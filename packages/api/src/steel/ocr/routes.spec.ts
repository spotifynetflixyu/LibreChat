import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createSteelOcrRunModel } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import { createSteelOcrStateService } from './state';
import { createOcrRouteHandlers } from './routes';

let server: MongoMemoryReplSet;
const scope = { userId: 'owner', conversationId: 'conversation', tenantId: 'tenant' };

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(server.getUri());
});
beforeEach(async () => { await mongoose.connection.dropDatabase(); });
afterAll(async () => { await mongoose.disconnect(); await server.stop(); });

function response() {
  const res = { statusCode: 200, payload: {} as object,
    status(code: number): Response { this.statusCode = code; return res as Partial<Response> as Response; },
    json(payload: object): Response { this.payload = payload; return res as Partial<Response> as Response; } };
  return res;
}
function request(runId: string, userId = scope.userId, tenantId = scope.tenantId) {
  return { params: { conversationId: scope.conversationId, runId }, user: { id: userId, tenantId } } as Partial<Request> as Request;
}
const handlers = () => createOcrRouteHandlers({ ownsConversation: async () => true });

it('tracks preflight progress, pauses durably, resumes without executing, and cancels', async () => {
  const service = createSteelOcrStateService(mongoose);
  const run = await service.createPreflightRun({ scope, responseGenerationId: 'turn', triggeringMessageId: 'message' });
  await service.updatePreflightRun({ scope, runId: run.runId, stage: 'organizer_chunk_saved', completedChunks: 1, totalChunks: 2 });
  const status = response();
  await handlers().status(request(run.runId), status as Partial<Response> as Response);
  expect(status.payload).toMatchObject({ runId: run.runId, kind: 'preflight', status: 'running',
    stage: 'organizer_chunk_saved', completedChunks: 1, totalChunks: 2, latestRunId: run.runId });
  const paused = response();
  await handlers().pause(request(run.runId), paused as Partial<Response> as Response);
  expect(paused.payload).toMatchObject({ status: 'paused' });
  await service.settleTurn({ scope, responseGenerationId: 'turn', status: 'interrupted' });
  expect((await service.readRun(scope, run.runId))).toMatchObject({ ok: true, run: { status: 'paused' } });
  const resumed = response();
  await handlers().resume(request(run.runId), resumed as Partial<Response> as Response);
  expect(resumed.payload).toEqual({ runId: run.runId, kind: 'preflight' });
  const cancelled = response();
  await handlers().cancel(request(run.runId), cancelled as Partial<Response> as Response);
  expect(cancelled.payload).toMatchObject({ status: 'cancelled' });
});

it('records disconnection and exhausted retries separately and retries failed runs', async () => {
  const service = createSteelOcrStateService(mongoose);
  const run = await service.createPreflightRun({ scope, responseGenerationId: 'turn', triggeringMessageId: 'message' });
  await service.settleTurn({ scope, responseGenerationId: 'turn', status: 'interrupted' });
  expect(await service.readRun(scope, run.runId)).toMatchObject({ run: { status: 'interrupted' } });
  await service.controlRun({ scope, runId: run.runId, action: 'resume' });
  await createSteelOcrRunModel(mongoose).updateOne({ runId: run.runId }, { $set: { awaitingExecution: false } });
  await service.settleTurn({ scope, responseGenerationId: 'turn', status: 'failed' });
  expect(await service.readRun(scope, run.runId)).toMatchObject({ run: { status: 'failed', errorMessage: 'OCR processing failed.' } });
  const retried = response();
  await handlers().retry(request(run.runId), retried as Partial<Response> as Response);
  expect(retried.payload).toEqual({ runId: run.runId, kind: 'preflight' });
});

it('rejects every stale destructive action within its kind but keeps kinds independent', async () => {
  const service = createSteelOcrStateService(mongoose);
  const old = await service.createPreflightRun({ scope, responseGenerationId: 'old', triggeringMessageId: 'old-message' });
  await service.createPreflightRun({ scope, responseGenerationId: 'new', triggeringMessageId: 'new-message' });
  const delegate = await service.materializeDelegateOcrRun({ ...scope, delegateOcrIndex: 1,
    claimToken: 'claim', triggeringMessageId: 'delegate-message', toolParameters: {}, files: [] });
  for (const action of ['resume', 'retry', 'cancel'] as const) {
    const res = response();
    await handlers()[action](request(old.runId), res as Partial<Response> as Response);
    expect(res.statusCode).toBe(409);
    expect(res.payload).toEqual({ code: 'flow_expired' });
  }
  const result = await service.readRun(scope, delegate.runId);
  expect(result).toMatchObject({ ok: true, latestRunId: delegate.runId, run: { kind: 'delegate' } });
});

