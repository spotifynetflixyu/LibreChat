import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { SteelReviewWriteError } from '@librechat/data-schemas';
import {
  parseSteelReviewMarkdownTables,
  applySteelReviewOperations,
  encodeSteelReviewDigest,
  inferSteelReviewSystemState,
  initializeFreshSteelReviewSystemRows,
  isSteelReviewSourceAssociationHeader,
  normalizeSteelReviewLedgerRows,
  sameSteelReviewSource,
  steelReviewOperationCommitSchema,
  steelReviewOperationPrepareSchema,
  validateSteelReviewLedger,
  steelReviewReceiptQuerySchema,
  steelReviewReadQuerySchema,
  convertSteelDimensionToMillimetres,
  normalizeSteelDecimal,
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
  SteelReviewOperationPrepare,
  SteelReviewOperationCommit,
  SteelReviewLedgerRow,
  SteelReviewCommit,
  SteelReviewReceiptStatus,
  SteelReviewReceipt,
  SteelReviewConflict,
  SteelReviewRecovery,
  SteelReviewSavedSnapshot,
  SteelReviewSourceIntent,
  SteelReviewSourceMapping,
  SteelReviewLedgerValidation,
  SteelCalculationCheckpoint,
} from 'librechat-data-provider';
import type {
  SteelReviewCommitInput,
  SteelReviewCommitResult,
  SteelReviewReadInput,
  SteelReviewReadRecord,
  SteelReviewReceiptLookup,
} from '@librechat/data-schemas';
import type { SteelMarkdownTable } from './markdown/table';
import type { SteelReviewCatalogService } from './catalog';
import type { ServerRequest } from '~/types/http';
import { buildCustomerQuoteFromMarkdown } from './markdown/quote';
import { escapeMarkdownTableCell } from './markdown/row-codec';
import { reconcileSteelReviewOcrLinks } from './review/ocr';
import { parseMarkdownTables } from './markdown/table';
import { SteelReviewCatalogError } from './catalog';

export interface SteelReviewReader {
  readSteelReview(input: SteelReviewReadInput): Promise<SteelReviewReadRecord | null>;
}

export interface SteelReviewSourceIntentInput {
  userId: string;
  tenantId?: string;
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  fileId: string;
}

export interface SteelReviewSourceAuthority {
  readMetadata(input: SteelReviewSourceIntentInput): Promise<{
    fileId: string;
    filename: string;
    mediaType: string;
    pageCount?: number;
  } | null>;
  readPageCount(
    input: SteelReviewSourceIntentInput,
    request: ServerRequest,
  ): Promise<{ pageCount: number } | null>;
}

export interface SteelReviewWriter {
  commitSteelReview(input: SteelReviewCommitInput): Promise<SteelReviewCommitResult>;
  resolveSteelReviewReceipt?(input: SteelReviewCommitInput): Promise<SteelReviewCommitResult | null>;
  readSteelReviewReceipt?(input: SteelReviewReceiptLookup): Promise<SteelReviewCommitResult | null>;
}

type SteelReviewPrepareInput = SteelReviewOperationPrepare & SteelReviewReadInput & { sourceRequest?: ServerRequest };
type SteelReviewCommitRequest = SteelReviewOperationCommit & SteelReviewReadInput & {
  sourceRequest?: ServerRequest;
};
type SteelReviewInternalPrepare = {
  conversationId: string;
  messageId: string;
  tableId: string;
  partIndex?: number;
  kind: SteelReviewKind;
  outputId: string;
  revision: string;
  title: string;
  rows: SteelReviewRow[];
  sourceIntents?: SteelReviewSourceIntent[];
  selectionEvidence?: SteelReviewCommitInput['selectionEvidence'];
};
type SteelReviewTrustedProjection = Omit<SteelReviewCommitInput, 'digest'> & {
  digest: string;
  requestDigest?: string;
  operationRequest?: SteelReviewOperationPrepare;
};

type SteelReviewSourceMetadata = {
  fileId: string;
  filename: string;
  mediaType: string;
  pageCount?: number;
};

interface SteelReviewSourceEvidence {
  metadataByFile: Map<string, SteelReviewSourceMetadata | null>;
  pageCountsByFile: Map<string, { pageCount: number } | null>;
}

function isOperationCommit(payload: SteelReviewCommit): payload is SteelReviewOperationCommit {
  return Object.prototype.hasOwnProperty.call(payload, 'operations');
}

const operationIdentityKeys = new Set([
  'conversationId', 'messageId', 'title', 'kind', 'outputId', 'revision', 'operations',
  // These are injected by the authenticated route/service boundary, never by
  // the browser operation DTO.
  'userId', 'tenantId', 'sourceRequest',
]);

function assertOperationKeys(input: object, commit: boolean): void {
  const allowed = new Set(operationIdentityKeys);
  if (commit) {
    allowed.add('operationId');
    allowed.add('digest');
  }
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
  }
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

interface LocatedTable extends ReviewTableCandidate {
  start: number;
  end: number;
  raw: string;
}

function serializeSavedSnapshot(snapshot: NonNullable<SteelReviewCommitResult['snapshot']>): SteelReviewSavedSnapshot {
  const { ownerUpdated, savedAt, ...rest } = snapshot;
  return {
    ...rest,
    savedAt: savedAt.toISOString(),
    ...(ownerUpdated
      ? { ownerUpdated: { ...ownerUpdated, updatedAt: ownerUpdated.updatedAt.toISOString() } }
      : {}),
  };
}

function serializeReceipt(receipt: SteelReviewReadRecord['lastSave']): SteelReviewReceipt | undefined {
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
  const prefix = kind === 'ocr_result' ? 'ocr_result' : 'system_order';
  if (title === prefix) {
    return true;
  }
  const separator = title.indexOf('｜');
  return separator > 0 && title.slice(0, separator).trim() === prefix &&
    title.slice(separator + 1).trim() !== '';
}

function collectTables(markdown: string): ReviewTableCandidate[] {
  return parseSteelReviewMarkdownTables(markdown).map(({ headers, rows, index, title }) => ({
    headers,
    rows,
    index,
    title,
  }));
}

function collectLocatedTables(markdown: string): LocatedTable[] {
  return parseSteelReviewMarkdownTables(markdown).map(({ headers, rows, index, title, start, end, raw }) => ({
    headers,
    rows,
    index,
    title,
    start,
    end,
    raw,
  }));
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

function hasCellProperty(cell: SteelReviewCell | undefined, property: keyof SteelReviewCell): boolean {
  return cell !== undefined && Object.prototype.hasOwnProperty.call(cell, property);
}

function sameCellProperty(
  left: SteelReviewCell | undefined,
  leftProperty: keyof SteelReviewCell,
  right: SteelReviewCell | undefined,
  rightProperty: keyof SteelReviewCell,
): boolean {
  const leftHasProperty = hasCellProperty(left, leftProperty);
  const rightHasProperty = hasCellProperty(right, rightProperty);
  return leftHasProperty === rightHasProperty &&
    (!leftHasProperty || left?.[leftProperty] === right?.[rightProperty]);
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
    const system = kind === 'system_order' ? inferSteelReviewSystemState(table.headers, row) : undefined;
    const checkpointRow = kind === 'system_order'
      ? calculationCheckpoint?.rows.find((candidate) => candidate.rowIndex === rowIndex &&
        candidate.candidate.erpItemCode === (row[table.headers.indexOf('型號')] ?? '') &&
        candidate.candidate.category === (row[table.headers.indexOf('類別')] ?? ''))
      : undefined;
    return [{
      rowId,
      values,
      source: sourceForRow(table, row, sourceMappings),
      ...(system ? { system } : {}),
      ...(checkpointRow ? { calculation: { candidate: checkpointRow.candidate } } : {}),
    }];
  });
  return kind === 'system_order' ? initializeFreshSteelReviewSystemRows(table.headers, rows) : rows;
}

