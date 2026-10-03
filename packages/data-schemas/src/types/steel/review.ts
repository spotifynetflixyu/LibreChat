import type {
  SteelReviewCell,
  SteelReviewKind,
  SteelReviewOwnerUpdated,
  SteelReviewRequoteProvenance,
  SteelReviewRow,
  SteelReviewSource,
  SteelReviewSourceIntent,
  SteelReviewSourceMapping,
} from 'librechat-data-provider';
import type { Document } from 'mongoose';

export interface SteelReviewScope {
  userId: string;
  tenantId?: string;
  conversationId: string;
}

export interface SteelReviewReadInput extends SteelReviewScope {
  kind: SteelReviewKind;
  messageId: string;
  tableId: string;
  partIndex?: number;
}

export interface SteelReviewReceiptLookup extends SteelReviewScope {
  kind: SteelReviewKind;
  messageId: string;
  tableId: string;
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
  lastSave?: SteelReviewReceipt;
}

export interface ISteelReviewOutput extends Document, SteelReviewScope {
  kind: SteelReviewKind;
  messageId: string;
  tableId: string;
  outputId: string;
  revision: string;
  state: 'current' | 'historical';
  headers: string[];
  rows: Array<{
    rowId: string;
    values: Record<string, SteelReviewCell>;
    source: SteelReviewSource | null;
  }>;
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
  revision: string;
  changedRows: number;
  changedRowIds: string[];
  savedAt: Date;
  snapshot?: SteelReviewSavedSnapshotRecord;
}

export interface SteelReviewSavedSnapshotRecord {
  operationId: string;
  digest: string;
  outputId: string;
  revision: string;
  headers: string[];
  rows: SteelReviewRow[];
  sourceMappings?: SteelReviewSourceMapping[];
  changedRows: number;
  changedRowIds: string[];
  savedAt: Date;
  messageSha256: string;
  conversationId: string;
  messageId: string;
  messageText: string;
  messageTextParts?: SteelReviewTextPart[];
  effectiveMarkdown: string;
  displayMarkdown: string;
  ownerUpdated?: SteelReviewOwnerUpdatedRecord;
}
