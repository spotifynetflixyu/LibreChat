import type { TCustomConfig } from 'librechat-data-provider';
import type { Document } from 'mongoose';

export type SteelQuotationRunStatus =
  | 'queued'
  | 'running'
  | 'aggregating'
  | 'finalizing'
  | 'interrupted'
  | 'completed'
  | 'cancelled';

export type SteelQuotationArtifactKind =
  | 'snapshot'
  | 'chunk'
  | 'tool'
  | 'main'
  | 'final'
  | 'archive';

export type SteelQuotationChunkStatus = 'pending' | 'completed';
export type SteelQuotationPendingMessageStatus = 'pending' | 'claimed' | 'completed';

export interface SteelQuotationScope {
  userId: string;
  conversationId: string;
  tenantId?: string;
}

/** Plain response payload used by the guarded quotation publication seam. */
export interface SteelQuotationPublicationMessage {
  messageId: string;
  conversationId: string;
  text: string;
  user: string;
  parentMessageId?: string | null;
  isCreatedByUser?: boolean;
  unfinished?: boolean;
  sender?: string;
  endpoint?: string;
  model?: string;
  finish_reason?: string;
  tokenCount?: number;
  processingDurationMs?: number;
  langfuseSampled?: boolean;
  langfuseDestinationIds?: string[];
  langfuseRunId?: string;
  content?: unknown[];
  metadata?: Record<string, unknown> | null;
  iconURL?: string;
  /** Host response owner that supplied the transport snapshot. */
  sourceMessageId?: string;
  tenantId?: string;
}

/** The full saved record is retained at runtime while this result exposes only
 * the identity fields consumed by completion persistence bookkeeping. */
export interface SteelQuotationSavedMessage {
  messageId: string;
  conversationId: string;
  user: string;
  text?: string;
  tenantId?: string;
}

/** Request-scoped message retention inputs carried into the private save core. */
export interface SteelQuotationPublicationSaveContext {
  isTemporary?: boolean;
  expiredAt?: Date;
  interfaceConfig?: TCustomConfig['interface'];
}

/** Trusted current inputs captured before a quotation publication callback runs. */
export interface SteelQuotationPublicationProof {
  scope: SteelQuotationScope;
  runId: string;
  /** Immutable response owner captured when the quotation run was accepted. */
  runTargetMessageId: string;
  /** Current canonical response owner captured from currentSystemOrder. */
  targetMessageId: string;
  finalSha256: string;
  currentOrderSha256: string;
  currentSystemOrderSha256: string;
  sourceSnapshot?: SteelQuotationSourceSnapshot;
  saveContext?: SteelQuotationPublicationSaveContext;
  run?: SteelQuotationActiveRun;
  customer: {
    preparationId: string;
    customerIdentity: string;
    customerMarkdown: string;
  };
  message: SteelQuotationPublicationMessage;
}

export type SteelQuotationPublicationSaveResult =
  | { ok: true; message: SteelQuotationSavedMessage }
  | { ok: false; code: 'superseded' };

export interface SteelQuotationOrder {
  markdown: string;
  sha256: string;
  revision?: string;
  messageId?: string;
}

export interface SteelQuotationSourceMapping {
  fileId: string;
  sourceCode: string;
  sourceFilename: string;
  mediaType?: string;
}

export interface SteelQuotationSourceSnapshot {
  orderHash: string;
  generationId?: string;
  resultMessageId?: string;
  resultHash?: string;
  mappings: SteelQuotationSourceMapping[];
}

export interface SteelQuotationCurrentSystemOrder {
  runId: string;
  sha256: string;
  markdown: string;
  messageId?: string;
  responseId?: string;
  customerQuoteMarkdown?: string;
  sourceSnapshot?: SteelQuotationSourceSnapshot;
  needsRequote?: boolean;
  requoteProvenance?: SteelQuotationRequoteProvenance;
  updatedAt: Date;
}

export interface SteelQuotationRequoteProvenance {
  sourceKind: 'ocr_result';
  sourceMessageId: string;
  sourceTableId: string;
  sourceOutputId: string;
  sourceRevision: string;
  changedRows: number;
  at: Date;
}

export interface SteelQuotationSelectionProvenance {
  method: 'unique' | 'selected' | 'default_tier';
  lookupMessageId?: string;
  selectionMessageId?: string;
  selectedCustomerId?: string;
}

