import {
  searchSteelCustomers,
  discoverSteelPriceCategories,
  searchSteelPriceItems,
} from '../repositories';
import { normalizeOcrEvidenceForRuntime } from '../runtime/context';
import { getExecutableSteelToolDefinition, isExecutableSteelToolName } from './registry';
import { sanitizeSteelToolOutput, steelToolRedactionVersion } from './sanitize';
import { steelToolArgsSchemas } from './schemas';

import type {
  FullActiveSteelOutputSheets,
  SteelOutputSheetMemorySnapshot,
  SteelRuntimeActiveOutputSheetId,
  SteelRuntimeJsonObject,
  SteelRuntimeOutputSheet,
} from '../runtime/context';
import type {
  SteelToolResult,
  SteelToolLogger,
  SteelToolJsonObject,
  SteelToolErrorCategory,
} from './results';
import type { SteelRepositoryClient, SteelSourceRef } from '../repositories/types';
import type { SteelPriceItem } from '../repositories';
import type { ReadMarkdownInput, SteelToolName } from './schemas';

type SteelRawToolOutput = { [key: string]: unknown };
type SearchCustomersInput = ReturnType<typeof steelToolArgsSchemas.search_customers.parse>;
type SearchPriceCandidatesInput = ReturnType<
  typeof steelToolArgsSchemas.search_price_candidates.parse
>;
type SearchPriceCandidateQuery = SearchPriceCandidatesInput['queries'][number];
type DispatchSteelToolArgs =
  | SearchCustomersInput
  | SearchPriceCandidatesInput
  | ReadMarkdownInput;

const workbookSheetOrder = [
  'system_order',
  'customer_data',
  'customer_quote',
  'manual_review',
] as const satisfies readonly SteelRuntimeActiveOutputSheetId[];

const defaultWorkbookFileKey = 'default';
const ocrContentPartLength = 1000;
const ocrTextKeys = new Set(['markdown', 'text', 'content', 'rawText', 'ocrText', 'pageText', 'result']);

const strictWorkbookHeaders: Partial<Record<SteelRuntimeActiveOutputSheetId, readonly string[]>> = {
  system_order: [
    '公司編號',
    '項次',
    '倉庫編號',
    '型號',
    '品名規格',
    '材質編號',
    '廠別編號',
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
    '類別',
    '交貨日期',
    '備註',
  ],
  customer_quote: ['項目', '說明', '小計'],
  manual_review: ['來源表格', '來源件號 / 項次', '問題欄位', '目前判斷', '需確認內容', '影響範圍'],
};

export interface SteelOutputSheetMemoryReader {
  readOutputSheetMemory(): Promise<SteelOutputSheetMemorySnapshot>;
}

export interface SteelToolRunState {
  maxCalls: number;
  callsUsed: number;
}

export interface ExecuteSteelToolOptions {
  client: SteelRepositoryClient;
  toolName: string;
  arguments: unknown;
  outputSheetMemoryReader?: SteelOutputSheetMemoryReader;
  providerToolCallId?: string;
  runState?: SteelToolRunState;
  log?: SteelToolLogger;
  now?: () => number;
}

export function createSteelToolRunState(maxCalls: number): SteelToolRunState {
  if (!Number.isInteger(maxCalls) || maxCalls < 1) {
    throw new Error('Steel tool maxCalls must be a positive integer');
  }

  return {
    maxCalls,
    callsUsed: 0,
  };
}

function getDurationMs(startTime: number, now: () => number): number {
  return Math.max(0, now() - startTime);
}

function summarizeInput(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'args=non_object';
  }

  return `args=${Object.keys(value).sort().join(',')}`;
}

function isSourceRef(value: unknown): value is SteelSourceRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const entry = value as { [key: string]: unknown };
  return typeof entry.channel === 'string' && typeof entry.factType === 'string';
}

function collectSourceRefs(
  value: unknown,
  refs: SteelSourceRef[] = [],
  seen = new WeakSet<object>(),
): SteelSourceRef[] {
  if (value === null || value === undefined) {
    return refs;
  }

  if (isSourceRef(value)) {
    refs.push(value);
    return refs;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return refs;
    }
    seen.add(value);
    value.forEach((entry) => collectSourceRefs(entry, refs, seen));
    seen.delete(value);
    return refs;
  }

  if (typeof value !== 'object') {
    return refs;
  }

  if (seen.has(value)) {
    return refs;
  }
  seen.add(value);
  Object.values(value as { [key: string]: unknown }).forEach((entry) => {
    collectSourceRefs(entry, refs, seen);
  });
  seen.delete(value);

  return refs;
}

