import type {
  SteelReviewKind,
  SteelReviewOwnerUpdated,
  SteelReviewCaption,
  SteelReviewRequoteProvenance,
  SteelReviewRow,
  SteelCatalogSelectionEvidence,
  SteelReviewSourceMapping,
  SteelReviewTarget,
} from 'librechat-data-provider';
import type { SteelCalculationCheckpoint } from 'librechat-data-provider';
import type { Document } from 'mongoose';

export interface SteelReviewScope {
  userId: string;
  tenantId?: string;
  conversationId: string;
}

export interface SteelReviewReadInput extends SteelReviewScope {
  kind: SteelReviewKind;
  messageId: string;
  title: string;
  /** Private physical hints retained only for existing repository internals; public requests never carry them. */
  tableId?: string;
  partIndex?: number;
}

/** Immutable quotation customer input captured by the run that owns a system-order review. */
export interface SteelReviewCustomerSnapshot {
  snapshotId: string;
  customerIdentity: string;
  customerMarkdown: string;
}

export interface SteelReviewReceiptLookup extends SteelReviewScope {
  kind: SteelReviewKind;
  messageId: string;
  title: string;
  /** Private physical hint for an already-resolved receipt; public queries omit it. */
  tableId?: string;
  outputId: string;
  operationId: string;
  digest: string;
}

export interface SteelReviewTextPart {
  partIndex: number;
  text: string;
}

export interface SteelReviewOwnerUpdatedRecord extends Omit<SteelReviewOwnerUpdated, 'updatedAt'> {
  updatedAt: Date;
}

export interface SteelReviewRequoteProvenanceRecord extends Omit<SteelReviewRequoteProvenance, 'at'> {
  at: Date;
}

/** Plain projection returned by the database boundary; no Mongoose query types escape it. */
export interface SteelReviewReadRecord extends SteelReviewScope {
  kind: SteelReviewKind;
  messageId: string;
  tableId: string;
  title?: string;
  outputId: string;
  revision: string;
  state: 'current' | 'historical';
  headers?: string[];
  rows?: SteelReviewRow[];
  markdown?: string;
  sourceMappings?: SteelReviewSourceMapping[];
  /** Trusted mapping evidence retained for current-owner files that may be unavailable now. */
  trustedSourceMappings?: SteelReviewSourceMapping[];
  /** Internal code reservations retained when an old source file is unavailable. */
  sourceMappingReservations?: SteelReviewSourceMapping[];
  latestOutputId?: string;
  messageText?: string;
  messageTextParts?: SteelReviewTextPart[];
  messageTextPartIndex?: number;
  aiRawMarkdown?: string;
  aiBaselineMarkdown?: string;
  humanMarkdown?: string;
  humanSavedAt?: Date;
  effectiveMarkdown?: string;
  displayMarkdown?: string;
  aiUpdatedAt?: Date;
  ownerUpdated?: SteelReviewOwnerUpdatedRecord;
  needsRequote?: boolean;
  requoteProvenance?: SteelReviewRequoteProvenanceRecord;
  /** Internal quotation state retained for system-order saves; never public. */
  customerQuoteMarkdown?: string;
  customerSnapshot?: SteelReviewCustomerSnapshot;
  /** Trusted exact lookup basis retained for the first review projection. */
  calculationCheckpoint?: SteelCalculationCheckpoint;
  lastSave?: SteelReviewReceipt;
  /** Immutable receipt history used to resolve a captured same-owner revision. */
  receipts?: SteelReviewReceipt[];
}

export interface ISteelReviewOutput extends Document, SteelReviewScope {
  kind: SteelReviewKind;
  messageId: string;
  tableId: string;
  title?: string;
  outputId: string;
  revision: string;
  state: 'current' | 'historical';
  headers: string[];
  rows: SteelReviewRow[];
  sourceMappings?: SteelReviewSourceMapping[];
  latestOutputId?: string;
  aiUpdatedAt?: Date;
  aiRawMarkdown?: string;
  aiBaselineMarkdown?: string;
  humanMarkdown?: string;
  humanSavedAt?: Date;
  effectiveMarkdown?: string;
  displayMarkdown?: string;
  receipts: SteelReviewReceipt[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SteelReviewReceipt {
  operationId: string;
  digest: string;
  title?: string;
  /** Present only on the additive operation-intent receipt lane. */
  requestDigest?: string;
  revision: string;
  changedRows: number;
  changedRowIds: string[];
  savedAt: Date;
  selectionEvidence?: SteelCatalogSelectionEvidence[];
  snapshot?: SteelReviewSavedSnapshotRecord;
}

export interface SteelReviewSavedSnapshotRecord {
  operationId: string;
  digest: string;
  title?: string;
  /** Present only on the additive operation-intent receipt lane. */
  requestDigest?: string;
  outputId: string;
  revision: string;
  headers: string[];
  rows: SteelReviewRow[];
  sourceMappings?: SteelReviewSourceMapping[];
  changedRows: number;
  changedRowIds: string[];
  savedAt: Date;
  selectionEvidence?: SteelCatalogSelectionEvidence[];
  messageSha256: string;
  conversationId: string;
  messageId: string;
  messageText: string;
  messageTextParts?: SteelReviewTextPart[];
  effectiveMarkdown: string;
  displayMarkdown: string;
  ownerUpdated?: SteelReviewOwnerUpdatedRecord;
  target?: SteelReviewTarget;
  targetText?: string;
  replacementText?: string;
  cleanReplacementText?: string;
  aiBaselineMarkdown?: string;
  aiRawMarkdown?: string;
  caption?: SteelReviewCaption;
}
