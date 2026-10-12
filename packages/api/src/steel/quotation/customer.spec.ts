import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createSteelQuotationStateModel, createSteelQuotationArtifactModel } from '@librechat/data-schemas';
import type { SteelQuotationScope } from '@librechat/data-schemas';
import type { SteelToolResult } from '../tools/results';
import { bindQuotationCustomerResult, commitQuotationCustomerResponse, prepareQuotationCustomerResponse, renderQuotationCustomerMarkdown } from './preparation';
import { acceptQuotationResponse, acceptQuotationSignal } from './runner';
import { createSteelQuotationStateService } from './state';

jest.mock('../native/context', () => ({
  buildDefaultSteelGlobalAgentContext: jest.fn(async ({ mode }: { mode: string }) => ({ instructionPrefix: mode })),
}));

const scope: SteelQuotationScope = {
  userId: 'customer-commit-user',
  conversationId: 'customer-commit-conversation',
};
const order = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| 文字訂單 | P1 | 鋼板 | 2 |';
const customer = renderQuotationCustomerMarkdown({ tier: 'C', customerCode: 'C7', customerName: 'Customer 7' });
let mongoServer: MongoMemoryReplSet;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await Promise.all([
    createSteelQuotationStateModel(mongoose).createIndexes(),
    createSteelQuotationArtifactModel(mongoose).createIndexes(),
  ]);
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

function success(customers: readonly Record<string, string | number>[]): SteelToolResult {
  return {
    ok: true,
    toolName: 'search_customers',
    data: { customers: [...customers] },
    durationMs: 1,
    redactionVersion: 1,
  };
}

async function prepareOrder() {
  const service = createSteelQuotationStateService(mongoose);
  const state = await service.setOrder({ scope, fullMarkdown: order });
  return { service, orderHash: state.currentOrder!.sha256 };
}

it('keeps a unique lookup as evidence until the presented customer data is committed', async () => {
  const { service, orderHash } = await prepareOrder();
  const result = await bindQuotationCustomerResult({
    scope,
    messageId: 'user-1',
    responseId: 'response-1',
    expectedOrderHash: orderHash,
    result: success([{ id: 7, erpCustomerCode: 'C7', displayName: 'Customer 7', customerTier: 'C' }]),
  });
  expect(result.ok && result.data.customerDataMarkdown).toBe(customer);
  expect((await service.readState(scope))?.currentCustomer).toBeUndefined();
  expect((await service.readState(scope))?.customerLookupEvidence?.customers).toEqual([
    { id: 7, erpCustomerCode: 'C7', displayName: 'Customer 7', customerTier: 'C' },
  ]);
  await commitQuotationCustomerResponse({
    scope,
    response: customer,
    responseId: 'response-1',
    messageId: 'user-1',
    expectedOrderHash: orderHash,
  });
  expect((await service.readState(scope))?.currentCustomer?.customerIdentity).toBe('7');
  expect((await service.readState(scope))?.customerLookupEvidence).toBeUndefined();
});

it('preserves a trusted customer identity when a current user selects another tier', async () => {
  const { service, orderHash } = await prepareOrder();
  await bindQuotationCustomerResult({
    scope,
    messageId: 'user-1',
    responseId: 'response-1',
    expectedOrderHash: orderHash,
    result: success([{ id: 7, erpCustomerCode: 'C7', displayName: 'Customer 7', customerTier: 'C' }]),
  });
  await commitQuotationCustomerResponse({ scope, response: customer, responseId: 'response-1', messageId: 'user-1', expectedOrderHash: orderHash });
  const before = await service.readState(scope);
  const next = renderQuotationCustomerMarkdown({ tier: 'F', customerCode: 'C7', customerName: 'Customer 7' });
  await commitQuotationCustomerResponse({
    scope,
    response: next,
    responseId: 'response-2',
    messageId: 'user-2',
    messageText: '使用F級',
    expectedOrderHash: orderHash,
    expectedCustomerPreparationId: before?.currentCustomer?.preparationId,
  });
  const saved = await service.readState(scope);
  expect(saved?.currentCustomer?.customerIdentity).toBe('7');
  expect(saved?.currentCustomer?.customerMarkdown).toBe(next);
});