function summarizeOutput(data: SteelToolJsonObject): string {
  const summaryKeys = [
    'packets',
    'instructionPackets',
    'packetGroups',
    'instructionPacketGroups',
    'catalogFamilyCandidates',
    'defaultCandidates',
    'quoteDefaults',
    'formulaCandidates',
    'customers',
    'priceCandidates',
    'workingOrderRows',
    'memoryEntries',
  ];
  const summary = summaryKeys
    .map((key) => {
      const value = data[key];
      return Array.isArray(value) ? `${key}=${value.length}` : undefined;
    })
    .find((entry) => entry !== undefined);

  if (summary) {
    return summary;
  }

  return `keys=${Object.keys(data).length}`;
}

function dedupePriceCandidates(candidates: SteelPriceItem[]): SteelPriceItem[] {
  const seen = new Set<number>();

  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) {
      return false;
    }

    seen.add(candidate.id);
    return true;
  });
}

function isCategoryDiscoveryPriceQuery(
  query: SearchPriceCandidateQuery,
): query is Extract<SearchPriceCandidateQuery, { mode: 'category_discovery' }> {
  return query.mode === 'category_discovery';
}

function isLookupPriceQuery(
  query: SearchPriceCandidateQuery,
): query is Extract<SearchPriceCandidateQuery, { category: string }> {
  return query.mode !== 'category_discovery';
}

async function searchPriceCandidates(
  client: SteelRepositoryClient,
  input: SearchPriceCandidatesInput,
): Promise<SteelRawToolOutput> {
  const discoveryQueries = input.queries.filter(isCategoryDiscoveryPriceQuery);
  const lookupQueries = input.queries.filter(isLookupPriceQuery);
  const categoryCandidateGroupsPromise = Promise.all(
    discoveryQueries.map((query) =>
      discoverSteelPriceCategories(client, {
        keyword: query.keyword,
        limit: query.limit,
      }),
    ),
  );
  const priceCandidatesPromise =
    lookupQueries.length > 0 ? searchSteelPriceItems(client, { queries: lookupQueries }) : [];

  const [categoryCandidateGroups, priceCandidates] = await Promise.all([
    categoryCandidateGroupsPromise,
    priceCandidatesPromise,
  ]);

  return {
    priceCandidates: dedupePriceCandidates(priceCandidates),
    categoryCandidates: categoryCandidateGroups.flat(),
    searchQueries: input.queries,
  };
}

function stringifyMarkdownValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function toMarkdownTableCell(value: unknown): string {
  return stringifyMarkdownValue(value).replace(/\|/gu, '\\|').replace(/\r?\n/gu, '<br>');
}

const workbookHeaderAliases: Record<string, readonly string[]> = {
  項次: ['rowNo', 'itemNo'],
  型號: ['erpItemCode', 'modelCode'],
  品名規格: ['productName'],
  數量: ['quantity'],
  單重: ['unitWeight'],
  總數: ['totalQuantity'],
  單價: ['unitPrice'],
  小計: ['subtotal', '金額'],
};

function getWorkbookCellValue(row: SteelRuntimeJsonObject, header: string): unknown {
  if (row[header] !== undefined) {
    return row[header];
  }

  for (const alias of workbookHeaderAliases[header] ?? []) {
    if (row[alias] !== undefined) {
      return row[alias];
    }
  }

  return '';
}

function toMarkdownTable(headers: readonly string[], rows: readonly SteelRuntimeJsonObject[]) {
  const headerLine = `| ${headers.map(toMarkdownTableCell).join(' |')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' |')} |`;
  const rowLines = rows.map((row) =>
    `| ${headers.map((header) => toMarkdownTableCell(getWorkbookCellValue(row, header))).join(' |')} |`,
  );

  return [headerLine, separatorLine, ...rowLines].join('\n');
}

function getDynamicHeaders(rows: readonly SteelRuntimeJsonObject[]): string[] {
  const seen = new Set<string>();

  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
      }
    });
  });

  return [...seen];
}

function getWorkbookSheetHeaders(sheet: SteelRuntimeOutputSheet): string[] {
  return [
    ...(strictWorkbookHeaders[sheet.sheetId] ??
      getDynamicHeaders(sheet.rows.map((row) => row.cells))),
  ];
}

