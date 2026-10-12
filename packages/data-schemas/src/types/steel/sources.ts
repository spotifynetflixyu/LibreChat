import type { SteelReviewKind, SteelReviewSourceFile } from 'librechat-data-provider';

export interface SteelReviewSourceScope {
  userId: string;
  tenantId?: string;
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  /** Markdown table title is required for list queries, but binary reads use file ownership only. */
  title?: string;
}

export interface SteelReviewSourceReadInput extends SteelReviewSourceScope {
  fileId: string;
}

/**
 * Plain source metadata returned by the storage boundary. Storage fields stay
 * internal to the backend service and are never serialized to the client.
 */
export interface SteelReviewSourceRecord extends SteelReviewSourceFile {
  storageSource: string;
  filepath: string;
  storageKey?: string;
  storageRegion?: string;
  model?: string;
}

export interface SteelReviewSourcePageCountUpdate {
  userId: string;
  tenantId?: string;
  fileId: string;
  filepath: string;
  storageSource: string;
  storageKey?: string;
  storageRegion?: string;
  pageCount: number;
}

export interface SteelReviewSourceMethods {
  listSteelReviewSources(input: SteelReviewSourceScope): Promise<SteelReviewSourceRecord[]>;
  readSteelReviewSource(input: SteelReviewSourceReadInput): Promise<SteelReviewSourceRecord | null>;
  setSteelReviewSourcePageCount(input: SteelReviewSourcePageCountUpdate): Promise<boolean>;
}
