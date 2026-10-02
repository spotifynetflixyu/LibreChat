import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { SteelResponseRequest } from './completion';
import { bindQuotationCustomerResult, prepareQuotationTurn, renderQuotationCustomerMarkdown } from './preparation';
import { buildResponse, createResponseTracker } from '../../agents/responses/handlers';
import { extractSteelNativeResponseOutputText } from '../native/markdown';
import { createSteelAgentCompletionServices } from './services';
import { createSteelQuotationStateService } from './state';
import { createSteelOcrStateService } from '../ocr/state';
import { finishSteelAgentResponse } from './completion';
import { acceptQuotationResponse } from './runner';

const scope = { userId: 'completion-user', conversationId: 'completion-conversation' };
const order = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| 文字訂單 | P1 | 鋼板 | 2 |';
let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

async function prepare() {
  const quotation = await prepareQuotationTurn({
    scope, messageId: 'user-message', responseId: 'response', text: 'B',
  });
  const req: SteelResponseRequest = {
    user: { id: scope.userId }, cookies: { lang: 'zh-TW' },
    steelNativeContext: { contextMetadata: { mode: 'standard' }, quotation },
  };
  const services = createSteelAgentCompletionServices({
    ocr: createSteelOcrStateService(mongoose), quotation: createSteelQuotationStateService(mongoose),
  });
  return { quotation, req, services };
}

async function finish(turn: Awaited<ReturnType<typeof prepare>>, markdown: string) {
  const applyMarkdown = jest.fn();
  const persistMarkdown = jest.fn(async () => ({}));
  await finishSteelAgentResponse({
    req: turn.req, responseId: 'response', markdown, completed: true,
    applyMarkdown, persistMarkdown,
  }, turn.services.dependencies);
  expect(persistMarkdown).toHaveBeenCalledTimes(1);
  expect(applyMarkdown).toHaveBeenCalledWith(expect.stringContaining('請確認資料後回覆「報價」'));
  expect(applyMarkdown.mock.calls[0]?.[0]).not.toContain('請先提供材料訂單');
}

it('reads the newly saved OCR result when the preparation snapshot has no order', async () => {
  const quotation = createSteelQuotationStateService(mongoose);
  await quotation.saveCustomer({
    scope, customerMarkdown: renderQuotationCustomerMarkdown({ tier: 'B' }),
    customerIdentity: 'explicit-default:B', triggeringMessageId: 'earlier-user', responseId: 'earlier-response',
    selectionProvenance: { method: 'default_tier', selectionMessageId: 'earlier-user' },
  });
  const turn = await prepare();
  expect(turn.quotation.state.currentOrder).toBeUndefined();
  const tracker = createResponseTracker();
  tracker.items.push({
    type: 'message', role: 'assistant', id: 'message', status: 'completed',
    content: [{ type: 'output_text', text: order, annotations: [], logprobs: [] }],
  });
  const response = buildResponse({ responseId: 'response', model: 'agent', createdAt: 0 }, tracker, 'completed');
  await turn.services.saveOrderWithoutMessage({ req: turn.req, response, responseId: 'response' });
  expect(await turn.services.dependencies.readOrder(scope)).toBe(order);
  expect(turn.quotation.state.currentOrder).toBeUndefined();
  await finish(turn, extractSteelNativeResponseOutputText(response));
});

it.each(['A', 'B', 'C', 'D', 'E', 'F'] as const)(
  'reads newly saved tier %s when the preparation snapshot has no customer', async (tier) => {
    await createSteelOcrStateService(mongoose).upsertCurrentOcrResult({
      conversationId: scope.conversationId, generationId: 'earlier-order', attemptNumber: 1, markdown: order,
    });
    const turn = await prepare();
    expect(turn.quotation.state.currentCustomer).toBeUndefined();
    const customer = renderQuotationCustomerMarkdown({ tier });
    await acceptQuotationResponse({
      scope, response: customer, responseId: 'response', messageId: 'user-message', messageText: tier,
      expectedOrderHash: turn.quotation.state.currentOrder?.sha256, finishReason: 'stop',
    });
    expect(await turn.services.dependencies.readCustomer(scope)).toBe(customer);
    expect(turn.quotation.state.currentCustomer).toBeUndefined();
    await finish(turn, customer);
  },
);

it('reads named customer data saved by the lookup before adding the next step', async () => {
  await createSteelOcrStateService(mongoose).upsertCurrentOcrResult({
    conversationId: scope.conversationId, generationId: 'earlier-order', attemptNumber: 1, markdown: order,
  });
  const turn = await prepare();
  const result = await bindQuotationCustomerResult({
    scope, messageId: 'user-message', responseId: 'response',
    expectedOrderHash: turn.quotation.state.currentOrder!.sha256,
    result: { ok: true, toolName: 'search_customers', durationMs: 1, redactionVersion: 1,
      data: { customers: [{ id: 1, erpCustomerCode: 'C1', displayName: '客戶一', customerTier: 'A' }] } },
  });
  if (!result.ok) throw new Error('test lookup did not succeed');
  const customer = result.data.customerDataMarkdown;
  if (typeof customer !== 'string') throw new Error('test lookup did not return customer data');
  await acceptQuotationResponse({ scope, response: customer, responseId: 'response', finishReason: 'stop' });
  expect(turn.quotation.state.currentCustomer).toBeUndefined();
  expect(await turn.services.dependencies.readCustomer(scope)).toBe(customer);
  await finish(turn, customer);
});
