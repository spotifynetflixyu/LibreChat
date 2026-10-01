import type { JSONObject } from '@ai-sdk/provider';
import type { OAuthCompactionInspectOptions } from './stream';
import { inspectResponseStream, readCompactionStream } from './stream';
import { OAuthCompactionError } from './runtime';

const opaque = { type: 'compaction', encrypted_content: 'ciphertext', extra: { retained: true } };

function event(value: JSONObject, ending = '\n\n'): string {
  return `data: ${JSON.stringify(value)}${ending}`;
}

function response(parts: string[], split = false): Response {
  const bytes = new TextEncoder().encode(parts.join(''));
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
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function completed(): JSONObject {
  return {
    type: 'response.completed',
    response: {
      status: 'completed',
      output: [],
      usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
    },
  };
}

function inspectOptions(
  onCompleted: (inputTokens: number) => Promise<void>,
  onFinished: (outcome: 'completed' | 'cancelled' | 'failed') => Promise<void>,
  signal = new AbortController().signal,
): OAuthCompactionInspectOptions {
  return { signal, maxBytes: 1024 * 1024, onCompleted, onFinished };
}

describe('OAuth compaction SSE streams', () => {
  it('accepts split UTF-8 and CRLF compaction events with empty response output', async () => {
    const result = await readCompactionStream(
      response(
        [
          event(
            { type: 'response.output_item.done', item: { ...opaque, label: '😀' } },
            '\r\n\r\n',
          ),
          event(completed(), '\r\n\r\n'),
        ],
        true,
      ),
      new AbortController().signal,
      1024 * 1024,
    );

    expect(JSON.parse(result.opaque)).toEqual({ ...opaque, label: '😀' });
    expect(result.inputTokens).toBe(12);
  });

  it.each([
    ['missing opaque', [event(completed())]],
    [
      'duplicate opaque',
      [
        event({ type: 'response.output_item.done', item: opaque }),
        event({ type: 'response.output_item.done', item: opaque }),
        event(completed()),
      ],
    ],
    ['failed response', [event({ type: 'response.failed' })]],
    [
      'missing usage',
      [
        event({ type: 'response.output_item.done', item: opaque }),
        event({ ...completed(), response: { status: 'completed', output: [] } }),
      ],
    ],
  ])('rejects %s safely', async (_name, events) => {
    await expect(
      readCompactionStream(response(events), new AbortController().signal, 1024 * 1024),
    ).rejects.toBeInstanceOf(OAuthCompactionError);
  });

  it('bounds compaction streams and never treats EOF as completion', async () => {
    await expect(
      readCompactionStream(
        response([event({ type: 'response.output_item.done', item: opaque })]),
        new AbortController().signal,
        2,
      ),
    ).rejects.toMatchObject({ code: 'response_too_large' });
    await expect(
      readCompactionStream(
        response(['data: {"type":"response.in_progress"}\n']),
        new AbortController().signal,
        1024,
      ),
    ).rejects.toMatchObject({ code: 'malformed_stream' });
  });

  it('passes ordinary response bytes through while inspecting completed usage', async () => {
    const completedUsage: number[] = [];
    const finished: string[] = [];
    const source = response([event({ type: 'response.created' }), event(completed())]);
    const inspected = inspectResponseStream(
      source,
      inspectOptions(
        async (inputTokens) => {
          completedUsage.push(inputTokens);
        },
        async (outcome) => {
          finished.push(outcome);
        },
      ),
    );

    await expect(inspected.text()).resolves.toContain('response.completed');
    expect(completedUsage).toEqual([12]);
    expect(finished).toEqual(['completed']);
  });

  it('cancels the inspected source and reports cancellation', async () => {
    const controller = new AbortController();
    const finished: string[] = [];
    const source = new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode(event({ type: 'response.created' })));
        },
        cancel() {
          finished.push('source-cancelled');
        },
      }),
      { status: 200 },
    );
    const inspected = inspectResponseStream(
      source,
      inspectOptions(
        async () => undefined,
        async (outcome) => {
          finished.push(outcome);
        },
        controller.signal,
      ),
    );
    const reader = inspected.body?.getReader();
    await reader?.read();
    controller.abort();
    await expect(reader?.read()).rejects.toMatchObject({ code: 'aborted' });
    expect(finished).toContain('cancelled');
  });

  it('waits for verified usage and shared cleanup when completion is followed by cancellation', async () => {
    const controller = new AbortController();
    let saveUsage = (): void => undefined;
    let releaseLease = (): void => undefined;
    let startCleanup = (): void => undefined;
    const saved = new Promise<void>((resolve) => {
      saveUsage = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseLease = resolve;
    });
    const cleanupStarted = new Promise<void>((resolve) => {
      startCleanup = resolve;
    });
    const onCompleted = jest.fn(async () => saved);
    const onFinished = jest.fn(async () => {
      startCleanup();
      return released;
    });
    const source = new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode(event(completed())));
        },
      }),
    );
    const reader = inspectResponseStream(
      source,
      inspectOptions(onCompleted, onFinished, controller.signal),
    ).body!.getReader();
    await reader.read();
    expect(onCompleted).toHaveBeenCalledWith(12);
    controller.abort();
    let cancelled = false;
    const cancellation = reader.cancel().then(() => {
      cancelled = true;
    });
    await Promise.resolve();
    expect(onFinished).not.toHaveBeenCalled();
    expect(cancelled).toBe(false);
    saveUsage();
    await cleanupStarted;
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(false);
    releaseLease();
    await cancellation;
    expect(cancelled).toBe(true);
  });

  it('finishes an unread response when its signal is already aborted', async () => {
    const controller = new AbortController();
    const onCompleted = jest.fn(async () => undefined);
    const onFinished = jest.fn(async () => undefined);
    const cancel = jest.fn();
    const source = new Response(new ReadableStream<Uint8Array>({ cancel }));
    controller.abort();

    inspectResponseStream(source, inspectOptions(onCompleted, onFinished, controller.signal));

    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith('cancelled');
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
