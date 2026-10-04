import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { encodeSteelReviewDigest } from 'librechat-data-provider';
import type { SteelReviewRow } from 'librechat-data-provider';
import {
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '~/models/steel';
import {
  createSteelReviewWriteMethods,
  type SteelReviewCommitInput,
} from './steelReview';
import { createFileModel } from '~/models/file';
import { createModels } from '~/models';

let mongoServer: MongoMemoryReplSet;

const markdownFor = (value: string, source = 'A') => [
  '## ocr_result',
  '',
  '| 來源 | 零件編號 |',
  '| --- | --- |',
  `| ${source} | ${value} |`,
].join('\n');

const aiRowIdFor = (outputId: string, row: readonly string[], rowIndex = 0): string =>
  createHash('sha256').update(`${outputId}:${rowIndex}:${JSON.stringify(row)}`).digest('hex');

const digestFor = (input: Omit<SteelReviewCommitInput, 'digest'>): string => {
  const firstRow = input.rows[0];
  const value = firstRow?.values['零件編號']?.effective ?? null;
  return createHash('sha256').update(encodeSteelReviewDigest({
    userId: input.userId,
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
    conversationId: input.conversationId,
    messageId: input.messageId,
    kind: input.kind,
    title: input.title ?? 'ocr_result',
    outputId: input.outputId,
    revision: input.revision,
    operationId: input.operationId,
    operations: [{
      type: 'update',
      rowId: firstRow?.rowId ?? 'row-1',
      changes: [{ header: '零件編號', value }],
    }],
  })).digest('hex');
};

const makeInput = ({
  operationId,
  revision,
  previousValue,
  nextValue,
  changedRows = 1,
  sourceValue = 'A',
  userId = 'user-1',
  conversationId = 'conversation-1',
  messageId = 'assistant-1',
}: {
  operationId: string;
  revision: string;
  previousValue: string;
  nextValue: string;
  changedRows?: number;
  sourceValue?: string;
  userId?: string;
  conversationId?: string;
  messageId?: string;
}): SteelReviewCommitInput => {
  const currentMarkdown = markdownFor(previousValue, sourceValue);
  const targetText = currentMarkdown.slice(currentMarkdown.indexOf('| 來源 |'));
  const replacementText = [
    '| 來源 | 零件編號 |',
    '| --- | --- |',
    `| A | ${nextValue} |`,
  ].join('\n');
  const rows: SteelReviewRow[] = [{
    rowId: 'row-1',
    values: {
      來源: { baseline: sourceValue, effective: sourceValue },
      零件編號: { baseline: 'P-1', effective: nextValue },
    },
    source: null,
  }];
  const base: Omit<SteelReviewCommitInput, 'digest'> = {
    userId,
    tenantId: 'tenant-1',
    conversationId,
    kind: 'ocr_result',
    messageId,
    title: 'ocr_result',
    tableId: 'ocr_result:1',
    outputId: 'ocr_result:generation-1',
    revision,
    operationId,
    rows,
    headers: ['來源', '零件編號'],
    messageSha256: createHash('sha256').update(currentMarkdown).digest('hex'),
    target: {
      start: currentMarkdown.indexOf('| 來源 |'),
      end: currentMarkdown.length,
      sha256: createHash('sha256').update(targetText).digest('hex'),
    },
    targetText,
    replacementText,
    cleanReplacementText: replacementText,
    effectiveMarkdown: currentMarkdown.replace(targetText, replacementText),
    displayMarkdown: currentMarkdown.replace(targetText, replacementText),
    aiBaselineMarkdown: markdownFor('P-1', sourceValue),
    aiRawMarkdown: markdownFor('P-1', sourceValue),
    caption: { kind: 'ocr_result', changedRows, changedRowIds: changedRows === 0 ? [] : ['row-1'] },
  };
  return { ...base, digest: digestFor(base) };
};

const rehashInput = (input: Omit<SteelReviewCommitInput, 'digest'>): SteelReviewCommitInput => {
  return { ...input, digest: digestFor(input) };
};

const withoutReviewLockToken = <T extends { reviewLockToken?: string }>(value: T): Omit<T, 'reviewLockToken'> => {
  const { reviewLockToken: _reviewLockToken, ...rest } = value;
  return rest;
};

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Steel review write methods', () => {
  it('returns the immutable first receipt after a later save', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    await models.Conversation.create({
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    const aiUpdatedAt = new Date('2026-10-03T00:00:00.000Z');
    await models.Message.create({
      messageId: 'assistant-1',
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: markdownFor('P-1'),
      metadata: {
        steel: { preserve: true },
        steelReview: { system_order: { version: 1, kind: 'system_order', revision: 'other' } },
      },
    });
    await State.create({
      conversationId: 'conversation-1',
      currentOcrResultMarkdown: markdownFor('P-1'),
      currentOcrResultMessageId: 'assistant-1',
      currentOcrResultGenerationId: 'generation-1',
      currentOcrResultProvenance: {
        generationId: 'generation-1',
        attemptNumber: 1,
        messageId: 'assistant-1',
        updatedAt: aiUpdatedAt,
      },
    });
    const stateBefore = await State.findOne({ conversationId: 'conversation-1' }).lean();

    const writer = createSteelReviewWriteMethods(mongoose);
    const first = makeInput({
      operationId: 'operation-1',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
    });
    const firstResult = await writer.commitSteelReview(first);
    const stateAfterFirst = await State.findOne({ conversationId: 'conversation-1' }).lean();
    expect(stateAfterFirst?.reviewLockToken).toEqual(expect.any(String));
    const second = makeInput({
      operationId: 'operation-2',
      revision: firstResult.revision,
      previousValue: 'P-7',
      nextValue: 'P-8',
    });
    const secondResult = await writer.commitSteelReview(second);
    const stateAfterSecond = await State.findOne({ conversationId: 'conversation-1' }).lean();
    expect(stateAfterSecond?.reviewLockToken).toEqual(expect.any(String));
    expect(stateAfterSecond?.reviewLockToken).not.toBe(stateAfterFirst?.reviewLockToken);
    const noop = makeInput({
      operationId: 'operation-noop',
      revision: secondResult.revision,
      previousValue: 'P-8',
      nextValue: 'P-8',
      changedRows: 0,
    });
    await expect(writer.commitSteelReview(noop)).resolves.toMatchObject({ changedRows: 0 });
    const replay = await writer.commitSteelReview(first);
    const changedPayload = makeInput({
      operationId: 'operation-1',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-9',
    });

    expect(replay).toEqual(firstResult);
    expect(replay.revision).not.toBe(secondResult.revision);
    expect(replay.effectiveMarkdown).toContain('P-7');
    expect(replay.effectiveMarkdown).not.toContain('P-8');
    const saved = await ReviewOutput.findOne({
      userId: 'user-1',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      tableId: 'ocr_result:1',
    }).lean();
    expect(saved?.receipts).toHaveLength(2);
    expect(saved?.receipts[0]?.snapshot?.revision).toBe(firstResult.revision);
    expect(saved?.receipts[0]?.snapshot?.effectiveMarkdown).toContain('P-7');
    expect(saved?.receipts[0]?.snapshot?.messageTextParts).toBeUndefined();
    expect(saved?.receipts[0]?.snapshot?.ownerUpdated).toMatchObject({
      version: 1,
      kind: 'ocr_result',
      messageId: 'assistant-1',
      outputId: 'ocr_result:generation-1',
      revision: firstResult.revision,
    });
    const stateAfter = await State.findOne({ conversationId: 'conversation-1' }).lean();
    expect(withoutReviewLockToken(stateAfter!)).toEqual(withoutReviewLockToken(stateBefore!));
    expect(stateAfter?.reviewLockToken).toBe(stateAfterSecond?.reviewLockToken);
    const savedMessage = await models.Message.findOne({ messageId: 'assistant-1' }).lean();
    expect(savedMessage?.metadata?.steel).toEqual({ preserve: true });
    expect(savedMessage?.metadata?.steelReview).toMatchObject({
      system_order: { revision: 'other' },
      ocr_result: { revision: secondResult.revision },
    });
    await expect(writer.commitSteelReview(changedPayload)).rejects.toMatchObject({
      code: 'REVIEW_CONFLICT',
    });
    const unchanged = await ReviewOutput.findOne({
      userId: 'user-1',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      tableId: 'ocr_result:1',
    }).lean();
    expect(unchanged?.receipts).toHaveLength(2);
    await expect(writer.readSteelReviewReceipt({
      userId: 'other-user',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'assistant-1',
      title: 'ocr_result',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      operationId: 'operation-1',
      digest: first.digest,
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' });
  });

  it('persists a manual ledger row and counts its later tombstone exactly once', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId: 'conversation-1', user: 'user-1', tenantId: 'tenant-1', title: 'Review', endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'assistant-1', conversationId: 'conversation-1', user: 'user-1', tenantId: 'tenant-1',
      isCreatedByUser: false, text: originalMarkdown,
    });
    await State.create({
      conversationId: 'conversation-1', currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: 'assistant-1', currentOcrResultGenerationId: 'generation-1',
    });
    const aiRow: SteelReviewRow = {
      rowId: aiRowIdFor('ocr_result:generation-1', ['A', 'P-1']), origin: 'ai', deleted: false, source: null,
      values: { 來源: { baseline: 'A', effective: 'A' }, 零件編號: { baseline: 'P-1', effective: 'P-1' } },
    };
    const manualRow: SteelReviewRow = {
      rowId: 'row-manual', origin: 'manual', deleted: false, source: null,
      insertion: { kind: 'end', ordinal: 0 },
      values: { 來源: { baseline: null, effective: '' }, 零件編號: { baseline: null, effective: 'P-1' } },
    };
    const firstMarkdown = [originalMarkdown, '| A | P-1 |'].join('\n');
    const makeLedgerInput = (args: {
      operationId: string;
      revision: string;
      rows: SteelReviewRow[];
      oldMarkdown: string;
      nextMarkdown: string;
      changedRowIds: string[];
    }): SteelReviewCommitInput => {
      const targetText = args.oldMarkdown.slice(args.oldMarkdown.indexOf('| 來源 |'));
      const replacementText = args.nextMarkdown.slice(args.nextMarkdown.indexOf('| 來源 |'));
      return rehashInput({
        ...makeInput({ operationId: args.operationId, revision: args.revision, previousValue: 'P-1', nextValue: 'P-1', changedRows: args.changedRowIds.length }),
        rows: args.rows,
        messageSha256: createHash('sha256').update(args.oldMarkdown).digest('hex'),
        target: { start: args.oldMarkdown.indexOf('| 來源 |'), end: args.oldMarkdown.length, sha256: createHash('sha256').update(targetText).digest('hex') },
        targetText,
        replacementText,
        cleanReplacementText: replacementText,
        effectiveMarkdown: args.oldMarkdown.replace(targetText, replacementText),
        displayMarkdown: args.oldMarkdown.replace(targetText, replacementText),
        caption: { kind: 'ocr_result', changedRows: args.changedRowIds.length, changedRowIds: args.changedRowIds },
      });
    };
    const writer = createSteelReviewWriteMethods(mongoose);
    const first = await writer.commitSteelReview(makeLedgerInput({
      operationId: 'operation-manual', revision: 'generation-1', rows: [aiRow, manualRow],
      oldMarkdown: originalMarkdown, nextMarkdown: firstMarkdown, changedRowIds: ['row-manual'],
    }));
    expect(first.changedRows).toBe(1);
    const savedFirst = await ReviewOutput.findOne({ conversationId: 'conversation-1', tableId: 'ocr_result:1' }).lean();
    expect(savedFirst?.rows.map((row) => row.rowId)).toEqual([aiRow.rowId, 'row-manual']);
    expect(savedFirst?.rows[1]).toMatchObject({ origin: 'manual', deleted: false });

    const deletedManual = { ...manualRow, deleted: true };
    const secondMarkdown = originalMarkdown;
    const second = await writer.commitSteelReview(makeLedgerInput({
      operationId: 'operation-delete-manual', revision: first.revision, rows: [aiRow, deletedManual],
      oldMarkdown: firstMarkdown, nextMarkdown: secondMarkdown, changedRowIds: ['row-manual'],
    }));
    expect(second.changedRows).toBe(1);
    const savedSecond = await ReviewOutput.findOne({ conversationId: 'conversation-1', tableId: 'ocr_result:1' }).lean();
    expect(savedSecond?.rows[1]).toMatchObject({ rowId: 'row-manual', origin: 'manual', deleted: true });
    expect(second.effectiveMarkdown).not.toContain('| A | P-1 |\n| A | P-1 |');
  });

  it('saves an all-deleted first ledger as a header-only table', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId: 'conversation-all-delete', user: 'user-1', tenantId: 'tenant-1',
      title: 'Review', endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'assistant-all-delete', conversationId: 'conversation-all-delete', user: 'user-1',
      tenantId: 'tenant-1', isCreatedByUser: false, text: originalMarkdown,
    });
    await State.create({
      conversationId: 'conversation-all-delete', currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: 'assistant-all-delete', currentOcrResultGenerationId: 'generation-all-delete',
    });
    const base = makeInput({
      operationId: 'operation-all-delete', revision: 'generation-all-delete',
      previousValue: 'P-1', nextValue: 'P-1', changedRows: 1,
      conversationId: 'conversation-all-delete', messageId: 'assistant-all-delete',
    });
    const targetText = originalMarkdown.slice(originalMarkdown.indexOf('| 來源 |'));
    const headerOnly = ['| 來源 | 零件編號 |', '| --- | --- |'].join('\n');
    const input = rehashInput({
      ...base,
      outputId: 'ocr_result:generation-all-delete',
      rows: base.rows.map((row) => ({
        ...row,
        rowId: aiRowIdFor('ocr_result:generation-all-delete', ['A', 'P-1']),
        origin: 'ai',
        deleted: true,
      })),
      targetText,
      replacementText: headerOnly,
      cleanReplacementText: headerOnly,
      effectiveMarkdown: originalMarkdown.replace(targetText, headerOnly),
      displayMarkdown: originalMarkdown.replace(targetText, headerOnly),
      caption: {
        kind: 'ocr_result',
        changedRows: 1,
        changedRowIds: [aiRowIdFor('ocr_result:generation-all-delete', ['A', 'P-1'])],
      },
    });

    const result = await createSteelReviewWriteMethods(mongoose).commitSteelReview(input);
    expect(result.changedRows).toBe(1);
    expect(result.changedRowIds).toEqual([aiRowIdFor('ocr_result:generation-all-delete', ['A', 'P-1'])]);
    expect(result.effectiveMarkdown).toBe(originalMarkdown.replace(targetText, headerOnly));
    await expect(models.Message.findOne({ messageId: 'assistant-all-delete' }).lean())
      .resolves.toMatchObject({ text: result.effectiveMarkdown });
    await expect(ReviewOutput.findOne({ conversationId: 'conversation-all-delete' }).lean())
      .resolves.toMatchObject({
        rows: [expect.objectContaining({
          rowId: aiRowIdFor('ocr_result:generation-all-delete', ['A', 'P-1']),
          origin: 'ai',
          deleted: true,
        })],
      });
  });

  it('rejects a noncanonical effective cell before claiming or writing state', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    await models.Conversation.create({
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    const markdown = markdownFor('P-1');
    await models.Message.create({
      messageId: 'assistant-1',
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: markdown,
    });
    await State.create({
      conversationId: 'conversation-1',
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'assistant-1',
      currentOcrResultGenerationId: 'generation-1',
    });
    const stateBefore = await State.findOne({ conversationId: 'conversation-1' }).lean();
    const messageBefore = await models.Message.findOne({ messageId: 'assistant-1' }).lean();
    const writer = createSteelReviewWriteMethods(mongoose);
    const noncanonical = makeInput({
      operationId: 'operation-noncanonical',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: '  P-7  ',
    });

    await expect(writer.commitSteelReview(noncanonical)).rejects.toMatchObject({
      code: 'REVIEW_INVALID_OPERATION',
    });
    const stateAfter = await State.findOne({ conversationId: 'conversation-1' }).lean();
    const messageAfter = await models.Message.findOne({ messageId: 'assistant-1' }).lean();
    expect(withoutReviewLockToken(stateAfter!)).toEqual(withoutReviewLockToken(stateBefore!));
    expect(stateAfter?.reviewLockToken).toBeUndefined();
    expect(messageAfter?.text).toBe(messageBefore?.text);
    await expect(ReviewOutput.findOne({
      userId: 'user-1',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      tableId: 'ocr_result:1',
    }).lean()).resolves.toBeNull();
  });

  it('creates the exact clicked sidecar when another owner reuses the output id', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const conversationId = 'exact-owner-conversation';
    const messageId = 'exact-owner-message';
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Exact owner',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId,
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: originalMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    const unrelatedFields = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId,
      kind: 'ocr_result',
      messageId: 'other-message',
      tableId: 'ocr_result:other',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      state: 'current',
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'other-row',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          '零件編號': { baseline: 'OTHER', effective: 'OTHER' },
        },
        source: null,
      }],
      effectiveMarkdown: markdownFor('OTHER'),
      displayMarkdown: markdownFor('OTHER'),
      receipts: [],
    };
    await ReviewOutput.create(unrelatedFields);
    await createSteelReviewWriteMethods(mongoose).commitSteelReview(makeInput({
      operationId: 'exact-owner-operation',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
      conversationId,
      messageId,
    }));

    const outputs = await ReviewOutput.find({ conversationId }).lean();
    expect(outputs).toHaveLength(2);
    const unrelatedAfter = (await ReviewOutput.find({
      messageId: 'other-message',
      tableId: 'ocr_result:other',
      outputId: 'ocr_result:generation-1',
    }).lean())[0];
    expect(unrelatedAfter).toMatchObject(unrelatedFields);
    expect(await ReviewOutput.findOne({ messageId }).lean()).toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId,
      kind: 'ocr_result',
      messageId,
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      state: 'current',
    });
  });

  it('classifies only an owned message and trusted OCR history as managed', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const Run = createSteelDelegateOcrRunModel(mongoose);
    const conversationId = 'conversation-guard';
    const messageId = 'assistant-guard';
    await models.Conversation.create({
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId,
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: markdownFor('P-1'),
    });
    const writer = createSteelReviewWriteMethods(mongoose);
    const scope = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId,
      messageId,
    };

    await expect(writer.checkSteelReviewMessageMutation(scope)).resolves.toEqual({
      ok: true,
      value: { managed: false },
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: markdownFor('P-1'),
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-current',
    });
    await expect(writer.checkSteelReviewMessageMutation(scope)).resolves.toEqual({
      ok: true,
      value: { managed: true },
    });
    await State.deleteMany({ conversationId });
    await Run.create({
      conversationId,
      delegateOcrIndex: 1,
      claimToken: 'guard-history-claim',
      triggeringMessageId: 'trigger-message',
      toolParameters: {},
      files: [],
      status: 'completed',
      currentStage: 'completed',
      responseGenerationId: 'generation-history',
      finalizedCandidate: {
        token: 'guard-history-token',
        markdown: markdownFor('P-1'),
        source: 'agent',
        generationId: 'generation-history',
        targetMessageId: messageId,
      },
      finalizationJournal: {
        candidateValidated: true,
        resultPersisted: true,
        messagePersisted: true,
        claimCleared: true,
      },
    });
    await expect(writer.checkSteelReviewMessageMutation(scope)).resolves.toEqual({
      ok: true,
      value: { managed: true },
    });
    await expect(writer.checkSteelReviewMessageMutation({
      ...scope,
      userId: 'foreign-user',
    })).resolves.toEqual({ ok: false, error: { code: 'REVIEW_NOT_FOUND' } });
    await expect(writer.checkSteelReviewMessageMutation({
      ...scope,
      tenantId: 'foreign-tenant',
    })).resolves.toEqual({ ok: false, error: { code: 'REVIEW_NOT_FOUND' } });
    await models.Conversation.create({
      conversationId,
      user: 'foreign-user',
      tenantId: 'foreign-tenant',
      title: 'Ambiguous identity',
      endpoint: 'openAI',
    });
    await expect(writer.checkSteelReviewMessageMutation(scope)).resolves.toEqual({
      ok: false,
      error: { code: 'REVIEW_NOT_FOUND' },
    });
  });

  it('marks only a quotation with trusted OCR lineage stale in the same transaction', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const QuotationState = createSteelQuotationStateModel(mongoose);
    const conversations = ['linked-conversation', 'unrelated-conversation'];
    await models.Conversation.create(conversations.map((conversationId) => ({
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Review',
      endpoint: 'openAI',
    })));
    await models.Message.create(conversations.map((conversationId) => ({
      messageId: `${conversationId}-message`,
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: markdownFor('P-1'),
    })));
    await State.create(conversations.map((conversationId) => ({
      conversationId,
      currentOcrResultMarkdown: markdownFor('P-1'),
      currentOcrResultMessageId: `${conversationId}-message`,
      currentOcrResultGenerationId: 'generation-1',
    })));
    const ocrHash = createHash('sha256').update(markdownFor('P-1')).digest('hex');
    const quotationBase = {
      currentSystemOrder: {
        runId: 'run-linked',
        sha256: 'system-order-hash',
        markdown: '## system_order',
        messageId: 'system-order-message',
        updatedAt: new Date('2026-10-03T00:00:00.000Z'),
      },
      nextSignalIndex: 2,
      pendingMessages: [],
    };
    await QuotationState.create({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'linked-conversation',
      ...quotationBase,
      tickets: [{
        index: 1,
        token: 'ticket-linked',
        orderHash: 'system-order-hash',
        customerMarkdown: 'customer',
        customerIdentity: 'customer-id',
        triggeringMessageId: 'trigger-message',
        selectionProvenance: { method: 'unique' },
        issuedAt: new Date('2026-10-03T00:00:00.000Z'),
        acceptedRunId: 'run-linked',
        completionReceipt: {
          inputHash: 'input-linked',
          markdown: '## system_order',
          ocrGeneration: 'generation-1',
          ocrHash,
        },
      }],
    });
    await QuotationState.create({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'unrelated-conversation',
      ...quotationBase,
      currentSystemOrder: { ...quotationBase.currentSystemOrder, runId: 'run-unrelated' },
      tickets: [{
        index: 1,
        token: 'ticket-unrelated',
        orderHash: 'system-order-hash',
        customerMarkdown: 'customer',
        customerIdentity: 'customer-id',
        triggeringMessageId: 'trigger-message',
        selectionProvenance: { method: 'unique' },
        issuedAt: new Date('2026-10-03T00:00:00.000Z'),
        acceptedRunId: 'run-unrelated',
        completionReceipt: {
          inputHash: 'input-unrelated',
          markdown: '## system_order',
          ocrGeneration: 'different-generation',
          ocrHash: 'different-hash',
        },
      }],
    });
    const unrelatedBefore = await QuotationState.findOne({ conversationId: 'unrelated-conversation' }).lean();
    const input = makeInput({
      operationId: 'linked-operation',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
      conversationId: 'linked-conversation',
      messageId: 'linked-conversation-message',
    });
    const writer = createSteelReviewWriteMethods(mongoose);
    await writer.commitSteelReview(input);

    const linked = await QuotationState.findOne({ conversationId: 'linked-conversation' }).lean();
    expect(linked?.currentSystemOrder).toMatchObject({
      runId: 'run-linked',
      needsRequote: true,
      requoteProvenance: {
        sourceKind: 'ocr_result',
        sourceMessageId: 'linked-conversation-message',
        sourceOutputId: 'ocr_result:generation-1',
        changedRows: 1,
      },
    });
    const unrelatedAfter = await QuotationState.findOne({ conversationId: 'unrelated-conversation' }).lean();
    expect(unrelatedAfter).toEqual(unrelatedBefore);
  });

  it('rejects source association cell edits before first and later sidecar writes', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const conversationId = 'source-guard-conversation';
    const messageId = 'source-guard-message';
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Source guard',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId,
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: originalMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    const writer = createSteelReviewWriteMethods(mongoose);
    const first = makeInput({
      operationId: 'source-guard-first',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
      conversationId,
      messageId,
    });
    const forgedFirst = rehashInput({
      ...first,
      rows: first.rows.map((row) => ({
        ...row,
        values: { ...row.values, 來源: { ...row.values.來源, effective: 'FORGED-SOURCE' } },
      })),
    });
    await expect(writer.commitSteelReview(forgedFirst)).rejects.toMatchObject({
      code: 'REVIEW_INVALID_OPERATION',
    });
    expect(await ReviewOutput.findOne({ conversationId }).lean()).toBeNull();
    expect(await models.Message.findOne({ messageId }).lean()).toMatchObject({ text: originalMarkdown });
    expect((await State.findOne({ conversationId }).lean())?.reviewLockToken).toBeUndefined();

    const firstResult = await writer.commitSteelReview(first);
    const second = makeInput({
      operationId: 'source-guard-second',
      revision: firstResult.revision,
      previousValue: 'P-7',
      nextValue: 'P-8',
      conversationId,
      messageId,
    });
    await writer.commitSteelReview(second);
    const savedBeforeForgedLater = await ReviewOutput.findOne({ conversationId }).lean();
    const tokenBeforeForgedLater = (await State.findOne({ conversationId }).lean())?.reviewLockToken;
    const later = makeInput({
      operationId: 'source-guard-forged-later',
      revision: savedBeforeForgedLater?.revision ?? '',
      previousValue: 'P-8',
      nextValue: 'P-9',
      conversationId,
      messageId,
    });
    const forgedLater = rehashInput({
      ...later,
      rows: later.rows.map((row) => ({
        ...row,
        values: { ...row.values, 來源: { ...row.values.來源, effective: 'FORGED-SOURCE' } },
      })),
    });
    await expect(writer.commitSteelReview(forgedLater)).rejects.toMatchObject({
      code: 'REVIEW_INVALID_OPERATION',
    });
    expect((await ReviewOutput.findOne({ conversationId }).lean())?.receipts).toHaveLength(2);
    expect((await State.findOne({ conversationId }).lean())?.reviewLockToken).toBe(tokenBeforeForgedLater);
  });

  it('derives a fresh ledger baseline from server OCR markdown before accepting rows', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const conversationId = 'server-baseline-conversation';
    const messageId = 'server-baseline-message';
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId, user: 'user-1', tenantId: 'tenant-1', title: 'Server baseline', endpoint: 'openAI',
    });
    await models.Message.create({
      messageId, conversationId, user: 'user-1', tenantId: 'tenant-1', isCreatedByUser: false,
      text: originalMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    const base = makeInput({
      operationId: 'server-baseline-forged', revision: 'generation-1', previousValue: 'P-1', nextValue: 'P-7',
      conversationId, messageId,
    });
    const rowId = aiRowIdFor('ocr_result:generation-1', ['A', 'P-1']);
    const forged = rehashInput({
      ...base,
      rows: base.rows.map((row) => ({
        ...row,
        rowId,
        origin: 'ai' as const,
        deleted: false,
        values: {
          ...row.values,
          零件編號: { baseline: 'FORGED-AI', effective: 'P-7' },
        },
      })),
      caption: { kind: 'ocr_result', changedRows: 1, changedRowIds: [rowId] },
    });
    await expect(createSteelReviewWriteMethods(mongoose).commitSteelReview(forged)).rejects.toMatchObject({
      code: 'REVIEW_CONFLICT',
    });
    expect(await ReviewOutput.findOne({ conversationId }).lean()).toBeNull();
    expect(await models.Message.findOne({ messageId }).lean()).toMatchObject({ text: originalMarkdown });
    expect((await State.findOne({ conversationId }).lean())?.reviewLockToken).toBeUndefined();
  });

  it('rejects a new operation baseline forged through legacy-shaped rows', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const conversationId = 'server-baseline-legacy-shaped-conversation';
    const messageId = 'server-baseline-legacy-shaped-message';
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId, user: 'user-1', tenantId: 'tenant-1', title: 'Server baseline', endpoint: 'openAI',
    });
    await models.Message.create({
      messageId, conversationId, user: 'user-1', tenantId: 'tenant-1', isCreatedByUser: false,
      text: originalMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    const base = makeInput({
      operationId: 'server-baseline-legacy-shaped', revision: 'generation-1', previousValue: 'P-1', nextValue: 'P-7',
      conversationId, messageId,
    });
    const rowId = aiRowIdFor('ocr_result:generation-1', ['A', 'P-1']);
    const forged = rehashInput({
      ...base,
      rows: base.rows.map((row) => ({
        ...row,
        rowId,
        values: {
          ...row.values,
          零件編號: { baseline: 'FORGED-AI', effective: 'P-7' },
        },
      })),
      caption: { kind: 'ocr_result', changedRows: 1, changedRowIds: [rowId] },
    });
    const operation = { ...forged, operationDigest: forged.digest };
    await expect(createSteelReviewWriteMethods(mongoose).commitSteelReview(operation)).rejects.toMatchObject({
      code: 'REVIEW_CONFLICT',
    });
    expect(await ReviewOutput.findOne({ conversationId }).lean()).toBeNull();
  });

  it('rejects a new operation with an unknown captured revision without writing state', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const conversationId = 'unknown-revision-conversation';
    const messageId = 'unknown-revision-message';
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId, user: 'user-1', tenantId: 'tenant-1', title: 'Unknown revision', endpoint: 'openAI',
    });
    await models.Message.create({
      messageId, conversationId, user: 'user-1', tenantId: 'tenant-1', isCreatedByUser: false,
      text: originalMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    const base = makeInput({
      operationId: 'unknown-revision-operation',
      revision: 'unknown-never-existed',
      previousValue: 'P-1',
      nextValue: 'P-7',
      conversationId,
      messageId,
    });
    const operation = {
      ...base,
      operationDigest: base.digest,
      requestDigest: 'request-digest',
    };
    const snapshot = async () => ({
      message: await models.Message.findOne({ messageId }).lean(),
      output: await ReviewOutput.findOne({ conversationId }).lean(),
      state: await State.findOne({ conversationId }).lean(),
    });
    const before = await snapshot();
    await expect(createSteelReviewWriteMethods(mongoose).commitSteelReview(operation)).rejects.toMatchObject({
      code: 'REVIEW_CONFLICT',
    });
    expect(await snapshot()).toEqual(before);
  });

  it('allows a business save when the existing source association is blank', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const conversationId = 'blank-source-conversation';
    const messageId = 'blank-source-message';
    const originalMarkdown = markdownFor('P-1', '');
    await models.Conversation.create({
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Blank source',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId,
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: originalMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    await expect(createSteelReviewWriteMethods(mongoose).commitSteelReview(makeInput({
      operationId: 'blank-source-save',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
      sourceValue: '',
      conversationId,
      messageId,
    }))).resolves.toMatchObject({ changedRows: 1 });
  });

  it('persists a source-only correction without marking the quotation stale', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const QuotationState = createSteelQuotationStateModel(mongoose);
    const File = createFileModel(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const conversationId = 'source-only-conversation';
    const messageId = 'source-only-message';
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId,
      user: userId,
      tenantId: 'tenant-1',
      title: 'Source only',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId,
      conversationId,
      user: userId,
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: originalMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    await File.create({
      user: userId,
      tenantId: 'tenant-1',
      conversationId,
      file_id: 'source-only-file',
      bytes: 12,
      filename: 'replacement.pdf',
      filepath: '/uploads/replacement.pdf',
      object: 'file',
      type: 'application/pdf',
      source: 'local',
      usage: 0,
    });
    const writer = createSteelReviewWriteMethods(mongoose);
    const firstResult = await writer.commitSteelReview(makeInput({
      userId,
      operationId: 'source-only-bootstrap',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
      conversationId,
      messageId,
    }));
    await QuotationState.create({
      conversationId,
      userId,
      tenantId: 'tenant-1',
      currentSystemOrder: {
        runId: 'source-only-run',
        messageId: 'order-message',
        ocrMessageId: messageId,
        ocrOutputId: 'ocr_result:generation-1',
        markdown: '## system_order\n| 型號 | 數量 |\n| --- | --- |\n| KEEP | 1 |',
        sha256: createHash('sha256').update('source-only-order').digest('hex'),
        updatedAt: new Date('2026-10-03T00:00:00.000Z'),
        needsRequote: false,
      },
    });

    const currentMarkdown = markdownFor('P-7');
    const targetText = currentMarkdown.slice(currentMarkdown.indexOf('| 來源 |'));
    const replacementText = markdownFor('P-7', 'F1').slice(markdownFor('P-7', 'F1').indexOf('| 來源 |'));
    const sourceOnlyBase: Omit<SteelReviewCommitInput, 'digest'> = {
      ...makeInput({
        userId,
        operationId: 'source-only-correction',
        revision: firstResult.revision,
        previousValue: 'P-7',
        nextValue: 'P-7',
        conversationId,
        messageId,
      }),
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'F1' },
          零件編號: { baseline: 'P-1', effective: 'P-7' },
        },
        source: {
          fileId: 'source-only-file',
          pageNumber: 2,
          filename: 'replacement.pdf',
          mediaType: 'application/pdf',
        },
      }],
      sourceIntents: [{ rowId: 'row-1', fileId: 'source-only-file', pageNumber: 2 }],
      sourceMappings: [{
        fileId: 'source-only-file',
        sourceCode: 'F1',
        sourceFilename: 'replacement.pdf',
        mediaType: 'application/pdf',
      }],
      messageSha256: createHash('sha256').update(currentMarkdown).digest('hex'),
      target: {
        start: currentMarkdown.indexOf('| 來源 |'),
        end: currentMarkdown.length,
        sha256: createHash('sha256').update(targetText).digest('hex'),
      },
      targetText,
      replacementText,
      cleanReplacementText: replacementText,
      effectiveMarkdown: currentMarkdown.replace(targetText, replacementText),
      displayMarkdown: currentMarkdown.replace(targetText, replacementText),
      caption: { kind: 'ocr_result', changedRows: 1, changedRowIds: ['row-1'] },
    };
    const sourceOnly = rehashInput(sourceOnlyBase);

    await expect(writer.commitSteelReview(sourceOnly)).resolves.toMatchObject({ changedRows: 1 });
    const saved = await ReviewOutput.findOne({ conversationId }).lean();
    expect(saved?.rows[0]?.source).toMatchObject({ fileId: 'source-only-file', pageNumber: 2 });
    expect(saved?.sourceMappings).toEqual([expect.objectContaining({
      fileId: 'source-only-file',
      sourceCode: 'F1',
      sourceFilename: 'replacement.pdf',
    })]);
    expect(saved?.receipts?.[1]?.snapshot?.sourceMappings).toEqual(saved?.sourceMappings);
    expect(await models.Message.findOne({ messageId }).lean()).toMatchObject({
      text: expect.stringContaining('| F1 | P-7 |'),
    });
    expect(await QuotationState.findOne({ conversationId }).lean()).toMatchObject({
      currentSystemOrder: { needsRequote: false },
    });
  });

  it('rejects persisted source metadata disappearing before any transaction write', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const File = createFileModel(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const conversationId = 'source-metadata-conversation';
    const messageId = 'source-metadata-message';
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId,
      user: userId,
      tenantId: 'tenant-1',
      title: 'Source metadata',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId,
      conversationId,
      user: userId,
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: originalMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    await File.create({
      user: userId,
      tenantId: 'tenant-1',
      conversationId,
      file_id: 'source-metadata-file',
      bytes: 12,
      filename: 'drawing.pdf',
      filepath: '/uploads/drawing.pdf',
      object: 'file',
      type: 'application/pdf',
      source: 'local',
      usage: 0,
    });
    const writer = createSteelReviewWriteMethods(mongoose);
    await writer.commitSteelReview(makeInput({
      userId,
      operationId: 'source-metadata-bootstrap',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
      conversationId,
      messageId,
    }));
    const source = {
      fileId: 'source-metadata-file',
      pageNumber: 1,
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
    };
    const output = await ReviewOutput.findOne({ conversationId }).lean();
    expect(output).not.toBeNull();
    await ReviewOutput.updateOne({ _id: output!._id }, {
      $set: { rows: output!.rows.map((row) => ({ ...row, source })) },
    });
    const before = {
      output: await ReviewOutput.findOne({ conversationId }).lean(),
      message: await models.Message.findOne({ messageId }).lean(),
      state: await State.findOne({ conversationId }).lean(),
    };

    await expect(writer.commitSteelReview(makeInput({
      userId,
      operationId: 'source-metadata-forged',
      revision: before.output!.revision,
      previousValue: 'P-7',
      nextValue: 'P-8',
      conversationId,
      messageId,
    }))).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });

    expect({
      output: await ReviewOutput.findOne({ conversationId }).lean(),
      message: await models.Message.findOne({ messageId }).lean(),
      state: await State.findOne({ conversationId }).lean(),
    }).toEqual(before);
  });

  it('allows a business save when an existing source file is no longer available', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const File = createFileModel(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const conversationId = 'unavailable-source-conversation';
    const messageId = 'unavailable-source-message';
    const originalMarkdown = markdownFor('P-1');
    await models.Conversation.create({
      conversationId,
      user: userId,
      tenantId: 'tenant-1',
      title: 'Unavailable source',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId,
      conversationId,
      user: userId,
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: originalMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: originalMarkdown,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    await File.create({
      user: userId,
      tenantId: 'tenant-1',
      conversationId,
      file_id: 'unavailable-source-file',
      bytes: 12,
      filename: 'drawing.pdf',
      filepath: '/uploads/drawing.pdf',
      object: 'file',
      type: 'application/pdf',
      source: 'local',
      usage: 0,
    });
    const writer = createSteelReviewWriteMethods(mongoose);
    await writer.commitSteelReview(makeInput({
      userId,
      operationId: 'unavailable-source-bootstrap',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
      conversationId,
      messageId,
    }));
    const output = await ReviewOutput.findOne({ conversationId }).lean();
    expect(output).not.toBeNull();
    const source = {
      fileId: 'unavailable-source-file',
      pageNumber: 1,
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
    };
    await ReviewOutput.updateOne({ _id: output!._id }, {
      $set: { rows: output!.rows.map((row) => ({ ...row, source })) },
    });
    const beforeOutput = await ReviewOutput.findOne({ conversationId }).lean();
    const beforeState = await State.findOne({ conversationId }).lean();
    await File.updateOne({ file_id: 'unavailable-source-file' }, {
      $set: { expiredAt: new Date(Date.now() - 60_000) },
    });
    const noOpBefore = {
      output: await ReviewOutput.findOne({ conversationId }).lean(),
      message: await models.Message.findOne({ messageId }).lean(),
      state: await State.findOne({ conversationId }).lean(),
    };
    await expect(writer.commitSteelReview(makeInput({
      userId,
      operationId: 'unavailable-source-noop',
      revision: beforeOutput!.revision,
      previousValue: 'P-7',
      nextValue: 'P-7',
      changedRows: 0,
      conversationId,
      messageId,
    }))).resolves.toMatchObject({ changedRows: 0 });
    expect({
      output: await ReviewOutput.findOne({ conversationId }).lean(),
      message: await models.Message.findOne({ messageId }).lean(),
      state: await State.findOne({ conversationId }).lean(),
    }).toEqual(noOpBefore);

    await expect(writer.commitSteelReview(makeInput({
      userId,
      operationId: 'unavailable-source-business-save',
      revision: beforeOutput!.revision,
      previousValue: 'P-7',
      nextValue: 'P-8',
      conversationId,
      messageId,
    }))).resolves.toMatchObject({ changedRows: 1 });

    const afterOutput = await ReviewOutput.findOne({ conversationId }).lean();
    const afterState = await State.findOne({ conversationId }).lean();
    expect(withoutReviewLockToken(afterState!)).toEqual(withoutReviewLockToken(beforeState!));
    expect(afterOutput?.rows[0]?.source).toBeNull();
    expect(afterOutput?.rows[0]?.values.來源).toEqual({ baseline: 'A', effective: 'A' });
    expect(afterOutput?.aiRawMarkdown).toBe(beforeOutput?.aiRawMarkdown);
    expect(afterOutput?.aiBaselineMarkdown).toBe(beforeOutput?.aiBaselineMarkdown);
    expect(afterOutput?.receipts?.[0]).toEqual(beforeOutput?.receipts?.[0]);

    const reattachSource = async () => {
      const current = await ReviewOutput.findOne({ conversationId }).lean();
      await ReviewOutput.updateOne({ _id: current!._id }, {
        $set: { rows: current!.rows.map((row) => ({ ...row, source })) },
      });
    };
    const saveUnavailable = async (operationId: string, previousValue: string, nextValue: string) => {
      const current = await ReviewOutput.findOne({ conversationId }).lean();
      return writer.commitSteelReview(makeInput({
        userId,
        operationId,
        revision: current!.revision,
        previousValue,
        nextValue,
        conversationId,
        messageId,
      }));
    };

    await reattachSource();
    await File.deleteMany({ file_id: 'unavailable-source-file' });
    const deletedBefore = await ReviewOutput.findOne({ conversationId }).lean();
    await expect(saveUnavailable('unavailable-source-deleted', 'P-8', 'P-9')).resolves.toMatchObject({ changedRows: 1 });
    const deletedAfter = await ReviewOutput.findOne({ conversationId }).lean();
    expect(deletedAfter?.rows[0]?.source).toBeNull();
    expect(deletedAfter?.receipts?.[0]).toEqual(deletedBefore?.receipts?.[0]);

    await reattachSource();
    await File.create([{
      user: userId,
      tenantId: 'tenant-1',
      conversationId,
      file_id: 'unavailable-source-file',
      bytes: 12,
      filename: 'drawing-a.pdf',
      filepath: '/uploads/drawing-a.pdf',
      object: 'file',
      type: 'application/pdf',
      source: 'local',
      usage: 0,
    }, {
      user: userId,
      tenantId: 'tenant-1',
      conversationId,
      file_id: 'unavailable-source-file',
      bytes: 12,
      filename: 'drawing-b.pdf',
      filepath: '/uploads/drawing-b.pdf',
      object: 'file',
      type: 'application/pdf',
      source: 'local',
      usage: 0,
    }]);
    const ambiguousBefore = await ReviewOutput.findOne({ conversationId }).lean();
    await expect(saveUnavailable('unavailable-source-ambiguous', 'P-9', 'P-10')).resolves.toMatchObject({ changedRows: 1 });
    const ambiguousAfter = await ReviewOutput.findOne({ conversationId }).lean();
    expect(ambiguousAfter?.rows[0]?.source).toBeNull();
    expect(ambiguousAfter?.receipts?.[0]).toEqual(ambiguousBefore?.receipts?.[0]);
  });

  it('rolls back sidecar, message metadata, receipt, and quotation stale state on a mid-transaction failure', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const QuotationState = createSteelQuotationStateModel(mongoose);
    const conversationId = 'rollback-conversation';
    const messageId = 'rollback-message';
    await models.Conversation.create({
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId,
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: markdownFor('P-1'),
      metadata: { steelReview: { system_order: { revision: 'keep' } } },
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: markdownFor('P-1'),
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'generation-1',
    });
    const ocrHash = createHash('sha256').update(markdownFor('P-1')).digest('hex');
    await QuotationState.create({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId,
      currentSystemOrder: {
        runId: 'rollback-run',
        sha256: 'system-order-hash',
        markdown: '## system_order',
        messageId: 'system-order-message',
        updatedAt: new Date('2026-10-03T00:00:00.000Z'),
      },
      nextSignalIndex: 1,
      tickets: [{
        index: 1,
        token: 'rollback-ticket',
        orderHash: 'system-order-hash',
        customerMarkdown: 'customer',
        customerIdentity: 'customer-id',
        triggeringMessageId: 'trigger-message',
        selectionProvenance: { method: 'unique' },
        issuedAt: new Date('2026-10-03T00:00:00.000Z'),
        acceptedRunId: 'rollback-run',
        completionReceipt: {
          inputHash: 'rollback-input',
          markdown: '## system_order',
          ocrGeneration: 'generation-1',
          ocrHash,
        },
      }],
      pendingMessages: [],
    });
    const beforeMessage = await models.Message.findOne({ messageId }).lean();
    const beforeState = await State.findOne({ conversationId }).lean();
    const beforeQuotation = await QuotationState.findOne({ conversationId }).lean();
    const injectedFailure = jest.spyOn(QuotationState, 'updateOne').mockImplementationOnce(() => {
      throw new Error('injected quotation write failure');
    });
    try {
      const writer = createSteelReviewWriteMethods(mongoose);
      await expect(writer.commitSteelReview(makeInput({
        operationId: 'rollback-operation',
        revision: 'generation-1',
        previousValue: 'P-1',
        nextValue: 'P-7',
        conversationId,
        messageId,
      }))).rejects.toBeDefined();
    } finally {
      injectedFailure.mockRestore();
    }
    expect(await ReviewOutput.findOne({ conversationId }).lean()).toBeNull();
    expect(await models.Message.findOne({ messageId }).lean()).toEqual(beforeMessage);
    expect(await State.findOne({ conversationId }).lean()).toEqual(beforeState);
    expect(await QuotationState.findOne({ conversationId }).lean()).toEqual(beforeQuotation);
  });

  it('rejects a save when a newer AI generation wins after the transactional OCR read', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const conversationId = 'generation-race-conversation';
    const oldMessageId = 'generation-race-old-message';
    const newMessageId = 'generation-race-new-message';
    const oldMarkdown = markdownFor('P-1');
    const newMarkdown = markdownFor('AI-NEXT');
    await models.Conversation.create({
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Generation race',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: oldMessageId,
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: oldMarkdown,
    });
    await State.create({
      conversationId,
      currentOcrResultMarkdown: oldMarkdown,
      currentOcrResultMessageId: oldMessageId,
      currentOcrResultGenerationId: 'generation-1',
      currentOcrResultProvenance: {
        generationId: 'generation-1',
        attemptNumber: 1,
        messageId: oldMessageId,
      },
    });
    await models.Message.create({
      messageId: newMessageId,
      conversationId,
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: newMarkdown,
    });

    let releaseRead: (() => void) | undefined;
    const reachedRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const originalExec = mongoose.Query.prototype.exec;
    let paused = false;
    let releaseBarrier: (() => void) | undefined;
    const continueSave = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const execSpy = jest.spyOn(mongoose.Query.prototype, 'exec');
    execSpy.mockImplementation(async function (this: mongoose.Query<unknown, unknown>) {
      const value = await originalExec.call(this);
      if (!paused && this.model.modelName === 'SteelConversationOcrState' &&
        this.getOptions().session) {
        paused = true;
        releaseRead?.();
        await continueSave;
      }
      return value;
    });
    const writer = createSteelReviewWriteMethods(mongoose);
    const pending = writer.commitSteelReview(makeInput({
      operationId: 'generation-race-operation',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
      conversationId,
      messageId: oldMessageId,
    })).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({
        ok: false as const,
        code: error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined,
      }),
    );
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        reachedRead,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Generation race barrier was not reached')), 5000);
        }),
      ]);
      if (timer) {
        clearTimeout(timer);
      }
      await State.collection.updateOne(
        { conversationId },
        {
          $set: {
            currentOcrResultMarkdown: newMarkdown,
            currentOcrResultMessageId: newMessageId,
            currentOcrResultGenerationId: 'generation-2',
            currentOcrResultProvenance: {
              generationId: 'generation-2',
              attemptNumber: 1,
              messageId: newMessageId,
            },
          },
        },
      );
      releaseBarrier?.();
      await expect(pending).resolves.toEqual({ ok: false, code: 'REVIEW_CONFLICT' });
    } finally {
      releaseBarrier?.();
      execSpy.mockRestore();
    }

    const oldMessage = await models.Message.findOne({ messageId: oldMessageId }).lean();
    const state = await State.findOne({ conversationId }).lean();
    expect(oldMessage?.text).toBe(oldMarkdown);
    expect(await ReviewOutput.countDocuments({ conversationId })).toBe(0);
    expect(state).toMatchObject({
      currentOcrResultMarkdown: newMarkdown,
      currentOcrResultMessageId: newMessageId,
      currentOcrResultGenerationId: 'generation-2',
    });
    expect(state?.reviewLockToken).toBeUndefined();
  });
});
