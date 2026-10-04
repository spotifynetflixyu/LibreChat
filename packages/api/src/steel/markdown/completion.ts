import { createHash } from 'node:crypto';
import type {
  ISteelConversationOcrState,
  ISteelQuotationState,
  SteelQuotationActiveRun,
  SteelQuotationScope,
  SteelQuotationSourceSnapshot,
} from '@librechat/data-schemas';
import type { PreparedQuotationCustomerResponse } from '../quotation/preparation';
import type { PreparedSystemOrderRevisionSuccess } from '../quotation/revision';
import type { SteelQuotationStateService } from '../quotation/state';
import type { SteelResponseRequest } from '../quotation/completion';
import type { SteelOcrResponseAuditService } from '../ocr/audit';
import type { SteelDelegateOcrStateService } from '../ocr/state';
import type { FinalizeOcrResponseSuccess } from '../ocr/result';
import { appendSteelNextStep, hasSteelDataMarkdown, hasSteelCustomerTier, steelSectionTitle } from '../quotation/next';
import { isUnfinishedQuotation, prepareQuotationCustomerResponse, hasQuotationOrder } from '../quotation/preparation';
import { acceptQuotationSignal, acceptQuotationResponse } from '../quotation/runner';
import { finalizeOcrResponse, parseAssistantMarkdown } from '../ocr/result';
import { createSystemOrderRevisionService } from '../quotation/revision';
import { SteelResponseCompletionError } from '../quotation/completion';
import { resolveRequestTenantId } from '../../middleware/tenant';
import { parseQuotationSignal } from '../quotation/protocol';
import { parseMarkdownTables } from './table';