function matchesRequestedFileKey(
  value: SteelRuntimeJsonObject,
  requestedFileKey: string,
  options?: { includeUnkeyedDefault?: boolean },
): boolean {
  if (
    options?.includeUnkeyedDefault === true &&
    requestedFileKey === defaultWorkbookFileKey &&
    value.ocrFileKey === undefined &&
    value.fileId === undefined
  ) {
    return true;
  }

  const bareFileKey = requestedFileKey.startsWith('file:')
    ? requestedFileKey.slice('file:'.length)
    : requestedFileKey;
  const ocrFileKeys = Array.isArray(value.ocrFileKeys) ? value.ocrFileKeys : [];
  return (
    value.ocrFileKey === requestedFileKey ||
    value.ocrFileKey === `file:${bareFileKey}` ||
    value.fileId === requestedFileKey ||
    value.fileId === bareFileKey ||
    ocrFileKeys.includes(requestedFileKey) ||
    ocrFileKeys.includes(`file:${bareFileKey}`)
  );
}

function filterWorkbookSheetByFileKey(
  sheet: SteelRuntimeOutputSheet,
  requestedFileKey: string,
): SteelRuntimeOutputSheet {
  return {
    ...sheet,
    rows: sheet.rows.filter((row) =>
      matchesRequestedFileKey(row.cells, requestedFileKey, { includeUnkeyedDefault: true }),
    ),
  };
}

function filterWorkbookSheetsByFileKey(
  outputSheets: FullActiveSteelOutputSheets,
  requestedFileKey: string | undefined,
): FullActiveSteelOutputSheets {
  if (!requestedFileKey) {
    return outputSheets;
  }

  return {
    system_order: filterWorkbookSheetByFileKey(outputSheets.system_order, requestedFileKey),
    customer_data: filterWorkbookSheetByFileKey(outputSheets.customer_data, requestedFileKey),
    manual_review: filterWorkbookSheetByFileKey(outputSheets.manual_review, requestedFileKey),
    customer_quote: filterWorkbookSheetByFileKey(outputSheets.customer_quote, requestedFileKey),
  };
}

function renderWorkbookMarkdown(
  snapshot: SteelOutputSheetMemorySnapshot,
  requestedFileKey: string | undefined,
): string {
  const outputSheets = filterWorkbookSheetsByFileKey(snapshot.previousOutputSheets, requestedFileKey);

  return workbookSheetOrder
    .map((sheetId) => {
      const sheet = outputSheets[sheetId];
      const headers = getWorkbookSheetHeaders(sheet);
      const rows = sheet.rows.map((row) => row.cells);

      return [`## ${sheetId}`, '', toMarkdownTable(headers, rows)].join('\n');
    })
    .join('\n\n');
}

function isOcrTextKey(key: string): boolean {
  return ocrTextKeys.has(key);
}

function getExtractOcrFileKey(extract: SteelRuntimeJsonObject): string | undefined {
  if (typeof extract.ocrFileKey === 'string' && extract.ocrFileKey.trim() !== '') {
    return extract.ocrFileKey.trim();
  }
  if (typeof extract.fileId === 'string' && extract.fileId.trim() !== '') {
    return `file:${extract.fileId.trim()}`;
  }
  return undefined;
}

function labelOfficialOcrMarkdown(extract: SteelRuntimeJsonObject, content: string): string {
  const kind = typeof extract.kind === 'string' ? extract.kind : '';
  const source = typeof extract.ocrSource === 'string' ? extract.ocrSource : '';
  if (
    kind !== 'ocr_official_markdown' ||
    (source !== 'paddleocr_official_markdown' && source !== 'ai_official_markdown')
  ) {
    return content;
  }

  const ocrFileKey = getExtractOcrFileKey(extract);
  if (!ocrFileKey || content.startsWith(`<${ocrFileKey}>`)) {
    return content;
  }
  return `<${ocrFileKey}>\n${content}`;
}

function getOcrTextBlocks(extract: SteelRuntimeJsonObject): string[] {
  return Object.entries(extract)
    .filter(([key, value]) => isOcrTextKey(key) && typeof value === 'string' && value.trim() !== '')
    .map(([, value]) => labelOfficialOcrMarkdown(extract, String(value).trim()));
}

function renderOcrMetadataTable(extract: SteelRuntimeJsonObject): string {
  const rows = Object.entries(extract)
    .filter(([key]) => !isOcrTextKey(key))
    .map(([key, value]) => ({ 欄位: key, 內容: stringifyMarkdownValue(value) }));

  return rows.length > 0 ? toMarkdownTable(['欄位', '內容'], rows) : '';
}

function isPaddleOcrRawEvidence(extract: SteelRuntimeJsonObject): boolean {
  return extract.ocrSource === 'paddleocr_mcp' || extract.kind === 'paddleocr_mcp_result';
}

