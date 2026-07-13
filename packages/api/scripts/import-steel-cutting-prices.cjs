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

const { createSteelPostgresPool } = require('../src/steel/postgres');
const { normalizeCuttingWorkbookRow } = require('./lib/cutting-normalize.cjs');

const PRICE_SHEET = 'cutting_prices';
const SUPPLEMENT_SHEET = 'cutting_supplements';
const DEFAULT_WORKBOOK_PATH = path.resolve(
  __dirname,
  '../../../docs/切工價錢-v4.4-normalized.xlsx',
);
const EXPECTED_HEADERS = Object.freeze([
  'cutting_category',
  'record_type',
  'item_name',
  'cut_type',
  'spec_text',
  'normalized_spec_text',
  'inch_min',
  'inch_max',
  'mm_min',
  'mm_max',
  'unit',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_f',
  'conditions_json',
  'calculation_rule',
  'notes',
  'source_sheet',
  'source_row',
]);
const INSERT_COLUMNS = Object.freeze([
  'cutting_category',
  'record_type',
  'item_name',
  'cut_type',
  'spec_text',
  'normalized_spec_text',
  'inch_min',
  'inch_max',
  'mm_min',
  'mm_max',
  'unit',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_f',
  'conditions',
  'calculation_rule',
  'notes',
  'source_sheet',
  'source_row',
]);
const EXPECTED_RECONCILIATION = Object.freeze({
  importRows: 119,
  priceRows: 100,
  supplementRows: 19,
});

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const explicitDryRun = argv.includes('--dry-run');
  const help = argv.includes('--help') || argv.includes('-h');
  const workbookIndex = argv.indexOf('--workbook');
  const workbookArg = workbookIndex >= 0 ? argv[workbookIndex + 1] : undefined;

  if (apply && explicitDryRun) {
    throw new Error('Use either --dry-run or --apply, not both.');
  }
  if (workbookIndex >= 0 && (!workbookArg || workbookArg.startsWith('--'))) {
    throw new Error('--workbook requires a path.');
  }

  const knownArgs = new Set(['--apply', '--dry-run', '--help', '-h', '--workbook', workbookArg]);
  const unknownArg = argv.find((arg) => !knownArgs.has(arg));
  if (unknownArg) {
    throw new Error(`Unknown argument: ${unknownArg}`);
  }

  return {
    apply,
    dryRun: !apply,
    help,
    workbookPath: workbookArg ? path.resolve(workbookArg) : DEFAULT_WORKBOOK_PATH,
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  node packages/api/scripts/import-steel-cutting-prices.cjs --dry-run [--workbook <path>]
  node packages/api/scripts/import-steel-cutting-prices.cjs --apply [--workbook <path>]

Default workbook:
  ${DEFAULT_WORKBOOK_PATH}

Default mode is --dry-run. --apply validates both complete clean sheets before
opening one transaction that replaces steel.cutting_prices.
`);
}

function parseNullableText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = String(value).normalize('NFKC').trim();
  return parsed || null;
}

function parseRequiredText(value, field, location) {
  const parsed = parseNullableText(value);
  if (parsed === null) {
    throw new Error(`Missing ${field} at ${location}`);
  }
  return parsed;
}

function parseNullableNumber(value, field, location) {
  const text = parseNullableText(value);
  if (text === null) {
    return null;
  }
  const parsed = Number(text.replace(/,/gu, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${field} at ${location}: ${text}`);
  }
  return parsed;
}

function parseRecordType(value, location) {
  const recordType = parseRequiredText(value, 'record_type', location);
  if (recordType !== 'price' && recordType !== 'supplement') {
    throw new Error(`Unknown cutting record_type: ${recordType}`);
  }
  return recordType;
}

