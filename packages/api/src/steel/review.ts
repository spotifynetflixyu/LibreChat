import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  getSteelReviewTableId,
  steelReviewCommitSchema,
  steelReviewPrepareSchema,
  steelReviewReadQuerySchema,
} from 'librechat-data-provider';
import type {
  SteelReviewCell,
  SteelReviewKind,
  SteelReviewReadQuery,
  SteelReviewRow,
  SteelReviewSource,
  SteelReviewTable,
  SteelReviewPrepare,
  SteelReviewPrepared,
  SteelReviewCommit,
} from 'librechat-data-provider';
import type {
  SteelReviewCommitInput,
  SteelReviewCommitResult,
  SteelReviewReadInput,
  SteelReviewReadRecord,
} from '@librechat/data-schemas';
import { SteelReviewWriteError } from '@librechat/data-schemas';
import { parseMarkdownTables, type SteelMarkdownTable } from './markdown/table';

export interface SteelReviewReader {
  readSteelReview(input: SteelReviewReadInput): Promise<SteelReviewReadRecord | null>;
}

export interface SteelReviewWriter {
  commitSteelReview(input: SteelReviewCommitInput): Promise<SteelReviewCommitResult>;
}

type SteelReviewPrepareInput = SteelReviewPrepare & SteelReviewReadInput;
type SteelReviewCommitRequest = SteelReviewCommit & SteelReviewReadInput;

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

interface LocatedTable extends ReviewTableCandidate {
  start: number;
  end: number;
  raw: string;
}

function appendRenderedText(current: string, next: string): string {
  if (current.length > 0 && next.length > 0 && !current.endsWith(' ') && !next.startsWith(' ')) {
    return `${current} ${next}`;
  }
  return `${current}${next}`;
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

function collectLocatedTables(markdown: string): LocatedTable[] {
  const tables: LocatedTable[] = [];
  const lines = markdown.match(/[^\r\n]*(?:\r?\n|$)/gu) ?? [];
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
    const parsed = parseMarkdownTables(block.join('\n'));
    for (const table of parsed) {
      index += 1;
      const raw = markdown.slice(blockStart, blockEnd);
      tables.push({ ...table, index, title, start: blockStart, end: blockEnd, raw });
    }
    block = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r?\n$/u, '');
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
    ...(record.humanSavedAt ? { humanSavedAt: record.humanSavedAt.toISOString() } : {}),
    ...(record.humanSavedAt && isLatest ? { updated: true } : {}),
    ...(record.humanSavedAt && !isLatest ? { previousVersion: true } : {}),
    ...(record.aiRawMarkdown ? { aiRawMarkdown: record.aiRawMarkdown } : {}),
    ...(record.aiBaselineMarkdown ? { aiBaselineMarkdown: record.aiBaselineMarkdown } : {}),
    ...(record.humanMarkdown ? { humanMarkdown: record.humanMarkdown } : {}),
    ...(record.effectiveMarkdown ? { effectiveMarkdown: record.effectiveMarkdown } : {}),
    ...(record.displayMarkdown ? { displayMarkdown: record.displayMarkdown } : {}),
    ...(record.lastSave ? {
      lastSave: { ...record.lastSave, savedAt: record.lastSave.savedAt.toISOString() },
    } : {}),
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
    const cell = row.values[header];
    const value = cell?.effective ?? cell?.baseline;
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
    ...(record.humanSavedAt ? { humanSavedAt: record.humanSavedAt.toISOString() } : {}),
    ...(record.humanSavedAt && isLatest ? { updated: true } : {}),
    ...(record.humanSavedAt && !isLatest ? { previousVersion: true } : {}),
    ...(record.aiRawMarkdown ? { aiRawMarkdown: record.aiRawMarkdown } : {}),
    ...(record.aiBaselineMarkdown ? { aiBaselineMarkdown: record.aiBaselineMarkdown } : {}),
    ...(record.humanMarkdown ? { humanMarkdown: record.humanMarkdown } : {}),
    ...(record.effectiveMarkdown ? { effectiveMarkdown: record.effectiveMarkdown } : {}),
    ...(record.displayMarkdown ? { displayMarkdown: record.displayMarkdown } : {}),
    ...(record.lastSave ? {
      lastSave: { ...record.lastSave, savedAt: record.lastSave.savedAt.toISOString() },
    } : {}),
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

function fullMessageText(record: SteelReviewReadRecord): string | undefined {
  if (record.messageTextParts && record.messageTextParts.length > 0) {
    return record.messageTextParts
      .map((part) => part.text)
      .reduce((result, text) => appendRenderedText(result, text), '');
  }
  return record.messageText;
}

function locateReviewTarget(record: SteelReviewReadRecord, tableId: string): LocatedTable | undefined {
  if (record.messageTextParts && record.messageTextParts.length > 0) {
    let tableOffset = 0;
    for (const part of record.messageTextParts) {
      const localTables = collectLocatedTables(part.text);
      const target = localTables.find(
        (candidate) => getSteelReviewTableId(record.kind, candidate.index + tableOffset) === tableId,
      );
      if (target && isManagedTitle(record.kind, target.title)) {
        return {
          ...target,
          index: target.index + tableOffset,
          partIndex: part.partIndex,
          raw: part.text.slice(target.start, target.end),
        };
      }
      tableOffset += localTables.length;
    }
    return undefined;
  }
  const text = record.messageText;
  if (!text) {
    return undefined;
  }
  const target = collectLocatedTables(text).find(
    (candidate) => getSteelReviewTableId(record.kind, candidate.index) === tableId,
  );
  return target && isManagedTitle(record.kind, target.title) ? target : undefined;
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/[\r\n]+/gu, ' ');
}

