#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
require('ts-node/register/transpile-only');

const XLSX = require('xlsx');
const { createSteelPostgresPool } = require('../src/steel/postgres');
const {
  ALLOWED_SELECTOR_AXES,
  CANONICAL_CUTTING_HEADERS,
  EXPECTED_CUTTING_PRICE_RECONCILIATION,
  buildCuttingSpecSelector,
  normalizeCuttingWorkbookRow,
} = require('./lib/cutting-normalize.cjs');

const PRICE_SHEET = 'cutting_prices';
const DEFAULT_WORKBOOK_PATH = path.resolve(__dirname, '../../../docs/reference/切工價錢-v4.4-normalized.xlsx');
const EXPECTED_HEADERS = CANONICAL_CUTTING_HEADERS;
const INSERT_COLUMNS = Object.freeze([
  'cutting_category', 'record_type', 'item_name', 'cut_type', 'spec_text', 'normalized_spec_text',
  'inch_min', 'inch_max', 'mm_min', 'mm_max', 'thickness_axis', 'thickness_mm_values',
  'thickness_mm_min', 'thickness_mm_max', 'unit', 'unit_price_a', 'unit_price_b', 'unit_price_c',
  'unit_price_f', 'conditions', 'spec_selector', 'calculation_rule', 'notes', 'source_sheet', 'source_row',
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

function selectorError(message, location) {
  throw new Error(`Invalid spec_selector_json at ${location}: ${message}`);
}

function object(value, label, location) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') selectorError(`${label} must be an object`, location);
}

function exactKeys(value, expected, label, location) {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) selectorError(`${label} has unexpected keys`, location);
}

function positive(value, label, location) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) selectorError(`${label} must be a positive finite number`, location);
}

function parseSelector(value, location) {
  const text = required(value, 'spec_selector_json', location);
  let selector;
  try { selector = JSON.parse(text); } catch { selectorError('must be valid JSON', location); }
  object(selector, 'selector', location);
  if (selector.version !== 1 || selector.match !== 'any') selectorError('version must be 1 and match must be any', location);
  exactKeys(selector, ['version', 'match', 'selectors'], 'selector', location);
  if (!Array.isArray(selector.selectors) || selector.selectors.length === 0) selectorError('selectors must be a nonempty array', location);
  selector.selectors.forEach((entry, index) => {
    object(entry, `selectors[${index}]`, location);
    exactKeys(entry, ['type', 'axes'], `selectors[${index}]`, location);
    if (entry.type !== 'axis_constraints') selectorError(`selectors[${index}].type is unsupported`, location);
    object(entry.axes, `selectors[${index}].axes`, location);
    const axes = Object.keys(entry.axes);
    if (!axes.length || axes.some((axis) => !ALLOWED_SELECTOR_AXES.includes(axis))) selectorError('selector contains unsupported axes', location);
    axes.forEach((axis) => {
      const constraint = entry.axes[axis];
      object(constraint, `${axis} constraint`, location);
      if (constraint.kind === 'exact' || constraint.kind === 'minimum') {
        const expected = constraint.kind === 'exact' ? ['kind', 'value'] : ['kind', 'value', 'inclusive'];
        exactKeys(constraint, expected, `${axis} constraint`, location);
        positive(constraint.value, `${axis}.value`, location);
        if (constraint.kind === 'minimum' && constraint.inclusive !== true) selectorError(`${axis}.inclusive must be true`, location);
      } else if (constraint.kind === 'one_of') {
        exactKeys(constraint, ['kind', 'values'], `${axis} constraint`, location);
        if (!Array.isArray(constraint.values) || !constraint.values.length) selectorError(`${axis}.values must be nonempty`, location);
        constraint.values.forEach((valueItem, valueIndex) => positive(valueItem, `${axis}.values[${valueIndex}]`, location));
        if (new Set(constraint.values).size !== constraint.values.length || constraint.values.some((item, i) => i > 0 && item <= constraint.values[i - 1])) selectorError(`${axis}.values must be sorted and unique`, location);
      } else if (constraint.kind === 'range') {
        exactKeys(constraint, ['kind', 'min', 'max', 'min_inclusive', 'max_inclusive'], `${axis} constraint`, location);
        positive(constraint.min, `${axis}.min`, location); positive(constraint.max, `${axis}.max`, location);
        if (constraint.min > constraint.max || constraint.min_inclusive !== true || constraint.max_inclusive !== true) selectorError(`${axis} range must be positive ordered inclusive`, location);
      } else selectorError(`${axis}.kind is unsupported`, location);
    });
  });
  return selector;
}

