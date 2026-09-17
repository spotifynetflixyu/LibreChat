import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

import type {
  SteelQuotationPendingMessageFile,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { QuotationModelInput } from './model';

import { createSteelQuotationStateService } from './state';
import { defaultQuotationCustomerMarkdown } from './preparation';
import {
  processQuotationPendingMessages,
  type SteelQuotationPendingInputPreparationResult,
} from './pending';
import { invokeQuotationModel } from './model';
import { buildDefaultSteelGlobalAgentContext } from '../native/context';
import { createSteelQuotationArtifactModel, createSteelQuotationStateModel } from '@librechat/data-schemas';

jest.mock('./model', () => ({
  invokeQuotationModel: jest.fn(),
}));

jest.mock('../native/context', () => ({
  buildDefaultSteelGlobalAgentContext: jest.fn(),
}));

const invokeMock = invokeQuotationModel as jest.MockedFunction<typeof invokeQuotationModel>;
const contextMock = buildDefaultSteelGlobalAgentContext as jest.MockedFunction<typeof buildDefaultSteelGlobalAgentContext>;

let mongoServer: MongoMemoryServer;
let service: ReturnType<typeof createSteelQuotationStateService>;

const scope: SteelQuotationScope = {
  userId: 'quotation-pending-user',
  conversationId: 'quotation-pending-conversation',
};
const modelOptions = {} as OpenAIOAuthModelOptions;

function processInput(
  publish: (input: { messageId: string; parentMessageId: string; markdown: string }) => Promise<void>,
  preparePendingInput?: () => Promise<SteelQuotationPendingInputPreparationResult>,
) {
  return {
    scope,
    modelOptions,
    signal: new AbortController().signal,
    ...(preparePendingInput ? { preparePendingInput } : {}),
    publish,
  };
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

  it.each(['## quote_signal', '  ## quote_signal ##', '## quote_signal｜報價'])('rejects a queued signal section %s before admission', async (heading) => {
    await service.enqueuePendingMessage({ scope, sourceMessageId: 'queued-change', sourceMessageText: '修改訂單' });
    invokeMock.mockResolvedValue({ markdown: `${heading}\n\nstart`, lookups: [], pythonEvidence: [] });
    const publish = jest.fn(async () => undefined);

    await expect(processQuotationPendingMessages(processInput(publish))).rejects.toThrow('new order confirmation');

    const state = await service.readState(scope);
    expect(state?.nextSignalIndex).toBe(0);
    expect(state?.activeRun).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  });

  it('journals the model result and recovers after publication failure without invoking the model twice', async () => {
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
      .fn<Promise<void>, [{ messageId: string; parentMessageId: string; markdown: string }]>()
      .mockRejectedValueOnce(new Error('publication unavailable'))
      .mockResolvedValue(undefined);

    const preparePendingInput = jest.fn(async () => ({
      input: 'OCR extracted order content\n請修正數量',
      currentUserTurn: '請修正數量',
    }));
    await expect(processQuotationPendingMessages(processInput(publish, preparePendingInput))).rejects.toThrow(
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
      createHash('sha256').update('queued correction', 'utf8').digest('hex'),
    );

    await State.updateOne(
      { userId: scope.userId, conversationId: scope.conversationId },
      { $set: { 'pendingMessages.0.claimExpiresAt': new Date(0) } },
    );
    await expect(processQuotationPendingMessages(processInput(publish, preparePendingInput))).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toEqual({
      messageId: 'target-1',
      parentMessageId: 'source-1',
      markdown: 'queued correction',
    });
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
    invokeMock.mockImplementation(async (input: QuotationModelInput) => ({
      markdown: input.input,
      lookups: [],
      pythonEvidence: [],
    }));
    const published: Array<{ messageId: string; parentMessageId: string; markdown: string }> = [];

    await expect(processQuotationPendingMessages(processInput(async (output) => {
      published.push(output);
    }))).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(published).toEqual([
      { messageId: 'target-1', parentMessageId: 'source-1', markdown: 'first correction' },
      { messageId: 'target-2', parentMessageId: 'source-2', markdown: 'second correction' },
    ]);
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
});
