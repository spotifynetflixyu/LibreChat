import { isJSONArray, isJSONObject, isJSONValue } from '@ai-sdk/provider';
import type { JSONObject, JSONArray, JSONValue } from '@ai-sdk/provider';
import type {
  OpenAIOAuthCompactionProbeOptions,
  OpenAIOAuthProbeClient,
  OpenAIOAuthProbeMethod,
  OpenAIOAuthProbePath,
} from './types';
import { OpenAIOAuthCompactionProbeError } from './probe';

const PROBE_VALUE = '42';
const PROBE_CONFIRMATION = `PROBE_OK_${PROBE_VALUE}`;
const PROBE_INSTRUCTIONS =
  'This is a disposable synthetic compaction protocol test. Preserve the diagnostic value.';
const PROBE_TOOL_NAME = 'probe_lookup';
const PROBE_TAIL_TEXT =
  'Reply with PROBE_OK_ followed by the value returned by the earlier diagnostic tool; do not call any tools.';

export type OpenAIOAuthCompactionProbeV2Stage =
  | 'eligibility'
  | 'catalog'
  | 'compact'
  | 'replay'
  | 'repeated_compaction'
  | 'generation'
  | 'cancellation';

export type OpenAIOAuthCompactionProbeV2Code =
  | 'provider_ineligible'
  | 'model_not_listed'
  | 'http_400'
  | 'http_401'
  | 'http_403'
  | 'http_404'
  | 'http_429'
  | 'malformed_json'
  | 'malformed_sse'
  | 'missing_opaque'
  | 'duplicate_opaque'
  | 'wrong_role'
  | 'wrong_confirmation'
  | 'invalid_usage'
  | 'incomplete_stream'
  | 'aborted'
  | 'response_too_large'
  | 'unexpected_status'
  | 'protocol_passed';

export interface OpenAIOAuthCompactionProbeV2Check {
  readonly path: OpenAIOAuthProbePath;
  readonly method: OpenAIOAuthProbeMethod;
  readonly status: number | null;
  readonly errorCode: OpenAIOAuthCompactionProbeV2Code | null;
  readonly ok: boolean;
}

export interface OpenAIOAuthCompactionProbeV2Result {
  readonly model: string;
  readonly modelListed: boolean;
  readonly protocolCompatible: boolean;
  readonly code: OpenAIOAuthCompactionProbeV2Code;
  readonly stage: OpenAIOAuthCompactionProbeV2Stage;
  readonly checks: readonly OpenAIOAuthCompactionProbeV2Check[];
  readonly compactAccepted: boolean;
  readonly replayCompleted: boolean;
  readonly cancellationObserved: boolean;
  readonly repeatedCompactionCompleted: boolean;
  readonly usageObserved: boolean;
}

interface MutableResult {
  model: string;
  modelListed: boolean;
  protocolCompatible: boolean;
  code: OpenAIOAuthCompactionProbeV2Code;
  stage: OpenAIOAuthCompactionProbeV2Stage;
  checks: OpenAIOAuthCompactionProbeV2Check[];
  compactAccepted: boolean;
  replayCompleted: boolean;
  cancellationObserved: boolean;
  repeatedCompactionCompleted: boolean;
  usageObserved: boolean;
}

type BodyRead =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'too_large' };

type ParsedBody =
  | { readonly kind: 'ok'; readonly value: JSONValue }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'too_large' };

type RequestResult =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'aborted' };

interface SseEvent {
  readonly data: string;
}

type StreamFailureCode =
  | 'malformed_json'
  | 'malformed_sse'
  | 'missing_opaque'
  | 'duplicate_opaque'
  | 'wrong_role'
  | 'wrong_confirmation'
  | 'invalid_usage'
  | 'incomplete_stream'
  | 'aborted'
  | 'response_too_large';

type StreamResult =
  | {
      readonly kind: 'completed';
      readonly compactItem: JSONObject | null;
      readonly assistantItem: JSONObject | null;
      readonly usageObserved: boolean;
    }
  | { readonly kind: 'failed'; readonly code: StreamFailureCode };

