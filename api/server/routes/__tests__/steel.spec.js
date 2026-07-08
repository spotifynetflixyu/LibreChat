const express = require('express');
const request = require('supertest');

const mockListModels = jest.fn((_req, res) => res.status(200).json({ options: [] }));
const mockReadOpenAIOAuthUsage = jest.fn((_req, res) =>
  res.status(200).json({
    provider: 'openai_oauth_responses',
    source: 'chatgpt_wham_usage',
    status: 'available',
    fetchedAt: '2026-06-26T07:00:00.000Z',
    windows: [],
  }),
);
const mockChat = jest.fn((_req, res) =>
  res.status(200).json({
    provider: 'openai_oauth_responses',
    model: 'gpt-5.5',
    text: 'steel-chat-ok',
    unsupportedSettings: [],
    warnings: [],
  }),
);
const mockStreamChat = jest.fn((_req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.write(
    `${JSON.stringify({
      type: 'done',
      response: {
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: 'steel-stream-ok',
        unsupportedSettings: [],
        warnings: [],
      },
    })}\n`,
  );
  res.end();
});
const mockCapabilitySmoke = jest.fn((_req, res) =>
  res.status(200).json({
    provider: 'openai_oauth_responses',
    model: 'gpt-5.5',
    source: 'code_owned_support_matrix',
  }),
);
const mockReadOpenAIOAuthTokenStatus = jest.fn((_req, res) =>
  res.status(200).json({
    provider: 'openai_oauth_responses',
    status: 'available',
    fetchedAt: '2026-07-08T02:34:02.000Z',
    accessToken: {
      status: 'valid',
      expiresAt: '2026-07-18T02:34:02.000Z',
      expiresInSeconds: 864000,
    },
    refresh: {
      available: true,
    },
    login: {
      available: false,
      reason: 'codex_cli_unavailable',
    },
  }),
);
const mockRefreshOpenAIOAuthToken = jest.fn((_req, res) =>
  res.status(200).json({
    provider: 'openai_oauth_responses',
    status: 'available',
    fetchedAt: '2026-07-08T02:35:02.000Z',
    accessToken: {
      status: 'valid',
      expiresAt: '2026-07-18T02:35:02.000Z',
      expiresInSeconds: 864000,
    },
    refresh: {
      available: true,
    },
    login: {
      available: false,
      reason: 'codex_cli_unavailable',
    },
  }),
);
const mockStartOpenAIOAuthCodexLogin = jest.fn((_req, res) =>
  res.status(202).json({
    status: 'pending',
    sessionId: 'session_1',
    startedAt: '2026-07-08T02:34:02.000Z',
    updatedAt: '2026-07-08T02:34:02.000Z',
    expiresAt: '2026-07-08T02:44:02.000Z',
    device: {
      verificationUri: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH',
    },
  }),
);
const mockReadOpenAIOAuthCodexLoginStatus = jest.fn((_req, res) =>
  res.status(200).json({
    status: 'succeeded',
    sessionId: 'session_1',
    startedAt: '2026-07-08T02:34:02.000Z',
    updatedAt: '2026-07-08T02:35:02.000Z',
  }),
);
const mockCreateAuthenticatedConversation = jest.fn((_req, res) =>
  res.status(201).json({ id: 'steel_meta_auth_1', createdFrom: 'authenticated' }),
);
const mockCreateGuestConversation = jest.fn((_req, res) =>
  res.status(201).json({
    id: 'steel_meta_guest_1',
    createdFrom: 'guest',
    guestToken: 'guest-token-raw',
  }),
);
const mockReadConversation = jest.fn((_req, res) =>
  res.status(200).json({ id: 'steel_meta_auth_1', createdFrom: 'authenticated' }),
);
const mockReadConversationMessages = jest.fn((_req, res) =>
  res.status(200).json({ conversationId: 'steel-chat-1', messages: [] }),
);
const mockCreateRuleProposal = jest.fn((_req, res) =>
  res.status(201).json({ id: 'proposal_1', status: 'needs_review' }),
);
const mockCreateSteelHandlers = jest.fn(() => ({
  chat: mockChat,
  createAuthenticatedConversation: mockCreateAuthenticatedConversation,
  createGuestConversation: mockCreateGuestConversation,
  createRuleProposal: mockCreateRuleProposal,
  listModels: mockListModels,
  readOpenAIOAuthUsage: mockReadOpenAIOAuthUsage,
  readConversation: mockReadConversation,
  readConversationMessages: mockReadConversationMessages,
  streamChat: mockStreamChat,
}));
const mockCreateSteelAdminHandlers = jest.fn(() => ({
  readOpenAIOAuthCodexLoginStatus: mockReadOpenAIOAuthCodexLoginStatus,
  readOpenAIOAuthTokenStatus: mockReadOpenAIOAuthTokenStatus,
  refreshOpenAIOAuthToken: mockRefreshOpenAIOAuthToken,
  requestCapabilitySmoke: mockCapabilitySmoke,
  startOpenAIOAuthCodexLogin: mockStartOpenAIOAuthCodexLogin,
}));
const mockRequireCapability = jest.fn(() => (_req, _res, next) => next());
const mockRequireJwtAuth = jest.fn((_req, _res, next) => next());

