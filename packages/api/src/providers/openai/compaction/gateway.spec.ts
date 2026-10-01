import type {
  OAuthCompactionAcquireInput,
  OAuthCompactionDeleteInput,
  OAuthCompactionSaveInput,
  OAuthCompactionState as StoredOAuthCompactionState,
  OAuthCompactionStore as StoredOAuthCompactionStore,
} from '@librechat/data-schemas';
import type { JSONObject } from '@ai-sdk/provider';
import type { OAuthCompactionConfig, OAuthCompactionScope, OAuthCompactionStore } from './runtime';
import { createOAuthCompactionFetch } from './gateway';

const URL = 'https://oauth.example/v1/responses';
const ACCOUNT = 'account-secret';

function event(value: JSONObject): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function completed(): JSONObject {
  return {
    type: 'response.completed',
    response: {
      status: 'completed',
      output: [],
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
    },
  };
}

function compactResponse(opaque: string): Response {
  return new Response(
    event({
      type: 'response.output_item.done',
      item: { type: 'compaction', encrypted_content: opaque },
    }) + event(completed()),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function hangingCompactResponse(opaque: string, onCancel: () => void): Response {
  const payload = new TextEncoder().encode(
    event({
      type: 'response.output_item.done',
      item: { type: 'compaction', encrypted_content: opaque },
    }) + event(completed()),
  );
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
      },
      cancel() {
        onCancel();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function normalResponse(): Response {
  return new Response(event({ type: 'response.created' }) + event(completed()), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function config(overrides: Partial<OAuthCompactionConfig> = {}): OAuthCompactionConfig {
  return {
    enabled: true,
    triggerRatio: 1,
    maxContextTokens: 50,
    outputReserveTokens: 0,
    timeoutMs: 10_000,
    maxResponseBytes: 1024 * 1024,
    retentionDays: 7,
    ...overrides,
  };
}

const scope: OAuthCompactionScope = {
  tenantId: 'tenant',
  userId: 'user',
  conversationId: 'conversation',
  agentId: 'agent',
  executionId: 'execution',
};

class MemoryStore implements OAuthCompactionStore {
  state: StoredOAuthCompactionState | null = null;
  revision = 0;
  busy = false;
  saves: StoredOAuthCompactionState[] = [];
  releases = 0;

  async acquireOAuthCompaction(input: OAuthCompactionAcquireInput) {
    void input;
    if (this.busy) {
      return { ok: false as const, code: 'busy' as const };
    }
    this.busy = true;
    return { ok: true as const, state: this.state, revision: this.revision };
  }

  async saveOAuthCompaction(input: OAuthCompactionSaveInput): Promise<boolean> {
    if (input.expectedRevision !== this.revision) {
      return false;
    }
    this.revision += 1;
    this.state = {
      revision: this.revision,
      ...input.state,
      coveredHashes: [...input.state.coveredHashes],
      usage:
        input.state.usage === undefined
          ? undefined
          : { ...input.state.usage, inputHashes: [...input.state.usage.inputHashes] },
      updatedAt: input.now,
    };
    this.saves.push(this.state);
    return true;
  }

  async releaseOAuthCompaction(
    input: Parameters<StoredOAuthCompactionStore['releaseOAuthCompaction']>[0],
  ): Promise<void> {
    void input;
    this.busy = false;
    this.releases += 1;
  }

  async deleteOAuthCompaction(input: OAuthCompactionDeleteInput): Promise<number> {
    void input;
    this.state = null;
    return 0;
  }
}

function body(input: JSONObject[]): string {
  return JSON.stringify({
    model: 'gpt-6.1-sol',
    instructions: 'keep this instruction',
    input,
    store: false,
    stream: true,
  });
}

function requestInput(text = 'A'.repeat(128), segmented = false): RequestInit {
  const input = segmented
    ? Array.from({ length: Math.ceil(text.length / 400) }, (_, index) => ({
        role: 'user',
        content: [{ type: 'input_text', text: text.slice(index * 400, (index + 1) * 400) }],
      }))
    : [{ role: 'user', content: [{ type: 'input_text', text }] }];
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'ChatGPT-Account-Id': ACCOUNT },
    body: body(input),
  };
}

function createFetch(
  store: MemoryStore,
  responses: Response[],
  statuses: Array<{ phase: string; code?: string }> = [],
  overrides: Partial<OAuthCompactionConfig> = {},
  compactOnly = false,
): { fetch: ReturnType<typeof createOAuthCompactionFetch>; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const underlying = async (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    calls.push(init ?? {});
    const response = responses.shift();
    if (response === undefined) {
      throw new Error('unexpected request');
    }
    return response;
  };
  return {
    fetch: createOAuthCompactionFetch({
      fetch: underlying,
      store,
      config: config(overrides),
      scope,
      compactOnly,
      onStatus(status) {
        statuses.push(status);
      },
    }),
    calls,
  };
}

describe('OAuth compaction gateway', () => {
  it('compacts and persists before ordinary generation, then releases the lease', async () => {
    const store = new MemoryStore();
    const statuses: Array<{ phase: string; code?: string }> = [];
    const { fetch, calls } = createFetch(
      store,
      [compactResponse('opaque-one'), normalResponse()],
      statuses,
    );
    const response = await fetch(URL, requestInput());
    const text = await response.text();

    expect(text).toContain('response.completed');
    expect(calls).toHaveLength(2);
    expect(store.saves).toHaveLength(2);
    expect(store.saves[0].opaque).toContain('opaque-one');
    expect(JSON.parse(String(calls[1].body)).input).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ type: 'compaction', encrypted_content: 'opaque-one' }),
    ]);
    expect(store.releases).toBe(1);
    expect(statuses.map((status) => status.phase)).toEqual(['started', 'completed']);
    expect(JSON.stringify(statuses)).not.toContain('opaque-one');
  });

  it('restores an exact covered prefix after a fresh gateway instance', async () => {
    const store = new MemoryStore();
    const first = createFetch(store, [compactResponse('opaque-reloaded'), normalResponse()]);
    await (await first.fetch(URL, requestInput())).text();

    const second = createFetch(store, [normalResponse()]);
    await (await second.fetch(URL, requestInput())).text();

    expect(second.calls).toHaveLength(1);
    expect(JSON.parse(String(second.calls[0].body)).input).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ type: 'compaction', encrypted_content: 'opaque-reloaded' }),
    ]);
  });

  it('replaces an older opaque item when a larger appended window triggers compaction again', async () => {
    const store = new MemoryStore();
    const first = createFetch(store, [compactResponse('opaque-old'), normalResponse()]);
    await (await first.fetch(URL, requestInput('first'))).text();

    const second = createFetch(store, [compactResponse('opaque-new'), normalResponse()]);
    await (await second.fetch(URL, requestInput('second'))).text();

    expect(second.calls).toHaveLength(2);
    const normalBody = JSON.parse(String(second.calls[1].body));
    expect(normalBody.input).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ type: 'compaction', encrypted_content: 'opaque-new' }),
    ]);
    expect(JSON.stringify(normalBody.input)).not.toContain('opaque-old');
  });

  it('uses verified projected usage when only a new tail is appended', async () => {
    const store = new MemoryStore();
    const first = createFetch(store, [compactResponse('opaque-projected'), normalResponse()], [], {
      maxContextTokens: 2000,
      triggerRatio: 0.15,
    });
    await (await first.fetch(URL, requestInput('A'.repeat(1600), true))).text();

    const second = createFetch(store, [normalResponse()], [], { maxContextTokens: 2000 });
    await (await second.fetch(URL, requestInput('A'.repeat(2000), true))).text();

    expect(second.calls).toHaveLength(1);
    expect(JSON.stringify(JSON.parse(String(second.calls[0].body)).input)).toContain(
      'opaque-projected',
    );
  });

  it('allows one bounded retry only for the approved context-length error', async () => {
    const store = new MemoryStore();
    const retryable = new Response(
      JSON.stringify({ type: 'invalid_request_error', code: 'context_length_exceeded' }),
      { status: 400 },
    );
    const { fetch, calls } = createFetch(
      store,
      [retryable, compactResponse('opaque'), normalResponse()],
      [],
      { maxContextTokens: 2000 },
    );
    await (await fetch(URL, requestInput('A'.repeat(1600), true))).text();
    expect(calls).toHaveLength(3);

    const nonRetryableStore = new MemoryStore();
    const nonRetryable = createFetch(nonRetryableStore, [
      new Response(JSON.stringify({ type: 'invalid_request_error', code: 'invalid_prompt' }), {
        status: 400,
      }),
    ]);
    await expect(nonRetryable.fetch(URL, requestInput())).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
  });

  it.each([false, true])(
    'stops repeated context errors after one compaction (proactive: %s)',
    async (proactive) => {
      const store = new MemoryStore();
      const contextError = (): Response =>
        new Response(
          JSON.stringify({ type: 'invalid_request_error', code: 'context_length_exceeded' }),
          { status: 400 },
        );
      const responses = proactive
        ? [compactResponse('opaque'), contextError()]
        : [contextError(), compactResponse('opaque'), contextError()];
      const { fetch, calls } = createFetch(store, responses, [], {
        maxContextTokens: proactive ? 50 : 2000,
      });
      await expect(fetch(URL, requestInput('A'.repeat(1600), true))).rejects.toMatchObject({
        code: 'context_too_large',
      });
      expect(calls).toHaveLength(proactive ? 2 : 3);
      expect(store.releases).toBe(1);
      expect(store.busy).toBe(false);
    },
  );

  it('rejects an empty persisted usage prefix without resending raw history', async () => {
    const store = new MemoryStore();
    const first = createFetch(store, [compactResponse('opaque'), normalResponse()]);
    await (await first.fetch(URL, requestInput())).text();
    if (!store.state?.usage) throw new Error('missing fixture usage');
    store.state.usage.inputHashes = [];
    const fresh = createFetch(store, [], [], { maxContextTokens: 2000 });
    await expect(fresh.fetch(URL, requestInput())).rejects.toMatchObject({
      code: 'persist_failed',
    });
    expect(fresh.calls).toHaveLength(0);
    expect(store.busy).toBe(false);
  });

  it('reports cancellation and releases a good persisted state', async () => {
    const store = new MemoryStore();
    const cancelled = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(event({ type: 'response.created' })));
        },
      }),
      { status: 200 },
    );
    const statuses: Array<{ phase: string; code?: string }> = [];
    const { fetch } = createFetch(store, [compactResponse('opaque'), cancelled], statuses);
    const response = await fetch(URL, requestInput());
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    expect(store.state?.opaque).toContain('opaque');
    expect(statuses.map((status) => status.phase)).toEqual(['started', 'completed']);
    expect(store.releases).toBe(1);

    const resumed = createFetch(store, [normalResponse()], [], { maxContextTokens: 500 });
    await (await resumed.fetch(URL, requestInput())).text();
    expect(resumed.calls).toHaveLength(1);
    expect(JSON.parse(String(resumed.calls[0].body)).input).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ type: 'compaction', encrypted_content: 'opaque' }),
    ]);
  });

  it('releases an active stream when the caller aborts before reading it', async () => {
    const store = new MemoryStore();
    const controller = new AbortController();
    const pending = new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode(event({ type: 'response.created' })));
        },
      }),
      { status: 200 },
    );
    const { fetch } = createFetch(store, [compactResponse('opaque'), pending]);
    await fetch(URL, { ...requestInput(), signal: controller.signal });
    controller.abort();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(store.releases).toBe(1);
  });

  it('does not send raw history while another execution owns the lease', async () => {
    const store = new MemoryStore();
    store.busy = true;
    const { fetch, calls } = createFetch(store, [normalResponse()]);

    await expect(fetch(URL, requestInput())).rejects.toMatchObject({ code: 'lease_busy' });
    expect(calls).toHaveLength(0);
  });

  it('supports explicit compact-only calls without a generation request', async () => {
    const store = new MemoryStore();
    const statuses: Array<{ phase: string; code?: string }> = [];
    const { fetch, calls } = createFetch(store, [compactResponse('manual')], statuses);

    await fetch.compactOnly(URL, requestInput());

    expect(calls).toHaveLength(1);
    expect(store.state?.opaque).toContain('manual');
    expect(store.state?.usage).toBeUndefined();
    expect(statuses.map((status) => status.phase)).toEqual(['started', 'completed']);
  });

  it('returns the verified provider compaction stream in compact-only mode', async () => {
    const store = new MemoryStore();
    const { fetch, calls } = createFetch(store, [compactResponse('wire')], [], {}, true);

    const response = await fetch(URL, requestInput());
    await expect(response.text()).resolves.toContain('encrypted_content');
    expect(calls).toHaveLength(1);
  });

  it('settles compact-only streams after completion without waiting for upstream EOF', async () => {
    const store = new MemoryStore();
    let cancelled = false;
    const { fetch } = createFetch(
      store,
      [hangingCompactResponse('hanging', () => (cancelled = true))],
      [],
      {},
      true,
    );

    const response = await Promise.race([
      fetch(URL, requestInput()),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('compact-only timeout')), 500);
      }),
    ]);
    await expect(response.text()).resolves.toContain('hanging');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(true);
  });
});
import { oauthCompactionConfigSchema } from 'librechat-data-provider';

