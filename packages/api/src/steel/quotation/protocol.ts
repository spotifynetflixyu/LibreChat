import { parseMarkdownTables } from '../markdown/table';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { buildCustomerQuoteFromMarkdown } from '../markdown/quote';
import { parseAssistantMarkdown, parseOcrResultTable } from '../ocr/result';

import type { SteelToolJsonObject, SteelToolJsonValue, SteelToolSuccessResult } from '../tools/results';

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

export const quotationSignalColumns = ['index', 'token'] as const;

export type QuotationSystemOrderColumn = (typeof quotationSystemOrderColumns)[number];
export type QuotationManualReviewColumn = (typeof quotationManualReviewColumns)[number];

export interface QuotationSignal {
  readonly index: number;
  readonly token: string;
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

export interface QuotationCandidateIdentity {
  readonly id?: number;
  readonly erpItemCode?: string;
  readonly productName?: string;
  readonly category?: string;
  readonly material?: string;
  readonly formulaCode?: string;
}

export type QuotationLineageKind = 'material' | 'processing';

export interface QuotationLineageEntry {
  readonly sourceRowId: string;
  readonly kind: QuotationLineageKind;
  readonly lookupCallId: string;
  readonly queryId?: string;
  readonly candidate: QuotationCandidateIdentity | null;
}

export interface QuotationLineageSidecar {
  readonly version: 1;
  readonly quote_lineage: Readonly<Record<string, QuotationLineageEntry>>;
}

export interface QuotationPythonEvidence {
  readonly type: 'tool-call' | 'tool-result';
  readonly toolCallId: string;
  readonly payload: string;
}

export interface QuotationLookupEvidence {
  readonly lookupCallId: string;
  readonly persisted: true;
  readonly result: SteelToolSuccessResult;
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
  readonly lineage: readonly QuotationLineageEntry[];
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
  ) {
    super(message);
    this.name = 'QuotationProtocolError';
  }
}

function protocolError(code: QuotationProtocolErrorCode, message: string): never {
  throw new QuotationProtocolError(code, message);
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
      if (closing?.[0] === fence && closing.length >= fenceLength) {
        fence = undefined;
      }
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
  options: { readonly allowEmpty?: boolean } = {},
): QuotationChunkTable | undefined {
  const tables = parseMarkdownTables(sectionBodyWithoutFences(body));
  if (tables.length !== 1) {
    return undefined;
  }
  const table = tables[0];
  if (
    table.headers.length !== headers.length ||
    headers.some((header, index) => table.headers[index] !== header) ||
    (!options.allowEmpty && table.rows.length === 0) ||
    table.rows.some((row) => row.length !== headers.length)
  ) {
    return undefined;
  }
  return {
    headers: [...table.headers],
    rows: table.rows.map((row) => [...row]),
  };
}

function isOnlyTableContent(body: string): boolean {
  return sectionBodyWithoutFences(body)
    .split(/\r?\n/u)
    .every((line) => line.trim() === '' || (line.trim().startsWith('|') && line.trim().endsWith('|')));
}

function parsePositiveInteger(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^[1-9]\d*$/u.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseQuotationSignal(response: string): QuotationSignal | undefined {
  const document = parseAssistantMarkdown(response);
  const section = exactSection(document, 'quote_signal');
  if (!section || section.title !== 'quote_signal' || !isOnlyTableContent(section.body)) {
    return undefined;
  }
  const table = parseExactTable(section.body, quotationSignalColumns);
  if (!table || table.rows.length !== 1) {
    return undefined;
  }
  const index = parsePositiveInteger(table.rows[0]?.[0] ?? '');
  const token = table.rows[0]?.[1]?.trim() ?? '';
  return index !== undefined && token !== '' ? { index, token } : undefined;
}

export function extractCustomerDataTable(response: string): QuotationChunkTable | undefined {
  const document = parseAssistantMarkdown(response);
  const section = exactSection(document, 'customer_data');
  if (!section) {
    return undefined;
  }
  const tables = parseMarkdownTables(sectionBodyWithoutFences(section.body));
  if (
    tables.length !== 1 ||
    tables[0]?.rows.length === 0 ||
    tables[0]?.rows.some((row) => row.length !== tables[0]?.headers.length)
  ) {
    return undefined;
  }
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
  if (!section) {
    protocolError('invalid_ocr_result', 'Quotation requires exactly one ocr_result section.');
  }
  const visibleTables = parseMarkdownTables(sectionBodyWithoutFences(section.body));
  if (visibleTables.length !== 1) {
    protocolError('invalid_ocr_result', 'Quotation requires exactly one ocr_result table.');
  }
  const parsed = parseOcrResultTable(section.body);
  if (!parsed.ok || parsed.table.rows.length === 0 ||
    !parsed.table.headers.includes('來源') || !parsed.table.headers.includes('零件編號')) {
    protocolError('invalid_ocr_result', 'Quotation requires a complete non-empty ocr_result table.');
  }
  return {
    headers: [...parsed.table.headers],
    rows: parsed.table.rows.map((row) => [...row]),
  };
}

export function buildQuotationChunks(fullOcrResult: string): readonly QuotationChunk[] {
  const table = readOcrResultTable(fullOcrResult);
  const categoryIndex = table.headers.indexOf('類別');
  if (categoryIndex < 0) {
    protocolError('invalid_ocr_result', 'ocr_result must contain a 類別 column for quotation chunking.');
  }

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

interface FencedBlock {
  readonly language: string;
  readonly content: string;
}

function readFencedBlocks(markdown: string): { visible: string; blocks: readonly FencedBlock[] } {
  const lines = markdown.split(/\r?\n/u);
  const visible: string[] = [];
  const blocks: FencedBlock[] = [];
  let opening: { character: '`' | '~'; length: number; language: string; content: string[] } | undefined;
  for (const line of lines) {
    if (!opening) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/u);
      if (match) {
        opening = {
          character: match[1]![0] as '`' | '~',
          length: match[1]!.length,
          language: match[2]!.trim(),
          content: [],
        };
      } else {
        visible.push(line);
      }
      continue;
    }
    const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1];
    if (closing?.[0] === opening.character && closing.length >= opening.length) {
      blocks.push({ language: opening.language, content: opening.content.join('\n') });
      opening = undefined;
    } else {
      opening.content.push(line);
    }
  }
  if (opening) {
    visible.push(...opening.content);
  }
  return { visible: visible.join('\n'), blocks };
}

