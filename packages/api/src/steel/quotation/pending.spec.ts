import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSteelOcrResponseAuditModel, createSteelQuotationArtifactModel, createSteelQuotationStateModel } from '@librechat/data-schemas';
import type {
  SteelQuotationPendingMessageFile,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { QuotationModelInput } from './model';
import {
  processQuotationPendingMessages,
  type SteelQuotationPendingInputPreparationResult,
} from './pending';
import { buildDefaultSteelGlobalAgentContext } from '../native/context';
import { defaultQuotationCustomerMarkdown } from './preparation';
import { createSystemOrderRevisionService } from './revision';
import { createSteelQuotationStateService } from './state';
import { createSteelOcrStateService } from '../ocr/state';
import { invokeQuotationModel } from './model';

jest.mock('./model', () => ({
  invokeQuotationModel: jest.fn(),
}));

jest.mock('../native/context', () => ({
  buildDefaultSteelGlobalAgentContext: jest.fn(),
}));

const invokeMock = invokeQuotationModel as jest.MockedFunction<typeof invokeQuotationModel>;
const contextMock = buildDefaultSteelGlobalAgentContext as jest.MockedFunction<typeof buildDefaultSteelGlobalAgentContext>;
type PendingProcessInput = Parameters<typeof processQuotationPendingMessages>[0];
type PendingPublishInput = Parameters<PendingProcessInput['publish']>[0];
type PendingPersistInput = Parameters<PendingProcessInput['persist']>[0];

let mongoServer: MongoMemoryServer;
let service: ReturnType<typeof createSteelQuotationStateService>;

const scope: SteelQuotationScope = {
  userId: 'quotation-pending-user',
  conversationId: 'quotation-pending-conversation',
};
const modelOptions = {} as OpenAIOAuthModelOptions;

function processInput(
  publish: (input: PendingPublishInput) => Promise<void>,
  preparePendingInput?: () => Promise<SteelQuotationPendingInputPreparationResult>,
  persisted?: PendingPersistInput[],
) {
  return {
    scope,
    modelOptions,
    signal: new AbortController().signal,
    ...(preparePendingInput ? { preparePendingInput } : {}),
    persist: async (input: PendingPersistInput) => {
      persisted?.push(input);
      await mongoose.connection.collection('pending_messages').updateOne(
        { messageId: input.messageId },
        { $set: { markdown: input.markdown, completed: input.completed } },
        { upsert: true },
      );
      return { messageId: input.messageId };
    },
    publish,
  };
}

async function prepareCompletedSystemOrder() {
  const order = [
    '## system_order｜報價單',
    '',
    '| 品名規格 | 數量 | 總數 | 單價 |',
    '| --- | --- | --- | --- |',
    '| A | 2 | 2 | 10 |',
  ].join('\n');
  await service.setOrder({ scope, fullMarkdown: order, revision: 'base', messageId: 'base-message' });
  const ticket = await service.issueTicket({
    scope,
    customerMarkdown: defaultQuotationCustomerMarkdown,
    customerIdentity: 'explicit-default:B',
    triggeringMessageId: 'quote-message',
    selectionProvenance: { method: 'default_tier', selectionMessageId: 'quote-message' },
  });
  const run = await service.acceptSignal({
    scope,
    index: ticket.index,
    token: ticket.token,
    orderHash: ticket.orderHash,
    customerMarkdown: ticket.customerMarkdown,
    customerIdentity: ticket.customerIdentity,
    prompts: { child: 'child', main: 'main' },
    chunks: [{ index: 1, sourceRowCount: 1 }],
    targetMessageId: 'quote-response',
  });
  const lease = await service.acquireLease({ scope, runId: run.runId, leaseToken: 'lease-1' });
  if (!lease) throw new Error('test setup did not acquire a lease');
  const final = `${order}\n\n## customer_quote\n\n| existing |\n| --- |\n| quote |`;
  await service.checkpoint({
    scope,
    runId: run.runId,
    leaseToken: lease.leaseToken,
    operationId: 'final',
    kind: 'final',
    payload: final,
  });
  const checkpointed = await service.readState(scope);
  const checkpoint = checkpointed?.activeRun?.checkpointRefs.find((ref) => ref.operationId === 'final');
  if (!checkpoint) throw new Error('test setup did not save a final checkpoint');
  const completed = await service.completeRun({
    scope,
    runId: run.runId,
    leaseToken: lease.leaseToken,
    finalRef: { ...scope, runId: run.runId, ...checkpoint, kind: 'final' },
  });
  if (!completed) throw new Error('test setup did not complete the run');
  const revision = createSystemOrderRevisionService({
    read: service.readState,
    readCurrentSystemOrder: service.readCurrentSystemOrder,
    readCheckpoint: service.readCheckpoint,
    saveCurrentSystemOrder: service.saveCurrentSystemOrder,
  });
  const snapshot = await revision.readCurrentSystemOrder(scope);
  if (!snapshot) throw new Error('test setup did not produce a current system-order snapshot');
  return { order, snapshot };
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  service = createSteelQuotationStateService(mongoose);
});