type CancellationFrame =
  | { readonly kind: 'observed' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'too_large' }
  | { readonly kind: 'incomplete' };

const PROBE_TOOLS: JSONArray = [
  {
    type: 'function',
    name: PROBE_TOOL_NAME,
    description: 'Return the diagnostic value.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
];

const PROBE_BASE_INPUT: JSONArray = [
  {
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: 'Remember the synthetic fixture value returned by the diagnostic tool.',
      },
    ],
  },
  {
    type: 'function_call',
    call_id: 'probe_call_42',
    name: PROBE_TOOL_NAME,
    arguments: '{}',
    status: 'completed',
  },
  {
    type: 'function_call_output',
    call_id: 'probe_call_42',
    output: PROBE_VALUE,
  },
  {
    role: 'assistant',
    content: [{ type: 'output_text', text: 'The diagnostic value is recorded.' }],
  },
];

const PROBE_TAIL: JSONObject = {
  role: 'user',
  content: [
    {
      type: 'input_text',
      text: PROBE_TAIL_TEXT,
    },
  ],
};

const COMPACTION_TRIGGER: JSONObject = { type: 'compaction_trigger' };

function createResult(model: string): MutableResult {
  return {
    model,
    modelListed: false,
    protocolCompatible: false,
    code: 'provider_ineligible',
    stage: 'eligibility',
    checks: [],
    compactAccepted: false,
    replayCompleted: false,
    cancellationObserved: false,
    repeatedCompactionCompleted: false,
    usageObserved: false,
  };
}

function finish(
  state: MutableResult,
  code: OpenAIOAuthCompactionProbeV2Code,
  stage: OpenAIOAuthCompactionProbeV2Stage,
): OpenAIOAuthCompactionProbeV2Result {
  state.code = code;
  state.stage = stage;
  return { ...state, checks: state.checks.slice() };
}

function addCheck(
  state: MutableResult,
  path: OpenAIOAuthProbePath,
  method: OpenAIOAuthProbeMethod,
  status: number | null,
  errorCode: OpenAIOAuthCompactionProbeV2Code | null,
  ok: boolean,
): void {
  state.checks.push({ path, method, status, errorCode, ok });
}

function isEligible(client: OpenAIOAuthProbeClient): boolean {
  return (
    client.provider === 'openai_oauth_responses' &&
    client.authKind === 'oauth' &&
    typeof client.request === 'function'
  );
}

function expectedHttpCode(status: number): OpenAIOAuthCompactionProbeV2Code {
  switch (status) {
    case 400:
      return 'http_400';
    case 401:
      return 'http_401';
    case 403:
      return 'http_403';
    case 404:
      return 'http_404';
    case 429:
      return 'http_429';
    default:
      return 'unexpected_status';
  }
}

function isExpectedHttpFailure(status: number): boolean {
  return status >= 400 && status < 500;
}

function isServerFailure(status: number): boolean {
  return status >= 500;
}

function encodeBody(body: JSONObject): string {
  const value = JSON.stringify(body);
  if (value === undefined) {
    throw new OpenAIOAuthCompactionProbeError('invalid_options', 'eligibility');
  }
  return value;
}

async function request(
  client: OpenAIOAuthProbeClient,
  path: OpenAIOAuthProbePath,
  method: OpenAIOAuthProbeMethod,
  signal: AbortSignal,
  body?: JSONObject,
): Promise<RequestResult> {
  if (signal.aborted) {
    return { kind: 'aborted' };
  }
  const init: RequestInit = { method, signal };
  if (body !== undefined) {
    init.body = encodeBody(body);
    init.headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  }
  try {
    return { kind: 'response', response: await client.request(path, init) };
  } catch {
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    throw new OpenAIOAuthCompactionProbeError(
      'provider_unavailable',
      path === '/models' ? 'catalog' : 'generation',
    );
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Reader cleanup must not replace a safe probe result.
  } finally {
    reader.releaseLock();
  }
}

