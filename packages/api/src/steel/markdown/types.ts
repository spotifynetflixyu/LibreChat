import type { SteelMarkdownPublicationInput, SteelMarkdownPublicationResult, SteelQuotationActiveRun, SteelQuotationPublicationProof, SteelQuotationPublicationSaveResult } from '@librechat/data-schemas';
import type { SteelQuotationStateService } from '../quotation/state';
import type { SteelResponseRequest } from '../quotation/completion';
import type { SteelOcrResponseAuditService } from '../ocr/audit';
import type { SteelDelegateOcrStateService } from '../ocr/state';

export type SteelFullPublication = Omit<SteelMarkdownPublicationInput, 'message' | 'saveContext'> & { markdown: string; parentMessageId?: string };
export type SteelFullPublisher = (input: SteelFullPublication) => Promise<SteelMarkdownPublicationResult>;

export interface SteelMarkdownCompletionInput {
  req: SteelResponseRequest;
  responseId: string;
  generationId?: string;
  markdown: string;
  completed: boolean;
  stage?: 'workflow' | 'ui' | 'pending';
  applyMarkdown(markdown: string): void;
  persistMarkdown(options?: { completed: boolean }): Promise<object | null | undefined>;
  publishMarkdown?: SteelFullPublisher;
  publishQuotation?(input: SteelQuotationPublicationProof & { markdown: string }):
    Promise<SteelQuotationPublicationSaveResult>;
  publishedResponse?: SteelPublishedResponsePort;
  assertActive?(): Promise<void>;
  onPrepared?(markdown: string): Promise<void>;
}

export interface SteelPublishedResponseLocator {
  responseId: string;
  conversationId: string;
  userId: string;
  tenantId?: string;
}

export interface SteelPublishedResponseIdentity {
  messageId: string;
  conversationId: string;
  user: string;
  tenantId?: string;
}

export interface SteelPublishedResponsePort<TRecord extends SteelPublishedResponseIdentity = SteelPublishedResponseIdentity> {
  load(locator: SteelPublishedResponseLocator): Promise<TRecord | null | undefined>;
  accept(record: TRecord): void;
}

export interface SteelMarkdownCompletionResult {
  markdown: string;
  acceptedRun?: SteelQuotationActiveRun;
  publication?: SteelMarkdownPublication;
}

export interface SteelMarkdownPublication {
  readonly scopeKey: string;
  readonly responseId: string;
  readonly generationId: string;
  readonly markdown: string;
  readonly ocrGeneration?: string;
  readonly ocrHash?: string;
  readonly orderHash?: string;
  readonly customerPreparationId?: string;
  readonly runId?: string;
  readonly systemOrderHash?: string;
}

export interface SteelMarkdownCompletionDependencies {
  ocr: SteelDelegateOcrStateService;
  quotation: SteelQuotationStateService;
  audit?: SteelOcrResponseAuditService;
}
