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

function getPatchTarget(
  sheets: SteelWorkbookSheet[],
  operation: SteelWorkbookPatchOperation,
): {
  sheet: SteelWorkbookSheet;
  row: SteelWorkbookRow;
  column: SteelWorkbookColumn;
} {
  const sheet = sheets.find((candidate) => candidate.id === operation.sheetId);
  if (!sheet) {
    throw new SteelWorkbookValidationError(`Unknown workbook sheet: ${operation.sheetId}`);
  }

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
        const { row, column } = getPatchTarget(nextSheets, operation);
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
