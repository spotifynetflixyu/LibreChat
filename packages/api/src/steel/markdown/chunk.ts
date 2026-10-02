export type SteelChunkKind = 'ocr_result_chunk' | 'system_order_chunk';

const STEEL_CHUNK_KINDS: readonly SteelChunkKind[] = [
  'ocr_result_chunk',
  'system_order_chunk',
];

const DATA_SECTION_TITLES = new Set([
  'ocr_result_chunk',
  'system_order_chunk',
  'ocr_result',
  'ocr_result_updates',
  'system_order',
  'system_order_updates',
]);

const H2_PATTERN = /^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/u;
const FENCE_START_PATTERN = /^ {0,3}(`{3,}|~{3,})/u;
const FENCE_END_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;

interface MarkdownFence {
  readonly marker: '`' | '~';
  readonly length: number;
}

function getSectionTitle(line: string): string | undefined {
  const match = H2_PATTERN.exec(line);
  if (!match) return undefined;
  return (match[1] ?? '').replace(/[ \t]+#+[ \t]*$/u, '').trim();
}

function baseSectionTitle(title: string): string {
  const separator = title.indexOf('｜');
  return (separator < 0 ? title : title.slice(0, separator)).trim();
}

function getFenceOpening(line: string): MarkdownFence | undefined {
  const marker = FENCE_START_PATTERN.exec(line)?.[1];
  return marker ? { marker: marker[0] as '`' | '~', length: marker.length } : undefined;
}

function isFenceClosing(line: string, fence: MarkdownFence): boolean {
  const marker = FENCE_END_PATTERN.exec(line)?.[1];
  return marker?.[0] === fence.marker && marker.length >= fence.length;
}

function isSteelChunkKind(value: string): value is SteelChunkKind {
  return STEEL_CHUNK_KINDS.includes(value as SteelChunkKind);
}

/**
 * Add the backend-owned data heading to a complete child Markdown table.
 * Existing matching headings are accepted for migration, but never copied.
 */
export function normalizeSteelChunkMarkdown(kind: SteelChunkKind, markdown: string): string {
  if (!isSteelChunkKind(kind)) {
    throw new Error(`Unknown Steel chunk kind: ${kind}`);
  }

  const text = markdown.trim();
  if (!text) {
    throw new Error(`${kind} output is empty`);
  }

  const lines = text.split(/\r?\n/u);
  const matchingHeadingIndexes: number[] = [];
  let fence: MarkdownFence | undefined;
  const sectionTitles: string[] = [];

  lines.forEach((line, index) => {
    if (fence) {
      if (isFenceClosing(line, fence)) fence = undefined;
      return;
    }

    const opening = getFenceOpening(line);
    if (opening) {
      fence = opening;
      return;
    }

    const title = getSectionTitle(line);
    if (title === undefined) return;
    const baseTitle = baseSectionTitle(title);
    if (!DATA_SECTION_TITLES.has(baseTitle)) return;
    sectionTitles.push(baseTitle);
    if (baseTitle === kind) matchingHeadingIndexes.push(index);
  });

  const conflictingTitle = sectionTitles.find((title) => title !== kind);
  if (conflictingTitle) {
    throw new Error(`${kind} output contains conflicting data section ${conflictingTitle}`);
  }
  if (matchingHeadingIndexes.length > 1) {
    throw new Error(`${kind} output contains duplicate data sections`);
  }

  const bodyLines = matchingHeadingIndexes.length === 1
    ? lines.filter((_, index) => index !== matchingHeadingIndexes[0])
    : lines;
  const body = bodyLines.join('\n').trim();
  return `## ${kind}\n\n${body}`;
}
