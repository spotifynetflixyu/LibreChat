import type {
  SteelWorkbookCellValue,
  SteelWorkbookPatchOperation,
  SteelWorkbookSheetId,
} from 'librechat-data-provider';
import { z } from 'zod';

type SemanticCellValue = SteelWorkbookCellValue | undefined;

type SemanticCustomer = {
  name?: SemanticCellValue;
  code?: SemanticCellValue;
  tier?: SemanticCellValue;
  address?: SemanticCellValue;
  contact?: SemanticCellValue;
  note?: string;
};

type SemanticSystemOrderLine = {
  modelCode?: SemanticCellValue;
  itemSpec?: SemanticCellValue;
  unit?: SemanticCellValue;
  quantity?: SemanticCellValue;
  unitWeight?: SemanticCellValue;
  totalQuantity?: SemanticCellValue;
  unitPrice?: SemanticCellValue;
  pricingBasis?: SemanticCellValue;
  formulaCode?: SemanticCellValue;
  thickness?: SemanticCellValue;
  width?: SemanticCellValue;
  length?: SemanticCellValue;
  category?: SemanticCellValue;
  note?: SemanticCellValue;
};

type SemanticPriceSource = {
  sourceFile?: SemanticCellValue;
  worksheet?: SemanticCellValue;
  rowOrPage?: SemanticCellValue;
  differenceNote?: SemanticCellValue;
  note?: SemanticCellValue;
};

type SemanticCustomerQuoteLine = {
  itemSpec?: SemanticCellValue;
  quantity?: SemanticCellValue;
  unit?: SemanticCellValue;
  unitPrice?: SemanticCellValue;
  subtotal?: SemanticCellValue;
  note?: SemanticCellValue;
};

type SemanticManualReview = {
  issueType?: SemanticCellValue;
  estimatedValue?: SemanticCellValue;
  lowConfidenceReason?: SemanticCellValue;
  inferredEvidence?: SemanticCellValue;
  confirmationNeeded?: SemanticCellValue;
  amountImpact?: SemanticCellValue;
  suggestedAction?: SemanticCellValue;
};

type SemanticInterpretationNote = {
  item?: SemanticCellValue;
  content?: SemanticCellValue;
  confidence?: SemanticCellValue;
  evidence?: SemanticCellValue;
};

export type SteelSemanticWorkbookQuoteLine = {
  lineId?: string;
  lineNo?: number;
  customerOriginalItemName?: SemanticCellValue;
  normalizedItemName?: SemanticCellValue;
  searchKeywords?: string[] | string;
  productPriceCandidateItems?: SemanticCellValue;
  adoptedProductPriceItem?: SemanticCellValue;
  isExactMatch?: SemanticCellValue;
  rejectedCandidateReason?: SemanticCellValue;
  materialCategory?: SemanticCellValue;
  material?: SemanticCellValue;
  spec?: SemanticCellValue;
  finishedLengthM?: SemanticCellValue;
  quantity?: SemanticCellValue;
  unit?: SemanticCellValue;
  rawMaterialLength?: SemanticCellValue;
  rawMaterialPieceCount?: SemanticCellValue;
  finishedCountPerRawMaterial?: SemanticCellValue;
  remainderLengthOrWeight?: SemanticCellValue;
  unitWeightKgPerM?: SemanticCellValue;
  unitWeightKg?: SemanticCellValue;
  totalWeightKg?: SemanticCellValue;
  weightAlgorithm?: SemanticCellValue;
  customerName?: SemanticCellValue;
  customerTier?: SemanticCellValue;
  materialUnitPrice?: SemanticCellValue;
  materialUnitPriceField?: SemanticCellValue;
  materialPricingUnit?: SemanticCellValue;
  billableQuantity?: SemanticCellValue;
  cuttingFee?: SemanticCellValue;
  holeFee?: SemanticCellValue;
  slottingFee?: SemanticCellValue;
  bendingFee?: SemanticCellValue;
  otherFee?: SemanticCellValue;
  subtotal?: SemanticCellValue;
  confidence?: SemanticCellValue;
  lowConfidenceReason?: SemanticCellValue;
  decisionEvidence?: SemanticCellValue;
  suggestedReview?: SemanticCellValue;
  note?: SemanticCellValue;
  systemOrder?: SemanticSystemOrderLine;
  priceSource?: SemanticPriceSource;
  customerQuote?: SemanticCustomerQuoteLine;
  manualReview?: SemanticManualReview;
  interpretationNote?: SemanticInterpretationNote;
};

