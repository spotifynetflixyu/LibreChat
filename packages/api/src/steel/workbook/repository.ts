import { createSteelWorkbookModel, createSteelWorkbookPatchModel } from '@librechat/data-schemas';

import type {
  SteelWorkbookCreateRecord,
  SteelWorkbookPatchRecord,
  SteelWorkbookRecord,
  SteelWorkbookRepository,
} from './service';
import type {
  SteelWorkbookCellValue,
  SteelWorkbookRow,
  SteelWorkbookSheet,
} from 'librechat-data-provider';

type Mongoose = typeof import('mongoose');

type CellsValue = Map<string, SteelWorkbookCellValue> | Record<string, SteelWorkbookCellValue>;

interface SteelWorkbookDocument {
  conversationMetaId?: string;
  workbookId: string;
  version: number;
  sheets: Array<
    Omit<SteelWorkbookSheet, 'rows'> & {
      rows: Array<Omit<SteelWorkbookRow, 'cells'> & { cells: CellsValue }>;
    }
  >;
  status: 'active' | 'archived';
  createdAt?: Date;
  updatedAt?: Date;
}

interface ObjectConvertible<T> {
  toObject?: (options?: { flattenMaps?: boolean }) => T;
}

function toPlain<T>(value: T | (T & ObjectConvertible<T>)): T {
  if (
    typeof value === 'object' &&
    value !== null &&
    'toObject' in value &&
    typeof value.toObject === 'function'
  ) {
    return value.toObject({ flattenMaps: false });
  }

  return value;
}

function normalizeCells(cells: CellsValue): Record<string, SteelWorkbookCellValue> {
  if (cells instanceof Map) {
    return Object.fromEntries(cells.entries());
  }

  return { ...cells };
}

function toRecord(document: SteelWorkbookDocument): SteelWorkbookRecord {
  const record = toPlain(document);
  const createdAt = record.createdAt ?? new Date();
  const updatedAt = record.updatedAt ?? createdAt;

  return {
    conversationMetaId: record.conversationMetaId,
    workbookId: record.workbookId,
    version: record.version,
    sheets: record.sheets.map((sheetValue) => {
      const sheet = toPlain(sheetValue);
      return {
        ...sheet,
        columns: sheet.columns.map((columnValue) => ({ ...toPlain(columnValue) })),
        rows: sheet.rows.map((rowValue) => {
          const row = toPlain(rowValue);
          return {
            ...row,
            cells: normalizeCells(row.cells),
          };
        }),
      };
    }),
    status: record.status,
    createdAt,
    updatedAt,
  };
}

export function createMongooseSteelWorkbookRepository(mongoose: Mongoose): SteelWorkbookRepository {
  const SteelWorkbook = createSteelWorkbookModel(mongoose);
  const SteelWorkbookPatch = createSteelWorkbookPatchModel(mongoose);

  return {
    async create(record: SteelWorkbookCreateRecord) {
      const document = await SteelWorkbook.create(record);
      return toRecord(document);
    },

    async findByWorkbookId(workbookId: string) {
      const document = await SteelWorkbook.findOne({ workbookId }).lean<SteelWorkbookDocument>();
      return document ? toRecord(document) : null;
    },

    async findByConversationMetaId(conversationMetaId: string) {
      const document = await SteelWorkbook.findOne({
        conversationMetaId,
        status: 'active',
      }).lean<SteelWorkbookDocument>();
      return document ? toRecord(document) : null;
    },

    async update(record: SteelWorkbookRecord) {
      const document = await SteelWorkbook.findOneAndUpdate(
        { workbookId: record.workbookId },
        record,
        { new: true, upsert: false },
      ).lean<SteelWorkbookDocument>();

      return document ? toRecord(document) : record;
    },

    async createPatch(record: SteelWorkbookPatchRecord) {
      await SteelWorkbookPatch.create(record);
      return record;
    },
  };
}
