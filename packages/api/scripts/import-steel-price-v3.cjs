#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
process.env.TS_NODE_TRANSPILE_ONLY = 'true';

require('ts-node/register/transpile-only');

const JSZip = require('jszip');
const XLSX = require('xlsx');

const { createSteelPostgresPool } = require('../src/steel/postgres');
const { buildSteelPriceImportRows } = require('../src/steel/pricing/import');

const defaultZipPath = '/Users/neven/Downloads/產品價格_分類檔案_v3-20260623T075539Z-3-001.zip';

function findRepoRoot(startDir) {
  let current = startDir;

  while (current !== path.dirname(current)) {
    const packageJson = path.join(current, 'package.json');
    if (fs.existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
        if (parsed.name === 'LibreChat') {
          return current;
        }
      } catch {
        return current;
      }
    }

    current = path.dirname(current);
  }

  return process.cwd();
}

function loadRootEnv(repoRoot) {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  require('dotenv').config({ path: envPath });
}

function parseArgs(argv) {
  const zipIndex = argv.findIndex((arg) => arg === '--zip');
  const workbookIndex = argv.findIndex((arg) => arg === '--workbook');
  const erpCodesIndex = argv.findIndex((arg) => arg === '--erp-codes');
  const zipPath = zipIndex >= 0 ? argv[zipIndex + 1] : defaultZipPath;
  const workbookPath = workbookIndex >= 0 ? argv[workbookIndex + 1] : undefined;
  const erpCodes =
    erpCodesIndex >= 0 && argv[erpCodesIndex + 1]
      ? argv[erpCodesIndex + 1]
          .split(',')
          .map((code) => code.trim())
          .filter(Boolean)
      : [];

  return {
    apply: argv.includes('--apply'),
    dryRun: argv.includes('--dry-run') || !argv.includes('--apply'),
    erpCodes,
    help: argv.includes('--help') || argv.includes('-h'),
    replaceWorkbook: argv.includes('--replace-workbook'),
    workbookPath,
    zipPath,
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  node packages/api/scripts/import-steel-price-v3.cjs --dry-run --zip <path>
  node packages/api/scripts/import-steel-price-v3.cjs --apply --zip <path>
  node packages/api/scripts/import-steel-price-v3.cjs --dry-run --workbook <path> --erp-codes <code,code>
  node packages/api/scripts/import-steel-price-v3.cjs --apply --workbook <path> --erp-codes <code,code>
  node packages/api/scripts/import-steel-price-v3.cjs --dry-run --workbook <path> --replace-workbook
  node packages/api/scripts/import-steel-price-v3.cjs --apply --workbook <path> --replace-workbook

Default ZIP:
  ${defaultZipPath}

Default mode is --dry-run. --apply truncates steel.prices and imports product
price v3 rows into the unified prices table using STEEL_POSTGRES_URL.

When --workbook is used, --erp-codes or --replace-workbook is required for
--apply. ERP-code mode deletes only those ERP codes from steel.prices.
Replace-workbook mode deletes rows whose source_row_key belongs to the workbook,
then inserts every parsed row from that workbook.
	`);
}

function rowsToObjects(rows) {
  const headers = (rows[0] || []).map((header) => String(header || '').trim());

  return rows.slice(1).map((cells, index) => {
    const row = {};
    headers.forEach((header, cellIndex) => {
      if (header) {
        row[header] = cells[cellIndex] ?? '';
      }
    });

    return {
      row,
      worksheetRowNumber: index + 2,
    };
  });
}

async function loadWorkbookRows(zipPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && /\.xlsm$/i.test(entry.name),
  );
  const workbookRows = [];

  for (const entry of entries) {
    const workbook = XLSX.read(await entry.async('nodebuffer'), {
      type: 'buffer',
      raw: false,
      cellDates: false,
    });
    const sheet = workbook.Sheets['整理後資料'];
    if (!sheet) {
      throw new Error(`${entry.name} missing 整理後資料 sheet`);
    }

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    rowsToObjects(rows).forEach((row) => {
      workbookRows.push({
        workbookName: entry.name,
        worksheetRowNumber: row.worksheetRowNumber,
        row: row.row,
      });
    });
  }

  return workbookRows;
}

function toSingleWorkbookName(workbookPath) {
  const parentName = path.basename(path.dirname(workbookPath));
  const workbookName = path.basename(workbookPath);

  return parentName ? `${parentName}/${workbookName}` : workbookName;
}

async function loadSingleWorkbookRows(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, {
    raw: false,
    cellDates: false,
  });
  const sheet = workbook.Sheets['整理後資料'];
  if (!sheet) {
    throw new Error(`${workbookPath} missing 整理後資料 sheet`);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  const workbookName = toSingleWorkbookName(workbookPath);

  return rowsToObjects(rows).map((row) => ({
    workbookName,
    worksheetRowNumber: row.worksheetRowNumber,
    row: row.row,
  }));
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = row[key] ?? null;
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function isNonEmptyWorkbookRow(input) {
  return Boolean(String(input.row['型號'] ?? '').trim() || String(input.row['品名規格'] ?? '').trim());
}

function filterByErpCodes(rows, erpCodes) {
  if (erpCodes.length === 0) {
    return rows;
  }

  const codes = new Set(erpCodes);
  return rows.filter((row) => row.erpItemCode && codes.has(row.erpItemCode));
}

function getMissingErpCodes(rows, erpCodes) {
  if (erpCodes.length === 0) {
    return [];
  }

  const found = new Set(rows.map((row) => row.erpItemCode).filter(Boolean));
  return erpCodes.filter((code) => !found.has(code));
}

function printSummary({ rows, mode, rawRows, nonEmptyRows, erpCodes, missingErpCodes }) {
  process.stdout.write(
    JSON.stringify(
      {
        mode,
        requestedErpCodes: erpCodes,
        missingErpCodes,
        rawRows,
        nonEmptyRows,
        importRows: rows.length,
        skippedRows: rawRows - rows.length,
        skippedNonEmptyRows: nonEmptyRows - rows.length,
        active: rows.filter((row) => row.active).length,
        inactive: rows.filter((row) => !row.active).length,
        byPriceKind: countBy(rows, 'priceKind'),
        byValueState: countBy(rows, 'valueState'),
        byReviewState: countBy(rows, 'reviewState'),
        bySubcategory: countBy(rows, 'subcategory'),
        categoryCount: Object.keys(countBy(rows, 'category')).length,
        materialCount: Object.keys(countBy(rows, 'material')).length,
      },
      null,
      2,
    ) + '\n',
  );
}

// Source 比率A-F columns are intentionally ignored; steel.prices stores tier prices only in unit_price_*.
const insertColumns = [
  'price_kind',
  'source_dataset',
  'source_row_key',
  'erp_item_code',
  'product_name',
  'spec_key',
  'category',
  'subcategory',
  'material',
  'source_category_label',
  'source_subcategory_label',
  'source_material_label',
  'source_thickness',
  'source_spec',
  'unit',
  'currency',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_f',
  'product_price_unit_weight',
  'product_price_unit_weight_unit',
  'active',
  'value_state',
  'review_state',
  'metadata',
  'source_refs',
];

function toDbValues(row) {
  return [
    row.priceKind,
    row.sourceDataset,
    row.sourceRowKey,
    row.erpItemCode,
    row.productName,
    row.specKey,
    row.category,
    row.subcategory,
    row.material,
    row.sourceCategoryLabel,
    row.sourceSubcategoryLabel,
    row.sourceMaterialLabel,
    row.sourceThickness,
    row.sourceSpec,
    row.unit,
    row.currency,
    row.unitPriceA,
    row.unitPriceB,
    row.unitPriceC,
    row.unitPriceF,
    row.productPriceUnitWeight,
    row.productPriceUnitWeightUnit,
    row.active,
    row.valueState,
    row.reviewState,
    JSON.stringify(row.metadata),
    JSON.stringify(row.sourceRefs),
  ];
}

function buildInsert(batch) {
  const values = [];
  const placeholders = batch.map((row, rowIndex) => {
    const rowValues = toDbValues(row);
    values.push(...rowValues);
    const offset = rowIndex * insertColumns.length;
    return `(${rowValues.map((_, index) => `$${offset + index + 1}`).join(', ')})`;
  });
  const updates = insertColumns
    .filter((column) => !['source_dataset', 'source_row_key'].includes(column))
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(',\n    ');

  return {
    sql: `
INSERT INTO steel.prices (${insertColumns.join(', ')})
VALUES ${placeholders.join(',\n')}
ON CONFLICT (source_dataset, source_row_key) DO UPDATE SET
    ${updates},
    imported_at = NOW(),
    updated_at = NOW()
`,
    values,
  };
}

async function insertRows(client, rows) {
  const batchSize = 500;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const insert = buildInsert(batch);
    await client.query(insert.sql, insert.values);
  }
}

async function replaceErpCodeRows(client, rows, erpCodes) {
  await client.query('DELETE FROM steel.prices WHERE erp_item_code = ANY($1::text[])', [erpCodes]);
  await insertRows(client, rows);
}

async function replaceWorkbookRows(client, rows, workbookPath) {
  const workbookName = toSingleWorkbookName(workbookPath);
  await client.query(
    `DELETE FROM steel.prices
     WHERE source_dataset = $1
       AND source_row_key LIKE $2`,
    ['product_price_v3', `${workbookName}:整理後資料:%`],
  );
  await insertRows(client, rows);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (args.workbookPath && args.zipPath !== defaultZipPath) {
    throw new Error('Use either --zip or --workbook, not both.');
  }

  if (args.workbookPath && !fs.existsSync(args.workbookPath)) {
    throw new Error(`Workbook not found: ${args.workbookPath}`);
  }

  if (!args.workbookPath && (!args.zipPath || !fs.existsSync(args.zipPath))) {
    throw new Error(`ZIP not found: ${args.zipPath}`);
  }

  if (args.workbookPath && args.erpCodes.length > 0 && args.replaceWorkbook) {
    throw new Error('Use either --erp-codes or --replace-workbook, not both.');
  }

  if (args.workbookPath && args.apply && args.erpCodes.length === 0 && !args.replaceWorkbook) {
    throw new Error('--erp-codes or --replace-workbook is required when applying a single workbook update.');
  }

  loadRootEnv(findRepoRoot(__dirname));

  const workbookRows = args.workbookPath
    ? await loadSingleWorkbookRows(args.workbookPath)
    : await loadWorkbookRows(args.zipPath);
  const allImportRows = buildSteelPriceImportRows(workbookRows);
  const importRows = filterByErpCodes(allImportRows, args.erpCodes);
  const missingErpCodes = getMissingErpCodes(importRows, args.erpCodes);
  printSummary({
    rows: importRows,
    mode: args.dryRun ? 'dry-run' : 'apply',
    rawRows: workbookRows.length,
    nonEmptyRows: workbookRows.filter(isNonEmptyWorkbookRow).length,
    erpCodes: args.erpCodes,
    missingErpCodes,
  });

  if (missingErpCodes.length > 0) {
    throw new Error(`Requested ERP codes missing from import rows: ${missingErpCodes.join(', ')}`);
  }

  if (args.dryRun) {
    return;
  }

  const pool = createSteelPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (args.workbookPath && args.erpCodes.length > 0) {
      await replaceErpCodeRows(client, importRows, args.erpCodes);
    } else if (args.workbookPath) {
      await replaceWorkbookRows(client, importRows, args.workbookPath);
    } else {
      await client.query('TRUNCATE TABLE steel.prices RESTART IDENTITY');
      await insertRows(client, importRows);
    }
    const result = await client.query(`
	SELECT
	  COUNT(*)::int AS total,
	  COUNT(*) FILTER (WHERE active)::int AS active,
  COUNT(*) FILTER (WHERE value_state = 'unknown')::int AS unknown,
  COUNT(DISTINCT category)::int AS categories,
  COUNT(DISTINCT material)::int AS materials
	FROM steel.prices
	`);
    await client.query('COMMIT');
    process.stdout.write(`readback=${JSON.stringify(result.rows[0])}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
