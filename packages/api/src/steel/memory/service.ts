import {
  createSteelWorkingOrderMemoryModel,
  type ISteelWorkingOrderMemory,
} from '@librechat/data-schemas';
import { parseMarkdownTables } from '../markdown/table';
import { resolveOcrPreprocessingChunkSizePages } from '../ocr/config';
import { getPaddleOcrResultText } from '../ocr/text';

import type { FilterQuery } from 'mongoose';
import type { SteelMarkdownTable } from '../markdown/table';
import type {
  FullActiveSteelOutputSheets,
  SteelOutputSheetMemorySnapshot,
  SteelRuntimeOutputSheet,
  SteelRuntimeOutputSheetRow,
} from '../runtime/context';

type Mongoose = typeof import('mongoose');
type SteelJsonPrimitive = string | number | boolean | null;
type SteelJsonValue = SteelJsonPrimitive | SteelJsonValue[] | SteelJsonObject;

interface SteelJsonObject {
  [key: string]: SteelJsonValue;
}

export {
  defaultOcrPreprocessingChunkSizePages,
  ocrPreprocessingChunkSizePagesEnvKey,
  resolveOcrPreprocessingChunkSizePages,
} from '../ocr/config';

const defaultWorkbookFileKey = 'default';

export const ocrPreprocessingPipelineVersion = 1;
export const ocrPreprocessingOrganizerVersion = 1;

export interface CaptureAssistantFinalMarkdownInput {
  conversationId: string;
  requestId?: string;
  messageId: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  content: string;
  currentTurnFiles?: readonly SteelOcrFileReference[];
  currentOcrMarkdownResults?: readonly SteelOcrFileReference[];
}

export interface CaptureAssistantFinalMarkdownResult {
  parseStatus: 'saved' | 'partial' | 'skipped';
  savedCounts: { [key: string]: number };
  savedTableCounts?: { [key: string]: number };
  totalSavedCounts?: { [key: string]: number };
  totalTableCounts?: { [key: string]: number };
}

export interface CaptureToolResultInput {
  conversationId: string;
  requestId?: string;
  providerToolCallId?: string;
  toolName: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  data: unknown;
}

export interface CaptureToolResultResult {
  savedCounts: { [key: string]: number };
  totalSavedCounts?: { [key: string]: number };
  totalTableCounts?: { [key: string]: number };
}

export type SteelOcrSource = 'assistant_ocr' | 'paddleocr_mcp';

export interface SteelOcrFileReference {
  ocrFileKey?: string;
  ocrSource?: string;
  ocrPreprocessing?: SteelJsonObject;
  content?: string;
  fileId?: string;
  file_id?: string;
  id?: string;
  storageKey?: string;
  storage_key?: string;
  filepath?: string;
  path?: string;
  filename?: string;
  name?: string;
  originalname?: string;
  mediaType?: string;
  type?: string;
  mimeType?: string;
  mimetype?: string;
  pageNumber?: number;
  imageIndex?: number;
  width?: number;
  height?: number;
}

export interface SteelOcrFileDescriptor {
  ocrFileKey: string;
  fileId?: string;
  storageKey?: string;
  filename?: string;
  mediaType?: string;
  pageNumber?: number;
  imageIndex?: number;
  width?: number;
  height?: number;
}

export interface FindMissingPaddleOcrFileKeysInput {
  conversationId: string;
  files: readonly SteelOcrFileReference[];
}

export interface FindMissingPaddleOcrFileKeysResult {
  completedKeys: string[];
  missingFiles: SteelOcrFileDescriptor[];
  missingKeys: string[];
}

export interface CapturePaddleOcrResultInput {
  conversationId: string;
  requestId?: string;
  providerToolCallId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  file: SteelOcrFileReference;
  data: unknown;
}

export interface OcrPreprocessingPdfChunkReference {
  source: 's3' | 'cloudfront';
  storageKey: string;
  storageRegion?: string;
  filepath: string;
}

export interface OcrPreprocessingChunkCaptureInput {
  pipelineVersion?: number;
  sourcePdfKey: string;
  chunkIndex: number;
  chunkCount: number;
  pageStart: number;
  pageEnd: number;
  chunkSizePages?: number;
  pdfChunk?: OcrPreprocessingPdfChunkReference;
}

export interface CapturePaddleOcrChunkResultInput {
  conversationId: string;
  requestId?: string;
  providerToolCallId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  file: SteelOcrFileReference;
  chunk: OcrPreprocessingChunkCaptureInput;
  rawResultHash: string;
  data: unknown;
  includeTotals?: boolean;
}

export interface CaptureOcrPreprocessingChunkMarkdownInput {
  conversationId: string;
  requestId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  file: SteelOcrFileReference;
  chunk: OcrPreprocessingChunkCaptureInput;
  rawResultHash: string;
  ocrRuleVersion: string;
  content: string;
  includeTotals?: boolean;
}

export interface OfficialOcrMarkdownInput {
  conversationId: string;
  sourcePdfKey: string;
  ocrFileKey: string;
  ocrRuleVersion: string;
  pipelineVersion?: number;
}

export interface OfficialOcrMarkdownResult {
  markdown: string;
  chunkCount: number;
}

export interface CaptureOfficialOcrMarkdownInput extends OfficialOcrMarkdownInput {
  requestId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  file: SteelOcrFileReference;
  content: string;
  chunkCount: number;
}

export interface OcrPreprocessingStateInput {
  conversationId: string;
  sourcePdfKey: string;
  ocrFileKey: string;
  ocrRuleVersion: string;
  pipelineVersion?: number;
}

export interface OcrPreprocessingChunkState {
  chunkIndex: number;
  chunkCount: number;
  pageStart: number;
  pageEnd: number;
  chunkSizePages: number;
  rawSaved: boolean;
  organizedSaved: boolean;
  rawResultHash?: string;
  rawOcrText?: string;
  ocrRuleVersion?: string;
  organizedMarkdown?: string;
}

export interface OcrPreprocessingState {
  ocrFileKey: string;
  sourcePdfKey: string;
  pipelineVersion: number;
  ocrRuleVersion: string;
  chunkSizePages: number;
  chunkCount: number;
  chunks: OcrPreprocessingChunkState[];
}

interface SteelWorkingOrderMemoryDocument {
  _id?: unknown;
  memoryKind: string;
  sourceKind: string;
  turnIndex: number;
  createdAt?: Date;
  summary?: string;
  payload?: SteelJsonValue;
  sourceRefs?: {
    sourceKind: string;
    sourceId?: string;
    filename?: string;
    fileId?: string;
    storageKey?: string;
    mediaType?: string;
    ocrFileKey?: string;
    pageNumber?: number;
    imageIndex?: number;
    locator?: string;
  }[];
}

interface MemorySourceRef {
  sourceKind: string;
  sourceId?: string;
  filename?: string;
  fileId?: string;
  storageKey?: string;
  mediaType?: string;
  ocrFileKey?: string;
  pageNumber?: number;
  imageIndex?: number;
  locator?: string;
}

interface TitledSteelMarkdownTable extends SteelMarkdownTable {
  title: string;
}

const activeSavedMemoryKinds = [
  'working_order_row',
  'customer_fact',
  'price_evidence',
  'calculation_fact',
  'ocr_extract',
  'paddleocr_preflight',
];

export interface SteelOutputSheetMemoryReader {
  readOutputSheetMemory(): Promise<SteelOutputSheetMemorySnapshot>;
}

export interface SteelWorkingOrderMemoryReadInput {
  mode: 'summary' | 'rowNo' | 'erpItemCode' | 'query' | 'source' | 'page';
  rowNo?: number;
  erpItemCode?: string;
  query?: string;
  filename?: string;
  pageNumber?: number;
  imageIndex?: number;
  page?: number;
  pageSize?: number;
}

