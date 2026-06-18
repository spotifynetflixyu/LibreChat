import {
  createSteelWorkingOrderMemoryModel,
  type ISteelWorkingOrderMemory,
} from '@librechat/data-schemas';

import type { FilterQuery } from 'mongoose';
import type { SteelWorkingOrderMemoryReader } from '../tools/execute';
import type { ReadWorkingOrderItemsInput } from '../tools/schemas';

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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isJsonObject(value: SteelJsonValue | undefined): value is SteelJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPageSize(input: ReadWorkingOrderItemsInput): number {
  return input.pageSize ?? 20;
}

function getPage(input: ReadWorkingOrderItemsInput): number {
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

function sourceFilter(input: ReadWorkingOrderItemsInput): FilterQuery<ISteelWorkingOrderMemory> {
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

function getModeFilter(input: ReadWorkingOrderItemsInput): FilterQuery<ISteelWorkingOrderMemory> {
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

function getMarkdownTableBlocks(content: string): string[][] {
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      currentBlock.push(line);
      continue;
    }

    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
      currentBlock = [];
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks;
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownTable(block: string[]) {
  if (block.length < 3) {
    return undefined;
  }

  const headers = splitMarkdownTableRow(block[0] ?? '');
  const separator = splitMarkdownTableRow(block[1] ?? '');
  if (!isSeparatorRow(separator)) {
    return undefined;
  }

  const rows = block.slice(2).map(splitMarkdownTableRow);
  return { headers, rows };
}

function isWorkingOrderTable(headers: readonly string[]): boolean {
  return ['項次', '型號', '品名規格'].every((header) => headers.includes(header));
}

function isRowChangeTable(headers: readonly string[]): boolean {
  return headers.includes('項次') && !isWorkingOrderTable(headers);
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
  return getMarkdownTableBlocks(content)
    .map(parseMarkdownTable)
    .filter((table): table is { headers: string[]; rows: string[][] } => table !== undefined);
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

function getRuleEvidenceSummary(payload: SteelJsonObject): string {
  return (
    getStringProperty(payload, 'slug') ??
    getStringProperty(payload, 'summary') ??
    getStringProperty(payload, 'title') ??
    'rule evidence'
  );
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

  if (input.toolName === 'lookup_quote_rules') {
    return getArrayProperty(data, 'rules').filter(isJsonObject).map((rule) =>
      createToolMemoryDocument({
        ...input,
        memoryKind: 'rule_evidence',
        sourceKind: 'tool_result',
        payload: rule,
        summary: getRuleEvidenceSummary(rule),
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

function mergePayload(
  previous: SteelJsonValue | undefined,
  patch: SteelJsonObject,
): SteelJsonObject {
  if (!isJsonObject(previous)) {
    return patch;
  }

  return {
    ...previous,
    ...patch,
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
      const resultCount = await SteelWorkingOrderMemory.countDocuments(filter);
      const documents = await SteelWorkingOrderMemory.find(filter)
        .sort({ turnIndex: 1, createdAt: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<SteelWorkingOrderMemoryDocument[]>();
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

export function createMongooseSteelWorkingOrderMemoryWriter(mongoose: Mongoose) {
  const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);

  return {
    async captureToolResult(input: CaptureToolResultInput): Promise<CaptureToolResultResult> {
      const documents = getToolCaptureDocuments(input);
      if (documents.length === 0) {
        return { savedCounts: {} };
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
          const rows = payloads.filter((payload) => getParsedRowNo(payload) !== undefined);
          if (rows.length === 0) {
            continue;
          }

          await SteelWorkingOrderMemory.updateMany(
            {
              conversationId,
              state: 'active',
              memoryKind: 'working_order_row',
            },
            {
              $set: {
                state: 'superseded',
                supersededAt: new Date(),
                supersededByMessageId: messageId,
              },
            },
          );
          await SteelWorkingOrderMemory.insertMany(
            createMemoryDocuments({
              conversationId,
              requestId,
              messageId,
              turnIndex,
              checkpointTurnIndex,
              memoryKind: 'working_order_row',
              payloads: rows,
              summaryForPayload: getRowSummary,
              locatorPrefix: 'table:system_order',
            }),
          );
          incrementSavedCount(savedCounts, 'working_order_row', rows.length);
          continue;
        }

        if (isRowChangeTable(table.headers)) {
          const rowPatches = payloads.filter((payload) => getParsedRowNo(payload) !== undefined);
          const rowNumbers = rowPatches
            .map(getParsedRowNo)
            .filter((rowNo): rowNo is number => rowNo !== undefined);
          const activeRows = await SteelWorkingOrderMemory.find({
            conversationId,
            state: 'active',
            memoryKind: 'working_order_row',
            $or: rowNumbers.flatMap((rowNo) => [
              { 'payload.rowNo': rowNo },
              { 'payload.rowNo': String(rowNo) },
              { 'payload.項次': rowNo },
              { 'payload.項次': String(rowNo) },
            ]),
          }).lean<SteelWorkingOrderMemoryDocument[]>();
          const activeByRowNo = new Map<number, SteelWorkingOrderMemoryDocument>();

          activeRows.forEach((row) => {
            if (!isJsonObject(row.payload)) {
              return;
            }
            const rowNo = getParsedRowNo(row.payload);
            if (rowNo !== undefined) {
              activeByRowNo.set(rowNo, row);
            }
          });

          await SteelWorkingOrderMemory.updateMany(
            {
              conversationId,
              state: 'active',
              memoryKind: 'working_order_row',
              $or: rowNumbers.flatMap((rowNo) => [
                { 'payload.rowNo': rowNo },
                { 'payload.rowNo': String(rowNo) },
                { 'payload.項次': rowNo },
                { 'payload.項次': String(rowNo) },
              ]),
            },
            {
              $set: {
                state: 'superseded',
                supersededAt: new Date(),
                supersededByMessageId: messageId,
              },
            },
          );

          const mergedRows = rowPatches.map((patch) => {
            const activeRow = activeByRowNo.get(getParsedRowNo(patch) ?? -1);
            return mergePayload(activeRow?.payload, patch);
          });
          await SteelWorkingOrderMemory.insertMany(
            createMemoryDocuments({
              conversationId,
              requestId,
              messageId,
              turnIndex,
              checkpointTurnIndex,
              memoryKind: 'working_order_row',
              payloads: mergedRows,
              summaryForPayload: getRowSummary,
              locatorPrefix: 'table:row_change',
            }),
          );
          incrementSavedCount(savedCounts, 'working_order_row', mergedRows.length);
          continue;
        }

        if (isCustomerTable(table.headers)) {
          await SteelWorkingOrderMemory.insertMany(
            createMemoryDocuments({
              conversationId,
              requestId,
              messageId,
              turnIndex,
              checkpointTurnIndex,
              memoryKind: 'customer_fact',
              payloads,
              summaryForPayload: getFactSummary,
              locatorPrefix: 'table:customer_fact',
            }),
          );
          incrementSavedCount(savedCounts, 'customer_fact', payloads.length);
          continue;
        }

        if (isCalculationTable(table.headers)) {
          await SteelWorkingOrderMemory.insertMany(
            createMemoryDocuments({
              conversationId,
              requestId,
              messageId,
              turnIndex,
              checkpointTurnIndex,
              memoryKind: 'calculation_fact',
              payloads,
              summaryForPayload: getFactSummary,
              locatorPrefix: 'table:calculation_fact',
            }),
          );
          incrementSavedCount(savedCounts, 'calculation_fact', payloads.length);
          continue;
        }

        const unclassifiedPayloads = payloads.map((payload) => ({
          ...payload,
          classification: 'unclassified_markdown_table',
        }));
        await SteelWorkingOrderMemory.insertMany(
          createMemoryDocuments({
            conversationId,
            requestId,
            messageId,
            turnIndex,
            checkpointTurnIndex,
            memoryKind: 'calculation_fact',
            payloads: unclassifiedPayloads,
            summaryForPayload: getFactSummary,
            locatorPrefix: 'table:unclassified',
          }),
        );
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
