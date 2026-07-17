import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import * as XLSX from 'xlsx';

const headers = ['來源區塊', '品項/尺寸', '加工', 'tier A/C/F', 'tier B', '備註'];

describe('cutting price normalizer CLI', () => {
  it('uses the reviewed raw xlsx as input and the normalized xlsx as output by default', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cutting-normalizer-default-'));
    const outputPath = path.join(directory, 'normalized.xlsx');
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, 'normalize-steel-cutting-prices.mjs'), '--output', outputPath],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      inputPath: path.resolve(__dirname, '../../../docs/reference/切工價錢-raw.xlsx'),
      outputPath,
      rowCount: 97,
    });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('runs with repository dependencies and generates one price-only canonical workbook', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cutting-normalizer-'));
    const inputPath = path.join(directory, 'raw.xlsm');
    const outputPath = path.join(directory, 'normalized.xlsx');
    const repeatedRows = (count: number, row: Array<string | number>) =>
      Array.from({ length: count }, () => row);
    const priceRows = [
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
    expect(matrix).toHaveLength(98);
    expect(matrix[0]).toEqual([
      'cutting_category',
      'item_name',
      'cut_type',
      'spec_text',
      'inch_min',
      'inch_max',
      'mm_min',
      'mm_max',
      'height_mm',
      'width_mm',
      'thickness_mm_values',
      'thickness_mm_min',
      'thickness_mm_max',
      'unit',
      'unit_price_a',
      'unit_price_b',
      'unit_price_c',
      'unit_price_f',
      'notes',
    ]);
    expect(
      matrix.slice(1).every(
        (row) =>
          row[2] === '加工/切工'
          && row[13] === '刀'
          && (row[14] === '' || row[15] !== ''),
      ),
    ).toBe(true);
    const profileRows = matrix
      .slice(1)
      .filter((row) => row[0] === 'H型鋼' || row[0] === '工字鐵/H型鋼');
    expect(profileRows).toHaveLength(50);
    expect(
      profileRows.every(
        (row) => row[8] !== '' && row[9] !== '' && row.slice(4, 8).every((value) => value === ''),
      ),
    ).toBe(true);
    expect(
      matrix
        .slice(1)
        .filter((row) => row[0] !== 'H型鋼' && row[0] !== '工字鐵/H型鋼')
        .every((row) => row[8] === '' && row[9] === ''),
    ).toBe(true);
    const flatRows = matrix.slice(1).filter((row) => row[0] === '平鐵');
    expect(flatRows).toHaveLength(10);
    expect(matrix.slice(1).some((row) => row[0] === '鐵板/平鐵' || row[0] === '黑平鐵')).toBe(false);
    expect(
      flatRows.every((row) => (row[18].match(/白鐵另計/gu) ?? []).length === 1),
    ).toBe(true);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
