import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { encodeSteelReviewTitleOwner } from 'librechat-data-provider';
import type { SteelReviewRow } from 'librechat-data-provider';
import {
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '~/models/steel';
import { createSteelReviewReadMethods } from './steelReview';
import { createModels } from '~/models';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    instance: { args: ['--setParameter', 'ttlMonitorEnabled=false'] },
  });
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

function titleProof(outputId: string, headers: readonly string[], rows: readonly SteelReviewRow[]) {
  const aiRows = rows.filter((row) => (row.origin ?? 'ai') === 'ai');
  let aiIndex = 0;
  const nextRows = rows.map((row) => {
    const values = Object.fromEntries(headers.map((header) => [
      header,
      row.values[header] ?? { baseline: '', effective: '' },
    ]));
    if ((row.origin ?? 'ai') !== 'ai') {
      return { ...row, values };
    }
    const baseline = headers.map((header) => values[header].baseline ?? '');
    const next = {
      ...row,
      values,
      rowId: createHash('sha256').update(`${outputId}:${aiIndex}:${JSON.stringify(baseline)}`).digest('hex'),
    };
    aiIndex += 1;
    return next;
  });
  const render = (tableRows: readonly string[][]) => [
    '## ocr_result',
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...tableRows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
  return {
    rows: nextRows,
    aiBaselineMarkdown: render(aiRows.map((row) => headers.map((header) => row.values[header]?.baseline ?? ''))),
    effectiveMarkdown: render(nextRows.filter((row) => !row.deleted)
      .map((row) => headers.map((header) => row.values[header]?.effective ?? ''))),
  };
}

async function seedTitleSidecarFixture(input: {
  conversationId: string;
  messageId: string;
  outputId: string;
  messageText: string;
  aiBaselineMarkdown: string;
  effectiveMarkdown: string;
  rows: SteelReviewRow[];
}) {
  const models = createModels(mongoose);
  const State = createSteelConversationOcrStateModel(mongoose);
  const ReviewOutput = createSteelReviewOutputModel(mongoose);
  await models.Conversation.create({
    conversationId: input.conversationId,
    user: 'title-proof-user',
    title: 'Title proof',
    endpoint: 'openAI',
  });
  await models.Message.create({
    messageId: input.messageId,
    conversationId: input.conversationId,
    user: 'title-proof-user',
    isCreatedByUser: false,
    text: input.messageText,
    content: [{ type: 'text', text: input.messageText }],
  });
  await State.create({
    conversationId: input.conversationId,
    currentOcrResultMarkdown: input.messageText,
    currentOcrResultMessageId: input.messageId,
    currentOcrResultGenerationId: input.outputId.replace(/^ocr_result:/u, ''),
  });
  await ReviewOutput.create({
    userId: 'title-proof-user',
    conversationId: input.conversationId,
    kind: 'ocr_result',
    messageId: input.messageId,
    tableId: 'legacy-positional-id',
    outputId: input.outputId,
    revision: input.outputId,
    state: 'current',
    headers: ['Code', 'Value'],
    rows: input.rows,
    aiBaselineMarkdown: input.aiBaselineMarkdown,
    effectiveMarkdown: input.effectiveMarkdown,
  });
  return createSteelReviewReadMethods(mongoose);
}

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Steel review read methods', () => {
  it('authorizes the message scope and returns the trusted current OCR owner', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| A | P-1 |',
    ].join('\n');
    await models.Message.create({
      messageId: 'assistant-1',
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: [
        '| ordinary | table |',
        '| --- | --- |',
        '| ignored | row |',
        '',
        markdown,
      ].join('\n'),
      content: [{
        type: 'text',
        text: [
          '| ordinary | table |',
          '| --- | --- |',
          '| ignored | row |',
          '',
          markdown,
        ].join('\n'),
      }],
    });
    await models.Conversation.create({
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await State.create({
      conversationId: 'conversation-1',
      sourceMappings: [{
        fileId: 'file-1',
        sourceCode: 'A',
        sourceFilename: 'drawing.pdf',
      }],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'assistant-1',
      currentOcrResultGenerationId: 'generation-1',
    });

    const record = await read.readSteelReview({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'assistant-1',
      tableId: 'ocr_result:2',
    });

    expect(record).toEqual(expect.objectContaining({
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      state: 'current',
      messageText: expect.stringContaining('| ordinary | table |'),
    }));
    expect(await read.readSteelReview({
      userId: 'other-user',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'assistant-1',
      tableId: 'ocr_result:2',
    })).toBeNull();

    const titleRecord = await read.readSteelReview({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'assistant-1',
      tableId: 'ocr_result:stale-prefix-index',
      partIndex: 99,
      title: 'ocr_result',
    });
    const expectedTitleId = `ocr_result:title:${createHash('sha256').update(encodeSteelReviewTitleOwner({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      kind: 'ocr_result',
      outputId: 'ocr_result:generation-1',
      title: 'ocr_result',
    })).digest('hex')}`;
    expect(titleRecord).toEqual(expect.objectContaining({
      title: 'ocr_result',
      tableId: expectedTitleId,
      messageTextPartIndex: undefined,
    }));
  });

  it('locates source files only when the file belongs to this user, tenant, and conversation', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();
    const foreignUserId = new mongoose.Types.ObjectId();
    const conversationId = 'source-file-scope-conversation';
    const markdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| trusted | P-1 |',
      '| cross-chat | P-2 |',
      '| cross-user | P-3 |',
      '| cross-tenant | P-4 |',
      '| missing | P-5 |',
      '| legacy | P-6 |',
      '| attached | P-7 |',
      '| unattached | P-8 |',
      '| other-user | P-9 |',
      '| other-tenant | P-10 |',
      '| expired | P-11 |',
      '| duplicate | P-12 |',
    ].join('\n');
    await models.Conversation.create({
      conversationId,
      user: userId.toString(),
      tenantId: 'tenant-source',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'source-file-message',
      conversationId,
      user: userId.toString(),
      tenantId: 'tenant-source',
      isCreatedByUser: false,
      text: markdown,
      content: [{ type: 'text', text: markdown }],
    });
    await models.Message.create({
      messageId: 'source-upload-message',
      conversationId,
      user: userId.toString(),
      tenantId: 'tenant-source',
      isCreatedByUser: true,
      text: 'Review uploaded source',
      files: [
        { file_id: 'attached-file' },
        { file_id: 'cross-chat-file' },
        { file_id: 'other-user-file' },
        { file_id: 'other-tenant-file' },
        { file_id: 'expired-file' },
        { file_id: 'duplicate-file' },
      ],
    });
    await models.File.create([
      {
        user: userId,
        tenantId: 'tenant-source',
        conversationId,
        file_id: 'trusted-file',
        bytes: 1,
        filename: 'trusted.pdf',
        filepath: '/uploads/trusted.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-source',
        file_id: 'attached-file',
        bytes: 1,
        filename: 'attached.pdf',
        filepath: '/uploads/attached.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-source',
        file_id: 'unattached-file',
        bytes: 1,
        filename: 'unattached.pdf',
        filepath: '/uploads/unattached.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: foreignUserId,
        tenantId: 'tenant-source',
        file_id: 'other-user-file',
        bytes: 1,
        filename: 'other-user.pdf',
        filepath: '/uploads/other-user.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'other-tenant',
        file_id: 'other-tenant-file',
        bytes: 1,
        filename: 'other-tenant.pdf',
        filepath: '/uploads/other-tenant.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-source',
        expiredAt: new Date(Date.now() - 60_000),
        file_id: 'expired-file',
        bytes: 1,
        filename: 'expired.pdf',
        filepath: '/uploads/expired.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-source',
        file_id: 'duplicate-file',
        bytes: 1,
        filename: 'duplicate-a.pdf',
        filepath: '/uploads/duplicate-a.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-source',
        file_id: 'duplicate-file',
        bytes: 1,
        filename: 'duplicate-b.pdf',
        filepath: '/uploads/duplicate-b.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-source',
        conversationId: 'other-conversation',
        messageId: 'source-file-message',
        file_id: 'cross-chat-file',
        bytes: 1,
        filename: 'cross-chat.pdf',
        filepath: '/uploads/cross-chat.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: foreignUserId,
        tenantId: 'tenant-source',
        conversationId,
        file_id: 'cross-user-file',
        bytes: 1,
        filename: 'cross-user.pdf',
        filepath: '/uploads/cross-user.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'other-tenant',
        conversationId,
        file_id: 'cross-tenant-file',
        bytes: 1,
        filename: 'cross-tenant.pdf',
        filepath: '/uploads/cross-tenant.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-source',
        messageId: 'source-file-message',
        file_id: 'legacy-message-file',
        bytes: 1,
        filename: 'legacy-message.pdf',
        filepath: '/uploads/legacy-message.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
    ]);
    await State.create({
      conversationId,
      sourceMappings: [
        { fileId: 'trusted-file', sourceCode: 'trusted', sourceFilename: 'spoof.pdf' },
        { fileId: 'cross-chat-file', sourceCode: 'cross-chat', sourceFilename: 'cross-chat.pdf' },
        { fileId: 'cross-user-file', sourceCode: 'cross-user', sourceFilename: 'cross-user.pdf' },
        { fileId: 'cross-tenant-file', sourceCode: 'cross-tenant', sourceFilename: 'cross-tenant.pdf' },
        { fileId: 'missing-file', sourceCode: 'missing', sourceFilename: 'missing.pdf' },
        { fileId: 'legacy-message-file', sourceCode: 'legacy', sourceFilename: 'legacy.pdf' },
        { fileId: 'attached-file', sourceCode: 'attached', sourceFilename: 'attached.pdf' },
        { fileId: 'unattached-file', sourceCode: 'unattached', sourceFilename: 'unattached.pdf' },
        { fileId: 'other-user-file', sourceCode: 'other-user', sourceFilename: 'other-user.pdf' },
        { fileId: 'other-tenant-file', sourceCode: 'other-tenant', sourceFilename: 'other-tenant.pdf' },
        { fileId: 'expired-file', sourceCode: 'expired', sourceFilename: 'expired.pdf' },
        { fileId: 'duplicate-file', sourceCode: 'duplicate', sourceFilename: 'duplicate.pdf' },
      ],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'source-file-message',
      currentOcrResultGenerationId: 'source-file-generation',
    });

    const current = await read.readSteelReview({
      userId: userId.toString(),
      tenantId: 'tenant-source',
      conversationId,
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'source-file-message',
      tableId: 'ocr_result:1',
    });
    expect(current?.sourceMappings).toEqual([{
      fileId: 'trusted-file',
      sourceCode: 'trusted',
      sourceFilename: 'trusted.pdf',
    }, {
      fileId: 'legacy-message-file',
      sourceCode: 'legacy',
      sourceFilename: 'legacy-message.pdf',
    }, {
      fileId: 'attached-file',
      sourceCode: 'attached',
      sourceFilename: 'attached.pdf',
    }]);

    await ReviewOutput.create({
      userId: userId.toString(),
      tenantId: 'tenant-source',
      conversationId,
      kind: 'ocr_result',
      title: 'ocr_result',
      messageId: 'source-file-message',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:source-file-generation',
      revision: 'source-file-generation',
      state: 'current',
      headers: ['來源', '零件編號'],
      sourceMappings: [{ fileId: 'trusted-file', sourceCode: 'trusted', sourceFilename: 'trusted.pdf' }],
      rows: [
        {
          rowId: 'trusted-row',
          values: { 來源: { baseline: 'trusted', effective: 'trusted' } },
          source: { fileId: 'trusted-file', pageNumber: 1, filename: 'spoof.pdf' },
        },
        {
          rowId: 'foreign-row',
          values: { 來源: { baseline: 'cross-chat', effective: 'cross-chat' } },
          source: { fileId: 'cross-chat-file', pageNumber: 1, filename: 'cross-chat.pdf' },
        },
        {
          rowId: 'missing-row',
          values: { 來源: { baseline: 'missing', effective: 'missing' } },
          source: { fileId: 'missing-file', pageNumber: 1, filename: 'missing.pdf' },
        },
        {
          rowId: 'other-user-row',
          values: { 來源: { baseline: 'other-user', effective: 'other-user' } },
          source: { fileId: 'other-user-file', pageNumber: 1, filename: 'other-user.pdf' },
        },
        {
          rowId: 'other-tenant-row',
          values: { 來源: { baseline: 'other-tenant', effective: 'other-tenant' } },
          source: { fileId: 'other-tenant-file', pageNumber: 1, filename: 'other-tenant.pdf' },
        },
        {
          rowId: 'expired-row',
          values: { 來源: { baseline: 'expired', effective: 'expired' } },
          source: { fileId: 'expired-file', pageNumber: 1, filename: 'expired.pdf' },
        },
      ],
    });
    const sourceOutput = await ReviewOutput.findOne({ outputId: 'ocr_result:source-file-generation' }).lean();
    if (!sourceOutput) throw new Error('source fixture missing');
    await ReviewOutput.updateOne(
      { outputId: sourceOutput.outputId },
      { $set: titleProof(sourceOutput.outputId, sourceOutput.headers, sourceOutput.rows) },
    );
    const sidecar = await read.readSteelReview({
      userId: userId.toString(),
      tenantId: 'tenant-source',
      conversationId,
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'source-file-message',
      tableId: 'ocr_result:1',
    });
    expect(sidecar?.rows).toEqual([
      expect.objectContaining({ source: { fileId: 'trusted-file', pageNumber: 1, filename: 'trusted.pdf' } }),
      expect.objectContaining({ source: null }),
      expect.objectContaining({ source: null }),
      expect.objectContaining({ source: null }),
      expect.objectContaining({ source: null }),
      expect.objectContaining({ source: null }),
    ]);
  });

  it('reads an explicitly owned historical sidecar without writing a message', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    await models.Message.create({
      messageId: 'assistant-history',
      conversationId: 'conversation-history',
      user: 'user-1',
      isCreatedByUser: false,
      text: '## ocr_result',
      content: [{ type: 'text', text: '## ocr_result' }],
    });
    await models.Conversation.create({
      conversationId: 'conversation-history',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await State.create({
      conversationId: 'conversation-history',
      sourceMappings: [],
      currentOcrResultMessageId: 'current-message',
      currentOcrResultGenerationId: 'new',
      currentOcrResultMarkdown: '## ocr_result',
    });
    await ReviewOutput.create({
      userId: 'user-1',
      conversationId: 'conversation-history',
      kind: 'ocr_result',
      title: 'ocr_result',
      messageId: 'assistant-history',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:old',
      revision: 'old-revision',
      state: 'historical',
      latestOutputId: 'ocr_result:new',
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
        },
        source: null,
      }],
    });
    const historicalOutput = await ReviewOutput.findOne({ outputId: 'ocr_result:old' }).lean();
    if (!historicalOutput) throw new Error('historical fixture missing');
    await ReviewOutput.updateOne(
      { outputId: historicalOutput.outputId },
      { $set: titleProof(historicalOutput.outputId, historicalOutput.headers, historicalOutput.rows) },
    );
    const before = await models.Message.countDocuments();
    const record = await read.readSteelReview({
      userId: 'user-1',
      conversationId: 'conversation-history',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'assistant-history',
      tableId: 'ocr_result:1',
    });

    expect(record).toEqual(expect.objectContaining({
      outputId: 'ocr_result:old',
      state: 'historical',
      latestOutputId: 'ocr_result:new',
      rows: expect.arrayContaining([expect.objectContaining({
        values: expect.objectContaining({
          '零件編號': { baseline: 'P-1', effective: 'P-1' },
        }),
      })]),
    }));
    expect(await models.Message.countDocuments()).toBe(before);
  });

  it('proves one title-owned baseline among other managed sections in a titleless sidecar', async () => {
    const outputId = 'ocr_result:multi-title-unique';
    const rowValues = {
      Code: { baseline: 'A', effective: 'A' },
      Value: { baseline: 'P-1', effective: 'P-1' },
    };
    const rowId = createHash('sha256')
      .update(`${outputId}:0:${JSON.stringify(['A', 'P-1'])}`)
      .digest('hex');
    const markdown = [
      '## ocr_result｜unrelated',
      '',
      '| Code | Value |',
      '| --- | --- |',
      '| X | other |',
      '',
      '## ocr_result',
      '',
      '| Code | Value |',
      '| --- | --- |',
      '| A | P-1 |',
    ].join('\n');
    const read = await seedTitleSidecarFixture({
      conversationId: 'multi-title-unique-conversation',
      messageId: 'multi-title-unique-message',
      outputId,
      messageText: markdown,
      aiBaselineMarkdown: markdown,
      effectiveMarkdown: markdown,
      rows: [{ rowId, source: null, values: rowValues }],
    });

    await expect(read.readSteelReview({
      userId: 'title-proof-user',
      conversationId: 'multi-title-unique-conversation',
      kind: 'ocr_result',
      messageId: 'multi-title-unique-message',
      title: 'ocr_result',
    })).resolves.toEqual(expect.objectContaining({
      outputId,
      title: 'ocr_result',
      rows: [expect.objectContaining({ rowId })],
    }));
  });

  it('resolves two independently proven titleless ledgers without cross-associating them', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const conversationId = 'multi-ledger-titleless-conversation';
    const messageId = 'multi-ledger-titleless-message';
    const outputId = 'ocr_result:multi-ledger-titleless';
    const markdown = [
      '## ocr_result｜first',
      '',
      '| Code | Value |',
      '| --- | --- |',
      '| A | P-1 |',
      '',
      '## ocr_result｜second',
      '',
      '| Code | Value |',
      '| --- | --- |',
      '| B | P-2 |',
    ].join('\n');
    const firstRowId = createHash('sha256')
      .update(`${outputId}:0:${JSON.stringify(['A', 'P-1'])}`)
      .digest('hex');
    const secondRowId = createHash('sha256')
      .update(`${outputId}:0:${JSON.stringify(['B', 'P-2'])}`)
      .digest('hex');
    const rows = (rowId: string, code: string, value: string): SteelReviewRow[] => [{
      rowId,
      source: null,
      origin: 'ai',
      deleted: false,
      values: {
        Code: { baseline: code, effective: code },
        Value: { baseline: value, effective: value },
      },
    }];
    await models.Conversation.create({
      conversationId, user: 'title-proof-user', title: 'Title proof', endpoint: 'openAI',
    });
    await models.Message.create({
      messageId, conversationId, user: 'title-proof-user', isCreatedByUser: false,
      text: markdown, content: [{ type: 'text', text: markdown }],
    });
    await State.create({
      conversationId, currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: messageId, currentOcrResultGenerationId: 'multi-ledger-titleless',
    });
    await ReviewOutput.create([
      {
        userId: 'title-proof-user', conversationId, kind: 'ocr_result', messageId,
        tableId: 'ledger-first', outputId, revision: outputId, state: 'historical',
        headers: ['Code', 'Value'], rows: rows(firstRowId, 'A', 'P-1'),
        aiBaselineMarkdown: markdown, effectiveMarkdown: markdown,
      },
      {
        userId: 'title-proof-user', conversationId, kind: 'ocr_result', messageId,
        tableId: 'ledger-second', outputId, revision: outputId, state: 'historical',
        headers: ['Code', 'Value'], rows: rows(secondRowId, 'B', 'P-2'),
        aiBaselineMarkdown: markdown, effectiveMarkdown: markdown,
      },
    ]);
    const before = await ReviewOutput.find({ conversationId }).lean();

    await expect(read.readSteelReview({
      userId: 'title-proof-user', conversationId, kind: 'ocr_result', messageId,
      title: 'ocr_result｜first',
    })).resolves.toEqual(expect.objectContaining({
      tableId: 'ledger-first',
      title: 'ocr_result｜first',
      rows: [expect.objectContaining({ rowId: firstRowId })],
    }));
    await expect(read.readSteelReview({
      userId: 'title-proof-user', conversationId, kind: 'ocr_result', messageId,
      title: 'ocr_result｜second',
    })).resolves.toEqual(expect.objectContaining({
      tableId: 'ledger-second',
      title: 'ocr_result｜second',
      rows: [expect.objectContaining({ rowId: secondRowId })],
    }));

    const after = await ReviewOutput.find({ conversationId }).lean();
    expect(after).toEqual(before);
    expect(after.every((candidate) => candidate.title === undefined)).toBe(true);
  });

  it('fails closed when two titleless managed sections prove the same requested ledger', async () => {
    const outputId = 'ocr_result:multi-title-ambiguous';
    const rowValues = {
      Code: { baseline: 'A', effective: 'A' },
      Value: { baseline: 'P-1', effective: 'P-1' },
    };
    const rowId = createHash('sha256')
      .update(`${outputId}:0:${JSON.stringify(['A', 'P-1'])}`)
      .digest('hex');
    const markdown = [
      '## ocr_result',
      '',
      '| Code | Value |',
      '| --- | --- |',
      '| A | P-1 |',
      '',
      '## ocr_result｜alias',
      '',
      '| Code | Value |',
      '| --- | --- |',
      '| A | P-1 |',
    ].join('\n');
    const read = await seedTitleSidecarFixture({
      conversationId: 'multi-title-ambiguous-conversation',
      messageId: 'multi-title-ambiguous-message',
      outputId,
      messageText: markdown,
      aiBaselineMarkdown: markdown,
      effectiveMarkdown: markdown,
      rows: [{ rowId, source: null, values: rowValues }],
    });

    await expect(read.readSteelReview({
      userId: 'title-proof-user',
      conversationId: 'multi-title-ambiguous-conversation',
      kind: 'ocr_result',
      messageId: 'multi-title-ambiguous-message',
      title: 'ocr_result',
    })).resolves.toBeNull();
  });

  it('derives sidecar latest status from the same-kind canonical owner', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const oldMarkdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | OLD |';
    const currentMarkdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | CURRENT |';
    await models.Conversation.create({
      conversationId: 'sidecar-current-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'sidecar-old-message',
      conversationId: 'sidecar-current-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: oldMarkdown,
      content: [{ type: 'text', text: oldMarkdown }],
    });
    await models.Message.create({
      messageId: 'sidecar-current-message',
      conversationId: 'sidecar-current-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: currentMarkdown,
      content: [{ type: 'text', text: currentMarkdown }],
    });
    await State.create({
      conversationId: 'sidecar-current-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: currentMarkdown,
      currentOcrResultMessageId: 'sidecar-current-message',
      currentOcrResultGenerationId: 'generation-current',
    });
    await ReviewOutput.create({
      userId: 'user-1',
      conversationId: 'sidecar-current-conversation',
      kind: 'ocr_result',
      title: 'ocr_result',
      messageId: 'sidecar-old-message',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:old-sidecar',
      revision: 'old-revision',
      state: 'current',
      latestOutputId: 'ocr_result:old-sidecar',
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-old',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'OLD', effective: 'OLD' },
        },
        source: null,
      }],
    });
    const oldSidecar = await ReviewOutput.findOne({ outputId: 'ocr_result:old-sidecar' }).lean();
    if (!oldSidecar) throw new Error('old sidecar fixture missing');
    await ReviewOutput.updateOne(
      { outputId: oldSidecar.outputId },
      { $set: titleProof(oldSidecar.outputId, oldSidecar.headers, oldSidecar.rows) },
    );

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'sidecar-current-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'sidecar-old-message',
      tableId: 'ocr_result:1',
    })).resolves.toEqual(expect.objectContaining({
      outputId: 'ocr_result:old-sidecar',
      latestOutputId: 'ocr_result:generation-current',
      state: 'current',
    }));
  });

  it('chooses the unique sidecar owned by the current OCR generation instead of freshness', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | CURRENT |';
    await models.Conversation.create({
      conversationId: 'sidecar-authority-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'sidecar-authority-message',
      conversationId: 'sidecar-authority-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: markdown,
      content: [{ type: 'text', text: markdown }],
    });
    await State.create({
      conversationId: 'sidecar-authority-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'sidecar-authority-message',
      currentOcrResultGenerationId: 'generation-new',
    });
    const sidecar = {
      userId: 'user-1',
      conversationId: 'sidecar-authority-conversation',
      kind: 'ocr_result' as const,
      title: 'ocr_result',
      messageId: 'sidecar-authority-message',
      tableId: 'ocr_result:1',
      revision: 'revision',
      state: 'current' as const,
      headers: ['來源', '零件編號'],
      rows: [],
    };
    await ReviewOutput.create([
      { ...sidecar, outputId: 'ocr_result:generation-old', revision: 'old' },
      { ...sidecar, outputId: 'ocr_result:generation-new', revision: 'new' },
    ]);
    for (const outputId of ['ocr_result:generation-old', 'ocr_result:generation-new']) {
      await ReviewOutput.updateOne(
        { outputId },
        { $set: titleProof(outputId, sidecar.headers, sidecar.rows) },
      );
    }
    await ReviewOutput.updateOne(
      { outputId: 'ocr_result:generation-old' },
      { $set: { updatedAt: new Date(Date.now() + 60_000) } },
    );

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'sidecar-authority-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'sidecar-authority-message',
      tableId: 'ocr_result:1',
    })).resolves.toEqual(expect.objectContaining({
      outputId: 'ocr_result:generation-new',
      revision: 'new',
    }));
  });

  it('supports a native text-only message without inventing a content-part locator', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | P-1 |';
    await models.Conversation.create({
      conversationId: 'text-only-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'text-only-message',
      conversationId: 'text-only-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: markdown,
    });
    await State.create({
      conversationId: 'text-only-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'text-only-message',
      currentOcrResultGenerationId: 'text-only-generation',
    });

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'text-only-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'text-only-message',
      tableId: 'ocr_result:1',
    })).resolves.toEqual(expect.objectContaining({
      outputId: 'ocr_result:text-only-generation',
      messageText: markdown,
      messageTextParts: [],
      messageTextPartIndex: undefined,
    }));
  });

  it('fails closed for legacy OCR state when the conversation id is shared across owners', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | P-1 |';
    await models.Conversation.create([
      {
        conversationId: 'collision-conversation',
        user: 'owner-a',
        tenantId: 'tenant-a',
        title: 'Review',
        endpoint: 'openAI',
      },
      {
        conversationId: 'collision-conversation',
        user: 'owner-b',
        tenantId: 'tenant-b',
        title: 'Foreign review',
        endpoint: 'openAI',
      },
      {
        conversationId: 'tenantless-collision-conversation',
        user: 'owner-c',
        title: 'Review',
        endpoint: 'openAI',
      },
      {
        conversationId: 'tenantless-collision-conversation',
        user: 'owner-c',
        tenantId: 'tenant-c',
        title: 'Foreign tenant review',
        endpoint: 'openAI',
      },
    ]);
    await models.Message.create([
      {
        messageId: 'collision-message',
        conversationId: 'collision-conversation',
        user: 'owner-a',
        tenantId: 'tenant-a',
        isCreatedByUser: false,
        text: markdown,
        content: [{ type: 'text', text: markdown }],
      },
      {
        messageId: 'tenantless-collision-message',
        conversationId: 'tenantless-collision-conversation',
        user: 'owner-c',
        isCreatedByUser: false,
        text: markdown,
        content: [{ type: 'text', text: markdown }],
      },
    ]);
    await State.create([
      {
        conversationId: 'collision-conversation',
        sourceMappings: [],
        currentOcrResultMarkdown: markdown,
        currentOcrResultMessageId: 'collision-message',
        currentOcrResultGenerationId: 'foreignable-generation',
      },
      {
        conversationId: 'tenantless-collision-conversation',
        sourceMappings: [],
        currentOcrResultMarkdown: markdown,
        currentOcrResultMessageId: 'tenantless-collision-message',
        currentOcrResultGenerationId: 'tenantless-foreignable-generation',
      },
    ]);

    await expect(read.readSteelReview({
      userId: 'owner-a',
      tenantId: 'tenant-a',
      conversationId: 'collision-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'collision-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();
    await expect(read.readSteelReview({
      userId: 'owner-c',
      conversationId: 'tenantless-collision-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'tenantless-collision-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();
  });

  it('does not expose an unaccepted superseded OCR candidate as history', async () => {
    const models = createModels(mongoose);
    const Run = createSteelDelegateOcrRunModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | P-1 |';
    await models.Conversation.create({
      conversationId: 'superseded-history-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'superseded-history-message',
      conversationId: 'superseded-history-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: markdown,
      content: [{ type: 'text', text: markdown }],
    });
    await Run.create({
      conversationId: 'superseded-history-conversation',
      delegateOcrIndex: 1,
      claimToken: 'superseded-claim',
      triggeringMessageId: 'trigger-message',
      toolParameters: {},
      files: [],
      status: 'superseded',
      currentStage: 'failed',
      finalizedCandidate: {
        token: 'candidate-token',
        markdown,
        source: 'agent',
        generationId: 'unaccepted-generation',
        targetMessageId: 'superseded-history-message',
      },
      finalizationJournal: {
        candidateValidated: true,
        resultPersisted: false,
        messagePersisted: false,
        claimCleared: true,
      },
    });

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'superseded-history-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'superseded-history-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();
  });

  it('reads a published historical system order from its owned quotation run artifact', async () => {
    const models = createModels(mongoose);
    const QuotationState = createSteelQuotationStateModel(mongoose);
    const QuotationArtifact = createSteelQuotationArtifactModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = [
      '## system_order',
      '',
      '| 類別 | 零件編號 | 數量 |',
      '| --- | --- | --- |',
      '| 材料 | P-1 | 2 |',
    ].join('\n');
    const finalPayload = `${markdown}\n\n## quote_summary\n\n完成`;
    const finalSha256 = createHash('sha256').update(finalPayload).digest('hex');
    await models.Conversation.create({
      conversationId: 'historical-order-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'historical-order-message',
      conversationId: 'historical-order-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: finalPayload,
      content: [{ type: 'text', text: finalPayload }],
    });
    await QuotationState.create({
      userId: 'user-1',
      conversationId: 'historical-order-conversation',
      currentSystemOrder: {
        runId: 'run-current',
        sha256: 'current-revision',
        markdown,
        messageId: 'current-order-message',
        updatedAt: new Date(),
      },
      nextSignalIndex: 2,
      tickets: [{
        index: 1,
        token: 'ticket-token',
        orderHash: 'order-hash',
        customerMarkdown: 'customer',
        customerIdentity: 'customer-id',
        triggeringMessageId: 'trigger-message',
        selectionProvenance: { method: 'unique' },
        issuedAt: new Date(),
        responseId: 'historical-order-message',
        acceptedRunId: 'run-old',
      }],
      pendingMessages: [],
    });
    await QuotationArtifact.create([
      {
        userId: 'user-1',
        conversationId: 'historical-order-conversation',
        runId: 'run-old',
        operationId: 'final',
        kind: 'final',
        sha256: finalSha256,
        payload: finalPayload,
      },
      {
        userId: 'user-1',
        conversationId: 'historical-order-conversation',
        runId: 'run-old',
        operationId: 'published',
        kind: 'final',
        sha256: createHash('sha256').update(JSON.stringify({ finalSha256 })).digest('hex'),
        payload: JSON.stringify({ finalSha256 }),
      },
      {
        userId: 'user-1',
        conversationId: 'historical-order-conversation',
        runId: 'run-old',
        operationId: 'archive',
        kind: 'archive',
        sha256: createHash('sha256').update(JSON.stringify({
          run: { runId: 'run-old', status: 'completed', targetMessageId: 'historical-order-message' },
        })).digest('hex'),
        payload: JSON.stringify({
          run: { runId: 'run-old', status: 'completed', targetMessageId: 'historical-order-message' },
        }),
      },
    ]);

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'historical-order-conversation',
      title: 'system_order',
      kind: 'system_order',
      messageId: 'historical-order-message',
      tableId: 'system_order:1',
    })).resolves.toEqual(expect.objectContaining({
      outputId: 'system_order:run-old',
      revision: finalSha256,
      state: 'historical',
      latestOutputId: 'system_order:run-current',
      messageText: finalPayload,
    }));
  });

  it('rejects a message whose conversation is missing or expired', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    await models.Message.create({
      messageId: 'orphan-message',
      conversationId: 'orphan-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: '## ocr_result',
      content: [{ type: 'text', text: '## ocr_result' }],
    });
    await State.create({
      conversationId: 'orphan-conversation',
      currentOcrResultMarkdown: '## ocr_result',
      currentOcrResultMessageId: 'orphan-message',
      currentOcrResultGenerationId: 'generation-1',
      sourceMappings: [],
    });
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'orphan-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'orphan-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();

    await models.Conversation.create({
      conversationId: 'expired-conversation',
      user: 'user-1',
      expiredAt: new Date(Date.now() - 60_000),
      title: 'Expired',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'expired-message',
      conversationId: 'expired-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: '## ocr_result',
    });
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'expired-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'expired-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();
  });

  it('rejects a stale or ambiguous rendered content mirror', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| A | P-1 |',
    ].join('\n');
    await models.Conversation.create({
      conversationId: 'mirror-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await State.create({
      conversationId: 'mirror-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'mirror-message',
      currentOcrResultGenerationId: 'generation-1',
    });
    await models.Message.create({
      messageId: 'mirror-message',
      conversationId: 'mirror-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: markdown,
      content: [{ type: 'text', text: markdown.replace('P-1', 'P-2') }],
    });
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'mirror-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'mirror-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();

    await models.Message.updateOne(
      { messageId: 'mirror-message' },
      { $set: { content: [{ type: 'text', text: markdown }, { type: 'text', text: markdown }] } },
    );
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'mirror-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'mirror-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();
  });

  it('reads a selected rendered part without combining unrelated text parts', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const firstPart = '| ordinary | table |\n| --- | --- |\n| keep | this |';
    const secondPart = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | P-1 |';
    await models.Conversation.create({
      conversationId: 'multi-part-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'multi-part-message',
      conversationId: 'multi-part-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: `${firstPart} ${secondPart}`,
      content: [{ type: 'text', text: firstPart }, { type: 'text', text: secondPart }],
    });
    await State.create({
      conversationId: 'multi-part-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: secondPart,
      currentOcrResultMessageId: 'multi-part-message',
      currentOcrResultGenerationId: 'generation-multi-part',
    });

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'multi-part-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'multi-part-message',
      tableId: 'ocr_result:2',
    })).resolves.toEqual(expect.objectContaining({
      messageTextParts: [
        { partIndex: 0, text: firstPart },
        { partIndex: 1, text: secondPart },
      ],
      messageTextPartIndex: undefined,
    }));
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'multi-part-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'multi-part-message',
      tableId: 'ocr_result:2',
    })).resolves.toEqual(expect.objectContaining({
      messageText: `${firstPart} ${secondPart}`,
      messageTextPartIndex: undefined,
      messageTextParts: [{ partIndex: 0, text: firstPart }, { partIndex: 1, text: secondPart }],
    }));
  });

  it('uses the full physical message when validating a title-owned receipt', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();
    const user = userId.toString();
    const conversationId = 'legacy-selected-part-proof';
    const messageId = 'legacy-selected-part-message';
    const outputId = 'ocr_result:legacy-selected-part-generation';
    const revision = 'legacy-selected-part-revision';
    const operationId = 'legacy-selected-part-operation';
    const digest = 'legacy-selected-part-digest';
    const firstPart = 'LEGACY-PREFIX';
    const selectedPart = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | P-1 |';
    const thirdPart = 'LEGACY-SUFFIX';
    const messageText = `${firstPart} ${selectedPart} ${thirdPart}`;
    const headers = ['來源', '零件編號'];
    const rows = [{
      rowId: 'legacy-selected-part-row',
      values: {
        來源: { baseline: 'A', effective: 'A' },
        零件編號: { baseline: 'P-1', effective: 'P-1' },
      },
      source: { fileId: 'legacy-selected-part-file', pageNumber: 1, filename: 'alpha.pdf' },
    }];
    const savedAt = new Date();
    const snapshot = {
      operationId,
      digest,
      outputId,
      revision,
      headers,
      rows,
      changedRows: 0,
      changedRowIds: [],
      savedAt,
      messageSha256: createHash('sha256').update(messageText).digest('hex'),
      conversationId,
      messageId,
      messageText,
      effectiveMarkdown: selectedPart,
      displayMarkdown: selectedPart,
    };
    await models.Conversation.create({
      conversationId,
      user,
      title: 'Legacy selected part proof',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId,
      conversationId,
      user,
      isCreatedByUser: false,
      text: messageText,
      content: [
        { type: 'text', text: firstPart },
        { type: 'text', text: selectedPart },
        { type: 'text', text: thirdPart },
      ],
    });
    await models.File.create({
      user: userId,
      conversationId,
      file_id: 'legacy-selected-part-file',
      bytes: 1,
      filename: 'alpha.pdf',
      filepath: '/uploads/alpha.pdf',
      object: 'file',
      type: 'application/pdf',
      source: 'local',
      usage: 0,
    });
    await State.create({
      conversationId,
      sourceMappings: [],
      currentOcrResultMarkdown: selectedPart,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'legacy-selected-part-generation',
    });
    await ReviewOutput.create({
      userId: user,
      conversationId,
      kind: 'ocr_result',
      title: 'ocr_result',
      messageId,
      tableId: 'ocr_result:1',
      outputId,
      revision,
      state: 'current',
      headers,
      rows,
      sourceMappings: [{ fileId: 'legacy-selected-part-file', sourceCode: 'A', sourceFilename: 'alpha.pdf' }],
      effectiveMarkdown: selectedPart,
      displayMarkdown: selectedPart,
      receipts: [{
        operationId,
        digest,
        revision,
        changedRows: 0,
        changedRowIds: [],
        savedAt,
        snapshot,
      }],
    });
    const selectedOutput = await ReviewOutput.findOne({ outputId }).lean();
    if (!selectedOutput) throw new Error('selected part fixture missing');
    await ReviewOutput.updateOne(
      { outputId: selectedOutput.outputId },
      { $set: titleProof(selectedOutput.outputId, selectedOutput.headers, selectedOutput.rows) },
    );

    const input = {
      userId: user,
      conversationId,
      kind: 'ocr_result' as const,
      messageId,
      title: 'ocr_result',
    };
    const located = await read.readSteelReview(input);
    expect(located?.sourceMappings).toEqual([{
      fileId: 'legacy-selected-part-file',
      sourceCode: 'A',
      sourceFilename: 'alpha.pdf',
    }]);
    expect(located?.rows?.map((row) => row.source)).toEqual([
      { fileId: 'legacy-selected-part-file', pageNumber: 1, filename: 'alpha.pdf' },
    ]);

    await ReviewOutput.updateOne(
      { conversationId, messageId, outputId },
      { $set: { 'receipts.0.snapshot.messageSha256': '0'.repeat(64) } },
    );
    const unlocated = await read.readSteelReview(input);
    expect(unlocated?.rows?.map((row) => row.source)).toEqual([
      { fileId: 'legacy-selected-part-file', pageNumber: 1, filename: 'alpha.pdf' },
    ]);
    expect(unlocated?.sourceMappings).toEqual([{
      fileId: 'legacy-selected-part-file',
      sourceCode: 'A',
      sourceFilename: 'alpha.pdf',
    }]);
  });

  it('keeps tenantless reads isolated from tenant-owned messages and sidecars', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | P-1 |';
    await models.Conversation.create([
      { conversationId: 'tenant-conversation', user: 'user-1', tenantId: 'tenant-a', title: 'Review', endpoint: 'openAI' },
      { conversationId: 'tenantless-conversation', user: 'user-1', title: 'Review', endpoint: 'openAI' },
    ]);
    await models.Message.create([
      {
        messageId: 'tenant-message',
        conversationId: 'tenant-conversation',
        user: 'user-1',
        tenantId: 'tenant-a',
        isCreatedByUser: false,
        text: markdown,
        content: [{ type: 'text', text: markdown }],
      },
      {
        messageId: 'tenantless-message',
        conversationId: 'tenantless-conversation',
        user: 'user-1',
        isCreatedByUser: false,
        text: markdown,
        content: [{ type: 'text', text: markdown }],
      },
    ]);
    await State.create({
      conversationId: 'tenant-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'tenant-message',
      currentOcrResultGenerationId: 'generation-tenant',
    });
    await State.create({
      conversationId: 'tenantless-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'tenantless-message',
      currentOcrResultGenerationId: 'generation-tenantless',
    });
    await ReviewOutput.create({
      userId: 'user-1',
      tenantId: 'tenant-a',
      conversationId: 'tenant-conversation',
      kind: 'ocr_result',
      messageId: 'tenant-message',
      tableId: 'ocr_result:1',
      outputId: 'tenant-output',
      revision: 'tenant-revision',
      state: 'current',
      headers: ['來源', '零件編號'],
      rows: [],
    });

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'tenant-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'tenant-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();
    await expect(read.readSteelReview({
      userId: 'user-1',
      tenantId: 'tenant-a',
      conversationId: 'tenant-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'tenant-message',
      tableId: 'ocr_result:1',
    })).resolves.toEqual(expect.objectContaining({
      outputId: 'ocr_result:generation-tenant',
      latestOutputId: 'ocr_result:generation-tenant',
      state: 'current',
    }));
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'tenantless-conversation',
      title: 'ocr_result',
      kind: 'ocr_result',
      messageId: 'tenantless-message',
      tableId: 'ocr_result:1',
    })).resolves.toEqual(expect.objectContaining({ outputId: 'ocr_result:generation-tenantless' }));
  });

  it('requires an active unique clicked message before exposing OCR state', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | P-1 |';
    const userId = 'expired-read-user';
    const tenantId = 'expired-read-tenant';
    const conversations = [
      'expired-empty-conversation',
      'expired-populated-conversation',
    ];
    await models.Conversation.create(conversations.map((conversationId) => ({
      conversationId,
      user: userId,
      tenantId,
      title: 'Review',
      endpoint: 'openAI',
    })));
    await models.Message.create([
      {
        messageId: 'expired-empty-message',
        conversationId: conversations[0],
        user: userId,
        tenantId,
        isCreatedByUser: false,
        text: markdown,
        content: [{ type: 'text', text: markdown }],
        expiredAt: new Date(Date.now() - 60_000),
      },
      {
        messageId: 'expired-populated-message',
        conversationId: conversations[1],
        user: userId,
        tenantId,
        isCreatedByUser: false,
        text: markdown,
        content: [{ type: 'text', text: markdown }],
        expiredAt: new Date(Date.now() - 60_000),
      },
    ]);
    await State.create([
      {
        conversationId: conversations[0],
        sourceMappings: [],
        currentOcrResultMarkdown: markdown,
        currentOcrResultMessageId: 'expired-empty-message',
        currentOcrResultGenerationId: 'expired-empty-generation',
      },
      {
        conversationId: conversations[1],
        sourceMappings: [{ fileId: 'expired-source', sourceCode: 'A', sourceFilename: 'expired.pdf' }],
        currentOcrResultMarkdown: markdown,
        currentOcrResultMessageId: 'expired-populated-message',
        currentOcrResultGenerationId: 'expired-populated-generation',
      },
    ]);

    const before = await Promise.all([
      models.Message.countDocuments(),
      State.countDocuments(),
    ]);
    for (const [conversationId, messageId] of [
      [conversations[0], 'expired-empty-message'],
      [conversations[1], 'expired-populated-message'],
    ] as const) {
      await expect(read.readSteelReview({
        userId,
        tenantId,
        conversationId,
        title: 'ocr_result',
        kind: 'ocr_result',
        messageId,
        tableId: 'ocr_result:1',
      })).resolves.toBeNull();
    }
    const after = await Promise.all([
      models.Message.countDocuments(),
      State.countDocuments(),
    ]);
    expect(after).toEqual(before);
  });

});