function parseConditions(value, location) {
  const text = parseNullableText(value) ?? '{}';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Invalid conditions_json at ${location}`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`conditions_json must be an object at ${location}`);
  }
  return parsed;
}

function validateRanges(row, location) {
  const pairs = [
    ['inch', row.inchMin, row.inchMax],
    ['mm', row.mmMin, row.mmMax],
  ];
  for (const [label, min, max] of pairs) {
    if ((min === null) !== (max === null)) {
      throw new Error(`${label}_min and ${label}_max must both be set at ${location}`);
    }
    if (min !== null && max !== null && min > max) {
      throw new Error(`${label}_min exceeds ${label}_max at ${location}`);
    }
  }

  if (row.inchMin !== null) {
    const expectedMin = Math.round(row.inchMin * 25.4 * 1_000_000_000) / 1_000_000_000;
    const expectedMax = Math.round(row.inchMax * 25.4 * 1_000_000_000) / 1_000_000_000;
    if (row.mmMin !== expectedMin || row.mmMax !== expectedMax) {
      throw new Error(`inch/mm conversion mismatch at ${location}`);
    }
  }
}

function parseWorkbookRow(raw, cleanSheet, cleanRow) {
  const location = `${cleanSheet}:${cleanRow}`;
  const recordType = parseRecordType(raw.record_type, location);
  const sourceSheet = parseRequiredText(raw.source_sheet, 'source_sheet', location);
  const sourceRow = parseNullableNumber(raw.source_row, 'source_row', location);
  if (!Number.isInteger(sourceRow) || sourceRow < 1) {
    throw new Error(`source_row must be a positive integer at ${location}`);
  }

  const row = {
    cuttingCategory: parseRequiredText(raw.cutting_category, 'cutting_category', location),
    recordType,
    itemName: parseRequiredText(raw.item_name, 'item_name', location),
    cutType: parseRequiredText(raw.cut_type, 'cut_type', location),
    specText: parseNullableText(raw.spec_text),
    normalizedSpecText: parseNullableText(raw.normalized_spec_text),
    inchMin: parseNullableNumber(raw.inch_min, 'inch_min', location),
    inchMax: parseNullableNumber(raw.inch_max, 'inch_max', location),
    mmMin: parseNullableNumber(raw.mm_min, 'mm_min', location),
    mmMax: parseNullableNumber(raw.mm_max, 'mm_max', location),
    unit: parseNullableText(raw.unit),
    unitPriceA: parseNullableNumber(raw.unit_price_a, 'unit_price_a', location),
    unitPriceB: parseNullableNumber(raw.unit_price_b, 'unit_price_b', location),
    unitPriceC: parseNullableNumber(raw.unit_price_c, 'unit_price_c', location),
    unitPriceF: parseNullableNumber(raw.unit_price_f, 'unit_price_f', location),
    conditions: parseConditions(raw.conditions_json, location),
    calculationRule: parseNullableText(raw.calculation_rule),
    notes: parseNullableText(raw.notes),
    sourceSheet,
    sourceRow,
  };

  validateRanges(row, location);
  const prices = [row.unitPriceA, row.unitPriceB, row.unitPriceC, row.unitPriceF];
  if (prices.some((price) => price !== null && price < 0)) {
    throw new Error(`Cutting price must be nonnegative at ${location}`);
  }
  if (
    recordType === 'supplement' &&
    (row.unit !== null || prices.some((price) => price !== null))
  ) {
    throw new Error(`Cutting supplement cannot contain unit prices at ${location}`);
  }

  return row;
}

function readSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Workbook missing ${sheetName} sheet`);
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const headers = (matrix[0] || []).map((value) => String(value));
  const exactHeaders =
    headers.length === EXPECTED_HEADERS.length &&
    headers.every((header, index) => header === EXPECTED_HEADERS[index]);
  if (!exactHeaders) {
    throw new Error(`${sheetName} headers do not match the exact cutting catalog contract`);
  }

  return matrix.slice(1).map((cells, index) => {
    const raw = Object.fromEntries(
      EXPECTED_HEADERS.map((header, column) => [header, cells[column] ?? '']),
    );
    return parseWorkbookRow(normalizeCuttingWorkbookRow(raw), sheetName, index + 2);
  });
}

function loadWorkbookRows(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { raw: false, cellDates: false });
  const rows = [...readSheet(workbook, PRICE_SHEET), ...readSheet(workbook, SUPPLEMENT_SHEET)];
  const sourceIdentities = new Set();
  for (const row of rows) {
    const identity = `${row.sourceSheet}:${row.sourceRow}`;
    if (sourceIdentities.has(identity)) {
      throw new Error(`Duplicate cutting source row: ${identity}`);
    }
    sourceIdentities.add(identity);
  }
  return rows;
}