function getOcrEvidenceHeading(extract: SteelRuntimeJsonObject, index: number): string {
  const filename = typeof extract.filename === 'string' ? extract.filename.trim() : '';
  const label = isPaddleOcrRawEvidence(extract)
    ? `PaddleOCR raw/preflight item ${index + 1}`
    : `OCR item ${index + 1}`;
  return filename ? `${label} - ${filename}` : label;
}

function getOcrEvidenceIndexLine(extract: SteelRuntimeJsonObject, index: number): string {
  const ocrFileKeys = Array.isArray(extract.ocrFileKeys)
    ? extract.ocrFileKeys.filter((key) => typeof key === 'string').join(',')
    : undefined;
  const fields = [
    ['heading', getOcrEvidenceHeading(extract, index)],
    ['filename', extract.filename],
    ['ocrFileKey', extract.ocrFileKey],
    ['ocrFileKeys', ocrFileKeys],
    ['fileId', extract.fileId],
    ['source', extract.ocrSource],
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([key, value]) => `${key}=${value}`);

  return `- item ${index + 1}: ${fields.join('; ')}`;
}

function chunkText(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }
  return chunks;
}

function getRequestedFileKey(input: ReadMarkdownInput): string | undefined {
  const fileKey = input.ocrFileKey ?? input.fileKey;
  return typeof fileKey === 'string' && fileKey.trim() !== '' ? fileKey.trim() : undefined;
}

function getOcrExtractsForFileKey(
  snapshot: SteelOutputSheetMemorySnapshot,
  requestedFileKey: string | undefined,
): SteelRuntimeJsonObject[] {
  const extracts = normalizeOcrEvidenceForRuntime(snapshot.derivedIndex.ocrExtracts);
  if (!requestedFileKey) {
    return extracts;
  }
  return extracts.filter((extract) => matchesRequestedFileKey(extract, requestedFileKey));
}

function getOcrStructuredItems(
  extracts: readonly SteelRuntimeJsonObject[],
  options: { includeContentParts: boolean },
): SteelRuntimeJsonObject[] {
  return extracts.map((extract, index) => {
    const textBlocks = getOcrTextBlocks(extract);
    const item: SteelRuntimeJsonObject = {
      item: index + 1,
      heading: getOcrEvidenceHeading(extract, index),
    };

    [
      'filename',
      'ocrFileKey',
      'fileId',
      'ocrSource',
      'ocrEngine',
      'kind',
      'mediaType',
    ].forEach((key) => {
      const value = extract[key];
      if (typeof value === 'string' && value.trim() !== '') {
        item[key] = value;
      }
    });

    if (textBlocks.length > 0) {
      const content = textBlocks.join('\n\n');
      item.content = content;
      if (options.includeContentParts) {
        item.contentParts = chunkText(content, ocrContentPartLength);
      }
    }

    return item;
  });
}

function renderOcrMarkdown(
  snapshot: SteelOutputSheetMemorySnapshot,
  requestedFileKey: string | undefined,
  extracts: readonly SteelRuntimeJsonObject[],
): string {
  if (extracts.length === 0) {
    if (requestedFileKey) {
      return [
        '## OCR data',
        '',
        `No current OCR data for ocrFileKey=${requestedFileKey}.`,
        '',
        '### Available OCR evidence index',
        '',
        ...normalizeOcrEvidenceForRuntime(snapshot.derivedIndex.ocrExtracts).map(
          getOcrEvidenceIndexLine,
        ),
      ].join('\n');
    }
    return '## OCR data\n\nNo current OCR data.';
  }

  return [
    '## OCR data',
    '',
    '### OCR evidence index',
    '',
    ...extracts.map(getOcrEvidenceIndexLine),
    ...extracts.flatMap((extract, index) => {
      const textBlocks = getOcrTextBlocks(extract);
      const metadataTable = renderOcrMetadataTable(extract);

      return [
        '',
        `### ${getOcrEvidenceHeading(extract, index)}`,
        '',
        ...textBlocks,
        ...(metadataTable ? ['', metadataTable] : []),
      ];
    }),
  ].join('\n');
}