async function discardBody(response: Response): Promise<void> {
  if (response.body !== null) {
    await cancelReader(response.body.getReader());
  }
}

async function readBody(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<BodyRead> {
  if (signal.aborted) {
    return { kind: 'aborted' };
  }
  if (response.body === null) {
    return { kind: 'ok', text: '' };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  const cancelOnAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) {
        await cancelReader(reader);
        return { kind: 'aborted' };
      }
      const next = await reader.read();
      if (signal.aborted) {
        await cancelReader(reader);
        return { kind: 'aborted' };
      }
      if (next.done) {
        parts.push(decoder.decode());
        return { kind: 'ok', text: parts.join('') };
      }
      bytes += next.value.byteLength;
      if (bytes > maxResponseBytes) {
        await cancelReader(reader);
        return { kind: 'too_large' };
      }
      parts.push(decoder.decode(next.value, { stream: true }));
    }
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }
}

function parseJson(text: string): JSONValue | null {
  if (text.length === 0) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return isJSONValue(value) ? value : null;
  } catch {
    return null;
  }
}

async function parseBody(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<ParsedBody> {
  const body = await readBody(response, signal, maxResponseBytes);
  if (body.kind === 'aborted' || body.kind === 'too_large') {
    return body;
  }
  const value = parseJson(body.text);
  return value === null ? { kind: 'malformed' } : { kind: 'ok', value };
}

function stringProperty(value: JSONObject, key: string): string | undefined {
  const property = value[key];
  return typeof property === 'string' ? property : undefined;
}

function numberProperty(value: JSONObject, key: string): number | undefined {
  const property = value[key];
  return typeof property === 'number' ? property : undefined;
}

function objectProperty(value: JSONObject, key: string): JSONObject | undefined {
  const property = value[key];
  return isJSONObject(property) ? property : undefined;
}

function arrayProperty(value: JSONObject, key: string): JSONArray | undefined {
  const property = value[key];
  return isJSONArray(property) ? property : undefined;
}

function nextSseLine(buffer: string): { readonly line: string; readonly rest: string } | null {
  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index];
    if (character !== '\n' && character !== '\r') {
      continue;
    }
    if (character === '\r' && index + 1 === buffer.length) {
      return null;
    }
    const end = character === '\r' && buffer[index + 1] === '\n' ? index + 2 : index + 1;
    return { line: buffer.slice(0, index), rest: buffer.slice(end) };
  }
  return null;
}

function consumeSseLine(
  line: string,
  dataLines: string[],
): { readonly event: SseEvent | null; readonly dataLines: string[] } {
  if (line.length === 0) {
    return {
      event: dataLines.length === 0 ? null : { data: dataLines.join('\n') },
      dataLines: [],
    };
  }
  if (line.startsWith('data:')) {
    const data = line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5);
    return { event: null, dataLines: [...dataLines, data] };
  }
  return { event: null, dataLines };
}

function isTerminalEvent(value: JSONObject): boolean {
  const type = stringProperty(value, 'type');
  if (
    type === 'response.completed' ||
    type === 'response.failed' ||
    type === 'response.error' ||
    type === 'response.incomplete' ||
    type === 'error'
  ) {
    return true;
  }
  const response = objectProperty(value, 'response');
  const status = response === undefined ? undefined : stringProperty(response, 'status');
  return (
    status === 'completed' || status === 'failed' || status === 'error' || status === 'incomplete'
  );
}

function validUsage(response: JSONObject): boolean {
  const usage = objectProperty(response, 'usage');
  if (usage === undefined) {
    return false;
  }
  const input = numberProperty(usage, 'input_tokens');
  const output = numberProperty(usage, 'output_tokens');
  const total = numberProperty(usage, 'total_tokens');
  const valid = [input, output, total].every(
    (value) =>
      value !== undefined && Number.isFinite(value) && Number.isInteger(value) && value >= 0,
  );
  return valid && input !== undefined && output !== undefined && total === input + output;
}

