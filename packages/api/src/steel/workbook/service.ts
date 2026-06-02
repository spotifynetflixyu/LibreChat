import crypto from 'crypto';

import {
  steelWorkbookPatchRequestSchema,
  steelWorkbookPatchResponseSchema,
  steelWorkbookReadResponseSchema,
  type SteelChangedFieldSummary,
  type SteelChangedPath,
  type SteelWorkbook,
  type SteelWorkbookCellValue,
  type SteelWorkbookColumn,
  type SteelWorkbookPatchOperation,
  type SteelWorkbookPatchRequest,
  type SteelWorkbookPatchResponse,
  type SteelWorkbookReadResponse,
  type SteelWorkbookRow,
  type SteelWorkbookSheet,
} from 'librechat-data-provider';

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

function column(
  key: string,
  label: string,
  valueType: SteelWorkbookColumn['valueType'] = 'text',
  editable = true,
  widthPx?: number,
): SteelWorkbookColumn {
  return {
    key,
    label,
    valueType,
    editable,
    ...(widthPx ? { widthPx } : {}),
  };
}

const quoteDetailColumns: SteelWorkbookColumn[] = [
  column('line_no', '項次', 'number', false, 72),
  column('customer_original_item_name', '客戶原始品名', 'text', true, 220),
  column('normalized_item_name', '標準化品名', 'text', true, 220),
  column('search_keywords', '搜尋關鍵字', 'text', true, 180),
  column('product_price_candidate_items', '產品價格候選品項', 'text', true, 240),
  column('adopted_product_price_item', '採用產品價格品項', 'text', true, 220),
  column('is_exact_match', '是否完全匹配', 'boolean', true, 120),
  column('rejected_candidate_reason', '未採用候選原因', 'text', true, 220),
  column('material_category', '材料類別', 'text', true, 120),
  column('material', '材質', 'text', true, 120),
  column('spec', '規格', 'text', true, 160),
  column('finished_length_m', '成品長度m', 'number', true, 120),
  column('quantity', '數量', 'number', true, 96),
  column('unit', '單位', 'text', true, 80),
  column('raw_material_length', '素材長度', 'text', true, 120),
  column('raw_material_piece_count', '素材支數', 'number', true, 120),
  column('finished_count_per_raw_material', '可裁成品數', 'number', true, 120),
  column('remainder_length_or_weight', '餘料長度/重量', 'text', true, 160),
  column('unit_weight_kg_per_m', '單位重量kg/m', 'number', true, 140),
  column('unit_weight_kg', '單重kg', 'number', true, 120),
  column('total_weight_kg', '總重kg', 'number', true, 120),
  column('weight_algorithm', '重量算法', 'text', true, 160),
  column('customer', '客戶', 'text', true, 140),
  column('customer_tier', '分級', 'text', true, 96),
  column('material_unit_price', '材料單價', 'currency', true, 120),
  column('material_unit_price_field', '材料單價欄位', 'text', true, 160),
  column('material_pricing_unit', '材料計價單位', 'text', true, 140),
  column('billable_quantity', '計價數量', 'number', true, 120),
  column('material_fee', '材料費', 'currency', true, 120),
  column('cutting_fee', '切工費', 'currency', true, 120),
  column('hole_fee', '孔費', 'currency', true, 120),
  column('slotting_fee', '開槽費', 'currency', true, 120),
  column('bending_fee', '折工費', 'currency', true, 120),
  column('other_fee', '其他費', 'currency', true, 120),
  column('subtotal', '小計', 'currency', false, 120),
  column('confidence', '信心等級', 'status', false, 120),
  column('low_confidence_reason', '低信心原因', 'text', true, 220),
  column('decision_evidence', '判斷依據', 'text', true, 240),
  column('suggested_review', '建議複核', 'text', true, 180),
  column('note', '備註', 'text', true, 240),
];

