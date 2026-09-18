import { parseMarkdownTables } from '../markdown/table';
import { escapeMarkdownTableCell, parsePipeTableRow } from '../markdown/row-codec';
import { buildCustomerQuoteFromMarkdown } from '../markdown/quote';
import { normalizeSystemOrderMarkdown } from '../markdown/order';
import { parseAssistantMarkdown, parseOcrResultTable } from '../ocr/result';

import type { SteelToolResult } from '../tools/results';

export const quotationSystemOrderColumns = [
  '型號',
  '品名規格',
  '材質編號',
  '單位',
  '數量',
  '單重',
  '總數',
  '單價',
  '計價基準',
  '公式編號',
  '厚度',
  '寬度',
  '長度',
  '肚',
  '類別',
  '備註',
] as const;

export const quotationManualReviewColumns = [
  '來源表格',
  '來源件號 / 項次',
  '問題欄位',
  '目前判斷',
  '需確認內容',
  '影響範圍',
] as const;

export const quotationSignal = '## quote_signal\n\nstart';

export type QuotationSystemOrderColumn = (typeof quotationSystemOrderColumns)[number];
export type QuotationManualReviewColumn = (typeof quotationManualReviewColumns)[number];

export interface QuotationSignal {
  readonly action: 'start';
}

export interface QuotationSourceRow {
  readonly sourceRowId: string;
  readonly sourceRowIndex: number;
  readonly category: string;
  readonly cells: readonly string[];
}

export interface QuotationChunkTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface QuotationChunk {
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly categoryIndex: number;
  readonly categoryChunkIndex: number;
  readonly categoryChunkCount: number;
  readonly category: string;
  readonly sourceRows: readonly QuotationSourceRow[];
  readonly table: QuotationChunkTable;
  readonly markdown: string;
}

export interface QuotationPythonEvidence {
  readonly type: 'tool-call' | 'tool-result';
  readonly toolCallId: string;
  readonly payload: string;
}

export interface QuotationLookupEvidence {
  readonly lookupCallId: string;
  readonly persisted: true;
  readonly result: SteelToolResult;
}

export interface QuotationChildResultInput {
  readonly chunk: QuotationChunk;
  readonly response?: string;
  readonly markdown?: string;
  readonly lookupEvidence: readonly QuotationLookupEvidence[];
  readonly pythonEvidence?: readonly QuotationPythonEvidence[];
  readonly customerTier?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
}

export interface ValidatedQuotationChildResult {
  readonly chunk: QuotationChunk;
  readonly markdown: string;
  readonly table: QuotationChunkTable;
  readonly rows: readonly (readonly string[])[];
  readonly reviewTable?: QuotationChunkTable;
}

export interface QuotationProtocolFailure {
  readonly code: QuotationProtocolErrorCode;
  readonly recoverable: true;
}

export type QuotationProtocolErrorCode =
  | 'invalid_signal'
  | 'invalid_customer_data'
  | 'invalid_ocr_result'
  | 'invalid_child_result'
  | 'incomplete_aggregate'
  | 'invalid_main_result';

export class QuotationProtocolError extends Error implements QuotationProtocolFailure {
  readonly recoverable = true as const;

  constructor(
    readonly code: QuotationProtocolErrorCode,
    message: string,
    readonly requiresFreshLookup = false,
  ) {
    super(message);
    this.name = 'QuotationProtocolError';
  }
}

function protocolError(code: QuotationProtocolErrorCode, message: string, requiresFreshLookup = false): never {
  throw new QuotationProtocolError(code, message, requiresFreshLookup);
}

export function quotationOutputRequiresFreshLookup(response: string): boolean {
  return response.includes('search_price_candidates') && (
    /<\|[^|\r\n]{1,80}\|>/u.test(response) || /\bassistant\s+to\s*=/iu.test(response)
  );
}

function baseSectionTitle(title: string): string {
  const separator = title.indexOf('｜');
  return (separator < 0 ? title : title.slice(0, separator)).trim();
}

