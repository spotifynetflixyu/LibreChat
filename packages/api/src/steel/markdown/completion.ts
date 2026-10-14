import { createHash } from 'node:crypto';
import { hasConsistentMessageText } from '@librechat/data-schemas';
import {
  steelQuotationMessagePublicationSchema,
  steelSectionBaseTitle,
} from 'librechat-data-provider';
import type {
  ISteelConversationOcrState,
  ISteelQuotationState,
  SteelQuotationActiveRun,
  SteelQuotationCurrentSystemOrder,
  SteelQuotationScope,
  SteelQuotationSourceSnapshot,
  SteelQuotationOcrSelection,
} from '@librechat/data-schemas';
import type {
  SteelMarkdownCompletionInput,
  SteelMarkdownCompletionDependencies,
  SteelMarkdownCompletionResult,
  SteelMarkdownPublication,
  SteelPublishedResponseIdentity,
} from './types';
import type { SteelResponseRequest } from '../quotation/completion';
import {
  appendSteelNextStep,
  hasSteelDataMarkdown,
  hasSteelCustomerTier,
} from '../quotation/next';
import {
  acceptQuotationSignal,
  acceptQuotationResponse,
  SteelQuotationPublicationError,
} from '../quotation/runner';
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
  expectedOcrGeneration?: string;
  expectedOcrSelection?: SteelQuotationOcrSelection;
  expectedOrderHash?: string;
  expectedCustomerPreparationId?: string;
  acceptedRun?: SteelQuotationActiveRun;
  latest?: ISteelQuotationState;
}

