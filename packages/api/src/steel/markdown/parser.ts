const H2_PATTERN = /^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/u;
const FENCE_START_PATTERN = /^ {0,3}(`{3,}|~{3,})/u;
const FENCE_END_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;

export interface MarkdownSection {
  readonly title: string;
  readonly heading: string;
  readonly body: string;
  readonly raw: string;
}

export type MarkdownSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'section'; readonly section: MarkdownSection };

export interface ParsedAssistantMarkdown {
  readonly newline: '\n' | '\r\n';
  readonly preamble: string;
  readonly sections: readonly MarkdownSection[];
  readonly segments: readonly MarkdownSegment[];
}


export interface MarkdownFence {
  readonly marker: '`' | '~';
  readonly length: number;
}

interface LinePart {
  readonly content: string;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

function getLines(markdown: string): LinePart[] {
  const lines: LinePart[] = [];
  const pattern = /([^\r\n]*)(\r\n|\n|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const content = match[1] ?? '';
    const ending = match[2] ?? '';
    const start = match.index;
    const end = start + match[0].length;
    lines.push({ content, raw: `${content}${ending}`, start, end });
    if (ending === '') {
      break;
    }
  }
  return lines;
}

function normalizeTitle(line: string): string | undefined {
  const match = H2_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }
  return (match[1] ?? '').replace(/[ \t]+#+[ \t]*$/u, '').trim();
}

export function getFenceStart(line: string): MarkdownFence | undefined {
  const markerText = FENCE_START_PATTERN.exec(line)?.[1];
  const marker = markerText?.[0];
  if (!markerText || (marker !== '`' && marker !== '~')) {
    return undefined;
  }
  return { marker, length: markerText.length };
}

export function closesFence(line: string, fence: MarkdownFence): boolean {
  const markerText = FENCE_END_PATTERN.exec(line)?.[1];
  return markerText?.[0] === fence.marker && markerText.length >= fence.length;
}

/** Parse H2 sections while retaining exact section slices and non-section text. */
export function parseAssistantMarkdown(markdown: string): ParsedAssistantMarkdown {
  const lines = getLines(markdown);
  const starts: Array<{ readonly index: number; readonly title: string }> = [];
  let fence: MarkdownFence | undefined;

  for (const [index, line] of lines.entries()) {
    if (fence) {
      if (closesFence(line.content, fence)) {
        fence = undefined;
      }
      continue;
    }
    const nextFence = getFenceStart(line.content);
    if (nextFence) {
      fence = nextFence;
      continue;
    }
    const title = normalizeTitle(line.content);
    if (title !== undefined) {
      starts.push({ index, title });
    }
  }

  const sections: MarkdownSection[] = starts.map((start, position) => {
    const next = starts[position + 1];
    const headingLine = lines[start.index];
    const sectionEnd = next ? lines[next.index]?.start ?? markdown.length : markdown.length;
    const bodyStart = headingLine?.end ?? sectionEnd;
    const raw = markdown.slice(headingLine?.start ?? sectionEnd, sectionEnd);
    return {
      title: start.title,
      heading: headingLine?.content ?? '',
      body: markdown.slice(bodyStart, sectionEnd),
      raw,
    };
  });

  const preamble = starts.length > 0 ? markdown.slice(0, lines[starts[0]?.index ?? 0]?.start ?? 0) : markdown;
  const segments: MarkdownSegment[] = [];
  if (preamble !== '') {
    segments.push({ kind: 'text', text: preamble });
  }
  sections.forEach((section) => segments.push({ kind: 'section', section }));

  return {
    newline: markdown.includes('\r\n') ? '\r\n' : '\n',
    preamble,
    sections,
    segments,
  };
}

/** Alias retained for callers that use the shorter parser name. */
export const parseMarkdownSections: typeof parseAssistantMarkdown = parseAssistantMarkdown;
