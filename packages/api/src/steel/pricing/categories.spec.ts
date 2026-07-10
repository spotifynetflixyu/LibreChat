import { priceCategories, isPriceSubcategory, priceSubcategoriesByCategory } from './categories';

describe('Steel price v4.2 category registry', () => {
  it('lists all 26 workbook categories in source order', () => {
    expect(priceCategories).toEqual([
      '加工/其他',
      '加工/孔',
      '其他',
      '圓鐵',
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
      '圓管',
      '鐵軌',
      '槽鐵',
      'I型鋼/工字鐵',
      '方管',
      '扁方管',
      '加工/開槽',
    ]);
  });

  it('preserves the complete workbook subcategory union', () => {
    const subcategories = new Set(Object.values(priceSubcategoriesByCategory).flat());

    expect([...subcategories]).toEqual([
      '',
      'C型鋼',
      'H型鋼',
      'L',
      'U',
      '丸條',
      '加工',
      '圓管',
      '扁',
      '扁鐵',
      '捲門/伸縮門',
      '網',
      '角鐵',
      '鐵板',
      '五金',
      '接頭',
      '門',
      '保麗龍',
      '手套',
      '曬衣架',
      '蜂巢紙',
      '配件',
      '其他',
      '中柱',
      '底支',
      '遙控',
      '邊柱',
      '刺網',
      '浪型網',
      '菱形網',
      '高床網',
      '點焊網',
      '伸縮器',
      '培林座',
      '壁虎',
      '彈簧',
      '後鈕',
      '扶手',
      '油漆',
      '焊條',
      '矽利康',
      '節竹鐵',
      '膠',
      '花管',
      '華司',
      '螺帽',
      '螺母',
      '螺母/螺絲',
      '螺絲',
      '輪子',
      '配管',
      '釘',
      '鋸',
      '鑄花',
      '馬達箱',
      '窗花',
      '門花',
      '圍籬板',
      '檔泥板',
      '特殊',
      '網板',
      '花板',
      '切工',
      '工具箱',
      '消音',
      '無缺口',
      '車斗',
      'I型鋼/工字鐵',
      '平鐵',
      '方管',
      '槽鐵',
      '板/浪板',
      '加工/其他',
      '五金/配件',
      '不等邊',
      '烤漆',
      'A管',
      'B管',
      '圓條',
      '連料',
      '鋼管',
    ]);
  });

  it('accepts T型鋼 and an explicitly registered empty subcategory', () => {
    expect(priceCategories).toContain('T型鋼');
    expect(isPriceSubcategory('T型鋼', '')).toBe(true);
  });

  it.each(priceCategories)('registers an empty subcategory for %s', (category) => {
    expect(isPriceSubcategory(category, '')).toBe(true);
  });

  it('preserves the exact processing subcategory registries', () => {
    expect(priceSubcategoriesByCategory['加工/其他']).toEqual([
      '',
      'C型鋼',
      'H型鋼',
      'L',
      'U',
      '丸條',
      '加工',
      '圓管',
      '扁',
      '扁鐵',
      '捲門/伸縮門',
      '網',
      '角鐵',
      '鐵板',
    ]);
    expect(priceSubcategoriesByCategory['加工/切工']).toEqual([
      '',
      'H型鋼',
      'I型鋼/工字鐵',
      '圓管',
      '平鐵',
      '方管',
      '槽鐵',
      '角鐵',
      '鐵板',
      '板/浪板',
    ]);
    expect(priceSubcategoriesByCategory['加工/開槽']).toEqual(['', 'H型鋼']);
  });

  it('rejects a subcategory that is registered under a different category', () => {
    expect(isPriceSubcategory('T型鋼', 'H型鋼')).toBe(false);
  });
});