it('admits a 260KB low-token first message with production defaults', async () => {
  const defaults = oauthCompactionConfigSchema.parse({ enabled: true });
  const input = requestInput('A'.repeat(260000));
  const { fetch, calls } = createFetch(new MemoryStore(), [normalResponse()], [], defaults);
  await (await fetch(URL, input)).text();
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toBe(input.body);
});

it('compacts at 85 percent before generation and emits both lifecycle markers', async () => {
  const statuses: Array<{ phase: string; code?: string }> = [];
  const { fetch, calls } = createFetch(
    new MemoryStore(),
    [compactResponse('opaque-budget'), normalResponse()],
    statuses,
    oauthCompactionConfigSchema.parse({ enabled: true }),
  );
  await (await fetch(URL, requestInput('word '.repeat(215000)))).text();
  expect(calls).toHaveLength(2);
  expect(JSON.parse(String(calls[0].body)).input.at(-1)).toEqual({ type: 'compaction_trigger' });
  expect(statuses.map((status) => status.phase)).toEqual(['started', 'completed']);
});

it('lets the provider confirm an oversized indivisible group before stopping', async () => {
  const statuses: Array<{ phase: string; code?: string }> = [];
  const store = new MemoryStore();
  const { fetch, calls } = createFetch(
    store,
    [
      Response.json(
        { type: 'invalid_request_error', code: 'context_length_exceeded' },
        { status: 413 },
      ),
    ],
    statuses,
    { maxContextTokens: 100 },
  );
  await expect(fetch(URL, requestInput('word '.repeat(1000)))).rejects.toMatchObject({
    code: 'context_too_large',
  });
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0].body)).input[0].content[0].text).toBe('word '.repeat(1000));
  expect(statuses[statuses.length - 1]).toMatchObject({
    phase: 'failed',
    code: 'context_too_large',
  });
  expect(store.releases).toBe(1);
});