export type SteelSemanticWorkbookPatch = {
  customer?: SemanticCustomer;
  quoteLines: SteelSemanticWorkbookQuoteLine[];
  customerQuoteTotal?: SemanticCustomerQuoteLine;
  summary?: {
    totalAmount?: SemanticCellValue;
    unconfirmedCount?: SemanticCellValue;
    lowConfidenceCount?: SemanticCellValue;
    totalWeightKg?: SemanticCellValue;
    rawMaterialPieceCount?: SemanticCellValue;
    remainderWeightKg?: SemanticCellValue;
    cuttingCount?: SemanticCellValue;
    cuttingFee?: SemanticCellValue;
    holeCount?: SemanticCellValue;
    holeFee?: SemanticCellValue;
    slottingMeters?: SemanticCellValue;
    slottingFee?: SemanticCellValue;
    bendingCount?: SemanticCellValue;
    bendingFee?: SemanticCellValue;
  };
};

const semanticCellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const optionalSemanticCellValueSchema = semanticCellValueSchema.optional();

const semanticCustomerSchema = z
  .object({
    name: optionalSemanticCellValueSchema,
    code: optionalSemanticCellValueSchema,
    tier: optionalSemanticCellValueSchema,
    address: optionalSemanticCellValueSchema,
    contact: optionalSemanticCellValueSchema,
    note: z.string().optional(),
  })
  .strict();

const semanticSystemOrderLineSchema = z
  .object({
    modelCode: optionalSemanticCellValueSchema,
    itemSpec: optionalSemanticCellValueSchema,
    unit: optionalSemanticCellValueSchema,
    quantity: optionalSemanticCellValueSchema,
    unitWeight: optionalSemanticCellValueSchema,
    totalQuantity: optionalSemanticCellValueSchema,
    unitPrice: optionalSemanticCellValueSchema,
    pricingBasis: optionalSemanticCellValueSchema,
    formulaCode: optionalSemanticCellValueSchema,
    thickness: optionalSemanticCellValueSchema,
    width: optionalSemanticCellValueSchema,
    length: optionalSemanticCellValueSchema,
    category: optionalSemanticCellValueSchema,
    note: optionalSemanticCellValueSchema,
  })
  .strict();

const semanticPriceSourceSchema = z
  .object({
    sourceFile: optionalSemanticCellValueSchema,
    worksheet: optionalSemanticCellValueSchema,
    rowOrPage: optionalSemanticCellValueSchema,
    differenceNote: optionalSemanticCellValueSchema,
    note: optionalSemanticCellValueSchema,
  })
  .strict();

const semanticCustomerQuoteLineSchema = z
  .object({
    itemSpec: optionalSemanticCellValueSchema,
    quantity: optionalSemanticCellValueSchema,
    unit: optionalSemanticCellValueSchema,
    unitPrice: optionalSemanticCellValueSchema,
    subtotal: optionalSemanticCellValueSchema,
    note: optionalSemanticCellValueSchema,
  })
  .strict();

const semanticManualReviewSchema = z
  .object({
    issueType: optionalSemanticCellValueSchema,
    estimatedValue: optionalSemanticCellValueSchema,
    lowConfidenceReason: optionalSemanticCellValueSchema,
    inferredEvidence: optionalSemanticCellValueSchema,
    confirmationNeeded: optionalSemanticCellValueSchema,
    amountImpact: optionalSemanticCellValueSchema,
    suggestedAction: optionalSemanticCellValueSchema,
  })
  .strict();

