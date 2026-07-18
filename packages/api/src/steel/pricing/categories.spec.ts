import {
  isPriceSubcategory,
  isProcessingMethod,
  isProcessingShape,
  priceCategories,
  priceSubcategoriesByCategory,
} from './categories';

describe('Steel price category registry', () => {
  it('uses the confirmed processing hierarchy', () => {
    expect(priceCategories).toEqual(
      expect.arrayContaining([
        '加工/切工',
        '加工/孔',
        '加工/倒角',
        '加工/開槽',
        '加工/折工',
        '加工/焊接',
        '加工/其他',
      ]),
    );
    expect(priceCategories).not.toContain('加工/孔加工');
  });

  it.each(priceCategories)('registers an empty subcategory for %s', (category) => {
    expect(isPriceSubcategory(category, '')).toBe(true);
  });

  it('keeps processing subcategory focused on target or operation family', () => {
    expect(priceSubcategoriesByCategory['加工/切工']).toEqual(
      expect.arrayContaining(['通用', '鐵板', 'H型鋼', '圓條', '方管']),
    );
    expect(priceSubcategoriesByCategory['加工/孔']).toEqual(
      expect.arrayContaining(['通用', '鐵板', '角鐵']),
    );
    expect(priceSubcategoriesByCategory['加工/倒角']).toEqual(['', '通用', '鐵板']);
    expect(priceSubcategoriesByCategory['加工/焊接']).toEqual(['', '通用']);
  });

  it('registers the fixed processing method and shape enums', () => {
    expect(['剪床', '雷射', '鋸床', '水刀', '火', '沖床', '鑽床'].every(isProcessingMethod)).toBe(
      true,
    );
    expect(
      ['外形切割', '直線切割', '圓孔', '方孔', '菱形孔', '長孔', '橢圓孔', '其他'].every(
        isProcessingShape,
      ),
    ).toBe(true);
    expect(isProcessingMethod('CNC')).toBe(false);
    expect(isProcessingShape('倒角')).toBe(false);
  });

  it('accepts all concise normalized workbook subcategories', () => {
    expect(priceSubcategoriesByCategory.鐵板).toEqual(
      expect.arrayContaining(['切板', '切圓', '切內外圓']),
    );
    expect(priceSubcategoriesByCategory.C型鋼).toEqual(
      expect.arrayContaining(['加工', '輕型', '成型', '其他']),
    );
    expect(priceSubcategoriesByCategory.平鐵).toContain('切料/加工');
    expect(priceSubcategoriesByCategory.鋼筋).toEqual(expect.arrayContaining(['竹節', '其他']));
    expect(priceSubcategoriesByCategory.槽鐵).toContain('切料/加工');
    expect(isPriceSubcategory('門窗/門板', '門花')).toBe(true);
    expect(isPriceSubcategory('門窗/門板', '加工/孔')).toBe(true);
    expect(isPriceSubcategory('五金/配件', '加工/孔')).toBe(true);
    expect(isPriceSubcategory('網', '點焊')).toBe(true);
    expect(isPriceSubcategory('網', '牛筋')).toBe(true);
    expect(isPriceSubcategory('網', '浪型')).toBe(true);
    expect(isPriceSubcategory('網', '點焊網')).toBe(false);
    expect(isPriceSubcategory('網', '浪型網')).toBe(false);
    expect(isPriceSubcategory('加工/折工', '含切工')).toBe(true);
    expect(isPriceSubcategory('T型鋼', 'H型鋼')).toBe(false);
  });
});
