const express = require('express');
const request = require('supertest');

const mockListModels = jest.fn((_req, res) => res.status(200).json({ options: [] }));
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
const mockCreateRuleProposal = jest.fn((_req, res) =>
  res.status(201).json({ id: 'proposal_1', status: 'needs_review' }),
);
const mockCreateSteelHandlers = jest.fn(() => ({
  chat: mockChat,
  createAuthenticatedConversation: mockCreateAuthenticatedConversation,
  createGuestConversation: mockCreateGuestConversation,
  createRuleProposal: mockCreateRuleProposal,
  listModels: mockListModels,
  readConversation: mockReadConversation,
  streamChat: mockStreamChat,
}));
const mockCreateSteelAdminHandlers = jest.fn(() => ({
  requestCapabilitySmoke: mockCapabilitySmoke,
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
    mockRequireJwtAuth.mockClear();
  });

  it('registers user-facing Steel model options under /api/steel', async () => {
    const app = createApp();

    const res = await request(app).get('/api/steel/ai/models');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ options: [] });
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
    const fileAnalysisRes = await request(app)
      .get('/api/steel/file-analysis/by-conversation/steel_meta_1');

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
});
