import { createHash, randomUUID } from 'crypto';

import {
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
} from '@librechat/data-schemas';

import type {
  ISteelQuotationArtifact,
  ISteelQuotationState,
  SteelQuotationActiveRun,
  SteelQuotationArtifactKind,
  SteelQuotationArtifactRef,
  SteelQuotationCheckpointRef,
  SteelQuotationChunkState,
  SteelQuotationCustomerPreparation,
  SteelQuotationOrder,
  SteelQuotationPendingMessage,
  SteelQuotationPendingMessageFile,
  SteelQuotationRunStatus,
  SteelQuotationScope,
  SteelQuotationSelectionProvenance,
  SteelQuotationSnapshotPayload,
  SteelQuotationTicket,
} from '@librechat/data-schemas';

type Mongoose = typeof import('mongoose');
type StateModel = ReturnType<typeof createSteelQuotationStateModel>;
type ArtifactModel = ReturnType<typeof createSteelQuotationArtifactModel>;

export const MAX_QUOTATION_ORDER_BYTES = 250_000;
export const MAX_QUOTATION_CUSTOMER_BYTES = 100_000;
export const MAX_QUOTATION_PROMPT_BYTES = 250_000;
export const MAX_QUOTATION_ARTIFACT_BYTES = 2_000_000;
export const MAX_QUOTATION_AUTHORITY_BYTES = 1_000_000;
export const MAX_QUOTATION_TICKETS = 64;
export const MAX_QUOTATION_PENDING_MESSAGES = 64;
export const MAX_QUOTATION_PENDING_FILES = 32;
export const MAX_QUOTATION_CHUNKS = 512;
export const DEFAULT_QUOTATION_LEASE_MS = 60_000;

const unfinishedStatuses: readonly SteelQuotationRunStatus[] = [
  'queued',
  'running',
  'aggregating',
  'finalizing',
  'interrupted',
];
const terminalStatuses: readonly SteelQuotationRunStatus[] = ['completed', 'cancelled'];
const leaseStatuses: readonly SteelQuotationRunStatus[] = [
  'queued',
  'running',
  'aggregating',
  'finalizing',
  'interrupted',
];

export interface SteelQuotationOrderInput {
  scope: SteelQuotationScope;
  fullMarkdown: string;
  revision?: string;
  messageId?: string;
  now?: Date;
}

export interface SteelQuotationIssueTicketInput {
  scope: SteelQuotationScope;
  customerMarkdown: string;
  customerIdentity: string;
  triggeringMessageId: string;
  selectionProvenance: SteelQuotationSelectionProvenance;
  preparationId?: string;
  responseId?: string;
  orderHash?: string;
  now?: Date;
}

export interface SteelQuotationSaveCustomerInput {
  scope: SteelQuotationScope;
  customerMarkdown: string;
  customerIdentity: string;
  triggeringMessageId: string;
  responseId: string;
  selectionProvenance: SteelQuotationSelectionProvenance;
  orderHash?: string;
  expectedPreparationId?: string | null;
  now?: Date;
}

export interface SteelQuotationClearCustomerInput {
  scope: SteelQuotationScope;
  responseId: string;
  preparationId?: string;
  orderHash?: string;
}

export interface SteelQuotationChunkInput {
  index: number;
  sourceRowCount: number;
}

export interface SteelQuotationAcceptSignalInput {
  scope: SteelQuotationScope;
  index: number;
  token: string;
  orderHash: string;
  customerMarkdown: string;
  customerIdentity: string;
  prompts: SteelQuotationSnapshotPayload['prompts'];
  chunks: readonly SteelQuotationChunkInput[];
  targetMessageId?: string;
  now?: Date;
}

export interface SteelQuotationWriteArtifactInput {
  scope: SteelQuotationScope;
  runId: string;
  operationId: string;
  kind: SteelQuotationArtifactKind;
  payload: string;
  sha256?: string;
  leaseToken?: string;
  now?: Date;
}

export interface SteelQuotationReadArtifactInput {
  scope: SteelQuotationScope;
  ref: SteelQuotationArtifactRef;
}

export interface SteelQuotationCheckpointInput {
  scope: SteelQuotationScope;
  runId: string;
  leaseToken: string;
  operationId: string;
  kind: Exclude<SteelQuotationArtifactKind, 'snapshot' | 'archive'>;
  payload?: string;
  artifactRef?: SteelQuotationArtifactRef;
  chunkIndex?: number;
  now?: Date;
}

export interface SteelQuotationAcquireLeaseInput {
  scope: SteelQuotationScope;
  runId: string;
  leaseToken?: string;
  now?: Date;
  leaseDurationMs?: number;
}

export interface SteelQuotationLease {
  runId: string;
  leaseToken: string;
  expiresAt: Date;
}

export interface SteelQuotationRunInput {
  scope: SteelQuotationScope;
  runId: string;
  leaseToken: string;
  now?: Date;
}

export interface SteelQuotationTransitionRunInput extends SteelQuotationRunInput {
  status: Exclude<SteelQuotationRunStatus, 'completed' | 'cancelled' | 'interrupted'>;
}

export interface SteelQuotationCompleteRunInput extends SteelQuotationRunInput {
  finalRef: SteelQuotationArtifactRef;
  targetMessageId?: string;
}

export interface SteelQuotationMarkPublishedInput {
  scope: SteelQuotationScope;
  runId: string;
  finalSha256: string;
  targetMessageId?: string;
  now?: Date;
}

export interface SteelQuotationPendingMessageInput {
  scope: SteelQuotationScope;
  sourceMessageId: string;
  sourceMessageText?: string;
  sourceMessageFiles?: readonly SteelQuotationPendingMessageFile[];
  targetMessageId?: string;
  preserveExistingTarget?: boolean;
  now?: Date;
}

export interface SteelQuotationClaimPendingInput {
  scope: SteelQuotationScope;
  claimToken?: string;
  now?: Date;
  leaseDurationMs?: number;
}

export interface SteelQuotationPendingClaim {
  sourceMessageId: string;
  sourceMessageText?: string;
  sourceMessageFiles?: SteelQuotationPendingMessageFile[];
  resultRef?: SteelQuotationArtifactRef;
  resultMarkdown?: string;
  targetMessageId?: string;
  claimToken: string;
  claimExpiresAt: Date;
}

export interface SteelQuotationCompletePendingInput {
  scope: SteelQuotationScope;
  sourceMessageId: string;
  claimToken: string;
  targetMessageId?: string;
  now?: Date;
}

export interface SteelQuotationRenewPendingInput {
  scope: SteelQuotationScope;
  sourceMessageId: string;
  claimToken: string;
  now?: Date;
  leaseDurationMs?: number;
}

export interface SteelQuotationSavePendingResultInput {
  scope: SteelQuotationScope;
  sourceMessageId: string;
  claimToken: string;
  markdown: string;
  targetMessageId?: string;
  now?: Date;
}

export interface SteelQuotationSavedPendingResult {
  sourceMessageId: string;
  markdown: string;
  targetMessageId?: string;
  resultRef: SteelQuotationArtifactRef;
}

export interface SteelQuotationCompletedPendingMessage {
  sourceMessageId: string;
  targetMessageId?: string;
}

export interface SteelQuotationDeleteResult {
  stateDeleted: number;
  artifactsDeleted: number;
}

export interface SteelQuotationStateService {
  ensureState(scope: SteelQuotationScope): Promise<ISteelQuotationState>;
  readState(scope: SteelQuotationScope): Promise<ISteelQuotationState | null>;
  hasSystemOrder(scope: SteelQuotationScope): Promise<boolean>;
  setOrder(input: SteelQuotationOrderInput): Promise<ISteelQuotationState>;
  saveCustomer(input: SteelQuotationSaveCustomerInput): Promise<SteelQuotationCustomerPreparation>;
  clearCustomer(input: SteelQuotationClearCustomerInput): Promise<ISteelQuotationState>;
  issueTicket(input: SteelQuotationIssueTicketInput): Promise<SteelQuotationTicket>;
  acceptSignal(input: SteelQuotationAcceptSignalInput): Promise<SteelQuotationActiveRun>;
  writeArtifact(input: SteelQuotationWriteArtifactInput): Promise<SteelQuotationArtifactRef>;
  getArtifact(input: {
    scope: SteelQuotationScope;
    runId: string;
    operationId: string;
  }): Promise<ISteelQuotationArtifact | null>;
  readArtifact(input: SteelQuotationReadArtifactInput): Promise<string | undefined>;
  readCheckpoint(input: {
    scope: SteelQuotationScope;
    runId: string;
    operationId: string;
  }): Promise<string | undefined>;
  checkpoint(input: SteelQuotationCheckpointInput): Promise<ISteelQuotationState | undefined>;
  acquireLease(input: SteelQuotationAcquireLeaseInput): Promise<SteelQuotationLease | undefined>;
  heartbeatLease(input: SteelQuotationAcquireLeaseInput): Promise<SteelQuotationLease | undefined>;
  releaseLease(input: SteelQuotationRunInput): Promise<SteelQuotationActiveRun | undefined>;
  transitionRun(
    input: SteelQuotationTransitionRunInput,
  ): Promise<SteelQuotationActiveRun | undefined>;
  interruptRun(input: SteelQuotationRunInput): Promise<SteelQuotationActiveRun | undefined>;
  cancelRun(input: Omit<SteelQuotationRunInput, 'leaseToken'> & { leaseToken?: string }): Promise<
    SteelQuotationActiveRun | undefined
  >;
  completeRun(input: SteelQuotationCompleteRunInput): Promise<SteelQuotationActiveRun | undefined>;
  markPublished(
    input: SteelQuotationMarkPublishedInput,
  ): Promise<SteelQuotationActiveRun | undefined>;
  enqueuePendingMessage(
    input: SteelQuotationPendingMessageInput,
  ): Promise<SteelQuotationPendingMessage>;
  claimPendingMessage(
    input: SteelQuotationClaimPendingInput,
  ): Promise<SteelQuotationPendingClaim | undefined>;
  renewPendingClaim(
    input: SteelQuotationRenewPendingInput,
  ): Promise<SteelQuotationPendingClaim | undefined>;
  savePendingResult(
    input: SteelQuotationSavePendingResultInput,
  ): Promise<SteelQuotationSavedPendingResult | undefined>;
  completePendingMessage(
    input: SteelQuotationCompletePendingInput,
  ): Promise<SteelQuotationCompletedPendingMessage | undefined>;
  deleteConversation(scope: SteelQuotationScope): Promise<SteelQuotationDeleteResult>;
}