/** Receipts belong to the server request, never to model output or a caller's boolean. */
const receipts = new WeakMap<SteelResponseRequest, Map<string, CompletionReceipt>>();
const publications = new WeakSet<SteelMarkdownPublication>();
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function admittedSourceSnapshot(
  ocrState:
    | Pick<
        ISteelConversationOcrState,
        | 'currentOcrResultGenerationId'
        | 'currentOcrResultMessageId'
        | 'currentOcrResultMarkdown'
        | 'sourceMappings'
      >
    | null
    | undefined,
  orderHash: string | undefined,
): SteelQuotationSourceSnapshot | undefined {
  if (
    !ocrState?.currentOcrResultGenerationId ||
    !ocrState.currentOcrResultMarkdown ||
    !orderHash ||
    hash(ocrState.currentOcrResultMarkdown) !== orderHash
  ) {
    return undefined;
  }
  return {
    orderHash,
    generationId: ocrState.currentOcrResultGenerationId,
    ...(ocrState.currentOcrResultMessageId
      ? { resultMessageId: ocrState.currentOcrResultMessageId }
      : {}),
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
  return new Set(
    parseAssistantMarkdown(markdown).sections.map((entry) => steelSectionBaseTitle(entry.title)),
  );
}

/** The finalizer owns all terminal Steel message persistence, including unfinished responses. */
export function shouldDeferSteelMarkdownPersistence(
  req: SteelResponseRequest,
  _markdown?: string,
): boolean {
  return Boolean(req.steelNativeContext?.quotation?.scope);
}

async function verifyPublication(
  publication: SteelMarkdownPublication,
  scope: SteelQuotationScope,
  dependencies: SteelMarkdownCompletionDependencies,
): Promise<void> {
  const [ocr, state] = await Promise.all([
    dependencies.ocr.readScopedCurrentOcrResult(scope),
    dependencies.quotation.readState(scope),
  ]);
  if (
    publication.scopeKey !== scopeKey(scope) ||
    !publications.has(publication) ||
    (publication.ocrSelection
      ? !sameQuotationOcrSelection(publication.ocrSelection, state?.activeRun?.ocrSelection)
      : publication.ocrGeneration !== ocr?.generationId ||
        publication.ocrHash !== (ocr?.markdown ? hash(ocr.markdown) : undefined)) ||
    publication.orderHash !== state?.currentOrder?.sha256 ||
    publication.customerPreparationId !== state?.currentCustomer?.preparationId ||
    publication.runId !== state?.activeRun?.runId ||
    publication.systemOrderHash !== state?.currentSystemOrder?.sha256
  ) {
    throw new SteelResponseCompletionError('superseded_response');
  }
}

function requireSaved<T>(value: T | null | undefined, code: string): T {
  if (!value) throw new SteelResponseCompletionError(code);
  return value;
}

async function persist(
  input: SteelMarkdownCompletionInput,
  markdown: string,
  completed = input.completed,
): Promise<void> {
  await input.assertActive?.();
  input.applyMarkdown(markdown);
  requireSaved(await input.persistMarkdown({ completed }), 'response_save_failed');
}

async function acceptPublishedResponse(
  input: SteelMarkdownCompletionInput,
  scope: SteelQuotationScope,
  responseId = input.responseId,
): Promise<SteelPublishedResponseIdentity | undefined> {
  if (!input.publishedResponse) return;
  let record: SteelPublishedResponseIdentity | null | undefined;
  try {
    record = await input.publishedResponse.load({
      responseId,
      conversationId: scope.conversationId,
      userId: scope.userId,
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
    });
  } catch {
    throw new SteelResponseCompletionError('response_save_failed');
  }
  if (
    !record ||
    record.messageId !== responseId ||
    record.conversationId !== scope.conversationId ||
    record.user !== scope.userId ||
    record.tenantId !== scope.tenantId
  ) {
    throw new SteelResponseCompletionError('response_save_failed');
  }
  const persisted = await appendPublishedResponseErrors(input, record);
  input.publishedResponse.accept(persisted);
  await input.onPublishedResponse?.(persisted);
  return persisted;
}

async function appendPublishedResponseErrors(
  input: SteelMarkdownCompletionInput,
  record: SteelPublishedResponseIdentity,
): Promise<SteelPublishedResponseIdentity> {
  if (!input.publishedResponse?.appendErrors) return record;
  let persisted: SteelPublishedResponseIdentity | null | undefined;
  try {
    persisted = await input.publishedResponse.appendErrors(record);
  } catch {
    throw new SteelResponseCompletionError('response_save_failed');
  }
  if (!persisted) throw new SteelResponseCompletionError('superseded_response');
  if (persisted.messageId !== record.messageId || persisted.conversationId !== record.conversationId ||
    persisted.user !== record.user || persisted.tenantId !== record.tenantId) {
    throw new SteelResponseCompletionError('response_save_failed');
  }
  return persisted;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function ownerMatchesCanonicalOrder(
  record: SteelPublishedResponseIdentity,
  outputId: string,
  targetMessageId: string,
  systemOrderSha256: string,
): boolean {
  const metadata = objectRecord(record.metadata);
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, 'steelMarkdownOwners')) return false;
  const owners = objectRecord(metadata.steelMarkdownOwners);
  if (!owners || !Object.prototype.hasOwnProperty.call(owners, 'system_order')) return false;
  const owner = objectRecord(owners.system_order);
  if (!owner) return false;
  return Boolean(
    owner.kind === 'system_order' &&
      owner.source === 'ai' &&
      owner.outputId === outputId &&
      owner.messageId === targetMessageId &&
      owner.sha256 === systemOrderSha256,
  );
}

function canonicalSystemOrderMatches(
  text: string | undefined,
  systemOrder: SteelQuotationCurrentSystemOrder,
): boolean {
  if (typeof text !== 'string') return false;
  const saved = parseAssistantMarkdown(systemOrder.markdown).sections.filter(
    (section) => steelSectionBaseTitle(section.title) === 'system_order',
  );
  const loadedDocument = parseAssistantMarkdown(text);
  const loaded = loadedDocument.sections.filter(
    (section) => steelSectionBaseTitle(section.title) === 'system_order',
  );
  if (saved.length !== 1 || loaded.length !== 1) return false;
  const savedSection = saved[0];
  const loadedSection = loaded[0];
  return Boolean(
    savedSection &&
      loadedSection &&
      savedSection.title === loadedSection.title &&
      JSON.stringify(parseMarkdownTables(savedSection.body)) ===
        JSON.stringify(parseMarkdownTables(loadedSection.body)) &&
      savedSection.raw.trim() === loadedSection.raw.trim(),
  );
}

