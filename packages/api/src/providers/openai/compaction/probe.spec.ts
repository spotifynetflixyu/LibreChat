import { isJSONArray, isJSONObject } from '@ai-sdk/provider';
import type { JSONObject, JSONArray } from '@ai-sdk/provider';
import type { OpenAIOAuthCompactionProbeOptions, OpenAIOAuthProbeClient } from './types';
import { OpenAIOAuthCompactionProbeError, probeOpenAIOAuthCompaction } from './probe';

const MODEL = 'gpt-6.1-sol';
const MAX_BYTES = 1024 * 1024;
const INSTRUCTIONS = 'You are running a bounded OpenAI OAuth compaction diagnostic.';
const OPAQUE_OUTPUT: JSONArray = [
  { type: 'compaction', encrypted_content: 'opaque-ciphertext-value', extra: { keep: true } },
  { type: 'message', content: [{ type: 'output_text', text: 'retained item' }] },
];

function catalogResponse(model = MODEL): Response {
  return Response.json({ data: [{ id: model }, { id: 'other-model' }] });
}

function countResponse(inputTokens = 42): Response {
  return Response.json({ input_tokens: inputTokens });
}

function compactResponse(output: JSONArray = OPAQUE_OUTPUT): Response {
  return Response.json({ id: 'compact_response_id', output, extra: { preserve: 'all' } });
}

