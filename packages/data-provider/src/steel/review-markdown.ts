/**
 * The plain Markdown boundary shared by Steel's API and persistence layers.
 * It intentionally only understands the table/heading/fence grammar used by
 * the review authority; rendering and source authorization stay in callers.
 */
export interface SteelReviewMarkdownTable {
  headers: string[];
  rows: string[][];
  index: number;
  title?: string;
  start: number;
  end: number;
  raw: string;
}

interface MarkdownFence {
  marker: '`' | '~';
  length: number;
}

function decodeCell(cell: string): string {
  let decoded = '';
  for (let index = 0; index < cell.length; index += 1) {
    const character = cell[index] ?? '';
    const next = cell[index + 1] ?? '';
    if (character === '\\' && (next === '|' || next === '\\')) {
      decoded += next;
      index += 1;
      continue;
    }
    decoded += character;
  }
  return decoded.trim();
}

export function parseSteelReviewMarkdownRow(line: string): string[] | undefined {
  const source = line.trim();
  if (!source) {
    return undefined;
  }
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (character === '\\') {
      current += character;
      const next = source[index + 1] ?? '';
      if (next) {
        current += next;
        index += 1;
      }
      continue;
    }
    if (character === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (cells.length === 0) {
    return undefined;
  }
  cells.push(current);
  if (source.startsWith('|')) {
    cells.shift();
  }
  if (source.endsWith('|') && cells[cells.length - 1] === '') {
    cells.pop();
  }
  if (cells.length === 0 || (cells.length === 1 && !(source.startsWith('|') && source.endsWith('|')))) {
    return undefined;
  }
  return cells.map(decodeCell);
}

function isSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell);
}

function parseBlock(lines: readonly string[]): { headers: string[]; rows: string[][] } | undefined {
  if (lines.length < 2) {
    return undefined;
  }
  const headers = parseSteelReviewMarkdownRow(lines[0] ?? '');
  const separator = parseSteelReviewMarkdownRow(lines[1] ?? '');
  if (!headers || !separator || headers.length !== separator.length || !separator.every(isSeparatorCell)) {
    return undefined;
  }
  return {
    headers,
    // Keep malformed row slots as empty rows. API row IDs intentionally use
    // the physical row index, including skipped rows, for digest stability.
    rows: lines.slice(2).map((line) => parseSteelReviewMarkdownRow(line) ?? []),
  };
}

function headingTitle(line: string): string | undefined {
  const match = line.match(/^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/);
  return match?.[1]?.replace(/[ \t]+#+[ \t]*$/, '').trim();
}

function isHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line);
}

function getFence(line: string): MarkdownFence | undefined {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
  return marker ? { marker: marker[0] as '`' | '~', length: marker.length } : undefined;
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
  return marker?.[0] === fence.marker && marker.length >= fence.length;
}

/** Parse all physical tables in global order, retaining exact source ranges. */
export function parseSteelReviewMarkdownTables(markdown: string): SteelReviewMarkdownTable[] {
  const tables: SteelReviewMarkdownTable[] = [];
  const lines = markdown.match(/[^\r\n]*(?:\r?\n|$)/g) ?? [];
  let fence: MarkdownFence | undefined;
  let title: string | undefined;
  let block: string[] = [];
  let blockStart = 0;
  let blockEnd = 0;
  let offset = 0;
  let index = 0;

  const flush = () => {
    if (block.length === 0) {
      return;
    }
    const parsed = parseBlock(block);
    if (parsed) {
      index += 1;
      tables.push({ ...parsed, index, title, start: blockStart, end: blockEnd, raw: markdown.slice(blockStart, blockEnd) });
    }
    block = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r?\n$/, '');
    const trimmed = line.trim();
    const lineStart = offset;
    offset += rawLine.length;
    if (fence) {
      if (closesFence(line, fence)) {
        fence = undefined;
      }
      continue;
    }
    const nextFence = getFence(line);
    if (nextFence) {
      flush();
      fence = nextFence;
      continue;
    }
    const nextTitle = headingTitle(line);
    if (isHeading(line)) {
      flush();
      title = nextTitle;
      continue;
    }
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (block.length === 0) {
        blockStart = lineStart;
      }
      blockEnd = lineStart + line.length;
      block.push(trimmed);
      continue;
    }
    flush();
  }
  flush();
  return tables;
}