const semanticInterpretationNoteSchema = z
  .object({
    item: optionalSemanticCellValueSchema,
    content: optionalSemanticCellValueSchema,
    confidence: optionalSemanticCellValueSchema,
    evidence: optionalSemanticCellValueSchema,
  })
  .strict();

const semanticQuoteLineSchema: z.ZodType<SteelSemanticWorkbookQuoteLine> = z
  .object({
    lineId: z.string().min(1).optional(),
    lineNo: z.number().int().positive().optional(),
    customerOriginalItemName: optionalSemanticCellValueSchema,
    normalizedItemName: optionalSemanticCellValueSchema,
    searchKeywords: z.union([z.array(z.string()), z.string()]).optional(),
    productPriceCandidateItems: optionalSemanticCellValueSchema,
    adoptedProductPriceItem: optionalSemanticCellValueSchema,
    isExactMatch: optionalSemanticCellValueSchema,
    rejectedCandidateReason: optionalSemanticCellValueSchema,
    materialCategory: optionalSemanticCellValueSchema,
    material: optionalSemanticCellValueSchema,
    spec: optionalSemanticCellValueSchema,
    finishedLengthM: optionalSemanticCellValueSchema,
    quantity: optionalSemanticCellValueSchema,
    unit: optionalSemanticCellValueSchema,
    rawMaterialLength: optionalSemanticCellValueSchema,
    rawMaterialPieceCount: optionalSemanticCellValueSchema,
    finishedCountPerRawMaterial: optionalSemanticCellValueSchema,
    remainderLengthOrWeight: optionalSemanticCellValueSchema,
    unitWeightKgPerM: optionalSemanticCellValueSchema,
    unitWeightKg: optionalSemanticCellValueSchema,
    totalWeightKg: optionalSemanticCellValueSchema,
    weightAlgorithm: optionalSemanticCellValueSchema,
    customerName: optionalSemanticCellValueSchema,
    customerTier: optionalSemanticCellValueSchema,
    materialUnitPrice: optionalSemanticCellValueSchema,
    materialUnitPriceField: optionalSemanticCellValueSchema,
    materialPricingUnit: optionalSemanticCellValueSchema,
    billableQuantity: optionalSemanticCellValueSchema,
    cuttingFee: optionalSemanticCellValueSchema,
    holeFee: optionalSemanticCellValueSchema,
    slottingFee: optionalSemanticCellValueSchema,
    bendingFee: optionalSemanticCellValueSchema,
    otherFee: optionalSemanticCellValueSchema,
    subtotal: optionalSemanticCellValueSchema,
    confidence: optionalSemanticCellValueSchema,
    lowConfidenceReason: optionalSemanticCellValueSchema,
    decisionEvidence: optionalSemanticCellValueSchema,
    suggestedReview: optionalSemanticCellValueSchema,
    note: optionalSemanticCellValueSchema,
    systemOrder: semanticSystemOrderLineSchema.optional(),
    priceSource: semanticPriceSourceSchema.optional(),
    customerQuote: semanticCustomerQuoteLineSchema.optional(),
    manualReview: semanticManualReviewSchema.optional(),
    interpretationNote: semanticInterpretationNoteSchema.optional(),
  })
  .strict();

const semanticSummarySchema = z
  .object({
    totalAmount: optionalSemanticCellValueSchema,
    unconfirmedCount: optionalSemanticCellValueSchema,
    lowConfidenceCount: optionalSemanticCellValueSchema,
    totalWeightKg: optionalSemanticCellValueSchema,
    rawMaterialPieceCount: optionalSemanticCellValueSchema,
    remainderWeightKg: optionalSemanticCellValueSchema,
    cuttingCount: optionalSemanticCellValueSchema,
    cuttingFee: optionalSemanticCellValueSchema,
    holeCount: optionalSemanticCellValueSchema,
    holeFee: optionalSemanticCellValueSchema,
    slottingMeters: optionalSemanticCellValueSchema,
    slottingFee: optionalSemanticCellValueSchema,
    bendingCount: optionalSemanticCellValueSchema,
    bendingFee: optionalSemanticCellValueSchema,
  })
  .strict();