async function readMarkdownRows(
  options: ExecuteSteelToolOptions,
  input: ReadMarkdownInput,
): Promise<SteelRawToolOutput> {
  if (!options.outputSheetMemoryReader) {
    throw new Error('Steel output sheet memory reader unavailable');
  }

  const snapshot = await options.outputSheetMemoryReader.readOutputSheetMemory();
  const requestedFileKey = getRequestedFileKey(input);
  const ocrExtracts =
    input.scope === 'ocr' ? getOcrExtractsForFileKey(snapshot, requestedFileKey) : [];
  const markdown =
    input.scope === 'workbook'
      ? renderWorkbookMarkdown(snapshot, requestedFileKey)
      : renderOcrMarkdown(snapshot, requestedFileKey, ocrExtracts);

  return {
    source: 'assistant_markdown_auto_parse',
    scope: input.scope,
    format: 'markdown',
    markdown,
    ...(input.scope === 'ocr'
      ? {
          ocrFileKey: requestedFileKey,
          items: getOcrStructuredItems(ocrExtracts, {
            includeContentParts: requestedFileKey !== undefined,
          }),
        }
      : {}),
    ...(input.scope === 'workbook' && requestedFileKey !== undefined
      ? { fileKey: requestedFileKey }
      : {}),
  };
}

async function emitLog(
  options: ExecuteSteelToolOptions,
  status: 'success' | 'error',
  durationMs: number,
  outputSummary: string,
  sourceRefs: SteelSourceRef[],
  errorCategory?: SteelToolErrorCategory,
) {
  await options.log?.({
    toolName: options.toolName,
    providerToolCallId: options.providerToolCallId,
    status,
    durationMs,
    inputSummary: summarizeInput(options.arguments),
    outputSummary,
    sourceRefs,
    errorCategory,
    redactionVersion: steelToolRedactionVersion,
  });
}

async function errorResult(
  options: ExecuteSteelToolOptions,
  startTime: number,
  errorCategory: SteelToolErrorCategory,
  errorSummary: string,
): Promise<SteelToolResult> {
  const now = options.now ?? Date.now;
  const durationMs = getDurationMs(startTime, now);

  await emitLog(options, 'error', durationMs, errorSummary, [], errorCategory);

  return {
    ok: false,
    toolName: options.toolName,
    errorCategory,
    errorSummary,
    durationMs,
    redactionVersion: steelToolRedactionVersion,
  };
}

async function dispatchSteelTool(
  options: ExecuteSteelToolOptions,
  toolName: SteelToolName,
  args: DispatchSteelToolArgs,
): Promise<SteelRawToolOutput> {
  const { client } = options;

  switch (toolName) {
    case 'search_customers': {
      const input = args as SearchCustomersInput;
      const customers = await searchSteelCustomers(client, input);

      return {
        customers,
      };
    }
    case 'search_price_candidates': {
      const input = args as SearchPriceCandidatesInput;

      return searchPriceCandidates(client, input);
    }
    case 'read_markdown': {
      const input = args as ReadMarkdownInput;

      return readMarkdownRows(options, input);
    }
    default:
      throw new Error(`Unhandled Steel tool: ${toolName}`);
  }
}

function reserveToolCall(runState: SteelToolRunState | undefined): boolean {
  if (!runState) {
    return true;
  }

  if (runState.callsUsed >= runState.maxCalls) {
    return false;
  }

  runState.callsUsed += 1;
  return true;
}

export async function executeSteelTool(options: ExecuteSteelToolOptions): Promise<SteelToolResult> {
  const now = options.now ?? Date.now;
  const startTime = now();

  if (!isExecutableSteelToolName(options.toolName)) {
    return errorResult(
      options,
      startTime,
      'unknown_tool',
      `Unknown Steel tool: ${options.toolName}`,
    );
  }

  if (!reserveToolCall(options.runState)) {
    return errorResult(options, startTime, 'rate_limited', 'Steel tool call limit exceeded');
  }

  const definition = getExecutableSteelToolDefinition(options.toolName);
  const parsedArgs = definition.argsSchema.safeParse(options.arguments);

  if (!parsedArgs.success) {
    return errorResult(
      options,
      startTime,
      'invalid_arguments',
      parsedArgs.error.issues.map((issue) => issue.message).join('; '),
    );
  }

  try {
    const rawData = await dispatchSteelTool(options, options.toolName, parsedArgs.data);
    const data = sanitizeSteelToolOutput(rawData);
    const sourceRefs = collectSourceRefs(data);
    const durationMs = getDurationMs(startTime, now);

    await emitLog(options, 'success', durationMs, summarizeOutput(data), sourceRefs);

    return {
      ok: true,
      toolName: options.toolName,
      data,
      sourceRefs,
      durationMs,
      redactionVersion: steelToolRedactionVersion,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Steel tool repository error';
    return errorResult(options, startTime, 'repository_error', message);
  }
}
