#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
require('ts-node/register/transpile-only');

const XLSX = require('xlsx');
const { createSteelPostgresPool } = require('../src/steel/postgres');
const {
  CANONICAL_CUTTING_HEADERS,
  EXPECTED_CUTTING_PRICE_RECONCILIATION,
  normalizeCuttingWorkbookRow,
} = require('./lib/cutting-normalize.cjs');

const PRICE_SHEET = 'cutting_prices';
const DEFAULT_WORKBOOK_PATH = path.resolve(__dirname, '../../../docs/reference/切工價錢-v4.4-normalized.xlsx');
const EXPECTED_HEADERS = CANONICAL_CUTTING_HEADERS;
const INSERT_COLUMNS = Object.freeze([
  'cutting_category', 'item_name', 'cut_type', 'spec_text',
  'inch_min', 'inch_max', 'mm_min', 'mm_max', 'height_mm', 'width_mm', 'thickness_mm_values',
  'thickness_mm_min', 'thickness_mm_max', 'unit', 'unit_price_a', 'unit_price_b', 'unit_price_c',
  'unit_price_f', 'notes',
]);
const EXPECTED_RECONCILIATION = EXPECTED_CUTTING_PRICE_RECONCILIATION;

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const explicitDryRun = argv.includes('--dry-run');
  if (apply && explicitDryRun) throw new Error('Use either --dry-run or --apply, not both.');
  const index = argv.indexOf('--workbook');
  const workbookArg = index >= 0 ? argv[index + 1] : undefined;
  if (index >= 0 && (!workbookArg || workbookArg.startsWith('--'))) throw new Error('--workbook requires a path.');
  const known = new Set(['--apply', '--dry-run', '--help', '-h', '--workbook', workbookArg]);
  const unknown = argv.find((arg) => !known.has(arg));
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);
  return { apply, dryRun: !apply, help: argv.includes('--help') || argv.includes('-h'), workbookPath: workbookArg ? path.resolve(workbookArg) : DEFAULT_WORKBOOK_PATH };
}

function parseNullableText(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).normalize('NFKC').trim();
  return parsed || null;
}

function required(value, field, location) {
  const parsed = parseNullableText(value);
  if (parsed === null) throw new Error(`Missing ${field} at ${location}`);
  return parsed;
}

function number(value, field, location) {
  const text = parseNullableText(value);
  if (text === null) return null;
  const parsed = Number(text.replace(/,/gu, ''));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${field} at ${location}: ${text}`);
  return parsed;
}

function parseThicknessValues(value, location) {
  const text = parseNullableText(value);
  if (text === null) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Invalid thickness_mm_values at ${location}`); }
  if (!Array.isArray(parsed) || !parsed.length || parsed.some((item) => typeof item !== 'number' || !Number.isFinite(item) || item <= 0)) throw new Error(`thickness_mm_values must be nonempty positive array at ${location}`);
  if (new Set(parsed).size !== parsed.length || parsed.some((item, index) => index > 0 && item <= parsed[index - 1])) throw new Error(`thickness_mm_values must be sorted and unique at ${location}`);
  return parsed;
}

function validateSizing(row, location) {
  for (const label of ['inch', 'mm']) {
    const min = row[`${label}Min`]; const max = row[`${label}Max`];
    if ((min === null) !== (max === null)) throw new Error(`${label}_min and ${label}_max must both be set at ${location}`);
    if (min !== null && (min <= 0 || max <= 0 || min > max)) throw new Error(`Invalid ${label} range at ${location}`);
  }
  if (row.inchMin !== null) {
    const min = Math.round(row.inchMin * 25.4 * 1e9) / 1e9;
    const max = Math.round(row.inchMax * 25.4 * 1e9) / 1e9;
    if (row.mmMin !== min || row.mmMax !== max) throw new Error(`inch/mm conversion mismatch at ${location}`);
  }
  const hFamily = row.cuttingCategory === 'H型鋼' || row.cuttingCategory === '工字鐵/H型鋼';
  const hasHeight = row.heightMm !== null;
  const hasWidth = row.widthMm !== null;
  if (hasHeight !== hasWidth) throw new Error(`height_mm and width_mm must both be set at ${location}`);
  if (hFamily) {
    if (!hasHeight || row.heightMm <= 0 || row.widthMm <= 0) throw new Error(`H-family dimensions are required at ${location}`);
    if (row.inchMin !== null || row.mmMin !== null) throw new Error(`H-family inch/mm ranges must be empty at ${location}`);
  } else {
    if (hasHeight) throw new Error(`Profile dimensions are only valid for H-family rows at ${location}`);
    if (row.mmMin === null || row.mmMax === null) throw new Error(`Primary mm range is required at ${location}`);
  }
  const hasValues = row.thicknessValues !== null;
  const hasBounds = row.thicknessMin !== null || row.thicknessMax !== null;
  if (hasValues && hasBounds) throw new Error(`thickness values/bounds are mutually exclusive at ${location}`);
  if (hasBounds && (row.thicknessMin !== null && row.thicknessMin <= 0 || row.thicknessMax !== null && row.thicknessMax <= 0 || row.thicknessMin !== null && row.thicknessMax !== null && row.thicknessMin > row.thicknessMax)) throw new Error(`Invalid thickness bounds at ${location}`);
}

