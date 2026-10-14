import { steelSectionBaseTitle } from 'librechat-data-provider';
import type { MarkdownFence, MarkdownSection, ParsedAssistantMarkdown } from '../markdown/parser';
import type { OcrTable } from './normalize';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { parseAssistantMarkdown, getFenceStart, closesFence } from '../markdown/parser';
import { admitFullOnlyMarkdown } from '../markdown/admission';
import { parseMarkdownTables } from '../markdown/table';
import { normalizeOcrTable } from './normalize';

export { parseAssistantMarkdown, parseMarkdownSections } from '../markdown/parser';
export type { MarkdownSection, MarkdownSegment, ParsedAssistantMarkdown } from '../markdown/parser';
export { admitFullOnlyMarkdown } from '../markdown/admission';

const SOURCE_TITLE = 'source_file_mapping';
const RESULT_TITLE = 'ocr_result';

const REVIEW_TITLE = 'manual_review';
const SUMMARY_TITLE = 'ocr_update_summary';
const SOURCE_HEADERS = ['來源', '檔名'] as const;
const RESULT_REQUIRED_HEADERS = ['來源', '零件編號'] as const;

export interface SourceMappingEntry {
  readonly sourceCode: string;
  readonly sourceFilename: string;
}

export type { OcrTable } from './normalize';

export interface ParsedTableSuccess {
  readonly ok: true;
  readonly table: OcrTable;
}

export interface ParsedTableFailure {
  readonly ok: false;
  readonly reason: 'missing_table' | 'invalid_table';
}

export type ParsedTable = ParsedTableSuccess | ParsedTableFailure;

export type MappingMismatchKind = 'missing' | 'extra' | 'duplicate' | 'different';

export interface MappingValidationSuccess {
  readonly ok: true;
  readonly entries: readonly SourceMappingEntry[];
}

export interface MappingValidationFailure {
  readonly ok: false;
  readonly kind: MappingMismatchKind;
  readonly missing: readonly SourceMappingEntry[];
  readonly extra: readonly SourceMappingEntry[];
  readonly duplicates: readonly SourceMappingEntry[];
  readonly different: readonly SourceMappingEntry[];
}

export type MappingValidation = MappingValidationSuccess | MappingValidationFailure;

export interface OcrReconciliation {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly restoredRows: readonly (readonly string[])[];
  readonly matchedKeys: readonly string[];
  readonly newKeys: readonly string[];
  readonly duplicateKeys: readonly string[];
  readonly changedKeys: readonly string[];
}

export type OcrAgentKind = 'delegate_ocr' | 'regular_ocr' | 'other';

export interface FinalizeOcrResponseInput {
  readonly assistantResponse: string;
  readonly messageId?: string;
  readonly previousOcrMarkdown?: string;
  readonly canonicalMapping: readonly SourceMappingEntry[];
  readonly delegateSummary?: boolean;
  readonly agentKind?: OcrAgentKind;
  readonly currentUserTurn?: string;
}

export interface FinalizeOcrResponseSuccess {
  readonly ok: true;
  readonly finalResponse: string;
  readonly ocrResultMarkdown: string;
  readonly mapping: MappingValidationSuccess;
  readonly reconciliation: OcrReconciliation;
  readonly summary: string;
}

export type FinalizationFailureReason =
  | 'missing_ocr_result'
  | 'invalid_ocr_result_table'
  | 'retired_control_section'
  | 'duplicate_ocr_result'
  | 'mapping_mismatch';

export interface FinalizeOcrResponseFailure {
  readonly ok: false;
  readonly reason: FinalizationFailureReason;
  readonly mapping?: MappingValidationFailure;
  readonly mappingRetryable?: boolean;
}

export type FinalizeOcrResponseResult =
  | FinalizeOcrResponseSuccess
  | FinalizeOcrResponseFailure;

function validHeaders(headers: readonly string[], required: readonly string[], exact: boolean): boolean {
  if (headers.some((header) => header.length === 0) || new Set(headers).size !== headers.length) {
    return false;
  }
  return exact
    ? headers.length === required.length && required.every((header, index) => headers[index] === header)
    : required.every((header) => headers.includes(header));
}

