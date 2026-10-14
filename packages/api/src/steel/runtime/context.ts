import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';
import type { SteelJsonValue } from '../repositories/types';

export interface SteelRuntimeJsonObject {
  [key: string]: SteelJsonValue | undefined;
}

export interface SteelRuntimeOtherGlobalRules {
  ocrSharedRules: SteelAgentRule[];
  ocrVisionRules: SteelAgentRule[];
  ocrMainRules: SteelAgentRule[];
  ocrOrganizerRules: SteelAgentRule[];
  ocrDelegateRules: SteelAgentRule[];
  fileRules: SteelAgentRule[];
  sourcePriorityRules: SteelAgentRule[];
  markdownOutputRules: SteelAgentRule[];
}

export interface SteelRuntimeOcrSourceFileMapping {
  sourceCode: string;
  sourceFilename: string;
}

export interface SteelRuntimeContext {
  rules: {
    agentRules: SteelAgentRule[];
    steelGlobalRules: {
      quoteRules: SteelQuoteRule[];
    };
    outputRules: SteelAgentRule[];
    otherGlobalRules: SteelRuntimeOtherGlobalRules;
  };
  attachments: {
    currentPaddleOcrStatuses: SteelRuntimeJsonObject[];
    currentOcrMarkdownResults: SteelRuntimeJsonObject[];
    currentOcrFailures: SteelRuntimeJsonObject[];
    currentOcrSourceFileMapping: SteelRuntimeOcrSourceFileMapping[];
    previousOcrResultMarkdown?: string;
    suggestedOcrResultColumns?: string[];
  };
}

export interface SteelRuntimeContextConversationInput {
  requestId: string;
}

export interface SteelRuntimeContextAttachmentsInput {
  currentPaddleOcrStatuses?: SteelRuntimeJsonObject[];
  currentOcrMarkdownResults?: SteelRuntimeJsonObject[];
  currentOcrFailures?: SteelRuntimeJsonObject[];
  currentOcrSourceFileMapping?: SteelRuntimeOcrSourceFileMapping[];
  previousOcrResultMarkdown?: string;
  suggestedOcrResultColumns?: string[];
}

export interface SteelRuntimeContextDependencies {
  listAgentRules(): Promise<SteelAgentRule[]>;
  listReviewedQuoteRules(): Promise<SteelQuoteRule[]>;
  listOutputRules(): Promise<SteelAgentRule[]>;
  listOtherGlobalRules(): Promise<SteelRuntimeOtherGlobalRules>;
}

export interface PrepareSteelRuntimeContextInput {
  conversation: SteelRuntimeContextConversationInput;
  attachments?: SteelRuntimeContextAttachmentsInput;
  dependencies: SteelRuntimeContextDependencies;
}

export async function prepareSteelRuntimeContext({
  attachments,
  dependencies,
}: PrepareSteelRuntimeContextInput): Promise<SteelRuntimeContext> {
  const [agentRules, quoteRules, outputRules, otherGlobalRules] =
    await Promise.all([
      dependencies.listAgentRules(),
      dependencies.listReviewedQuoteRules(),
      dependencies.listOutputRules(),
      dependencies.listOtherGlobalRules(),
    ]);

  return {
    rules: {
      agentRules,
      steelGlobalRules: { quoteRules },
      outputRules,
      otherGlobalRules,
    },
    attachments: {
      currentPaddleOcrStatuses: attachments?.currentPaddleOcrStatuses ?? [],
      currentOcrMarkdownResults: attachments?.currentOcrMarkdownResults ?? [],
      currentOcrFailures: attachments?.currentOcrFailures ?? [],
      currentOcrSourceFileMapping: attachments?.currentOcrSourceFileMapping ?? [],
      ...(attachments?.previousOcrResultMarkdown !== undefined
        ? { previousOcrResultMarkdown: attachments.previousOcrResultMarkdown }
        : {}),
      ...(attachments?.suggestedOcrResultColumns !== undefined
        ? { suggestedOcrResultColumns: attachments.suggestedOcrResultColumns }
        : {}),
    },
  };
}