export interface SteelWorkingOrderMemoryReader {
  readWorkingOrderItems(input: SteelWorkingOrderMemoryReadInput): Promise<SteelJsonObject>;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isJsonObject(value: SteelJsonValue | undefined): value is SteelJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPageSize(input: SteelWorkingOrderMemoryReadInput): number {
  return input.pageSize ?? 20;
}

function getPage(input: SteelWorkingOrderMemoryReadInput): number {
  return input.mode === 'page' ? (input.page ?? 1) : 1;
}

function rowNoFilter(rowNo: number): FilterQuery<ISteelWorkingOrderMemory> {
  return {
    memoryKind: 'working_order_row',
    $or: [
      { 'payload.rowNo': rowNo },
      { 'payload.rowNo': String(rowNo) },
      { 'payload.itemNo': rowNo },
      { 'payload.itemNo': String(rowNo) },
      { 'payload.項次': rowNo },
      { 'payload.項次': String(rowNo) },
    ],
  };
}

function erpItemCodeFilter(erpItemCode: string): FilterQuery<ISteelWorkingOrderMemory> {
  return {
    memoryKind: 'working_order_row',
    $or: [
      { 'payload.erpItemCode': erpItemCode },
      { 'payload.modelCode': erpItemCode },
      { 'payload.型號': erpItemCode },
    ],
  };
}

function queryFilter(query: string): FilterQuery<ISteelWorkingOrderMemory> {
  const regex = new RegExp(escapeRegex(query), 'i');

  return {
    memoryKind: 'working_order_row',
    $or: [
      { summary: regex },
      { 'payload.productName': regex },
      { 'payload.specKey': regex },
      { 'payload.notes': regex },
      { 'payload.品名規格': regex },
      { 'payload.備註': regex },
    ],
  };
}

function sourceFilter(
  input: SteelWorkingOrderMemoryReadInput,
): FilterQuery<ISteelWorkingOrderMemory> {
  const sourceRefMatchers: FilterQuery<ISteelWorkingOrderMemory>[] = [];

  if (input.filename !== undefined) {
    sourceRefMatchers.push({ sourceRefs: { $elemMatch: { filename: input.filename } } });
  }
  if (input.pageNumber !== undefined) {
    sourceRefMatchers.push({ sourceRefs: { $elemMatch: { pageNumber: input.pageNumber } } });
  }
  if (input.imageIndex !== undefined) {
    sourceRefMatchers.push({ sourceRefs: { $elemMatch: { imageIndex: input.imageIndex } } });
  }

  return sourceRefMatchers.length === 1 ? sourceRefMatchers[0] : { $or: sourceRefMatchers };
}

function getModeFilter(
  input: SteelWorkingOrderMemoryReadInput,
): FilterQuery<ISteelWorkingOrderMemory> {
  switch (input.mode) {
    case 'summary':
      return {};
    case 'rowNo':
      return rowNoFilter(input.rowNo ?? 0);
    case 'erpItemCode':
      return erpItemCodeFilter(input.erpItemCode ?? '');
    case 'query':
      return queryFilter(input.query ?? '');
    case 'source':
      return sourceFilter(input);
    case 'page':
      return { memoryKind: 'working_order_row' };
    default:
      return {};
  }
}

function toWorkingOrderRow(document: SteelWorkingOrderMemoryDocument): SteelJsonObject | undefined {
  if (document.memoryKind !== 'working_order_row' || !isJsonObject(document.payload)) {
    return undefined;
  }

  return document.payload;
}

function toMemoryEntry(document: SteelWorkingOrderMemoryDocument) {
  return {
    memoryKind: document.memoryKind,
    sourceKind: document.sourceKind,
    turnIndex: document.turnIndex,
    summary: document.summary,
    payload: document.payload,
    sourceRefs: document.sourceRefs,
  };
}

function summarizeByKind(documents: SteelWorkingOrderMemoryDocument[]) {
  const counts: { [key: string]: number } = {};

  for (const document of documents) {
    if (document.memoryKind === 'ocr_extract' && isJsonObject(document.payload)) {
      const kind = getStringProperty(document.payload, 'kind');
      if (kind === 'ocr_preprocessing_chunk_markdown') {
        counts.ocr_preprocessing_chunk_markdown =
          (counts.ocr_preprocessing_chunk_markdown ?? 0) + 1;
        continue;
      }
      if (kind === 'ocr_official_markdown') {
        if (!isOfficialOcrMarkdownPayload(document.payload)) {
          continue;
        }
        counts.ocr_markdown = (counts.ocr_markdown ?? 0) + 1;
        continue;
      }
    }

    counts[document.memoryKind] = (counts[document.memoryKind] ?? 0) + 1;
  }

  return counts;
}

function summarizeTableCounts(documents: SteelWorkingOrderMemoryDocument[]) {
  const counts: { [key: string]: number } = {};
  const systemOrderGroups = new Set<string>();

  for (const document of documents) {
    if (document.memoryKind === 'ocr_extract') {
      if (
        isJsonObject(document.payload) &&
        ['ocr_preprocessing_chunk_markdown', 'ocr_official_markdown'].includes(
          getStringProperty(document.payload, 'kind') ?? '',
        )
      ) {
        continue;
      }
      counts.ocr_table = (counts.ocr_table ?? 0) + 1;
      continue;
    }

    if (document.memoryKind !== 'working_order_row' || !isJsonObject(document.payload)) {
      continue;
    }

    systemOrderGroups.add(getStringProperty(document.payload, 'ocrFileKey') ?? 'default');
  }

  if (systemOrderGroups.size > 0) {
    counts.system_order_table = systemOrderGroups.size;
  }

  return counts;
}

async function readActiveMemoryTotals({
  SteelWorkingOrderMemory,
  conversationId,
}: {
  SteelWorkingOrderMemory: ReturnType<typeof createSteelWorkingOrderMemoryModel>;
  conversationId: string;
}) {
  const documents = await SteelWorkingOrderMemory.find({
    conversationId,
    state: 'active',
    memoryKind: { $in: activeSavedMemoryKinds },
  })
    .select({
      memoryKind: 1,
      'payload.kind': 1,
      'payload.ocrFileKey': 1,
      'payload.ocrSource': 1,
      'payload.title': 1,
    })
    .lean<SteelWorkingOrderMemoryDocument[]>();

  return {
    totalSavedCounts: summarizeByKind(documents),
    totalTableCounts: summarizeTableCounts(documents),
  };
}

function isWorkingOrderTable(headers: readonly string[]): boolean {
  return ['項次', '型號', '品名規格'].every((header) => headers.includes(header));
}

function getFirstText(values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeOcrLookupValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeOcrFilename(value: string | undefined): string {
  const lookupValue = normalizeOcrLookupValue(value).replace(/\\/gu, '/').split(/[?#]/u)[0];
  return (
    lookupValue
      .split('/')
      .filter((part) => part !== '')
      .pop() ?? lookupValue
  );
}

export function isSteelOcrCapableFile(file: SteelOcrFileReference): boolean {
  const mediaType = normalizeOcrLookupValue(
    getFirstText([file.mediaType, file.type, file.mimeType, file.mimetype]),
  );
  const filename = normalizeOcrFilename(
    getFirstText([file.filename, file.name, file.originalname, file.filepath, file.path]),
  );

  return (
    mediaType === 'application/pdf' ||
    mediaType.startsWith('image/') ||
    /\.(pdf|png|jpe?g|webp|bmp|gif|tiff?)$/iu.test(filename)
  );
}

export function getSteelOcrFileDescriptor(
  file: SteelOcrFileReference,
): SteelOcrFileDescriptor | undefined {
  if (!isSteelOcrCapableFile(file)) {
    return undefined;
  }

  const fileId = getFirstText([file.fileId, file.file_id, file.id]);
  const storageKey = getFirstText([file.storageKey, file.storage_key]);
  const pathKey = getFirstText([file.filepath, file.path]);
  const filename = getFirstText([file.filename, file.name, file.originalname]);
  const mediaType = getFirstText([file.mediaType, file.type, file.mimeType, file.mimetype]);
  const providedOcrFileKey = getFirstText([file.ocrFileKey]);
  const ocrFileKey =
    providedOcrFileKey !== undefined
      ? providedOcrFileKey
      : fileId !== undefined
        ? `file:${fileId}`
        : storageKey !== undefined
          ? `storage:${storageKey}`
          : pathKey !== undefined
            ? `path:${pathKey}`
            : filename !== undefined
              ? `filename:${normalizeOcrFilename(filename)}`
              : undefined;

  if (ocrFileKey === undefined) {
    return undefined;
  }

  return {
    ocrFileKey,
    ...(fileId !== undefined ? { fileId } : {}),
    ...(storageKey !== undefined ? { storageKey } : {}),
    ...(filename !== undefined ? { filename } : {}),
    ...(mediaType !== undefined ? { mediaType } : {}),
    ...(file.pageNumber !== undefined ? { pageNumber: file.pageNumber } : {}),
    ...(file.imageIndex !== undefined ? { imageIndex: file.imageIndex } : {}),
    ...(file.width !== undefined ? { width: file.width } : {}),
    ...(file.height !== undefined ? { height: file.height } : {}),
  };
}

function getUniqueOcrFileDescriptors(
  files: readonly SteelOcrFileReference[] | undefined,
): SteelOcrFileDescriptor[] {
  const descriptors: SteelOcrFileDescriptor[] = [];
  const seen = new Set<string>();

  for (const file of files ?? []) {
    const descriptor = getSteelOcrFileDescriptor(file);
    if (!descriptor || seen.has(descriptor.ocrFileKey)) {
      continue;
    }
    seen.add(descriptor.ocrFileKey);
    descriptors.push(descriptor);
  }

  return descriptors;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getCell(row: SteelJsonObject, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' ? value : undefined;
}

function toPayload(headers: readonly string[], cells: readonly string[]): SteelJsonObject {
  const payload: SteelJsonObject = {};

  headers.forEach((header, index) => {
    payload[header] = cells[index] ?? '';
  });

  const rowNo = parseNumber(getCell(payload, '項次'));
  const quantity = parseNumber(getCell(payload, '數量'));
  const unitPrice = parseNumber(getCell(payload, '單價'));
  const unitWeight = parseNumber(getCell(payload, '單重'));
  const totalQuantity = parseNumber(getCell(payload, '總數'));
  const erpItemCode = getCell(payload, '型號');
  const productName = getCell(payload, '品名規格');

  if (rowNo !== undefined) {
    payload.rowNo = rowNo;
  }
  if (erpItemCode !== undefined) {
    payload.erpItemCode = erpItemCode;
  }
  if (productName !== undefined) {
    payload.productName = productName;
  }
  if (quantity !== undefined) {
    payload.quantity = quantity;
  }
  if (unitPrice !== undefined) {
    payload.unitPrice = unitPrice;
  }
  if (unitWeight !== undefined) {
    payload.unitWeight = unitWeight;
  }
  if (totalQuantity !== undefined) {
    payload.totalQuantity = totalQuantity;
  }

  return payload;
}

function getRowSummary(payload: SteelJsonObject): string {
  const rowNo = typeof payload.rowNo === 'number' ? `第 ${payload.rowNo} 項` : '工作訂單列';
  const erpItemCode = typeof payload.erpItemCode === 'string' ? payload.erpItemCode : '';
  const productName = typeof payload.productName === 'string' ? payload.productName : '';

  return [rowNo, erpItemCode, productName].filter((entry) => entry.trim() !== '').join(' ');
}

function getFactSummary(payload: SteelJsonObject): string {
  return Object.values(payload)
    .filter((value): value is string | number | boolean => {
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    })
    .map(String)
    .filter((value) => value.trim() !== '')
    .join(' ');
}

function normalizeTableTitle(line: string): string {
  return line
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^\*\*(.*)\*\*$/u, '$1')
    .trim();
}

function isStructuredTableTitleLine(line: string): boolean {
  return /^#{1,6}\s*/u.test(line) || /^\*\*.*\*\*$/u.test(line);
}

function getTableTitleType(title: string): 'ocr' | 'workbook' | undefined {
  const normalizedTitle = title.toLowerCase();
  if (normalizedTitle.includes('ocr')) {
    return 'ocr';
  }
  if (normalizedTitle.includes('system')) {
    return 'workbook';
  }
  return undefined;
}

const officialOcrMarkdownTitlePattern = /ocr/iu;

function isOfficialOcrMarkdownTitle(title: string): boolean {
  return getTableTitleType(title) === 'ocr';
}

function getParsedTables(content: string): TitledSteelMarkdownTable[] {
  const tables: TitledSteelMarkdownTable[] = [];
  let pendingTitle = '';
  let pendingTitleIsStructured = false;
  let currentTitle = '';
  let currentBlock: string[] = [];

  const flushCurrentBlock = () => {
    if (currentBlock.length === 0) {
      return;
    }

    const table = parseMarkdownTables(currentBlock.join('\n'))[0];
    if (table) {
      tables.push({
        ...table,
        title: currentTitle,
      });
    }

    currentBlock = [];
    currentTitle = '';
    pendingTitle = '';
    pendingTitleIsStructured = false;
  };

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const isTableLine = line.startsWith('|') && line.endsWith('|');
    if (isTableLine) {
      if (currentBlock.length === 0) {
        currentTitle = pendingTitle;
      }
      currentBlock.push(line);
      continue;
    }

    flushCurrentBlock();

    if (line !== '') {
      const isStructuredTitle = isStructuredTableTitleLine(line);
      if (isStructuredTitle || !pendingTitleIsStructured) {
        pendingTitle = normalizeTableTitle(line);
        pendingTitleIsStructured = isStructuredTitle;
      }
    }
  }

  flushCurrentBlock();

  return tables;
}

function toPayloads(headers: readonly string[], rows: readonly string[][]): SteelJsonObject[] {
  return rows.map((cells) => toPayload(headers, cells));
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, '<br>');
}

function renderMarkdownTable(headers: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${headers.map(escapeMarkdownTableCell).join(' |')} |`,
    `| ${headers.map(() => '---').join(' |')} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(' |')} |`),
  ].join('\n');
}

function descriptorMatchesTable(
  descriptor: SteelOcrFileDescriptor,
  title: string,
  rows: readonly string[][],
): boolean {
  const tableText = [title, ...rows.flat()].map(normalizeOcrLookupValue).join('\n');
  const filename = normalizeOcrFilename(descriptor.filename);
  const candidates = [descriptor.fileId, filename].filter(
    (value): value is string => value !== undefined && value !== '',
  );

  return candidates.some((candidate) => tableText.includes(normalizeOcrLookupValue(candidate)));
}

function getExplicitOcrFileKeyFromTitle(title: string): string | undefined {
  const match = /(?:^|[\s`([{（【])(?<fileKey>file:[^`\s)\]）】,，;；]+)/u.exec(title);
  return match?.groups?.fileKey;
}

function getOcrDescriptorsForTable({
  title,
  rows,
  currentTurnFiles,
}: {
  title: string;
  rows: readonly string[][];
  currentTurnFiles?: readonly SteelOcrFileReference[];
}): SteelOcrFileDescriptor[] {
  const descriptors = getUniqueOcrFileDescriptors(currentTurnFiles);
  if (descriptors.length <= 1) {
    return descriptors;
  }

  return descriptors.filter((descriptor) => descriptorMatchesTable(descriptor, title, rows));
}

function getOfficialOcrDescriptorsForTable({
  title,
  currentOcrMarkdownResults,
  currentTurnFiles,
}: {
  title: string;
  currentOcrMarkdownResults?: readonly SteelOcrFileReference[];
  currentTurnFiles?: readonly SteelOcrFileReference[];
}): SteelOcrFileDescriptor[] {
  const titleFileKey = getExplicitOcrFileKeyFromTitle(title);
  if (!titleFileKey) {
    return [];
  }

  const descriptorsByKey = new Map<string, SteelOcrFileDescriptor>();
  for (const descriptor of getUniqueOcrFileDescriptors(currentOcrMarkdownResults)) {
    descriptorsByKey.set(descriptor.ocrFileKey, descriptor);
  }
  for (const descriptor of getUniqueOcrFileDescriptors(currentTurnFiles)) {
    if (!descriptorsByKey.has(descriptor.ocrFileKey)) {
      descriptorsByKey.set(descriptor.ocrFileKey, descriptor);
    }
  }
  const descriptors = [...descriptorsByKey.values()];
  const matched = descriptors.find((descriptor) => descriptor.ocrFileKey === titleFileKey);
  if (matched) {
    return [matched];
  }

  return [{ ocrFileKey: titleFileKey }];
}

function getOfficialOcrMetadataForDescriptor({
  descriptor,
  currentOcrMarkdownResults,
  paddleOcrSource,
}: {
  descriptor: SteelOcrFileDescriptor | undefined;
  currentOcrMarkdownResults?: readonly SteelOcrFileReference[];
  paddleOcrSource: boolean;
}): SteelJsonObject {
  const source = currentOcrMarkdownResults
    ?.map((result) => ({
      descriptor: getSteelOcrFileDescriptor(result),
      metadata:
        result.ocrPreprocessing !== undefined && isJsonObject(result.ocrPreprocessing)
          ? result.ocrPreprocessing
          : undefined,
    }))
    .find((entry) => entry.descriptor?.ocrFileKey === descriptor?.ocrFileKey);

  return {
    ...(source?.metadata ?? {}),
    official: true,
    source: paddleOcrSource ? 'paddleocr_markdowns' : 'ai_ocr_markdowns',
  };
}

function getOcrGroupKeyForDescriptors(descriptors: readonly SteelOcrFileDescriptor[]): string {
  const keys = [...new Set(descriptors.map((descriptor) => descriptor.ocrFileKey))].sort();
  return keys.length > 0 ? `files:${keys.join('|')}` : 'files:default';
}

function toOcrFileMetadataPayload(descriptor: SteelOcrFileDescriptor): SteelJsonObject {
  return {
    ocrFileKey: descriptor.ocrFileKey,
    ...(descriptor.fileId !== undefined ? { fileId: descriptor.fileId } : {}),
    ...(descriptor.storageKey !== undefined ? { storageKey: descriptor.storageKey } : {}),
    ...(descriptor.filename !== undefined ? { filename: descriptor.filename } : {}),
    ...(descriptor.mediaType !== undefined ? { mediaType: descriptor.mediaType } : {}),
    ...(descriptor.pageNumber !== undefined ? { pageNumber: descriptor.pageNumber } : {}),
    ...(descriptor.imageIndex !== undefined ? { imageIndex: descriptor.imageIndex } : {}),
    ...(descriptor.width !== undefined ? { width: descriptor.width } : {}),
    ...(descriptor.height !== undefined ? { height: descriptor.height } : {}),
  };
}

function toOcrMarkdownPayload(
  headers: readonly string[],
  rows: readonly string[][],
  tableIndex: number,
  title: string,
  descriptors: readonly SteelOcrFileDescriptor[],
  options: { official?: boolean; officialMetadata?: SteelJsonObject } = {},
): SteelJsonObject {
  const singleDescriptor = descriptors.length === 1 ? descriptors[0] : undefined;
  const official = options.official === true;
  const officialSource =
    official && options.officialMetadata?.source === 'paddleocr_markdowns'
      ? 'paddleocr_official_markdown'
      : 'ai_official_markdown';
  const ocrGroupKey = getOcrGroupKeyForDescriptors(descriptors);

  return {
    kind: official ? 'ocr_official_markdown' : 'assistant_ocr_markdown',
    ocrSource: official ? officialSource : 'assistant_ocr',
    ocrEngine: officialSource === 'paddleocr_official_markdown' ? 'paddleocr_vl' : 'assistant',
    ...(singleDescriptor !== undefined ? toOcrFileMetadataPayload(singleDescriptor) : {}),
    ...(official && singleDescriptor === undefined ? { ocrFileKey: defaultWorkbookFileKey } : {}),
    ...(official ? { ocrGroupKey } : {}),
    ...(descriptors.length > 1
      ? {
          ocrFileKeys: descriptors.map((descriptor) => descriptor.ocrFileKey),
          files: descriptors.map(toOcrFileMetadataPayload),
        }
      : {}),
    tableIndex,
    title,
    headers: [...headers],
    rows: rows.map((row) => [...row]),
    markdown: renderMarkdownTable(headers, rows),
    ...(official
      ? {
          ocrPreprocessing: options.officialMetadata ?? {
            official: true,
            source: 'assistant_final_markdown',
          },
        }
      : {}),
  };
}

function getOcrMarkdownSummary(payload: SteelJsonObject): string {
  const markdown = getStringProperty(payload, 'markdown') ?? '';
  return ['OCR Markdown', markdown.replace(/\s+/g, ' ')]
    .filter((entry) => entry.trim() !== '')
    .join(' ');
}

function incrementSavedCount(savedCounts: { [key: string]: number }, key: string, count: number) {
  if (count <= 0) {
    return;
  }

  savedCounts[key] = (savedCounts[key] ?? 0) + count;
}

function createSourceRef(messageId: string, locator: string, descriptor?: SteelOcrFileDescriptor) {
  return [
    {
      sourceKind: 'assistant_final_markdown',
      sourceId: messageId,
      locator,
      ...(descriptor !== undefined ? toOcrFileMetadataPayload(descriptor) : {}),
    },
  ];
}

function toJsonValue(value: unknown, seen = new WeakSet<object>()): SteelJsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    const output = value.map((entry) => toJsonValue(entry, seen));
    seen.delete(value);
    return output;
  }

  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);
  const output: SteelJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = toJsonValue(entry, seen);
  }
  seen.delete(value);
  return output;
}

function getArrayProperty(value: SteelJsonValue, key: string): SteelJsonValue[] {
  if (!isJsonObject(value)) {
    return [];
  }
  const property = value[key];
  return Array.isArray(property) ? property : [];
}

function getStringProperty(value: SteelJsonValue, key: string): string | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const property = value[key];
  return typeof property === 'string' ? property : undefined;
}

function getNumberProperty(value: SteelJsonValue, key: string): number | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const property = value[key];
  return typeof property === 'number' ? property : undefined;
}

function getObjectProperty(value: SteelJsonValue, key: string): SteelJsonObject | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const property = value[key];
  return isJsonObject(property) ? property : undefined;
}

function getOcrDescriptorFromPayload(payload: SteelJsonObject): SteelOcrFileDescriptor | undefined {
  const ocrFileKey = getStringProperty(payload, 'ocrFileKey');
  if (ocrFileKey === undefined) {
    return undefined;
  }

  return {
    ocrFileKey,
    ...(getStringProperty(payload, 'fileId') !== undefined
      ? { fileId: getStringProperty(payload, 'fileId') }
      : {}),
    ...(getStringProperty(payload, 'storageKey') !== undefined
      ? { storageKey: getStringProperty(payload, 'storageKey') }
      : {}),
    ...(getStringProperty(payload, 'filename') !== undefined
      ? { filename: getStringProperty(payload, 'filename') }
      : {}),
    ...(getStringProperty(payload, 'mediaType') !== undefined
      ? { mediaType: getStringProperty(payload, 'mediaType') }
      : {}),
    ...(getNumberProperty(payload, 'pageNumber') !== undefined
      ? { pageNumber: getNumberProperty(payload, 'pageNumber') }
      : {}),
    ...(getNumberProperty(payload, 'imageIndex') !== undefined
      ? { imageIndex: getNumberProperty(payload, 'imageIndex') }
      : {}),
    ...(getNumberProperty(payload, 'width') !== undefined
      ? { width: getNumberProperty(payload, 'width') }
      : {}),
    ...(getNumberProperty(payload, 'height') !== undefined
      ? { height: getNumberProperty(payload, 'height') }
      : {}),
  };
}

function toMemorySourceRefs({
  providerToolCallId,
  sourceRefs,
}: {
  providerToolCallId?: string;
  sourceRefs: SteelJsonValue[];
}): MemorySourceRef[] {
  return sourceRefs.filter(isJsonObject).map((ref) => ({
    sourceKind:
      [getStringProperty(ref, 'channel'), getStringProperty(ref, 'factType')]
        .filter((entry): entry is string => entry !== undefined)
        .join(':') || 'tool_result',
    sourceId: providerToolCallId,
    filename: getStringProperty(ref, 'filename') ?? getStringProperty(ref, 'sourceFile'),
    fileId: getStringProperty(ref, 'fileId') ?? getStringProperty(ref, 'file_id'),
    storageKey: getStringProperty(ref, 'storageKey') ?? getStringProperty(ref, 'storage_key'),
    mediaType: getStringProperty(ref, 'mediaType') ?? getStringProperty(ref, 'mimeType'),
    ocrFileKey: getStringProperty(ref, 'ocrFileKey'),
    pageNumber: getNumberProperty(ref, 'pageNumber') ?? getNumberProperty(ref, 'page'),
    imageIndex: getNumberProperty(ref, 'imageIndex'),
    locator: getStringProperty(ref, 'locator'),
  }));
}

function getCustomerSummary(payload: SteelJsonObject): string {
  return [
    getStringProperty(payload, 'displayName'),
    getStringProperty(payload, 'erpCustomerCode'),
    isJsonObject(payload.customerTier)
      ? getStringProperty(payload.customerTier, 'code')
      : undefined,
  ]
    .filter((entry): entry is string => entry !== undefined && entry.trim() !== '')
    .join(' ');
}

function getPriceSummary(payload: SteelJsonObject): string {
  return [
    getStringProperty(payload, 'erpItemCode'),
    getStringProperty(payload, 'productName'),
    getStringProperty(payload, 'specKey'),
  ]
    .filter((entry): entry is string => entry !== undefined && entry.trim() !== '')
    .join(' ');
}

function createToolMemoryDocument(input: {
  conversationId: string;
  requestId?: string;
  providerToolCallId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  memoryKind: string;
  sourceKind: 'tool_result' | 'ocr_result';
  payload: SteelJsonObject;
  summary: string;
  sourceRefs?: MemorySourceRef[];
}) {
  return {
    conversationId: input.conversationId,
    requestId: input.requestId,
    turnIndex: input.turnIndex,
    checkpointTurnIndex: input.checkpointTurnIndex,
    memoryKind: input.memoryKind,
    sourceKind: input.sourceKind,
    state: 'active',
    summary: input.summary,
    payload: input.payload,
    sourceRefs:
      input.sourceRefs && input.sourceRefs.length > 0
        ? input.sourceRefs
        : [
            {
              sourceKind: input.sourceKind,
              sourceId: input.providerToolCallId,
            },
          ],
  };
}

function getGroupedPriceCandidates(data: SteelJsonObject) {
  return getArrayProperty(data, 'queryResults')
    .filter(isJsonObject)
    .flatMap((queryResult) => {
      const query = isJsonObject(queryResult.query) ? queryResult.query : null;
      const queryId = getStringProperty(queryResult, 'queryId');

      return getArrayProperty(queryResult, 'candidates')
        .filter(isJsonObject)
        .map((candidate) => ({ candidate, query, queryId }));
    });
}

function getToolCaptureDocuments(input: CaptureToolResultInput) {
  const data = toJsonValue(input.data);
  if (!isJsonObject(data)) {
    return [];
  }

  if (input.toolName === 'search_customers') {
    return getArrayProperty(data, 'customers')
      .filter(isJsonObject)
      .map((customer) =>
        createToolMemoryDocument({
          ...input,
          memoryKind: 'customer_fact',
          sourceKind: 'tool_result',
          payload: customer,
          summary: getCustomerSummary(customer) || getFactSummary(customer),
          sourceRefs: toMemorySourceRefs({
            providerToolCallId: input.providerToolCallId,
            sourceRefs: getArrayProperty(customer, 'sourceRefs'),
          }),
        }),
      );
  }

  if (input.toolName === 'search_price_candidates') {
    return getGroupedPriceCandidates(data).map(({ candidate, query, queryId }) =>
      createToolMemoryDocument({
        ...input,
        memoryKind: 'price_evidence',
        sourceKind: 'tool_result',
        payload: {
          ...candidate,
          ...(queryId ? { queryId } : {}),
          ...(query ? { searchQuery: query } : {}),
        },
        summary: getPriceSummary(candidate) || getFactSummary(candidate),
        sourceRefs: toMemorySourceRefs({
          providerToolCallId: input.providerToolCallId,
          sourceRefs: getArrayProperty(candidate, 'sourceRefs'),
        }),
      }),
    );
  }

  return [];
}

function createMemoryDocuments(input: {
  conversationId: string;
  requestId?: string;
  messageId: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  memoryKind: string;
  payloads: SteelJsonObject[];
  summaryForPayload: (payload: SteelJsonObject) => string;
  locatorPrefix: string;
}) {
  return input.payloads.map((payload, index) => ({
    conversationId: input.conversationId,
    requestId: input.requestId,
    turnIndex: input.turnIndex,
    checkpointTurnIndex: input.checkpointTurnIndex,
    memoryKind: input.memoryKind,
    sourceKind: 'assistant_final_markdown',
    state: 'active',
    summary: input.summaryForPayload(payload),
    payload,
    sourceRefs: createSourceRef(
      input.messageId,
      `${input.locatorPrefix},row:${index + 1}`,
      getOcrDescriptorFromPayload(payload),
    ),
  }));
}

function getParsedRowNo(payload: SteelJsonObject): number | undefined {
  return typeof payload.rowNo === 'number' ? payload.rowNo : undefined;
}

async function replaceActiveMarkdownRows({
  SteelWorkingOrderMemory,
  conversationId,
  requestId,
  messageId,
  turnIndex,
  checkpointTurnIndex,
  memoryKind,
  payloads,
  summaryForPayload,
  locatorPrefix,
  replacementFilter,
}: {
  SteelWorkingOrderMemory: ReturnType<typeof createSteelWorkingOrderMemoryModel>;
  conversationId: string;
  requestId?: string;
  messageId: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  memoryKind: string;
  payloads: SteelJsonObject[];
  summaryForPayload: (payload: SteelJsonObject) => string;
  locatorPrefix: string;
  replacementFilter?: FilterQuery<ISteelWorkingOrderMemory>;
}) {
  if (payloads.length === 0) {
    return;
  }

  await SteelWorkingOrderMemory.deleteMany({
    conversationId,
    memoryKind,
    ...(replacementFilter ?? {}),
  });
  await SteelWorkingOrderMemory.insertMany(
    createMemoryDocuments({
      conversationId,
      requestId,
      messageId,
      turnIndex,
      checkpointTurnIndex,
      memoryKind,
      payloads,
      summaryForPayload,
      locatorPrefix,
    }),
  );
}

function getAssistantOcrReplacementFilter(
  ocrFileKey: string | undefined,
): FilterQuery<ISteelWorkingOrderMemory> {
  return {
    ...(ocrFileKey !== undefined
      ? { 'payload.ocrFileKey': ocrFileKey }
      : { 'payload.ocrFileKey': { $exists: false } }),
    $or: [{ 'payload.ocrSource': 'assistant_ocr' }, { 'payload.ocrSource': { $exists: false } }],
  };
}

function getOfficialOcrReplacementFilter(
  ocrFileKey: string | undefined,
  ocrSource: string | undefined,
  ocrGroupKey: string | undefined,
): FilterQuery<ISteelWorkingOrderMemory> {
  const sourceConditions =
    ocrSource === 'paddleocr_official_markdown'
      ? [
          { 'payload.kind': 'ocr_official_markdown' },
          { 'payload.ocrSource': 'assistant_ocr' },
          { 'payload.ocrSource': { $exists: false } },
        ]
      : [
          { 'payload.ocrSource': 'ai_official_markdown' },
          { 'payload.ocrSource': 'assistant_ocr' },
          { 'payload.ocrSource': { $exists: false } },
        ];
  const keyConditions = ocrGroupKey
    ? [
        { 'payload.ocrGroupKey': ocrGroupKey },
        ...(ocrGroupKey === 'files:default'
          ? [
              {
                'payload.ocrGroupKey': { $exists: false },
                $or: [
                  { 'payload.ocrFileKey': defaultWorkbookFileKey },
                  { 'payload.ocrFileKey': { $exists: false } },
                ],
              },
            ]
          : []),
      ]
    : ocrFileKey === defaultWorkbookFileKey
      ? [
          { 'payload.ocrFileKey': defaultWorkbookFileKey },
          { 'payload.ocrFileKey': { $exists: false } },
        ]
      : ocrFileKey !== undefined
        ? [{ 'payload.ocrFileKey': ocrFileKey }]
        : [{ 'payload.ocrFileKey': { $exists: false } }];

  return {
    $and: [{ $or: keyConditions }, { $or: sourceConditions }],
  };
}

function getOcrFileKeyReplacementFilter(
  ocrFileKey: string | undefined,
): FilterQuery<ISteelWorkingOrderMemory> {
  if (ocrFileKey === defaultWorkbookFileKey) {
    return {
      $or: [
        { 'payload.ocrFileKey': defaultWorkbookFileKey },
        { 'payload.ocrFileKey': { $exists: false } },
      ],
    };
  }

  return ocrFileKey !== undefined
    ? { 'payload.ocrFileKey': ocrFileKey }
    : { 'payload.ocrFileKey': { $exists: false } };
}

function groupPayloadsByOcrFileKey(
  payloads: readonly SteelJsonObject[],
): Map<string, SteelJsonObject[]> {
  const groups = new Map<string, SteelJsonObject[]>();

  for (const payload of payloads) {
    const key = getStringProperty(payload, 'ocrFileKey') ?? '';
    const group = groups.get(key);
    if (group) {
      group.push(payload);
      continue;
    }
    groups.set(key, [payload]);
  }

  return groups;
}

function attachWorkbookFileMetadata(
  payload: SteelJsonObject,
  descriptors: readonly SteelOcrFileDescriptor[],
): SteelJsonObject {
  const descriptor = descriptors.length === 1 ? descriptors[0] : undefined;
  return descriptor === undefined
    ? {
        ...payload,
        ocrFileKey: defaultWorkbookFileKey,
      }
    : {
        ...payload,
        ...toOcrFileMetadataPayload(descriptor),
      };
}

function hasSimpleSequentialItemNumbers(payloads: readonly SteelJsonObject[]): boolean {
  return (
    payloads.length > 0 && payloads.every((payload, index) => getParsedRowNo(payload) === index + 1)
  );
}

function canonicalizeSystemOrderItemNumbers(
  payloads: readonly SteelJsonObject[],
): SteelJsonObject[] {
  if (!hasSimpleSequentialItemNumbers(payloads)) {
    return [...payloads];
  }

  return payloads.map((payload, index) => {
    const rowNo = (index + 1) * 10;

    return {
      ...payload,
      項次: String(rowNo),
      rowNo,
    };
  });
}

function toOutputSheetRow(
  document: SteelWorkingOrderMemoryDocument,
  index: number,
): SteelRuntimeOutputSheetRow | undefined {
  if (!isJsonObject(document.payload)) {
    return undefined;
  }

  return {
    rowId: `${document.memoryKind}:${String(document._id ?? index + 1)}`,
    cells: document.payload,
  };
}

function createOutputSheet(
  sheetId: SteelRuntimeOutputSheet['sheetId'],
  rows: SteelRuntimeOutputSheetRow[],
): SteelRuntimeOutputSheet {
  return {
    sheetId,
    rows,
  };
}

function isManualReviewPayload(payload: SteelJsonObject): boolean {
  return (
    getStringProperty(payload, 'reviewStatus') === 'manual_review' ||
    getStringProperty(payload, 'classification') === 'manual_review' ||
    getStringProperty(payload, 'classification') === 'unclassified_markdown_table' ||
    getStringProperty(payload, 'reason') !== undefined ||
    getStringProperty(payload, 'unresolvedReason') !== undefined
  );
}

function getEmptyDerivedIndex(): SteelOutputSheetMemorySnapshot['derivedIndex'] {
  return {
    lineItems: [],
    customers: [],
    adoptedPrices: [],
    calculations: [],
    ocrExtracts: [],
    unresolvedItems: [],
  };
}

function createEmptyOutputSheets(): FullActiveSteelOutputSheets {
  return {
    system_order: createOutputSheet('system_order', []),
    customer_data: createOutputSheet('customer_data', []),
    manual_review: createOutputSheet('manual_review', []),
    customer_quote: createOutputSheet('customer_quote', []),
  };
}

function toOutputSheetMemorySnapshot(
  documents: SteelWorkingOrderMemoryDocument[],
): SteelOutputSheetMemorySnapshot {
  const previousOutputSheets = createEmptyOutputSheets();
  const derivedIndex = getEmptyDerivedIndex();

  documents.forEach((document, index) => {
    const row = toOutputSheetRow(document, index);
    if (!row || !isJsonObject(document.payload)) {
      return;
    }

    switch (document.memoryKind) {
      case 'working_order_row':
        previousOutputSheets.system_order.rows.push(row);
        derivedIndex.lineItems.push(document.payload);
        return;
      case 'customer_fact':
        previousOutputSheets.customer_data.rows.push(row);
        derivedIndex.customers.push(document.payload);
        return;
      case 'price_evidence':
        derivedIndex.adoptedPrices.push(document.payload);
        return;
      case 'calculation_fact':
        derivedIndex.calculations.push(document.payload);
        if (isManualReviewPayload(document.payload)) {
          previousOutputSheets.manual_review.rows.push(row);
          derivedIndex.unresolvedItems.push(document.payload);
          return;
        }
        previousOutputSheets.customer_quote.rows.push(row);
        return;
      case 'ocr_extract':
        if (isOfficialOcrMarkdownPayload(document.payload)) {
          derivedIndex.ocrExtracts.push(document.payload);
        }
        return;
      default:
        return;
    }
  });

  return {
    previousOutputSheets,
    derivedIndex,
  };
}

function toPaddleOcrEvidencePayload(payload: SteelJsonObject): SteelJsonObject {
  const text = getPaddleOcrResultText(payload.result);
  return {
    ...payload,
    kind: 'paddleocr_mcp_result',
    ocrSource: 'paddleocr_mcp',
    ocrEngine: 'paddleocr_vl',
    ...(text !== undefined ? { content: text } : {}),
  };
}

function getOcrPreprocessingMetadata(payload: SteelJsonObject): SteelJsonObject | undefined {
  return getObjectProperty(payload, 'ocrPreprocessing');
}

function isOcrPreprocessingKind(payload: SteelJsonObject, kind: string): boolean {
  return getStringProperty(payload, 'kind') === kind;
}

function getRequiredChunkNumber(
  metadata: SteelJsonObject,
  key: 'chunkIndex' | 'chunkCount' | 'pageStart' | 'pageEnd' | 'chunkSizePages',
): number | undefined {
  const value = getNumberProperty(metadata, key);
  return value !== undefined && value > 0 ? value : undefined;
}

function toPartialOcrPreprocessingChunkState(
  document: SteelWorkingOrderMemoryDocument,
): OcrPreprocessingChunkState | undefined {
  if (!isJsonObject(document.payload)) {
    return undefined;
  }
  const metadata = getOcrPreprocessingMetadata(document.payload);
  if (!metadata) {
    return undefined;
  }
  const chunkIndex = getRequiredChunkNumber(metadata, 'chunkIndex');
  const chunkCount = getRequiredChunkNumber(metadata, 'chunkCount');
  const pageStart = getRequiredChunkNumber(metadata, 'pageStart');
  const pageEnd = getRequiredChunkNumber(metadata, 'pageEnd');
  const chunkSizePages = getRequiredChunkNumber(metadata, 'chunkSizePages');
  if (
    chunkIndex === undefined ||
    chunkCount === undefined ||
    pageStart === undefined ||
    pageEnd === undefined ||
    chunkSizePages === undefined
  ) {
    return undefined;
  }

  return {
    chunkIndex,
    chunkCount,
    pageStart,
    pageEnd,
    chunkSizePages,
    rawSaved: false,
    organizedSaved: false,
    ...(getStringProperty(metadata, 'rawResultHash') !== undefined
      ? { rawResultHash: getStringProperty(metadata, 'rawResultHash') }
      : {}),
    ...(getStringProperty(metadata, 'ocrRuleVersion') !== undefined
      ? { ocrRuleVersion: getStringProperty(metadata, 'ocrRuleVersion') }
      : {}),
  };
}

function toOcrPreprocessingState({
  input,
  documents,
}: {
  input: Required<OcrPreprocessingStateInput>;
  documents: SteelWorkingOrderMemoryDocument[];
}): OcrPreprocessingState {
  const chunksByIndex = new Map<number, OcrPreprocessingChunkState>();

  for (const document of documents) {
    if (!isJsonObject(document.payload)) {
      continue;
    }
    const metadata = getOcrPreprocessingMetadata(document.payload);
    if (!metadata) {
      continue;
    }
    const isCurrentRule = getStringProperty(metadata, 'ocrRuleVersion') === input.ocrRuleVersion;

    const nextChunk = toPartialOcrPreprocessingChunkState(document);
    if (!nextChunk) {
      continue;
    }
    const currentChunk = chunksByIndex.get(nextChunk.chunkIndex) ?? nextChunk;

    if (
      document.memoryKind === 'paddleocr_preflight' &&
      isOcrPreprocessingKind(document.payload, 'paddleocr_mcp_chunk_result')
    ) {
      chunksByIndex.set(nextChunk.chunkIndex, {
        ...nextChunk,
        ...currentChunk,
        rawResultHash: nextChunk.rawResultHash ?? currentChunk.rawResultHash,
        rawOcrText: getPaddleOcrResultText(document.payload.result) ?? currentChunk.rawOcrText,
        rawSaved: true,
      });
      continue;
    }

    if (
      document.memoryKind === 'ocr_extract' &&
      isCurrentRule &&
      isOcrPreprocessingKind(document.payload, 'ocr_preprocessing_chunk_markdown')
    ) {
      chunksByIndex.set(nextChunk.chunkIndex, {
        ...nextChunk,
        ...currentChunk,
        rawResultHash: nextChunk.rawResultHash ?? currentChunk.rawResultHash,
        ocrRuleVersion: nextChunk.ocrRuleVersion ?? currentChunk.ocrRuleVersion,
        organizedSaved: true,
        organizedMarkdown: getStringProperty(document.payload, 'content') ?? '',
      });
    }
  }

  const chunks = [...chunksByIndex.values()].sort(
    (left, right) => left.chunkIndex - right.chunkIndex,
  );
  const firstChunk = chunks[0];

  return {
    ocrFileKey: input.ocrFileKey,
    sourcePdfKey: input.sourcePdfKey,
    pipelineVersion: input.pipelineVersion,
    ocrRuleVersion: input.ocrRuleVersion,
    chunkSizePages: firstChunk?.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages(),
    chunkCount: firstChunk?.chunkCount ?? 0,
    chunks,
  };
}

function getPaddleOcrSummary(payload: SteelJsonObject): string {
  const filename = getStringProperty(payload, 'filename');
  const result = isJsonObject(payload.result) ? payload.result : undefined;
  const text =
    (result ? getStringProperty(result, 'text') : undefined) ??
    (result ? getStringProperty(result, 'markdown') : undefined) ??
    getFactSummary(payload);

  return ['PaddleOCR', filename, text?.replace(/\s+/gu, ' ')]
    .filter((entry): entry is string => entry !== undefined && entry.trim() !== '')
    .join(' ');
}

function createPaddleOcrPayload({
  file,
  data,
}: Pick<CapturePaddleOcrResultInput, 'file' | 'data'>): SteelJsonObject | undefined {
  const descriptor = getSteelOcrFileDescriptor(file);
  if (!descriptor) {
    return undefined;
  }

  return {
    kind: 'paddleocr_mcp_result',
    ocrSource: 'paddleocr_mcp',
    ocrEngine: 'paddleocr_vl',
    ...toOcrFileMetadataPayload(descriptor),
    result: toJsonValue(data),
  };
}

function toOcrPreprocessingPdfChunkPayload(
  pdfChunk: OcrPreprocessingPdfChunkReference,
): SteelJsonObject {
  return {
    source: pdfChunk.source,
    storageKey: pdfChunk.storageKey,
    ...(pdfChunk.storageRegion !== undefined ? { storageRegion: pdfChunk.storageRegion } : {}),
    filepath: pdfChunk.filepath,
  };
}

function createPaddleOcrChunkPayload({
  file,
  chunk,
  rawResultHash,
  data,
}: Pick<CapturePaddleOcrChunkResultInput, 'file' | 'chunk' | 'rawResultHash' | 'data'>):
  | SteelJsonObject
  | undefined {
  const descriptor = getSteelOcrFileDescriptor(file);
  if (!descriptor || chunk.pdfChunk === undefined) {
    return undefined;
  }

  return {
    kind: 'paddleocr_mcp_chunk_result',
    ocrSource: 'paddleocr_mcp',
    ocrEngine: 'paddleocr_vl',
    ...toOcrFileMetadataPayload(descriptor),
    ocrPreprocessing: {
      pipelineVersion: chunk.pipelineVersion ?? ocrPreprocessingPipelineVersion,
      sourcePdfKey: chunk.sourcePdfKey,
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      chunkSizePages: chunk.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages(),
      pdfChunk: toOcrPreprocessingPdfChunkPayload(chunk.pdfChunk),
      rawResultHash,
    },
    result: toJsonValue(data),
  };
}

function createOcrPreprocessingChunkMarkdownPayload({
  file,
  chunk,
  rawResultHash,
  ocrRuleVersion,
  content,
}: Pick<
  CaptureOcrPreprocessingChunkMarkdownInput,
  'file' | 'chunk' | 'rawResultHash' | 'ocrRuleVersion' | 'content'
>): SteelJsonObject | undefined {
  const descriptor = getSteelOcrFileDescriptor(file);
  if (!descriptor) {
    return undefined;
  }

  return {
    kind: 'ocr_preprocessing_chunk_markdown',
    ocrSource: 'ocr_preprocessing_subagent',
    ...toOcrFileMetadataPayload(descriptor),
    content,
    ocrPreprocessing: {
      pipelineVersion: chunk.pipelineVersion ?? ocrPreprocessingPipelineVersion,
      sourcePdfKey: chunk.sourcePdfKey,
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      chunkSizePages: chunk.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages(),
      rawResultHash,
      ocrRuleVersion,
      organizerVersion: ocrPreprocessingOrganizerVersion,
    },
  };
}

function createOfficialOcrMarkdownPayload({
  file,
  sourcePdfKey,
  ocrRuleVersion,
  pipelineVersion,
  content,
  chunkCount,
}: Pick<
  CaptureOfficialOcrMarkdownInput,
  'file' | 'sourcePdfKey' | 'ocrRuleVersion' | 'pipelineVersion' | 'content' | 'chunkCount'
>): SteelJsonObject | undefined {
  const descriptor = getSteelOcrFileDescriptor(file);
  if (!descriptor) {
    return undefined;
  }

  return {
    kind: 'ocr_official_markdown',
    ocrSource: 'paddleocr_official_markdown',
    ocrEngine: 'paddleocr_vl',
    ...toOcrFileMetadataPayload(descriptor),
    ocrGroupKey: getOcrGroupKeyForDescriptors([descriptor]),
    content,
    ocrPreprocessing: {
      pipelineVersion: pipelineVersion ?? ocrPreprocessingPipelineVersion,
      sourcePdfKey,
      chunkCount,
      ocrRuleVersion,
      organizerVersion: ocrPreprocessingOrganizerVersion,
      official: true,
      source: 'paddleocr_markdowns',
    },
  };
}

function isOfficialOcrMarkdownPayload(payload: SteelJsonObject): boolean {
  const source = getStringProperty(payload, 'ocrSource');
  const title = getStringProperty(payload, 'title');
  return (
    getStringProperty(payload, 'kind') === 'ocr_official_markdown' &&
    (source === 'paddleocr_official_markdown' || source === 'ai_official_markdown') &&
    (title === undefined || isOfficialOcrMarkdownTitle(title))
  );
}

function officialOcrMarkdownTitleQuery(): FilterQuery<ISteelWorkingOrderMemory> {
  return {
    $or: [
      { 'payload.title': { $exists: false } },
      { 'payload.title': officialOcrMarkdownTitlePattern },
    ],
  };
}

function createPaddleOcrSourceRef({
  providerToolCallId,
  payload,
}: {
  providerToolCallId?: string;
  payload: SteelJsonObject;
}): MemorySourceRef[] {
  const descriptor = getOcrDescriptorFromPayload(payload);

  return [
    {
      sourceKind: 'paddleocr_mcp',
      sourceId: providerToolCallId,
      ...(descriptor !== undefined ? toOcrFileMetadataPayload(descriptor) : {}),
    },
  ];
}

export function createMongooseSteelWorkingOrderMemoryReader(
  mongoose: Mongoose,
  conversationId: string,
): SteelWorkingOrderMemoryReader {
  const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);

  return {
    async readWorkingOrderItems(input) {
      const filter: FilterQuery<ISteelWorkingOrderMemory> = {
        conversationId,
        state: 'active',
        ...getModeFilter(input),
      };
      const pageSize = getPageSize(input);
      const page = getPage(input);
      const [resultCount, documents] = await Promise.all([
        SteelWorkingOrderMemory.countDocuments(filter),
        SteelWorkingOrderMemory.find(filter)
          .sort({ turnIndex: 1, createdAt: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean<SteelWorkingOrderMemoryDocument[]>(),
      ]);
      const workingOrderRows = documents
        .map(toWorkingOrderRow)
        .filter((row): row is SteelJsonObject => row !== undefined);

      return {
        mode: input.mode,
        page,
        pageSize,
        resultCount,
        summary: input.mode === 'summary' ? summarizeByKind(documents) : undefined,
        workingOrderRows,
        memoryEntries:
          input.mode === 'summary' || input.mode === 'source'
            ? documents.map(toMemoryEntry)
            : undefined,
      };
    },
  };
}

export function createMongooseSteelOutputSheetMemoryReader(
  mongoose: Mongoose,
  conversationId: string,
): SteelOutputSheetMemoryReader {
  const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);

  return {
    async readOutputSheetMemory() {
      const documents = await SteelWorkingOrderMemory.find({
        conversationId,
        state: 'active',
        memoryKind: {
          $in: [
            'working_order_row',
            'customer_fact',
            'price_evidence',
            'calculation_fact',
            'ocr_extract',
            'paddleocr_preflight',
          ],
        },
      })
        .sort({ turnIndex: 1, createdAt: 1 })
        .lean<SteelWorkingOrderMemoryDocument[]>();

      return toOutputSheetMemorySnapshot(documents);
    },
  };
}

export function createMongooseSteelWorkingOrderMemoryWriter(mongoose: Mongoose) {
  const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);

  return {
    async captureToolResult(input: CaptureToolResultInput): Promise<CaptureToolResultResult> {
      const documents = getToolCaptureDocuments(input);
      if (documents.length === 0) {
        return { savedCounts: {} };
      }

      await SteelWorkingOrderMemory.insertMany(documents);
      const totals = await readActiveMemoryTotals({
        SteelWorkingOrderMemory,
        conversationId: input.conversationId,
      });
      return {
        savedCounts: summarizeByKind(documents),
        ...totals,
      };
    },

    async findMissingPaddleOcrFileKeys({
      conversationId,
      files,
    }: FindMissingPaddleOcrFileKeysInput): Promise<FindMissingPaddleOcrFileKeysResult> {
      const descriptors = getUniqueOcrFileDescriptors(files);
      const keys = descriptors.map((descriptor) => descriptor.ocrFileKey);
      if (keys.length === 0) {
        return {
          completedKeys: [],
          missingFiles: [],
          missingKeys: [],
        };
      }

      const documents = await SteelWorkingOrderMemory.find({
        conversationId,
        state: 'active',
        memoryKind: 'paddleocr_preflight',
        sourceKind: 'ocr_result',
        'payload.ocrFileKey': { $in: keys },
        'payload.ocrSource': 'paddleocr_mcp',
      }).lean<SteelWorkingOrderMemoryDocument[]>();
      const completedSet = new Set(
        documents
          .map((document) =>
            isJsonObject(document.payload)
              ? getStringProperty(document.payload, 'ocrFileKey')
              : undefined,
          )
          .filter((key): key is string => key !== undefined),
      );
      const missingFiles = descriptors.filter(
        (descriptor) => !completedSet.has(descriptor.ocrFileKey),
      );

      return {
        completedKeys: keys.filter((key) => completedSet.has(key)),
        missingFiles,
        missingKeys: missingFiles.map((descriptor) => descriptor.ocrFileKey),
      };
    },

    async readOcrPreprocessingState(
      input: OcrPreprocessingStateInput,
    ): Promise<OcrPreprocessingState> {
      const pipelineVersion = input.pipelineVersion ?? ocrPreprocessingPipelineVersion;
      const documents = await SteelWorkingOrderMemory.find({
        conversationId: input.conversationId,
        state: 'active',
        memoryKind: { $in: ['paddleocr_preflight', 'ocr_extract'] },
        'payload.ocrFileKey': input.ocrFileKey,
        'payload.ocrPreprocessing.sourcePdfKey': input.sourcePdfKey,
        'payload.ocrPreprocessing.pipelineVersion': pipelineVersion,
      })
        .sort({ 'payload.ocrPreprocessing.chunkIndex': 1, turnIndex: 1, createdAt: 1 })
        .lean<SteelWorkingOrderMemoryDocument[]>();

      return toOcrPreprocessingState({
        input: {
          ...input,
          pipelineVersion,
        },
        documents,
      });
    },

    async readOfficialOcrMarkdown(
      input: OfficialOcrMarkdownInput,
    ): Promise<OfficialOcrMarkdownResult | undefined> {
      const pipelineVersion = input.pipelineVersion ?? ocrPreprocessingPipelineVersion;
      const document = await SteelWorkingOrderMemory.findOne({
        conversationId: input.conversationId,
        state: 'active',
        memoryKind: 'ocr_extract',
        'payload.kind': 'ocr_official_markdown',
        'payload.ocrSource': 'paddleocr_official_markdown',
        $and: [
          officialOcrMarkdownTitleQuery(),
          {
            $or: [
              { 'payload.ocrFileKey': input.ocrFileKey },
              { 'payload.ocrFileKeys': input.ocrFileKey },
            ],
          },
          {
            $or: [
              { 'payload.ocrPreprocessing.sourcePdfKey': input.sourcePdfKey },
              { 'payload.ocrPreprocessing.sourcePdfKey': { $exists: false } },
            ],
          },
          {
            $or: [
              { 'payload.ocrPreprocessing.ocrRuleVersion': input.ocrRuleVersion },
              { 'payload.ocrPreprocessing.ocrRuleVersion': { $exists: false } },
            ],
          },
          {
            $or: [
              { 'payload.ocrPreprocessing.pipelineVersion': pipelineVersion },
              { 'payload.ocrPreprocessing.pipelineVersion': { $exists: false } },
            ],
          },
        ],
      })
        .sort({ turnIndex: -1, createdAt: -1 })
        .lean<SteelWorkingOrderMemoryDocument>();
      const payload = isJsonObject(document?.payload) ? document.payload : undefined;
      const markdown = payload
        ? (getStringProperty(payload, 'markdown') ?? getStringProperty(payload, 'content'))
        : undefined;
      const metadata = payload ? getOcrPreprocessingMetadata(payload) : undefined;
      const chunkCount = metadata ? getNumberProperty(metadata, 'chunkCount') : undefined;
      if (markdown === undefined) {
        return undefined;
      }

      return {
        markdown,
        chunkCount: chunkCount && chunkCount > 0 ? chunkCount : 1,
      };
    },

    async capturePaddleOcrResult(
      input: CapturePaddleOcrResultInput,
    ): Promise<CaptureToolResultResult> {
      const payload = createPaddleOcrPayload(input);
      if (!payload) {
        return { savedCounts: {} };
      }

      await SteelWorkingOrderMemory.deleteMany({
        conversationId: input.conversationId,
        memoryKind: 'paddleocr_preflight',
        'payload.ocrFileKey': getStringProperty(payload, 'ocrFileKey'),
      });
      await SteelWorkingOrderMemory.create(
        createToolMemoryDocument({
          conversationId: input.conversationId,
          requestId: input.requestId,
          providerToolCallId: input.providerToolCallId,
          turnIndex: input.turnIndex,
          checkpointTurnIndex: input.checkpointTurnIndex,
          memoryKind: 'paddleocr_preflight',
          sourceKind: 'ocr_result',
          payload,
          summary: getPaddleOcrSummary(payload),
          sourceRefs: createPaddleOcrSourceRef({
            providerToolCallId: input.providerToolCallId,
            payload,
          }),
        }),
      );

      const totals = await readActiveMemoryTotals({
        SteelWorkingOrderMemory,
        conversationId: input.conversationId,
      });

      return {
        savedCounts: { paddleocr_preflight: 1 },
        ...totals,
      };
    },

    async capturePaddleOcrChunkResult(
      input: CapturePaddleOcrChunkResultInput,
    ): Promise<CaptureToolResultResult> {
      const payload = createPaddleOcrChunkPayload(input);
      if (!payload) {
        return { savedCounts: {} };
      }
      const pipelineVersion = input.chunk.pipelineVersion ?? ocrPreprocessingPipelineVersion;
      const chunkSizePages = input.chunk.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages();

      await SteelWorkingOrderMemory.deleteMany({
        conversationId: input.conversationId,
        memoryKind: 'paddleocr_preflight',
        'payload.ocrFileKey': getStringProperty(payload, 'ocrFileKey'),
        'payload.ocrPreprocessing.sourcePdfKey': input.chunk.sourcePdfKey,
        'payload.ocrPreprocessing.pipelineVersion': pipelineVersion,
        'payload.ocrPreprocessing.chunkIndex': input.chunk.chunkIndex,
        'payload.ocrPreprocessing.pageStart': input.chunk.pageStart,
        'payload.ocrPreprocessing.pageEnd': input.chunk.pageEnd,
      });
      await SteelWorkingOrderMemory.create(
        createToolMemoryDocument({
          conversationId: input.conversationId,
          requestId: input.requestId,
          providerToolCallId: input.providerToolCallId,
          turnIndex: input.turnIndex,
          checkpointTurnIndex: input.checkpointTurnIndex,
          memoryKind: 'paddleocr_preflight',
          sourceKind: 'ocr_result',
          payload: {
            ...payload,
            ocrPreprocessing: {
              ...getOcrPreprocessingMetadata(payload),
              chunkSizePages,
            },
          },
          summary: getPaddleOcrSummary(payload),
          sourceRefs: createPaddleOcrSourceRef({
            providerToolCallId: input.providerToolCallId,
            payload,
          }),
        }),
      );

      const totals =
        input.includeTotals === false
          ? undefined
          : await readActiveMemoryTotals({
              SteelWorkingOrderMemory,
              conversationId: input.conversationId,
            });

      return {
        savedCounts: { paddleocr_preflight: 1 },
        ...(totals ?? {}),
      };
    },

    async captureOcrPreprocessingChunkMarkdown(
      input: CaptureOcrPreprocessingChunkMarkdownInput,
    ): Promise<CaptureToolResultResult> {
      const payload = createOcrPreprocessingChunkMarkdownPayload(input);
      if (!payload) {
        return { savedCounts: {} };
      }
      const pipelineVersion = input.chunk.pipelineVersion ?? ocrPreprocessingPipelineVersion;

      await SteelWorkingOrderMemory.deleteMany({
        conversationId: input.conversationId,
        memoryKind: 'ocr_extract',
        'payload.kind': 'ocr_preprocessing_chunk_markdown',
        'payload.ocrFileKey': getStringProperty(payload, 'ocrFileKey'),
        'payload.ocrPreprocessing.sourcePdfKey': input.chunk.sourcePdfKey,
        'payload.ocrPreprocessing.pipelineVersion': pipelineVersion,
        'payload.ocrPreprocessing.ocrRuleVersion': input.ocrRuleVersion,
        'payload.ocrPreprocessing.chunkIndex': input.chunk.chunkIndex,
        'payload.ocrPreprocessing.pageStart': input.chunk.pageStart,
        'payload.ocrPreprocessing.pageEnd': input.chunk.pageEnd,
      });
      await SteelWorkingOrderMemory.create(
        createToolMemoryDocument({
          conversationId: input.conversationId,
          requestId: input.requestId,
          turnIndex: input.turnIndex,
          checkpointTurnIndex: input.checkpointTurnIndex,
          memoryKind: 'ocr_extract',
          sourceKind: 'ocr_result',
          payload,
          summary: getFactSummary(payload),
          sourceRefs: createPaddleOcrSourceRef({
            payload,
          }),
        }),
      );

      const totals =
        input.includeTotals === false
          ? undefined
          : await readActiveMemoryTotals({
              SteelWorkingOrderMemory,
              conversationId: input.conversationId,
            });

      return {
        savedCounts: { ocr_preprocessing_chunk_markdown: 1 },
        ...(totals ?? {}),
      };
    },

    async captureOfficialOcrMarkdown(
      input: CaptureOfficialOcrMarkdownInput,
    ): Promise<CaptureToolResultResult> {
      const payload = createOfficialOcrMarkdownPayload(input);
      if (!payload) {
        return { savedCounts: {} };
      }
      const pipelineVersion = input.pipelineVersion ?? ocrPreprocessingPipelineVersion;

      await SteelWorkingOrderMemory.deleteMany({
        conversationId: input.conversationId,
        memoryKind: 'ocr_extract',
        'payload.kind': 'ocr_official_markdown',
        'payload.ocrSource': 'paddleocr_official_markdown',
        'payload.ocrFileKey': getStringProperty(payload, 'ocrFileKey'),
        'payload.ocrPreprocessing.sourcePdfKey': input.sourcePdfKey,
        'payload.ocrPreprocessing.pipelineVersion': pipelineVersion,
        'payload.ocrPreprocessing.ocrRuleVersion': input.ocrRuleVersion,
      });
      await SteelWorkingOrderMemory.create(
        createToolMemoryDocument({
          conversationId: input.conversationId,
          requestId: input.requestId,
          turnIndex: input.turnIndex,
          checkpointTurnIndex: input.checkpointTurnIndex,
          memoryKind: 'ocr_extract',
          sourceKind: 'ocr_result',
          payload,
          summary: getOcrMarkdownSummary(payload),
          sourceRefs: createPaddleOcrSourceRef({
            payload,
          }),
        }),
      );

      const totals = await readActiveMemoryTotals({
        SteelWorkingOrderMemory,
        conversationId: input.conversationId,
      });

      return {
        savedCounts: { ocr_markdown: 1 },
        ...totals,
      };
    },

    async captureAssistantFinalMarkdown({
      conversationId,
      requestId,
      messageId,
      turnIndex,
      checkpointTurnIndex,
      content,
      currentTurnFiles,
      currentOcrMarkdownResults,
    }: CaptureAssistantFinalMarkdownInput): Promise<CaptureAssistantFinalMarkdownResult> {
      const tables = getParsedTables(content);
      const hasPaddleOcrFinalMarkdown = (currentOcrMarkdownResults?.length ?? 0) > 0;
      const savedCounts: { [key: string]: number } = {};
      const savedTableCounts: { [key: string]: number } = {};
      const ocrPayloadEntries = tables
        .map((table, index) => {
          if (!isOfficialOcrMarkdownTitle(table.title)) {
            return undefined;
          }

          const officialDescriptors = getOfficialOcrDescriptorsForTable({
            title: table.title,
            currentOcrMarkdownResults,
            currentTurnFiles,
          });

          const payload = toOcrMarkdownPayload(
            table.headers,
            table.rows,
            index + 1,
            table.title,
            officialDescriptors,
            {
              official: true,
              officialMetadata: getOfficialOcrMetadataForDescriptor({
                descriptor: officialDescriptors.length === 1 ? officialDescriptors[0] : undefined,
                currentOcrMarkdownResults,
                paddleOcrSource: hasPaddleOcrFinalMarkdown,
              }),
            },
          );

          return { payload, official: true };
        })
        .filter(
          (entry): entry is { payload: SteelJsonObject; official: boolean } => entry !== undefined,
        );

      const assistantOcrPayloads = ocrPayloadEntries
        .filter((entry) => !entry.official)
        .map((entry) => entry.payload);
      if (assistantOcrPayloads.length > 0) {
        const groupedOcrPayloads = groupPayloadsByOcrFileKey(assistantOcrPayloads);
        for (const [key, payloads] of groupedOcrPayloads) {
          await replaceActiveMarkdownRows({
            SteelWorkingOrderMemory,
            conversationId,
            requestId,
            messageId,
            turnIndex,
            checkpointTurnIndex,
            memoryKind: 'ocr_extract',
            payloads,
            summaryForPayload: getOcrMarkdownSummary,
            locatorPrefix: 'table:ocr_extract',
            replacementFilter: getAssistantOcrReplacementFilter(key === '' ? undefined : key),
          });
        }
        incrementSavedCount(savedCounts, 'ocr_extract', assistantOcrPayloads.length);
        incrementSavedCount(savedTableCounts, 'ocr_table', assistantOcrPayloads.length);
      }

      const officialOcrPayloads = ocrPayloadEntries
        .filter((entry) => entry.official)
        .map((entry) => entry.payload);
      if (officialOcrPayloads.length > 0) {
        await SteelWorkingOrderMemory.deleteMany({
          conversationId,
          state: 'active',
          memoryKind: 'ocr_extract',
          'payload.kind': 'ocr_official_markdown',
          'payload.title': { $exists: true, $not: officialOcrMarkdownTitlePattern },
        });
        const groupedOcrPayloads = groupPayloadsByOcrFileKey(officialOcrPayloads);
        for (const [key, payloads] of groupedOcrPayloads) {
          await replaceActiveMarkdownRows({
            SteelWorkingOrderMemory,
            conversationId,
            requestId,
            messageId,
            turnIndex,
            checkpointTurnIndex,
            memoryKind: 'ocr_extract',
            payloads,
            summaryForPayload: getOcrMarkdownSummary,
            locatorPrefix: 'table:ocr_markdown',
            replacementFilter: getOfficialOcrReplacementFilter(
              key === '' ? undefined : key,
              getStringProperty(payloads[0], 'ocrSource'),
              getStringProperty(payloads[0], 'ocrGroupKey'),
            ),
          });
        }
        incrementSavedCount(savedCounts, 'ocr_markdown', officialOcrPayloads.length);
      }

      const systemOrderRows: SteelJsonObject[] = [];
      for (const table of tables) {
        const payloads = toPayloads(table.headers, table.rows);
        const tableTitleType = getTableTitleType(table.title);

        if (tableTitleType === 'ocr') {
          continue;
        }

        if (tableTitleType === 'workbook' && isWorkingOrderTable(table.headers)) {
          const descriptors = getOcrDescriptorsForTable({
            title: table.title,
            rows: table.rows,
            currentTurnFiles,
          });
          const rows = canonicalizeSystemOrderItemNumbers(
            payloads
              .filter((payload) => getParsedRowNo(payload) !== undefined)
              .map((payload) => attachWorkbookFileMetadata(payload, descriptors)),
          );
          if (rows.length === 0) {
            continue;
          }

          systemOrderRows.push(...rows);
          continue;
        }
      }

      const systemOrderGroups = groupPayloadsByOcrFileKey(systemOrderRows);
      for (const [key, rows] of systemOrderGroups) {
        await replaceActiveMarkdownRows({
          SteelWorkingOrderMemory,
          conversationId,
          requestId,
          messageId,
          turnIndex,
          checkpointTurnIndex,
          memoryKind: 'working_order_row',
          payloads: rows,
          summaryForPayload: getRowSummary,
          locatorPrefix: 'table:system_order',
          replacementFilter: getOcrFileKeyReplacementFilter(key === '' ? undefined : key),
        });
        incrementSavedCount(savedCounts, 'working_order_row', rows.length);
      }
      incrementSavedCount(savedTableCounts, 'system_order_table', systemOrderGroups.size);

      if (Object.keys(savedCounts).length === 0) {
        return {
          parseStatus: 'skipped',
          savedCounts,
        };
      }

      const totals = await readActiveMemoryTotals({
        SteelWorkingOrderMemory,
        conversationId,
      });

      return {
        parseStatus: 'saved',
        savedCounts,
        ...(Object.keys(savedTableCounts).length > 0 ? { savedTableCounts } : {}),
        ...totals,
      };
    },
  };
}