function sectionBodyWithoutFences(body: string): string {
  const lines = body.split(/\r?\n/u);
  const visible: string[] = [];
  let fence: '`' | '~' | undefined;
  let fenceLength = 0;
  for (const line of lines) {
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1];
      if (closing?.[0] === fence && closing.length >= fenceLength) fence = undefined;
      continue;
    }
    if (opening) {
      fence = opening[0] as '`' | '~';
      fenceLength = opening.length;
      continue;
    }
    visible.push(line);
  }
  return visible.join('\n');
}

function exactSection(document: ReturnType<typeof parseAssistantMarkdown>, title: string) {
  const sections = document.sections.filter((section) => baseSectionTitle(section.title) === title);
  return sections.length === 1 ? sections[0] : undefined;
}

function parseExactTable(
  body: string,
  headers: readonly string[],
): QuotationChunkTable | undefined {
  const tables = parseMarkdownTables(sectionBodyWithoutFences(body));
  if (tables.length !== 1) return undefined;
  const table = tables[0];
  if (
    table.headers.length !== headers.length ||
    headers.some((header, index) => table.headers[index] !== header) ||
    table.rows.length === 0 ||
    table.rows.some((row) => row.length !== headers.length)
  ) return undefined;
  return {
    headers: [...table.headers],
    rows: table.rows.map((row) => [...row]),
  };
}

