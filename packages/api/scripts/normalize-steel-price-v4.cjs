#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
process.env.TS_NODE_TRANSPILE_ONLY = 'true';

require('ts-node/register/transpile-only');

const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const { steelPriceV4WorkbookHeaders } = require('../src/steel/pricing/v4');
const { isPriceCategory } = require('../src/steel/pricing/categories');
const { materialKinds } = require('../src/steel/pricing/enums');
const {
  applyPriceCategory,
  getPendingPriceCategoryProposal,
} = require('../src/steel/pricing/normalize/classification');
const {
  normalizeSteelPriceWorkbookRow,
  normalizedSteelPriceV4WorkbookHeaders,
  protectedSteelPriceWorkbookHeaders,
} = require('../src/steel/pricing/normalize/core');

const SHEET_NAME = 'products_db_ready';
const REVIEW_SHEET_NAME = '待確認';
const RAW_SHEET_NAME = '工作表2';
const RAW_HEADER_ROW_INDEX = 4;
const DEFAULT_INPUT_PATH = path.resolve(__dirname, '../../../docs/reference/0701.xlsx');
const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '../../../docs/reference/products_db_v4.4.xlsx',
);
const DEFAULT_ENRICHMENT_PATH = path.resolve(__dirname, './steel-price-v4.4-enrichment.json');
const DEFAULT_REVIEW_PATH = path.resolve(
  __dirname,
  '../../../docs/reference/products_db_v4.4.pending-review.csv',
);
const rawSteelPriceHeaders = Object.freeze([
  '_流水號_',
  '型號',
  '品名規格',
  '公式編號',
  '本倉數量',
  '本倉總數',
  '單位',
  '售價',
  '進價',
  '成本基準',
  '金額',
  '售價A',
  '售價B',
  '售價C',
  '售價D',
  '售價E',
  '售價F',
  '單位重',
  '比重',
  '異動日期',
  '備註',
  '比率A',
  '比率B',
  '比率C',
  '比率D',
  '比率E',
  '比率F',
]);
const enrichmentNumericFields = Object.freeze([
  'density',
  'thicknessMinMm',
  'thicknessMaxMm',
  'width_mm',
  'height_mm',
  'length_mm',
  'outer_diameter_mm',
  'web_mm',
  'flange_mm',
  'lip_mm',
  'sheet_width_mm',
  'sheet_length_mm',
  'spec_sort_key',
]);
const enrichmentOptionalFields = Object.freeze([
  'product_name',
  'material',
  'unit_weight_basis',
  'nominal_inch',
  ...enrichmentNumericFields.filter((field) => field !== 'density'),
]);
const enrichmentFields = new Set([
  'erp_item_code',
  'category',
  'density',
  'spec_key',
  ...enrichmentOptionalFields,
]);
const canonicalMaterialKinds = new Set(materialKinds);
const unitWeightBases = new Set([
  'kg_per_m',
  'kg_per_piece_or_stock_length',
  'kg_per_stock_length',
  'unknown',
]);
const blankProductNameCodes = new Set(['AX', 'FV', 'FVG']);
const alternatingRowFill = Object.freeze({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3F4F6' },
});
const reviewHeaders = Object.freeze([
  'row',
  'erp_item_code',
  'product_name',
  'current_category',
  'inferred_category',
  'proposed_subcategory',
  'reason',
  'suggested_action',
  'confirmed_category',
  'review_note',
]);

function resolveOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a path`);
  }
  return path.resolve(value);
}

function parseArgs(argv) {
  const help = argv.includes('--help') || argv.includes('-h');
  const write = argv.includes('--write');
  const inputPath = resolveOption(argv, '--input', DEFAULT_INPUT_PATH);
  const outputPath = resolveOption(argv, '--output', DEFAULT_OUTPUT_PATH);
  const enrichmentPath = resolveOption(argv, '--enrichment', DEFAULT_ENRICHMENT_PATH);
  const reviewPath = resolveOption(argv, '--review', DEFAULT_REVIEW_PATH);
  const known = new Set([
    '--help',
    '-h',
    '--input',
    '--output',
    '--enrichment',
    '--review',
    '--write',
    argv[argv.indexOf('--input') + 1],
    argv[argv.indexOf('--output') + 1],
    argv[argv.indexOf('--enrichment') + 1],
    argv[argv.indexOf('--review') + 1],
  ]);
  const unknown = argv.find((argument) => !known.has(argument));
  if (unknown) {
    throw new Error(`Unknown argument: ${unknown}`);
  }
  return { help, write, inputPath, outputPath, enrichmentPath, reviewPath };
}

function sameFile(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function cellText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim();
}

function hasPositiveValue(row, fields) {
  return fields.some((field) => Number(cellText(row[field]).replace(/,/gu, '')) > 0);
}

function numericCell(value, field) {
  const text = cellText(value);
  if (!text) {
    return '';
  }
  const parsed = Number(text.replace(/,/gu, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid 0701 numeric value for ${field}: ${text}`);
  }
  return String(parsed);
}

function buildRawSourceRow(row) {
  const source = Object.fromEntries(steelPriceV4WorkbookHeaders.map((header) => [header, '']));
  const hasPrice = hasPositiveValue(row, [
    '售價',
    '售價A',
    '售價B',
    '售價C',
    '售價D',
    '售價E',
    '售價F',
  ]);
  const hasRatio = hasPositiveValue(row, ['比率A', '比率B', '比率C', '比率D', '比率E', '比率F']);
  let valueState = 'no_price';
  if (hasPrice) {
    valueState = 'confirmed';
  } else if (hasRatio) {
    valueState = 'ratio_only';
  }

  Object.assign(source, {
    erp_item_code: cellText(row['型號']),
    formula_code: cellText(row['公式編號']),
    product_name: cellText(row['品名規格']),
    unit: cellText(row['單位']),
    value_state: valueState,
    unit_price_base: numericCell(row['售價'], '售價'),
    unit_price_a: numericCell(row['售價A'], '售價A'),
    unit_price_b: numericCell(row['售價B'], '售價B'),
    unit_price_c: numericCell(row['售價C'], '售價C'),
    unit_price_d: numericCell(row['售價D'], '售價D'),
    unit_price_e: numericCell(row['售價E'], '售價E'),
    unit_price_f: numericCell(row['售價F'], '售價F'),
    price_ratio_a: numericCell(row['比率A'], '比率A'),
    price_ratio_b: numericCell(row['比率B'], '比率B'),
    price_ratio_c: numericCell(row['比率C'], '比率C'),
    price_ratio_d: numericCell(row['比率D'], '比率D'),
    price_ratio_e: numericCell(row['比率E'], '比率E'),
    price_ratio_f: numericCell(row['比率F'], '比率F'),
    unit_weight_value: cellText(row['單位重']),
    cost_basis: cellText(row['成本基準']),
  });
  return source;
}

function assertExactHeaders(headers) {
  const matches =
    headers.length === rawSteelPriceHeaders.length &&
    headers.every((header, index) => header === rawSteelPriceHeaders[index]);
  if (!matches) {
    throw new Error(`${RAW_SHEET_NAME} row 5 headers do not match the 0701 raw contract`);
  }
}

function loadRawWorkbook(inputPath) {
  const workbook = XLSX.readFile(inputPath, { raw: false, cellDates: false });
  const worksheet = workbook.Sheets[RAW_SHEET_NAME];
  if (!worksheet) {
    throw new Error(`${inputPath} missing ${RAW_SHEET_NAME} sheet`);
  }
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  const headers = (matrix[RAW_HEADER_ROW_INDEX] || []).map(String);
  assertExactHeaders(headers);
  const rows = matrix
    .slice(RAW_HEADER_ROW_INDEX + 1)
    .map((cells) =>
      buildRawSourceRow(
        Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])),
      ),
    );
  return { workbook, rows };
}