function isQuoteControlFence(language: string, content: string): boolean {
  if (/^(?:json|application\/json)$/iu.test(language.trim())) {
    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      value = undefined;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (
        ['quote_lineage', 'quote_signal', 'quote_summary', 'summary', 'customer_quote'].some(
          (key) => Object.prototype.hasOwnProperty.call(value, key),
        )
      ) {
        return true;
      }
    }
  }
  return (
    /["'](?:quote_lineage|quote_signal|quote_summary|summary|customer_quote)["']\s*:/iu.test(content) ||
    /(?:^|\r?\n)\s*##\s+(?:customer_quote|quote_signal|quote_lineage|quote_summary|summary)(?:｜|[ \t]|$)/iu.test(content)
  );
}

function stripControlFencedBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/u);
  const output: string[] = [];
  let opening:
    | {
        readonly marker: '`' | '~';
        readonly length: number;
        readonly language: string;
        readonly lines: string[];
      }
    | undefined;
  for (const line of lines) {
    if (!opening) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/u);
      if (!match) {
        output.push(line);
        continue;
      }
      opening = {
        marker: match[1]![0] as '`' | '~',
        length: match[1]!.length,
        language: match[2]!.trim(),
        lines: [line],
      };
      continue;
    }
    const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1];
    opening.lines.push(line);
    if (closing?.[0] === opening.marker && closing.length >= opening.length) {
      const content = opening.lines.slice(1, -1).join('\n');
      if (!isQuoteControlFence(opening.language, content)) {
        output.push(...opening.lines);
      }
      opening = undefined;
    }
  }
  if (opening) {
    output.push(...opening.lines);
  }
  return output.join('\n');
}

function parseLineageSidecar(blocks: readonly FencedBlock[]): QuotationLineageSidecar | undefined {
  const sidecars = blocks.filter((block) => /^(?:json|application\/json)$/iu.test(block.language.trim()));
  if (sidecars.length !== 1) {
    return undefined;
  }
  let value: SteelToolJsonValue;
  try {
    value = JSON.parse(sidecars[0]!.content) as SteelToolJsonValue;
  } catch {
    return undefined;
  }
  if (!isJsonObject(value) || value.version !== 1 || !isJsonObject(value.quote_lineage)) {
    return undefined;
  }
  const lineage: Record<string, QuotationLineageEntry> = {};
  for (const [ordinal, raw] of Object.entries(value.quote_lineage)) {
    if (!/^\d+$/u.test(ordinal) || !isJsonObject(raw)) {
      return undefined;
    }
    const sourceRowId = readString(raw.sourceRowId);
    const kind = readString(raw.kind);
    const lookupCallId = readString(raw.lookupCallId);
    const queryId = readString(raw.queryId);
    const candidateValue = Object.prototype.hasOwnProperty.call(raw, 'candidate')
      ? raw.candidate
      : raw.candidateIdentity;
    if (!sourceRowId || (kind !== 'material' && kind !== 'processing') || !lookupCallId) {
      return undefined;
    }
    if (candidateValue === undefined || (candidateValue !== null && !isJsonObject(candidateValue))) {
      return undefined;
    }
    if (candidateValue === null) {
      lineage[ordinal] = {
        sourceRowId,
        kind,
        lookupCallId,
        ...(queryId ? { queryId } : {}),
        candidate: null,
      };
      continue;
    }
    const candidate = candidateIdentity(candidateValue);
    if (!candidate) {
      return undefined;
    }
    lineage[ordinal] = {
      sourceRowId,
      kind,
      lookupCallId,
      ...(queryId ? { queryId } : {}),
      candidate,
    };
  }
  return { version: 1, quote_lineage: lineage };
}

