import { isJSONObject } from '@ai-sdk/provider';
import type { JSONObject, JSONArray } from '@ai-sdk/provider';
import type { OpenAIOAuthCompactionProbeOptions, OpenAIOAuthProbeClient } from './types';
import { OpenAIOAuthCompactionProbeError } from './probe';
import { probeOpenAIOAuthCompactionV2 } from './v2';

const MODEL = 'gpt-6.1-sol';
const MAX_BYTES = 1024 * 1024;
const OPAQUE = 'opaque-ciphertext-v2';
const OPAQUE_SECOND = 'opaque-ciphertext-v2-second';

function catalogResponse(model = MODEL): Response {
  return Response.json({ data: [{ id: model }] });
}

function event(value: JSONObject, lineEnding = '\n'): string {
  return `data: ${JSON.stringify(value)}${lineEnding}${lineEnding}`;
}

function completedEvent(usage = true): JSONObject {
  return {
    type: 'response.completed',
    response: {
      status: 'completed',
      output: [],
      ...(usage ? { usage: { input_tokens: 42, output_tokens: 3, total_tokens: 45 } } : {}),
    },
  };
}

function compactionStream(
  opaque = OPAQUE,
  options: { duplicate?: boolean; usage?: boolean } = {},
): Response {
  const item: JSONObject = {
    type: 'compaction',
    encrypted_content: opaque,
    extra: { preserve: true },
  };
  const events = [
    event({ type: 'response.output_item.done', item }),
    ...(options.duplicate ? [event({ type: 'response.output_item.done', item })] : []),
    event(completedEvent(options.usage)),
  ];
  return sseResponse(events);
}

function generationStream(answer = 'PROBE_OK_42', role = 'assistant'): Response {
  return sseResponse([
    event({
      type: 'response.output_item.done',
      item: {
        type: 'message',
        role,
        content: [{ type: 'output_text', text: answer }],
      },
    }),
    event(completedEvent()),
  ]);
}

