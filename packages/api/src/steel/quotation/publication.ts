import { parseSteelReviewMarkdownTables } from 'librechat-data-provider';
import type {
  SteelQuotationPublicationMessage,
  SteelQuotationPublicationProof,
  SteelQuotationPublicationSaveContext,
  SteelQuotationPublicationSaveResult,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import type { ResponseAggregator } from '../../agents/responses/service';
import type { ResponseTracker } from '../../agents/responses/handlers';
import type { OutputItem } from '../../agents/responses/types';
import { createSteelReviewBaselineRows } from '../review';
import { parseAssistantMarkdown } from '../ocr/result';

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
    return {
      ...fields,
      messageId: targetMessageId,
      text: `${capturedPrimaryText}\n\n${markdown}`,
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
    return input.savePublication({
      ...proof,
      reviewBaseline: { kind: 'system_order', title: section.title, outputId, revision: proof.runId,
        baselineMarkdown, headers: table.headers, sourceMappings: proof.sourceSnapshot?.mappings ?? [],
        rows: createSteelReviewBaselineRows(table, 'system_order', outputId, proof.sourceSnapshot?.mappings ?? [], proof.calculationCheckpoint) },
      scope,
      targetMessageId,
      saveContext: input.saveContext ?? proof.saveContext,
      message: {
        ...message,
        messageId: targetMessageId,
        sourceMessageId,
        conversationId: scope.conversationId,
        user: scope.userId,
      },
    });
  };
}
