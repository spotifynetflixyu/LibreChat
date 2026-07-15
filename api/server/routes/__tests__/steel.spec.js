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
const mockCreateRuleProposal = jest.fn((_req, res) =>
  res.status(201).json({ id: 'proposal_1', status: 'needs_review' }),
);
const mockCreateSteelRouteHandlers = jest.fn(() => ({
  createRuleProposal: mockCreateRuleProposal,
  listModels: mockListModels,
  readOpenAIOAuthUsage: mockReadOpenAIOAuthUsage,
}));

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
    refresh: { available: true },
    login: { available: false, reason: 'codex_cli_unavailable' },
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
    refresh: { available: true },
    login: { available: false, reason: 'codex_cli_unavailable' },
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
const mockCancelOpenAIOAuthCodexLogin = jest.fn((_req, res) => res.status(204).end());
const mockLogoutOpenAIOAuthToken = jest.fn((_req, res) =>
  res.status(200).json({ status: 'succeeded', fetchedAt: '2026-07-08T02:35:02.000Z' }),
);
const mockCreateSteelAdminHandlers = jest.fn(() => ({
  cancelOpenAIOAuthCodexLogin: mockCancelOpenAIOAuthCodexLogin,
  logoutOpenAIOAuthToken: mockLogoutOpenAIOAuthToken,
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
  createSteelRouteHandlers: (...args) => mockCreateSteelRouteHandlers(...args),
}));

jest.mock('@librechat/data-schemas', () => ({
  SystemCapabilities: {
    ACCESS_ADMIN: 'ACCESS_ADMIN',
  },
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
    jest.clearAllMocks();
  });

  it('dispatches preserved model, usage, and rule proposal routes', async () => {
    const app = createApp();

    const modelsRes = await request(app).get('/api/steel/ai/models');
    const usageRes = await request(app).get('/api/steel/ai/oauth-usage');
    const proposalRes = await request(app)
      .post('/api/steel/rule-proposals')
      .send({ proposalType: 'customer_default' });

    expect(modelsRes.status).toBe(200);
    expect(modelsRes.body).toEqual({ options: [] });
    expect(usageRes.status).toBe(200);
    expect(usageRes.body).toMatchObject({
      provider: 'openai_oauth_responses',
      source: 'chatgpt_wham_usage',
      status: 'available',
    });
    expect(proposalRes.status).toBe(201);
    expect(proposalRes.body).toEqual({ id: 'proposal_1', status: 'needs_review' });
    expect(mockListModels).toHaveBeenCalledTimes(1);
    expect(mockReadOpenAIOAuthUsage).toHaveBeenCalledTimes(1);
    expect(mockCreateRuleProposal).toHaveBeenCalledTimes(1);
  });

  it('does not register standalone Steel OAuth chat or conversation APIs', async () => {
    const app = createApp();
    const responses = await Promise.all([
      request(app).post('/api/steel/ai/chat'),
      request(app).post('/api/steel/ai/chat/stream'),
      request(app).post('/api/steel/conversations/authenticated'),
      request(app).post('/api/steel/conversations/guest'),
      request(app).get('/api/steel/conversations/steel_meta_1'),
      request(app).get('/api/steel/conversations/steel-chat-1/messages'),
    ]);

    responses.forEach((response) => expect(response.status).toBe(404));
  });

  it('does not register Steel workbook or file-analysis REST routes', async () => {
    const app = createApp();

    const createRes = await request(app).post('/api/steel/workbooks').send({});
    const readRes = await request(app).get('/api/steel/workbooks/wb_1');
    const patchRes = await request(app).patch('/api/steel/workbooks/wb_1').send({});
    const fileAnalysisRes = await request(app).get(
      '/api/steel/file-analysis/by-conversation/steel_meta_1',
    );

    expect(createRes.status).toBe(404);
    expect(readRes.status).toBe(404);
    expect(patchRes.status).toBe(404);
    expect(fileAnalysisRes.status).toBe(404);
  });

  it('preserves admin-only capability smoke and OAuth token routes', async () => {
    const app = createApp();

    const capabilityRes = await request(app).post('/api/admin/steel/ai/capability-smoke');
    const statusRes = await request(app).get('/api/admin/steel/ai/oauth-token');
    const refreshRes = await request(app).post('/api/admin/steel/ai/oauth-token/refresh');
    const loginRes = await request(app)
      .post('/api/admin/steel/ai/oauth-token/login')
      .send({ method: 'device_code' });
    const loginStatusRes = await request(app).get(
      '/api/admin/steel/ai/oauth-token/login/session_1',
    );
    const cancelRes = await request(app).post(
      '/api/admin/steel/ai/oauth-token/login/session_1/cancel',
    );
    const logoutRes = await request(app).post('/api/admin/steel/ai/oauth-token/logout');

    expect(capabilityRes.status).toBe(200);
    expect(statusRes.status).toBe(200);
    expect(refreshRes.status).toBe(200);
    expect(loginRes.status).toBe(202);
    expect(loginStatusRes.status).toBe(200);
    expect(cancelRes.status).toBe(204);
    expect(logoutRes.status).toBe(200);
  });
});