function isJsonObject(value: SteelToolJsonValue | undefined): value is SteelToolJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: SteelToolJsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readNumber(value: SteelToolJsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function candidateIdentity(value: SteelToolJsonObject): QuotationCandidateIdentity | undefined {
  const result: {
    id?: number;
    erpItemCode?: string;
    productName?: string;
    category?: string;
    material?: string;
    formulaCode?: string;
  } = {};
  const id = readNumber(value.id);
  const fields = ['erpItemCode', 'productName', 'category', 'material', 'formulaCode'] as const;
  if (id !== undefined) result.id = id;
  fields.forEach((field) => {
    const text = readString(value[field]);
    if (text) result[field] = text;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function identityMatches(expected: QuotationCandidateIdentity, actual: SteelToolJsonObject): boolean {
  const actualIdentity = candidateIdentity(actual);
  if (!actualIdentity) return false;
  return Object.entries(expected).every(([field, value]) => actualIdentity[field as keyof QuotationCandidateIdentity] === value);
}

function collectEvidenceCandidates(value: SteelToolJsonValue, output: SteelToolJsonObject[] = []): SteelToolJsonObject[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectEvidenceCandidates(entry, output));
    return output;
  }
  if (!isJsonObject(value)) return output;
  if (candidateIdentity(value)) output.push(value);
  Object.values(value).forEach((entry) => {
    if (entry !== undefined) collectEvidenceCandidates(entry, output);
  });
  return output;
}

function rowValue(headers: readonly string[], row: readonly string[], header: string): string {
  const index = headers.indexOf(header);
  return index < 0 ? '' : (row[index] ?? '').trim();
}

function hasCandidateInEvidence(
  identity: QuotationCandidateIdentity,
  evidence: QuotationLookupEvidence,
  queryId?: string,
  kind?: QuotationLineageKind,
  source?: QuotationSourceRow,
  sourceHeaders?: readonly string[],
): boolean {
  return collectEvidenceCandidatesForQuery(evidence.result.data, queryId).some((candidate) =>
    identityMatches(identity, candidate) &&
    (kind === undefined || (source !== undefined && sourceHeaders !== undefined &&
      candidateCoversSourceThickness(candidate, kind, source, sourceHeaders))),
  );
}

function collectEvidenceCandidatesForQuery(
  data: SteelToolJsonObject,
  queryId: string | undefined,
): SteelToolJsonObject[] {
  if (!queryId) {
    return collectEvidenceCandidates(data);
  }
  const queryResults: SteelToolJsonValue[] = [
    ...(Array.isArray(data.queryResults) ? data.queryResults : []),
    ...(isJsonObject(data.processingPrice) && Array.isArray(data.processingPrice.queryResults)
      ? data.processingPrice.queryResults
      : []),
  ];
  const query = queryResults.find((entry) => isJsonObject(entry) && entry.queryId === queryId);
  return query ? collectEvidenceCandidates(query) : [];
}

function lookupHasMultipleQueries(evidence: QuotationLookupEvidence): boolean {
  const data = evidence.result.data;
  const queryResults = [
    ...(Array.isArray(data.queryResults) ? data.queryResults : []),
    ...(isJsonObject(data.processingPrice) && Array.isArray(data.processingPrice.queryResults)
      ? data.processingPrice.queryResults
      : []),
  ];
  return queryResults.length > 1;
}

function hasAnyEvidenceCandidate(
  evidence: QuotationLookupEvidence,
  queryId?: string,
  kind?: QuotationLineageKind,
  source?: QuotationSourceRow,
  sourceHeaders?: readonly string[],
): boolean {
  return collectEvidenceCandidatesForQuery(evidence.result.data, queryId).some((candidate) =>
    kind === undefined || (source !== undefined && sourceHeaders !== undefined &&
      candidateCoversSourceThickness(candidate, kind, source, sourceHeaders)),
  );
}

function evidenceByCallId(evidence: readonly QuotationLookupEvidence[]): Map<string, QuotationLookupEvidence> {
  const map = new Map<string, QuotationLookupEvidence>();
  evidence.forEach((entry) => {
    if (
      entry.persisted === true &&
      entry.lookupCallId.trim() !== '' &&
      entry.result.ok === true &&
      entry.result.toolName === 'search_price_candidates'
    ) {
      map.set(entry.lookupCallId.trim(), entry);
    }
  });
  return map;
}

function validateSourceOwnedValues(
  source: QuotationSourceRow,
  sourceHeaders: readonly string[],
  output: readonly string[],
  outputHeaders: readonly string[],
): boolean {
  return ['數量', '厚度', '寬度', '長度', '肚'].every((header) => {
    const sourceIndex = sourceHeaderIndex(sourceHeaders, header);
    if (sourceIndex < 0 || (source.cells[sourceIndex] ?? '').trim() === '') return true;
    return boundValueEqual(rowValue(outputHeaders, output, header), source.cells[sourceIndex] ?? '');
  });
}

function sourceHeaderIndex(headers: readonly string[], canonical: string): number {
  const exact = headers.indexOf(canonical);
  if (exact >= 0) return exact;
  return headers.findIndex((header) =>
    header.normalize('NFKC').replace(/[ \t]*(?:\([^)]*\)|（[^）]*）)[ \t]*$/u, '').trim() === canonical,
  );
}

function boundValueEqual(left: string, right: string): boolean {
  const normalizedLeft = left.normalize('NFKC').trim();
  const normalizedRight = right.normalize('NFKC').trim();
  if (normalizedLeft === normalizedRight) return true;
  const leftNumber = normalizedLeft.match(/^\d+(?:\.\d+)?$/u)?.[0];
  const rightNumber = normalizedRight.match(/^\d+(?:\.\d+)?$/u)?.[0];
  return leftNumber !== undefined && rightNumber !== undefined && Number(leftNumber) === Number(rightNumber);
}

function finiteNumber(value: SteelToolJsonValue | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value.trim())) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sourceThicknessMm(source: QuotationSourceRow, sourceHeaders: readonly string[]): number | undefined {
  const index = sourceHeaderIndex(sourceHeaders, '厚度');
  if (index < 0) return undefined;
  const value = (source.cells[index] ?? '').trim();
  if (value === '') return undefined;
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function sourceThicknessUnknown(source: QuotationSourceRow, sourceHeaders: readonly string[]): boolean {
  return sourceThicknessMm(source, sourceHeaders) === undefined;
}

function candidateCategory(candidate: SteelToolJsonObject): string | undefined {
  return readString(candidate.category);
}

function candidateKindMatches(candidate: SteelToolJsonObject, kind: QuotationLineageKind): boolean {
  const category = candidateCategory(candidate);
  if (kind === 'processing') return category !== undefined && category.startsWith('加工/');
  return category === undefined || !category.startsWith('加工/');
}

function candidateCoversSourceThickness(
  candidate: SteelToolJsonObject,
  kind: QuotationLineageKind,
  source: QuotationSourceRow,
  sourceHeaders: readonly string[],
): boolean {
  if (!candidateKindMatches(candidate, kind)) return false;
  const thickness = sourceThicknessMm(source, sourceHeaders);
  if (thickness === undefined) return true;
  const category = candidateCategory(candidate);
  if (kind === 'processing' && category !== '加工/切工') return true;
  const minimum = finiteNumber(candidate.thicknessMinMm);
  const maximum = finiteNumber(candidate.thicknessMaxMm);
  if (minimum === undefined || maximum === undefined || minimum < 0 || maximum < minimum) return false;
  return minimum <= thickness && thickness <= maximum;
}

function validateSelectedTier(
  row: readonly string[],
  evidenceCandidate: SteelToolJsonObject,
): boolean {
  const basis = rowValue(quotationSystemOrderColumns, row, '計價基準');
  const price = rowValue(quotationSystemOrderColumns, row, '單價');
  if (basis === '' && price === '') return false;
  const basisNumber = parsePositiveInteger(basis);
  if (basisNumber === undefined || basisNumber > 6) return false;
  const tier = ['A', 'B', 'C', 'D', 'E', 'F'][basisNumber - 1]!;
  const tierPrices = evidenceCandidate.tierPrices;
  if (!isJsonObject(tierPrices)) return false;
  const selected = tierPrices[tier];
  if (selected === null || selected === undefined) return price === '';
  if (typeof selected !== 'number' && typeof selected !== 'string') return false;
  return price === String(selected);
}

function validateCandidateOwnedValues(
  row: readonly string[],
  candidate: SteelToolJsonObject,
): boolean {
  const expected: Array<[string, string]> = [
    ['型號', 'erpItemCode'],
    ['材質編號', 'material'],
    ['類別', 'category'],
    ['公式編號', 'formulaCode'],
    ['單位', 'unit'],
  ];
  for (const [rowHeader, candidateField] of expected) {
    const actual = candidate[candidateField];
    if (typeof actual === 'string' && rowValue(quotationSystemOrderColumns, row, rowHeader) !== actual.trim()) return false;
  }
  const productName = candidate.productName;
  return typeof productName !== 'string' || rowValue(quotationSystemOrderColumns, row, '品名規格').startsWith(productName.trim());
}

function selectedTierPriceIsMissing(row: readonly string[], candidate: SteelToolJsonObject): boolean {
  const basisNumber = parsePositiveInteger(rowValue(quotationSystemOrderColumns, row, '計價基準'));
  if (basisNumber === undefined || basisNumber > 6) return false;
  const tierPrices = candidate.tierPrices;
  if (!isJsonObject(tierPrices)) return false;
  const selected = tierPrices[['A', 'B', 'C', 'D', 'E', 'F'][basisNumber - 1]!];
  return (selected === null || selected === undefined) && rowValue(quotationSystemOrderColumns, row, '單價') === '';
}

interface ParsedQuotationPythonCalculations {
  readonly values: ReadonlyMap<string, SteelToolJsonObject>;
  readonly invalid: boolean;
}

function collectPythonOutputTexts(value: SteelToolJsonValue, output: string[] = []): string[] {
  if (typeof value === 'string') {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPythonOutputTexts(entry, output));
    return output;
  }
  if (!isJsonObject(value)) return output;
  if (isJsonObject(value.quote_calculations)) output.push(JSON.stringify(value));
  ['result', 'output', 'stdout', 'logs', 'text', 'value'].forEach((key) => {
    const child = value[key];
    if (child !== undefined) collectPythonOutputTexts(child, output);
  });
  return output;
}

