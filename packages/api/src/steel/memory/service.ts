import {
  createSteelWorkingOrderMemoryModel,
  type ISteelWorkingOrderMemory,
} from '@librechat/data-schemas';
import { parseMarkdownTables } from '../markdown/table';

import type { FilterQuery } from 'mongoose';
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
}

export interface CaptureAssistantFinalMarkdownResult {
  parseStatus: 'saved' | 'partial' | 'skipped';
  savedCounts: { [key: string]: number };
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
    pageNumber?: number;
    imageIndex?: number;
    locator?: string;
  }[];
}

interface MemorySourceRef {
  sourceKind: string;
  sourceId?: string;
  filename?: string;
  pageNumber?: number;
  imageIndex?: number;
  locator?: string;
}

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

function isWorkingOrderTable(headers: readonly string[]): boolean {
  return ['項次', '型號', '品名規格'].every((header) => headers.includes(header));
}

function isCustomerTable(headers: readonly string[]): boolean {
  return headers.some((header) => ['客戶名稱', '客戶代號', '客戶編號', '計價基準'].includes(header));
}

function isCalculationTable(headers: readonly string[]): boolean {
  return headers.some((header) => ['公式', '小計', '總計', '金額', '項目'].includes(header));
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

function getParsedTables(content: string) {
  return parseMarkdownTables(content);
}

function toPayloads(headers: readonly string[], rows: readonly string[][]): SteelJsonObject[] {
  return rows.map((cells) => toPayload(headers, cells));
}

function incrementSavedCount(savedCounts: { [key: string]: number }, key: string, count: number) {
  if (count <= 0) {
    return;
  }

  savedCounts[key] = (savedCounts[key] ?? 0) + count;
}

function createSourceRef(messageId: string, locator: string) {
  return [
    {
      sourceKind: 'assistant_final_markdown',
      sourceId: messageId,
      locator,
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

  if (input.toolName === 'run_file_ocr') {
    const filename = getStringProperty(data, 'filename');
    return getArrayProperty(data, 'pageResults').filter(isJsonObject).map((page) => {
      const pageNumber = getNumberProperty(page, 'page') ?? getNumberProperty(page, 'pageNumber');
      const payload: SteelJsonObject = { ...page };
      const sourceRef: MemorySourceRef = {
        sourceKind: 'ocr_result',
        sourceId: input.providerToolCallId,
      };
      if (filename !== undefined) {
        payload.filename = filename;
        sourceRef.filename = filename;
      }
      if (pageNumber !== undefined) {
        sourceRef.pageNumber = pageNumber;
      }
      return createToolMemoryDocument({
        ...input,
        memoryKind: 'ocr_extract',
        sourceKind: 'ocr_result',
        payload,
        summary: [filename, pageNumber !== undefined ? `page ${pageNumber}` : undefined, 'OCR']
          .filter((entry): entry is string => entry !== undefined)
          .join(' '),
        sourceRefs: [sourceRef],
      });
    });
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
    sourceRefs: createSourceRef(input.messageId, `${input.locatorPrefix},row:${index + 1}`),
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

function quoteCalculationFilter(): FilterQuery<ISteelWorkingOrderMemory> {
  return {
    $nor: [
      { 'payload.reviewStatus': 'manual_review' },
      { 'payload.classification': { $in: ['manual_review', 'unclassified_markdown_table'] } },
      { 'payload.reason': { $exists: true } },
      { 'payload.unresolvedReason': { $exists: true } },
    ],
  };
}

function manualReviewCalculationFilter(): FilterQuery<ISteelWorkingOrderMemory> {
  return {
    $or: [
      { 'payload.reviewStatus': 'manual_review' },
      { 'payload.classification': { $in: ['manual_review', 'unclassified_markdown_table'] } },
      { 'payload.reason': { $exists: true } },
      { 'payload.unresolvedReason': { $exists: true } },
    ],
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

      if (input.toolName === 'run_file_ocr') {
        await SteelWorkingOrderMemory.deleteMany({
          conversationId: input.conversationId,
          memoryKind: 'ocr_extract',
        });
      }
      await SteelWorkingOrderMemory.insertMany(documents);
      return {
        savedCounts: summarizeByKind(documents),
      };
    },

    async captureAssistantFinalMarkdown({
      conversationId,
      requestId,
      messageId,
      turnIndex,
      checkpointTurnIndex,
      content,
    }: CaptureAssistantFinalMarkdownInput): Promise<CaptureAssistantFinalMarkdownResult> {
      const tables = getParsedTables(content);
      const savedCounts: { [key: string]: number } = {};
      let sawUnclassifiedTable = false;

      for (const table of tables) {
        const payloads = toPayloads(table.headers, table.rows);

        if (isWorkingOrderTable(table.headers)) {
          const rows = canonicalizeSystemOrderItemNumbers(
            payloads.filter((payload) => getParsedRowNo(payload) !== undefined),
          );
          if (rows.length === 0) {
            continue;
          }

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
          });
          incrementSavedCount(savedCounts, 'working_order_row', rows.length);
          continue;
        }

        if (isCustomerTable(table.headers)) {
          await replaceActiveMarkdownRows({
            SteelWorkingOrderMemory,
            conversationId,
            requestId,
            messageId,
            turnIndex,
            checkpointTurnIndex,
            memoryKind: 'customer_fact',
            payloads,
            summaryForPayload: getFactSummary,
            locatorPrefix: 'table:customer_fact',
          });
          incrementSavedCount(savedCounts, 'customer_fact', payloads.length);
          continue;
        }

        if (isCalculationTable(table.headers)) {
          const quoteRows = payloads.filter((payload) => !isManualReviewPayload(payload));
          const manualRows = payloads.filter(isManualReviewPayload);
          await replaceActiveMarkdownRows({
            SteelWorkingOrderMemory,
            conversationId,
            requestId,
            messageId,
            turnIndex,
            checkpointTurnIndex,
            memoryKind: 'calculation_fact',
            payloads: quoteRows,
            summaryForPayload: getFactSummary,
            locatorPrefix: 'table:calculation_fact',
            replacementFilter: quoteCalculationFilter(),
          });
          await replaceActiveMarkdownRows({
            SteelWorkingOrderMemory,
            conversationId,
            requestId,
            messageId,
            turnIndex,
            checkpointTurnIndex,
            memoryKind: 'calculation_fact',
            payloads: manualRows,
            summaryForPayload: getFactSummary,
            locatorPrefix: 'table:manual_review',
            replacementFilter: manualReviewCalculationFilter(),
          });
          incrementSavedCount(savedCounts, 'calculation_fact', payloads.length);
          continue;
        }

        const unclassifiedPayloads = payloads.map((payload) => ({
          ...payload,
          classification: 'unclassified_markdown_table',
        }));
        await replaceActiveMarkdownRows({
          SteelWorkingOrderMemory,
          conversationId,
          requestId,
          messageId,
          turnIndex,
          checkpointTurnIndex,
          memoryKind: 'calculation_fact',
          payloads: unclassifiedPayloads,
          summaryForPayload: getFactSummary,
          locatorPrefix: 'table:unclassified',
          replacementFilter: manualReviewCalculationFilter(),
        });
        sawUnclassifiedTable = true;
        incrementSavedCount(savedCounts, 'calculation_fact', unclassifiedPayloads.length);
      }

      if (Object.keys(savedCounts).length === 0) {
        return {
          parseStatus: 'skipped',
          savedCounts,
        };
      }
      if (savedCounts.working_order_row === undefined) {
        savedCounts.working_order_row = 0;
      }

      return {
        parseStatus: sawUnclassifiedTable ? 'partial' : 'saved',
        savedCounts,
      };
    },
  };
}
