import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { oauthCompactionConfigSchema } from 'librechat-data-provider';
import { createOAuthCompactionModel, createOAuthCompactionMethods } from '@librechat/data-schemas';
import type { OAuthCompactionStore } from '@librechat/data-schemas';
import type { TContextUsageEvent } from 'librechat-data-provider';
import type { JSONObject, JSONArray } from '@ai-sdk/provider';
import type { OpenAIOAuthFetch } from '~/steel/native/credentials';
import type { TextTokenCounter } from './budget';
import { createOAuthCompactionFetch } from './gateway';
import { estimateContextTokens } from './runtime';
import Tokenizer from '~/utils/tokenizer';

const url = 'https://oauth.example/responses';
const opaque = { type: 'compaction', encrypted_content: 'private-state', id: 'cmp-1' };
const config = oauthCompactionConfigSchema.parse({
  enabled: true,
  maxContextTokens: 8192,
  outputReserveTokens: 1024,
  triggerRatio: 0.75,
});
const scope = {
  tenantId: 'tenant',
  userId: 'user',
  conversationId: 'conversation',
  agentId: 'agent',
  executionId: 'main',
};
const history: JSONArray = [
  { role: 'user', content: [{ type: 'input_text', text: 'Please calculate.' }] },
  { type: 'function_call', call_id: 'call-1', name: 'calculate', arguments: '{}' },
  { type: 'function_call_output', call_id: 'call-1', output: '42 '.repeat(3000) },
];
const event = (data: JSONObject): string => `data: ${JSON.stringify(data)}\n\n`;
const completed = event({
  type: 'response.completed',
  response: {
    status: 'completed',
    output: [],
    usage: { input_tokens: 80, output_tokens: 5, total_tokens: 85 },
  },
});
const normalResponse = (): Response =>
  new Response(completed, {
    headers: { 'content-type': 'text/event-stream' },
  });
const compactResponse = (): Response =>
  new Response(event({ type: 'response.output_item.done', item: opaque }) + completed, {
    headers: { 'content-type': 'text/event-stream' },
  });
function request(input: JSONArray): RequestInit {
  return {
    method: 'POST',
    headers: { 'chatgpt-account-id': 'account' },
    body: JSON.stringify({
      model: 'gpt-6.1-sol',
      instructions: 'Keep accurate.',
      stream: true,
      store: false,
      input,
    }),
  };
}
function wire(init?: RequestInit): JSONArray {
  return (JSON.parse(String(init?.body)) as { input: JSONArray }).input;
}
const provider: OpenAIOAuthFetch = async (_input, init) => {
  const lastItem = wire(init)[wire(init).length - 1];
  return JSON.stringify(lastItem).includes('compaction_trigger')
    ? compactResponse()
    : normalResponse();
};
let countText: TextTokenCounter;
let mongo: MongoMemoryServer;
let store: OAuthCompactionStore;
let model: ReturnType<typeof createOAuthCompactionModel>;
beforeAll(async () => {
  countText = await Tokenizer.createExactTokenCounter('o200k_base');
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  model = createOAuthCompactionModel(mongoose);
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  store = createOAuthCompactionMethods(mongoose);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it('restores after a fresh service instance and only appends the new tail', async () => {
  const sent: JSONArray[] = [];
  const phases: string[] = [];
  const snapshots: TContextUsageEvent[] = [];
  const fetch: OpenAIOAuthFetch = async (input, init) => {
    const inputItems = wire(init);
    sent.push(inputItems);
    if (!JSON.stringify(inputItems[inputItems.length - 1]).includes('compaction_trigger')) {
      expect(snapshots).toHaveLength(sent.length - 1);
    }
    return provider(input, init);
  };
  const first = createOAuthCompactionFetch({
    fetch,
    store,
    config,
    scope,
    onContextUsage: (usage) => {
      snapshots.push(usage);
    },
    onStatus: (status) => {
      phases.push(status.phase);
    },
  });
  await (await first(url, request(history))).text();
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual([history[0], opaque]);
  expect(phases).toEqual(['started', 'completed']);
  expect((await model.findOne().lean())?.opaque).toBeUndefined();
  const restored = createOAuthCompactionFetch({
    fetch,
    store: createOAuthCompactionMethods(mongoose),
    config,
    scope,
    onContextUsage: (usage) => {
      snapshots.push(usage);
    },
    onStatus: (status) => {
      phases.push(status.phase);
    },
  });
  const tail = { role: 'user', content: 'What was the result?' };
  await (await restored(url, request([...history, tail]))).text();
  expect(sent).toHaveLength(3);
  expect(sent[2]).toEqual([history[0], opaque, tail]);
  expect(phases).toEqual(['started', 'completed']);
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0].oauthCompaction?.inputTokens).toBeLessThan(
    estimateContextTokens(history, 0, countText),
  );
  expect(snapshots[1].oauthCompaction).toEqual({
    inputTokens: 80 + estimateContextTokens([tail], 0, countText),
    isEstimate: true,
  });
  expect(snapshots[1].contextBudget).toBe(7168);
  expect(JSON.stringify(snapshots)).not.toContain('private-state');
  expect(JSON.stringify(snapshots)).not.toContain('42 42');
  const exactRestored = createOAuthCompactionFetch({
    fetch,
    store: createOAuthCompactionMethods(mongoose),
    config,
    scope,
    onContextUsage: (usage) => {
      snapshots.push(usage);
    },
  });
  await (await exactRestored(url, request([...history, tail]))).text();
  expect(sent).toHaveLength(4);
  expect(snapshots[2].oauthCompaction).toEqual({ inputTokens: 80, isEstimate: false });
  expect(phases).toEqual(['started', 'completed']);
});

