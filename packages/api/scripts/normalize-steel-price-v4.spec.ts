import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

import type { SteelPriceV4WorkbookRow } from '../src/steel/pricing/v4';

interface NormalizerModule {
  DEFAULT_INPUT_PATH: string;
  DEFAULT_OUTPUT_PATH: string;
  DEFAULT_ENRICHMENT_PATH: string;
  analyzeWorkbook: (
    inputPath: string,
    enrichmentPath?: string,
  ) => { rowCount: number; pendingReviewCount: number };
  loadEnrichment: (enrichmentPath: string) => ReadonlyMap<string, Record<string, string | number>>;
  normalizeWorkbook: (options: {
    inputPath: string;
    outputPath: string;
    enrichmentPath?: string;
    reviewPath?: string;
  }) => Promise<{
    rowCount: number;
    pendingReviewCount: number;
    categoryMismatchCount: number;
    unclassifiedSubcategoryCount: number;
    changedCategoryCount: number;
  }>;
  parseArgs: (argv: readonly string[]) => {
    write: boolean;
    inputPath: string;
    outputPath: string;
    enrichmentPath: string;
    reviewPath: string;
  };
}

interface ImporterModule {
  loadWorkbookRows: (workbookPath: string) => SteelPriceV4WorkbookRow[];
}

const normalizer = jest.requireActual<NormalizerModule>('./normalize-steel-price-v4.cjs');
const importer = jest.requireActual<ImporterModule>('./import-steel-price-v4.cjs');
const goldenWorkbookPath = path.resolve(__dirname, '../../../docs/reference/products_db_v4.4.xlsx');
const tempDirectories: string[] = [];

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function workbookMatrix(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
    header: 1,
    defval: '',
    raw: false,
  });
}

