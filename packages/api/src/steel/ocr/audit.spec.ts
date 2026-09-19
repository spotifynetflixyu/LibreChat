import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSteelOcrResponseAuditModel } from '@librechat/data-schemas';

import {
  createSteelOcrResponseAuditService,
  hashSteelOcrAuditValue,
  SteelOcrResponseAuditPersistenceError,
} from './audit';

type SteelOcrAuditModel = ReturnType<typeof createSteelOcrResponseAuditModel>;

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await createSteelOcrResponseAuditModel(mongoose).deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});

describe('Steel OCR response audit', () => {
  it('persists the exact raw response and immutable provenance', async () => {
    const Audit = createSteelOcrResponseAuditModel(mongoose);
    await Audit.init();
    const service = createSteelOcrResponseAuditService(mongoose, Audit);
    const rawResponse = '  ## ocr_result\n|品名|數量|\n|---|---|\n|鋼板|1|\n';

    const saved = await service.save({
      rawResponse,
      sourceStage: 'normal_request',
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      generationId: 'generation-1',
      attemptId: 'attempt-1',
      attemptNumber: 1,
      baseRevision: 'revision-1',
      baseHash: 'base-hash-1',
    });

    expect(saved.rawResponse).toBe(rawResponse);
    expect(saved.rawResponseHash).toBe(hashSteelOcrAuditValue(rawResponse));
    expect(saved).toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      generationId: 'generation-1',
      attemptId: 'attempt-1',
      attemptNumber: 1,
      sourceStage: 'normal_request',
      baseRevision: 'revision-1',
      baseHash: 'base-hash-1',
    });

    await Audit.updateOne({ _id: saved._id }, { $set: { rawResponse: 'replacement' } });
    await expect(Audit.findById(saved._id).lean()).resolves.toEqual(
      expect.objectContaining({ rawResponse }),
    );
  });

  it('is idempotent for the same attempt and retains distinct retries', async () => {
    const Audit = createSteelOcrResponseAuditModel(mongoose);
    await Audit.init();
    const service = createSteelOcrResponseAuditService(mongoose, Audit);
    const input = {
      rawResponse: '',
      sourceStage: 'delegate' as const,
      userId: 'user-1',
      messageId: 'message-1',
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      attemptId: 'attempt-1',
      baseHash: 'base-hash-1',
    };

    const first = await service.save(input);
    const repeated = await service.save(input);
    const retry = await service.save({
      ...input,
      rawResponse: 'retry answer',
      attemptId: 'attempt-2',
      attemptNumber: 2,
    });

    expect(repeated._id).toEqual(first._id);
    expect(retry._id).not.toEqual(first._id);
    await expect(Audit.countDocuments()).resolves.toBe(2);
  });

  it('propagates storage failures so callers can fail closed', async () => {
    const service = createSteelOcrResponseAuditService(mongoose, {
      create: async () => {
        throw new Error('mongo unavailable');
      },
      findOne: () => ({ exec: async () => null }),
    } as SteelOcrAuditModel);

    await expect(
      service.save({
        rawResponse: 'answer',
        sourceStage: 'responses',
        userId: 'user-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        generationId: 'generation-1',
      }),
    ).rejects.toBeInstanceOf(SteelOcrResponseAuditPersistenceError);
  });

  it('rejects an unscoped audit before touching storage', async () => {
    const Audit = createSteelOcrResponseAuditModel(mongoose);
    const service = createSteelOcrResponseAuditService(mongoose, Audit);

    await expect(
      service.save({
        rawResponse: 'answer',
        sourceStage: 'normal_request',
        userId: ' ',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        generationId: 'generation-1',
      }),
    ).rejects.toThrow('userId is required');
    await expect(Audit.countDocuments()).resolves.toBe(0);
  });
});