function parseJsonObjects(text: string): SteelToolJsonObject[] {
  const objects: SteelToolJsonObject[] = [];
  const seen = new Set<string>();
  const add = (value: SteelToolJsonValue): void => {
    if (typeof value === 'string') {
      const nested = value.trim();
      if (nested !== '' && nested !== text.trim()) parseText(nested);
      return;
    }
    if (!isJsonObject(value)) return;
    const serialized = JSON.stringify(value);
    if (!seen.has(serialized)) {
      seen.add(serialized);
      objects.push(value);
    }
  };
  const parseValue = (candidate: string): void => {
    try {
      add(JSON.parse(candidate) as SteelToolJsonValue);
    } catch {
      // Provider result wrappers may contain logs around the JSON stdout.
    }
  };
  const parseText = (candidate: string): void => {
    const trimmed = candidate.trim();
    if (trimmed === '') return;
    parseValue(trimmed);
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) parseValue(trimmed.slice(first, last + 1));
  };
  parseText(text);
  readFencedBlocks(text).blocks.forEach((block) => parseText(block.content));
  return objects;
}

function parseQuotationPythonCalculations(
  evidence: readonly QuotationPythonEvidence[],
): ParsedQuotationPythonCalculations {
  const values = new Map<string, SteelToolJsonObject>();
  let invalid = false;
  evidence.forEach((entry) => {
    if (entry.type !== 'tool-result' || entry.toolCallId.trim() === '') return;
    const payload = entry.payload.trim();
    if (payload === '') return;
    const texts = [payload];
    try {
      const parsed = JSON.parse(payload) as SteelToolJsonValue;
      collectPythonOutputTexts(parsed, texts);
    } catch {
      // A raw stdout payload is valid evidence as long as it contains the JSON contract.
    }
    texts.forEach((text) => {
      parseJsonObjects(text).forEach((object) => {
        const calculations = object.quote_calculations;
        if (!isJsonObject(calculations)) return;
        Object.entries(calculations).forEach(([ordinal, raw]) => {
          if (!/^[1-9]\d*$/u.test(ordinal) || !isJsonObject(raw)) {
            invalid = true;
            return;
          }
          const existing = values.get(ordinal);
          if (existing && JSON.stringify(existing) !== JSON.stringify(raw)) {
            invalid = true;
            return;
          }
          values.set(ordinal, raw);
        });
      });
    });
  });
  return { values, invalid };
}