function outputText(item: JSONObject): string {
  const content = arrayProperty(item, 'content');
  if (content === undefined) {
    return '';
  }
  return content
    .filter(isJSONObject)
    .filter((part) => stringProperty(part, 'type') === 'output_text')
    .map((part) => stringProperty(part, 'text') ?? '')
    .join('');
}

function hasAssistantConfirmation(item: JSONObject | null): boolean {
  return (
    item !== null &&
    stringProperty(item, 'type') === 'message' &&
    stringProperty(item, 'role') === 'assistant' &&
    outputText(item).trim() === PROBE_CONFIRMATION
  );
}

function isValidCompactionItem(item: JSONObject): boolean {
  return (
    stringProperty(item, 'type') === 'compaction' &&
    (stringProperty(item, 'encrypted_content')?.length ?? 0) > 0
  );
}

function isValidCancellationEvent(value: JSONObject): boolean {
  const type = stringProperty(value, 'type');
  const response = objectProperty(value, 'response');
  return (
    (type === 'response.created' || type === 'response.in_progress') &&
    response !== undefined &&
    stringProperty(response, 'status') === 'in_progress'
  );
}

function eventType(value: JSONValue): string | undefined {
  return isJSONObject(value) ? stringProperty(value, 'type') : undefined;
}

async function collectStream(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number,
  mode: 'compaction' | 'generation',
): Promise<StreamResult> {
  if (signal.aborted) {
    return { kind: 'failed', code: 'aborted' };
  }
  if (response.body === null) {
    return { kind: 'failed', code: 'incomplete_stream' };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const dataLines: string[] = [];
  let pendingDataLines = dataLines;
  let buffer = '';
  let bytes = 0;
  let compactItem: JSONObject | null = null;
  let compactCount = 0;
  let assistantItem: JSONObject | null = null;
  let invalidRole = false;
  let usageObserved = false;
  const cancelOnAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) {
        await cancelReader(reader);
        return { kind: 'failed', code: 'aborted' };
      }
      const chunk = await reader.read();
      if (signal.aborted) {
        await cancelReader(reader);
        return { kind: 'failed', code: 'aborted' };
      }
      if (chunk.done) {
        await cancelReader(reader);
        return { kind: 'failed', code: 'incomplete_stream' };
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxResponseBytes) {
        await cancelReader(reader);
        return { kind: 'failed', code: 'response_too_large' };
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let next = nextSseLine(buffer);
      while (next !== null) {
        buffer = next.rest;
        const consumed = consumeSseLine(next.line, pendingDataLines);
        pendingDataLines = consumed.dataLines;
        if (consumed.event !== null) {
          if (consumed.event.data === '[DONE]') {
            await cancelReader(reader);
            return { kind: 'failed', code: 'incomplete_stream' };
          }
          const value = parseJson(consumed.event.data);
          if (value === null || !isJSONObject(value)) {
            await cancelReader(reader);
            return { kind: 'failed', code: 'malformed_json' };
          }
          const type = eventType(value);
          if (
            type === 'response.failed' ||
            type === 'response.error' ||
            type === 'response.incomplete' ||
            type === 'error'
          ) {
            await cancelReader(reader);
            return { kind: 'failed', code: 'incomplete_stream' };
          }
          if (type === 'response.output_item.done') {
            const item = objectProperty(value, 'item');
            if (item === undefined) {
              await cancelReader(reader);
              return { kind: 'failed', code: 'malformed_sse' };
            }
            if (stringProperty(item, 'type') === 'compaction') {
              compactCount += 1;
              if (!isValidCompactionItem(item)) {
                await cancelReader(reader);
                return { kind: 'failed', code: 'missing_opaque' };
              }
              if (compactCount > 1) {
                await cancelReader(reader);
                return { kind: 'failed', code: 'duplicate_opaque' };
              }
              compactItem = item;
            } else if (stringProperty(item, 'type') === 'message') {
              if (stringProperty(item, 'role') !== 'assistant') {
                invalidRole = true;
              } else {
                assistantItem = item;
              }
            }
          } else if (type === 'response.output_text.delta') {
            const delta = stringProperty(value, 'delta');
            if (delta === undefined) {
              await cancelReader(reader);
              return { kind: 'failed', code: 'malformed_sse' };
            }
          } else if (type === 'response.completed') {
            const completedResponse = objectProperty(value, 'response');
            if (
              completedResponse === undefined ||
              stringProperty(completedResponse, 'status') !== 'completed'
            ) {
              await cancelReader(reader);
              return { kind: 'failed', code: 'incomplete_stream' };
            }
            if (!validUsage(completedResponse)) {
              await cancelReader(reader);
              return { kind: 'failed', code: 'invalid_usage' };
            }
            usageObserved = true;
            if (mode === 'compaction') {
              if (compactCount === 0 || compactItem === null) {
                await cancelReader(reader);
                return { kind: 'failed', code: 'missing_opaque' };
              }
              await cancelReader(reader);
              return { kind: 'completed', compactItem, assistantItem, usageObserved };
            }
            if (invalidRole) {
              await cancelReader(reader);
              return { kind: 'failed', code: 'wrong_role' };
            }
            if (!hasAssistantConfirmation(assistantItem)) {
              await cancelReader(reader);
              return { kind: 'failed', code: 'wrong_confirmation' };
            }
            await cancelReader(reader);
            return { kind: 'completed', compactItem: null, assistantItem, usageObserved };
          } else if (isTerminalEvent(value)) {
            await cancelReader(reader);
            return { kind: 'failed', code: 'incomplete_stream' };
          }
        }
        next = nextSseLine(buffer);
      }
    }
  } catch {
    await cancelReader(reader);
    if (signal.aborted) {
      return { kind: 'failed', code: 'aborted' };
    }
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'generation');
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }
}

