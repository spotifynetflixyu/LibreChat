import { HumanMessage } from '@librechat/agents/langchain/messages';
import { createRun, getLatestHumanMessageText } from '~/agents/run';

/**
 * Guards the code-tool eager/session wiring in `createRun`. The whole
 * create_file -> bash_tool sandbox-sharing chain depends on run.ts passing
 * `codeSessionToolNames` (so file-authoring tools share the code session) and
 * `excludeToolNames` (so side-effecting/large-arg tools aren't eager-executed).
 * These were silently missing before and only surfaced with both the
 * file-authoring and code-execution capabilities enabled — assert they're wired
 * so a future edit can't drop them without failing CI.
 */

jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  })),
  format: Object.assign(
    jest.fn((fn) => () => ({ transform: fn })),
    {
      combine: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn(),
      label: jest.fn(),
      timestamp: jest.fn(),
      printf: jest.fn(),
      errors: jest.fn(),
      splat: jest.fn(),
      json: jest.fn(),
    },
  ),
  addColors: jest.fn(),
  transports: { Console: jest.fn(), DailyRotateFile: jest.fn(), File: jest.fn() },
}));

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@librechat/agents', () => {
  const actual = jest.requireActual('@librechat/agents');
  return {
    ...actual,
    Run: {
      create: jest.fn().mockResolvedValue({
        processStream: jest.fn().mockResolvedValue(undefined),
      }),
    },
  };
});

jest.mock('~/agents/checkpointer', () => ({
  getAgentCheckpointer: jest.fn().mockResolvedValue({}),
}));

import { Run } from '@librechat/agents';

function makeAgent(overrides?: Record<string, unknown>) {
  return {
    id: 'agent_1',
    provider: 'openAI',
    endpoint: 'openAI',
    model: 'gpt-4o',
    tools: [],
    model_parameters: { model: 'gpt-4o' },
    maxContextTokens: 100_000,
    toolContextMap: {},
    ...overrides,
  };
}

async function captureRunConfig(agent = makeAgent()): Promise<Record<string, unknown>> {
  await createRun({
    agents: [agent] as never,
    signal: new AbortController().signal,
    streaming: true,
    streamUsage: true,
  });
  const createMock = Run.create as jest.Mock;
  expect(createMock).toHaveBeenCalledTimes(1);
  return createMock.mock.calls[0][0] as Record<string, unknown>;
}

