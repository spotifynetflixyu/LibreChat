import { parseMarkdownTables } from '../markdown/table';
import { escapeMarkdownTableCell } from '../markdown/row-codec';

const H2_PATTERN = /^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/u;
const FENCE_START_PATTERN = /^ {0,3}(`{3,}|~{3,})/u;
const FENCE_END_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;
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

export interface OcrTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface MarkdownSection {
  readonly title: string;
  readonly heading: string;
  readonly body: string;
  readonly raw: string;
}

export type MarkdownSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'section'; readonly section: MarkdownSection };

export interface ParsedAssistantMarkdown {
  readonly newline: '\n' | '\r\n';
  readonly preamble: string;
  readonly sections: readonly MarkdownSection[];
  readonly segments: readonly MarkdownSegment[];
}

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

export interface OcrUpdateSummary {
  readonly markdown: string;
  readonly changed: boolean;
  readonly changedKeys: readonly string[];
  readonly newKeys: readonly string[];
  readonly unkeyedRows: readonly (readonly string[])[];
}

export type OcrAgentKind = 'delegate_ocr' | 'regular_ocr' | 'other';

export interface FinalizeOcrResponseInput {
  readonly assistantResponse: string;
  readonly previousOcrMarkdown?: string;
  readonly canonicalMapping: readonly SourceMappingEntry[];
  readonly delegateSummary?: boolean;
  readonly agentKind?: OcrAgentKind;
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

interface MarkdownFence {
  readonly marker: '`' | '~';
  readonly length: number;
}

