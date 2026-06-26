import {
  searchSteelCustomers,
  discoverSteelPriceCategories,
  searchSteelPriceItems,
} from '../repositories';
import { runSteelFileOcr } from '../vision/ocr';
import { getExecutableSteelToolDefinition, isExecutableSteelToolName } from './registry';
import { sanitizeSteelToolOutput, steelToolRedactionVersion } from './sanitize';
import { steelToolArgsSchemas } from './schemas';

import type { SteelFileOcrOptions, SteelFileOcrSourceFile } from '../vision/ocr';
import type {
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
type RunFileOcrInput = ReturnType<typeof steelToolArgsSchemas.run_file_ocr.parse>;
type SearchPriceCandidateQuery = SearchPriceCandidatesInput['queries'][number];
type DispatchSteelToolArgs =
  | SearchCustomersInput
  | SearchPriceCandidatesInput
  | RunFileOcrInput
  | ReadMarkdownInput;

type RunSteelFileOcr = (options: SteelFileOcrOptions) => Promise<SteelToolResult>;

const workbookSheetOrder = [
  'system_order',
  'customer_data',
  'customer_quote',
  'manual_review',
] as const satisfies readonly SteelRuntimeActiveOutputSheetId[];

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
  ocrFiles?: readonly SteelFileOcrSourceFile[];
  runFileOcr?: RunSteelFileOcr;
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

function collectSourceRefs(value: unknown, refs: SteelSourceRef[] = []): SteelSourceRef[] {
  if (refs.length >= 100 || value === null || value === undefined) {
    return refs;
  }

  if (isSourceRef(value)) {
    refs.push(value);
    return refs;
  }

  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((entry) => collectSourceRefs(entry, refs));
    return refs;
  }

  if (typeof value !== 'object') {
    return refs;
  }

  Object.values(value as { [key: string]: unknown }).forEach((entry) => {
    collectSourceRefs(entry, refs);
  });

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

function renderWorkbookMarkdown(snapshot: SteelOutputSheetMemorySnapshot): string {
  return workbookSheetOrder
    .map((sheetId) => {
      const sheet = snapshot.previousOutputSheets[sheetId];
      const headers = getWorkbookSheetHeaders(sheet);
      const rows = sheet.rows.map((row) => row.cells);

      return [`## ${sheetId}`, '', toMarkdownTable(headers, rows)].join('\n');
    })
    .join('\n\n');
}

function isOcrTextKey(key: string): boolean {
  return ['markdown', 'text', 'content', 'rawText', 'ocrText', 'pageText'].includes(key);
}

function renderOcrMetadataTable(extract: SteelRuntimeJsonObject): string {
  const rows = Object.entries(extract)
    .filter(([key]) => !isOcrTextKey(key))
    .map(([key, value]) => ({ 欄位: key, 內容: stringifyMarkdownValue(value) }));

  return rows.length > 0 ? toMarkdownTable(['欄位', '內容'], rows) : '';
}

function renderOcrMarkdown(snapshot: SteelOutputSheetMemorySnapshot): string {
  if (snapshot.derivedIndex.ocrExtracts.length === 0) {
    return '## OCR data\n\nNo current OCR data.';
  }

  return [
    '## OCR data',
    ...snapshot.derivedIndex.ocrExtracts.flatMap((extract, index) => {
      const textBlocks = Object.entries(extract)
        .filter(([key, value]) => isOcrTextKey(key) && typeof value === 'string' && value.trim() !== '')
        .map(([, value]) => String(value).trim());
      const metadataTable = renderOcrMetadataTable(extract);

      return [
        '',
        `### OCR item ${index + 1}`,
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
  const markdown =
    input.scope === 'workbook' ? renderWorkbookMarkdown(snapshot) : renderOcrMarkdown(snapshot);

  return {
    source: 'assistant_markdown_auto_parse',
    scope: input.scope,
    format: 'markdown',
    markdown,
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
    case 'run_file_ocr': {
      const input = args as RunFileOcrInput;
      const files = options.ocrFiles ?? [];
      const result = await (options.runFileOcr ?? runSteelFileOcr)({
        arguments: input,
        files,
        providerToolCallId: options.providerToolCallId ?? 'run_file_ocr',
      });

      if (!result.ok) {
        throw new Error(result.errorSummary);
      }

      return result.data as SteelRawToolOutput;
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
