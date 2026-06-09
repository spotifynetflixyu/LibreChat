import { createSteelFileAnalysisDataModel } from '@librechat/data-schemas';

import type {
  SteelFileAnalysisCreateRecord,
  SteelFileAnalysisRecord,
  SteelFileAnalysisRepository,
} from './analysis';

type Mongoose = typeof import('mongoose');

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

function normalizeCells(cells: Map<string, unknown> | Record<string, unknown>) {
  return cells instanceof Map ? Object.fromEntries(cells.entries()) : { ...cells };
}

function normalizeRow<Row extends { cells: Map<string, unknown> | Record<string, unknown> }>(
  rowValue: Row,
) {
  const row = toPlain(rowValue);

  return {
    ...row,
    cells: normalizeCells(row.cells),
  };
}

function toRecord(document: SteelFileAnalysisRecord & { fileAnalysisDataId?: string }) {
  const record = toPlain(document);

  return {
    ...record,
    id: record.id ?? record.fileAnalysisDataId,
    sheets: {
      file_analysis_data: {
        columns: record.sheets.file_analysis_data.columns.map((column) => ({ ...toPlain(column) })),
        rows: record.sheets.file_analysis_data.rows.map(normalizeRow),
      },
      manual_review: {
        columns: record.sheets.manual_review.columns.map((column) => ({ ...toPlain(column) })),
        rows: record.sheets.manual_review.rows.map(normalizeRow),
      },
      interpretation_notes: {
        columns: record.sheets.interpretation_notes.columns.map((column) => ({
          ...toPlain(column),
        })),
        rows: record.sheets.interpretation_notes.rows.map(normalizeRow),
      },
    },
  } as SteelFileAnalysisRecord;
}

function toDocument(record: SteelFileAnalysisRecord) {
  return {
    ...record,
    fileAnalysisDataId: record.id,
  };
}

export function createMongooseSteelFileAnalysisRepository(
  mongoose: Mongoose,
): SteelFileAnalysisRepository {
  const SteelFileAnalysisData = createSteelFileAnalysisDataModel(mongoose);

  return {
    async create(record: SteelFileAnalysisCreateRecord) {
      const document = await SteelFileAnalysisData.create(toDocument(record));
      return toRecord(document as unknown as SteelFileAnalysisRecord);
    },
    async findByConversationId(conversationId: string) {
      const document = await SteelFileAnalysisData.findOne({
        conversationId,
      }).lean<SteelFileAnalysisRecord & { fileAnalysisDataId?: string }>();

      return document ? toRecord(document) : null;
    },
    async update(record: SteelFileAnalysisRecord) {
      const document = await SteelFileAnalysisData.findOneAndUpdate(
        { conversationId: record.conversationId },
        toDocument(record),
        { new: true, upsert: true },
      ).lean<SteelFileAnalysisRecord & { fileAnalysisDataId?: string }>();

      return document ? toRecord(document) : record;
    },
  };
}
