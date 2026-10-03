import type {
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
  createdAt?: Date;
  updatedAt?: Date;
}
