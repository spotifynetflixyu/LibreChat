import type { SteelReviewKind, SteelReviewSourceFile } from 'librechat-data-provider';

export interface SteelReviewSourceScope {
  userId: string;
  tenantId?: string;
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  title: string;
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

export interface SteelReviewSourceMethods {
  listSteelReviewSources(input: SteelReviewSourceScope): Promise<SteelReviewSourceRecord[]>;
  readSteelReviewSource(input: SteelReviewSourceReadInput): Promise<SteelReviewSourceRecord | null>;
}
