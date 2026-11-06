import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { tenantStorage, createSteelOcrRunModel } from '@librechat/data-schemas';
import { InMemoryEventTransport } from '../stream/implementations/InMemoryEventTransport';
import { createSteelFlowLifecycle, createSteelGenerationReader } from './lifecycle';
import { InMemoryJobStore } from '../stream/implementations/InMemoryJobStore';
import { GenerationJobManagerClass } from '../stream/GenerationJobManager';
import { createSteelOcrStateService } from './ocr/state';
import { createOcrRouteHandlers } from './ocr/routes';

let mongo: MongoMemoryReplSet;
const scope = { userId: 'owner', conversationId: 'conversation', tenantId: 'tenant' };

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

it('pauses only the stopped generation before cleanup and preserves pause through late failure', async () => {
  const ocr = createSteelOcrStateService(mongoose);
  await ocr.createPreflightRun({ scope, responseGenerationId: 'old', triggeringMessageId: 'input', executionEpoch: 1 });
  await ocr.createPreflightRun({ scope, responseGenerationId: 'current', triggeringMessageId: 'next' });
  const lifecycle = createSteelFlowLifecycle(mongoose);
  await lifecycle.pauseJob({
    conversationId: scope.conversationId, userId: scope.userId, responseMessageId: 'old',
    tenantId: scope.tenantId, createdAt: 1,
  });
  await lifecycle.settleTurn({
    req: { user: { id: scope.userId, tenantId: scope.tenantId }, steelNativeContext: { requestId: 'old' } },
    conversationId: scope.conversationId, failed: true,
  });
  const Runs = createSteelOcrRunModel(mongoose);
  expect(await Runs.findOne({ responseGenerationId: 'old' }).lean()).toMatchObject({ status: 'paused' });
  expect(await Runs.findOne({ responseGenerationId: 'current' }).lean()).toMatchObject({ status: 'running' });
});

it.each(['completed', 'failed', 'interrupted'] as const)('settles OCR as %s using only the matching tenant and turn', async (status) => {
  const ocr = createSteelOcrStateService(mongoose);
  await ocr.createPreflightRun({ scope, responseGenerationId: 'response', triggeringMessageId: 'input' });
  const controller = new AbortController();
  if (status === 'interrupted') controller.abort();
  await createSteelFlowLifecycle(mongoose).settleTurn({
    req: { user: { id: scope.userId, tenantId: scope.tenantId }, steelNativeContext: { requestId: 'response' } },
    conversationId: scope.conversationId, signal: controller.signal, failed: status === 'failed',
  });
  expect(await createSteelOcrRunModel(mongoose).findOne({ responseGenerationId: 'response' }).lean())
    .toMatchObject({ status, ...(status === 'failed' ? { errorMessage: 'OCR processing failed.' } : {}) });
});

it('keeps a stop paused when status is read between the terminal claim and durable pause', async () => {
  const manager = new GenerationJobManagerClass();
  manager.configure({ jobStore: new InMemoryJobStore(), eventTransport: new InMemoryEventTransport(), isRedis: false });
  manager.initialize();
  const job = await tenantStorage.run({ tenantId: scope.tenantId }, async () =>
    manager.createJob(scope.conversationId, scope.userId, scope.conversationId,
      { initialMetadata: { responseMessageId: 'response' } }));
  const lifecycle = createSteelFlowLifecycle(mongoose);
  const run = await createSteelOcrStateService(mongoose).createPreflightRun({ scope,
    responseGenerationId: 'response', triggeringMessageId: 'input', executionEpoch: job.createdAt });
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, { user: { id: scope.userId, tenantId: scope.tenantId } }); next(); });
  const handlers = createOcrRouteHandlers({ ownsConversation: async () => true,
    readGeneration: createSteelGenerationReader(manager) });
  app.get('/status/:conversationId/:runId', handlers.status);
  try {
    await manager.abortJob(scope.conversationId, { expectedCreatedAt: job.createdAt, reason: 'user_pause',
      beforeAbort: async (claimed) => {
        const status = await request(app).get(`/status/${scope.conversationId}/${run.runId}`);
        expect(status.body.status).toBe('running');
        expect(job.abortController.signal.aborted).toBe(false);
        await createSteelOcrStateService(mongoose).settleTurn({ scope, responseGenerationId: 'response',
          executionEpoch: job.createdAt, status: 'interrupted' });
        await lifecycle.pauseJob(claimed);
      },
    });
    expect(await createSteelOcrRunModel(mongoose).findOne({ runId: run.runId }).lean()).toMatchObject({ status: 'paused' });
    expect(job.abortController.signal.reason).toBe('user_pause');
  } finally {
    await manager.destroy();
  }
});
