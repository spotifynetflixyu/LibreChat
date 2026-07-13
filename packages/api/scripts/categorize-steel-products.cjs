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

const {
  applyCategoryStage,
  buildPriceCategoryReference,
} = require('../src/steel/pricing/normalize/stage');

const SHEET_NAME = 'products_db_ready';
const REVIEW_SHEET_NAME = 'category_review';
const DEFAULT_INPUT_PATH = path.resolve(__dirname, '../../../docs/products_db_v4.3.xlsx');
const DEFAULT_REFERENCE_PATH = path.resolve(__dirname, '../../../docs/products_db_v4.4.xlsx');
const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '../../../docs/products_db_categorized.xlsx');
const DEFAULT_REVIEW_PATH = path.resolve(
  __dirname,
  '../../../docs/products_db_categorized.pending-review.csv',
);

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
  const referencePath = resolveOption(argv, '--reference', DEFAULT_REFERENCE_PATH);
  const outputPath = resolveOption(argv, '--output', DEFAULT_OUTPUT_PATH);
  const reviewPath = resolveOption(argv, '--review', DEFAULT_REVIEW_PATH);
  const values = ['--input', '--reference', '--output', '--review'].flatMap((name) => {
    const index = argv.indexOf(name);
    return index < 0 ? [] : [argv[index + 1]];
  });
  const known = new Set([
    '--help',
    '-h',
    '--write',
    '--input',
    '--reference',
    '--output',
    '--review',
    ...values,
  ]);
  const unknown = argv.find((argument) => !known.has(argument));
  if (unknown) {
    throw new Error(`Unknown argument: ${unknown}`);
  }
  return { help, write, inputPath, referencePath, outputPath, reviewPath };
}

function loadProductList(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { raw: false, cellDates: false });
  const worksheet = workbook.Sheets[SHEET_NAME];
  if (!worksheet) {
    throw new Error(`${workbookPath} missing ${SHEET_NAME} sheet`);
  }
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  const headers = (matrix[0] || []).map(String);
  if (!headers.includes('erp_item_code') || !headers.includes('product_name')) {
    throw new Error(`${SHEET_NAME} requires erp_item_code and product_name headers`);
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error(`${SHEET_NAME} contains duplicate headers`);
  }
  const rows = matrix.slice(1).map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => [header, cells[index] === undefined ? '' : cells[index]]),
    ),
  );
  return { workbook, headers, rows };
}

function buildCategorization(inputPath, referencePath) {
  const input = loadProductList(inputPath);
  const referenceInput = loadProductList(referencePath);
  if (!referenceInput.headers.includes('category')) {
    throw new Error('Category reference requires a category header');
  }
  const reference = buildPriceCategoryReference(referenceInput.rows);
  return { ...input, result: applyCategoryStage(input.rows, reference) };
}

function analyzeWorkbook(inputPath, referencePath) {
  return buildCategorization(inputPath, referencePath).result.summary;
}

function outputHeaders(headers) {
  if (headers.includes('category')) {
    return headers;
  }
  const productNameIndex = headers.indexOf('product_name');
  return [
    ...headers.slice(0, productNameIndex + 1),
    'category',
    ...headers.slice(productNameIndex + 1),
  ];
}

function makeDataSheet(headers, rows) {
  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? '')),
  ]);
  worksheet['!autofilter'] = { ref: worksheet['!ref'] };
  return worksheet;
}

function makeReviewSheet(reviewRows) {
  return XLSX.utils.json_to_sheet(
    reviewRows.map((row) => ({
      erp_item_code: row.erpItemCode,
      product_name: row.productName,
      reason: row.reason,
    })),
    { header: ['erp_item_code', 'product_name', 'reason'] },
  );
}

function categorizeWorkbook({ inputPath, referencePath, outputPath, reviewPath }) {
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error('Input and output paths must differ');
  }
  const { workbook, headers, result } = buildCategorization(inputPath, referencePath);
  const headersWithCategory = outputHeaders(headers);
  workbook.Sheets[SHEET_NAME] = makeDataSheet(headersWithCategory, result.rows);
  if (!workbook.SheetNames.includes(REVIEW_SHEET_NAME)) {
    workbook.SheetNames.push(REVIEW_SHEET_NAME);
  }
  workbook.Sheets[REVIEW_SHEET_NAME] = makeReviewSheet(result.reviewRows);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  XLSX.writeFile(workbook, outputPath, { compression: true });
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(reviewPath, XLSX.utils.sheet_to_csv(workbook.Sheets[REVIEW_SHEET_NAME]), 'utf8');
  return result.summary;
}

function printUsage() {
  process.stdout.write(`Usage:
  node packages/api/scripts/categorize-steel-products.cjs [options]

Options:
  --input <xlsx>      Product list input
  --reference <xlsx>  Confirmed category reference workbook
  --output <xlsx>     Categorized output workbook
  --review <csv>      Unknown-category review rows
  --write             Write output; default is dry-run
`);
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printUsage();
    } else if (options.write) {
      process.stdout.write(`${JSON.stringify(categorizeWorkbook(options), null, 2)}\n`);
    } else {
      process.stdout.write(
        `${JSON.stringify({ mode: 'dry-run', ...analyzeWorkbook(options.inputPath, options.referencePath) }, null, 2)}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_INPUT_PATH,
  DEFAULT_REFERENCE_PATH,
  DEFAULT_OUTPUT_PATH,
  DEFAULT_REVIEW_PATH,
  analyzeWorkbook,
  categorizeWorkbook,
  loadProductList,
  parseArgs,
};
