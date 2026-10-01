import { isJSONObject, isJSONValue } from '@ai-sdk/provider';
import type { JSONObject, JSONValue } from '@ai-sdk/provider';
import { OAuthCompactionError } from './runtime';

interface ParsedEvent {
  readonly data: string;
}

export interface OAuthCompactionStreamResult {
  readonly opaque: string;
  readonly inputTokens: number;
  readonly response?: Response;
}

export interface OAuthCompactionInspectOptions {
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly onCompleted: (inputTokens: number) => Promise<void>;
  readonly onFinished: (outcome: 'completed' | 'cancelled' | 'failed') => Promise<void>;
}

function objectProperty(value: JSONObject, key: string): JSONObject | undefined {
  const property = value[key];
  return isJSONObject(property) ? property : undefined;
}

function stringProperty(value: JSONObject, key: string): string | undefined {
  const property = value[key];
  return typeof property === 'string' ? property : undefined;
}

function numberProperty(value: JSONObject, key: string): number | undefined {
  const property = value[key];
  return typeof property === 'number' ? property : undefined;
}

function parseJSON(text: string): JSONValue | null {
  try {
    const value: unknown = JSON.parse(text);
    return isJSONValue(value) ? value : null;
  } catch {
    return null;
  }
}

function parseJSONObject(text: string): JSONObject | null {
  const parsed = parseJSON(text);
  return isJSONObject(parsed) ? parsed : null;
}