const sheetDefinitions: Array<{
  id: SteelWorkbookSheet['id'];
  label: string;
  columns: SteelWorkbookColumn[];
  rows: SteelWorkbookRow[];
}> = [
  {
    id: 'system_order',
    label: '系統訂單',
    columns: [
      column('company_code', '公司編號', 'text', true, 120),
      column('line_no', '項次', 'number', true, 72),
      column('warehouse_code', '倉庫編號', 'text', true, 120),
      column('model_code', '型號', 'text', true, 140),
      column('item_spec', '品名規格', 'text', true, 260),
      column('material_code', '材質編號', 'text', true, 120),
      column('factory_code', '廠別編號', 'text', true, 120),
      column('unit', '單位', 'text', true, 80),
      column('quantity', '數量', 'number', true, 96),
      column('unit_weight', '單重', 'number', true, 96),
      column('total_quantity', '總數', 'number', true, 96),
      column('unit_price', '單價', 'currency', true, 96),
      column('pricing_basis', '計價基準', 'text', true, 120),
      column('formula_code', '公式編號', 'text', true, 120),
      column('thickness', '厚度', 'number', true, 96),
      column('width', '寬度', 'number', true, 96),
      column('length', '長度', 'number', true, 96),
      column('category', '類別', 'text', true, 96),
      column('delivery_date', '交貨日期', 'date', true, 120),
      column('note', '備註', 'text', true, 220),
    ],
    rows: [{ id: 'order_1', cells: { line_no: 10 } }],
  },
  {
    id: 'summary',
    label: '總結',
    columns: [column('item', '項目'), column('value', '值'), column('note', '備註')],
    rows: [
      { id: 'summary_total_weight', cells: { item: '總重量', value: null, note: null } },
      { id: 'summary_total_amount', cells: { item: '總額', value: null, note: null } },
    ],
  },
  {
    id: 'manual_review',
    label: '人工複核',
    columns: [
      column('line_no', '項次', 'number', true, 72),
      column('issue_type', '問題類型', 'text', true, 140),
      column('estimated_value', '暫估值', 'text', true, 160),
      column('low_confidence_reason', '低信心原因', 'text', true, 220),
      column('inferred_evidence', '推定依據', 'text', true, 240),
      column('confirmation_needed', '需確認內容', 'text', true, 240),
      column('amount_impact', '金額影響', 'currency', true, 120),
      column('suggested_action', '建議處理', 'text', true, 220),
    ],
    rows: [{ id: 'review_1', cells: { line_no: 1 } }],
  },
  {
    id: 'quote_details',
    label: '報價明細',
    columns: quoteDetailColumns,
    rows: [{ id: 'line_1', cells: { line_no: 1, material_unit_price: null } }],
  },
  {
    id: 'price_sources',
    label: '價格來源',
    columns: [
      column('customer', '客戶', 'text', true, 140),
      column('customer_tier', '分級', 'text', true, 96),
      column('customer_original_item_name', '客戶原始品名', 'text', true, 220),
      column('normalized_item_name', '標準化品名', 'text', true, 220),
      column('search_keywords', '搜尋關鍵字', 'text', true, 180),
      column('product_price_candidate_items', '產品價格候選品項', 'text', true, 240),
      column('adopted_product_price_item', '採用產品價格品項', 'text', true, 220),
      column('adopted_unit_price', '採用單價', 'currency', true, 120),
      column('unit_price_field', '單價欄位', 'text', true, 140),
      column('unit', '單位', 'text', true, 80),
      column('source_file', '來源檔案', 'text', false, 180),
      column('worksheet', '工作表', 'text', false, 140),
      column('row_or_page', '列號或頁碼', 'text', false, 120),
      column('is_exact_match', '是否精準匹配', 'boolean', true, 140),
      column('difference_note', '差異說明', 'text', true, 220),
      column('confidence', '信心等級', 'status', false, 120),
      column('note', '備註', 'text', true, 220),
    ],
    rows: [{ id: 'source_1', cells: {} }],
  },
  {
    id: 'interpretation_notes',
    label: '判讀備註',
    columns: [
      column('item', '項目', 'text', true, 160),
      column('content', '內容', 'text', true, 320),
      column('confidence', '信心', 'status', false, 120),
      column('evidence', '依據', 'text', false, 240),
    ],
    rows: [{ id: 'note_1', cells: { item: '整體處理規則' } }],
  },
  {
    id: 'customer_quote',
    label: '給客戶',
    columns: [
      column('line_no', '項次', 'number', true, 72),
      column('item_spec', '品名規格', 'text', true, 260),
      column('quantity', '數量', 'number', true, 96),
      column('unit', '單位', 'text', true, 80),
      column('unit_price', '單價', 'currency', true, 120),
      column('subtotal', '小計', 'currency', false, 120),
      column('note', '備註', 'text', true, 220),
    ],
    rows: [
      { id: 'customer_1', cells: { line_no: 1 } },
      { id: 'customer_total', cells: { item_spec: '訂單總額', subtotal: null } },
    ],
  },
];

function defaultId(): string {
  return `steel_wb_${crypto.randomUUID()}`;
}

function createInitialSheets(): SteelWorkbookSheet[] {
  return sheetDefinitions.map((sheet) => ({
    id: sheet.id,
    label: sheet.label,
    columns: sheet.columns.map((column) => ({ ...column })),
    rows: sheet.rows.map((row) => ({ id: row.id, cells: { ...row.cells } })),
  }));
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

  const row = sheet.rows.find((candidate) => candidate.id === operation.rowId);
  if (!row) {
    throw new SteelWorkbookValidationError(`Unknown workbook row: ${operation.rowId}`);
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

function createRejectedPatchRecord(
  request: SteelWorkbookPatchRequest,
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

export function createSteelWorkbookService({
  repository,
  id = defaultId,
  now = () => new Date(),
}: SteelWorkbookServiceDeps) {
  return {
    async create(input: SteelWorkbookCreateInput): Promise<SteelWorkbookReadResponse> {
      const timestamp = now();
      const record = await repository.create({
        conversationMetaId: input.conversationMetaId,
        workbookId: id(),
        version: 1,
        sheets: createInitialSheets(),
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      return toReadResponse(record);
    },

    async read(input: SteelWorkbookReadInput): Promise<SteelWorkbookReadResponse> {
      const record = await repository.findByWorkbookId(input.workbookId);
      if (!record) {
        throw new SteelWorkbookNotFoundError();
      }

      return toReadResponse(record);
    },

    async patch(input: unknown): Promise<SteelWorkbookPatchResponse> {
      const parsed = steelWorkbookPatchRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw new SteelWorkbookValidationError();
      }

      const request = parsed.data;
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
        version: current.version + 1,
        sheets: nextSheets,
        updatedAt: timestamp,
      });
      await repository.createPatch({
        workbookId: request.workbookId,
        beforeVersion: current.version,
        afterVersion: nextRecord.version,
        selectedWorkbookRefs: request.selectedWorkbookRefs,
        operations: request.operations,
        changedPaths,
        changedFieldSummary,
        status: 'accepted',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      return steelWorkbookPatchResponseSchema.parse({
        workbook: toPublicWorkbook(nextRecord),
        changedPaths,
        changedFieldSummary,
      });
    },
  };
}