export const steelSemanticWorkbookPatchSchema: z.ZodType<SteelSemanticWorkbookPatch> = z
  .object({
    customer: semanticCustomerSchema.optional(),
    quoteLines: z.array(semanticQuoteLineSchema).min(1),
    customerQuoteTotal: semanticCustomerQuoteLineSchema.optional(),
    summary: semanticSummarySchema.optional(),
  })
  .strict();

function isPresent(value: SemanticCellValue): value is SteelWorkbookCellValue {
  return (
    value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '')
  );
}

function rowIndexFromLine(line: SteelSemanticWorkbookQuoteLine, fallbackIndex: number): number {
  if (typeof line.lineNo === 'number' && Number.isFinite(line.lineNo) && line.lineNo > 0) {
    return line.lineNo;
  }

  const match = line.lineId?.match(/(\d+)$/);
  return match ? Number(match[1]) : fallbackIndex + 1;
}

function lineRowId(line: SteelSemanticWorkbookQuoteLine, fallbackIndex: number): string {
  return line.lineId?.trim() || `line_${rowIndexFromLine(line, fallbackIndex)}`;
}

function relatedRowId(prefix: string, line: SteelSemanticWorkbookQuoteLine, fallbackIndex: number) {
  return `${prefix}_${rowIndexFromLine(line, fallbackIndex)}`;
}

function searchKeywordsValue(value: SteelSemanticWorkbookQuoteLine['searchKeywords']) {
  return Array.isArray(value) ? value.filter((entry) => entry.trim() !== '').join('、') : value;
}

function addCell({
  columnKey,
  operations,
  reason,
  rowId,
  sheetId,
  value,
}: {
  columnKey: string;
  operations: SteelWorkbookPatchOperation[];
  reason: string;
  rowId: string;
  sheetId: SteelWorkbookSheetId;
  value: SemanticCellValue;
}) {
  if (!isPresent(value)) {
    return;
  }

  operations.push({
    op: 'set_cell',
    sheetId,
    rowId,
    columnKey,
    value,
    reason,
  });
}

function addCells({
  cells,
  operations,
  reason,
  rowId,
  sheetId,
}: {
  cells: Record<string, SemanticCellValue>;
  operations: SteelWorkbookPatchOperation[];
  reason: string;
  rowId: string;
  sheetId: SteelWorkbookSheetId;
}) {
  for (const [columnKey, value] of Object.entries(cells)) {
    addCell({
      columnKey,
      operations,
      reason,
      rowId,
      sheetId,
      value,
    });
  }
}

function sumNumeric(values: SemanticCellValue[]) {
  const numericValues = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );

  return numericValues.length === values.length && numericValues.length > 0
    ? Number(numericValues.reduce((sum, value) => sum + value, 0).toFixed(2))
    : undefined;
}

