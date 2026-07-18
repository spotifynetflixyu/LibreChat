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

const { buildSteelPriceV4Rows } = require('../src/steel/pricing/v4');
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
const DEFAULT_INPUT_PATH = path.resolve(__dirname, '../../../docs/reference/products_db_v4.4.xlsx');
const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '../../../docs/reference/products_db_v4.4.xlsx',
);
const DEFAULT_REVIEW_PATH = path.resolve(
  __dirname,
  '../../../docs/reference/products_db_v4.4.pending-review.csv',
);
const legacySteelPriceV4SourceHeaders = Object.freeze([
  'erp_item_code',
  'formula_code',
  'product_name',
  'normalized_spec_text',
  'category',
  'subcategory',
  'material',
  'dimension_signature',
  'unit',
  'value_state',
  'unit_price_base',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_d',
  'unit_price_e',
  'unit_price_f',
  'price_ratio_a',
  'price_ratio_b',
  'price_ratio_c',
  'price_ratio_d',
  'price_ratio_e',
  'price_ratio_f',
  'unit_weight_value',
  'unit_weight_basis',
  'density',
  'source_thickness',
  'width_mm',
  'height_mm',
  'length_mm',
  'outer_diameter_mm',
  'nominal_inch',
  'web_mm',
  'flange_mm',
  'lip_mm',
  'sheet_width_mm',
  'sheet_length_mm',
  'spec_sort_key',
  'cost_basis',
]);
const legacySubcategoryIndex = legacySteelPriceV4SourceHeaders.indexOf('subcategory');
const legacyHeadersWithProcessing = [
  ...legacySteelPriceV4SourceHeaders.slice(0, legacySubcategoryIndex + 1),
  'processing_method',
  'processing_shape',
  ...legacySteelPriceV4SourceHeaders.slice(legacySubcategoryIndex + 1),
];
const legacySourceThicknessIndex = legacyHeadersWithProcessing.indexOf('source_thickness');
const legacyNormalizedHeaders = [
  ...legacyHeadersWithProcessing.slice(0, legacySourceThicknessIndex + 1),
  'thicknessMinMm',
  'thicknessMaxMm',
  ...legacyHeadersWithProcessing.slice(legacySourceThicknessIndex + 1),
];
const inputHeaders = [
  ...new Set([
    ...legacySteelPriceV4SourceHeaders,
    ...legacyNormalizedHeaders,
    ...normalizedSteelPriceV4WorkbookHeaders,
  ]),
];
const legacyThicknessIgnoredCategories = new Set([
  '圓管',
  '方管',
  '扁方管',
  '槽鐵',
  '角鐵',
  '網',
  '鋼筋',
  '鐵軌',
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
  const reviewPath = resolveOption(argv, '--review', DEFAULT_REVIEW_PATH);
  const known = new Set([
    '--help',
    '-h',
    '--input',
    '--output',
    '--review',
    '--write',
    argv[argv.indexOf('--input') + 1],
    argv[argv.indexOf('--output') + 1],
    argv[argv.indexOf('--review') + 1],
  ]);
  const unknown = argv.find((argument) => !known.has(argument));
  if (unknown) {
    throw new Error(`Unknown argument: ${unknown}`);
  }
  return { help, write, inputPath, outputPath, reviewPath };
}

function sameFile(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function adaptLegacySourceRow(row) {
  const erpItemCode = String(row.erp_item_code ?? '').normalize('NFKC').trim();
  const legacySpecText = String(row.normalized_spec_text ?? '').normalize('NFKC').trim();
  if (!String(row.spec_key ?? '').trim()) {
    row.spec_key = legacySpecText ? `${erpItemCode} ${legacySpecText}`.trim() : erpItemCode;
  }

  if (String(row.thicknessMinMm ?? '').trim() || String(row.thicknessMaxMm ?? '').trim()) {
    return row;
  }
  const sourceThickness = String(row.source_thickness ?? '').normalize('NFKC').trim();
  if (!sourceThickness || sourceThickness === '0') {
    return row;
  }
  const match = sourceThickness.match(
    /^([0-9]+(?:\.[0-9]+)?)\s*(?:[-~～至]\s*([0-9]+(?:\.[0-9]+)?))?\s*(?:m\s*\/\s*m|mm|t)?$/iu,
  );
  if (!match?.[1]) {
    throw new Error(`Invalid Steel source thickness: ${sourceThickness}`);
  }
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  if (min <= 0 || max < min) {
    throw new Error(`Invalid Steel source thickness: ${sourceThickness}`);
  }
  const category = String(row.category ?? '').trim();
  const productName = String(row.product_name ?? '').normalize('NFKC').toUpperCase();
  const [parsedWithoutSourceThickness] = buildSteelPriceV4Rows([row]);
  if (
    parsedWithoutSourceThickness?.thicknessMinMm !== null ||
    legacyThicknessIgnoredCategories.has(category)
  ) {
    return row;
  }
  if (
    category === '鐵板' &&
    ((min === 2 && productName.includes('2B')) || (min === 1 && productName.includes('NO1')))
  ) {
    return row;
  }
  row.thicknessMinMm = min;
  row.thicknessMaxMm = max;
  return row;
}

function loadWorkbook(inputPath) {
  const workbook = XLSX.readFile(inputPath, { raw: false, cellDates: false });
  const worksheet = workbook.Sheets[SHEET_NAME];
  if (!worksheet) {
    throw new Error(`${inputPath} missing ${SHEET_NAME} sheet`);
  }
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  const headers = (matrix[0] || []).map(String);
  const acceptedHeaders = [
    legacySteelPriceV4SourceHeaders,
    legacyNormalizedHeaders,
    normalizedSteelPriceV4WorkbookHeaders,
  ];
  const valid = acceptedHeaders.some(
    (candidate) =>
      headers.length === candidate.length &&
      headers.every((header, index) => header === candidate[index]),
  );
  if (!valid) {
    throw new Error(
      `${SHEET_NAME} headers must match the 39-column source or normalized target contract`,
    );
  }
  const rows = matrix.slice(1).map((cells) =>
    adaptLegacySourceRow(
      Object.fromEntries(
        inputHeaders.map((header) => {
          const index = headers.indexOf(header);
          return [header, cells[index] === undefined ? '' : cells[index]];
        }),
      ),
    ),
  );
  return { workbook, rows };
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

function makeDataSheet(rows) {
  const matrix = [
    [...normalizedSteelPriceV4WorkbookHeaders],
    ...rows.map((row) => normalizedSteelPriceV4WorkbookHeaders.map((header) => row[header] ?? '')),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  worksheet['!cols'] = normalizedSteelPriceV4WorkbookHeaders.map((header) => ({
    wch:
      header === 'product_name' || header === 'spec_key'
        ? 42
        : Math.max(12, header.length + 2),
  }));
  return worksheet;
}

function makeReviewSheet(rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [
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
    ],
  });
  worksheet['!cols'] = [8, 16, 52, 18, 18, 24, 36, 34, 20, 36].map((wch) => ({ wch }));
  return worksheet;
}

function addWorkbookAutoFilters(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet?.['!ref']) {
      continue;
    }
    worksheet['!autofilter'] = { ref: worksheet['!ref'] };
  }
}

