import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { bindSteelReviewRowsToOcrContext, createSteelReviewOcrContext } from 'librechat-data-provider';
import type {
  SteelReviewMetadata,
  SteelReviewRow,
  SteelReviewSourceMapping,
} from 'librechat-data-provider';
import type {
  IMessage,
  SteelMarkdownAdmission,
  SteelMarkdownPublicationInput,
  SteelQuotationScope,
} from '~/types';
import {
  createSteelConversationOcrStateModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '~/models/steel';
import { createSteelPublicationMethods } from './steelPublication';
import {
  createSteelReviewReadMethods,
  createSteelReviewWriteMethods,
  type SteelReviewCommitInput,
} from './steelReview';
import { createModels } from '~/models';

let server: MongoMemoryReplSet;

const scope: SteelQuotationScope = {
  userId: new mongoose.Types.ObjectId().toString(),
  conversationId: 'review-ocr-conversation',
};
const sourceMapping: SteelReviewSourceMapping = {
  fileId: 'drawing-file',
  sourceCode: 'F1',
  sourceFilename: 'drawing.pdf',
  mediaType: 'application/pdf',
};
const ocrHeaders = ['零件編號', '來源', '頁碼'];
const systemHeaders = ['品名規格', '總數', '單價', '類別', '備註'];
const ocrMarkdown = [
  '## ocr_result',
  '',
  `| ${ocrHeaders.join(' | ')} |`,
  `| ${ocrHeaders.map(() => '---').join(' | ')} |`,
  '| P-1 | F1 | 1 |',
  '| P-1 | F1 | 2 |',
  '| P-2 | F1 | 3 |',
  '| P-foreign | F9 | 4 |',
].join('\n');
const systemMarkdown = [
  '## system_order',
  '',
  `| ${systemHeaders.join(' | ')} |`,
  `| ${systemHeaders.map(() => '---').join(' | ')} |`,
  '| Steel plate | 2 | 10 | 鐵板 | P-1 |',
  '| Cut | 1 | 3 | 加工/切工 | P-1 |',
  '| Steel beam | 4 | 20 | 鐵板 | P-2 |',
  '| Foreign plate | 5 | 30 | 鐵板 | P-foreign |',
].join('\n');
const rawMarkdown = `${ocrMarkdown}\n\n${systemMarkdown}`;
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

function rowsFor(
  outputId: string,
  headers: readonly string[],
  values: readonly (readonly string[])[],
  source: SteelReviewRow['source'] = null,
  system?: SteelReviewRow['system'],
): SteelReviewRow[] {
  return values.map((row, index) => ({
    rowId: sha(`${outputId}:${index}:${JSON.stringify(row)}`),
    values: Object.fromEntries(headers.map((header, column) => [header, {
      baseline: row[column] ?? '',
      effective: row[column] ?? '',
    }])),
    source,
    ...(system ? { system } : {}),
  }));
}

function publicationInput(admission: SteelMarkdownAdmission): SteelMarkdownPublicationInput {
  const ocrOutputId = 'ocr_result:human-v3';
  const systemOutputId = 'system_order:quotation-run';
  const ocrRows = rowsFor(ocrOutputId, ocrHeaders, [
    ['P-1', 'F1', '1'],
    ['P-1', 'F1', '2'],
    ['P-2', 'F1', '3'],
    ['P-foreign', 'F9', '4'],
  ], { fileId: sourceMapping.fileId, pageNumber: 1, filename: sourceMapping.sourceFilename, mediaType: sourceMapping.mediaType });
  const systemRows = rowsFor(systemOutputId, systemHeaders, [
    ['Steel plate', '2', '10', '鐵板', 'P-1'],
    ['Cut', '1', '3', '加工/切工', 'P-1'],
    ['Steel beam', '4', '20', '鐵板', 'P-2'],
    ['Foreign plate', '5', '30', '鐵板', 'P-foreign'],
  ], null, { kind: 'material', parentRowId: null, cascadeDeletedBy: null });
  systemRows[1] = {
    ...systemRows[1],
    system: { kind: 'processing', parentRowId: null, cascadeDeletedBy: null },
  };
  const selected = {
    kind: 'ocr_result' as const,
    source: 'human' as const,
    snapshotId: 'ocr-human-v3-snapshot',
    generationId: 'human-v3',
    outputId: ocrOutputId,
    messageId: admission.responseId,
    title: 'ocr_result',
    revision: 'human-v3-revision',
    sha256: sha(ocrMarkdown),
    lineageId: 'ocr-lineage',
    version: 3,
    savedAt: new Date('2026-10-06T00:00:00.000Z'),
  };
  const ocrContext = createSteelReviewOcrContext({
    title: 'ocr_result',
    outputId: ocrOutputId,
    revision: selected.revision,
    headers: ocrHeaders,
    rows: ocrRows,
  });
  const reviewMetadata: SteelReviewMetadata = {
    version: 1,
    initialized: true,
    lineage: {
      runId: 'quotation-run',
      outputId: systemOutputId,
      revision: 'quotation-run',
      ocrOutputId,
      ocrRevision: selected.revision,
      ocrHash: selected.sha256,
    },
    ocrContext,
    rows: bindSteelReviewRowsToOcrContext(systemHeaders, systemRows, ocrContext),
  };
  return {
    scope,
    admission,
    rawMarkdown,
    message: {
      messageId: admission.responseId,
      conversationId: scope.conversationId,
      user: scope.userId,
      text: rawMarkdown,
      isCreatedByUser: false,
      unfinished: false,
    },
    targets: [
      {
        kind: 'system_order',
        title: 'system_order',
        outputId: systemOutputId,
        revision: 'quotation-run',
        baselineMarkdown: systemMarkdown,
        headers: systemHeaders,
        rows: reviewMetadata.rows,
        sourceMappings: [sourceMapping],
      },
    ],
    ocr: { attemptNumber: 1 },
    systemOrder: {
      runId: 'quotation-run',
      sha256: sha(systemMarkdown),
      markdown: systemMarkdown,
      messageId: admission.responseId,
      reviewMetadata,
      sourceSnapshot: {
        orderHash: sha(systemMarkdown),
        generationId: 'human-v3',
        resultMessageId: admission.responseId,
        resultHash: sha(ocrMarkdown),
        mappings: [sourceMapping],
      },
      ocrSelection: { candidates: { human: selected }, selected, version: 3 },
      updatedAt: new Date('2026-10-06T00:00:00.000Z'),
    },
  };
}

async function clearDatabase(): Promise<void> {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  const models = createModels(mongoose);
  await Promise.all(Object.values(models).map((model) => model.init()));
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await clearDatabase();
});

