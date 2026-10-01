import type {
  OAuthCompactionAcquireInput,
  OAuthCompactionDeleteInput,
  OAuthCompactionRecord,
  OAuthCompactionSaveInput,
  OAuthCompactionScope,
  OAuthCompactionState,
  OAuthCompactionStore,
} from '~/types/oauthCompaction';
import {
  isOAuthCompactionOpaque,
  isOAuthCompactionSha256,
  MAX_OAUTH_COMPACTION_HASHES,
  MAX_OAUTH_COMPACTION_IDENTIFIER_LENGTH,
} from '~/types/oauthCompaction';
import { createOAuthCompactionModel } from '~/models/oauthCompaction';
import { createIndexesWithRetry } from '~/utils/retry';

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function assertIdentifier(value: string, name: string, allowEmpty = false): void {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > MAX_OAUTH_COMPACTION_IDENTIFIER_LENGTH
  ) {
    throw new TypeError(`${name} is invalid`);
  }
}

function assertScope(scope: OAuthCompactionScope): void {
  assertIdentifier(scope.tenantId, 'tenantId', true);
  assertIdentifier(scope.userId, 'userId');
  assertIdentifier(scope.conversationId, 'conversationId');
  assertIdentifier(scope.agentId, 'agentId');
  assertIdentifier(scope.executionId, 'executionId');
  assertIdentifier(scope.accountHash, 'accountHash');
  assertIdentifier(scope.model, 'model');
  assertIdentifier(scope.instructionsHash, 'instructionsHash');
  if (!isOAuthCompactionSha256(scope.accountHash)) {
    throw new TypeError('accountHash is invalid');
  }
  if (!isOAuthCompactionSha256(scope.instructionsHash)) {
    throw new TypeError('instructionsHash is invalid');
  }
}

function assertHashes(values: string[], name: string): void {
  if (
    !Array.isArray(values) ||
    values.length > MAX_OAUTH_COMPACTION_HASHES ||
    !values.every(isOAuthCompactionSha256)
  ) {
    throw new TypeError(`${name} is invalid`);
  }
}

function assertAcquireInput(input: OAuthCompactionAcquireInput): void {
  assertScope(input.scope);
  assertIdentifier(input.ownerId, 'ownerId');
  if (
    !isValidDate(input.now) ||
    !isValidDate(input.leaseExpiresAt) ||
    !isValidDate(input.expiresAt)
  ) {
    throw new TypeError('OAuth compaction dates are invalid');
  }
  if (input.leaseExpiresAt <= input.now || input.expiresAt <= input.now) {
    throw new TypeError('OAuth compaction expiry must be in the future');
  }
}

function assertSaveInput(input: OAuthCompactionSaveInput): void {
  assertScope(input.scope);
  assertIdentifier(input.ownerId, 'ownerId');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new TypeError('expectedRevision is invalid');
  }
  if (!isValidDate(input.now) || !isValidDate(input.state.expiresAt)) {
    throw new TypeError('OAuth compaction dates are invalid');
  }
  if (input.state.expiresAt <= input.now) {
    throw new TypeError('OAuth compaction expiry must be in the future');
  }
  assertHashes(input.state.coveredHashes, 'coveredHashes');
  if (!isOAuthCompactionOpaque(input.state.opaque)) {
    throw new TypeError('opaque is invalid');
  }
  if (input.state.usage != null) {
    if (
      !Number.isSafeInteger(input.state.usage.inputTokens) ||
      input.state.usage.inputTokens < 0 ||
      input.state.usage.inputHashes.length === 0 ||
      !isOAuthCompactionSha256(input.state.usage.shapingHash)
    ) {
      throw new TypeError('usage is invalid');
    }
    assertHashes(input.state.usage.inputHashes, 'inputHashes');
  }
}

function scopeFilter(scope: OAuthCompactionScope): OAuthCompactionScope {
  return { ...scope };
}

function toState(record: OAuthCompactionRecord): OAuthCompactionState | null {
  if (typeof record.opaque !== 'string') {
    return null;
  }
  return {
    revision: record.revision,
    coveredHashes: record.coveredHashes,
    opaque: record.opaque,
    ...(record.usage == null ? {} : { usage: record.usage }),
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
  };
}

