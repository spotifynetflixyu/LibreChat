import { Schema, mongo } from 'mongoose';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Document as MongoDocument } from 'mongodb';
import type { ClientSession, Model } from 'mongoose';
import { runAsSystem } from '~/config/tenantContext';
import logger from '~/config/winston';

type Mongoose = typeof import('mongoose');
type PlainRecord = Record<string, unknown>;
type DriverArguments = unknown[];
type DriverMethod = (...args: DriverArguments) => Promise<unknown>;
type LifecycleScope = SteelConversationScope | { conversationId: string };

export interface SteelConversationScope {
  userId: string;
  conversationId: string;
  tenantId?: string;
}

export interface SteelConversationDeletionScope {
  deleted: boolean;
}

interface SteelConversationLifecycleDocument extends MongoDocument {
  _id: string;
  userId?: string;
  tenantId?: string | null;
  conversationId: string;
  deleted: boolean;
  pendingWrites: number;
}

interface SteelCollection {
  find(filter: PlainRecord, options?: PlainRecord): {
    limit(limit: number): { next(): Promise<PlainRecord | null> };
    toArray(): Promise<PlainRecord[]>;
  };
  [key: string]: unknown;
}

interface SteelGuardOptions extends PlainRecord {
  session?: ClientSession;
  upsert?: boolean;
}

const LIFECYCLE_MODEL = 'SteelConversationLifecycle';
const LIFECYCLE_COLLECTION = 'steel_conversation_lifecycle';
const BYPASS = new AsyncLocalStorage<ReadonlySet<object>>();
const guardedCollections = new WeakSet<object>();

