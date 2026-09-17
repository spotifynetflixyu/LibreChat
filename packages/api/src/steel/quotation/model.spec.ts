import { AIMessageChunk } from '@librechat/agents/langchain/messages';
import { invokeQuotationModel } from './model';
import { createOpenAIOAuthModel } from '../native/oauth';
import type { OpenAIOAuthModelOptions } from '../native/oauth';

jest.mock('../native/oauth', () => ({ createOpenAIOAuthModel: jest.fn() }));
const factory = jest.mocked(createOpenAIOAuthModel);
const invoke = jest.fn();
const base = () => ({ prompt: 'rules', input: 'chunk', modelOptions: {} as OpenAIOAuthModelOptions,
  signal: new AbortController().signal, assertActive: jest.fn().mockResolvedValue(undefined) });
beforeEach(() => { jest.clearAllMocks(); factory.mockReturnValue({ invoke } as never); });
it('binds price lookup and Python only for item pricing, then requires real lookup success', async () => {
  invoke.mockResolvedValueOnce(new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup', args: { queries: [{ queryId: 'q1', text: 'plate' }] } }], response_metadata: { finish_reason: 'tool_calls' } }))
    .mockResolvedValueOnce(new AIMessageChunk({ content: '## system_order_chunk', response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue({ ok: true, toolName: 'search_price_candidates', data: { queryResults: [] }, durationMs: 1, redactionVersion: 1 });
  expect((await invokeQuotationModel({ ...base(), role: 'child', lookup })).markdown).toBe('## system_order_chunk');
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledWith(expect.objectContaining({ enableCodeInterpreter: true, tools: [expect.objectContaining({ name: 'search_price_candidates' })] }));
});
it('rejects child completion without lookup and truncated output', async () => {
  invoke.mockResolvedValue(new AIMessageChunk({ content: 'guessed', response_metadata: { finish_reason: 'stop' } }));
  await expect(invokeQuotationModel({ ...base(), role: 'child' })).rejects.toThrow('lookup evidence');
  invoke.mockResolvedValue(new AIMessageChunk({ content: 'partial', response_metadata: { finish_reason: 'length' } }));
  await expect(invokeQuotationModel({ ...base(), role: 'main' })).rejects.toThrow('complete');
});
it('gives consolidation no tools and prevents an invented tool call from executing', async () => {
  invoke.mockResolvedValue(new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'bad', args: {} }] }));
  const lookup = jest.fn();
  await expect(invokeQuotationModel({ ...base(), role: 'main', lookup })).rejects.toThrow('cannot execute tools');
  expect(factory).toHaveBeenCalledWith(expect.objectContaining({ enableCodeInterpreter: false, tools: [] }));
  expect(lookup).not.toHaveBeenCalled();
});
