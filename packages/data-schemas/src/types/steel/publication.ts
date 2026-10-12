import type {
  SteelQuotationScope,
  SteelQuotationCurrentSystemOrder,
  SteelQuotationCustomerPreparation,
  SteelQuotationPublicationMessage,
  SteelQuotationSavedMessage,
  SteelQuotationPublicationSaveContext,
  SteelQuotationSummaryInput,
  SteelQuotationSummaryResult,
} from './quotation';

import type { SteelMarkdownAdmission, SteelMarkdownPublicationTarget, SteelMarkdownReference } from './versions';

export interface SteelMarkdownAdmissionInput {
  scope: SteelQuotationScope;
  responseId: string;
  generationId: string;
}

export interface SteelMarkdownPublicationInput {
  scope: SteelQuotationScope;
  admission: SteelMarkdownAdmission;
  message: SteelQuotationPublicationMessage;
  rawMarkdown: string;
  saveContext?: SteelQuotationPublicationSaveContext;
  targets: SteelMarkdownPublicationTarget[];
  ocr?: { attemptNumber: number; delegateOcrIndex?: number; claimToken?: string; executionLeaseToken?: string; candidateToken?: string };
  customer?: SteelQuotationCustomerPreparation;
  systemOrder?: SteelQuotationCurrentSystemOrder;
  quotationOrder?: SteelMarkdownQuotationOrderInput;
}

export type SteelQuotationSummaryAppendInput = SteelQuotationSummaryInput;
export type SteelQuotationSummaryAppendResult = SteelQuotationSummaryResult;

/** Extra guard inputs for the early quotation-order publication path. */
export interface SteelMarkdownQuotationOrderInput {
  runId: string;
  runTargetMessageId: string;
  leaseToken: string;
  inputSnapshotSha256: string;
  normalizedSha256: string;
  customer: Pick<SteelQuotationCustomerPreparation, 'preparationId' | 'customerIdentity' | 'customerMarkdown'>;
  /** Ephemeral caller fence; never persisted in the receipt. */
  signal?: AbortSignal;
}

export type SteelMarkdownPublicationResult =
  | { ok: true; message: SteelQuotationSavedMessage; references: SteelMarkdownReference[] }
  | { ok: false; code: 'superseded' | 'invalid_target' };