function addSummaryRows(
  input: SteelSemanticWorkbookPatch,
  operations: SteelWorkbookPatchOperation[],
) {
  const lineSubtotals = input.quoteLines.map((line) => line.subtotal);
  const lineWeights = input.quoteLines.map((line) => line.totalWeightKg);
  const totalAmount = input.summary?.totalAmount ?? sumNumeric(lineSubtotals);
  const totalWeight = input.summary?.totalWeightKg ?? sumNumeric(lineWeights);
  const summaryRows: Array<{
    rowId: string;
    item: string;
    value: SemanticCellValue;
    note?: SemanticCellValue;
  }> = [
    {
      rowId: 'summary_customer',
      item: '客戶暫採',
      value: input.customer?.name,
      note: input.customer?.note,
    },
    {
      rowId: 'summary_customer_code',
      item: '客戶編號暫採',
      value: input.customer?.code,
    },
    {
      rowId: 'summary_customer_tier',
      item: '分級暫採',
      value: input.customer?.tier,
    },
    {
      rowId: 'summary_delivery_address',
      item: '送貨地址',
      value: input.customer?.address,
    },
    {
      rowId: 'summary_contact',
      item: '聯繫人',
      value: input.customer?.contact,
    },
    {
      rowId: 'summary_total_amount',
      item: '報價總額',
      value: totalAmount,
      note: '語意報價 patch 投影',
    },
    {
      rowId: 'summary_unconfirmed_count',
      item: '未確認項目數',
      value: input.summary?.unconfirmedCount,
    },
    {
      rowId: 'summary_low_confidence_count',
      item: '低信心項目數',
      value: input.summary?.lowConfidenceCount,
    },
    {
      rowId: 'summary_total_weight',
      item: '總重量kg',
      value: totalWeight,
    },
    {
      rowId: 'summary_raw_material_piece_count',
      item: '素材支數',
      value: input.summary?.rawMaterialPieceCount,
    },
    {
      rowId: 'summary_remainder_weight',
      item: '餘料重量kg',
      value: input.summary?.remainderWeightKg,
    },
    {
      rowId: 'summary_cutting_total',
      item: '總切工次數/費',
      value: input.summary?.cuttingCount,
      note: input.summary?.cuttingFee,
    },
    {
      rowId: 'summary_hole_total',
      item: '總孔數/費',
      value: input.summary?.holeCount,
      note: input.summary?.holeFee,
    },
    {
      rowId: 'summary_slotting_total',
      item: '總開槽M/費',
      value: input.summary?.slottingMeters,
      note: input.summary?.slottingFee,
    },
    {
      rowId: 'summary_bending_total',
      item: '總折刀數/費',
      value: input.summary?.bendingCount,
      note: input.summary?.bendingFee,
    },
  ];

  for (const row of summaryRows) {
    if (!isPresent(row.value) && !isPresent(row.note)) {
      continue;
    }

    addCells({
      operations,
      sheetId: 'summary',
      rowId: row.rowId,
      reason: 'Project semantic quote summary into the workbook summary sheet.',
      cells: {
        item: row.item,
        value: row.value,
        note: row.note,
      },
    });
  }
}

function addQuoteLineCells(
  line: SteelSemanticWorkbookQuoteLine,
  fallbackIndex: number,
  operations: SteelWorkbookPatchOperation[],
) {
  const rowId = lineRowId(line, fallbackIndex);
  const rowNumber = rowIndexFromLine(line, fallbackIndex);
  const searchKeywords = searchKeywordsValue(line.searchKeywords);
  addCells({
    operations,
    sheetId: 'quote_details',
    rowId,
    reason: 'Project semantic quote line into quote details.',
    cells: {
      line_no: line.lineNo ?? rowNumber,
      customer_original_item_name: line.customerOriginalItemName,
      normalized_item_name: line.normalizedItemName,
      search_keywords: searchKeywords,
      product_price_candidate_items: line.productPriceCandidateItems,
      adopted_product_price_item: line.adoptedProductPriceItem,
      is_exact_match: line.isExactMatch,
      rejected_candidate_reason: line.rejectedCandidateReason,
      material_category: line.materialCategory,
      material: line.material,
      spec: line.spec,
      finished_length_m: line.finishedLengthM,
      quantity: line.quantity,
      unit: line.unit,
      raw_material_length: line.rawMaterialLength,
      raw_material_piece_count: line.rawMaterialPieceCount,
      finished_count_per_raw_material: line.finishedCountPerRawMaterial,
      remainder_length_or_weight: line.remainderLengthOrWeight,
      unit_weight_kg_per_m: line.unitWeightKgPerM,
      unit_weight_kg: line.unitWeightKg,
      total_weight_kg: line.totalWeightKg,
      weight_algorithm: line.weightAlgorithm,
      customer: line.customerName,
      customer_tier: line.customerTier,
      material_unit_price: line.materialUnitPrice,
      material_unit_price_field: line.materialUnitPriceField,
      material_pricing_unit: line.materialPricingUnit,
      billable_quantity: line.billableQuantity,
      cutting_fee: line.cuttingFee,
      hole_fee: line.holeFee,
      slotting_fee: line.slottingFee,
      bending_fee: line.bendingFee,
      other_fee: line.otherFee,
      subtotal: line.subtotal,
      confidence: line.confidence,
      low_confidence_reason: line.lowConfidenceReason,
      decision_evidence: line.decisionEvidence,
      suggested_review: line.suggestedReview,
      note: line.note,
    },
  });
}