async function adoptPublishedQuotationOrder(
  input: SteelMarkdownCompletionInput,
  dependencies: SteelMarkdownCompletionDependencies,
  scope: SteelQuotationScope,
  generationId: string,
): Promise<SteelMarkdownCompletionResult | undefined> {
  if (input.stage === 'workflow' || !input.publishedResponse) return undefined;
  const quotation = input.req.steelNativeContext?.quotation;
  const admission = quotation?.publicationAdmission;
  if (
    !admission ||
    admission.responseId !== input.responseId ||
    admission.generationId !== generationId
  ) {
    return undefined;
  }

  let state: ISteelQuotationState | null | undefined;
  try {
    state = await dependencies.quotation.readState(scope);
  } catch {
    throw new SteelResponseCompletionError('response_save_failed');
  }
  const run = state?.activeRun;
  const systemOrder = state?.currentSystemOrder;
  if (!state || !run || run.status !== 'completed' || !systemOrder) return undefined;
  if (systemOrder.responseId !== input.responseId) return undefined;
  const owner = state.markdownPublication?.current?.system_order;
  const currentAdmission = state.markdownPublication?.admission;
  if (!owner || !systemOrder.messageId || !run.targetMessageId ||
    !currentAdmission || currentAdmission.responseId !== admission.responseId ||
    currentAdmission.generationId !== admission.generationId || currentAdmission.sequence !== admission.sequence ||
    currentAdmission.lineageId !== admission.lineageId ||
    JSON.stringify(currentAdmission.expected) !== JSON.stringify(admission.expected) ||
    systemOrder.runId !== run.runId || systemOrder.messageId !== run.targetMessageId ||
    owner?.ai.messageId !== run.targetMessageId || owner.effective.messageId !== run.targetMessageId ||
    owner.effective.sha256 !== systemOrder.sha256 ||
    !sameQuotationOcrSelection(run.ocrSelection, systemOrder.ocrSelection) ||
    (quotation.resume && quotation.state?.activeRun?.runId !== run.runId)) {
    throw new SteelResponseCompletionError('superseded_response');
  }
  let record: SteelPublishedResponseIdentity | null | undefined;
  try {
    record = await input.publishedResponse.load({
      responseId: systemOrder.messageId,
      conversationId: scope.conversationId,
      userId: scope.userId,
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
    });
  } catch {
    throw new SteelResponseCompletionError('response_save_failed');
  }
  const savedText = record?.text;
  const publication = steelQuotationMessagePublicationSchema.safeParse(record?.metadata?.steelQuotation);
  const tablePart = publication.success
    ? objectRecord(record?.content?.[publication.data.tableContentIndex])
    : undefined;
  const tableText = tablePart?.type === 'text' && typeof tablePart.text === 'string'
    ? tablePart.text
    : undefined;
  const receiptRef = run.checkpointRefs.find((ref) => ref.operationId === 'order-published');
  if (!publication.success || publication.data.sourceMessageId !== input.responseId ||
    publication.data.admissionSequence !== admission.sequence ||
    publication.data.runId !== run.runId ||
    publication.data.outputId !== owner.ai.outputId ||
    publication.data.receiptSha256 !== receiptRef?.sha256) {
    throw new SteelResponseCompletionError('superseded_response');
  }
  if (
    !record ||
    !savedText ||
    record.messageId !== systemOrder.messageId ||
    record.conversationId !== scope.conversationId ||
    record.user !== scope.userId ||
    record.tenantId !== scope.tenantId ||
    !hasConsistentMessageText({
      text: record.text, content: record.content, metadata: record.metadata ?? undefined,
    }) ||
    !canonicalSystemOrderMatches(tableText, systemOrder) ||
    !ownerMatchesCanonicalOrder(
      record,
      owner.ai.outputId,
      systemOrder.messageId,
      owner.ai.sha256,
    )
  ) {
    throw new SteelResponseCompletionError('superseded_response');
  }

  const persisted = await appendPublishedResponseErrors(input, record);
  input.publishedResponse.accept(persisted);
  await input.onPublishedResponse?.(persisted);
  return { markdown: persisted.text ?? savedText, acceptedRun: run };
}

