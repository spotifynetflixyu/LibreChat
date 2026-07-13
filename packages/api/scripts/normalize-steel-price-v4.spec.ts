import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

interface NormalizerModule {
  DEFAULT_INPUT_PATH: string;
  analyzeWorkbook: (inputPath: string) => { rowCount: number; pendingReviewCount: number };
  normalizeWorkbook: (options: { inputPath: string; outputPath: string; reviewPath?: string }) => {
    rowCount: number;
    pendingReviewCount: number;
    categoryMismatchCount: number;
    unclassifiedSubcategoryCount: number;
    changedCategoryCount: number;
  };
  parseArgs: (argv: readonly string[]) => {
    write: boolean;
    inputPath: string;
    outputPath: string;
    reviewPath: string;
  };
}

const normalizer = jest.requireActual<NormalizerModule>('./normalize-steel-price-v4.cjs');
const tempDirectories: string[] = [];

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

afterAll(() => {
  for (const directory of tempDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Steel price v4 workbook normalizer script', () => {
  it('defaults to read-only mode and requires an explicit write flag', () => {
    expect(normalizer.parseArgs([]).write).toBe(false);
    expect(normalizer.parseArgs(['--write']).write).toBe(true);
    expect(normalizer.analyzeWorkbook(normalizer.DEFAULT_INPUT_PATH).rowCount).toBe(6761);
  });

  it('rejects writing over the source workbook', () => {
    expect(() =>
      normalizer.normalizeWorkbook({
        inputPath: normalizer.DEFAULT_INPUT_PATH,
        outputPath: normalizer.DEFAULT_INPUT_PATH,
      }),
    ).toThrow('must differ');
  });

  it('writes an independent 43-column workbook and review CSV without changing the input', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steel-v4-normalize-'));
    tempDirectories.push(directory);
    const outputPath = path.join(directory, 'products_db_v4.4.xlsx');
    const reviewPath = path.join(directory, 'products_db_v4.4.pending-review.csv');
    const secondOutputPath = path.join(directory, 'products_db_v4.4-second.xlsx');
    const secondReviewPath = path.join(directory, 'products_db_v4.4-second.pending-review.csv');
    const beforeHash = sha256(normalizer.DEFAULT_INPUT_PATH);

    const summary = normalizer.normalizeWorkbook({
      inputPath: normalizer.DEFAULT_INPUT_PATH,
      outputPath,
      reviewPath,
    });

    expect(summary.rowCount).toBe(6761);
    expect(summary.pendingReviewCount).toBe(0);
    expect(summary.categoryMismatchCount).toBe(0);
    expect(summary.unclassifiedSubcategoryCount).toBe(0);
    expect(summary.changedCategoryCount).toBe(46);
    expect(sha256(normalizer.DEFAULT_INPUT_PATH)).toBe(beforeHash);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.existsSync(reviewPath)).toBe(true);

    const workbook = XLSX.readFile(outputPath, { raw: false });
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.products_db_ready!, {
      header: 1,
      defval: '',
      raw: false,
    });
    const headers = matrix[0] as string[];
    expect(headers).toHaveLength(43);
    expect(
      headers.slice(headers.indexOf('subcategory'), headers.indexOf('subcategory') + 4),
    ).toEqual(['subcategory', 'processing_method', 'processing_shape', 'material']);
    expect(
      headers.slice(headers.indexOf('source_thickness'), headers.indexOf('source_thickness') + 3),
    ).toEqual(['source_thickness', 'thicknessMinMm', 'thicknessMaxMm']);
    expect(workbook.SheetNames).toContain('待確認');
    const outputRows = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets.products_db_ready!,
      { defval: '', raw: false },
    );
    const byErp = new Map(outputRows.map((row) => [row.erp_item_code, row]));
    const waveMeshSubcategories = new Set(
      outputRows
        .filter((row) => row.category === '網' && row.product_name.includes('浪型網'))
        .map((row) => row.subcategory),
    );
    expect(waveMeshSubcategories).toEqual(new Set(['浪型']));
    expect(byErp.get('AX0290')).toMatchObject({ category: '門窗/門板' });
    expect(byErp.get('AX0291')).toMatchObject({ category: '門窗/門板' });
    expect(byErp.get('AX0292')).toMatchObject({ category: '五金/配件', subcategory: '螺絲' });
    expect(byErp.get('CNB01')).toMatchObject({ category: '板/浪板' });
    expect(byErp.get('CNBG08')).toMatchObject({ category: '板/浪板' });
    expect(byErp.get('DNB60')).toMatchObject({
      category: '加工/倒角',
      subcategory: '鐵板',
      processing_method: '剪床',
    });
    expect(byErp.get('KZZB12')).toMatchObject({ category: '加工/倒角', subcategory: '通用' });
    expect(byErp.get('AXPBA')).toMatchObject({ category: '門窗/門板', subcategory: '門花' });
    expect(byErp.get('BLZZO2')).toMatchObject({
      category: '加工/切工',
      subcategory: '鐵板',
      processing_method: '雷射',
      processing_shape: '外形切割',
    });
    expect(byErp.get('KZZA16')).toMatchObject({
      category: '加工/其他',
      subcategory: '雷射畫線',
    });
    expect(byErp.get('KA05')).toMatchObject({ category: '加工/焊接', subcategory: '通用' });
    expect(byErp.get('BKZZE26')).toMatchObject({
      category: '門窗/門板',
      subcategory: '加工/孔',
    });
    expect(byErp.get('FEV1220201')).toMatchObject({
      category: '五金/配件',
      subcategory: '加工/孔',
    });
    expect(byErp.get('DZA00')).toMatchObject({ category: '加工/孔', subcategory: '鐵板' });
    expect(byErp.get('A9')).toMatchObject({ category: '加工/其他', subcategory: '其他' });
    expect(byErp.get('CCG02')).toMatchObject({ category: '加工/其他', subcategory: 'C型鋼' });
    expect(byErp.get('FSA0001')).toMatchObject({ category: '加工/其他', subcategory: '其他' });
    expect(byErp.get('FFQ0620')).toMatchObject({ category: '門窗/門板' });
    expect(byErp.get('FFQ0625')).toMatchObject({ category: '門窗/門板' });
    expect(byErp.get('FFQ0630')).toMatchObject({ category: '門窗/門板' });
    expect(byErp.get('FLS002')).toMatchObject({ category: '五金/配件' });
    expect(
      outputRows.filter(
        (row) =>
          row.erp_item_code.startsWith('AX') && row.product_name.trim() && !row.subcategory.trim(),
      ),
    ).toEqual([]);
    const reviewHeaders = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['待確認']!, {
      header: 1,
      defval: '',
      raw: false,
    })[0];
    expect(reviewHeaders).toEqual([
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
    ]);
    const reviewRows = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets['待確認']!,
      {
        defval: '',
        raw: false,
      },
    );
    expect(reviewRows).toEqual([]);

    normalizer.normalizeWorkbook({
      inputPath: outputPath,
      outputPath: secondOutputPath,
      reviewPath: secondReviewPath,
    });
    const secondWorkbook = XLSX.readFile(secondOutputPath, { raw: false });
    const secondMatrix = XLSX.utils.sheet_to_json<unknown[]>(
      secondWorkbook.Sheets.products_db_ready!,
      {
        header: 1,
        defval: '',
        raw: false,
      },
    );
    expect(secondMatrix).toEqual(matrix);
  });
});
