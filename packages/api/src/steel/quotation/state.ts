import { createHash, randomUUID } from 'crypto';
import {
  createSteelQuotationInputMethods,
  STEEL_QUOTATION_INPUT_TTL_MS,
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
  SteelQuotationCustomerLookupEvidence,
  SteelQuotationCustomerPreparation,
  SteelQuotationCurrentSystemOrder,
  SteelQuotationOcrInput,
  SteelQuotationOcrSelection,
  SteelQuotationOrder,
  SteelQuotationPendingMessage,
  SteelQuotationRunStatus,
  SteelQuotationScope,
  SteelQuotationSelectionProvenance,
  SteelQuotationSnapshotPayload,
  SteelQuotationTicketCompletionReceipt,
  SteelQuotationTicket,
} from '@librechat/data-schemas';
import { isCurrentSystemOrderRun } from './revision';
import { SteelQuotationInputError } from './input';

type Mongoose = typeof import('mongoose');
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
  expectedOrderHash?: string | null;
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
  completionReceipt?: SteelQuotationTicketCompletionReceipt;
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

export interface SteelQuotationSaveCustomerLookupEvidenceInput {
  scope: SteelQuotationScope;
  evidence: SteelQuotationCustomerLookupEvidence;
  expectedOrderHash: string;
  expectedCustomerPreparationId?: string;
  now?: Date;
}

