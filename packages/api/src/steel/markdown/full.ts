import { randomUUID, createHash } from 'node:crypto';
import { parseSteelReviewMarkdownTables } from 'librechat-data-provider';
import type { SteelMarkdownPublicationInput, SteelMarkdownPublicationResult, SteelMarkdownPublicationTarget, SteelQuotationPublicationMessage, SteelQuotationPublicationSaveContext } from '@librechat/data-schemas';
import type { SteelMarkdownCompletionInput, SteelMarkdownCompletionDependencies, SteelFullPublisher } from './types';
import { prepareQuotationCustomerResponse } from '../quotation/preparation';
import { finalizeOcrResponse, parseAssistantMarkdown } from '../ocr/result';
import { appendSteelNextStep, steelSectionTitle } from '../quotation/next';
import { SteelResponseCompletionError } from '../quotation/completion';
import { createSteelReviewBaselineRows } from '../review';
import { buildCustomerQuoteFromMarkdown } from './quote';
import { admitFullOnlyMarkdown } from './admission';

export type { SteelFullPublication, SteelFullPublisher } from './types';

export function createSteelFullMarkdownPublisher(input: {
  buildMessage(input: { markdown: string }): SteelQuotationPublicationMessage | Promise<SteelQuotationPublicationMessage>;
  savePublication(input: SteelMarkdownPublicationInput): Promise<SteelMarkdownPublicationResult>;
  saveContext?: SteelQuotationPublicationSaveContext;
}): SteelFullPublisher {
  return async (publication) => {
    const message = await input.buildMessage({ markdown: publication.markdown });
    return input.savePublication({ ...publication, saveContext: input.saveContext,
      message: { ...message, messageId: publication.admission.responseId, conversationId: publication.scope.conversationId,
        parentMessageId: publication.parentMessageId ?? message.parentMessageId, user: publication.scope.userId, tenantId: publication.scope.tenantId, text: publication.markdown, isCreatedByUser: false, unfinished: false } });
  };
}

