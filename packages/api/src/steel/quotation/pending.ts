import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import type {
  SteelQuotationPendingMessageFile,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import type { QuotationModelInput } from './model';
import { invokeQuotationModel } from './model';
import { createSteelQuotationStateService } from './state';
import { createSteelOcrStateService } from '../ocr/state';
import { createSteelOcrResponseAuditService } from '../ocr/audit';
import { finalizeOcrResponse, parseAssistantMarkdown } from '../ocr/result';
import { quotationPreparationInstruction } from './preparation';
import { acceptQuotationResponse } from './runner';
import { buildDefaultSteelGlobalAgentContext } from '../native/context';

export interface SteelQuotationPendingInputPreparationInput {
  scope: SteelQuotationScope;
  sourceMessageId: string;
  sourceMessageText?: string;
  sourceMessageFiles: readonly SteelQuotationPendingMessageFile[];
  signal: AbortSignal;
  assertActive(): Promise<void>;
}

export interface SteelQuotationPendingInputPreparationResult {
  /** Model input containing OCR content produced from the queued files. */
  input: string;
  /** Original user text used when validating a revised OCR result. */
  currentUserTurn?: string;
}

function hasOcrOrderSection(markdown: string): boolean {
  return parseAssistantMarkdown(markdown).sections.some((section) =>
    ['ocr_result', 'ocr_result_updates'].includes(section.title.trim()),
  );
}

function extractCanonicalOcrResult(markdown: string): string | undefined {
  const sections = parseAssistantMarkdown(markdown).sections.filter(
    (section) => section.title.trim() === 'ocr_result',
  );
  const section = sections.at(-1);
  return section?.raw.trim() || undefined;
}

/** A queued correction never inherits approval to quote the preceding revision. */
export async function processQuotationPendingMessages(input: {
  scope: SteelQuotationScope;
  modelOptions: QuotationModelInput['modelOptions'];
  signal: AbortSignal;
  onUsage?: QuotationModelInput['onUsage'];
  preparePendingInput?: (
    input: SteelQuotationPendingInputPreparationInput,
  ) => Promise<SteelQuotationPendingInputPreparationResult>;
  publish(input: { messageId: string; parentMessageId: string; markdown: string }): Promise<void>;
}): Promise<void> {
  const service = createSteelQuotationStateService(mongoose);
  const ocrService = createSteelOcrStateService(mongoose);
  for (let count = 0; count < 64; count += 1) {
    input.signal.throwIfAborted();
    const claim = await service.claimPendingMessage({ scope: input.scope, leaseDurationMs: 60_000 });
    if (!claim) return;
    const claimInput = { scope: input.scope, sourceMessageId: claim.sourceMessageId, claimToken: claim.claimToken };
    const controller = new AbortController();
    const abort = () => controller.abort(input.signal.reason);
    input.signal.addEventListener('abort', abort, { once: true });
    const assertActive = async () => {
      controller.signal.throwIfAborted();
      if (!await service.renewPendingClaim({ ...claimInput, leaseDurationMs: 60_000 })) {
        controller.abort(new Error('Pending quotation message claim expired'));
        controller.signal.throwIfAborted();
      }
    };
    const heartbeat = setInterval(() => { assertActive().catch((error: Error) => controller.abort(error)); }, 10_000);
    heartbeat.unref();
    try {
      const messageId = claim.targetMessageId ?? randomUUID();
      const [previous, quotationState, hasSystemOrder] = await Promise.all([
        ocrService.readConversationOcrState(input.scope.conversationId),
        service.readState(input.scope),
        service.hasSystemOrder(input.scope),
      ]);
      let markdown = claim.resultMarkdown;
      let canonicalOcrResultMarkdown: string | undefined;
      const needsResultSave = !markdown;
      if (markdown) {
        canonicalOcrResultMarkdown = extractCanonicalOcrResult(markdown);
      }
      if (!markdown) {
        const sourceMessageFiles = claim.sourceMessageFiles ?? [];
        const preparedInput = sourceMessageFiles.length > 0
          ? await input.preparePendingInput?.({
              scope: input.scope,
              sourceMessageId: claim.sourceMessageId,
              ...(claim.sourceMessageText ? { sourceMessageText: claim.sourceMessageText } : {}),
              sourceMessageFiles,
              signal: controller.signal,
              assertActive,
            })
          : undefined;
        if (sourceMessageFiles.length > 0 && !preparedInput) {
          throw new Error('Queued quotation files require OCR preprocessing before completion');
        }
        const rules = await buildDefaultSteelGlobalAgentContext({
          conversation: { conversationId: input.scope.conversationId, requestId: messageId, activeHistory: [] },
          mode: 'standard',
        });
        const result = await invokeQuotationModel({
          role: 'preparation',
          prompt: `${rules.instructionPrefix}\n\n${quotationPreparationInstruction(previous?.currentOcrResultMarkdown, quotationState?.currentCustomer?.customerMarkdown, hasSystemOrder)}\n\nThe previous quotation is now terminal. Process the queued message below exactly once. For a new order, output one complete ## ocr_result table. For a correction, output only changed or newly added rows under ## ocr_result_updates, using the exact saved column names and order. Preserve all unchanged cells in each changed row and never use omission to delete a row. When hasSystemOrder is true, do not repeatedly ask whether to quote the current completed system_order; historical results do not count. An explicit default-B choice may emit customer_data. Do not output quote_signal in this response.`,
          input: preparedInput?.input ?? claim.sourceMessageText ?? '',
          modelOptions: input.modelOptions,
          signal: controller.signal,
          assertActive,
          onUsage: input.onUsage,
        });
        markdown = result.markdown;
        const rawPendingResponse = typeof markdown === 'string' ? markdown : '';
        await createSteelOcrResponseAuditService(mongoose).save({
          rawResponse: rawPendingResponse,
          sourceStage: 'pending',
          userId: input.scope.userId,
          conversationId: input.scope.conversationId,
          messageId,
          generationId: messageId,
          attemptId: claim.claimToken,
          attemptNumber: 1,
          ...(previous?.currentOcrResultGenerationId
            ? { baseRevision: previous.currentOcrResultGenerationId }
            : {}),
          baseResponse: previous?.currentOcrResultMarkdown ?? '',
        });
        if (parseAssistantMarkdown(markdown).sections.some((section) =>
          ['quote_signal', 'system_order', 'customer_quote'].includes(section.title.split(/[｜|]/u)[0]?.trim()),
        )) {
          throw new Error('Queued corrections require a new order confirmation');
        }
        if (hasOcrOrderSection(markdown)) {
          const finalized = finalizeOcrResponse({
            assistantResponse: markdown,
            previousOcrMarkdown: previous?.currentOcrResultMarkdown,
            canonicalMapping: (previous?.sourceMappings ?? []).map(({ sourceCode, sourceFilename }) => ({ sourceCode, sourceFilename })),
            agentKind: 'other',
            currentUserTurn: preparedInput?.currentUserTurn ?? claim.sourceMessageText,
          });
          if (!finalized.ok) {
            throw new Error(`Queued order could not be validated: ${finalized.reason}`);
          }
          markdown = finalized.finalResponse;
          canonicalOcrResultMarkdown = finalized.ocrResultMarkdown;
        }
        await acceptQuotationResponse({
          scope: input.scope,
          response: markdown,
          responseId: messageId,
          messageId: claim.sourceMessageId,
          expectedOrderHash: quotationState?.currentOrder?.sha256,
          expectedCustomerPreparationId: quotationState?.currentCustomer?.preparationId,
          finishReason: 'stop',
        });
        await assertActive();
      }
      await assertActive();
      if (canonicalOcrResultMarkdown) {
        const saved = await ocrService.upsertCurrentOcrResult({
          conversationId: input.scope.conversationId,
          generationId: messageId,
          attemptNumber: 1,
          markdown: canonicalOcrResultMarkdown,
          messageId,
          ...(previous?.currentOcrResultGenerationId && previous.currentOcrResultGenerationId !== messageId
            ? { expectedGenerationId: previous.currentOcrResultGenerationId }
            : {}),
        });
        if (!saved) throw new Error('Queued order persistence failed');
        await service.setOrder({
          scope: input.scope,
          fullMarkdown: canonicalOcrResultMarkdown,
          revision: messageId,
          messageId,
        });
      }
      if (needsResultSave) {
        if (!await service.savePendingResult({ ...claimInput, markdown, targetMessageId: messageId })) {
          throw new Error('Queued order result lost its claim');
        }
      }
      await input.publish({ messageId, parentMessageId: claim.sourceMessageId, markdown });
      if (!await service.completePendingMessage({ ...claimInput, targetMessageId: messageId })) {
        throw new Error('Queued order completion lost its claim');
      }
    } finally {
      clearInterval(heartbeat);
      input.signal.removeEventListener('abort', abort);
    }
  }
}
