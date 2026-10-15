import { createHash } from 'node:crypto';
import { SteelReviewWriteError } from '@librechat/data-schemas';
import {
  parseSteelReviewMarkdownTables,
  inferSteelReviewSystemState,
  initializeFreshSteelReviewSystemRows,
  convertSteelDimensionToMillimetres,
  normalizeSteelDecimal,
  isSteelSectionTitle,
} from 'librechat-data-provider';
import type {
  SteelReviewCell,
  SteelReviewKind,
  SteelReviewRow,
  SteelReviewSource,
  SteelReviewTable,
  SteelReviewReceipt,
  SteelReviewSavedSnapshot,
  SteelReviewSourceMapping,
  SteelReviewLedgerValidation,
  SteelCalculationCheckpoint,
} from 'librechat-data-provider';
import type { SteelReviewCommitResult, SteelReviewReadRecord } from '@librechat/data-schemas';
import type { SteelMarkdownTable } from '../markdown/table';
import type { MarkdownFence } from '../markdown/parser';
import { steelCatalogCustomerEvidenceForSnapshot } from '../catalog';
import { buildCustomerQuoteFromMarkdown } from '../markdown/quote';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { parseMarkdownTables } from '../markdown/table';
import { getFenceStart, closesFence, getH2Title } from '../markdown/parser';
import { SteelReviewReadError } from './errors';

interface ReviewTableCandidate extends SteelMarkdownTable {
  index: number;
  title?: string;
  partIndex?: number;
}

export interface LocatedTable extends ReviewTableCandidate {
  start: number;
  end: number;
  raw: string;
}

export function serializeSavedSnapshot(
  snapshot: NonNullable<SteelReviewCommitResult['snapshot']>,
): SteelReviewSavedSnapshot {
  const { ownerUpdated, savedAt, ...rest } = snapshot;
  return {
    ...rest,
    savedAt: savedAt.toISOString(),
    ...(ownerUpdated
      ? { ownerUpdated: { ...ownerUpdated, updatedAt: ownerUpdated.updatedAt.toISOString() } }
      : {}),
  };
}

function serializeReceipt(
  receipt: SteelReviewReadRecord['lastSave'],
): SteelReviewReceipt | undefined {
  if (!receipt) {
    return undefined;
  }
  const { snapshot, savedAt, ...rest } = receipt;
  return {
    ...rest,
    savedAt: savedAt.toISOString(),
    ...(snapshot ? { snapshot: serializeSavedSnapshot(snapshot) } : {}),
  };
}

function appendRenderedText(current: string, next: string): string {
  if (current.length > 0 && next.length > 0 && !current.endsWith(' ') && !next.startsWith(' ')) {
    return `${current} ${next}`;
  }
  return `${current}${next}`;
}

function isHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/u.test(line);
}

function isManagedTitle(kind: SteelReviewKind, title: string | undefined): boolean {
  if (!title) {
    return false;
  }
  return isSteelSectionTitle(title, kind === 'ocr_result' ? 'ocr_result' : 'system_order');
}

export function collectTables(markdown: string): ReviewTableCandidate[] {
  return parseSteelReviewMarkdownTables(markdown).map(({ headers, rows, index, title }) => ({
    headers,
    rows,
    index,
    title,
  }));
}

