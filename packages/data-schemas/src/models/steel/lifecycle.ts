import { Schema, mongo } from 'mongoose';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Document as MongoDocument } from 'mongodb';
import type { ClientSession, Model } from 'mongoose';
import { runAsSystem } from '~/config/tenantContext';

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
  revision: number;
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
    revision: { type: Number, required: true, default: 0 },
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

function isTransactionUnsupported(error: unknown): boolean {
  return error instanceof mongo.MongoServerError && error.code === 20 &&
    error.message.includes('Transaction numbers');
}

function sessionOptions(session?: ClientSession): PlainRecord {
  return session ? { session } : {};
}

const transactionFences = new WeakMap<object, Map<string, SteelConversationLifecycleDocument>>();

function assertOwner(marker: SteelConversationLifecycleDocument, scope: LifecycleScope): void {
  if (isLifecycleScope(scope) && marker.userId && !sameOwner(marker, scope)) {
    throw new SteelConversationOwnerError();
  }
}

/** One atomic deletion fence per conversation and transaction attempt; no release is needed. */
export async function protectSteelConversationWrite(
  mongoose: Mongoose,
  scope: LifecycleScope,
  session: ClientSession,
): Promise<void> {
  if (!session.inTransaction()) throw new Error('Steel writes require a transaction.');
  const key = scopeKey(scope);
  let fences = transactionFences.get(session.transaction);
  if (!fences) {
    fences = new Map();
    transactionFences.set(session.transaction, fences);
  }
  const cached = fences.get(key);
  if (cached) {
    assertOwner(cached, scope);
    if (!isLifecycleScope(scope) || cached.userId) return;
  }
  const Marker = createLifecycleModel(mongoose);
  const current = await Marker.findById(key).session(session).lean<SteelConversationLifecycleDocument>();
  if (current?.deleted) throw new SteelConversationDeletedError();
  if (current) assertOwner(current, scope);
  const canonical = isLifecycleScope(scope);
  try {
    const marker = await Marker.findOneAndUpdate(
      { _id: key, deleted: { $ne: true },
        ...(canonical ? { $or: [{ userId: scope.userId, tenantId: scope.tenantId ?? null }, { userId: { $exists: false } }] } : {}),
      },
      {
        ...(canonical ? { $set: { userId: scope.userId, tenantId: scope.tenantId ?? null } } : {}),
        $setOnInsert: { _id: key, conversationId: scope.conversationId },
        $inc: { revision: 1 },
      },
      { upsert: true, new: true, session },
    ).lean<SteelConversationLifecycleDocument>();
    if (!marker) throw new SteelConversationDeletedError();
    fences.set(key, marker);
  } catch (error) {
    // Only a concurrent first insert of this marker can hit its unique _id index.
    if (error instanceof mongo.MongoServerError && isDuplicateKey(error)) {
      error.addErrorLabel(mongo.MongoErrorLabel.TransientTransactionError);
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
  records: readonly unknown[],
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
  if (options.w === 0 || (isRecord(options.writeConcern) && options.writeConcern.w === 0)) {
    throw new Error('Steel conversation writes require acknowledged MongoDB operations.');
  }
  const write = async (session: ClientSession): Promise<unknown> => {
    let scopes: LifecycleScope[];
    if (method === 'insertOne' || method === 'insertMany') {
      let records: DriverArguments = [];
      if (method === 'insertOne') records = [args[0]];
      else if (Array.isArray(args[0])) records = args[0];
      scopes = requireScopes(records, legacy);
    } else if (method === 'bulkWrite') {
      scopes = await resolveBulkScopes(collection, Array.isArray(args[0]) ? args[0] as MongoDocument[] : [], legacy, session);
    } else {
      scopes = await scopesForUpdate(collection, args[0] as PlainRecord, args[1], options, legacy, session,
        method === 'updateMany', method === 'replaceOne' || method === 'findOneAndReplace');
    }
    for (const scope of scopes) await protectSteelConversationWrite(mongoose, scope, session);
    return BYPASS.run(new Set([collection]), () => original.apply(collection, withSession(args, optionIndex, session)));
  };
  if (options.session?.inTransaction()) return write(options.session);
  const session = options.session ?? await mongoose.startSession();
  try {
    return await session.withTransaction(() => write(session));
  } finally {
    if (!options.session) await session.endSession();
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

/**
 * Called for an authorized deletion; absent parents require an existing owned deletion marker.
 * Without transaction support guarded Steel writes fail closed, so no Steel state exists to fence.
 */
export async function fenceSteelConversationWrites(
  mongoose: Mongoose,
  scope: SteelConversationScope,
): Promise<boolean> {
  const Marker = createLifecycleModel(mongoose);
  const Conversation = mongoose.models.Conversation;
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const identities = await runAsSystem(async () => Conversation.find({ conversationId: scope.conversationId })
        .session(session).select('user tenantId').lean<Array<{ user: string; tenantId?: string }>>());
      if (identities.some((identity) => identity.user !== scope.userId || (identity.tenantId ?? undefined) !== scope.tenantId)) {
        throw new SteelConversationOwnerError();
      }
      const prior = await Marker.findById(scope.conversationId).session(session).lean<SteelConversationLifecycleDocument>();
      if (prior) assertOwner(prior, scope);
      if (prior?.deleted) return true;
      if (identities.length === 0) return false;
      await protectSteelConversationWrite(mongoose, scope, session);
      await Marker.updateOne(
        { _id: scope.conversationId, userId: scope.userId, tenantId: scope.tenantId ?? null },
        { $set: { deleted: true } },
        { session },
      );
      return true;
    });
  } catch (error) {
    if (isTransactionUnsupported(error)) return false;
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function readSteelConversationDeletionScope(
  mongoose: Mongoose,
  scope: SteelConversationScope,
): Promise<SteelConversationDeletionScope> {
  const gate = await createLifecycleModel(mongoose).findById(scope.conversationId)
    .lean<SteelConversationLifecycleDocument>();
  return { deleted: gate?.deleted === true && sameOwner(gate, scope) };
}
