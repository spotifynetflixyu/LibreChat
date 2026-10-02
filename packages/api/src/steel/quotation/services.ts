import type { SteelResponseRequest, SteelResponseCompletionDependencies } from './completion';
import type { SteelDelegateOcrStateService } from '../ocr/state';
import type { Response } from '../../agents/responses/types';
import type { SteelQuotationStateService } from './state';
import { extractSteelNativeMarkdownText, extractSteelNativeResponseOutputText } from '../native/markdown';
import { isStandardSteelResponse, SteelResponseCompletionError } from './completion';
import { finalizeOcrResponse, parseAssistantMarkdown } from '../ocr/result';
import { resolveRequestTenantId } from '../../middleware/tenant';
import { createSystemOrderRevisionService } from './revision';
import { replaceSteelResponsesMarkdown } from './transport';
import { steelDataSectionTitles } from './next';

export function extractSteelAgentResponseMarkdown(
  response: Parameters<typeof extractSteelNativeMarkdownText>[0],
): string {
  return extractSteelNativeMarkdownText({ ...response, sectionTitles: steelDataSectionTitles });
}

export function createSteelAgentCompletionServices(input: {
  ocr: SteelDelegateOcrStateService;
  quotation: SteelQuotationStateService;
}): {
  dependencies: SteelResponseCompletionDependencies;
  saveOrderWithoutMessage(input: {
    req: SteelResponseRequest;
    response: Response;
    responseId: string;
  }): Promise<void>;
} {
  const revision = createSystemOrderRevisionService({
    read: input.quotation.readState,
    readCurrentSystemOrder: input.quotation.readCurrentSystemOrder,
    readCheckpoint: input.quotation.readCheckpoint,
    saveCurrentSystemOrder: input.quotation.saveCurrentSystemOrder,
  });
  return {
    dependencies: {
      readOrder: async (scope) => (await input.ocr.readCurrentOcrResult(scope.conversationId))?.markdown,
      readCustomer: async (scope) =>
        (await input.quotation.readState(scope))?.currentCustomer?.customerMarkdown,
      reviseOrder: revision.finalizeSystemOrderUpdates,
    },
    async saveOrderWithoutMessage(turn) {
      const scope = turn.req.steelNativeContext?.quotation?.scope;
      if (!scope || !isStandardSteelResponse(turn.req) || turn.response.status !== 'completed') {
        return;
      }
      if (
        scope.userId !== turn.req.user?.id ||
        scope.tenantId !== resolveRequestTenantId(turn.req)
      ) {
        throw new SteelResponseCompletionError('invalid_response_scope');
      }
      const response = extractSteelNativeResponseOutputText(turn.response);
      if (
        !parseAssistantMarkdown(response).sections.some((section) =>
          ['ocr_result', 'ocr_result_updates'].includes(section.title),
        )
      ) {
        return;
      }
      const state = await input.ocr.readConversationOcrState(scope.conversationId);
      const finalized = finalizeOcrResponse({
        assistantResponse: response,
        previousOcrMarkdown: state?.currentOcrResultMarkdown,
        canonicalMapping: (state?.sourceMappings ?? []).map((entry) => ({
          sourceCode: entry.sourceCode,
          sourceFilename: entry.sourceFilename,
        })),
        agentKind: 'other',
      });
      if (!finalized.ok) throw new SteelResponseCompletionError(finalized.reason);
      const saved = await input.ocr.upsertCurrentOcrResult({
        conversationId: scope.conversationId,
        generationId: turn.responseId,
        attemptNumber: 1,
        markdown: finalized.ocrResultMarkdown,
        ...(state?.currentOcrResultGenerationId
          ? { expectedGenerationId: state.currentOcrResultGenerationId }
          : {}),
      });
      if (!saved) throw new SteelResponseCompletionError('order_save_failed');
      replaceSteelResponsesMarkdown(turn.response, finalized.finalResponse);
    },
  };
}
