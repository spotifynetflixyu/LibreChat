const express = require('express');
const request = require('supertest');

const mockSetBalanceConfig = jest.fn((req, _res, next) => {
  req.balanceInitialized = true;
  next();
});
const mockCreateSetBalanceConfig = jest.fn(() => mockSetBalanceConfig);
const mockFindBalanceByUser = jest.fn();
const mockUpsertBalanceFields = jest.fn();
const mockGetAppConfig = jest.fn();
const mockController = jest.fn((req, res) =>
  res.status(200).json({ balanceInitialized: req.balanceInitialized === true }),
);

jest.mock('@librechat/api', () => ({
  createSetBalanceConfig: (...args) => mockCreateSetBalanceConfig(...args),
}));

jest.mock('~/models', () => ({
  findBalanceByUser: mockFindBalanceByUser,
  upsertBalanceFields: mockUpsertBalanceFields,
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: mockGetAppConfig,
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = { id: 'user_1', _id: 'user_1', role: 'USER' };
    next();
  },
}));

jest.mock('~/server/controllers/Balance', () => (req, res) => mockController(req, res));

const balanceRouter = require('../balance');

function createApp() {
  const app = express();
  app.use('/api/balance', balanceRouter);
  return app;
}

describe('Balance route shell', () => {
  beforeEach(() => {
    mockSetBalanceConfig.mockClear();
    mockController.mockClear();
  });

  it('runs balance initialization before returning the user balance', async () => {
    const app = createApp();

    const res = await request(app).get('/api/balance');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balanceInitialized: true });
    expect(mockSetBalanceConfig).toHaveBeenCalledTimes(1);
    expect(mockController).toHaveBeenCalledTimes(1);
  });
});