function hasEscapedTrailingPipe(line: string): boolean {
  const trimmed = line.trimEnd();
  if (!trimmed.endsWith('|')) return false;
  let backslashes = 0;
  for (let index = trimmed.length - 2; index >= 0 && trimmed[index] === '\\'; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function normalizeMissingTrailingPipes(body: string, expectedColumns: number): string {
  return body.split(/\r?\n/u).map((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) return line;
    const missingTrailingPipe = !trimmed.endsWith('|') || hasEscapedTrailingPipe(trimmed);
    if (!missingTrailingPipe || parsePipeTableRow(trimmed)?.length !== expectedColumns) return line;
    return `${line.trimEnd()} |`;
  }).join('\n');
}

function incompleteTableRow(body: string): { line: number; columns: number } | undefined {
  const lines = sectionBodyWithoutFences(body).split(/\r?\n/u);
  const index = lines.findIndex((line) => line.trim().startsWith('|') &&
    (line.trim().length === 1 || !line.trim().endsWith('|')));
  return index < 0 ? undefined : { line: index + 1, columns: parsePipeTableRow(lines[index]!)?.length ?? 0 };
}

export function parseQuotationSignal(response: string): QuotationSignal | undefined {
  const section = exactSection(parseAssistantMarkdown(response), 'quote_signal');
  return section?.title === 'quote_signal' && section.body.trim() === 'start'
    ? { action: 'start' } : undefined;
}

export function extractCustomerDataTable(response: string): QuotationChunkTable | undefined {
  const document = parseAssistantMarkdown(response);
  const section = exactSection(document, 'customer_data');
  if (!section) return undefined;
  const tables = parseMarkdownTables(sectionBodyWithoutFences(section.body));
  if (
    tables.length !== 1 ||
    tables[0]?.rows.length === 0 ||
    tables[0]?.rows.some((row) => row.length !== tables[0]?.headers.length)
  ) return undefined;
  return tables[0]
    ? { headers: [...tables[0].headers], rows: tables[0].rows.map((row) => [...row]) }
    : undefined;
}

export const parseCustomerDataTable: typeof extractCustomerDataTable = extractCustomerDataTable;

function renderTable(table: QuotationChunkTable): string {
  return [
    `| ${table.headers.map(escapeMarkdownTableCell).join(' | ')} |`,
    `| ${table.headers.map(() => '---').join(' | ')} |`,
    ...table.rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`),
  ].join('\n');
}

function renderQuotationChunkTable(table: QuotationChunkTable): string {
  return `## system_order_chunk\n\n${renderTable(table)}`;
}

function readOcrResultTable(fullOcrResult: string): QuotationChunkTable {
  const document = parseAssistantMarkdown(fullOcrResult);
  const section = exactSection(document, 'ocr_result');
  if (!section) protocolError('invalid_ocr_result', 'Quotation requires exactly one ocr_result section.');
  const visibleTables = parseMarkdownTables(sectionBodyWithoutFences(section.body));
  if (visibleTables.length !== 1) protocolError('invalid_ocr_result', 'Quotation requires exactly one ocr_result table.');
  const parsed = parseOcrResultTable(section.body);
  if (!parsed.ok || parsed.table.rows.length === 0 ||
    !parsed.table.headers.includes('來源') || !parsed.table.headers.includes('零件編號')) {
    protocolError('invalid_ocr_result', 'Quotation requires a complete non-empty ocr_result table.');
  }
  return { headers: [...parsed.table.headers], rows: parsed.table.rows.map((row) => [...row]) };
}

export function buildQuotationChunks(fullOcrResult: string): readonly QuotationChunk[] {
  const table = readOcrResultTable(fullOcrResult);
  const categoryIndex = table.headers.indexOf('類別');
  if (categoryIndex < 0) protocolError('invalid_ocr_result', 'ocr_result must contain a 類別 column for quotation chunking.');

  const categories: Array<{ category: string; rows: QuotationSourceRow[] }> = [];
  const categoryPositions = new Map<string, number>();
  table.rows.forEach((cells, rowIndex) => {
    const category = (cells[categoryIndex] ?? '').trim();
    const existing = categoryPositions.get(category);
    const position = existing ?? categories.length;
    if (existing === undefined) {
      categoryPositions.set(category, position);
      categories.push({ category, rows: [] });
    }
    categories[position]?.rows.push({
      sourceRowId: `source-row-${rowIndex + 1}`,
      sourceRowIndex: rowIndex,
      category,
      cells: [...cells],
    });
  });

  const chunks: QuotationChunk[] = [];
  const chunkCount = categories.reduce((count, entry) => count + Math.ceil(entry.rows.length / 30), 0);
  let chunkIndex = 0;
  categories.forEach((entry, categoryIndex) => {
    const categoryChunkCount = Math.ceil(entry.rows.length / 30);
    for (let offset = 0; offset < entry.rows.length; offset += 30) {
      const sourceRows = entry.rows.slice(offset, offset + 30);
      chunkIndex += 1;
      const chunkTable: QuotationChunkTable = {
        headers: [...table.headers],
        rows: sourceRows.map((row) => [...row.cells]),
      };
      chunks.push({
        chunkIndex,
        chunkCount,
        categoryIndex,
        categoryChunkIndex: Math.floor(offset / 30) + 1,
        categoryChunkCount,
        category: entry.category,
        sourceRows,
        table: chunkTable,
        markdown: renderQuotationChunkTable(chunkTable),
      });
    }
  });
  return chunks;
}

export function splitQuotationChunk(chunk: QuotationChunk): readonly QuotationChunk[] {
  const slices: QuotationChunk[] = [];
  for (let offset = 0; offset < chunk.sourceRows.length; offset += 10) {
    const sourceRows = chunk.sourceRows.slice(offset, offset + 10);
    const table = { headers: chunk.table.headers, rows: sourceRows.map((row) => row.cells) };
    slices.push({ ...chunk, sourceRows, table, markdown: renderQuotationChunkTable(table) });
  }
  return slices;
}

export function mergeQuotationChildResults(
  parent: QuotationChunk,
  children: readonly QuotationChildResultInput[],
): string {
  const sources = children.flatMap((child) => child.chunk.sourceRows);
  if (sources.length !== parent.sourceRows.length || sources.some((source, index) =>
    source.sourceRowId !== parent.sourceRows[index]!.sourceRowId ||
    JSON.stringify(source.cells) !== JSON.stringify(parent.sourceRows[index]!.cells))) {
    throw new Error('Quotation recovery slices do not match the original source rows');
  }
  const validated = children.map(validateQuotationChildResult);
  const rows = validated.flatMap((child) => child.rows);
  const reviews = validated.flatMap((child) => child.reviewTable?.rows ?? []);
  return [
    renderQuotationChunkTable({ headers: quotationSystemOrderColumns, rows }),
    ...(reviews.length ? [`## manual_reviews_chunk\n\n${renderTable({ headers: quotationManualReviewColumns, rows: reviews })}`] : []),
  ].join('\n\n');
}

function isQuoteControlFence(language: string, content: string): boolean {
  if (/^(?:json|application\/json)$/iu.test(language.trim())) {
    try {
      const value: unknown = JSON.parse(content);
      if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
        ['quote_lineage', 'quote_signal', 'quote_summary', 'summary', 'customer_quote'].some((key) =>
          Object.prototype.hasOwnProperty.call(value, key))) return true;
    } catch {
      return /(?:quote_lineage|quote_signal|quote_summary|customer_quote|summary)/iu.test(content);
    }
  }
  return /["'](?:quote_lineage|quote_signal|quote_summary|summary|customer_quote)["']\s*:/iu.test(content) ||
    /(?:^|\r?\n)\s*##\s+(?:customer_quote|quote_signal|quote_lineage|quote_summary|summary)(?:｜|[ \t]|$)/imu.test(content);
}

function stripControlFencedBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/u);
  const output: string[] = [];
  let opening:
    | { readonly marker: '`' | '~'; readonly length: number; readonly language: string; readonly lines: string[] }
    | undefined;
  for (const line of lines) {
    if (!opening) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/u);
      if (!match) {
        output.push(line);
        continue;
      }
      opening = { marker: match[1]![0] as '`' | '~', length: match[1]!.length, language: match[2]!.trim(), lines: [line] };
      continue;
    }
    const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1];
    opening.lines.push(line);
    if (closing?.[0] === opening.marker && closing.length >= opening.length) {
      const content = opening.lines.slice(1, -1).join('\n');
      if (!isQuoteControlFence(opening.language, content)) output.push(...opening.lines);
      opening = undefined;
    }
  }
  if (opening) output.push(...opening.lines);
  return output.join('\n');
}