function parseConditions(value, location) {
  const text = parseNullableText(value) ?? '{}';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Invalid conditions_json at ${location}`); }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(`conditions_json must be an object at ${location}`);
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
  const unrestricted = row.cuttingCategory === 'H型鋼' && ['加工/孔', '加工/倒角', '加工/開槽'].includes(row.cutType);
  if (unrestricted ? row.mmMin !== null || row.mmMax !== null : row.mmMin === null || row.mmMax === null) throw new Error(`Primary mm selector requirement failed at ${location}`);
  const hasValues = row.thicknessValues !== null;
  const hasBounds = row.thicknessMin !== null || row.thicknessMax !== null;
  if ((row.thicknessAxis === null && (hasValues || hasBounds)) || (row.thicknessAxis !== null && !hasValues && !hasBounds)) throw new Error(`thickness_axis coupling failed at ${location}`);
  if (hasValues && hasBounds) throw new Error(`thickness values/bounds are mutually exclusive at ${location}`);
  if (row.thicknessAxis !== null && !['material', 'flange'].includes(row.thicknessAxis)) throw new Error(`Invalid thickness_axis at ${location}`);
  if (hasBounds && (row.thicknessMin !== null && row.thicknessMin <= 0 || row.thicknessMax !== null && row.thicknessMax <= 0 || row.thicknessMin !== null && row.thicknessMax !== null && row.thicknessMin > row.thicknessMax)) throw new Error(`Invalid thickness bounds at ${location}`);
}

function parseWorkbookRow(raw, sheetName, cleanRow) {
  const location = `${sheetName}:${cleanRow}`;
  const recordType = required(raw.record_type, 'record_type', location);
  if (recordType !== 'price') throw new Error(`Only price records are allowed at ${location}`);
  const row = {
    cuttingCategory: required(raw.cutting_category, 'cutting_category', location),
    recordType,
    itemName: required(raw.item_name, 'item_name', location),
    cutType: required(raw.cut_type, 'cut_type', location),
    specText: parseNullableText(raw.spec_text),
    normalizedSpecText: parseNullableText(raw.normalized_spec_text),
    inchMin: number(raw.inch_min, 'inch_min', location), inchMax: number(raw.inch_max, 'inch_max', location),
    mmMin: number(raw.mm_min, 'mm_min', location), mmMax: number(raw.mm_max, 'mm_max', location),
    thicknessAxis: parseNullableText(raw.thickness_axis), thicknessValues: parseThicknessValues(raw.thickness_mm_values, location),
    thicknessMin: number(raw.thickness_mm_min, 'thickness_mm_min', location), thicknessMax: number(raw.thickness_mm_max, 'thickness_mm_max', location),
    unit: required(raw.unit, 'unit', location),
    unitPriceA: number(raw.unit_price_a, 'unit_price_a', location), unitPriceB: number(raw.unit_price_b, 'unit_price_b', location),
    unitPriceC: number(raw.unit_price_c, 'unit_price_c', location), unitPriceF: number(raw.unit_price_f, 'unit_price_f', location),
    conditions: parseConditions(raw.conditions_json, location), calculationRule: parseNullableText(raw.calculation_rule), notes: parseNullableText(raw.notes),
    sourceSheet: required(raw.source_sheet, 'source_sheet', location), sourceRow: number(raw.source_row, 'source_row', location),
  };
  if (row.unit !== '刀' || !Number.isInteger(row.sourceRow) || row.sourceRow < 1) throw new Error(`Invalid unit/source_row at ${location}`);
  for (const price of [row.unitPriceA, row.unitPriceB, row.unitPriceC, row.unitPriceF]) if (price !== null && price < 0) throw new Error(`Cutting price must be nonnegative at ${location}`);
  validateSizing(row, location);
  const selector = parseSelector(raw.spec_selector_json, location);
  let normalized;
  try { normalized = normalizeCuttingWorkbookRow(raw); } catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)} at ${location}`); }
  const normalizedConditions = JSON.parse(normalized.conditions_json);
  if (
    normalized.normalized_spec_text !== row.normalizedSpecText
    || !isDeepStrictEqual(normalizedConditions, row.conditions)
    || normalized.thickness_axis !== row.thicknessAxis
    || normalized.thickness_mm_values !== (row.thicknessValues ? JSON.stringify(row.thicknessValues) : null)
    || normalized.thickness_mm_min !== row.thicknessMin
    || normalized.thickness_mm_max !== row.thicknessMax
    || normalized.mm_min !== row.mmMin
    || normalized.mm_max !== row.mmMax
    || normalized.inch_min !== row.inchMin
    || normalized.inch_max !== row.inchMax
  ) throw new Error(`Normalized sizing/conditions mismatch at ${location}`);
  const expectedSelector = JSON.parse(buildCuttingSpecSelector(raw));
  if (!isDeepStrictEqual(selector, expectedSelector)) selectorError('selector axes do not match category/cut_type/spec semantics', location);
  row.specSelector = selector;
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
  const byCategory = {}; const axisDistribution = {}; let mmRangeRows = 0; let unrestrictedRows = 0; let thicknessConstrainedRows = 0;
  for (const row of rows) {
    byCategory[row.cuttingCategory] = (byCategory[row.cuttingCategory] || 0) + 1;
    if (row.mmMin === null) unrestrictedRows += 1; else mmRangeRows += 1;
    if (row.thicknessAxis !== null) thicknessConstrainedRows += 1;
    for (const selector of row.specSelector.selectors) { const axes = Object.keys(selector.axes).join('+'); axisDistribution[axes] = (axisDistribution[axes] || 0) + 1; }
  }
  return { mode: 'dry-run', workbookPath, importRows: rows.length, priceRows: rows.filter((row) => row.recordType === 'price').length, supplementRows: 0, byCategory, mmRangeRows, unrestrictedRows, thicknessConstrainedRows, axisDistribution };
}

