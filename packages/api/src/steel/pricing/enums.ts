export const priceTierCodes = ['A', 'B', 'C', 'F'] as const;
export type PriceTierCode = (typeof priceTierCodes)[number];

export const defaultPriceTierCode: PriceTierCode = 'B';

export const priceCategories = [
  'C型鋼',
  'H型鋼',
  '鐵板/鋼板',
  '圓鐵/圓鋼',
  '角鐵/角鋼',
  '孔',
  '平鐵/扁鐵',
  '槽鐵',
  '工字鐵/I字鐵',
  '方鋼/方鐵',
  '圓管/鋼管',
  '方管',
  '扁方管',
  '樓層板',
  '浪板/收邊',
  '網材',
  '門窗/捲門/配件',
  '五金/零件/耗材',
  '折工',
  '切工/切割',
  '非鋼材/其他材料',
  '鐵軌',
  'T型鋼',
  '加工',
] as const;
export type PriceCategory = (typeof priceCategories)[number];

export const materialKinds = [
  'OT 黑鐵',
  'ST 白鐵',
  '2B 白鐵霧面',
  'BA 白鐵亮面',
  'HL 白鐵沙面',
  'No1 白鐵',
  '錏/鍍鋅',
  '錏',
  '鋁鋅',
  '彩色/烤漆',
  '中碳鋼',
  '鋁',
  '非鋼材',
  '塑膠',
  '玻璃',
  '無',
  '待確認',
] as const;
export type MaterialKind = (typeof materialKinds)[number];
