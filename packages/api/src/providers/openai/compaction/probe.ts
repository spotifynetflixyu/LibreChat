import { isJSONArray, isJSONObject, isJSONValue } from '@ai-sdk/provider';
import type { JSONObject, JSONArray, JSONValue } from '@ai-sdk/provider';
import type {
  OpenAIOAuthCompactionProbeCheck,
  OpenAIOAuthCompactionProbeCode,
  OpenAIOAuthCompactionProbeOperationalCode,
  OpenAIOAuthCompactionProbeOptions,
  OpenAIOAuthCompactionProbeResult,
  OpenAIOAuthCompactionProbeStage,
  OpenAIOAuthProbeClient,
  OpenAIOAuthProbeMethod,
  OpenAIOAuthProbePath,
} from './types';

const PROBE_VALUE = '42';
const PROBE_CONFIRMATION = `PROBE_OK_${PROBE_VALUE}`;
const PROBE_INSTRUCTIONS = 'You are running a bounded OpenAI OAuth compaction diagnostic.';
const PROBE_TOOL_NAME = 'probe_lookup';

const PROBE_TOOLS: JSONArray = [
  {
    type: 'function',
    name: PROBE_TOOL_NAME,
    description: 'Return the fixed diagnostic value.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
  },
];

const PROBE_INPUT: JSONArray = [
  {
    role: 'user',
    content: [{ type: 'input_text', text: 'Begin the bounded compaction diagnostic.' }],
  },
  {
    role: 'assistant',
    content: [{ type: 'output_text', text: 'I will call the diagnostic function.' }],
  },
  {
    type: 'function_call',
    id: 'probe_function_call_42',
    call_id: 'probe_function_call_42',
    name: PROBE_TOOL_NAME,
    arguments: '{"value":"42"}',
    status: 'completed',
  },
  {
    type: 'function_call_output',
    call_id: 'probe_function_call_42',
    output: PROBE_VALUE,
  },
];

const PROBE_TAIL: JSONObject = {
  role: 'user',
  content: [
    {
      type: 'input_text',
      text: 'Reply with PROBE_OK_ followed by the value returned by the earlier diagnostic tool; do not call any tools.',
    },
  ],
};

const SAFE_ERROR_MESSAGE = 'OpenAI OAuth compaction probe failed';

export class OpenAIOAuthCompactionProbeError extends Error {
  readonly code: OpenAIOAuthCompactionProbeOperationalCode;
  readonly stage: OpenAIOAuthCompactionProbeStage;

  constructor(
    code: OpenAIOAuthCompactionProbeOperationalCode,
    stage: OpenAIOAuthCompactionProbeStage,
  ) {
    super(SAFE_ERROR_MESSAGE);
    this.name = 'OpenAIOAuthCompactionProbeError';
    this.code = code;
    this.stage = stage;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface MutableProbeState {
  model: string;
  modelListed: boolean;
  protocolCompatible: boolean;
  code: OpenAIOAuthCompactionProbeCode;
  stage: OpenAIOAuthCompactionProbeStage;
  checks: OpenAIOAuthCompactionProbeCheck[];
  countAccepted: boolean;
  compactAccepted: boolean;
  replayCompleted: boolean;
  cancellationObserved: boolean;
}

type BodyReadResult =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'too_large' };

type RequestResult =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'aborted' };

type ParsedResponse =
  | { readonly kind: 'ok'; readonly value: JSONValue }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'too_large' };

type StreamResult =
  | { readonly kind: 'completed' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'too_large' };

function createState(model: string): MutableProbeState {
  return {
    model,
    modelListed: false,
    protocolCompatible: false,
    code: 'provider_ineligible',
    stage: 'eligibility',
    checks: [],
    countAccepted: false,
    compactAccepted: false,
    replayCompleted: false,
    cancellationObserved: false,
  };
}

function result(state: MutableProbeState): OpenAIOAuthCompactionProbeResult {
  return { ...state, checks: state.checks.slice() };
}

function finish(
  state: MutableProbeState,
  code: OpenAIOAuthCompactionProbeCode,
  stage: OpenAIOAuthCompactionProbeStage,
): OpenAIOAuthCompactionProbeResult {
  state.code = code;
  state.stage = stage;
  return result(state);
}

function isEligibleClient(client: OpenAIOAuthProbeClient): boolean {
  return (
    client.provider === 'openai_oauth_responses' &&
    client.authKind === 'oauth' &&
    typeof client.request === 'function'
  );
}