function calculationValueEqual(left: string, right: string): boolean {
  const normalizedLeft = left.normalize('NFKC').trim();
  const normalizedRight = right.normalize('NFKC').trim();
  if (normalizedLeft === normalizedRight) return true;
  const numberPattern = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/u;
  return (
    numberPattern.test(normalizedLeft) &&
    numberPattern.test(normalizedRight) &&
    Number(normalizedLeft) === Number(normalizedRight)
  );
}

function validatePythonCalculations(
  rows: readonly (readonly string[])[],
  pythonEvidence: readonly QuotationPythonEvidence[] | undefined,
): void {
  const required = rows.flatMap((row, index) =>
    (['單重', '總數'] as const)
      .map((column) => [index + 1, column, rowValue(quotationSystemOrderColumns, row, column)] as const)
      .filter(([, , value]) => value !== ''),
  );
  if (required.length === 0) return;
  if (!pythonEvidence?.some((entry) => entry.type === 'tool-result' && entry.toolCallId.trim() !== '')) {
    protocolError('invalid_child_result', 'Child calculated values require persisted Python tool-result evidence.');
  }
  const parsed = parseQuotationPythonCalculations(pythonEvidence ?? []);
  if (parsed.invalid || parsed.values.size === 0) {
    protocolError('invalid_child_result', 'Child calculated values have invalid Python evidence.');
  }
  for (const [ordinal, column, expected] of required) {
    const calculation = parsed.values.get(String(ordinal));
    const actual = calculation?.[column];
    if ((typeof actual !== 'string' && typeof actual !== 'number') || !calculationValueEqual(String(actual), expected)) {
      protocolError('invalid_child_result', `Python calculation evidence does not match row ${ordinal} ${column}.`);
    }
  }
  for (const ordinal of parsed.values.keys()) {
    if (Number(ordinal) > rows.length) {
      protocolError('invalid_child_result', `Python calculation evidence references unknown row ${ordinal}.`);
    }
  }
}