it('saves verified input usage before releasing a cancelled completed response', async () => {
  let finishSave = (): void => undefined;
  const saveReady = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  const delayedStore: OAuthCompactionStore = {
    ...store,
    saveOAuthCompaction: async (input) => {
      if (input.state.usage) await saveReady;
      return store.saveOAuthCompaction(input);
    },
  };
  const controller = new AbortController();
  let calls = 0;
  const fetch = createOAuthCompactionFetch({
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? compactResponse()
        : new Response(
            new ReadableStream<Uint8Array>({
              start(streamController) {
                streamController.enqueue(new TextEncoder().encode(completed));
              },
            }),
          );
    },
    store: delayedStore,
    config,
    scope,
  });
  const response = await fetch(url, { ...request(history), signal: controller.signal });
  const reader = response.body!.getReader();
  await reader.read();
  controller.abort();
  const cancelled = reader.cancel();
  finishSave();
  await cancelled;
  const saved = await model.findOne().lean();
  expect(saved?.usage?.inputTokens).toBe(80);
  expect(saved?.ownerId).toBeUndefined();
});

it('retains compact when generation is cancelled before verified usage', async () => {
  let calls = 0;
  const fetch: OpenAIOAuthFetch = async () => {
    calls += 1;
    return calls === 1 ? compactResponse() : new Response(new ReadableStream<Uint8Array>());
  };
  const first = createOAuthCompactionFetch({
    fetch,
    store,
    config,
    scope,
  });
  const controller = new AbortController();
  const response = await first(url, { ...request(history), signal: controller.signal });
  controller.abort();
  await response.body?.cancel();
  const saved = await model.findOne().select('+opaque').lean();
  expect(saved?.opaque).toBe(JSON.stringify(opaque));
  expect(saved?.usage).toBeUndefined();
  const sent: JSONArray[] = [];
  const restored = createOAuthCompactionFetch({
    fetch: async (_input, init) => {
      sent.push(wire(init));
      return normalResponse();
    },
    store: createOAuthCompactionMethods(mongoose),
    config,
    scope,
  });
  await (await restored(url, request(history))).text();
  expect(sent).toEqual([[history[0], opaque]]);
});