const steelConversationLifecycleSchema = new Schema<SteelConversationLifecycleDocument>(
  {
    _id: { type: String, required: true, immutable: true },
    userId: { type: String },
    tenantId: { type: String },
    conversationId: { type: String, required: true, immutable: true },
    deleted: { type: Boolean, required: true, default: false },
    pendingWrites: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export class SteelConversationDeletedError extends Error {
  readonly code = 'STEEL_CONVERSATION_DELETED';

  constructor() {
    super('Steel conversation writes are fenced because the conversation was deleted.');
    this.name = 'SteelConversationDeletedError';
  }
}

export class SteelConversationWritePendingError extends Error {
  readonly code = 'STEEL_CONVERSATION_IDENTITY_PENDING';

  constructor() {
    super('Steel conversation cleanup is waiting for an in-flight write to finish.');
    this.name = 'SteelConversationWritePendingError';
  }
}

class SteelConversationGateBootstrapRetryError extends mongo.MongoError {
  readonly code = 'STEEL_CONVERSATION_GATE_BOOTSTRAP_RETRY';

  constructor(cause: Error) {
    super('Steel conversation gate bootstrap conflicted with another transaction.', { cause });
    this.addErrorLabel(mongo.MongoErrorLabel.TransientTransactionError);
  }
}

function createLifecycleModel(mongoose: Mongoose): Model<SteelConversationLifecycleDocument> {
  return (
    (mongoose.models[LIFECYCLE_MODEL] as Model<SteelConversationLifecycleDocument> | undefined) ||
    mongoose.model<SteelConversationLifecycleDocument>(
      LIFECYCLE_MODEL,
      steelConversationLifecycleSchema,
      LIFECYCLE_COLLECTION,
    )
  );
}

function isRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function scopeKey(scope: LifecycleScope): string {
  return scope.conversationId;
}

function sameOwner(gate: Pick<SteelConversationLifecycleDocument, 'userId' | 'tenantId'>, scope: SteelConversationScope): boolean {
  return gate.userId === scope.userId && (gate.tenantId ?? undefined) === scope.tenantId;
}

class SteelConversationOwnerError extends Error {
  readonly code = 'STEEL_CONVERSATION_OWNER_MISMATCH';

  constructor() {
    super('Steel conversation scope does not match its owner.');
    this.name = 'SteelConversationOwnerError';
  }
}

function scopeFromRecord(value: unknown, legacy: boolean): SteelConversationScope | { conversationId: string } | undefined {
  if (!isRecord(value)) return undefined;
  const conversationId = nonEmptyString(value.conversationId);
  if (!conversationId) return undefined;
  if (legacy) return { conversationId };
  const userId = nonEmptyString(value.userId);
  if (!userId) return undefined;
  const tenantValue = value.tenantId;
  if (tenantValue != null && !nonEmptyString(tenantValue)) return undefined;
  return { userId, conversationId, ...(tenantValue != null ? { tenantId: tenantValue as string } : {}) };
}

function isLifecycleScope(value: SteelConversationScope | { conversationId: string }): value is SteelConversationScope {
  return 'userId' in value;
}

function sameScope(
  left: SteelConversationScope | { conversationId: string },
  right: SteelConversationScope | { conversationId: string },
): boolean {
  if (!isLifecycleScope(left) || !isLifecycleScope(right)) {
    return !isLifecycleScope(left) && !isLifecycleScope(right) && left.conversationId === right.conversationId;
  }
  return left.userId === right.userId && left.conversationId === right.conversationId &&
    (left.tenantId ?? undefined) === (right.tenantId ?? undefined);
}

const identityFields = ['userId', 'tenantId', 'conversationId'];

function isIdentityPath(path: string): boolean {
  return identityFields.some((field) => path === field || path.startsWith(`${field}.`));
}

function isExactIdentityPath(path: string): boolean {
  return identityFields.includes(path);
}

function combineRecords(left: PlainRecord, right: PlainRecord): PlainRecord | undefined {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (key in result && result[key] !== value) return undefined;
    result[key] = value;
  }
  return result;
}

/** Extracts only equality predicates. Ambiguous operators are deliberately ignored. */
function filterVariants(value: unknown): PlainRecord[] {
  if (!isRecord(value)) return [];
  let variants: PlainRecord[] = [{}];
  for (const [key, candidate] of Object.entries(value)) {
    if (key === '$and' && Array.isArray(candidate)) {
      for (const part of candidate) {
        const nested = filterVariants(part);
        if (nested.length === 0) continue;
        variants = variants.flatMap((current) => nested
          .map((next) => combineRecords(current, next))
          .filter((next): next is PlainRecord => next !== undefined));
      }
      continue;
    }
    if (key === '$or' && Array.isArray(candidate)) {
      const nested = candidate.flatMap((part) => filterVariants(part));
      variants = variants.flatMap((current) => nested
        .map((next) => combineRecords(current, next))
        .filter((next): next is PlainRecord => next !== undefined));
      continue;
    }
    if (key.startsWith('$') || (isRecord(candidate) && Object.keys(candidate).some((entry) => entry.startsWith('$')))) continue;
    variants = variants.map((current) => ({ ...current, [key]: candidate }));
  }
  return variants;
}

function updateIdentityVariants(
  update: unknown,
  replacement: boolean,
  includeSetOnInsert = true,
): PlainRecord[] | undefined {
  if (Array.isArray(update)) return undefined;
  if (replacement) {
    if (!isRecord(update) || Object.keys(update).some((path) => isIdentityPath(path) && !isExactIdentityPath(path))) {
      return undefined;
    }
    return [update];
  }
  if (!isRecord(update)) return [];
  const values: PlainRecord = {};
  for (const [operator, rawFields] of Object.entries(update)) {
    if (!isRecord(rawFields)) continue;
    const fields = rawFields;
    if (operator !== '$set' && (operator !== '$setOnInsert' || !includeSetOnInsert)) {
      if (Object.keys(fields).some((path) => isIdentityPath(path)) ||
        (operator === '$rename' && Object.values(fields).some((path) => typeof path === 'string' && isIdentityPath(path)))) {
        return undefined;
      }
      continue;
    }
    if (Object.keys(fields).some((path) => isIdentityPath(path) && !isExactIdentityPath(path))) return undefined;
    for (const field of ['userId', 'tenantId', 'conversationId']) {
      if (!(field in fields)) continue;
      if (field in values && values[field] !== fields[field]) return undefined;
      values[field] = fields[field];
    }
  }
  return [values];
}

function hasIdentityFields(update: unknown, replacement: boolean): boolean {
  if (replacement || Array.isArray(update)) return true;
  if (!isRecord(update)) return false;
  return Object.entries(update).some(([operator, rawFields]) => {
    if (!isRecord(rawFields)) return false;
    const fields = rawFields;
    if (operator === '$rename') {
      return Object.keys(fields).some((path) => isIdentityPath(path)) ||
        Object.values(fields).some((path) => typeof path === 'string' && isIdentityPath(path));
    }
    return Object.keys(fields).some((path) => isIdentityPath(path));
  });
}

function scopeCandidatesFromFilterAndUpdate(
  filter: unknown,
  update: unknown,
  legacy: boolean,
  replacement = false,
): LifecycleScope[] | undefined {
  const updates = updateIdentityVariants(update, replacement);
  if (updates === undefined) return undefined;
  const scopes: LifecycleScope[] = [];
  for (const updateVariant of updates) {
    if (replacement) {
      const scope = scopeFromRecord(updateVariant, legacy);
      if (!scope) return undefined;
      if (!scopes.some((candidate) => sameScope(candidate, scope))) scopes.push(scope);
      continue;
    }
    for (const variant of filterVariants(filter)) {
      const combined = combineRecords(variant, updateVariant);
      if (!combined) continue;
      const scope = scopeFromRecord(combined, legacy);
      if (scope && !scopes.some((candidate) => sameScope(candidate, scope))) scopes.push(scope);
    }
  }
  return scopes;
}

function getOptions(args: DriverArguments, index: number): SteelGuardOptions {
  return isRecord(args[index]) ? args[index] as SteelGuardOptions : {};
}

function withSession(args: DriverArguments, index: number, session?: ClientSession): DriverArguments {
  if (!session) return [...args];
  const result = [...args];
  result[index] = { ...getOptions(args, index), session };
  return result;
}

function isDuplicateKey(error: unknown): boolean {
  return isRecord(error) && error.code === 11000;
}

function isConfirmedWriteFailure(error: unknown): boolean {
  if (error instanceof mongo.BSON.BSONError || error instanceof mongo.MongoInvalidArgumentError) return true;
  if (error instanceof mongo.MongoNetworkError || error instanceof mongo.MongoWriteConcernError) return false;
  if (error instanceof mongo.MongoServerError) {
    return !error.hasErrorLabel(mongo.MongoErrorLabel.TransientTransactionError) &&
      !error.hasErrorLabel(mongo.MongoErrorLabel.RetryableWriteError) &&
      !error.hasErrorLabel(mongo.MongoErrorLabel.UnknownTransactionCommitResult);
  }
  if (error instanceof mongo.MongoError) return false;
  if (!isRecord(error)) return false;
  if (isDuplicateKey(error)) return true;
  return Array.isArray(error.writeErrors);
}

function canReleaseAfterFailure(error: unknown, session?: ClientSession): boolean {
  if (!session?.inTransaction()) return isConfirmedWriteFailure(error);
  return error instanceof mongo.BSON.BSONError || error instanceof mongo.MongoInvalidArgumentError;
}

function hasUnacknowledgedWriteConcern(options: SteelGuardOptions): boolean {
  if (options.w === 0) return true;
  return isRecord(options.writeConcern) && options.writeConcern.w === 0;
}

function isAcknowledgedWriteResult(result: unknown): boolean {
  return !isRecord(result) || result.acknowledged !== false;
}

function sessionOptions(session?: ClientSession): PlainRecord {
  return session ? { session } : {};
}

async function advanceGate(
  mongoose: Mongoose,
  scope: SteelConversationScope | { conversationId: string },
  session?: ClientSession,
): Promise<{ key: string }> {
  const Gate = createLifecycleModel(mongoose);
  const canonical = isLifecycleScope(scope);
  const key = scopeKey(scope);
  let gate: SteelConversationLifecycleDocument | null = null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inTransaction = session?.inTransaction() === true;
    try {
      gate = await Gate.findOneAndUpdate(
        { _id: key, deleted: { $ne: true },
          ...(canonical ? { $or: [{ userId: scope.userId, tenantId: scope.tenantId ?? null }, { userId: { $exists: false } }] } : {}),
        },
        {
          ...(canonical ? { $set: { userId: scope.userId, tenantId: scope.tenantId ?? null } } : {}),
          $setOnInsert: {
            _id: key,
            conversationId: scope.conversationId,
          },
          $inc: { pendingWrites: 1 },
        },
        { upsert: true, new: true, ...sessionOptions(session) },
      ).lean<SteelConversationLifecycleDocument>();
      break;
    } catch (error) {
      lastError = error;
      if (!isDuplicateKey(error)) throw error;
      if (inTransaction) {
        const existing = await Gate.findOne({ _id: key }).lean<Pick<SteelConversationLifecycleDocument, 'deleted' | 'userId' | 'tenantId'>>();
        if (existing?.deleted === true) throw new SteelConversationDeletedError();
        if (canonical && existing?.userId && !sameOwner(existing, scope)) throw new SteelConversationOwnerError();
        throw new SteelConversationGateBootstrapRetryError(
          error instanceof Error ? error : new Error('Concurrent gate bootstrap failed.'),
        );
      }
      const existing = await Gate.findOne({ _id: key }, null, sessionOptions(session))
        .lean<Pick<SteelConversationLifecycleDocument, 'deleted' | 'userId' | 'tenantId'>>();
      if (existing?.deleted === true) throw new SteelConversationDeletedError();
      if (canonical && existing?.userId && !sameOwner(existing, scope)) throw new SteelConversationOwnerError();
      if (attempt === 2) throw error;
    }
  }
  if (!gate) {
    if (lastError) throw lastError;
    throw new SteelConversationDeletedError();
  }
  return { key };
}