async function collectCancellation(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<CancellationFrame> {
  if (signal.aborted) {
    return { kind: 'aborted' };
  }
  if (response.body === null) {
    return { kind: 'incomplete' };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let bytes = 0;
  let sawValid = false;
  const cancelOnAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) {
        await cancelReader(reader);
        return { kind: 'aborted' };
      }
      const chunk = await reader.read();
      if (signal.aborted) {
        await cancelReader(reader);
        return { kind: 'aborted' };
      }
      if (chunk.done) {
        await cancelReader(reader);
        return { kind: 'incomplete' };
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxResponseBytes) {
        await cancelReader(reader);
        return { kind: 'too_large' };
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let next = nextSseLine(buffer);
      while (next !== null) {
        buffer = next.rest;
        const consumed = consumeSseLine(next.line, dataLines);
        dataLines = consumed.dataLines;
        if (consumed.event !== null) {
          if (consumed.event.data === '[DONE]') {
            await cancelReader(reader);
            return { kind: 'invalid' };
          }
          const value = parseJson(consumed.event.data);
          if (value === null || !isJSONObject(value) || isTerminalEvent(value)) {
            await cancelReader(reader);
            return { kind: 'invalid' };
          }
          if (!isValidCancellationEvent(value)) {
            await cancelReader(reader);
            return { kind: 'invalid' };
          }
          sawValid = true;
        }
        next = nextSseLine(buffer);
      }
      if (sawValid && buffer.length === 0 && dataLines.length === 0) {
        await cancelReader(reader);
        return { kind: 'observed' };
      }
    }
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }
}

function catalogHasModel(value: JSONValue, model: string): boolean | null {
  if (!isJSONObject(value)) {
    return null;
  }
  const data = arrayProperty(value, 'data');
  if (data === undefined) {
    return null;
  }
  let listed = false;
  for (const item of data) {
    if (!isJSONObject(item) || stringProperty(item, 'id') === undefined) {
      return null;
    }
    listed = listed || stringProperty(item, 'id') === model;
  }
  return listed;
}

