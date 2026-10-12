import express from 'express';
import request from 'supertest';
import type { SteelCustomerMethods } from '@librechat/data-schemas';
import { createSteelCustomerRouteHandlers } from './customer';

const query = { conversationId: 'conversation', messageId: 'message', title: 'customer_data', outputId: 'output' };
const commit = { ...query, revision: 'revision', tier: 'C', expectedTier: 'B' };
const methods: SteelCustomerMethods = {
  readSteelCustomer: jest.fn(),
  commitSteelCustomer: jest.fn(),
};
const read = jest.mocked(methods.readSteelCustomer);
const save = jest.mocked(methods.commitSteelCustomer);
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  Object.assign(req, { user: req.headers['x-user'] ? { id: req.headers['x-user'], tenantId: 'tenant' } : undefined });
  next();
});
const handlers = createSteelCustomerRouteHandlers(methods);
app.get('/conversations/:conversationId/customer', handlers.read);
app.post('/conversations/:conversationId/customer', handlers.commit);
beforeEach(() => jest.resetAllMocks());

it('requires authentication and validates the request before database access', async () => {
  expect((await request(app).post('/conversations/conversation/customer').send(commit)).status).toBe(401);
  for (const body of [{ ...commit, tier: 'G' }, { ...commit, expectedTier: 'G' }, { ...commit, expectedTier: undefined }, { ...commit, conversationId: 'other' }, { ...commit, userId: 'forged' }]) {
    expect((await request(app).post('/conversations/conversation/customer').set('x-user', 'user').send(body)).status).toBe(400);
  }
  expect(save).not.toHaveBeenCalled();
});

it('binds reads and writes to the authenticated tenant and returns only the saved projection', async () => {
  const value = { ...query, tier: 'C' as const, revision: 'new', latest: true };
  read.mockResolvedValue({ ok: true, value });
  save.mockResolvedValue({ ok: true, value: { ...value, message: { messageId: 'message', text: 'saved markdown' } } });
  const response = await request(app).get('/conversations/conversation/customer').query({ messageId: 'message', title: 'customer_data', outputId: 'output' }).set('x-user', 'user');
  expect(response.status).toBe(200);
  expect(read).toHaveBeenCalledWith({ ...query, userId: 'user', tenantId: 'tenant' });
  const saved = await request(app).post('/conversations/conversation/customer').set('x-user', 'user').send(commit);
  expect(saved.status).toBe(200);
  expect(saved.body.message.text).toBe('saved markdown');
  expect(save).toHaveBeenCalledWith({ ...commit, userId: 'user', tenantId: 'tenant' });
});

it.each([
  ['CUSTOMER_NOT_FOUND', 404], ['CUSTOMER_HISTORICAL', 409], ['CUSTOMER_CONFLICT', 409],
  ['CUSTOMER_BUSY', 409], ['CUSTOMER_INVALID_TABLE', 422],
] as const)('maps %s to a non-success response', async (code, status) => {
  save.mockResolvedValue({ ok: false, code });
  const response = await request(app).post('/conversations/conversation/customer').set('x-user', 'user').send(commit);
  expect(response.status).toBe(status);
  expect(response.body).toEqual({ code });
});

it('does not expose operational database diagnostics', async () => {
  save.mockRejectedValue(new Error('password secret query payload'));
  const response = await request(app).post('/conversations/conversation/customer').set('x-user', 'user').send(commit);
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ code: 'CUSTOMER_REQUEST_FAILED' });
});