function serializeReviewTable(headers: readonly string[], rows: readonly SteelReviewRow[]): string {
  const header = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${headers.map((name) => escapeMarkdownCell(row.values[name]?.effective ?? '')).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

function replaceTargetText(
  record: SteelReviewReadRecord,
  target: LocatedTable,
  replacement: string,
): string | undefined {
  if (record.messageTextParts && record.messageTextParts.length > 0 && target.partIndex !== undefined) {
    const parts = record.messageTextParts.map((part) => part.text);
    const selectedIndex = parts.findIndex((_part, index) => record.messageTextParts?.[index]?.partIndex === target.partIndex);
    if (selectedIndex < 0) {
      return undefined;
    }
    const selected = parts[selectedIndex];
    const next = `${selected.slice(0, target.start)}${replacement}${selected.slice(target.end)}`;
    parts[selectedIndex] = next;
    return parts.reduce((result, part) => appendRenderedText(result, part), '');
  }
  const text = fullMessageText(record);
  return text === undefined ? undefined : `${text.slice(0, target.start)}${replacement}${text.slice(target.end)}`;
}

function operationDigest(input: Omit<SteelReviewCommitInput, 'digest'>): string {
  const canonical = JSON.stringify({
    userId: input.userId,
    tenantId: input.tenantId ?? null,
    conversationId: input.conversationId,
    kind: input.kind,
    messageId: input.messageId,
    tableId: input.tableId,
    partIndex: input.partIndex ?? null,
    outputId: input.outputId,
    revision: input.revision,
    rows: input.rows,
    headers: input.headers,
    messageSha256: input.messageSha256,
    target: input.target,
    targetText: input.targetText,
    replacementText: input.replacementText,
    cleanReplacementText: input.cleanReplacementText,
    effectiveMarkdown: input.effectiveMarkdown,
    displayMarkdown: input.displayMarkdown,
    aiBaselineMarkdown: input.aiBaselineMarkdown ?? null,
    aiRawMarkdown: input.aiRawMarkdown ?? null,
    caption: input.caption,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function createSteelReviewService({
  reader,
  writer,
}: {
  reader: SteelReviewReader;
  writer?: SteelReviewWriter;
}) {
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

    async prepare(input: SteelReviewPrepareInput): Promise<SteelReviewPrepared> {
      const parsed = steelReviewPrepareSchema.safeParse(input);
      if (!parsed.success) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
      }
      const record = await reader.readSteelReview(input);
      if (!record || record.state !== 'current' || (record.latestOutputId ?? record.outputId) !== record.outputId ||
        record.outputId !== input.outputId || record.revision !== input.revision) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table is no longer current');
      }
      const target = locateReviewTarget(record, input.tableId);
      if (!target || target.partIndex !== input.partIndex && input.partIndex !== undefined) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table target not found');
      }
      const currentRows = record.rows ?? toRows(target, record.outputId, record.sourceMappings);
      if (currentRows.length !== input.rows.length ||
        currentRows.some((row, index) => row.rowId !== input.rows[index]?.rowId)) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review rows changed');
      }
      for (let index = 0; index < currentRows.length; index += 1) {
        const current = currentRows[index];
        const next = input.rows[index];
        if (!next || Object.keys(current.values).some((header) =>
          (current.values[header]?.baseline ?? null) !== (next.values[header]?.baseline ?? null))) {
          throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review AI baseline changed');
        }
      }
      const changedRowIds = input.rows
        .filter((row, index) => JSON.stringify(row.values) !== JSON.stringify(currentRows[index]?.values))
        .map((row) => row.rowId);
      const headers = record.headers ?? target.headers;
      const cleanReplacementText = serializeReviewTable(headers, input.rows);
      const effectiveMarkdown = replaceTargetText(record, target, cleanReplacementText);
      if (!effectiveMarkdown) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table target not found');
      }
      const fullText = fullMessageText(record);
      if (fullText === undefined) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review message not found');
      }
      const operationId = randomUUID();
      const operationBase: Omit<SteelReviewCommitInput, 'digest'> = {
        ...input,
        operationId,
        ...(target.partIndex !== undefined ? { partIndex: target.partIndex } : {}),
        headers,
        messageSha256: createHash('sha256').update(fullText).digest('hex'),
        target: {
          ...(target.partIndex !== undefined ? { partIndex: target.partIndex } : {}),
          start: target.start,
          end: target.end,
          sha256: createHash('sha256').update(target.raw).digest('hex'),
        },
        targetText: target.raw,
        replacementText: cleanReplacementText,
        cleanReplacementText,
        effectiveMarkdown,
        displayMarkdown: effectiveMarkdown,
        ...(record.aiBaselineMarkdown || record.markdown
          ? { aiBaselineMarkdown: record.aiBaselineMarkdown ?? record.markdown }
          : {}),
        ...(record.aiRawMarkdown || record.markdown
          ? { aiRawMarkdown: record.aiRawMarkdown ?? record.markdown }
          : {}),
        caption: {
          kind: input.kind,
          changedRows: changedRowIds.length,
          changedRowIds,
        },
      };
      return {
        ...input,
        ...operationBase,
        operationId,
        digest: operationDigest(operationBase),
        messageSha256: operationBase.messageSha256,
        target: operationBase.target,
        targetText: operationBase.targetText,
        replacementText: operationBase.replacementText,
        cleanReplacementText: operationBase.cleanReplacementText,
        headers: operationBase.headers,
        effectiveMarkdown: operationBase.effectiveMarkdown,
        displayMarkdown: operationBase.displayMarkdown,
        ...(operationBase.aiBaselineMarkdown ? { aiBaselineMarkdown: operationBase.aiBaselineMarkdown } : {}),
        ...(operationBase.aiRawMarkdown ? { aiRawMarkdown: operationBase.aiRawMarkdown } : {}),
        caption: operationBase.caption,
      };
    },

    async commit(input: SteelReviewCommitRequest): Promise<SteelReviewPrepared & { savedAt: string; changedRows: number; changedRowIds: string[] }> {
      const parsed = steelReviewCommitSchema.safeParse(input);
      if (!parsed.success) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
      }
      if (!writer) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Steel review save unavailable');
      }
      const expectedDigest = operationDigest(input);
      if (expectedDigest !== input.digest) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation digest mismatch');
      }
      try {
        const result = await writer.commitSteelReview(input);
        return {
          ...input,
          revision: result.revision,
          messageSha256: result.messageSha256,
          effectiveMarkdown: result.effectiveMarkdown,
          displayMarkdown: result.displayMarkdown,
          caption: {
            ...input.caption,
            changedRows: result.changedRows,
            changedRowIds: result.changedRowIds,
          },
          savedAt: result.savedAt.toISOString(),
          changedRows: result.changedRows,
          changedRowIds: result.changedRowIds,
        };
      } catch (error) {
        if (error instanceof SteelReviewWriteError) {
          throw error;
        }
        throw error;
      }
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
