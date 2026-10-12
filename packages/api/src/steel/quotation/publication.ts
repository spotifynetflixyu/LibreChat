import { z } from 'zod';
import { createHash } from 'node:crypto';
import { parseSteelReviewMarkdownTables } from 'librechat-data-provider';
import type {
  ISteelQuotationState,
  SteelQuotationActiveRun,
  SteelQuotationCurrentSystemOrder,
  SteelQuotationOrderPublicationReceipt,
  SteelQuotationPublicationMessage,
  SteelQuotationPublicationProof,
  SteelQuotationPublicationSaveContext,
  SteelQuotationPublicationSaveResult,
  SteelQuotationSavedMessage,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import type { ResponseAggregator } from '../../agents/responses/service';
import type { ResponseTracker } from '../../agents/responses/handlers';
import type { OutputItem } from '../../agents/responses/types';
import type { SteelQuotationStateService } from './state';
import { normalizeSystemOrderMarkdown, systemOrderColumns } from '../markdown/order';
import { canonicalizeSystemOrderMarkdown } from './revision';
import { createSteelReviewBaselineRows } from '../review';
import { parseMarkdownTables } from '../markdown/table';
import { parseAssistantMarkdown } from '../ocr/result';
import { sameQuotationOcrSelection } from './input';

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const orderPublicationReceiptSchema = z
  .object({
    version: z.literal(1),
    runId: z.string().min(1),
    targetMessageId: z.string().min(1),
    outputId: z.string().min(1),
    inputSnapshotSha256: sha256,
    normalizedSha256: sha256,
    systemOrderSha256: sha256,
  })
  .strict();
const legacyPublicationReceiptSchema = z
  .object({ finalSha256: sha256 })
  .strict();
const markdownReferenceSchema = z.object({
  kind: z.enum(['ocr_result', 'system_order', 'customer_data']),
  source: z.enum(['ai', 'human']),
  snapshotId: z.string(),
  generationId: z.string(),
  outputId: z.string(),
  messageId: z.string(),
  title: z.string(),
  revision: z.string(),
  sha256,
  lineageId: z.string(),
  version: z.number().int().positive().optional(),
  savedAt: z.coerce.date(),
  operationId: z.string().optional(),
});
const ocrSelectionSchema = z.object({
  candidates: z.object({
    ai: markdownReferenceSchema.optional(),
    human: markdownReferenceSchema.optional(),
  }),
  selected: markdownReferenceSchema,
  version: z.number().int().positive(),
});
export type PublishedQuotationOrderRead =
  | { status: 'absent' }
  | { status: 'invalid' }
  | {
      status: 'published';
      value: {
        state: ISteelQuotationState;
        run: SteelQuotationActiveRun;
        systemOrder: SteelQuotationCurrentSystemOrder;
        receipt: SteelQuotationOrderPublicationReceipt | { legacy: true; finalSha256: string };
      };
    };

export async function readPublishedQuotationOrder(input: {
  scope: SteelQuotationScope;
  service: Pick<SteelQuotationStateService, 'readState' | 'getArtifact' | 'isPublishedRun'>;
}): Promise<PublishedQuotationOrderRead> {
  const state = await input.service.readState(input.scope);
  const run = state?.activeRun;
  const systemOrder = state?.currentSystemOrder;
  const publicationRef = run?.checkpointRefs.find(
    (ref) => ref.operationId === 'order-published' && ref.kind === 'main',
  );
  const hasPublicationMarker = run?.checkpointRefs.some((ref) => ref.operationId === 'order-published') ?? false;
  const normalizedRef = run?.checkpointRefs.find(
    (ref) => ref.operationId === 'system-order:normalized' && ref.kind === 'main',
  );
  if (!state || !run) return { status: 'absent' };
  if (!hasPublicationMarker) {
    const legacyPublicationRef = run.checkpointRefs.find(
      (ref) => ref.operationId === 'published' && ref.kind === 'final',
    );
    const legacyFinalRef = run.checkpointRefs.find(
      (ref) => ref.operationId === 'final' && ref.kind === 'final',
    );
    if (!legacyPublicationRef && !legacyFinalRef) return { status: 'absent' };
    if (
      !systemOrder ||
      !legacyPublicationRef ||
      !legacyFinalRef ||
      run.status !== 'completed' ||
      !run.targetMessageId ||
      systemOrder.runId !== run.runId ||
      systemOrder.messageId !== run.targetMessageId
    ) {
      return { status: 'invalid' };
    }
    if (!(await input.service.isPublishedRun(input.scope, run))) return { status: 'invalid' };
    const [legacyPublication, legacyFinal] = await Promise.all([
      input.service.getArtifact({ scope: input.scope, runId: run.runId, operationId: 'published' }),
      input.service.getArtifact({ scope: input.scope, runId: run.runId, operationId: 'final' }),
    ]);
    if (
      !legacyPublication ||
      legacyPublication.kind !== 'final' ||
      legacyPublication.sha256 !== legacyPublicationRef.sha256 ||
      hash(legacyPublication.payload) !== legacyPublication.sha256 ||
      !legacyFinal ||
      legacyFinal.kind !== 'final' ||
      legacyFinal.sha256 !== legacyFinalRef.sha256 ||
      hash(legacyFinal.payload) !== legacyFinal.sha256
    ) {
      return { status: 'invalid' };
    }
    try {
      const receipt = legacyPublicationReceiptSchema.safeParse(JSON.parse(legacyPublication.payload));
      if (!receipt.success || receipt.data.finalSha256 !== legacyFinal.sha256) return { status: 'invalid' };
      const canonical = canonicalizeSystemOrderMarkdown(
        normalizeSystemOrderMarkdown(systemOrder.markdown),
      );
      const table = parseMarkdownTables(canonical?.markdown ?? '')[0];
      if (
        !canonical ||
        canonical.markdown !== systemOrder.markdown ||
        !table ||
        table.rows.length === 0 ||
        JSON.stringify(table.headers) !== JSON.stringify(systemOrderColumns) ||
        hash(systemOrder.markdown) !== systemOrder.sha256
      ) {
        return { status: 'invalid' };
      }
      return {
        status: 'published',
        value: {
          state,
          run,
          systemOrder,
          receipt: { legacy: true, finalSha256: receipt.data.finalSha256 },
        },
      };
    } catch {
      return { status: 'invalid' };
    }
  }
  if (!systemOrder || !publicationRef) return { status: 'invalid' };

  // New publications are the completion proof themselves. They may be read
  // after the run lease is cleared, so this path must never depend on the
  // expiring input snapshot or on rerunning the model.
  if (!normalizedRef || run.status !== 'completed' || run.targetMessageId == null) {
    return { status: 'invalid' };
  }
  if (!(await input.service.isPublishedRun(input.scope, run))) return { status: 'invalid' };
  const [publication, normalized] = await Promise.all([
    input.service.getArtifact({ scope: input.scope, runId: run.runId, operationId: 'order-published' }),
    input.service.getArtifact({ scope: input.scope, runId: run.runId, operationId: 'system-order:normalized' }),
  ]);
  if (
    !publication ||
    publication.kind !== 'main' ||
    publication.sha256 !== publicationRef.sha256 ||
    hash(publication.payload) !== publication.sha256 ||
    !normalized ||
    normalized.kind !== 'main' ||
    normalized.sha256 !== normalizedRef.sha256 ||
    hash(normalized.payload) !== normalized.sha256
  ) {
    return { status: 'invalid' };
  }
  let receipt: SteelQuotationOrderPublicationReceipt;
  try {
    const parsedReceipt = orderPublicationReceiptSchema.safeParse(JSON.parse(publication.payload));
    if (!parsedReceipt.success) return { status: 'invalid' };
    receipt = parsedReceipt.data;
  } catch {
    return { status: 'invalid' };
  }
  const owner = state.markdownPublication?.current?.system_order;
  const canonical = canonicalizeSystemOrderMarkdown(normalizeSystemOrderMarkdown(normalized.payload));
  const table = parseMarkdownTables(canonical?.markdown ?? '')[0];
  const effectiveCanonical = canonicalizeSystemOrderMarkdown(
    normalizeSystemOrderMarkdown(systemOrder.markdown),
  );
  const effectiveTable = parseMarkdownTables(effectiveCanonical?.markdown ?? '')[0];
  const runSelection = ocrSelectionSchema.optional().safeParse(run.ocrSelection);
  if (
    receipt.runId !== run.runId ||
    receipt.targetMessageId !== run.targetMessageId ||
    receipt.targetMessageId !== systemOrder.messageId ||
    receipt.outputId !== `system_order:${run.runId}` ||
    receipt.inputSnapshotSha256 !== run.snapshotRef.sha256 ||
    receipt.normalizedSha256 !== normalized.sha256 ||
    receipt.systemOrderSha256 !== normalized.sha256 ||
    hash(systemOrder.markdown) !== systemOrder.sha256 ||
    !canonical ||
    canonical.markdown !== normalized.payload ||
    !table ||
    table.rows.length === 0 ||
    JSON.stringify(table.headers) !== JSON.stringify(systemOrderColumns) ||
    !effectiveCanonical ||
    effectiveCanonical.markdown !== systemOrder.markdown ||
    !effectiveTable ||
    effectiveTable.rows.length === 0 ||
    JSON.stringify(effectiveTable.headers) !== JSON.stringify(systemOrderColumns) ||
    !runSelection.success ||
    !sameQuotationOcrSelection(run.ocrSelection, systemOrder.ocrSelection) ||
    owner?.ai?.outputId !== receipt.outputId ||
    owner?.ai?.messageId !== receipt.targetMessageId ||
    owner?.ai?.sha256 !== receipt.systemOrderSha256 ||
    owner?.effective?.outputId !== receipt.outputId ||
    owner?.effective?.messageId !== receipt.targetMessageId ||
    owner?.effective?.sha256 !== systemOrder.sha256
  ) {
    return { status: 'invalid' };
  }
  return { status: 'published', value: { state, run, systemOrder, receipt } };
}

export interface SteelQuotationPublicationContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface SteelQuotationPublicationMessageSnapshot extends Omit<SteelQuotationPublicationMessage, 'content'> {
  content?: SteelQuotationPublicationContentPart[];
}

export type SteelQuotationPublicationMessageFields = Omit<
  SteelQuotationPublicationMessageSnapshot,
  'messageId' | 'text' | 'content'
> & {
  sourceMessageId: string;
  conversationId: string;
  user: string;
};

export interface SteelQuotationPublicationMessageBuildInput {
  targetMessageId: string;
  markdown: string;
  proof: SteelQuotationPublicationProof & { markdown: string };
}

export interface SteelQuotationPublicationPublisherInput {
  scope?: SteelQuotationScope;
  buildMessage: (
    input: SteelQuotationPublicationMessageBuildInput,
  ) => SteelQuotationPublicationMessageSnapshot | Promise<SteelQuotationPublicationMessageSnapshot>;
  savePublication: (
    input: SteelQuotationPublicationProof,
  ) => Promise<SteelQuotationPublicationSaveResult>;
  onPublicationCommitted?: (message: SteelQuotationSavedMessage) => Promise<void>;
  saveContext?: SteelQuotationPublicationSaveContext;
}

export type SteelQuotationPublicationTrackerSnapshot = Pick<
  ResponseTracker,
  'items' | 'currentMessage' | 'currentContentIndex'
>;

export type SteelQuotationPublicationAggregatorSnapshot = Pick<
  ResponseAggregator,
  'reasoningChunks' | 'textChunks' | 'toolCalls' | 'toolOutputs'
>;

function appendRenderedText(current: string, next: string): string {
  if (current.length > 0 && next.length > 0 &&
    current[current.length - 1] !== ' ' && next[0] !== ' ') {
    return `${current} ${next}`;
  }
  return `${current}${next}`;
}

function renderText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content.reduce(
    (result, part) => (part.type === 'text' || part.type === 'output_text') && typeof part.text === 'string'
      ? appendRenderedText(result, part.text)
      : result,
    '',
  );
}