function validateExpectedReconciliation(summary) {
  const categoryMatches = Object.entries(EXPECTED_RECONCILIATION.byCategory)
    .every(([category, count]) => summary.byCategory[category] === count);
  if (
    summary.importRows !== EXPECTED_RECONCILIATION.importRows
    || summary.priceRows !== EXPECTED_RECONCILIATION.priceRows
    || summary.supplementRows !== EXPECTED_RECONCILIATION.supplementRows
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
  return [row.cuttingCategory, row.recordType, row.itemName, row.cutType, row.specText, row.normalizedSpecText, row.inchMin, row.inchMax, row.mmMin, row.mmMax, row.thicknessAxis, row.thicknessValues, row.thicknessMin, row.thicknessMax, row.unit, row.unitPriceA, row.unitPriceB, row.unitPriceC, row.unitPriceF, JSON.stringify(row.conditions), JSON.stringify(row.specSelector), row.calculationRule, row.notes, row.sourceSheet, row.sourceRow];
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
    const result = await client.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE record_type = 'price')::int AS price, COUNT(*) FILTER (WHERE record_type = 'supplement')::int AS supplement FROM steel.cutting_prices");
    const readback = result.rows[0] || {};
    if (Number(readback.total) !== 100 || Number(readback.price) !== 100 || Number(readback.supplement) !== 0) throw new Error(`Steel cutting price readback mismatch: ${JSON.stringify(readback)}`);
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
  parseSelector,
  replaceSteelCuttingPrices,
  validateExpectedReconciliation,
};
if (require.main === module) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