function createRecordBaselineRows(record: SteelReviewReadRecord, table: SteelMarkdownTable): SteelReviewRow[] {
  const rows = createSteelReviewBaselineRows(table, record.kind, record.outputId, record.sourceMappings, record.calculationCheckpoint);
  const metadata = record.kind === 'system_order' ? record.reviewMetadata : undefined;
  if (!metadata || metadata.lineage.outputId !== record.outputId) return rows;
  const metadataById = new Map(metadata.rows.map((row) => [row.rowId, row]));
  return rows.map((row) => {
    const persisted = metadataById.get(row.rowId);
    return persisted ? { ...row, source: persisted.source, ocrLink: persisted.ocrLink ?? null } : row;
  });
}

function projectRecord(
  record: SteelReviewReadRecord,
  table: ReviewTableCandidate,
  _tableId: string,
): SteelReviewTable | null {
  if (!isManagedTitle(record.kind, table.title)) {
    return null;
  }
  if (record.kind === 'ocr_result' &&
    (!table.headers.includes('來源') || !table.headers.includes('零件編號'))) {
    return null;
  }
  const rows = createRecordBaselineRows(record, table);
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
      ? { ownerUpdated: { ...record.ownerUpdated, updatedAt: record.ownerUpdated.updatedAt.toISOString() } }
      : {}),
    ...(record.needsRequote !== undefined ? { needsRequote: record.needsRequote } : {}),
    ...(record.requoteProvenance
      ? { requoteProvenance: { ...record.requoteProvenance, at: record.requoteProvenance.at.toISOString() } }
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
    ...(record.kind === 'system_order' && record.ocrContext ? { ocrContext: record.ocrContext } : {}),
  };
}

function sidecarTarget(
  record: SteelReviewReadRecord,
  _tableId: string,
  title: string,
): ReviewTableCandidate | undefined {
  if ((!record.messageText && (!record.messageTextParts || record.messageTextParts.length === 0)) ||
    record.headers === undefined || record.rows === undefined) {
    return undefined;
  }
  const rows = record.rows.filter((row) => !row.deleted).map((row) => record.headers!.map((header) => {
    const cell = row.values[header];
    const value = cell && Object.prototype.hasOwnProperty.call(cell, 'effective') ? cell.effective : undefined;
    if (value === null) {
      return '';
    }
    return typeof value === 'string' ? value : undefined;
  }));
  if (rows.some((row) => row.some((value) => value === undefined))) {
    return undefined;
  }
  const expected: SteelMarkdownTable = { headers: record.headers, rows: rows as string[][] };
  const actualTables = collectMessageTables(record);
  const requested = actualTables.filter((candidate) => candidate.title === title && isManagedTitle(record.kind, candidate.title));
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
      ? { ownerUpdated: { ...record.ownerUpdated, updatedAt: record.ownerUpdated.updatedAt.toISOString() } }
      : {}),
    ...(record.needsRequote !== undefined ? { needsRequote: record.needsRequote } : {}),
    ...(record.requoteProvenance
      ? { requoteProvenance: { ...record.requoteProvenance, at: record.requoteProvenance.at.toISOString() } }
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
    ...(record.kind === 'system_order' && record.ocrContext ? { ocrContext: record.ocrContext } : {}),
  };
}

function sameTable(left: SteelMarkdownTable, right: SteelMarkdownTable): boolean {
  return JSON.stringify(left.headers) === JSON.stringify(right.headers) &&
    JSON.stringify(left.rows) === JSON.stringify(right.rows);
}

