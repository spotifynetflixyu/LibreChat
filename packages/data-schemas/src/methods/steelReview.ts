import { createHash, randomUUID } from 'node:crypto';
import {
  isSteelReviewSourceAssociationHeader,
  inferSteelReviewSystemState,
  parseSteelReviewMarkdownTables,
  normalizeSteelReviewRows,
  normalizeSteelReviewEffectiveValue,
  encodeSteelReviewTitleOwner,
  sameSteelReviewSource,
  validateSteelReviewLedger,
} from 'librechat-data-provider';
import type {
  SteelReviewCell,
  SteelReviewKind,
  SteelReviewCaption,
  SteelReviewOperationPrepare,
  SteelReviewRow,
  SteelReviewSourceIntent,
  SteelReviewSourceMapping,
  SteelReviewTitleOwner,
  SteelReviewTarget,
  SteelReviewRecovery,
} from 'librechat-data-provider';
import type {
  IMessage,
  ISteelConversationOcrState,
  ISteelDelegateOcrRun,
  ISteelQuotationState,
  ISteelReviewOutput,
  SteelReviewReadInput,
  SteelReviewReadRecord,
  SteelReviewReceipt,
  SteelReviewReceiptLookup,
  SteelReviewSavedSnapshotRecord,
  SteelReviewScope,
  SteelReviewTextPart,
  SteelReviewOwnerUpdatedRecord,
  SteelReviewRequoteProvenanceRecord,
} from '~/types';
import type { SteelReviewAuthorizedFile } from './steelSourceAuthorization';
import {
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '~/models';
import { createSteelReviewSourceAuthorization } from './steelSourceAuthorization';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';

type Mongoose = typeof import('mongoose');

export interface SteelReviewReadMethods {
  readSteelReview(input: SteelReviewReadInput): Promise<SteelReviewReadRecord | null>;
}

export type SteelReviewMessageMutationCheckResult =
  | { ok: true; value: { managed: boolean } }
  | { ok: false; error: { code: 'REVIEW_NOT_FOUND' } };

export interface SteelReviewCommitInput extends SteelReviewReadInput {
  /** Server-resolved physical target; never accepted from the public request. */
  tableId: string;
  partIndex?: number;
  outputId: string;
  revision: string;
  operationId: string;
  digest: string;
  rows: SteelReviewRow[];
  headers: string[];
  messageSha256: string;
  target: SteelReviewTarget;
  targetText: string;
  replacementText: string;
  cleanReplacementText: string;
  effectiveMarkdown: string;
  displayMarkdown: string;
  aiBaselineMarkdown?: string;
  aiRawMarkdown?: string;
  /** Private quotation projection used only by the system-order transaction. */
  systemOrderMarkdown?: string;
  /** Private physical Markdown CAS for the quotation state; sidecar revision stays independent. */
  systemOrderSha256?: string;
  customerQuoteMarkdown?: string;
  caption: SteelReviewCaption;
  sourceIntents?: SteelReviewSourceIntent[];
  sourceMappings?: SteelReviewSourceMapping[];
  /** Private new-operation receipt namespace; legacy full-row digests omit it. */
  operationDigest?: string;
  requestDigest?: string;
  /**
   * The operation lane is rebuilt from the transaction-current record. This
   * callback is private to the API/data-schemas boundary and never enters a
   * request digest or a persisted document.
   */
  prepareOperation?: (current: SteelReviewReadRecord) => Promise<SteelReviewCommitInput>;
  operationRequest?: SteelReviewOperationPrepare;
}

export interface SteelReviewCommitResult {
  operationId: string;
  digest: string;
  requestDigest?: string;
  outputId: string;
  title?: string;
  revision: string;
  headers?: string[];
  rows?: SteelReviewRow[];
  caption?: SteelReviewCaption;
  target?: SteelReviewTarget;
  targetText?: string;
  replacementText?: string;
  cleanReplacementText?: string;
  aiBaselineMarkdown?: string;
  aiRawMarkdown?: string;
  systemOrderMarkdown?: string;
  customerQuoteMarkdown?: string;
  sourceMappings?: SteelReviewSourceMapping[];
  changedRows: number;
  changedRowIds: string[];
  savedAt: Date;
  messageSha256: string;
  effectiveMarkdown: string;
  displayMarkdown: string;
  snapshot?: SteelReviewSavedSnapshotRecord;
}

export interface SteelReviewWriteMethods {
  commitSteelReview(input: SteelReviewCommitInput): Promise<SteelReviewCommitResult>;
  resolveSteelReviewReceipt(input: SteelReviewCommitInput): Promise<SteelReviewCommitResult | null>;
  readSteelReviewReceipt(input: SteelReviewReceiptLookup): Promise<SteelReviewCommitResult | null>;
  checkSteelReviewMessageMutation(
    input: SteelReviewScope & { messageId: string },
  ): Promise<SteelReviewMessageMutationCheckResult>;
}

export class SteelReviewWriteError extends Error {
  readonly code: 'REVIEW_CONFLICT' | 'REVIEW_NOT_FOUND' | 'REVIEW_INVALID_OPERATION';
  readonly recovery?: SteelReviewRecovery;

  constructor(
    code: SteelReviewWriteError['code'],
    message: string,
    recovery?: SteelReviewRecovery,
  ) {
    super(message);
    this.name = 'SteelReviewWriteError';
    this.code = code;
    this.recovery = recovery;
  }
}

function tenantFilter(tenantId?: string): Record<string, unknown> {
  return tenantId === undefined
    ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
    : { tenantId };
}

function isManagedReviewTitle(kind: SteelReviewKind, title: string | undefined): title is string {
  if (!title) {
    return false;
  }
  const prefix = kind === 'ocr_result' ? 'ocr_result' : 'system_order';
  if (title === prefix) {
    return true;
  }
  const separator = title.indexOf('｜');
  return separator > 0 && title.slice(0, separator).trim() === prefix &&
    title.slice(separator + 1).trim().length > 0;
}

function hasUniqueTitle(markdown: string | undefined, kind: SteelReviewKind, title: string): boolean {
  if (!markdown) {
    return false;
  }
  const matches = parseSteelReviewMarkdownTables(markdown)
    .filter((table) => table.title === title && isManagedReviewTitle(kind, table.title));
  return matches.length === 1;
}

function hasUniqueRenderedTitle(
  message: { messageText: string; parts: SteelReviewTextPart[] },
  kind: SteelReviewKind,
  title: string,
): boolean {
  const sources = message.parts.length > 0 ? message.parts.map((part) => part.text) : [message.messageText];
  const matches = sources.flatMap((markdown) => parseSteelReviewMarkdownTables(markdown))
    .filter((table) => table.title === title && isManagedReviewTitle(kind, table.title));
  return matches.length === 1;
}

function titleStorageId(owner: SteelReviewTitleOwner): string {
  return `${owner.kind}:title:${createHash('sha256').update(encodeSteelReviewTitleOwner(owner)).digest('hex')}`;
}

type SidecarProofOutput = Pick<
  ISteelReviewOutput,
  'title' | 'kind' | 'outputId' | 'headers' | 'rows' | 'aiRawMarkdown' | 'aiBaselineMarkdown' | 'humanMarkdown' | 'effectiveMarkdown'
>;

function sameReviewHeaders(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Prove one immutable sidecar owner without consulting the requested title.
 * The baseline uses physical parser indexes for AI row IDs; effective output
 * uses every active ledger row so manual insertions cannot be hidden by a
 * subsequence match.
 */
function provenSidecarTitle(output: SidecarProofOutput): string | undefined {
  const baseline = output.aiBaselineMarkdown ?? output.aiRawMarkdown;
  const effective = output.effectiveMarkdown ?? output.humanMarkdown;
  if (!baseline || !effective) {
    return undefined;
  }
  const baselineTables = parseSteelReviewMarkdownTables(baseline)
    .filter((candidate) => isManagedReviewTitle(output.kind, candidate.title));
  const effectiveTables = parseSteelReviewMarkdownTables(effective)
    .filter((candidate) => isManagedReviewTitle(output.kind, candidate.title));
  const aiRows = output.rows.filter((row) => (row.origin ?? 'ai') === 'ai');
  const matchesBaseline = (candidate: { headers: string[]; rows: string[][] }): boolean => {
    if (!sameReviewHeaders(candidate.headers, output.headers)) {
      return false;
    }
    let aiIndex = 0;
    for (const [originalRowIndex, row] of candidate.rows.entries()) {
      // Malformed physical rows are skipped by the trusted ledger importer;
      // their original index still remains part of the following row ID.
      if (row.length !== candidate.headers.length) {
        continue;
      }
      const stored = aiRows[aiIndex];
      if (!stored || stored.rowId !== createHash('sha256')
        .update(`${output.outputId}:${originalRowIndex}:${JSON.stringify(row)}`).digest('hex')) {
        return false;
      }
      if (!output.headers.every((header, columnIndex) =>
        (stored.values[header]?.baseline ?? '') === (row[columnIndex] ?? ''))) {
        return false;
      }
      aiIndex += 1;
    }
    return aiIndex === aiRows.length;
  };
  const matchesEffective = (candidate: { headers: string[]; rows: string[][] }): boolean => {
    if (!sameReviewHeaders(candidate.headers, output.headers)) {
      return false;
    }
    const expectedRows = output.rows.filter((row) => !row.deleted);
    if (candidate.rows.length !== expectedRows.length) {
      return false;
    }
    return expectedRows.every((stored, rowIndex) =>
      output.headers.every((header, columnIndex) =>
        (normalizeSteelReviewEffectiveValue(stored.values[header]?.effective ?? '') ?? '') ===
        (normalizeSteelReviewEffectiveValue(candidate.rows[rowIndex]?.[columnIndex] ?? '') ?? '')));
  };
  const baselineCandidates = baselineTables.filter(matchesBaseline);
  // Effective human values cannot disambiguate two identical immutable AI
  // candidates. Require one complete baseline owner before checking its
  // mutable projection, even when only one candidate happens to match it.
  if (baselineCandidates.length !== 1) {
    return undefined;
  }
  const [baselineTable] = baselineCandidates;
  if (!baselineTable?.title) {
    return undefined;
  }
  const effectiveMatches = effectiveTables.filter((candidate) =>
    candidate.title === baselineTable.title && matchesEffective(candidate));
  return effectiveMatches.length === 1 &&
    (output.title === undefined || output.title === baselineTable.title)
    ? baselineTable.title
    : undefined;
}

function sidecarHasTitle(output: SidecarProofOutput, title: string): boolean {
  return provenSidecarTitle(output) === title;
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

function rowsAreNormalized(rows: readonly SteelReviewRow[]): boolean {
  return JSON.stringify(normalizeSteelReviewRows(rows)) === JSON.stringify(rows);
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

function parseSourcePage(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value.trim())) {
    return null;
  }
  const page = Number(value.trim());
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

/**
 * Build the first-save authority from the server's immutable AI markdown.
 * The submitted rows are deliberately absent from this function: they may
 * carry tombstones, changed baselines, or forged identities and therefore
 * cannot establish the previous ledger state.
 */
function trustedInitialRowsFromMarkdown(
  markdown: string,
  input: SteelReviewCommitInput,
  trustedMappings: readonly SteelReviewSourceMapping[],
  authorizedFiles: ReadonlyMap<string, AuthorizedFile>,
): SteelReviewRow[] | undefined {
  const physicalTarget = parseSteelReviewMarkdownTables(input.targetText)
    .find((candidate) => JSON.stringify(candidate.headers) === JSON.stringify(input.headers));
  if (!physicalTarget) {
    return undefined;
  }
  const matches = parseSteelReviewMarkdownTables(markdown).filter((candidate) =>
    JSON.stringify(candidate.headers) === JSON.stringify(physicalTarget.headers) &&
    JSON.stringify(candidate.rows) === JSON.stringify(physicalTarget.rows));
  if (matches.length !== 1) {
    return undefined;
  }
  const [table] = matches;
  const sourceColumn = sourceHeader(table.headers);
  const pageColumn = pageHeader(table.headers);
  const mappingsByCode = new Map(trustedMappings.map((mapping) => [mapping.sourceCode, mapping]));
  return table.rows.flatMap((row, rowIndex) => {
    if (row.length !== table.headers.length) {
      return [];
    }
    const values = Object.fromEntries(table.headers.map((header, index) => {
      const value = row[index] ?? '';
      return [header, { baseline: value, effective: value }];
    }));
    const sourceCode = sourceColumn ? row[table.headers.indexOf(sourceColumn)]?.trim() : undefined;
    const mapping = sourceCode ? mappingsByCode.get(sourceCode) : undefined;
    const page = pageColumn ? parseSourcePage(row[table.headers.indexOf(pageColumn)]) : null;
    // A source code in the immutable AI table is evidence only when the
    // transaction can still authorize its file for this user/message. Keep
    // unavailable mappings as reserved codes, but project their row source to
    // NULL so a later authorized source edit does not conflict with a hidden
    // historical file association.
    const source = mapping && authorizedFiles.has(mapping.fileId)
      ? {
          fileId: mapping.fileId,
          pageNumber: page,
          filename: mapping.sourceFilename,
          ...(mapping.mediaType ? { mediaType: mapping.mediaType } : {}),
        }
      : null;
    const rowId = createHash('sha256')
      .update(`${input.outputId}:${rowIndex}:${JSON.stringify(row)}`)
      .digest('hex');
    const system = input.kind === 'system_order'
      ? inferSteelReviewSystemState(table.headers, row)
      : undefined;
    return [{ rowId, values, source, origin: 'ai' as const, deleted: false, ...(system ? { system } : {}) }];
  });
}

function trustedPhysicalTarget(
  record: SteelReviewReadRecord,
): { raw: string; headers: string[]; rows: string[][]; partIndex?: number } | undefined {
  if (!record.title) {
    return undefined;
  }
  const candidates = record.messageTextParts && record.messageTextParts.length > 0
    ? record.messageTextParts.flatMap((part) => parseSteelReviewMarkdownTables(part.text).map((table) => ({
        ...table,
        partIndex: part.partIndex,
      })))
    : parseSteelReviewMarkdownTables(record.messageText ?? record.markdown ?? '');
  const titled = candidates.filter((candidate) => candidate.title === record.title);
  const headed = record.headers
    ? titled.filter((candidate) => JSON.stringify(candidate.headers) === JSON.stringify(record.headers))
    : titled;
  const activeRows = record.headers && record.rows
    ? record.rows.filter((row) => !row.deleted).map((row) => record.headers!.map((header) => {
        const value = row.values[header]?.effective;
        return value === null || value === undefined ? '' : value;
      }))
    : undefined;
  const matched = activeRows
    ? headed.filter((candidate) => JSON.stringify(candidate.rows) === JSON.stringify(activeRows))
    : headed;
  if (matched.length !== 1) {
    return undefined;
  }
  const [target] = matched;
  return target;
}

function throwLedgerConflict(result: ReturnType<typeof validateSteelReviewLedger>): never {
  if (result.ok) {
    throw new Error('Expected a failed Steel review ledger validation');
  }
  const messages: Record<string, string> = {
    'duplicate-id': 'Review row identity changed',
    'existing-authority': 'Review row authority changed',
    'existing-insertion': 'Review row placement changed',
    'existing-order': 'Review row order changed',
    'new-row-authority': 'Review row authority changed',
    'insertion-anchor': 'Review insertion anchor is unavailable',
    'insertion-order': 'Review insertion order is ambiguous',
  };
  throw new SteelReviewWriteError('REVIEW_CONFLICT', messages[result.code]);
}

function sameSourceAssociationCellAsBaseline(cell: SteelReviewCell | undefined): boolean {
  return sameCellProperty(cell, 'effective', cell, 'baseline');
}

function businessValues(
  row: SteelReviewRow,
  headers: readonly string[],
  useBaseline = false,
): Record<string, SteelReviewCell> {
  return Object.fromEntries(headers
    .filter((header) => !isSteelReviewSourceAssociationHeader(header))
    .map((header) => {
      const cell = row.values[header];
      return [header, useBaseline ? { ...cell, effective: cell.baseline } : cell];
    }));
}

function scopeFilter(input: SteelReviewReadInput): Record<string, unknown> {
  return {
    userId: input.userId,
    ...tenantFilter(input.tenantId),
    conversationId: input.conversationId,
  };
}

function reviewScope(input: SteelReviewScope): Record<string, unknown> {
  return {
    userId: input.userId,
    ...tenantFilter(input.tenantId),
    conversationId: input.conversationId,
  };
}

function messageFilter(
  input: Pick<SteelReviewReadInput, 'messageId' | 'conversationId' | 'userId' | 'tenantId'>,
): Record<string, unknown> {
  return {
    $and: [
      {
        messageId: input.messageId,
        conversationId: input.conversationId,
        user: input.userId,
      },
      tenantFilter(input.tenantId),
      activeExpirationFilter(),
    ],
  };
}

function appendRenderedText(current: string, next: string): string {
  if (current.length > 0 && next.length > 0 &&
    current[current.length - 1] !== ' ' && next[0] !== ' ') {
    return `${current} ${next}`;
  }
  return `${current}${next}`;
}

function renderedMessageText(
  message: Pick<IMessage, 'text' | 'content'>,
  requestedPartIndex?: number,
): { selected: string; messageText: string; parts: SteelReviewTextPart[]; selectedPartIndex?: number } | undefined {
  if (typeof message.text !== 'string') {
    return undefined;
  }
  // Native Responses messages may persist only the rendered text. There is
  // no part locator to claim in that shape, but the text itself remains the
  // trusted message boundary.
  if (!Array.isArray(message.content)) {
    return requestedPartIndex === undefined
      ? { selected: message.text, messageText: message.text, parts: [] }
      : undefined;
  }
  const parts = message.content.flatMap((part, partIndex) => {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      return [];
    }
    const value = part as { type?: unknown; text?: unknown };
    return value.type === 'text' && typeof value.text === 'string'
      ? [{ partIndex, text: value.text }]
      : [];
  });
  if (parts.length === 0) {
    return undefined;
  }
  const selectedPart = requestedPartIndex === undefined
    ? undefined
    : parts.find((part) => part.partIndex === requestedPartIndex);
  if (requestedPartIndex !== undefined && !selectedPart) {
    return undefined;
  }
  const rendered = parts.reduce((result, part) => appendRenderedText(result, part.text), '');
  if (rendered !== message.text) {
    return undefined;
  }
  return {
    selected: selectedPart?.text ?? message.text,
    messageText: message.text,
    parts,
    ...(selectedPart ? { selectedPartIndex: selectedPart.partIndex } : {}),
  };
}

function readOwnerUpdated(
  metadata: IMessage['metadata'],
  kind: SteelReviewReadInput['kind'],
): SteelReviewOwnerUpdatedRecord | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const value = metadata.steelReview;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const scoped = (value as Record<string, unknown>)[kind];
  const candidate = (scoped && typeof scoped === 'object' && !Array.isArray(scoped)
    ? scoped
    : value) as Partial<SteelReviewOwnerUpdatedRecord>;
  if (candidate.version !== 1 ||
    (candidate.kind !== 'ocr_result' && candidate.kind !== 'system_order') ||
    typeof candidate.conversationId !== 'string' || typeof candidate.messageId !== 'string' ||
    typeof candidate.title !== 'string' || typeof candidate.outputId !== 'string' ||
    typeof candidate.revision !== 'string' || !(candidate.updatedAt instanceof Date)) {
    return undefined;
  }
  return candidate as SteelReviewOwnerUpdatedRecord;
}

interface AuthorizedFile {
  fileId: string;
  filename: string;
  mediaType?: string;
}

function sourceMappings(
  state: ISteelConversationOcrState,
  authorizedFiles: ReadonlyMap<string, AuthorizedFile>,
): SteelReviewSourceMapping[] {
  return (state.sourceMappings ?? []).map((mapping) => ({
    fileId: mapping.fileId,
    sourceCode: mapping.sourceCode,
    sourceFilename: authorizedFiles.get(mapping.fileId)?.filename ?? mapping.sourceFilename,
  })).filter((mapping) => authorizedFiles.has(mapping.fileId));
}

function trustedSourceMappings(state: ISteelConversationOcrState): SteelReviewSourceMapping[] {
  return (state.sourceMappings ?? []).map((mapping) => ({
    fileId: mapping.fileId,
    sourceCode: mapping.sourceCode,
    sourceFilename: mapping.sourceFilename,
  }));
}

function sourceMappingReservations(state: ISteelConversationOcrState): SteelReviewSourceMapping[] {
  return (state.sourceMappings ?? []).map((mapping) => ({
    fileId: mapping.fileId,
    sourceCode: mapping.sourceCode,
    sourceFilename: mapping.sourceFilename,
  }));
}

function sanitizeRows(
  rows: ISteelReviewOutput['rows'],
  authorizedFiles: ReadonlyMap<string, AuthorizedFile>,
  trustedMappings?: readonly SteelReviewSourceMapping[],
): ISteelReviewOutput['rows'] {
  const trustedFileIds = trustedMappings ? new Set(trustedMappings.map((mapping) => mapping.fileId)) : undefined;
  return rows.map((row) => {
    if (!row.source || !authorizedFiles.has(row.source.fileId) ||
      (trustedFileIds && !trustedFileIds.has(row.source.fileId))) {
      return { ...row, source: null };
    }
    const file = authorizedFiles.get(row.source.fileId);
    return {
      ...row,
      source: {
        ...row.source,
        ...(file ? { filename: file.filename } : {}),
      },
    };
  });
}

function legacySnapshotMappings(
  output: Pick<ISteelReviewOutput, 'conversationId' | 'messageId' | 'tableId' | 'title' | 'outputId' | 'revision' | 'headers' | 'rows' | 'effectiveMarkdown' | 'receipts'>,
  expectedKind: SteelReviewReadInput['kind'],
  currentMessageText: string,
): SteelReviewSourceMapping[] | undefined {
  const currentMessageSha256 = createHash('sha256').update(currentMessageText).digest('hex');
  const snapshots = (Array.isArray(output.receipts) ? output.receipts : [])
    .filter((receipt) => receipt && typeof receipt === 'object')
    .filter((receipt) => receipt.revision === output.revision)
    .filter((receipt) => receipt.snapshot &&
      receipt.operationId === receipt.snapshot.operationId &&
      receipt.digest === receipt.snapshot.digest &&
      receipt.snapshot.revision === receipt.revision)
    .map((receipt) => receipt.snapshot)
    .filter((snapshot): snapshot is SteelReviewSavedSnapshotRecord => Boolean(snapshot))
    .filter((snapshot) => snapshot.conversationId === output.conversationId &&
      snapshot.messageId === output.messageId &&
      snapshot.outputId === output.outputId &&
      snapshot.revision === output.revision &&
      JSON.stringify(snapshot.headers) === JSON.stringify(output.headers) &&
      snapshot.effectiveMarkdown === output.effectiveMarkdown &&
      JSON.stringify(snapshot.rows) === JSON.stringify(output.rows) &&
      snapshot.messageText === currentMessageText &&
      snapshot.messageSha256 === currentMessageSha256 &&
      (!snapshot.ownerUpdated || (
        snapshot.ownerUpdated.kind === expectedKind &&
        snapshot.ownerUpdated.conversationId === output.conversationId &&
        snapshot.ownerUpdated.messageId === output.messageId &&
        snapshot.ownerUpdated.title === output.title &&
        snapshot.ownerUpdated.outputId === output.outputId &&
        snapshot.ownerUpdated.revision === output.revision
      )));
  if (snapshots.length !== 1) {
    return undefined;
  }
  const [snapshot] = snapshots;
  const sourceColumn = output.headers.find((header) => header === '來源') ?? output.headers.find((header) => header.toLowerCase() === 'source');
  if (!sourceColumn) {
    return undefined;
  }
  const byCode = new Map<string, SteelReviewSourceMapping>();
  const byFile = new Map<string, SteelReviewSourceMapping>();
  for (const row of snapshot.rows) {
    const source = row.source;
    const sourceCode = row.values[sourceColumn]?.effective?.trim();
    if (!source || !sourceCode) {
      continue;
    }
    const mapping: SteelReviewSourceMapping = {
      fileId: source.fileId,
      sourceCode,
      sourceFilename: source.filename ?? '',
      ...(source.mediaType ? { mediaType: source.mediaType } : {}),
    };
    if (!mapping.sourceFilename) {
      return undefined;
    }
    const existingCode = byCode.get(sourceCode);
    const existingFile = byFile.get(source.fileId);
    if ((existingCode && JSON.stringify(existingCode) !== JSON.stringify(mapping)) ||
      (existingFile && JSON.stringify(existingFile) !== JSON.stringify(mapping))) {
      return undefined;
    }
    byCode.set(sourceCode, mapping);
    byFile.set(source.fileId, mapping);
  }
  return byCode.size > 0 ? [...byCode.values()] : undefined;
}

function projectAuthorizedFiles(
  files: ReadonlyMap<string, SteelReviewAuthorizedFile>,
): Map<string, AuthorizedFile> {
  const authorized = new Map<string, AuthorizedFile>();
  for (const file of files.values()) {
    authorized.set(file.file_id, {
      fileId: file.file_id,
      filename: file.filename,
      ...(file.type ? { mediaType: file.type } : {}),
    });
  }
  return authorized;
}

function sidecarRecord(
  output: Pick<ISteelReviewOutput, 'userId' | 'tenantId' | 'conversationId' | 'kind' | 'messageId' | 'tableId' | 'title' | 'outputId' | 'revision' | 'state' | 'headers' | 'rows' | 'sourceMappings' | 'latestOutputId' | 'aiUpdatedAt' | 'aiRawMarkdown' | 'aiBaselineMarkdown' | 'humanMarkdown' | 'humanSavedAt' | 'effectiveMarkdown' | 'displayMarkdown' | 'receipts'>,
  message?: { selected: string; parts: SteelReviewTextPart[]; selectedPartIndex?: number; ownerUpdated?: SteelReviewOwnerUpdatedRecord },
  authorizedFiles: ReadonlyMap<string, AuthorizedFile> = new Map(),
  aiUpdatedAt?: Date,
  requote?: { needsRequote?: boolean; requoteProvenance?: SteelReviewRequoteProvenanceRecord },
  trustedMappings?: readonly SteelReviewSourceMapping[],
  customerQuoteMarkdown?: string,
): SteelReviewReadRecord {
  const lastSave = output.receipts?.[output.receipts.length - 1];
  return {
    userId: output.userId,
    ...(output.tenantId ? { tenantId: output.tenantId } : {}),
    conversationId: output.conversationId,
    kind: output.kind,
    messageId: output.messageId,
    tableId: output.tableId,
    ...(output.title ? { title: output.title } : {}),
    outputId: output.outputId,
    revision: output.revision,
    state: output.state,
    headers: output.headers,
    rows: sanitizeRows(output.rows, authorizedFiles, trustedMappings).map((row) => ({
      ...row,
      values: row.values instanceof Map ? Object.fromEntries(row.values) : row.values,
    })),
    ...(output.sourceMappings ? { sourceMappings: output.sourceMappings } : {}),
    ...(trustedMappings ? { trustedSourceMappings: [...trustedMappings] } : {}),
    ...(output.latestOutputId ? { latestOutputId: output.latestOutputId } : {}),
    ...(output.aiUpdatedAt ? { aiUpdatedAt: output.aiUpdatedAt } : {}),
    ...(output.aiRawMarkdown ? { aiRawMarkdown: output.aiRawMarkdown } : {}),
    ...(output.aiBaselineMarkdown ? { aiBaselineMarkdown: output.aiBaselineMarkdown } : {}),
    ...(output.humanMarkdown ? { humanMarkdown: output.humanMarkdown } : {}),
    ...(output.humanSavedAt ? { humanSavedAt: output.humanSavedAt } : {}),
    ...(output.effectiveMarkdown ? { effectiveMarkdown: output.effectiveMarkdown } : {}),
    ...(output.displayMarkdown ? { displayMarkdown: output.displayMarkdown } : {}),
    ...(aiUpdatedAt ? { aiUpdatedAt } : {}),
    ...(requote?.needsRequote !== undefined ? { needsRequote: requote.needsRequote } : {}),
    ...(requote?.requoteProvenance ? { requoteProvenance: requote.requoteProvenance } : {}),
    ...(customerQuoteMarkdown !== undefined ? { customerQuoteMarkdown } : {}),
    ...(message?.ownerUpdated ? { ownerUpdated: message.ownerUpdated } : {}),
    ...(lastSave
      ? {
          lastSave: {
            ...lastSave,
            ...(lastSave.snapshot ? { snapshot: normalizeSnapshot(lastSave.snapshot) } : {}),
          },
        }
      : {}),
    ...(output.receipts?.length
      ? { receipts: output.receipts.map((receipt) => ({
          ...receipt,
          ...(receipt.snapshot ? { snapshot: normalizeSnapshot(receipt.snapshot) } : {}),
        })) }
      : {}),
    ...(message
      ? {
          messageText: message.selected,
          messageTextParts: message.parts,
          messageTextPartIndex: message.selectedPartIndex,
        }
      : {}),
  };
}

interface ReviewAuthority {
  outputId: string;
  messageId?: string;
}

function matchesTenantScope(value: unknown, tenantId?: string): boolean {
  return tenantId === undefined ? value == null : value === tenantId;
}

function selectSidecar(
  candidates: ISteelReviewOutput[],
  authority: ReviewAuthority | undefined,
  requestedMessageId: string,
): ISteelReviewOutput | undefined {
  if (authority) {
    const current = authority.messageId === requestedMessageId
      ? candidates.filter((candidate) => candidate.outputId === authority.outputId)
      : [];
    if (current.length === 1) {
      return current[0];
    }
    // Without a proven different target, an old sidecar must not hide current data.
    if (authority.messageId === undefined || authority.messageId === requestedMessageId) {
      return undefined;
    }
    // A current output bound to another message cannot certify this sidecar as current.
    if (candidates.some((candidate) => candidate.outputId === authority.outputId)) {
      return candidates.length === 1 && candidates[0]?.outputId !== authority.outputId
        ? candidates[0]
        : undefined;
    }
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function isPublishedFinalArtifact(
  artifact: { sha256: string },
  publication: { payload: string } | undefined,
): boolean {
  if (!publication) {
    return false;
  }
  try {
    const value: unknown = JSON.parse(publication.payload);
    return typeof value === 'object' && value !== null &&
      'finalSha256' in value && value.finalSha256 === artifact.sha256;
  } catch {
    return false;
  }
}

function archivedRunOwnsMessage(
  artifact: { runId: string; payload: string },
  messageId: string,
): boolean {
  try {
    const value: unknown = JSON.parse(artifact.payload);
    if (typeof value !== 'object' || value === null || !('run' in value) ||
      typeof value.run !== 'object' || value.run === null) {
      return false;
    }
    const run = value.run as { runId?: unknown; status?: unknown; targetMessageId?: unknown };
    return run.runId === artifact.runId && run.status === 'completed' &&
      run.targetMessageId === messageId;
  } catch {
    return false;
  }
}

export function createSteelReviewReadMethods(mongoose: Mongoose): SteelReviewReadMethods {
  const Message = createMessageModel(mongoose);
  const Conversation = createConversationModel(mongoose);
  const OcrState = createSteelConversationOcrStateModel(mongoose);
  const OcrRun = createSteelDelegateOcrRunModel(mongoose);
  const QuotationState = createSteelQuotationStateModel(mongoose);
  const QuotationArtifact = createSteelQuotationArtifactModel(mongoose);
  const ReviewOutput = createSteelReviewOutputModel(mongoose);
  const authorizeFiles = createSteelReviewSourceAuthorization(mongoose);

  const readAuthorizedFiles = async (
    input: SteelReviewReadInput,
    fileIds: readonly string[],
  ): Promise<Map<string, AuthorizedFile>> => {
    return projectAuthorizedFiles(await authorizeFiles(input, fileIds));
  };

  return {
    async readSteelReview(input) {
      const [messageRecords, conversation, conversationIdentities] = await Promise.all([
        Message.find(messageFilter(input))
          .select({ messageId: 1, text: 1, content: 1, files: 1, metadata: 1 })
          .lean<Pick<IMessage, 'messageId' | 'text' | 'content' | 'files' | 'metadata'>[]>(),
        Conversation.findOne({
          $and: [
            { user: input.userId, conversationId: input.conversationId },
            tenantFilter(input.tenantId),
            activeExpirationFilter(),
          ],
        })
          .select({ conversationId: 1 })
          .lean(),
        Conversation.find({ conversationId: input.conversationId })
          .select({ user: 1, tenantId: 1 })
          .lean<Array<{ user?: string; tenantId?: string | null }>>(),
      ]);
      if (messageRecords.length !== 1 || !conversation) {
        return null;
      }
      const messageRecord = messageRecords[0];
      const message = renderedMessageText(messageRecord);
      if (!message) {
        return null;
      }
      const trustedGlobalConversation = conversationIdentities.length === 1 &&
        conversationIdentities[0]?.user === input.userId &&
        matchesTenantScope(conversationIdentities[0]?.tenantId, input.tenantId);
      const sidecarCandidatesPromise = ReviewOutput.find({
        ...scopeFilter(input),
        kind: input.kind,
        messageId: input.messageId,
      })
        .lean<ISteelReviewOutput[]>();

      if (input.kind === 'ocr_result') {
        const [allSidecarCandidates, ocrData] = await Promise.all([
          sidecarCandidatesPromise,
          trustedGlobalConversation
            ? Promise.all([
              OcrState.findOne({ conversationId: input.conversationId })
                .lean<ISteelConversationOcrState>(),
              OcrRun.findOne({
                conversationId: input.conversationId,
                status: 'completed',
                'finalizedCandidate.targetMessageId': input.messageId,
              })
                .sort({ updatedAt: -1 })
                .lean<ISteelDelegateOcrRun>(),
            ])
            : Promise.resolve([undefined, undefined] as const),
        ]);
        const [state, historicalRun] = ocrData;
        const authority = state?.currentOcrResultGenerationId
          ? {
              outputId: `ocr_result:${state.currentOcrResultGenerationId}`,
              messageId: state.currentOcrResultMessageId,
            }
          : undefined;
        const relevantSidecarCandidates = authority
          ? allSidecarCandidates.filter((candidate) => candidate.outputId === authority.outputId)
          : allSidecarCandidates;
        if (input.title && relevantSidecarCandidates.some((candidate) => provenSidecarTitle(candidate) === undefined)) {
          return null;
        }
        const sidecarCandidates = allSidecarCandidates.filter((candidate) =>
          sidecarHasTitle(candidate, input.title));
        const selected = selectSidecar(sidecarCandidates, authority, input.messageId);
        const selectedMappings = selected?.sourceMappings ??
          (selected ? legacySnapshotMappings(selected, input.kind, message.messageText) : undefined);
        const authorizedFiles = await readAuthorizedFiles(input, [
          ...(!selected ? (state?.sourceMappings ?? []).map((mapping) => mapping.fileId) : []),
          ...(selectedMappings ?? []).map((mapping) => mapping.fileId),
          ...(!selectedMappings ? [] : (selected?.rows ?? []).flatMap((row) => row.source?.fileId ? [row.source.fileId] : [])),
        ]);
        if (selected) {
          const { latestOutputId: _ignoredLatestOutputId, ...selectedWithoutLatest } = selected;
          const aiUpdatedAt = selected.aiUpdatedAt ??
            (state?.currentOcrResultGenerationId === selected.outputId.replace(/^ocr_result:/u, '')
              ? state.currentOcrResultProvenance?.updatedAt ?? state.updatedAt
              : undefined);
          return sidecarRecord({
            ...selectedWithoutLatest,
            ...(authority ? { latestOutputId: authority.outputId } : {}),
            ...(input.title ? { title: input.title } : {}),
            ...(selectedMappings && selectedMappings.length > 0 ? { sourceMappings: selectedMappings } : {}),
          }, {
            ...message,
            ...(readOwnerUpdated(messageRecord.metadata, input.kind)
              ? { ownerUpdated: readOwnerUpdated(messageRecord.metadata, input.kind) }
              : {}),
          }, authorizedFiles, aiUpdatedAt, undefined, selectedMappings ?? []);
        }

        if (
          state?.currentOcrResultMessageId === input.messageId &&
          state.currentOcrResultMarkdown &&
          state.currentOcrResultGenerationId &&
          (!input.title || (
            hasUniqueTitle(state.currentOcrResultMarkdown, input.kind, input.title) &&
            hasUniqueRenderedTitle(message, input.kind, input.title)
          ))
        ) {
          const outputId = `ocr_result:${state.currentOcrResultGenerationId}`;
          return {
            userId: input.userId,
            ...(input.tenantId ? { tenantId: input.tenantId } : {}),
            conversationId: input.conversationId,
            kind: input.kind,
            messageId: input.messageId,
            tableId: titleStorageId({
              userId: input.userId,
              tenantId: input.tenantId,
              conversationId: input.conversationId,
              messageId: input.messageId,
              kind: input.kind,
              outputId,
              title: input.title,
            }),
            title: input.title,
            outputId,
            revision: state.currentOcrResultGenerationId,
            state: 'current',
            markdown: state.currentOcrResultMarkdown,
            sourceMappings: sourceMappings(state, authorizedFiles),
            trustedSourceMappings: trustedSourceMappings(state),
            sourceMappingReservations: sourceMappingReservations(state),
            latestOutputId: `ocr_result:${state.currentOcrResultGenerationId}`,
            ...(state.currentOcrResultProvenance?.generationId === state.currentOcrResultGenerationId &&
              (state.currentOcrResultProvenance.updatedAt ?? state.updatedAt)
              ? { aiUpdatedAt: state.currentOcrResultProvenance.updatedAt ?? state.updatedAt }
              : {}),
            ...(readOwnerUpdated(messageRecord.metadata, input.kind)
              ? { ownerUpdated: readOwnerUpdated(messageRecord.metadata, input.kind) }
              : {}),
            messageText: message.selected,
            messageTextParts: message.parts,
            messageTextPartIndex: message.selectedPartIndex,
          };
        }

        const candidate = historicalRun?.finalizedCandidate;
        const revision = candidate?.generationId ?? historicalRun?.responseGenerationId;
        if (candidate?.markdown && revision && candidate.targetMessageId === input.messageId &&
          (!input.title || (
            hasUniqueTitle(candidate.markdown, input.kind, input.title) &&
            hasUniqueRenderedTitle(message, input.kind, input.title)
          ))) {
          const outputId = `ocr_result:${revision}`;
          return {
            userId: input.userId,
            ...(input.tenantId ? { tenantId: input.tenantId } : {}),
            conversationId: input.conversationId,
            kind: input.kind,
            messageId: input.messageId,
            tableId: titleStorageId({
              userId: input.userId,
              tenantId: input.tenantId,
              conversationId: input.conversationId,
              messageId: input.messageId,
              kind: input.kind,
              outputId,
              title: input.title,
            }),
            title: input.title,
            outputId,
            revision,
            state: 'historical',
            markdown: candidate.markdown,
            // Historical runs do not carry a trusted source-code-to-file owner; keep rows unlocated.
            sourceMappings: [],
            ...(state?.currentOcrResultGenerationId
              ? { latestOutputId: `ocr_result:${state.currentOcrResultGenerationId}` }
              : {}),
            messageText: message.selected,
            messageTextParts: message.parts,
            messageTextPartIndex: message.selectedPartIndex,
          };
        }
        return null;
      }

      const [allSidecarCandidates, quotation] = await Promise.all([
        sidecarCandidatesPromise,
        QuotationState.findOne(scopeFilter(input)).lean<ISteelQuotationState>(),
      ]);
      const authority = quotation?.currentSystemOrder?.runId
        ? {
            outputId: `system_order:${quotation.currentSystemOrder.runId}`,
            messageId: quotation.currentSystemOrder.messageId,
          }
        : undefined;
      const relevantSidecarCandidates = authority
        ? allSidecarCandidates.filter((candidate) => candidate.outputId === authority.outputId)
        : allSidecarCandidates;
      if (input.title && relevantSidecarCandidates.some((candidate) => provenSidecarTitle(candidate) === undefined)) {
        return null;
      }
      const sidecarCandidates = allSidecarCandidates.filter((candidate) =>
        sidecarHasTitle(candidate, input.title));
      const selected = selectSidecar(sidecarCandidates, authority, input.messageId);
      const authorizedFiles = await readAuthorizedFiles(input, [
        ...(selected?.rows ?? []).flatMap((row) => row.source?.fileId ? [row.source.fileId] : []),
      ]);
      if (selected) {
        const { latestOutputId: _ignoredLatestOutputId, ...selectedWithoutLatest } = selected;
        return sidecarRecord({
          ...selectedWithoutLatest,
          ...(authority ? { latestOutputId: authority.outputId } : {}),
          ...(input.title ? { title: input.title } : {}),
        }, {
          ...message,
          ...(readOwnerUpdated(messageRecord.metadata, input.kind)
            ? { ownerUpdated: readOwnerUpdated(messageRecord.metadata, input.kind) }
            : {}),
        }, authorizedFiles, undefined, {
          needsRequote: quotation?.currentSystemOrder?.needsRequote,
          requoteProvenance: quotation?.currentSystemOrder?.requoteProvenance,
        }, undefined, quotation?.currentSystemOrder?.customerQuoteMarkdown);
      }

      if (
        quotation?.currentSystemOrder?.messageId === input.messageId &&
        quotation.currentSystemOrder.markdown &&
        (!input.title || (
          hasUniqueTitle(quotation.currentSystemOrder.markdown, input.kind, input.title) &&
          hasUniqueRenderedTitle(message, input.kind, input.title)
        ))
      ) {
        const { runId, markdown } = quotation.currentSystemOrder;
        const outputId = `system_order:${runId}`;
        return {
          userId: input.userId,
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          conversationId: input.conversationId,
          kind: input.kind,
          messageId: input.messageId,
          tableId: titleStorageId({
            userId: input.userId,
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            messageId: input.messageId,
            kind: input.kind,
            outputId,
            title: input.title,
          }),
          title: input.title,
          outputId,
          revision: quotation.currentSystemOrder.sha256,
          state: 'current',
          markdown,
          latestOutputId: `system_order:${runId}`,
          ...(quotation.currentSystemOrder.needsRequote !== undefined
            ? { needsRequote: quotation.currentSystemOrder.needsRequote }
            : {}),
          ...(quotation.currentSystemOrder.requoteProvenance
            ? { requoteProvenance: quotation.currentSystemOrder.requoteProvenance }
            : {}),
          ...(quotation.currentSystemOrder.customerQuoteMarkdown !== undefined
            ? { customerQuoteMarkdown: quotation.currentSystemOrder.customerQuoteMarkdown }
            : {}),
          ...(quotation.currentSystemOrder.calculationCheckpoint
            ? { calculationCheckpoint: quotation.currentSystemOrder.calculationCheckpoint }
            : {}),
          ...(readOwnerUpdated(messageRecord.metadata, input.kind)
            ? { ownerUpdated: readOwnerUpdated(messageRecord.metadata, input.kind) }
            : {}),
          messageText: message.selected,
          messageTextParts: message.parts,
          messageTextPartIndex: message.selectedPartIndex,
        };
      }

      const [finalArtifacts, publicationArtifacts, archiveArtifacts] = await Promise.all([
        QuotationArtifact.find({
          ...scopeFilter(input),
          kind: 'final',
          operationId: 'final',
        })
          .sort({ updatedAt: -1 })
          .lean(),
        QuotationArtifact.find({
          ...scopeFilter(input),
          kind: 'final',
          operationId: 'published',
        })
          .lean(),
        QuotationArtifact.find({
          ...scopeFilter(input),
          kind: 'archive',
          operationId: 'archive',
        })
          .lean(),
      ]);
      const historical = finalArtifacts.filter((artifact) => {
        if (createHash('sha256').update(artifact.payload).digest('hex') !== artifact.sha256) {
          return false;
        }
        const publication = publicationArtifacts.find((candidate) => candidate.runId === artifact.runId);
        const archive = archiveArtifacts.find((candidate) => candidate.runId === artifact.runId);
        return isPublishedFinalArtifact(artifact, publication) &&
          archive !== undefined && archivedRunOwnsMessage(archive, input.messageId);
      });
      if (historical.length !== 1) {
        return null;
      }
      const [artifact] = historical;
      return {
        userId: input.userId,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        conversationId: input.conversationId,
        kind: input.kind,
        messageId: input.messageId,
        tableId: titleStorageId({
          userId: input.userId,
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          kind: input.kind,
          outputId: `system_order:${artifact.runId}`,
          title: input.title,
        }),
        ...(input.title ? { title: input.title } : {}),
        outputId: `system_order:${artifact.runId}`,
        revision: artifact.sha256,
        state: 'historical',
        markdown: artifact.payload,
        ...(quotation?.currentSystemOrder?.runId
          ? { latestOutputId: `system_order:${quotation.currentSystemOrder.runId}` }
          : {}),
        messageText: message.selected,
        messageTextParts: message.parts,
        messageTextPartIndex: message.selectedPartIndex,
      };
    },
  };
}

type SteelTextPart = { contentIndex?: number; type?: string; text?: string; [key: string]: unknown };

function readTextMirror(message: Pick<IMessage, 'text' | 'content'>): {
  text: string;
  parts: SteelTextPart[];
} | null {
  if (typeof message.text !== 'string') {
    return null;
  }
  if (!Array.isArray(message.content)) {
    return { text: message.text, parts: [] };
  }
  const parts = message.content.flatMap((part, contentIndex) => {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      return [];
    }
    return [{ ...(part as SteelTextPart), contentIndex }];
  });
  const rendered = parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .reduce(appendRenderedText, '');
  if (rendered !== message.text) {
    return null;
  }
  return { text: message.text, parts };
}

function renderTextParts(parts: readonly SteelTextPart[]): string {
  return parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .reduce(appendRenderedText, '');
}

function withTextPart(
  parts: readonly SteelTextPart[],
  partIndex: number,
  start: number,
  end: number,
  target: string,
  replacement: string,
): SteelTextPart[] | null {
  const next = parts.map((part) => ({ ...part }));
  const part = next.find((candidate) => candidate.contentIndex === partIndex);
  if (!part || part.type !== 'text' || typeof part.text !== 'string') {
    return null;
  }
  if (part.text.slice(start, end) !== target) {
    return null;
  }
  part.text = `${part.text.slice(0, start)}${replacement}${part.text.slice(end)}`;
  return next;
}

function updateAtRange(text: string, start: number, end: number, expected: string, replacement: string): string | null {
  if (start < 0 || end < start || end > text.length || text.slice(start, end) !== expected) {
    return null;
  }
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function normalizeSnapshot(snapshot: SteelReviewSavedSnapshotRecord): SteelReviewSavedSnapshotRecord {
  const { messageTextParts, ...snapshotWithoutParts } = snapshot;
  return {
    ...snapshotWithoutParts,
    ...(messageTextParts && messageTextParts.length > 0 ? { messageTextParts } : {}),
  };
}

function resultFromReceipt(
  receipt: SteelReviewReceipt,
): SteelReviewCommitResult {
  if (!receipt.snapshot) {
    throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review receipt snapshot is unavailable');
  }
  const snapshot = normalizeSnapshot(receipt.snapshot);
  return {
    operationId: receipt.operationId,
    digest: receipt.digest,
    ...(receipt.requestDigest ? { requestDigest: receipt.requestDigest } : {}),
    outputId: snapshot.outputId,
    ...(snapshot.title !== undefined ? { title: snapshot.title } : {}),
    revision: snapshot.revision,
    headers: snapshot.headers,
    rows: snapshot.rows,
    ...(snapshot.caption ? { caption: snapshot.caption } : {}),
    ...(snapshot.target ? { target: snapshot.target } : {}),
    ...(snapshot.targetText !== undefined ? { targetText: snapshot.targetText } : {}),
    ...(snapshot.replacementText !== undefined ? { replacementText: snapshot.replacementText } : {}),
    ...(snapshot.cleanReplacementText !== undefined ? { cleanReplacementText: snapshot.cleanReplacementText } : {}),
    ...(snapshot.aiBaselineMarkdown !== undefined ? { aiBaselineMarkdown: snapshot.aiBaselineMarkdown } : {}),
    ...(snapshot.aiRawMarkdown !== undefined ? { aiRawMarkdown: snapshot.aiRawMarkdown } : {}),
    ...(snapshot.sourceMappings ? { sourceMappings: snapshot.sourceMappings } : {}),
    changedRows: snapshot.changedRows,
    changedRowIds: snapshot.changedRowIds,
    savedAt: snapshot.savedAt,
    messageSha256: snapshot.messageSha256,
    effectiveMarkdown: snapshot.effectiveMarkdown,
    displayMarkdown: snapshot.displayMarkdown,
    snapshot,
  };
}

function markdownSha256(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

function quotationIsLinkedToOcr(
  quotation: ISteelQuotationState | null,
  input: SteelReviewCommitInput,
  output?: Pick<ISteelReviewOutput, 'humanMarkdown' | 'effectiveMarkdown'>,
): boolean {
  const current = quotation?.currentSystemOrder;
  if (!current) {
    return false;
  }
  const generationId = input.outputId.replace(/^ocr_result:/u, '');
  const sourceHashes = new Set(
    [input.aiRawMarkdown, input.aiBaselineMarkdown, output?.humanMarkdown, output?.effectiveMarkdown]
      .filter((value): value is string => value !== undefined)
      .map(markdownSha256),
  );
  const ticket = quotation?.tickets?.find((candidate) => candidate.acceptedRunId === current.runId);
  const receipt = ticket?.completionReceipt;
  const receiptLinked = receipt !== undefined &&
    (receipt.ocrGeneration === generationId ||
      (receipt.ocrHash !== undefined && sourceHashes.has(receipt.ocrHash)));
  return receiptLinked;
}

function matchesReviewOutputOwner(
  output: Pick<ISteelReviewOutput, 'userId' | 'tenantId' | 'conversationId' | 'kind' | 'messageId' | 'tableId' | 'title' | 'outputId'>,
  input: SteelReviewCommitInput,
): boolean {
  return output.userId === input.userId &&
    matchesTenantScope(output.tenantId, input.tenantId) &&
    output.conversationId === input.conversationId &&
    output.kind === input.kind &&
    output.messageId === input.messageId &&
    output.tableId === input.tableId &&
    (input.title === undefined || output.title === undefined || output.title === input.title) &&
    output.outputId === input.outputId;
}

export function createSteelReviewWriteMethods(mongoose: Mongoose): SteelReviewWriteMethods {
  const Message = createMessageModel(mongoose);
  const Conversation = createConversationModel(mongoose);
  const OcrState = createSteelConversationOcrStateModel(mongoose);
  const OcrRun = createSteelDelegateOcrRunModel(mongoose);
  const QuotationState = createSteelQuotationStateModel(mongoose);
  const ReviewOutput = createSteelReviewOutputModel(mongoose);
  const authorizeFiles = createSteelReviewSourceAuthorization(mongoose);

  const unavailableMessageMutation = (): SteelReviewMessageMutationCheckResult => ({
    ok: false,
    error: { code: 'REVIEW_NOT_FOUND' },
  });

  const assertReceiptScope = async (input: SteelReviewReceiptLookup): Promise<void> => {
    const [conversations, messages] = await Promise.all([
      Conversation.find({
        $and: [
          { conversationId: input.conversationId, user: input.userId },
          tenantFilter(input.tenantId),
          activeExpirationFilter(),
        ],
      }).limit(2).select({ conversationId: 1 }).lean(),
      Message.find(messageFilter(input))
        .limit(2)
        .select({ messageId: 1 })
        .lean(),
    ]);
    if (conversations.length > 1 || messages.length > 1) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review receipt authority is ambiguous');
    }
    if (conversations.length !== 1 || messages.length !== 1) {
      throw new SteelReviewWriteError('REVIEW_NOT_FOUND', 'Review receipt scope is unavailable');
    }
  };

  const findReceipt = async (
    input: SteelReviewReceiptLookup,
  ): Promise<SteelReviewCommitResult | null> => {
    await assertReceiptScope(input);
    const priors = await ReviewOutput.find({
      ...scopeFilter(input),
      kind: input.kind,
      messageId: input.messageId,
      outputId: input.outputId,
      'receipts.operationId': input.operationId,
    }).limit(2).lean<ISteelReviewOutput[]>();
    if (priors.length > 1) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review receipt authority is ambiguous');
    }
    const prior = priors[0];
    if (!prior) {
      return null;
    }
    const receipt = prior.receipts?.find((candidate) => candidate.operationId === input.operationId);
    if (!receipt) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review operation is unavailable');
    }
    if (prior.title !== input.title && receipt.snapshot?.title !== input.title) {
      return null;
    }
    if (receipt.digest !== input.digest) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review operation payload changed');
    }
    return resultFromReceipt(receipt);
  };

  const resolveReceipt = async (input: SteelReviewCommitInput): Promise<SteelReviewCommitResult | null> => {
    if (input.operationDigest !== undefined && input.operationDigest !== input.digest) {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation digest mismatch');
    }
    if (input.operationDigest === undefined) {
      return null;
    }
    return findReceipt(input);
  };

  return {
    async checkSteelReviewMessageMutation(input) {
      const [conversations, messages, conversationIdentities] = await Promise.all([
        Conversation.find({
          $and: [
            { conversationId: input.conversationId, user: input.userId },
            tenantFilter(input.tenantId),
            activeExpirationFilter(),
          ],
        })
          .limit(2)
          .select({ conversationId: 1 })
          .lean(),
        Message.find(messageFilter(input))
          .limit(2)
          .select({ messageId: 1 })
          .lean(),
        Conversation.find({ conversationId: input.conversationId })
          .limit(2)
          .select({ user: 1, tenantId: 1 })
          .lean<Array<{ user?: string; tenantId?: string | null }>>(),
      ]);
      if (conversations.length !== 1 || messages.length !== 1 || conversationIdentities.length !== 1) {
        return unavailableMessageMutation();
      }
      if (!matchesTenantScope(conversationIdentities[0]?.tenantId, input.tenantId) ||
        conversationIdentities[0]?.user !== input.userId) {
        return unavailableMessageMutation();
      }

      const [outputs, ocrStates, quotations, historicalRuns] = await Promise.all([
        ReviewOutput.find({
          ...reviewScope(input),
          messageId: input.messageId,
        })
          .limit(2)
          .select({ _id: 1 })
          .lean(),
        OcrState.find({
          conversationId: input.conversationId,
          currentOcrResultMessageId: input.messageId,
        })
          .limit(2)
          .select({ _id: 1 })
          .lean(),
        QuotationState.find({
          ...reviewScope(input),
          'currentSystemOrder.messageId': input.messageId,
        })
          .limit(2)
          .select({ _id: 1 })
          .lean(),
        OcrRun.find({
          conversationId: input.conversationId,
          status: 'completed',
          'finalizedCandidate.targetMessageId': input.messageId,
        })
          .limit(2)
          .select({ finalizedCandidate: 1, responseGenerationId: 1 })
          .lean<Pick<ISteelDelegateOcrRun, 'finalizedCandidate' | 'responseGenerationId'>[]>(),
      ]);
      const historicalOcr = historicalRuns.some((run) => {
        const candidate = run.finalizedCandidate;
        const revision = candidate?.generationId ?? run.responseGenerationId;
        return Boolean(candidate?.markdown && revision);
      });
      if (outputs.length > 1 || ocrStates.length > 1 || quotations.length > 1 || historicalRuns.length > 1) {
        return unavailableMessageMutation();
      }
      return {
        ok: true,
        value: {
          managed: outputs.length > 0 || ocrStates.length > 0 || quotations.length > 0 || historicalOcr,
        },
      };
    },

    async commitSteelReview(input) {
      const resolved = await resolveReceipt(input);
      if (resolved) {
        return resolved;
      }

      const originalInput = input;
      const session = await mongoose.startSession();
      try {
        let result: SteelReviewCommitResult | undefined;
        await session.withTransaction(async () => {
          // Mongo may invoke the transaction callback again after a transient
          // error. Rebuild the private current-operation lane from the
          // immutable request so its server callback is available on every
          // attempt; the first attempt may replace `input` with its prepared
          // transaction-current projection.
          input = originalInput;
          const [conversations, messages, ocrStates, quotations] = await Promise.all([
            Conversation.find({
              $and: [
                { conversationId: input.conversationId, user: input.userId },
                tenantFilter(input.tenantId),
                activeExpirationFilter(),
              ],
            }).limit(2).session(session).lean(),
            Message.find(messageFilter(input))
              .select({
                messageId: 1,
                conversationId: 1,
                user: 1,
                tenantId: 1,
                expiredAt: 1,
                files: 1,
                text: 1,
                content: 1,
                metadata: 1,
              })
              .limit(2)
              .session(session)
              .lean<Array<Pick<IMessage, 'messageId' | 'conversationId' | 'user' | 'tenantId' | 'expiredAt' | 'files' | 'text' | 'content' | 'metadata'>>>(),
            input.kind === 'ocr_result'
              ? OcrState.find({ conversationId: input.conversationId })
                .limit(2)
                .session(session)
                .lean<ISteelConversationOcrState[]>()
              : Promise.resolve([] as ISteelConversationOcrState[]),
            QuotationState.find(reviewScope(input))
              .limit(2)
              .session(session)
              .lean<ISteelQuotationState[]>(),
          ]);
          if (conversations.length > 1 || messages.length > 1 || ocrStates.length > 1 || quotations.length > 1) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review authority is ambiguous');
          }
          const conversation = conversations[0];
          const message = messages[0];
          const ocrState = ocrStates[0];
          const quotation = quotations[0];
          const operationLane = input.operationDigest !== undefined && input.prepareOperation !== undefined;
          if (input.operationDigest !== undefined && !input.prepareOperation) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation authority is unavailable');
          }
          if (!conversation || !message) {
            throw new SteelReviewWriteError('REVIEW_NOT_FOUND', 'Review table not found');
          }
          if (input.kind === 'ocr_result' &&
            (ocrState?.currentOcrResultMessageId !== input.messageId ||
              ocrState?.currentOcrResultGenerationId !== input.outputId.replace(/^ocr_result:/u, ''))) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
          }
          if (input.kind === 'system_order' &&
            (quotation?.currentSystemOrder?.messageId !== input.messageId ||
              quotation?.currentSystemOrder?.runId !== input.outputId.replace(/^system_order:/u, ''))) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
          }
          if (!operationLane && (typeof message.text !== 'string' ||
            createHash('sha256').update(message.text).digest('hex') !== input.messageSha256)) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message changed');
          }

          const scopedOutputFilter = {
            ...reviewScope(input),
            kind: input.kind,
            messageId: input.messageId,
            outputId: input.outputId,
          };
          const outputFilter = { ...scopedOutputFilter, title: input.title };
          const outputs = await ReviewOutput.find(scopedOutputFilter)
            .session(session)
            .lean<ISteelReviewOutput[]>();
          const provenOutputs = outputs.filter((candidate) => sidecarHasTitle(candidate, input.title));
          const unprovenOutputs = outputs.filter((candidate) => provenSidecarTitle(candidate) === undefined);
          if (provenOutputs.length > 1 || unprovenOutputs.length > 0) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output authority is ambiguous');
          }
          const output = provenOutputs[0];
          if (output && !matchesReviewOutputOwner(output, input)) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output owner changed');
          }
          if (output && (output.state !== 'current' ||
            (output.latestOutputId !== undefined && output.latestOutputId !== output.outputId) ||
            (!operationLane && output.revision !== input.revision))) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
          }
          const currentSourceFileIds = [...new Set([
            ...(output?.rows ?? []).flatMap((row) => row.source?.fileId ? [row.source.fileId] : []),
            ...(ocrState?.sourceMappings ?? []).map((mapping) => mapping.fileId),
            ...(input.sourceIntents ?? []).flatMap((intent) => intent.fileId ? [intent.fileId] : []),
            ...(input.sourceMappings ?? []).map((mapping) => mapping.fileId),
          ])];
          const currentAuthorizedFiles = currentSourceFileIds.length > 0
            ? projectAuthorizedFiles(await authorizeFiles(input, currentSourceFileIds, session, {
              conversation: {
                conversationId: conversation.conversationId,
                user: conversation.user,
                tenantId: conversation.tenantId,
                expiredAt: conversation.expiredAt,
              },
              message: {
                messageId: message.messageId,
                conversationId: message.conversationId,
                user: message.user,
                tenantId: message.tenantId,
                expiredAt: message.expiredAt,
                files: message.files,
              },
            }))
            : new Map<string, AuthorizedFile>();
          const trustedCurrentSourceMappings = output?.sourceMappings ??
            (input.kind === 'ocr_result' && ocrState?.sourceMappings ? trustedSourceMappings(ocrState) : undefined);
          const currentSourceMappings = output?.sourceMappings
            ?.filter((mapping) => currentAuthorizedFiles.has(mapping.fileId)) ??
            (input.kind === 'ocr_result' && ocrState?.sourceMappings
              ? sourceMappings(ocrState, currentAuthorizedFiles)
              : undefined);
          const currentRevision = output?.revision ?? (input.kind === 'ocr_result'
            ? ocrState?.currentOcrResultGenerationId
            : quotation?.currentSystemOrder?.sha256);
          if (input.operationDigest !== undefined && !currentRevision) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output revision is unavailable');
          }
          const capturedRevision = input.operationRequest?.revision;
          if (input.operationDigest !== undefined && capturedRevision !== undefined &&
            capturedRevision !== currentRevision) {
            const hasImmutableReceipt = output?.receipts?.some((receipt) =>
              receipt.revision === capturedRevision && receipt.snapshot !== undefined);
            const isInitialOcrRevision = input.kind === 'ocr_result' &&
              ocrState?.currentOcrResultGenerationId === capturedRevision &&
              input.outputId === `ocr_result:${capturedRevision}` &&
              Boolean(ocrState.currentOcrResultMarkdown || output?.aiBaselineMarkdown);
            const isInitialSystemOrderRevision = input.kind === 'system_order' &&
              output?.outputId === input.outputId &&
              output.aiBaselineMarkdown !== undefined &&
              markdownSha256(output.aiBaselineMarkdown) === capturedRevision;
            if (!hasImmutableReceipt && !isInitialOcrRevision && !isInitialSystemOrderRevision) {
              throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review captured revision is unavailable');
            }
          }
          const currentLatestOutputId = output?.latestOutputId ?? input.outputId;
          const currentAiRawMarkdown = output?.aiRawMarkdown ?? (input.kind === 'ocr_result'
            ? ocrState?.currentOcrResultMarkdown
            : quotation?.currentSystemOrder?.markdown);

          const mirror = readTextMirror(message);
          if (!mirror) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message mirror changed');
          }
          if (operationLane) {
            const currentRecord: SteelReviewReadRecord = {
              userId: input.userId,
              ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
              conversationId: input.conversationId,
              kind: input.kind,
              messageId: input.messageId,
              tableId: input.tableId,
              ...(output?.title ?? input.title ? { title: output?.title ?? input.title } : {}),
              outputId: output?.outputId ?? input.outputId,
              revision: currentRevision ?? input.revision,
              state: 'current',
              ...(output?.headers ? { headers: output.headers } : {}),
              ...(output?.rows
                ? { rows: sanitizeRows(output.rows, currentAuthorizedFiles, output.sourceMappings) }
                : {}),
              ...(currentSourceMappings ? { sourceMappings: currentSourceMappings } : {}),
              ...(trustedCurrentSourceMappings ? { trustedSourceMappings: trustedCurrentSourceMappings } : {}),
              // Keep unavailable AI mappings as allocation reservations. They
              // are never projected back onto rows, but a later authorized
              // human source must not reuse their F-code.
            ...(input.kind === 'ocr_result' && (ocrState?.sourceMappings || output?.sourceMappings)
                ? {
                    sourceMappingReservations: [
                      ...(ocrState?.sourceMappings ? sourceMappingReservations(ocrState) : []),
                      ...(output?.sourceMappings ?? []),
                    ],
                  }
                : {}),
              latestOutputId: currentLatestOutputId,
              ...(currentAiRawMarkdown ? { aiRawMarkdown: currentAiRawMarkdown } : {}),
              ...(output?.aiBaselineMarkdown ? { aiBaselineMarkdown: output.aiBaselineMarkdown } : {}),
              ...(output?.humanMarkdown ? { humanMarkdown: output.humanMarkdown } : {}),
              ...(output?.humanSavedAt ? { humanSavedAt: output.humanSavedAt } : {}),
              ...(output?.effectiveMarkdown ? { effectiveMarkdown: output.effectiveMarkdown } : {}),
              ...(output?.displayMarkdown ? { displayMarkdown: output.displayMarkdown } : {}),
              ...(output?.receipts ? { receipts: output.receipts } : {}),
              ...(!output && input.kind === 'ocr_result' && ocrState?.currentOcrResultMarkdown
                ? { markdown: ocrState.currentOcrResultMarkdown }
                : {}),
              ...(!output && input.kind === 'system_order' && quotation?.currentSystemOrder?.markdown
                ? {
                    markdown: quotation.currentSystemOrder.markdown,
                    customerQuoteMarkdown: quotation.currentSystemOrder.customerQuoteMarkdown,
                  }
                : {}),
              ...(output && input.kind === 'system_order' && quotation?.currentSystemOrder?.customerQuoteMarkdown
                ? { customerQuoteMarkdown: quotation.currentSystemOrder.customerQuoteMarkdown }
                : {}),
              ...(input.kind === 'system_order' && quotation?.currentSystemOrder?.calculationCheckpoint
                ? { calculationCheckpoint: quotation.currentSystemOrder.calculationCheckpoint }
                : {}),
              messageText: mirror.text,
              messageTextParts: mirror.parts
                .filter((part): part is typeof part & { contentIndex: number; text: string } =>
                  part.contentIndex !== undefined && part.type === 'text' && typeof part.text === 'string')
                .map((part) => ({ partIndex: part.contentIndex, text: part.text as string })),
              ...(input.partIndex !== undefined ? { messageTextPartIndex: input.partIndex } : {}),
            };
            const prepared = await input.prepareOperation!(currentRecord);
            if (prepared.revision !== currentRecord.revision) {
              throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review captured revision is unavailable');
            }
            if ((currentAiRawMarkdown !== undefined && prepared.aiRawMarkdown !== currentAiRawMarkdown) ||
              (output?.aiBaselineMarkdown !== undefined && prepared.aiBaselineMarkdown !== output.aiBaselineMarkdown)) {
              throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review AI projection changed');
            }
            if (prepared.userId !== currentRecord.userId ||
              prepared.conversationId !== currentRecord.conversationId ||
              prepared.kind !== currentRecord.kind ||
              prepared.messageId !== currentRecord.messageId ||
              prepared.tableId !== currentRecord.tableId ||
              prepared.title !== currentRecord.title ||
              prepared.outputId !== currentRecord.outputId ||
              (currentRecord.headers !== undefined && JSON.stringify(prepared.headers) !== JSON.stringify(currentRecord.headers))) {
              throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation authority changed');
            }
            const physicalTarget = trustedPhysicalTarget(currentRecord);
            if (!physicalTarget || prepared.targetText !== physicalTarget.raw ||
              (prepared.target.partIndex ?? null) !== (currentRecord.messageTextPartIndex ?? null)) {
              throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation target changed');
            }
            if (prepared.operationDigest !== input.operationDigest ||
              prepared.digest !== input.digest ||
              prepared.requestDigest !== input.requestDigest ||
              prepared.operationId !== input.operationId) {
              throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation digest mismatch');
            }
            input = prepared;
          }

          if (input.operationDigest !== undefined && input.revision !== currentRevision) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review captured revision is unavailable');
          }

          if (typeof message.text !== 'string' || createHash('sha256').update(message.text).digest('hex') !== input.messageSha256) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message changed');
          }

          const selectedText = input.partIndex === undefined
            ? mirror.text
            : mirror.parts.find((part) => part.contentIndex === input.partIndex)?.text;
          if (selectedText === undefined) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message part changed');
          }
          const targetHash = createHash('sha256').update(input.targetText).digest('hex');
          if (targetHash !== input.target.sha256) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review target digest mismatch');
          }
          if (input.target.partIndex !== input.partIndex) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review target part mismatch');
          }
          const selectedNext = updateAtRange(
            selectedText,
            input.target.start,
            input.target.end,
            input.targetText,
            input.replacementText,
          );
          const selectedClean = updateAtRange(
            selectedText,
            input.target.start,
            input.target.end,
            input.targetText,
            input.cleanReplacementText,
          );
          if (selectedNext === null || selectedClean === null) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review target moved or was removed');
          }
          const nextParts = input.partIndex === undefined
            ? mirror.parts
            : withTextPart(
                mirror.parts,
                input.partIndex,
                input.target.start,
                input.target.end,
                input.targetText,
                input.cleanReplacementText,
              );
          if (input.partIndex !== undefined && !nextParts) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message part changed');
          }
          const safeNextParts = nextParts ?? [];
          const nextContent = input.partIndex === undefined || safeNextParts.length === 0
            ? message.content
            : safeNextParts.map(({ contentIndex: _contentIndex, ...part }) => part);
          const nextText = input.partIndex === undefined
            ? selectedNext
            : renderTextParts(safeNextParts);

          const authorizedFiles = currentAuthorizedFiles;
          if (output && input.sourceMappings === undefined && output.rows.some((row) =>
            row.source !== null && authorizedFiles.has(row.source.fileId))) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review source metadata changed');
          }
          const freshOperationMode = input.operationDigest !== undefined;
          const ledgerMode = Boolean(output) || freshOperationMode || input.rows.some((row) =>
            row.origin !== undefined || row.deleted !== undefined || row.insertion !== undefined);
          const trustedMappings = input.sourceMappings ?? [];
          const projectedRows = output ? sanitizeRows(output.rows, authorizedFiles, trustedMappings) : [];
          const legacyInitialRows = input.rows
            .filter((row) => (row.origin ?? 'ai') === 'ai' || row.insertion === undefined)
            .map((row) => ({
              ...row,
              deleted: false,
              values: Object.fromEntries(Object.entries(row.values).map(([header, cell]) => [
                header,
                { ...cell, effective: cell.baseline },
              ])),
            }));
          let serverOriginalMarkdown: string | undefined;
          if (!output && input.kind === 'ocr_result' &&
            ocrState?.currentOcrResultGenerationId === input.outputId.replace(/^ocr_result:/u, '')) {
            serverOriginalMarkdown = ocrState.currentOcrResultMarkdown;
          } else if (!output && input.kind === 'system_order' &&
            quotation?.currentSystemOrder?.runId === input.outputId.replace(/^system_order:/u, '')) {
            serverOriginalMarkdown = quotation.currentSystemOrder.markdown;
          }
          let initialTrustedRows: SteelReviewRow[] | undefined;
          if (output || !ledgerMode) {
            initialTrustedRows = legacyInitialRows;
          } else if (serverOriginalMarkdown) {
            initialTrustedRows = trustedInitialRowsFromMarkdown(
              serverOriginalMarkdown,
              input,
              ocrState?.sourceMappings ?? [],
              authorizedFiles,
            );
          }
          if (!output && ledgerMode && !initialTrustedRows) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review server baseline is unavailable');
          }
          const baselineRows = output ? projectedRows : initialTrustedRows ?? [];
          const ledgerValidation = ledgerMode
            ? validateSteelReviewLedger(output ? projectedRows : initialTrustedRows ?? [], input.rows, input.headers)
            : undefined;
          if (ledgerValidation && !ledgerValidation.ok) {
            throwLedgerConflict(ledgerValidation);
          }
          const trustedLedgerRows = ledgerValidation?.ok
            ? ledgerValidation.currentRows
            : [];
          const submittedLedgerRows = ledgerValidation?.ok
            ? ledgerValidation.submittedRows
            : [];
          const orderedLedgerRows = ledgerValidation?.ok
            ? ledgerValidation.orderedRows
            : [];
          const trustedLedgerIds = new Set(trustedLedgerRows.map((row) => row.rowId));
          const trustedById = new Map(trustedLedgerRows.map((row) => [row.rowId, row]));
          const submittedById = new Map(submittedLedgerRows.map((row) => [row.rowId, row]));
          const sourceIntents = new Map<string, SteelReviewSourceIntent>();
          for (const intent of input.sourceIntents ?? []) {
            if (sourceIntents.has(intent.rowId)) {
              throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source intent is duplicated');
            }
            sourceIntents.set(intent.rowId, intent);
          }
          const validatedSourceRows = new Map<string, boolean>();
          const validatingSourceRows = new Set<string>();
          const sourceMatchesExpected = (rowId: string): boolean => {
            const validated = validatedSourceRows.get(rowId);
            if (validated !== undefined) {
              return validated;
            }
            if (validatingSourceRows.has(rowId)) {
              return false;
            }
            const next = submittedById.get(rowId);
            if (!next) {
              validatedSourceRows.set(rowId, false);
              return false;
            }
            validatingSourceRows.add(rowId);
            const previous = trustedById.get(rowId);
            const intent = sourceIntents.get(rowId);
            let matched: boolean;
            if (intent && next.system?.kind === 'processing') {
              throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Processing source follows its material');
            }
            if (intent) {
              if (intent.fileId === null) {
                matched = next.source === null;
              } else {
                const nextSource = next.source;
                const authorizedFile = authorizedFiles.get(intent.fileId);
                matched = nextSource !== null && nextSource !== undefined &&
                  nextSource.fileId === intent.fileId && nextSource.pageNumber === intent.pageNumber &&
                  nextSource.filename === authorizedFile?.filename &&
                  (nextSource.mediaType === undefined || nextSource.mediaType === authorizedFile?.mediaType);
              }
            } else if (next.system?.kind === 'processing' && !next.deleted) {
              const parentId = next.system.parentRowId;
              if (!parentId) {
                // Imported AI processing rows can remain unbound until an explicit
                // binding operation. Preserve their trusted source evidence while
                // requiring new rows to start blank until they have a parent.
                matched = trustedLedgerIds.has(rowId)
                  ? sameSteelReviewSource(previous?.source ?? null, next.source ?? null)
                  : next.source === null;
              } else {
                const parent = submittedById.get(parentId);
                matched = Boolean(parent && !parent.deleted && parent.system?.kind === 'material' &&
                  sourceMatchesExpected(parent.rowId) && sameSteelReviewSource(next.source ?? null, parent.source ?? null));
              }
            } else {
              matched = trustedLedgerIds.has(rowId)
                ? sameSteelReviewSource(previous?.source ?? null, next.source ?? null)
                : next.source === null;
            }
            validatingSourceRows.delete(rowId);
            validatedSourceRows.set(rowId, matched);
            return matched;
          };
          if (input.sourceMappings) {
            const mappingByCode = new Map<string, SteelReviewSourceMapping>();
            const mappingByFile = new Map<string, SteelReviewSourceMapping>();
            const selectedFileIds = new Set((input.sourceIntents ?? [])
              .flatMap((intent) => intent.fileId ? [intent.fileId] : []));
            const currentOwnerMappings = [
              ...(ocrState?.sourceMappings ?? []),
              ...(output?.sourceMappings ?? []),
              ...(output && typeof message.text === 'string'
                ? legacySnapshotMappings(output, input.kind, message.text) ?? []
                : []),
            ];
            for (const mapping of input.sourceMappings) {
              const file = authorizedFiles.get(mapping.fileId);
              const priorCode = mappingByCode.get(mapping.sourceCode);
              const priorFile = mappingByFile.get(mapping.fileId);
              const retainedUnavailable = !file && !selectedFileIds.has(mapping.fileId) &&
                currentOwnerMappings.some((candidate) => candidate.fileId === mapping.fileId &&
                  candidate.sourceCode === mapping.sourceCode && candidate.sourceFilename === mapping.sourceFilename);
              if ((!file && !retainedUnavailable) || (file && mapping.sourceFilename !== file.filename) ||
                (file && mapping.mediaType !== undefined && mapping.mediaType !== file.mediaType) ||
                (priorCode && JSON.stringify(priorCode) !== JSON.stringify(mapping)) ||
                (priorFile && JSON.stringify(priorFile) !== JSON.stringify(mapping))) {
                throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source mapping is invalid');
              }
              mappingByCode.set(mapping.sourceCode, mapping);
              mappingByFile.set(mapping.fileId, mapping);
            }
          }
          if (output && JSON.stringify(output.headers) !== JSON.stringify(input.headers)) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review rows changed');
          }
          if (output || input.rows.some((row) => row.origin !== undefined || row.deleted !== undefined || row.insertion !== undefined)) {
            for (const previous of orderedLedgerRows) {
              const next = submittedById.get(previous.rowId);
              const isNewRow = !trustedLedgerIds.has(previous.rowId);
              const intent = sourceIntents.get(previous.rowId);
              const sourceMatches = next ? sourceMatchesExpected(previous.rowId) : false;
              if (!next || !sourceMatches) {
                throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review row identity changed');
              }
              for (const header of input.headers) {
                if (!isNewRow && (previous.values[header]?.baseline ?? null) !== (next.values[header]?.baseline ?? null)) {
                  throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review AI baseline changed');
                }
                if (!intent && isSteelReviewSourceAssociationHeader(header) &&
                  !sameCellProperty(previous.values[header], 'effective', next.values[header], 'effective')) {
                  const parentId = next.system?.kind === 'processing' && !next.deleted ? next.system.parentRowId : undefined;
                  const parent = parentId ? submittedById.get(parentId) : undefined;
                  if (parent && parent.system?.kind === 'material' &&
                    sameCellProperty(parent.values[header], 'effective', next.values[header], 'effective')) {
                    continue;
                  }
                  throw new SteelReviewWriteError(
                    'REVIEW_INVALID_OPERATION',
                    'Review source association cell is read-only',
                  );
                }
              }
            }
          } else if ((input.sourceIntents ?? []).length === 0 && input.headers.some((header) => isSteelReviewSourceAssociationHeader(header) &&
            input.rows.some((row) => !sameSourceAssociationCellAsBaseline(row.values[header])))) {
            throw new SteelReviewWriteError(
              'REVIEW_INVALID_OPERATION',
              'Review source association cell is read-only',
            );
          }
          if (!rowsAreNormalized(input.rows)) {
            throw new SteelReviewWriteError(
              'REVIEW_INVALID_OPERATION',
              'Review effective cell representation is not canonical',
            );
          }
          const canonicalRows = ledgerMode
            ? submittedLedgerRows
            : normalizeSteelReviewRows(input.rows);
          const canonicalBaselineRows = ledgerMode
            ? trustedLedgerRows
            : normalizeSteelReviewRows(baselineRows);
          const comparisonBaselineRows = !output && ledgerMode
            ? canonicalBaselineRows.filter((row) => row.origin === 'ai' || row.insertion === undefined)
            : canonicalBaselineRows;
          const previousEffective = new Map(
            comparisonBaselineRows.map((row) => [
              row.rowId,
              JSON.stringify({
                values: output
                  ? row.values
                  : Object.fromEntries(Object.entries(row.values).map(([header, cell]) => [
                    header,
                    { ...cell, effective: cell.baseline },
                  ])),
                source: row.source,
                system: row.system ?? null,
                calculation: row.calculation ?? null,
                ...(ledgerMode ? { origin: row.origin, deleted: row.deleted } : {}),
              }),
            ]),
          );
          const changedRowIds = canonicalRows
            .filter((row) => previousEffective.get(row.rowId) !== JSON.stringify({
              values: row.values,
              source: row.source,
              system: row.system ?? null,
              calculation: row.calculation ?? null,
              ...(ledgerMode ? { origin: row.origin, deleted: row.deleted } : {}),
            }))
            .map((row) => row.rowId);
          const businessChangedRowIds = canonicalRows
            .filter((row) => {
              const previous = comparisonBaselineRows.find((candidate) => candidate.rowId === row.rowId);
              return (previous === undefined && ledgerMode && row.origin === 'manual' && !row.deleted) ||
                (previous !== undefined &&
                ((ledgerMode && previous.deleted !== row.deleted) ||
                JSON.stringify(previous.system ?? null) !== JSON.stringify(row.system ?? null) ||
                JSON.stringify(businessValues(previous, input.headers, !output)) !==
                JSON.stringify(businessValues(row, input.headers))));
            })
            .map((row) => row.rowId);
          if (changedRowIds.length !== input.caption.changedRows ||
            changedRowIds.some((rowId) => !input.caption.changedRowIds.includes(rowId))) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review caption does not match rows');
          }
          if (changedRowIds.length === 0) {
            result = {
              operationId: input.operationId,
              digest: input.digest,
              outputId: input.outputId,
              ...(input.title !== undefined ? { title: input.title } : {}),
              revision: input.revision,
              changedRows: 0,
              changedRowIds: [],
              savedAt: output?.humanSavedAt ?? new Date(0),
              messageSha256: input.messageSha256,
              effectiveMarkdown: output?.effectiveMarkdown ?? input.effectiveMarkdown,
              displayMarkdown: output?.displayMarkdown ?? input.displayMarkdown,
              headers: input.headers,
              rows: canonicalRows,
              ...(input.operationDigest !== undefined
                ? { caption: { kind: input.kind, changedRows: 0, changedRowIds: [] } }
                : {}),
              ...(input.operationDigest !== undefined
                ? {
                    target: input.target,
                    targetText: input.targetText,
                    replacementText: input.replacementText,
                    cleanReplacementText: input.cleanReplacementText,
                    ...(input.aiBaselineMarkdown !== undefined ? { aiBaselineMarkdown: input.aiBaselineMarkdown } : {}),
                    ...(input.aiRawMarkdown !== undefined ? { aiRawMarkdown: input.aiRawMarkdown } : {}),
                    ...(input.sourceMappings ? { sourceMappings: input.sourceMappings } : {}),
                  }
                : {}),
            };
            return;
          }

          if (input.kind === 'ocr_result') {
            if (!ocrState?._id) {
              throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
            }
            const reviewLockToken = randomUUID();
            const fenced = await OcrState.updateOne(
              {
                _id: ocrState._id,
                conversationId: input.conversationId,
                currentOcrResultMessageId: input.messageId,
                currentOcrResultGenerationId: input.outputId.replace(/^ocr_result:/u, ''),
              },
              { $set: { reviewLockToken } },
              { session, timestamps: false },
            );
            if (fenced.matchedCount !== 1 || fenced.modifiedCount !== 1) {
              throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
            }
          } else if (!quotation?.currentSystemOrder) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
          }

          const savedAt = new Date();
          const expectedSystemOrderSha256 = input.kind === 'system_order'
            ? input.systemOrderSha256 ?? input.revision
            : undefined;
          const nextRevision = createHash('sha256')
            .update(`${input.revision}:${input.digest}`)
            .digest('hex');
          const nextSystemOrderSha256 = input.kind === 'system_order'
            ? markdownSha256(input.systemOrderMarkdown ?? input.effectiveMarkdown)
            : undefined;
          const nextMessageSha256 = createHash('sha256').update(nextText).digest('hex');
          const ownerUpdated: SteelReviewOwnerUpdatedRecord = {
            version: 1,
            kind: input.kind,
            conversationId: input.conversationId,
            messageId: input.messageId,
            title: input.title,
            outputId: input.outputId,
            revision: nextRevision,
            updatedAt: savedAt,
          };
          const messageTextParts = safeNextParts.flatMap((part) =>
            part.contentIndex !== undefined && part.type === 'text' && typeof part.text === 'string'
              ? [{ partIndex: part.contentIndex, text: part.text }]
              : [],
          );
          const receipt: SteelReviewReceipt = {
            operationId: input.operationId,
            digest: input.digest,
            ...(input.requestDigest ? { requestDigest: input.requestDigest } : {}),
            revision: nextRevision,
            changedRows: changedRowIds.length,
            changedRowIds,
            savedAt,
            snapshot: {
              operationId: input.operationId,
              digest: input.digest,
              ...(input.requestDigest ? { requestDigest: input.requestDigest } : {}),
              outputId: input.outputId,
              ...(input.title !== undefined ? { title: input.title } : {}),
              revision: nextRevision,
              headers: input.headers,
              rows: canonicalRows,
              ...(input.sourceMappings ? { sourceMappings: input.sourceMappings } : {}),
              changedRows: changedRowIds.length,
              changedRowIds,
              savedAt,
              messageSha256: nextMessageSha256,
              conversationId: input.conversationId,
              messageId: input.messageId,
              messageText: nextText,
              ...(messageTextParts.length > 0 ? { messageTextParts } : {}),
              effectiveMarkdown: input.effectiveMarkdown,
              displayMarkdown: input.displayMarkdown,
              ownerUpdated,
              ...(input.operationDigest !== undefined
                ? {
                    target: input.target,
                    targetText: input.targetText,
                    replacementText: input.replacementText,
                    cleanReplacementText: input.cleanReplacementText,
                    ...(input.aiBaselineMarkdown ? { aiBaselineMarkdown: input.aiBaselineMarkdown } : {}),
                    ...(input.aiRawMarkdown ? { aiRawMarkdown: input.aiRawMarkdown } : {}),
                    caption: input.caption,
                  }
                : {}),
            },
          };
          const update = {
            $set: {
              userId: input.userId,
              ...(input.tenantId ? { tenantId: input.tenantId } : {}),
              conversationId: input.conversationId,
              kind: input.kind,
              messageId: input.messageId,
              tableId: input.tableId,
              outputId: input.outputId,
              ...(input.title !== undefined ? { title: input.title } : {}),
              revision: nextRevision,
              state: 'current' as const,
              headers: input.headers,
              rows: canonicalRows,
              ...(input.sourceMappings ? { sourceMappings: input.sourceMappings } : {}),
              latestOutputId: input.outputId,
              humanMarkdown: input.effectiveMarkdown,
              humanSavedAt: savedAt,
              effectiveMarkdown: input.effectiveMarkdown,
              displayMarkdown: input.displayMarkdown,
              ...(output?.aiUpdatedAt ||
              (ocrState?.currentOcrResultGenerationId === input.outputId.replace(/^ocr_result:/u, '') &&
                (ocrState.currentOcrResultProvenance?.updatedAt ?? ocrState.updatedAt))
                ? {
                    aiUpdatedAt: output?.aiUpdatedAt ??
                      ocrState?.currentOcrResultProvenance?.updatedAt ?? ocrState?.updatedAt,
                  }
                : {}),
              ...(output?.aiBaselineMarkdown || input.aiBaselineMarkdown
                ? { aiBaselineMarkdown: output?.aiBaselineMarkdown ?? input.aiBaselineMarkdown }
                : {}),
              ...(output?.aiRawMarkdown || input.aiRawMarkdown
                ? { aiRawMarkdown: output?.aiRawMarkdown ?? input.aiRawMarkdown }
                : {}),
            },
            $push: { receipts: receipt },
          };
          const updated = await ReviewOutput.findOneAndUpdate(
            output
              ? { ...scopedOutputFilter, _id: output._id, state: 'current', revision: input.revision }
              : outputFilter,
            update,
            { upsert: !output, new: true, session },
          ).lean<ISteelReviewOutput>();
          if (!updated) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output changed');
          }
          const messageUpdate = await Message.updateOne(
            {
              ...messageFilter(input),
              text: message.text,
            },
            {
              $set: {
                text: nextText,
                ...(nextContent ? { content: nextContent } : {}),
                [`metadata.steelReview.${input.kind}`]: ownerUpdated,
              },
            },
            { session },
          );
          if (messageUpdate.matchedCount !== 1) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message changed');
          }
          if (input.kind === 'system_order') {
            const currentSystemOrder = quotation?.currentSystemOrder;
            const systemOrderMarkdown = input.systemOrderMarkdown ?? input.effectiveMarkdown;
            if (!currentSystemOrder || currentSystemOrder.runId !== input.outputId.replace(/^system_order:/u, '') ||
              currentSystemOrder.messageId !== input.messageId || currentSystemOrder.sha256 !== expectedSystemOrderSha256) {
              throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Quotation state changed');
            }
            const quotationUpdate = await QuotationState.updateOne(
              {
                ...reviewScope(input),
                'currentSystemOrder.runId': currentSystemOrder.runId,
                'currentSystemOrder.messageId': input.messageId,
                'currentSystemOrder.sha256': expectedSystemOrderSha256,
              },
              {
                $set: {
                  'currentSystemOrder.markdown': systemOrderMarkdown,
                  'currentSystemOrder.sha256': nextSystemOrderSha256,
                  'currentSystemOrder.updatedAt': savedAt,
                  ...(input.customerQuoteMarkdown !== undefined
                    ? { 'currentSystemOrder.customerQuoteMarkdown': input.customerQuoteMarkdown }
                    : {}),
                  'updatedAt': savedAt,
                },
              },
              { session },
            );
            if (quotationUpdate.matchedCount !== 1) {
              throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Quotation state changed');
            }
          }
          if (input.kind === 'ocr_result' && businessChangedRowIds.length > 0 && quotationIsLinkedToOcr(quotation, input, output)) {
            const requoteProvenance = {
              sourceKind: 'ocr_result' as const,
              sourceMessageId: input.messageId,
              sourceTableId: input.tableId,
              sourceOutputId: input.outputId,
              sourceRevision: nextRevision,
              changedRows: businessChangedRowIds.length,
              at: savedAt,
            };
            const quotationUpdate = await QuotationState.updateOne(
              {
                ...reviewScope(input),
                'currentSystemOrder.runId': quotation?.currentSystemOrder?.runId,
              },
              {
                $set: {
                  'currentSystemOrder.needsRequote': true,
                  'currentSystemOrder.requoteProvenance': requoteProvenance,
                },
              },
              { session },
            );
            if (quotationUpdate.matchedCount !== 1) {
              throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Quotation state changed');
            }
          }
          result = {
            operationId: receipt.operationId,
            digest: receipt.digest,
              outputId: updated.outputId,
              ...(updated.title !== undefined ? { title: updated.title } : {}),
              revision: updated.revision,
            changedRows: receipt.changedRows,
            changedRowIds: receipt.changedRowIds,
            savedAt: receipt.savedAt,
            messageSha256: nextMessageSha256,
            effectiveMarkdown: input.effectiveMarkdown,
            displayMarkdown: input.displayMarkdown,
            headers: input.headers,
            rows: canonicalRows,
            ...(input.operationDigest !== undefined ? { caption: input.caption } : {}),
            ...(input.operationDigest !== undefined
              ? {
                  target: input.target,
                  targetText: input.targetText,
                  replacementText: input.replacementText,
                  cleanReplacementText: input.cleanReplacementText,
                  ...(input.aiBaselineMarkdown !== undefined ? { aiBaselineMarkdown: input.aiBaselineMarkdown } : {}),
                  ...(input.aiRawMarkdown !== undefined ? { aiRawMarkdown: input.aiRawMarkdown } : {}),
                  ...(input.sourceMappings ? { sourceMappings: input.sourceMappings } : {}),
                }
              : {}),
            snapshot: receipt.snapshot,
          };
        });
        if (!result) {
          throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review save did not complete');
        }
        return result;
      } finally {
        await session.endSession();
      }
    },

    resolveSteelReviewReceipt: resolveReceipt,
    readSteelReviewReceipt: findReceipt,
  };
}