function assertNumericEnrichmentField(record, field, erpItemCode) {
  const value = record[field];
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Invalid Steel price enrichment ${field} for ${erpItemCode}`);
  }
  const parsed = Number(cellText(value).replace(/,/gu, ''));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid Steel price enrichment ${field} for ${erpItemCode}`);
  }
}

function validateEnrichmentRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Steel price enrichment row ${index + 1} must be an object`);
  }
  const unknownField = Object.keys(record).find((field) => !enrichmentFields.has(field));
  if (unknownField) {
    throw new Error(`Unknown Steel price enrichment field: ${unknownField}`);
  }

  const erpItemCode = cellText(record.erp_item_code);
  if (!erpItemCode) {
    throw new Error(`Steel price enrichment row ${index + 1} requires erp_item_code`);
  }
  const category = cellText(record.category);
  if (!isPriceCategory(category)) {
    throw new Error(`Invalid Steel price enrichment category for ${erpItemCode}`);
  }
  if (typeof record.spec_key !== 'string' || !cellText(record.spec_key)) {
    throw new Error(`Steel price enrichment requires spec_key for ${erpItemCode}`);
  }
  assertNumericEnrichmentField(record, 'density', erpItemCode);
  if (record.density === undefined) {
    throw new Error(`Steel price enrichment requires density for ${erpItemCode}`);
  }
  for (const field of enrichmentNumericFields) {
    assertNumericEnrichmentField(record, field, erpItemCode);
  }
  if (record.product_name !== undefined && typeof record.product_name !== 'string') {
    throw new Error(`Invalid Steel price enrichment product_name for ${erpItemCode}`);
  }
  if (record.material !== undefined && !canonicalMaterialKinds.has(cellText(record.material))) {
    throw new Error(`Invalid Steel price enrichment material for ${erpItemCode}`);
  }
  if (
    record.unit_weight_basis !== undefined &&
    !unitWeightBases.has(cellText(record.unit_weight_basis))
  ) {
    throw new Error(`Invalid Steel price enrichment unit_weight_basis for ${erpItemCode}`);
  }
  if (record.nominal_inch !== undefined) {
    const validType =
      typeof record.nominal_inch === 'string' || typeof record.nominal_inch === 'number';
    if (!validType || !cellText(record.nominal_inch)) {
      throw new Error(`Invalid Steel price enrichment nominal_inch for ${erpItemCode}`);
    }
  }
  return { ...record, erp_item_code: erpItemCode, category };
}

function loadEnrichment(enrichmentPath) {
  const parsed = JSON.parse(fs.readFileSync(enrichmentPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('Steel price enrichment must be a JSON array');
  }
  const records = parsed.map(validateEnrichmentRecord);
  const byErpItemCode = new Map();
  for (const record of records) {
    if (byErpItemCode.has(record.erp_item_code)) {
      throw new Error(`Duplicate Steel price enrichment ERP code: ${record.erp_item_code}`);
    }
    byErpItemCode.set(record.erp_item_code, record);
  }
  return byErpItemCode;
}

function applyEnrichment(rows, enrichmentPath) {
  const byErpItemCode = loadEnrichment(enrichmentPath);
  const seen = new Set();
  const enrichedRows = rows.map((row) => {
    const erpItemCode = cellText(row.erp_item_code);
    if (!erpItemCode || seen.has(erpItemCode)) {
      throw new Error(`Duplicate 0701 ERP code: ${erpItemCode || '(blank)'}`);
    }
    seen.add(erpItemCode);
    const enrichment = byErpItemCode.get(erpItemCode);
    if (!enrichment) {
      throw new Error(`Missing Steel price enrichment for ERP code: ${erpItemCode}`);
    }
    if (
      Object.prototype.hasOwnProperty.call(enrichment, 'product_name') &&
      String(enrichment.product_name) === String(row.product_name)
    ) {
      throw new Error(`Redundant Steel price product_name enrichment for ${erpItemCode}`);
    }
    const enriched = { ...row, ...enrichment, erp_item_code: erpItemCode };
    const productName = cellText(enriched.product_name);
    if (!productName && !blankProductNameCodes.has(erpItemCode)) {
      throw new Error(`Steel price row requires product_name for ${erpItemCode}`);
    }
    if (productName && blankProductNameCodes.has(erpItemCode)) {
      throw new Error(`Steel price placeholder product_name must stay blank for ${erpItemCode}`);
    }
    return enriched;
  });
  const extra = [...byErpItemCode.keys()].find((erpItemCode) => !seen.has(erpItemCode));
  if (extra) {
    throw new Error(`Steel price enrichment has unknown ERP code: ${extra}`);
  }
  return enrichedRows;
}

function reviewRow(source, classified, normalized, rowNumber) {
  const productName = String(normalized.product_name ?? '').trim();
  const proposal = getPendingPriceCategoryProposal(source);
  const reasons = [];
  if (proposal && proposal.category !== classified.category) {
    reasons.push('category_mismatch');
  }
  if (productName && !normalized.subcategory) {
    reasons.push('subcategory_unclassified');
  }
  return reasons.length === 0
    ? null
    : {
        row: rowNumber,
        erp_item_code: normalized.erp_item_code,
        product_name: normalized.product_name,
        current_category: classified.category,
        inferred_category: proposal?.category ?? classified.category,
        proposed_subcategory: proposal?.subcategory ?? normalized.subcategory,
        reason: reasons.join('|'),
        suggested_action: proposal ? `確認 category 是否改為 ${proposal.category}` : '補充分類規則',
        confirmed_category: '',
        review_note: '',
      };
}

function assertParserProtected(classifiedRows, normalizedRows) {
  classifiedRows.forEach((source, index) => {
    const normalized = normalizedRows[index];
    for (const header of protectedSteelPriceWorkbookHeaders) {
      if (normalized[header] !== source[header]) {
        throw new Error(`Protected field changed at row ${index + 2}: ${header}`);
      }
    }
  });
}

function assertSourceProtected(sourceRows, normalizedRows) {
  sourceRows.forEach((source, index) => {
    const normalized = normalizedRows[index];
    for (const header of protectedSteelPriceWorkbookHeaders) {
      if (header !== 'category' && normalized[header] !== source[header]) {
        throw new Error(`Source protected field changed at row ${index + 2}: ${header}`);
      }
    }
  });
}

function makeDataMatrix(rows) {
  return [
    [...normalizedSteelPriceV4WorkbookHeaders],
    ...rows.map((row) => normalizedSteelPriceV4WorkbookHeaders.map((header) => row[header] ?? '')),
  ];
}

function makeReviewMatrix(rows) {
  return [reviewHeaders, ...rows.map((row) => reviewHeaders.map((header) => row[header] ?? ''))];
}

function applyAlternatingRowFill(worksheet, dataRowCount, columnCount) {
  for (let rowNumber = 3; rowNumber <= dataRowCount + 1; rowNumber += 2) {
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      worksheet.getCell(rowNumber, columnNumber).fill = alternatingRowFill;
    }
  }
}

function addWorkbookSheet(workbook, name, matrix, widths) {
  const worksheet = workbook.addWorksheet(name);
  worksheet.addRows(matrix);
  worksheet.columns = widths.map((width) => ({ width }));
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: matrix.length, column: matrix[0].length },
  };
  applyAlternatingRowFill(worksheet, matrix.length - 1, matrix[0].length);
  return worksheet;
}

async function writeWorkbook(outputPath, normalizedRows, reviewRows) {
  const workbook = new ExcelJS.Workbook();
  const dataMatrix = makeDataMatrix(normalizedRows);
  const dataWidths = normalizedSteelPriceV4WorkbookHeaders.map((header) =>
    header === 'product_name' || header === 'spec_key' ? 42 : Math.max(12, header.length + 2),
  );
  const reviewMatrix = makeReviewMatrix(reviewRows);
  addWorkbookSheet(workbook, SHEET_NAME, dataMatrix, dataWidths);
  addWorkbookSheet(
    workbook,
    REVIEW_SHEET_NAME,
    reviewMatrix,
    [8, 16, 52, 18, 18, 24, 36, 34, 20, 36],
  );
  await workbook.xlsx.writeFile(outputPath);
}

function buildNormalization(inputPath, enrichmentPath) {
  const { workbook, rows: rawRows } = loadRawWorkbook(inputPath);
  const rows = applyEnrichment(rawRows, enrichmentPath);
  const classifiedRows = rows.map(applyPriceCategory);
  const normalizedRows = classifiedRows.map(normalizeSteelPriceWorkbookRow);
  assertParserProtected(classifiedRows, normalizedRows);
  assertSourceProtected(rows, normalizedRows);
  const reviewRows = normalizedRows.flatMap((row, index) => {
    const review = reviewRow(rows[index], classifiedRows[index], row, index + 2);
    return review ? [review] : [];
  });
  const changedCategoryCount = classifiedRows.reduce(
    (count, row, index) => count + (row.category === rows[index].category ? 0 : 1),
    0,
  );

  return { workbook, normalizedRows, reviewRows, changedCategoryCount };
}

function summarize(inputPath, normalizedRows, reviewRows, changedCategoryCount) {
  return {
    inputPath: path.resolve(inputPath),
    rowCount: normalizedRows.length,
    changedCategoryCount,
    pendingReviewCount: reviewRows.length,
    categoryMismatchCount: reviewRows.filter((row) => row.reason.includes('category_mismatch'))
      .length,
    unclassifiedSubcategoryCount: reviewRows.filter((row) =>
      row.reason.includes('subcategory_unclassified'),
    ).length,
  };
}

function analyzeWorkbook(inputPath, enrichmentPath = DEFAULT_ENRICHMENT_PATH) {
  const { normalizedRows, reviewRows, changedCategoryCount } = buildNormalization(
    inputPath,
    enrichmentPath,
  );
  return summarize(inputPath, normalizedRows, reviewRows, changedCategoryCount);
}

async function normalizeWorkbook({
  inputPath,
  outputPath,
  enrichmentPath = DEFAULT_ENRICHMENT_PATH,
  reviewPath = DEFAULT_REVIEW_PATH,
}) {
  if (sameFile(inputPath, outputPath)) {
    throw new Error('Input and output paths must differ');
  }
  const { normalizedRows, reviewRows, changedCategoryCount } = buildNormalization(
    inputPath,
    enrichmentPath,
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await writeWorkbook(outputPath, normalizedRows, reviewRows);
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  const reviewWorksheet = XLSX.utils.aoa_to_sheet(makeReviewMatrix(reviewRows));
  fs.writeFileSync(reviewPath, XLSX.utils.sheet_to_csv(reviewWorksheet), 'utf8');

  return {
    ...summarize(inputPath, normalizedRows, reviewRows, changedCategoryCount),
    outputPath: path.resolve(outputPath),
    reviewPath: path.resolve(reviewPath),
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  node packages/api/scripts/normalize-steel-price-v4.cjs [--input <xlsx>] [--output <xlsx>] [--enrichment <json>] [--review <csv>] [--write]

Default mode validates docs/reference/0701.xlsx read-only. Add --write with a separate --output path to create the normalized v4.4 workbook.
The input and output paths must differ.
`);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printUsage();
    } else if (!options.write) {
      process.stdout.write(
        `${JSON.stringify(
          {
            mode: 'dry-run',
            ...analyzeWorkbook(options.inputPath, options.enrichmentPath),
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(`${JSON.stringify(await normalizeWorkbook(options), null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  DEFAULT_INPUT_PATH,
  DEFAULT_OUTPUT_PATH,
  DEFAULT_ENRICHMENT_PATH,
  DEFAULT_REVIEW_PATH,
  analyzeWorkbook,
  loadEnrichment,
  loadRawWorkbook,
  normalizeWorkbook,
  parseArgs,
};
