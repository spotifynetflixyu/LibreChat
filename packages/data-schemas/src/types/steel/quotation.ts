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
}

export interface SteelQuotationOrder {
  markdown: string;
  sha256: string;
  revision?: string;
  messageId?: string;
}

export interface SteelQuotationSelectionProvenance {
  method: 'unique' | 'selected' | 'default_tier';
  lookupMessageId?: string;
  selectionMessageId?: string;
  selectedCustomerId?: string;
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
}

export interface SteelQuotationArtifactRef {
  artifactId: string;
  userId: string;
  conversationId: string;
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
  currentCustomer?: SteelQuotationCustomerPreparation;
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
