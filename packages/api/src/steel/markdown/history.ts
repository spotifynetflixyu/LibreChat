import type {
  SteelMarkdownHistoryRecord,
  SteelMarkdownHistoryReadInput,
  SteelMarkdownKind,
} from '@librechat/data-schemas';
import { fullOnlyMarkdownKinds, retiredMarkdownSectionTitles } from './admission';
import { parseAssistantMarkdown } from './parser';

export interface SteelMarkdownHistoryMessage {
  messageId?: string;
  id?: string;
  metadata?: Record<string, unknown>;
  text?: string;
  content?: unknown;
  unfinished?: boolean;
  isCreatedByUser?: boolean;
}

type Replacement = Pick<SteelMarkdownHistoryRecord, 'kind' | 'effectiveMarkdown' | 'reference'>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function trailingNewlines(value: string): string {
  return value.match(/(?:\r\n|\n)+$/u)?.[0] ?? '';
}

function withoutTrailingNewlines(value: string): string {
  return value.replace(/(?:\r\n|\n)+$/u, '');
}

function replacementSection(replacement: Replacement): string | undefined {
  const parsed = parseAssistantMarkdown(replacement.effectiveMarkdown);
  const matches = parsed.sections.filter((section) => section.title === replacement.reference.title);
  if (matches.length !== 1) {
    return undefined;
  }
  return withoutTrailingNewlines(matches[0]?.raw ?? '');
}