function expectedHttpCode(status: number): OpenAIOAuthCompactionProbeCode {
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

function addCheck(
  state: MutableProbeState,
  path: OpenAIOAuthProbePath,
  method: OpenAIOAuthProbeMethod,
  status: number | null,
  errorCode: OpenAIOAuthCompactionProbeCheck['errorCode'],
  ok: boolean,
): void {
  state.checks.push({ path, method, status, errorCode, ok });
}

function encodeBody(body: JSONObject): string {
  const encoded = JSON.stringify(body);
  if (encoded === undefined) {
    throw new OpenAIOAuthCompactionProbeError('invalid_options', 'eligibility');
  }
  return encoded;
}

async function request(
  client: OpenAIOAuthProbeClient,
  path: OpenAIOAuthProbePath,
  method: OpenAIOAuthProbeMethod,
  signal: AbortSignal,
  body?: JSONObject,
  stream = false,
): Promise<RequestResult> {
  if (signal.aborted) {
    return { kind: 'aborted' };
  }

  const init: RequestInit = { method, signal };
  if (body !== undefined) {
    init.body = encodeBody(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (stream) {
      headers.accept = 'text/event-stream';
    }
    init.headers = headers;
  }

  try {
    return { kind: 'response', response: await client.request(path, init) };
  } catch {
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', stageForPath(path));
  }
}

function stageForPath(path: OpenAIOAuthProbePath): OpenAIOAuthCompactionProbeStage {
  switch (path) {
    case '/models':
      return 'catalog';
    case '/responses/input_tokens':
      return 'count';
    case '/responses/compact':
      return 'compact';
    case '/responses':
      return 'generation';
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Reader cleanup must not replace the probe result.
  } finally {
    reader.releaseLock();
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  if (response.body === null) {
    return;
  }
  await cancelReader(response.body.getReader());
}

async function readBody(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<BodyReadResult> {
  if (signal.aborted) {
    return { kind: 'aborted' };
  }
  if (response.body === null) {
    return { kind: 'ok', text: '' };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  const cancelOnAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
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
        chunks.push(decoder.decode());
        return { kind: 'ok', text: chunks.join('') };
      }
      bytes += next.value.byteLength;
      if (bytes > maxResponseBytes) {
        await cancelReader(reader);
        return { kind: 'too_large' };
      }
      chunks.push(decoder.decode(next.value, { stream: true }));
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

async function parseJsonResponse(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<ParsedResponse> {
  const body = await readBody(response, signal, maxResponseBytes);
  if (body.kind === 'aborted') {
    return body;
  }
  if (body.kind === 'too_large') {
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

function isExpectedHttpFailure(status: number): boolean {
  return status >= 400 && status < 500;
}

function isServerFailure(status: number): boolean {
  return status >= 500;
}

function hasValidCount(value: JSONValue): boolean {
  if (!isJSONObject(value)) {
    return false;
  }
  const count = numberProperty(value, 'input_tokens');
  return count !== undefined && Number.isFinite(count) && Number.isInteger(count) && count > 0;
}

function hasOpaqueCompaction(value: JSONValue): value is JSONObject {
  if (!isJSONObject(value)) {
    return false;
  }
  const output = arrayProperty(value, 'output');
  if (output === undefined || output.length === 0) {
    return false;
  }
  return output.some(
    (item) =>
      isJSONObject(item) &&
      stringProperty(item, 'type') === 'compaction' &&
      (stringProperty(item, 'encrypted_content')?.length ?? 0) > 0,
  );
}

function hasAssistantConfirmation(output: JSONArray): boolean {
  return output.some((item) => {
    if (
      !isJSONObject(item) ||
      stringProperty(item, 'type') !== 'message' ||
      stringProperty(item, 'role') !== 'assistant'
    ) {
      return false;
    }
    const content = arrayProperty(item, 'content');
    return (
      content?.some(
        (part) =>
          isJSONObject(part) &&
          stringProperty(part, 'type') === 'output_text' &&
          (stringProperty(part, 'text')?.includes(PROBE_CONFIRMATION) ?? false),
      ) ?? false
    );
  });
}

function hasValidUsage(response: JSONObject): boolean {
  const usage = objectProperty(response, 'usage');
  if (usage === undefined) {
    return false;
  }
  const input = numberProperty(usage, 'input_tokens');
  const output = numberProperty(usage, 'output_tokens');
  const total = numberProperty(usage, 'total_tokens');
  const valid = [input, output, total].every(
    (count) =>
      count !== undefined && Number.isFinite(count) && Number.isInteger(count) && count >= 0,
  );
  return valid && input !== undefined && output !== undefined && total === input + output;
}

function isCompletedEvent(value: JSONObject): boolean {
  if (stringProperty(value, 'type') !== 'response.completed') {
    return false;
  }
  const response = objectProperty(value, 'response');
  if (response === undefined || stringProperty(response, 'status') !== 'completed') {
    return false;
  }
  const output = arrayProperty(response, 'output');
  return hasValidUsage(response) && output !== undefined && hasAssistantConfirmation(output);
}

function isFailedEvent(value: JSONObject): boolean {
  const type = stringProperty(value, 'type');
  if (
    type === 'response.failed' ||
    type === 'response.error' ||
    type === 'response.incomplete' ||
    type === 'error'
  ) {
    return true;
  }
  const response = objectProperty(value, 'response');
  const status = response === undefined ? undefined : stringProperty(response, 'status');
  return status === 'failed' || status === 'incomplete' || status === 'error';
}

interface SseEvent {
  readonly data: string;
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
    const lineEnd = character === '\r' && buffer[index + 1] === '\n' ? index + 2 : index + 1;
    return { line: buffer.slice(0, index), rest: buffer.slice(lineEnd) };
  }
  return null;
}

function parseSseEvent(dataLines: string[]): SseEvent | null {
  return dataLines.length === 0 ? null : { data: dataLines.join('\n') };
}

function consumeSseLine(
  line: string,
  dataLines: string[],
): { readonly event: SseEvent | null; readonly dataLines: string[] } {
  if (line.length === 0) {
    return { event: parseSseEvent(dataLines), dataLines: [] };
  }
  if (line.startsWith('data:')) {
    const data = line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5);
    return { event: null, dataLines: [...dataLines, data] };
  }
  return { event: null, dataLines };
}

function classifySseEvent(event: SseEvent): 'completed' | 'failed' | 'malformed' | 'continue' {
  if (event.data === '[DONE]') {
    return 'continue';
  }
  const value = parseJson(event.data);
  if (value === null || !isJSONObject(value)) {
    return 'malformed';
  }
  if (isCompletedEvent(value)) {
    return 'completed';
  }
  return isFailedEvent(value) ? 'failed' : 'continue';
}

function isTerminalSseEvent(event: SseEvent): boolean {
  if (event.data === '[DONE]') {
    return true;
  }
  const value = parseJson(event.data);
  if (value === null || !isJSONObject(value)) {
    return false;
  }
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
    status === 'completed' || status === 'failed' || status === 'incomplete' || status === 'error'
  );
}

function isValidCancellationEvent(event: SseEvent): boolean {
  const value = parseJson(event.data);
  if (value === null || !isJSONObject(value)) {
    return false;
  }
  const type = stringProperty(value, 'type');
  const response = objectProperty(value, 'response');
  return (
    (type === 'response.created' || type === 'response.in_progress') &&
    response !== undefined &&
    stringProperty(response, 'status') === 'in_progress'
  );
}

async function readSseCompletion(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<StreamResult> {
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
  const cancelOnAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) {
        await cancelReader(reader);
        return { kind: 'aborted' };
      }
      let next = nextSseLine(buffer);
      while (next !== null) {
        buffer = next.rest;
        const consumed = consumeSseLine(next.line, dataLines);
        dataLines = consumed.dataLines;
        if (consumed.event !== null) {
          const classification = classifySseEvent(consumed.event);
          if (classification === 'completed') {
            await cancelReader(reader);
            return { kind: 'completed' };
          }
          if (classification === 'failed') {
            await cancelReader(reader);
            return { kind: 'incomplete' };
          }
          if (classification === 'malformed') {
            await cancelReader(reader);
            return { kind: 'malformed' };
          }
        }
        next = nextSseLine(buffer);
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
    }
  } catch {
    await cancelReader(reader);
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'generation');
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }
}

type CancellationFrameResult =
  | { readonly kind: 'observed' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'too_large' }
  | { readonly kind: 'incomplete' };

async function readCancellationFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<CancellationFrameResult> {
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let bytes = 0;
  let sawValidEvent = false;
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
        if (isTerminalSseEvent(consumed.event) || !isValidCancellationEvent(consumed.event)) {
          await cancelReader(reader);
          return { kind: 'invalid' };
        }
        sawValidEvent = true;
      }
      next = nextSseLine(buffer);
    }
    if (sawValidEvent && buffer.length === 0 && dataLines.length === 0) {
      await cancelReader(reader);
      return { kind: 'observed' };
    }
  }
}

