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
import { finalizeOcrResponse } from '../ocr/result';
import { quotationPreparationInstruction } from './preparation';
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
      const previous = await ocrService.readConversationOcrState(input.scope.conversationId);
      let markdown = claim.resultMarkdown;
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
          prompt: `${rules.instructionPrefix}\n\n${quotationPreparationInstruction(previous?.currentOcrResultMarkdown)}\n\nThe previous quotation is now terminal. Process the queued message below exactly once. For order changes, output the complete revised ocr_result and ask the user to confirm a NEW quotation. Do not output customer_data or quote_signal in this response.`,
          input: preparedInput?.input ?? claim.sourceMessageText ?? '',
          modelOptions: input.modelOptions,
          signal: controller.signal,
          assertActive,
          onUsage: input.onUsage,
        });
        markdown = result.markdown;
        if (/^##\s+(quote_signal|system_order|customer_quote)\s*$/mu.test(markdown)) {
          throw new Error('Queued corrections require a new order confirmation');
        }
        if (/^##\s+ocr_result\s*$/mu.test(markdown)) {
          const finalized = finalizeOcrResponse({
            assistantResponse: markdown,
            previousOcrMarkdown: previous?.currentOcrResultMarkdown,
            canonicalMapping: (previous?.sourceMappings ?? []).map(({ sourceCode, sourceFilename }) => ({ sourceCode, sourceFilename })),
            agentKind: 'other',
            currentUserTurn: preparedInput?.currentUserTurn ?? claim.sourceMessageText,
          });
          if (!finalized.ok) throw new Error(`Queued order could not be validated: ${finalized.reason}`);
          markdown = finalized.finalResponse;
        }
        await assertActive();
        if (!await service.savePendingResult({ ...claimInput, markdown, targetMessageId: messageId })) {
          throw new Error('Queued order result lost its claim');
        }
      }
      await assertActive();
      await input.publish({ messageId, parentMessageId: claim.sourceMessageId, markdown });
      if (/^##\s+ocr_result\s*$/mu.test(markdown)) {
        const saved = await ocrService.upsertCurrentOcrResult({
          conversationId: input.scope.conversationId,
          generationId: messageId,
          attemptNumber: 1,
          markdown,
          messageId,
          ...(previous?.currentOcrResultGenerationId ? { expectedGenerationId: previous.currentOcrResultGenerationId } : {}),
        });
        if (!saved) throw new Error('Queued order persistence failed');
        await service.setOrder({ scope: input.scope, fullMarkdown: markdown, revision: messageId, messageId });
      }
      if (!await service.completePendingMessage({ ...claimInput, targetMessageId: messageId })) {
        throw new Error('Queued order completion lost its claim');
      }
    } finally {
      clearInterval(heartbeat);
      input.signal.removeEventListener('abort', abort);
    }
  }
}
