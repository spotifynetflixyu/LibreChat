import { bindQuotationCustomerResult, hasQuotationOrder, prepareQuotationTurn, quotationPreparationStatus } from './preparation';
import type { SteelToolResult } from '../tools/results';

const mockRead = jest.fn();
const mockSave = jest.fn();
const mockClear = jest.fn();
const mockEnqueue = jest.fn();
const mockSetOrder = jest.fn();
const mockReadOcr = jest.fn();
const mockArtifact = jest.fn();
const mockHasSystemOrder = jest.fn();
jest.mock('./state', () => ({ createSteelQuotationStateService: () => ({
  ensureState: mockRead, readState: mockRead, saveCustomer: mockSave, clearCustomer: mockClear,
  enqueuePendingMessage: mockEnqueue, setOrder: mockSetOrder, getArtifact: mockArtifact,
  hasSystemOrder: mockHasSystemOrder,
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
  mockHasSystemOrder.mockResolvedValue(false);
});

it.each([
  [false, false, false], [false, false, true], [false, true, false], [false, true, true],
  [true, false, false], [true, false, true], [true, true, false], [true, true, true],
])('reports saved data readiness for OCR=%s customer=%s systemOrder=%s', (hasOcrResult, hasCustomerData, hasSystemOrder) => {
  expect(quotationPreparationStatus(hasOcrResult ? order : undefined, hasCustomerData ? 'saved customer' : undefined, hasSystemOrder)).toEqual({
    hasOcrResult, hasCustomerData, hasSystemOrder,
    shouldAskToQuote: hasOcrResult && hasCustomerData && !hasSystemOrder,
  });
});

it('injects fresh saved customer and system-order presence into each ordinary turn', async () => {
  const customerMarkdown = '## customer_data\n\n| 價格等級 |\n| --- |\n| B |';
  mockRead.mockResolvedValue({ currentOrder: { markdown: order, sha256: 'order-hash' },
    currentCustomer: { customerMarkdown }, tickets: [], pendingMessages: [] });
  mockHasSystemOrder.mockResolvedValue(true);
  const first = await prepareQuotationTurn({ scope, messageId: 'u1', responseId: 'a1', text: '你好' });
  expect(first.instruction).toContain(JSON.stringify({ hasOcrResult: true, hasCustomerData: true, hasSystemOrder: true, shouldAskToQuote: false }));
  expect(first.instruction).toContain(customerMarkdown);
  expect(first.instruction).toContain(order);
  mockHasSystemOrder.mockResolvedValue(false);
  const second = await prepareQuotationTurn({ scope, messageId: 'u2', responseId: 'a2', text: '繼續' });
  expect(second.instruction).toContain(JSON.stringify({ hasOcrResult: true, hasCustomerData: true, hasSystemOrder: false, shouldAskToQuote: true }));
  expect(mockHasSystemOrder).toHaveBeenCalledTimes(2);
});

it.each(['old-response', 'rerun-response'])(
  'keeps completed quotation state independent of response %s', async (responseId) => {
    mockRead.mockResolvedValue({ currentOrder: { markdown: order, sha256: 'order-hash' },
      currentCustomer: { customerMarkdown: 'saved customer' }, tickets: [], pendingMessages: [],
      activeRun: { runId: 'finished', status: 'completed', triggerMessageId: 'quote-user', targetMessageId: 'old-response' } });
    mockArtifact.mockResolvedValue({ operationId: 'published' });
    mockHasSystemOrder.mockResolvedValue(true);
    const prepared = await prepareQuotationTurn({
      scope, messageId: 'quote-user', responseId, text: '依目前 OCR 彙整表開始報價',
    });
    expect(prepared.resume).toBe(false);
    expect(prepared.instruction).toContain(JSON.stringify({ hasOcrResult: true, hasCustomerData: true, hasSystemOrder: true, shouldAskToQuote: false }));
    expect(prepared.instruction).not.toContain('hasSystemOrderForCurrentResponse');
    expect(mockEnqueue).not.toHaveBeenCalled();
  },
);

it('clears a prior-turn customer when a new lookup is unresolved', async () => {
  mockRead.mockResolvedValue({ currentOrder: { markdown: order, sha256: 'order-hash' },
    currentCustomer: { preparationId: 'prior-customer', responseId: 'old-response' }, pendingMessages: [] });
  await bindQuotationCustomerResult({ expectedOrderHash: 'order-hash', scope, messageId: 'u1', responseId: 'new-response', expectedCustomerPreparationId: 'prior-customer', result: success([{ id: 1 }, { id: 2 }]) });
  expect(mockClear).toHaveBeenCalledWith({ scope, responseId: 'new-response', preparationId: 'prior-customer', orderHash: 'order-hash' });
  expect(mockSave).not.toHaveBeenCalled();
});
it('requires the exact saved OCR section and actual rows', () => {
  expect(hasQuotationOrder(order)).toBe(true);
  expect(hasQuotationOrder(order.replace('ocr_result', 'system_order'))).toBe(false);
  expect(hasQuotationOrder('## source_file_mapping\n\n| 來源 | 檔名 |\n| --- | --- |\n| F1 | foo.pdf |')).toBe(false);
});
it('does not issue customer data or a signal for multiple matches', async () => {
  const result = await bindQuotationCustomerResult({ expectedOrderHash: 'order-hash', scope, messageId: 'confirm', responseId: 'response-1', result: success([{ id: 1 }, { id: 2 }]) });
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
  expect(result.ok && result.data.quotationSelectionRequired).toBe(true);
  expect(result.ok && result.data.customerDataMarkdown).toBeUndefined();
});
it('binds no-match to a disclosed saved B-tier customer and customer context before admission', async () => {
  const result = await bindQuotationCustomerResult({ expectedOrderHash: 'order-hash', scope, messageId: 'confirm', responseId: 'response-1', result: success([]) });
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ customerIdentity: 'no-match:default-B',
    triggeringMessageId: 'confirm', customerMarkdown: expect.stringContaining('使用預設 B tier') }));
  expect(result.ok && result.data.quoteSignal).toBe('## quote_signal\n\nstart');
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ responseId: 'response-1', orderHash: 'order-hash' }));
});
it('does not turn lookup errors into a default customer', async () => {
  const result = { ok: false, toolName: 'search_customers', errorCategory: 'repository_error', errorSummary: 'offline', durationMs: 1, redactionVersion: 1 } as const;
  expect(await bindQuotationCustomerResult({ expectedOrderHash: 'order-hash', scope, messageId: 'confirm', responseId: 'response-1', result })).toBe(result);
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
});
it('rejects customer lookup without saved OCR', async () => {
  mockRead.mockResolvedValue({ pendingMessages: [] });
  await expect(bindQuotationCustomerResult({ expectedOrderHash: 'order-hash', scope, messageId: 'confirm', responseId: 'response-1', result: success([]) })).rejects.toThrow('saved order');
});
it.each(['queued', 'running', 'aggregating', 'finalizing', 'interrupted'])('runs AI before resuming unfinished %s quotation', async (status) => {
  const activeRun = { runId: 'r1', status, triggerMessageId: 'old' };
  mockRead.mockResolvedValue({
    currentOrder: { markdown: order, sha256: 'order-hash' },
    currentCustomer: { customerMarkdown: 'saved customer' }, activeRun, pendingMessages: [],
  });
  const result = await prepareQuotationTurn({
    scope, messageId: 'new', responseId: 'a2', text: '數量改成 3',
    files: [{ fileId: 'file-1', filename: 'order.pdf' }],
  });
  expect(result.resume).toBe(false);
  expect(result.messageText).toBe('數量改成 3');
  expect(result.messageFiles).toEqual([{ fileId: 'file-1', filename: 'order.pdf' }]);
  expect(result.instruction).toContain(order);
  expect(result.instruction).toContain('saved customer');
  expect(result.instruction).toContain(JSON.stringify({ hasOcrResult: true, hasCustomerData: true, hasSystemOrder: false, shouldAskToQuote: true }));
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(mockReadOcr).not.toHaveBeenCalled();
  expect(mockSetOrder).not.toHaveBeenCalled();
});
it('recovers completed but unpublished quotations before a new turn', async () => {
  mockRead.mockResolvedValue({ activeRun: { runId: 'r1', status: 'completed', triggerMessageId: 'old' }, pendingMessages: [] });
  expect((await prepareQuotationTurn({ scope, messageId: 'new', responseId: 'a2', text: '改成 3' })).resume).toBe(true);
});

