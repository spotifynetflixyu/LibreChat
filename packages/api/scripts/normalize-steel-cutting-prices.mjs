#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { FileBlob, SpreadsheetFile } = await import(
  pathToFileURL(require.resolve('@oai/artifact-tool')).href
);
const { normalizeCuttingWorkbookRow } = require('./lib/cutting-normalize.cjs');
const { enableCuttingHeaderFilters } = require('./lib/workbook-filters.cjs');

const DEFAULT_INPUT_PATH = path.resolve(
  import.meta.dirname,
  '../../../docs/reference/切工價錢-clean.xlsx',
);
const DEFAULT_OUTPUT_PATH = path.resolve(
  import.meta.dirname,
  '../../../docs/reference/切工價錢-v4.4-normalized.xlsx',
);
const EXPECTED_SHEETS = ['cutting_prices', 'cutting_supplements'];

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const inputPath = path.resolve(optionValue(argv, '--input') ?? DEFAULT_INPUT_PATH);
  const outputPath = path.resolve(optionValue(argv, '--output') ?? DEFAULT_OUTPUT_PATH);
  if (inputPath === outputPath) {
    throw new Error('Cutting workbook normalization requires a separate output path');
  }
  return { inputPath, outputPath };
}

async function normalizeWorkbook({ inputPath, outputPath }) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
  const sheets = [];

  for (const sheetName of EXPECTED_SHEETS) {
    const sheet = workbook.worksheets.getItem(sheetName);
    const used = sheet.getUsedRange(true);
    const matrix = used.values;
    const headers = matrix[0].map(String);
    const normalizedRows = matrix.slice(1).map((cells) => {
      const source = Object.fromEntries(
        headers.map((header, index) => [header, cells[index] ?? '']),
      );
      const normalized = normalizeCuttingWorkbookRow(source);
      return headers.map((header) => normalized[header] ?? '');
    });
    used.values = [headers, ...normalizedRows];
    enableCuttingHeaderFilters(sheet, used, sheetName);
    sheets.push({ sheetName, rowCount: normalizedRows.length, columnCount: headers.length });
  }

  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(outputPath);
  await fs.rm(`${outputPath}.inspect.ndjson`, { force: true });
  return { inputPath, outputPath, sheets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  normalizeWorkbook(parseArgs(process.argv.slice(2)))
    .then((summary) => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}

export { DEFAULT_INPUT_PATH, DEFAULT_OUTPUT_PATH, normalizeWorkbook, parseArgs };