jest.mock('@librechat/api', () => ({
  createSteelAdminHandlers: (...args) => mockCreateSteelAdminHandlers(...args),
  createSteelHandlers: (...args) => mockCreateSteelHandlers(...args),
  resolveEvidenceFileForProvider: jest.fn(),
}));

jest.mock('@librechat/data-schemas', () => ({
  SystemCapabilities: {
    ACCESS_ADMIN: 'ACCESS_ADMIN',
  },
}));

jest.mock('~/models', () => ({
  getFiles: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(() => ({})),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (...args) => mockRequireJwtAuth(...args),
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: (...args) => mockRequireCapability(...args),
}));

jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: jest.fn(),
}));

const steelRouter = require('../steel');
const adminSteelRouter = require('../admin/steel');

async function withNodeEnv(value, testFn) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await testFn();
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u_1', role: 'ADMIN' };
    next();
  });
  app.use('/api/steel', steelRouter);
  app.use('/api/admin/steel', adminSteelRouter);
  return app;
}

describe('Steel route shells', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers user-facing Steel model options under /api/steel', async () => {
    const app = createApp();

    const res = await request(app).get('/api/steel/ai/models');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ options: [] });
  });

  it('registers authenticated OpenAI OAuth usage remaining under /api/steel', async () => {
    const app = createApp();

    const res = await request(app).get('/api/steel/ai/oauth-usage');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      provider: 'openai_oauth_responses',
      source: 'chatgpt_wham_usage',
      status: 'available',
      fetchedAt: '2026-06-26T07:00:00.000Z',
      windows: [],
    });
    expect(mockReadOpenAIOAuthUsage).toHaveBeenCalledTimes(1);
  });

  it('registers authenticated Steel chat under /api/steel', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/api/steel/ai/chat')
      .send({ messages: [{ role: 'user', content: 'Say steel-chat-ok' }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    });
  });

  it('blocks standalone Steel OAuth chat APIs in production', async () =>
    withNodeEnv('production', async () => {
      const app = createApp();

      const chatRes = await request(app)
        .post('/api/steel/ai/chat')
        .send({ messages: [{ role: 'user', content: 'dev probe' }] });
      const streamRes = await request(app)
        .post('/api/steel/ai/chat/stream')
        .send({ messages: [{ role: 'user', content: 'dev probe' }] });
      const createRes = await request(app)
        .post('/api/steel/conversations/authenticated')
        .send({ libreChatConversationId: 'lc_1' });
      const guestRes = await request(app)
        .post('/api/steel/conversations/guest')
        .send({ libreChatConversationId: 'lc_guest_1' });
      const readRes = await request(app).get('/api/steel/conversations/steel_meta_1');
      const messagesRes = await request(app).get('/api/steel/conversations/steel-chat-1/messages');

      expect(chatRes.status).toBe(404);
      expect(streamRes.status).toBe(404);
      expect(createRes.status).toBe(404);
      expect(guestRes.status).toBe(404);
      expect(readRes.status).toBe(404);
      expect(messagesRes.status).toBe(404);
      expect(mockChat).not.toHaveBeenCalled();
      expect(mockStreamChat).not.toHaveBeenCalled();
      expect(mockCreateAuthenticatedConversation).not.toHaveBeenCalled();
      expect(mockCreateGuestConversation).not.toHaveBeenCalled();
      expect(mockReadConversation).not.toHaveBeenCalled();
      expect(mockReadConversationMessages).not.toHaveBeenCalled();
    }));

  it('keeps OpenAI OAuth usage available in production', async () =>
    withNodeEnv('production', async () => {
      const app = createApp();

      const res = await request(app).get('/api/steel/ai/oauth-usage');

      expect(res.status).toBe(200);
      expect(mockReadOpenAIOAuthUsage).toHaveBeenCalledTimes(1);
    }));

  it('registers authenticated Steel streaming chat under /api/steel', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/api/steel/ai/chat/stream')
      .send({ messages: [{ role: 'user', content: 'Say steel-stream-ok' }] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    expect(res.text).toContain('"type":"done"');
    expect(mockStreamChat).toHaveBeenCalledTimes(1);
  });

  it('returns Steel JSON when the streaming handler rejects before writing headers', async () => {
    mockStreamChat.mockRejectedValueOnce(new Error('stream setup exploded'));
    const app = createApp();

    const res = await request(app)
      .post('/api/steel/ai/chat/stream')
      .send({ messages: [{ role: 'user', content: 'Say steel-stream-ok' }] });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      provider: 'openai_oauth_responses',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      errorCategory: 'unknown',
      errorSummary: 'stream setup exploded',
    });
  });

  it('registers authenticated Steel conversation creation under /api/steel', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/api/steel/conversations/authenticated')
      .send({ libreChatConversationId: 'lc_1' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 'steel_meta_auth_1',
      createdFrom: 'authenticated',
    });
  });

  it('registers guest Steel conversation creation without JWT middleware', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/api/steel/conversations/guest')
      .send({ libreChatConversationId: 'lc_guest_1' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 'steel_meta_guest_1',
      createdFrom: 'guest',
      guestToken: 'guest-token-raw',
    });
  });

  it('registers Steel conversation read under /api/steel', async () => {
    const app = createApp();

    const res = await request(app).get('/api/steel/conversations/steel_meta_auth_1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'steel_meta_auth_1',
      createdFrom: 'authenticated',
    });
    expect(mockRequireJwtAuth).toHaveBeenCalledTimes(1);
  });

  it('lets guest-token Steel conversation reads reach the service without JWT middleware', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/api/steel/conversations/steel_meta_guest_1')
      .set('x-steel-guest-token', 'guest-token-raw');

    expect(res.status).toBe(200);
    expect(mockRequireJwtAuth).not.toHaveBeenCalled();
  });

  it('registers authenticated Steel conversation message reload under /api/steel', async () => {
    const app = createApp();

    const res = await request(app).get('/api/steel/conversations/steel-chat-1/messages');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conversationId: 'steel-chat-1', messages: [] });
    expect(mockReadConversationMessages).toHaveBeenCalledTimes(1);
    expect(mockRequireJwtAuth).toHaveBeenCalled();
  });

  it('registers authenticated Steel rule proposal creation under /api/steel', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/api/steel/rule-proposals')
      .send({ proposalType: 'customer_default' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'proposal_1', status: 'needs_review' });
    expect(mockRequireJwtAuth).toHaveBeenCalledTimes(1);
  });

  it('does not register Steel workbook or file-analysis REST routes', async () => {
    const app = createApp();

    const createRes = await request(app)
      .post('/api/steel/workbooks')
      .send({ conversationMetaId: 'steel_meta_1' });
    const readRes = await request(app).get('/api/steel/workbooks/wb_1');
    const patchRes = await request(app)
      .patch('/api/steel/workbooks/wb_1')
      .send({ workbookVersion: 1, operations: [] });
    const fileAnalysisRes = await request(app).get(
      '/api/steel/file-analysis/by-conversation/steel_meta_1',
    );

    expect(createRes.status).toBe(404);
    expect(readRes.status).toBe(404);
    expect(patchRes.status).toBe(404);
    expect(fileAnalysisRes.status).toBe(404);
  });

  it('registers admin-only capability smoke under /api/admin/steel', async () => {
    const app = createApp();

    const res = await request(app).post('/api/admin/steel/ai/capability-smoke');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      source: 'code_owned_support_matrix',
    });
  });

  it('registers admin-only OpenAI OAuth token status under /api/admin/steel', async () => {
    const app = createApp();

    const res = await request(app).get('/api/admin/steel/ai/oauth-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      provider: 'openai_oauth_responses',
      status: 'available',
      fetchedAt: '2026-07-08T02:34:02.000Z',
      accessToken: {
        status: 'valid',
        expiresAt: '2026-07-18T02:34:02.000Z',
        expiresInSeconds: 864000,
      },
      refresh: {
        available: true,
      },
      login: {
        available: false,
        reason: 'codex_cli_unavailable',
      },
    });
    expect(mockReadOpenAIOAuthTokenStatus).toHaveBeenCalledTimes(1);
  });

  it('registers admin-only OpenAI OAuth token refresh under /api/admin/steel', async () => {
    const app = createApp();

    const res = await request(app).post('/api/admin/steel/ai/oauth-token/refresh');

    expect(res.status).toBe(200);
    expect(res.body.accessToken.status).toBe('valid');
    expect(mockRefreshOpenAIOAuthToken).toHaveBeenCalledTimes(1);
  });

  it('registers admin-only OpenAI OAuth Codex login start under /api/admin/steel', async () => {
    const app = createApp();

    const res = await request(app).post('/api/admin/steel/ai/oauth-token/login');

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      status: 'pending',
      sessionId: 'session_1',
      startedAt: '2026-07-08T02:34:02.000Z',
      updatedAt: '2026-07-08T02:34:02.000Z',
      expiresAt: '2026-07-08T02:44:02.000Z',
      device: {
        verificationUri: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-EFGH',
      },
    });
    expect(mockStartOpenAIOAuthCodexLogin).toHaveBeenCalledTimes(1);
  });

  it('registers admin-only OpenAI OAuth Codex login status under /api/admin/steel', async () => {
    const app = createApp();

    const res = await request(app).get('/api/admin/steel/ai/oauth-token/login/session_1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'succeeded',
      sessionId: 'session_1',
      startedAt: '2026-07-08T02:34:02.000Z',
      updatedAt: '2026-07-08T02:35:02.000Z',
    });
    expect(mockReadOpenAIOAuthCodexLoginStatus).toHaveBeenCalledTimes(1);
  });
});
