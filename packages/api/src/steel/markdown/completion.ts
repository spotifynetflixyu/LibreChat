import { createHash } from 'node:crypto';
import type {
  ISteelConversationOcrState,
  ISteelQuotationState,
  SteelQuotationActiveRun,
  SteelQuotationCurrentSystemOrder,
  SteelQuotationPublicationProof,
  SteelQuotationPublicationSaveResult,
  SteelQuotationScope,
  SteelQuotationSourceSnapshot,
  SteelQuotationOcrSelection,
} from '@librechat/data-schemas';
import type { SteelMarkdownCompletionInput, SteelMarkdownCompletionDependencies, SteelMarkdownCompletionResult, SteelMarkdownPublication, SteelPublishedResponseIdentity } from './types';
import type { SteelResponseRequest } from '../quotation/completion';
import { acceptQuotationSignal, acceptQuotationResponse, publishCompletedQuotation, SteelQuotationPublicationError } from '../quotation/runner';
import { appendSteelNextStep, hasSteelDataMarkdown, hasSteelCustomerTier, steelSectionTitle } from '../quotation/next';
import { isUnfinishedQuotation, hasQuotationOrder } from '../quotation/preparation';
import { SteelResponseCompletionError } from '../quotation/completion';
import { resolveRequestTenantId } from '../../middleware/tenant';
import { sameQuotationOcrSelection } from '../quotation/input';
import { parseQuotationSignal } from '../quotation/protocol';
import { retiredMarkdownSectionTitles } from './admission';
import { parseAssistantMarkdown } from '../ocr/result';
import { parseMarkdownTables } from './table';
import { publishFullMarkdown } from './full';

export type {
  SteelMarkdownCompletionInput,
  SteelMarkdownCompletionDependencies,
  SteelMarkdownCompletionResult,
  SteelMarkdownPublication,
  SteelPublishedResponseLocator,
  SteelPublishedResponseIdentity,
  SteelPublishedResponsePort,
} from './types';

interface CompletionReceipt {
  scopeKey: string;
  responseId: string;
  generationId: string;
  inputHash: string;
  inputMarkdown: string;
  stage: 'workflow' | 'ui' | 'pending';
  canonicalMarkdown: string;
  expectedSystemOrderHash?: string;
  expectedSystemOrderRunId?: string;
  expectedOcrGeneration?: string;
  expectedOcrSelection?: SteelQuotationOcrSelection;
  expectedOrderHash?: string;
  expectedCustomerPreparationId?: string;
  systemOrderSnapshot?: SteelQuotationCurrentSystemOrder;
  acceptedRun?: SteelQuotationActiveRun;
  latest?: ISteelQuotationState;
}

/** Receipts belong to the server request, never to model output or a caller's boolean. */
const receipts = new WeakMap<SteelResponseRequest, Map<string, CompletionReceipt>>();
const publications = new WeakSet<SteelMarkdownPublication>();
const adoptedPublications = new WeakMap<SteelResponseRequest, { publication: SteelMarkdownPublication; responseId: string; generationId: string }>();

export function clearSteelMarkdownPublication(req: SteelResponseRequest): void {
  adoptedPublications.delete(req);
}

