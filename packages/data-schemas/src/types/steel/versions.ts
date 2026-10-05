import type { SteelReviewRow, SteelReviewSourceMapping } from 'librechat-data-provider';

export type SteelMarkdownKind = 'ocr_result' | 'system_order' | 'customer_data';

/** A reference identifies one immutable successful snapshot in its original owner. */
export interface SteelMarkdownReference {
  kind: SteelMarkdownKind;
  source: 'ai' | 'human';
  snapshotId: string;
  generationId: string;
  outputId: string;
  messageId: string;
  title: string;
  revision: string;
  sha256: string;
  lineageId: string;
  savedAt: Date;
  operationId?: string;
}

export interface SteelMarkdownOwner {
  ai: SteelMarkdownReference;
  effective: SteelMarkdownReference;
}

export interface SteelMarkdownExpected {
  ocrGeneration?: string;
  ocrHash?: string;
  orderHash?: string;
  systemOrderHash?: string;
  customerPreparationId?: string;
  owners?: Partial<Record<SteelMarkdownKind, SteelMarkdownOwner>>;
}

export interface SteelMarkdownAdmission {
  sequence: number;
  responseId: string;
  generationId: string;
  lineageId: string;
  expected: SteelMarkdownExpected;
}

export interface SteelMarkdownState {
  nextSequence: number;
  admission?: SteelMarkdownAdmission;
  current?: Partial<Record<SteelMarkdownKind, SteelMarkdownOwner>>;
  lastHumanOcr?: SteelMarkdownReference;
}

export interface SteelMarkdownSnapshot {
  reference: SteelMarkdownReference;
  rawMarkdown: string;
  baselineMarkdown: string;
  sourceMappings?: SteelReviewSourceMapping[];
}

export interface SteelMarkdownPublicationTarget {
  kind: SteelMarkdownKind;
  title: string;
  outputId: string;
  revision: string;
  baselineMarkdown: string;
  headers?: string[];
  rows?: SteelReviewRow[];
  sourceMappings?: SteelReviewSourceMapping[];
}

export type { SteelMarkdownVersion } from 'librechat-data-provider';
