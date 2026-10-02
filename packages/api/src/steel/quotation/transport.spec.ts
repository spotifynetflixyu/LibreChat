import type { Response as ServerResponse } from 'express';
import type { ResponseEvent } from '../../agents/responses/types';
import { buildResponse, createResponseTracker, emitOutputTextDone } from '../../agents/responses/handlers';
import { finalizeSteelResponsesTurn, replaceSteelResponsesMarkdown } from './transport';
import { extractSteelNativeResponseOutputText } from '../native/markdown';
import { appendSteelNextStep } from './next';

const order = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| F1 | P1 | 鋼板 | 2 |';
const customer = '## customer_data\n\n| 價格等級 |\n| --- |\n| B |';

function setup(store: boolean) {
  const tracker = createResponseTracker();
  tracker.currentMessage = { type: 'message', role: 'assistant', id: 'message', status: 'in_progress',
    content: [{ type: 'output_text', text: customer, annotations: [], logprobs: [] }] };
  tracker.items.push(tracker.currentMessage);
  tracker.accumulatedText = customer;
  const response = buildResponse({ responseId: 'response', model: 'agent', createdAt: 0 }, tracker, 'completed');
  const req = { user: { id: 'user' }, headers: { 'accept-language': 'en-US,en;q=0.9' },
    steelNativeContext: { quotation: { scope: { userId: 'user', conversationId: 'conversation' } } } };
  return {
    response, tracker, req, responseId: 'response', store,
    saveConversation: jest.fn(async () => {}), saveInput: jest.fn(async () => {}),
    saveOutput: jest.fn(async () => {
      replaceSteelResponsesMarkdown(response, appendSteelNextStep({ markdown: extractSteelNativeResponseOutputText(response),
        order, customer, completed: true, language: 'en-US' }));
    }),
  };
}

it('uses the sole output persistence owner for store=false before wire publication', async () => {
  const input = setup(false);
  await finalizeSteelResponsesTurn(input);
  expect(extractSteelNativeResponseOutputText(input.response)).toContain('reply “Quote”');
  expect(input.tracker.accumulatedText).toBe(extractSteelNativeResponseOutputText(input.response));
  expect(input.saveConversation).not.toHaveBeenCalled();
  expect(input.saveOutput).toHaveBeenCalledTimes(1);
});

it('publishes the saved decorated output for stored responses', async () => {
  const input = setup(true);
  input.saveOutput.mockImplementation(async () => {
    replaceSteelResponsesMarkdown(input.response, `${customer}\n\nSaved footer`);
  });
  await finalizeSteelResponsesTurn(input);
  expect(input.saveConversation).toHaveBeenCalledTimes(1);
  expect(input.saveInput).toHaveBeenCalledTimes(1);
  expect(input.saveOutput).toHaveBeenCalledTimes(1);
  expect(input.tracker.accumulatedText).toContain('Saved footer');
});

it('propagates persistence failures instead of publishing a success response', async () => {
  const input = setup(true);
  input.saveOutput.mockRejectedValue(new Error('database unavailable'));
  await expect(finalizeSteelResponsesTurn(input)).rejects.toMatchObject({ code: 'response_save_failed' });
  expect(input.tracker.accumulatedText).toBe(customer);
});

it('logs an ordinary persistence failure and preserves the model response', async () => {
  const input = setup(true);
  replaceSteelResponsesMarkdown(input.response, 'Hello');
  input.saveOutput.mockRejectedValue(new Error('database unavailable'));
  const onPersistenceFailure = jest.fn();
  await expect(finalizeSteelResponsesTurn({ ...input, onPersistenceFailure })).resolves.toBeUndefined();
  expect(onPersistenceFailure).toHaveBeenCalledTimes(1);
  expect(extractSteelNativeResponseOutputText(input.response)).toBe('Hello');
});

it('emits a sanitized failed event when streamed Steel persistence fails', async () => {
  const input = setup(true);
  input.saveOutput.mockRejectedValue(new Error('secret provider payload'));
  const events: ResponseEvent[] = [];
  const res = { write: (chunk: string) => {
    if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)) as ResponseEvent);
    return true;
  } } as ServerResponse;
  const streamConfig = { res, tracker: input.tracker, context: { responseId: 'response', model: 'agent', createdAt: 0 } };
  await expect(finalizeSteelResponsesTurn({ ...input, streamConfig })).rejects.toMatchObject({ code: 'response_save_failed' });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'response.failed', response: {
    status: 'failed', error: { type: 'server_error', message: 'Steel response could not be finalized.', code: 'response_save_failed' },
  } });
  expect(JSON.stringify(events)).not.toContain('secret provider payload');
});

it('keeps an already finalized flow output unchanged', async () => {
  const input = setup(false);
  input.saveOutput.mockImplementation(async () => {});
  await finalizeSteelResponsesTurn(input);
  expect(extractSteelNativeResponseOutputText(input.response)).toBe(customer);
});

it('keeps the footer on the final message across a completed tool boundary', async () => {
  const input = setup(false);
  const intro = { type: 'message' as const, role: 'assistant' as const, id: 'intro', status: 'completed' as const,
    content: [{ type: 'output_text' as const, text: 'Checking customer.\n\n', annotations: [], logprobs: [] }] };
  const tool = { type: 'function_call' as const, id: 'tool', call_id: 'call', name: 'search_customers',
    arguments: '{}', status: 'completed' as const };
  input.tracker.items.unshift(intro, tool);
  const events: ResponseEvent[] = [];
  const res = { write: (chunk: string) => {
    if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)) as ResponseEvent);
    return true;
  } } as ServerResponse;
  const streamConfig = { res, tracker: input.tracker, context: { responseId: 'response', model: 'agent', createdAt: 0 } };
  await finalizeSteelResponsesTurn({ ...input, streamConfig });
  emitOutputTextDone(streamConfig);
  expect(intro.content[0]?.text).toBe('Checking customer.\n\n');
  const delta = events.find((event) => event.type === 'response.output_text.delta');
  const done = events.find((event) => event.type === 'response.output_text.done');
  expect(delta).toMatchObject({ item_id: 'message', output_index: 2, delta: expect.stringContaining('reply “Quote”') });
  expect(done).toMatchObject({ item_id: 'message', output_index: 2, text: expect.stringContaining(customer) });
  const completed = buildResponse(streamConfig.context, input.tracker, 'completed');
  expect(extractSteelNativeResponseOutputText(completed)).toBe(extractSteelNativeResponseOutputText(input.response));
  expect(input.tracker.currentMessage?.content[0]).toMatchObject({ text: `${customer}\n\n**Next step:** The material order and customer tier are available. Please confirm the details, then reply “Quote”.` });
});