function validateChildTable(input: QuotationChildResultInput): ValidatedQuotationChildResult {
  const response = input.response ?? input.markdown;
  if (!response) protocolError('invalid_child_result', 'Quotation child result is empty.');
  const fenced = readFencedBlocks(response);
  const document = parseAssistantMarkdown(fenced.visible);
  const section = exactSection(document, 'system_order_chunk');
  const forbiddenSections = new Set([
    'system_order',
    'customer_quote',
    'quote_signal',
    'quote_lineage',
    'quote_summary',
    'summary',
  ]);
  if (
    !section ||
    section.title !== 'system_order_chunk' ||
    document.sections.some((candidate) => forbiddenSections.has(baseSectionTitle(candidate.title)))
  ) {
    protocolError('invalid_child_result', 'Child result must contain exactly one system_order_chunk section.');
  }
  const table = parseExactTable(section.body, quotationSystemOrderColumns);
  const sidecar = parseLineageSidecar(readFencedBlocks(response).blocks);
  if (!table || !sidecar || Object.keys(sidecar.quote_lineage).length !== table.rows.length) {
    protocolError('invalid_child_result', 'Child result has an invalid system_order_chunk or lineage sidecar.');
  }
  const evidence = evidenceByCallId(input.lookupEvidence);
  if (evidence.size !== input.lookupEvidence.length) {
    protocolError('invalid_child_result', 'Child result references failed or non-persisted lookup evidence.');
  }
  const sourceById = new Map(input.chunk.sourceRows.map((source) => [source.sourceRowId, source]));
  const sourceHeaders = input.chunk.table.headers;
  const materialSourceIds = new Set<string>();
  const lineage: QuotationLineageEntry[] = [];
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const ordinal = String(rowIndex + 1);
    const entry = sidecar.quote_lineage[ordinal];
    if (!entry) protocolError('invalid_child_result', `Missing lineage for output row ${ordinal}.`);
    const source = sourceById.get(entry.sourceRowId);
    const lookup = evidence.get(entry.lookupCallId);
    if (!source) protocolError('invalid_child_result', `Lineage row ${ordinal} has an untrusted source.`);
    if (!lookup) protocolError('invalid_child_result', `Lineage row ${ordinal} references missing lookup evidence.`);
    if (!entry.queryId && lookupHasMultipleQueries(lookup)) {
      protocolError('invalid_child_result', `Lineage row ${ordinal} requires queryId for scoped lookup evidence.`);
    }
    if (entry.kind === 'material') {
      if (materialSourceIds.has(entry.sourceRowId)) protocolError('invalid_child_result', `Duplicate material coverage for ${entry.sourceRowId}.`);
      materialSourceIds.add(entry.sourceRowId);
      if (!validateSourceOwnedValues(source, sourceHeaders, table.rows[rowIndex]!, quotationSystemOrderColumns)) {
        protocolError('invalid_child_result', `Source quantity or dimensions changed for ${entry.sourceRowId}.`);
      }
    }
    if (entry.candidate) {
      if (!entry.candidate.erpItemCode) {
        protocolError('invalid_child_result', `Lineage row ${ordinal} has no erpItemCode candidate identity.`);
      }
      if (!hasCandidateInEvidence(entry.candidate, lookup, entry.queryId, entry.kind, source, sourceHeaders)) protocolError('invalid_child_result', `Lineage row ${ordinal} has no matching applicable lookup candidate.`);
      const candidate = collectEvidenceCandidatesForQuery(lookup.result.data, entry.queryId).find((item) =>
        identityMatches(entry.candidate!, item) && candidateCoversSourceThickness(item, entry.kind, source, sourceHeaders));
      if (!candidate || !validateCandidateOwnedValues(table.rows[rowIndex]!, candidate) || !validateSelectedTier(table.rows[rowIndex]!, candidate)) {
        protocolError('invalid_child_result', `Lineage row ${ordinal} changed candidate-owned values or tier price.`);
      }
      if (selectedTierPriceIsMissing(table.rows[rowIndex]!, candidate) && rowValue(quotationSystemOrderColumns, table.rows[rowIndex]!, '備註') === '') {
        protocolError('invalid_child_result', `Lineage row ${ordinal} lacks a review note for the missing selected tier price.`);
      }
    } else {
      if (hasAnyEvidenceCandidate(lookup, entry.queryId, entry.kind, source, sourceHeaders)) protocolError('invalid_child_result', `Lineage row ${ordinal} omitted an available candidate.`);
      if (rowValue(quotationSystemOrderColumns, table.rows[rowIndex]!, '單價') !== '' || rowValue(quotationSystemOrderColumns, table.rows[rowIndex]!, '備註') === '') {
        protocolError('invalid_child_result', `Lineage row ${ordinal} lacks a concrete no-candidate review issue.`);
      }
    }
    if (input.customerTier) {
      const expectedBasis = String(input.customerTier.charCodeAt(0) - 64);
      if (rowValue(quotationSystemOrderColumns, table.rows[rowIndex]!, '計價基準') !== expectedBasis) {
        protocolError('invalid_child_result', `Lineage row ${ordinal} uses a different customer tier.`);
      }
    }
    lineage.push(entry);
  }
  validatePythonCalculations(table.rows, input.pythonEvidence);
  if (materialSourceIds.size !== input.chunk.sourceRows.length || input.chunk.sourceRows.some((source) => !materialSourceIds.has(source.sourceRowId))) {
    protocolError('invalid_child_result', 'Child result does not cover every source material exactly once.');
  }
  return { chunk: input.chunk, markdown: response, table, rows: table.rows, lineage };
}