it('prevalidates forged customer data without writing canonical state', async () => {
  const { service, orderHash } = await prepareOrder();
  await bindQuotationCustomerResult({
    scope,
    messageId: 'user-1',
    responseId: 'response-1',
    expectedOrderHash: orderHash,
    result: success([{ id: 7, erpCustomerCode: 'C7', displayName: 'Customer 7', customerTier: 'C' }]),
  });
  const before = await service.readState(scope);
  const forged = renderQuotationCustomerMarkdown({ tier: 'C', customerCode: 'FORGED', customerName: 'Customer 7' });
  await expect(prepareQuotationCustomerResponse({
    scope,
    response: forged,
    responseId: 'response-1',
    messageId: 'user-1',
    expectedOrderHash: orderHash,
    service,
  })).rejects.toThrow('trusted customer lookup');
  const after = await service.readState(scope);
  expect(after?.currentCustomer).toBeUndefined();
  expect(after?.customerLookupEvidence).toEqual(before?.customerLookupEvidence);
});

it('accepts a same-turn signal after the presented customer data is committed', async () => {
  const { service, orderHash } = await prepareOrder();
  const response = `${renderQuotationCustomerMarkdown({ tier: 'B' })}\n\n## quote_signal\n\nstart`;
  await commitQuotationCustomerResponse({
    scope,
    response,
    responseId: 'response-1',
    messageId: 'user-1',
    messageText: '使用預設 B tier，報價',
    expectedOrderHash: orderHash,
  });
  const state = await service.readState(scope);
  const run = await acceptQuotationSignal({
    scope,
    response: '## quote_signal\n\nstart',
    responseId: 'response-1',
    messageId: 'user-1',
    expectedOrderHash: state?.currentOrder?.sha256,
    expectedCustomerPreparationId: state?.currentCustomer?.preparationId,
    finishReason: 'stop',
    service,
  });
  expect(run?.index).toBe(1);
});

it('facade commits same-turn customer data before accepting its signal and replays idempotently', async () => {
  const { service, orderHash } = await prepareOrder();
  const response = `${renderQuotationCustomerMarkdown({ tier: 'B' })}\n\n## quote_signal\n\nstart`;
  const request = {
    scope,
    response,
    responseId: 'facade-response',
    messageId: 'facade-user',
    messageText: '使用預設 B tier，報價',
    expectedOrderHash: orderHash,
    finishReason: 'stop',
    service,
  };
  const first = await acceptQuotationResponse(request);
  expect(first?.index).toBe(1);
  const state = await service.readState(scope);
  expect(state?.currentCustomer?.preparationId).toBeDefined();
  const replay = await acceptQuotationResponse(request);
  expect(replay?.runId).toBe(first?.runId);
});

it('rejects forged, stale, multiple-match, and failed lookup customer data', async () => {
  const { service, orderHash } = await prepareOrder();
  await bindQuotationCustomerResult({
    scope,
    messageId: 'user-1',
    responseId: 'response-1',
    expectedOrderHash: orderHash,
    result: success([{ id: 7, erpCustomerCode: 'C7', displayName: 'Customer 7', customerTier: 'C' }]),
  });
  const forged = renderQuotationCustomerMarkdown({ tier: 'C', customerCode: 'FORGED', customerName: 'Customer 7' });
  await expect(commitQuotationCustomerResponse({ scope, response: forged, responseId: 'response-1', messageId: 'user-1', expectedOrderHash: orderHash })).rejects.toThrow('trusted customer lookup');
  await service.setOrder({ scope, fullMarkdown: `${order}\n\nchanged`, expectedOrderHash: orderHash });
  await expect(commitQuotationCustomerResponse({ scope, response: customer, responseId: 'response-1', messageId: 'user-1', expectedOrderHash: orderHash })).rejects.toThrow('stale preparation');

  const fresh = await service.readState(scope);
  const freshHash = fresh?.currentOrder?.sha256;
  await bindQuotationCustomerResult({ scope, messageId: 'user-2', responseId: 'response-2', expectedOrderHash: freshHash!, result: success([{ id: 1 }, { id: 2 }]) });
  await expect(commitQuotationCustomerResponse({ scope, response: customer, responseId: 'response-2', messageId: 'user-2', expectedOrderHash: freshHash })).rejects.toThrow('trusted customer lookup');
  await bindQuotationCustomerResult({ scope, messageId: 'user-3', responseId: 'response-3', expectedOrderHash: freshHash!, result: {
    ok: false,
    toolName: 'search_customers',
    errorCategory: 'repository_error',
    errorSummary: 'offline',
    durationMs: 1,
    redactionVersion: 1,
  } });
  await expect(commitQuotationCustomerResponse({ scope, response: customer, responseId: 'response-3', messageId: 'user-3', expectedOrderHash: freshHash })).rejects.toThrow('trusted customer lookup');
});