function sectionCounts(
  values: readonly string[],
  titles: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const section of parseAssistantMarkdown(value).sections) {
      if (titles.has(section.title)) {
        counts.set(section.title, (counts.get(section.title) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function replaceSections(
  value: string,
  replacements: ReadonlyMap<string, string>,
  allowedTitles: ReadonlySet<string>,
): string {
  const parsed = parseAssistantMarkdown(value);
  return parsed.segments.map((segment) => {
    if (segment.kind === 'text' || !allowedTitles.has(segment.section.title)) {
      return segment.kind === 'text' ? segment.text : segment.section.raw;
    }
    const replacement = replacements.get(segment.section.title);
    if (replacement === undefined) {
      return segment.section.raw;
    }
    return `${replacement}${trailingNewlines(segment.section.raw)}`;
  }).join('');
}

function replaceTextParts(
  parts: readonly unknown[],
  replacements: ReadonlyMap<string, string>,
): unknown[] {
  const textPartIndexes: number[] = [];
  const values: string[] = [];
  for (const [index, part] of parts.entries()) {
    const candidate = record(part);
    if (!candidate || typeof candidate.text !== 'string' ||
      (candidate.type !== undefined && candidate.type !== 'text')) {
      continue;
    }
    textPartIndexes.push(index);
    values.push(candidate.text);
  }
  const counts = sectionCounts(values, new Set(replacements.keys()));
  const allowedTitles = new Set(
    [...replacements.keys()].filter((title) => counts.get(title) === 1),
  );
  if (allowedTitles.size === 0) {
    return [...parts];
  }
  const next = [...parts];
  for (const index of textPartIndexes) {
    const part = record(parts[index]);
    if (!part || typeof part.text !== 'string') {
      continue;
    }
    const text = replaceSections(part.text, replacements, allowedTitles);
    if (text !== part.text) {
      next[index] = { ...part, text };
    }
  }
  return next;
}

function replacementMap(
  records: readonly SteelMarkdownHistoryRecord[],
  messageId: string,
): Map<string, string> {
  const byTitle = new Map<string, string>();
  const invalidTitles = new Set<string>();
  for (const candidate of records) {
    if (candidate.messageId !== messageId || candidate.reference.messageId !== messageId) {
      continue;
    }
    const title = candidate.reference.title;
    const section = replacementSection(candidate);
    if (!section || invalidTitles.has(title)) {
      invalidTitles.add(title);
      byTitle.delete(title);
      continue;
    }
    const previous = byTitle.get(title);
    if (previous !== undefined && previous !== section) {
      invalidTitles.add(title);
      byTitle.delete(title);
      continue;
    }
    byTitle.set(title, section);
  }
  return byTitle;
}

function projectMessage<T extends SteelMarkdownHistoryMessage>(
  message: T,
  replacements: ReadonlyMap<string, string>,
): T {
  if (replacements.size === 0) {
    return message;
  }
  const next = { ...message };
  if (typeof message.text === 'string') {
    const allowedTitles = new Set(
      [...replacements.keys()].filter((title) =>
        sectionCounts([message.text!], new Set([title])).get(title) === 1),
    );
    if (allowedTitles.size > 0) {
      next.text = replaceSections(message.text, replacements, allowedTitles);
    }
  }
  if (typeof message.content === 'string') {
    const allowedTitles = new Set(
      [...replacements.keys()].filter((title) =>
        sectionCounts([message.content as string], new Set([title])).get(title) === 1),
    );
    if (allowedTitles.size > 0) {
      next.content = replaceSections(message.content, replacements, allowedTitles);
    }
  } else if (Array.isArray(message.content)) {
    next.content = replaceTextParts(message.content, replacements);
  }
  return next;
}

/**
 * Projects validated clean managed snapshots into loaded provider history.
 * Every replacement is title-bound and section-local; unrelated message fields
 * and content-part order are retained by the shallow message/part copies.
 */
export function projectSteelMarkdownHistory<T extends SteelMarkdownHistoryMessage>(
  messages: readonly T[],
  records: readonly SteelMarkdownHistoryRecord[],
): T[] {
  const recordsByMessage = new Map<string, SteelMarkdownHistoryRecord[]>();
  for (const candidate of records) {
    const messageId = candidate.messageId;
    const list = recordsByMessage.get(messageId) ?? [];
    list.push(candidate);
    recordsByMessage.set(messageId, list);
  }
  return messages.map((message) => {
    const messageId = message.messageId ?? message.id;
    if (!messageId) {
      return message;
    }
    return projectMessage(message, replacementMap(recordsByMessage.get(messageId) ?? [], messageId));
  });
}

export type { SteelMarkdownKind };

function withoutUnfinishedManagedSections<T extends SteelMarkdownHistoryMessage>(message: T): T {
  if (message.unfinished !== true || message.isCreatedByUser !== false) return message;
  const clean = (value: string): string => parseAssistantMarkdown(value).segments.map((segment) => {
    if (segment.kind === 'text') return segment.text;
    const base = segment.section.title.split(/[｜|]/u)[0]?.trim();
    return [...fullOnlyMarkdownKinds, ...retiredMarkdownSectionTitles].some((title) => title === base)
      ? '' : segment.section.raw;
  }).join('');
  const next = { ...message };
  if (typeof message.text === 'string') next.text = clean(message.text);
  if (typeof message.content === 'string') next.content = clean(message.content);
  else if (Array.isArray(message.content)) next.content = message.content.map((part: unknown) => {
    const candidate = record(part);
    return candidate && typeof candidate.text === 'string' && (candidate.type === undefined || candidate.type === 'text')
      ? { ...candidate, text: clean(candidate.text) } : part;
  });
  return next;
}

/** Resolve one loaded, already authorized conversation batch before provider formatting. */
export async function prepareSteelMarkdownHistory<T extends SteelMarkdownHistoryMessage>(input: {
  scope: { userId?: string; conversationId?: string; tenantId?: string };
  messages: readonly T[];
  reader: { readSteelMarkdownHistory(input: SteelMarkdownHistoryReadInput): Promise<SteelMarkdownHistoryRecord[]> };
}): Promise<T[]> {
  const messages = input.messages.map(withoutUnfinishedManagedSections);
  if (!input.scope.userId || !input.scope.conversationId || !messages.some((message) => message.metadata?.steelMarkdownOwners)) {
    return messages;
  }
  const records = await input.reader.readSteelMarkdownHistory({ userId: input.scope.userId, conversationId: input.scope.conversationId,
    tenantId: input.scope.tenantId, messages: messages.flatMap((message) => message.messageId ? [{ messageId: message.messageId, metadata: message.metadata }] : []) });
  return projectSteelMarkdownHistory(messages, records);
}