function nowOrDefault(now?: Date): Date {
  return now ? new Date(now.getTime()) : new Date();
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function validateScope(scope: SteelQuotationScope): void {
  if (!scope.userId || !scope.conversationId) {
    throw new Error('quotation scope requires userId and conversationId');
  }
}

function validateText(value: string, field: string, limit: number): void {
  if (!value) {
    throw new Error(`${field} must not be empty`);
  }
  if (byteLength(value) > limit) {
    throw new Error(`${field} exceeds ${limit} bytes`);
  }
}

function validateSelectionProvenance(selectionProvenance: SteelQuotationSelectionProvenance): void {
  if (!selectionProvenance || !['unique', 'selected', 'default_tier'].includes(selectionProvenance.method)) {
    throw new Error('selectionProvenance method is invalid');
  }
  for (const [name, value] of [
    ['lookupMessageId', selectionProvenance.lookupMessageId],
    ['selectionMessageId', selectionProvenance.selectionMessageId],
    ['selectedCustomerId', selectionProvenance.selectedCustomerId],
  ] as const) {
    if (value !== undefined) {
      validateText(value, `selectionProvenance.${name}`, 1_000);
    }
  }
}

function validatePositiveIndex(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`);
  }
}

function validateLeaseDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 86_400_000) {
    throw new Error('leaseDurationMs must be between 1000 and 86400000');
  }
}

function validatePendingFiles(files: readonly SteelQuotationPendingMessageFile[] | undefined): void {
  if (!files) {
    return;
  }
  if (files.length > MAX_QUOTATION_PENDING_FILES) {
    throw new Error(`pending message exceeds ${MAX_QUOTATION_PENDING_FILES} files`);
  }
  for (const file of files) {
    for (const [name, value] of [
      ['fileId', file.fileId],
      ['filename', file.filename],
      ['storageKey', file.storageKey],
      ['mediaType', file.mediaType],
    ] as const) {
      if (value !== undefined) {
        validateText(value, `pending file ${name}`, 2_000);
      }
    }
    for (const [name, value] of [
      ['pageNumber', file.pageNumber],
      ['imageIndex', file.imageIndex],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error(`pending file ${name} must be a non-negative safe integer`);
      }
    }
  }
}

function isUnfinished(status: SteelQuotationRunStatus | undefined): boolean {
  return status !== undefined && unfinishedStatuses.includes(status);
}

function isTerminal(status: SteelQuotationRunStatus | undefined): boolean {
  return status !== undefined && terminalStatuses.includes(status);
}

function stateFilter(scope: SteelQuotationScope) {
  return { userId: scope.userId, conversationId: scope.conversationId };
}

function authorityByteLength(state: SteelQuotationStateLike): number {
  return byteLength(
    JSON.stringify({
      userId: state.userId,
      conversationId: state.conversationId,
      currentOrder: state.currentOrder,
      currentCustomer: state.currentCustomer,
      nextSignalIndex: state.nextSignalIndex,
      tickets: state.tickets,
      activeRun: state.activeRun,
      pendingMessages: state.pendingMessages,
    }),
  );
}

interface SteelQuotationStateLike {
  userId: string;
  conversationId: string;
  currentOrder?: SteelQuotationOrder;
  currentCustomer?: SteelQuotationCustomerPreparation;
  nextSignalIndex: number;
  tickets: SteelQuotationTicket[];
  activeRun?: SteelQuotationActiveRun;
  pendingMessages: SteelQuotationPendingMessage[];
}

interface SteelQuotationPendingCompletionReceipt {
  sourceMessageId: string;
  sourceMessageText?: string;
  sourceMessageFiles?: SteelQuotationPendingMessageFile[];
  targetMessageId?: string;
  completedTargetMessageId?: string;
  resultRef: SteelQuotationArtifactRef;
}

function assertAuthorityBounds(state: SteelQuotationStateLike): void {
  if (state.tickets.length > MAX_QUOTATION_TICKETS) {
    throw new Error(`quotation authority exceeds ${MAX_QUOTATION_TICKETS} tickets`);
  }
  if (state.pendingMessages.length > MAX_QUOTATION_PENDING_MESSAGES) {
    throw new Error(`quotation authority exceeds ${MAX_QUOTATION_PENDING_MESSAGES} pending messages`);
  }
  if ((state.activeRun?.chunks.length ?? 0) > MAX_QUOTATION_CHUNKS) {
    throw new Error(`quotation authority exceeds ${MAX_QUOTATION_CHUNKS} chunks`);
  }
  if (authorityByteLength(state) > MAX_QUOTATION_AUTHORITY_BYTES) {
    throw new Error(`quotation authority exceeds ${MAX_QUOTATION_AUTHORITY_BYTES} bytes`);
  }
}

function cloneScopeRef(scope: SteelQuotationScope, ref: SteelQuotationArtifactRef): boolean {
  return ref.userId === scope.userId && ref.conversationId === scope.conversationId;
}

function artifactRef(
  scope: SteelQuotationScope,
  runId: string,
  operationId: string,
  kind: SteelQuotationArtifactKind,
  sha256: string,
): SteelQuotationArtifactRef {
  return {
    artifactId: `${runId}:${operationId}:${sha256}`,
    userId: scope.userId,
    conversationId: scope.conversationId,
    runId,
    operationId,
    kind,
    sha256,
  };
}

function parseArchivedRun(payload: string): SteelQuotationActiveRun | undefined {
  const parsed = JSON.parse(payload) as { run?: SteelQuotationActiveRun };
  if (!parsed.run || !parsed.run.runId || !isTerminal(parsed.run.status)) {
    return undefined;
  }
  return parsed.run;
}

function getActiveRun(state: ISteelQuotationState | null, runId: string): SteelQuotationActiveRun | undefined {
  return state?.activeRun?.runId === runId ? state.activeRun : undefined;
}

function isDuplicateKey(error: Error): boolean {
  return 'code' in error && error.code === 11000;
}

function sameSelectionProvenance(
  left: SteelQuotationSelectionProvenance,
  right: SteelQuotationSelectionProvenance,
): boolean {
  return left.method === right.method &&
    left.lookupMessageId === right.lookupMessageId &&
    left.selectionMessageId === right.selectionMessageId &&
    left.selectedCustomerId === right.selectedCustomerId;
}

function matchesCustomerPreparation(
  preparation: SteelQuotationCustomerPreparation | undefined,
  input: Pick<SteelQuotationIssueTicketInput, 'customerMarkdown' | 'customerIdentity' | 'selectionProvenance'> & {
    preparationId?: string;
  },
): boolean {
  return preparation !== undefined &&
    preparation.customerMarkdown === input.customerMarkdown &&
    preparation.customerIdentity === input.customerIdentity &&
    preparation.preparationId === input.preparationId &&
    sameSelectionProvenance(preparation.selectionProvenance, input.selectionProvenance);
}

export function createSteelQuotationStateService(mongoose: Mongoose): SteelQuotationStateService {
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);

  async function ensureState(scope: SteelQuotationScope): Promise<ISteelQuotationState> {
    validateScope(scope);
    try {
      await State.updateOne(
        stateFilter(scope),
        {
          $setOnInsert: {
            userId: scope.userId,
            conversationId: scope.conversationId,
            nextSignalIndex: 0,
            tickets: [],
            pendingMessages: [],
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!(error instanceof Error) || !isDuplicateKey(error)) {
        throw error;
      }
    }
    const state = await State.findOne(stateFilter(scope)).lean<ISteelQuotationState>();
    if (!state) {
      throw new Error('quotation authority state could not be created');
    }
    assertAuthorityBounds(state);
    return state;
  }

  async function readState(scope: SteelQuotationScope): Promise<ISteelQuotationState | null> {
    validateScope(scope);
    const state = await State.findOne(stateFilter(scope)).lean<ISteelQuotationState>();
    if (state) {
      assertAuthorityBounds(state);
    }
    return state;
  }

  async function hasSystemOrder(scope: SteelQuotationScope): Promise<boolean> {
    validateScope(scope);
    const matches = await State.aggregate<{ exists: boolean }>([
      { $match: { ...stateFilter(scope), 'activeRun.status': 'completed' } },
      { $limit: 1 },
      { $lookup: {
        from: Artifact.collection.name,
        let: { runId: '$activeRun.runId' },
        pipeline: [
          { $match: {
            ...stateFilter(scope),
            kind: 'final',
            operationId: 'final',
            $expr: { $eq: ['$runId', '$$runId'] },
          } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: 'currentFinal',
      } },
      { $match: { 'currentFinal.0': { $exists: true } } },
      { $project: { _id: 0, exists: { $literal: true } } },
    ]);
    return matches.length > 0;
  }

  async function setOrder(input: SteelQuotationOrderInput): Promise<ISteelQuotationState> {
    validateScope(input.scope);
    validateText(input.fullMarkdown, 'fullMarkdown', MAX_QUOTATION_ORDER_BYTES);
    const now = nowOrDefault(input.now);
    const sha256 = hashText(input.fullMarkdown);
    const nextOrder: SteelQuotationOrder = {
      markdown: input.fullMarkdown,
      sha256,
      ...(input.revision !== undefined ? { revision: input.revision } : {}),
      ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
    };
    await ensureState(input.scope);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await readState(input.scope);
      if (!current) {
        continue;
      }
      if (isUnfinished(current.activeRun?.status)) {
        throw new Error('cannot set quotation order while a run is unfinished');
      }
      const orderChanged = current.currentOrder?.sha256 !== sha256;
      const retainedTickets = current.tickets.filter((ticket) => ticket.acceptedRunId);
      const filter = {
        ...stateFilter(input.scope),
        nextSignalIndex: current.nextSignalIndex,
        ...(current.currentOrder?.sha256
          ? { 'currentOrder.sha256': current.currentOrder.sha256 }
          : { 'currentOrder.sha256': { $exists: false } }),
        $or: [
          { activeRun: { $exists: false } },
          { 'activeRun.status': { $in: terminalStatuses } },
        ],
      };
      const update = orderChanged
        ? {
            $set: { currentOrder: nextOrder, tickets: retainedTickets, updatedAt: now },
          }
        : { $set: { currentOrder: nextOrder, updatedAt: now } };
      assertAuthorityBounds({
        userId: current.userId,
        conversationId: current.conversationId,
        currentOrder: nextOrder,
        currentCustomer: current.currentCustomer,
        nextSignalIndex: current.nextSignalIndex,
        tickets: orderChanged ? retainedTickets : current.tickets,
        activeRun: current.activeRun,
        pendingMessages: current.pendingMessages,
      });
      const updated = await State.findOneAndUpdate(filter, update, { new: true }).lean<ISteelQuotationState>();
      if (updated) {
        assertAuthorityBounds(updated);
        return updated;
      }
    }
    throw new Error('quotation order changed concurrently; retry the operation');
  }

  async function saveCustomer(
    input: SteelQuotationSaveCustomerInput,
  ): Promise<SteelQuotationCustomerPreparation> {
    validateScope(input.scope);
    validateText(input.customerMarkdown, 'customerMarkdown', MAX_QUOTATION_CUSTOMER_BYTES);
    validateText(input.customerIdentity, 'customerIdentity', MAX_QUOTATION_CUSTOMER_BYTES);
    validateText(input.triggeringMessageId, 'triggeringMessageId', 1_000);
    validateText(input.responseId, 'responseId', 300);
    if (input.orderHash !== undefined) {
      validateText(input.orderHash, 'orderHash', 128);
    }
    if (input.expectedPreparationId !== undefined && input.expectedPreparationId !== null) {
      validateText(input.expectedPreparationId, 'expectedPreparationId', 200);
    }
    validateSelectionProvenance(input.selectionProvenance);
    const now = nowOrDefault(input.now);
    const preparation: SteelQuotationCustomerPreparation = {
      preparationId: randomUUID(),
      customerMarkdown: input.customerMarkdown,
      customerIdentity: input.customerIdentity,
      triggeringMessageId: input.triggeringMessageId,
      responseId: input.responseId,
      selectionProvenance: input.selectionProvenance,
      ...(input.orderHash !== undefined ? { orderHash: input.orderHash } : {}),
    };
    await ensureState(input.scope);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await readState(input.scope);
      const existing = current?.currentCustomer;
      if (
        existing &&
        existing.responseId === input.responseId &&
        existing.customerMarkdown === input.customerMarkdown &&
        existing.customerIdentity === input.customerIdentity &&
        existing.triggeringMessageId === input.triggeringMessageId &&
        existing.orderHash === input.orderHash &&
        sameSelectionProvenance(existing.selectionProvenance, input.selectionProvenance)
      ) {
        return existing;
      }
      if (
        input.expectedPreparationId !== undefined &&
        (existing?.preparationId ?? null) !== input.expectedPreparationId
      ) {
        throw new Error('customer preparation changed since it was read');
      }
      if (
        (input.orderHash === undefined && current?.currentOrder !== undefined) ||
        (input.orderHash !== undefined && current?.currentOrder?.sha256 !== input.orderHash)
      ) {
        throw new Error('customer preparation order is stale');
      }
      if (!current) {
        continue;
      }
      if (isUnfinished(current.activeRun?.status)) {
        throw new Error('cannot save customer preparation while a run is unfinished');
      }
      assertAuthorityBounds({
        ...current,
        currentCustomer: preparation,
      });
      const preparationFilter = input.expectedPreparationId !== undefined
        ? input.expectedPreparationId === null
          ? { currentCustomer: { $exists: false } }
          : { 'currentCustomer.preparationId': input.expectedPreparationId }
        : { 'currentCustomer.responseId': { $ne: input.responseId } };
      const updated = await State.findOneAndUpdate(
        {
          ...stateFilter(input.scope),
          ...(input.orderHash !== undefined
            ? { 'currentOrder.sha256': input.orderHash }
            : { 'currentOrder': { $exists: false } }),
          ...preparationFilter,
          $or: [
            { activeRun: { $exists: false } },
            { 'activeRun.status': { $in: terminalStatuses } },
          ],
        },
        {
          $set: { currentCustomer: preparation, updatedAt: now },
        },
        { new: true },
      ).lean<ISteelQuotationState>();
      if (updated?.currentCustomer?.preparationId === preparation.preparationId) {
        assertAuthorityBounds(updated);
        return updated.currentCustomer;
      }
    }
    throw new Error('customer preparation changed concurrently; retry the operation');
  }

  async function clearCustomer(
    input: SteelQuotationClearCustomerInput,
  ): Promise<ISteelQuotationState> {
    validateScope(input.scope);
    validateText(input.responseId, 'responseId', 300);
    if (input.preparationId !== undefined) {
      validateText(input.preparationId, 'preparationId', 200);
    }
    const current = await ensureState(input.scope);
    if (!current.currentCustomer || (
      input.preparationId !== undefined
        ? current.currentCustomer.preparationId !== input.preparationId
        : current.currentCustomer.responseId !== input.responseId
    )) {
      return current;
    }
    const customerFilter = input.preparationId !== undefined
      ? { 'currentCustomer.preparationId': input.preparationId }
      : { 'currentCustomer.responseId': input.responseId };
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        ...customerFilter,
        ...(input.orderHash !== undefined ? { 'currentOrder.sha256': input.orderHash } : {}),
      },
      {
        $unset: { currentCustomer: 1 },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    if (updated) {
      assertAuthorityBounds(updated);
      return updated;
    }
    const raced = await readState(input.scope);
    if (raced) {
      return raced;
    }
    throw new Error('quotation authority state is unavailable');
  }

  async function issueTicket(
    input: SteelQuotationIssueTicketInput,
  ): Promise<SteelQuotationTicket> {
    validateScope(input.scope);
    validateText(input.customerMarkdown, 'customerMarkdown', MAX_QUOTATION_CUSTOMER_BYTES);
    validateText(input.customerIdentity, 'customerIdentity', MAX_QUOTATION_CUSTOMER_BYTES);
    validateText(input.triggeringMessageId, 'triggeringMessageId', 1_000);
    validateSelectionProvenance(input.selectionProvenance);
    const hasBinding = input.preparationId !== undefined ||
      input.responseId !== undefined || input.orderHash !== undefined;
    if (hasBinding && (input.preparationId === undefined || input.responseId === undefined || input.orderHash === undefined)) {
      throw new Error('quotation ticket binding requires preparationId, responseId and orderHash');
    }
    if (hasBinding) {
      validateText(input.preparationId!, 'preparationId', 200);
      validateText(input.responseId!, 'responseId', 300);
      validateText(input.orderHash!, 'orderHash', 128);
    }
    const now = nowOrDefault(input.now);
    await ensureState(input.scope);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await readState(input.scope);
      if (hasBinding) {
        const existing = current?.tickets.find((candidate) => candidate.responseId === input.responseId);
        if (existing) {
          if (
            existing.customerMarkdown !== input.customerMarkdown ||
            existing.customerIdentity !== input.customerIdentity ||
            existing.orderHash !== input.orderHash ||
            existing.preparationId !== input.preparationId ||
            existing.triggeringMessageId !== input.triggeringMessageId ||
            !sameSelectionProvenance(existing.selectionProvenance, input.selectionProvenance)
          ) {
            throw new Error('quotation ticket response binding is immutable');
          }
          return existing;
        }
      }
      if (!current?.currentOrder) {
        throw new Error('cannot issue quotation ticket without a current order');
      }
      if (isUnfinished(current.activeRun?.status)) {
        throw new Error('cannot issue quotation ticket while a run is unfinished');
      }
      if (current.tickets.length >= MAX_QUOTATION_TICKETS) {
        throw new Error(`quotation authority exceeds ${MAX_QUOTATION_TICKETS} tickets`);
      }
      if (hasBinding && (
        current.currentOrder.sha256 !== input.orderHash ||
        !matchesCustomerPreparation(current.currentCustomer, input)
      )) {
        throw new Error('quotation ticket does not match the current customer preparation');
      }
      const index = current.nextSignalIndex + 1;
      validatePositiveIndex(index, 'quotation index');
      const ticket: SteelQuotationTicket = {
        index,
        token: randomUUID(),
        orderHash: current.currentOrder.sha256,
        customerMarkdown: input.customerMarkdown,
        customerIdentity: input.customerIdentity,
        triggeringMessageId: input.triggeringMessageId,
        selectionProvenance: input.selectionProvenance,
        issuedAt: now,
        ...(hasBinding
          ? { preparationId: input.preparationId, responseId: input.responseId }
          : {}),
      };
      assertAuthorityBounds({
        ...current,
        tickets: [...current.tickets, ticket],
      });
      const updated = await State.findOneAndUpdate(
        {
          ...stateFilter(input.scope),
          nextSignalIndex: current.nextSignalIndex,
          'currentOrder.sha256': current.currentOrder.sha256,
          ...(hasBinding
            ? {
                'currentCustomer.preparationId': input.preparationId,
                'tickets.responseId': { $ne: input.responseId },
              }
            : {}),
          $or: [
            { activeRun: { $exists: false } },
            { 'activeRun.status': { $in: terminalStatuses } },
          ],
        },
        {
          $inc: { nextSignalIndex: 1 },
          $push: { tickets: ticket },
          $set: { updatedAt: now },
        },
        { new: true },
      ).lean<ISteelQuotationState>();
      if (updated) {
        assertAuthorityBounds(updated);
        const issued = updated.tickets.find((candidate) => candidate.token === ticket.token);
        if (!issued) {
          throw new Error('quotation ticket could not be read after persistence');
        }
        return issued;
      }
    }
    throw new Error('quotation ticket changed concurrently; retry the operation');
  }

  async function findArtifact(
    scope: SteelQuotationScope,
    runId: string,
    operationId: string,
    sha256?: string,
  ): Promise<ISteelQuotationArtifact | null> {
    return Artifact.findOne({
      ...stateFilter(scope),
      runId,
      operationId,
      ...(sha256 ? { sha256 } : {}),
    }).lean<ISteelQuotationArtifact>();
  }

  function pendingResultRunId(sourceMessageId: string): string {
    return `pending:${hashText(sourceMessageId)}`;
  }

  function assertPendingMessageIdentity(
    input: Pick<SteelQuotationPendingMessageInput, 'sourceMessageText' | 'sourceMessageFiles' | 'targetMessageId' | 'preserveExistingTarget'>,
    receipt: Pick<SteelQuotationPendingCompletionReceipt, 'sourceMessageText' | 'sourceMessageFiles' | 'targetMessageId' | 'completedTargetMessageId'>,
  ): void {
    if (
      input.sourceMessageText !== undefined &&
      (receipt.sourceMessageText ?? '') !== input.sourceMessageText
    ) {
      throw new Error('pending message identity is immutable');
    }
    if (
      input.sourceMessageFiles !== undefined &&
      JSON.stringify(input.sourceMessageFiles) !== JSON.stringify(receipt.sourceMessageFiles ?? [])
    ) {
      throw new Error('pending message identity is immutable');
    }
    const completedTargetMessageId = receipt.completedTargetMessageId ?? receipt.targetMessageId;
    if (
      !input.preserveExistingTarget &&
      input.targetMessageId !== undefined &&
      completedTargetMessageId !== undefined &&
      input.targetMessageId !== completedTargetMessageId
    ) {
      throw new Error('pending message identity is immutable');
    }
  }

  function pendingMessageFromReceipt(
    receipt: SteelQuotationPendingCompletionReceipt,
    now: Date,
  ): SteelQuotationPendingMessage {
    return {
      sourceMessageId: receipt.sourceMessageId,
      ...(receipt.sourceMessageText !== undefined ? { sourceMessageText: receipt.sourceMessageText } : {}),
      ...(receipt.sourceMessageFiles?.length ? { sourceMessageFiles: receipt.sourceMessageFiles } : {}),
      ...(receipt.targetMessageId ? { targetMessageId: receipt.targetMessageId } : {}),
      status: 'completed',
      resultRef: receipt.resultRef,
      ...(receipt.completedTargetMessageId
        ? { completedTargetMessageId: receipt.completedTargetMessageId }
        : {}),
      enqueuedAt: now,
      updatedAt: now,
    };
  }

  async function readPendingCompletionReceipt(
    scope: SteelQuotationScope,
    sourceMessageId: string,
  ): Promise<SteelQuotationPendingCompletionReceipt | undefined> {
    const artifact = await findArtifact(scope, pendingResultRunId(sourceMessageId), 'completed');
    if (!artifact) {
      return undefined;
    }
    let receipt: SteelQuotationPendingCompletionReceipt;
    try {
      receipt = JSON.parse(artifact.payload) as SteelQuotationPendingCompletionReceipt;
    } catch {
      throw new Error('pending completion receipt is invalid');
    }
    if (
      !receipt ||
      receipt.sourceMessageId !== sourceMessageId ||
      !receipt.resultRef ||
      receipt.resultRef.userId !== scope.userId ||
      receipt.resultRef.conversationId !== scope.conversationId ||
      receipt.resultRef.runId !== pendingResultRunId(sourceMessageId) ||
      receipt.resultRef.operationId !== 'result' ||
      receipt.resultRef.kind !== 'main'
    ) {
      throw new Error('pending completion receipt is invalid');
    }
    return receipt;
  }

  async function writePendingCompletionReceipt(
    scope: SteelQuotationScope,
    message: SteelQuotationPendingMessage,
    now: Date,
  ): Promise<void> {
    if (message.status !== 'completed' || !message.resultRef) {
      return;
    }
    const receipt: SteelQuotationPendingCompletionReceipt = {
      sourceMessageId: message.sourceMessageId,
      ...(message.sourceMessageText !== undefined ? { sourceMessageText: message.sourceMessageText } : {}),
      ...(message.sourceMessageFiles?.length ? { sourceMessageFiles: message.sourceMessageFiles } : {}),
      ...(message.targetMessageId ? { targetMessageId: message.targetMessageId } : {}),
      ...(message.completedTargetMessageId
        ? { completedTargetMessageId: message.completedTargetMessageId }
        : {}),
      resultRef: message.resultRef,
    };
    const payload = JSON.stringify(receipt);
    const ref = artifactRef(
      scope,
      pendingResultRunId(message.sourceMessageId),
      'completed',
      'main',
      hashText(payload),
    );
    await writePendingArtifact(
      scope,
      pendingResultRunId(message.sourceMessageId),
      'completed',
      payload,
      ref,
      now,
    );
  }

  async function archiveCompletedPendingMessages(
    scope: SteelQuotationScope,
    current: ISteelQuotationState,
    now: Date,
  ): Promise<void> {
    const completed = current.pendingMessages.filter(
      (message) => message.status === 'completed' && message.resultRef,
    );
    if (completed.length === 0) {
      return;
    }
    for (const message of completed) {
      await writePendingCompletionReceipt(scope, message, now);
    }
    await State.updateOne(
      {
        ...stateFilter(scope),
        pendingMessages: {
          $elemMatch: {
            status: 'completed',
            sourceMessageId: { $in: completed.map((message) => message.sourceMessageId) },
          },
        },
      },
      {
        $pull: { pendingMessages: { sourceMessageId: { $in: completed.map((message) => message.sourceMessageId) } } },
        $set: { updatedAt: now },
      },
    );
  }

  async function writeArtifact(
    input: SteelQuotationWriteArtifactInput,
  ): Promise<SteelQuotationArtifactRef> {
    validateScope(input.scope);
    validateText(input.runId, 'runId', 200);
    validateText(input.operationId, 'operationId', 300);
    if (byteLength(input.payload) > MAX_QUOTATION_ARTIFACT_BYTES) {
      throw new Error(`artifact payload exceeds ${MAX_QUOTATION_ARTIFACT_BYTES} bytes`);
    }
    const sha256 = hashText(input.payload);
    if (input.sha256 && input.sha256 !== sha256) {
      throw new Error('artifact SHA does not match payload');
    }
    const now = nowOrDefault(input.now);
    const ref = artifactRef(input.scope, input.runId, input.operationId, input.kind, sha256);
    const requiresLease = input.kind !== 'snapshot' && input.kind !== 'archive';
    if (requiresLease) {
      if (!input.leaseToken) {
        throw new Error('runtime quotation artifact writes require a lease token');
      }
      const state = await readState(input.scope);
      const run = getActiveRun(state, input.runId);
      if (
        !run ||
        !leaseStatuses.includes(run.status) ||
        run.leaseToken !== input.leaseToken ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        throw new Error('quotation artifact write is fenced by an invalid lease');
      }
    }
    const sameHash = await findArtifact(input.scope, input.runId, input.operationId, sha256);
    if (sameHash) {
      if (sameHash.payload !== input.payload || sameHash.kind !== input.kind) {
        throw new Error('quotation artifact is immutable');
      }
      return ref;
    }
    const otherHash = await findArtifact(input.scope, input.runId, input.operationId);
    if (otherHash && (otherHash.sha256 !== sha256 || otherHash.kind !== input.kind)) {
      throw new Error('quotation operation already has a different immutable artifact');
    }
    try {
      await Artifact.create({
        userId: input.scope.userId,
        conversationId: input.scope.conversationId,
        runId: input.runId,
        operationId: input.operationId,
        kind: input.kind,
        sha256,
        payload: input.payload,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!(error instanceof Error) || !isDuplicateKey(error)) {
        throw error;
      }
      const raced = await findArtifact(input.scope, input.runId, input.operationId, sha256);
      if (!raced || raced.payload !== input.payload || raced.kind !== input.kind) {
        throw new Error('quotation artifact changed concurrently');
      }
    }
    return ref;
  }

  async function getArtifact(input: {
    scope: SteelQuotationScope;
    runId: string;
    operationId: string;
  }): Promise<ISteelQuotationArtifact | null> {
    validateScope(input.scope);
    validateText(input.runId, 'runId', 200);
    validateText(input.operationId, 'operationId', 300);
    return findArtifact(input.scope, input.runId, input.operationId);
  }

  async function readArtifact(input: SteelQuotationReadArtifactInput): Promise<string | undefined> {
    validateScope(input.scope);
    if (!cloneScopeRef(input.scope, input.ref)) {
      return undefined;
    }
    const found = await Artifact.findOne({
      ...stateFilter(input.scope),
      runId: input.ref.runId,
      operationId: input.ref.operationId,
      kind: input.ref.kind,
      sha256: input.ref.sha256,
    }).lean<ISteelQuotationArtifact>();
    return found?.payload;
  }

  async function readCheckpoint(input: {
    scope: SteelQuotationScope;
    runId: string;
    operationId: string;
  }): Promise<string | undefined> {
    validateScope(input.scope);
    const state = await readState(input.scope);
    const ref = state?.activeRun?.runId === input.runId
      ? state.activeRun.checkpointRefs.find((candidate) => candidate.operationId === input.operationId)
      : undefined;
    if (ref) {
      return readArtifact({ scope: input.scope, ref: artifactRef(input.scope, input.runId, ref.operationId, ref.kind, ref.sha256) });
    }
    const found = await getArtifact(input);
    return found?.payload;
  }

  async function acceptSignal(
    input: SteelQuotationAcceptSignalInput,
  ): Promise<SteelQuotationActiveRun> {
    validateScope(input.scope);
    validatePositiveIndex(input.index, 'quotation index');
    validateText(input.token, 'quotation ticket token', 200);
    validateText(input.orderHash, 'orderHash', 128);
    validateText(input.customerMarkdown, 'customerMarkdown', MAX_QUOTATION_CUSTOMER_BYTES);
    validateText(input.customerIdentity, 'customerIdentity', MAX_QUOTATION_CUSTOMER_BYTES);
    validateText(input.prompts.child, 'child prompt', MAX_QUOTATION_PROMPT_BYTES);
    validateText(input.prompts.main, 'main prompt', MAX_QUOTATION_PROMPT_BYTES);
    if (input.chunks.length > MAX_QUOTATION_CHUNKS) {
      throw new Error(`quotation authority exceeds ${MAX_QUOTATION_CHUNKS} chunks`);
    }
    const seenChunkIndexes = new Set<number>();
    for (const chunk of input.chunks) {
      validatePositiveIndex(chunk.index, 'chunk index');
      if (!Number.isSafeInteger(chunk.sourceRowCount) || chunk.sourceRowCount < 0) {
        throw new Error('chunk sourceRowCount must be a non-negative safe integer');
      }
      if (seenChunkIndexes.has(chunk.index)) {
        throw new Error('quotation chunks must have unique indexes');
      }
      seenChunkIndexes.add(chunk.index);
    }
    const now = nowOrDefault(input.now);
    const current = await ensureState(input.scope);
    const ticket = current.tickets.find((candidate) => candidate.index === input.index);
    if (!ticket || ticket.token !== input.token) {
      throw new Error('quotation signal ticket is invalid');
    }
    if (
      ticket.orderHash !== input.orderHash ||
      ticket.customerMarkdown !== input.customerMarkdown ||
      ticket.customerIdentity !== input.customerIdentity
    ) {
      throw new Error('quotation signal does not match its ticket');
    }
    if (ticket.acceptedRunId) {
      const active = getActiveRun(current, ticket.acceptedRunId);
      if (active) {
        return active;
      }
      const archived = await findArtifact(input.scope, ticket.acceptedRunId, 'archive');
      const archivedRun = archived ? parseArchivedRun(archived.payload) : undefined;
      if (archivedRun) {
        return archivedRun;
      }
      throw new Error('accepted quotation run is unavailable');
    }
    if (!current.currentOrder || current.currentOrder.sha256 !== input.orderHash) {
      throw new Error('quotation signal order is stale');
    }
    if (ticket.preparationId !== undefined || ticket.responseId !== undefined) {
      if (ticket.preparationId === undefined || ticket.responseId === undefined ||
        !matchesCustomerPreparation(current.currentCustomer, {
          customerMarkdown: ticket.customerMarkdown,
          customerIdentity: ticket.customerIdentity,
          selectionProvenance: ticket.selectionProvenance,
          preparationId: ticket.preparationId,
        })) {
        throw new Error('quotation signal customer preparation is stale');
      }
    }
    if (isUnfinished(current.activeRun?.status)) {
      throw new Error('another quotation run is unfinished');
    }
    const runId = ticket.token;
    const snapshotPayload: SteelQuotationSnapshotPayload = {
      prompts: input.prompts,
      orderMarkdown: current.currentOrder.markdown,
      orderHash: current.currentOrder.sha256,
      customerMarkdown: input.customerMarkdown,
      customerIdentity: input.customerIdentity,
    };
    const snapshotText = JSON.stringify(snapshotPayload);
    const snapshotRef = artifactRef(
      input.scope,
      runId,
      'snapshot',
      'snapshot',
      hashText(snapshotText),
    );
    const chunks: SteelQuotationChunkState[] = input.chunks.map((chunk) => ({
      index: chunk.index,
      sourceRowCount: chunk.sourceRowCount,
      status: 'pending',
    }));
    const nextRun: SteelQuotationActiveRun = {
      runId,
      index: input.index,
      status: 'queued',
      triggerMessageId: ticket.triggeringMessageId,
      ...(input.targetMessageId ? { targetMessageId: input.targetMessageId } : {}),
      snapshotRef,
      chunks,
      checkpointRefs: [],
      acceptedAt: now,
      updatedAt: now,
    };
    assertAuthorityBounds({
      userId: current.userId,
      conversationId: current.conversationId,
      currentOrder: current.currentOrder,
      currentCustomer: current.currentCustomer,
      nextSignalIndex: current.nextSignalIndex,
      tickets: current.tickets,
      activeRun: nextRun,
      pendingMessages: current.pendingMessages,
    });
    await writeArtifact({
      scope: input.scope,
      runId,
      operationId: 'snapshot',
      kind: 'snapshot',
      payload: snapshotText,
      now,
    });
    const previous = current.activeRun;
    if (previous && isTerminal(previous.status)) {
      await writeArtifact({
        scope: input.scope,
        runId: previous.runId,
        operationId: 'archive',
        kind: 'archive',
        payload: JSON.stringify({ run: previous }),
        now,
      });
    }
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        'currentOrder.sha256': input.orderHash,
        'tickets': {
          $elemMatch: {
            index: input.index,
            token: input.token,
            orderHash: input.orderHash,
            customerMarkdown: input.customerMarkdown,
            customerIdentity: input.customerIdentity,
            acceptedRunId: { $exists: false },
          },
        },
        ...(ticket.preparationId !== undefined && ticket.responseId !== undefined
          ? {
              'currentCustomer.preparationId': ticket.preparationId,
            }
          : {}),
        $or: [
          { activeRun: { $exists: false } },
          { 'activeRun.status': { $in: terminalStatuses } },
        ],
      },
      {
        $set: {
          activeRun: nextRun,
          'tickets.$.acceptedRunId': runId,
          updatedAt: now,
        },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    if (updated?.activeRun?.runId === runId) {
      assertAuthorityBounds(updated);
      return updated.activeRun;
    }
    const raced = await readState(input.scope);
    const racedTicket = raced?.tickets.find((candidate) => candidate.index === input.index);
    if (racedTicket?.acceptedRunId) {
      const racedActive = getActiveRun(raced, racedTicket.acceptedRunId);
      if (racedActive) {
        return racedActive;
      }
      const archived = await findArtifact(input.scope, racedTicket.acceptedRunId, 'archive');
      const archivedRun = archived ? parseArchivedRun(archived.payload) : undefined;
      if (archivedRun) {
        return archivedRun;
      }
    }
    throw new Error('quotation signal changed concurrently; retry the operation');
  }

  async function requireLiveRun(
    input: SteelQuotationRunInput,
    now: Date,
  ): Promise<SteelQuotationActiveRun | undefined> {
    const state = await readState(input.scope);
    const run = getActiveRun(state, input.runId);
    if (
      !run ||
      !leaseStatuses.includes(run.status) ||
      run.leaseToken !== input.leaseToken ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      return undefined;
    }
    return run;
  }

  async function acquireLease(
    input: SteelQuotationAcquireLeaseInput,
  ): Promise<SteelQuotationLease | undefined> {
    validateScope(input.scope);
    validateText(input.runId, 'runId', 200);
    const now = nowOrDefault(input.now);
    const duration = input.leaseDurationMs ?? DEFAULT_QUOTATION_LEASE_MS;
    validateLeaseDuration(duration);
    const leaseToken = input.leaseToken ?? randomUUID();
    const expiresAt = new Date(now.getTime() + duration);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        'activeRun.runId': input.runId,
        'activeRun.status': { $in: leaseStatuses },
        $or: [
          { 'activeRun.leaseToken': { $exists: false } },
          { 'activeRun.leaseToken': null },
          { 'activeRun.leaseExpiresAt': { $lte: now } },
        ],
      },
      {
        $set: {
          'activeRun.leaseToken': leaseToken,
          'activeRun.leaseExpiresAt': expiresAt,
          'activeRun.updatedAt': now,
          updatedAt: now,
        },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    if (!updated?.activeRun || updated.activeRun.runId !== input.runId) {
      return undefined;
    }
    return { runId: input.runId, leaseToken, expiresAt };
  }

  async function heartbeatLease(
    input: SteelQuotationAcquireLeaseInput,
  ): Promise<SteelQuotationLease | undefined> {
    validateScope(input.scope);
    validateText(input.runId, 'runId', 200);
    validateText(input.leaseToken ?? '', 'leaseToken', 200);
    const now = nowOrDefault(input.now);
    const duration = input.leaseDurationMs ?? DEFAULT_QUOTATION_LEASE_MS;
    validateLeaseDuration(duration);
    const expiresAt = new Date(now.getTime() + duration);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        'activeRun.runId': input.runId,
        'activeRun.leaseToken': input.leaseToken,
        'activeRun.status': { $in: leaseStatuses },
        'activeRun.leaseExpiresAt': { $gt: now },
      },
      {
        $set: {
          'activeRun.leaseExpiresAt': expiresAt,
          'activeRun.updatedAt': now,
          updatedAt: now,
        },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    return updated?.activeRun?.runId === input.runId
      ? { runId: input.runId, leaseToken: input.leaseToken!, expiresAt }
      : undefined;
  }

  async function releaseLease(
    input: SteelQuotationRunInput,
  ): Promise<SteelQuotationActiveRun | undefined> {
    validateScope(input.scope);
    const now = nowOrDefault(input.now);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        'activeRun.runId': input.runId,
        'activeRun.leaseToken': input.leaseToken,
        'activeRun.status': { $in: leaseStatuses },
        'activeRun.leaseExpiresAt': { $gt: now },
      },
      {
        $unset: { 'activeRun.leaseToken': 1, 'activeRun.leaseExpiresAt': 1 },
        $set: { 'activeRun.updatedAt': now, updatedAt: now },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    return getActiveRun(updated, input.runId);
  }

  async function transitionRun(
    input: SteelQuotationTransitionRunInput,
  ): Promise<SteelQuotationActiveRun | undefined> {
    validateScope(input.scope);
    const now = nowOrDefault(input.now);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        'activeRun.runId': input.runId,
        'activeRun.leaseToken': input.leaseToken,
        'activeRun.status': { $in: leaseStatuses },
        'activeRun.leaseExpiresAt': { $gt: now },
      },
      { $set: { 'activeRun.status': input.status, 'activeRun.updatedAt': now, updatedAt: now } },
      { new: true },
    ).lean<ISteelQuotationState>();
    return getActiveRun(updated, input.runId);
  }

  async function interruptRun(
    input: SteelQuotationRunInput,
  ): Promise<SteelQuotationActiveRun | undefined> {
    validateScope(input.scope);
    const now = nowOrDefault(input.now);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        'activeRun.runId': input.runId,
        'activeRun.leaseToken': input.leaseToken,
        'activeRun.status': { $in: leaseStatuses },
        'activeRun.leaseExpiresAt': { $gt: now },
      },
      {
        $set: { 'activeRun.status': 'interrupted', 'activeRun.updatedAt': now, updatedAt: now },
        $unset: { 'activeRun.leaseToken': 1, 'activeRun.leaseExpiresAt': 1 },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    return getActiveRun(updated, input.runId);
  }

  async function cancelRun(
    input: Omit<SteelQuotationRunInput, 'leaseToken'> & { leaseToken?: string },
  ): Promise<SteelQuotationActiveRun | undefined> {
    validateScope(input.scope);
    const now = nowOrDefault(input.now);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        'activeRun.runId': input.runId,
        'activeRun.status': { $in: unfinishedStatuses },
      },
      {
        $set: { 'activeRun.status': 'cancelled', 'activeRun.updatedAt': now, updatedAt: now },
        $unset: { 'activeRun.leaseToken': 1, 'activeRun.leaseExpiresAt': 1 },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    if (updated) {
      return getActiveRun(updated, input.runId);
    }
    const current = await readState(input.scope);
    return getActiveRun(current, input.runId);
  }

  async function completeRun(
    input: SteelQuotationCompleteRunInput,
  ): Promise<SteelQuotationActiveRun | undefined> {
    validateScope(input.scope);
    if (
      !cloneScopeRef(input.scope, input.finalRef) ||
      input.finalRef.runId !== input.runId ||
      input.finalRef.kind !== 'final'
    ) {
      throw new Error('final artifact reference is outside the quotation run scope');
    }
    const finalArtifact = await readArtifact({ scope: input.scope, ref: input.finalRef });
    if (finalArtifact === undefined) {
      throw new Error('final artifact does not exist');
    }
    const now = nowOrDefault(input.now);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        'activeRun.runId': input.runId,
        'activeRun.leaseToken': input.leaseToken,
        'activeRun.status': { $in: leaseStatuses },
        'activeRun.leaseExpiresAt': { $gt: now },
      },
      {
        $set: {
          'activeRun.status': 'completed',
          ...(input.targetMessageId ? { 'activeRun.targetMessageId': input.targetMessageId } : {}),
          'activeRun.updatedAt': now,
          updatedAt: now,
        },
        $unset: { 'activeRun.leaseToken': 1, 'activeRun.leaseExpiresAt': 1 },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    return getActiveRun(updated, input.runId);
  }

  async function markPublished(
    input: SteelQuotationMarkPublishedInput,
  ): Promise<SteelQuotationActiveRun | undefined> {
    validateScope(input.scope);
    validateText(input.runId, 'runId', 200);
    validateText(input.finalSha256, 'finalSha256', 128);
    if (input.targetMessageId !== undefined) {
      validateText(input.targetMessageId, 'targetMessageId', 300);
    }
    const now = nowOrDefault(input.now);
    const current = await readState(input.scope);
    const run = getActiveRun(current, input.runId);
    const finalCheckpoint = run?.checkpointRefs.find(
      (candidate) => candidate.operationId === 'final' && candidate.kind === 'final',
    );
    if (!run || run.status !== 'completed' || finalCheckpoint?.sha256 !== input.finalSha256) {
      return undefined;
    }
    if (run.targetMessageId && input.targetMessageId && run.targetMessageId !== input.targetMessageId) {
      throw new Error('published quotation target message is immutable');
    }
    const publicationPayload = JSON.stringify({ finalSha256: input.finalSha256 });
    const publicationRef = artifactRef(
      input.scope,
      input.runId,
      'published',
      'final',
      hashText(publicationPayload),
    );
    await writePublicationArtifact(input.scope, input.runId, publicationPayload, publicationRef, now);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        $and: [
          { 'activeRun.runId': input.runId, 'activeRun.status': 'completed' },
          { 'activeRun.checkpointRefs': { $elemMatch: { operationId: 'final', kind: 'final', sha256: input.finalSha256 } } },
          { 'activeRun.checkpointRefs': { $not: { $elemMatch: { operationId: 'published' } } } },
        ],
      },
      {
        $set: {
          ...(input.targetMessageId && !run.targetMessageId
            ? { 'activeRun.targetMessageId': input.targetMessageId }
            : {}),
          'activeRun.updatedAt': now,
          updatedAt: now,
        },
        $push: {
          'activeRun.checkpointRefs': {
            operationId: publicationRef.operationId,
            kind: publicationRef.kind,
            artifactId: publicationRef.artifactId,
            sha256: publicationRef.sha256,
            updatedAt: now,
          },
        },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    if (updated) {
      return getActiveRun(updated, input.runId);
    }
    const raced = await readState(input.scope);
    const racedRun = getActiveRun(raced, input.runId);
    const racedPublication = racedRun?.checkpointRefs.find(
      (candidate) => candidate.operationId === 'published',
    );
    if (racedPublication?.sha256 === publicationRef.sha256) {
      return racedRun;
    }
    return undefined;
  }

  async function writePublicationArtifact(
    scope: SteelQuotationScope,
    runId: string,
    payload: string,
    ref: SteelQuotationArtifactRef,
    now: Date,
  ): Promise<void> {
    const sameHash = await findArtifact(scope, runId, 'published', ref.sha256);
    if (sameHash) {
      if (sameHash.payload !== payload || sameHash.kind !== 'final') {
        throw new Error('quotation publication receipt is immutable');
      }
      return;
    }
    const otherHash = await findArtifact(scope, runId, 'published');
    if (otherHash && (otherHash.sha256 !== ref.sha256 || otherHash.kind !== 'final')) {
      throw new Error('quotation publication receipt is immutable');
    }
    try {
      await Artifact.create({
        userId: scope.userId,
        conversationId: scope.conversationId,
        runId,
        operationId: 'published',
        kind: 'final',
        sha256: ref.sha256,
        payload,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!(error instanceof Error) || !isDuplicateKey(error)) {
        throw error;
      }
      const raced = await findArtifact(scope, runId, 'published', ref.sha256);
      if (!raced || raced.payload !== payload || raced.kind !== 'final') {
        throw new Error('quotation publication receipt changed concurrently');
      }
    }
  }

  async function checkpoint(
    input: SteelQuotationCheckpointInput,
  ): Promise<ISteelQuotationState | undefined> {
    validateScope(input.scope);
    validateText(input.leaseToken, 'leaseToken', 200);
    const now = nowOrDefault(input.now);
    if (!(await requireLiveRun({ ...input, now }, now))) {
      return undefined;
    }
    let ref: SteelQuotationArtifactRef;
    if (input.payload !== undefined) {
      ref = await writeArtifact({
        scope: input.scope,
        runId: input.runId,
        operationId: input.operationId,
        kind: input.kind,
        payload: input.payload,
        now,
        leaseToken: input.leaseToken,
      });
    } else if (input.artifactRef) {
      if (
        !cloneScopeRef(input.scope, input.artifactRef) ||
        input.artifactRef.runId !== input.runId ||
        input.artifactRef.operationId !== input.operationId ||
        input.artifactRef.kind !== input.kind
      ) {
        throw new Error('checkpoint artifact reference is outside the quotation run scope');
      }
      const payload = await readArtifact({ scope: input.scope, ref: input.artifactRef });
      if (payload === undefined) {
        throw new Error('checkpoint artifact does not exist');
      }
      ref = input.artifactRef;
    } else {
      throw new Error('checkpoint requires payload or artifactRef');
    }
    if (input.chunkIndex !== undefined) {
      validatePositiveIndex(input.chunkIndex, 'chunk index');
    }
    const checkpointRef: SteelQuotationCheckpointRef = {
      operationId: ref.operationId,
      kind: ref.kind,
      artifactId: ref.artifactId,
      sha256: ref.sha256,
      updatedAt: now,
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await readState(input.scope);
      if (!current) {
        return undefined;
      }
      const run = getActiveRun(current, input.runId);
      if (
        !run ||
        !leaseStatuses.includes(run.status) ||
        run.leaseToken !== input.leaseToken ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        return undefined;
      }
      if (input.chunkIndex !== undefined && !run.chunks.some((chunk) => chunk.index === input.chunkIndex)) {
        throw new Error('checkpoint chunk does not exist in the quotation run');
      }
      const nextRefs = [
        ...run.checkpointRefs.filter((candidate) => candidate.operationId !== ref.operationId),
        checkpointRef,
      ];
      const nextChunks = input.chunkIndex === undefined
        ? run.chunks
        : run.chunks.map((chunk) =>
            chunk.index === input.chunkIndex
              ? { ...chunk, status: 'completed' as const, checkpointRef: ref }
              : chunk,
          );
      assertAuthorityBounds({
        userId: current.userId,
        conversationId: current.conversationId,
        currentOrder: current.currentOrder,
        currentCustomer: current.currentCustomer,
        nextSignalIndex: current.nextSignalIndex,
        tickets: current.tickets,
        activeRun: { ...run, checkpointRefs: nextRefs, chunks: nextChunks },
        pendingMessages: current.pendingMessages,
      });
      const updated = await State.findOneAndUpdate(
        {
          ...stateFilter(input.scope),
          'activeRun.runId': input.runId,
          'activeRun.leaseToken': input.leaseToken,
          'activeRun.status': { $in: leaseStatuses },
          'activeRun.leaseExpiresAt': { $gt: now },
          'activeRun.updatedAt': run.updatedAt,
        },
        {
          $set: {
            'activeRun.checkpointRefs': nextRefs,
            'activeRun.chunks': nextChunks,
            'activeRun.updatedAt': now,
            updatedAt: now,
          },
        },
        {
          new: true,
        },
      ).lean<ISteelQuotationState>();
      if (updated) {
        assertAuthorityBounds(updated);
        return updated;
      }
    }
    return undefined;
  }

  async function enqueuePendingMessage(
    input: SteelQuotationPendingMessageInput,
  ): Promise<SteelQuotationPendingMessage> {
    validateScope(input.scope);
    validateText(input.sourceMessageId, 'sourceMessageId', 300);
    if (input.sourceMessageText !== undefined &&
      byteLength(input.sourceMessageText) > MAX_QUOTATION_CUSTOMER_BYTES) {
      throw new Error(`sourceMessageText exceeds ${MAX_QUOTATION_CUSTOMER_BYTES} bytes`);
    }
    validatePendingFiles(input.sourceMessageFiles);
    const now = nowOrDefault(input.now);
    await ensureState(input.scope);
    let current = await readState(input.scope);
    if (!current) {
      throw new Error('quotation authority state is unavailable');
    }
    const receipt = await readPendingCompletionReceipt(input.scope, input.sourceMessageId);
    if (receipt) {
      assertPendingMessageIdentity(input, receipt);
      return pendingMessageFromReceipt(receipt, now);
    }
    const existing = current?.pendingMessages.find(
      (message) => message.sourceMessageId === input.sourceMessageId,
    );
    if (existing) {
      assertPendingMessageIdentity(input, existing);
      return existing;
    }
    if ((current?.pendingMessages.length ?? 0) >= MAX_QUOTATION_PENDING_MESSAGES) {
      await archiveCompletedPendingMessages(input.scope, current, now);
      current = await readState(input.scope);
      if (!current || current.pendingMessages.length >= MAX_QUOTATION_PENDING_MESSAGES) {
        throw new Error(`quotation authority exceeds ${MAX_QUOTATION_PENDING_MESSAGES} pending messages`);
      }
    }
    const message: SteelQuotationPendingMessage = {
      sourceMessageId: input.sourceMessageId,
      ...(input.sourceMessageText !== undefined ? { sourceMessageText: input.sourceMessageText } : {}),
      ...(input.sourceMessageFiles?.length ? { sourceMessageFiles: [...input.sourceMessageFiles] } : {}),
      ...(input.targetMessageId ? { targetMessageId: input.targetMessageId } : {}),
      status: 'pending',
      enqueuedAt: now,
      updatedAt: now,
    };
    assertAuthorityBounds({
      userId: current?.userId ?? input.scope.userId,
      conversationId: current?.conversationId ?? input.scope.conversationId,
      currentOrder: current?.currentOrder,
      currentCustomer: current?.currentCustomer,
      nextSignalIndex: current?.nextSignalIndex ?? 0,
      tickets: current?.tickets ?? [],
      activeRun: current?.activeRun,
      pendingMessages: [...(current?.pendingMessages ?? []), message],
    });
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        pendingMessages: { $not: { $elemMatch: { sourceMessageId: input.sourceMessageId } } },
      },
      { $push: { pendingMessages: message }, $set: { updatedAt: now } },
      { new: true },
    ).lean<ISteelQuotationState>();
    if (!updated) {
      const raced = await readState(input.scope);
      const racedMessage = raced?.pendingMessages.find(
        (candidate) => candidate.sourceMessageId === input.sourceMessageId,
      );
      if (racedMessage) {
        assertPendingMessageIdentity(input, racedMessage);
        return racedMessage;
      }
      throw new Error('pending message changed concurrently; retry the operation');
    }
    assertAuthorityBounds(updated);
    const inserted = updated.pendingMessages.find(
      (candidate) => candidate.sourceMessageId === input.sourceMessageId,
    );
    if (!inserted) {
      throw new Error('pending message could not be persisted');
    }
    return inserted;
  }

  async function claimPendingMessage(
    input: SteelQuotationClaimPendingInput,
  ): Promise<SteelQuotationPendingClaim | undefined> {
    validateScope(input.scope);
    const now = nowOrDefault(input.now);
    const duration = input.leaseDurationMs ?? DEFAULT_QUOTATION_LEASE_MS;
    validateLeaseDuration(duration);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const state = await readState(input.scope);
      if (!state || isUnfinished(state.activeRun?.status)) {
        return undefined;
      }
      const candidate = state.pendingMessages.find((message) => message.status !== 'completed');
      if (!candidate) {
        return undefined;
      }
      if (
        candidate.status === 'claimed' &&
        (!candidate.claimExpiresAt || candidate.claimExpiresAt.getTime() > now.getTime())
      ) {
        return undefined;
      }
      const claimToken = input.claimToken ?? randomUUID();
      const claimExpiresAt = new Date(now.getTime() + duration);
      const updated = await State.findOneAndUpdate(
        {
          ...stateFilter(input.scope),
          $and: [
            {
              $or: [
                {
                  pendingMessages: {
                    $elemMatch: { sourceMessageId: candidate.sourceMessageId, status: 'pending' },
                  },
                },
                {
                  pendingMessages: {
                    $elemMatch: {
                      sourceMessageId: candidate.sourceMessageId,
                      status: 'claimed',
                      claimExpiresAt: { $lte: now },
                    },
                  },
                },
              ],
            },
            {
              $or: [
                { activeRun: { $exists: false } },
                { 'activeRun.status': { $in: terminalStatuses } },
              ],
            },
          ],
        },
        {
          $set: {
            'pendingMessages.$[message].status': 'claimed',
            'pendingMessages.$[message].claimToken': claimToken,
            'pendingMessages.$[message].claimExpiresAt': claimExpiresAt,
            'pendingMessages.$[message].updatedAt': now,
            updatedAt: now,
          },
        },
        {
          new: true,
          arrayFilters: [
            candidate.status === 'pending'
              ? { 'message.sourceMessageId': candidate.sourceMessageId, 'message.status': 'pending' }
              : {
                  'message.sourceMessageId': candidate.sourceMessageId,
                  'message.status': 'claimed',
                  'message.claimExpiresAt': { $lte: now },
                },
          ],
        },
      ).lean<ISteelQuotationState>();
      if (!updated) {
        continue;
      }
      const claimed = updated.pendingMessages.find(
        (message) => message.sourceMessageId === candidate.sourceMessageId,
      );
      if (!claimed || claimed.claimToken !== claimToken || !claimed.claimExpiresAt) {
        continue;
      }
      const savedResult = claimed.resultRef
        ? await readArtifact({ scope: input.scope, ref: claimed.resultRef })
        : undefined;
      return {
        sourceMessageId: claimed.sourceMessageId,
        ...(claimed.sourceMessageText ? { sourceMessageText: claimed.sourceMessageText } : {}),
        ...(claimed.sourceMessageFiles ? { sourceMessageFiles: claimed.sourceMessageFiles } : {}),
        ...(claimed.targetMessageId ? { targetMessageId: claimed.targetMessageId } : {}),
        ...(claimed.resultRef ? { resultRef: claimed.resultRef } : {}),
        ...(savedResult !== undefined ? { resultMarkdown: savedResult } : {}),
        claimToken,
        claimExpiresAt: claimed.claimExpiresAt,
      };
    }
    return undefined;
  }

  async function renewPendingClaim(
    input: SteelQuotationRenewPendingInput,
  ): Promise<SteelQuotationPendingClaim | undefined> {
    validateScope(input.scope);
    validateText(input.sourceMessageId, 'sourceMessageId', 300);
    validateText(input.claimToken, 'claimToken', 200);
    const now = nowOrDefault(input.now);
    const duration = input.leaseDurationMs ?? DEFAULT_QUOTATION_LEASE_MS;
    validateLeaseDuration(duration);
    const claimExpiresAt = new Date(now.getTime() + duration);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        pendingMessages: {
          $elemMatch: {
            sourceMessageId: input.sourceMessageId,
            status: 'claimed',
            claimToken: input.claimToken,
            claimExpiresAt: { $gt: now },
          },
        },
      },
      {
        $set: {
          'pendingMessages.$.claimExpiresAt': claimExpiresAt,
          'pendingMessages.$.updatedAt': now,
          updatedAt: now,
        },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    const claimed = updated?.pendingMessages.find(
      (message) => message.sourceMessageId === input.sourceMessageId,
    );
    if (!claimed || claimed.status !== 'claimed' || claimed.claimToken !== input.claimToken || !claimed.claimExpiresAt) {
      return undefined;
    }
    const savedResult = claimed.resultRef
      ? await readArtifact({ scope: input.scope, ref: claimed.resultRef })
      : undefined;
    return {
      sourceMessageId: claimed.sourceMessageId,
      ...(claimed.sourceMessageText ? { sourceMessageText: claimed.sourceMessageText } : {}),
      ...(claimed.sourceMessageFiles ? { sourceMessageFiles: claimed.sourceMessageFiles } : {}),
      ...(claimed.targetMessageId ? { targetMessageId: claimed.targetMessageId } : {}),
      ...(claimed.resultRef ? { resultRef: claimed.resultRef } : {}),
      ...(savedResult !== undefined ? { resultMarkdown: savedResult } : {}),
      claimToken: input.claimToken,
      claimExpiresAt: claimed.claimExpiresAt,
    };
  }

  async function savePendingResult(
    input: SteelQuotationSavePendingResultInput,
  ): Promise<SteelQuotationSavedPendingResult | undefined> {
    validateScope(input.scope);
    validateText(input.sourceMessageId, 'sourceMessageId', 300);
    validateText(input.claimToken, 'claimToken', 200);
    validateText(input.markdown, 'pending result', MAX_QUOTATION_ARTIFACT_BYTES);
    if (input.targetMessageId !== undefined) {
      validateText(input.targetMessageId, 'targetMessageId', 300);
    }
    const now = nowOrDefault(input.now);
    const current = await readState(input.scope);
    const existing = current?.pendingMessages.find(
      (message) => message.sourceMessageId === input.sourceMessageId,
    );
    if (
      !existing ||
      existing.status !== 'claimed' ||
      existing.claimToken !== input.claimToken ||
      !existing.claimExpiresAt ||
      existing.claimExpiresAt.getTime() <= now.getTime()
    ) {
      return undefined;
    }
    const resultRunId = pendingResultRunId(input.sourceMessageId);
    const resultRef = artifactRef(
      input.scope,
      resultRunId,
      'result',
      'main',
      hashText(input.markdown),
    );
    if (existing.resultRef) {
      const saved = await readArtifact({ scope: input.scope, ref: existing.resultRef });
      if (saved === undefined) {
        throw new Error('pending result reference is missing');
      }
      if (saved !== input.markdown) {
        throw new Error('pending result is immutable');
      }
      return {
        sourceMessageId: input.sourceMessageId,
        markdown: saved,
        ...(existing.completedTargetMessageId ?? existing.targetMessageId
          ? { targetMessageId: existing.completedTargetMessageId ?? existing.targetMessageId }
          : {}),
        resultRef: existing.resultRef,
      };
    }
    await writePendingArtifact(input.scope, resultRunId, 'result', input.markdown, resultRef, now);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        pendingMessages: {
          $elemMatch: {
            sourceMessageId: input.sourceMessageId,
            status: 'claimed',
            claimToken: input.claimToken,
            claimExpiresAt: { $gt: now },
            resultRef: { $exists: false },
          },
        },
      },
      {
        $set: {
          'pendingMessages.$.resultRef': resultRef,
          ...(input.targetMessageId ? { 'pendingMessages.$.targetMessageId': input.targetMessageId } : {}),
          'pendingMessages.$.updatedAt': now,
          updatedAt: now,
        },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    const savedMessage = updated?.pendingMessages.find(
      (message) => message.sourceMessageId === input.sourceMessageId,
    );
    if (savedMessage?.resultRef) {
      const saved = await readArtifact({ scope: input.scope, ref: savedMessage.resultRef });
      if (saved === undefined) {
        throw new Error('pending result reference is missing');
      }
      return {
        sourceMessageId: input.sourceMessageId,
        markdown: saved,
        ...(input.targetMessageId ?? savedMessage.targetMessageId
          ? { targetMessageId: input.targetMessageId ?? savedMessage.targetMessageId }
          : {}),
        resultRef: savedMessage.resultRef,
      };
    }
    const raced = await readState(input.scope);
    const racedMessage = raced?.pendingMessages.find(
      (message) => message.sourceMessageId === input.sourceMessageId,
    );
    if (racedMessage?.resultRef) {
      const saved = await readArtifact({ scope: input.scope, ref: racedMessage.resultRef });
      if (saved === undefined) {
        throw new Error('pending result reference is missing');
      }
      return {
        sourceMessageId: input.sourceMessageId,
        markdown: saved,
        ...(racedMessage.targetMessageId ? { targetMessageId: racedMessage.targetMessageId } : {}),
        resultRef: racedMessage.resultRef,
      };
    }
    return undefined;
  }

  async function writePendingArtifact(
    scope: SteelQuotationScope,
    runId: string,
    operationId: string,
    payload: string,
    ref: SteelQuotationArtifactRef,
    now: Date,
  ): Promise<void> {
    if (byteLength(payload) > MAX_QUOTATION_ARTIFACT_BYTES) {
      throw new Error(`artifact payload exceeds ${MAX_QUOTATION_ARTIFACT_BYTES} bytes`);
    }
    const sameHash = await findArtifact(scope, runId, operationId, ref.sha256);
    if (sameHash) {
      if (sameHash.payload !== payload || sameHash.kind !== 'main') {
        throw new Error('pending result is immutable');
      }
      return;
    }
    const otherHash = await findArtifact(scope, runId, operationId);
    if (otherHash && (otherHash.sha256 !== ref.sha256 || otherHash.kind !== 'main')) {
      throw new Error('pending result is immutable');
    }
    try {
      await Artifact.create({
        userId: scope.userId,
        conversationId: scope.conversationId,
        runId,
        operationId,
        kind: 'main',
        sha256: ref.sha256,
        payload,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!(error instanceof Error) || !isDuplicateKey(error)) {
        throw error;
      }
      const raced = await findArtifact(scope, runId, operationId, ref.sha256);
      if (!raced || raced.payload !== payload || raced.kind !== 'main') {
        throw new Error('pending result changed concurrently');
      }
    }
  }

  async function completePendingMessage(
    input: SteelQuotationCompletePendingInput,
  ): Promise<SteelQuotationCompletedPendingMessage | undefined> {
    validateScope(input.scope);
    validateText(input.sourceMessageId, 'sourceMessageId', 300);
    validateText(input.claimToken, 'claimToken', 200);
    if (input.targetMessageId !== undefined) {
      validateText(input.targetMessageId, 'targetMessageId', 300);
    }
    const now = nowOrDefault(input.now);
    const current = await readState(input.scope);
    const existing = current?.pendingMessages.find(
      (message) => message.sourceMessageId === input.sourceMessageId,
    );
    if (!existing) {
      const receipt = await readPendingCompletionReceipt(input.scope, input.sourceMessageId);
      if (receipt) {
        return {
          sourceMessageId: receipt.sourceMessageId,
          ...(receipt.completedTargetMessageId ?? receipt.targetMessageId
            ? { targetMessageId: receipt.completedTargetMessageId ?? receipt.targetMessageId }
            : {}),
        };
      }
      return undefined;
    }
    if (existing.status === 'completed') {
      await writePendingCompletionReceipt(input.scope, existing, now);
      return {
        sourceMessageId: input.sourceMessageId,
        ...(existing.completedTargetMessageId
          ? { targetMessageId: existing.completedTargetMessageId }
          : {}),
      };
    }
    if (!existing.resultRef) {
      return undefined;
    }
    const targetMessageId = input.targetMessageId ?? existing.targetMessageId;
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        pendingMessages: {
          $elemMatch: {
            sourceMessageId: input.sourceMessageId,
            status: 'claimed',
            claimToken: input.claimToken,
            claimExpiresAt: { $gt: now },
          },
        },
      },
      {
        $set: {
          'pendingMessages.$.status': 'completed',
          ...(targetMessageId ? { 'pendingMessages.$.completedTargetMessageId': targetMessageId } : {}),
          'pendingMessages.$.updatedAt': now,
          updatedAt: now,
        },
        $unset: {
          'pendingMessages.$.claimToken': 1,
          'pendingMessages.$.claimExpiresAt': 1,
        },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    if (updated) {
      const done = updated.pendingMessages.find(
        (message) => message.sourceMessageId === input.sourceMessageId,
      );
      if (done?.status === 'completed') {
        await writePendingCompletionReceipt(input.scope, done, now);
        return {
          sourceMessageId: done.sourceMessageId,
          ...(done.completedTargetMessageId ? { targetMessageId: done.completedTargetMessageId } : {}),
        };
      }
    }
    const raced = await readState(input.scope);
    const racedMessage = raced?.pendingMessages.find(
      (message) => message.sourceMessageId === input.sourceMessageId,
    );
    if (racedMessage?.status === 'completed') {
      await writePendingCompletionReceipt(input.scope, racedMessage, now);
      return {
        sourceMessageId: racedMessage.sourceMessageId,
        ...(racedMessage.completedTargetMessageId
          ? { targetMessageId: racedMessage.completedTargetMessageId }
          : {}),
      };
    }
    return undefined;
  }

  async function deleteConversation(scope: SteelQuotationScope): Promise<SteelQuotationDeleteResult> {
    validateScope(scope);
    const [stateResult, artifactResult] = await Promise.all([
      State.deleteOne(stateFilter(scope)),
      Artifact.deleteMany(stateFilter(scope)),
    ]);
    return {
      stateDeleted: stateResult.deletedCount,
      artifactsDeleted: artifactResult.deletedCount,
    };
  }

  return {
    ensureState,
    readState,
    hasSystemOrder,
    setOrder,
    saveCustomer,
    clearCustomer,
    issueTicket,
    acceptSignal,
    writeArtifact,
    getArtifact,
    readArtifact,
    readCheckpoint,
    checkpoint,
    acquireLease,
    heartbeatLease,
    releaseLease,
    transitionRun,
    interruptRun,
    cancelRun,
    completeRun,
    markPublished,
    enqueuePendingMessage,
    claimPendingMessage,
    renewPendingClaim,
    savePendingResult,
    completePendingMessage,
    deleteConversation,
  };
}
