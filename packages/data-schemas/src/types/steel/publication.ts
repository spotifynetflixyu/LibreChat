import type { SteelQuotationScope, SteelQuotationCurrentSystemOrder, SteelQuotationCustomerPreparation, SteelQuotationPublicationMessage, SteelQuotationSavedMessage, SteelQuotationPublicationSaveContext } from './quotation';

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
}

export type SteelMarkdownPublicationResult =
  | { ok: true; message: SteelQuotationSavedMessage; references: SteelMarkdownReference[] }
  | { ok: false; code: 'superseded' | 'invalid_target' };
