import {
  createSteelWorkingOrderMemoryModel,
  type ISteelWorkingOrderMemory,
} from '@librechat/data-schemas';
import { parseMarkdownTables } from '../markdown/table';

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

export interface CaptureAssistantFinalMarkdownInput {
  conversationId: string;
  requestId?: string;
  messageId: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  content: string;
  currentTurnFiles?: readonly SteelOcrFileReference[];
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
  return input.mode === 'page' ? input.page ?? 1 : 1;
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
    counts[document.memoryKind] = (counts[document.memoryKind] ?? 0) + 1;
  }

  return counts;
}

function summarizeTableCounts(documents: SteelWorkingOrderMemoryDocument[]) {
  const counts: { [key: string]: number } = {};
  const systemOrderGroups = new Set<string>();

  for (const document of documents) {
    if (document.memoryKind === 'ocr_extract') {
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
  }).lean<SteelWorkingOrderMemoryDocument[]>();

  return {
    totalSavedCounts: summarizeByKind(documents),
    totalTableCounts: summarizeTableCounts(documents),
  };
}

function isWorkingOrderTable(headers: readonly string[]): boolean {
  return ['項次', '型號', '品名規格'].every((header) => headers.includes(header));
}

function normalizeHeader(header: string): string {
  return header.replace(/\s+/g, '');
}

function isOcrTable(headers: readonly string[]): boolean {
  const normalizedHeaders = headers.map(normalizeHeader);
  const signalCount = normalizedHeaders.filter((header) =>
    [
      '來源檔案',
      '來源標籤',
      '來源頁',
      '品名/材料名稱',
      '加工內容',
      '孔數',
      '折邊',
      '切角',
      '缺口',
      '開槽',
      '信心程度',
      '是否需人工複核',
    ].some((signal) => header.includes(signal)),
  ).length;

  return signalCount >= 2;
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
  return lookupValue.split('/').filter((part) => part !== '').pop() ?? lookupValue;
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
  const ocrFileKey =
    fileId !== undefined
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
    .slice(0, 4)
    .join(' ');
}

function normalizeTableTitle(line: string): string {
  return line
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^\*\*(.*)\*\*$/u, '$1')
    .trim();
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

function getParsedTables(content: string): TitledSteelMarkdownTable[] {
  const tables: TitledSteelMarkdownTable[] = [];
  let pendingTitle = '';
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
      pendingTitle = normalizeTableTitle(line);
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
): SteelJsonObject {
  const singleDescriptor = descriptors.length === 1 ? descriptors[0] : undefined;

  return {
    kind: 'assistant_ocr_markdown',
    ocrSource: 'assistant_ocr',
    ocrEngine: 'assistant',
    ...(singleDescriptor !== undefined ? toOcrFileMetadataPayload(singleDescriptor) : {}),
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
  };
}

function getOcrMarkdownSummary(payload: SteelJsonObject): string {
  const markdown = getStringProperty(payload, 'markdown') ?? '';
  return ['OCR Markdown', markdown.replace(/\s+/g, ' ').slice(0, 100)]
    .filter((entry) => entry.trim() !== '')
    .join(' ');
}

function incrementSavedCount(savedCounts: { [key: string]: number }, key: string, count: number) {
  if (count <= 0) {
    return;
  }

  savedCounts[key] = (savedCounts[key] ?? 0) + count;
}

function createSourceRef(
  messageId: string,
  locator: string,
  descriptor?: SteelOcrFileDescriptor,
) {
  return [
    {
      sourceKind: 'assistant_final_markdown',
      sourceId: messageId,
      locator,
      ...(descriptor !== undefined ? toOcrFileMetadataPayload(descriptor) : {}),
    },
  ];
}

function toBoundedJsonValue(value: unknown, depth = 0): SteelJsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 6) {
      return [];
    }
    return value.slice(0, 20).map((entry) => toBoundedJsonValue(entry, depth + 1));
  }
  if (typeof value !== 'object' || depth >= 6) {
    return String(value);
  }

  const output: SteelJsonObject = {};
  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    output[key] = toBoundedJsonValue(entry, depth + 1);
  }
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