async function observeCancellation(
  client: OpenAIOAuthProbeClient,
  externalSignal: AbortSignal,
  model: string,
  compactOutput: JSONArray,
  maxResponseBytes: number,
): Promise<
  | { readonly kind: 'observed'; readonly status: number }
  | { readonly kind: 'aborted' }
  | {
      readonly kind: 'failed';
      readonly code: OpenAIOAuthCompactionProbeCode;
      readonly status: number;
    }
> {
  if (externalSignal.aborted) {
    return { kind: 'aborted' };
  }
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const forwardAbort = () => {
    controller.abort();
    if (reader !== undefined) {
      void reader.cancel().catch(() => undefined);
    }
  };
  externalSignal.addEventListener('abort', forwardAbort, { once: true });
  try {
    const requestResult = await request(
      client,
      '/responses',
      'POST',
      controller.signal,
      bodyForGeneration(model, compactOutput),
      true,
    );
    if (requestResult.kind === 'aborted') {
      return externalSignal.aborted
        ? { kind: 'aborted' }
        : { kind: 'failed', code: 'incomplete_stream', status: 0 };
    }
    const response = requestResult.response;
    if (isServerFailure(response.status)) {
      await discardResponseBody(response);
      throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'cancellation');
    }
    if (isExpectedHttpFailure(response.status) || !response.ok) {
      await discardResponseBody(response);
      return { kind: 'failed', code: expectedHttpCode(response.status), status: response.status };
    }
    if (response.body === null) {
      return { kind: 'failed', code: 'incomplete_stream', status: response.status };
    }
    reader = response.body.getReader();
    try {
      if (externalSignal.aborted) {
        await cancelReader(reader);
        return { kind: 'aborted' };
      }
      const frame = await readCancellationFrame(reader, externalSignal, maxResponseBytes);
      if (frame.kind === 'aborted') {
        return { kind: 'aborted' };
      }
      if (frame.kind !== 'observed') {
        const code = frame.kind === 'too_large' ? 'response_too_large' : 'incomplete_stream';
        return { kind: 'failed', code, status: response.status };
      }
      controller.abort();
      return { kind: 'observed', status: response.status };
    } catch {
      await cancelReader(reader);
      if (externalSignal.aborted) {
        return { kind: 'aborted' };
      }
      throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'cancellation');
    } finally {
      reader.releaseLock();
      reader = undefined;
    }
  } finally {
    externalSignal.removeEventListener('abort', forwardAbort);
  }
}