export interface SteelMarkdownCompletionInput {
  req: SteelResponseRequest;
  responseId: string;
  generationId?: string;
  markdown: string;
  completed: boolean;
  stage?: 'workflow' | 'ui' | 'pending';
  applyMarkdown(markdown: string): void;
  persistMarkdown(options?: { completed: boolean }): Promise<object | null | undefined>;
  assertActive?(): Promise<void>;
  onPrepared?(markdown: string): Promise<void>;
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

interface CompletionReceipt {
  scopeKey: string;
  responseId: string;
  generationId: string;
  inputHash: string;
  inputMarkdown: string;
  stage: 'workflow' | 'ui' | 'pending';
  canonicalMarkdown: string;
  ocr?: FinalizeOcrResponseSuccess;
  preparedCustomer?: PreparedQuotationCustomerResponse;
  preparedRevision?: PreparedSystemOrderRevisionSuccess;
  expectedSystemOrderHash?: string;
  expectedSystemOrderRunId?: string;
  expectedOcrGeneration?: string;
  expectedOrderHash?: string;
  expectedCustomerPreparationId?: string;
  candidateToken?: string;
  candidateValidated?: boolean;
  ocrSaved?: boolean;
  orderSaved?: boolean;
  customerSaved?: boolean;
  customerPreparationId?: string;
  delegateCompleted?: boolean;
  revisionSaved?: boolean;
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

function canonicalPendingMarkdown(markdown: string): string {
  return parseAssistantMarkdown(markdown).segments.filter((segment) => segment.kind !== 'section' ||
    !['ocr_result_updates', 'ocr_deletions', 'system_order_updates'].includes(steelSectionTitle(segment.section.title)))
    .map((segment) => segment.kind === 'section' ? segment.section.raw : segment.text).join('').trimEnd();
}

function preserveStreamedMarkdown(original: string, canonical: string): string {
  return canonical.startsWith(original) ? canonical : `${original}\n\n${canonical}`;
}

async function verifyPublication(publication: SteelMarkdownPublication, scope: SteelQuotationScope, dependencies: SteelMarkdownCompletionDependencies): Promise<void> {
  const [ocr, state] = await Promise.all([dependencies.ocr.readCurrentOcrResult(scope.conversationId), dependencies.quotation.readState(scope)]);
  if (publication.scopeKey !== scopeKey(scope) || !publications.has(publication) ||
    publication.ocrGeneration !== ocr?.generationId || publication.ocrHash !== (ocr?.markdown ? hash(ocr.markdown) : undefined) ||
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
    !titles.has('ocr_result') && !titles.has('ocr_result_updates') &&
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
      await persist(input, input.markdown, true);
      await verifyPublication(publication, scope, dependencies);
      return { markdown: input.markdown, publication };
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
        dependencies.ocr.readConversationOcrState(scope.conversationId),
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
          (savedCompletion.ocrGeneration && (savedCompletion.ocrGeneration !== ocrState?.currentOcrResultGenerationId ||
            savedCompletion.ocrHash !== hash(ocrState?.currentOcrResultMarkdown ?? ''))) ||
          (savedCompletion.systemOrderHash && savedCompletion.systemOrderHash !== quotationState.currentSystemOrder?.sha256)) {
          throw new SteelResponseCompletionError('superseded_response');
        }
        const acceptedRun = await acceptQuotationSignal({ scope, response: savedCompletion.markdown,
          responseId: input.responseId, completionReceipt: savedCompletion,
          finishReason: 'stop', service: dependencies.quotation });
        requireSaved(acceptedRun, 'signal_not_accepted');
        await input.onPrepared?.(savedCompletion.markdown);
        let markdown = savedCompletion.markdown;
        if (quotationState.activeRun?.status === 'completed') {
          markdown = requireSaved(await dependencies.quotation.readCheckpoint({ scope,
            runId: quotationState.activeRun.runId, operationId: 'final' }), 'missing_quotation_result');
        }
        await persist(input, markdown, input.stage !== 'workflow');
        const publication = Object.freeze({ scopeKey: scopeKey(scope), responseId: input.responseId,
          generationId, markdown,
          ocrGeneration: ocrState?.currentOcrResultGenerationId,
          ocrHash: ocrState?.currentOcrResultMarkdown ? hash(ocrState.currentOcrResultMarkdown) : undefined,
          orderHash: quotationState.currentOrder?.sha256,
          customerPreparationId: quotationState.currentCustomer?.preparationId,
          runId: quotationState.activeRun?.runId, systemOrderHash: quotationState.currentSystemOrder?.sha256 });
        publications.add(publication);
        await verifyPublication(publication, scope, dependencies);
        return { markdown, acceptedRun, publication };
      }
      if (isUnfinishedQuotation(quotationState?.activeRun?.status) &&
        (titles.has('ocr_result') || titles.has('ocr_result_updates') || titles.has('customer_data'))) {
        const acceptedRun = await acceptQuotationResponse({
          scope, response: input.markdown, responseId: input.responseId,
          messageId: context?.quotation?.messageId, messageText: context?.quotation?.messageText,
          messageFiles: context?.quotation?.messageFiles,
          expectedOrderHash: context?.quotation?.state?.currentOrder?.sha256,
          expectedCustomerPreparationId: context?.quotation?.state?.currentCustomer?.preparationId,
          sourceSnapshot: admittedSourceSnapshot(ocrState, quotationState?.currentOrder?.sha256),
          finishReason: 'stop', service: dependencies.quotation,
        });
        if (acceptedRun) {
          await persist(input, input.markdown, input.stage !== 'workflow');
          return { markdown: input.markdown, acceptedRun };
        }
      }
      receipt = {
        scopeKey: scopeKey(scope), responseId: input.responseId, generationId,
        inputHash: hash(input.markdown), inputMarkdown: input.markdown,
        stage: input.stage ?? 'ui', canonicalMarkdown: input.markdown,
        expectedOcrGeneration: ocrState?.currentOcrResultGenerationId,
        expectedOrderHash: quotationState?.currentOrder?.sha256,
        expectedCustomerPreparationId: context?.quotation?.state
          ? context.quotation.state.currentCustomer?.preparationId
          : quotationState?.currentCustomer?.preparationId,
      };
      const hasOcr = titles.has('ocr_result') || titles.has('ocr_result_updates');
      if (hasOcr) {
        const delegate = context?.delegateOcrContext;
        const run = delegate?.activeRun ?? delegate?.delegateOcrRun;
        const workflow = delegate?.delegateOcrWorkflow ?? delegate;
        const trusted = workflow?.finalizedByBackend === true &&
          workflow.finalizedResponse?.finalResponse === input.markdown
          ? workflow.finalizedResponse : undefined;
        if (!trusted) {
          await dependencies.audit?.save({
            rawResponse: input.markdown, sourceStage: 'normal_request',
            userId: scope.userId, tenantId: scope.tenantId,
            conversationId: scope.conversationId, messageId: input.responseId, generationId,
            attemptNumber: run?.agentAttemptNumber ?? delegate?.agentAttemptNumber ?? 1,
            attemptId: run?.agentAttemptToken ?? delegate?.attemptToken,
            baseRevision: ocrState?.currentOcrResultGenerationId,
            baseResponse: ocrState?.currentOcrResultMarkdown ?? '',
          });
        }
        let agentKind: 'delegate_ocr' | 'regular_ocr' | 'other' = 'other';
        if (context?.ocrTurnActive) agentKind = 'regular_ocr';
        if (delegate?.didExecute || run) agentKind = 'delegate_ocr';
        const finalized = trusted ?? finalizeOcrResponse({
          assistantResponse: input.markdown,
          previousOcrMarkdown: ocrState?.currentOcrResultMarkdown,
          canonicalMapping: (ocrState?.sourceMappings ?? []).map(({ sourceCode, sourceFilename }) => ({ sourceCode, sourceFilename })),
          agentKind,
          delegateSummary: Boolean(delegate?.didExecute || run),
          currentUserTurn: delegate?.currentUserTurnText ?? context?.quotation?.messageText,
        });
        if (!finalized.ok) throw new SteelResponseCompletionError(finalized.reason);
        receipt.ocr = finalized;
        receipt.canonicalMarkdown = finalized.finalResponse;
        // Already-published pending/delegate results retain their durable generation and owner.
        if (ocrState?.currentOcrResultMarkdown === finalized.ocrResultMarkdown &&
          ocrState.currentOcrResultMessageId && (!run?.claimToken ||
            (ocrState.currentOcrResultGenerationId === generationId && ocrState.currentOcrResultMessageId === input.responseId))) {
          receipt.ocrSaved = true;
          receipt.expectedOcrGeneration = ocrState.currentOcrResultGenerationId;
        }
      }
      if (titles.has('customer_data')) {
        receipt.preparedCustomer = await prepareQuotationCustomerResponse({
          scope, response: receipt.canonicalMarkdown, responseId: input.responseId,
          messageId: context?.quotation?.messageId, messageText: context?.quotation?.messageText,
          messageFiles: context?.quotation?.messageFiles, service: dependencies.quotation,
          expectedOrderHash: receipt.expectedOrderHash,
          expectedCustomerPreparationId: receipt.expectedCustomerPreparationId, finishReason: 'stop',
        });
        requireSaved(receipt.preparedCustomer, 'customer_save_failed');
      }
      const revision = createSystemOrderRevisionService({ read: dependencies.quotation.readState,
        readCurrentSystemOrder: dependencies.quotation.readCurrentSystemOrder,
        readCheckpoint: dependencies.quotation.readCheckpoint, saveCurrentSystemOrder: dependencies.quotation.saveCurrentSystemOrder,
      });
      if (titles.has('system_order_updates')) {
        const prepared = await revision.prepareSystemOrderUpdates({ scope,
          response: receipt.canonicalMarkdown, responseId: input.responseId, messageId: input.responseId });
        if (!prepared.ok) throw new SteelResponseCompletionError(prepared.code);
        receipt.preparedRevision = prepared;
        receipt.canonicalMarkdown = input.stage === 'pending' ? prepared.markdown
          : preserveStreamedMarkdown(input.markdown, prepared.markdown);
      }
      if (titles.has('system_order')) {
        const savedOrder = await revision.readCurrentSystemOrder(scope);
        const sections = parseAssistantMarkdown(receipt.canonicalMarkdown).sections.filter((entry) => steelSectionTitle(entry.title) === 'system_order');
        const section = sections[0];
        if (sections.length !== 1 || !savedOrder || !section || !await dependencies.quotation.hasSystemOrder(scope) ||
          (receipt.ocr && receipt.ocr.ocrResultMarkdown !== quotationState?.currentOrder?.markdown) ||
          receipt.preparedCustomer?.kind === 'save' || JSON.stringify(parseMarkdownTables(section.body)) !==
          JSON.stringify(parseMarkdownTables(savedOrder.markdown))) {
          throw new SteelResponseCompletionError('invalid_system_order');
        }
        receipt.expectedSystemOrderHash = savedOrder.sha256;
        receipt.expectedSystemOrderRunId = savedOrder.runId;
      }
      if (titles.has('quote_signal')) {
        if (!parseQuotationSignal(input.markdown)) throw new SteelResponseCompletionError('invalid_quote_signal');
        let customer = quotationState?.currentCustomer?.customerMarkdown;
        if (receipt.preparedCustomer?.kind === 'save') customer = receipt.preparedCustomer.input.customerMarkdown;
        if (receipt.preparedCustomer?.kind === 'unchanged') customer = receipt.preparedCustomer.customer.customerMarkdown;
        if (!hasQuotationOrder(receipt.ocr?.ocrResultMarkdown ?? quotationState?.currentOrder?.markdown) ||
          !hasSteelCustomerTier(customer)) throw new SteelResponseCompletionError('quotation_data_required');
        if (input.stage !== 'workflow' && titles.has('system_order') &&
          (context?.quotation?.resume || [...requestReceipts.values()].some((entry) =>
            entry.scopeKey === scopeKey(scope) && entry.acceptedRun?.runId === quotationState?.activeRun?.runId))) {
          receipt.acceptedRun = quotationState?.activeRun;
        }
      }
      if (input.stage === 'pending') receipt.canonicalMarkdown = canonicalPendingMarkdown(receipt.canonicalMarkdown);
      await input.onPrepared?.(receipt.canonicalMarkdown);
      requestReceipts.set(key, receipt);
    }
    if (receipt.scopeKey !== scopeKey(scope) || receipt.responseId !== input.responseId ||
      receipt.generationId !== generationId || receipt.inputHash !== hash(input.markdown)) {
      throw new SteelResponseCompletionError('invalid_completion_receipt');
    }
    const delegate = context?.delegateOcrContext;
    const run = delegate?.activeRun ?? delegate?.delegateOcrRun;
    const claimToken = run?.claimToken ?? delegate?.claimToken;
    const executionLeaseToken = delegate?.delegateOcrExecutionLease?.executionLeaseToken ?? run?.executionLeaseToken;
    const delegateOcrIndex = run?.delegateOcrIndex ?? delegate?.delegateOcrIndex;
    const claim = { claimToken: claimToken ?? '', ...(executionLeaseToken ? { executionLeaseToken } : {}) };
    if (receipt.ocr && claimToken && !receipt.ocrSaved && !receipt.candidateToken) {
      const candidateToken = `${generationId}:${input.responseId}:${hash(receipt.canonicalMarkdown)}`;
      requireSaved(await dependencies.ocr.setDelegateFinalizedCandidate({
        ...claim, candidate: { token: candidateToken, markdown: receipt.canonicalMarkdown,
          source: 'backend', generationId, targetMessageId: input.responseId, createdAt: new Date() },
      }), 'stale_delegate_lease');
      receipt.candidateToken = candidateToken;
    }
    if (receipt.ocr && claimToken && receipt.candidateToken && !receipt.candidateValidated) {
      requireSaved(await dependencies.ocr.updateDelegateFinalizationJournal({
        ...claim, candidateToken: receipt.candidateToken,
        journal: { candidateValidated: true, candidateValidatedToken: receipt.candidateToken },
      }), 'stale_delegate_lease');
      receipt.candidateValidated = true;
    }
    // Save the complete merged message before canonical OCR points at its message id.
    await persist(input, receipt.canonicalMarkdown, false);
    if (receipt.ocr && !receipt.ocrSaved) {
      if (claimToken && receipt.candidateToken) {
        requireSaved(await dependencies.ocr.updateDelegateFinalizationJournal({
          ...claim, candidateToken: receipt.candidateToken,
          journal: { messagePersisted: true, messagePersistedToken: receipt.candidateToken },
        }), 'stale_delegate_lease');
      }
      await input.assertActive?.();
      requireSaved(await dependencies.ocr.upsertCurrentOcrResult({
        conversationId: scope.conversationId, generationId, attemptNumber: run?.agentAttemptNumber ?? delegate?.agentAttemptNumber ?? 1,
        markdown: receipt.ocr.ocrResultMarkdown, messageId: input.responseId,
        ...(claimToken ? { claimToken } : {}), ...(executionLeaseToken ? { executionLeaseToken } : {}),
        ...(delegateOcrIndex !== undefined ? { delegateOcrIndex } : {}),
        ...(receipt.expectedOcrGeneration ? { expectedGenerationId: receipt.expectedOcrGeneration } : {}),
      }), 'order_save_failed');
      receipt.ocrSaved = true;
      receipt.expectedOcrGeneration = generationId;
    }
    if (receipt.ocr && !receipt.orderSaved) {
      const currentOcr = await dependencies.ocr.readCurrentOcrResult(scope.conversationId);
      if (!currentOcr || currentOcr.generationId !== receipt.expectedOcrGeneration ||
        currentOcr.markdown !== receipt.ocr.ocrResultMarkdown) {
        throw new SteelResponseCompletionError('superseded_order');
      }
      const state = await dependencies.quotation.readState(scope);
      if (state?.currentOrder?.markdown !== receipt.ocr.ocrResultMarkdown) {
        if (state?.currentOrder?.sha256 !== receipt.expectedOrderHash) {
          throw new SteelResponseCompletionError('superseded_order');
        }
        await dependencies.quotation.setOrder({ scope, fullMarkdown: receipt.ocr.ocrResultMarkdown,
          revision: currentOcr.generationId, messageId: currentOcr.messageId,
          expectedOrderHash: receipt.expectedOrderHash ?? null });
      }
      receipt.orderSaved = true;
    }
    if (receipt.preparedCustomer && !receipt.customerSaved) {
      const current = await dependencies.quotation.readState(scope);
      const committedCustomer = receipt.preparedCustomer.kind === 'unchanged' ? receipt.preparedCustomer.customer
        : await dependencies.quotation.saveCustomer({ ...receipt.preparedCustomer.input,
          ...(current?.currentOrder?.sha256 ? { orderHash: current.currentOrder.sha256 } : {}) });
      receipt.customerPreparationId = requireSaved(committedCustomer, 'customer_save_failed').preparationId;
      receipt.customerSaved = true;
    }
    if (receipt.preparedRevision && !receipt.revisionSaved) {
      const result = await receipt.preparedRevision.commit();
      if (!result.ok) throw new SteelResponseCompletionError(result.code);
      receipt.revisionSaved = true;
    }
    if (receipt.ocr && claimToken && receipt.candidateToken && !receipt.delegateCompleted) {
      requireSaved(await dependencies.ocr.updateDelegateFinalizationJournal({ ...claim,
        candidateToken: receipt.candidateToken, journal: { resultPersisted: true, resultPersistedToken: receipt.candidateToken } }), 'stale_delegate_lease');
      requireSaved(await dependencies.ocr.transitionDelegateOcrRun({ ...claim, status: 'completed', currentStage: 'completed' }), 'stale_delegate_lease');
      if (delegateOcrIndex !== undefined) {
        requireSaved(await dependencies.ocr.clearCompletedDelegateClaim({ ...claim,
          conversationId: scope.conversationId, delegateOcrIndex }), 'stale_delegate_lease');
      }
      requireSaved(await dependencies.ocr.updateDelegateFinalizationJournal({ ...claim,
        candidateToken: receipt.candidateToken, journal: { claimCleared: true, claimClearedToken: receipt.candidateToken } }), 'stale_delegate_lease');
      receipt.delegateCompleted = true;
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
      const expectedOrder = receipt.ocr ? hash(receipt.ocr.ocrResultMarkdown) : receipt.expectedOrderHash;
      const expectedCustomer = receipt.customerPreparationId ?? receipt.expectedCustomerPreparationId;
      if (latest?.currentOrder?.sha256 !== expectedOrder ||
        latest?.currentCustomer?.preparationId !== expectedCustomer) {
        throw new SteelResponseCompletionError('superseded_response');
      }
      const admittedOcrState = receipt.ocr
        ? await dependencies.ocr.readConversationOcrState(scope.conversationId)
        : await dependencies.ocr.readConversationOcrState(scope.conversationId);
      receipt.acceptedRun = await acceptQuotationSignal({
        scope, response: input.markdown, responseId: input.responseId,
        messageId: context?.quotation?.messageId, service: dependencies.quotation,
        expectedOrderHash: latest?.currentOrder?.sha256,
        expectedCustomerPreparationId: latest?.currentCustomer?.preparationId, finishReason: 'stop',
        sourceSnapshot: admittedSourceSnapshot(admittedOcrState, latest?.currentOrder?.sha256),
        completionReceipt: {
          inputHash: receipt.inputHash, markdown: receipt.canonicalMarkdown,
          ...(receipt.ocr ? { ocrGeneration: receipt.expectedOcrGeneration,
            ocrHash: hash(receipt.ocr.ocrResultMarkdown) } : {}),
          ...(receipt.preparedRevision ? { systemOrderHash: latest?.currentSystemOrder?.sha256 } : {}),
        },
      });
      requireSaved(receipt.acceptedRun, 'signal_not_accepted');
      latest = await dependencies.quotation.readState(scope);
    }
    const currentOcr = await dependencies.ocr.readCurrentOcrResult(scope.conversationId);
    if (receipt.ocr && (!currentOcr || currentOcr.generationId !== receipt.expectedOcrGeneration ||
      currentOcr.markdown !== receipt.ocr.ocrResultMarkdown || latest?.currentOrder?.markdown !== currentOcr.markdown)) {
      throw new SteelResponseCompletionError('superseded_order');
    }
    if (receipt.customerSaved && receipt.customerPreparationId !== latest?.currentCustomer?.preparationId) {
      throw new SteelResponseCompletionError('superseded_customer');
    }
    receipt.latest = latest ?? undefined;
    const markdown = input.stage === 'workflow' || receipt.acceptedRun
      ? receipt.canonicalMarkdown : appendSteelNextStep({ markdown: receipt.canonicalMarkdown,
        order: currentOcr?.markdown, customer: latest?.currentCustomer?.customerMarkdown,
        completed: true, language: input.req.cookies?.lang || input.req.headers?.['accept-language']?.split(',')[0] || 'en' });
    if (input.stage !== 'workflow') await persist(input, markdown, true);
    const [publishedOcr, publishedState] = await Promise.all([
      dependencies.ocr.readCurrentOcrResult(scope.conversationId), dependencies.quotation.readState(scope),
    ]);
    if (publishedOcr?.generationId !== currentOcr?.generationId ||
      publishedOcr?.markdown !== currentOcr?.markdown ||
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
      runId: publishedState?.activeRun?.runId, systemOrderHash: publishedState?.currentSystemOrder?.sha256,
    });
    publications.add(publication);
    return { markdown, publication, ...(receipt.acceptedRun ? { acceptedRun: receipt.acceptedRun } : {}) };
  } catch (error) {
    if (error instanceof SteelResponseCompletionError) throw error;
    throw new SteelResponseCompletionError('response_save_failed');
  }
}