function parseWorkbookRow(raw, sheetName, cleanRow) {
  const location = `${sheetName}:${cleanRow}`;
  const cutType = required(raw.cut_type, 'cut_type', location);
  if (cutType !== '加工/切工') throw new Error(`Only 加工/切工 records are allowed at ${location}`);
  const row = {
    cuttingCategory: required(raw.cutting_category, 'cutting_category', location),
    itemName: required(raw.item_name, 'item_name', location),
    cutType,
    specText: parseNullableText(raw.spec_text),
    inchMin: number(raw.inch_min, 'inch_min', location), inchMax: number(raw.inch_max, 'inch_max', location),
    mmMin: number(raw.mm_min, 'mm_min', location), mmMax: number(raw.mm_max, 'mm_max', location),
    heightMm: number(raw.height_mm, 'height_mm', location), widthMm: number(raw.width_mm, 'width_mm', location),
    thicknessValues: parseThicknessValues(raw.thickness_mm_values, location),
    thicknessMin: number(raw.thickness_mm_min, 'thickness_mm_min', location), thicknessMax: number(raw.thickness_mm_max, 'thickness_mm_max', location),
    unit: required(raw.unit, 'unit', location),
    unitPriceA: number(raw.unit_price_a, 'unit_price_a', location), unitPriceB: number(raw.unit_price_b, 'unit_price_b', location),
    unitPriceC: number(raw.unit_price_c, 'unit_price_c', location), unitPriceF: number(raw.unit_price_f, 'unit_price_f', location),
    notes: parseNullableText(raw.notes),
  };
  if (row.unit !== '刀') throw new Error(`Invalid unit at ${location}`);
  for (const price of [row.unitPriceA, row.unitPriceB, row.unitPriceC, row.unitPriceF]) if (price !== null && price < 0) throw new Error(`Cutting price must be nonnegative at ${location}`);
  validateSizing(row, location);
  let normalized;
  try { normalized = normalizeCuttingWorkbookRow(raw); } catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)} at ${location}`); }
  if (
    normalized.unit_price_a !== row.unitPriceA
    || normalized.unit_price_b !== row.unitPriceB
    || normalized.unit_price_c !== row.unitPriceC
    || normalized.unit_price_f !== row.unitPriceF
  ) throw new Error(`Normalized prices mismatch at ${location}`);
  if (
    normalized.thickness_mm_values !== (row.thicknessValues ? JSON.stringify(row.thicknessValues) : null)
    || normalized.thickness_mm_min !== row.thicknessMin
    || normalized.thickness_mm_max !== row.thicknessMax
    || normalized.mm_min !== row.mmMin
    || normalized.mm_max !== row.mmMax
    || normalized.inch_min !== row.inchMin
    || normalized.inch_max !== row.inchMax
    || normalized.height_mm !== row.heightMm
    || normalized.width_mm !== row.widthMm
  ) throw new Error(`Normalized sizing mismatch at ${location}`);
  return row;
}

function readSheet(workbook) {
  const names = workbook.SheetNames;
  if (names.length !== 1 || names[0] !== PRICE_SHEET) throw new Error('Workbook must contain exactly one cutting_prices sheet');
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[PRICE_SHEET], { header: 1, defval: '', raw: false });
  const headers = (matrix[0] || []).map(String);
  if (headers.length !== EXPECTED_HEADERS.length || headers.some((header, index) => header !== EXPECTED_HEADERS[index])) throw new Error('cutting_prices headers do not match the exact cutting catalog contract');
  return matrix.slice(1).filter((cells) => cells.some((cell) => String(cell).trim() !== '')).map((cells, index) => parseWorkbookRow(Object.fromEntries(EXPECTED_HEADERS.map((header, column) => [header, cells[column] ?? ''])), PRICE_SHEET, index + 2));
}

function loadWorkbookRows(workbookPath) {
  return readSheet(XLSX.readFile(workbookPath, { raw: false, cellDates: false }));
}

function buildDryRunSummary(rows, workbookPath) {
  const byCategory = {}; let profileDimensionRows = 0; let mmRangeRows = 0; let unrestrictedRows = 0; let thicknessConstrainedRows = 0;
  for (const row of rows) {
    byCategory[row.cuttingCategory] = (byCategory[row.cuttingCategory] || 0) + 1;
    if (row.heightMm !== null) profileDimensionRows += 1;
    else if (row.mmMin !== null) mmRangeRows += 1;
    else unrestrictedRows += 1;
    if (row.thicknessValues !== null || row.thicknessMin !== null || row.thicknessMax !== null) thicknessConstrainedRows += 1;
  }
  return { mode: 'dry-run', workbookPath, importRows: rows.length, byCategory, profileDimensionRows, mmRangeRows, unrestrictedRows, thicknessConstrainedRows };
}

function validateExpectedReconciliation(summary) {
  const categoryMatches = Object.entries(EXPECTED_RECONCILIATION.byCategory)
    .every(([category, count]) => summary.byCategory[category] === count);
  if (
    summary.importRows !== EXPECTED_RECONCILIATION.importRows
    || summary.profileDimensionRows !== EXPECTED_RECONCILIATION.profileDimensionRows
    || summary.mmRangeRows !== EXPECTED_RECONCILIATION.mmRangeRows
    || summary.unrestrictedRows !== EXPECTED_RECONCILIATION.unrestrictedRows
    || summary.thicknessConstrainedRows !== EXPECTED_RECONCILIATION.thicknessConstrainedRows
    || Object.keys(summary.byCategory).length !== Object.keys(EXPECTED_RECONCILIATION.byCategory).length
    || !categoryMatches
  ) {
    throw new Error(`Steel cutting price reconciliation mismatch: expected ${JSON.stringify(EXPECTED_RECONCILIATION)}, received ${JSON.stringify(summary)}`);
  }
}

function toDbValues(row) {
  return [row.cuttingCategory, row.itemName, row.cutType, row.specText, row.inchMin, row.inchMax, row.mmMin, row.mmMax, row.heightMm, row.widthMm, row.thicknessValues, row.thicknessMin, row.thicknessMax, row.unit, row.unitPriceA, row.unitPriceB, row.unitPriceC, row.unitPriceF, row.notes];
}

function buildInsert(batch) {
  const values = []; const placeholders = batch.map((row, rowIndex) => { const rowValues = toDbValues(row); const offset = rowIndex * INSERT_COLUMNS.length; values.push(...rowValues); return `(${rowValues.map((_, index) => `$${offset + index + 1}`).join(', ')})`; });
  return { sql: `INSERT INTO steel.cutting_prices (${INSERT_COLUMNS.join(', ')}) VALUES ${placeholders.join(', ')}`, values };
}

async function replaceSteelCuttingPrices(client, rows) {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('steel.cutting_prices:replace'))");
    await client.query('LOCK TABLE steel.cutting_prices IN ACCESS EXCLUSIVE MODE');
    await client.query('TRUNCATE TABLE steel.cutting_prices RESTART IDENTITY');
    const insert = buildInsert(rows); await client.query(insert.sql, insert.values);
    const result = await client.query('SELECT COUNT(*)::int AS total FROM steel.cutting_prices');
    const readback = result.rows[0] || {};
    if (
      Number(readback.total) !== EXPECTED_RECONCILIATION.importRows
    ) throw new Error(`Steel cutting price readback mismatch: ${JSON.stringify(readback)}`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

function loadRootEnv() { const envPath = path.resolve(__dirname, '../../../.env'); if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath }); }

async function importWorkbook(options) {
  if (!fs.existsSync(options.workbookPath)) throw new Error(`Workbook not found: ${options.workbookPath}`);
  const rows = loadWorkbookRows(options.workbookPath); const dryRunSummary = buildDryRunSummary(rows, options.workbookPath); validateExpectedReconciliation(dryRunSummary);
  const summary = { ...dryRunSummary, mode: options.apply ? 'apply' : 'dry-run' }; (options.write || ((value) => process.stdout.write(value)))(`${JSON.stringify(summary, null, 2)}\n`);
  if (!options.apply) return summary;
  loadRootEnv(); const pool = (options.createPool || createSteelPostgresPool)(); let client;
  try { client = await pool.connect(); await replaceSteelCuttingPrices(client, rows); } finally { if (client) client.release(); await pool.end(); }
  return summary;
}

async function main() { const args = parseArgs(process.argv.slice(2)); if (args.help) return; await importWorkbook({ apply: args.apply, workbookPath: args.workbookPath }); }

module.exports = {
  DEFAULT_WORKBOOK_PATH,
  EXPECTED_HEADERS,
  buildDryRunSummary,
  importWorkbook,
  loadWorkbookRows,
  parseArgs,
  replaceSteelCuttingPrices,
  validateExpectedReconciliation,
};
if (require.main === module) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