async function releaseGate(
  mongoose: Mongoose,
  key: string,
  session?: ClientSession,
): Promise<void> {
  const Gate = createLifecycleModel(mongoose);
  await Gate.updateOne(
    { _id: key, pendingWrites: { $gt: 0 } },
    { $inc: { pendingWrites: -1 } },
    sessionOptions(session),
  );
}

async function releaseGates(
  mongoose: Mongoose,
  reservations: Array<{ key: string }>,
  session?: ClientSession,
  preservePrimaryError = false,
): Promise<void> {
  for (const reservation of reservations) {
    try {
      await releaseGate(mongoose, reservation.key, session);
    } catch (error) {
      if (!preservePrimaryError) throw error;
      logger.error('[steelLifecycle] Reservation cleanup failed after a rejected write.');
    }
  }
}

async function advanceGates(
  mongoose: Mongoose,
  scopes: Array<SteelConversationScope | { conversationId: string }>,
  session?: ClientSession,
): Promise<Array<{ key: string }>> {
  const unique: Array<SteelConversationScope | { conversationId: string }> = [];
  for (const scope of scopes) {
    if (!unique.some((candidate) => sameScope(candidate, scope))) unique.push(scope);
  }
  const reservations: Array<{ key: string }> = [];
  try {
    for (const scope of unique) reservations.push(await advanceGate(mongoose, scope, session));
    return reservations;
  } catch (error) {
    if ((!session?.inTransaction() && (error instanceof SteelConversationDeletedError || error instanceof SteelConversationOwnerError)) || canReleaseAfterFailure(error, session)) {
      await releaseGates(mongoose, reservations, session, true);
    }
    throw error;
  }
}