it.each([
  ['tenant', { tenantId: 'other' }],
  ['user', { userId: 'other' }],
  ['conversation', { conversationId: 'other' }],
  ['agent', { agentId: 'other' }],
  ['child execution', { executionId: 'child' }],
])('isolates a different %s', async (_name, overrides) => {
  await (
    await createOAuthCompactionFetch({ fetch: provider, store, config, scope })(
      url,
      request(history),
    )
  ).text();
  const sent: JSONArray[] = [];
  const other = createOAuthCompactionFetch({
    fetch: async (_input, init) => {
      sent.push(wire(init));
      return normalResponse();
    },
    store,
    config: { ...config, maxContextTokens: 100000 },
    scope: { ...scope, ...overrides },
  });
  await (await other(url, request(history))).text();
  expect(sent).toEqual([history]);
});

it('invalidates edits to the covered prefix', async () => {
  await (
    await createOAuthCompactionFetch({ fetch: provider, store, config, scope })(
      url,
      request(history),
    )
  ).text();
  const edited = [{ role: 'user', content: 'Changed request' }, ...history.slice(1)];
  const sent: JSONArray[] = [];
  const fresh = createOAuthCompactionFetch({
    fetch: async (_input, init) => {
      sent.push(wire(init));
      return normalResponse();
    },
    store,
    config: { ...config, maxContextTokens: 100000 },
    scope,
  });
  await (await fresh(url, request(edited))).text();
  expect(sent).toEqual([edited]);
});