function addSystemOrderCells(
  line: SteelSemanticWorkbookQuoteLine,
  fallbackIndex: number,
  operations: SteelWorkbookPatchOperation[],
) {
  const rowNumber = rowIndexFromLine(line, fallbackIndex);
  const systemOrder = line.systemOrder ?? {};
  addCells({
    operations,
    sheetId: 'system_order',
    rowId: relatedRowId('order', line, fallbackIndex),
    reason: 'Project semantic quote line into ERP-style system order.',
    cells: {
      line_no: rowNumber * 10,
      model_code: systemOrder.modelCode,
      item_spec: systemOrder.itemSpec ?? line.normalizedItemName,
      unit: systemOrder.unit ?? line.materialPricingUnit ?? line.unit,
      quantity: systemOrder.quantity ?? line.billableQuantity ?? line.quantity,
      unit_weight: systemOrder.unitWeight ?? line.unitWeightKgPerM ?? line.unitWeightKg,
      total_quantity: systemOrder.totalQuantity ?? line.billableQuantity ?? line.totalWeightKg,
      unit_price: systemOrder.unitPrice ?? line.materialUnitPrice,
      pricing_basis: systemOrder.pricingBasis ?? line.materialUnitPriceField,
      formula_code: systemOrder.formulaCode,
      thickness: systemOrder.thickness,
      width: systemOrder.width,
      length: systemOrder.length ?? line.finishedLengthM,
      category: systemOrder.category ?? line.materialCategory,
      note: systemOrder.note ?? line.note ?? line.suggestedReview,
    },
  });
}

function addPriceSourceCells(
  line: SteelSemanticWorkbookQuoteLine,
  fallbackIndex: number,
  operations: SteelWorkbookPatchOperation[],
) {
  const source = line.priceSource ?? {};
  addCells({
    operations,
    sheetId: 'price_sources',
    rowId: relatedRowId('source', line, fallbackIndex),
    reason: 'Project semantic quote source data into price sources.',
    cells: {
      customer: line.customerName,
      customer_tier: line.customerTier,
      customer_original_item_name: line.customerOriginalItemName,
      normalized_item_name: line.normalizedItemName,
      search_keywords: searchKeywordsValue(line.searchKeywords),
      product_price_candidate_items: line.productPriceCandidateItems,
      adopted_product_price_item: line.adoptedProductPriceItem,
      adopted_unit_price: line.materialUnitPrice,
      unit_price_field: line.materialUnitPriceField,
      unit: line.materialPricingUnit ?? line.unit,
      source_file: source.sourceFile,
      worksheet: source.worksheet,
      row_or_page: source.rowOrPage,
      is_exact_match: line.isExactMatch,
      difference_note: source.differenceNote ?? line.rejectedCandidateReason,
      confidence: line.confidence,
      note: source.note ?? line.suggestedReview,
    },
  });
}

function addManualReviewCells(
  line: SteelSemanticWorkbookQuoteLine,
  fallbackIndex: number,
  operations: SteelWorkbookPatchOperation[],
) {
  const review = line.manualReview;
  if (!review && !isPresent(line.suggestedReview) && !isPresent(line.lowConfidenceReason)) {
    return;
  }

  addCells({
    operations,
    sheetId: 'manual_review',
    rowId: relatedRowId('review', line, fallbackIndex),
    reason: 'Project semantic quote uncertainty into manual review.',
    cells: {
      line_no: line.lineNo ?? rowIndexFromLine(line, fallbackIndex),
      issue_type: review?.issueType ?? line.lowConfidenceReason,
      estimated_value: review?.estimatedValue ?? line.adoptedProductPriceItem,
      low_confidence_reason: review?.lowConfidenceReason ?? line.lowConfidenceReason,
      inferred_evidence: review?.inferredEvidence ?? line.decisionEvidence,
      confirmation_needed: review?.confirmationNeeded ?? line.suggestedReview,
      amount_impact: review?.amountImpact ?? line.subtotal,
      suggested_action: review?.suggestedAction,
    },
  });
}