export function registerSteelMarkdownPublication(
  req: SteelResponseRequest,
  publication: SteelMarkdownPublication,
  responseId: string,
): void {
  const scope = req.steelNativeContext?.quotation?.scope;
  if (!scope || !publications.has(publication) || publication.scopeKey !== scopeKey(scope) ||
    responseId !== req.steelNativeContext?.requestId) {
    throw new SteelResponseCompletionError('invalid_completion_receipt');
  }
  adoptedPublications.set(req, { publication, responseId,
    generationId: String(req._resumableJobCreatedAt ?? req.steelNativeContext?.requestId ?? responseId) });
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function admittedSourceSnapshot(
  ocrState: Pick<ISteelConversationOcrState, 'currentOcrResultGenerationId' | 'currentOcrResultMessageId' |
    'currentOcrResultMarkdown' | 'sourceMappings'> | null | undefined,
  orderHash: string | undefined,
): SteelQuotationSourceSnapshot | undefined {
  if (!ocrState?.currentOcrResultGenerationId || !ocrState.currentOcrResultMarkdown || !orderHash ||
    hash(ocrState.currentOcrResultMarkdown) !== orderHash) {
    return undefined;
  }
  return {
    orderHash,
    generationId: ocrState.currentOcrResultGenerationId,
    ...(ocrState.currentOcrResultMessageId ? { resultMessageId: ocrState.currentOcrResultMessageId } : {}),
    resultHash: orderHash,
    mappings: ocrState.sourceMappings.map(({ fileId, sourceCode, sourceFilename }) => ({
      fileId,
      sourceCode,
      sourceFilename,
    })),
  };
}

function scopeKey(scope: SteelQuotationScope): string {
  return JSON.stringify([scope.userId, scope.tenantId ?? '', scope.conversationId]);
}

function sectionTitles(markdown: string): Set<string> {
  return new Set(parseAssistantMarkdown(markdown).sections.map((entry) => steelSectionTitle(entry.title)));
}

/** The finalizer owns canonical Steel data and completed message persistence. */
export function shouldDeferSteelMarkdownPersistence(req: SteelResponseRequest, markdown: string): boolean {
  const context = req.steelNativeContext;
  return Boolean(context?.quotation?.scope && (hasSteelDataMarkdown(markdown) ||
    parseQuotationSignal(markdown) || context.ocrTurnActive || context.delegateOcrContext?.didExecute ||
    context.quotation.resume || adoptedPublications.has(req)));
}

async function verifyPublication(publication: SteelMarkdownPublication, scope: SteelQuotationScope, dependencies: SteelMarkdownCompletionDependencies): Promise<void> {
  const [ocr, state] = await Promise.all([dependencies.ocr.readScopedCurrentOcrResult(scope), dependencies.quotation.readState(scope)]);
  if (publication.scopeKey !== scopeKey(scope) || !publications.has(publication) ||
    (publication.ocrSelection
      ? !sameQuotationOcrSelection(publication.ocrSelection, state?.activeRun?.ocrSelection)
      : publication.ocrGeneration !== ocr?.generationId || publication.ocrHash !== (ocr?.markdown ? hash(ocr.markdown) : undefined)) ||
    publication.orderHash !== state?.currentOrder?.sha256 ||
    publication.customerPreparationId !== state?.currentCustomer?.preparationId ||
    publication.runId !== state?.activeRun?.runId || publication.systemOrderHash !== state?.currentSystemOrder?.sha256) {
    throw new SteelResponseCompletionError('superseded_response');
  }
}

function requireSaved<T>(value: T | null | undefined, code: string): T {
  if (!value) throw new SteelResponseCompletionError(code);
  return value;
}

async function persist(input: SteelMarkdownCompletionInput, markdown: string, completed = input.completed): Promise<void> {
  await input.assertActive?.();
  input.applyMarkdown(markdown);
  requireSaved(await input.persistMarkdown({ completed }), 'response_save_failed');
}

async function persistQuotation(
  input: SteelMarkdownCompletionInput,
  publication: SteelQuotationPublicationProof & { markdown: string },
): Promise<SteelQuotationPublicationSaveResult> {
  if (input.publishQuotation) {
    // Update the caller-owned physical response before its guarded save captures
    // the full message, preserving content parts alongside the clean text.
    input.applyMarkdown(publication.markdown);
    const saved = await input.publishQuotation(publication);
    if (!saved.ok) throw new SteelResponseCompletionError('superseded_response');
    input.publishedResponse?.accept(saved.message);
    return saved;
  }
  throw new SteelResponseCompletionError('response_save_failed');
}

async function currentQuotationPublicationProof(
  input: SteelMarkdownCompletionInput,
  dependencies: SteelMarkdownCompletionDependencies,
  markdown: string,
  state: ISteelQuotationState | null | undefined,
  run: SteelQuotationActiveRun | undefined,
  capturedSystemOrder?: SteelQuotationCurrentSystemOrder,
): Promise<(SteelQuotationPublicationProof & { markdown: string }) | undefined> {
  const currentOrder = state?.currentOrder;
  const currentSystemOrder = capturedSystemOrder ?? state?.currentSystemOrder;
  const customer = state?.currentCustomer;
  const targetMessageId = currentSystemOrder?.messageId ?? run?.targetMessageId;
  if (!run || run.status !== 'completed' || !run.targetMessageId || !targetMessageId || !currentOrder ||
    !currentSystemOrder || !customer || !input.publishQuotation) return undefined;
  const final = await dependencies.quotation.readCheckpoint({
    scope: input.req.steelNativeContext!.quotation!.scope,
    runId: run.runId,
    operationId: 'final',
  });
  if (!final) return undefined;
  return {
    scope: input.req.steelNativeContext!.quotation!.scope,
    runId: run.runId,
    runTargetMessageId: run.targetMessageId,
    targetMessageId,
    markdown,
    finalSha256: hash(final),
    currentOrderSha256: currentOrder.sha256,
    currentSystemOrderSha256: currentSystemOrder.sha256,
    ...(currentSystemOrder.sourceSnapshot ? { sourceSnapshot: currentSystemOrder.sourceSnapshot } : {}),
    customer: {
      preparationId: customer.preparationId,
      customerIdentity: customer.customerIdentity,
      customerMarkdown: customer.customerMarkdown,
    },
    message: {
      messageId: targetMessageId,
      conversationId: input.req.steelNativeContext!.quotation!.scope.conversationId,
      text: markdown,
      user: input.req.steelNativeContext!.quotation!.scope.userId,
    },
  };
}

async function persistQuotationResponse(
  input: SteelMarkdownCompletionInput,
  dependencies: SteelMarkdownCompletionDependencies,
  markdown: string,
  state: ISteelQuotationState | null | undefined,
  run: SteelQuotationActiveRun | undefined,
  completed: boolean,
  capturedSystemOrder?: SteelQuotationCurrentSystemOrder,
): Promise<void> {
  const effectiveRun = run ?? (state?.activeRun?.status === 'completed' ? state.activeRun : undefined);
  const targetMessageId = capturedSystemOrder?.messageId ?? state?.currentSystemOrder?.messageId ?? effectiveRun?.targetMessageId;
  if (!effectiveRun || targetMessageId !== input.responseId) {
    await persist(input, markdown, completed);
    return;
  }
  const proof = await currentQuotationPublicationProof(input, dependencies, markdown, state, effectiveRun, capturedSystemOrder);
  if (!proof) throw new SteelResponseCompletionError('response_save_failed');
  await input.assertActive?.();
  input.applyMarkdown(markdown);
  await persistQuotation(input, proof);
}

async function acceptPublishedResponse(
  input: SteelMarkdownCompletionInput,
  scope: SteelQuotationScope,
): Promise<void> {
  if (!input.publishedResponse) return;
  let record: SteelPublishedResponseIdentity | null | undefined;
  try {
    record = await input.publishedResponse.load({
      responseId: input.responseId,
      conversationId: scope.conversationId,
      userId: scope.userId,
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
    });
  } catch {
    throw new SteelResponseCompletionError('response_save_failed');
  }
  if (!record || record.messageId !== input.responseId ||
    record.conversationId !== scope.conversationId || record.user !== scope.userId ||
    record.tenantId !== scope.tenantId) {
    throw new SteelResponseCompletionError('response_save_failed');
  }
  input.publishedResponse.accept(record);
}

export function createSteelMarkdownCompletionServices(dependencies: SteelMarkdownCompletionDependencies): {
  finalize(input: SteelMarkdownCompletionInput): Promise<SteelMarkdownCompletionResult>;
} {
  return { finalize: (input) => finalizeSteelMarkdownTurn(input, dependencies) };
}

/** The caller owns only the final UI turn; child/artifact invocations never call this service. */
export async function finalizeSteelMarkdownTurn(
  input: SteelMarkdownCompletionInput,
  dependencies: SteelMarkdownCompletionDependencies,
): Promise<SteelMarkdownCompletionResult> {
  const context = input.req.steelNativeContext;
  const scope = context?.quotation?.scope;
  if (!scope || !input.completed) {
    await persist(input, input.markdown);
    return { markdown: input.markdown };
  }
  if (scope.userId !== input.req.user?.id || scope.tenantId !== resolveRequestTenantId(input.req)) {
    throw new SteelResponseCompletionError('invalid_response_scope');
  }
  if (parseAssistantMarkdown(input.markdown).sections.some((section) =>
    retiredMarkdownSectionTitles.some((title) => title === steelSectionTitle(section.title)))) {
    throw new SteelResponseCompletionError('retired_control_section');
  }
  if (parseQuotationSignal(input.markdown) && ['ocr_result', 'system_order', 'customer_data'].some((kind) => sectionTitles(input.markdown).has(kind))) {
    throw new SteelResponseCompletionError('invalid_quote_signal');
  }
  // The flow appends a new quotation to primary text already committed by this request.
  const workflowReceipt = [...(receipts.get(input.req)?.values() ?? [])].find((entry) =>
    entry.stage === 'workflow' && entry.acceptedRun && entry.responseId === input.responseId &&
    entry.scopeKey === scopeKey(scope) && input.markdown.includes(entry.inputMarkdown));
  if (input.stage === 'ui' && workflowReceipt && input.markdown !== workflowReceipt.inputMarkdown) {
    const boundary = input.markdown.indexOf(workflowReceipt.inputMarkdown) + workflowReceipt.inputMarkdown.length;
    const suffix = input.markdown.slice(boundary);
    if (sectionTitles(suffix).has('system_order')) {
      const prefix = input.markdown.slice(0, boundary);
      const result = await finalizeSteelMarkdownTurn({ ...input, markdown: suffix,
        applyMarkdown: (markdown) => input.applyMarkdown(prefix + markdown) }, dependencies);
      const markdown = prefix + result.markdown;
      if (!result.publication) return { ...result, markdown };
      const publication = Object.freeze({ ...result.publication, markdown });
      publications.add(publication);
      return { ...result, markdown, publication };
    }
  }
  const titles = sectionTitles(input.markdown);
  if (input.stage === 'workflow' && !parseQuotationSignal(input.markdown)) {
    const state = await dependencies.quotation.readState(scope);
    if (!isUnfinishedQuotation(state?.activeRun?.status)) return { markdown: input.markdown };
  }
  if (titles.has('customer_data_updates')) {
    throw new SteelResponseCompletionError('unsupported_customer_updates');
  }
  if (titles.has('ocr_result_chunk') || titles.has('system_order_chunk')) {
    await persist(input, input.markdown);
    return { markdown: input.markdown };
  }
  if (!adoptedPublications.has(input.req) && (context?.ocrTurnActive || context?.delegateOcrContext?.didExecute) &&
    !titles.has('ocr_result') &&
    !titles.has('system_order') && !titles.has('quote_signal')) {
    throw new SteelResponseCompletionError('missing_ocr_result');
  }
  if (!adoptedPublications.has(input.req) && !hasSteelDataMarkdown(input.markdown) && !titles.has('quote_signal')) {
    await persist(input, input.markdown);
    return { markdown: input.markdown };
  }
  try {
    await input.assertActive?.();
    const generationId = input.generationId ?? context?.requestId ?? input.responseId;
    const adoption = adoptedPublications.get(input.req);
    if (input.stage !== 'workflow' && adoption) {
      if (adoption.responseId !== input.responseId || adoption.generationId !== generationId ||
        !input.markdown.endsWith(adoption.publication.markdown)) throw new SteelResponseCompletionError('invalid_completion_receipt');
      await verifyPublication(adoption.publication, scope, dependencies);
      // Keep already-streamed primary text; only the branded trailing snapshot owns data.
      const publication = Object.freeze({ ...adoption.publication,
        responseId: input.responseId, generationId, markdown: input.markdown });
      publications.add(publication);
      const adoptedState = await dependencies.quotation.readState(scope);
      const adoptedRun = adoptedState?.activeRun;
      if (adoption.publication.runId && (!adoptedRun || adoptedRun.runId !== adoption.publication.runId)) {
        throw new SteelResponseCompletionError('superseded_response');
      }
      if (adoptedRun) {
        const capturedSystemOrder = adoptedState?.currentSystemOrder && adoption.publication.systemOrderHash
          ? { ...adoptedState.currentSystemOrder, sha256: adoption.publication.systemOrderHash }
          : undefined;
        await persistQuotationResponse(input, dependencies, input.markdown, adoptedState, adoptedRun, true,
          capturedSystemOrder);
      } else {
        // A durable pending publication without a live run has no guarded proof
        // for a new write; project it to the current response and retain its receipt.
        input.applyMarkdown(input.markdown);
      }
      await verifyPublication(publication, scope, dependencies);
      return { markdown: input.markdown, publication };
    }
    if (['ocr_result', 'customer_data', 'system_order'].some((title) => titles.has(title)) &&
      !parseQuotationSignal(input.markdown) && (!context?.quotation?.resume || titles.has('ocr_result') || titles.has('customer_data'))) {
      const state = await dependencies.quotation.readState(scope);
      if (isUnfinishedQuotation(state?.activeRun?.status)) {
        const acceptedRun = await acceptQuotationResponse({ scope, response: input.markdown, responseId: input.responseId,
          messageId: context?.quotation?.messageId, messageText: context?.quotation?.messageText, messageFiles: context?.quotation?.messageFiles,
          expectedOrderHash: context?.quotation?.state?.currentOrder?.sha256,
          expectedCustomerPreparationId: context?.quotation?.state?.currentCustomer?.preparationId, finishReason: 'stop', service: dependencies.quotation });
        if (!acceptedRun) throw new SteelResponseCompletionError('superseded_response');
        await persist(input, input.markdown, input.stage !== 'workflow');
        return { markdown: input.markdown, acceptedRun };
      }
      const markdown = await publishFullMarkdown(input, dependencies);
      const [ocr, latest] = await Promise.all([dependencies.ocr.readScopedCurrentOcrResult(scope), dependencies.quotation.readState(scope)]);
      const publication: SteelMarkdownPublication = Object.freeze({ scopeKey: scopeKey(scope), responseId: input.responseId,
        generationId, markdown, ocrGeneration: ocr?.generationId, ocrHash: ocr?.markdown ? hash(ocr.markdown) : undefined,
        orderHash: latest?.currentOrder?.sha256, customerPreparationId: latest?.currentCustomer?.preparationId,
        runId: latest?.activeRun?.runId, ocrSelection: latest?.activeRun?.ocrSelection, systemOrderHash: latest?.currentSystemOrder?.sha256 });
      publications.add(publication);
      return { markdown, publication };
    }
    const key = JSON.stringify([scopeKey(scope), input.responseId, generationId, hash(input.markdown)]);
    let requestReceipts = receipts.get(input.req);
    if (!requestReceipts) {
      requestReceipts = new Map();
      receipts.set(input.req, requestReceipts);
    }
    let receipt = requestReceipts.get(key);
    if (!receipt) {
      const [ocrState, quotationState] = await Promise.all([
        dependencies.ocr.readScopedConversationOcrState(scope),
        dependencies.quotation.readState(scope),
      ]);
      const replayTicket = quotationState?.tickets.find((entry) => entry.responseId === input.responseId && entry.acceptedRunId);
      const savedCompletion = replayTicket?.completionReceipt;
      if (savedCompletion && replayTicket && parseQuotationSignal(input.markdown) &&
        (!titles.has('system_order') || savedCompletion.inputHash === hash(input.markdown) ||
          savedCompletion.markdown === input.markdown)) {
        if (savedCompletion.inputHash !== hash(input.markdown) && savedCompletion.markdown !== input.markdown) {
          throw new SteelResponseCompletionError('invalid_completion_receipt');
        }
        if (!quotationState || quotationState.activeRun?.runId !== replayTicket.acceptedRunId ||
          quotationState.currentOrder?.sha256 !== replayTicket.orderHash ||
          quotationState.currentCustomer?.preparationId !== replayTicket.preparationId ||
          quotationState.currentCustomer?.customerIdentity !== replayTicket.customerIdentity ||
          quotationState.currentCustomer?.customerMarkdown !== replayTicket.customerMarkdown ||
          (!quotationState.activeRun?.ocrSelection && savedCompletion.ocrGeneration && (savedCompletion.ocrGeneration !== ocrState?.currentOcrResultGenerationId ||
            savedCompletion.ocrHash !== hash(ocrState?.currentOcrResultMarkdown ?? ''))) ||
          (savedCompletion.systemOrderHash && quotationState.currentSystemOrder?.runId !== replayTicket.acceptedRunId &&
            savedCompletion.systemOrderHash !== quotationState.currentSystemOrder?.sha256)) {
          throw new SteelResponseCompletionError('superseded_response');
        }
        const acceptedRun = await acceptQuotationSignal({ scope, response: savedCompletion.markdown,
          responseId: input.responseId, completionReceipt: savedCompletion,
          finishReason: 'stop', service: dependencies.quotation });
        requireSaved(acceptedRun, 'signal_not_accepted');
        await input.onPrepared?.(savedCompletion.markdown);
        let markdown = savedCompletion.markdown;
        let projectedSystemOrderHash: string | undefined;
        if (quotationState.activeRun?.status === 'completed') {
          const finalMarkdown = requireSaved(await dependencies.quotation.readCheckpoint({ scope,
            runId: quotationState.activeRun.runId, operationId: 'final' }), 'missing_quotation_result');
          const published = await publishCompletedQuotation({
            scope,
            run: quotationState.activeRun,
            markdown: finalMarkdown,
            service: dependencies.quotation,
            publishFinal: (publication) => persistQuotation(input, publication),
            projectFinal: async ({ markdown: publicMarkdown }) => {
              input.applyMarkdown(publicMarkdown);
            },
          });
          markdown = published.markdown;
          projectedSystemOrderHash = published.systemOrderHash;
          if (published.alreadyPublished) {
            await acceptPublishedResponse(input, scope);
            input.applyMarkdown(markdown);
          }
        } else {
          await persist(input, markdown, input.stage !== 'workflow');
        }
        const [publishedOcr, publishedState] = await Promise.all([
          dependencies.ocr.readScopedCurrentOcrResult(scope), dependencies.quotation.readState(scope),
        ]);
        const publication = Object.freeze({ scopeKey: scopeKey(scope), responseId: input.responseId,
          generationId, markdown,
          ocrGeneration: publishedOcr?.generationId,
          ocrHash: publishedOcr?.markdown ? hash(publishedOcr.markdown) : undefined,
          orderHash: publishedState?.currentOrder?.sha256,
          customerPreparationId: publishedState?.currentCustomer?.preparationId,
          runId: publishedState?.activeRun?.runId,
          ocrSelection: publishedState?.activeRun?.ocrSelection,
          systemOrderHash: projectedSystemOrderHash ?? publishedState?.currentSystemOrder?.sha256 });
        publications.add(publication);
        await verifyPublication(publication, scope, dependencies);
        return { markdown, acceptedRun, publication };
      }
      receipt = {
        scopeKey: scopeKey(scope), responseId: input.responseId, generationId,
        inputHash: hash(input.markdown), inputMarkdown: input.markdown,
        stage: input.stage ?? 'ui', canonicalMarkdown: input.markdown,
        expectedOcrGeneration: ocrState?.currentOcrResultGenerationId,
        expectedOcrSelection: context?.quotation?.state?.currentOrder?.ocrSelection ?? quotationState?.currentOrder?.ocrSelection,
        expectedOrderHash: quotationState?.currentOrder?.sha256,
        expectedCustomerPreparationId: context?.quotation?.state
          ? context.quotation.state.currentCustomer?.preparationId
          : quotationState?.currentCustomer?.preparationId,
      };
      if (titles.has('system_order')) {
        const savedOrder = await dependencies.quotation.readCurrentSystemOrder(scope);
        const sections = parseAssistantMarkdown(receipt.canonicalMarkdown).sections.filter((entry) => steelSectionTitle(entry.title) === 'system_order');
        const section = sections[0];
        if (sections.length !== 1 || !savedOrder || !section || !await dependencies.quotation.hasSystemOrder(scope) ||
          JSON.stringify(parseMarkdownTables(section.body)) !==
          JSON.stringify(parseMarkdownTables(savedOrder.markdown))) {
          throw new SteelResponseCompletionError('invalid_system_order');
        }
        receipt.systemOrderSnapshot = savedOrder;
        receipt.expectedSystemOrderHash = savedOrder.sha256;
        receipt.expectedSystemOrderRunId = savedOrder.runId;
      }
      if (titles.has('quote_signal')) {
        if (!parseQuotationSignal(input.markdown)) throw new SteelResponseCompletionError('invalid_quote_signal');
        const customer = quotationState?.currentCustomer?.customerMarkdown;
        if (!hasQuotationOrder(quotationState?.currentOrder?.markdown) ||
          !hasSteelCustomerTier(customer)) throw new SteelResponseCompletionError('quotation_data_required');
        if (input.stage !== 'workflow' && titles.has('system_order') &&
          (context?.quotation?.resume || [...requestReceipts.values()].some((entry) =>
            entry.scopeKey === scopeKey(scope) && entry.acceptedRun?.runId === quotationState?.activeRun?.runId))) {
          receipt.acceptedRun = quotationState?.activeRun;
        }
      }
      await input.onPrepared?.(receipt.canonicalMarkdown);
      requestReceipts.set(key, receipt);
    }
    if (receipt.scopeKey !== scopeKey(scope) || receipt.responseId !== input.responseId ||
      receipt.generationId !== generationId || receipt.inputHash !== hash(input.markdown)) {
      throw new SteelResponseCompletionError('invalid_completion_receipt');
    }
    let latest = await dependencies.quotation.readState(scope);
    if (receipt.expectedSystemOrderHash && (!await dependencies.quotation.hasSystemOrder(scope) ||
      (latest?.currentSystemOrder && latest.currentSystemOrder.runId === receipt.expectedSystemOrderRunId &&
        latest.currentSystemOrder.sha256 !== receipt.expectedSystemOrderHash) ||
      latest?.activeRun?.runId !== receipt.expectedSystemOrderRunId ||
      latest?.currentOrder?.sha256 !== receipt.expectedOrderHash ||
      latest?.currentCustomer?.preparationId !== receipt.expectedCustomerPreparationId)) {
      throw new SteelResponseCompletionError('superseded_response');
    }
    if (titles.has('quote_signal') && !receipt.acceptedRun) {
      if (!parseQuotationSignal(input.markdown)) throw new SteelResponseCompletionError('invalid_quote_signal');
      const expectedOrder = receipt.expectedOrderHash;
      const expectedCustomer = receipt.expectedCustomerPreparationId;
      if (latest?.currentOrder?.sha256 !== expectedOrder ||
        latest?.currentCustomer?.preparationId !== expectedCustomer) {
        throw new SteelResponseCompletionError('superseded_response');
      }
      const admittedOcrState = await dependencies.ocr.readScopedConversationOcrState(scope);
      receipt.acceptedRun = await acceptQuotationSignal({
        scope, response: input.markdown, responseId: input.responseId,
        messageId: context?.quotation?.messageId, service: dependencies.quotation,
        expectedOrderHash: latest?.currentOrder?.sha256,
        expectedCustomerPreparationId: latest?.currentCustomer?.preparationId, finishReason: 'stop',
        ocrSelection: receipt.expectedOcrSelection,
        sourceSnapshot: latest?.currentOrder?.sourceSnapshot ?? admittedSourceSnapshot(admittedOcrState, latest?.currentOrder?.sha256),
        completionReceipt: {
          inputHash: receipt.inputHash, markdown: receipt.canonicalMarkdown,
          ...(admittedOcrState?.currentOcrResultGenerationId ? { ocrGeneration: admittedOcrState.currentOcrResultGenerationId,
            ocrHash: hash(admittedOcrState.currentOcrResultMarkdown ?? '') } : {}),
          ...(latest?.currentSystemOrder ? { systemOrderHash: latest.currentSystemOrder.sha256 } : {}),
        },
      });
      requireSaved(receipt.acceptedRun, 'signal_not_accepted');
      latest = await dependencies.quotation.readState(scope);
    }
    const currentOcr = await dependencies.ocr.readScopedCurrentOcrResult(scope);
    receipt.latest = latest ?? undefined;
    const markdown = input.stage === 'workflow' || receipt.acceptedRun
      ? receipt.canonicalMarkdown : appendSteelNextStep({ markdown: receipt.canonicalMarkdown,
        order: currentOcr?.markdown, customer: latest?.currentCustomer?.customerMarkdown,
        completed: true, language: input.req.cookies?.lang || input.req.headers?.['accept-language']?.split(',')[0] || 'en' });
    if (input.stage !== 'workflow') await persistQuotationResponse(
      input, dependencies, markdown, latest, receipt.acceptedRun, true, receipt.systemOrderSnapshot,
    );
    const [publishedOcr, publishedState] = await Promise.all([
      dependencies.ocr.readScopedCurrentOcrResult(scope), dependencies.quotation.readState(scope),
    ]);
    if ((!latest?.activeRun?.ocrSelection && (publishedOcr?.generationId !== currentOcr?.generationId ||
      publishedOcr?.markdown !== currentOcr?.markdown)) ||
      !sameQuotationOcrSelection(publishedState?.activeRun?.ocrSelection, latest?.activeRun?.ocrSelection) ||
      publishedState?.currentOrder?.sha256 !== latest?.currentOrder?.sha256 ||
      publishedState?.currentCustomer?.preparationId !== latest?.currentCustomer?.preparationId ||
      publishedState?.activeRun?.runId !== latest?.activeRun?.runId ||
      publishedState?.currentSystemOrder?.sha256 !== latest?.currentSystemOrder?.sha256) {
      throw new SteelResponseCompletionError('superseded_response');
    }
    await input.assertActive?.();
    const publication: SteelMarkdownPublication = Object.freeze({
      scopeKey: scopeKey(scope), responseId: input.responseId, generationId, markdown,
      ocrGeneration: publishedOcr?.generationId, ocrHash: publishedOcr?.markdown ? hash(publishedOcr.markdown) : undefined,
      orderHash: publishedState?.currentOrder?.sha256, customerPreparationId: publishedState?.currentCustomer?.preparationId,
      runId: publishedState?.activeRun?.runId, ocrSelection: publishedState?.activeRun?.ocrSelection, systemOrderHash: publishedState?.currentSystemOrder?.sha256,
    });
    publications.add(publication);
    return { markdown, publication, ...(receipt.acceptedRun ? { acceptedRun: receipt.acceptedRun } : {}) };
  } catch (error) {
    if (error instanceof SteelResponseCompletionError) throw error;
    if (error instanceof SteelQuotationPublicationError) {
      throw new SteelResponseCompletionError(error.code);
    }
    throw new SteelResponseCompletionError('response_save_failed');
  }
}