it('includes instructions, tool schemas and output reserve in the compact trigger', async () => {
  const { fetch, calls } = createFetch(
    new MemoryStore(),
    [compactResponse('opaque'), normalResponse()],
    [],
    { maxContextTokens: 2000, outputReserveTokens: 1000 },
  );
  const request = requestInput('Hi');
  request.body = JSON.stringify({
    ...JSON.parse(String(request.body)),
    instructions: 'word '.repeat(500),
    tools: [
      {
        type: 'function',
        name: 'lookup',
        description: 'word '.repeat(500),
        parameters: { type: 'object' },
      },
    ],
  });
  await (await fetch(URL, request)).text();
  expect(calls).toHaveLength(2);
  expect(JSON.parse(String(calls[0].body)).tools).toEqual(JSON.parse(String(request.body)).tools);
});

it('selects a compact prefix only at complete function-call/result boundaries', async () => {
  const pair = (id: string, size: number) => [
    { type: 'function_call', call_id: id, name: 'lookup', arguments: '{}' },
    { type: 'function_call_output', call_id: id, output: 'word '.repeat(size) },
  ];
  const input = [...pair('first', 100), ...pair('second', 1000)];
  const { fetch, calls } = createFetch(
    new MemoryStore(),
    [compactResponse('opaque'), normalResponse()],
    [],
    { maxContextTokens: 500 },
  );
  await (
    await fetch(URL, {
      method: 'POST',
      headers: { 'chatgpt-account-id': ACCOUNT },
      body: body(input),
    })
  ).text();
  expect(JSON.parse(String(calls[0].body)).input).toEqual([
    ...input.slice(0, 2),
    { type: 'compaction_trigger' },
  ]);
  expect(JSON.parse(String(calls[1].body)).input).toEqual([
    { type: 'compaction', encrypted_content: 'opaque' },
    ...input.slice(2),
  ]);
});