function buildNormalization(inputPath) {
  const { workbook, rows } = loadWorkbook(inputPath);
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

function analyzeWorkbook(inputPath) {
  const { normalizedRows, reviewRows, changedCategoryCount } = buildNormalization(inputPath);
  return summarize(inputPath, normalizedRows, reviewRows, changedCategoryCount);
}

function normalizeWorkbook({ inputPath, outputPath, reviewPath = DEFAULT_REVIEW_PATH }) {
  if (sameFile(inputPath, outputPath)) {
    throw new Error('Input and output paths must differ');
  }
  const { normalizedRows, reviewRows, changedCategoryCount } = buildNormalization(inputPath);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeDataSheet(normalizedRows), SHEET_NAME);
  XLSX.utils.book_append_sheet(workbook, makeReviewSheet(reviewRows), REVIEW_SHEET_NAME);
  addWorkbookAutoFilters(workbook);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  XLSX.writeFile(workbook, outputPath, { compression: true });
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(reviewPath, XLSX.utils.sheet_to_csv(workbook.Sheets[REVIEW_SHEET_NAME]), 'utf8');

  return {
    ...summarize(inputPath, normalizedRows, reviewRows, changedCategoryCount),
    outputPath: path.resolve(outputPath),
    reviewPath: path.resolve(reviewPath),
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  node packages/api/scripts/normalize-steel-price-v4.cjs [--input <xlsx>] [--output <xlsx>] [--review <csv>] [--write]

Default mode validates the reference v4.4 workbook read-only. Add --write with a separate --output path to create an independent workbook.
The input and output paths must differ.
`);
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printUsage();
    } else if (!options.write) {
      process.stdout.write(
        `${JSON.stringify({ mode: 'dry-run', ...analyzeWorkbook(options.inputPath) }, null, 2)}\n`,
      );
    } else {
      process.stdout.write(`${JSON.stringify(normalizeWorkbook(options), null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_INPUT_PATH,
  DEFAULT_OUTPUT_PATH,
  DEFAULT_REVIEW_PATH,
  analyzeWorkbook,
  loadWorkbook,
  normalizeWorkbook,
  parseArgs,
};
