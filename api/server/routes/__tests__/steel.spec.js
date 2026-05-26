const express = require('express');
const request = require('supertest');

const mockListModels = jest.fn((_req, res) => res.status(200).json({ options: [] }));
const mockChat = jest.fn((_req, res) =>
  res.status(200).json({
    provider: 'openai_oauth_responses',
    model: 'gpt-5.4',
    text: 'steel-chat-ok',
    unsupportedSettings: [],
    warnings: [],
  }),
);
const mockCapabilitySmoke = jest.fn((_req, res) =>
  res.status(202).json({ status: 'accepted', provider: 'openai_oauth_responses' }),
);
const mockCreateSteelHandlers = jest.fn(() => ({
  chat: mockChat,
  listModels: mockListModels,
}));
const mockCreateSteelAdminHandlers = jest.fn(() => ({
  requestCapabilitySmoke: mockCapabilitySmoke,
}));
const mockRequireCapability = jest.fn(() => (_req, _res, next) => next());

jest.mock('@librechat/api', () => ({
  createSteelAdminHandlers: (...args) => mockCreateSteelAdminHandlers(...args),
  createSteelHandlers: (...args) => mockCreateSteelHandlers(...args),
}));

jest.mock('@librechat/data-schemas', () => ({
  SystemCapabilities: {
    ACCESS_ADMIN: 'ACCESS_ADMIN',
  },
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (_req, _res, next) => next(),
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
      model: 'gpt-5.4',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    });
  });

  it('registers admin-only capability smoke under /api/admin/steel', async () => {
    const app = createApp();

    const res = await request(app).post('/api/admin/steel/ai/capability-smoke');

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      status: 'accepted',
      provider: 'openai_oauth_responses',
    });
  });
});