function completedEvent(value = '42'): JSONObject {
  return {
    type: 'response.completed',
    response: {
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: `😀 PROBE_OK_${value}` }],
        },
      ],
      usage: { input_tokens: 42, output_tokens: 3, total_tokens: 45 },
    },
  };
}

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const chunks = events.map((event) => encoder.encode(event));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          const midpoint = Math.max(1, Math.floor(chunk.byteLength / 2));
          controller.enqueue(chunk.slice(0, midpoint));
          controller.enqueue(chunk.slice(midpoint));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function singleSseResponse(event: string): Response {
  const chunk = new TextEncoder().encode(event);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function responseStreamWithCancel(onCancel: () => void): Response {
  const chunk = new TextEncoder().encode(
    'data: {"type":"response.in_progress","response":{"status":"in_progress"}}\n\n',
  );
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        onCancel();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function hangingResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>({}), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeOptions(
  responses: Response[],
  model = MODEL,
): {
  options: OpenAIOAuthCompactionProbeOptions;
  requests: Array<{ path: string; init?: RequestInit }>;
} {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const queue = [...responses];
  const client: OpenAIOAuthProbeClient = {
    provider: 'openai_oauth_responses',
    authKind: 'oauth',
    request: jest.fn(async (path: string, init?: RequestInit) => {
      requests.push({ path, init });
      const response = queue.shift();
      if (response === undefined) {
        throw new Error('unexpected test request');
      }
      return response;
    }),
  };
  return {
    options: { client, model, signal: new AbortController().signal, maxResponseBytes: MAX_BYTES },
    requests,
  };
}

function requestBody(request: { init?: RequestInit }): JSONObject {
  const raw = request.init?.body;
  if (typeof raw !== 'string') {
    throw new Error('expected JSON request body');
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected JSON object request body');
  }
  return parsed as JSONObject;
}

function functionOutput(body: JSONObject): string {
  const input = body.input;
  if (!isJSONArray(input)) {
    throw new Error('expected diagnostic input');
  }
  for (const item of input) {
    if (!isJSONObject(item) || item.type !== 'function_call_output') {
      continue;
    }
    if (typeof item.output === 'string') {
      return item.output;
    }
  }
  throw new Error('expected diagnostic function result');
}

describe('probeOpenAIOAuthCompaction', () => {
  it('rejects an ineligible provider before making a request', async () => {
    const { options, requests } = makeOptions([]);
    const ineligible = {
      ...options,
      client: Object.assign(options.client, { provider: 'openai_api_key' }),
    };

    const result = await probeOpenAIOAuthCompaction(ineligible);

    expect(result).toMatchObject({
      model: MODEL,
      modelListed: false,
      protocolCompatible: false,
      code: 'provider_ineligible',
      stage: 'eligibility',
    });
    expect(requests).toHaveLength(0);
  });

  it('stops after a missing model in the catalog', async () => {
    const { options, requests } = makeOptions([catalogResponse('different-model')]);

    const result = await probeOpenAIOAuthCompaction(options);

    expect(result).toMatchObject({
      modelListed: false,
      code: 'model_not_listed',
      stage: 'catalog',
    });
    expect(requests).toHaveLength(1);
  });

  it.each([401, 403, 404, 429])(
    'returns expected catalog HTTP %i as negative evidence',
    async (status) => {
      const response = new Response('{}', { status });
      const { options, requests } = makeOptions([response]);

      const result = await probeOpenAIOAuthCompaction(options);

      expect(result).toMatchObject({ code: `http_${status}`, stage: 'catalog' });
      expect(result.checks[0]).toMatchObject({ path: '/models', method: 'GET', status, ok: false });
      expect(requests).toHaveLength(1);
    },
  );

  it('throws a safe operational error for a catalog server failure or network failure', async () => {
    const server = makeOptions([new Response('{}', { status: 503 })]);
    await expect(probeOpenAIOAuthCompaction(server.options)).rejects.toMatchObject({
      code: 'provider_unavailable',
      stage: 'catalog',
      message: 'OpenAI OAuth compaction probe failed',
    });

    const network = makeOptions([]);
    const networkClient: OpenAIOAuthProbeClient = {
      provider: 'openai_oauth_responses',
      authKind: 'oauth',
      request: jest.fn(async () => {
        throw new Error('credential and upstream details must stay private');
      }),
    };
    const networkOptions = { ...network.options, client: networkClient };
    await expect(probeOpenAIOAuthCompaction(networkOptions)).rejects.toBeInstanceOf(
      OpenAIOAuthCompactionProbeError,
    );
    await expect(probeOpenAIOAuthCompaction(networkOptions)).rejects.toMatchObject({
      code: 'provider_unavailable',
      stage: 'catalog',
      message: 'OpenAI OAuth compaction probe failed',
    });
  });

  it('keeps count and compact calls independent while rejecting invalid accounting', async () => {
    const { options, requests } = makeOptions([
      catalogResponse(),
      Response.json({ input_tokens: 'not-a-count' }),
      compactResponse(),
    ]);

    const result = await probeOpenAIOAuthCompaction(options);

    expect(result).toMatchObject({
      code: 'invalid_count',
      stage: 'count',
      modelListed: true,
      countAccepted: false,
      compactAccepted: true,
    });
    expect(requests.map(({ path }) => path)).toEqual([
      '/models',
      '/responses/input_tokens',
      '/responses/compact',
    ]);
  });

  it('rejects malformed and opaque-less compact responses without exposing payloads', async () => {
    const malformed = makeOptions([
      catalogResponse(),
      countResponse(),
      new Response('{', { status: 200 }),
    ]);
    const malformedResult = await probeOpenAIOAuthCompaction(malformed.options);
    expect(malformedResult).toMatchObject({ code: 'malformed_json', stage: 'compact' });

    const opaqueMissing = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse([{ type: 'message' }]),
    ]);
    const opaqueResult = await probeOpenAIOAuthCompaction(opaqueMissing.options);
    expect(opaqueResult).toMatchObject({ code: 'missing_opaque', stage: 'compact' });
    expect(JSON.stringify(opaqueResult)).not.toContain('opaque-ciphertext-value');
    expect(JSON.stringify(opaqueResult)).not.toContain('compact_response_id');
  });

  it('replays the entire compact output once and preserves the tool pair and request fields', async () => {
    const first = sseResponse([
      `event: response.completed\ndata: ${JSON.stringify(completedEvent())}\n\n`,
    ]);
    const second = responseStreamWithCancel(() => undefined);
    const { options, requests } = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      countResponse(45),
      first,
      second,
    ]);

    const result = await probeOpenAIOAuthCompaction(options);
    const countBody = requestBody(requests[1]);
    const compactBody = requestBody(requests[2]);
    const replayCountBody = requestBody(requests[3]);
    const generationBody = requestBody(requests[4]);
    const cancellationBody = requestBody(requests[5]);
    const toolValue = functionOutput(countBody);

    expect(result).toMatchObject({
      code: 'protocol_passed',
      stage: 'cancellation',
      modelListed: true,
      protocolCompatible: true,
      countAccepted: true,
      compactAccepted: true,
      replayCompleted: true,
      cancellationObserved: true,
    });
    expect(countBody).toMatchObject({ model: MODEL, instructions: INSTRUCTIONS });
    expect(countBody.tools).toBeDefined();
    expect(toolValue).toBe('42');
    expect(compactBody).toEqual({
      model: MODEL,
      instructions: INSTRUCTIONS,
      input: expect.any(Array),
    });
    expect(compactBody.tools).toBeUndefined();
    expect(replayCountBody).toEqual({
      model: MODEL,
      instructions: INSTRUCTIONS,
      tools: generationBody.tools,
      input: generationBody.input,
    });
    expect(generationBody).toEqual(cancellationBody);
    expect(generationBody.model).toBe(MODEL);
    expect(generationBody.instructions).toBe(INSTRUCTIONS);
    expect(generationBody.store).toBe(false);
    expect(generationBody.stream).toBe(true);
    expect(generationBody.reasoning).toEqual({ effort: 'low' });
    expect(generationBody.input).toEqual([
      ...OPAQUE_OUTPUT,
      expect.objectContaining({ role: 'user' }),
    ]);
    expect(JSON.stringify(generationBody.input)).toContain('Reply with PROBE_OK_');
    expect(JSON.stringify(generationBody.input)).not.toContain(`PROBE_OK_${toolValue}`);
    expect(JSON.stringify(result)).not.toContain('opaque-ciphertext-value');
    expect(JSON.stringify(result)).not.toContain('compact_response_id');
    expect(JSON.stringify(result)).not.toContain('PROBE_OK_42');
    expect(JSON.stringify(result)).not.toContain('"input_tokens":');
    expect(JSON.stringify(result)).not.toContain('"output_tokens":');
    expect(JSON.stringify(result)).not.toContain('"total_tokens":');
  });

  it('requires a valid count for the compact replay before generation', async () => {
    const { options, requests } = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      Response.json({ input_tokens: 0 }),
    ]);

    const result = await probeOpenAIOAuthCompaction(options);

    expect(result).toMatchObject({
      code: 'invalid_count',
      stage: 'count',
      countAccepted: false,
      compactAccepted: true,
      replayCompleted: false,
    });
    expect(requests.map(({ path }) => path)).toEqual([
      '/models',
      '/responses/input_tokens',
      '/responses/compact',
      '/responses/input_tokens',
    ]);
  });

  it('parses split UTF-8, CRLF, and multiline SSE data and requires a completed response', async () => {
    const event = JSON.stringify(completedEvent());
    const split = Math.max(1, event.indexOf('"response"'));
    const firstData = event.slice(0, split);
    const secondData = event.slice(split);
    const generation = sseResponse([
      `event: response.completed\r\ndata: ${firstData}\r\ndata: ${secondData}\r\n\r\n`,
    ]);
    const cancellation = responseStreamWithCancel(() => undefined);
    const { options } = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      countResponse(45),
      generation,
      cancellation,
    ]);

    const result = await probeOpenAIOAuthCompaction(options);

    expect(result.protocolCompatible).toBe(true);
    expect(result.code).toBe('protocol_passed');
  });

  it.each(['response.failed', 'response.error', 'response.incomplete'])(
    'does not complete on %s or EOF',
    async (type) => {
      const failure = sseResponse([`event: ${type}\ndata: ${JSON.stringify({ type })}\n\n`]);
      const { options } = makeOptions([
        catalogResponse(),
        countResponse(),
        compactResponse(),
        countResponse(45),
        failure,
      ]);

      const result = await probeOpenAIOAuthCompaction(options);

      expect(result).toMatchObject({ code: 'incomplete_stream', stage: 'generation' });
      expect(result.replayCompleted).toBe(false);
    },
  );

  it('does not accept a completed event after a top-level error frame', async () => {
    const error = JSON.stringify({ type: 'error' });
    const completed = JSON.stringify(completedEvent());
    const generation = sseResponse([`data: ${error}\n\ndata: ${completed}\n\n`]);
    const { options } = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      countResponse(45),
      generation,
    ]);

    const result = await probeOpenAIOAuthCompaction(options);

    expect(result).toMatchObject({ code: 'incomplete_stream', stage: 'generation' });
  });

  it('does not treat [DONE] as completion and never calls after an external abort', async () => {
    const done = sseResponse(['data: [DONE]\n\n']);
    const doneRun = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      countResponse(45),
      done,
    ]);
    const doneResult = await probeOpenAIOAuthCompaction(doneRun.options);
    expect(doneResult.code).toBe('incomplete_stream');

    const controller = new AbortController();
    controller.abort();
    const aborted = makeOptions([]);
    const abortedOptions = { ...aborted.options, signal: controller.signal };
    const abortedResult = await probeOpenAIOAuthCompaction(abortedOptions);
    expect(abortedResult).toMatchObject({ code: 'aborted', stage: 'eligibility' });
    expect(aborted.requests).toHaveLength(0);
  });

  it('observes cancellation by aborting and cancelling after the first response frame', async () => {
    let cancelled = false;
    const generation = sseResponse([`data: ${JSON.stringify(completedEvent())}\n\n`]);
    const cancellation = responseStreamWithCancel(() => {
      cancelled = true;
    });
    const { options } = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      countResponse(45),
      generation,
      cancellation,
    ]);

    const result = await probeOpenAIOAuthCompaction(options);

    expect(result.cancellationObserved).toBe(true);
    expect(cancelled).toBe(true);
  });

  it('does not call an already completed second generation a cancellation success', async () => {
    const generation = sseResponse([`data: ${JSON.stringify(completedEvent())}\n\n`]);
    const completedCancellation = singleSseResponse(
      `data: ${JSON.stringify(completedEvent())}\n\n`,
    );
    const { options } = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      countResponse(45),
      generation,
      completedCancellation,
    ]);

    const result = await probeOpenAIOAuthCompaction(options);

    expect(result).toMatchObject({
      code: 'incomplete_stream',
      stage: 'cancellation',
      replayCompleted: true,
      cancellationObserved: false,
      protocolCompatible: false,
    });
  });

  it.each([
    ['split completed', `data: ${JSON.stringify(completedEvent())}\n\n`],
    ['split done', 'data: [DONE]\n\n'],
    ['type-only created', 'data: {"type":"response.created"}\n\n'],
    ['type-only in-progress', 'data: {"type":"response.in_progress"}\n\n'],
  ])('fails closed for a %s cancellation frame', async (_name, event) => {
    const generation = sseResponse([`data: ${JSON.stringify(completedEvent())}\n\n`]);
    const cancellation = sseResponse([event]);
    const { options } = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      countResponse(45),
      generation,
      cancellation,
    ]);

    const result = await probeOpenAIOAuthCompaction(options);

    expect(result).toMatchObject({
      code: 'incomplete_stream',
      stage: 'cancellation',
      cancellationObserved: false,
    });
  });

  it('accumulates a split nonterminal cancellation frame safely', async () => {
    const generation = sseResponse([`data: ${JSON.stringify(completedEvent())}\n\n`]);
    const cancellation = sseResponse([
      'data: {"type":"response.in_progress","response":{"status":"in_progress"}}\n\n',
    ]);
    const { options } = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      countResponse(45),
      generation,
      cancellation,
    ]);

    const result = await probeOpenAIOAuthCompaction(options);

    expect(result).toMatchObject({
      code: 'protocol_passed',
      stage: 'cancellation',
      cancellationObserved: true,
    });
  });

  it('bounds provider response bodies', async () => {
    const { options } = makeOptions([catalogResponse(), countResponse(), compactResponse()]);
    const bounded = { ...options, maxResponseBytes: 1 };

    const result = await probeOpenAIOAuthCompaction(bounded);

    expect(result).toMatchObject({ code: 'response_too_large', stage: 'catalog' });
  });

  it('returns aborted when a bounded JSON reader is waiting for a body', async () => {
    const controller = new AbortController();
    const { options, requests } = makeOptions([hangingResponse()]);
    const abortedOptions = { ...options, signal: controller.signal };
    setTimeout(() => controller.abort(), 0);

    const result = await probeOpenAIOAuthCompaction(abortedOptions);

    expect(result).toMatchObject({ code: 'aborted', stage: 'catalog' });
    expect(requests).toHaveLength(1);
  });

  it('returns aborted when an SSE reader is waiting for a frame', async () => {
    const controller = new AbortController();
    const { options, requests } = makeOptions([
      catalogResponse(),
      countResponse(),
      compactResponse(),
      countResponse(45),
      hangingResponse(),
    ]);
    const abortedOptions = { ...options, signal: controller.signal };
    setTimeout(() => controller.abort(), 0);

    const result = await probeOpenAIOAuthCompaction(abortedOptions);

    expect(result).toMatchObject({ code: 'aborted', stage: 'generation' });
    expect(requests).toHaveLength(5);
  });
});