it('scopes all controls to owner and tenant and refuses invalid state transitions', async () => {
  const service = createSteelOcrStateService(mongoose);
  const run = await service.createPreflightRun({ scope, responseGenerationId: 'turn', triggeringMessageId: 'message' });
  for (const req of [request(run.runId, 'other'), request(run.runId, 'owner', 'other')]) {
    const res = response();
    await handlers().cancel(req, res as Partial<Response> as Response);
    expect(res.statusCode).toBe(404);
  }
  await service.settleTurn({ scope, responseGenerationId: 'turn', status: 'completed' });
  const res = response();
  await handlers().resume(request(run.runId), res as Partial<Response> as Response);
  expect(res.statusCode).toBe(409);
  expect(res.payload).toEqual({ code: 'flow_invalid_state' });
});

it('revokes a delegate lease before cleanup so stale workers cannot overwrite pause', async () => {
  const service = createSteelOcrStateService(mongoose);
  const claim = await service.claimNewDelegateOcrIndex({ conversationId: scope.conversationId, triggeringMessageId: 'message' });
  if (!claim) throw new Error('missing claim');
  const run = await service.materializeDelegateOcrRun({ ...scope, ...claim, toolParameters: {}, files: [], responseGenerationId: 'turn' });
  const lease = await service.acquireDelegateExecutionLease({ claimToken: claim.claimToken });
  if (!lease) throw new Error('missing lease');
  await service.transitionDelegateOcrRun({ ...lease, stage: 'organizer_chunk_saved', completedChunks: 2, totalChunks: 3 });
  await service.pauseScope({ scope, responseGenerationId: 'turn' });
  expect(await service.transitionDelegateOcrRun({ ...lease, status: 'failed' })).toBeNull();
  expect(await service.readRun(scope, run.runId)).toMatchObject({ run: { status: 'paused', completedChunks: 2, totalChunks: 3 } });
  expect(await createSteelOcrRunModel(mongoose).findOne({ runId: run.runId }).lean()).not.toHaveProperty('executionLeaseToken');
});

it('creates a fresh run for regenerated epochs and fences delayed settlement after resume', async () => {
  const service = createSteelOcrStateService(mongoose);
  const old = await service.createPreflightRun({ scope, responseGenerationId: 'same-message', executionEpoch: 1, triggeringMessageId: 'message' });
  await service.settleTurn({ scope, responseGenerationId: 'same-message', executionEpoch: 1, status: 'completed' });
  const current = await service.createPreflightRun({ scope, responseGenerationId: 'same-message', executionEpoch: 2, triggeringMessageId: 'message' });
  expect(current.runId).not.toBe(old.runId);
  await service.pauseScope({ scope, executionEpoch: 1 });
  expect(await service.readRun(scope, current.runId)).toMatchObject({ run: { status: 'running' } });
  await service.pauseScope({ scope, executionEpoch: 2 });
  await service.controlRun({ scope, runId: current.runId, action: 'resume' });
  await service.settleTurn({ scope, responseGenerationId: 'same-message', executionEpoch: 2, status: 'failed' });
  await service.pauseScope({ scope, executionEpoch: 2 });
  expect(await service.readRun(scope, current.runId)).toMatchObject({ run: { status: 'running' } });
  expect(await service.updatePreflightRun({ scope, runId: current.runId, stage: 'completed' })).toBe(false);
});

it('reconciles a disappeared generation while preserving live owners and pending resumes', async () => {
  const service = createSteelOcrStateService(mongoose);
  const run = await service.createPreflightRun({ scope, responseGenerationId: 'turn', executionEpoch: 10, triggeringMessageId: 'message' });
  const active = createOcrRouteHandlers({ ownsConversation: async () => true,
    readGeneration: async () => ({ createdAt: 10, status: 'running' }) });
  const live = response();
  await active.status(request(run.runId), live as Partial<Response> as Response);
  expect(live.payload).toMatchObject({ status: 'running' });
  const missing = createOcrRouteHandlers({ ownsConversation: async () => true, readGeneration: async () => null });
  const interrupted = response();
  await missing.status(request(run.runId), interrupted as Partial<Response> as Response);
  expect(interrupted.payload).toMatchObject({ status: 'interrupted' });
  await service.controlRun({ scope, runId: run.runId, action: 'resume' });
  const pending = response();
  await missing.status(request(run.runId), pending as Partial<Response> as Response);
  expect(pending.payload).toMatchObject({ status: 'running' });
});