async function readPreimages(
  collection: SteelCollection,
  filter: PlainRecord,
  session: ClientSession | undefined,
  many: boolean,
): Promise<PlainRecord[]> {
  const cursor = collection.find(filter, sessionOptions(session));
  if (many) return cursor.toArray();
  const one = await cursor.limit(1).next();
  return one ? [one] : [];
}

function requireScopes(
  records: PlainRecord[],
  legacy: boolean,
): Array<SteelConversationScope | { conversationId: string }> {
  const scopes = records.map((record) => scopeFromRecord(record, legacy));
  if (scopes.some((scope): scope is undefined => scope === undefined)) {
    throw new Error('Steel conversation write identity is missing.');
  }
  return scopes as Array<SteelConversationScope | { conversationId: string }>;
}

async function scopesForUpdate(
  collection: SteelCollection,
  filter: PlainRecord,
  update: unknown,
  options: SteelGuardOptions,
  legacy: boolean,
  session: ClientSession | undefined,
  many: boolean,
  replacement = false,
): Promise<Array<SteelConversationScope | { conversationId: string }>> {
  const records = await readPreimages(collection, filter, session, many);
  const scopes = requireScopes(records, legacy);
  const candidates = scopeCandidatesFromFilterAndUpdate(filter, update, legacy, replacement);
  if (!candidates) throw new Error('Steel conversation identity mutation is invalid.');
  if (candidates.length === 0 && hasIdentityFields(update, replacement)) {
    throw new Error('Steel conversation identity mutation is invalid.');
  }
  if (options.upsert === true && candidates.length !== 1) {
    throw new Error('Steel conversation upsert identity is missing.');
  }
  if (records.length === 0) {
    if (candidates.length === 1) scopes.push(candidates[0]);
    else if (options.upsert === true || candidates.length > 1) {
      throw new Error('Steel conversation upsert identity is missing.');
    }
  } else if (candidates.some((candidate) => !scopes.some((scope) => sameScope(scope, candidate)))) {
    throw new Error('Steel conversation identity mutation is not allowed.');
  }
  return scopes;
}

