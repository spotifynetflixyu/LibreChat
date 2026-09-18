import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { SteelNativeActivityEvent } from '~/store/steel';

type TextValue = string | { value?: string };
type TextPartLike = { text?: TextValue };

export function hasAcceptedQuotationPreflight(
  events: readonly SteelNativeActivityEvent[] | undefined,
  messageId?: string,
): boolean {
  return (events ?? []).some(
    (event) =>
      event.type === 'quotation_status' &&
      event.source === 'quotation_preflight' &&
      event.status !== 'idle' &&
      (messageId == null || event.messageId == null || event.messageId === messageId),
  );
}

type MarkdownLine = {
  start: number;
  end: number;
  content: string;
  inFence: boolean;
};

function getMarkdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let lineStart = 0;
  let fenceChar: '`' | '~' | undefined;
  let fenceLength = 0;

  while (lineStart < markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart);
    const end = newlineIndex === -1 ? markdown.length : newlineIndex + 1;
    const contentEnd = newlineIndex === -1
      ? end
      : newlineIndex > lineStart && markdown[newlineIndex - 1] === '\r'
        ? newlineIndex - 1
        : newlineIndex;
    const content = markdown.slice(lineStart, contentEnd);
    const inFence = fenceChar !== undefined;
    lines.push({ start: lineStart, end, content, inFence });

    const fence = /^ {0,3}(`{3,}|~{3,})/u.exec(content);
    if (inFence) {
      if (
        fenceChar &&
        new RegExp(`^ {0,3}${fenceChar}{${fenceLength},}[ \\t]*$`, 'u').test(content)
      ) {
        fenceChar = undefined;
        fenceLength = 0;
      }
    } else if (fence) {
      fenceChar = fence[1][0] as '`' | '~';
      fenceLength = fence[1].length;
    }

    lineStart = end;
  }

  return lines;
}

function isMarkdownHeading(content: string): boolean {
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/u.test(content);
}

function isQuoteSignalHeading(content: string): boolean {
  return /^ {0,3}##[ \t]+quote_signal[ \t]*$/u.test(content);
}

export function removeQuoteSignalSections(text: string): string | undefined {
  if (!text.includes('quote_signal')) {
    return text;
  }

  const lines = getMarkdownLines(text);
  const removals: Array<{ start: number; end: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.inFence || !isQuoteSignalHeading(line.content)) {
      continue;
    }

    let sectionEnd = text.length;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (!nextLine?.inFence && isMarkdownHeading(nextLine.content)) {
        sectionEnd = nextLine.start;
        break;
      }
    }

    if (text.slice(line.end, sectionEnd).trim() === 'start') {
      removals.push({ start: line.start, end: sectionEnd });
    }
  }

  if (removals.length === 0) {
    return text;
  }

  let result = text;
  for (let index = removals.length - 1; index >= 0; index -= 1) {
    const removal = removals[index];
    result = result.slice(0, removal.start) + result.slice(removal.end);
  }

  return result.trim().length === 0 ? undefined : result;
}

function removeQuoteSignalFromPart(part: TMessageContentParts): TMessageContentParts | undefined {
  const textValue = (part as TextPartLike).text;
  if (typeof textValue === 'string') {
    const text = removeQuoteSignalSections(textValue);
    if (text === textValue) {
      return part;
    }
    return text === undefined ? undefined : ({ ...part, text } as TMessageContentParts);
  }

  if (textValue && typeof textValue.value === 'string') {
    const text = removeQuoteSignalSections(textValue.value);
    if (text === textValue.value) {
      return part;
    }
    return text === undefined
      ? undefined
      : ({ ...part, text: { ...textValue, value: text } } as TMessageContentParts);
  }

  return part;
}

export function hideQuoteSignalFromContent(
  content: Array<TMessageContentParts | undefined> | undefined,
  shouldHide: boolean,
): Array<TMessageContentParts | undefined> | undefined {
  if (content == null || !shouldHide) {
    return content;
  }

  return content.map((part) =>
    part == null || part.type !== ContentTypes.TEXT ? part : removeQuoteSignalFromPart(part),
  );
}
