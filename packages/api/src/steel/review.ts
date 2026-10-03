import { createHash } from 'node:crypto';
import {
  getSteelReviewTableId,
  steelReviewReadQuerySchema,
} from 'librechat-data-provider';
import type {
  SteelReviewCell,
  SteelReviewKind,
  SteelReviewReadQuery,
  SteelReviewRow,
  SteelReviewSource,
  SteelReviewTable,
} from 'librechat-data-provider';
import type {
  SteelReviewReadInput,
  SteelReviewReadRecord,
} from '@librechat/data-schemas';
import { parseMarkdownTables, type SteelMarkdownTable } from './markdown/table';

export interface SteelReviewReader {
  readSteelReview(input: SteelReviewReadInput): Promise<SteelReviewReadRecord | null>;
}

export class SteelReviewReadError extends Error {
  readonly statusCode: 400 | 404;
  readonly code: 'INVALID_REVIEW_QUERY' | 'REVIEW_NOT_FOUND';

  constructor(
    code: 'INVALID_REVIEW_QUERY' | 'REVIEW_NOT_FOUND',
    statusCode: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = 'SteelReviewReadError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface ReviewTableCandidate extends SteelMarkdownTable {
  index: number;
  title?: string;
  partIndex?: number;
}

interface MarkdownFence {
  marker: '`' | '~';
  length: number;
}

function headingTitle(line: string): string | undefined {
  const match = line.match(/^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/u);
  return match?.[1]?.replace(/[ \t]+#+[ \t]*$/u, '').trim();
}

function isHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/u.test(line);
}

function getFence(line: string): MarkdownFence | undefined {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
  return marker ? { marker: marker[0] as '`' | '~', length: marker.length } : undefined;
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1];
  return marker?.[0] === fence.marker && marker.length >= fence.length;
}

function isManagedTitle(kind: SteelReviewKind, title: string | undefined): boolean {
  if (!title) {
    return false;
  }
  if (kind === 'ocr_result') {
    return title === 'ocr_result';
  }
  if (title === 'system_order') {
    return true;
  }
  const separator = title.indexOf('｜');
  return separator > 0 && title.slice(0, separator).trim() === 'system_order' &&
    title.slice(separator + 1).trim() !== '';
}

function collectTables(markdown: string): ReviewTableCandidate[] {
  const tables: ReviewTableCandidate[] = [];
  let fence: MarkdownFence | undefined;
  let title: string | undefined;
  let block: string[] = [];
  let index = 0;

  const flush = () => {
    if (block.length > 0) {
      const parsed = parseMarkdownTables(block.join('\n'));
      for (const table of parsed) {
        index += 1;
        tables.push({ ...table, index, title });
      }
      block = [];
    }
  };

  for (const line of markdown.split(/\r?\n/u)) {
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
      // A managed H2 section ends at every heading level. Do not carry its
      // authority into an ordinary table below an H1/H3/other section.
      title = nextTitle;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      block.push(trimmed);
    } else {
      flush();
    }
  }
  flush();
  return tables;
}

function collectMessageTables(record: SteelReviewReadRecord): ReviewTableCandidate[] {
  if (!record.messageTextParts || record.messageTextParts.length === 0) {
    return record.messageText ? collectTables(record.messageText) : [];
  }
  let tableOffset = 0;
  return record.messageTextParts.flatMap((part) => {
    const localTables = collectTables(part.text);
    const tables = localTables.map((table) => ({
      ...table,
      index: table.index + tableOffset,
      partIndex: part.partIndex,
    }));
    tableOffset += localTables.length;
    return tables;
  });
}

function parsePageNumber(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value.trim())) {
    return null;
  }
  const page = Number(value.trim());
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

function sourceForRow(
  table: SteelMarkdownTable,
  row: string[],
  mappings: SteelReviewReadRecord['sourceMappings'],
): SteelReviewSource | null {
  const sourceIndex = table.headers.indexOf('來源');
  const sourceCode = sourceIndex >= 0 ? row[sourceIndex]?.trim() : undefined;
  if (!sourceCode || !mappings) {
    return null;
  }
  const matches = mappings.filter((candidate) => candidate.sourceCode === sourceCode);
  if (matches.length !== 1) {
    return null;
  }
  const [mapping] = matches;
  const page = parsePageNumber(row[table.headers.indexOf('頁碼')]);
  return {
    fileId: mapping.fileId,
    pageNumber: page,
    filename: mapping.sourceFilename,
    ...(mapping.mediaType ? { mediaType: mapping.mediaType } : {}),
  };
}

function toRows(
  table: SteelMarkdownTable,
  outputId: string,
  sourceMappings: SteelReviewReadRecord['sourceMappings'],
): SteelReviewRow[] {
  return table.rows.flatMap((row, rowIndex) => {
    if (row.length !== table.headers.length) {
      return [];
    }
    const values: Record<string, SteelReviewCell> = {};
    table.headers.forEach((header, index) => {
      const value = row[index] ?? '';
      values[header] = { baseline: value, effective: value };
    });
    const rowId = createHash('sha256')
      .update(`${outputId}:${rowIndex}:${JSON.stringify(row)}`)
      .digest('hex');
    return [{ rowId, values, source: sourceForRow(table, row, sourceMappings) }];
  });
}

