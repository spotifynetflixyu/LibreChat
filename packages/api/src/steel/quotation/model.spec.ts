import { AIMessage, AIMessageChunk, ToolMessage } from '@librechat/agents/langchain/messages';
import type { BaseMessage } from '@librechat/agents/langchain/messages';
import { invokeQuotationModel } from './model';
import type { QuotationModelInput } from './model';
import { createOpenAIOAuthModel } from '../native/oauth';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import { buildQuotationChunks, QuotationProtocolError, validateQuotationChildResult } from './protocol';
import type { QuotationLookupEvidence, QuotationPythonEvidence } from './protocol';
import type { SteelToolResult } from '../tools/results';

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
  await expect(invokeQuotationModel({ ...base(), role: 'child' })).rejects.toThrow('search_price_candidates result');
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
it('gives consolidation Python but no Steel tools and prevents an invented client tool call', async () => {
  invoke.mockResolvedValue(new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'bad', args: {} }] }));
  const lookup = jest.fn();
  await expect(invokeQuotationModel({ ...base(), role: 'main', lookup })).rejects.toThrow('cannot execute tools');
  expect(factory).toHaveBeenCalledWith(expect.objectContaining({ enableCodeInterpreter: true, tools: [] }));
  expect(lookup).not.toHaveBeenCalled();
});

const childHeaders = [
  '型號', '品名規格', '材質編號', '單位', '數量', '單重', '總數', '單價',
  '計價基準', '公式編號', '厚度', '寬度', '長度', '肚', '類別', '備註',
];
const childRow = ['ERP-1', '鐵板 6T P1', '黑鐵', 'Kg', '2', '', '2', '12', '2', 'PL', '6', '100', '200', '', '鐵板', 'F1 P1'];
const childOrder = buildQuotationChunks([
  '## ocr_result',
  '',
  '| 來源 | 零件編號 | 類別 | 數量 | 厚度 | 寬度 | 長度 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| F1 | P1 | 鐵板 | 2 | 6 | 100 | 200 |',
].join('\n'))[0]!;
const validChild = `## system_order_chunk\n\n| ${childHeaders.join(' | ')} |\n| ${childHeaders.map(() => '---').join(' | ')} |\n| ${childRow.join(' | ')} |`;
const malformedChild = `${validChild}\n| unfinished`;
const lookupResult: SteelToolResult = {
  ok: true,
  toolName: 'search_price_candidates',
  data: { queryResults: [{ queryId: 'q1', status: 'ok', candidates: [] }] },
  durationMs: 1,
  redactionVersion: 1,
};

function lookupEvidence(result: SteelToolResult = lookupResult): QuotationLookupEvidence {
  return { lookupCallId: 'lookup-1', persisted: true, result };
}

function childToolCall(id = 'lookup-1'): AIMessageChunk {
  return new AIMessageChunk({
    content: '',
    tool_calls: [{ name: 'search_price_candidates', id, args: { queries: [{ queryId: 'q1', categories: ['鐵板'] }] } }],
    response_metadata: { finish_reason: 'tool_calls' },
  });
}

function childInput(overrides: Partial<QuotationModelInput> = {}): QuotationModelInput {
  return {
    ...base(),
    role: 'child',
    input: JSON.stringify({ chunk: childOrder.markdown, customer: 'customer context' }),
    ...overrides,
  };
}