export function createSteelMarkdownCompletionServices(
  dependencies: SteelMarkdownCompletionDependencies,
): {
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
  if (!scope) {
    await persist(input, input.markdown);
    return { markdown: input.markdown };
  }
  if (scope.userId !== input.req.user?.id || scope.tenantId !== resolveRequestTenantId(input.req)) {
    throw new SteelResponseCompletionError('invalid_response_scope');
  }
  const generationId = input.generationId ?? context?.requestId ?? input.responseId;
  const recovered = await adoptPublishedQuotationOrder(input, dependencies, scope, generationId);
  if (recovered) return recovered;
  if (!input.completed) {
    await persist(input, input.markdown);
    return { markdown: input.markdown };
  }
  if (
    parseAssistantMarkdown(input.markdown).sections.some((section) =>
      retiredMarkdownSectionTitles.some((title) => title === steelSectionBaseTitle(section.title)),
    )
  ) {
    throw new SteelResponseCompletionError('retired_control_section');
  }
  if (
    parseQuotationSignal(input.markdown) &&
    ['ocr_result', 'system_order', 'customer_data'].some((kind) =>
      sectionTitles(input.markdown).has(kind),
    )
  ) {
    throw new SteelResponseCompletionError('invalid_quote_signal');
  }
  const titles = sectionTitles(input.markdown);
  if (titles.has('system_order')) throw new SteelResponseCompletionError('invalid_system_order');
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
  if (
    (context?.ocrTurnActive || context?.delegateOcrContext?.didExecute) &&
    !titles.has('ocr_result') &&
    !titles.has('system_order') &&
    !titles.has('quote_signal')
  ) {
    throw new SteelResponseCompletionError('missing_ocr_result');
  }
  if (
    !hasSteelDataMarkdown(input.markdown) &&
    !titles.has('quote_signal')
  ) {
    await persist(input, input.markdown);
    return { markdown: input.markdown };
  }
  try {
    await input.assertActive?.();
    if (
      ['ocr_result', 'customer_data', 'system_order'].some((title) => titles.has(title)) &&
      !parseQuotationSignal(input.markdown) &&
      (!context?.quotation?.resume || titles.has('ocr_result') || titles.has('customer_data'))
    ) {
      const state = await dependencies.quotation.readState(scope);
      if (isUnfinishedQuotation(state?.activeRun?.status)) {
        const acceptedRun = await acceptQuotationResponse({
          scope,
          response: input.markdown,
          responseId: input.responseId,
          runtimeRulesClient: dependencies.runtimeRulesClient,
          messageId: context?.quotation?.messageId,
          messageText: context?.quotation?.messageText,
          messageFiles: context?.quotation?.messageFiles,
          expectedOrderHash: context?.quotation?.state?.currentOrder?.sha256,
          expectedCustomerPreparationId: context?.quotation?.state?.currentCustomer?.preparationId,
          finishReason: 'stop',
          service: dependencies.quotation,
        });
        if (!acceptedRun) throw new SteelResponseCompletionError('superseded_response');
        await persist(input, input.markdown, input.stage !== 'workflow');
        return { markdown: input.markdown, acceptedRun };
      }
      const markdown = await publishFullMarkdown(input, dependencies);
      const [ocr, latest] = await Promise.all([
        dependencies.ocr.readScopedCurrentOcrResult(scope),
        dependencies.quotation.readState(scope),
      ]);
      const publication: SteelMarkdownPublication = Object.freeze({
        scopeKey: scopeKey(scope),
        responseId: input.responseId,
        generationId,
        markdown,
        ocrGeneration: ocr?.generationId,
        ocrHash: ocr?.markdown ? hash(ocr.markdown) : undefined,
        orderHash: latest?.currentOrder?.sha256,
        customerPreparationId: latest?.currentCustomer?.preparationId,
        runId: latest?.activeRun?.runId,
        ocrSelection: latest?.activeRun?.ocrSelection,
        systemOrderHash: latest?.currentSystemOrder?.sha256,
      });
      publications.add(publication);
      return { markdown, publication };
    }
    const key = JSON.stringify([
      scopeKey(scope),
      input.responseId,
      generationId,
      hash(input.markdown),
    ]);
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
      const replayTicket = quotationState?.tickets.find(
        (entry) => entry.responseId === input.responseId && entry.acceptedRunId,
      );
      const savedCompletion = replayTicket?.completionReceipt;
      if (
        savedCompletion &&
        replayTicket &&
        parseQuotationSignal(input.markdown) &&
        (!titles.has('system_order') ||
          savedCompletion.inputHash === hash(input.markdown) ||
          savedCompletion.markdown === input.markdown)
      ) {
        if (
          savedCompletion.inputHash !== hash(input.markdown) &&
          savedCompletion.markdown !== input.markdown
        ) {
          throw new SteelResponseCompletionError('invalid_completion_receipt');
        }
        if (
          !quotationState ||
          quotationState.activeRun?.runId !== replayTicket.acceptedRunId ||
          quotationState.currentOrder?.sha256 !== replayTicket.orderHash ||
          quotationState.currentCustomer?.preparationId !== replayTicket.preparationId ||
          quotationState.currentCustomer?.customerIdentity !== replayTicket.customerIdentity ||
          quotationState.currentCustomer?.customerMarkdown !== replayTicket.customerMarkdown ||
          (!quotationState.activeRun?.ocrSelection &&
            savedCompletion.ocrGeneration &&
            (savedCompletion.ocrGeneration !== ocrState?.currentOcrResultGenerationId ||
              savedCompletion.ocrHash !== hash(ocrState?.currentOcrResultMarkdown ?? ''))) ||
          (savedCompletion.systemOrderHash &&
            quotationState.currentSystemOrder?.runId !== replayTicket.acceptedRunId &&
            savedCompletion.systemOrderHash !== quotationState.currentSystemOrder?.sha256)
        ) {
          throw new SteelResponseCompletionError('superseded_response');
        }
        const acceptedRun = await acceptQuotationSignal({
          scope,
          response: savedCompletion.markdown,
          runtimeRulesClient: dependencies.runtimeRulesClient,
          responseId: input.responseId,
          completionReceipt: savedCompletion,
          finishReason: 'stop',
          service: dependencies.quotation,
        });
        requireSaved(acceptedRun, 'signal_not_accepted');
        await input.onPrepared?.(savedCompletion.markdown);
        let markdown = savedCompletion.markdown;
        let projectedSystemOrderHash: string | undefined;
        if (quotationState.activeRun?.status === 'completed') {
          if (!await dependencies.quotation.isPublishedRun(scope, quotationState.activeRun)) {
            throw new SteelResponseCompletionError('missing_quotation_result');
          }
          const savedOrder = requireSaved(quotationState.currentSystemOrder, 'missing_quotation_result');
          const targetMessageId = requireSaved(savedOrder.messageId, 'missing_quotation_result');
          const record = await acceptPublishedResponse(input, scope, targetMessageId);
          markdown = record?.text ?? savedOrder.markdown;
          projectedSystemOrderHash = savedOrder.sha256;
          input.applyMarkdown(markdown);
        } else {
          await persist(input, markdown, input.stage !== 'workflow');
        }
        const [publishedOcr, publishedState] = await Promise.all([
          dependencies.ocr.readScopedCurrentOcrResult(scope),
          dependencies.quotation.readState(scope),
        ]);
        const publication = Object.freeze({
          scopeKey: scopeKey(scope),
          responseId: input.responseId,
          generationId,
          markdown,
          ocrGeneration: publishedOcr?.generationId,
          ocrHash: publishedOcr?.markdown ? hash(publishedOcr.markdown) : undefined,
          orderHash: publishedState?.currentOrder?.sha256,
          customerPreparationId: publishedState?.currentCustomer?.preparationId,
          runId: publishedState?.activeRun?.runId,
          ocrSelection: publishedState?.activeRun?.ocrSelection,
          systemOrderHash: projectedSystemOrderHash ?? publishedState?.currentSystemOrder?.sha256,
        });
        publications.add(publication);
        await verifyPublication(publication, scope, dependencies);
        return { markdown, acceptedRun, publication };
      }
      receipt = {
        scopeKey: scopeKey(scope),
        responseId: input.responseId,
        generationId,
        inputHash: hash(input.markdown),
        inputMarkdown: input.markdown,
        stage: input.stage ?? 'ui',
        canonicalMarkdown: input.markdown,
        expectedOcrGeneration: ocrState?.currentOcrResultGenerationId,
        expectedOcrSelection:
          context?.quotation?.state?.currentOrder?.ocrSelection ??
          quotationState?.currentOrder?.ocrSelection,
        expectedOrderHash: quotationState?.currentOrder?.sha256,
        expectedCustomerPreparationId: context?.quotation?.state
          ? context.quotation.state.currentCustomer?.preparationId
          : quotationState?.currentCustomer?.preparationId,
      };
      if (titles.has('quote_signal')) {
        if (!parseQuotationSignal(input.markdown))
          throw new SteelResponseCompletionError('invalid_quote_signal');
        const customer = quotationState?.currentCustomer?.customerMarkdown;
        if (
          !hasQuotationOrder(quotationState?.currentOrder?.markdown) ||
          !hasSteelCustomerTier(customer)
        )
          throw new SteelResponseCompletionError('quotation_data_required');
      }
      await input.onPrepared?.(receipt.canonicalMarkdown);
      requestReceipts.set(key, receipt);
    }
    if (
      receipt.scopeKey !== scopeKey(scope) ||
      receipt.responseId !== input.responseId ||
      receipt.generationId !== generationId ||
      receipt.inputHash !== hash(input.markdown)
    ) {
      throw new SteelResponseCompletionError('invalid_completion_receipt');
    }
    let latest = await dependencies.quotation.readState(scope);
    if (titles.has('quote_signal') && !receipt.acceptedRun) {
      if (!parseQuotationSignal(input.markdown))
        throw new SteelResponseCompletionError('invalid_quote_signal');
      const expectedOrder = receipt.expectedOrderHash;
      const expectedCustomer = receipt.expectedCustomerPreparationId;
      if (
        latest?.currentOrder?.sha256 !== expectedOrder ||
        latest?.currentCustomer?.preparationId !== expectedCustomer
      ) {
        throw new SteelResponseCompletionError('superseded_response');
      }
      const admittedOcrState = await dependencies.ocr.readScopedConversationOcrState(scope);
      receipt.acceptedRun = await acceptQuotationSignal({
        runtimeRulesClient: dependencies.runtimeRulesClient,
        scope,
        response: input.markdown,
        responseId: input.responseId,
        messageId: context?.quotation?.messageId,
        service: dependencies.quotation,
        expectedOrderHash: latest?.currentOrder?.sha256,
        expectedCustomerPreparationId: latest?.currentCustomer?.preparationId,
        finishReason: 'stop',
        ocrSelection: receipt.expectedOcrSelection,
        sourceSnapshot:
          latest?.currentOrder?.sourceSnapshot ??
          admittedSourceSnapshot(admittedOcrState, latest?.currentOrder?.sha256),
        completionReceipt: {
          inputHash: receipt.inputHash,
          markdown: receipt.canonicalMarkdown,
          ...(admittedOcrState?.currentOcrResultGenerationId
            ? {
                ocrGeneration: admittedOcrState.currentOcrResultGenerationId,
                ocrHash: hash(admittedOcrState.currentOcrResultMarkdown ?? ''),
              }
            : {}),
          ...(latest?.currentSystemOrder
            ? { systemOrderHash: latest.currentSystemOrder.sha256 }
            : {}),
        },
      });
      requireSaved(receipt.acceptedRun, 'signal_not_accepted');
      latest = await dependencies.quotation.readState(scope);
    }
    const currentOcr = await dependencies.ocr.readScopedCurrentOcrResult(scope);
    receipt.latest = latest ?? undefined;
    const markdown =
      input.stage === 'workflow' || receipt.acceptedRun
        ? receipt.canonicalMarkdown
        : appendSteelNextStep({
            markdown: receipt.canonicalMarkdown,
            order: currentOcr?.markdown,
            customer: latest?.currentCustomer?.customerMarkdown,
            completed: true,
            language:
              input.req.cookies?.lang ||
              input.req.headers?.['accept-language']?.split(',')[0] ||
              'en',
          });
    if (input.stage !== 'workflow') await persist(input, markdown);
    const [publishedOcr, publishedState] = await Promise.all([
      dependencies.ocr.readScopedCurrentOcrResult(scope),
      dependencies.quotation.readState(scope),
    ]);
    if (
      (!latest?.activeRun?.ocrSelection &&
        (publishedOcr?.generationId !== currentOcr?.generationId ||
          publishedOcr?.markdown !== currentOcr?.markdown)) ||
      !sameQuotationOcrSelection(
        publishedState?.activeRun?.ocrSelection,
        latest?.activeRun?.ocrSelection,
      ) ||
      publishedState?.currentOrder?.sha256 !== latest?.currentOrder?.sha256 ||
      publishedState?.currentCustomer?.preparationId !== latest?.currentCustomer?.preparationId ||
      publishedState?.activeRun?.runId !== latest?.activeRun?.runId ||
      publishedState?.currentSystemOrder?.sha256 !== latest?.currentSystemOrder?.sha256
    ) {
      throw new SteelResponseCompletionError('superseded_response');
    }
    await input.assertActive?.();
    const publication: SteelMarkdownPublication = Object.freeze({
      scopeKey: scopeKey(scope),
      responseId: input.responseId,
      generationId,
      markdown,
      ocrGeneration: publishedOcr?.generationId,
      ocrHash: publishedOcr?.markdown ? hash(publishedOcr.markdown) : undefined,
      orderHash: publishedState?.currentOrder?.sha256,
      customerPreparationId: publishedState?.currentCustomer?.preparationId,
      runId: publishedState?.activeRun?.runId,
      ocrSelection: publishedState?.activeRun?.ocrSelection,
      systemOrderHash: publishedState?.currentSystemOrder?.sha256,
    });
    publications.add(publication);
    return {
      markdown,
      publication,
      ...(receipt.acceptedRun ? { acceptedRun: receipt.acceptedRun } : {}),
    };
  } catch (error) {
    if (error instanceof SteelResponseCompletionError) throw error;
    if (error instanceof SteelQuotationPublicationError) {
      throw new SteelResponseCompletionError(error.code);
    }
    throw new SteelResponseCompletionError('response_save_failed');
  }
}
