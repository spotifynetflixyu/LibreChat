jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock('~/models', () => ({}));

const AgentClient = require('../client');
const { logger } = require('@librechat/data-schemas');

describe('AgentClient completion error logging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs bounded structured metadata for terminated errors and nested causes', async () => {
    const cause = new Error('provider stream stopped');
    cause.code = 'EPIPE';
    const terminated = new Error('terminated', { cause });
    terminated.status = 502;

    const agent = {};
    Object.defineProperty(agent, 'hide_sequential_outputs', {
      get() {
        throw terminated;
      },
    });

    const client = Object.create(AgentClient.prototype);
    client.options = {
      req: { config: {}, user: { id: 'user-1' }, body: {} },
      agent,
    };
    client.conversationId = 'conversation-1';
    client.contentParts = [];
    client.pendingSubagentEmits = [];
    client.artifactPromises = [];
    client.finalizeSubagentContent = jest.fn();
    client.settleActivityLabels = jest.fn().mockResolvedValue(undefined);
    client.awaitMemoryWithTimeout = jest.fn().mockResolvedValue(undefined);
    client.recordCollectedUsage = jest.fn().mockResolvedValue(undefined);
    client.getEncoding = jest.fn(() => 'o200k_base');

    await client.chatCompletion({ payload: [] });

    expect(logger.error).toHaveBeenCalledWith(
      '[api/server/controllers/agents/client.js #sendCompletion] Unhandled error',
      { type: 'Error', status: 502 },
    );
    expect(logger.error.mock.calls[0][1]).not.toHaveProperty('message');
    expect(logger.error.mock.calls[0][1]).not.toHaveProperty('stack');
    expect(logger.error.mock.calls[0][1]).not.toHaveProperty('cause');
    expect(logger.error.mock.calls[0][1]).not.toHaveProperty('request');
    expect(logger.error.mock.calls[0][1]).not.toHaveProperty('user');
    expect(client.contentParts).toEqual([
      expect.objectContaining({
        error: expect.stringContaining('terminated'),
      }),
    ]);
  });

  it('caps oversized fields and handles cyclic causes without expanding the log', async () => {
    const terminated = new Error(`terminated-${'m'.repeat(50_000)}`);
    terminated.stack = `stack-${'s'.repeat(100_000)}`;
    terminated.cause = terminated;

    const agent = {};
    Object.defineProperty(agent, 'hide_sequential_outputs', {
      get() {
        throw terminated;
      },
    });

    const client = Object.create(AgentClient.prototype);
    client.options = {
      req: { config: {}, user: { id: 'user-1' }, body: {} },
      agent,
    };
    client.conversationId = 'conversation-1';
    client.contentParts = [];
    client.pendingSubagentEmits = [];
    client.artifactPromises = [];
    client.finalizeSubagentContent = jest.fn();
    client.settleActivityLabels = jest.fn().mockResolvedValue(undefined);
    client.awaitMemoryWithTimeout = jest.fn().mockResolvedValue(undefined);
    client.recordCollectedUsage = jest.fn().mockResolvedValue(undefined);
    client.getEncoding = jest.fn(() => 'o200k_base');

    await client.chatCompletion({ payload: [] });

    const loggedError = logger.error.mock.calls[0][1];
    expect(loggedError).toEqual({ type: 'Error' });
    expect(loggedError).not.toHaveProperty('message');
    expect(loggedError).not.toHaveProperty('stack');
    expect(loggedError).not.toHaveProperty('cause');
    expect(loggedError).not.toHaveProperty('request');
    expect(loggedError).not.toHaveProperty('user');
  });
});
