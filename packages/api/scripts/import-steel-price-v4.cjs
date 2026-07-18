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
const { buildSteelPriceV4Rows, steelPriceV4WorkbookHeaders } = require('../src/steel/pricing/v4');

const SHEET_NAME = 'products_db_ready';
const DEFAULT_WORKBOOK_PATH = path.resolve(
  __dirname,
  '../../../docs/reference/products_db_v4.4.xlsx',
);
const EXPECTED_HEADERS = steelPriceV4WorkbookHeaders;
const INPUT_HEADERS = EXPECTED_HEADERS;
const EXPECTED_RECONCILIATION = Object.freeze({
  importRows: 6761,
  duplicateErpItemCodes: 0,
  byValueState: Object.freeze({
    confirmed: 4787,
    ratio_only: 190,
    no_price: 1784,
  }),
});
const INSERT_COLUMNS = Object.freeze([
  'erp_item_code',
  'formula_code',
  'product_name',
  'spec_key',
  'category',
  'subcategory',
  'processing_method',
  'processing_shape',
  'material',
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
  'thickness_min_mm',
  'thickness_max_mm',
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
  node packages/api/scripts/import-steel-price-v4.cjs --dry-run [--workbook <path>]
  node packages/api/scripts/import-steel-price-v4.cjs --apply [--workbook <path>]

Default workbook:
  ${DEFAULT_WORKBOOK_PATH}

Default mode is --dry-run. --apply validates the complete workbook before opening
one transaction that reconciles steel.prices to the exact workbook ERP set and verifies readback.
`);
}

function loadWorkbookRows(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, {
    raw: false,
    cellDates: false,
  });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(`${workbookPath} missing ${SHEET_NAME} sheet`);
  }

  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  const headers = (matrix[0] || []).map((value) => String(value));
  const exactHeaders =
    headers.length === EXPECTED_HEADERS.length &&
    headers.every((header, index) => header === EXPECTED_HEADERS[index]);

  if (!exactHeaders) {
    throw new Error(`${SHEET_NAME} headers do not match the normalized v4.4 contract`);
  }

  return matrix
    .slice(1)
    .map((cells) =>
      Object.fromEntries(
        INPUT_HEADERS.map((header) => [
          header,
          cells[headers.indexOf(header)] === undefined ? '' : cells[headers.indexOf(header)],
        ]),
      ),
    );
}

function buildReconciliationCounts(rows) {
  const seen = new Set();
  const counts = {
    duplicateErpItemCodes: 0,
    byValueState: {
      confirmed: 0,
      ratio_only: 0,
      no_price: 0,
    },
  };

  for (const row of rows) {
    if (seen.has(row.erpItemCode)) {
      counts.duplicateErpItemCodes += 1;
    } else {
      seen.add(row.erpItemCode);
    }

    counts.byValueState[row.valueState] += 1;
  }

  return counts;
}

function buildDryRunSummary(rows, workbookPath) {
  const counts = buildReconciliationCounts(rows);

  return {
    mode: 'dry-run',
    workbookPath,
    sheet: SHEET_NAME,
    importRows: rows.length,
    ...counts,
  };
}

function validateExpectedReconciliation(summary) {
  const matches =
    summary.importRows === EXPECTED_RECONCILIATION.importRows &&
    summary.duplicateErpItemCodes === EXPECTED_RECONCILIATION.duplicateErpItemCodes &&
    summary.byValueState.confirmed === EXPECTED_RECONCILIATION.byValueState.confirmed &&
    summary.byValueState.ratio_only === EXPECTED_RECONCILIATION.byValueState.ratio_only &&
    summary.byValueState.no_price === EXPECTED_RECONCILIATION.byValueState.no_price;

  if (!matches) {
    throw new Error(
      `Steel price v4.4 reconciliation mismatch: expected ${JSON.stringify(EXPECTED_RECONCILIATION)}, received ${JSON.stringify(summary)}`,
    );
  }
}

function toDbValues(row) {
  return [
    row.erpItemCode,
    row.formulaCode,
    row.productName,
    row.specKey,
    row.category,
    row.subcategory || null,
    row.processingMethod,
    row.processingShape,
    row.material,
    row.unit,
    row.valueState,
    row.unitPriceBase,
    row.unitPriceA,
    row.unitPriceB,
    row.unitPriceC,
    row.unitPriceD,
    row.unitPriceE,
    row.unitPriceF,
    row.priceRatioA,
    row.priceRatioB,
    row.priceRatioC,
    row.priceRatioD,
    row.priceRatioE,
    row.priceRatioF,
    row.unitWeightValue,
    row.unitWeightBasis,
    row.density,
    row.thicknessMinMm,
    row.thicknessMaxMm,
    row.widthMm,
    row.heightMm,
    row.lengthMm,
    row.outerDiameterMm,
    row.nominalInch,
    row.webMm,
    row.flangeMm,
    row.lipMm,
    row.sheetWidthMm,
    row.sheetLengthMm,
    row.specSortKey,
    row.costBasis,
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

  const updateColumns = INSERT_COLUMNS.filter((column) => column !== 'erp_item_code');

  return {
    sql: `INSERT INTO steel.prices (${INSERT_COLUMNS.join(', ')})
VALUES ${placeholders.join(',\n')}
ON CONFLICT (erp_item_code) DO UPDATE SET
${updateColumns.map((column) => `  ${column} = EXCLUDED.${column}`).join(',\n')}`,
    values,
  };
}

async function insertRows(client, rows) {
  const batchSize = 500;

  for (let index = 0; index < rows.length; index += batchSize) {
    const insert = buildInsert(rows.slice(index, index + batchSize));
    await client.query(insert.sql, insert.values);
  }
}

function buildReadbackExpectation(rows) {
  const counts = buildReconciliationCounts(rows);

  return {
    total: rows.length,
    ...counts.byValueState,
  };
}

function readbackMatches(actual, expected) {
  return Object.entries(expected).every(([key, value]) => Number(actual[key]) === value);
}

async function replaceSteelPrices(client, rows) {
  const expectedReadback = buildReadbackExpectation(rows);

  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('steel.prices:replace'))");
    await insertRows(client, rows);
    await client.query(
      'DELETE FROM steel.prices WHERE NOT (erp_item_code = ANY($1::text[]))',
      [rows.map((row) => row.erpItemCode)],
    );

    const result = await client.query(`
SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE value_state = 'confirmed')::int AS confirmed,
  COUNT(*) FILTER (WHERE value_state = 'ratio_only')::int AS ratio_only,
  COUNT(*) FILTER (WHERE value_state = 'no_price')::int AS no_price
FROM steel.prices
`);
    const readback = result.rows[0] || {};
    if (!readbackMatches(readback, expectedReadback)) {
      throw new Error(
        `Steel price v4.4 readback mismatch: expected ${JSON.stringify(expectedReadback)}, received ${JSON.stringify(readback)}`,
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

  const workbookRows = loadWorkbookRows(options.workbookPath);
  const rows = buildSteelPriceV4Rows(workbookRows);
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
    await replaceSteelPrices(client, rows);
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

  await importWorkbook({
    apply: args.apply,
    workbookPath: args.workbookPath,
  });
}

module.exports = {
  DEFAULT_WORKBOOK_PATH,
  EXPECTED_HEADERS,
  buildDryRunSummary,
  importWorkbook,
  loadWorkbookRows,
  parseArgs,
  replaceSteelPrices,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