export async function publishFullMarkdown(input: SteelMarkdownCompletionInput, dependencies: SteelMarkdownCompletionDependencies): Promise<string> {
  const context = input.req.steelNativeContext;
  const scope = context?.quotation?.scope;
  const admission = context?.quotation?.publicationAdmission;
  if (!scope || !admission || !input.publishMarkdown || admission.responseId !== input.responseId ||
    admission.generationId !== (input.generationId ?? context?.requestId ?? input.responseId)) {
    throw new SteelResponseCompletionError('invalid_completion_receipt');
  }
  const [ocr, state] = await Promise.all([
    dependencies.ocr.readConversationOcrState(scope.conversationId), dependencies.quotation.readState(scope),
  ]);
  const sections = parseAssistantMarkdown(input.markdown).sections;
  const kinds = ['ocr_result', 'system_order', 'customer_data'] as const;
  for (const kind of kinds) {
    const section = sections.find((entry) => steelSectionTitle(entry.title) === kind);
    if (!section) continue;
    const valid = admitFullOnlyMarkdown({ markdown: input.markdown, kind, title: section.title, messageId: input.responseId });
    if (!valid.ok) throw new SteelResponseCompletionError(valid.code);
  }
  let markdown = parseAssistantMarkdown(input.markdown).segments
    .filter((segment) => segment.kind !== 'section' || steelSectionTitle(segment.section.title) !== 'customer_quote')
    .map((segment) => segment.kind === 'section' ? segment.section.raw : segment.text).join('').trimEnd();
  const delegate = context?.delegateOcrContext;
  const run = delegate?.activeRun ?? delegate?.delegateOcrRun;
  const agentKind = delegate?.didExecute || run ? 'delegate_ocr' : 'other';
  if (sections.some((section) => steelSectionTitle(section.title) === 'ocr_result')) {
    const workflow = delegate?.delegateOcrWorkflow ?? delegate;
    if (!(workflow?.finalizedByBackend && workflow.finalizedResponse?.finalResponse === input.markdown)) {
      await dependencies.audit?.save({ rawResponse: input.markdown, sourceStage: 'normal_request', userId: scope.userId,
        tenantId: scope.tenantId, conversationId: scope.conversationId, messageId: input.responseId, generationId: admission.generationId,
        attemptNumber: run?.agentAttemptNumber ?? delegate?.agentAttemptNumber ?? 1,
        attemptId: run?.agentAttemptToken ?? delegate?.attemptToken,
        baseRevision: ocr?.currentOcrResultGenerationId, baseResponse: ocr?.currentOcrResultMarkdown ?? '' });
    }
    const finalized = finalizeOcrResponse({ assistantResponse: markdown, messageId: input.responseId,
      canonicalMapping: (ocr?.sourceMappings ?? []).map(({ sourceCode, sourceFilename }) => ({ sourceCode, sourceFilename })),
      agentKind: context?.ocrTurnActive && agentKind === 'other' ? 'regular_ocr' : agentKind,
      delegateSummary: Boolean(delegate?.didExecute || run), currentUserTurn: delegate?.currentUserTurnText ?? context?.quotation?.messageText });
    if (!finalized.ok) throw new SteelResponseCompletionError(finalized.reason);
    markdown = finalized.finalResponse;
  }
  const targets: SteelMarkdownPublicationTarget[] = [];
  let customer: SteelMarkdownPublicationInput['customer'];
  let systemOrder: SteelMarkdownPublicationInput['systemOrder'];
  for (const kind of kinds) {
    const section = parseAssistantMarkdown(markdown).sections.find((entry) => steelSectionTitle(entry.title) === kind);
    if (!section) continue;
    const baselineMarkdown = section.raw.trimEnd();
    const outputId = `${kind}:${admission.generationId}`;
    const target: SteelMarkdownPublicationTarget = { kind, title: section.title, outputId, revision: admission.generationId, baselineMarkdown };
    if (kind === 'customer_data') {
      const prepared = await prepareQuotationCustomerResponse({ scope, response: markdown, responseId: input.responseId,
        messageId: context?.quotation?.messageId, messageText: context?.quotation?.messageText,
        messageFiles: context?.quotation?.messageFiles, service: dependencies.quotation,
        expectedOrderHash: admission.expected.orderHash, expectedCustomerPreparationId: admission.expected.customerPreparationId, finishReason: 'stop' });
      if (!prepared) throw new SteelResponseCompletionError('customer_save_failed');
      customer = prepared.kind === 'unchanged' ? { ...prepared.customer, customerMarkdown: baselineMarkdown, responseId: input.responseId }
        : { preparationId: randomUUID(), customerMarkdown: baselineMarkdown, customerIdentity: prepared.input.customerIdentity,
          triggeringMessageId: prepared.input.triggeringMessageId, responseId: input.responseId,
          orderHash: prepared.input.orderHash, selectionProvenance: prepared.input.selectionProvenance };
    } else {
      const tables = parseSteelReviewMarkdownTables(baselineMarkdown);
      if (tables.length !== 1) throw new SteelResponseCompletionError('invalid_target');
      const sourceMappings = (ocr?.sourceMappings ?? []).map(({ fileId, sourceCode, sourceFilename }) => ({ fileId, sourceCode, sourceFilename }));
      target.headers = tables[0].headers;
      target.sourceMappings = sourceMappings;
      if (kind === 'system_order') {
        const current = state?.currentSystemOrder;
        if (!current || state?.activeRun?.status !== 'completed' || state.activeRun.runId !== current.runId ||
          state.currentOrder?.sha256 !== admission.expected.orderHash || state.currentCustomer?.preparationId !== admission.expected.customerPreparationId ||
          !await dependencies.quotation.hasSystemOrder(scope)) throw new SteelResponseCompletionError('invalid_system_order');
        const quote = buildCustomerQuoteFromMarkdown(baselineMarkdown);
        if (!quote) throw new SteelResponseCompletionError('invalid_system_order');
        systemOrder = { ...current, markdown: baselineMarkdown, sha256: createHash('sha256').update(baselineMarkdown).digest('hex'),
          customerQuoteMarkdown: quote.markdown, messageId: input.responseId, responseId: input.responseId, needsRequote: false, updatedAt: new Date() };
        target.sourceMappings = current.sourceSnapshot?.mappings ?? [];
      }
      target.rows = createSteelReviewBaselineRows(tables[0], kind, outputId, target.sourceMappings, kind === 'system_order' ? systemOrder?.calculationCheckpoint : undefined);
    }
    targets.push(target);
  }
  const order = targets.find((target) => target.kind === 'ocr_result')?.baselineMarkdown ?? state?.currentOrder?.markdown;
  markdown = appendSteelNextStep({ markdown, order, customer: customer?.customerMarkdown ?? state?.currentCustomer?.customerMarkdown,
    completed: true, language: input.req.cookies?.lang || input.req.headers?.['accept-language']?.split(',')[0] || 'en' });
  const claimToken = run?.claimToken ?? delegate?.claimToken;
  const executionLeaseToken = delegate?.delegateOcrExecutionLease?.executionLeaseToken ?? run?.executionLeaseToken;
  const delegateOcrIndex = run?.delegateOcrIndex ?? delegate?.delegateOcrIndex;
  let candidateToken: string | undefined;
  if (claimToken && targets.some((target) => target.kind === 'ocr_result')) {
    const currentRun = await dependencies.ocr.findDelegateOcrRunByClaimToken(claimToken);
    candidateToken = `${admission.generationId}:${input.responseId}:${createHash('sha256').update(markdown).digest('hex')}`;
    if (!currentRun?.finalizationJournal.claimCleared) {
      if (!await dependencies.ocr.setDelegateFinalizedCandidate({ claimToken, executionLeaseToken,
        candidate: { token: candidateToken, markdown, source: 'backend', generationId: admission.generationId,
          targetMessageId: input.responseId, createdAt: new Date() } }) ||
        !await dependencies.ocr.updateDelegateFinalizationJournal({ claimToken, executionLeaseToken, candidateToken,
          journal: { candidateValidated: true, candidateValidatedToken: candidateToken } })) {
        throw new SteelResponseCompletionError('stale_delegate_lease');
      }
    }
  }
  await input.onPrepared?.(markdown);
  await input.assertActive?.();
  input.applyMarkdown(markdown);
  const saved = await input.publishMarkdown({ scope, admission, rawMarkdown: input.markdown, targets, markdown, parentMessageId: context?.quotation?.messageId,
    ...(customer ? { customer } : {}), ...(systemOrder ? { systemOrder } : {}),
    ...(targets.some((target) => target.kind === 'ocr_result') ? { ocr: { attemptNumber: run?.agentAttemptNumber ?? delegate?.agentAttemptNumber ?? 1,
      delegateOcrIndex, claimToken, executionLeaseToken, candidateToken } } : {}) });
  if (!saved.ok) throw new SteelResponseCompletionError(saved.code === 'superseded' ? 'superseded_response' : saved.code);
  input.publishedResponse?.accept(saved.message);
  return markdown;
}