afterAll(() => {
  for (const directory of tempDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Steel price v4 workbook normalizer script', () => {
  it('defaults to the strict 0701 raw source and read-only mode', () => {
    const options = normalizer.parseArgs([]);

    expect(options.write).toBe(false);
    expect(options.inputPath).toBe(path.resolve(__dirname, '../../../docs/reference/0701.xlsx'));
    expect(options.outputPath).toBe(goldenWorkbookPath);
    expect(options.enrichmentPath).toBe(normalizer.DEFAULT_ENRICHMENT_PATH);
    expect(normalizer.parseArgs(['--write']).write).toBe(true);
    expect(normalizer.analyzeWorkbook(normalizer.DEFAULT_INPUT_PATH)).toMatchObject({
      rowCount: 6761,
      pendingReviewCount: 0,
    });
    expect(normalizer.loadEnrichment(normalizer.DEFAULT_ENRICHMENT_PATH).size).toBe(6761);
  });

  it('rejects overwriting the raw source and rejects the retired normalized input contract', async () => {
    await expect(
      normalizer.normalizeWorkbook({
        inputPath: normalizer.DEFAULT_INPUT_PATH,
        outputPath: normalizer.DEFAULT_INPUT_PATH,
      }),
    ).rejects.toThrow('must differ');
    expect(() => normalizer.analyzeWorkbook(goldenWorkbookPath)).toThrow('missing 工作表2 sheet');
  });

  it('rejects duplicate ERP codes before indexing the enrichment baseline', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steel-v4-enrichment-'));
    tempDirectories.push(directory);
    const enrichmentPath = path.join(directory, 'duplicate-enrichment.json');
    const records = JSON.parse(
      fs.readFileSync(normalizer.DEFAULT_ENRICHMENT_PATH, 'utf8'),
    ) as Array<Record<string, string | number>>;
    fs.writeFileSync(enrichmentPath, JSON.stringify([...records, records[0]]), 'utf8');

    expect(() => normalizer.analyzeWorkbook(normalizer.DEFAULT_INPUT_PATH, enrichmentPath)).toThrow(
      'Duplicate Steel price enrichment ERP code',
    );
  });

  it('converts 0701 into the exact current 41-column data and workbook format', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steel-v4-normalize-'));
    tempDirectories.push(directory);
    const outputPath = path.join(directory, 'products_db_v4.4.xlsx');
    const reviewPath = path.join(directory, 'products_db_v4.4.pending-review.csv');
    const rawHash = sha256(normalizer.DEFAULT_INPUT_PATH);
    const enrichmentHash = sha256(normalizer.DEFAULT_ENRICHMENT_PATH);

    const summary = await normalizer.normalizeWorkbook({
      inputPath: normalizer.DEFAULT_INPUT_PATH,
      outputPath,
      reviewPath,
    });

    expect(summary).toMatchObject({
      rowCount: 6761,
      pendingReviewCount: 0,
      categoryMismatchCount: 0,
      unclassifiedSubcategoryCount: 0,
      changedCategoryCount: 0,
    });
    expect(sha256(normalizer.DEFAULT_INPUT_PATH)).toBe(rawHash);
    expect(sha256(normalizer.DEFAULT_ENRICHMENT_PATH)).toBe(enrichmentHash);

    const workbook = XLSX.readFile(outputPath, { raw: false });
    const goldenWorkbook = XLSX.readFile(goldenWorkbookPath, { raw: false });
    expect(workbook.SheetNames).toEqual(['products_db_ready', '待確認']);
    expect(workbookMatrix(workbook, 'products_db_ready')).toEqual(
      workbookMatrix(goldenWorkbook, 'products_db_ready'),
    );
    expect(workbookMatrix(workbook, 'products_db_ready')[0]).toHaveLength(41);
    expect(fs.readFileSync(reviewPath, 'utf8')).toBe(
      'row,erp_item_code,product_name,current_category,inferred_category,proposed_subcategory,reason,suggested_action,confirmed_category,review_note',
    );

    const retiredHeaders = new Set([
      'source_row_key',
      'source_dataset',
      'source_refs',
      'normalized_spec_text',
      'dimension_signature',
      'source_thickness',
      'active',
      'imported_at',
      'created_at',
      'updated_at',
    ]);
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName]!;
      expect(worksheet['!autofilter']).toEqual({ ref: worksheet['!ref'] });
      const [headers = []] = workbookMatrix(workbook, sheetName) as string[][];
      expect(headers.filter((header) => retiredHeaders.has(header))).toEqual([]);
    }

    const outputRows = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets.products_db_ready!,
      { defval: '', raw: false },
    );
    const outputRowsByCode = new Map(outputRows.map((row) => [row.erp_item_code, row]));
    expect(outputRowsByCode.get('CCG01')).toMatchObject({
      unit: 'M',
    });
    expect(outputRowsByCode.get('DNB40')).toMatchObject({
      formula_code: 'BH',
      category: '鐵板',
      subcategory: '切板',
      material: 'OT 黑鐵',
    });
    for (const erpItemCode of ['DNB20', 'DNB2001', 'DNB2002', 'DNB2003']) {
      expect(outputRowsByCode.get(erpItemCode)).toMatchObject({
        formula_code: 'BH',
        category: '鐵板',
        subcategory: '切圓',
        material: 'OT 黑鐵',
        spec_key: expect.stringContaining('切圓'),
      });
    }
    for (const erpItemCode of ['DNB30', 'DNB3001', 'DNB3002', 'DNB3003']) {
      expect(outputRowsByCode.get(erpItemCode)).toMatchObject({
        formula_code: 'BH',
        category: '鐵板',
        subcategory: '切內外圓',
        material: 'OT 黑鐵',
        spec_key: expect.stringContaining('切內外圓'),
      });
    }
    expect(importer.loadWorkbookRows(outputPath)).toHaveLength(6761);

    const styledWorkbook = new ExcelJS.Workbook();
    await styledWorkbook.xlsx.readFile(outputPath);
    const styledSheet = styledWorkbook.getWorksheet('products_db_ready');
    expect(styledSheet?.getCell('A2').fill).toBeUndefined();
    expect(styledSheet?.getCell('A3').fill).toMatchObject({
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    });
    expect(styledSheet?.getCell('AO3').fill).toMatchObject({
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    });
    expect(styledSheet?.getCell('A4').fill).toBeUndefined();
  });
});
