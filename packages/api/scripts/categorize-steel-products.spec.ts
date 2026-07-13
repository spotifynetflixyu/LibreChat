import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

interface CategoryScriptModule {
  categorizeWorkbook: (options: {
    inputPath: string;
    referencePath: string;
    outputPath: string;
    reviewPath: string;
  }) => {
    rowCount: number;
    changedCategoryCount: number;
    unknownCount: number;
    readyForNormalization: boolean;
  };
  parseArgs: (argv: readonly string[]) => {
    write: boolean;
    inputPath: string;
    referencePath: string;
    outputPath: string;
    reviewPath: string;
  };
}

const categoryScript = jest.requireActual<CategoryScriptModule>('./categorize-steel-products.cjs');
const tempDirectories: string[] = [];

function writeWorkbook(
  directory: string,
  fileName: string,
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[...headers], ...rows.map((row) => [...row])]),
    'products_db_ready',
  );
  const workbookPath = path.join(directory, fileName);
  XLSX.writeFile(workbook, workbookPath);
  return workbookPath;
}

afterAll(() => {
  for (const directory of tempDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Steel product category script', () => {
  it('defaults to dry-run and rejects writing over the input', () => {
    expect(categoryScript.parseArgs([]).write).toBe(false);
    const options = categoryScript.parseArgs(['--write']);
    expect(() =>
      categoryScript.categorizeWorkbook({
        ...options,
        outputPath: options.inputPath,
      }),
    ).toThrow('must differ');
  });

  it('writes only category while preserving the product-list schema and row order', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steel-category-stage-'));
    tempDirectories.push(directory);
    const inputPath = writeWorkbook(
      directory,
      'input.xlsx',
      ['erp_item_code', 'product_name', 'unit'],
      [
        ['AX0292', '百葉窗用銅鏍絲', '只'],
        ['TUBE-1', '黑鐵方管 50*50*2.3', '支'],
      ],
    );
    const referencePath = writeWorkbook(
      directory,
      'reference.xlsx',
      ['erp_item_code', 'product_name', 'category', 'unit'],
      [['AX0292', '百葉窗用銅鏍絲', '五金/配件', '只']],
    );
    const outputPath = path.join(directory, 'categorized.xlsx');
    const reviewPath = path.join(directory, 'categorized.pending-review.csv');

    const summary = categoryScript.categorizeWorkbook({
      inputPath,
      referencePath,
      outputPath,
      reviewPath,
    });

    expect(summary).toMatchObject({
      rowCount: 2,
      changedCategoryCount: 2,
      unknownCount: 0,
      readyForNormalization: true,
    });
    const workbook = XLSX.readFile(outputPath, { raw: false });
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.products_db_ready!, {
      header: 1,
      defval: '',
      raw: false,
    });
    expect(matrix).toEqual([
      ['erp_item_code', 'product_name', 'category', 'unit'],
      ['AX0292', '百葉窗用銅鏍絲', '五金/配件', '只'],
      ['TUBE-1', '黑鐵方管 50*50*2.3', '方管', '支'],
    ]);
    expect(workbook.SheetNames).toContain('category_review');
    expect(fs.existsSync(reviewPath)).toBe(true);
  });
});
