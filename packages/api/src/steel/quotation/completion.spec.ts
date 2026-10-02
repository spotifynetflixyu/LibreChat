import type { SteelResponseCompletionDependencies, SteelResponseRequest } from './completion';

import { finishSteelAgentResponse } from './completion';

const scope = { userId: 'user', tenantId: 'tenant', conversationId: 'conversation' };
const req: SteelResponseRequest = { user: { id: 'user', tenantId: 'tenant' }, cookies: { lang: 'zh-TW' }, steelNativeContext: { quotation: { scope } } };
const order = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| F1 | P1 | 鋼板 | 2 |';
const customer = '## customer_data\n\n| 價格等級 |\n| --- |\n| A |';

function setup() {
  const dependencies: SteelResponseCompletionDependencies = {
    readOrder: jest.fn(async () => order),
    readCustomer: jest.fn(async () => customer),
    reviseOrder: jest.fn(async () => ({ ok: true as const, markdown: '## system_order\n\n| x |\n| --- |\n| 1 |' })),
  };
  return { dependencies, applyMarkdown: jest.fn(), persistMarkdown: jest.fn(async () => ({})) };
}

it('uses durable state and waits for message persistence before completing', async () => {
  const test = setup();
  await finishSteelAgentResponse({ req, responseId: 'r1', markdown: customer, completed: true, ...test }, test.dependencies);
  expect(test.dependencies.readOrder).toHaveBeenCalledWith(scope);
  expect(test.dependencies.readCustomer).toHaveBeenCalledWith(scope);
  expect(test.applyMarkdown).toHaveBeenCalledWith(expect.stringContaining('請確認資料後回覆「報價」'));
  expect(test.persistMarkdown).toHaveBeenCalledTimes(1);
  expect(test.applyMarkdown.mock.invocationCallOrder[0]).toBeLessThan(test.persistMarkdown.mock.invocationCallOrder[0]!);
});

it.each([
  { completed: false }, { ocrSucceeded: false },
  { req: { ...req, steelNativeContext: { ...req.steelNativeContext, ocrTurnActive: true } } },
  { req: { ...req, steelNativeContext: { ...req.steelNativeContext, delegateOcrContext: { didExecute: true } } } },
  { req: { ...req, steelNativeContext: { quotation: { scope, resume: true } } } },
])('does not finalize incomplete or flow responses: %s', async (overrides) => {
  const test = setup();
  await finishSteelAgentResponse({ req, responseId: 'r1', markdown: customer, completed: true, ...test, ...overrides }, test.dependencies);
  expect(test.dependencies.readOrder).not.toHaveBeenCalled();
  expect(test.applyMarkdown).not.toHaveBeenCalled();
});

it('does not write or read state for plain text or a current system_order', async () => {
  const test = setup();
  for (const markdown of ['hello', '## system_order\n\n| x |\n| --- |\n| 1 |']) {
    await finishSteelAgentResponse({ req, responseId: 'r1', markdown, completed: true, ...test }, test.dependencies);
  }
  expect(test.dependencies.readOrder).not.toHaveBeenCalled();
  expect(test.persistMarkdown).not.toHaveBeenCalled();
});

it('fails completion if saving the decorated message fails', async () => {
  const test = setup();
  await expect(finishSteelAgentResponse({ req, responseId: 'r1', markdown: customer, completed: true, ...test,
    persistMarkdown: async () => null }, test.dependencies)).rejects.toMatchObject({ code: 'response_save_failed' });
});

it('keeps the authenticated scope boundary', async () => {
  const test = setup();
  await expect(finishSteelAgentResponse({ req: { ...req, user: { id: 'other' } }, responseId: 'r1', markdown: customer,
    completed: true, ...test }, test.dependencies)).rejects.toMatchObject({ code: 'invalid_response_scope' });
  expect(test.dependencies.readCustomer).not.toHaveBeenCalled();
});

it.each([undefined, 'other'])('rejects an unbound or mismatched tenant %s', async (tenantId) => {
  const test = setup();
  await expect(finishSteelAgentResponse({ req: { ...req, user: { id: 'user', tenantId } }, responseId: 'r1', markdown: customer,
    completed: true, ...test }, test.dependencies)).rejects.toMatchObject({ code: 'invalid_response_scope' });
  expect(test.dependencies.readCustomer).not.toHaveBeenCalled();
});

it('merges revisions before applying any footer and keeps failures unpublished', async () => {
  const test = setup();
  const input = { req, responseId: 'r1', markdown: '## system_order_updates\n\nchanged', completed: true, ...test };
  await finishSteelAgentResponse(input, test.dependencies);
  expect(test.applyMarkdown).toHaveBeenCalledWith(expect.stringContaining('## system_order'));
  expect(test.applyMarkdown.mock.calls[0]?.[0]).not.toContain('下一步');
  expect(test.dependencies.readOrder).not.toHaveBeenCalled();
  test.dependencies.reviseOrder = async () => ({ ok: false, code: 'stale_revision' });
  test.applyMarkdown.mockClear();
  await expect(finishSteelAgentResponse(input, test.dependencies)).rejects.toMatchObject({ code: 'stale_revision' });
  expect(test.applyMarkdown).not.toHaveBeenCalled();
});