function buildDryRunSummary(rows, workbookPath) {
  const byCategory = {};
  let priceRows = 0;
  let supplementRows = 0;
  for (const row of rows) {
    if (row.recordType === 'price') {
      priceRows += 1;
    } else {
      supplementRows += 1;
    }
    byCategory[row.cuttingCategory] = (byCategory[row.cuttingCategory] || 0) + 1;
  }

  return {
    mode: 'dry-run',
    workbookPath,
    importRows: rows.length,
    priceRows,
    supplementRows,
    byCategory,
  };
}

function validateExpectedReconciliation(summary) {
  const matches =
    summary.importRows === EXPECTED_RECONCILIATION.importRows &&
    summary.priceRows === EXPECTED_RECONCILIATION.priceRows &&
    summary.supplementRows === EXPECTED_RECONCILIATION.supplementRows;
  if (!matches) {
    throw new Error(
      `Steel cutting price reconciliation mismatch: expected ${JSON.stringify(EXPECTED_RECONCILIATION)}, received ${JSON.stringify(summary)}`,
    );
  }
}

function toDbValues(row) {
  return [
    row.cuttingCategory,
    row.recordType,
    row.itemName,
    row.cutType,
    row.specText,
    row.normalizedSpecText,
    row.inchMin,
    row.inchMax,
    row.mmMin,
    row.mmMax,
    row.unit,
    row.unitPriceA,
    row.unitPriceB,
    row.unitPriceC,
    row.unitPriceF,
    JSON.stringify(row.conditions),
    row.calculationRule,
    row.notes,
    row.sourceSheet,
    row.sourceRow,
  ];
}

function buildInsert(batch) {
  const values = [];
  const placeholders = batch.map((row, rowIndex) => {
    const rowValues = toDbValues(row);
    const offset = rowIndex * INSERT_COLUMNS.length;
    values.push(...rowValues);
    return `(${rowValues.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`;
  });
  return {
    sql: `INSERT INTO steel.cutting_prices (${INSERT_COLUMNS.join(', ')})\nVALUES ${placeholders.join(',\n')}`,
    values,
  };
}

async function replaceSteelCuttingPrices(client, rows) {
  const expected = buildDryRunSummary(rows, '').priceRows;
  const expectedSupplements = rows.length - expected;

  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('steel.cutting_prices:replace'))");
    await client.query('LOCK TABLE steel.cutting_prices IN ACCESS EXCLUSIVE MODE');
    await client.query('TRUNCATE TABLE steel.cutting_prices RESTART IDENTITY');
    const insert = buildInsert(rows);
    await client.query(insert.sql, insert.values);

    const result = await client.query(`
SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE record_type = 'price')::int AS price,
  COUNT(*) FILTER (WHERE record_type = 'supplement')::int AS supplement
FROM steel.cutting_prices
`);
    const readback = result.rows[0] || {};
    const matches =
      Number(readback.total) === rows.length &&
      Number(readback.price) === expected &&
      Number(readback.supplement) === expectedSupplements;
    if (!matches) {
      throw new Error(
        `Steel cutting price readback mismatch: expected ${JSON.stringify({ total: rows.length, price: expected, supplement: expectedSupplements })}, received ${JSON.stringify(readback)}`,
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function loadRootEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
}

async function importWorkbook(options) {
  const write = options.write || ((value) => process.stdout.write(value));
  if (!fs.existsSync(options.workbookPath)) {
    throw new Error(`Workbook not found: ${options.workbookPath}`);
  }

  const rows = loadWorkbookRows(options.workbookPath);
  const dryRunSummary = buildDryRunSummary(rows, options.workbookPath);
  const summary = options.apply ? { ...dryRunSummary, mode: 'apply' } : dryRunSummary;
  write(`${JSON.stringify(summary, null, 2)}\n`);
  validateExpectedReconciliation(dryRunSummary);
  if (!options.apply) {
    return summary;
  }

  loadRootEnv();
  const pool = (options.createPool || createSteelPostgresPool)();
  let client;
  try {
    client = await pool.connect();
    await replaceSteelCuttingPrices(client, rows);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  await importWorkbook({ apply: args.apply, workbookPath: args.workbookPath });
}

module.exports = {
  DEFAULT_WORKBOOK_PATH,
  EXPECTED_HEADERS,
  buildDryRunSummary,
  importWorkbook,
  loadWorkbookRows,
  parseArgs,
  replaceSteelCuttingPrices,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