export type SteelQuotationCustomerTier = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface SteelQuotationCustomerLookupCandidate {
  id: number;
  erpCustomerCode?: string;
  displayName?: string;
  customerTier?: SteelQuotationCustomerTier;
}

export interface SteelQuotationCustomerLookupEvidence {
  responseId: string;
  lookupMessageId: string;
  orderHash: string;
  customerPreparationId?: string;
  customers: SteelQuotationCustomerLookupCandidate[];
  customerMarkdown?: string;
}

export interface SteelQuotationCustomerPreparation {
  preparationId: string;
  customerMarkdown: string;
  customerIdentity: string;
  orderHash?: string;
  triggeringMessageId: string;
  responseId: string;
  selectionProvenance: SteelQuotationSelectionProvenance;
}

export interface SteelQuotationTicketCompletionReceipt {
  inputHash: string;
  markdown: string;
  ocrGeneration?: string;
  ocrHash?: string;
  systemOrderHash?: string;
}

export type SteelQuotationCompletionReceipt = SteelQuotationTicketCompletionReceipt;

export interface SteelQuotationTicket {
  index: number;
  token: string;
  orderHash: string;
  customerMarkdown: string;
  customerIdentity: string;
  triggeringMessageId: string;
  selectionProvenance: SteelQuotationSelectionProvenance;
  issuedAt: Date;
  preparationId?: string;
  responseId?: string;
  acceptedRunId?: string;
  completionReceipt?: SteelQuotationTicketCompletionReceipt;
}

export interface SteelQuotationSnapshotPrompts {
  child: string;
  main: string;
}

export interface SteelQuotationSnapshotPayload {
  prompts: SteelQuotationSnapshotPrompts;
  orderMarkdown: string;
  orderHash: string;
  customerMarkdown: string;
  customerIdentity: string;
  sourceSnapshot?: SteelQuotationSourceSnapshot;
}

export interface SteelQuotationArtifactRef {
  artifactId: string;
  userId: string;
  conversationId: string;
  tenantId?: string;
  runId: string;
  operationId: string;
  kind: SteelQuotationArtifactKind;
  sha256: string;
}

export interface SteelQuotationChunkState {
  index: number;
  sourceRowCount: number;
  status: SteelQuotationChunkStatus;
  checkpointRef?: SteelQuotationArtifactRef;
}

export interface SteelQuotationCheckpointRef {
  operationId: string;
  kind: SteelQuotationArtifactKind;
  artifactId: string;
  sha256: string;
  updatedAt: Date;
}

export interface SteelQuotationActiveRun {
  runId: string;
  index: number;
  status: SteelQuotationRunStatus;
  triggerMessageId: string;
  targetMessageId?: string;
  snapshotRef: SteelQuotationArtifactRef;
  chunks: SteelQuotationChunkState[];
  checkpointRefs: SteelQuotationCheckpointRef[];
  leaseToken?: string;
  leaseExpiresAt?: Date;
  interruption?: {
    reason: 'paused' | 'error';
    chunkIndex?: number;
  };
  acceptedAt: Date;
  updatedAt: Date;
}

export interface SteelQuotationPendingMessage {
  sourceMessageId: string;
  sourceMessageText?: string;
  sourceMessageFiles?: SteelQuotationPendingMessageFile[];
  targetMessageId?: string;
  status: SteelQuotationPendingMessageStatus;
  claimToken?: string;
  claimExpiresAt?: Date;
  resultRef?: SteelQuotationArtifactRef;
  completedTargetMessageId?: string;
  enqueuedAt: Date;
  updatedAt: Date;
}

export interface SteelQuotationPendingMessageFile {
  fileId?: string;
  filename?: string;
  storageKey?: string;
  mediaType?: string;
  pageNumber?: number;
  imageIndex?: number;
}

export interface ISteelQuotationState extends Document, SteelQuotationScope {
  currentOrder?: SteelQuotationOrder;
  currentSystemOrder?: SteelQuotationCurrentSystemOrder;
  currentCustomer?: SteelQuotationCustomerPreparation;
  customerLookupEvidence?: SteelQuotationCustomerLookupEvidence;
  nextSignalIndex: number;
  tickets: SteelQuotationTicket[];
  activeRun?: SteelQuotationActiveRun;
  pendingMessages: SteelQuotationPendingMessage[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelQuotationArtifact extends Document, SteelQuotationScope {
  runId: string;
  operationId: string;
  kind: SteelQuotationArtifactKind;
  sha256: string;
  payload: string;
  createdAt?: Date;
  updatedAt?: Date;
}
