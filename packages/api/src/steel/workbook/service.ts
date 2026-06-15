import crypto from 'crypto';

import {
  steelWorkbookInternalPatchRequestSchema,
  steelWorkbookPatchRequestSchema,
  steelWorkbookPatchResponseSchema,
  steelWorkbookReadResponseSchema,
  type SteelChangedFieldSummary,
  type SteelChangedPath,
  type SteelWorkbook,
  type SteelWorkbookCellValue,
  type SteelWorkbookColumn,
  type SteelWorkbookInternalPatchRequest,
  type SteelWorkbookPatchOperation,
  type SteelWorkbookPatchRequest,
  type SteelWorkbookPatchResponse,
  type SteelWorkbookReadResponse,
  type SteelWorkbookRow,
  type SteelWorkbookSheet,
} from 'librechat-data-provider';

import { createInitialSheets } from './template';

type SteelWorkbookStatus = 'active' | 'archived';
type SteelWorkbookPatchStatus = 'accepted' | 'rejected';
const customerQuoteSheetId = 'customer_quote';
const customerQuoteTotalRowId = 'customer_total';
const customerQuoteTotalLabel = '報價總額';

export interface SteelWorkbookCreateRecord {
  conversationMetaId?: string;
  workbookId: string;
  version: number;
  sheets: SteelWorkbookSheet[];
  status: SteelWorkbookStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type SteelWorkbookRecord = SteelWorkbookCreateRecord;

export interface SteelWorkbookPatchRecord {
  workbookId: string;
  beforeVersion: number;
  afterVersion: number;
  selectedWorkbookRefs: SteelWorkbookPatchRequest['selectedWorkbookRefs'];
  operations: SteelWorkbookPatchOperation[];
  changedPaths: SteelChangedPath[];
  changedFieldSummary: SteelChangedFieldSummary[];
  status: SteelWorkbookPatchStatus;
  rejectedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SteelWorkbookRepository {
  create(record: SteelWorkbookCreateRecord): Promise<SteelWorkbookRecord>;
  findByWorkbookId(workbookId: string): Promise<SteelWorkbookRecord | null>;
  findByConversationMetaId(conversationMetaId: string): Promise<SteelWorkbookRecord | null>;
  update(record: SteelWorkbookRecord): Promise<SteelWorkbookRecord>;
  createPatch(record: SteelWorkbookPatchRecord): Promise<SteelWorkbookPatchRecord>;
}

interface SteelWorkbookServiceDeps {
  repository: SteelWorkbookRepository;
  id?: () => string;
  now?: () => Date;
}

interface SteelWorkbookCreateInput {
  conversationMetaId?: string;
}

interface SteelWorkbookReadInput {
  workbookId: string;
}

interface SteelWorkbookConversationReadInput {
  conversationMetaId: string;
}

interface SteelWorkbookConversationPatchInput extends SteelWorkbookPatchRequest {
  conversationMetaId: string;
}

export class SteelWorkbookNotFoundError extends Error {
  readonly statusCode = 404;
  readonly errorCategory = 'steel_workbook_not_found';

  constructor() {
    super('Steel workbook not found');
    this.name = 'SteelWorkbookNotFoundError';
  }
}

export class SteelWorkbookVersionConflictError extends Error {
  readonly statusCode = 409;
  readonly errorCategory = 'steel_workbook_version_conflict';

  constructor() {
    super('Steel workbook version conflict');
    this.name = 'SteelWorkbookVersionConflictError';
  }
}

export class SteelWorkbookValidationError extends Error {
  readonly statusCode = 400;
  readonly errorCategory = 'steel_workbook_patch_invalid';

