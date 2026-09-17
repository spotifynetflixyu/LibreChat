import { bindQuotationCustomerResult, hasQuotationOrder, prepareQuotationTurn } from './preparation';
import type { SteelToolResult } from '../tools/results';

const mockRead = jest.fn();
const mockSave = jest.fn();
const mockClear = jest.fn();
const mockEnqueue = jest.fn();
const mockSetOrder = jest.fn();
const mockReadOcr = jest.fn();
const mockArtifact = jest.fn();
jest.mock('./state', () => ({ createSteelQuotationStateService: () => ({
  ensureState: mockRead, readState: mockRead, saveCustomer: mockSave, clearCustomer: mockClear,
  enqueuePendingMessage: mockEnqueue, setOrder: mockSetOrder, getArtifact: mockArtifact,
}) }));
jest.mock('../ocr/state', () => ({ createSteelOcrStateService: () => ({ readConversationOcrState: mockReadOcr }) }));
const scope = { userId: 'owner', conversationId: 'conversation' };
const order = '## ocr_result\n\n| 來源 | 零件編號 | 數量 | 類別 |\n| --- | --- | --- | --- |\n| 文字訂單 | 1 | 2 | 鐵板 |';
const success = (customers: unknown[]): SteelToolResult => ({ ok: true, toolName: 'search_customers',
  data: { customers } as never, durationMs: 1, redactionVersion: 1 });
beforeEach(() => {
  jest.clearAllMocks();
  mockRead.mockResolvedValue({ currentOrder: { markdown: order, sha256: 'order-hash' }, tickets: [], pendingMessages: [] });
  mockSave.mockResolvedValue({ preparationId: 'saved-customer' });
  mockReadOcr.mockResolvedValue(null);
  mockArtifact.mockResolvedValue(null);
});
it('requires the exact saved OCR section and actual rows', () => {
  expect(hasQuotationOrder(order)).toBe(true);
  expect(hasQuotationOrder(order.replace('ocr_result', 'system_order'))).toBe(false);
  expect(hasQuotationOrder('## source_file_mapping\n\n| 來源 | 檔名 |\n| --- | --- |\n| F1 | foo.pdf |')).toBe(false);
});
it('does not issue customer data or a signal for multiple matches', async () => {
  const result = await bindQuotationCustomerResult({ scope, messageId: 'confirm', responseId: 'response-1', result: success([{ id: 1 }, { id: 2 }]) });
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockClear).toHaveBeenCalledWith({ scope, responseId: 'response-1' });
  expect(result.ok && result.data.quotationSelectionRequired).toBe(true);
  expect(result.ok && result.data.customerDataMarkdown).toBeUndefined();
});
it('binds no-match to a disclosed saved B-tier customer and customer context before admission', async () => {
  const result = await bindQuotationCustomerResult({ scope, messageId: 'confirm', responseId: 'response-1', result: success([]) });
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ customerIdentity: 'no-match:default-B',
    triggeringMessageId: 'confirm', customerMarkdown: expect.stringContaining('使用預設 B tier') }));
  expect(result.ok && result.data.quoteSignal).toBe('## quote_signal\n\nstart');
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ responseId: 'response-1', orderHash: 'order-hash' }));
});
it('does not turn lookup errors into a default customer', async () => {
  const result = { ok: false, toolName: 'search_customers', errorCategory: 'repository_error', errorSummary: 'offline', durationMs: 1, redactionVersion: 1 } as const;
  expect(await bindQuotationCustomerResult({ scope, messageId: 'confirm', responseId: 'response-1', result })).toBe(result);
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockClear).toHaveBeenCalledWith({ scope, responseId: 'response-1' });
});
it('rejects customer lookup without saved OCR', async () => {
  mockRead.mockResolvedValue({ pendingMessages: [] });
  await expect(bindQuotationCustomerResult({ scope, messageId: 'confirm', responseId: 'response-1', result: success([]) })).rejects.toThrow('saved order');
});
it('queues a correction and resumes before reading or updating the order', async () => {
  mockRead.mockResolvedValue({ activeRun: { runId: 'r1', status: 'interrupted', triggerMessageId: 'old' }, pendingMessages: [] });
  const result = await prepareQuotationTurn({ scope, messageId: 'new', responseId: 'a2', text: '數量改成 3' });
  expect(result.resume).toBe(true);
  expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ sourceMessageId: 'new', sourceMessageText: '數量改成 3' }));
  expect(mockReadOcr).not.toHaveBeenCalled();
});
it('recovers completed but unpublished quotations before a new turn', async () => {
  mockRead.mockResolvedValue({ activeRun: { runId: 'r1', status: 'completed', triggerMessageId: 'old' }, pendingMessages: [] });
  expect((await prepareQuotationTurn({ scope, messageId: 'new', responseId: 'a2', text: '改成 3' })).resume).toBe(true);
});

it('does not resume a cancelled quotation when there are no pending messages', async () => {
  mockRead.mockResolvedValue({ currentOrder: { markdown: order, sha256: 'order-hash' }, tickets: [], pendingMessages: [],
    activeRun: { runId: 'cancelled-run', status: 'cancelled', triggerMessageId: 'old' } });
  const result = await prepareQuotationTurn({ scope, messageId: 'new', responseId: 'a-new', text: '你好' });
  expect(result.resume).toBe(false);
  expect(mockEnqueue).not.toHaveBeenCalled();
});