beforeEach(() => {
  jest.clearAllMocks();
  contextMock.mockResolvedValue({
    instructionPrefix: 'mocked quotation rules',
  } as Awaited<ReturnType<typeof buildDefaultSteelGlobalAgentContext>>);
  invokeMock.mockResolvedValue({
    markdown: 'queued correction',
    lookups: [],
    pythonEvidence: [],
  });
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('quotation pending processor', () => {
  it('saves a queued default-B selection before an order exists without starting a quotation', async () => {
    await service.enqueuePendingMessage({ scope, sourceMessageId: 'choose-b', sourceMessageText: '使用預設 B tier' });
    invokeMock.mockResolvedValue({ markdown: defaultQuotationCustomerMarkdown, lookups: [], pythonEvidence: [] });
    const publish = jest.fn(async () => undefined);

    await processQuotationPendingMessages(processInput(publish));

    const state = await service.readState(scope);
    expect(state?.currentCustomer?.customerMarkdown).toBe(defaultQuotationCustomerMarkdown);
    expect(state?.currentOrder).toBeUndefined();
    expect(state?.activeRun).toBeUndefined();
    expect(state?.pendingMessages[0]?.status).toBe('completed');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it.each(['## quote_signal', '  ## quote_signal ##', '## quote_signal｜報價'])('retains saved-data admission gates for a queued signal %s', async (heading) => {
    await service.enqueuePendingMessage({ scope, sourceMessageId: 'queued-change', sourceMessageText: '修改訂單' });
    invokeMock.mockResolvedValue({ markdown: `${heading}\n\nstart`, lookups: [], pythonEvidence: [] });
    const publish = jest.fn(async () => undefined);

    await expect(processQuotationPendingMessages(processInput(publish))).rejects.toMatchObject({
      code: heading.includes('｜') ? 'invalid_quote_signal' : 'quotation_data_required',
    });

    const state = await service.readState(scope);
    expect(state?.nextSignalIndex).toBe(0);
    expect(state?.activeRun).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
    const audit = await createSteelOcrResponseAuditModel(mongoose).findOne({ conversationId: scope.conversationId }).lean();
    expect(audit?.rawResponse).toBe(`${heading}\n\nstart`);
  });

  it('saves canonical pending output before publication and retries without invoking the model twice', async () => {
    const files: SteelQuotationPendingMessageFile[] = [{
      fileId: 'file-1',
      filename: 'order.pdf',
      storageKey: 'steel/order.pdf',
      mediaType: 'application/pdf',
    }];
    await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'source-1',
      sourceMessageText: '請修正數量',
      sourceMessageFiles: files,
      targetMessageId: 'target-1',
    });
    const publish = jest
      .fn<Promise<void>, [PendingPublishInput]>()
      .mockRejectedValueOnce(new Error('publication unavailable'))
      .mockResolvedValue(undefined);
    const persisted: PendingPersistInput[] = [];
    const canonical = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 | 類別 | 數量 |',
      '| --- | --- | --- | --- |',
      '| OCR | A | 鋼板 | 2 |',
    ].join('\n');
    invokeMock.mockResolvedValue({ markdown: canonical, lookups: [], pythonEvidence: [] });

    const preparePendingInput = jest.fn(async () => ({
      input: 'OCR extracted order content\n請修正數量',
      currentUserTurn: '請修正數量',
    }));
    await expect(processQuotationPendingMessages(processInput(publish, preparePendingInput, persisted))).rejects.toThrow(
      'publication unavailable',
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const modelInput = invokeMock.mock.calls[0]?.[0];
    expect(preparePendingInput).toHaveBeenCalledTimes(1);
    expect(modelInput?.input).toContain('OCR extracted order content');

    const State = createSteelQuotationStateModel(mongoose);
    const afterFailure = await State.findOne({
      userId: scope.userId,
      conversationId: scope.conversationId,
    }).lean();
    const pendingAfterFailure = afterFailure?.pendingMessages[0];
    expect(pendingAfterFailure?.status).toBe('claimed');
    expect(pendingAfterFailure?.resultRef?.sha256).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );

    await State.updateOne(
      { userId: scope.userId, conversationId: scope.conversationId },
      { $set: { 'pendingMessages.0.claimExpiresAt': new Date(0) } },
    );
    await expect(processQuotationPendingMessages(processInput(publish, preparePendingInput, persisted))).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      messageId: 'target-1',
      parentMessageId: 'source-1',
      markdown: expect.stringContaining('## ocr_result'),
      publication: expect.objectContaining({
        responseId: 'target-1',
        generationId: 'target-1',
      }),
    }));
    expect(persisted.map(({ completed }) => completed)).toEqual([false, true, false, true]);
    const completed = await service.readState(scope);
    expect(completed?.pendingMessages[0]).toEqual(expect.objectContaining({
      status: 'completed',
      completedTargetMessageId: 'target-1',
    }));
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    expect(await Artifact.countDocuments({
      userId: scope.userId,
      conversationId: scope.conversationId,
    })).toBe(2);
  });

  it('does not save an invalid model result and invokes the model again for a valid retry', async () => {
    await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'invalid-output',
      sourceMessageText: '請讀取訂單',
      targetMessageId: 'invalid-output-target',
    });
    const invalid = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 | 類別 | 數量 |',
      '| --- | --- | --- |',
      '| OCR | A | 鋼板 | 2 |',
    ].join('\n');
    const valid = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 | 類別 | 數量 |',
      '| --- | --- | --- | --- |',
      '| OCR | A | 鋼板 | 2 |',
    ].join('\n');
    invokeMock.mockResolvedValueOnce({ markdown: invalid, lookups: [], pythonEvidence: [] })
      .mockResolvedValueOnce({ markdown: valid, lookups: [], pythonEvidence: [] });
    const persisted: PendingPersistInput[] = [];
    const publish = jest.fn(async () => undefined);

    await expect(processQuotationPendingMessages(processInput(publish, undefined, persisted))).rejects.toMatchObject({
      code: 'invalid_ocr_result_table',
    });
    const failed = await service.readState(scope);
    expect(failed?.pendingMessages[0]?.status).toBe('claimed');
    expect(failed?.pendingMessages[0]?.resultRef).toBeUndefined();
    expect(persisted).toHaveLength(0);

    await createSteelQuotationStateModel(mongoose).updateOne(
      { userId: scope.userId, conversationId: scope.conversationId },
      { $set: { 'pendingMessages.0.claimExpiresAt': new Date(0) } },
    );
    await processQuotationPendingMessages(processInput(publish, undefined, persisted));

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(persisted.map(({ completed }) => completed)).toEqual([false, true]);
    const retried = await service.readState(scope);
    expect(retried?.pendingMessages[0]?.status).toBe('completed');
    expect(retried?.currentOrder?.markdown).toBe(valid);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('publishes canonical state without OCR update sections and keeps one raw audit', async () => {
    const ocrService = createSteelOcrStateService(mongoose);
    const base = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| F1 | A-6M74 | 鋼板 | 3 |\n| F1 | P2 | 鋼板 | 5 |';
    const delta = '已修正\n\n## ocr_result_updates\n\n| 數量 | 來源 | 零件編號 | 類別 |\n| --- | --- | --- | --- |\n| 1 | F1 | A-6M74 | 鋼板 |';
    const raw = `${delta}\n\n${defaultQuotationCustomerMarkdown}`;
    const canonical = base.replace('| A-6M74 | 鋼板 | 3 |', '| A-6M74 | 鋼板 | 1 |');
    await ocrService.upsertCurrentOcrResult({ conversationId: scope.conversationId, generationId: 'base', attemptNumber: 1, markdown: base, messageId: 'base-message' });
    await service.setOrder({ scope, fullMarkdown: base, revision: 'base', messageId: 'base-message' });
    await service.enqueuePendingMessage({ scope, sourceMessageId: 'correct-qty', targetMessageId: 'corrected', sourceMessageText: '修改數量為 1，使用 B tier' });
    invokeMock.mockResolvedValue({ markdown: raw, lookups: [], pythonEvidence: [] });
    const publish = jest.fn<Promise<void>, [{ messageId: string; parentMessageId: string; markdown: string }]>()
      .mockImplementationOnce(async () => {
        expect((await ocrService.readConversationOcrState(scope.conversationId))?.currentOcrResultMarkdown).toBe(canonical);
        throw new Error('publication unavailable');
      }).mockResolvedValue(undefined);
    await expect(processQuotationPendingMessages(processInput(publish))).rejects.toThrow('publication unavailable');
    await createSteelQuotationStateModel(mongoose).updateOne(
      { userId: scope.userId, conversationId: scope.conversationId },
      { $set: { 'pendingMessages.0.claimExpiresAt': new Date(0) } },
    );
    await processQuotationPendingMessages(processInput(publish));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const publishedMarkdown = publish.mock.calls.map(([value]) => value.markdown);
    expect(publishedMarkdown).toHaveLength(2);
    for (const value of publishedMarkdown) {
      expect(value).toContain('## ocr_result');
      expect(value).toContain('| F1 | A-6M74 | 鋼板 | 1 |');
      expect(value).not.toContain('## ocr_result_updates');
      expect(value).not.toContain('## ocr_deletions');
    }
    const current = await service.readState(scope);
    expect(current?.currentOrder?.markdown).toBe(canonical);
    expect(current?.currentCustomer?.customerMarkdown).toBe(defaultQuotationCustomerMarkdown);
    expect((await ocrService.readConversationOcrState(scope.conversationId))?.currentOcrResultMarkdown).toBe(canonical);
    const audits = await createSteelOcrResponseAuditModel(mongoose).find({ conversationId: scope.conversationId }).lean();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ rawResponse: raw, baseRevision: 'base', messageId: 'corrected', sourceStage: 'pending' });
  });

  it('gives the model the live completed system-order revision and publishes the merged correction', async () => {
    const { snapshot } = await prepareCompletedSystemOrder();
    const updates = [
      '## system_order_updates',
      '',
      '| base_hash | row_index | 品名規格 | 數量 | 總數 | 單價 |',
      '| --- | --- | --- | --- | --- | --- |',
      `| ${snapshot.sha256} | 1 | A | 3 | 3 | 10 |`,
    ].join('\n');
    await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'system-order-correction',
      targetMessageId: 'system-order-corrected',
      sourceMessageText: 'A 數量改為 3',
    });
    invokeMock.mockResolvedValue({ markdown: updates, lookups: [], pythonEvidence: [] });
    const publish = jest.fn<Promise<void>, [{ messageId: string; parentMessageId: string; markdown: string }]>()
      .mockResolvedValue(undefined);

    await processQuotationPendingMessages(processInput(publish));

    const modelPrompt = invokeMock.mock.calls[0]?.[0]?.prompt ?? '';
    expect(modelPrompt).toContain(snapshot.markdown);
    expect(modelPrompt).toContain('## system_order_revision');
    expect(modelPrompt).toContain(`| ${snapshot.sha256} | 1 |`);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'system-order-corrected',
      parentMessageId: 'system-order-correction',
      markdown: expect.stringContaining('| A | 3 | 3 | 10 |'),
    }));
    const publishedMarkdown = publish.mock.calls[0]?.[0].markdown ?? '';
    expect(publishedMarkdown).toContain('## system_order｜報價單');
    expect(publishedMarkdown).toContain('## customer_quote');
    expect(publishedMarkdown).not.toContain('## system_order_updates');
    const state = await service.readState(scope);
    expect(state?.currentSystemOrder?.responseId).toBe('system-order-corrected');
    expect(state?.currentSystemOrder?.markdown).toContain('| A | 3 | 3 | 10 |');
  });

  it('claims pending corrections in FIFO order and carries each stable target message', async () => {
    await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'source-1',
      sourceMessageText: 'first correction',
      targetMessageId: 'target-1',
    });
    await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'source-2',
      sourceMessageText: 'second correction',
      targetMessageId: 'target-2',
    });
    const first = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| F1 | A | 鋼板 | 1 |';
    const second = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| F1 | B | 鋼板 | 2 |';
    invokeMock.mockImplementation(async (input: QuotationModelInput) => ({
      markdown: input.input.includes('first correction') ? first : second,
      lookups: [],
      pythonEvidence: [],
    }));
    const published: PendingPublishInput[] = [];

    await expect(processQuotationPendingMessages(processInput(async (output) => {
      published.push(output);
    }))).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(published).toHaveLength(2);
    expect(published.map(({ messageId, parentMessageId }) => ({ messageId, parentMessageId }))).toEqual([
      { messageId: 'target-1', parentMessageId: 'source-1' },
      { messageId: 'target-2', parentMessageId: 'source-2' },
    ]);
    expect(published.every(({ publication }) => publication)).toBe(true);
    expect(published[0]?.markdown).toContain('| F1 | A | 鋼板 | 1 |');
    expect(published[1]?.markdown).toContain('| F1 | B | 鋼板 | 2 |');
    const state = await service.readState(scope);
    expect(state?.pendingMessages.map((message) => message.status)).toEqual(['completed', 'completed']);
  });

  it('refuses to complete an attached correction when OCR preparation is unavailable', async () => {
    await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'source-file-without-preparer',
      sourceMessageText: '請讀取附件',
      sourceMessageFiles: [{ filename: 'order.pdf', mediaType: 'application/pdf' }],
    });

    await expect(processQuotationPendingMessages(processInput(async () => undefined))).rejects.toThrow(
      'require OCR preprocessing',
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect((await service.readState(scope))?.pendingMessages[0]?.status).toBe('claimed');
  });

  it('renews a live claim while a pending model operation is in progress', async () => {
    const enqueued = await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'source-heartbeat',
      sourceMessageText: 'heartbeat correction',
    });
    const claimed = await service.claimPendingMessage({
      scope,
      now: new Date(10_000),
      leaseDurationMs: 1_000,
    });
    expect(claimed?.sourceMessageId).toBe(enqueued.sourceMessageId);
    if (!claimed) {
      throw new Error('pending claim missing');
    }
    const renewed = await service.renewPendingClaim({
      scope,
      sourceMessageId: claimed.sourceMessageId,
      claimToken: claimed.claimToken,
      now: new Date(10_500),
      leaseDurationMs: 1_000,
    });
    expect(renewed?.claimExpiresAt).toEqual(new Date(11_500));
    expect(await service.claimPendingMessage({ scope, now: new Date(11_400) })).toBeUndefined();
    expect(await service.claimPendingMessage({ scope, now: new Date(11_501) })).toEqual(expect.objectContaining({
      sourceMessageId: claimed.sourceMessageId,
    }));
  });

  it('audits a correction, publishes the canonical full order, and stores canonical markdown', async () => {
    const ocrService = createSteelOcrStateService(mongoose);
    const previous = '## ocr_result\n\n| 來源 | 零件編號 | 數量 |\n| --- | --- | --- |\n| F1 | P1 | 2 |';
    await ocrService.upsertCurrentOcrResult({
      conversationId: scope.conversationId,
      generationId: 'previous-generation',
      attemptNumber: 1,
      markdown: previous,
      messageId: 'previous-message',
    });
    await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'delta-source',
      sourceMessageText: '修改數量為 4',
      targetMessageId: 'delta-target',
    });
    const updates = '說明文字\n\n## ocr_result_updates\n\n| 數量 | 零件編號 | 來源 |\n| --- | --- | --- |\n| 4 | P1 | F1 |';
    invokeMock.mockResolvedValue({ markdown: updates, lookups: [], pythonEvidence: [] });
    const published: Array<{ messageId: string; parentMessageId: string; markdown: string }> = [];

    await processQuotationPendingMessages(processInput(async (output) => {
      published.push(output);
    }));

    expect(published).toHaveLength(1);
    expect(published[0]?.markdown).toContain('## ocr_result');
    expect(published[0]?.markdown).not.toContain('## ocr_result_updates');
    expect(published[0]?.markdown).not.toContain('## ocr_deletions');
    const current = await ocrService.readCurrentOcrResult(scope.conversationId);
    expect(current?.markdown).toContain('| F1 | P1 | 4 |');
    expect(current?.markdown).not.toContain('ocr_result_updates');
    expect((await service.readState(scope))?.currentOrder?.markdown).toBe(current?.markdown);
  });
});