  constructor(message = 'Invalid Steel workbook patch') {
    super(message);
    this.name = 'SteelWorkbookValidationError';
  }
}

function defaultId(): string {
  return `steel_wb_${crypto.randomUUID()}`;
}

function toPublicWorkbook(record: SteelWorkbookRecord): SteelWorkbook {
  return {
    id: record.workbookId,
    version: record.version,
    sheets: record.sheets,
  };
}

function toReadResponse(record: SteelWorkbookRecord): SteelWorkbookReadResponse {
  return steelWorkbookReadResponseSchema.parse({
    workbook: toPublicWorkbook(record),
  });
}

function getExistingCellValue(
  cells: SteelWorkbookRow['cells'],
  key: string,
): SteelWorkbookCellValue {
  return Object.prototype.hasOwnProperty.call(cells, key) ? cells[key] : null;
}

function getPatchSheet(
  sheets: SteelWorkbookSheet[],
  operation: SteelWorkbookPatchOperation,
): SteelWorkbookSheet {
  const sheet = sheets.find((candidate) => candidate.id === operation.sheetId);
  if (!sheet) {
    throw new SteelWorkbookValidationError(`Unknown workbook sheet: ${operation.sheetId}`);
  }

  return sheet;
}

function getSetCellPatchTarget(
  sheets: SteelWorkbookSheet[],
  operation: Extract<SteelWorkbookPatchOperation, { op: 'set_cell' }>,
): {
  sheet: SteelWorkbookSheet;
  row: SteelWorkbookRow;
  column: SteelWorkbookColumn;
} {
  const sheet = getPatchSheet(sheets, operation);
  const column = sheet.columns.find((candidate) => candidate.key === operation.columnKey);
  if (!column) {
    throw new SteelWorkbookValidationError(`Unknown workbook column: ${operation.columnKey}`);
  }

  let row = sheet.rows.find((candidate) => candidate.id === operation.rowId);
  if (!row) {
    row = { id: operation.rowId, cells: {} };
    sheet.rows.push(row);
  }

  return { sheet, row, column };
}

function applySetCellOperation({
  changedFieldSummary,
  changedPaths,
  nextSheets,
  operation,
}: {
  changedFieldSummary: SteelChangedFieldSummary[];
  changedPaths: SteelChangedPath[];
  nextSheets: SteelWorkbookSheet[];
  operation: Extract<SteelWorkbookPatchOperation, { op: 'set_cell' }>;
}) {
  const { row, column } = getSetCellPatchTarget(nextSheets, operation);
  const previousValue = getExistingCellValue(row.cells, operation.columnKey);
  row.cells[operation.columnKey] = operation.value;
  changedPaths.push({
    sheetId: operation.sheetId,
    rowId: operation.rowId,
    columnKey: operation.columnKey,
  });
  changedFieldSummary.push({
    sheetId: operation.sheetId,
    rowId: operation.rowId,
    columnKey: operation.columnKey,
    label: column.label,
    previousValue,
    nextValue: operation.value,
  });
}

function applyDeleteRowOperation({
  changedFieldSummary,
  changedPaths,
  nextSheets,
  operation,
}: {
  changedFieldSummary: SteelChangedFieldSummary[];
  changedPaths: SteelChangedPath[];
  nextSheets: SteelWorkbookSheet[];
  operation: Extract<SteelWorkbookPatchOperation, { op: 'delete_row' }>;
}) {
  const sheet = getPatchSheet(nextSheets, operation);
  const previousLength = sheet.rows.length;
  sheet.rows = sheet.rows.filter((row) => row.id !== operation.rowId);
  if (sheet.rows.length === previousLength) {
    return;
  }

  changedPaths.push({
    sheetId: operation.sheetId,
    rowId: operation.rowId,
    columnKey: '__row__',
  });
  changedFieldSummary.push({
    sheetId: operation.sheetId,
    rowId: operation.rowId,
    columnKey: '__row__',
    label: '列',
    previousValue: '已存在',
    nextValue: null,
  });
}

function getColumnLabel(sheet: SteelWorkbookSheet, columnKey: string): string {
  return sheet.columns.find((column) => column.key === columnKey)?.label ?? columnKey;
}

function valuesEqual(left: SteelWorkbookCellValue, right: SteelWorkbookCellValue): boolean {
  return Object.is(left, right);
}

function setNormalizedCustomerQuoteCell({
  changedFieldSummary,
  changedPaths,
  columnKey,
  row,
  sheet,
  value,
}: {
  changedFieldSummary: SteelChangedFieldSummary[];
  changedPaths: SteelChangedPath[];
  columnKey: string;
  row: SteelWorkbookRow;
  sheet: SteelWorkbookSheet;
  value: SteelWorkbookCellValue;
}) {
  const previousValue = getExistingCellValue(row.cells, columnKey);
  if (valuesEqual(previousValue, value)) {
    return;
  }

  row.cells[columnKey] = value;
  changedPaths.push({
    sheetId: customerQuoteSheetId,
    rowId: row.id,
    columnKey,
  });
  changedFieldSummary.push({
    sheetId: customerQuoteSheetId,
    rowId: row.id,
    columnKey,
    label: getColumnLabel(sheet, columnKey),
    previousValue,
    nextValue: value,
  });
}

function isCustomerQuoteTotalRow(row: SteelWorkbookRow): boolean {
  return (
    row.id === customerQuoteTotalRowId ||
    row.cells.item_spec === customerQuoteTotalLabel ||
    row.cells.unit_price === customerQuoteTotalLabel
  );
}

function toNumericSubtotal(value: SteelWorkbookCellValue): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/,/g, '').trim();
  if (normalized === '') {
    return undefined;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getCustomerQuoteTotalSubtotal(lineRows: SteelWorkbookRow[]): SteelWorkbookCellValue {
  if (lineRows.length === 0) {
    return null;
  }

  let total = 0;
  for (const row of lineRows) {
    const numericSubtotal = toNumericSubtotal(getExistingCellValue(row.cells, 'subtotal'));
    if (numericSubtotal === undefined) {
      return '未確認';
    }
    total += numericSubtotal;
  }

  return roundCurrency(total);
}

function normalizeCustomerQuoteTotalRow({
  changedFieldSummary,
  changedPaths,
  nextSheets,
}: {
  changedFieldSummary: SteelChangedFieldSummary[];
  changedPaths: SteelChangedPath[];
  nextSheets: SteelWorkbookSheet[];
}) {
  const sheet = nextSheets.find((candidate) => candidate.id === customerQuoteSheetId);
  if (!sheet) {
    return;
  }

  const totalRows = sheet.rows.filter(isCustomerQuoteTotalRow);
  const totalRow = totalRows[0];
  if (!totalRow) {
    return;
  }

  const lineRows = sheet.rows.filter((row) => !isCustomerQuoteTotalRow(row));
  setNormalizedCustomerQuoteCell({
    changedFieldSummary,
    changedPaths,
    columnKey: 'item_spec',
    row: totalRow,
    sheet,
    value: customerQuoteTotalLabel,
  });
  setNormalizedCustomerQuoteCell({
    changedFieldSummary,
    changedPaths,
    columnKey: 'subtotal',
    row: totalRow,
    sheet,
    value: getCustomerQuoteTotalSubtotal(lineRows),
  });

  sheet.rows = [
    ...lineRows,
    ...totalRows.filter((row) => row !== totalRow),
    totalRow,
  ];
}

function cloneSheets(sheets: SteelWorkbookSheet[]): SteelWorkbookSheet[] {
  return sheets.map((sheet) => ({
    ...sheet,
    columns: sheet.columns.map((column) => ({ ...column })),
    rows: sheet.rows.map((row) => ({
      ...row,
      cells: { ...row.cells },
    })),
  }));
}

function isEmptyWorkbook(sheets: SteelWorkbookSheet[]): boolean {
  return sheets.every((sheet) => sheet.rows.length === 0);
}

function createRejectedPatchRecord(
  request: SteelWorkbookInternalPatchRequest,
  currentVersion: number,
  reason: string,
  timestamp: Date,
): SteelWorkbookPatchRecord {
  return {
    workbookId: request.workbookId,
    beforeVersion: request.workbookVersion,
    afterVersion: currentVersion,
    selectedWorkbookRefs: request.selectedWorkbookRefs,
    operations: request.operations,
    changedPaths: [],
    changedFieldSummary: [],
    status: 'rejected',
    rejectedReason: reason,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createWorkbookRecord({
  conversationMetaId,
  id,
  now,
}: {
  conversationMetaId?: string;
  id: () => string;
  now: () => Date;
}): SteelWorkbookCreateRecord {
  const timestamp = now();
  return {
    conversationMetaId,
    workbookId: id(),
    version: 1,
    sheets: createInitialSheets(),
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createSteelWorkbookService({
  repository,
  id = defaultId,
  now = () => new Date(),
}: SteelWorkbookServiceDeps) {
  async function applyPatch(
    request: SteelWorkbookInternalPatchRequest,
  ): Promise<SteelWorkbookPatchResponse> {
    const current = await repository.findByWorkbookId(request.workbookId);
    if (!current) {
      throw new SteelWorkbookNotFoundError();
    }

    const timestamp = now();
    if (current.version !== request.workbookVersion) {
      await repository.createPatch(
        createRejectedPatchRecord(
          request,
          current.version,
          'Workbook version changed before this patch was applied.',
          timestamp,
        ),
      );
      throw new SteelWorkbookVersionConflictError();
    }

    const nextSheets = cloneSheets(current.sheets);
    const isInitialDataLoad = isEmptyWorkbook(current.sheets);
    const changedPaths: SteelChangedPath[] = [];
    const changedFieldSummary: SteelChangedFieldSummary[] = [];

    try {
      for (const operation of request.operations) {
        if (operation.op === 'set_cell') {
          applySetCellOperation({
            changedFieldSummary,
            changedPaths,
            nextSheets,
            operation,
          });
          continue;
        }

        applyDeleteRowOperation({
          changedFieldSummary,
          changedPaths,
          nextSheets,
          operation,
        });
      }
      normalizeCustomerQuoteTotalRow({
        changedFieldSummary,
        changedPaths,
        nextSheets,
      });
    } catch (error) {
      if (error instanceof SteelWorkbookValidationError) {
        await repository.createPatch(
          createRejectedPatchRecord(request, current.version, error.message, timestamp),
        );
      }
      throw error;
    }

    const nextRecord = await repository.update({
      ...current,
      version: isInitialDataLoad ? current.version : current.version + 1,
      sheets: nextSheets,
      updatedAt: timestamp,
    });
    const publicChangedPaths = isInitialDataLoad ? [] : changedPaths;
    await repository.createPatch({
      workbookId: request.workbookId,
      beforeVersion: current.version,
      afterVersion: nextRecord.version,
      selectedWorkbookRefs: request.selectedWorkbookRefs,
      operations: request.operations,
      changedPaths: publicChangedPaths,
      changedFieldSummary,
      status: 'accepted',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return steelWorkbookPatchResponseSchema.parse({
      workbook: toPublicWorkbook(nextRecord),
      changedPaths: publicChangedPaths,
      changedFieldSummary,
    });
  }

  return {
    async create(input: SteelWorkbookCreateInput): Promise<SteelWorkbookReadResponse> {
      const record = await repository.create(
        createWorkbookRecord({ conversationMetaId: input.conversationMetaId, id, now }),
      );

      return toReadResponse(record);
    },

    async read(input: SteelWorkbookReadInput): Promise<SteelWorkbookReadResponse> {
      const record = await repository.findByWorkbookId(input.workbookId);
      if (!record) {
        throw new SteelWorkbookNotFoundError();
      }

      return toReadResponse(record);
    },

    async readByConversationMetaId(
      input: SteelWorkbookConversationReadInput,
    ): Promise<SteelWorkbookReadResponse | null> {
      const record = await repository.findByConversationMetaId(input.conversationMetaId);
      return record ? toReadResponse(record) : null;
    },

    async patchByConversationMetaId(
      input: SteelWorkbookConversationPatchInput,
    ): Promise<SteelWorkbookPatchResponse> {
      if (!input.conversationMetaId) {
        throw new SteelWorkbookValidationError('conversationMetaId is required');
      }

      const request = steelWorkbookPatchRequestSchema.parse(input);
      const current =
        (await repository.findByConversationMetaId(input.conversationMetaId)) ??
        (await repository.create(
          createWorkbookRecord({ conversationMetaId: input.conversationMetaId, id, now }),
        ));

      return applyPatch({
        ...request,
        workbookId: current.workbookId,
      });
    },

    async patch(input: unknown): Promise<SteelWorkbookPatchResponse> {
      const parsed = steelWorkbookInternalPatchRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw new SteelWorkbookValidationError();
      }

      return applyPatch(parsed.data);
    },
  };
}