export function validateQuotationChildResult(input: QuotationChildResultInput): ValidatedQuotationChildResult {
  return validateChildTable(input);
}

export const validateQuotationChunkResult: typeof validateQuotationChildResult = validateQuotationChildResult;

function canonicalAcceptedRows(
  chunks: readonly QuotationChunk[],
  results: readonly ValidatedQuotationChildResult[],
): readonly (readonly string[])[] {
  const expectedChunks = new Map(chunks.map((chunk) => [chunk.chunkIndex, chunk]));
  const seenChunks = new Set<number>();
  const sourceOrder = new Map(chunks.flatMap((chunk) => chunk.sourceRows).map((row) => [row.sourceRowId, row.sourceRowIndex]));
  const materialRows = new Map<string, readonly string[]>();
  const processingRows: Array<{ sourceIndex: number; outputIndex: number; row: readonly string[] }> = [];
  results.forEach((result) => {
    const expected = expectedChunks.get(result.chunk.chunkIndex);
    if (!expected || seenChunks.has(result.chunk.chunkIndex)) protocolError('incomplete_aggregate', 'Quotation child chunks are missing or duplicated.');
    if (
      expected.chunkCount !== result.chunk.chunkCount ||
      expected.categoryIndex !== result.chunk.categoryIndex ||
      expected.categoryChunkIndex !== result.chunk.categoryChunkIndex ||
      expected.categoryChunkCount !== result.chunk.categoryChunkCount ||
      expected.category !== result.chunk.category ||
      expected.table.headers.length !== result.chunk.table.headers.length ||
      expected.table.headers.some((header, index) => header !== result.chunk.table.headers[index]) ||
      !rowsEqual(expected.table.rows, result.chunk.table.rows) ||
      expected.sourceRows.length !== result.chunk.sourceRows.length ||
      expected.sourceRows.some((source, index) => {
        const actual = result.chunk.sourceRows[index];
        return (
          !actual ||
          source.sourceRowId !== actual.sourceRowId ||
          source.sourceRowIndex !== actual.sourceRowIndex ||
          source.category !== actual.category ||
          JSON.stringify(source.cells) !== JSON.stringify(actual.cells)
        );
      })
    ) {
      protocolError('incomplete_aggregate', `Quotation child chunk ${result.chunk.chunkIndex} is not the trusted source chunk.`);
    }
    seenChunks.add(result.chunk.chunkIndex);
    result.rows.forEach((row, index) => {
      const entry = result.lineage[index]!;
      const sourceIndex = sourceOrder.get(entry.sourceRowId);
      if (sourceIndex === undefined) protocolError('incomplete_aggregate', 'Quotation lineage points outside the full source order.');
      if (entry.kind === 'material') {
        if (materialRows.has(entry.sourceRowId)) protocolError('incomplete_aggregate', `Duplicate material row ${entry.sourceRowId}.`);
        materialRows.set(entry.sourceRowId, row);
      } else {
        processingRows.push({ sourceIndex, outputIndex: index, row });
      }
    });
  });
  if (seenChunks.size !== chunks.length || materialRows.size !== sourceOrder.size) protocolError('incomplete_aggregate', 'Quotation aggregate does not cover the complete source order.');
  const rows: Array<{ sourceIndex: number; order: number; row: readonly string[] }> = [];
  chunks.flatMap((chunk) => chunk.sourceRows).forEach((source) => {
    const row = materialRows.get(source.sourceRowId);
    if (!row) protocolError('incomplete_aggregate', `Missing material row ${source.sourceRowId}.`);
    rows.push({ sourceIndex: source.sourceRowIndex, order: 0, row });
  });
  processingRows.forEach((entry) => rows.push({ sourceIndex: entry.sourceIndex, order: entry.outputIndex + 1, row: entry.row }));
  return rows.sort((left, right) => left.sourceIndex - right.sourceIndex || left.order - right.order).map((entry) => entry.row);
}

function rowsEqual(left: readonly (readonly string[])[], right: readonly (readonly string[])[]): boolean {
  return left.length === right.length && left.every((row, index) => JSON.stringify(row) === JSON.stringify(right[index]));
}

function sectionRows(text: string, title: string): { heading: string; table: QuotationChunkTable } | undefined {
  const document = parseAssistantMarkdown(text);
  const section = exactSection(document, title);
  if (!section) return undefined;
  const tables = parseMarkdownTables(sectionBodyWithoutFences(section.body));
  if (tables.length !== 1 || tables[0]!.rows.some((row) => row.length !== tables[0]!.headers.length)) return undefined;
  return { heading: section.heading.trim(), table: { headers: [...tables[0]!.headers], rows: tables[0]!.rows.map((row) => [...row]) } };
}

function sectionCount(text: string, title: string): number {
  return parseAssistantMarkdown(text).sections.filter(
    (section) => baseSectionTitle(section.title) === title,
  ).length;
}

