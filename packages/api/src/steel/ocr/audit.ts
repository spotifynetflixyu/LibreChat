import { createHash } from 'node:crypto';

import { createSteelOcrResponseAuditModel } from '@librechat/data-schemas';

import type { ISteelOcrResponseAudit, SteelOcrResponseAuditStage } from '@librechat/data-schemas';

type Mongoose = typeof import('mongoose');
type SteelOcrResponseAuditModel = ReturnType<typeof createSteelOcrResponseAuditModel>;

export interface SaveSteelOcrResponseAuditInput {
  rawResponse: string;
  sourceStage: SteelOcrResponseAuditStage;
  userId: string;
  tenantId?: string;
  conversationId: string;
  messageId: string;
  generationId: string;
  attemptId?: string;
  attemptNumber?: number;
  baseRevision?: string;
  baseHash?: string;
  baseResponse?: string;
}

export interface SteelOcrResponseAuditService {
  save(input: SaveSteelOcrResponseAuditInput): Promise<ISteelOcrResponseAudit>;
}

export class SteelOcrResponseAuditPersistenceError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = 'SteelOcrResponseAuditPersistenceError';
  }
}

export function hashSteelOcrAuditValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function getOptionalString(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function requireScopeString(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`OCR audit ${name} is required`);
  }
  return value;
}

function buildIdempotencyKey({
  userId,
  tenantId,
  conversationId,
  messageId,
  generationId,
  attemptId,
  attemptNumber,
  sourceStage,
  rawResponseHash,
  baseHash,
  baseRevision,
}: {
  userId?: string;
  tenantId?: string;
  conversationId?: string;
  messageId?: string;
  generationId?: string;
  attemptId?: string;
  attemptNumber: number;
  sourceStage: SteelOcrResponseAuditStage;
  rawResponseHash: string;
  baseHash: string;
  baseRevision?: string;
}): string {
  return hashSteelOcrAuditValue(
    JSON.stringify([
      userId ?? '',
      tenantId ?? '',
      conversationId ?? '',
      messageId ?? '',
      generationId ?? '',
      attemptId ?? '',
      attemptNumber,
      sourceStage,
      rawResponseHash,
      baseHash,
      baseRevision ?? '',
    ]),
  );
}

function buildRecord(input: SaveSteelOcrResponseAuditInput) {
  if (typeof input.rawResponse !== 'string') {
    throw new TypeError('OCR audit rawResponse must be a string');
  }
  const attemptNumber = input.attemptNumber ?? 1;
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new TypeError('OCR audit attemptNumber must be a positive integer');
  }

  const rawResponseHash = hashSteelOcrAuditValue(input.rawResponse);
  const baseHash = input.baseHash ?? hashSteelOcrAuditValue(input.baseResponse ?? '');
  const userId = requireScopeString(input.userId, 'userId');
  const tenantId = getOptionalString(input.tenantId);
  const conversationId = requireScopeString(input.conversationId, 'conversationId');
  const messageId = requireScopeString(input.messageId, 'messageId');
  const generationId = requireScopeString(input.generationId, 'generationId');
  const attemptId = getOptionalString(input.attemptId);
  const baseRevision = getOptionalString(input.baseRevision);

  return {
    ...(userId ? { userId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(generationId ? { generationId } : {}),
    ...(attemptId ? { attemptId } : {}),
    attemptNumber,
    sourceStage: input.sourceStage,
    ...(baseRevision ? { baseRevision } : {}),
    baseHash,
    rawResponse: input.rawResponse,
    rawResponseHash,
    idempotencyKey: buildIdempotencyKey({
      userId,
      tenantId,
      conversationId,
      messageId,
      generationId,
      attemptId,
      attemptNumber,
      sourceStage: input.sourceStage,
      rawResponseHash,
      baseHash,
      baseRevision,
    }),
  };
}

export function createSteelOcrResponseAuditService(
  mongoose: Mongoose,
  model: SteelOcrResponseAuditModel = createSteelOcrResponseAuditModel(mongoose),
): SteelOcrResponseAuditService {
  return {
    async save(input) {
      let record: ReturnType<typeof buildRecord>;
      try {
        record = buildRecord(input);
      } catch (error) {
        throw new SteelOcrResponseAuditPersistenceError(
          `OCR response audit input could not be persisted: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined,
        );
      }
      try {
        return await model.create(record);
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw new SteelOcrResponseAuditPersistenceError(
            'OCR response audit could not be persisted',
            error instanceof Error ? error : undefined,
          );
        }

        let existing;
        try {
          existing = await model.findOne({ idempotencyKey: record.idempotencyKey }).exec();
        } catch (lookupError) {
          throw new SteelOcrResponseAuditPersistenceError(
            'OCR response audit could not be read after an idempotent insert race',
            lookupError instanceof Error ? lookupError : undefined,
          );
        }
        if (!existing) {
          throw new SteelOcrResponseAuditPersistenceError(
            'OCR response audit idempotency record was not found after a duplicate insert',
            error instanceof Error ? error : undefined,
          );
        }
        return existing;
      }
    },
  };
}
