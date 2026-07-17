import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import * as XLSX from 'xlsx';

const headers = ['來源區塊', '品項/尺寸', '加工', 'tier A/C/F', 'tier B', '備註'];

describe('cutting price normalizer CLI', () => {
  it('runs with repository dependencies and generates one price-only canonical workbook', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cutting-normalizer-'));
    const inputPath = path.join(directory, 'raw.xlsm');
    const outputPath = path.join(directory, 'normalized.xlsx');
    const repeatedRows = (count: number, row: Array<string | number>) =>
      Array.from({ length: count }, () => row);
    const priceRows = [
      ['H型鋼', '', '加工/開槽', 140, 150, '14m/m 以上另計'],
      ['H型鋼', '', '加工/孔', 16, 17, '14m/m 以上另計'],
      ['H型鋼', '', '加工/倒角', 140, 150, '14m/m 以上另計'],
      ...repeatedRows(19, ['H型鋼', '200*100', '加工/切工', 120, 125, '']),
      ...repeatedRows(31, ['工字鐵/H型鋼', '194*150', '加工/切工', 120, 125, '']),
      ...repeatedRows(13, ['鐵管', '4"', '加工/切工', 30, '', '']),
      ...repeatedRows(12, ['角鐵', '1"', '加工/切工', 10, '', '']),
      ['槽鐵', '150X9.0', '加工/切工', 40, '', ''],
      ...repeatedRows(11, ['槽鐵', '75', '加工/切工', 20, '', '']),
      ...repeatedRows(10, ['鐵板/平鐵', '65~100', '加工/切工', 20, '', '厚度：6']),
    ];
    const supplementRows = Array.from({ length: 19 }, () => [
      '鐵管',
      '補充',
      '補充',
      '',
      '',
      '不匯入',
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([headers, ...priceRows, ...supplementRows]),
      '全部整理資料',
    );
    XLSX.writeFile(workbook, inputPath, { bookType: 'xlsm' });

    const result = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, 'normalize-steel-cutting-prices.mjs'),
        '--input',
        inputPath,
        '--output',
        outputPath,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const normalized = XLSX.readFile(outputPath, { raw: false });
    expect(normalized.SheetNames).toEqual(['cutting_prices']);
    const matrix = XLSX.utils.sheet_to_json(normalized.Sheets.cutting_prices, {
      header: 1,
      defval: '',
      raw: false,
    }) as string[][];
    expect(matrix).toHaveLength(101);
    expect(matrix[0]).toEqual([
      'cutting_category',
      'record_type',
      'item_name',
      'cut_type',
      'spec_text',
      'normalized_spec_text',
      'inch_min',
      'inch_max',
      'mm_min',
      'mm_max',
      'thickness_axis',
      'thickness_mm_values',
      'thickness_mm_min',
      'thickness_mm_max',
      'unit',
      'unit_price_a',
      'unit_price_b',
      'unit_price_c',
      'unit_price_f',
      'conditions_json',
      'calculation_rule',
      'notes',
      'source_sheet',
      'source_row',
      'spec_selector_json',
    ]);
    expect(matrix.slice(1).every((row) => row[1] === 'price' && row[14] === '刀')).toBe(true);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