function collectLocatedTables(markdown: string): LocatedTable[] {
  return parseSteelReviewMarkdownTables(markdown).map(
    ({ headers, rows, index, title, start, end, raw }) => ({
      headers,
      rows,
      index,
      title,
      start,
      end,
      raw,
    }),
  );
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

function collectLocatedMessageTables(record: SteelReviewReadRecord): LocatedTable[] {
  if (!record.messageTextParts || record.messageTextParts.length === 0) {
    return record.messageText ? collectLocatedTables(record.messageText) : [];
  }
  let tableOffset = 0;
  return record.messageTextParts.flatMap((part) => {
    const localTables = collectLocatedTables(part.text);
    const tables = localTables.map((table) => ({
      ...table,
      index: table.index + tableOffset,
      partIndex: part.partIndex,
      raw: part.text.slice(table.start, table.end),
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

function hasCellProperty(
  cell: SteelReviewCell | undefined,
  property: keyof SteelReviewCell,
): boolean {
  return cell !== undefined && Object.prototype.hasOwnProperty.call(cell, property);
}

export function sameCellProperty(
  left: SteelReviewCell | undefined,
  leftProperty: keyof SteelReviewCell,
  right: SteelReviewCell | undefined,
  rightProperty: keyof SteelReviewCell,
): boolean {
  const leftHasProperty = hasCellProperty(left, leftProperty);
  const rightHasProperty = hasCellProperty(right, rightProperty);
  return (
    leftHasProperty === rightHasProperty &&
    (!leftHasProperty || left?.[leftProperty] === right?.[rightProperty])
  );
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
  const pageColumn = pageHeader(table.headers);
  const page = parsePageNumber(pageColumn ? row[table.headers.indexOf(pageColumn)] : undefined);
  return {
    fileId: mapping.fileId,
    pageNumber: page,
    filename: mapping.sourceFilename,
    ...(mapping.mediaType ? { mediaType: mapping.mediaType } : {}),
  };
}

export function createSteelReviewBaselineRows(
  table: SteelMarkdownTable,
  kind: SteelReviewKind,
  outputId: string,
  sourceMappings: SteelReviewReadRecord['sourceMappings'],
  calculationCheckpoint?: SteelCalculationCheckpoint,
): SteelReviewRow[] {
  const rows = table.rows.flatMap((row, rowIndex) => {
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
    const system =
      kind === 'system_order' ? inferSteelReviewSystemState(table.headers, row) : undefined;
    const checkpointRow =
      kind === 'system_order'
        ? calculationCheckpoint?.rows.find(
            (candidate) =>
              candidate.rowIndex === rowIndex &&
              candidate.candidate.erpItemCode === (row[table.headers.indexOf('型號')] ?? '') &&
              candidate.candidate.category === (row[table.headers.indexOf('類別')] ?? ''),
          )
        : undefined;
    return [
      {
        rowId,
        values,
        source: sourceForRow(table, row, sourceMappings),
        ...(system ? { system } : {}),
        ...(checkpointRow ? { calculation: { candidate: checkpointRow.candidate } } : {}),
      },
    ];
  });
  return kind === 'system_order' ? initializeFreshSteelReviewSystemRows(table.headers, rows) : rows;
}

export function createRecordBaselineRows(
  record: SteelReviewReadRecord,
  table: SteelMarkdownTable,
): SteelReviewRow[] {
  const rows = createSteelReviewBaselineRows(
    table,
    record.kind,
    record.outputId,
    record.sourceMappings,
    record.calculationCheckpoint,
  );
  const metadata = record.kind === 'system_order' ? record.reviewMetadata : undefined;
  if (!metadata || metadata.lineage.outputId !== record.outputId) return rows;
  const metadataById = new Map(metadata.rows.map((row) => [row.rowId, row]));
  return rows.map((row) => {
    const persisted = metadataById.get(row.rowId);
    return persisted
      ? { ...row, source: persisted.source, ocrLink: persisted.ocrLink ?? null }
      : row;
  });
}

export function projectRecord(
  record: SteelReviewReadRecord,
  table: ReviewTableCandidate,
  _tableId: string,
): SteelReviewTable | null {
  if (!isManagedTitle(record.kind, table.title)) {
    return null;
  }
  if (
    record.kind === 'ocr_result' &&
    (!table.headers.includes('來源') || !table.headers.includes('零件編號'))
  ) {
    return null;
  }
  const rows = createRecordBaselineRows(record, table);
  const catalogCustomer = steelCatalogCustomerEvidenceForSnapshot(record.customerSnapshot);
  const latestOutputId = record.latestOutputId ?? record.outputId;
  const isLatest = record.state === 'current' && latestOutputId === record.outputId;
  return {
    conversationId: record.conversationId,
    messageId: record.messageId,
    title: record.title ?? table.title!,
    outputId: record.outputId,
    kind: record.kind,
    revision: record.revision,
    latestOutputId,
    isLatest,
    readOnly: !isLatest,
    ...(record.humanSavedAt ? { humanSavedAt: record.humanSavedAt.toISOString() } : {}),
    ...(record.humanSavedAt && isLatest ? { updated: true } : {}),
    ...(!isLatest ? { previousVersion: true } : {}),
    ...(record.aiUpdatedAt ? { aiUpdatedAt: record.aiUpdatedAt.toISOString() } : {}),
    ...(record.ownerUpdated
      ? {
          ownerUpdated: {
            ...record.ownerUpdated,
            updatedAt: record.ownerUpdated.updatedAt.toISOString(),
          },
        }
      : {}),
    ...(record.needsRequote !== undefined ? { needsRequote: record.needsRequote } : {}),
    ...(record.requoteProvenance
      ? {
          requoteProvenance: {
            ...record.requoteProvenance,
            at: record.requoteProvenance.at.toISOString(),
          },
        }
      : {}),
    ...(record.aiRawMarkdown ? { aiRawMarkdown: record.aiRawMarkdown } : {}),
    ...(record.aiBaselineMarkdown ? { aiBaselineMarkdown: record.aiBaselineMarkdown } : {}),
    ...(record.humanMarkdown ? { humanMarkdown: record.humanMarkdown } : {}),
    ...(record.effectiveMarkdown ? { effectiveMarkdown: record.effectiveMarkdown } : {}),
    ...(record.displayMarkdown ? { displayMarkdown: record.displayMarkdown } : {}),
    ...(record.lastSave ? { lastSave: serializeReceipt(record.lastSave) } : {}),
    headers: table.headers,
    rows,
    ...(record.sourceMappings ? { sourceMappings: record.sourceMappings } : {}),
    ...(record.kind === 'system_order' && record.ocrContext
      ? { ocrContext: record.ocrContext }
      : {}),
    ...(catalogCustomer ? { catalogCustomer } : {}),
  };
}

export function sidecarTarget(
  record: SteelReviewReadRecord,
  _tableId: string,
  title: string,
): ReviewTableCandidate | undefined {
  if (
    (!record.messageText && (!record.messageTextParts || record.messageTextParts.length === 0)) ||
    record.headers === undefined ||
    record.rows === undefined
  ) {
    return undefined;
  }
  const rows = record.rows
    .filter((row) => !row.deleted)
    .map((row) =>
      record.headers!.map((header) => {
        const cell = row.values[header];
        const value =
          cell && Object.prototype.hasOwnProperty.call(cell, 'effective')
            ? cell.effective
            : undefined;
        if (value === null) {
          return '';
        }
        return typeof value === 'string' ? value : undefined;
      }),
    );
  if (rows.some((row) => row.some((value) => value === undefined))) {
    return undefined;
  }
  const expected: SteelMarkdownTable = { headers: record.headers, rows: rows as string[][] };
  const actualTables = collectMessageTables(record);
  const requested = actualTables.filter(
    (candidate) => candidate.title === title && isManagedTitle(record.kind, candidate.title),
  );
  if (requested.length !== 1 || !isManagedTitle(record.kind, requested[0]?.title)) {
    return undefined;
  }
  const [target] = requested;
  if (
    record.messageTextPartIndex !== undefined &&
    target.partIndex !== record.messageTextPartIndex
  ) {
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

export function projectSidecar(
  record: SteelReviewReadRecord,
  target?: ReviewTableCandidate,
): SteelReviewTable | null {
  if (!record.headers || !record.rows) {
    return null;
  }
  const catalogCustomer = steelCatalogCustomerEvidenceForSnapshot(record.customerSnapshot);
  const latestOutputId = record.latestOutputId ?? record.outputId;
  const isLatest =
    record.state === 'current' &&
    record.latestOutputId !== undefined &&
    latestOutputId === record.outputId;
  return {
    conversationId: record.conversationId,
    messageId: record.messageId,
    title: record.title ?? target?.title ?? '',
    outputId: record.outputId,
    kind: record.kind,
    revision: record.revision,
    latestOutputId,
    isLatest,
    readOnly: !isLatest,
    ...(record.humanSavedAt ? { humanSavedAt: record.humanSavedAt.toISOString() } : {}),
    ...(record.humanSavedAt && isLatest ? { updated: true } : {}),
    ...(!isLatest ? { previousVersion: true } : {}),
    ...(record.aiUpdatedAt ? { aiUpdatedAt: record.aiUpdatedAt.toISOString() } : {}),
    ...(record.ownerUpdated
      ? {
          ownerUpdated: {
            ...record.ownerUpdated,
            updatedAt: record.ownerUpdated.updatedAt.toISOString(),
          },
        }
      : {}),
    ...(record.needsRequote !== undefined ? { needsRequote: record.needsRequote } : {}),
    ...(record.requoteProvenance
      ? {
          requoteProvenance: {
            ...record.requoteProvenance,
            at: record.requoteProvenance.at.toISOString(),
          },
        }
      : {}),
    ...(record.aiRawMarkdown ? { aiRawMarkdown: record.aiRawMarkdown } : {}),
    ...(record.aiBaselineMarkdown ? { aiBaselineMarkdown: record.aiBaselineMarkdown } : {}),
    ...(record.humanMarkdown ? { humanMarkdown: record.humanMarkdown } : {}),
    ...(record.effectiveMarkdown ? { effectiveMarkdown: record.effectiveMarkdown } : {}),
    ...(record.displayMarkdown ? { displayMarkdown: record.displayMarkdown } : {}),
    ...(record.lastSave ? { lastSave: serializeReceipt(record.lastSave) } : {}),
    headers: record.headers,
    rows: record.rows,
    ...(record.sourceMappings ? { sourceMappings: record.sourceMappings } : {}),
    ...(record.kind === 'system_order' && record.ocrContext
      ? { ocrContext: record.ocrContext }
      : {}),
    ...(catalogCustomer ? { catalogCustomer } : {}),
  };
}

function sameTable(left: SteelMarkdownTable, right: SteelMarkdownTable): boolean {
  return (
    JSON.stringify(left.headers) === JSON.stringify(right.headers) &&
    JSON.stringify(left.rows) === JSON.stringify(right.rows)
  );
}

export function findCanonicalTarget(
  record: SteelReviewReadRecord,
  _tableId: string,
  title: string,
): ReviewTableCandidate | undefined {
  if (!record.markdown) {
    return undefined;
  }
  const canonicalTables = collectTables(record.markdown);
  if (!record.messageText && !record.messageTextParts) {
    return canonicalTables.find(
      (candidate) => candidate.title === title && isManagedTitle(record.kind, candidate.title),
    );
  }
  const messageTables = collectMessageTables(record);
  const requestedTables = messageTables.filter(
    (candidate) => candidate.title === title && isManagedTitle(record.kind, candidate.title),
  );
  if (
    requestedTables.length !== 1 ||
    (record.messageTextPartIndex !== undefined &&
      requestedTables[0]?.partIndex !== record.messageTextPartIndex)
  ) {
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

export function fullMessageText(record: SteelReviewReadRecord): string | undefined {
  if (record.messageText !== undefined) return record.messageText;
  if (record.messageTextParts && record.messageTextParts.length > 0) {
    return record.messageTextParts
      .map((part) => part.text)
      .reduce((result, text) => appendRenderedText(result, text), '');
  }
  return record.messageText;
}

function findVerifiedPhysicalTarget(
  record: SteelReviewReadRecord,
  expected: ReviewTableCandidate,
  _tableId: string,
  title: string,
): LocatedTable | undefined {
  const candidates = collectLocatedMessageTables(record).filter(
    (candidate) =>
      candidate.title === title &&
      candidate.title === expected.title &&
      sameTable(candidate, expected) &&
      (candidate.partIndex ?? null) === (expected.partIndex ?? null),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function findVerifiedSaveTarget(
  record: SteelReviewReadRecord,
  _tableId: string,
  title: string,
): LocatedTable | undefined {
  const expected =
    record.headers !== undefined && record.rows !== undefined
      ? sidecarTarget(record, record.tableId, title)
      : findCanonicalTarget(record, record.tableId, title);
  if (!expected) {
    return undefined;
  }
  return findVerifiedPhysicalTarget(record, expected, record.tableId, title);
}

export function serializeReviewTable(
  headers: readonly string[],
  rows: readonly SteelReviewRow[],
): string {
  const header = `| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(
    (row) =>
      `| ${headers.map((name) => escapeMarkdownTableCell(row.values[name]?.effective ?? '')).join(' | ')} |`,
  );
  return [header, separator, ...body].join('\n');
}

const SYSTEM_ORDER_DIMENSION_HEADERS = new Set(['厚度', '寬度', '長度', '肚']);
const SYSTEM_ORDER_DECIMAL_HEADERS = new Set(['數量', '單重', '總數', '單價']);

export function isValidSystemOrderCellValue(header: string, value: string): boolean {
  const text = value.trim();
  if (text === '') return true;
  if (SYSTEM_ORDER_DIMENSION_HEADERS.has(header)) {
    return convertSteelDimensionToMillimetres(text) !== undefined;
  }
  if (SYSTEM_ORDER_DECIMAL_HEADERS.has(header)) {
    return normalizeSteelDecimal(text) !== undefined;
  }
  return true;
}

export function quoteProjection(
  markdown: string | undefined,
): { markdown: string; rows: string[][]; total: string | null } | undefined {
  if (!markdown) {
    return undefined;
  }
  const quote = buildCustomerQuoteFromMarkdown(markdown);
  const quoteMarkdown = quote?.markdown ?? markdown;
  const table = parseMarkdownTables(quoteMarkdown)[0];
  if (!table) {
    return undefined;
  }
  const totalRow = table.rows[table.rows.length - 1];
  return {
    markdown: quoteMarkdown,
    rows: table.rows.slice(0, -1),
    total: totalRow?.[2] ?? null,
  };
}

function quoteRowProjection(headers: readonly string[], row: SteelReviewRow): string[] | undefined {
  return quoteProjection(`## system_order\n\n${serializeReviewTable(headers, [row])}`)?.rows[0];
}

export function countCustomerQuoteChangedRows(
  headers: readonly string[],
  currentRows: readonly SteelReviewRow[],
  nextRows: readonly SteelReviewRow[],
): number {
  const currentById = new Map(
    currentRows
      .filter((row) => !row.deleted)
      .map((row) => [row.rowId, quoteRowProjection(headers, row)]),
  );
  const nextById = new Map(
    nextRows
      .filter((row) => !row.deleted)
      .map((row) => [row.rowId, quoteRowProjection(headers, row)]),
  );
  const rowIds = new Set([...currentById.keys(), ...nextById.keys()]);
  let changed = 0;
  for (const rowId of rowIds) {
    if (
      JSON.stringify(currentById.get(rowId) ?? null) !== JSON.stringify(nextById.get(rowId) ?? null)
    ) {
      changed += 1;
    }
  }
  return changed;
}

function ownerMarkdown(record: SteelReviewReadRecord): string | undefined {
  return record.effectiveMarkdown ?? record.humanMarkdown ?? record.markdown;
}

function locateOwnerTarget(
  record: SteelReviewReadRecord,
  markdown: string,
  expected: LocatedTable,
): LocatedTable | undefined {
  const matches = collectLocatedTables(markdown).filter(
    (table) =>
      isManagedTitle(record.kind, table.title) &&
      table.title === expected.title &&
      sameTable(table, expected),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

interface LocatedHeading {
  start: number;
  title?: string;
}

function collectHeadings(markdown: string): LocatedHeading[] {
  const headings: LocatedHeading[] = [];
  const lines = markdown.match(/[^\r\n]*(?:\r?\n|$)/gu) ?? [];
  let fence: MarkdownFence | undefined;
  let offset = 0;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r?\n$/u, '');
    const start = offset;
    offset += rawLine.length;
    if (fence) {
      if (closesFence(line, fence)) {
        fence = undefined;
      }
      continue;
    }
    const nextFence = getFenceStart(line);
    if (nextFence) {
      fence = nextFence;
      continue;
    }
    if (isHeading(line)) {
      headings.push({ start, title: getH2Title(line) });
    }
  }
  return headings;
}

function ownedSection(
  record: SteelReviewReadRecord,
  markdown: string,
  expected: LocatedTable,
): string | undefined {
  const ownerTarget = locateOwnerTarget(record, markdown, expected);
  if (!ownerTarget) {
    return undefined;
  }
  const headings = collectHeadings(markdown);
  let headingIndex = -1;
  for (let index = 0; index < headings.length; index += 1) {
    if (headings[index].start <= ownerTarget.start) {
      headingIndex = index;
    }
  }
  if (headingIndex < 0 || !isManagedTitle(record.kind, headings[headingIndex]?.title)) {
    return undefined;
  }
  const heading = headings[headingIndex];
  const nextHeading = headings[headingIndex + 1];
  return markdown.slice(heading.start, nextHeading?.start ?? markdown.length).trimEnd();
}

export function replaceOwnerTarget(
  record: SteelReviewReadRecord,
  replacement: string,
  expected: LocatedTable,
): string | undefined {
  const markdown = ownerMarkdown(record);
  const section = markdown ? ownedSection(record, markdown, expected) : undefined;
  if (!section) {
    return undefined;
  }
  const target = locateOwnerTarget(record, section, expected);
  return target
    ? `${section.slice(0, target.start)}${replacement}${section.slice(target.end)}`
    : undefined;
}

export function sourceHeader(headers: readonly string[]): string | undefined {
  return (
    headers.find((header) => header === '來源') ??
    headers.find((header) => {
      const normalized = header
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/gu, '');
      return [
        'source',
        'sourcefile',
        'sourcefilename',
        'file',
        'filename',
        'originalfile',
        'originalfilename',
      ].includes(normalized);
    })
  );
}

function pageHeader(headers: readonly string[]): string | undefined {
  return (
    headers.find((header) => ['頁碼', '原檔頁碼', '原始頁碼', '來源頁碼'].includes(header)) ??
    headers.find((header) => {
      const normalized = header
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/gu, '');
      return ['page', 'pagenumber', 'sourcepage', 'originalpage', 'originalpagenumber'].includes(
        normalized,
      );
    })
  );
}

export function nextHumanSourceCode(
  mappings: readonly SteelReviewSourceMapping[],
  reservedCodes: readonly string[] = [],
): string {
  let next = BigInt(1);
  for (const code of [...mappings.map((mapping) => mapping.sourceCode), ...reservedCodes]) {
    const match = code.match(/^F([1-9]\d*)$/u);
    if (match) {
      const value = BigInt(match[1]);
      next = value >= next ? value + BigInt(1) : next;
    }
  }
  return `F${next.toString()}`;
}

export function uniqueSourceMappings(
  mappings: readonly SteelReviewSourceMapping[],
): SteelReviewSourceMapping[] {
  const byFile = new Map<string, SteelReviewSourceMapping>();
  const byCode = new Map<string, SteelReviewSourceMapping>();
  for (const mapping of mappings) {
    const priorFile = byFile.get(mapping.fileId);
    const priorCode = byCode.get(mapping.sourceCode);
    if (
      (priorFile && JSON.stringify(priorFile) !== JSON.stringify(mapping)) ||
      (priorCode && JSON.stringify(priorCode) !== JSON.stringify(mapping))
    ) {
      throw new SteelReviewWriteError(
        'REVIEW_INVALID_OPERATION',
        'Review source mapping is ambiguous',
      );
    }
    byFile.set(mapping.fileId, mapping);
    byCode.set(mapping.sourceCode, mapping);
  }
  return [...byFile.values()];
}

export function rowWithSource(
  row: SteelReviewRow,
  source: SteelReviewSource | null,
  headers: readonly string[],
  sourceCode?: string,
): SteelReviewRow {
  const values = Object.fromEntries(
    Object.entries(row.values).map(([header, cell]) => [header, { ...cell }]),
  );
  const sourceColumn = sourceHeader(headers);
  const pageColumn = pageHeader(headers);
  if (sourceColumn) {
    values[sourceColumn] = {
      ...values[sourceColumn],
      effective: sourceCode ?? '',
    };
  }
  if (pageColumn) {
    values[pageColumn] = {
      ...values[pageColumn],
      effective: source?.pageNumber === null || source === null ? '' : String(source.pageNumber),
    };
  }
  return { ...row, values, source };
}

export function throwLedgerValidationFailure(result: SteelReviewLedgerValidation): never {
  if (result.ok) {
    throw new Error('Expected a failed Steel review ledger validation');
  }
  if (result.code === 'existing-authority') {
    throw new SteelReviewReadError(
      'INVALID_REVIEW_QUERY',
      400,
      'Review row ledger authority changed',
    );
  }
  if (result.code === 'existing-insertion') {
    throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Existing review rows cannot move');
  }
  const messages: Record<string, string> = {
    'duplicate-id': 'Review row identity is duplicated',
    'existing-order': 'Review row order changed',
    'new-row-authority': 'New review rows require manual insertion authority',
    'insertion-anchor': 'Review insertion anchor is unavailable',
    'insertion-order': 'Review insertion order is ambiguous',
  };
  throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', messages[result.code]);
}
