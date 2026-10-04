import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import type {
  SteelQuotationPendingMessageFile,
  SteelQuotationScope,
  SteelQuotationPublicationProof,
  SteelQuotationPublicationSaveResult,
} from '@librechat/data-schemas';
import type { SteelQuotationActiveRun } from '@librechat/data-schemas';
import type { SteelMarkdownPublication } from '../markdown/completion';
import type { QuotationModelInput } from './model';
import { createSystemOrderRevisionService, formatSystemOrderRevisionInstruction } from './revision';
import { createSteelMarkdownCompletionServices } from '../markdown/completion';
import { buildDefaultSteelGlobalAgentContext } from '../native/context';
import { createSteelOcrResponseAuditService } from '../ocr/audit';
import { quotationPreparationInstruction } from './preparation';
import { createSteelQuotationStateService } from './state';
import { createSteelOcrStateService } from '../ocr/state';
import { invokeQuotationModel } from './model';

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
  language?: string;
  persist(input: { messageId: string; parentMessageId: string; markdown: string; completed?: boolean }): Promise<object | null | undefined>;
  publishQuotation?(input: SteelQuotationPublicationProof & { markdown: string }): Promise<SteelQuotationPublicationSaveResult>;
  publish(input: { messageId: string; parentMessageId: string; markdown: string; publication?: SteelMarkdownPublication; acceptedRun?: SteelQuotationActiveRun }): Promise<void>;
  onSignalAccepted?(): Promise<void>;
}): Promise<void> {
  const service = createSteelQuotationStateService(mongoose);
  const ocrService = createSteelOcrStateService(mongoose);
  const revisionService = createSystemOrderRevisionService({
    read: service.readState,
    readCurrentSystemOrder: service.readCurrentSystemOrder,
    readCheckpoint: service.readCheckpoint,
    saveCurrentSystemOrder: service.saveCurrentSystemOrder,
  });
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
      const needsResultSave = !markdown;
      const hasCurrentSystemOrder = hasSystemOrder && (!previous?.currentOcrResultMarkdown ||
        previous.currentOcrResultMarkdown === quotationState?.currentOrder?.markdown);
      const systemOrder = hasCurrentSystemOrder
        ? await revisionService.readCurrentSystemOrder(input.scope, quotationState) : undefined;
      const revisionInstruction = systemOrder ? formatSystemOrderRevisionInstruction(systemOrder) : '';
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
          prompt: `${rules.instructionPrefix}\n\n${quotationPreparationInstruction(previous?.currentOcrResultMarkdown, quotationState?.currentCustomer?.customerMarkdown, hasCurrentSystemOrder)}\n\n${revisionInstruction}\n\nThe previous quotation is now terminal. Process the queued message below exactly once. For a new order, output one complete ## ocr_result table. For a material-order correction, output only changed or newly added rows under ## ocr_result_updates, using the exact saved column names and order. Preserve all unchanged cells in each changed row and never use omission to delete a row. When hasSystemOrder is true, do not repeatedly ask whether to quote the current completed system_order; historical results do not count. An explicit A-F direct tier choice may emit customer_data. Do not output quote_signal in this response.`,
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
        await assertActive();
      }
      let finalMarkdown = markdown;
      const finalized = await createSteelMarkdownCompletionServices({ ocr: ocrService, quotation: service }).finalize({
        req: {
          user: { id: input.scope.userId, tenantId: input.scope.tenantId },
          cookies: { lang: input.language },
          steelNativeContext: { requestId: messageId, quotation: {
            scope: input.scope, state: quotationState ?? undefined,
            messageId: claim.sourceMessageId, messageText: claim.sourceMessageText,
            messageFiles: claim.sourceMessageFiles,
          } },
        },
        responseId: messageId, generationId: messageId, markdown, completed: true, stage: 'pending',
        assertActive,
        onPrepared: async (prepared) => {
          if (needsResultSave && !await service.savePendingResult({ ...claimInput, markdown: prepared, targetMessageId: messageId })) {
            throw new Error('Queued order result lost its claim');
          }
        },
        applyMarkdown: (value) => { finalMarkdown = value; },
        persistMarkdown: (options) => input.persist({ messageId, parentMessageId: claim.sourceMessageId, markdown: finalMarkdown, completed: options?.completed }),
        publishQuotation: input.publishQuotation,
      });
      markdown = finalized.markdown;
      if (finalized.acceptedRun) await input.onSignalAccepted?.();
      await assertActive();
      await input.publish({ messageId, parentMessageId: claim.sourceMessageId, markdown, publication: finalized.publication, acceptedRun: finalized.acceptedRun });
      if (!await service.completePendingMessage({ ...claimInput, targetMessageId: messageId })) {
        throw new Error('Queued order completion lost its claim');
      }
    } finally {
      clearInterval(heartbeat);
      input.signal.removeEventListener('abort', abort);
    }
  }
}
