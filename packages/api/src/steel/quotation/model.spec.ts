import { AIMessageChunk } from '@librechat/agents/langchain/messages';
import { invokeQuotationModel } from './model';
import { createOpenAIOAuthModel } from '../native/oauth';
import type { OpenAIOAuthModelOptions } from '../native/oauth';

jest.mock('../native/oauth', () => ({ createOpenAIOAuthModel: jest.fn() }));
const factory = jest.mocked(createOpenAIOAuthModel);
const invoke = jest.fn();
const stream = jest.fn();
const base = () => ({ prompt: 'rules', input: 'chunk', modelOptions: {} as OpenAIOAuthModelOptions,
  signal: new AbortController().signal, assertActive: jest.fn().mockResolvedValue(undefined) });
beforeEach(() => { jest.clearAllMocks(); factory.mockReturnValue({ invoke, stream } as never); });
it('streams main text before completion and collects the complete result and usage', async () => {
  const onTextDelta = jest.fn();
  const onUsage = jest.fn();
  const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
  stream.mockImplementationOnce(async function* () {
    yield new AIMessageChunk({ content: '## system_order\n' });
    expect(onTextDelta).toHaveBeenCalledWith('## system_order\n');
    yield new AIMessageChunk({ content: 'table' });
    yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'stop' }, usage_metadata: usage });
  });
  const result = await invokeQuotationModel({ ...base(), role: 'main', onTextDelta, onUsage });
  expect(result.markdown).toBe('## system_order\ntable');
  expect(onTextDelta.mock.calls).toEqual([['## system_order\n'], ['table']]);
  expect(onUsage).toHaveBeenCalledWith(expect.objectContaining(usage));
  expect(invoke).not.toHaveBeenCalled();
});
it('rejects truncated or cancelled main streams without treating partial text as complete', async () => {
  const onTextDelta = jest.fn();
  stream.mockImplementationOnce(async function* () {
    yield new AIMessageChunk({ content: 'partial' });
    yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'length' } });
  });
  await expect(invokeQuotationModel({ ...base(), role: 'main', onTextDelta })).rejects.toThrow('complete');
  const controller = new AbortController();
  stream.mockImplementationOnce(async function* () {
    yield new AIMessageChunk({ content: 'before cancellation\n' });
    controller.abort();
    yield new AIMessageChunk({ content: 'after cancellation' });
  });
  onTextDelta.mockClear();
  await expect(invokeQuotationModel({ ...base(), role: 'main', signal: controller.signal, onTextDelta })).rejects.toThrow();
  expect(onTextDelta.mock.calls).toEqual([['before cancellation\n']]);
});
it('buffers split order rows and reuses numeric normalization before emitting them', async () => {
  const onTextDelta = jest.fn();
  const header = '## system_order\n| 數量 | 單價 | 計價基準 |\n| --- | --- | --- |\n';
  stream.mockImplementationOnce(async function* () {
    yield new AIMessageChunk({ content: `${header}| 2支 | 1,234.` });
    expect(onTextDelta.mock.calls).toEqual([[header]]);
    yield new AIMessageChunk({ content: '50元 | B |\n| 3' });
    expect(onTextDelta.mock.calls).toEqual([[header], ['| 2 | 1234.50 | 2 |\n']]);
    yield new AIMessageChunk({ content: '支 | 4元 | B |', response_metadata: { finish_reason: 'stop' } });
  });
  await invokeQuotationModel({ ...base(), role: 'main', onTextDelta });
  expect(onTextDelta.mock.calls).toEqual([[header], ['| 2 | 1234.50 | 2 |\n'], ['| 3 | 4 | 2 |']]);
});
it('stops emitting normalized rows immediately when the execution lease is lost', async () => {
  const onTextDelta = jest.fn();
  const assertActive = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
    .mockRejectedValue(new Error('execution lease lost'));
  stream.mockImplementationOnce(async function* () {
    yield new AIMessageChunk({ content: 'first line\n' });
    yield new AIMessageChunk({ content: 'second line\n' });
  });
  await expect(invokeQuotationModel({ ...base(), role: 'main', assertActive, onTextDelta })).rejects.toThrow('execution lease lost');
  expect(onTextDelta.mock.calls).toEqual([['first line\n']]);
});
it('binds price lookup and Python only for item pricing, then accepts a completed attempt', async () => {
  invoke.mockResolvedValueOnce(new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup', args: { queries: [{ queryId: 'q1', text: 'plate' }] } }], response_metadata: { finish_reason: 'tool_calls' } }))
    .mockResolvedValueOnce(new AIMessageChunk({ content: '## system_order_chunk', response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue({ ok: true, toolName: 'search_price_candidates', data: { queryResults: [] }, durationMs: 1, redactionVersion: 1 });
  expect((await invokeQuotationModel({ ...base(), role: 'child', lookup })).markdown).toBe('## system_order_chunk');
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledWith(expect.objectContaining({ enableCodeInterpreter: true, tools: [expect.objectContaining({ name: 'search_price_candidates' })] }));
});
it('rejects child completion without lookup and truncated output', async () => {
  invoke.mockResolvedValue(new AIMessageChunk({ content: 'guessed', response_metadata: { finish_reason: 'stop' } }));
  await expect(invokeQuotationModel({ ...base(), role: 'child' })).rejects.toThrow('search_price_candidates attempt');
  invoke.mockResolvedValue(new AIMessageChunk({ content: 'partial', response_metadata: { finish_reason: 'length' } }));
  await expect(invokeQuotationModel({ ...base(), role: 'main' })).rejects.toThrow('complete');
});
it('accepts a structured failed price lookup when the child returns blank-data Markdown', async () => {
  invoke.mockResolvedValueOnce(new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'failed-lookup', args: { queries: [{ queryId: 'q1', categories: ['鐵板'] }] } }], response_metadata: { finish_reason: 'tool_calls' } }))
    .mockResolvedValueOnce(new AIMessageChunk({ content: '## system_order_chunk', response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue({
    ok: false,
    toolName: 'search_price_candidates',
    errorCategory: 'repository_error',
    errorSummary: 'temporary lookup failure',
    durationMs: 1,
    redactionVersion: 1,
  });
  await expect(invokeQuotationModel({ ...base(), role: 'child', lookup })).resolves.toEqual(expect.objectContaining({ markdown: '## system_order_chunk' }));
});
it('gives consolidation no tools and prevents an invented tool call from executing', async () => {
  invoke.mockResolvedValue(new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'bad', args: {} }] }));
  const lookup = jest.fn();
  await expect(invokeQuotationModel({ ...base(), role: 'main', lookup })).rejects.toThrow('cannot execute tools');
  expect(factory).toHaveBeenCalledWith(expect.objectContaining({ enableCodeInterpreter: false, tools: [] }));
  expect(lookup).not.toHaveBeenCalled();
});
