import type {
  SteelReviewCaption,
  SteelReviewCell,
  SteelReviewKind,
  SteelReviewRow,
  SteelReviewSource,
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
  lastSave?: SteelReviewReceipt;
}

export interface SteelReviewSourceMapping {
  fileId: string;
  sourceCode: string;
  sourceFilename: string;
  mediaType?: string;
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
  latestOutputId?: string;
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
  changedRows: number;
  changedRowIds: string[];
  savedAt: Date;
  messageSha256: string;
  effectiveMarkdown: string;
  displayMarkdown: string;
}