function tableFromMarkdown(markdown: string, required: readonly string[], exact: boolean): ParsedTable {
  const visibleLines: string[] = [];
  let fence: MarkdownFence | undefined;
  for (const line of markdown.split(/\r?\n/u)) {
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
    visibleLines.push(line);
  }
  const visibleMarkdown = visibleLines.join('\n');
  const tables = parseMarkdownTables(visibleMarkdown);
  if (tables.length > 1) return { ok: false, reason: 'invalid_table' };
  const table = tables[0];
  if (!table) {
    const hasPipeBlock = visibleLines.some((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('|') || trimmed.endsWith('|');
    });
    return { ok: false, reason: hasPipeBlock ? 'invalid_table' : 'missing_table' };
  }
  if (
    table.rows.length === 0 ||
    !validHeaders(table.headers, required, exact) ||
    table.rows.some((row) => row.length !== table.headers.length)
  ) {
    return { ok: false, reason: 'invalid_table' };
  }
  return {
    ok: true,
    table: {
      headers: [...table.headers],
      rows: table.rows.map((row) => [...row]),
    },
  };
}

export function parseOcrResultTable(markdown: string): ParsedTable {
  return tableFromMarkdown(markdown, [], false);
}

export function parseSourceMappingTable(markdown: string): ParsedTable {
  return tableFromMarkdown(markdown, SOURCE_HEADERS, true);
}

function mappingEntries(table: OcrTable): SourceMappingEntry[] {
  const sourceIndex = table.headers.indexOf(SOURCE_HEADERS[0]);
  const filenameIndex = table.headers.indexOf(SOURCE_HEADERS[1]);
  return table.rows.map((row) => ({
    sourceCode: (row[sourceIndex] ?? '').trim(),
    sourceFilename: (row[filenameIndex] ?? '').trim(),
  }));
}

function pairKey(entry: SourceMappingEntry): string {
  return `${entry.sourceCode}\u0000${entry.sourceFilename}`;
}