it.each(['instructions', 'tools', 'model'])(
  'invalidates verified usage when %s changes',
  async (key) => {
    const store = new MemoryStore();
    const first = createFetch(store, [compactResponse('opaque-old'), normalResponse()]);
    await (await first.fetch(URL, requestInput())).text();
    const request = requestInput();
    request.body = JSON.stringify({
      ...JSON.parse(String(request.body)),
      [key]: key === 'tools' ? [{ type: 'function', name: 'changed' }] : 'changed',
    });
    const next = createFetch(store, [compactResponse('opaque-new'), normalResponse()]);
    await (await next.fetch(URL, request)).text();
    expect(next.calls).toHaveLength(2);
    expect(JSON.stringify(JSON.parse(String(next.calls[0].body)).input)).not.toContain(
      'opaque-old',
    );
  },
);

it('preserves confirmed overflow after a smaller-prefix compact retry succeeds', async () => {
  const statuses: Array<{ phase: string; code?: string; id?: string }> = [];
  const contextError = () =>
    Response.json(
      { type: 'invalid_request_error', code: 'context_length_exceeded' },
      { status: 400 },
    );
  const { fetch, calls } = createFetch(
    new MemoryStore(),
    [contextError(), compactResponse('opaque'), contextError()],
    statuses,
    { maxContextTokens: 2000 },
  );
  await expect(fetch(URL, requestInput('word '.repeat(3000), true))).rejects.toMatchObject({
    code: 'context_too_large',
  });
  expect(calls).toHaveLength(3);
  expect(JSON.parse(String(calls[1].body)).input.length).toBeLessThan(
    JSON.parse(String(calls[0].body)).input.length,
  );
  expect(statuses.map((status) => status.phase)).toEqual(['started', 'completed', 'failed']);
  expect(statuses[2]).toMatchObject({ code: 'context_too_large' });
  expect(statuses[2].id).not.toBe(statuses[1].id);
});
