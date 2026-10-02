import type { ISteelQuotationState, SteelQuotationScope, SteelQuotationPendingMessageFile } from '@librechat/data-schemas';
import type { FinalizeOcrResponseSuccess } from '../ocr/result';

export interface SteelResponseRequest {
  _resumableJobCreatedAt?: number;
  user?: { id?: string; tenantId?: string };
  tenantId?: string;
  cookies?: { lang?: string };
  headers?: { 'accept-language'?: string };
  steelNativeContext?: {
    requestId?: string;
    contextMetadata?: { mode?: string };
    ocrTurnActive?: boolean;
    delegateOcrContext?: {
      didExecute?: boolean;
      activeRun?: SteelCompletionDelegateRun;
      delegateOcrRun?: SteelCompletionDelegateRun;
      claimToken?: string;
      delegateOcrIndex?: number;
      agentAttemptNumber?: number;
      attemptToken?: string;
      currentUserTurnText?: string;
      delegateOcrExecutionLease?: { executionLeaseToken?: string };
      delegateOcrWorkflow?: {
        finalizedByBackend?: boolean;
        finalizedResponse?: FinalizeOcrResponseSuccess;
      };
      finalizedByBackend?: boolean;
      finalizedResponse?: FinalizeOcrResponseSuccess;
    };
    quotation?: {
      scope: SteelQuotationScope;
      resume?: boolean;
      state?: ISteelQuotationState;
      messageId?: string;
      messageText?: string;
      messageFiles?: readonly SteelQuotationPendingMessageFile[];
    };
  };
}

export interface SteelCompletionDelegateRun {
  claimToken?: string;
  executionLeaseToken?: string;
  delegateOcrIndex?: number;
  agentAttemptNumber?: number;
  agentAttemptToken?: string;
}

export class SteelResponseCompletionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('Steel response could not be finalized.');
    this.name = 'SteelResponseCompletionError';
    this.code = code;
  }
}