function reviewCoversSource(
  reviewRows: readonly (readonly string[])[],
  source: QuotationSourceRow,
  sourceHeaders: readonly string[],
): boolean {
  if (reviewRows.some((row) => row.some((cell) => cell.trim() === source.sourceRowId))) return true;
  const sourceIndex = sourceHeaders.indexOf('來源');
  const partIndex = sourceHeaders.indexOf('零件編號');
  const sourceValue = sourceIndex >= 0 ? source.cells[sourceIndex]?.trim() : '';
  const partValue = partIndex >= 0 ? source.cells[partIndex]?.trim() : '';
  if (sourceValue === '' || partValue === '') return false;
  return reviewRows.some((row) => row[0]?.trim() === sourceValue && row[1]?.trim() === partValue);
}

function validateReviewCoverage(
  results: readonly ValidatedQuotationChildResult[],
  reviewRows: readonly (readonly string[])[],
): void {
  for (const result of results) {
    result.rows.forEach((row, index) => {
      const price = rowValue(quotationSystemOrderColumns, row, '單價');
      const note = rowValue(quotationSystemOrderColumns, row, '備註');
      const entry = result.lineage[index]!;
      const source = result.chunk.sourceRows.find((candidate) => candidate.sourceRowId === entry.sourceRowId);
      const thicknessDependent = entry.kind === 'material' || entry.candidate?.category === '加工/切工';
      const thicknessNeedsReview = source !== undefined && thicknessDependent &&
        sourceThicknessUnknown(source, result.chunk.table.headers);
      if (price !== '' && !/(?:未確認|低信心|fallback|需確認|人工)/iu.test(note) && !thicknessNeedsReview) return;
      if (!source || !reviewCoversSource(reviewRows, source, result.chunk.table.headers)) {
        protocolError('incomplete_aggregate', `Missing manual_review coverage for ${entry.sourceRowId}.`);
      }
    });
  }
}

function stripQuoteControls(text: string): string {
  const withoutSidecars = stripControlFencedBlocks(text);
  const document = parseAssistantMarkdown(
    withoutSidecars.replace(/(?:^|\r?\n)[ \t]*查價輸出完成：[^\r\n]*(?:\r?\n|$)/gu, '\n'),
  );
  const removedTitles = new Set([
    'system_order_chunk',
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
  const result = chunks.filter(Boolean).join(document.newline + document.newline);
  return result;
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
  const chunks = buildQuotationChunks(input.fullOcrResult);
  const validated = input.childResults.map(validateChildTable);
  const acceptedRows = canonicalAcceptedRows(chunks, validated);
  const main = sectionRows(input.mainResponse, 'system_order');
  if (!main || main.table.headers.length !== quotationSystemOrderColumns.length || main.table.headers.some((header, index) => header !== quotationSystemOrderColumns[index])) {
    protocolError('invalid_main_result', 'Quotation main result must contain one exact system_order table.');
  }
  if (!rowsEqual(main.table.rows, acceptedRows)) protocolError('incomplete_aggregate', 'Quotation main system_order differs from accepted child rows.');
  if (sectionCount(input.mainResponse, 'manual_review') > 1) {
    protocolError('invalid_main_result', 'Quotation main result may contain only one manual_review section.');
  }
  const review = sectionRows(input.mainResponse, 'manual_review');
  if (sectionCount(input.mainResponse, 'manual_review') === 1 && !review) {
    protocolError('invalid_main_result', 'manual_review must use the current six columns and contain rows.');
  }
  if (review && (review.table.headers.length !== quotationManualReviewColumns.length || review.table.headers.some((header, index) => header !== quotationManualReviewColumns[index]) || review.table.rows.length === 0)) {
    protocolError('invalid_main_result', 'manual_review must use the current six columns and contain rows.');
  }
  validateReviewCoverage(validated, review?.table.rows ?? []);
  const sanitized = stripQuoteControls(input.mainResponse);
  const sanitizedMain = sectionRows(sanitized, 'system_order');
  if (!sanitizedMain) protocolError('invalid_main_result', 'Quotation main system_order disappeared during finalization.');
  const systemOrderMarkdown = `${sanitizedMain.heading}\n\n${renderTable({ headers: quotationSystemOrderColumns, rows: acceptedRows })}`;
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
    if (title === 'manual_review') {
      manualReviewSection = section.raw.trim();
      return;
    }
    outputParts.push(section.raw.trim());
  });
  if (!inserted) outputParts.unshift(systemOrderMarkdown, customerQuote.markdown);
  if (manualReviewSection) outputParts.push(manualReviewSection);
  const manualReviewCount = review?.table.rows.length ?? 0;
  const summary = manualReviewCount > 0
    ? `查價輸出完成：共 ${acceptedRows.length} 筆 system_order、${manualReviewCount} 項待複核事項。`
    : `查價輸出完成：共 ${acceptedRows.length} 筆 system_order，無待複核事項。`;
  outputParts.push(summary);
  return {
    response: outputParts.filter(Boolean).join(document.newline + document.newline),
    systemOrderMarkdown,
    customerQuoteMarkdown: customerQuote.markdown,
    summary,
    rows: acceptedRows,
  };
}

export const finalizeQuotationResponse: typeof finalizeQuotationMainResponse = finalizeQuotationMainResponse;