interface LinePart {
  readonly content: string;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

interface KeyedRow {
  readonly key: string;
  readonly row: readonly string[];
}

function getLines(markdown: string): LinePart[] {
  const lines: LinePart[] = [];
  const pattern = /([^\r\n]*)(\r\n|\n|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const content = match[1] ?? '';
    const ending = match[2] ?? '';
    const start = match.index;
    const end = start + match[0].length;
    lines.push({ content, raw: `${content}${ending}`, start, end });
    if (ending === '') {
      break;
    }
  }
  return lines;
}

function normalizeTitle(line: string): string | undefined {
  const match = H2_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }
  return (match[1] ?? '').replace(/[ \t]+#+[ \t]*$/u, '').trim();
}

function getFenceStart(line: string): MarkdownFence | undefined {
  const markerText = FENCE_START_PATTERN.exec(line)?.[1];
  const marker = markerText?.[0];
  if (!markerText || (marker !== '`' && marker !== '~')) {
    return undefined;
  }
  return { marker, length: markerText.length };
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const markerText = FENCE_END_PATTERN.exec(line)?.[1];
  return markerText?.[0] === fence.marker && markerText.length >= fence.length;
}

/** Parse H2 sections while retaining exact section slices and non-section text. */
export function parseAssistantMarkdown(markdown: string): ParsedAssistantMarkdown {
  const lines = getLines(markdown);
  const starts: Array<{ readonly index: number; readonly title: string }> = [];
  let fence: MarkdownFence | undefined;

  for (const [index, line] of lines.entries()) {
    if (fence) {
      if (closesFence(line.content, fence)) {
        fence = undefined;
      }
      continue;
    }
    const nextFence = getFenceStart(line.content);
    if (nextFence) {
      fence = nextFence;
      continue;
    }
    const title = normalizeTitle(line.content);
    if (title !== undefined) {
      starts.push({ index, title });
    }
  }

  const sections: MarkdownSection[] = starts.map((start, position) => {
    const next = starts[position + 1];
    const headingLine = lines[start.index];
    const sectionEnd = next ? lines[next.index]?.start ?? markdown.length : markdown.length;
    const bodyStart = headingLine?.end ?? sectionEnd;
    const raw = markdown.slice(headingLine?.start ?? sectionEnd, sectionEnd);
    return {
      title: start.title,
      heading: headingLine?.content ?? '',
      body: markdown.slice(bodyStart, sectionEnd),
      raw,
    };
  });

  const preamble = starts.length > 0 ? markdown.slice(0, lines[starts[0]?.index ?? 0]?.start ?? 0) : markdown;
  const segments: MarkdownSegment[] = [];
  if (preamble !== '') {
    segments.push({ kind: 'text', text: preamble });
  }
  sections.forEach((section) => segments.push({ kind: 'section', section }));

  return {
    newline: markdown.includes('\r\n') ? '\r\n' : '\n',
    preamble,
    sections,
    segments,
  };
}

/** Alias retained for callers that use the shorter parser name. */
export const parseMarkdownSections: typeof parseAssistantMarkdown = parseAssistantMarkdown;

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
  const table = parseMarkdownTables(visibleMarkdown)[0];
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

/** Alias for callers parsing a generic OCR table. */
export const parseOcrTable: typeof parseOcrResultTable = parseOcrResultTable;

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

function keyRows(rows: readonly (readonly string[])[], headers: readonly string[]): KeyedRow[] {
  return rows.flatMap((row) => {
    const key = tableKey(row, headers);
    return key === undefined ? [] : [{ key, row }];
  });
}

function changedCellCount(current: readonly string[], old: readonly string[], headers: readonly string[], oldHeaders: readonly string[]): boolean {
  return headers.some((header, index) => (current[index] ?? '') !== (old[oldHeaders.indexOf(header)] ?? ''));
}

/** Reconcile current OCR rows against previous rows without deleting current data. */
export function reconcileOcrResults(
  previous: OcrTable | undefined,
  current: OcrTable,
): OcrReconciliation {
  const currentHeaders = [...current.headers];
  const previousRows = previous?.rows ?? [];
  const previousHeaders = previous?.headers ?? currentHeaders;
  const oldCounts = countKeys(previousRows, previousHeaders);
  const currentCounts = countKeys(current.rows, currentHeaders);
  const duplicateKeys = [...new Set([
    ...[...oldCounts].filter(([, count]) => count > 1).map(([key]) => key),
    ...[...currentCounts].filter(([, count]) => count > 1).map(([key]) => key),
  ])];
  const duplicateSet = new Set(duplicateKeys);
  const currentByKey = new Map<string, readonly string[]>();
  for (const keyed of keyRows(current.rows, currentHeaders)) {
    if ((currentCounts.get(keyed.key) ?? 0) === 1) {
      currentByKey.set(keyed.key, keyed.row);
    }
  }

  const emittedCurrent = new Set<number>();
  const restoredRows: Array<readonly string[]> = [];
  const rows: Array<readonly string[]> = [];
  const matchedKeys: string[] = [];
  const changedKeys: string[] = [];
  const oldEligible = new Set<string>();
  for (const keyed of keyRows(previousRows, previousHeaders)) {
    if ((oldCounts.get(keyed.key) ?? 0) === 1 && !duplicateSet.has(keyed.key)) {
      oldEligible.add(keyed.key);
    }
  }

  for (const oldKeyed of keyRows(previousRows, previousHeaders)) {
    const oldCount = oldCounts.get(oldKeyed.key) ?? 0;
    if (oldCount > 1) {
      if ((currentCounts.get(oldKeyed.key) ?? 0) === 0) {
        const restored = alignRow(oldKeyed.row, previousHeaders, currentHeaders);
        rows.push(restored);
        restoredRows.push(restored);
      }
      continue;
    }
    if (oldCount !== 1 || duplicateSet.has(oldKeyed.key)) {
      continue;
    }
    const currentRow = currentByKey.get(oldKeyed.key);
    if (currentRow) {
      rows.push([...currentRow]);
      const currentIndex = current.rows.findIndex((row) => row === currentRow);
      if (currentIndex >= 0) {
        emittedCurrent.add(currentIndex);
      }
      matchedKeys.push(oldKeyed.key);
      if (changedCellCount(currentRow, oldKeyed.row, currentHeaders, previousHeaders)) {
        changedKeys.push(oldKeyed.key);
      }
      continue;
    }
    const restored = alignRow(oldKeyed.row, previousHeaders, currentHeaders);
    rows.push(restored);
    restoredRows.push(restored);
  }

  const currentExtras = current.rows
    .map((row, index) => ({ row, index, key: tableKey(row, currentHeaders) }))
    .filter(({ index, key }) => !emittedCurrent.has(index) && (key === undefined || !oldEligible.has(key) || duplicateSet.has(key)));
  const sourceGroups = new Map<string, Array<{ readonly row: readonly string[]; readonly index: number }>>();
  const groupOrder: string[] = [];
  for (const extra of currentExtras) {
    const source = sourceOf(extra.row, currentHeaders);
    if (!sourceGroups.has(source)) {
      sourceGroups.set(source, []);
      groupOrder.push(source);
    }
    sourceGroups.get(source)?.push(extra);
  }
  for (const source of groupOrder) {
    const extras = sourceGroups.get(source) ?? [];
    const insertAt = rows.reduce((last, row, index) => sourceOf(row, currentHeaders) === source ? index + 1 : last, -1);
    if (insertAt < 0) {
      rows.push(...extras.map(({ row }) => [...row]));
    } else {
      rows.splice(insertAt, 0, ...extras.map(({ row }) => [...row]));
    }
  }

  const newKeys = currentExtras
    .map(({ key }) => key)
    .filter((key): key is string => key !== undefined && !duplicateSet.has(key) && !oldEligible.has(key));
  return {
    headers: currentHeaders,
    rows,
    restoredRows,
    matchedKeys,
    newKeys: [...new Set(newKeys)],
    duplicateKeys,
    changedKeys,
  };
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

function summaryRowValue(current: string, old: string | undefined, matched: boolean): string {
  if (!matched || current === (old ?? '')) {
    return current;
  }
  return `${current} (~~${old ?? ''}~~)`;
}

/** Build delegate-only summary from current rows and previous values. */
export function buildOcrUpdateSummary(
  previous: OcrTable | undefined,
  current: OcrTable,
  reconciliation?: OcrReconciliation,
): OcrUpdateSummary {
  const result = reconciliation ?? reconcileOcrResults(previous, current);
  const oldHeaders = previous?.headers ?? current.headers;
  const oldRowsByKey = new Map<string, readonly string[]>();
  const oldCounts = countKeys(previous?.rows ?? [], oldHeaders);
  for (const keyed of keyRows(previous?.rows ?? [], oldHeaders)) {
    if ((oldCounts.get(keyed.key) ?? 0) === 1 && !result.duplicateKeys.includes(keyed.key)) {
      oldRowsByKey.set(keyed.key, keyed.row);
    }
  }
  const currentCounts = countKeys(current.rows, current.headers);
  const summaryRows: Array<readonly string[]> = [];
  const changedKeys: string[] = [];
  const newKeys: string[] = [];
  const unkeyedRows: Array<readonly string[]> = [];
  const seenCurrentKeys = new Set<string>();
  for (const row of current.rows) {
    const key = tableKey(row, current.headers);
    if (key === undefined) {
      summaryRows.push([...row]);
      unkeyedRows.push([...row]);
      continue;
    }
    if ((currentCounts.get(key) ?? 0) !== 1 || result.duplicateKeys.includes(key)) {
      continue;
    }
    if (seenCurrentKeys.has(key)) {
      continue;
    }
    seenCurrentKeys.add(key);
    const old = oldRowsByKey.get(key);
    if (!old) {
      summaryRows.push([...row]);
      newKeys.push(key);
      continue;
    }
    if (changedCellCount(row, old, current.headers, oldHeaders)) {
      summaryRows.push(current.headers.map((header, index) => {
        const oldIndex = oldHeaders.indexOf(header);
        return summaryRowValue(row[index] ?? '', oldIndex >= 0 ? old[oldIndex] : '', true);
      }));
      changedKeys.push(key);
    }
  }
  const changed = summaryRows.length > 0;
  const markdown = changed
    ? `## ${SUMMARY_TITLE}\n\n${renderTable({ headers: current.headers, rows: summaryRows })}`
    : '無變動資料';
  return { markdown, changed, changedKeys, newKeys, unkeyedRows };
}

function getSection(document: ParsedAssistantMarkdown, title: string): MarkdownSection | undefined {
  return document.sections.find((section) => section.title === title);
}

function tableInSection(document: ParsedAssistantMarkdown, title: string, parser: (body: string) => ParsedTable): ParsedTable {
  const section = getSection(document, title);
  return section ? parser(section.body) : { ok: false, reason: 'missing_table' };
}

function parsePreviousTable(markdown: string | undefined): OcrTable | undefined {
  if (!markdown) {
    return undefined;
  }
  const document = parseAssistantMarkdown(markdown);
  const section = getSection(document, RESULT_TITLE);
  const parsed = parseOcrResultTable(section?.body ?? markdown);
  return parsed.ok ? parsed.table : undefined;
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

function renderResultSection(table: OcrTable): string {
  return `## ${RESULT_TITLE}\n\n${renderTable(table)}`;
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
  const input = normalizeInput(inputOrResponse, previousOcrMarkdown, canonicalMapping, delegateSummary);
  const document = parseAssistantMarkdown(input.assistantResponse);
  const resultParsed = tableInSection(document, RESULT_TITLE, parseOcrResultTable);
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

  const previous = parsePreviousTable(input.previousOcrMarkdown);
  const reconciliation = reconcileOcrResults(previous, resultParsed.table);
  const summaryResult = buildOcrUpdateSummary(previous, resultParsed.table, reconciliation);
  const review = getSection(document, REVIEW_TITLE);
  const used = new Set<MarkdownSection>([...document.sections.filter((section) =>
    section.title === SOURCE_TITLE || section.title === RESULT_TITLE || section.title === REVIEW_TITLE || section.title === SUMMARY_TITLE)]);
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
  chunks.push(renderResultSection({ headers: reconciliation.headers, rows: reconciliation.rows }));
  if (review) {
    chunks.push(review.raw);
  }
  chunks.push(...safeOtherText(document, used));
  if (input.delegateSummary) {
    chunks.push(summaryResult.markdown);
  }
  const finalResponse = joinChunks(chunks, document.newline);
  return {
    ok: true,
    finalResponse,
    ocrResultMarkdown: renderResultSection({ headers: reconciliation.headers, rows: reconciliation.rows }),
    mapping,
    reconciliation,
    summary: input.delegateSummary ? summaryResult.markdown : '',
  };
}