function uniqueEntries(entries: readonly SourceMappingEntry[]): SourceMappingEntry[] {
  const seen = new Set<string>();
  const result: SourceMappingEntry[] = [];
  for (const entry of entries) {
    const key = pairKey(entry);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

export function validateSourceMapping(
  tableOrEntries: OcrTable | readonly SourceMappingEntry[],
  canonicalEntries: readonly SourceMappingEntry[],
): MappingValidation {
  const actual = 'headers' in tableOrEntries
    ? mappingEntries(tableOrEntries)
    : tableOrEntries.map((entry) => ({ ...entry }));
  const canonical = canonicalEntries.map((entry) => ({
    sourceCode: entry.sourceCode.trim(),
    sourceFilename: entry.sourceFilename.trim(),
  }));
  const canonicalKeys = new Set(canonical.map(pairKey));
  const seen = new Set<string>();
  const duplicates: SourceMappingEntry[] = [];
  const extra: SourceMappingEntry[] = [];
  for (const entry of actual) {
    const key = pairKey(entry);
    if (seen.has(key)) {
      duplicates.push(entry);
      continue;
    }
    seen.add(key);
    if (!canonicalKeys.has(key)) {
      extra.push(entry);
    }
  }
  const actualKeys = new Set(actual.map(pairKey));
  const missing = uniqueEntries(canonical.filter((entry) => !actualKeys.has(pairKey(entry))));
  const different: SourceMappingEntry[] = [];
  const actualByCode = new Map(actual.map((entry) => [entry.sourceCode, entry.sourceFilename]));
  const actualByFilename = new Map(actual.map((entry) => [entry.sourceFilename, entry.sourceCode]));
  for (const entry of canonical) {
    const filename = actualByCode.get(entry.sourceCode);
    const sourceCode = actualByFilename.get(entry.sourceFilename);
    if ((filename !== undefined && filename !== entry.sourceFilename) ||
        (sourceCode !== undefined && sourceCode !== entry.sourceCode)) {
      different.push(entry);
    }
  }

  if (duplicates.length > 0) {
    return { ok: false, kind: 'duplicate', missing, extra, duplicates, different };
  }
  if (different.length > 0) {
    return { ok: false, kind: 'different', missing, extra, duplicates, different };
  }
  if (missing.length > 0) {
    return { ok: false, kind: 'missing', missing, extra, duplicates, different };
  }
  if (extra.length > 0 || actual.length !== canonical.length) {
    return { ok: false, kind: 'extra', missing, extra, duplicates, different };
  }
  return { ok: true, entries: actual };
}

function tableKey(row: readonly string[], headers: readonly string[]): string | undefined {
  const source = (row[headers.indexOf(RESULT_REQUIRED_HEADERS[0])] ?? '').trim();
  const part = (row[headers.indexOf(RESULT_REQUIRED_HEADERS[1])] ?? '').trim();
  if (source === '' || part === '') {
    return undefined;
  }
  return `${source}\u0000${part}`;
}

function countKeys(rows: readonly (readonly string[])[], headers: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = tableKey(row, headers);
    if (key !== undefined) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function alignRow(row: readonly string[], oldHeaders: readonly string[], newHeaders: readonly string[]): string[] {
  const oldValues = new Map(oldHeaders.map((header, index) => [header, row[index] ?? '']));
  return newHeaders.map((header) => oldValues.get(header) ?? '');
}

function sourceOf(row: readonly string[], headers: readonly string[]): string {
  return (row[headers.indexOf(RESULT_REQUIRED_HEADERS[0])] ?? '').trim();
}

function changedCellCount(current: readonly string[], old: readonly string[], headers: readonly string[], oldHeaders: readonly string[]): boolean {
  return headers.some((header, index) => (current[index] ?? '') !== (old[oldHeaders.indexOf(header)] ?? ''));
}

/** Reconcile current OCR rows against previous rows without deleting current data. */
export function reconcileOcrResults(
  previous: OcrTable | undefined,
  current: OcrTable,
  deletedKeys: ReadonlySet<string> = new Set(),
): OcrReconciliation {
  const previousHeaders = previous?.headers ?? current.headers;
  const headers = [...new Set([...previousHeaders, ...current.headers])];
  const previousRows = (previous?.rows ?? []).filter((row) => {
    const key = tableKey(row, previousHeaders);
    return key === undefined || !deletedKeys.has(key);
  });
  const oldCounts = countKeys(previousRows, previousHeaders);
  const currentCounts = countKeys(current.rows, current.headers);
  const duplicateKeys = [...new Set([
    ...[...oldCounts].filter(([, count]) => count > 1).map(([key]) => key),
    ...[...currentCounts].filter(([, count]) => count > 1).map(([key]) => key),
  ])];
  const currentGroups = new Map<string, number[]>();
  const alignedCurrent = current.rows.map((row, index) => {
    const key = tableKey(row, current.headers);
    if (key !== undefined) {
      const group = currentGroups.get(key) ?? [];
      group.push(index);
      currentGroups.set(key, group);
    }
    return alignRow(row, current.headers, headers);
  });
  const providedHeaders = new Set(current.headers);
  const emittedCurrent = new Set<number>();
  const emittedGroups = new Set<string>();
  const restoredRows: Array<readonly string[]> = [];
  const rows: Array<readonly string[]> = [];
  const matchedKeys: string[] = [];
  const changedKeys: string[] = [];

  for (const oldRow of previousRows) {
    const key = tableKey(oldRow, previousHeaders);
    const restored = alignRow(oldRow, previousHeaders, headers);
    if (key === undefined) {
      const sameIndex = alignedCurrent.findIndex((row, index) =>
        !emittedCurrent.has(index) && tableKey(row, headers) === undefined &&
        row.every((value, column) => value === restored[column]),
      );
      if (sameIndex >= 0) emittedCurrent.add(sameIndex);
      rows.push(restored);
      restoredRows.push(restored);
      continue;
    }
    const group = currentGroups.get(key);
    if (!group) {
      rows.push(restored);
      restoredRows.push(restored);
      continue;
    }
    if (emittedGroups.has(key)) continue;
    emittedGroups.add(key);
    for (const index of group) {
      emittedCurrent.add(index);
      const updated = alignedCurrent[index].map((value, column) =>
        providedHeaders.has(headers[column]) ? value : restored[column],
      );
      rows.push(updated);
      if (oldCounts.get(key) === 1 && group.length === 1) {
        matchedKeys.push(key);
        if (changedCellCount(updated, restored, headers, headers)) changedKeys.push(key);
      }
    }
  }

  const sourceGroups = new Map<string, Array<readonly string[]>>();
  const newKeys: string[] = [];
  for (let index = 0; index < alignedCurrent.length; index += 1) {
    if (emittedCurrent.has(index)) continue;
    const row = alignedCurrent[index];
    const source = sourceOf(row, headers);
    const group = sourceGroups.get(source) ?? [];
    group.push(row);
    sourceGroups.set(source, group);
    const key = tableKey(row, headers);
    if (key !== undefined && !oldCounts.has(key) && currentCounts.get(key) === 1) newKeys.push(key);
  }
  for (const [source, extras] of sourceGroups) {
    const insertAt = rows.reduce((last, row, index) => sourceOf(row, headers) === source ? index + 1 : last, -1);
    rows.splice(insertAt < 0 ? rows.length : insertAt, 0, ...extras);
  }

  return { headers, rows, restoredRows, matchedKeys, newKeys, duplicateKeys, changedKeys };
}

function renderTable(table: OcrTable): string {
  const separator = table.headers.map(() => '---');
  const renderRow = (row: readonly string[]) => `| ${row.map((cell) => escapeMarkdownTableCell(cell)).join(' | ')} |`;
  return [
    renderRow(table.headers),
    renderRow(separator),
    ...table.rows.map(renderRow),
  ].join('\n');
}

function getSection(document: ParsedAssistantMarkdown, title: string): MarkdownSection | undefined {
  return document.sections.find((section) => section.title === title);
}

function tableInSection(document: ParsedAssistantMarkdown, title: string, parser: (body: string) => ParsedTable): ParsedTable {
  const section = getSection(document, title);
  return section ? parser(section.body) : { ok: false, reason: 'missing_table' };
}

function trimChunk(chunk: string): string {
  return chunk.replace(/^(?:\r?\n)+/u, '').replace(/(?:\r?\n)+$/u, '');
}

function joinChunks(chunks: readonly string[], newline: '\n' | '\r\n'): string {
  return chunks.map(trimChunk).filter((chunk) => chunk !== '').join(`${newline}${newline}`);
}

function safeOtherText(document: ParsedAssistantMarkdown, used: ReadonlySet<MarkdownSection>): string[] {
  const chunks: string[] = [];
  if (document.preamble !== '') {
    chunks.push(document.preamble);
  }
  for (const segment of document.segments) {
    if (segment.kind === 'section' && !used.has(segment.section) && segment.section.title !== SUMMARY_TITLE) {
      chunks.push(segment.section.raw);
    }
  }
  return chunks;
}

function renderResultSection(table: OcrTable, title = RESULT_TITLE): string {
  return `## ${title}\n\n${renderTable(table)}`;
}

function normalizeInput(
  inputOrResponse: FinalizeOcrResponseInput | string,
  previousOcrMarkdown?: string,
  canonicalMapping?: readonly SourceMappingEntry[],
  delegateSummary = false,
): FinalizeOcrResponseInput {
  if (typeof inputOrResponse !== 'string') {
    return inputOrResponse;
  }
  return {
    assistantResponse: inputOrResponse,
    previousOcrMarkdown,
    canonicalMapping: canonicalMapping ?? [],
    delegateSummary,
  };
}

export function finalizeOcrResponse(input: FinalizeOcrResponseInput): FinalizeOcrResponseResult;
export function finalizeOcrResponse(
  assistantResponse: string,
  previousOcrMarkdown: string | undefined,
  canonicalMapping: readonly SourceMappingEntry[],
  delegateSummary?: boolean,
): FinalizeOcrResponseResult;
export function finalizeOcrResponse(
  inputOrResponse: FinalizeOcrResponseInput | string,
  previousOcrMarkdown?: string,
  canonicalMapping?: readonly SourceMappingEntry[],
  delegateSummary = false,
): FinalizeOcrResponseResult {
  return finalizeOcrResponseInternal(
    normalizeInput(inputOrResponse, previousOcrMarkdown, canonicalMapping, delegateSummary),
  );
}

function finalizeOcrResponseInternal(input: FinalizeOcrResponseInput): FinalizeOcrResponseResult {
  const document = parseAssistantMarkdown(input.assistantResponse);
  const resultTitle = document.sections.find((section) => steelSectionBaseTitle(section.title) === RESULT_TITLE)?.title ?? RESULT_TITLE;
  const admission = admitFullOnlyMarkdown({
    markdown: input.assistantResponse,
    kind: 'ocr_result',
    title: resultTitle,
    messageId: input.messageId ?? 'completion-response',
  });
  if (!admission.ok) {
    if (admission.code === 'retired_control_section') {
      return { ok: false, reason: 'retired_control_section' };
    }
    if (admission.code === 'duplicate_full_target') {
      return { ok: false, reason: 'duplicate_ocr_result' };
    }
    return { ok: false, reason: 'missing_ocr_result' };
  }
  const resultParsed = tableInSection(document, resultTitle, (markdown) => tableFromMarkdown(markdown, [], false));
  if (resultParsed.ok === false) {
    return { ok: false, reason: resultParsed.reason === 'missing_table' ? 'missing_ocr_result' : 'invalid_ocr_result_table' };
  }
  const mappingParsed = tableInSection(document, SOURCE_TITLE, parseSourceMappingTable);
  const requiresCanonicalMapping = input.agentKind === 'delegate_ocr' || input.agentKind === 'regular_ocr';
  if (mappingParsed.ok === false && requiresCanonicalMapping) {
    return {
      ok: false,
      reason: 'mapping_mismatch',
      mappingRetryable: true,
      mapping: {
        ok: false,
        kind: mappingParsed.reason === 'missing_table' ? 'missing' : 'different',
        missing: input.canonicalMapping,
        extra: [],
        duplicates: [],
        different: [],
      },
    };
  }
  const mappingValidation = mappingParsed.ok
    ? validateSourceMapping(mappingParsed.table, input.canonicalMapping)
    : { ok: true as const, entries: [...input.canonicalMapping] };
  if (mappingValidation.ok === false && requiresCanonicalMapping) {
    return {
      ok: false,
      reason: 'mapping_mismatch',
      mapping: mappingValidation,
      mappingRetryable: true,
    };
  }
  const mapping: MappingValidationSuccess = mappingValidation.ok
    ? mappingValidation
    : { ok: true, entries: mappingParsed.ok ? mappingEntries(mappingParsed.table) : [] };

  const reconciliation = reconcileOcrResults(undefined, normalizeOcrTable(resultParsed.table));
  const review = getSection(document, REVIEW_TITLE);
  const used = new Set<MarkdownSection>([...document.sections.filter((section) =>
    section.title === SOURCE_TITLE || section.title === resultTitle || section.title === REVIEW_TITLE)]);
  const chunks: string[] = [];
  const sourceSection = getSection(document, SOURCE_TITLE);
  if (input.agentKind === 'regular_ocr') {
    chunks.push(
      `## ${SOURCE_TITLE}\n\n${renderTable({ headers: SOURCE_HEADERS, rows: input.canonicalMapping.map((entry) => [entry.sourceCode, entry.sourceFilename]) })}`,
    );
  } else if (sourceSection) {
    chunks.push(sourceSection.raw);
  } else if (requiresCanonicalMapping) {
    chunks.push(`## ${SOURCE_TITLE}\n\n${renderTable({ headers: SOURCE_HEADERS, rows: mapping.entries.map((entry) => [entry.sourceCode, entry.sourceFilename]) })}`);
  }
  chunks.push(renderResultSection({ headers: reconciliation.headers, rows: reconciliation.rows }, resultTitle));
  if (review) {
    chunks.push(review.raw);
  }
  chunks.push(...safeOtherText(document, used));
  const ocrResultMarkdown = renderResultSection({ headers: reconciliation.headers, rows: reconciliation.rows }, resultTitle);
  const finalResponse = joinChunks(chunks, document.newline);
  return {
    ok: true,
    finalResponse,
    ocrResultMarkdown,
    mapping,
    reconciliation,
    summary: '',
  };
}