function bulkOperationScopes(
  operation: MongoDocument,
): { filter?: PlainRecord; update?: unknown; replacement?: boolean; many?: boolean; insert?: PlainRecord; invalid?: boolean; upsert?: boolean } | undefined {
  if (isRecord(operation.insertOne)) {
    return isRecord(operation.insertOne.document)
      ? { insert: operation.insertOne.document }
      : { invalid: true };
  }
  for (const name of ['updateOne', 'updateMany', 'replaceOne']) {
    const value = operation[name];
    if (!isRecord(value)) continue;
    if (!isRecord(value.filter)) return { invalid: true };
    return {
      filter: value.filter as PlainRecord,
      update: name === 'replaceOne' ? value.replacement : value.update,
      replacement: name === 'replaceOne',
      many: name === 'updateMany',
      upsert: value.upsert === true,
    };
  }
  return undefined;
}

async function resolveBulkScopes(
  collection: SteelCollection,
  operations: readonly MongoDocument[],
  legacy: boolean,
  session: ClientSession | undefined,
): Promise<Array<SteelConversationScope | { conversationId: string }>> {
  const scopes: Array<SteelConversationScope | { conversationId: string }> = [];
  for (const operation of operations) {
    const parts = bulkOperationScopes(operation);
    if (!parts) continue;
    if (parts.invalid) throw new Error('Steel conversation bulk write identity is missing.');
    if (parts.insert) {
      const scope = scopeFromRecord(parts.insert, legacy);
      if (!scope) throw new Error('Steel conversation insert identity is missing.');
      scopes.push(scope);
      continue;
    }
    if (parts.replacement && !isRecord(parts.update)) {
      throw new Error('Steel conversation replacement identity is missing.');
    }
    const records = await readPreimages(collection, parts.filter ?? {}, session, parts.many === true);
    scopes.push(...requireScopes(records, legacy));
    const candidates = scopeCandidatesFromFilterAndUpdate(parts.filter, parts.update, legacy, parts.replacement === true);
    if (!candidates) throw new Error('Steel conversation identity mutation is invalid.');
    if (candidates.length === 0 && hasIdentityFields(parts.update, parts.replacement === true)) {
      throw new Error('Steel conversation identity mutation is invalid.');
    }
    if (parts.upsert === true && candidates.length !== 1) {
      throw new Error('Steel conversation upsert identity is missing.');
    }
    if (records.length === 0) {
      if (candidates.length === 1) scopes.push(candidates[0]);
      else if (parts.upsert === true || candidates.length > 1) {
        throw new Error('Steel conversation upsert identity is missing.');
      }
    } else {
      if (candidates.some((candidate) => !scopes.some((scope) => sameScope(scope, candidate)))) {
        throw new Error('Steel conversation identity mutation is not allowed.');
      }
    }
  }
  return scopes;
}

async function guardedWrite(
  mongoose: Mongoose,
  collection: SteelCollection,
  original: DriverMethod,
  args: DriverArguments,
  method: string,
  legacy: boolean,
): Promise<unknown> {
  const optionIndex = method === 'insertOne' || method === 'insertMany' || method === 'bulkWrite' ? 1 : 2;
  const options = getOptions(args, optionIndex);
  if (hasUnacknowledgedWriteConcern(options)) {
    throw new Error('Steel conversation writes require acknowledged MongoDB operations.');
  }
  const session = options.session;
  let scopes: Array<SteelConversationScope | { conversationId: string }> = [];
  if (method === 'insertOne') {
    const scope = scopeFromRecord(args[0], legacy);
    if (!scope) throw new Error('Steel conversation insert identity is missing.');
    scopes = [scope];
  } else if (method === 'insertMany') {
    const candidateScopes = (Array.isArray(args[0]) ? args[0] : []).map((value) => scopeFromRecord(value, legacy));
    if (candidateScopes.some((scope) => scope === undefined)) {
      throw new Error('Steel conversation insert identity is missing.');
    }
    scopes = candidateScopes as Array<SteelConversationScope | { conversationId: string }>;
  } else if (method === 'bulkWrite') {
    scopes = await resolveBulkScopes(collection, Array.isArray(args[0]) ? args[0] as MongoDocument[] : [], legacy, session);
  } else {
    scopes = await scopesForUpdate(collection, args[0] as PlainRecord, args[1], options, legacy, session,
      method === 'updateMany', method === 'replaceOne' || method === 'findOneAndReplace');
  }
  const reservations = await advanceGates(mongoose, scopes, session);
  let releaseReservations = false;
  let primaryFailure = false;
  try {
    const callArgs = withSession(args, optionIndex, session);
    const result = await BYPASS.run(new Set([collection]), () => original.apply(collection, callArgs));
    releaseReservations = isAcknowledgedWriteResult(result);
    return result;
  } catch (error) {
    primaryFailure = true;
    releaseReservations = canReleaseAfterFailure(error, session);
    throw error;
  } finally {
    if (releaseReservations) {
      await releaseGates(mongoose, reservations, session, primaryFailure);
    }
  }
}