function nextLine(buffer: string): { readonly line: string; readonly rest: string } | null {
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

function consumeLine(
  line: string,
  dataLines: readonly string[],
): { readonly event: ParsedEvent | null; readonly dataLines: readonly string[] } {
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

function terminalFailure(value: JSONObject): boolean {
  const type = stringProperty(value, 'type');
  return (
    type === 'response.failed' ||
    type === 'response.error' ||
    type === 'response.incomplete' ||
    type === 'error'
  );
}

function completedUsage(value: JSONObject): number | null {
  if (stringProperty(value, 'type') !== 'response.completed') {
    return null;
  }
  const response = objectProperty(value, 'response');
  const usage = response === undefined ? undefined : objectProperty(response, 'usage');
  const status = response === undefined ? undefined : stringProperty(response, 'status');
  const input = usage === undefined ? undefined : numberProperty(usage, 'input_tokens');
  const output = usage === undefined ? undefined : numberProperty(usage, 'output_tokens');
  const total = usage === undefined ? undefined : numberProperty(usage, 'total_tokens');
  if (
    status !== 'completed' ||
    input === undefined ||
    output === undefined ||
    total === undefined ||
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    !Number.isSafeInteger(total) ||
    input < 0 ||
    output < 0 ||
    total !== input + output
  ) {
    return null;
  }
  return input;
}

function validCompactionItem(value: JSONObject): boolean {
  return (
    stringProperty(value, 'type') === 'compaction' &&
    (stringProperty(value, 'encrypted_content')?.length ?? 0) > 0
  );
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
  reader.releaseLock();
}

function joinChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

export async function readBoundedJSON(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<JSONValue | null> {
  if (signal.aborted || response.body === null) {
    return null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  const cancelOnAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) {
        await cancelReader(reader);
        return null;
      }
      const chunk = await reader.read();
      if (signal.aborted) {
        await cancelReader(reader);
        return null;
      }
      if (chunk.done) {
        chunks.push(decoder.decode());
        return parseJSON(chunks.join(''));
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await cancelReader(reader);
        return null;
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }
}

export async function readCompactionStream(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
  captureResponse = false,
): Promise<OAuthCompactionStreamResult> {
  if (signal.aborted) {
    throw new OAuthCompactionError('aborted');
  }
  if (response.body === null) {
    throw new OAuthCompactionError('malformed_stream');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: readonly string[] = [];
  let bytes = 0;
  const capturedChunks: Uint8Array[] = [];
  let opaqueItem: JSONObject | null = null;
  let compactionCount = 0;
  const cancelOnAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  const fail = async (
    code: 'malformed_stream' | 'aborted' | 'response_too_large',
  ): Promise<never> => {
    await cancelReader(reader);
    throw new OAuthCompactionError(code);
  };
  try {
    for (;;) {
      if (signal.aborted) {
        await fail('aborted');
      }
      const chunk = await reader.read();
      if (signal.aborted) {
        await fail('aborted');
      }
      if (chunk.done || chunk.value === undefined) {
        await cancelReader(reader);
        throw new OAuthCompactionError('malformed_stream');
      }
      const value = chunk.value;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await fail('response_too_large');
      }
      if (captureResponse) {
        capturedChunks.push(value.slice());
      }
      buffer += decoder.decode(value, { stream: true });
      let line = nextLine(buffer);
      while (line !== null) {
        buffer = line.rest;
        const consumed = consumeLine(line.line, dataLines);
        dataLines = consumed.dataLines;
        if (consumed.event !== null) {
          const data = consumed.event.data;
          if (data === '[DONE]') {
            await fail('malformed_stream');
          }
          const parsed = parseJSONObject(data);
          if (parsed === null) {
            await fail('malformed_stream');
            continue;
          }
          if (terminalFailure(parsed)) {
            await fail('malformed_stream');
            continue;
          }
          if (stringProperty(parsed, 'type') === 'response.output_item.done') {
            const item = objectProperty(parsed, 'item');
            if (item === undefined) {
              await fail('malformed_stream');
              continue;
            }
            if (stringProperty(item, 'type') === 'compaction' && !validCompactionItem(item)) {
              await fail('malformed_stream');
              continue;
            }
            if (item !== undefined && stringProperty(item, 'type') === 'compaction') {
              compactionCount += 1;
              if (compactionCount > 1 || !validCompactionItem(item)) {
                await fail('malformed_stream');
              }
              opaqueItem = item;
            }
          }
          const inputTokens = completedUsage(parsed);
          if (inputTokens !== null) {
            if (opaqueItem === null || compactionCount !== 1) {
              await fail('malformed_stream');
              continue;
            }
            await cancelReader(reader);
            const capturedResponse = captureResponse
              ? new Response(joinChunks(capturedChunks, bytes), {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                })
              : undefined;
            return {
              opaque: JSON.stringify(opaqueItem),
              inputTokens,
              response: capturedResponse,
            };
          }
          if (stringProperty(parsed, 'type') === 'response.completed') {
            await fail('malformed_stream');
          }
        }
        line = nextLine(buffer);
      }
    }
  } catch (error) {
    await cancelReader(reader);
    if (error instanceof OAuthCompactionError) {
      throw error;
    }
    throw new OAuthCompactionError(signal.aborted ? 'aborted' : 'malformed_stream');
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }
}

export function inspectResponseStream(
  response: Response,
  options: OAuthCompactionInspectOptions,
): Response {
  if (response.body === null) {
    return response;
  }
  const source = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: readonly string[] = [];
  let bytes = 0;
  let completed = false;
  let completionPromise: Promise<void> | null = null;
  let finishPromise: Promise<void> | null = null;
  const cancelOnAbort = (): void => {
    void source.cancel().catch(() => undefined);
    void finish('cancelled').catch(() => undefined);
  };
  const finish = async (outcome: 'completed' | 'cancelled' | 'failed'): Promise<void> => {
    if (finishPromise === null) {
      options.signal.removeEventListener('abort', cancelOnAbort);
      finishPromise = Promise.resolve(completionPromise)
        .then(() => options.onFinished(outcome))
        .catch(() => undefined);
    }
    await finishPromise;
  };
  const inspect = async (chunk: Uint8Array): Promise<void> => {
    bytes += chunk.byteLength;
    if (bytes > options.maxBytes) {
      throw new OAuthCompactionError('malformed_stream');
    }
    buffer += decoder.decode(chunk, { stream: true });
    let line = nextLine(buffer);
    while (line !== null) {
      buffer = line.rest;
      const consumed = consumeLine(line.line, dataLines);
      dataLines = consumed.dataLines;
      if (consumed.event !== null) {
        const parsed = parseJSONObject(consumed.event.data);
        if (parsed === null) {
          continue;
        }
        if (terminalFailure(parsed)) {
          throw new OAuthCompactionError('malformed_stream');
        }
        const inputTokens = completedUsage(parsed);
        if (inputTokens !== null && !completed) {
          completed = true;
          completionPromise = options.onCompleted(inputTokens).catch(() => undefined);
        } else if (stringProperty(parsed, 'type') === 'response.completed') {
          throw new OAuthCompactionError('malformed_stream');
        }
      }
      line = nextLine(buffer);
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (options.signal.aborted) {
        await cancelReader(source);
        await finish('cancelled');
        controller.error(new OAuthCompactionError('aborted'));
        return;
      }
      try {
        const chunk = await source.read();
        if (options.signal.aborted) {
          await cancelReader(source);
          await finish('cancelled');
          controller.error(new OAuthCompactionError('aborted'));
          return;
        }
        if (chunk.done) {
          if (completionPromise !== null) {
            await completionPromise;
          }
          await finish(completed ? 'completed' : 'failed');
          if (!completed) {
            controller.error(new OAuthCompactionError('malformed_stream'));
          } else {
            controller.close();
          }
          return;
        }
        await inspect(chunk.value);
        controller.enqueue(chunk.value);
      } catch (error) {
        await cancelReader(source);
        await finish(options.signal.aborted ? 'cancelled' : 'failed');
        controller.error(
          error instanceof OAuthCompactionError
            ? error
            : new OAuthCompactionError(options.signal.aborted ? 'aborted' : 'malformed_stream'),
        );
      }
    },
    async cancel() {
      await cancelReader(source);
      await finish('cancelled');
    },
  });
  options.signal.addEventListener('abort', cancelOnAbort, { once: true });
  if (options.signal.aborted) {
    cancelOnAbort();
  }
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