function compactionBody(model: string, input: JSONArray): JSONObject {
  return {
    model,
    instructions: PROBE_INSTRUCTIONS,
    tools: PROBE_TOOLS,
    input,
    parallel_tool_calls: true,
    reasoning: { effort: 'high' },
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
  };
}

function generationBody(model: string, input: JSONArray): JSONObject {
  return {
    model,
    instructions: PROBE_INSTRUCTIONS,
    input,
    reasoning: { effort: 'high' },
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
  };
}

function initialCompactionInput(): JSONArray {
  return [...PROBE_BASE_INPUT, COMPACTION_TRIGGER];
}

function originalUserInput(input: JSONArray): JSONArray {
  return input.filter((item) => isJSONObject(item) && stringProperty(item, 'role') === 'user');
}

function replayInput(compactItem: JSONObject): JSONArray {
  return [...originalUserInput(PROBE_BASE_INPUT), compactItem, PROBE_TAIL];
}

function repeatedCompactionInput(input: JSONArray): JSONArray {
  return [...input, COMPACTION_TRIGGER];
}

function secondReplayInput(input: JSONArray, compactItem: JSONObject): JSONArray {
  return [...originalUserInput(input), compactItem, PROBE_TAIL];
}

function bodyFailureCode(parsed: ParsedBody): OpenAIOAuthCompactionProbeV2Code {
  if (parsed.kind === 'aborted') {
    return 'aborted';
  }
  if (parsed.kind === 'too_large') {
    return 'response_too_large';
  }
  return 'malformed_json';
}

function streamFailureCode(code: StreamFailureCode): OpenAIOAuthCompactionProbeV2Code {
  return code;
}

