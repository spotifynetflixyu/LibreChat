type PriceCategoryTuple = readonly [
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
];

export const priceCategories: PriceCategoryTuple = Object.freeze([
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
] as const);

export type PriceCategory = (typeof priceCategories)[number];

export type PriceSubcategory =
  | ''
  | '捲門/伸縮門'
  | 'H型鋼'
  | '鐵板'
  | 'C型鋼'
  | '圓管'
  | '扁鐵'
  | 'L'
  | '條'
  | 'U'
  | '角鐵'
  | '網'
  | '加工'
  | '管'
  | '門'
  | '五金'
  | '接頭'
  | '圓條'
  | '曬衣架'
  | '手套'
  | '蜂巢紙'
  | '保麗龍'
  | '配件'
  | '底支'
  | '邊柱'
  | '中柱'
  | '遙控'
  | '其他'
  | '五金/配件'
  | '點焊網'
  | '鐵網'
  | '牛筋網'
  | '刺網'
  | '高床網'
  | '浪型網'
  | '菱形網'
  | '彈簧'
  | '伸縮器'
  | '培林座'
  | '矽利康'
  | '膠'
  | '油漆'
  | '扶手'
  | '花管'
  | '焊條'
  | '輪子'
  | '配管'
  | '螺絲'
  | '後鈕'
  | '馬達箱'
  | '華司'
  | '螺母/螺絲'
  | '螺母'
  | '螺帽'
  | '鑄花'
  | '壁虎'
  | '釘'
  | '鋸'
  | '門花'
  | '窗花'
  | '檔泥板'
  | '花板'
  | '特殊'
  | '網板'
  | '圍籬板'
  | '板/消音'
  | '鐵板/切工'
  | '車'
  | '車/中柱'
  | '車/工具箱'
  | '無缺口'
  | '切工'
  | '工具箱'
  | '消音'
  | '車斗'
  | '方管'
  | '平鐵'
  | '槽鐵'
  | 'I型鋼/工字鐵'
  | '板/浪板'
  | '加工/其他'
  | '不等邊'
  | '烤漆'
  | '鋼管'
  | 'B管'
  | 'A管'
  | '連料'
  | '鐵板/H型鋼';

type PriceSubcategoryRegistry = Readonly<{
  [Category in PriceCategory]: readonly PriceSubcategory[];
}>;

export const priceSubcategoriesByCategory: PriceSubcategoryRegistry = Object.freeze({
  '加工/其他': Object.freeze([
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
  ] as const),
  '加工/孔': Object.freeze(['', 'C型鋼', '門', '鐵板', '角鐵', '五金', '接頭'] as const),
  其他: Object.freeze(['', '圓條', '曬衣架', '手套', '蜂巢紙', '保麗龍', '加工', '配件'] as const),
  圓條: Object.freeze([''] as const),
  '捲門/伸縮門': Object.freeze([
    '',
    '配件',
    '底支',
    '邊柱',
    '中柱',
    '遙控',
    '其他',
    '五金/配件',
  ] as const),
  網: Object.freeze([
    '',
    '點焊網',
    '鐵網',
    '牛筋網',
    '刺網',
    '高床網',
    '浪型網',
    '菱形網',
    '配件',
  ] as const),
  '格板/隔板': Object.freeze([''] as const),
  '五金/配件': Object.freeze([
    '',
    '彈簧',
    '配件',
    '伸縮器',
    '培林座',
    '蜂巢紙',
    '矽利康',
    '膠',
    '油漆',
    '扶手',
    '花管',
    '焊條',
    '輪子',
    '配管',
    '螺絲',
    '後鈕',
    '馬達箱',
    '華司',
    '螺母/螺絲',
    '螺母',
    '螺帽',
    '鑄花',
    '壁虎',
    '釘',
    '鋸',
    '加工',
  ] as const),
  '門窗/門板': Object.freeze(['', '五金/配件', '門花', '網', '窗花', '配件', '角鐵'] as const),
  鐵板: Object.freeze(['', '檔泥板', '花板', '特殊', '網板', '圍籬板'] as const),
  '加工/折工': Object.freeze([
    '',
    '鐵板',
    '特殊',
    '板/消音',
    '鐵板/切工',
    '門',
    '車',
    '車/中柱',
    '車/工具箱',
    '無缺口',
    '花板',
    '其他',
    '中柱',
    '切工',
    '工具箱',
    '消音',
    '車斗',
  ] as const),
  '加工/切工': Object.freeze([
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
  ] as const),
  C型鋼: Object.freeze(['', '加工/其他'] as const),
  '板/浪板': Object.freeze(['', '五金/配件'] as const),
  方鐵: Object.freeze([''] as const),
  H型鋼: Object.freeze([''] as const),
  T型鋼: Object.freeze([''] as const),
  平鐵: Object.freeze([''] as const),
  角鐵: Object.freeze(['', '不等邊', '烤漆', '配件'] as const),
  鋼筋: Object.freeze([''] as const),
  圓管: Object.freeze(['', '鋼管', 'B管', 'A管', '配管', '連料'] as const),
  鐵軌: Object.freeze([''] as const),
  槽鐵: Object.freeze([''] as const),
  'I型鋼/工字鐵': Object.freeze([''] as const),
  方管: Object.freeze(['', '連料'] as const),
  扁方管: Object.freeze([''] as const),
  '加工/開槽': Object.freeze(['', '鐵板/H型鋼', 'H型鋼'] as const),
});

const priceCategorySet = new Set<string>(priceCategories);

export function isPriceCategory(value: string): value is PriceCategory {
  return priceCategorySet.has(value);
}

export function isPriceSubcategory(
  category: PriceCategory,
  value: string,
): value is PriceSubcategory {
  return (priceSubcategoriesByCategory[category] as readonly string[]).includes(value);
}