function findCanonicalTarget(
  record: SteelReviewReadRecord,
  _tableId: string,
  title: string,
): ReviewTableCandidate | undefined {
  if (!record.markdown) {
    return undefined;
  }
  const canonicalTables = collectTables(record.markdown);
  if (!record.messageText && !record.messageTextParts) {
    return canonicalTables.find((candidate) => candidate.title === title && isManagedTitle(record.kind, candidate.title));
  }
  const messageTables = collectMessageTables(record);
  const requestedTables = messageTables.filter((candidate) => candidate.title === title && isManagedTitle(record.kind, candidate.title));
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

function findVerifiedPhysicalTarget(
  record: SteelReviewReadRecord,
  expected: ReviewTableCandidate,
  _tableId: string,
  title: string,
): LocatedTable | undefined {
  const candidates = collectLocatedMessageTables(record).filter((candidate) =>
    candidate.title === title &&
    candidate.title === expected.title &&
    sameTable(candidate, expected) &&
    (candidate.partIndex ?? null) === (expected.partIndex ?? null),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function findVerifiedSaveTarget(
  record: SteelReviewReadRecord,
  _tableId: string,
  title: string,
): LocatedTable | undefined {
  const expected = record.headers !== undefined && record.rows !== undefined
    ? sidecarTarget(record, record.tableId, title)
    : findCanonicalTarget(record, record.tableId, title);
  if (!expected) {
    return undefined;
  }
  return findVerifiedPhysicalTarget(record, expected, record.tableId, title);
}

function serializeReviewTable(headers: readonly string[], rows: readonly SteelReviewRow[]): string {
  const header = `| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${headers.map((name) => escapeMarkdownTableCell(row.values[name]?.effective ?? '')).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

const SYSTEM_ORDER_DIMENSION_HEADERS = new Set(['厚度', '寬度', '長度', '肚']);
const SYSTEM_ORDER_DECIMAL_HEADERS = new Set(['數量', '單重', '總數', '單價']);

function isValidSystemOrderCellValue(header: string, value: string): boolean {
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

function quoteProjection(markdown: string | undefined): { markdown: string; rows: string[][]; total: string | null } | undefined {
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

function countCustomerQuoteChangedRows(
  headers: readonly string[],
  currentRows: readonly SteelReviewRow[],
  nextRows: readonly SteelReviewRow[],
): number {
  const currentById = new Map(currentRows
    .filter((row) => !row.deleted)
    .map((row) => [row.rowId, quoteRowProjection(headers, row)]));
  const nextById = new Map(nextRows
    .filter((row) => !row.deleted)
    .map((row) => [row.rowId, quoteRowProjection(headers, row)]));
  const rowIds = new Set([...currentById.keys(), ...nextById.keys()]);
  let changed = 0;
  for (const rowId of rowIds) {
    if (JSON.stringify(currentById.get(rowId) ?? null) !== JSON.stringify(nextById.get(rowId) ?? null)) {
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
  const matches = collectLocatedTables(markdown).filter((table) =>
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
    const nextFence = getFence(line);
    if (nextFence) {
      fence = nextFence;
      continue;
    }
    if (isHeading(line)) {
      headings.push({ start, title: headingTitle(line) });
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

function replaceOwnerTarget(
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
  return target ? `${section.slice(0, target.start)}${replacement}${section.slice(target.end)}` : undefined;
}

function sourceHeader(headers: readonly string[]): string | undefined {
  return headers.find((header) => header === '來源') ?? headers.find((header) => {
    const normalized = header.trim().toLowerCase().replace(/[\s_]+/gu, '');
    return ['source', 'sourcefile', 'sourcefilename', 'file', 'filename', 'originalfile', 'originalfilename']
      .includes(normalized);
  });
}

function pageHeader(headers: readonly string[]): string | undefined {
  return headers.find((header) => ['頁碼', '原檔頁碼', '原始頁碼', '來源頁碼'].includes(header)) ?? headers.find((header) => {
    const normalized = header.trim().toLowerCase().replace(/[\s_]+/gu, '');
    return ['page', 'pagenumber', 'sourcepage', 'originalpage', 'originalpagenumber'].includes(normalized);
  });
}

function nextHumanSourceCode(
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

function uniqueSourceMappings(mappings: readonly SteelReviewSourceMapping[]): SteelReviewSourceMapping[] {
  const byFile = new Map<string, SteelReviewSourceMapping>();
  const byCode = new Map<string, SteelReviewSourceMapping>();
  for (const mapping of mappings) {
    const priorFile = byFile.get(mapping.fileId);
    const priorCode = byCode.get(mapping.sourceCode);
    if ((priorFile && JSON.stringify(priorFile) !== JSON.stringify(mapping)) ||
      (priorCode && JSON.stringify(priorCode) !== JSON.stringify(mapping))) {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source mapping is ambiguous');
    }
    byFile.set(mapping.fileId, mapping);
    byCode.set(mapping.sourceCode, mapping);
  }
  return [...byFile.values()];
}

function rowWithSource(
  row: SteelReviewRow,
  source: SteelReviewSource | null,
  headers: readonly string[],
  sourceCode?: string,
): SteelReviewRow {
  const values = Object.fromEntries(Object.entries(row.values).map(([header, cell]) => [header, { ...cell }]));
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

function throwLedgerValidationFailure(result: SteelReviewLedgerValidation): never {
  if (result.ok) {
    throw new Error('Expected a failed Steel review ledger validation');
  }
  if (result.code === 'existing-authority') {
    throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review row ledger authority changed');
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

export function createSteelReviewService({
  reader,
  writer,
  sourceAuthority,
  catalogService,
}: {
  reader: SteelReviewReader;
  writer?: SteelReviewWriter;
  sourceAuthority?: SteelReviewSourceAuthority;
  catalogService?: SteelReviewCatalogService;
}) {
  function parsePreparePayload(input: SteelReviewPrepareInput): SteelReviewPrepare {
    assertOperationKeys(input, false);
    const operationInput = input as SteelReviewOperationPrepare;
    const parsed = steelReviewOperationPrepareSchema.safeParse({
      conversationId: operationInput.conversationId,
      messageId: operationInput.messageId,
      title: operationInput.title,
      kind: operationInput.kind,
      outputId: operationInput.outputId,
      revision: operationInput.revision,
      operations: operationInput.operations,
    });
    if (!parsed.success) {
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
    }
    return parsed.data;
  }

  function parseCommitPayload(input: SteelReviewCommitRequest): SteelReviewCommit {
    assertOperationKeys(input, true);
    const operationInput = input as SteelReviewOperationCommit;
    const parsed = steelReviewOperationCommitSchema.safeParse({
      conversationId: operationInput.conversationId,
      messageId: operationInput.messageId,
      title: operationInput.title,
      kind: operationInput.kind,
      outputId: operationInput.outputId,
      revision: operationInput.revision,
      operations: operationInput.operations,
      operationId: operationInput.operationId,
      digest: operationInput.digest,
    });
    if (!parsed.success) {
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
    }
    return parsed.data;
  }

  function operationRequestDigest(
    payload: SteelReviewOperationPrepare,
    scope: Pick<SteelReviewReadInput, 'userId' | 'tenantId'>,
  ): string {
    return createHash('sha256')
      .update(encodeSteelReviewDigest({
        userId: scope.userId,
        tenantId: scope.tenantId ?? null,
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        kind: payload.kind,
        title: payload.title,
        outputId: payload.outputId,
        revision: payload.revision,
        operationId: '',
        operations: payload.operations,
      }))
      .digest('hex');
  }

  function operationIntentDigest(
    payload: SteelReviewOperationPrepare,
    operationId: string,
    scope: Pick<SteelReviewReadInput, 'userId' | 'tenantId'>,
    selectionEvidence?: SteelReviewCommitInput['selectionEvidence'],
  ): string {
    return createHash('sha256')
      .update(encodeSteelReviewDigest({
        userId: scope.userId,
        tenantId: scope.tenantId ?? null,
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        kind: payload.kind,
        title: payload.title,
        outputId: payload.outputId,
        revision: payload.revision,
        operationId,
        operations: payload.operations,
        ...(selectionEvidence ? { selectionEvidence } : {}),
      }))
      .digest('hex');
  }

  function operationPreparedFromReceipt(
    payload: SteelReviewOperationCommit,
    result: SteelReviewCommitResult,
  ): SteelReviewPrepared {
    const snapshot = result.snapshot;
    if (!snapshot || !snapshot.target || snapshot.targetText === undefined ||
      snapshot.replacementText === undefined || snapshot.cleanReplacementText === undefined ||
      !snapshot.caption || snapshot.requestDigest === undefined) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review operation receipt snapshot is incomplete');
    }
    const { operationId: _operationId, digest: _digest, ...operationRequest } = payload;
    return {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      title: payload.title,
      kind: payload.kind,
      outputId: snapshot.outputId,
      revision: snapshot.revision,
      headers: snapshot.headers,
      operationId: result.operationId,
      digest: result.digest,
      messageSha256: snapshot.messageSha256,
      target: snapshot.target,
      targetText: snapshot.targetText,
      replacementText: snapshot.replacementText,
      cleanReplacementText: snapshot.cleanReplacementText,
      rows: snapshot.rows,
      effectiveMarkdown: snapshot.effectiveMarkdown,
      displayMarkdown: snapshot.displayMarkdown,
      ...(snapshot.aiBaselineMarkdown ? { aiBaselineMarkdown: snapshot.aiBaselineMarkdown } : {}),
      ...(snapshot.aiRawMarkdown ? { aiRawMarkdown: snapshot.aiRawMarkdown } : {}),
      sourceMappings: snapshot.sourceMappings ?? [],
      ...(snapshot.selectionEvidence ? { selectionEvidence: snapshot.selectionEvidence } : {}),
      caption: snapshot.caption,
      operations: payload.operations,
      operationRequest,
      requestDigest: snapshot.requestDigest,
    } as SteelReviewPrepared;
  }

  function operationExpectedRows(
    record: SteelReviewReadRecord,
    payload: SteelReviewOperationPrepare,
    target: LocatedTable,
    currentRows: SteelReviewLedgerRow[],
  ): SteelReviewLedgerRow[] | undefined {
    if (record.revision === payload.revision) {
      return currentRows.map((row) => ({ ...row, values: { ...row.values } }));
    }
    const matchingSnapshots = (record.receipts ?? [])
      .filter((receipt) => receipt.revision === payload.revision && receipt.snapshot)
      .flatMap((receipt) => receipt.snapshot ? [receipt.snapshot] : [])
      .filter((snapshot) => snapshot.outputId === record.outputId &&
        JSON.stringify(snapshot.headers) === JSON.stringify(target.headers));
    if (matchingSnapshots.length === 1) {
      return normalizeSteelReviewLedgerRows(matchingSnapshots[0].rows);
    }
    if (matchingSnapshots.length > 1) {
      return undefined;
    }
    const initialOutputId = `ocr_result:${payload.revision}`;
    const isInitialOcrRevision = record.kind === 'ocr_result' && record.outputId === initialOutputId;
    const isSystemOrderBaseline = record.kind === 'system_order' &&
      record.aiBaselineMarkdown !== undefined &&
      createHash('sha256').update(record.aiBaselineMarkdown).digest('hex') === payload.revision;
    if (!isInitialOcrRevision && !isSystemOrderBaseline) {
      return undefined;
    }
    const initialMarkdown = record.aiBaselineMarkdown ?? record.markdown;
    if (!initialMarkdown) {
      return undefined;
    }
    const initialTables = collectTables(initialMarkdown).filter((candidate) =>
      candidate.title === payload.title &&
      candidate.title === target.title &&
      JSON.stringify(candidate.headers) === JSON.stringify(target.headers),
    );
    if (initialTables.length !== 1) {
      return undefined;
    }
    return normalizeSteelReviewLedgerRows(createRecordBaselineRows(record, initialTables[0]));
  }

  function operationRecovery(
    record: SteelReviewReadRecord,
    payload: SteelReviewOperationPrepare,
    target: LocatedTable,
    currentRows: readonly SteelReviewLedgerRow[],
    conflicts: readonly SteelReviewConflict[],
  ): SteelReviewRecovery {
    const latestOutputId = record.latestOutputId ?? record.outputId;
    return {
      table: {
        conversationId: record.conversationId,
        messageId: record.messageId,
        title: record.title ?? payload.title,
        outputId: record.outputId,
        kind: record.kind,
        revision: record.revision,
        latestOutputId,
        isLatest: record.state === 'current' && latestOutputId === record.outputId,
        readOnly: record.state !== 'current' || latestOutputId !== record.outputId,
        headers: target.headers,
        rows: [...currentRows],
        effectiveMarkdown: record.effectiveMarkdown ?? record.humanMarkdown ?? record.markdown ?? '',
        ...(record.humanSavedAt ? { humanSavedAt: record.humanSavedAt.toISOString() } : {}),
        ...(record.aiRawMarkdown ? { aiRawMarkdown: record.aiRawMarkdown } : {}),
        ...(record.aiBaselineMarkdown ? { aiBaselineMarkdown: record.aiBaselineMarkdown } : {}),
        ...(record.sourceMappings ? { sourceMappings: record.sourceMappings } : {}),
        ...(record.kind === 'system_order' && record.ocrContext ? { ocrContext: record.ocrContext } : {}),
      },
      conflicts: [...conflicts],
    };
  }

  async function loadSourceEvidence(
    scope: SteelReviewPrepareInput,
    payload: SteelReviewOperationPrepare,
  ): Promise<SteelReviewSourceEvidence> {
    const metadataByFile = new Map<string, SteelReviewSourceMetadata | null>();
    const pageCountsByFile = new Map<string, { pageCount: number } | null>();
    if (!sourceAuthority) {
      return { metadataByFile, pageCountsByFile };
    }
    const sourceInputs = new Map<string, SteelReviewSourceIntentInput>();
    for (const operation of payload.operations) {
      const source = operation.type === 'add' || operation.type === 'update'
        ? operation.source
        : undefined;
      if (!source || source.fileId === null || sourceInputs.has(source.fileId)) {
        continue;
      }
      sourceInputs.set(source.fileId, {
        userId: scope.userId,
        ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
        conversationId: scope.conversationId,
        messageId: payload.messageId,
        kind: payload.kind,
        fileId: source.fileId,
      });
    }
    const metadataResults = await Promise.all([...sourceInputs.entries()].map(async ([fileId, sourceInput]) =>
      [fileId, await sourceAuthority.readMetadata(sourceInput)] as const));
    for (const [fileId, metadata] of metadataResults) {
      metadataByFile.set(fileId, metadata);
      if (metadata?.pageCount !== undefined) {
        pageCountsByFile.set(fileId, { pageCount: metadata.pageCount });
      }
    }
    if (!scope.sourceRequest) {
      return { metadataByFile, pageCountsByFile };
    }
    const pageInputs = [...sourceInputs.entries()].filter(([fileId]) => {
      const metadata = metadataByFile.get(fileId);
      return metadata !== null && metadata !== undefined && metadata.pageCount === undefined && !metadata.mediaType.toLowerCase().startsWith('image/') &&
        payload.operations.some((operation) => {
          const source = operation.type === 'add' || operation.type === 'update'
            ? operation.source
            : undefined;
          return source?.fileId === fileId && source.pageNumber !== null && source.pageNumber !== undefined;
        });
    });
    const pageResults = await Promise.all(pageInputs.map(async ([fileId, sourceInput]) =>
      [fileId, await sourceAuthority.readPageCount(sourceInput, scope.sourceRequest!)] as const));
    for (const [fileId, pageCount] of pageResults) {
      pageCountsByFile.set(fileId, pageCount);
    }
    return { metadataByFile, pageCountsByFile };
  }

  async function buildTrustedOperationPrepared(
    scope: SteelReviewPrepareInput,
    payload: SteelReviewOperationPrepare,
    operationId: string,
    trustedRecord?: SteelReviewReadRecord,
    sourceEvidence?: SteelReviewSourceEvidence,
  ): Promise<SteelReviewTrustedProjection> {
    const record = trustedRecord ?? await reader.readSteelReview(scope);
    if (!record || record.state !== 'current' || (record.latestOutputId ?? record.outputId) !== record.outputId ||
      record.outputId !== payload.outputId) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table is no longer current');
    }
    if (record.title !== payload.title) {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review title authority changed');
    }
    const target = findVerifiedSaveTarget(record, record.tableId, payload.title);
    if (!target) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table target not found');
    }
    const currentRows = normalizeSteelReviewLedgerRows(record.rows ?? createRecordBaselineRows(record, target));
    const headers = record.headers ?? target.headers;
    const expectedRows = operationExpectedRows(record, payload, target, currentRows);
    if (!expectedRows) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review expected version is unavailable');
    }
    const materialCandidates = new Map<string, NonNullable<Awaited<ReturnType<SteelReviewCatalogService['resolve']>>>['candidate']>();
    const processingCandidates = new Map<string, NonNullable<Awaited<ReturnType<SteelReviewCatalogService['resolve']>>>['candidate']>();
    const selectionEvidence: NonNullable<SteelReviewCommitInput['selectionEvidence']> = [];
    for (const operation of payload.operations) {
      if (operation.type !== 'replace_material' && operation.type !== 'replace_processing') continue;
      if (payload.kind !== 'system_order' || !catalogService) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Material catalog selection is unavailable');
      }
      try {
        const resolved = await catalogService.resolve({
          scope: {
            userId: scope.userId,
            ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
            conversationId: scope.conversationId,
          },
          messageId: payload.messageId,
          title: payload.title,
          outputId: payload.outputId,
          // Catalog authorization follows the transaction-current review. The
          // operation's captured revision remains bound by the review ledger
          // conflict checks and operation digest.
          revision: record.revision,
          rowId: operation.rowId,
          kind: operation.type === 'replace_processing' ? 'processing' : 'material',
          selection: operation.selection,
        });
        if (operation.type === 'replace_processing') {
          processingCandidates.set(operation.rowId, resolved.candidate);
        } else {
          materialCandidates.set(operation.rowId, resolved.candidate);
        }
        selectionEvidence.push(resolved.evidence);
      } catch (error) {
        if (error instanceof SteelReviewCatalogError) {
          throw new SteelReviewWriteError(error.code === 'CATALOG_CHANGED' ? 'CATALOG_CHANGED' : 'REVIEW_INVALID_OPERATION', error.message);
        }
        throw error;
      }
    }
    const stagedExpectedKinds = new Map(expectedRows.map((row) => [row.rowId, row.system?.kind] as const));
    const sourceIntents: SteelReviewSourceIntent[] = [];
    for (const operation of payload.operations) {
      if (operation.type === 'add' && operation.source) {
        sourceIntents.push({
          rowId: operation.rowId,
          fileId: operation.source.fileId,
          pageNumber: operation.source.pageNumber,
        });
      } else if (operation.type === 'update' && operation.source) {
        sourceIntents.push({
          rowId: operation.rowId,
          fileId: operation.source.fileId,
          pageNumber: operation.source.pageNumber,
        });
      }
    }
    for (const operation of payload.operations) {
      let changes: Array<{ header: string; value: string | null }> = [];
      if (operation.type === 'add') {
        changes = operation.changes;
      } else if (operation.type === 'update') {
        changes = operation.changes ?? [];
      }
      if (changes.some((change) => !headers.includes(change.header) ||
        isSteelReviewSourceAssociationHeader(change.header))) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review row column is read-only');
      }
      const stagedKind = stagedExpectedKinds.get(operation.rowId);
      const operationSource = operation.type === 'add' || operation.type === 'update' ? operation.source : undefined;
      const hasMeasurement = (operation.type === 'add' || operation.type === 'update') &&
        Object.prototype.hasOwnProperty.call(operation, 'measurement');
      if (hasMeasurement && (payload.kind !== 'system_order' ||
        (operation.type === 'add' ? operation.system?.kind : stagedKind) !== 'processing')) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Only processing rows may use a measurement');
      }
      if (payload.kind !== 'system_order' && (
        (operation.type === 'add' && operation.system !== undefined) ||
        operation.type === 'classify' ||
        (operation.type === 'update' && operation.binding !== undefined)
      )) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'System row identity is unavailable for OCR results');
      }
      if (payload.kind === 'system_order' && operation.type === 'add' && !operation.system) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'System rows require an explicit kind');
      }
      if (payload.kind === 'system_order' && operation.type === 'classify' && stagedKind !== 'unassigned') {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Only unassigned rows may be classified');
      }
      if (payload.kind === 'system_order' && operation.type === 'update' && operation.binding !== undefined &&
        stagedKind !== 'processing') {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Only processing rows may be bound');
      }
      if (payload.kind === 'system_order' && operationSource !== undefined &&
        operation.type === 'update' && stagedKind === 'processing') {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Processing source follows its material');
      }
      if (payload.kind === 'system_order' && operationSource !== undefined &&
        operation.type === 'add' && operation.system?.kind === 'processing') {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Processing source follows its material');
      }
      if (payload.kind === 'system_order' && changes.some((change) =>
        !isValidSystemOrderCellValue(change.header, change.value ?? ''))) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'System-order numeric input is invalid');
      }
      if (operation.type === 'add' && operation.system) {
        stagedExpectedKinds.set(operation.rowId, operation.system.kind);
      } else if (operation.type === 'classify') {
        stagedExpectedKinds.set(operation.rowId, operation.system.kind);
      }
    }
    const applied = applySteelReviewOperations({
      currentRows,
      expectedRows,
      headers,
      operations: payload.operations,
      ...(materialCandidates.size > 0 ? { materialCandidates } : {}),
      ...(processingCandidates.size > 0 ? { processingCandidates } : {}),
    });
    if (!applied.ok) {
      throw new SteelReviewWriteError(
        'REVIEW_CONFLICT',
        'Review changes conflict with the latest saved table',
        operationRecovery(record, payload, target, currentRows, applied.conflicts),
      );
    }
    const stagedRows = applied.currentRows;
    const trustedSourceEvidence = sourceEvidence ?? await loadSourceEvidence(scope, payload);
    const fullPayload: SteelReviewInternalPrepare = {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      tableId: record.tableId,
      ...(target.partIndex !== undefined ? { partIndex: target.partIndex } : {}),
      title: payload.title,
      kind: payload.kind,
      outputId: payload.outputId,
      // The full trusted preview is based on the transaction-current record.
      // Keep the client's captured revision in the operation request and intent
      // digest; the legacy internal projection must use the current owner
      // revision so the writer can persist the merged snapshot.
      revision: record.revision,
      rows: stagedRows,
      ...(sourceIntents.length > 0 ? { sourceIntents } : {}),
      ...(selectionEvidence.length > 0 ? { selectionEvidence } : {}),
    };
    const prepared = await buildTrustedInternalPrepared(scope, fullPayload, operationId, record, trustedSourceEvidence);
    return {
      ...prepared,
      operationRequest: payload,
      digest: operationIntentDigest(payload, operationId, scope, selectionEvidence),
      requestDigest: operationRequestDigest(payload, scope),
      ...(selectionEvidence.length > 0 ? { selectionEvidence } : {}),
    };
  }

  async function buildTrustedInternalPrepared(
    scope: SteelReviewPrepareInput,
    payload: SteelReviewInternalPrepare,
    operationId: string,
    trustedRecord?: SteelReviewReadRecord,
    sourceEvidence?: SteelReviewSourceEvidence,
  ): Promise<Omit<SteelReviewTrustedProjection, 'digest'>> {
    const record = trustedRecord ?? await reader.readSteelReview(scope);
    if (!record || record.state !== 'current' || (record.latestOutputId ?? record.outputId) !== record.outputId ||
      record.outputId !== payload.outputId) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table is no longer current');
    }
    if (record.revision !== payload.revision) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review table is no longer current');
    }
    if (payload.title && record.title !== payload.title) {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review title authority changed');
    }
    const target = findVerifiedSaveTarget(record, payload.tableId, payload.title);
    if (payload.title && record.tableId !== payload.tableId) {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review storage identity changed');
    }
    if (!target || target.partIndex !== payload.partIndex && payload.partIndex !== undefined) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table target not found');
    }
    const currentRows = record.rows ?? createRecordBaselineRows(record, target);
    const headers = record.headers ?? target.headers;
    const remarksBindingMode = payload.kind === 'system_order' && headers.includes('備註');
    const ledgerValidation = validateSteelReviewLedger(currentRows, payload.rows, headers);
    if (!ledgerValidation.ok) {
      throwLedgerValidationFailure(ledgerValidation);
    }
    const { currentRows: trustedCurrentRows, submittedRows, orderedRows } = ledgerValidation;
    const sourceIntents = payload.sourceIntents ?? [];
    const intentsByRow = new Map<string, SteelReviewSourceIntent>();
    for (const intent of sourceIntents) {
      if (intentsByRow.has(intent.rowId)) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source intent is duplicated');
      }
      intentsByRow.set(intent.rowId, intent);
    }
    const sourceMappings = [
      ...(record.trustedSourceMappings ?? record.sourceMappings ?? []),
      ...(record.sourceMappingReservations ?? []),
    ];
    const trustedSourceMappings = [...(record.trustedSourceMappings ?? record.sourceMappings ?? [])];
    const sourceColumn = sourceHeader(headers);
    const sourceCodeReservations = trustedCurrentRows.flatMap((row) => {
      const sourceCode = sourceColumn ? row.values[sourceColumn]?.effective?.trim() : undefined;
      return sourceCode?.match(/^F[1-9]\d*$/u) ? [sourceCode] : [];
    });
    const metadataByFile = sourceEvidence?.metadataByFile ??
      new Map<string, SteelReviewSourceMetadata | null>();
    const pageCountsByFile = sourceEvidence?.pageCountsByFile ?? new Map<string, { pageCount: number } | null>();
    const metadataInputs = new Map<string, SteelReviewSourceIntentInput>();
    for (const intent of sourceIntents) {
      if (intent.fileId === null || metadataInputs.has(intent.fileId)) {
        continue;
      }
      metadataInputs.set(intent.fileId, {
        userId: scope.userId,
        ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
        conversationId: scope.conversationId,
        messageId: payload.messageId,
        kind: payload.kind,
        fileId: intent.fileId,
      });
    }
    if (!sourceEvidence && sourceAuthority && metadataInputs.size > 0) {
      const metadataResults = await Promise.all([...metadataInputs.entries()].map(async ([fileId, sourceInput]) =>
        [fileId, await sourceAuthority.readMetadata(sourceInput)] as const));
      for (const [fileId, metadata] of metadataResults) {
        metadataByFile.set(fileId, metadata);
        if (metadata?.pageCount !== undefined) {
          pageCountsByFile.set(fileId, { pageCount: metadata.pageCount });
        }
      }
    }
    if (!sourceEvidence && sourceAuthority && scope.sourceRequest) {
      const pageInputs = [...metadataInputs.entries()].filter(([fileId]) => {
        const metadata = metadataByFile.get(fileId);
        return metadata !== null && metadata?.pageCount === undefined && [...intentsByRow.values()].some((intent) =>
          intent.fileId === fileId && intent.pageNumber !== null &&
          !metadata?.mediaType.toLowerCase().startsWith('image/'));
      });
      const pageResults = await Promise.all(pageInputs.map(async ([fileId, sourceInput]) =>
        [fileId, await sourceAuthority.readPageCount(sourceInput, scope.sourceRequest!)] as const));
      for (const [fileId, pageCount] of pageResults) {
        pageCountsByFile.set(fileId, pageCount);
      }
    }
    const canonicalRows = [] as SteelReviewRow[];
    const knownRowIds = new Set(trustedCurrentRows.map((row) => row.rowId));
    const submittedRowIds = new Set(submittedRows.map((row) => row.rowId));
    if ([...intentsByRow.keys()].some((rowId) => !submittedRowIds.has(rowId))) {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source row is unavailable');
    }
    for (const current of orderedRows) {
      const next = submittedRows.find((row) => row.rowId === current.rowId) ?? current;
      const isNewRow = !knownRowIds.has(current.rowId);
      const baselineChanged = Object.keys(current.values).some((header) =>
        (current.values[header]?.baseline ?? null) !== (next?.values[header]?.baseline ?? null));
      if (!next || (!isNewRow && baselineChanged)) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review AI baseline changed');
      }
      if (!next || Object.keys(next.values).some((header) => !Object.prototype.hasOwnProperty.call(current.values, header))) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review columns changed');
      }
      const intent = intentsByRow.get(current.rowId);
      if (intent && next.system?.kind === 'processing') {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Processing source follows its material');
      }
      if (!intent) {
        if (isNewRow && next.source !== null && next.system?.kind !== 'processing') {
          throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'New review source selection is invalid');
        }
        if (next.system?.kind !== 'processing' && headers.some((header) => isSteelReviewSourceAssociationHeader(header) &&
          !sameCellProperty(current.values[header], 'effective', next?.values[header], 'effective'))) {
          throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review source association cell changed');
        }
        if (next.system?.kind !== 'processing' && !sameSteelReviewSource(current.source, next.source)) {
          throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review source changed');
        }
        canonicalRows.push(next);
        continue;
      }
      if (!sourceAuthority) {
        if (isNewRow && next.source === null) {
          canonicalRows.push({ ...next, source: null });
          continue;
        }
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source selection is unavailable');
      }
      if (intent.fileId === null) {
        if (next.source !== null) {
          throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source selection is invalid');
        }
        canonicalRows.push(rowWithSource(next, null, headers));
        continue;
      }
      const metadata = metadataByFile.get(intent.fileId);
      if (!metadata) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source is unavailable');
      }
      const preservesCurrentSource = sameSteelReviewSource(current.source, next.source);
      if (next.source && !preservesCurrentSource && (next.source.fileId !== metadata.fileId ||
        (next.source.filename !== undefined && next.source.filename !== metadata.filename) ||
        (next.source.mediaType !== undefined && next.source.mediaType !== metadata.mediaType))) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source metadata is invalid');
      }
      const mediaType = metadata.mediaType.toLowerCase();
      if (intent.pageNumber !== null) {
        if (mediaType.startsWith('image/')) {
          if (intent.pageNumber !== 1) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review image page is invalid');
          }
        } else {
          if (!pageCountsByFile.has(intent.fileId)) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source page is unavailable');
          }
          const pageCount = pageCountsByFile.get(intent.fileId);
          if (!pageCount || intent.pageNumber > pageCount.pageCount) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source page is invalid');
          }
        }
      }
      let mapping = trustedSourceMappings.find((candidate) => candidate.fileId === metadata.fileId);
      if (!mapping) {
        mapping = {
          fileId: metadata.fileId,
          sourceCode: nextHumanSourceCode(sourceMappings, sourceCodeReservations),
          sourceFilename: metadata.filename,
          mediaType: metadata.mediaType,
        };
        sourceMappings.push(mapping);
        trustedSourceMappings.push(mapping);
      } else if (mapping.sourceFilename !== metadata.filename ||
        (mapping.mediaType !== undefined && mapping.mediaType !== metadata.mediaType)) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source mapping changed');
      }
      const preservesLegacyOmittedMedia = mapping.mediaType === undefined &&
        next.source?.fileId === metadata.fileId && next.source.mediaType === undefined;
      const canonicalMediaType = preservesLegacyOmittedMedia ? undefined : metadata.mediaType;
      canonicalRows.push(rowWithSource(next, {
        fileId: metadata.fileId,
        pageNumber: intent.pageNumber,
        filename: metadata.filename,
        ...(canonicalMediaType ? { mediaType: canonicalMediaType } : {}),
      }, headers, mapping.sourceCode));
    }
    const canonicalById = new Map(canonicalRows.map((row) => [row.rowId, row]));
    const canonicalSourceColumn = sourceHeader(headers);
    for (const row of canonicalRows) {
      if (row.system?.kind !== 'processing' || !row.system.parentRowId || row.deleted) {
        continue;
      }
      const parent = canonicalById.get(row.system.parentRowId);
      if (!parent || parent.deleted || parent.system?.kind !== 'material') {
        if (remarksBindingMode) {
          const index = canonicalRows.findIndex((candidate) => candidate.rowId === row.rowId);
          canonicalRows[index] = rowWithSource(row, null, headers);
          continue;
        }
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Processing row requires an active material parent');
      }
      const source = parent.source;
      const parentCode = canonicalSourceColumn
        ? parent.values[canonicalSourceColumn]?.effective?.trim() || undefined
        : undefined;
      const mapping = source
        ? trustedSourceMappings.find((candidate) => candidate.fileId === source.fileId)
        : undefined;
      const index = canonicalRows.findIndex((candidate) => candidate.rowId === row.rowId);
      canonicalRows[index] = rowWithSource(row, source, headers, mapping?.sourceCode ?? parentCode);
    }
    if (payload.rows.some((row) => Object.keys(row.values).length !== headers.length ||
      headers.some((header) => !Object.prototype.hasOwnProperty.call(row.values, header)))) {
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review columns changed');
    }
    if (intentsByRow.size !== sourceIntents.length) {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source intent is duplicated');
    }
    const hasOcrMetadata = record.kind === 'system_order' && Boolean(record.ocrContext || record.reviewMetadata);
    const rowsWithOcrLinks = hasOcrMetadata
      ? reconcileSteelReviewOcrLinks(headers, canonicalRows, record.ocrContext ?? null)
      : canonicalRows;
    const normalizedRows = validateSteelReviewLedger(currentRows, rowsWithOcrLinks, headers);
    if (!normalizedRows.ok) {
      throwLedgerValidationFailure(normalizedRows);
    }
    const canonicalLedgerRows = normalizedRows.orderedSubmittedRows;
    const normalizedCurrentRows = normalizedRows.currentRows;
    const cleanReplacementText = serializeReviewTable(headers, canonicalLedgerRows.filter((row) => !row.deleted));
    const effectiveMarkdown = replaceOwnerTarget(record, cleanReplacementText, target);
    if (!effectiveMarkdown) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table target not found');
    }
    let systemOrderMarkdown: string | undefined;
    let customerQuoteMarkdown: string | undefined;
    let customerQuoteChangedRows: number | undefined;
    let customerQuoteTotal: string | null | undefined;
    if (payload.kind === 'system_order') {
      // The ledger already contains the trusted changed-cell normalization and
      // derived values. Preserve all untouched cells byte-for-byte so legacy
      // numeric text is not rewritten as a side effect of an unrelated edit.
      systemOrderMarkdown = effectiveMarkdown;
      const nextQuote = quoteProjection(effectiveMarkdown);
      if (!nextQuote) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'System-order quotation is invalid');
      }
      customerQuoteMarkdown = nextQuote.markdown;
      customerQuoteTotal = nextQuote.total;
      customerQuoteChangedRows = countCustomerQuoteChangedRows(headers, normalizedCurrentRows, canonicalLedgerRows);
    }
    const previousById = new Map(normalizedCurrentRows.map((row) => [row.rowId, row]));
    const changedRowIds = canonicalLedgerRows
      .filter((row) => {
        const previous = previousById.get(row.rowId);
        return !previous || JSON.stringify({
          values: row.values,
          source: row.source,
          origin: row.origin,
          deleted: row.deleted,
          system: row.system ?? null,
          measurement: row.calculation?.measurement ?? null,
        }) !== JSON.stringify({
          values: previous.values,
          source: previous.source,
          origin: previous.origin,
          deleted: previous.deleted,
          system: previous.system ?? null,
          measurement: previous.calculation?.measurement ?? null,
        });
      })
      .map((row) => row.rowId);
    const fullText = fullMessageText(record);
    if (fullText === undefined) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review message not found');
    }
    const operationBase: Omit<SteelReviewCommitInput, 'digest'> = {
      userId: scope.userId,
      ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
      conversationId: payload.conversationId,
      kind: payload.kind,
      messageId: payload.messageId,
      tableId: record.tableId,
      ...(target.partIndex !== undefined ? { partIndex: target.partIndex } : {}),
      title: payload.title,
      outputId: payload.outputId,
      revision: payload.revision,
      rows: canonicalLedgerRows,
      ...(sourceIntents.length > 0 ? { sourceIntents } : {}),
      sourceMappings: uniqueSourceMappings(trustedSourceMappings),
      headers,
      operationId,
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
      ...(systemOrderMarkdown ? { systemOrderMarkdown } : {}),
      ...(payload.kind === 'system_order' && (record.effectiveMarkdown ?? record.markdown)
        ? { systemOrderSha256: createHash('sha256').update(record.effectiveMarkdown ?? record.markdown!).digest('hex') }
        : {}),
      ...(customerQuoteMarkdown ? { customerQuoteMarkdown } : {}),
      ...(payload.selectionEvidence ? { selectionEvidence: payload.selectionEvidence } : {}),
      ...(record.aiBaselineMarkdown || record.markdown
        ? { aiBaselineMarkdown: record.aiBaselineMarkdown ?? record.markdown }
        : {}),
      ...(record.aiRawMarkdown || record.markdown
        ? { aiRawMarkdown: record.aiRawMarkdown ?? record.markdown }
        : {}),
      caption: {
        kind: payload.kind,
        changedRows: changedRowIds.length,
        changedRowIds,
        ...(customerQuoteChangedRows !== undefined ? { customerQuoteChangedRows } : {}),
        ...(customerQuoteTotal !== undefined ? { customerQuoteTotal } : {}),
      },
    };
    return {
      ...operationBase,
      sourceMappings: operationBase.sourceMappings ?? [],
    };
  }

  function projectPrepared(
    payload: SteelReviewOperationPrepare,
    prepared: SteelReviewTrustedProjection,
  ): SteelReviewPrepared {
    return {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      title: payload.title,
      kind: payload.kind,
      outputId: prepared.outputId,
      revision: prepared.revision,
      operationId: prepared.operationId,
      digest: prepared.digest,
      headers: prepared.headers,
      messageSha256: prepared.messageSha256,
      target: prepared.target,
      targetText: prepared.targetText,
      replacementText: prepared.replacementText,
      cleanReplacementText: prepared.cleanReplacementText,
      rows: prepared.rows,
      effectiveMarkdown: prepared.effectiveMarkdown,
      displayMarkdown: prepared.displayMarkdown,
      ...(prepared.aiBaselineMarkdown ? { aiBaselineMarkdown: prepared.aiBaselineMarkdown } : {}),
      ...(prepared.aiRawMarkdown ? { aiRawMarkdown: prepared.aiRawMarkdown } : {}),
      sourceMappings: prepared.sourceMappings ?? [],
      caption: prepared.caption,
      operations: payload.operations,
      operationRequest: payload,
      ...(prepared.requestDigest ? { requestDigest: prepared.requestDigest } : {}),
      ...(prepared.selectionEvidence ? { selectionEvidence: prepared.selectionEvidence } : {}),
    };
  }

  async function resolveReceiptStatus(input: SteelReviewReceiptLookup): Promise<SteelReviewReceiptStatus> {
    const parsed = steelReviewReceiptQuerySchema.safeParse({
      messageId: input.messageId,
      outputId: input.outputId,
      operationId: input.operationId,
      digest: input.digest,
      title: input.title,
    });
    if (!parsed.success) {
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review receipt query');
    }
    if (!writer?.readSteelReviewReceipt) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Steel review receipt unavailable');
    }
    const result = await writer.readSteelReviewReceipt(input);
    if (!result) {
      return { status: 'absent' };
    }
    if (!result.snapshot) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review receipt snapshot is unavailable');
    }
    return {
      status: 'committed',
      snapshot: serializeSavedSnapshot(result.snapshot),
    };
  }

  return {
    async read(input: SteelReviewReadInput): Promise<{ table: SteelReviewTable }> {
      const query = steelReviewReadQuerySchema.safeParse({
        messageId: input.messageId,
        title: input.title,
      });
      if (!query.success) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review table');
      }
      const record = await reader.readSteelReview(input);
      if (!record) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      if (record.title !== input.title) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      const sidecarTargetCandidate = sidecarTarget(record, record.tableId, input.title);
      const sidecar = projectSidecar(record, sidecarTargetCandidate);
      if (sidecar && sidecarTargetCandidate) {
        return { table: sidecar };
      }
      if (!record.markdown) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      const table = findCanonicalTarget(record, record.tableId, input.title);
      if (!table) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      const projected = projectRecord(record, table, record.tableId);
      if (!projected) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      return { table: projected };
    },

    receipt: (input: SteelReviewReceiptLookup): Promise<SteelReviewReceiptStatus> =>
      resolveReceiptStatus(input),

    async prepare(input: SteelReviewPrepareInput): Promise<SteelReviewPrepared> {
      const payload = parsePreparePayload(input);
      const prepared = await buildTrustedOperationPrepared(input, payload, randomUUID());
      return projectPrepared(payload, prepared);
    },

    async commit(input: SteelReviewCommitRequest): Promise<SteelReviewPrepared & {
      savedAt: string;
      changedRows: number;
      changedRowIds: string[];
      savedSnapshot?: SteelReviewSavedSnapshot;
    }> {
      if (!writer) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Steel review save unavailable');
      }
      const payload = parseCommitPayload(input);
      if (isOperationCommit(payload)) {
        if (writer.readSteelReviewReceipt) {
          const receipt = await writer.readSteelReviewReceipt({
            userId: input.userId,
            ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
            conversationId: payload.conversationId,
            kind: payload.kind,
            messageId: payload.messageId,
            title: payload.title,
            outputId: payload.outputId,
            operationId: payload.operationId,
            digest: payload.digest,
          });
          if (receipt) {
            const requestDigest = operationRequestDigest(payload, input);
            if (receipt.requestDigest !== requestDigest && receipt.snapshot?.requestDigest !== requestDigest) {
              throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation request changed');
            }
            const prepared = operationPreparedFromReceipt(payload, receipt);
            return {
              ...prepared,
              savedAt: receipt.savedAt.toISOString(),
              changedRows: receipt.changedRows,
              changedRowIds: receipt.changedRowIds,
              ...(receipt.snapshot ? { savedSnapshot: serializeSavedSnapshot(receipt.snapshot) } : {}),
            } as SteelReviewPrepared & {
              savedAt: string;
              changedRows: number;
              changedRowIds: string[];
              savedSnapshot?: SteelReviewSavedSnapshot;
            };
          }
        }
        let trusted: SteelReviewTrustedProjection;
        const sourceEvidence = await loadSourceEvidence(input as SteelReviewPrepareInput, payload);
        try {
          trusted = await buildTrustedOperationPrepared(
            input as SteelReviewPrepareInput,
            payload,
            payload.operationId,
            undefined,
            sourceEvidence,
          );
        } catch (error) {
          if (error instanceof SteelReviewReadError &&
            error.code === 'REVIEW_NOT_FOUND' && error.message === 'Review table is no longer current') {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', error.message);
          }
          throw error;
        }
        if (payload.digest !== trusted.digest) {
          throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation digest mismatch');
        }
        const trustedOperation = trusted;
        const trustedInternal = trusted;
        const result = await writer.commitSteelReview({
          ...trustedInternal,
          userId: input.userId,
          ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
          operationDigest: trustedOperation.digest,
          ...(trustedOperation.requestDigest ? { requestDigest: trustedOperation.requestDigest } : {}),
          operationRequest: payload,
          prepareOperation: async (currentRecord) => {
            const currentTrusted = await buildTrustedOperationPrepared(
              input as SteelReviewPrepareInput,
              payload,
              payload.operationId,
              currentRecord,
              sourceEvidence,
            );
            const currentOperation = currentTrusted;
            if (currentOperation.digest !== payload.digest || currentOperation.requestDigest !== trustedOperation.requestDigest) {
              throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation digest mismatch');
            }
            return {
              ...currentTrusted,
              userId: input.userId,
              ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
              operationDigest: currentOperation.digest,
              ...(currentOperation.requestDigest ? { requestDigest: currentOperation.requestDigest } : {}),
              operationRequest: payload,
            };
          },
        });
        // The first response and an exact receipt replay must expose the same
        // safe operation projection. Build both from the immutable saved
        // snapshot so internal owner/auth fields and the mutable prepare
        // preview cannot leak into only one of the two responses.
        const savedProjection = result.snapshot
          ? operationPreparedFromReceipt(payload, result)
          : (() => {
              const { operationId: _operationId, digest: _digest, ...operationRequest } = payload;
              return {
                conversationId: payload.conversationId,
                messageId: payload.messageId,
                title: payload.title,
                kind: payload.kind,
                outputId: result.outputId,
                revision: result.revision,
                operations: payload.operations,
                operationRequest,
                ...(result.headers ? { headers: result.headers } : {}),
                rows: result.rows ?? trustedInternal.rows,
                messageSha256: result.messageSha256,
                effectiveMarkdown: result.effectiveMarkdown,
                displayMarkdown: result.displayMarkdown,
                ...(result.target ? { target: result.target } : {}),
                ...(result.targetText !== undefined ? { targetText: result.targetText } : {}),
                ...(result.replacementText !== undefined ? { replacementText: result.replacementText } : {}),
                ...(result.cleanReplacementText !== undefined
                  ? { cleanReplacementText: result.cleanReplacementText }
                  : {}),
                ...(result.aiBaselineMarkdown !== undefined ? { aiBaselineMarkdown: result.aiBaselineMarkdown } : {}),
                ...(result.aiRawMarkdown !== undefined ? { aiRawMarkdown: result.aiRawMarkdown } : {}),
                ...(result.sourceMappings ? { sourceMappings: result.sourceMappings } : {}),
                ...(result.selectionEvidence ? { selectionEvidence: result.selectionEvidence } : {}),
                ...(result.caption ? { caption: result.caption } : {}),
              };
            })();
        return {
          ...savedProjection,
          savedAt: result.savedAt.toISOString(),
          changedRows: result.changedRows,
          changedRowIds: result.changedRowIds,
          ...(result.snapshot ? { savedSnapshot: serializeSavedSnapshot(result.snapshot) } : {}),
        } as SteelReviewPrepared & {
          savedAt: string;
          changedRows: number;
          changedRowIds: string[];
          savedSnapshot?: SteelReviewSavedSnapshot;
        };
      }
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
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
