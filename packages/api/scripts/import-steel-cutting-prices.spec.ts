import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

const importer = jest.requireActual<typeof import('./import-steel-cutting-prices.cjs')>('./import-steel-cutting-prices.cjs');
const headers = [...importer.EXPECTED_HEADERS];

function fixture(overrides: Record<string, string | number> = {}) {
  return {
    cutting_category: '鐵管', record_type: 'price', item_name: '4"', cut_type: '加工/切工', spec_text: '4"', normalized_spec_text: '4" 直線切割',
    inch_min: 4, inch_max: 4, mm_min: 101.6, mm_max: 101.6, thickness_axis: '', thickness_mm_values: '', thickness_mm_min: '', thickness_mm_max: '', unit: '刀',
    unit_price_a: 30, unit_price_b: '', unit_price_c: 30, unit_price_f: 30,
    conditions_json: '{"applicable_categories":["圓管","方管","扁方管","圓條","方鐵"],"processing_category":"加工/切工","processing_method":null,"processing_shape":"直線切割"}', calculation_rule: '', notes: '', source_sheet: '全部整理資料', source_row: 70,
    spec_selector_json: '{"version":1,"match":"any","selectors":[{"type":"axis_constraints","axes":{"nominal_size_mm":{"kind":"exact","value":101.6}}}]}',
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
  it('requires exactly one canonical sheet and rejects supplements/non-price rows', () => {
    const withSupplement = writeWorkbook(fixture(), ['cutting_prices', 'cutting_supplements']);
    expect(() => importer.loadWorkbookRows(withSupplement.file)).toThrow('exactly one cutting_prices sheet');
    fs.rmSync(withSupplement.directory, { recursive: true, force: true });
    const supplement = writeWorkbook(fixture({ record_type: 'supplement' }));
    expect(() => importer.loadWorkbookRows(supplement.file)).toThrow('Only price records are allowed');
    fs.rmSync(supplement.directory, { recursive: true, force: true });
  });

  it('deep-validates thickness/selector coupling and accepts metric-only sizing', () => {
    const bad = writeWorkbook(fixture({ thickness_axis: 'material', thickness_mm_values: '[9]', thickness_mm_min: '' }));
    expect(() => importer.loadWorkbookRows(bad.file)).toThrow('Normalized sizing/conditions mismatch');
    fs.rmSync(bad.directory, { recursive: true, force: true });
    const badConditions = writeWorkbook(fixture({ conditions_json: '{}' }));
    expect(() => importer.loadWorkbookRows(badConditions.file)).toThrow(
      'Normalized sizing/conditions mismatch',
    );
    fs.rmSync(badConditions.directory, { recursive: true, force: true });
    const good = writeWorkbook(fixture());
    expect(importer.loadWorkbookRows(good.file)).toHaveLength(1);
    fs.rmSync(good.directory, { recursive: true, force: true });
  });

  it('enforces the complete 100-row reconciliation without depending on a local workbook', () => {
    const summary = {
      importRows: 100,
      priceRows: 100,
      supplementRows: 0,
      byCategory: {
        H型鋼: 22,
        '工字鐵/H型鋼': 31,
        鐵管: 13,
        角鐵: 12,
        槽鐵: 12,
        '鐵板/平鐵': 10,
      },
      mmRangeRows: 97,
      unrestrictedRows: 3,
      thicknessConstrainedRows: 14,
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
          return { rows: [{ total: 0, price: 0, supplement: 0 }] };
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