it('resumes the original quotation request without enqueuing it as a new message', async () => {
  const activeRun = { runId: 'r1', status: 'interrupted', triggerMessageId: 'confirm' };
  mockRead.mockResolvedValue({ activeRun, pendingMessages: [] });
  const result = await prepareQuotationTurn({
    scope, messageId: 'confirm', responseId: 'original-response', text: '確認，開始報價',
  });
  expect(result.resume).toBe(false);
  expect(result.messageText).toBe('確認，開始報價');
  expect(result.state.activeRun).toEqual(activeRun);
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(mockSetOrder).not.toHaveBeenCalled();
  expect(mockReadOcr).not.toHaveBeenCalled();
});

it('enqueues pending input for terminal recovery and returns the original message', async () => {
  mockRead.mockResolvedValue({
    currentOrder: { markdown: order, sha256: 'order-hash' }, pendingMessages: [{ status: 'pending' }],
  });
  const result = await prepareQuotationTurn({
    scope, messageId: 'new', responseId: 'a2', text: '重新報價',
    files: [{ fileId: 'file-2' }],
  });
  expect(result.resume).toBe(true);
  expect(result.messageText).toBe('重新報價');
  expect(result.messageFiles).toEqual([{ fileId: 'file-2' }]);
  expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
    sourceMessageId: 'new', sourceMessageText: '重新報價', sourceMessageFiles: [{ fileId: 'file-2' }],
    targetMessageId: 'a2', preserveExistingTarget: true,
  }));
  expect(mockReadOcr).not.toHaveBeenCalled();
});

it('does not resume a cancelled quotation when there are no pending messages', async () => {
  mockRead.mockResolvedValue({ currentOrder: { markdown: order, sha256: 'order-hash' }, tickets: [], pendingMessages: [],
    activeRun: { runId: 'cancelled-run', status: 'cancelled', triggerMessageId: 'old' } });
  const result = await prepareQuotationTurn({ scope, messageId: 'new', responseId: 'a-new', text: '你好' });
  expect(result.resume).toBe(false);
  expect(mockEnqueue).not.toHaveBeenCalled();
});
