export interface SteelMarkdownTable {
  headers: string[];
  rows: string[][];
}

function getMarkdownTableBlocks(content: string): string[][] {
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      currentBlock.push(line);
      continue;
    }

    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
      currentBlock = [];
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks;
}

export function splitMarkdownTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownTable(block: string[]): SteelMarkdownTable | undefined {
  if (block.length < 3) {
    return undefined;
  }

  const headers = splitMarkdownTableRow(block[0] ?? '');
  const separator = splitMarkdownTableRow(block[1] ?? '');
  if (!isSeparatorRow(separator)) {
    return undefined;
  }

  return {
    headers,
    rows: block.slice(2).map(splitMarkdownTableRow),
  };
}

export function parseMarkdownTables(content: string): SteelMarkdownTable[] {
  return getMarkdownTableBlocks(content)
    .map(parseMarkdownTable)
    .filter((table): table is SteelMarkdownTable => table !== undefined);
}

export function countMarkdownTables(contentOrTables: string | readonly SteelMarkdownTable[]) {
  return typeof contentOrTables === 'string'
    ? parseMarkdownTables(contentOrTables).length
    : contentOrTables.length;
}