function bodyForCount(model: string): JSONObject {
  return { model, instructions: PROBE_INSTRUCTIONS, tools: PROBE_TOOLS, input: PROBE_INPUT };
}

function bodyForCompact(model: string): JSONObject {
  return { model, instructions: PROBE_INSTRUCTIONS, input: PROBE_INPUT };
}

function bodyForReplayCount(model: string, compactOutput: JSONArray): JSONObject {
  return {
    model,
    instructions: PROBE_INSTRUCTIONS,
    tools: PROBE_TOOLS,
    input: [...compactOutput, PROBE_TAIL],
  };
}

function bodyForGeneration(model: string, compactOutput: JSONArray): JSONObject {
  return {
    model,
    instructions: PROBE_INSTRUCTIONS,
    tools: PROBE_TOOLS,
    input: [...compactOutput, PROBE_TAIL],
    store: false,
    stream: true,
    reasoning: { effort: 'low' },
  };
}

function catalogListsModel(value: JSONValue, model: string): boolean | null {
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
    if (stringProperty(item, 'id') === model) {
      listed = true;
    }
  }
  return listed;
}

function mapBodyFailure(
  state: MutableProbeState,
  stage: OpenAIOAuthCompactionProbeStage,
  parsed: ParsedResponse,
): OpenAIOAuthCompactionProbeResult {
  if (parsed.kind === 'aborted') {
    return finish(state, 'aborted', stage);
  }
  if (parsed.kind === 'too_large') {
    return finish(state, 'response_too_large', stage);
  }
  return finish(state, 'malformed_json', stage);
}

