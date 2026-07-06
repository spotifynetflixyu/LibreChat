const { EventEmitter } = require('events');

const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

const mockGenerationJobManager = {
  createJob: jest.fn(),
  emitChunk: jest.fn(),
  emitDone: jest.fn(),
  emitError: jest.fn(),
  completeJob: jest.fn(),
  getJob: jest.fn(),
  getResumeState: jest.fn(),
  updateMetadata: jest.fn(),
};

const mockCheckAndIncrementPendingRequest = jest.fn();
const mockDecrementPendingRequest = jest.fn();
const mockFilterPersistableAbortContent = jest.fn((content) =>
  content.filter((part) => part?.type !== 'tool_call'),
);
const mockGetConvo = jest.fn();
const mockGetMessages = jest.fn();
const mockSaveConvo = jest.fn();
const mockSaveMessage = jest.fn();
let mockMCPContexts = new WeakMap();

const mockCreateMCPRequestContext = jest.fn(() => ({
  connections: new Map(),
  pending: new Map(),
  cleanupStarted: false,
  cleanupOnResponse: false,
  responseCleanupAttached: false,
}));
const mockGetMCPRequestContext = jest.fn((req) => {
  if (!req) {
    return undefined;
  }

  let context = mockMCPContexts.get(req);
  if (!context) {
    context = mockCreateMCPRequestContext();
    mockMCPContexts.set(req, context);
  }

  return context.cleanupStarted ? undefined : context;
});
const mockCleanupMCPRequestContext = jest.fn(async (context) => {
  if (!context || context.cleanupStarted) {
    return;
  }

  context.cleanupStarted = true;
  const connections = new Set(context.connections.values());
  const settled = await Promise.allSettled(context.pending.values());
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) {
      connections.add(result.value);
    }
  }

  await Promise.allSettled(Array.from(connections).map((connection) => connection.disconnect?.()));
  context.connections.clear();
  context.pending.clear();
});
const mockCleanupMCPRequestContextForReq = jest.fn(async (req) => {
  const context = mockMCPContexts.get(req);
  if (!context) {
    return;
  }

  try {
    await mockCleanupMCPRequestContext(context);
  } finally {
    mockMCPContexts.delete(req);
  }
});

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
}));

jest.mock('@librechat/api', () => ({
  sendEvent: jest.fn(),
  getViolationInfo: jest.fn(),
  buildMessageFiles: jest.fn(() => []),
  resolveTitleTiming: jest.fn(() => 'immediate'),
  GenerationJobManager: mockGenerationJobManager,
  getReferencedQuotes: jest.fn((quotes) => {
    if (!Array.isArray(quotes)) {
      return null;
    }
    const normalized = quotes
      .filter((quote) => typeof quote === 'string' && quote.trim().length > 0)
      .map((quote) => quote.trim());
    return normalized.length > 0 ? normalized : null;
  }),
  cleanupMCPRequestContext: (...args) => mockCleanupMCPRequestContext(...args),
  createMCPRequestContext: (...args) => mockCreateMCPRequestContext(...args),
  getMCPRequestContext: (...args) => mockGetMCPRequestContext(...args),
  filterPersistableAbortContent: (...args) => mockFilterPersistableAbortContent(...args),
  cleanupMCPRequestContextForReq: (...args) => mockCleanupMCPRequestContextForReq(...args),
  decrementPendingRequest: (...args) => mockDecrementPendingRequest(...args),
  sanitizeMessageForTransmit: jest.fn((message) => message),
  checkAndIncrementPendingRequest: (...args) => mockCheckAndIncrementPendingRequest(...args),
  isUnpersistedPreliminaryParent: async ({
    userId,
    conversationId,
    parentMessageId,
    getMessages,
  }) => {
    if (typeof parentMessageId !== 'string' || !parentMessageId.endsWith('_')) {
      return false;
    }

    const filter = { user: userId, messageId: parentMessageId };
    if (conversationId && conversationId !== 'new') {
      filter.conversationId = conversationId;
    }

    const messages = await getMessages(filter, '_id');
    return messages.length === 0;
  },
}));

jest.mock('~/server/cleanup', () => ({
  disposeClient: jest.fn(),
  clientRegistry: null,
  requestDataMap: {
    set: jest.fn(),
  },
}));

jest.mock('~/server/middleware', () => ({
  handleAbortError: jest.fn(() => Promise.resolve()),
}));

jest.mock('~/cache', () => ({
  logViolation: jest.fn(),
}));