describe('Steel review OCR metadata persistence', () => {
  it('initializes exact human OCR lineage, binds unique parts, and keeps it across a newer OCR result', async () => {
    const models = createModels(mongoose);
    const OcrState = createSteelConversationOcrStateModel(mongoose);
    const QuotationState = createSteelQuotationStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    await models.Conversation.create({
      conversationId: scope.conversationId,
      user: scope.userId,
      endpoint: 'openAI',
    });
    await models.File.create({
      user: new mongoose.Types.ObjectId(scope.userId),
      conversationId: scope.conversationId,
      file_id: sourceMapping.fileId,
      bytes: 1,
      filename: sourceMapping.sourceFilename,
      filepath: '/uploads/drawing.pdf',
      object: 'file',
      type: sourceMapping.mediaType,
      source: 'local',
      usage: 0,
    });
    await OcrState.create({
      conversationId: scope.conversationId,
      sourceMappings: [sourceMapping],
      currentOcrResultMarkdown: ocrMarkdown,
      currentOcrResultMessageId: 'old-ocr-message',
      currentOcrResultGenerationId: 'human-v3',
    });
    const methods = createSteelPublicationMethods(mongoose, async (_input, message, session) =>
      models.Message.findOneAndUpdate(
        { user: scope.userId, conversationId: scope.conversationId, messageId: message.messageId },
        { $set: message },
        { session, new: true, upsert: true },
      ).lean<IMessage>());
    const admission = await methods.admitSteelMarkdown({
      scope,
      responseId: 'system-message',
      generationId: 'human-v3',
    });
    if (!admission) throw new Error('Missing publication admission');

    const result = await methods.publishSteelMarkdown(publicationInput(admission));
    expect(result.ok).toBe(true);

    const saved = await QuotationState.findOne(scope).lean();
    const metadata = saved?.currentSystemOrder?.reviewMetadata;
    expect(metadata).toMatchObject({
      version: 1,
      initialized: true,
      lineage: {
        runId: 'quotation-run',
        outputId: 'system_order:quotation-run',
        revision: 'quotation-run',
        ocrOutputId: 'ocr_result:human-v3',
        ocrRevision: 'human-v3-revision',
        ocrHash: sha(ocrMarkdown),
      },
      ocrContext: {
        outputId: 'ocr_result:human-v3',
        revision: 'human-v3-revision',
      },
    });
    expect(metadata?.ocrContext?.rows).toHaveLength(4);
    const persistedRows = metadata?.rows ?? [];
    const materialP1 = persistedRows.find((row) => row.values['備註']?.effective === 'P-1');
    const processingP1 = persistedRows.find((row) => row.values['類別']?.effective === '加工/切工');
    const materialP2 = persistedRows.find((row) => row.values['備註']?.effective === 'P-2');
    const foreign = persistedRows.find((row) => row.values['備註']?.effective === 'P-foreign');
    expect(materialP1).toMatchObject({ source: null, ocrLink: null });
    expect(processingP1).toMatchObject({ source: null, ocrLink: null, system: { parentRowId: materialP1?.rowId } });
    expect(materialP2).toMatchObject({
      source: expect.objectContaining({ fileId: sourceMapping.fileId, pageNumber: 1 }),
      ocrLink: { outputId: 'ocr_result:human-v3', revision: 'human-v3-revision' },
    });
    expect(foreign).toMatchObject({
      source: expect.objectContaining({ fileId: sourceMapping.fileId }),
      ocrLink: { outputId: 'ocr_result:human-v3', revision: 'human-v3-revision' },
    });

    if (!metadata?.ocrContext) throw new Error('Missing persisted OCR context');
    const foreignSource = {
      fileId: 'foreign-file',
      pageNumber: 4,
      filename: 'foreign.pdf',
      mediaType: 'application/pdf',
    };
    const legacyMetadata: SteelReviewMetadata = {
      ...metadata,
      ocrContext: {
        ...metadata.ocrContext,
        rows: metadata.ocrContext.rows.map((row) => row.values['零件編號']?.effective === 'P-foreign'
          ? { ...row, source: foreignSource, rowId: 'foreign-ocr-row' }
          : row),
      },
      rows: metadata.rows.map((row) => {
        if (row.values['備註']?.effective === 'P-2') {
          return {
            ...row,
            values: { ...row.values, 單價: { ...row.values['單價'], effective: '99' } },
            source: {
              fileId: sourceMapping.fileId,
              pageNumber: 8,
              filename: sourceMapping.sourceFilename,
              mediaType: sourceMapping.mediaType,
            },
          };
        }
        if (row.values['備註']?.effective === 'P-foreign') {
          return {
            ...row,
            values: { ...row.values, 單價: { ...row.values['單價'], effective: '99' } },
            source: foreignSource,
            ocrLink: { outputId: 'ocr_result:human-v3', revision: 'human-v3-revision', rowId: 'foreign-ocr-row' },
          };
        }
        return row;
      }),
    };
    await QuotationState.updateOne({ ...scope, 'currentSystemOrder.runId': 'quotation-run' }, {
      $set: { 'currentSystemOrder.reviewMetadata': legacyMetadata },
    });
    await ReviewOutput.updateOne({ ...scope, kind: 'system_order', outputId: 'system_order:quotation-run' }, {
      $set: { reviewMetadata: legacyMetadata },
    });
    expect((await QuotationState.findOne(scope).lean())?.currentSystemOrder?.reviewMetadata?.rows)
      .toEqual(legacyMetadata.rows);

    const read = createSteelReviewReadMethods(mongoose);
    const first = await read.readSteelReview({
      ...scope,
      kind: 'system_order',
      messageId: 'system-message',
      title: 'system_order',
    });
    expect(first?.reviewMetadata?.lineage.ocrRevision).toBe('human-v3-revision');
    expect(first?.reviewMetadata?.rows.find((row) => row.values['備註']?.effective === 'P-2')).toMatchObject({
      values: { 單價: { effective: '99' } },
      source: expect.objectContaining({ fileId: sourceMapping.fileId, pageNumber: 8 }),
      ocrLink: { outputId: 'ocr_result:human-v3', revision: 'human-v3-revision' },
    });
    expect(first?.reviewMetadata?.ocrContext?.rows).toHaveLength(3);
    expect(first?.reviewMetadata?.rows.find((row) => row.values['備註']?.effective === 'P-foreign')).toMatchObject({
      values: { 單價: { effective: '99' } },
      source: null,
      ocrLink: null,
    });

    await OcrState.updateOne({ conversationId: scope.conversationId }, {
      $set: {
        currentOcrResultMarkdown: ocrMarkdown.replace('P-2', 'P-NEW'),
        currentOcrResultMessageId: 'new-ocr-message',
        currentOcrResultGenerationId: 'human-v4',
      },
    });
    const second = await read.readSteelReview({
      ...scope,
      kind: 'system_order',
      messageId: 'system-message',
      title: 'system_order',
    });
    expect(second?.reviewMetadata).toEqual(first?.reviewMetadata);
    expect((await QuotationState.findOne(scope).lean())?.currentSystemOrder?.reviewMetadata).toEqual(legacyMetadata);
    expect(await ReviewOutput.findOne({ ...scope, kind: 'system_order' }).lean()).toBeTruthy();
  });

  it('backfills legacy system output metadata from the immutable human OCR receipt and keeps the manual overlay', async () => {
    const models = createModels(mongoose);
    const OcrState = createSteelConversationOcrStateModel(mongoose);
    const QuotationState = createSteelQuotationStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const ocrOutputId = 'ocr_result:human-v3';
    const systemOutputId = 'system_order:legacy-run';
    const systemMessageId = 'legacy-system-message';
    const ocrMessageId = 'legacy-ocr-message';
    const ocrRevision = 'human-v3-revision';
    const systemRevision = 'legacy-system-revision';
    const savedAt = new Date('2026-10-06T00:00:00.000Z');
    const legacyOcrMarkdown = [
      '## ocr_result',
      '',
      `| ${ocrHeaders.join(' | ')} |`,
      `| ${ocrHeaders.map(() => '---').join(' | ')} |`,
      '| P-1 | F1 | 2 |',
      '| P-2 | F1 | 3 |',
    ].join('\n');
    const legacySystemMarkdown = [
      '## system_order',
      '',
      `| ${systemHeaders.join(' | ')} |`,
      `| ${systemHeaders.map(() => '---').join(' | ')} |`,
      '| Steel plate | 2 | 99 | 鐵板 | P-1 |',
      '| Cut | 1 | 3 | 加工/切工 | P-1 |',
      '| Steel beam | 4 | 20 | 鐵板 | P-2 |',
    ].join('\n');
    const systemBaselineMarkdown = legacySystemMarkdown.replace('| Steel plate | 2 | 99 |', '| Steel plate | 2 | 10 |');
    const ocrRows = rowsFor(ocrOutputId, ocrHeaders, [
      ['P-1', 'F1', '2'],
      ['P-2', 'F1', '3'],
    ], { fileId: sourceMapping.fileId, pageNumber: 2, filename: sourceMapping.sourceFilename, mediaType: sourceMapping.mediaType });
    const systemRows = rowsFor(systemOutputId, systemHeaders, [
      ['Steel plate', '2', '10', '鐵板', 'P-1'],
      ['Cut', '1', '3', '加工/切工', 'P-1'],
      ['Steel beam', '4', '20', '鐵板', 'P-2'],
    ], null, { kind: 'material', parentRowId: null, cascadeDeletedBy: null });
    systemRows[0] = {
      ...systemRows[0],
      values: { ...systemRows[0].values, 單價: { baseline: '10', effective: '99' } },
    };
    systemRows[1] = {
      ...systemRows[1],
      system: { kind: 'processing', parentRowId: null, cascadeDeletedBy: null },
    };
    systemRows[2] = {
      ...systemRows[2],
      source: {
        fileId: sourceMapping.fileId,
        pageNumber: 8,
        filename: sourceMapping.sourceFilename,
        mediaType: sourceMapping.mediaType,
      },
      ocrLink: null,
    };
    const selected = {
      kind: 'ocr_result' as const,
      source: 'human' as const,
      snapshotId: 'ocr-human-v3-snapshot',
      generationId: 'human-v3',
      outputId: ocrOutputId,
      messageId: ocrMessageId,
      title: 'ocr_result',
      revision: ocrRevision,
      sha256: sha(legacyOcrMarkdown),
      lineageId: 'ocr-lineage',
      version: 3,
      savedAt,
    };
    const ocrReceiptSnapshot = {
      operationId: 'ocr-human-v3-save',
      digest: sha('ocr-human-v3-receipt'),
      title: 'ocr_result',
      outputId: ocrOutputId,
      revision: ocrRevision,
      headers: ocrHeaders,
      rows: ocrRows,
      sourceMappings: [sourceMapping],
      changedRows: 0,
      changedRowIds: [],
      savedAt,
      messageSha256: sha(legacyOcrMarkdown),
      conversationId: scope.conversationId,
      messageId: ocrMessageId,
      messageText: legacyOcrMarkdown,
      effectiveMarkdown: legacyOcrMarkdown,
      displayMarkdown: legacyOcrMarkdown,
    };
    const systemReceiptSnapshot = {
      operationId: 'legacy-system-save',
      digest: sha('legacy-system-receipt'),
      title: 'system_order',
      outputId: systemOutputId,
      revision: systemRevision,
      headers: systemHeaders,
      rows: systemRows,
      sourceMappings: [],
      changedRows: 1,
      changedRowIds: [systemRows[0].rowId],
      savedAt,
      messageSha256: sha(legacySystemMarkdown),
      conversationId: scope.conversationId,
      messageId: systemMessageId,
      messageText: legacySystemMarkdown,
      effectiveMarkdown: legacySystemMarkdown,
      displayMarkdown: legacySystemMarkdown,
    };
    await models.Conversation.create({ conversationId: scope.conversationId, user: scope.userId, endpoint: 'openAI' });
    await models.Message.create({
      messageId: systemMessageId,
      conversationId: scope.conversationId,
      user: scope.userId,
      isCreatedByUser: false,
      text: legacySystemMarkdown,
      content: [{ type: 'text', text: legacySystemMarkdown }],
    });
    await models.File.create({
      user: new mongoose.Types.ObjectId(scope.userId),
      conversationId: scope.conversationId,
      file_id: sourceMapping.fileId,
      bytes: 1,
      filename: sourceMapping.sourceFilename,
      filepath: '/uploads/drawing.pdf',
      object: 'file',
      type: sourceMapping.mediaType,
      source: 'local',
      usage: 0,
    });
    await OcrState.create({
      conversationId: scope.conversationId,
      sourceMappings: [],
      currentOcrResultMarkdown: legacyOcrMarkdown.replace('P-1', 'P-NEW'),
      currentOcrResultMessageId: 'live-ocr-v4',
      currentOcrResultGenerationId: 'human-v4',
    });
    await ReviewOutput.create({
      userId: scope.userId,
      conversationId: scope.conversationId,
      kind: 'ocr_result',
      title: 'ocr_result',
      messageId: ocrMessageId,
      tableId: 'ocr-result-legacy-table',
      outputId: ocrOutputId,
      revision: ocrRevision,
      state: 'current',
      headers: ocrHeaders,
      rows: ocrRows,
      sourceMappings: [sourceMapping],
      aiRawMarkdown: legacyOcrMarkdown,
      aiBaselineMarkdown: legacyOcrMarkdown,
      effectiveMarkdown: legacyOcrMarkdown,
      displayMarkdown: legacyOcrMarkdown,
      receipts: [{
        operationId: ocrReceiptSnapshot.operationId,
        digest: ocrReceiptSnapshot.digest,
        title: ocrReceiptSnapshot.title,
        revision: ocrRevision,
        changedRows: 0,
        changedRowIds: [],
        savedAt,
        snapshot: ocrReceiptSnapshot,
      }],
    });
    await ReviewOutput.create({
      userId: scope.userId,
      conversationId: scope.conversationId,
      kind: 'system_order',
      title: 'system_order',
      messageId: systemMessageId,
      tableId: 'system-result-legacy-table',
      outputId: systemOutputId,
      revision: systemRevision,
      state: 'current',
      latestOutputId: systemOutputId,
      headers: systemHeaders,
      rows: systemRows,
      sourceMappings: [],
      aiRawMarkdown: systemBaselineMarkdown,
      aiBaselineMarkdown: systemBaselineMarkdown,
      humanMarkdown: legacySystemMarkdown,
      effectiveMarkdown: legacySystemMarkdown,
      displayMarkdown: legacySystemMarkdown,
      humanSavedAt: savedAt,
      receipts: [{
        operationId: systemReceiptSnapshot.operationId,
        digest: systemReceiptSnapshot.digest,
        title: systemReceiptSnapshot.title,
        revision: systemRevision,
        changedRows: 1,
        changedRowIds: [systemRows[0].rowId],
        savedAt,
        snapshot: systemReceiptSnapshot,
      }],
    });
    await QuotationState.create({
      ...scope,
      currentSystemOrder: {
        runId: 'legacy-run',
        reviewOutputId: systemOutputId,
        sha256: sha(systemBaselineMarkdown),
        markdown: systemBaselineMarkdown,
        messageId: systemMessageId,
        sourceSnapshot: {
          orderHash: sha(systemBaselineMarkdown),
          generationId: 'human-v3',
          resultMessageId: ocrMessageId,
          resultHash: sha(legacyOcrMarkdown),
          mappings: [],
        },
        ocrSelection: { candidates: { human: selected }, selected, version: 3 },
        updatedAt: savedAt,
      },
    });

    await ReviewOutput.updateOne({ ...scope, outputId: ocrOutputId }, {
      $set: {
        revision: 'human-v4-revision',
        rows: ocrRows.map((row) => ({
          ...row,
          values: { ...row.values, 零件編號: { baseline: 'P-NEW', effective: 'P-NEW' } },
        })),
        effectiveMarkdown: legacyOcrMarkdown.replace('P-1', 'P-NEW'),
      },
    });
    const read = createSteelReviewReadMethods(mongoose);
    const first = await read.readSteelReview({
      ...scope,
      kind: 'system_order',
      messageId: systemMessageId,
      title: 'system_order',
    });
    expect(first?.reviewMetadata).toMatchObject({
      version: 1,
      initialized: true,
      lineage: {
        runId: 'legacy-run',
        outputId: systemOutputId,
        revision: systemRevision,
        ocrOutputId,
        ocrRevision,
        ocrHash: sha(legacyOcrMarkdown),
      },
    });
    expect(first?.reviewMetadata?.ocrContext?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        values: expect.objectContaining({ 零件編號: { baseline: 'P-1', effective: 'P-1' } }),
        source: expect.objectContaining({ fileId: sourceMapping.fileId, pageNumber: 2 }),
      }),
    ]));
    const firstMaterial = first?.reviewMetadata?.rows.find((row) => row.values['備註']?.effective === 'P-1');
    const firstProcessing = first?.reviewMetadata?.rows.find((row) => row.values['類別']?.effective === '加工/切工');
    expect(firstMaterial).toMatchObject({
      values: { 單價: { baseline: '10', effective: '99' } },
      source: expect.objectContaining({ fileId: sourceMapping.fileId, pageNumber: 2 }),
      ocrLink: { outputId: ocrOutputId, revision: ocrRevision },
    });
    expect(firstProcessing).toMatchObject({
      source: expect.objectContaining({ fileId: sourceMapping.fileId, pageNumber: 2 }),
      ocrLink: { outputId: ocrOutputId, revision: ocrRevision },
      system: { parentRowId: firstMaterial?.rowId },
    });
    expect(first?.reviewMetadata?.rows.find((row) => row.values['備註']?.effective === 'P-2')).toMatchObject({
      source: expect.objectContaining({ fileId: sourceMapping.fileId, pageNumber: 8 }),
      ocrLink: null,
    });

    const persisted = await QuotationState.findOne(scope).lean();
    expect(persisted?.currentSystemOrder?.reviewMetadata).toEqual(first?.reviewMetadata);
    expect((await ReviewOutput.findOne({ ...scope, kind: 'system_order', outputId: systemOutputId }).lean())?.reviewMetadata)
      .toEqual(first?.reviewMetadata);

    await OcrState.updateOne({ conversationId: scope.conversationId }, {
      $set: {
        currentOcrResultMarkdown: legacyOcrMarkdown.replace('P-1', 'P-LATEST'),
        currentOcrResultMessageId: 'live-ocr-v5',
        currentOcrResultGenerationId: 'human-v5',
      },
    });
    const second = await read.readSteelReview({
      ...scope,
      kind: 'system_order',
      messageId: systemMessageId,
      title: 'system_order',
    });
    expect(second?.reviewMetadata).toEqual(first?.reviewMetadata);
    expect(second?.reviewMetadata?.rows.find((row) => row.values['備註']?.effective === 'P-1')).toMatchObject({
      values: { 單價: { effective: '99' } },
      ocrLink: { outputId: ocrOutputId, revision: ocrRevision },
    });
  });

  it('persists reconciled source links and the new revision in both metadata owners after reopen', async () => {
    const models = createModels(mongoose);
    const QuotationState = createSteelQuotationStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const systemOutputId = 'system_order:reconcile-run';
    const messageId = 'reconcile-system-message';
    const currentMarkdown = [
      '## system_order',
      '',
      `| ${systemHeaders.join(' | ')} |`,
      `| ${systemHeaders.map(() => '---').join(' | ')} |`,
      '| Steel plate | 2 | 10 | 鐵板 | P-1 |',
      '| Cut | 1 | 3 | 加工/切工 | P-1 |',
    ].join('\n');
    const savedMarkdown = currentMarkdown.replace('| Steel plate | 2 | 10 |', '| Steel plate | 2 | 11 |');
    const currentRevision = sha(currentMarkdown);
    const oldSource = {
      fileId: 'old-reconcile-file',
      pageNumber: 1,
      filename: 'old-drawing.pdf',
      mediaType: 'application/pdf',
    };
    const newSource = {
      fileId: 'new-reconcile-file',
      pageNumber: 8,
      filename: 'new-drawing.pdf',
      mediaType: 'application/pdf',
    };
    const newMapping: SteelReviewSourceMapping = {
      fileId: newSource.fileId,
      sourceCode: 'F1',
      sourceFilename: newSource.filename,
      mediaType: newSource.mediaType,
    };
    const ocrOutputId = 'ocr_result:human-v4';
    const ocrRevision = 'human-v4-revision';
    const ocrRows = rowsFor(ocrOutputId, ocrHeaders, [['P-1', 'F1', '8']], newSource);
    const ocrContext = createSteelReviewOcrContext({
      title: 'ocr_result',
      outputId: ocrOutputId,
      revision: ocrRevision,
      headers: ocrHeaders,
      rows: ocrRows,
    });
    const staleRows = rowsFor(systemOutputId, systemHeaders, [
      ['Steel plate', '2', '10', '鐵板', 'P-1'],
      ['Cut', '1', '3', '加工/切工', 'P-1'],
    ], oldSource, { kind: 'material', parentRowId: null, cascadeDeletedBy: null });
    staleRows[1] = {
      ...staleRows[1],
      system: { kind: 'processing', parentRowId: staleRows[0].rowId, cascadeDeletedBy: null },
    };
    const staleLink = { outputId: ocrOutputId, revision: ocrRevision, rowId: ocrRows[0].rowId };
    const rowsWithStaleLinks = staleRows.map((row) => ({ ...row, ocrLink: staleLink }));
    const reviewMetadata: SteelReviewMetadata = {
      version: 1,
      initialized: true,
      lineage: {
        runId: 'reconcile-run',
        outputId: systemOutputId,
        revision: currentRevision,
        messageId,
        ocrOutputId,
        ocrRevision,
        ocrHash: sha('human-v4-context'),
      },
      ocrContext,
      rows: rowsWithStaleLinks,
    };
    const reconciledBaseRows = rowsFor(systemOutputId, systemHeaders, [
      ['Steel plate', '2', '11', '鐵板', 'P-1'],
      ['Cut', '1', '3', '加工/切工', 'P-1'],
    ], newSource, { kind: 'material', parentRowId: null, cascadeDeletedBy: null });
    reconciledBaseRows[1] = {
      ...reconciledBaseRows[1],
      system: { kind: 'processing', parentRowId: reconciledBaseRows[0].rowId, cascadeDeletedBy: null },
    };
    const reconciledRows = bindSteelReviewRowsToOcrContext(systemHeaders, reconciledBaseRows, ocrContext);
    reconciledRows[0] = { ...reconciledRows[0], rowId: staleRows[0].rowId };
    reconciledRows[0] = {
      ...reconciledRows[0],
      values: { ...reconciledRows[0].values, 單價: { baseline: '10', effective: '11' } },
    };
    reconciledRows[1] = {
      ...reconciledRows[1],
      rowId: staleRows[1].rowId,
      system: { kind: 'processing', parentRowId: staleRows[0].rowId, cascadeDeletedBy: null },
    };
    const targetText = currentMarkdown.slice(currentMarkdown.indexOf('| 品名規格 |'));
    const replacementText = savedMarkdown.slice(savedMarkdown.indexOf('| 品名規格 |'));
    const operation: SteelReviewCommitInput = {
      ...scope,
      kind: 'system_order',
      messageId,
      title: 'system_order',
      tableId: 'system-order-reconcile-table',
      outputId: systemOutputId,
      revision: currentRevision,
      operationId: 'system-reconcile-save',
      digest: sha('system-reconcile-save'),
      rows: reconciledRows,
      headers: systemHeaders,
      messageSha256: sha(currentMarkdown),
      target: {
        start: currentMarkdown.indexOf('| 品名規格 |'),
        end: currentMarkdown.length,
        sha256: sha(targetText),
      },
      targetText,
      replacementText,
      cleanReplacementText: replacementText,
      effectiveMarkdown: savedMarkdown,
      displayMarkdown: savedMarkdown,
      aiBaselineMarkdown: currentMarkdown,
      aiRawMarkdown: currentMarkdown,
      systemOrderMarkdown: savedMarkdown,
      systemOrderSha256: currentRevision,
      caption: {
        kind: 'system_order',
        changedRows: 2,
        changedRowIds: [reconciledRows[0].rowId, reconciledRows[1].rowId],
      },
      sourceIntents: [{ rowId: reconciledRows[0].rowId, fileId: newSource.fileId, pageNumber: newSource.pageNumber }],
      sourceMappings: [newMapping],
    };
    await models.Conversation.create({ conversationId: scope.conversationId, user: scope.userId, endpoint: 'openAI' });
    await models.Message.create({
      messageId,
      conversationId: scope.conversationId,
      user: scope.userId,
      isCreatedByUser: false,
      text: currentMarkdown,
    });
    await models.File.create([
      {
        user: new mongoose.Types.ObjectId(scope.userId),
        conversationId: scope.conversationId,
        file_id: oldSource.fileId,
        bytes: 1,
        filename: oldSource.filename,
        filepath: '/uploads/old-drawing.pdf',
        object: 'file',
        type: oldSource.mediaType,
        source: 'local',
        usage: 0,
      },
      {
        user: new mongoose.Types.ObjectId(scope.userId),
        conversationId: scope.conversationId,
        file_id: newSource.fileId,
        bytes: 1,
        filename: newSource.filename,
        filepath: '/uploads/new-drawing.pdf',
        object: 'file',
        type: newSource.mediaType,
        source: 'local',
        usage: 0,
      },
    ]);
    await ReviewOutput.create({
      ...scope,
      kind: 'system_order',
      title: 'system_order',
      messageId,
      tableId: operation.tableId,
      outputId: systemOutputId,
      revision: currentRevision,
      state: 'current',
      latestOutputId: systemOutputId,
      headers: systemHeaders,
      rows: rowsWithStaleLinks,
      sourceMappings: [{
        fileId: oldSource.fileId,
        sourceCode: 'F1',
        sourceFilename: oldSource.filename,
        mediaType: oldSource.mediaType,
      }],
      aiRawMarkdown: currentMarkdown,
      aiBaselineMarkdown: currentMarkdown,
      humanMarkdown: currentMarkdown,
      effectiveMarkdown: currentMarkdown,
      displayMarkdown: currentMarkdown,
      reviewMetadata,
      receipts: [],
    });
    await QuotationState.create({
      ...scope,
      currentSystemOrder: {
        runId: 'reconcile-run',
        reviewOutputId: systemOutputId,
        sha256: currentRevision,
        markdown: currentMarkdown,
        messageId,
        reviewMetadata,
        updatedAt: new Date('2026-10-06T00:00:00.000Z'),
      },
    });

    const result = await createSteelReviewWriteMethods(mongoose).commitSteelReview(operation);
    const expectedRevision = sha(`${currentRevision}:${operation.digest}`);
    expect(result).toMatchObject({ revision: expectedRevision, changedRows: 2 });
    const persistedOutput = await ReviewOutput.findOne({ ...scope, kind: 'system_order', outputId: systemOutputId }).lean();
    const persistedQuotation = await QuotationState.findOne(scope).lean();
    const outputMetadata = persistedOutput?.reviewMetadata;
    const quotationMetadata = persistedQuotation?.currentSystemOrder?.reviewMetadata;
    expect(outputMetadata).toEqual(quotationMetadata);
    expect(outputMetadata).toMatchObject({
      lineage: { outputId: systemOutputId, revision: expectedRevision, messageId },
      ocrContext: { outputId: ocrOutputId, revision: ocrRevision },
    });
    const persistedMaterial = outputMetadata?.rows.find((row) => row.rowId === reconciledRows[0].rowId);
    const persistedProcessing = outputMetadata?.rows.find((row) => row.rowId === reconciledRows[1].rowId);
    expect(persistedMaterial).toMatchObject({ source: newSource, ocrLink: staleLink, values: { 單價: { baseline: '10', effective: '11' } } });
    expect(persistedProcessing).toMatchObject({ source: newSource, ocrLink: staleLink, system: { parentRowId: reconciledRows[0].rowId } });
    expect(persistedOutput?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowId: reconciledRows[0].rowId, source: newSource, ocrLink: staleLink }),
      expect.objectContaining({ rowId: reconciledRows[1].rowId, source: newSource, ocrLink: staleLink }),
    ]));

    const reopened = await createSteelReviewReadMethods(mongoose).readSteelReview({
      ...scope,
      kind: 'system_order',
      messageId,
      title: 'system_order',
    });
    expect(reopened?.reviewMetadata).toEqual(outputMetadata);
    expect(reopened?.reviewMetadata?.lineage.revision).toBe(expectedRevision);
    expect(reopened?.reviewMetadata?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowId: reconciledRows[0].rowId, source: newSource, ocrLink: staleLink }),
      expect.objectContaining({ rowId: reconciledRows[1].rowId, source: newSource, ocrLink: staleLink }),
    ]));
  });

  it('keeps an initialized no-match lineage empty when later OCR data appears', async () => {
    const models = createModels(mongoose);
    const QuotationState = createSteelQuotationStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const messageText = '## system_order\n\n| 品名規格 | 備註 |\n| --- | --- |\n| Plate | UNKNOWN |';
    const metadata: SteelReviewMetadata = {
      version: 1,
      initialized: true,
      lineage: {
        runId: 'unknown-run',
        outputId: 'system_order:unknown-run',
        revision: 'unknown-revision',
        messageId: 'unknown-message',
      },
      ocrContext: null,
      rows: rowsFor('system_order:unknown-run', ['品名規格', '備註'], [['Plate', 'UNKNOWN']], null, {
        kind: 'material',
        parentRowId: null,
        cascadeDeletedBy: null,
      }),
    };
    await models.Conversation.create({ conversationId: scope.conversationId, user: scope.userId, endpoint: 'openAI' });
    await models.Message.create({
      messageId: 'unknown-message',
      conversationId: scope.conversationId,
      user: scope.userId,
      isCreatedByUser: false,
      text: messageText,
      content: [{ type: 'text', text: messageText }],
    });
    await QuotationState.create({
      ...scope,
      currentSystemOrder: {
        runId: 'unknown-run',
        sha256: 'unknown-revision',
        markdown: messageText,
        messageId: 'unknown-message',
        reviewMetadata: metadata,
        updatedAt: new Date('2026-10-06T00:00:00.000Z'),
      },
    });
    const first = await read.readSteelReview({
      ...scope,
      kind: 'system_order',
      messageId: 'unknown-message',
      title: 'system_order',
    });
    expect(first?.reviewMetadata?.ocrContext).toBeNull();
    expect(first?.reviewMetadata?.rows[0]).toMatchObject({ source: null, ocrLink: undefined });

    await createSteelConversationOcrStateModel(mongoose).create({
      conversationId: scope.conversationId,
      sourceMappings: [sourceMapping],
      currentOcrResultMarkdown: ocrMarkdown.replace('P-1', 'UNKNOWN'),
      currentOcrResultMessageId: 'new-ocr-message',
      currentOcrResultGenerationId: 'human-v4',
    });
    const second = await read.readSteelReview({
      ...scope,
      kind: 'system_order',
      messageId: 'unknown-message',
      title: 'system_order',
    });
    expect(second?.reviewMetadata).toEqual(first?.reviewMetadata);
  });
});
