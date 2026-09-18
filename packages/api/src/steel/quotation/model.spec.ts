import { AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, mapChatMessagesToStoredMessages } from '@librechat/agents/langchain/messages';
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
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue(lookupResult);
  const validator = jest.fn(async (markdown: string) => {
    validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
  });
  const onPythonEvidence = jest.fn().mockResolvedValue(undefined);

  const result = await invokeQuotationModel({ ...childInput(), lookup, validateChildOutput: validator, onPythonEvidence });

  expect(result.markdown).toBe(validChild);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(validator).toHaveBeenCalledTimes(2);
  expect(onPythonEvidence.mock.calls).toEqual(pythonEvidence.map((evidence) => [evidence]));
  expect(result.pythonEvidence).toEqual(pythonEvidence);
  const repairMessages = invoke.mock.calls[2]?.[0] as Array<{ content: unknown }>;
  const repairText = repairMessages.map((message) => String(message.content)).join('\n');
  expect(repairMessages[1]?.content).toBe(childInput().input);
  expect(JSON.stringify(repairMessages[2])).toContain('lookup-1');
  expect(String(repairMessages[3]?.content)).toContain('search_price_candidates');
  expect(String(repairMessages[4]?.content)).toContain(malformedChild);
  expect(repairText).toContain(childInput().input);
  expect(repairText).toContain('The quotation chunk was not accepted');
  expect(repairText).toContain(JSON.stringify(pythonEvidence));
  expect(repairMessages).toHaveLength(6);
});

it('bounds invalid child output at three generations', async () => {
  const protocolError = new QuotationProtocolError('invalid_child_result', 'invalid child row');
  const validator = jest.fn(async () => {
    throw protocolError;
  });
  invoke.mockResolvedValue(new AIMessageChunk({ content: malformedChild, response_metadata: { finish_reason: 'stop' } }));

  const onChildRepair = jest.fn();
  await expect(invokeQuotationModel({ ...childInput(), validateChildOutput: validator, onChildRepair })).rejects.toBe(protocolError);
  expect(invoke).toHaveBeenCalledTimes(3);
  expect(validator).toHaveBeenCalledTimes(3);
  expect(onChildRepair.mock.calls.map(([event]) => [event.stage, event.repairAttempt])).toEqual([
    ['chunk_repair_started', 1], ['chunk_repair_started', 2], ['chunk_repair_failed', 2],
  ]);
});