jest.mock('~/models', () => ({
  saveConvo: (...args) => mockSaveConvo(...args),
  saveMessage: (...args) => mockSaveMessage(...args),
  getMessages: (...args) => mockGetMessages(...args),
  getConvo: (...args) => mockGetConvo(...args),
}));

const AgentController = require('../request');
const { getMCPRequestContext } = require('~/server/services/MCPRequestContext');

function createResumableResponse() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.writableEnded = false;
  res.finished = false;
  res.destroyed = false;
  res.json = jest.fn(() => {
    res.headersSent = true;
    res.writableEnded = true;
    res.finished = true;
    res.emit('finish');
    return res;
  });
  res.status = jest.fn(() => res);
  return res;
}

function nextTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitForExpectation(assertion) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await nextTick();
    }
  }
  throw lastError;
}

describe('ResumableAgentController resume metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMCPContexts = new WeakMap();
    mockCheckAndIncrementPendingRequest.mockResolvedValue({ allowed: true });
    mockDecrementPendingRequest.mockResolvedValue(undefined);
    mockGetConvo.mockResolvedValue({ createdAt: '2026-06-07T00:00:00.000Z' });
    mockGetMessages.mockResolvedValue([]);
    mockSaveConvo.mockResolvedValue({});
    mockGenerationJobManager.createJob.mockResolvedValue({
      createdAt: 1000,
      readyPromise: Promise.resolve(),
      abortController: new AbortController(),
      emitter: { on: jest.fn() },
    });
    mockGenerationJobManager.getResumeState.mockResolvedValue(null);
    mockGenerationJobManager.updateMetadata.mockResolvedValue(undefined);
    mockGenerationJobManager.emitChunk.mockResolvedValue(undefined);
    mockGenerationJobManager.emitDone.mockResolvedValue(undefined);
    mockGenerationJobManager.emitError.mockResolvedValue(undefined);
    mockGenerationJobManager.getJob.mockResolvedValue({ createdAt: 1000 });
    mockSaveMessage.mockResolvedValue({});
  });

  it('rejects an underscore-suffixed parent that is not persisted', async () => {
    const conversationId = 'conversation-123';
    const initializeClient = jest.fn();
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Follow up too early.',
        messageId: 'follow-up-user',
        parentMessageId: 'pending-response_',
        conversationId,
        endpointOption: {
          endpoint: 'agents',
          modelOptions: { model: 'gpt-3.5-turbo' },
        },
      },
      config: {},
    };
    const res = {
      json: jest.fn(),
      status: jest.fn(() => res),
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);

    expect(mockGetMessages).toHaveBeenCalledWith(
      { user: 'user-123', messageId: 'pending-response_', conversationId },
      '_id',
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('selected parent response is still being saved'),
      }),
    );
    expect(mockCheckAndIncrementPendingRequest).not.toHaveBeenCalled();
    expect(mockGenerationJobManager.createJob).not.toHaveBeenCalled();
    expect(initializeClient).not.toHaveBeenCalled();
  });

  it('allows an underscore-suffixed parent when it is already persisted', async () => {
    const conversationId = 'conversation-123';
    mockGetMessages.mockResolvedValue([{ _id: 'persisted-parent' }]);
    const initializeClient = jest.fn().mockRejectedValue(new Error('stop before tool loading'));
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Follow up to persisted underscore id.',
        messageId: 'follow-up-user',
        parentMessageId: 'persisted-response_',
        conversationId,
        endpointOption: {
          endpoint: 'agents',
          modelOptions: { model: 'gpt-3.5-turbo' },
        },
      },
      config: {},
    };
    const res = {
      headersSent: true,
      json: jest.fn(() => {
        res.headersSent = true;
      }),
      status: jest.fn(() => res),
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);

    expect(mockGetMessages).toHaveBeenCalledWith(
      { user: 'user-123', messageId: 'persisted-response_', conversationId },
      '_id',
    );
    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(mockCheckAndIncrementPendingRequest).toHaveBeenCalledWith('user-123');
    expect(mockGenerationJobManager.createJob).toHaveBeenCalledWith(
      conversationId,
      'user-123',
      conversationId,
    );
  });

  it('persists a new conversation shell before returning the generated stream id', async () => {
    const initializeClient = jest.fn().mockRejectedValue(new Error('stop before tool loading'));
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'OCR this PDF before replying.',
        messageId: 'file-user-message',
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        endpointOption: {
          endpoint: 'openai_oauth_responses',
          iconURL: 'openai',
          modelOptions: { model: 'gpt-5.5' },
        },
      },
      config: {},
    };
    const res = createResumableResponse();

    await AgentController(req, res, jest.fn(), initializeClient, null);

    const { conversationId } = res.json.mock.calls[0][0];
    expect(mockSaveConvo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123' }),
      expect.objectContaining({
        conversationId,
        endpoint: 'openai_oauth_responses',
        title: 'New Chat',
        model: 'gpt-5.5',
      }),
      expect.objectContaining({
        context: 'api/server/controllers/agents/request.js - preliminary conversation shell',
        createdAtOnInsert: expect.any(Date),
      }),
    );
    expect(mockSaveConvo.mock.invocationCallOrder[0]).toBeLessThan(
      res.json.mock.invocationCallOrder[0],
    );
    expect(mockSaveConvo.mock.invocationCallOrder[0]).toBeLessThan(
      initializeClient.mock.invocationCallOrder[0],
    );
  });

  it('keeps an already-generated title persistable when preflight later fails', async () => {
    let titleParams;
    const addTitle = jest.fn(async (_req, params) => {
      titleParams = params;
      await params.convoReady;
    });
    const client = {
      options: {},
      savedMessageIds: new Set(),
      sendMessage: jest.fn(async (_text, messageOptions) => {
        messageOptions.onStart(
          {
            messageId: 'file-user-message',
            parentMessageId: '00000000-0000-0000-0000-000000000000',
            conversationId: messageOptions.conversationId,
            text: 'OCR this PDF before replying.',
          },
          'assistant-message',
        );
        throw new Error('preflight failed after title generation');
      }),
    };
    const initializeClient = jest.fn().mockResolvedValue({ client });
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'OCR this PDF before replying.',
        messageId: 'file-user-message',
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        endpointOption: {
          endpoint: 'openai_oauth_responses',
          modelOptions: { model: 'gpt-5.5' },
        },
      },
      config: {},
    };
    const res = createResumableResponse();

    await AgentController(req, res, jest.fn(), initializeClient, addTitle);
    await waitForExpectation(() => {
      expect(addTitle).toHaveBeenCalled();
    });

    expect(titleParams.discardSignal.aborted).toBe(false);
  });

  it('stores the in-flight turn before MCP initialization can emit OAuth', async () => {
    const conversationId = 'conversation-123';
    const initializeClient = jest.fn().mockRejectedValue(new Error('stop before tool loading'));
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Check Google Workspace availability.',
        messageId: 'follow-up-user',
        parentMessageId: 'original-response',
        conversationId,
        endpointOption: {
          endpoint: 'agents',
          iconURL: 'https://example.com/spec-icon.png',
          modelOptions: { model: 'gpt-3.5-turbo' },
        },
      },
      config: {},
    };
    const res = {
      headersSent: true,
      json: jest.fn(() => {
        res.headersSent = true;
      }),
      status: jest.fn(() => res),
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);

    expect(mockGenerationJobManager.updateMetadata).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({
        conversationId,
        endpoint: 'agents',
        iconURL: 'https://example.com/spec-icon.png',
        model: 'gpt-3.5-turbo',
        responseMessageId: 'follow-up-user_',
        userMessage: {
          messageId: 'follow-up-user',
          parentMessageId: 'original-response',
          conversationId,
          text: 'Check Google Workspace availability.',
        },
      }),
    );
    expect(mockGenerationJobManager.updateMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      initializeClient.mock.invocationCallOrder[0],
    );
  });

  it('stores uploaded files in the in-flight turn before MCP initialization', async () => {
    const conversationId = 'conversation-123';
    const initializeClient = jest.fn().mockRejectedValue(new Error('stop before tool loading'));
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'OCR檔案內容，逐一列表給我核對。',
        messageId: 'file-user-message',
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        conversationId,
        files: [
          {
            file_id: 'file-bh-pdf',
            filename: 'BH.pdf',
            filepath: 'files/user-123/BH.pdf',
            type: 'application/pdf',
            bytes: 1024,
            height: 0,
            width: 0,
            text: 'must not be stored in preliminary metadata',
            _id: 'mongo-row-id',
            __v: 0,
          },
        ],
        endpointOption: {
          endpoint: 'agents',
          modelOptions: { model: 'gpt-5.5' },
        },
      },
      config: {},
    };
    const res = createResumableResponse();

    await AgentController(req, res, jest.fn(), initializeClient, null);

    expect(mockGenerationJobManager.updateMetadata).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({
        userMessage: expect.objectContaining({
          messageId: 'file-user-message',
          conversationId,
          files: [
            {
              file_id: 'file-bh-pdf',
              filename: 'BH.pdf',
              filepath: 'files/user-123/BH.pdf',
              type: 'application/pdf',
              bytes: 1024,
              height: 0,
              width: 0,
            },
          ],
        }),
      }),
    );
  });

  it('keeps request-scoped MCP connections until resumable initialization finishes', async () => {
    const conversationId = 'conversation-123';
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const initializeClient = jest.fn(async ({ req, res }) => {
      const context = getMCPRequestContext(req, res);
      context.connections.set('mcp-server', { disconnect });

      await nextTick();
      expect(disconnect).not.toHaveBeenCalled();

      throw new Error('stop after request-scoped MCP connection');
    });
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Use a BODY-scoped MCP server.',
        messageId: 'user-message',
        parentMessageId: 'parent-message',
        conversationId,
        endpointOption: {
          endpoint: 'agents',
          modelOptions: { model: 'gpt-4.1' },
        },
      },
      config: {},
    };
    const res = createResumableResponse();

    await AgentController(req, res, jest.fn(), initializeClient, null);

    expect(res.json).toHaveBeenCalledWith({
      streamId: conversationId,
      conversationId,
      status: 'started',
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      mockDecrementPendingRequest.mock.invocationCallOrder[0],
    );
  });

  it('stores model spec icon fallbacks and agent ids in early resume metadata', async () => {
    const conversationId = 'conversation-123';
    const initializeClient = jest.fn().mockRejectedValue(new Error('stop before tool loading'));
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Use the resume spec.',
        messageId: 'follow-up-user',
        parentMessageId: 'original-response',
        conversationId,
        endpointOption: {
          endpoint: 'agents',
          spec: 'agent-spec',
          agent_id: 'agent_resume_spec',
          model_parameters: { model: 'gpt-4.1' },
        },
      },
      config: {
        modelSpecs: {
          list: [
            {
              name: 'agent-spec',
              preset: {
                endpoint: 'openAI',
                iconURL: 'https://example.com/preset-icon.png',
              },
            },
          ],
        },
      },
    };
    const res = {
      headersSent: true,
      json: jest.fn(() => {
        res.headersSent = true;
      }),
      status: jest.fn(() => res),
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);

    expect(mockGenerationJobManager.updateMetadata).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({
        iconURL: 'https://example.com/preset-icon.png',
        model: 'agent_resume_spec',
      }),
    );
  });

  it('falls back to the model spec preset endpoint when no icon URL is configured', async () => {
    const conversationId = 'conversation-123';
    const initializeClient = jest.fn().mockRejectedValue(new Error('stop before tool loading'));
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Use the endpoint icon.',
        messageId: 'follow-up-user',
        parentMessageId: 'original-response',
        conversationId,
        endpointOption: {
          endpoint: 'agents',
          spec: 'endpoint-icon-spec',
          model_parameters: { model: 'gpt-4.1' },
        },
      },
      config: {
        modelSpecs: {
          list: [
            {
              name: 'endpoint-icon-spec',
              preset: {
                endpoint: 'anthropic',
              },
            },
          ],
        },
      },
    };
    const res = {
      headersSent: true,
      json: jest.fn(() => {
        res.headersSent = true;
      }),
      status: jest.fn(() => res),
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);

    expect(mockGenerationJobManager.updateMetadata).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({
        iconURL: 'anthropic',
        model: 'gpt-4.1',
      }),
    );
  });

  it('filters OAuth prompts before saving partial responses on disconnect', async () => {
    const conversationId = 'conversation-123';
    let allSubscribersLeftHandler;
    mockGenerationJobManager.createJob.mockResolvedValue({
      createdAt: 1000,
      readyPromise: Promise.resolve(),
      abortController: new AbortController(),
      emitter: {
        on: jest.fn((event, handler) => {
          if (event === 'allSubscribersLeft') {
            allSubscribersLeftHandler = handler;
          }
        }),
      },
    });
    mockGenerationJobManager.getResumeState.mockResolvedValue({
      conversationId,
      responseMessageId: 'response-message',
      iconURL: 'https://example.com/spec-icon.png',
      model: 'gpt-4.1',
      userMessage: {
        messageId: 'user-message',
        parentMessageId: 'parent-message',
        conversationId,
        text: 'Use Google Workspace',
      },
    });

    const initializeClient = jest.fn().mockRejectedValue(new Error('stop after setup'));
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Use Google Workspace',
        messageId: 'user-message',
        parentMessageId: 'parent-message',
        conversationId,
        endpointOption: {
          endpoint: 'agents',
          iconURL: 'https://example.com/fallback-icon.png',
          modelOptions: { model: 'gpt-3.5-turbo' },
        },
      },
      config: {},
    };
    const res = {
      headersSent: true,
      json: jest.fn(() => {
        res.headersSent = true;
      }),
      status: jest.fn(() => res),
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);
    expect(allSubscribersLeftHandler).toEqual(expect.any(Function));

    const oauthPart = {
      type: 'tool_call',
      tool_call: {
        name: 'oauth_mcp_Google-Workspace',
        auth: 'https://auth.example.com/oauth',
      },
    };
    const textPart = { type: 'text', text: 'Partial response...' };

    await allSubscribersLeftHandler([oauthPart, textPart]);

    expect(mockFilterPersistableAbortContent).toHaveBeenCalledWith([oauthPart, textPart]);
    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123' }),
      expect.objectContaining({
        content: [textPart],
        iconURL: 'https://example.com/spec-icon.png',
        model: 'gpt-4.1',
        messageId: 'response-message',
        parentMessageId: 'user-message',
      }),
      expect.any(Object),
    );
  });

  it('uses model spec and agent fallbacks when saving partial responses on disconnect', async () => {
    const conversationId = 'conversation-123';
    let allSubscribersLeftHandler;
    mockGenerationJobManager.createJob.mockResolvedValue({
      createdAt: 1000,
      readyPromise: Promise.resolve(),
      abortController: new AbortController(),
      emitter: {
        on: jest.fn((event, handler) => {
          if (event === 'allSubscribersLeft') {
            allSubscribersLeftHandler = handler;
          }
        }),
      },
    });
    mockGenerationJobManager.getResumeState.mockResolvedValue({
      conversationId,
      responseMessageId: 'response-message',
      userMessage: {
        messageId: 'user-message',
        parentMessageId: 'parent-message',
        conversationId,
        text: 'Use fallback metadata',
      },
    });

    const initializeClient = jest.fn().mockRejectedValue(new Error('stop after setup'));
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Use fallback metadata',
        messageId: 'user-message',
        parentMessageId: 'parent-message',
        conversationId,
        endpointOption: {
          endpoint: 'agents',
          spec: 'agent-spec',
          agent_id: 'agent_resume_spec',
          model_parameters: { model: 'gpt-4.1' },
        },
      },
      config: {
        modelSpecs: {
          list: [
            {
              name: 'agent-spec',
              preset: {
                endpoint: 'openAI',
                iconURL: 'https://example.com/preset-icon.png',
              },
            },
          ],
        },
      },
    };
    const res = {
      headersSent: true,
      json: jest.fn(() => {
        res.headersSent = true;
      }),
      status: jest.fn(() => res),
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);
    expect(allSubscribersLeftHandler).toEqual(expect.any(Function));

    const textPart = { type: 'text', text: 'Partial response...' };
    await allSubscribersLeftHandler([textPart]);

    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123' }),
      expect.objectContaining({
        content: [textPart],
        iconURL: 'https://example.com/preset-icon.png',
        model: 'agent_resume_spec',
        messageId: 'response-message',
        parentMessageId: 'user-message',
      }),
      expect.any(Object),
    );
  });

  it('generates a title after a follow-up user message when the conversation still has New Chat title', async () => {
    const conversationId = 'conversation-untitled';
    const addTitle = jest.fn().mockResolvedValue(undefined);
    const client = {
      options: {},
      savedMessageIds: new Set(),
      sendMessage: jest.fn(async (_text, messageOptions) => {
        const userMessage = {
          messageId: 'follow-up-user',
          parentMessageId: 'assistant-1',
          conversationId,
          text: '再幫我整理這張報價單。',
        };
        messageOptions.onStart(userMessage, 'assistant-2');
        return {
          messageId: 'assistant-2',
          conversationId,
          content: [{ type: 'text', text: '整理完成。' }],
          databasePromise: Promise.resolve({
            conversation: {
              conversationId,
              title: 'New Chat',
            },
          }),
        };
      }),
    };
    const initializeClient = jest.fn().mockResolvedValue({ client });
    const req = {
      user: { id: 'user-123' },
      body: {
        text: '再幫我整理這張報價單。',
        messageId: 'follow-up-user',
        parentMessageId: 'assistant-1',
        conversationId,
        endpointOption: {
          endpoint: 'agents',
          modelOptions: { model: 'gpt-4.1' },
        },
      },
      config: {},
    };
    const res = createResumableResponse();

    await AgentController(req, res, jest.fn(), initializeClient, addTitle);

    await waitForExpectation(() => {
      expect(addTitle).toHaveBeenCalledWith(
        req,
        expect.objectContaining({
          text: '再幫我整理這張報價單。',
          response: expect.objectContaining({
            conversationId,
            messageId: 'assistant-2',
          }),
          client,
        }),
      );
    });
  });
});