function streamFailureCode(stream: StreamResult): OpenAIOAuthCompactionProbeCode {
  switch (stream.kind) {
    case 'aborted':
      return 'aborted';
    case 'malformed':
      return 'malformed_json';
    case 'too_large':
      return 'response_too_large';
    case 'incomplete':
      return 'incomplete_stream';
    case 'completed':
      return 'protocol_passed';
  }
}

export async function probeOpenAIOAuthCompaction(
  options: OpenAIOAuthCompactionProbeOptions,
): Promise<OpenAIOAuthCompactionProbeResult> {
  const state = createState(options.model);
  if (!Number.isInteger(options.maxResponseBytes) || options.maxResponseBytes <= 0) {
    throw new OpenAIOAuthCompactionProbeError('invalid_options', 'eligibility');
  }
  if (!isEligibleClient(options.client)) {
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
    await discardResponseBody(catalogResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'catalog');
  }
  if (isExpectedHttpFailure(catalogResult.response.status) || !catalogResult.response.ok) {
    const code = expectedHttpCode(catalogResult.response.status);
    await discardResponseBody(catalogResult.response);
    addCheck(state, '/models', 'GET', catalogResult.response.status, code, false);
    return finish(state, code, 'catalog');
  }
  const catalog = await parseJsonResponse(
    catalogResult.response,
    options.signal,
    options.maxResponseBytes,
  );
  if (catalog.kind !== 'ok') {
    let catalogCode: OpenAIOAuthCompactionProbeCode;
    if (catalog.kind === 'aborted') {
      catalogCode = 'aborted';
    } else if (catalog.kind === 'too_large') {
      catalogCode = 'response_too_large';
    } else {
      catalogCode = 'malformed_json';
    }
    addCheck(state, '/models', 'GET', catalogResult.response.status, catalogCode, false);
    return mapBodyFailure(state, 'catalog', catalog);
  }
  const listed = catalogListsModel(catalog.value, options.model);
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

  const countResult = await request(
    options.client,
    '/responses/input_tokens',
    'POST',
    options.signal,
    bodyForCount(options.model),
  );
  if (countResult.kind === 'aborted') {
    return finish(state, 'aborted', 'count');
  }
  let countFailure: OpenAIOAuthCompactionProbeCode | null = null;
  if (isServerFailure(countResult.response.status)) {
    await discardResponseBody(countResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'count');
  }
  if (isExpectedHttpFailure(countResult.response.status) || !countResult.response.ok) {
    countFailure = expectedHttpCode(countResult.response.status);
    await discardResponseBody(countResult.response);
    addCheck(
      state,
      '/responses/input_tokens',
      'POST',
      countResult.response.status,
      countFailure,
      false,
    );
  } else {
    const count = await parseJsonResponse(
      countResult.response,
      options.signal,
      options.maxResponseBytes,
    );
    if (count.kind === 'aborted') {
      return finish(state, 'aborted', 'count');
    }
    if (count.kind === 'too_large') {
      countFailure = 'response_too_large';
    } else if (count.kind === 'malformed') {
      countFailure = 'malformed_json';
    } else if (!hasValidCount(count.value)) {
      countFailure = 'invalid_count';
    } else {
      state.countAccepted = true;
    }
    addCheck(
      state,
      '/responses/input_tokens',
      'POST',
      countResult.response.status,
      countFailure,
      countFailure === null,
    );
  }

  const compactResult = await request(
    options.client,
    '/responses/compact',
    'POST',
    options.signal,
    bodyForCompact(options.model),
  );
  if (compactResult.kind === 'aborted') {
    return finish(state, 'aborted', 'compact');
  }
  let compactFailure: OpenAIOAuthCompactionProbeCode | null = null;
  let compactOutput: JSONArray | null = null;
  if (isServerFailure(compactResult.response.status)) {
    await discardResponseBody(compactResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'compact');
  }
  if (isExpectedHttpFailure(compactResult.response.status) || !compactResult.response.ok) {
    compactFailure = expectedHttpCode(compactResult.response.status);
    await discardResponseBody(compactResult.response);
  } else {
    const compact = await parseJsonResponse(
      compactResult.response,
      options.signal,
      options.maxResponseBytes,
    );
    if (compact.kind === 'aborted') {
      return finish(state, 'aborted', 'compact');
    }
    if (compact.kind === 'too_large') {
      compactFailure = 'response_too_large';
    } else if (compact.kind === 'malformed') {
      compactFailure = 'malformed_json';
    } else if (!hasOpaqueCompaction(compact.value)) {
      compactFailure = 'missing_opaque';
    } else {
      compactOutput = arrayProperty(compact.value, 'output') ?? null;
      state.compactAccepted = compactOutput !== null;
    }
  }
  addCheck(
    state,
    '/responses/compact',
    'POST',
    compactResult.response.status,
    compactFailure,
    compactFailure === null,
  );

  if (countFailure !== null) {
    return finish(state, countFailure, 'count');
  }
  if (compactFailure !== null || compactOutput === null) {
    return finish(state, compactFailure ?? 'missing_opaque', 'compact');
  }

  const replayCountResult = await request(
    options.client,
    '/responses/input_tokens',
    'POST',
    options.signal,
    bodyForReplayCount(options.model, compactOutput),
  );
  if (replayCountResult.kind === 'aborted') {
    return finish(state, 'aborted', 'count');
  }
  let replayCountFailure: OpenAIOAuthCompactionProbeCode | null = null;
  if (isServerFailure(replayCountResult.response.status)) {
    await discardResponseBody(replayCountResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'count');
  }
  if (isExpectedHttpFailure(replayCountResult.response.status) || !replayCountResult.response.ok) {
    replayCountFailure = expectedHttpCode(replayCountResult.response.status);
    await discardResponseBody(replayCountResult.response);
  } else {
    const replayCount = await parseJsonResponse(
      replayCountResult.response,
      options.signal,
      options.maxResponseBytes,
    );
    if (replayCount.kind === 'aborted') {
      return finish(state, 'aborted', 'count');
    }
    if (replayCount.kind === 'too_large') {
      replayCountFailure = 'response_too_large';
    } else if (replayCount.kind === 'malformed') {
      replayCountFailure = 'malformed_json';
    } else if (!hasValidCount(replayCount.value)) {
      replayCountFailure = 'invalid_count';
    }
  }
  if (replayCountFailure !== null) {
    state.countAccepted = false;
  }
  addCheck(
    state,
    '/responses/input_tokens',
    'POST',
    replayCountResult.response.status,
    replayCountFailure,
    replayCountFailure === null,
  );
  if (replayCountFailure !== null) {
    return finish(state, replayCountFailure, 'count');
  }
  if (options.signal.aborted) {
    return finish(state, 'aborted', 'generation');
  }

  const generationResult = await request(
    options.client,
    '/responses',
    'POST',
    options.signal,
    bodyForGeneration(options.model, compactOutput),
    true,
  );
  if (generationResult.kind === 'aborted') {
    return finish(state, 'aborted', 'generation');
  }
  if (isServerFailure(generationResult.response.status)) {
    await discardResponseBody(generationResult.response);
    throw new OpenAIOAuthCompactionProbeError('provider_unavailable', 'generation');
  }
  if (isExpectedHttpFailure(generationResult.response.status) || !generationResult.response.ok) {
    const code = expectedHttpCode(generationResult.response.status);
    await discardResponseBody(generationResult.response);
    addCheck(state, '/responses', 'POST', generationResult.response.status, code, false);
    return finish(state, code, 'generation');
  }
  const stream = await readSseCompletion(
    generationResult.response,
    options.signal,
    options.maxResponseBytes,
  );
  if (stream.kind !== 'completed') {
    const code = streamFailureCode(stream);
    addCheck(state, '/responses', 'POST', generationResult.response.status, code, false);
    return finish(state, code, 'generation');
  }
  state.replayCompleted = true;
  addCheck(state, '/responses', 'POST', generationResult.response.status, null, true);

  const cancellation = await observeCancellation(
    options.client,
    options.signal,
    options.model,
    compactOutput,
    options.maxResponseBytes,
  );
  if (cancellation.kind === 'aborted') {
    return finish(state, 'aborted', 'cancellation');
  }
  if (cancellation.kind === 'failed') {
    const status = cancellation.status === 0 ? null : cancellation.status;
    addCheck(state, '/responses', 'POST', status, cancellation.code, false);
    return finish(state, cancellation.code, 'cancellation');
  }
  state.cancellationObserved = true;
  addCheck(state, '/responses', 'POST', cancellation.status, null, true);
  state.protocolCompatible = true;
  return finish(state, 'protocol_passed', 'cancellation');
}