function addInterpretationNoteCells(
  line: SteelSemanticWorkbookQuoteLine,
  fallbackIndex: number,
  operations: SteelWorkbookPatchOperation[],
) {
  const note = line.interpretationNote;
  if (!note && !isPresent(line.decisionEvidence) && !isPresent(line.note)) {
    return;
  }

  addCells({
    operations,
    sheetId: 'interpretation_notes',
    rowId: relatedRowId('note', line, fallbackIndex),
    reason: 'Project semantic quote interpretation into concise notes.',
    cells: {
      item: note?.item ?? line.materialCategory ?? line.normalizedItemName,
      content: note?.content ?? line.decisionEvidence ?? line.note,
      confidence: note?.confidence ?? line.confidence,
      evidence: note?.evidence ?? line.decisionEvidence,
    },
  });
}

function addCustomerQuoteCells(
  line: SteelSemanticWorkbookQuoteLine,
  fallbackIndex: number,
  operations: SteelWorkbookPatchOperation[],
) {
  const customerQuote = line.customerQuote ?? {};
  addCells({
    operations,
    sheetId: 'customer_quote',
    rowId: relatedRowId('customer', line, fallbackIndex),
    reason: 'Project semantic quote line into customer-visible quote sheet.',
    cells: {
      line_no: line.lineNo ?? rowIndexFromLine(line, fallbackIndex),
      item_spec: customerQuote.itemSpec ?? line.customerOriginalItemName ?? line.normalizedItemName,
      quantity: customerQuote.quantity ?? line.quantity,
      unit: customerQuote.unit ?? line.unit,
      unit_price: customerQuote.unitPrice ?? line.materialUnitPrice,
      subtotal: customerQuote.subtotal ?? line.subtotal,
      note: customerQuote.note,
    },
  });
}

function addCustomerQuoteTotalCells(
  input: SteelSemanticWorkbookPatch,
  operations: SteelWorkbookPatchOperation[],
) {
  const customerQuoteTotal = input.customerQuoteTotal;
  if (!customerQuoteTotal) {
    return;
  }

  const reason = 'Project AI-authored customer-visible quote total row.';
  const totalCells: Record<string, SteelWorkbookCellValue> = {
    item_spec: customerQuoteTotal.itemSpec ?? '報價總額',
    quantity: customerQuoteTotal.quantity ?? null,
    unit: customerQuoteTotal.unit ?? null,
    unit_price: customerQuoteTotal.unitPrice ?? null,
    subtotal: customerQuoteTotal.subtotal ?? input.summary?.totalAmount ?? null,
    note: customerQuoteTotal.note ?? null,
  };

  for (const [columnKey, value] of Object.entries(totalCells)) {
    operations.push({
      op: 'set_cell',
      sheetId: 'customer_quote',
      rowId: 'customer_total',
      columnKey,
      value,
      reason,
    });
  }
}

export function buildSemanticWorkbookPatchOperations(
  input: SteelSemanticWorkbookPatch,
): SteelWorkbookPatchOperation[] {
  const operations: SteelWorkbookPatchOperation[] = [];

  input.quoteLines.forEach((line, index) => {
    addQuoteLineCells(line, index, operations);
    addSystemOrderCells(line, index, operations);
    addPriceSourceCells(line, index, operations);
    addManualReviewCells(line, index, operations);
    addInterpretationNoteCells(line, index, operations);
    addCustomerQuoteCells(line, index, operations);
  });
  addCustomerQuoteTotalCells(input, operations);
  addSummaryRows(input, operations);

  return operations;
}