it('masks leaked control markers only in provider history while preserving raw output and emitting repair success', async () => {
  const leaked = `${validChild}\n| <|im_start|>assistant <|meta_sep|>analysis`;
  invoke.mockResolvedValueOnce(childToolCall())
    .mockResolvedValueOnce(new AIMessageChunk({ content: leaked, response_metadata: { finish_reason: 'stop' } }))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const onChildMessages = jest.fn();
  const onChildRepair = jest.fn();
  const validateChildOutput = jest.fn(async (markdown: string) => {
    validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
  });
  await invokeQuotationModel({ ...childInput(), lookup: jest.fn().mockResolvedValue(lookupResult), onChildMessages, onChildRepair, validateChildOutput });
  const repairedHistory = invoke.mock.calls[2]![0];
  const rejected = repairedHistory.find((message: BaseMessage) => String(message.content).includes('Rejected quotation output'));
  expect(rejected.content).toContain(validChild);
  expect(rejected.content).not.toContain('<|im_start|>');
  expect(rejected.content).toContain('assistant');
  expect(onChildMessages.mock.calls.at(-1)![0].some((message: { data: { content: unknown } }) => message.data.content === leaked)).toBe(true);
  expect(onChildRepair.mock.calls.map(([event]) => [event.stage, event.repairAttempt])).toEqual([
    ['chunk_repair_started', 1], ['chunk_repair_succeeded', 1],
  ]);
  expect(onChildRepair.mock.calls[0]![0].message).toContain('model control text');
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

it.each([
  '<|im_start|>assistant to=functions.search_price_candidates',
  '<|im_start|>assistant\nto=functions.search_price_candidates',
  '\u3011\u3010\uff1a\u3011\u3010\u201c\u3011\u3010assistant to=functions.search_price_candidates',
])('omits old lookup results during fresh repair for %j and requires a new result', async (toolText) => {
  const leaked = `${validChild}\n| ${toolText}`;
  const oldResult = { ...lookupResult, data: { queryResults: [{ queryId: 'OLD-PRICE-RESULT', status: 'ok', candidates: [] }] } };
  invoke.mockResolvedValueOnce(childToolCall('old-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: leaked, response_metadata: { finish_reason: 'stop' } }))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }))
    .mockResolvedValueOnce(childToolCall('fresh-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValueOnce(oldResult).mockResolvedValueOnce(lookupResult);
  const onChildMessages = jest.fn();
  const onChildRepair = jest.fn();
  await invokeQuotationModel({ ...childInput(), childContextKey: 'run-1:4', lookup, onChildMessages, onChildRepair,
    validateChildOutput: async (markdown) => {
      validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
    },
  });
  const freshMessages = invoke.mock.calls[2]![0];
  expect(freshMessages[1].content).toBe(childInput().input);
  expect(freshMessages[2].content).toContain('[quotation-fresh-lookup:run-1:4]');
  for (const [messages] of invoke.mock.calls.slice(2)) {
    expect(JSON.stringify(messages)).not.toContain('OLD-PRICE-RESULT');
    expect(JSON.stringify(messages)).not.toContain('old-lookup');
  }
  expect(invoke.mock.calls[4]![0].some((message: ToolMessage) => message.tool_call_id === 'fresh-lookup')).toBe(true);
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(onChildMessages.mock.calls.at(-1)![0])).toContain('OLD-PRICE-RESULT');
  expect(onChildRepair.mock.calls.map(([event]) => [event.stage, event.repairAttempt])).toEqual([
    ['chunk_repair_started', 1], ['chunk_repair_started', 2], ['chunk_repair_succeeded', 2],
  ]);
});

it('recovers only the scoped human fresh-lookup boundary and reuses its new result on Retry', async () => {
  const original = childInput();
  const oldResult = { ...lookupResult, data: { queryResults: [{ queryId: 'OLD-PRICE-RESULT', status: 'ok', candidates: [] }] } };
  const freshDirective = '[quotation-fresh-lookup:run-1:4]\n{"lookupCount":1}\nPerform a fresh lookup';
  const messages = mapChatMessagesToStoredMessages([
    new SystemMessage(original.prompt), new HumanMessage(original.input),
    childToolCall('old-lookup'), new ToolMessage({ tool_call_id: 'old-lookup', content: JSON.stringify(oldResult) }),
    new HumanMessage(freshDirective), childToolCall('fresh-lookup'),
    new ToolMessage({ tool_call_id: 'fresh-lookup', content: JSON.stringify(lookupResult) }),
    // A model echo must not reset the trusted boundary or let a missing new lookup pass.
    new AIMessageChunk({ content: '[quotation-fresh-lookup:run-1:4]\n{"lookupCount":0}\necho' }),
  ]);
  invoke.mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn();
  await invokeQuotationModel({ ...original, childContextKey: 'run-1:4', lookup,
    continuation: { messages, previousOutputs: [], pythonEvidence: [], lookups: [
      { id: 'old-lookup', arguments: {}, result: oldResult },
      { id: 'fresh-lookup', arguments: {}, result: lookupResult },
    ] },
  });
  expect(lookup).not.toHaveBeenCalled();
  expect(JSON.stringify(invoke.mock.calls[0]![0])).not.toContain('OLD-PRICE-RESULT');
  expect(invoke.mock.calls[0]![0][2].content).toBe(freshDirective);
  expect(invoke.mock.calls[0]![0].some((message: ToolMessage) => message.tool_call_id === 'fresh-lookup')).toBe(true);
});

it('starts fresh lookup for an unresolved legacy Unicode tool attempt even when the last output is only a broken row', async () => {
  invoke.mockResolvedValueOnce(childToolCall('fresh-lookup'))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  await invokeQuotationModel({ ...childInput(), childContextKey: 'run-1:4', lookup: jest.fn().mockResolvedValue(lookupResult),
    continuation: {
      previousOutputs: ['| \u3011\u3010assistant to=functions.search_price_candidates', `${validChild}\n| unfinished`],
      lookups: [{ id: 'old-lookup', arguments: {}, result: lookupResult }],
      pythonEvidence: [{ type: 'tool-result', toolCallId: 'old-python', payload: 'OLD-PYTHON-RESULT' }],
    },
  });
  const messages = invoke.mock.calls[0]![0];
  expect(messages[2].content).toContain('[quotation-fresh-lookup:run-1:4]');
  expect(JSON.stringify(messages)).not.toContain('old-lookup');
  expect(JSON.stringify(messages)).not.toContain('OLD-PYTHON-RESULT');
});

it('repairs a length-finished child even when the candidate validates', async () => {
  invoke
    .mockResolvedValueOnce(childToolCall())
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'length' } }))
    .mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue(lookupResult);
  const validator = jest.fn(async (markdown: string) => {
    validateQuotationChildResult({ chunk: childOrder, response: markdown, lookupEvidence: [lookupEvidence()] });
  });

  await expect(invokeQuotationModel({ ...childInput(), lookup, validateChildOutput: validator })).resolves.toEqual(
    expect.objectContaining({ markdown: validChild }),
  );
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(validator).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledTimes(3);
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

it.each([true, false])('balances an interrupted tool turn on Retry (persisted result: %s)', async (persisted) => {
  const original = childInput();
  const messages = mapChatMessagesToStoredMessages([
    new SystemMessage(original.prompt), new HumanMessage(original.input), childToolCall(),
  ]);
  const lookups = persisted ? [{ id: 'lookup-1', arguments: {}, result: lookupResult }] : [];
  if (!persisted) invoke.mockResolvedValueOnce(childToolCall('lookup-2'));
  invoke.mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn().mockResolvedValue(lookupResult);
  const onChildMessages = jest.fn();
  await invokeQuotationModel({
    ...original, lookup, onChildMessages,
    continuation: { messages, previousOutputs: [], lookups, pythonEvidence: [] },
  });
  const resumed = invoke.mock.calls[0]![0];
  expect(resumed[1].content).toBe(original.input);
  expect(resumed[2].tool_calls[0].id).toBe('lookup-1');
  expect(resumed[3].getType()).toBe('tool');
  expect(resumed[3].tool_call_id).toBe('lookup-1');
  if (persisted) {
    expect(resumed[3].content).toContain('search_price_candidates');
    expect(lookup).not.toHaveBeenCalled();
  } else {
    expect(resumed[3].status).toBe('error');
    expect(resumed[3].content).toContain('No result is available');
    expect(lookup).toHaveBeenCalledTimes(1);
  }
  expect(onChildMessages.mock.calls.at(-1)![0].at(-1).data.content).toBe(validChild);
});

it('rehydrates legacy output and Python evidence with the original chunk and persisted lookups', async () => {
  const pythonEvidence: QuotationPythonEvidence[] = [{ type: 'tool-result', toolCallId: 'py-1', payload: '{"output":"42"}' }];
  invoke.mockResolvedValueOnce(new AIMessageChunk({ content: validChild, response_metadata: { finish_reason: 'stop' } }));
  const lookup = jest.fn();
  await invokeQuotationModel({
    ...childInput(), lookup,
    continuation: {
      previousOutputs: [malformedChild],
      lookups: [{ id: 'lookup-1', arguments: { query: 'original lookup' }, result: lookupResult }],
      pythonEvidence,
    },
  });
  const resumed = invoke.mock.calls[0]![0];
  expect(resumed[1].content).toBe(childInput().input);
  expect(resumed[2].tool_calls[0].args).toEqual({ query: 'original lookup' });
  expect(resumed[3].tool_call_id).toBe('lookup-1');
  expect(resumed[4].content).toBe(malformedChild);
  expect(resumed[5].content).toContain(JSON.stringify(pythonEvidence));
  expect(lookup).not.toHaveBeenCalled();
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

it.each(['different input', 'orphan result', 'unmatched result'])('rejects corrupt Retry history: %s', async (scenario) => {
  const original = childInput();
  const messages: BaseMessage[] = [new SystemMessage(original.prompt), new HumanMessage(
    scenario === 'different input' ? 'another chunk' : original.input,
  )];
  if (scenario === 'unmatched result') messages.push(childToolCall());
  if (scenario !== 'different input') messages.push(new ToolMessage({ content: 'result', tool_call_id: 'unrelated' }));
  await expect(invokeQuotationModel({
    ...original,
    continuation: { messages: mapChatMessagesToStoredMessages(messages), previousOutputs: [], lookups: [], pythonEvidence: [] },
  })).rejects.toThrow('Saved quotation');
  expect(invoke).not.toHaveBeenCalled();
});