export async function probeOpenAIOAuthCompactionV2(
  options: OpenAIOAuthCompactionProbeOptions,
): Promise<OpenAIOAuthCompactionProbeV2Result> {
  const state = createResult(options.model);
  if (!Number.isInteger(options.maxResponseBytes) || options.maxResponseBytes <= 0) {
    throw new OpenAIOAuthCompactionProbeError('invalid_options', 'eligibility');
  }
  if (!isEligible(options.client)) {
    return finish(state, 'provider_ineligible', 'eligibility');
  }
  if (options.signal.aborted) {
    return finish(state, 'aborted', 'eligibility');
  }

  const catalogResult = await request(options.client, '/models', 'GET', options.signal);
  if (catalogResult.kind === 'aborted') {
    return finish(state, 'aborted', 'catalog');
  }
  if (isServerFailure(catalogResult.response.status)) {
    await discardBody(catalogResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'catalog');
  }
  if (isExpectedHttpFailure(catalogResult.response.status) || !catalogResult.response.ok) {
    const code = expectedHttpCode(catalogResult.response.status);
    await discardBody(catalogResult.response);
    addCheck(state, '/models', 'GET', catalogResult.response.status, code, false);
    return finish(state, code, 'catalog');
  }
  const catalog = await parseBody(catalogResult.response, options.signal, options.maxResponseBytes);
  if (catalog.kind !== 'ok') {
    const code = bodyFailureCode(catalog);
    addCheck(state, '/models', 'GET', catalogResult.response.status, code, false);
    return finish(state, code, 'catalog');
  }
  const listed = catalogHasModel(catalog.value, options.model);
  if (listed === null) {
    addCheck(state, '/models', 'GET', catalogResult.response.status, 'malformed_json', false);
    return finish(state, 'malformed_json', 'catalog');
  }
  state.modelListed = listed;
  if (!listed) {
    addCheck(state, '/models', 'GET', catalogResult.response.status, 'model_not_listed', false);
    return finish(state, 'model_not_listed', 'catalog');
  }
  addCheck(state, '/models', 'GET', catalogResult.response.status, null, true);

  const compactResult = await request(
    options.client,
    '/responses',
    'POST',
    options.signal,
    compactionBody(options.model, initialCompactionInput()),
  );
  if (compactResult.kind === 'aborted') {
    return finish(state, 'aborted', 'compact');
  }
  if (isServerFailure(compactResult.response.status)) {
    await discardBody(compactResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'generation');
  }
  if (isExpectedHttpFailure(compactResult.response.status) || !compactResult.response.ok) {
    const code = expectedHttpCode(compactResult.response.status);
    await discardBody(compactResult.response);
    addCheck(state, '/responses', 'POST', compactResult.response.status, code, false);
    return finish(state, code, 'compact');
  }
  const compactStream = await collectStream(
    compactResult.response,
    options.signal,
    options.maxResponseBytes,
    'compaction',
  );
  if (compactStream.kind === 'failed') {
    const code = streamFailureCode(compactStream.code);
    addCheck(state, '/responses', 'POST', compactResult.response.status, code, false);
    return finish(state, code, 'compact');
  }
  state.compactAccepted = true;
  state.usageObserved = compactStream.usageObserved;
  addCheck(state, '/responses', 'POST', compactResult.response.status, null, true);
  const compactItem = compactStream.compactItem;
  if (compactItem === null) {
    return finish(state, 'missing_opaque', 'compact');
  }

  const firstReplayInput = replayInput(compactItem);
  const firstGenerationResult = await request(
    options.client,
    '/responses',
    'POST',
    options.signal,
    generationBody(options.model, firstReplayInput),
  );
  if (firstGenerationResult.kind === 'aborted') {
    return finish(state, 'aborted', 'replay');
  }
  if (isServerFailure(firstGenerationResult.response.status)) {
    await discardBody(firstGenerationResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'generation');
  }
  if (
    isExpectedHttpFailure(firstGenerationResult.response.status) ||
    !firstGenerationResult.response.ok
  ) {
    const code = expectedHttpCode(firstGenerationResult.response.status);
    await discardBody(firstGenerationResult.response);
    addCheck(state, '/responses', 'POST', firstGenerationResult.response.status, code, false);
    return finish(state, code, 'replay');
  }
  const firstGeneration = await collectStream(
    firstGenerationResult.response,
    options.signal,
    options.maxResponseBytes,
    'generation',
  );
  if (firstGeneration.kind === 'failed') {
    const code = streamFailureCode(firstGeneration.code);
    addCheck(state, '/responses', 'POST', firstGenerationResult.response.status, code, false);
    return finish(state, code, 'replay');
  }
  state.replayCompleted = true;
  state.usageObserved = state.usageObserved && firstGeneration.usageObserved;
  addCheck(state, '/responses', 'POST', firstGenerationResult.response.status, null, true);

  const secondCompactInput = repeatedCompactionInput(
    firstReplayInput.concat(
      firstGeneration.assistantItem === null ? [] : [firstGeneration.assistantItem],
    ),
  );
  const secondCompactResult = await request(
    options.client,
    '/responses',
    'POST',
    options.signal,
    compactionBody(options.model, secondCompactInput),
  );
  if (secondCompactResult.kind === 'aborted') {
    return finish(state, 'aborted', 'repeated_compaction');
  }
  if (isServerFailure(secondCompactResult.response.status)) {
    await discardBody(secondCompactResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'generation');
  }
  if (
    isExpectedHttpFailure(secondCompactResult.response.status) ||
    !secondCompactResult.response.ok
  ) {
    const code = expectedHttpCode(secondCompactResult.response.status);
    await discardBody(secondCompactResult.response);
    addCheck(state, '/responses', 'POST', secondCompactResult.response.status, code, false);
    return finish(state, code, 'repeated_compaction');
  }
  const secondCompact = await collectStream(
    secondCompactResult.response,
    options.signal,
    options.maxResponseBytes,
    'compaction',
  );
  if (secondCompact.kind === 'failed') {
    const code = streamFailureCode(secondCompact.code);
    addCheck(state, '/responses', 'POST', secondCompactResult.response.status, code, false);
    return finish(state, code, 'repeated_compaction');
  }
  state.repeatedCompactionCompleted = true;
  state.usageObserved = state.usageObserved && secondCompact.usageObserved;
  addCheck(state, '/responses', 'POST', secondCompactResult.response.status, null, true);
  if (secondCompact.compactItem === null) {
    return finish(state, 'missing_opaque', 'repeated_compaction');
  }

  const secondReplay = secondReplayInput(firstReplayInput, secondCompact.compactItem);
  const secondGenerationResult = await request(
    options.client,
    '/responses',
    'POST',
    options.signal,
    generationBody(options.model, secondReplay),
  );
  if (secondGenerationResult.kind === 'aborted') {
    return finish(state, 'aborted', 'generation');
  }
  if (isServerFailure(secondGenerationResult.response.status)) {
    await discardBody(secondGenerationResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'generation');
  }
  if (
    isExpectedHttpFailure(secondGenerationResult.response.status) ||
    !secondGenerationResult.response.ok
  ) {
    const code = expectedHttpCode(secondGenerationResult.response.status);
    await discardBody(secondGenerationResult.response);
    addCheck(state, '/responses', 'POST', secondGenerationResult.response.status, code, false);
    return finish(state, code, 'generation');
  }
  const secondGeneration = await collectStream(
    secondGenerationResult.response,
    options.signal,
    options.maxResponseBytes,
    'generation',
  );
  if (secondGeneration.kind === 'failed') {
    const code = streamFailureCode(secondGeneration.code);
    addCheck(state, '/responses', 'POST', secondGenerationResult.response.status, code, false);
    return finish(state, code, 'generation');
  }
  state.usageObserved = state.usageObserved && secondGeneration.usageObserved;
  addCheck(state, '/responses', 'POST', secondGenerationResult.response.status, null, true);

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  options.signal.addEventListener('abort', forwardAbort, { once: true });
  if (options.signal.aborted) {
    controller.abort();
  }
  try {
    const cancellationResult = await request(
      options.client,
      '/responses',
      'POST',
      controller.signal,
      generationBody(options.model, secondReplay),
    );
    if (cancellationResult.kind === 'aborted') {
      return finish(state, 'aborted', 'cancellation');
    }
    if (isServerFailure(cancellationResult.response.status)) {
      await discardBody(cancellationResult.response);
      throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'generation');
    }
    if (
      isExpectedHttpFailure(cancellationResult.response.status) ||
      !cancellationResult.response.ok
    ) {
      const code = expectedHttpCode(cancellationResult.response.status);
      await discardBody(cancellationResult.response);
      addCheck(state, '/responses', 'POST', cancellationResult.response.status, code, false);
      return finish(state, code, 'cancellation');
    }
    const cancellation = await collectCancellation(
      cancellationResult.response,
      controller.signal,
      options.maxResponseBytes,
    );
    if (cancellation.kind === 'aborted') {
      return finish(state, 'aborted', 'cancellation');
    }
    if (cancellation.kind !== 'observed') {
      const code = cancellation.kind === 'too_large' ? 'response_too_large' : 'incomplete_stream';
      addCheck(state, '/responses', 'POST', cancellationResult.response.status, code, false);
      return finish(state, code, 'cancellation');
    }
    state.cancellationObserved = true;
    addCheck(state, '/responses', 'POST', cancellationResult.response.status, null, true);
    state.protocolCompatible =
      state.compactAccepted &&
      state.replayCompleted &&
      state.repeatedCompactionCompleted &&
      state.cancellationObserved &&
      state.usageObserved;
    return finish(
      state,
      state.protocolCompatible ? 'protocol_passed' : 'incomplete_stream',
      'cancellation',
    );
  } finally {
    options.signal.removeEventListener('abort', forwardAbort);
    controller.abort();
  }
}