function sseResponse(events: string[], split = false): Response {
  const bytes = new TextEncoder().encode(events.join(''));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (!split) {
          controller.enqueue(bytes);
          controller.close();
          return;
        }
        for (let index = 0; index < bytes.byteLength; index += 1) {
          controller.enqueue(bytes.slice(index, index + 1));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function cancellationResponse(
  body = event({ type: 'response.in_progress', response: { status: 'in_progress' } }),
  onCancel?: () => void,
  split = false,
): Response {
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (split) {
          for (let index = 0; index < bytes.byteLength; index += 1) {
            controller.enqueue(bytes.slice(index, index + 1));
          }
        } else {
          controller.enqueue(bytes);
        }
      },
      cancel() {
        onCancel?.();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function requestBody(request: { init?: RequestInit }): JSONObject {
  const raw = request.init?.body;
  if (typeof raw !== 'string') {
    throw new Error('expected JSON request body');
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isJSONObject(parsed)) {
    throw new Error('expected JSON object request body');
  }
  return parsed;
}

function makeOptions(
  responses: Response[],
  model = MODEL,
): {
  options: OpenAIOAuthCompactionProbeOptions;
  requests: Array<{ path: string; init?: RequestInit }>;
} {
  const queue = [...responses];
  const requests: Array<{ path: string; init?: RequestInit }> = [];
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

function successResponses(onCancel?: () => void): Response[] {
  return [
    catalogResponse(),
    compactionStream(),
    generationStream(),
    compactionStream(OPAQUE_SECOND),
    generationStream(),
    cancellationResponse(undefined, onCancel),
  ];
}

function input(body: JSONObject): JSONArray {
  const value = body.input;
  if (!Array.isArray(value)) {
    throw new Error('expected input array');
  }
  return value;
}

describe('probeOpenAIOAuthCompactionV2', () => {
  it('proves the native empty-output compaction, replay, repeated compaction, and cancellation flow', async () => {
    let cancelled = false;
    const { options, requests } = makeOptions(successResponses(() => (cancelled = true)));

    const result = await probeOpenAIOAuthCompactionV2(options);

    expect(result).toMatchObject({
      model: MODEL,
      modelListed: true,
      protocolCompatible: true,
      code: 'protocol_passed',
      compactAccepted: true,
      replayCompleted: true,
      repeatedCompactionCompleted: true,
      cancellationObserved: true,
      usageObserved: true,
    });
    expect(cancelled).toBe(true);
    expect(requests.map(({ path }) => path)).toEqual([
      '/models',
      '/responses',
      '/responses',
      '/responses',
      '/responses',
      '/responses',
    ]);

    const firstCompact = requestBody(requests[1]);
    const firstReplay = requestBody(requests[2]);
    const secondCompact = requestBody(requests[3]);
    const secondReplay = requestBody(requests[4]);
    expect(firstCompact.reasoning).toEqual({ effort: 'high' });
    expect(firstCompact.store).toBe(false);
    expect(firstCompact.stream).toBe(true);
    expect(input(firstCompact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'function_call' }),
        expect.objectContaining({ type: 'function_call_output', output: '42' }),
        expect.objectContaining({ type: 'compaction_trigger' }),
      ]),
    );
    expect(input(firstReplay)).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({
        type: 'compaction',
        encrypted_content: OPAQUE,
      }),
      expect.objectContaining({ role: 'user' }),
    ]);
    expect(input(firstReplay)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'function_call_output' })]),
    );
    expect(input(secondCompact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'compaction', encrypted_content: OPAQUE }),
        expect.objectContaining({ type: 'compaction_trigger' }),
        expect.objectContaining({ type: 'message', role: 'assistant' }),
      ]),
    );
    expect(input(secondReplay)).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ type: 'compaction', encrypted_content: OPAQUE_SECOND }),
      expect.objectContaining({ role: 'user' }),
    ]);
    expect(input(secondReplay)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'function_call_output' })]),
    );
    expect(input(secondReplay)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'compaction', encrypted_content: OPAQUE }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(OPAQUE);
    expect(JSON.stringify(result)).not.toContain('PROBE_OK_42');
    expect(JSON.stringify(result)).not.toContain('input_tokens');
    expect(JSON.stringify(result)).not.toContain('response.output');
  });

  it('rejects a wrong role or answer from the replay assistant item', async () => {
    const wrongRole = makeOptions([
      catalogResponse(),
      compactionStream(),
      generationStream('PROBE_OK_42', 'user'),
    ]);
    await expect(probeOpenAIOAuthCompactionV2(wrongRole.options)).resolves.toMatchObject({
      code: 'wrong_role',
      stage: 'replay',
    });

    const wrongAnswer = makeOptions([
      catalogResponse(),
      compactionStream(),
      generationStream('PROBE_OK_43'),
    ]);
    await expect(probeOpenAIOAuthCompactionV2(wrongAnswer.options)).resolves.toMatchObject({
      code: 'wrong_confirmation',
      stage: 'replay',
    });
  });

  it('requires the final assistant output text to agree with matching deltas', async () => {
    const mismatch = makeOptions([
      catalogResponse(),
      compactionStream(),
      sseResponse([
        event({ type: 'response.output_text.delta', delta: 'PROBE_OK_42' }),
        event({
          type: 'response.output_item.done',
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'PROBE_OK_43' }],
          },
        }),
        event(completedEvent()),
      ]),
    ]);
    await expect(probeOpenAIOAuthCompactionV2(mismatch.options)).resolves.toMatchObject({
      code: 'wrong_confirmation',
      stage: 'replay',
      replayCompleted: false,
    });
  });

  it('requires exactly one opaque compaction item and valid completion usage', async () => {
    const missing = makeOptions([catalogResponse(), sseResponse([event(completedEvent())])]);
    await expect(probeOpenAIOAuthCompactionV2(missing.options)).resolves.toMatchObject({
      code: 'missing_opaque',
      stage: 'compact',
    });

    const duplicate = makeOptions([
      catalogResponse(),
      compactionStream(OPAQUE, { duplicate: true }),
    ]);
    await expect(probeOpenAIOAuthCompactionV2(duplicate.options)).resolves.toMatchObject({
      code: 'duplicate_opaque',
      stage: 'compact',
    });

    const invalidUsage = makeOptions([
      catalogResponse(),
      compactionStream(OPAQUE, { usage: false }),
    ]);
    await expect(probeOpenAIOAuthCompactionV2(invalidUsage.options)).resolves.toMatchObject({
      code: 'invalid_usage',
      stage: 'compact',
    });
  });

  it('handles malformed, failed, and EOF streams without claiming completion', async () => {
    const malformed = makeOptions([catalogResponse(), sseResponse(['data: {\n\n'])]);
    await expect(probeOpenAIOAuthCompactionV2(malformed.options)).resolves.toMatchObject({
      code: 'malformed_json',
      stage: 'compact',
    });

    const failed = makeOptions([
      catalogResponse(),
      compactionStream(),
      sseResponse([event({ type: 'error' })]),
    ]);
    await expect(probeOpenAIOAuthCompactionV2(failed.options)).resolves.toMatchObject({
      code: 'incomplete_stream',
      stage: 'replay',
    });

    const eof = makeOptions([
      catalogResponse(),
      compactionStream(),
      sseResponse(['data: {"type":"response.output_item.done"}\n']),
    ]);
    await expect(probeOpenAIOAuthCompactionV2(eof.options)).resolves.toMatchObject({
      code: 'incomplete_stream',
      stage: 'replay',
    });
  });

  it.each([401, 403, 404, 429])('reports catalog HTTP %i and stops', async (status) => {
    const { options, requests } = makeOptions([new Response('{}', { status })]);
    const result = await probeOpenAIOAuthCompactionV2(options);
    expect(result).toMatchObject({ code: `http_${status}`, stage: 'catalog' });
    expect(requests).toHaveLength(1);
  });

  it('throws only the safe operational error for server and network failures', async () => {
    const server = makeOptions([new Response('{}', { status: 503 })]);
    await expect(probeOpenAIOAuthCompactionV2(server.options)).rejects.toMatchObject({
      code: 'provider_unavailable',
      stage: 'catalog',
      message: 'OpenAI OAuth compaction probe failed',
    });

    const network = makeOptions([]);
    const networkClient: OpenAIOAuthProbeClient = {
      ...network.options.client,
      request: jest.fn(async () => {
        throw new Error('credentials must never appear');
      }),
    };
    const networkOptions = { ...network.options, client: networkClient };
    await expect(probeOpenAIOAuthCompactionV2(networkOptions)).rejects.toBeInstanceOf(
      OpenAIOAuthCompactionProbeError,
    );
    await expect(probeOpenAIOAuthCompactionV2(networkOptions)).rejects.toMatchObject({
      code: 'provider_unavailable',
      stage: 'catalog',
      message: 'OpenAI OAuth compaction probe failed',
    });
  });

  it('fails closed for split terminal and done cancellation frames', async () => {
    const terminalEvent: JSONObject = {
      type: 'response.completed',
      response: { status: 'completed' },
    };
    const cases: Array<{ body: string; split: boolean }> = [
      { body: event(terminalEvent), split: true },
      { body: 'data: [DONE]\n\n', split: true },
      { body: event({ type: 'response.in_progress' }), split: false },
    ];
    for (const { body, split } of cases) {
      const { options } = makeOptions([
        catalogResponse(),
        compactionStream(),
        generationStream(),
        compactionStream(OPAQUE_SECOND),
        generationStream(),
        cancellationResponse(body, undefined, split),
      ]);
      const result = await probeOpenAIOAuthCompactionV2(options);
      expect(result).toMatchObject({
        code: 'incomplete_stream',
        stage: 'cancellation',
        cancellationObserved: false,
      });
    }
  });

  it('forwards abort to hanging JSON reads, bounds bodies, and stops follow-up calls', async () => {
    const controller = new AbortController();
    const hanging = new Response(new ReadableStream<Uint8Array>({}), { status: 200 });
    const { options, requests } = makeOptions([hanging]);
    const promise = probeOpenAIOAuthCompactionV2({ ...options, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(promise).resolves.toMatchObject({ code: 'aborted', stage: 'catalog' });
    expect(requests).toHaveLength(1);

    const bounded = makeOptions([catalogResponse()]);
    await expect(
      probeOpenAIOAuthCompactionV2({ ...bounded.options, maxResponseBytes: 1 }),
    ).resolves.toMatchObject({ code: 'response_too_large', stage: 'catalog' });
  });

  it('stops before any call for an ineligible provider', async () => {
    const { options, requests } = makeOptions([]);
    const ineligible = {
      ...options,
      client: Object.assign(options.client, { provider: 'openai_api_key' }),
    };
    await expect(probeOpenAIOAuthCompactionV2(ineligible)).resolves.toMatchObject({
      code: 'provider_ineligible',
      stage: 'eligibility',
    });
    expect(requests).toHaveLength(0);
  });
});