function trackerText(tracker: SteelQuotationPublicationTrackerSnapshot): string {
  const items: readonly OutputItem[] = Array.isArray(tracker.items) ? tracker.items : [];
  return items
    .flatMap((item) => item.type === 'message' ? item.content ?? [] : [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string')
    .join('');
}

function primaryText(input: {
  tracker?: SteelQuotationPublicationTrackerSnapshot | null;
  aggregator?: SteelQuotationPublicationAggregatorSnapshot | null;
}): string {
  if (input.tracker) {
    return trackerText(input.tracker);
  }
  return input.aggregator?.textChunks?.join('') ?? '';
}

/**
 * Captures the settled host response before the quotation workflow starts and
 * returns the callback used by the guarded publisher. Responses persistence
 * stores the ordinary assistant message shape; transport-only output items
 * remain in the live Responses response and are never copied into IMessage.
 */
export function createSteelQuotationPublicationMessageBuilder(input: {
  tracker?: SteelQuotationPublicationTrackerSnapshot | null;
  aggregator?: SteelQuotationPublicationAggregatorSnapshot | null;
  buildMessageFields: (
    targetMessageId: string,
  ) => SteelQuotationPublicationMessageFields | Promise<SteelQuotationPublicationMessageFields>;
}): (input: {
  targetMessageId: string;
  markdown: string;
}) => Promise<SteelQuotationPublicationMessageSnapshot> {
  const capturedPrimaryText = primaryText(input);
  return async ({ targetMessageId, markdown }) => {
    const fields = await input.buildMessageFields(targetMessageId);
    const content = [
      ...(capturedPrimaryText ? [{ type: 'text', text: capturedPrimaryText }] : []),
      { type: 'text', text: markdown },
    ];
    return {
      ...fields,
      messageId: targetMessageId,
      text: `${capturedPrimaryText}\n\n${markdown}`,
      content,
    };
  };
}

/** Projects the committed quotation into the Chat host's explicit text slot. */
export function projectSteelQuotationMessage(input: {
  message: SteelQuotationPublicationMessageSnapshot;
  markdown: string;
  quotationContentIndex?: number;
}): SteelQuotationPublicationMessageSnapshot {
  const content = input.message.content?.map((part) => ({ ...part }));
  if (!content) {
    return { ...input.message, text: `${input.message.text}\n\n${input.markdown}` };
  }
  if (input.quotationContentIndex !== undefined && input.quotationContentIndex >= 0 &&
    input.quotationContentIndex < content.length) {
    content[input.quotationContentIndex] = {
      ...content[input.quotationContentIndex],
      text: input.markdown,
    };
  } else {
    content.push({ type: 'text', text: input.markdown });
  }
  return { ...input.message, text: renderText(content), content };
}

/**
 * Binds a host's raw response snapshot to the guarded quotation writer.
 *
 * The host message is built while its original response id is still present.
 * Only this TypeScript seam applies the canonical current target, so a delayed
 * completion cannot accidentally make the target look like the raw source.
 */
export function createSteelQuotationPublicationPublisher(
  input: SteelQuotationPublicationPublisherInput,
): (proof: SteelQuotationPublicationProof & { markdown: string }) => Promise<SteelQuotationPublicationSaveResult> {
  return async (proof) => {
    const targetMessageId = proof.targetMessageId || proof.run?.targetMessageId;
    if (!targetMessageId) {
      throw new Error('Quotation publication target is unavailable');
    }

    const message = await input.buildMessage({
      targetMessageId,
      markdown: proof.markdown,
      proof,
    });
    const sourceMessageId = message.sourceMessageId ?? message.messageId;
    if (!sourceMessageId) {
      throw new Error('Quotation publication source is unavailable');
    }

    const scope = input.scope ?? proof.scope;
    if (!scope) {
      throw new Error('Quotation publication scope is unavailable');
    }

    const tables = parseSteelReviewMarkdownTables(proof.markdown).filter((table) => table.title?.split(/[｜|]/u)[0]?.trim() === 'system_order');
    if (tables.length !== 1 || !tables[0].title) throw new Error('Quotation publication full target is unavailable');
    const table = tables[0];
    const section = parseAssistantMarkdown(proof.markdown).sections.find((entry) => entry.title === table.title);
    if (!section) throw new Error('Quotation publication full section is unavailable');
    const baselineMarkdown = section.raw.trimEnd();
    const outputId = `system_order:${proof.runId}`;
    const revision = proof.reviewMetadata?.lineage.outputId === outputId
      ? proof.reviewMetadata.lineage.revision
      : proof.runId;
    const result = await input.savePublication({
      ...proof,
      reviewBaseline: { kind: 'system_order', title: section.title, outputId, revision,
        baselineMarkdown, headers: table.headers, sourceMappings: proof.sourceSnapshot?.mappings ?? [],
        rows: proof.reviewMetadata?.rows ?? createSteelReviewBaselineRows(
          table,
          'system_order',
          outputId,
          proof.sourceSnapshot?.mappings ?? [],
          proof.calculationCheckpoint,
        ) },
      scope,
      targetMessageId,
      saveContext: input.saveContext ?? proof.saveContext,
      message: {
        ...message,
        messageId: targetMessageId,
        sourceMessageId,
        conversationId: scope.conversationId,
        user: scope.userId,
        tenantId: scope.tenantId,
      },
    });
    if (result.ok && input.onPublicationCommitted) {
      try {
        await input.onPublicationCommitted(result.message);
      } catch {
        // The database transaction is already committed; delivery observers
        // cannot turn a durable publication into an interrupted quotation.
      }
    }
    return result;
  };
}