it('repairs a malformed row through the real validator while preserving lookup, original context, and Python evidence', async () => {
  let evidenceCallback: OpenAIOAuthModelOptions['onCodeInterpreterEvidence'];
  factory.mockImplementation((options) => {
    evidenceCallback = options.onCodeInterpreterEvidence;
    return { invoke, stream } as never;
  });
  const pythonEvidence: QuotationPythonEvidence[] = [
    { type: 'tool-call', toolCallId: 'py-1', payload: '{"code":"print(1)"}' },
    { type: 'tool-result', toolCallId: 'py-1', payload: '{"output":"1"}' },
  ];
  invoke
    .mockImplementationOnce(async () => {
      await evidenceCallback?.(pythonEvidence[0]!);
      await evidenceCallback?.(pythonEvidence[1]!);
      return childToolCall();
    })
    .mockResolvedValueOnce(new AIMessageChunk({ content: malformedChild, response_metadata: { finish_reason: 'stop' } }))
    .mockResolvedValueOnce(childToolCall('fresh-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValueOnce(lookupResult).mockResolvedValueOnce(lookupResult);
  const onChildMessages = jest.fn();
  const validator = jest.fn(async (markdown: string) => {
    validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
  });
  const onPythonEvidence = jest.fn().mockResolvedValue(undefined);

  const result = await invokeQuotationModel({ ...childInput(), lookup, validateChildOutput: validator, onPythonEvidence, onChildMessages });

  expect(result.markdown).toBe(validChild);
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(validator).toHaveBeenCalledTimes(2);
  expect(onPythonEvidence.mock.calls).toEqual(pythonEvidence.map((evidence) => [evidence]));
  expect(result.pythonEvidence).toEqual(pythonEvidence);
  const repairMessages = invoke.mock.calls[2]?.[0] as BaseMessage[];
  expect(repairMessages).toHaveLength(2);
  expect(repairMessages[1]?.content).toBe(childInput().input);
  expect(JSON.stringify(repairMessages)).not.toContain('lookup-1');
  const freshMessages = invoke.mock.calls[3]?.[0] as BaseMessage[];
  const freshCall = freshMessages.find((message) => message.getType() === 'ai' &&
    (message as AIMessage).tool_calls?.some((call) => call.id === 'fresh-lookup')) as AIMessage;
  expect(freshCall.tool_calls[0].args).toEqual(expect.any(Object));
  expect(freshMessages.some((message) => message.getType() === 'tool' &&
    (message as ToolMessage).tool_call_id === 'fresh-lookup')).toBe(true);
  expect(onChildMessages.mock.calls.flatMap(([saved]) => saved)
    .some((message: { data: { content: unknown } }) => message.data.content === malformedChild)).toBe(true);
});

it('retries an invalid small child only once before interrupting', async () => {
  const protocolError = new QuotationProtocolError('invalid_child_result', 'invalid child row');
  const validator = jest.fn(async () => {
    throw protocolError;
  });
  invoke.mockResolvedValue(new AIMessageChunk({ content: malformedChild, response_metadata: { finish_reason: 'stop' } }));

  const onChildRepair = jest.fn();
  await expect(invokeQuotationModel({ ...childInput(), validateChildOutput: validator, onChildRepair })).rejects.toBe(protocolError);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(validator).toHaveBeenCalledTimes(2);
  expect(onChildRepair.mock.calls.map(([event]) => [event.stage, event.repairAttempt])).toEqual([
    ['chunk_repair_started', 1], ['chunk_repair_failed', 1],
  ]);
  expect(invoke.mock.calls.slice(1).every(([messages]) => {
    const providerMessages = messages as BaseMessage[];
    return !providerMessages.some((message) => String(message.content).includes(malformedChild)) &&
      !providerMessages.some((message) => message.getType() === 'ai');
  })).toBe(true);
});

it('filters a failed draft from provider history while preserving raw output and emitting repair success', async () => {
  const leaked = `${validChild}\n| <|im_start|>assistant <|meta_sep|>analysis`;
  invoke.mockResolvedValueOnce(childToolCall())
    .mockResolvedValueOnce(new AIMessageChunk({ content: leaked, response_metadata: { finish_reason: 'stop' } }))
    .mockResolvedValueOnce(childToolCall('fresh-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const onChildMessages = jest.fn();
  const onChildRepair = jest.fn();
  const validateChildOutput = jest.fn(async (markdown: string) => {
    validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
  });
  await invokeQuotationModel({ ...childInput(), lookup: jest.fn().mockResolvedValue(lookupResult), onChildMessages, onChildRepair, validateChildOutput });
  const repairedHistory = invoke.mock.calls[2]![0] as BaseMessage[];
  expect(repairedHistory.some((message) => String(message.content).includes(leaked))).toBe(false);
  expect(repairedHistory.some((message) => message.getType() === 'ai')).toBe(false);
  expect(onChildMessages.mock.calls.at(-1)![0].some((message: { data: { content: unknown } }) => message.data.content === leaked)).toBe(true);
  expect(onChildRepair.mock.calls.map(([event]) => [event.stage, event.repairAttempt])).toEqual([
    ['chunk_repair_started', 1], ['chunk_repair_succeeded', 1],
  ]);
  expect(onChildRepair.mock.calls[0]![0].message).toContain('model control text');
});

it('preserves actual tool calls and results while sanitizing leaked invocation prose', async () => {
  invoke.mockResolvedValueOnce(new AIMessageChunk({ content: 'assistant to=functions.fake_tool', tool_calls: [{
    name: 'search_price_candidates', id: 'lookup-1', args: { query: 'original lookup' },
  }], response_metadata: { finish_reason: 'tool_calls' } }))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  await invokeQuotationModel({ ...childInput(), lookup: jest.fn().mockResolvedValue(lookupResult),
    validateChildOutput: async (markdown) => {
      validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
    } });
  const resumed = invoke.mock.calls[1]![0] as BaseMessage[];
  const toolTurn = resumed.find((message) => message.getType() === 'ai') as AIMessage;
  expect(toolTurn.tool_calls[0].id).toBe('lookup-1');
  expect(toolTurn.content).toBe('');
  expect(resumed.some((message) => message.getType() === 'tool' &&
    (message as ToolMessage).tool_call_id === 'lookup-1')).toBe(true);
});

it('does not replay a failed child draft with the production Unicode tail while preserving the raw transcript', async () => {
  const poisonedTail = '\u3011\u3010\uff1a\u3011\u3010\u201c\u3011\u3010analysis code';
  const poisoned = `${validChild}\n| ${poisonedTail}`;
  invoke.mockResolvedValueOnce(childToolCall())
    .mockResolvedValueOnce(new AIMessageChunk({ content: poisoned, response_metadata: { finish_reason: 'stop' } }))
    .mockResolvedValueOnce(childToolCall('fresh-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const onChildMessages = jest.fn();
  const validateChildOutput = jest.fn(async (markdown: string) => {
    validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
  });

  await invokeQuotationModel({ ...childInput(), lookup: jest.fn().mockResolvedValue(lookupResult),
    onChildMessages, validateChildOutput });

  const repairMessages = invoke.mock.calls[2]![0] as BaseMessage[];
  expect(repairMessages.some((message) => String(message.content).includes(poisonedTail))).toBe(false);
  expect(repairMessages.some((message) => message.getType() === 'ai')).toBe(false);
  expect(onChildMessages.mock.calls.flatMap(([saved]) => saved)
    .some((message: { data: { content: unknown } }) => message.data.content === poisoned)).toBe(true);
});

it('captures main Python evidence without offering Steel tools, while preparation keeps Python disabled', async () => {
  let evidenceCallback: OpenAIOAuthModelOptions['onCodeInterpreterEvidence'];
  factory.mockImplementation((options) => {
    evidenceCallback = options.onCodeInterpreterEvidence;
    return { invoke, stream } as never;
  });
  const evidence: QuotationPythonEvidence = { type: 'tool-result', toolCallId: 'main-python', payload: '{"output":"6"}' };
  stream.mockImplementationOnce(async function* () {
    await evidenceCallback?.(evidence);
    yield new AIMessageChunk({ content: 'complete', response_metadata: { finish_reason: 'stop' } });
  });
  const onPythonEvidence = jest.fn();
  const result = await invokeQuotationModel({ ...base(), role: 'main', onTextDelta: jest.fn(), onPythonEvidence });
  expect(result.pythonEvidence).toEqual([evidence]);
  expect(onPythonEvidence).toHaveBeenCalledWith(evidence);
  expect(factory).toHaveBeenLastCalledWith(expect.objectContaining({ enableCodeInterpreter: true, tools: [] }));
  invoke.mockResolvedValueOnce(new AIMessageChunk({ content: 'prepared', response_metadata: { finish_reason: 'stop' } }));
  await invokeQuotationModel({ ...base(), role: 'preparation' });
  expect(factory).toHaveBeenLastCalledWith(expect.objectContaining({ enableCodeInterpreter: false, tools: [], onCodeInterpreterEvidence: undefined }));
});

it('starts every repair from a clean prompt and requires a new lookup result', async () => {
  invoke
    .mockResolvedValueOnce(childToolCall('old-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: malformedChild, response_metadata: { finish_reason: 'stop' } }))
    .mockResolvedValueOnce(childToolCall('fresh-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue(lookupResult);
  const validator = jest.fn(async (markdown: string) => {
    validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
  });

  await expect(invokeQuotationModel({ ...childInput(), lookup, validateChildOutput: validator })).resolves.toEqual(
    expect.objectContaining({ markdown: validChild }),
  );
  const repair = invoke.mock.calls[2]![0] as BaseMessage[];
  expect(repair.filter((message) => message.getType() === 'system')).toHaveLength(1);
  expect(repair.some((message) => message.getType() === 'human' && message.content === childInput().input)).toBe(true);
  expect(repair.some((message) => message.getType() === 'tool')).toBe(false);
  expect(invoke.mock.calls[0]![1].toolChoice).toEqual({ type: 'tool', toolName: 'search_price_candidates' });
  expect(invoke.mock.calls[1]![1].toolChoice).toEqual({ type: 'auto' });
  expect(invoke.mock.calls[2]![1].toolChoice).toEqual({ type: 'tool', toolName: 'search_price_candidates' });
  expect(invoke.mock.calls[3]![1].toolChoice).toEqual({ type: 'auto' });
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(lookup).toHaveBeenLastCalledWith('fresh-lookup', {
    queries: [{ queryId: 'q1', categories: ['鐵板'] }],
  });
});

it('does not count printed lookup JSON or an earlier lookup as a real call in the new attempt', async () => {
  const printedCall = `search_price_candidates {"queries":[{"categories":["鐵板"]}]}\n\n${validChild}`;
  invoke.mockResolvedValueOnce(childToolCall('old-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: malformedChild, response_metadata: { finish_reason: 'stop' } }))
    .mockResolvedValueOnce(new AIMessageChunk({ content: printedCall, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue(lookupResult);
  await expect(invokeQuotationModel({ ...childInput(), lookup,
    validateChildOutput: async (markdown) => {
      validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
    },
  })).rejects.toThrow('This quotation attempt requires a search_price_candidates result');
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[2]![1].toolChoice).toEqual({ type: 'tool', toolName: 'search_price_candidates' });
  expect(invoke.mock.calls[2]![0]).toHaveLength(2);
});

it('does not locally repair when maxChildRepairAttempts is zero', async () => {
  const onChildRepair = jest.fn();
  const onChildMessages = jest.fn();
  invoke.mockResolvedValueOnce(new AIMessageChunk({ content: malformedChild, response_metadata: { finish_reason: 'stop' } }));
  await expect(invokeQuotationModel({ ...childInput(), maxChildRepairAttempts: 0, onChildRepair, onChildMessages,
    validateChildOutput: async (markdown) => {
      validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
    },
  })).rejects.toThrow('incomplete Markdown row');
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(onChildRepair).not.toHaveBeenCalled();
  expect(onChildMessages.mock.calls.at(-1)![0].at(-1).data.content).toBe(malformedChild);
});

it('repairs a length-finished child even when the candidate validates', async () => {
  invoke
    .mockResolvedValueOnce(childToolCall())
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'length' } }))
    .mockResolvedValueOnce(childToolCall('fresh-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue(lookupResult);
  const validator = jest.fn(async (markdown: string) => {
    validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
  });

  await expect(invokeQuotationModel({ ...childInput(), lookup, validateChildOutput: validator })).resolves.toEqual(
    expect.objectContaining({ markdown: validChild }),
  );
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(validator).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledTimes(4);
});

it('does not retry a generic validator or checkpoint error', async () => {
  const storageError = new Error('checkpoint storage failed');
  invoke.mockResolvedValue(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const validator = jest.fn(async () => { throw storageError; });

  await expect(invokeQuotationModel({ ...childInput(), validateChildOutput: validator })).rejects.toBe(storageError);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(validator).toHaveBeenCalledTimes(1);
});

it('stops repair immediately when cancellation occurs after an invalid candidate', async () => {
  const controller = new AbortController();
  invoke.mockResolvedValue(new AIMessageChunk({ content: malformedChild, response_metadata: { finish_reason: 'stop' } }));
  const validator = jest.fn(async () => {
    controller.abort(new Error('cancelled'));
    throw new QuotationProtocolError('invalid_child_result', 'invalid child');
  });

  await expect(invokeQuotationModel({ ...childInput({ signal: controller.signal }), validateChildOutput: validator })).rejects.toThrow('cancelled');
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(validator).toHaveBeenCalledTimes(1);
});

it('repairs a valid child that omitted lookup and succeeds after one lookup', async () => {
  invoke
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }))
    .mockResolvedValueOnce(childToolCall())
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue(lookupResult);
  const persistedLookups: QuotationLookupEvidence[] = [];
  const validator = jest.fn(async (markdown: string) => {
    validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: persistedLookups });
  });
  lookup.mockImplementation(async () => {
    persistedLookups.push(lookupEvidence());
    return lookupResult;
  });

  await expect(invokeQuotationModel({ ...childInput(), lookup, validateChildOutput: validator })).resolves.toEqual(
    expect.objectContaining({ markdown: validChild }),
  );
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(validator).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledTimes(3);
});

it('preserves the exhausted final response and stops when transcript persistence fails', async () => {
  invoke.mockResolvedValue(new AIMessageChunk({ content: malformedChild, response_metadata: { finish_reason: 'stop' } }));
  const onChildMessages = jest.fn();
  const validateChildOutput = jest.fn(async () => { throw new QuotationProtocolError('invalid_child_result', 'bad row'); });
  await expect(invokeQuotationModel({ ...childInput(), onChildMessages, validateChildOutput })).rejects.toThrow('bad row');
  expect(onChildMessages.mock.calls.at(-1)![0].at(-1).data.content).toBe(malformedChild);
  invoke.mockClear();
  onChildMessages.mockRejectedValueOnce(new Error('transcript storage failed'));
  await expect(invokeQuotationModel({ ...childInput(), onChildMessages, validateChildOutput })).rejects.toThrow('transcript storage failed');
  expect(invoke).toHaveBeenCalledTimes(1);
});