it('constructs the OAuth model through the real SDK registry, including isolated child calls', async () => {
  const { initializeModel, Run } = await import('@librechat/agents');
  const { HumanMessage, AIMessage, ToolMessage } = await import('@langchain/core/messages');
  const { registerOAuthCompactionProvider, oauthCompactionProvider } = await import('./model');
  registerOAuthCompactionProvider();
  const sent: JSONArray[] = [];
  const phases: string[] = [];
  const fetch: OpenAIOAuthFetch = async (input, init) => {
    const endpoint = String(input instanceof Request ? input.url : input);
    if (endpoint.includes('/models')) {
      return new Response(
        JSON.stringify({
          models: [{ slug: 'gpt-6.1-sol', supported_in_api: true, visibility: 'list' }],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    sent.push(wire(init));
    if (JSON.stringify(wire(init)[wire(init).length - 1]).includes('compaction_trigger')) {
      return compactResponse();
    }
    return new Response(
      event({
        type: 'response.created',
        response: {
          id: 'resp-test',
          created_at: 1,
          model: 'gpt-6.1-sol',
          status: 'in_progress',
        },
      }) +
        event({ type: 'response.output_text.delta', item_id: 'msg-test', delta: 'ok' }) +
        completed +
        'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };
  const options = {
    oauthRunId: 'run',
    model: 'gpt-6.1-sol',
    oauth: {
      model: 'gpt-6.1-sol',
      reasoningEffort: 'high',
      enableCodeInterpreter: false,
      fetch,
      loadAuthTokens: async () => ({
        accessToken: 'synthetic-access',
        accountId: 'account',
        sourcePath: '/tmp/synthetic-auth.json',
      }),
      compaction: { store, config, scope },
    },
  };
  const messages = [
    new HumanMessage('Please calculate.'),
    new AIMessage({
      content: '',
      tool_calls: [{ id: 'call-1', name: 'calculate', args: {} }],
    }),
    new ToolMessage({ tool_call_id: 'call-1', content: '42 '.repeat(3000) }),
  ];
  const model = initializeModel({ provider: oauthCompactionProvider, clientOptions: options });
  const snapshots: TContextUsageEvent[] = [];
  const callbacks = [
    {
      handleCustomEvent: (name: string, data: TContextUsageEvent & { phase?: string }) => {
        if (name === 'on_context_usage') {
          snapshots.push(data);
        }
        if (name === 'on_context_compaction' && data.phase) {
          phases.push(data.phase);
        }
      },
    },
  ];
  expect((await model.invoke(messages, { callbacks })).content).toBe('ok');
  expect(sent).toHaveLength(2);
  expect(JSON.stringify(sent[1])).not.toContain('function_call_output');
  expect(phases).toEqual(['started', 'completed']);
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({ runId: 'run', agentId: 'agent', contextBudget: 7168 });
  expect(snapshots[0].oauthCompaction?.isEstimate).toBe(true);
  const restored = initializeModel({ provider: oauthCompactionProvider, clientOptions: options });
  await restored.invoke([...messages, new HumanMessage('Continue')]);
  expect(sent).toHaveLength(3);
  const graphRun = await Run.create({
    runId: 'real-graph',
    graphConfig: {
      type: 'standard',
      agents: [
        {
          agentId: 'agent',
          provider: oauthCompactionProvider,
          clientOptions: options,
          contextPruningConfig: { enabled: false },
          summarizationEnabled: false,
        },
      ],
    },
  });
  await graphRun.processStream(
    { messages: [...messages, new HumanMessage('Continue')] },
    {
      configurable: { thread_id: 'conversation' },
      recursionLimit: 10,
      version: 'v2',
    },
  );
  expect(sent).toHaveLength(5);
  expect(
    sent[4]?.some(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        item.type === 'function_call_output',
    ),
  ).toBe(false);
  const refreshedGraph = await Run.create({
    runId: 'refreshed-graph',
    graphConfig: {
      type: 'standard',
      agents: [
        {
          agentId: 'agent',
          provider: oauthCompactionProvider,
          clientOptions: options,
          contextPruningConfig: { enabled: false },
          summarizationEnabled: false,
        },
      ],
    },
  });
  await refreshedGraph.processStream(
    {
      messages: [
        ...messages,
        new HumanMessage('Continue'),
        new HumanMessage('Continue after refresh'),
      ],
    },
    {
      configurable: { thread_id: 'conversation' },
      recursionLimit: 10,
      version: 'v2',
    },
  );
  expect(sent).toHaveLength(6);
  expect(JSON.stringify(sent[5])).not.toContain('function_call_output');
  expect(JSON.stringify(sent[5])).toContain('private-state');
  const { createOAuthCompactionEventHandler } = await import('./events');
  const hiddenParts: import('librechat-data-provider').TMessageContentParts[] = [];
  const hiddenEmit = jest.fn(async () => undefined);
  const childContextUsage = jest.fn(async () => undefined);
  const hiddenHandler = createOAuthCompactionEventHandler({
    contentParts: hiddenParts,
    emitForJob: hiddenEmit,
  });
  const child = initializeModel({
    provider: oauthCompactionProvider,
    clientOptions: {
      ...options,
      oauthSubagent: true,
      oauth: {
        ...options.oauth,
        compaction: {
          ...options.oauth.compaction,
          onContextUsage: childContextUsage,
          onStatus: (event, metadata) =>
            hiddenHandler.handle(
              'on_context_compaction',
              { input: { ...event, runId: 'run' } },
              metadata,
            ),
        },
      },
    },
  });
  await child.invoke(messages, {
    configurable: {
      hide_sequential_outputs: true,
      last_agent_id: 'other',
      executionContext: {
        ancestry: [{ subagentRunId: 'child-execution' }],
      },
    },
  });
  expect(sent).toHaveLength(8);
  expect(await modelCollectionCount()).toBe(2);
  expect(hiddenEmit).not.toHaveBeenCalled();
  expect(childContextUsage).not.toHaveBeenCalled();
  expect(hiddenParts).toEqual([]);
  const manual = initializeModel({
    provider: oauthCompactionProvider,
    clientOptions: {
      ...options,
      oauth: {
        ...options.oauth,
        compaction: {
          ...options.oauth.compaction,
          compactOnly: true,
          scope: { ...scope, conversationId: 'manual-conversation' },
        },
      },
    },
  });
  const manualResult = await manual.invoke(messages);
  expect(manualResult.content).toBe('');
  expect(JSON.stringify(manualResult)).not.toContain('private-state');
  expect(sent).toHaveLength(9);
});

async function modelCollectionCount(): Promise<number> {
  return mongoose.connection.collection('oauthcompactions').countDocuments();
}