function getOcrDescriptorFromPayload(
  payload: SteelJsonObject,
): SteelOcrFileDescriptor | undefined {
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
  return sourceRefs
    .filter(isJsonObject)
    .slice(0, 10)
    .map((ref) => ({
      sourceKind: [getStringProperty(ref, 'channel'), getStringProperty(ref, 'factType')]
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
    isJsonObject(payload.customerTier) ? getStringProperty(payload.customerTier, 'code') : undefined,
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

function getToolCaptureDocuments(input: CaptureToolResultInput) {
  const data = toBoundedJsonValue(input.data);
  if (!isJsonObject(data)) {
    return [];
  }

  if (input.toolName === 'search_customers') {
    return getArrayProperty(data, 'customers').filter(isJsonObject).map((customer) =>
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
    return getArrayProperty(data, 'priceCandidates').filter(isJsonObject).map((candidate) =>
      createToolMemoryDocument({
        ...input,
        memoryKind: 'price_evidence',
        sourceKind: 'tool_result',
        payload: {
          ...candidate,
          customerTierId: data.customerTierId,
          searchQueries: data.searchQueries,
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

  await SteelWorkingOrderMemory.deleteMany(
    {
      conversationId,
      memoryKind,
      ...(replacementFilter ?? {}),
    },
  );
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
    $or: [
      { 'payload.ocrSource': 'assistant_ocr' },
      { 'payload.ocrSource': { $exists: false } },
    ],
  };
}

function getOcrFileKeyReplacementFilter(
  ocrFileKey: string | undefined,
): FilterQuery<ISteelWorkingOrderMemory> {
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

function attachSingleOcrFileMetadata(
  payload: SteelJsonObject,
  descriptors: readonly SteelOcrFileDescriptor[],
): SteelJsonObject {
  const descriptor = descriptors.length === 1 ? descriptors[0] : undefined;
  return descriptor === undefined
    ? payload
    : {
        ...payload,
        ...toOcrFileMetadataPayload(descriptor),
      };
}

function hasSimpleSequentialItemNumbers(payloads: readonly SteelJsonObject[]): boolean {
  return payloads.length > 0 && payloads.every((payload, index) => getParsedRowNo(payload) === index + 1);
}

function canonicalizeSystemOrderItemNumbers(payloads: readonly SteelJsonObject[]): SteelJsonObject[] {
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
        derivedIndex.ocrExtracts.push(document.payload);
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

function getPaddleOcrSummary(payload: SteelJsonObject): string {
  const filename = getStringProperty(payload, 'filename');
  const result = isJsonObject(payload.result) ? payload.result : undefined;
  const text =
    (result ? getStringProperty(result, 'text') : undefined) ??
    (result ? getStringProperty(result, 'markdown') : undefined) ??
    getFactSummary(payload);

  return ['PaddleOCR', filename, text?.replace(/\s+/gu, ' ').slice(0, 100)]
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
    result: toBoundedJsonValue(data),
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

    async captureAssistantFinalMarkdown({
      conversationId,
      requestId,
      messageId,
      turnIndex,
      checkpointTurnIndex,
      content,
      currentTurnFiles,
    }: CaptureAssistantFinalMarkdownInput): Promise<CaptureAssistantFinalMarkdownResult> {
      const tables = getParsedTables(content);
      const savedCounts: { [key: string]: number } = {};
      const savedTableCounts: { [key: string]: number } = {};
      const ocrPayloads = tables
        .map((table, index) => {
          if (getTableTitleType(table.title) !== 'ocr' || !isOcrTable(table.headers)) {
            return undefined;
          }

          return toOcrMarkdownPayload(
            table.headers,
            table.rows,
            index + 1,
            table.title,
            getOcrDescriptorsForTable({
              title: table.title,
              rows: table.rows,
              currentTurnFiles,
            }),
          );
        })
        .filter((payload): payload is SteelJsonObject => payload !== undefined);

      if (ocrPayloads.length > 0) {
        const groupedOcrPayloads = groupPayloadsByOcrFileKey(ocrPayloads);
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
        incrementSavedCount(savedCounts, 'ocr_extract', ocrPayloads.length);
        incrementSavedCount(savedTableCounts, 'ocr_table', ocrPayloads.length);
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
              .map((payload) => attachSingleOcrFileMetadata(payload, descriptors)),
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
