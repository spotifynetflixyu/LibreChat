export const priceTierCodes = ['A', 'B', 'C', 'F'] as const;
export type PriceTierCode = (typeof priceTierCodes)[number];

export const defaultPriceTierCode: PriceTierCode = 'B';

export { priceCategories } from './categories';
export type { PriceCategory } from './categories';

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

export const priceLookupMaterialKinds = ['黑鐵', '白鐵', '錏', '鋁', '鋅'] as const;
export type PriceLookupMaterialKind = (typeof priceLookupMaterialKinds)[number];
