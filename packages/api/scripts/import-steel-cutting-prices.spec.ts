import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

const importer = jest.requireActual<typeof import('./import-steel-cutting-prices.cjs')>('./import-steel-cutting-prices.cjs');
const headers = [...importer.EXPECTED_HEADERS];

function fixture(overrides: Record<string, string | number> = {}) {
  return {
    cutting_category: '鐵管', item_name: '4"', cut_type: '加工/切工', spec_text: '4"',
    inch_min: 4, inch_max: 4, mm_min: 101.6, mm_max: 101.6, height_mm: '', width_mm: '', thickness_mm_values: '', thickness_mm_min: '', thickness_mm_max: '', unit: '刀',
    unit_price_a: 30, unit_price_b: 30, unit_price_c: 30, unit_price_f: 30,
    notes: '',
    ...overrides,
  };
}

function writeWorkbook(row: Record<string, string | number>, sheetNames: string[] = ['cutting_prices']) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cutting-import-'));
  const file = path.join(directory, 'fixture.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, headers.map((header) => row[header] ?? '')]), 'cutting_prices');
  if (sheetNames.includes('cutting_supplements')) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), 'cutting_supplements');
  XLSX.writeFile(workbook, file);
  return { directory, file };
}

describe('price-only cutting importer', () => {
  it('requires exactly one canonical sheet and only accepts 加工/切工 rows', () => {
    const withSupplement = writeWorkbook(fixture(), ['cutting_prices', 'cutting_supplements']);
    expect(() => importer.loadWorkbookRows(withSupplement.file)).toThrow('exactly one cutting_prices sheet');
    fs.rmSync(withSupplement.directory, { recursive: true, force: true });
    const otherOperation = writeWorkbook(fixture({ cut_type: '加工/孔' }));
    expect(() => importer.loadWorkbookRows(otherOperation.file)).toThrow(
      'Only 加工/切工 records are allowed',
    );
    fs.rmSync(otherOperation.directory, { recursive: true, force: true });
  });

  it('validates retained sizing fields and H-family dimensions', () => {
    const bad = writeWorkbook(fixture({ thickness_mm_values: '[9]', thickness_mm_min: 8 }));
    expect(() => importer.loadWorkbookRows(bad.file)).toThrow('mutually exclusive');
    fs.rmSync(bad.directory, { recursive: true, force: true });
    const good = writeWorkbook(fixture());
    expect(importer.loadWorkbookRows(good.file)).toHaveLength(1);
    fs.rmSync(good.directory, { recursive: true, force: true });

    const hFamily = writeWorkbook(fixture({
      cutting_category: 'H型鋼', item_name: '200x100', spec_text: '200x100',
      inch_min: '', inch_max: '', mm_min: '', mm_max: '', height_mm: 200, width_mm: 100,
    }));
    expect(importer.loadWorkbookRows(hFamily.file)).toHaveLength(1);
    fs.rmSync(hFamily.directory, { recursive: true, force: true });

    const missingWidth = writeWorkbook(fixture({
      cutting_category: 'H型鋼', item_name: '200x100', spec_text: '200x100',
      inch_min: '', inch_max: '', mm_min: '', mm_max: '', height_mm: 200, width_mm: '',
    }));
    expect(() => importer.loadWorkbookRows(missingWidth.file)).toThrow(
      'height_mm and width_mm must both be set',
    );
    fs.rmSync(missingWidth.directory, { recursive: true, force: true });
  });

  it('rejects a canonical workbook that leaves tier B blank when tier A has a price', () => {
    const missingTierB = writeWorkbook(fixture({ unit_price_b: '' }));
    expect(() => importer.loadWorkbookRows(missingTierB.file)).toThrow(
      'Normalized prices mismatch',
    );
    fs.rmSync(missingTierB.directory, { recursive: true, force: true });
  });

  it('enforces the complete 97-row reconciliation without depending on a local workbook', () => {
    const summary = {
      importRows: 97,
      byCategory: {
        H型鋼: 19,
        '工字鐵/H型鋼': 31,
        鐵管: 13,
        角鐵: 12,
        槽鐵: 12,
        平鐵: 10,
      },
      profileDimensionRows: 50,
      mmRangeRows: 47,
      unrestrictedRows: 0,
      thicknessConstrainedRows: 11,
    };

    expect(() => importer.validateExpectedReconciliation(summary)).not.toThrow();
    expect(() => importer.validateExpectedReconciliation({
      ...summary,
      byCategory: { ...summary.byCategory, 槽鐵: 11, 鐵板: 1 },
    })).toThrow('Steel cutting price reconciliation mismatch');
  });

  it('rolls back the replacement transaction when readback does not match', async () => {
    const workbook = writeWorkbook(fixture());
    const rows = importer.loadWorkbookRows(workbook.file);
    const statements: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql.trim());
        if (sql.includes('COUNT(*)::int AS total')) {
          return { rows: [{ total: 0 }] };
        }
        return { rows: [] };
      }),
    };

    await expect(importer.replaceSteelCuttingPrices(client, rows)).rejects.toThrow(
      'Steel cutting price readback mismatch',
    );
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    fs.rmSync(workbook.directory, { recursive: true, force: true });
  });
});