export interface SteelQuotationClearCustomerLookupEvidenceInput {
  scope: SteelQuotationScope;
  responseId?: string;
  orderHash?: string;
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
  sourceSnapshot?: SteelQuotationSnapshotPayload['sourceSnapshot'];
  ocrSelection?: SteelQuotationOcrSelection;
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

export interface SteelQuotationInterruptInput extends SteelQuotationRunInput {
  interruption?: SteelQuotationActiveRun['interruption'];
}

export interface SteelQuotationDeleteResult {
  stateDeleted: number;
  artifactsDeleted: number;
}

export interface SteelQuotationStateService {
  ensureState(scope: SteelQuotationScope): Promise<ISteelQuotationState>;
  readState(scope: SteelQuotationScope): Promise<ISteelQuotationState | null>;
  /** Reads only the active run for hot lease checks; expired runs fall back to readState retirement. */
  readActiveRun(scope: SteelQuotationScope): Promise<SteelQuotationActiveRun | undefined>;
  isPublishedRun(scope: SteelQuotationScope, run: SteelQuotationActiveRun): Promise<boolean>;
  hasSystemOrder(scope: SteelQuotationScope, preloadedState?: ISteelQuotationState | null): Promise<boolean>;
  setOrder(input: SteelQuotationOrderInput): Promise<ISteelQuotationState>;
  prepareOcrOrder(scope: SteelQuotationScope, expectedOrderHash: string | null):
    Promise<{ state: ISteelQuotationState; input?: SteelQuotationOcrInput }>;
  saveCustomer(input: SteelQuotationSaveCustomerInput): Promise<SteelQuotationCustomerPreparation>;
  saveCustomerLookupEvidence(
    input: SteelQuotationSaveCustomerLookupEvidenceInput,
  ): Promise<SteelQuotationCustomerLookupEvidence>;
  clearCustomerLookupEvidence(
    input: SteelQuotationClearCustomerLookupEvidenceInput,
  ): Promise<ISteelQuotationState>;
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
  interruptRun(input: SteelQuotationInterruptInput): Promise<SteelQuotationActiveRun | undefined>;
  cancelRun(input: Omit<SteelQuotationRunInput, 'leaseToken'> & { leaseToken?: string }): Promise<
    SteelQuotationActiveRun | undefined
  >;
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
  if (scope.tenantId !== undefined && !scope.tenantId) {
    throw new Error('quotation scope tenantId must not be empty');
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

function validateCustomerLookupEvidence(evidence: SteelQuotationCustomerLookupEvidence): void {
  validateText(evidence.responseId, 'customerLookupEvidence.responseId', 300);
  validateText(evidence.lookupMessageId, 'customerLookupEvidence.lookupMessageId', 1_000);
  validateText(evidence.orderHash, 'customerLookupEvidence.orderHash', 128);
  if (evidence.customerPreparationId !== undefined) {
    validateText(evidence.customerPreparationId, 'customerLookupEvidence.customerPreparationId', 200);
  }
  if (evidence.customerMarkdown !== undefined) {
    validateText(evidence.customerMarkdown, 'customerLookupEvidence.customerMarkdown', MAX_QUOTATION_CUSTOMER_BYTES);
  }
  if (!Array.isArray(evidence.customers)) {
    throw new Error('customerLookupEvidence.customers must be an array');
  }
  for (const [index, customer] of evidence.customers.entries()) {
    if (!Number.isSafeInteger(customer.id) || customer.id < 0) {
      throw new Error(`customerLookupEvidence.customers[${index}].id must be a safe integer`);
    }
    for (const [name, value] of [
      ['erpCustomerCode', customer.erpCustomerCode],
      ['displayName', customer.displayName],
    ] as const) {
      if (value !== undefined) {
        validateText(value, `customerLookupEvidence.customers[${index}].${name}`, MAX_QUOTATION_CUSTOMER_BYTES);
      }
    }
    if (customer.customerTier !== undefined && !/^[A-F]$/.test(customer.customerTier)) {
      throw new Error(`customerLookupEvidence.customers[${index}].customerTier is invalid`);
    }
  }
}

function validateHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 hash`);
  }
}

function validateCompletionReceipt(receipt: SteelQuotationTicketCompletionReceipt): void {
  validateHash(receipt.inputHash, 'completionReceipt.inputHash');
  validateText(receipt.markdown, 'completionReceipt.markdown', MAX_QUOTATION_ARTIFACT_BYTES);
  if (receipt.ocrGeneration !== undefined) {
    validateText(receipt.ocrGeneration, 'completionReceipt.ocrGeneration', 300);
  }
  if (receipt.ocrHash !== undefined) {
    validateHash(receipt.ocrHash, 'completionReceipt.ocrHash');
  }
  if (receipt.systemOrderHash !== undefined) {
    validateHash(receipt.systemOrderHash, 'completionReceipt.systemOrderHash');
  }
}

function sameCompletionReceipt(
  left: SteelQuotationTicketCompletionReceipt | undefined,
  right: SteelQuotationTicketCompletionReceipt | undefined,
): boolean {
  return left?.inputHash === right?.inputHash &&
    left?.markdown === right?.markdown &&
    left?.ocrGeneration === right?.ocrGeneration &&
    left?.ocrHash === right?.ocrHash &&
    left?.systemOrderHash === right?.systemOrderHash;
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

function validateSourceSnapshot(
  snapshot: SteelQuotationSnapshotPayload['sourceSnapshot'],
  orderHash: string,
): void {
  if (!snapshot) return;
  if (snapshot.orderHash !== orderHash) {
    throw new Error('quotation source snapshot order hash is stale');
  }
  if (snapshot.mappings.length > MAX_QUOTATION_PENDING_FILES) {
    throw new Error(`quotation source snapshot exceeds ${MAX_QUOTATION_PENDING_FILES} mappings`);
  }
  const sourceCodes = new Set<string>();
  const fileIds = new Set<string>();
  for (const mapping of snapshot.mappings) {
    validateText(mapping.fileId, 'quotation source fileId', 2_000);
    validateText(mapping.sourceCode, 'quotation source code', 200);
    validateText(mapping.sourceFilename, 'quotation source filename', 2_000);
    if (mapping.mediaType !== undefined) validateText(mapping.mediaType, 'quotation source mediaType', 200);
    if (sourceCodes.has(mapping.sourceCode) || fileIds.has(mapping.fileId)) {
      throw new Error('quotation source snapshot mappings must be unique');
    }
    sourceCodes.add(mapping.sourceCode);
    fileIds.add(mapping.fileId);
  }
}

function isUnfinished(status: SteelQuotationRunStatus | undefined): boolean {
  return status !== undefined && unfinishedStatuses.includes(status);
}

function stateFilter(scope: SteelQuotationScope) {
  return {
    userId: scope.userId,
    conversationId: scope.conversationId,
    tenantId: scope.tenantId ?? null,
  };
}

function sameActiveRunFilter(run?: SteelQuotationActiveRun): Record<string, unknown> {
  return run ? {
    'activeRun.runId': run.runId,
    'activeRun.status': run.status,
    'activeRun.checkpointRefs': run.checkpointRefs,
  } : { activeRun: { $exists: false } };
}

function authorityByteLength(state: SteelQuotationStateLike): number {
  return byteLength(
    JSON.stringify({
      userId: state.userId,
      conversationId: state.conversationId,
      tenantId: state.tenantId,
      currentOrder: state.currentOrder,
      currentSystemOrder: state.currentSystemOrder,
      currentCustomer: state.currentCustomer,
      customerLookupEvidence: state.customerLookupEvidence,
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
  tenantId?: string;
  currentOrder?: SteelQuotationOrder;
  currentSystemOrder?: SteelQuotationCurrentSystemOrder;
  currentCustomer?: SteelQuotationCustomerPreparation;
  customerLookupEvidence?: SteelQuotationCustomerLookupEvidence;
  nextSignalIndex: number;
  tickets: SteelQuotationTicket[];
  activeRun?: SteelQuotationActiveRun;
  pendingMessages: SteelQuotationPendingMessage[];
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
  if (ref.userId !== scope.userId || ref.conversationId !== scope.conversationId) {
    return false;
  }
  return (ref.tenantId ?? null) === (scope.tenantId ?? null);
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
    ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
    runId,
    operationId,
    kind,
    sha256,
  };
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

export function createSteelQuotationStateService(
  mongoose: Mongoose,
  inputs: ReturnType<typeof createSteelQuotationInputMethods> = createSteelQuotationInputMethods(mongoose),
): SteelQuotationStateService {
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);

  async function blocksInputMutation(scope: SteelQuotationScope, run?: SteelQuotationActiveRun): Promise<boolean> {
    return isUnfinished(run?.status) || Boolean(run?.status === 'completed' &&
      !await inputs.isSteelQuotationRunPublished(scope, run));
  }

  async function ensureState(scope: SteelQuotationScope): Promise<ISteelQuotationState> {
    validateScope(scope);
    try {
      await State.updateOne(
        stateFilter(scope),
        {
          $setOnInsert: {
            userId: scope.userId,
            conversationId: scope.conversationId,
            ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
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
    const state = await readState(scope);
    if (!state) {
      throw new Error('quotation authority state could not be created');
    }
    assertAuthorityBounds(state);
    return state;
  }

  async function readState(scope: SteelQuotationScope): Promise<ISteelQuotationState | null> {
    validateScope(scope);
    const state = await State.findOne(stateFilter(scope)).lean<ISteelQuotationState>();
    if (!state) return null;
    assertAuthorityBounds(state);
    const run = state.activeRun;
    if (run && run.status !== 'cancelled' &&
      new Date(run.acceptedAt).getTime() + STEEL_QUOTATION_INPUT_TTL_MS <= Date.now() &&
      !await inputs.isSteelQuotationRunPublished(scope, run)) {
      const retired = await inputs.retireSteelQuotationInput({ scope, runId: run.runId, reason: 'expired' });
      if (!retired.ok) throw new SteelQuotationInputError(retired.code);
      return retired.state;
    }
    return state;
  }
  async function readActiveRun(scope: SteelQuotationScope): Promise<SteelQuotationActiveRun | undefined> {
    validateScope(scope);
    const state = await State.findOne(stateFilter(scope))
      .select({ activeRun: 1 })
      .lean<Pick<ISteelQuotationState, 'activeRun'>>();
    const run = state?.activeRun;
    if (run && run.status !== 'cancelled' &&
      new Date(run.acceptedAt).getTime() + STEEL_QUOTATION_INPUT_TTL_MS <= Date.now()) {
      return (await readState(scope))?.activeRun;
    }
    return run;
  }


  async function prepareOcrOrder(scope: SteelQuotationScope, expectedOrderHash: string | null) {
    const result = await inputs.prepareSteelQuotationOcrInput({ scope, expectedOrderHash });
    if (!result.ok) throw new SteelQuotationInputError(result.code);
    return { state: result.state, ...(result.input ? { input: result.input } : {}) };
  }

  async function hasSystemOrder(
    scope: SteelQuotationScope,
    preloadedState?: ISteelQuotationState | null,
  ): Promise<boolean> {
    validateScope(scope);
    const state = preloadedState === undefined ? await readState(scope) : preloadedState;
    if (!state || state.userId !== scope.userId || state.conversationId !== scope.conversationId ||
      (state.tenantId ?? undefined) !== scope.tenantId) {
      return false;
    }

    const run = state.activeRun;
    const currentSystemOrder = state.currentSystemOrder;
    if (!run || !currentSystemOrder || currentSystemOrder.runId !== run.runId ||
      currentSystemOrder.messageId !== run.targetMessageId || !isCurrentSystemOrderRun(state)) {
      return false;
    }
    return inputs.isSteelQuotationRunPublished(scope, run);
  }

  async function setOrder(input: SteelQuotationOrderInput): Promise<ISteelQuotationState> {
    validateScope(input.scope);
    validateText(input.fullMarkdown, 'fullMarkdown', MAX_QUOTATION_ORDER_BYTES);
    if (input.expectedOrderHash !== undefined && input.expectedOrderHash !== null) {
      validateText(input.expectedOrderHash, 'expectedOrderHash', 128);
    }
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
      if (input.expectedOrderHash !== undefined &&
        (current.currentOrder?.sha256 ?? null) !== input.expectedOrderHash) {
        throw new Error('quotation order changed since it was read');
      }
      if (await blocksInputMutation(input.scope, current.activeRun)) {
        throw new Error('cannot set quotation order while a run is unfinished or unpublished');
      }
      const orderChanged = current.currentOrder?.sha256 !== sha256;
      const retainedTickets = current.tickets.filter((ticket) => ticket.acceptedRunId);
      const filter = {
        ...stateFilter(input.scope),
        nextSignalIndex: current.nextSignalIndex,
        ...(current.currentOrder?.sha256
          ? { 'currentOrder.sha256': current.currentOrder.sha256 }
          : { 'currentOrder.sha256': { $exists: false } }),
        ...sameActiveRunFilter(current.activeRun),
      };
      const update = orderChanged
        ? {
            $set: { currentOrder: nextOrder, tickets: retainedTickets, updatedAt: now },
            $unset: { customerLookupEvidence: 1 },
          }
        : { $set: { currentOrder: nextOrder, updatedAt: now } };
      assertAuthorityBounds({
        ...current,
        currentOrder: nextOrder,
        tickets: orderChanged ? retainedTickets : current.tickets,
        ...(orderChanged ? { customerLookupEvidence: undefined } : {}),
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
      if (await blocksInputMutation(input.scope, current.activeRun)) {
        throw new Error('cannot save customer preparation while a run is unfinished or unpublished');
      }
      assertAuthorityBounds({
        ...current,
        currentCustomer: preparation,
      });
      let preparationFilter: Record<string, unknown>;
      if (input.expectedPreparationId === undefined) {
        preparationFilter = { 'currentCustomer.responseId': { $ne: input.responseId } };
      } else if (input.expectedPreparationId === null) {
        preparationFilter = { currentCustomer: { $exists: false } };
      } else {
        preparationFilter = { 'currentCustomer.preparationId': input.expectedPreparationId };
      }
      const updated = await State.findOneAndUpdate(
        {
          ...stateFilter(input.scope),
          ...(input.orderHash !== undefined
            ? { 'currentOrder.sha256': input.orderHash }
            : { 'currentOrder': { $exists: false } }),
          ...preparationFilter,
          ...sameActiveRunFilter(current.activeRun),
        },
        {
          $set: { currentCustomer: preparation, updatedAt: now },
          $unset: { customerLookupEvidence: 1 },
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

  async function saveCustomerLookupEvidence(
    input: SteelQuotationSaveCustomerLookupEvidenceInput,
  ): Promise<SteelQuotationCustomerLookupEvidence> {
    validateScope(input.scope);
    validateText(input.expectedOrderHash, 'expectedOrderHash', 128);
    validateCustomerLookupEvidence(input.evidence);
    if (input.evidence.orderHash !== input.expectedOrderHash) {
      throw new Error('customer lookup evidence order is stale');
    }
    if ((input.evidence.customerPreparationId ?? undefined) !== input.expectedCustomerPreparationId) {
      throw new Error('customer lookup evidence preparation is stale');
    }
    const now = nowOrDefault(input.now);
    await ensureState(input.scope);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await readState(input.scope);
      if (!current || current.currentOrder?.sha256 !== input.expectedOrderHash ||
        current.currentCustomer?.preparationId !== input.expectedCustomerPreparationId) {
        throw new Error('customer lookup evidence is based on stale preparation data');
      }
      const existing = current.customerLookupEvidence;
      if (existing && JSON.stringify(existing) === JSON.stringify(input.evidence)) {
        return existing;
      }
      if (await blocksInputMutation(input.scope, current.activeRun)) {
        throw new Error('cannot save customer lookup evidence while a run is unfinished or unpublished');
      }
      assertAuthorityBounds({ ...current, customerLookupEvidence: input.evidence });
      const updated = await State.findOneAndUpdate(
        {
          ...stateFilter(input.scope),
          'currentOrder.sha256': input.expectedOrderHash,
          ...(input.expectedCustomerPreparationId === undefined
            ? { currentCustomer: { $exists: false } }
            : { 'currentCustomer.preparationId': input.expectedCustomerPreparationId }),
          ...sameActiveRunFilter(current.activeRun),
        },
        { $set: { customerLookupEvidence: input.evidence, updatedAt: now } },
        { new: true },
      ).lean<ISteelQuotationState>();
      if (updated && updated.customerLookupEvidence?.responseId === input.evidence.responseId) {
        assertAuthorityBounds(updated);
        return updated.customerLookupEvidence;
      }
    }
    throw new Error('customer lookup evidence changed concurrently; retry the operation');
  }

  async function clearCustomerLookupEvidence(
    input: SteelQuotationClearCustomerLookupEvidenceInput,
  ): Promise<ISteelQuotationState> {
    validateScope(input.scope);
    if (input.responseId !== undefined) validateText(input.responseId, 'responseId', 300);
    if (input.orderHash !== undefined) validateText(input.orderHash, 'orderHash', 128);
    const current = await ensureState(input.scope);
    if (!current.customerLookupEvidence ||
      (input.responseId !== undefined && current.customerLookupEvidence.responseId !== input.responseId) ||
      (input.orderHash !== undefined && current.customerLookupEvidence.orderHash !== input.orderHash)) {
      return current;
    }
    if (await blocksInputMutation(input.scope, current.activeRun)) return current;
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        ...sameActiveRunFilter(current.activeRun),
        ...(input.responseId !== undefined
          ? { 'customerLookupEvidence.responseId': input.responseId }
          : {}),
        ...(input.orderHash !== undefined
          ? { 'customerLookupEvidence.orderHash': input.orderHash }
          : {}),
      },
      { $unset: { customerLookupEvidence: 1 }, $set: { updatedAt: new Date() } },
      { new: true },
    ).lean<ISteelQuotationState>();
    if (updated) {
      assertAuthorityBounds(updated);
      return updated;
    }
    return (await readState(input.scope)) ?? current;
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
    if (await blocksInputMutation(input.scope, current.activeRun)) return current;
    const customerFilter = input.preparationId !== undefined
      ? { 'currentCustomer.preparationId': input.preparationId }
      : { 'currentCustomer.responseId': input.responseId };
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        ...customerFilter,
        ...sameActiveRunFilter(current.activeRun),
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
    if (input.completionReceipt !== undefined) {
      if (!input.responseId) {
        throw new Error('completion receipt requires a responseId');
      }
      validateCompletionReceipt(input.completionReceipt);
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
            !sameSelectionProvenance(existing.selectionProvenance, input.selectionProvenance) ||
            !sameCompletionReceipt(existing.completionReceipt, input.completionReceipt)
          ) {
            throw new Error('quotation ticket response binding is immutable');
          }
          return existing;
        }
      }
      if (!current?.currentOrder) {
        throw new Error('cannot issue quotation ticket without a current order');
      }
      if (await blocksInputMutation(input.scope, current.activeRun)) {
        throw new Error('cannot issue quotation ticket while a run is unfinished or unpublished');
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
        ...(input.completionReceipt ? { completionReceipt: input.completionReceipt } : {}),
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
          ...sameActiveRunFilter(current.activeRun),
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

  async function writeArtifact(
    input: SteelQuotationWriteArtifactInput,
  ): Promise<SteelQuotationArtifactRef> {
    validateScope(input.scope);
    validateText(input.runId, 'runId', 200);
    validateText(input.operationId, 'operationId', 300);
    if (byteLength(input.payload) > MAX_QUOTATION_ARTIFACT_BYTES) {
      throw new Error(`artifact payload exceeds ${MAX_QUOTATION_ARTIFACT_BYTES} bytes`);
    }
    if (input.kind === 'snapshot') throw new SteelQuotationInputError('invalid_snapshot');
    const sha256 = hashText(input.payload);
    if (input.sha256 && input.sha256 !== sha256) {
      throw new Error('artifact SHA does not match payload');
    }
    const now = nowOrDefault(input.now);
    const ref = artifactRef(input.scope, input.runId, input.operationId, input.kind, sha256);
    const requiresLease = input.kind !== 'archive';
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
        ...(input.scope.tenantId !== undefined ? { tenantId: input.scope.tenantId } : {}),
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
    if (found?.kind === 'snapshot') {
      if (found.expiresAt && found.expiresAt.getTime() <= Date.now()) return undefined;
      if (hashText(found.payload) !== found.sha256) throw new SteelQuotationInputError('invalid_snapshot');
    }
    return found?.payload;
  }

  async function readCheckpoint(input: {
    scope: SteelQuotationScope;
    runId: string;
    operationId: string;
  }): Promise<string | undefined> {
    const activeRun = await readActiveRun(input.scope);
    const ref = activeRun?.runId === input.runId
      ? activeRun.checkpointRefs.find((candidate) => candidate.operationId === input.operationId)
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
    const admit = async (): Promise<SteelQuotationActiveRun> => {
      const admitted = await inputs.admitSteelQuotationOcrInput({
        scope: input.scope,
        index: input.index,
        token: input.token,
        orderHash: input.orderHash,
        customerMarkdown: input.customerMarkdown,
        customerIdentity: input.customerIdentity,
        prompts: input.prompts,
        chunks: input.chunks,
        selection: input.ocrSelection ?? current.currentOrder?.ocrSelection,
        ...(input.sourceSnapshot ? { sourceSnapshot: input.sourceSnapshot } : {}),
        ...(input.targetMessageId ? { targetMessageId: input.targetMessageId } : {}),
        now,
      });
      if (!admitted.ok) throw new SteelQuotationInputError(admitted.code);
      return admitted.run;
    };
    if (ticket.acceptedRunId) return admit();
    if (!current.currentOrder || current.currentOrder.sha256 !== input.orderHash) {
      throw new Error('quotation signal order is stale');
    }
    validateSourceSnapshot(input.sourceSnapshot, current.currentOrder.sha256);
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
    return admit();
  }

  async function requireLiveRun(
    input: SteelQuotationRunInput,
    now: Date,
  ): Promise<SteelQuotationActiveRun | undefined> {
    const active = await readActiveRun(input.scope);
    const run = active?.runId === input.runId ? active : undefined;
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
        'activeRun.acceptedAt': { $gt: new Date(now.getTime() - STEEL_QUOTATION_INPUT_TTL_MS) },
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
        'activeRun.acceptedAt': { $gt: new Date(now.getTime() - STEEL_QUOTATION_INPUT_TTL_MS) },
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
        'activeRun.acceptedAt': { $gt: new Date(now.getTime() - STEEL_QUOTATION_INPUT_TTL_MS) },
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
        'activeRun.acceptedAt': { $gt: new Date(now.getTime() - STEEL_QUOTATION_INPUT_TTL_MS) },
      },
      { $set: { 'activeRun.status': input.status, 'activeRun.updatedAt': now, updatedAt: now } },
      { new: true },
    ).lean<ISteelQuotationState>();
    return getActiveRun(updated, input.runId);
  }

  async function interruptRun(
    input: SteelQuotationInterruptInput,
  ): Promise<SteelQuotationActiveRun | undefined> {
    validateScope(input.scope);
    if (input.interruption && !['paused', 'error'].includes(input.interruption.reason)) {
      throw new Error('Invalid quotation interruption reason');
    }
    if (input.interruption?.chunkIndex !== undefined) {
      validatePositiveIndex(input.interruption.chunkIndex, 'interrupted chunk index');
    }
    const now = nowOrDefault(input.now);
    const updated = await State.findOneAndUpdate(
      {
        ...stateFilter(input.scope),
        'activeRun.runId': input.runId,
        'activeRun.leaseToken': input.leaseToken,
        'activeRun.status': { $in: leaseStatuses },
        'activeRun.leaseExpiresAt': { $gt: now },
        'activeRun.acceptedAt': { $gt: new Date(now.getTime() - STEEL_QUOTATION_INPUT_TTL_MS) },
        ...(input.interruption?.chunkIndex !== undefined && {
          'activeRun.chunks.index': input.interruption.chunkIndex,
        }),
      },
      {
        $set: {
          'activeRun.status': 'interrupted', 'activeRun.updatedAt': now, updatedAt: now,
          ...(input.interruption && { 'activeRun.interruption': input.interruption }),
        },
        $unset: {
          'activeRun.leaseToken': 1, 'activeRun.leaseExpiresAt': 1,
          ...(!input.interruption && { 'activeRun.interruption': 1 }),
        },
      },
      { new: true },
    ).lean<ISteelQuotationState>();
    return getActiveRun(updated, input.runId);
  }

  async function cancelRun(
    input: Omit<SteelQuotationRunInput, 'leaseToken'> & { leaseToken?: string },
  ): Promise<SteelQuotationActiveRun | undefined> {
    validateScope(input.scope);
    const retired = await inputs.retireSteelQuotationInput({
      scope: input.scope, runId: input.runId, reason: 'cancelled', now: input.now,
    });
    if (!retired.ok) throw new SteelQuotationInputError(retired.code);
    return getActiveRun(retired.state, input.runId);
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
      userId: input.scope.userId,
      conversationId: input.scope.conversationId,
      ...(input.scope.tenantId && { tenantId: input.scope.tenantId }),
      runId: input.runId,
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
        run.leaseExpiresAt.getTime() <= nowOrDefault(input.now).getTime()
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
        ...current,
        activeRun: { ...run, checkpointRefs: nextRefs, chunks: nextChunks },
      });
      const attemptNow = nowOrDefault(input.now);
      const updated = await State.findOneAndUpdate(
        {
          ...stateFilter(input.scope),
          'activeRun.runId': input.runId,
          'activeRun.leaseToken': input.leaseToken,
          'activeRun.status': { $in: leaseStatuses },
          'activeRun.leaseExpiresAt': { $gt: attemptNow },
          'activeRun.acceptedAt': { $gt: new Date(attemptNow.getTime() - STEEL_QUOTATION_INPUT_TTL_MS) },
          'activeRun.checkpointRefs': run.checkpointRefs,
          'activeRun.chunks': run.chunks,
        },
        {
          $set: {
            'activeRun.checkpointRefs': nextRefs,
            'activeRun.chunks': nextChunks,
            'activeRun.updatedAt': attemptNow,
            updatedAt: attemptNow,
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
    readActiveRun,
    isPublishedRun: inputs.isSteelQuotationRunPublished,
    hasSystemOrder,
    setOrder,
    prepareOcrOrder,
    saveCustomer,
    saveCustomerLookupEvidence,
    clearCustomerLookupEvidence,
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
    deleteConversation,
  };
}
