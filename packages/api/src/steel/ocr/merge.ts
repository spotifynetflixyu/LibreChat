import { parseMarkdownTables } from '../markdown/table';

interface OcrPreprocessingMarkdownChunk {
  chunkIndex: number;
  pageStart?: number;
  pageEnd?: number;
  organizedSaved?: boolean;
  organizedMarkdown?: string;
}

interface OcrPreprocessingMarkdownState {
  chunks: readonly OcrPreprocessingMarkdownChunk[];
}

export function mergeChunkMarkdownForFileKey(input: {
  ocrFileKey: string;
  ocrRuleVersion: string;
  chunks: readonly {
    chunkIndex: number;
    pageStart?: number;
    pageEnd?: number;
    markdown: string;
  }[];
}): string {
  return mergeChunkMarkdownTables(input.chunks);
}

export function getSavedOcrPreprocessingChunkMarkdowns(
  state: OcrPreprocessingMarkdownState,
): { chunkIndex: number; pageStart?: number; pageEnd?: number; markdown: string }[] {
  return state.chunks
    .filter((chunk) => chunk.organizedSaved && chunk.organizedMarkdown !== undefined)
    .map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      ...(chunk.pageStart !== undefined ? { pageStart: chunk.pageStart } : {}),
      ...(chunk.pageEnd !== undefined ? { pageEnd: chunk.pageEnd } : {}),
      markdown: chunk.organizedMarkdown ?? '',
    }));
}

export function mergeOcrPreprocessingStateMarkdown(input: {
  state: OcrPreprocessingMarkdownState;
  ocrFileKey: string;
  ocrRuleVersion: string;
}): string | undefined {
  const chunks = getSavedOcrPreprocessingChunkMarkdowns(input.state);
  return chunks.length > 0
    ? mergeChunkMarkdownForFileKey({
        ocrFileKey: input.ocrFileKey,
        ocrRuleVersion: input.ocrRuleVersion,
        chunks,
      })
    : undefined;
}

function mergeChunkMarkdownTables(
  chunks: readonly {
    chunkIndex: number;
    pageStart?: number;
    pageEnd?: number;
    markdown: string;
  }[],
) {
  const orderedChunks = [...chunks].sort(
    (left, right) =>
      (left.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.pageStart ?? Number.MAX_SAFE_INTEGER) ||
      (left.pageEnd ?? Number.MAX_SAFE_INTEGER) - (right.pageEnd ?? Number.MAX_SAFE_INTEGER) ||
      left.chunkIndex - right.chunkIndex,
  );
  const tables = orderedChunks.flatMap((chunk) => parseMarkdownTables(chunk.markdown));
  if (tables.length === 0) {
    return orderedChunks.map((chunk) => chunk.markdown).join('\n\n');
  }

  const headers: string[] = [];
  for (const table of tables) {
    for (const header of table.headers) {
      if (!headers.includes(header)) {
        headers.push(header);
      }
    }
  }

  const rows = tables.flatMap((table) =>
    table.rows.map((row) => {
      const cellsByHeader = new Map(
        table.headers.map((header, index) => [header, row[index] ?? '']),
      );
      return headers.map((header) => cellsByHeader.get(header) ?? '');
    }),
  );

  return renderMarkdownTable(headers, rows);
}

function renderMarkdownTable(headers: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`),
  ].join('\n');
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, '<br>');
}