export function createOAuthCompactionMethods(
  mongoose: typeof import('mongoose'),
): OAuthCompactionStore {
  const OAuthCompaction = createOAuthCompactionModel(mongoose);
  let indexesPromise: Promise<void> | null = null;

  function ensureIndexes(): Promise<void> {
    if (indexesPromise == null) {
      indexesPromise = createIndexesWithRetry(OAuthCompaction).catch((error) => {
        indexesPromise = null;
        throw error;
      });
    }
    return indexesPromise;
  }

  async function acquireOAuthCompaction(
    input: OAuthCompactionAcquireInput,
  ): Promise<Awaited<ReturnType<OAuthCompactionStore['acquireOAuthCompaction']>>> {
    assertAcquireInput(input);
    await ensureIndexes();
    const scope = scopeFilter(input.scope);
    try {
      await OAuthCompaction.create({
        ...scope,
        ownerId: input.ownerId,
        leaseExpiresAt: input.leaseExpiresAt,
        revision: 0,
        coveredHashes: [],
        updatedAt: input.now,
        expiresAt: input.expiresAt,
      });
      return { ok: true, state: null, revision: 0 };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }

    const availableLease = {
      $or: [{ leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: input.now } }],
    };
    const activeState = {
      ...scope,
      ...availableLease,
      expiresAt: { $gt: input.now },
    };
    const reclaimed = await OAuthCompaction.findOneAndUpdate(
      activeState,
      {
        $set: {
          ownerId: input.ownerId,
          leaseExpiresAt: input.leaseExpiresAt,
        },
      },
      { new: true, runValidators: true, timestamps: false },
    )
      .select('+opaque')
      .lean<OAuthCompactionRecord>();
    if (reclaimed != null) {
      return { ok: true, state: toState(reclaimed), revision: reclaimed.revision };
    }

    const expired = await OAuthCompaction.findOneAndUpdate(
      { ...scope, ...availableLease, expiresAt: { $lte: input.now } },
      {
        $set: {
          ownerId: input.ownerId,
          leaseExpiresAt: input.leaseExpiresAt,
          coveredHashes: [],
          updatedAt: input.now,
          expiresAt: input.expiresAt,
        },
        $unset: { opaque: '', usage: '' },
        $inc: { revision: 1 },
      },
      { new: true, runValidators: true, timestamps: false },
    )
      .select('+opaque')
      .lean<OAuthCompactionRecord>();
    if (expired != null) {
      return { ok: true, state: null, revision: expired.revision };
    }

    return { ok: false, code: 'busy' };
  }

  async function saveOAuthCompaction(input: OAuthCompactionSaveInput): Promise<boolean> {
    assertSaveInput(input);
    await ensureIndexes();
    const update = {
      $set: {
        coveredHashes: input.state.coveredHashes,
        opaque: input.state.opaque,
        ...(input.state.usage == null ? {} : { usage: input.state.usage }),
        expiresAt: input.state.expiresAt,
        updatedAt: input.now,
      },
      ...(input.state.usage == null ? { $unset: { usage: '' } } : {}),
      $inc: { revision: 1 },
    };
    const result = await OAuthCompaction.updateOne(
      {
        ...scopeFilter(input.scope),
        ownerId: input.ownerId,
        leaseExpiresAt: { $gt: input.now },
        revision: input.expectedRevision,
      },
      update,
      { runValidators: true, timestamps: false },
    );
    return result.modifiedCount === 1;
  }

  async function releaseOAuthCompaction(input: {
    scope: OAuthCompactionScope;
    ownerId: string;
  }): Promise<void> {
    assertScope(input.scope);
    assertIdentifier(input.ownerId, 'ownerId');
    await ensureIndexes();
    await OAuthCompaction.updateOne(
      { ...scopeFilter(input.scope), ownerId: input.ownerId },
      { $unset: { ownerId: '', leaseExpiresAt: '' } },
      { timestamps: false },
    );
  }

  async function deleteOAuthCompaction(input: OAuthCompactionDeleteInput): Promise<number> {
    assertIdentifier(input.userId, 'userId');
    if (input.tenantId !== undefined) {
      assertIdentifier(input.tenantId, 'tenantId', true);
    }
    if (input.conversationIds !== undefined) {
      if (
        !Array.isArray(input.conversationIds) ||
        input.conversationIds.some((conversationId) => {
          try {
            assertIdentifier(conversationId, 'conversationId');
            return false;
          } catch {
            return true;
          }
        })
      ) {
        throw new TypeError('conversationIds is invalid');
      }
      if (input.conversationIds.length === 0) {
        return 0;
      }
    }
    await ensureIndexes();
    const result = await OAuthCompaction.deleteMany({
      userId: input.userId,
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
      ...(input.conversationIds === undefined
        ? {}
        : { conversationId: { $in: input.conversationIds } }),
    });
    return result.deletedCount;
  }

  return {
    acquireOAuthCompaction,
    saveOAuthCompaction,
    releaseOAuthCompaction,
    deleteOAuthCompaction,
  };
}

export type OAuthCompactionMethods = ReturnType<typeof createOAuthCompactionMethods>;