describe('createRun code-tool eager/session wiring', () => {
  beforeEach(() => jest.clearAllMocks());

  it('excludes side-effecting/large-arg tools from eager execution', async () => {
    const runConfig = await captureRunConfig();
    const eager = runConfig.eagerEventToolExecution as {
      enabled?: boolean;
      excludeToolNames?: string[];
    };
    expect(eager.enabled).toBe(true);
    expect(eager.excludeToolNames).toEqual(
      expect.arrayContaining(['create_file', 'edit_file', 'execute_code', 'bash_tool']),
    );
  });

  it('declares create_file/edit_file/read_file as code-session participants', async () => {
    const runConfig = await captureRunConfig();
    expect(runConfig.codeSessionToolNames).toEqual(
      expect.arrayContaining(['create_file', 'edit_file', 'read_file']),
    );
  });

  it('filters quote-only delegate_ocr from AgentInputs collections before provider binding', async () => {
    const delegate = { name: 'delegate_ocr', description: 'delegate', parameters: {} };
    const search = { name: 'search_customers', description: 'search', parameters: {} };
    const price = { name: 'search_price_candidates', description: 'price', parameters: {} };
    const agent = makeAgent({
      tools: [delegate, search, price],
      toolDefinitions: [delegate, search, price],
      toolRegistry: new Map([
        [delegate.name, delegate],
        [search.name, search],
        [price.name, price],
      ]),
    });

    await createRun({
      agents: [agent] as never,
      signal: new AbortController().signal,
      messages: [new HumanMessage({ content: [{ type: 'text', text: '請幫我報個價' }] })],
      streaming: true,
      streamUsage: true,
    });

    const runConfig = (Run.create as jest.Mock).mock.calls[0][0] as {
      graphConfig: { agents: Array<Record<string, unknown>> };
    };
    const input = runConfig.graphConfig.agents[0];
    expect((input.tools as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'search_customers',
      'search_price_candidates',
    ]);
    expect((input.toolDefinitions as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'search_customers',
      'search_price_candidates',
    ]);
    expect(Array.from((input.toolRegistry as Map<string, unknown>).keys())).toEqual([
      'search_customers',
      'search_price_candidates',
    ]);
  });

  it('removes delegate_ocr but retains search tools for mixed inspection and quote requests', async () => {
    const delegate = { name: 'delegate_ocr', description: 'delegate', parameters: {} };
    const customerSearch = { name: 'search_customers', description: 'customer', parameters: {} };
    const priceSearch = {
      name: 'search_price_candidates',
      description: 'price',
      parameters: {},
    };
    const agent = makeAgent({
      tools: [delegate, customerSearch, priceSearch],
      toolDefinitions: [delegate, customerSearch, priceSearch],
      toolRegistry: new Map([
        [delegate.name, delegate],
        [customerSearch.name, customerSearch],
        [priceSearch.name, priceSearch],
      ]),
    });

    await createRun({
      agents: [agent] as never,
      signal: new AbortController().signal,
      messages: [new HumanMessage('重新核對第35頁孔數後報價')],
      streaming: true,
      streamUsage: true,
    });

    const runConfig = (Run.create as jest.Mock).mock.calls[0][0] as {
      graphConfig: { agents: Array<Record<string, unknown>> };
    };
    const input = runConfig.graphConfig.agents[0];
    expect((input.toolDefinitions as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'search_customers',
      'search_price_candidates',
    ]);
    expect((input.toolRegistry as Map<string, unknown>).has('delegate_ocr')).toBe(false);
  });

  it('retains delegate_ocr when the quote phrase is explicitly negated', async () => {
    const delegate = { name: 'delegate_ocr', description: 'delegate', parameters: {} };
    const agent = makeAgent({
      tools: [delegate],
      toolDefinitions: [delegate],
      toolRegistry: new Map([[delegate.name, delegate]]),
    });

    await createRun({
      agents: [agent] as never,
      signal: new AbortController().signal,
      messages: [new HumanMessage('先不要再報價，請重新核對附件')],
      streaming: true,
      streamUsage: true,
    });

    const runConfig = (Run.create as jest.Mock).mock.calls[0][0] as {
      graphConfig: { agents: Array<Record<string, unknown>> };
    };
    const input = runConfig.graphConfig.agents[0];
    expect((input.toolDefinitions as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'delegate_ocr',
    ]);
    expect((input.toolRegistry as Map<string, unknown>).has('delegate_ocr')).toBe(true);
  });

  it('extracts latest human text from string and array content', () => {
    expect(
      getLatestHumanMessageText([
        new HumanMessage('舊問題'),
        new HumanMessage({ content: [{ type: 'text', text: '報價' }] }),
      ]),
    ).toBe('報價');
  });

  it('applies explicit quote-only override when resuming with empty messages and deferred tools', async () => {
    const delegate = { name: 'delegate_ocr', description: 'delegate', parameters: {} };
    const agent = makeAgent({
      tools: [delegate],
      toolDefinitions: [delegate],
      toolRegistry: new Map([[delegate.name, delegate]]),
      hasDeferredTools: true,
    });

    await createRun({
      agents: [agent] as never,
      signal: new AbortController().signal,
      messages: [],
      discoveredToolNames: ['delegate_ocr'],
      delegateOcrQuoteOnlyTurn: true,
      streaming: true,
      streamUsage: true,
    });

    const runConfig = (Run.create as jest.Mock).mock.calls[0][0] as {
      graphConfig: { agents: Array<Record<string, unknown>> };
    };
    const input = runConfig.graphConfig.agents[0];
    expect(input.tools).toEqual([]);
    expect(input.toolDefinitions).toEqual([]);
    expect((input.toolRegistry as Map<string, unknown>).size).toBe(0);
  });

  it('keeps delegate_ocr when explicit resume quote-only override is false', async () => {
    const delegate = { name: 'delegate_ocr', description: 'delegate', parameters: {} };
    const agent = makeAgent({
      tools: [delegate],
      toolDefinitions: [delegate],
      toolRegistry: new Map([[delegate.name, delegate]]),
    });

    await createRun({
      agents: [agent] as never,
      signal: new AbortController().signal,
      messages: [],
      delegateOcrQuoteOnlyTurn: false,
      streaming: true,
      streamUsage: true,
    });

    const runConfig = (Run.create as jest.Mock).mock.calls[0][0] as {
      graphConfig: { agents: Array<Record<string, unknown>> };
    };
    const input = runConfig.graphConfig.agents[0];
    expect((input.toolDefinitions as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'delegate_ocr',
    ]);
    expect((input.toolRegistry as Map<string, unknown>).has('delegate_ocr')).toBe(true);
  });
  it('passes the trusted per-agent code-session partition to the SDK', async () => {
    const codeSessionKey = 'execute_code:stateful:v1:user';
    const runConfig = await captureRunConfig(makeAgent({ codeSessionKey }));
    const [agentInput] = (runConfig.graphConfig as { agents: Array<Record<string, unknown>> })
      .agents;
    expect(agentInput.codeSessionKey).toBe(codeSessionKey);
  });
});
