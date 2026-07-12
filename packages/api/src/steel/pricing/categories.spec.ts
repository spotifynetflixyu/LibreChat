import { priceCategories, isPriceSubcategory, priceSubcategoriesByCategory } from './categories';

describe('Steel price v4.3 category registry', () => {
  it('lists all 27 workbook categories in source order', () => {
    expect(priceCategories).toEqual([
      '加工/其他',
      '加工/孔',
      '其他',
      '圓條',
      '捲門/伸縮門',
      '網',
      '格板/隔板',
      '五金/配件',
      '門窗/門板',
      '鐵板',
      '加工/折工',
      '加工/切工',
      'C型鋼',
      '板/浪板',
      '方鐵',
      'H型鋼',
      'T型鋼',
      '平鐵',
      '角鐵',
      '鋼筋',
      '圓管',
      '鐵軌',
      '槽鐵',
      'I型鋼/工字鐵',
      '方管',
      '扁方管',
      '加工/開槽',
    ]);
  });

  it('preserves the v4.3 workbook subcategory union', () => {
    const subcategories = new Set(Object.values(priceSubcategoriesByCategory).flat());

    expect(subcategories.size).toBeGreaterThan(0);
    expect([...subcategories]).toEqual(
      expect.arrayContaining([
        '',
        '圓條',
        '鐵網',
        '牛筋網',
        '板/消音',
        '鐵板/切工',
        '車/中柱',
        '車/工具箱',
        '鐵板/H型鋼',
        '五金/配件',
      ]),
    );
    expect(subcategories).not.toContain('丸條');
    expect(subcategories).not.toContain('節竹鐵');
  });

  it('accepts T型鋼 and an explicitly registered empty subcategory', () => {
    expect(priceCategories).toContain('T型鋼');
    expect(isPriceSubcategory('T型鋼', '')).toBe(true);
  });

  it('accepts the v4.3 renamed categories and workbook subcategories', () => {
    expect(priceCategories).not.toContain('圓鐵');
    expect(priceCategories).toEqual(expect.arrayContaining(['圓條', '鋼筋']));
    expect(isPriceSubcategory('其他', '圓條')).toBe(true);
    expect(isPriceSubcategory('加工/折工', '鐵板/切工')).toBe(true);
    expect(isPriceSubcategory('加工/開槽', '鐵板/H型鋼')).toBe(true);
    expect(isPriceSubcategory('網', '牛筋網')).toBe(true);
  });

  it.each(priceCategories)('registers an empty subcategory for %s', (category) => {
    expect(isPriceSubcategory(category, '')).toBe(true);
  });

  it('preserves the exact processing subcategory registries', () => {
    expect(priceSubcategoriesByCategory['加工/其他']).toEqual([
      '',
      '捲門/伸縮門',
      'H型鋼',
      '鐵板',
      'C型鋼',
      '圓管',
      '扁鐵',
      'L',
      '條',
      'U',
      '角鐵',
      '網',
      '加工',
      '管',
    ]);
    expect(priceSubcategoriesByCategory['加工/切工']).toEqual([
      '',
      '鐵板',
      'H型鋼',
      '圓條',
      '方管',
      '平鐵',
      '角鐵',
      '圓管',
      '槽鐵',
      'I型鋼/工字鐵',
      '板/浪板',
    ]);
    expect(priceSubcategoriesByCategory['加工/開槽']).toEqual(['', '鐵板/H型鋼', 'H型鋼']);
  });

  it('rejects a subcategory that is registered under a different category', () => {
    expect(isPriceSubcategory('T型鋼', 'H型鋼')).toBe(false);
  });
});