function patchCollectionMethod(
  mongoose: Mongoose,
  collection: SteelCollection,
  method: string,
  legacy: boolean,
): void {
  const original = collection[method];
  if (typeof original !== 'function') return;
  const originalMethod = original as DriverMethod;
  collection[method] = function guardedCollectionMethod(...args: DriverArguments): Promise<unknown> {
    const active = BYPASS.getStore();
    if (active?.has(collection)) return originalMethod.apply(collection, args);
    return guardedWrite(mongoose, collection, originalMethod, args, method, legacy);
  };
}

export function guardSteelConversationModel<T>(
  mongoose: Mongoose,
  model: Model<T>,
  legacy: boolean,
): Model<T> {
  createLifecycleModel(mongoose);
  const collection = model.collection as unknown as SteelCollection;
  if (guardedCollections.has(collection)) return model;
  guardedCollections.add(collection);
  for (const method of [
    'insertOne',
    'insertMany',
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'bulkWrite',
  ]) patchCollectionMethod(mongoose, collection, method, legacy);
  return model;
}

/** Called for an authorized deletion; absent parents require an existing owned deletion marker. */
export async function fenceSteelConversationWrites(
  mongoose: Mongoose,
  scope: SteelConversationScope,
): Promise<boolean> {
  const Gate = createLifecycleModel(mongoose);
  const Conversation = mongoose.models.Conversation;
  const identities = await runAsSystem(async () => Conversation.find({ conversationId: scope.conversationId })
    .select('user tenantId').lean<Array<{ user: string; tenantId?: string }>>());
  if (identities.some((identity) => identity.user !== scope.userId || (identity.tenantId ?? undefined) !== scope.tenantId)) {
    throw new SteelConversationOwnerError();
  }
  const prior = await Gate.findById(scope.conversationId).lean<SteelConversationLifecycleDocument>();
  if (prior?.userId && !sameOwner(prior, scope)) throw new SteelConversationOwnerError();
  if (identities.length === 0 && !(prior?.deleted && sameOwner(prior, scope))) return false;
  if (prior?.deleted) return true;
  try {
    await Gate.updateOne(
      {
        _id: scope.conversationId,
        deleted: { $ne: true },
        pendingWrites: { $in: [0, null] },
        $or: [
          { userId: scope.userId, tenantId: scope.tenantId ?? null },
          { userId: { $exists: false } },
        ],
      },
      {
        $set: { deleted: true, userId: scope.userId, tenantId: scope.tenantId ?? null },
        $setOnInsert: { _id: scope.conversationId, conversationId: scope.conversationId, pendingWrites: 0 },
      },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const gate = await Gate.findById(scope.conversationId).lean<SteelConversationLifecycleDocument>();
    if (gate?.userId && !sameOwner(gate, scope)) throw new SteelConversationOwnerError();
    if (!gate?.deleted) throw new SteelConversationWritePendingError();
  }
  return true;
}

export async function readSteelConversationDeletionScope(
  mongoose: Mongoose,
  scope: SteelConversationScope,
): Promise<SteelConversationDeletionScope> {
  const gate = await createLifecycleModel(mongoose).findById(scope.conversationId)
    .lean<SteelConversationLifecycleDocument>();
  return { deleted: gate?.deleted === true && sameOwner(gate, scope) };
}