/** Removes a legacy child control sidecar while preserving its Markdown table. */
export function stripLegacyQuotationChildSidecars(markdown: string): string {
  return stripControlFencedBlocks(markdown);
}

function evidenceIsPersistedSearch(evidence: readonly QuotationLookupEvidence[]): boolean {
  return evidence.length > 0 && evidence.every((entry) =>
    entry.persisted === true && entry.lookupCallId.trim() !== '' && entry.result.toolName === 'search_price_candidates');
}

function validateChildTable(input: QuotationChildResultInput): ValidatedQuotationChildResult {
  const response = input.response ?? input.markdown;
  if (!response) protocolError('invalid_child_result', 'Quotation child result is empty.');
  const leakedControlLine = response.split(/\r?\n/u).findIndex((line) =>
    /<\|[^|\r\n]{1,80}\|>/u.test(line) || /\bassistant\s+to\s*=/iu.test(line));
  if (leakedControlLine >= 0) {
    protocolError('invalid_child_result', `Quotation child result contains model control text on line ${leakedControlLine + 1}. Use actual tool calls for lookups; return only complete Markdown tables, without role or channel markers.`, quotationOutputRequiresFreshLookup(response));
  }
  const sanitizedResponse = stripLegacyQuotationChildSidecars(response);
  const document = parseAssistantMarkdown(sanitizedResponse);
  const section = exactSection(document, 'system_order_chunk');
  const reviewSection = exactSection(document, 'manual_reviews_chunk');
  if (!section || section.title !== 'system_order_chunk' ||
    document.sections[0] !== section ||
    document.sections.length !== (reviewSection ? 2 : 1) ||
    (reviewSection && reviewSection.title !== 'manual_reviews_chunk') ||
    /^ {0,3}(`{3,}|~{3,})/mu.test(sanitizedResponse)) {
    protocolError('invalid_child_result', 'Child result must contain one 16-column system_order_chunk followed by an optional manual_reviews_chunk Markdown table.');
  }
  const normalizedSectionBody = normalizeMissingTrailingPipes(section.body, quotationSystemOrderColumns.length);
  const normalizedReviewBody = reviewSection
    ? normalizeMissingTrailingPipes(reviewSection.body, quotationManualReviewColumns.length)
    : undefined;
  for (const [title, body, width] of [
    ['system_order_chunk', normalizedSectionBody, quotationSystemOrderColumns.length],
    ['manual_reviews_chunk', normalizedReviewBody, quotationManualReviewColumns.length],
  ] as const) {
    const row = body ? incompleteTableRow(body) : undefined;
    if (row) protocolError('invalid_child_result', `Quotation child result contains an incomplete Markdown row in ${title} at section line ${row.line}: expected ${width} columns, found ${row.columns}; return the complete replacement table before saving the chunk.`);
  }
  const table = parseExactTable(normalizedSectionBody, quotationSystemOrderColumns);
  if (!table) {
    protocolError('invalid_child_result', 'Child result has an invalid system_order_chunk table.');
  }
  const reviewTable = normalizedReviewBody && parseExactTable(normalizedReviewBody, quotationManualReviewColumns);
  if (reviewSection && !reviewTable) {
    protocolError('invalid_child_result', 'Child result has an invalid manual_reviews_chunk table.');
  }
  if (!evidenceIsPersistedSearch(input.lookupEvidence)) {
    protocolError('invalid_child_result', 'Child result requires a persisted search_price_candidates attempt.');
  }
  return {
    chunk: input.chunk,
    markdown: [renderQuotationChunkTable(table), reviewTable
      ? `## manual_reviews_chunk\n\n${renderTable(reviewTable)}` : ''].filter(Boolean).join('\n\n'),
    table,
    rows: table.rows,
    ...(reviewTable ? { reviewTable } : {}),
  };
}

export function validateQuotationChildResult(input: QuotationChildResultInput): ValidatedQuotationChildResult {
  return validateChildTable(input);
}

export const validateQuotationChunkResult: typeof validateQuotationChildResult = validateQuotationChildResult;

function sectionRows(text: string, title: string): { heading: string; table: QuotationChunkTable } | undefined {
  const document = parseAssistantMarkdown(text);
  const section = exactSection(document, title);
  if (!section) return undefined;
  const tables = parseMarkdownTables(sectionBodyWithoutFences(section.body));
  if (tables.length !== 1 || tables[0]!.rows.length === 0 ||
    tables[0]!.rows.some((row) => row.length !== tables[0]!.headers.length)) return undefined;
  return {
    heading: section.heading.trim(),
    table: { headers: [...tables[0]!.headers], rows: tables[0]!.rows.map((row) => [...row]) },
  };
}

function sectionCount(text: string, title: string): number {
  return parseAssistantMarkdown(text).sections.filter((section) => baseSectionTitle(section.title) === title).length;
}

function stripQuoteControls(text: string): string {
  const withoutSidecars = stripControlFencedBlocks(text);
  const document = parseAssistantMarkdown(
    withoutSidecars.replace(/(?:^|\r?\n)[ \t]*查價輸出完成：[^\r\n]*(?:\r?\n|$)/gu, '\n'),
  );
  const removedTitles = new Set([
    'system_order_chunk',
    'manual_reviews_chunk',
    'customer_quote',
    'quote_signal',
    'quote_lineage',
    'quote_summary',
    'summary',
  ]);
  const chunks: string[] = [document.preamble.trimEnd()];
  document.sections.forEach((section) => {
    if (!removedTitles.has(baseSectionTitle(section.title))) chunks.push(section.raw.trim());
  });
  return chunks.filter(Boolean).join(document.newline + document.newline);
}

export interface FinalizeQuotationMainInput {
  readonly fullOcrResult: string;
  readonly mainResponse: string;
  readonly childResults: readonly QuotationChildResultInput[];
}

export interface FinalizedQuotationResponse {
  readonly response: string;
  readonly systemOrderMarkdown: string;
  readonly customerQuoteMarkdown: string;
  readonly summary: string;
  readonly rows: readonly (readonly string[])[];
}

export function finalizeQuotationMainResponse(input: FinalizeQuotationMainInput): FinalizedQuotationResponse {
  if (input.childResults.length === 0) protocolError('incomplete_aggregate', 'Quotation has no child results.');
  input.childResults.forEach(validateChildTable);

  const mainResponse = normalizeSystemOrderMarkdown(input.mainResponse);
  const main = sectionRows(mainResponse, 'system_order');
  if (!main || main.table.headers.length !== quotationSystemOrderColumns.length ||
    main.table.headers.some((header, index) => header !== quotationSystemOrderColumns[index])) {
    protocolError('invalid_main_result', 'Quotation main result must contain one exact 16-column system_order table.');
  }
  const reviewCount = sectionCount(mainResponse, 'manual_reviews') + sectionCount(mainResponse, 'manual_review');
  if (reviewCount > 1) {
    protocolError('invalid_main_result', 'Quotation main result may contain only one manual_reviews section.');
  }
  const review = sectionRows(mainResponse, 'manual_reviews') ?? sectionRows(mainResponse, 'manual_review');
  if (reviewCount === 1 && !review) {
    protocolError('invalid_main_result', 'manual_reviews must use the current six columns and contain rows.');
  }
  if (review && (review.table.headers.length !== quotationManualReviewColumns.length ||
    review.table.headers.some((header, index) => header !== quotationManualReviewColumns[index]))) {
    protocolError('invalid_main_result', 'manual_reviews must use the current six columns.');
  }

  const sanitized = stripQuoteControls(mainResponse);
  const sanitizedMain = sectionRows(sanitized, 'system_order');
  if (!sanitizedMain) protocolError('invalid_main_result', 'Quotation main system_order disappeared during finalization.');
  const rows = main.table.rows;
  const systemOrderMarkdown = `## system_order\n\n${renderTable({ headers: quotationSystemOrderColumns, rows })}`;
  const customerQuote = buildCustomerQuoteFromMarkdown(systemOrderMarkdown);
  if (!customerQuote) protocolError('invalid_main_result', 'Quotation system_order cannot produce a customer quote.');

  const document = parseAssistantMarkdown(sanitized);
  const outputParts: string[] = [];
  if (document.preamble.trim()) outputParts.push(document.preamble.trim());
  let inserted = false;
  let manualReviewSection: string | undefined;
  document.sections.forEach((section) => {
    const title = baseSectionTitle(section.title);
    if (title === 'system_order') {
      if (!inserted) {
        outputParts.push(systemOrderMarkdown, customerQuote.markdown);
        inserted = true;
      }
      return;
    }
    if (title === 'manual_reviews' || title === 'manual_review') {
      manualReviewSection = section.raw.trim().replace(/^##[^\r\n]*/u, '## manual_reviews');
      return;
    }
    outputParts.push(section.raw.trim());
  });
  if (!inserted) outputParts.unshift(systemOrderMarkdown, customerQuote.markdown);
  if (manualReviewSection) outputParts.push(manualReviewSection);
  const manualReviewCount = review?.table.rows.length ?? 0;
  const summary = manualReviewCount > 0
    ? `查價輸出完成：共 ${rows.length} 筆 system_order、${manualReviewCount} 項待複核事項。`
    : `查價輸出完成：共 ${rows.length} 筆 system_order，無待複核事項。`;
  outputParts.push(`## quote_summary\n\n${summary}`);
  return {
    response: outputParts.filter(Boolean).join(document.newline + document.newline),
    systemOrderMarkdown,
    customerQuoteMarkdown: customerQuote.markdown,
    summary,
    rows,
  };
}

export const finalizeQuotationResponse: typeof finalizeQuotationMainResponse = finalizeQuotationMainResponse;
