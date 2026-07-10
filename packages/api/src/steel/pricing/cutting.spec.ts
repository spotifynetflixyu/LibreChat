import { buildSteelCuttingRows } from './cutting';

describe('buildSteelCuttingRows', () => {
  test('normalizes dimensions and preserves exact fractional inch ranges', () => {
    const result = buildSteelCuttingRows([
      {
        sourceBlock: '鐵板/平鐵',
        itemSpec: '5/8~2"',
        processing: '加工/切工',
        tierAcf: 10,
        tierB: null,
        notes: '厚度：3、4.5、6',
        sourceSheet: '全部整理資料',
        sourceRow: 99,
      },
      {
        sourceBlock: 'H型鋼',
        itemSpec: '200＊100',
        processing: '加工/切工',
        tierAcf: 120,
        tierB: 125,
        notes: null,
        sourceSheet: '全部整理資料',
        sourceRow: 5,
      },
    ]);

    expect(result.prices).toEqual([
      expect.objectContaining({
        cuttingCategory: '鐵板/平鐵',
        normalizedSpecText: '5/8~2"',
        inchMin: 0.625,
        inchMax: 2,
        mmMin: 15.875,
        mmMax: 50.8,
        unitPriceA: 10,
        unitPriceB: null,
        unitPriceC: 10,
        unitPriceF: 10,
      }),
      expect.objectContaining({
        cuttingCategory: 'H型鋼',
        normalizedSpecText: '200x100',
        inchMin: null,
        inchMax: null,
        mmMin: null,
        mmMax: null,
      }),
    ]);
  });

  test('classifies formula and note rows as supplements without inventing prices', () => {
    const result = buildSteelCuttingRows([
      {
        sourceBlock: '工字鐵/H型鋼',
        itemSpec: null,
        processing: '加工/切斜',
        tierAcf: '單價 X2 - 10',
        tierB: null,
        notes: '斜切加價',
        sourceSheet: '全部整理資料',
        sourceRow: 55,
      },
      {
        sourceBlock: '鐵管',
        itemSpec: '1"以下圓條',
        processing: '補充',
        tierAcf: null,
        tierB: null,
        notes: '不切／要外切',
        sourceSheet: '全部整理資料',
        sourceRow: 117,
      },
    ]);

    expect(result.prices).toEqual([]);
    expect(result.supplements).toEqual([
      expect.objectContaining({
        cuttingCategory: '工字鐵/H型鋼',
        recordType: 'supplement',
        calculationRule: '單價 x2 - 10',
        unitPriceA: null,
        unitPriceB: null,
      }),
      expect.objectContaining({
        cuttingCategory: '鐵管',
        recordType: 'supplement',
        calculationRule: null,
        notes: '不切／要外切',
      }),
    ]);
  });

  test('rejects duplicate or incomplete source identities', () => {
    const sourceRow = {
      sourceBlock: '鐵管',
      itemSpec: '1/2"',
      processing: '加工/切工',
      tierAcf: 10,
      tierB: null,
      notes: null,
      sourceSheet: '全部整理資料',
      sourceRow: 63,
    } as const;

    expect(() => buildSteelCuttingRows([sourceRow, sourceRow])).toThrow(
      'Duplicate cutting source row: 全部整理資料:63',
    );
    expect(() => buildSteelCuttingRows([{ ...sourceRow, sourceBlock: '' }])).toThrow(
      'Missing cutting category at 全部整理資料:63',
    );
  });
});
