import type { SteelToolResult } from '../tools/results';
import { bindQuotationCustomerResult, hasQuotationOrder, parseQuotationTierSelection, prepareQuotationTurn, quotationPreparationStatus, renderQuotationCustomerMarkdown } from './preparation';

const mockRead = jest.fn();
const mockSave = jest.fn();
const mockSaveEvidence = jest.fn();
const mockClear = jest.fn();
const mockClearEvidence = jest.fn();
const mockEnqueue = jest.fn();
const mockSetOrder = jest.fn();
const mockReadOcr = jest.fn();
const mockArtifact = jest.fn();
const mockHasSystemOrder = jest.fn();
const mockReadCurrentSystemOrder = jest.fn();
const mockReadCheckpoint = jest.fn();
const mockSaveCurrentSystemOrder = jest.fn();
jest.mock('./state', () => ({ createSteelQuotationStateService: () => ({
  ensureState: mockRead, readState: mockRead, saveCustomer: mockSave, clearCustomer: mockClear,
  saveCustomerLookupEvidence: mockSaveEvidence, clearCustomerLookupEvidence: mockClearEvidence,
  enqueuePendingMessage: mockEnqueue, setOrder: mockSetOrder, getArtifact: mockArtifact,
  hasSystemOrder: mockHasSystemOrder, readCurrentSystemOrder: mockReadCurrentSystemOrder,
  readCheckpoint: mockReadCheckpoint, saveCurrentSystemOrder: mockSaveCurrentSystemOrder,
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
  mockSaveEvidence.mockImplementation(async ({ evidence }: { evidence: unknown }) => evidence);
  mockClearEvidence.mockResolvedValue({ currentOrder: { markdown: order, sha256: 'order-hash' }, tickets: [], pendingMessages: [] });
  mockReadOcr.mockResolvedValue(null);
  mockArtifact.mockResolvedValue(null);
  mockHasSystemOrder.mockResolvedValue(false);
  mockReadCurrentSystemOrder.mockResolvedValue(undefined);
  mockReadCheckpoint.mockResolvedValue(undefined);
  mockSaveCurrentSystemOrder.mockResolvedValue(undefined);
});

it.each([
  ['使用預設 B 級進行報價', 'B'],
  ['用A級', 'A'],
  ['tier c', 'C'],
  ['use Tier D', 'D'],
  ['set tier F', 'F'],
  ['使用c級', 'C'],
  ['a', 'A'],
  ['B tier', 'B'],
  ['Use default Tier B for the quote', 'B'],
  ['A-6M74 數量改為 1，使用 B tier', 'B'],
] as const)('accepts one explicit current-user tier command: %s', (text, tier) => {
  expect(parseQuotationTierSelection(text)).toEqual({ status: 'selected', tier });
});

it.each(['用A和B級', 'tier C, tier D', 'use Tier D and F'])('rejects ambiguous direct tier commands: %s', (text) => {
  expect(parseQuotationTierSelection(text)).toEqual({ status: 'invalid', reason: 'ambiguous' });
});

it('does not treat an unrelated customer letter as a tier choice', () => {
  expect(parseQuotationTierSelection('查詢客戶 A 公司')).toEqual({ status: 'none' });
  expect(parseQuotationTierSelection('使用A公司')).toEqual({ status: 'none' });
  expect(renderQuotationCustomerMarkdown({ tier: 'E' })).toContain('|  | 未指定客戶 | E | 用戶指定預設 E tier |');
});

it.each(['使用 A 材料', '選擇 B 型鋼', 'use A steel', 'set C coating'])(
  'does not treat material instructions as customer tiers: %s', (text) => {
    expect(parseQuotationTierSelection(text)).toEqual({ status: 'none' });
  },
);

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
    currentCustomer: { customerIdentity: 'accepted-customer', customerMarkdown },
    tickets: [{ acceptedRunId: 'accepted-run', orderHash: 'order-hash', customerIdentity: 'accepted-customer', customerMarkdown }],
    activeRun: { runId: 'accepted-run', status: 'completed' }, pendingMessages: [] });
  mockArtifact.mockResolvedValue({ operationId: 'published' });
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

it('keeps system-order corrections full-only and does not inject revision mappings', async () => {
  const completedSystemOrder = [
    '## system_order｜報價單',
    '',
    '| 品名規格 | 數量 | 總數 | 單價 |',
    '| --- | --- | --- | --- |',
    '| A | 2 | 2 | 10 |',
  ].join('\n');
  mockRead.mockResolvedValue({
    currentOrder: { markdown: order, sha256: 'order-hash' },
    currentCustomer: { customerIdentity: 'saved-customer', customerMarkdown: 'saved customer' },
    tickets: [{ acceptedRunId: 'completed-run', orderHash: 'order-hash', customerIdentity: 'saved-customer', customerMarkdown: 'saved customer' }],
    pendingMessages: [],
    activeRun: { runId: 'completed-run', status: 'completed', targetMessageId: 'completed-response' },
  });
  mockArtifact.mockResolvedValue({ operationId: 'published' });
  mockHasSystemOrder.mockResolvedValue(true);

  const prepared = await prepareQuotationTurn({ scope, messageId: 'u3', responseId: 'a3', text: '修改數量' });

  expect(prepared.instruction).not.toContain(completedSystemOrder);
  expect(prepared.instruction).not.toContain('## system_order_revision');
  expect(prepared.instruction).not.toContain('## system_order_updates');
  expect(mockReadCheckpoint).not.toHaveBeenCalled();
});

it('clears completed quote readiness after OCR changes the current order', async () => {
  const updatedOrder = order.replace('| 1 | 2 | 鐵板 |', '| 1 | 3 | 鐵板 |');
  const completedSystemOrder = [
    '## system_order｜報價單',
    '',
    '| 品名規格 | 數量 | 總數 | 單價 |',
    '| --- | --- | --- | --- |',
    '| A | 2 | 2 | 10 |',
  ].join('\n');
  const updatedState = {
    currentOrder: { markdown: updatedOrder, sha256: 'new-order-hash' },
    currentCustomer: { customerIdentity: 'saved-customer', customerMarkdown: 'saved customer' },
    tickets: [{ acceptedRunId: 'completed-run', orderHash: 'order-hash', customerIdentity: 'saved-customer', customerMarkdown: 'saved customer' }],
    activeRun: { runId: 'completed-run', status: 'completed', targetMessageId: 'completed-response' },
    pendingMessages: [],
  };
  mockRead.mockResolvedValue({
    currentOrder: { markdown: order, sha256: 'order-hash' },
    currentCustomer: { customerIdentity: 'saved-customer', customerMarkdown: 'saved customer' },
    tickets: [{ acceptedRunId: 'completed-run', orderHash: 'order-hash', customerIdentity: 'saved-customer', customerMarkdown: 'saved customer' }],
    activeRun: { runId: 'completed-run', status: 'completed', targetMessageId: 'completed-response' },
    pendingMessages: [],
  });
  mockArtifact.mockResolvedValue({ operationId: 'published' });
  mockHasSystemOrder.mockResolvedValue(true);
  mockReadOcr.mockResolvedValue({
    currentOcrResultMarkdown: updatedOrder,
    currentOcrResultGenerationId: 'ocr-generation-2',
    currentOcrResultMessageId: 'ocr-message-2',
  });
  mockSetOrder.mockResolvedValue(updatedState);
  mockReadCheckpoint.mockResolvedValue(completedSystemOrder);

  const prepared = await prepareQuotationTurn({ scope, messageId: 'u5', responseId: 'a5', text: '修改數量' });

  expect(mockSetOrder).toHaveBeenCalledWith(expect.objectContaining({
    fullMarkdown: updatedOrder,
    revision: 'ocr-generation-2',
    messageId: 'ocr-message-2',
  }));
  expect(prepared.instruction).toContain(JSON.stringify({
    hasOcrResult: true, hasCustomerData: true, hasSystemOrder: false, shouldAskToQuote: true,
  }));
  expect(prepared.instruction).toContain(updatedOrder);
  expect(prepared.instruction).not.toContain(completedSystemOrder);
  expect(mockReadCheckpoint).not.toHaveBeenCalled();
});

it('clears completed quote readiness when the saved customer no longer matches the accepted run', async () => {
  const completedSystemOrder = [
    '## system_order｜報價單',
    '',
    '| 品名規格 | 數量 | 總數 | 單價 |',
    '| --- | --- | --- | --- |',
    '| A | 2 | 2 | 10 |',
  ].join('\n');
  mockRead.mockResolvedValue({
    currentOrder: { markdown: order, sha256: 'order-hash' },
    currentCustomer: { customerIdentity: 'customer-b', customerMarkdown: 'customer B' },
    tickets: [{ acceptedRunId: 'completed-run', orderHash: 'order-hash', customerIdentity: 'customer-a', customerMarkdown: 'customer A' }],
    activeRun: { runId: 'completed-run', status: 'completed', targetMessageId: 'completed-response' },
    pendingMessages: [],
  });
  mockArtifact.mockResolvedValue({ operationId: 'published' });
  mockHasSystemOrder.mockResolvedValue(true);
  mockReadCheckpoint.mockResolvedValue(completedSystemOrder);

  const prepared = await prepareQuotationTurn({ scope, messageId: 'u6', responseId: 'a6', text: '重新確認客戶' });

  expect(prepared.instruction).toContain(JSON.stringify({
    hasOcrResult: true, hasCustomerData: true, hasSystemOrder: false, shouldAskToQuote: true,
  }));
  expect(prepared.instruction).toContain('customer B');
  expect(prepared.instruction).not.toContain(completedSystemOrder);
  expect(mockReadCheckpoint).not.toHaveBeenCalled();
});

it('does not inject completed system-order revision data while a quotation is unfinished', async () => {
  const completedSystemOrder = [
    '## system_order',
    '',
    '| 品名規格 | 數量 |',
    '| --- | --- |',
    '| A | 2 |',
  ].join('\n');
  mockRead.mockResolvedValue({
    currentOrder: { markdown: order, sha256: 'order-hash' },
    currentCustomer: { customerIdentity: 'saved-customer', customerMarkdown: 'saved customer' },
    tickets: [],
    pendingMessages: [],
    activeRun: { runId: 'running-run', status: 'running', targetMessageId: 'running-response' },
  });
  mockReadCheckpoint.mockResolvedValue(completedSystemOrder);

  const prepared = await prepareQuotationTurn({ scope, messageId: 'u4', responseId: 'a4', text: '修改數量' });

  expect(prepared.instruction).toContain(order);
  expect(prepared.instruction).not.toContain(completedSystemOrder);
  expect(mockReadCheckpoint).not.toHaveBeenCalled();
});

it.each(['old-response', 'rerun-response'])(
  'keeps completed quotation state independent of response %s', async (responseId) => {
    mockRead.mockResolvedValue({ currentOrder: { markdown: order, sha256: 'order-hash' },
    currentCustomer: { customerIdentity: 'saved-customer', customerMarkdown: 'saved customer' }, pendingMessages: [],
    activeRun: { runId: 'finished', status: 'completed', triggerMessageId: 'quote-user', targetMessageId: 'old-response' },
      tickets: [{ acceptedRunId: 'finished', orderHash: 'order-hash', customerIdentity: 'saved-customer', customerMarkdown: 'saved customer' }] });
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
  expect(mockSaveEvidence).toHaveBeenCalledWith(expect.objectContaining({ expectedOrderHash: 'order-hash' }));
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
  expect(mockSaveEvidence).toHaveBeenCalledWith(expect.objectContaining({
    evidence: expect.objectContaining({ customers: [{ id: 1 }, { id: 2 }] }),
  }));
  expect(result.ok && result.data.quotationSelectionRequired).toBe(true);
  expect(result.ok && result.data.customerDataMarkdown).toBeUndefined();
});
it('binds no-match to a disclosed saved B-tier customer and customer context before admission', async () => {
  const result = await bindQuotationCustomerResult({ expectedOrderHash: 'order-hash', scope, messageId: 'confirm', responseId: 'response-1', result: success([]) });
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockSaveEvidence).toHaveBeenCalledWith(expect.objectContaining({
    evidence: expect.objectContaining({ orderHash: 'order-hash', customerMarkdown: expect.stringContaining('|  | 未指定客戶 | B |') }),
  }));
  expect(result.ok && result.data.quoteSignal).toBeUndefined();
  expect(result.ok && result.data.customerLookupEvidence).toEqual(expect.objectContaining({ orderHash: 'order-hash' }));
});
it('does not turn lookup errors into a default customer', async () => {
  const result = { ok: false, toolName: 'search_customers', errorCategory: 'repository_error', errorSummary: 'offline', durationMs: 1, redactionVersion: 1 } as const;
  expect(await bindQuotationCustomerResult({ expectedOrderHash: 'order-hash', scope, messageId: 'confirm', responseId: 'response-1', result })).toBe(result);
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockClearEvidence).toHaveBeenCalledWith({ scope, responseId: 'response-1', orderHash: 'order-hash' });
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