function projectRecord(
  record: SteelReviewReadRecord,
  table: ReviewTableCandidate,
  tableId: string,
): SteelReviewTable | null {
  if (!isManagedTitle(record.kind, table.title)) {
    return null;
  }
  if (record.kind === 'ocr_result' &&
    (!table.headers.includes('來源') || !table.headers.includes('零件編號'))) {
    return null;
  }
  const rows = toRows(table, record.outputId, record.sourceMappings);
  const latestOutputId = record.latestOutputId ?? record.outputId;
  const isLatest = record.state === 'current' && latestOutputId === record.outputId;
  return {
    conversationId: record.conversationId,
    messageId: record.messageId,
    tableId,
    ...(table.partIndex !== undefined ? { partIndex: table.partIndex } : {}),
    outputId: record.outputId,
    kind: record.kind,
    revision: record.revision,
    latestOutputId,
    isLatest,
    readOnly: !isLatest,
    headers: table.headers,
    rows,
  };
}

function sidecarTarget(
  record: SteelReviewReadRecord,
  tableId: string,
): ReviewTableCandidate | undefined {
  if (!record.messageText || !record.headers || !record.rows) {
    return undefined;
  }
  const rows = record.rows.map((row) => record.headers!.map((header) => {
    const value = row.values[header]?.baseline;
    return typeof value === 'string' ? value : undefined;
  }));
  if (rows.some((row) => row.some((value) => value === undefined))) {
    return undefined;
  }
  const expected: SteelMarkdownTable = { headers: record.headers, rows: rows as string[][] };
  const actualTables = collectMessageTables(record);
  const requested = actualTables.filter(
    (candidate) => getSteelReviewTableId(record.kind, candidate.index) === tableId,
  );
  if (requested.length !== 1 || !isManagedTitle(record.kind, requested[0]?.title)) {
    return undefined;
  }
  const [target] = requested;
  if (record.messageTextPartIndex !== undefined && target.partIndex !== record.messageTextPartIndex) {
    return undefined;
  }
  if (!sameTable(target, expected)) {
    return undefined;
  }
  const matches = actualTables.filter(
    (candidate) => candidate.title === target.title && sameTable(candidate, expected),
  );
  return matches.length === 1 ? target : undefined;
}

function projectSidecar(
  record: SteelReviewReadRecord,
  target?: ReviewTableCandidate,
): SteelReviewTable | null {
  if (!record.headers || !record.rows) {
    return null;
  }
  const latestOutputId = record.latestOutputId ?? record.outputId;
  const isLatest = record.state === 'current' &&
    record.latestOutputId !== undefined && latestOutputId === record.outputId;
  return {
    conversationId: record.conversationId,
    messageId: record.messageId,
    tableId: record.tableId,
    ...(target?.partIndex !== undefined ? { partIndex: target.partIndex } : {}),
    outputId: record.outputId,
    kind: record.kind,
    revision: record.revision,
    latestOutputId,
    isLatest,
    readOnly: !isLatest,
    headers: record.headers,
    rows: record.rows,
  };
}

function sameTable(left: SteelMarkdownTable, right: SteelMarkdownTable): boolean {
  return JSON.stringify(left.headers) === JSON.stringify(right.headers) &&
    JSON.stringify(left.rows) === JSON.stringify(right.rows);
}

function findCanonicalTarget(
  record: SteelReviewReadRecord,
  tableId: string,
): ReviewTableCandidate | undefined {
  if (!record.markdown) {
    return undefined;
  }
  const canonicalTables = collectTables(record.markdown);
  if (!record.messageText && !record.messageTextParts) {
    return canonicalTables.find(
      (candidate) => getSteelReviewTableId(record.kind, candidate.index) === tableId,
    );
  }
  const messageTables = collectMessageTables(record);
  const requestedTables = messageTables.filter(
    (candidate) => getSteelReviewTableId(record.kind, candidate.index) === tableId,
  );
  if (requestedTables.length !== 1 ||
    (record.messageTextPartIndex !== undefined && requestedTables[0]?.partIndex !== record.messageTextPartIndex)) {
    return undefined;
  }
  const [messageTable] = requestedTables;
  if (!isManagedTitle(record.kind, messageTable?.title)) {
    return undefined;
  }
  const canonicalMatches = canonicalTables.filter(
    (candidate) => candidate.title === messageTable.title && sameTable(candidate, messageTable),
  );
  if (canonicalMatches.length !== 1) {
    return undefined;
  }
  const messageMatches = messageTables.filter(
    (candidate) => candidate.title === messageTable.title && sameTable(candidate, messageTable),
  );
  if (messageMatches.length !== 1) {
    return undefined;
  }
  const [canonicalTable] = canonicalMatches;
  return {
    ...canonicalTable,
    ...(messageTable.partIndex !== undefined ? { partIndex: messageTable.partIndex } : {}),
  };
}

export function createSteelReviewService({ reader }: { reader: SteelReviewReader }) {
  return {
    async read(input: SteelReviewReadInput): Promise<{ table: SteelReviewTable }> {
      const query = steelReviewReadQuerySchema.safeParse(input);
      if (!query.success) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review table');
      }
      const record = await reader.readSteelReview(input);
      if (!record) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      const sidecarTargetCandidate = sidecarTarget(record, input.tableId);
      const sidecar = projectSidecar(record, sidecarTargetCandidate);
      if (sidecar && sidecarTargetCandidate) {
        return { table: sidecar };
      }
      if (!record.markdown) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      const tableId = input.tableId;
      const table = findCanonicalTarget(record, tableId);
      if (!table) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      const projected = projectRecord(record, table, tableId);
      if (!projected) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      return { table: projected };
    },
  };
}

export type SteelReviewService = ReturnType<typeof createSteelReviewService>;

export function parseSteelReviewQuery(query: Record<string, unknown>): SteelReviewReadQuery {
  const result = steelReviewReadQuerySchema.safeParse(query);
  if (!result.success) {
    throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review table');
  }
  return result.data;
}
