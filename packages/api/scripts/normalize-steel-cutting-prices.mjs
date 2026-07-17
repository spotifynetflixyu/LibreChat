#!/usr/bin/env node

import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const {
  CANONICAL_CUTTING_HEADERS,
  EXPECTED_CUTTING_PRICE_RECONCILIATION,
  mapRawCuttingRow,
} = require('./lib/cutting-normalize.cjs');

const DEFAULT_INPUT_PATH = path.resolve(import.meta.dirname, '../../../docs/reference/切工價錢-raw.xlsm');
const DEFAULT_OUTPUT_PATH = path.resolve(import.meta.dirname, '../../../docs/reference/切工價錢-v4.4-normalized.xlsx');
const RAW_SHEET = '全部整理資料';

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function parseArgs(argv) {
  const inputPath = path.resolve(optionValue(argv, '--input') ?? DEFAULT_INPUT_PATH);
  const outputPath = path.resolve(optionValue(argv, '--output') ?? DEFAULT_OUTPUT_PATH);
  if (inputPath === outputPath) throw new Error('Cutting workbook normalization requires a separate output path');
  return { inputPath, outputPath };
}

function sourceRowsFromWorkbook(workbook) {
  const sheet = workbook.Sheets[RAW_SHEET];
  if (!sheet) throw new Error(`Workbook missing ${RAW_SHEET} sheet`);
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const headers = matrix[0]?.map(String) ?? [];
  const expected = ['來源區塊', '品項/尺寸', '加工', 'tier A/C/F', 'tier B', '備註'];
  if (headers.length !== expected.length || headers.some((header, index) => header !== expected[index])) {
    throw new Error('Raw 全部整理資料 headers do not match the exact cutting catalog contract');
  }
  return matrix.slice(1).map((cells, index) => ({
    sourceRow: index + 2,
    raw: Object.fromEntries(expected.map((header, column) => [header, cells[column] ?? ''])),
  }));
}

function mapRawRows(inputPath) {
  const workbook = XLSX.readFile(inputPath, { raw: false, cellDates: false });
  return sourceRowsFromWorkbook(workbook)
    .map(({ raw, sourceRow }) => mapRawCuttingRow(raw, sourceRow))
    .filter(Boolean);
}

function validateNormalizedRows(rows) {
  const byCategory = {};
  const sourceRows = new Set();
  let mmRangeRows = 0;
  let unrestrictedRows = 0;
  let thicknessConstrainedRows = 0;
  for (const row of rows) {
    if (row.record_type !== 'price' || row.unit !== '刀') {
      throw new Error(`Invalid price contract at ${row.source_sheet}:${row.source_row}`);
    }
    if (sourceRows.has(row.source_row)) {
      throw new Error(`Duplicate cutting source row: ${row.source_row}`);
    }
    sourceRows.add(row.source_row);
    byCategory[row.cutting_category] = (byCategory[row.cutting_category] ?? 0) + 1;
    if (row.mm_min === null) unrestrictedRows += 1;
    else mmRangeRows += 1;
    if (row.thickness_axis !== null) thicknessConstrainedRows += 1;
  }
  const expected = EXPECTED_CUTTING_PRICE_RECONCILIATION;
  const categoryMatches =
    Object.keys(byCategory).length === Object.keys(expected.byCategory).length
    && Object.entries(expected.byCategory)
      .every(([category, count]) => byCategory[category] === count);
  if (
    rows.length !== expected.importRows
    || mmRangeRows !== expected.mmRangeRows
    || unrestrictedRows !== expected.unrestrictedRows
    || thicknessConstrainedRows !== expected.thicknessConstrainedRows
    || !categoryMatches
  ) {
    throw new Error(
      `Cutting normalization reconciliation mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify({
        importRows: rows.length,
        byCategory,
        mmRangeRows,
        unrestrictedRows,
        thicknessConstrainedRows,
      })}`,
    );
  }
}

async function writeNormalizedWorkbook(rows, outputPath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('cutting_prices', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.addTable({
    name: 'CuttingPricesTable',
    ref: 'A1',
    headerRow: true,
    style: {
      theme: 'TableStyleMedium2',
      showRowStripes: true,
    },
    columns: CANONICAL_CUTTING_HEADERS.map((name) => ({ name, filterButton: true })),
    rows: rows.map((row) =>
      CANONICAL_CUTTING_HEADERS.map((header) => row[header] ?? null),
    ),
  });
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9EAF7' },
  };
  sheet.columns.forEach((column, index) => {
    if (index < 6) column.width = 16;
    else if (index < 19) column.width = 12;
    else if (index === 19 || index === 24) column.width = 48;
    else if (index === 20) column.width = 20;
    else if (index === 21 || index === 22) column.width = 24;
    else column.width = 10;
  });
  await workbook.xlsx.writeFile(outputPath);
}

async function normalizeWorkbook({ inputPath, outputPath }) {
  const rows = mapRawRows(inputPath);
  validateNormalizedRows(rows);
  await writeNormalizedWorkbook(rows, outputPath);
  return { inputPath, outputPath, sheet: 'cutting_prices', rowCount: rows.length, columnCount: CANONICAL_CUTTING_HEADERS.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  normalizeWorkbook(parseArgs(process.argv.slice(2)))
    .then((summary) => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}

export {
  DEFAULT_INPUT_PATH,
  DEFAULT_OUTPUT_PATH,
  mapRawRows,
  normalizeWorkbook,
  parseArgs,
  validateNormalizedRows,
  writeNormalizedWorkbook,
};
