import { priceCategories, type PriceCategory } from './categories';

export type SteelMaterialPriceCategory = Exclude<PriceCategory, `加工/${string}`>;

export function isSteelMaterialPriceCategory(
  category: PriceCategory,
): category is SteelMaterialPriceCategory {
  return !category.startsWith('加工/');
}

export const steelMaterialPriceCategories: readonly SteelMaterialPriceCategory[] =
  priceCategories.filter(isSteelMaterialPriceCategory);

/** Canonical material families exposed by Steel price lookup. */
export const steelMaterialFamilies = [
  '黑鐵',
  '白鐵',
  '錏',
  '鋁',
  '鋅',
  '鎢',
  '塑膠',
] as const;

export type SteelMaterialFamily = (typeof steelMaterialFamilies)[number];

export const steelWhiteSteelSurfaces = ['ST', '2B', 'NO1', 'HL', 'BA'] as const;
export type SteelWhiteSteelSurface = (typeof steelWhiteSteelSurfaces)[number];

export interface SteelPriceMaterialCatalogEntry {
  readonly category: SteelMaterialPriceCategory;
  readonly defaultMaterial: SteelMaterialFamily;
  readonly availableMaterials: readonly SteelMaterialFamily[];
  readonly defaultWhiteSteelSurface: '2B';
  readonly availableWhiteSteelSurfaces: readonly SteelWhiteSteelSurface[];
}

const catalogOverrides: Partial<
  Record<SteelMaterialPriceCategory, readonly SteelMaterialFamily[]>
> = {
  'C型鋼': ['黑鐵', '白鐵', '錏'],
  'H型鋼': ['黑鐵'],
  '五金/配件': ['黑鐵', '白鐵', '塑膠', '鋁', '錏'],
  其他: ['白鐵'],
  圓條: ['黑鐵', '白鐵', '錏'],
  圓管: ['黑鐵', '白鐵', '錏'],
  平鐵: ['黑鐵', '白鐵'],
  扁方管: ['黑鐵', '白鐵', '錏'],
  '捲門/伸縮門': ['黑鐵', '白鐵', '鋁', '錏'],
  方管: ['黑鐵', '白鐵', '錏'],
  方鐵: ['黑鐵', '白鐵'],
  '板/浪板': ['黑鐵', '白鐵', '塑膠', '鋁', '錏'],
  '格板/隔板': ['黑鐵', '白鐵'],
  槽鐵: ['黑鐵', '白鐵', '錏'],
  網: ['黑鐵', '白鐵', '塑膠', '錏'],
  角鐵: ['黑鐵', '白鐵', '錏'],
  鐵板: ['黑鐵', '白鐵', '錏'],
  鐵軌: ['黑鐵'],
  '門窗/門板': ['黑鐵', '白鐵', '鋁', '錏'],
};

const whiteSteelSurfaceOverrides: Partial<
  Record<SteelMaterialPriceCategory, readonly SteelWhiteSteelSurface[]>
> = {
  'C型鋼': ['ST'],
  '五金/配件': ['ST'],
  其他: ['ST'],
  圓條: ['ST'],
  圓管: ['ST'],
  平鐵: ['ST'],
  扁方管: ['ST'],
  '捲門/伸縮門': ['ST', '2B', 'BA'],
  方管: ['ST', 'BA'],
  方鐵: ['ST'],
  '板/浪板': ['ST'],
  '格板/隔板': ['ST'],
  槽鐵: ['ST'],
  網: ['ST'],
  角鐵: ['ST', '2B', 'BA'],
  鐵板: ['ST', '2B', 'NO1', 'HL', 'BA'],
  '門窗/門板': ['ST'],
};

const entries = new Map<SteelMaterialPriceCategory, SteelPriceMaterialCatalogEntry>();

export function getSteelPriceMaterialCatalog(
  category: PriceCategory,
): SteelPriceMaterialCatalogEntry {
  if (!isSteelMaterialPriceCategory(category)) {
    throw new Error(`Steel material catalog does not include processing category ${category}`);
  }

  const existing = entries.get(category);
  if (existing) {
    return existing;
  }

  const availableMaterials = catalogOverrides[category] ?? ['黑鐵'];
  const entry: SteelPriceMaterialCatalogEntry = {
    category,
    defaultMaterial: category === 'C型鋼' ? '錏' : '黑鐵',
    availableMaterials,
    defaultWhiteSteelSurface: '2B',
    availableWhiteSteelSurfaces: whiteSteelSurfaceOverrides[category] ?? [],
  };
  entries.set(category, entry);
  return entry;
}

export const steelPriceMaterialCatalog = Object.fromEntries(
  steelMaterialPriceCategories.map((category) => [
    category,
    getSteelPriceMaterialCatalog(category),
  ]),
) as Readonly<Record<SteelMaterialPriceCategory, SteelPriceMaterialCatalogEntry>>;

export function getSteelPriceDefaultMaterial(category: PriceCategory): SteelMaterialFamily {
  return getSteelPriceMaterialCatalog(category).defaultMaterial;
}

export function getSteelPriceAvailableMaterials(
  categories: readonly PriceCategory[],
): SteelMaterialFamily[] {
  const available = new Set(
    categories.flatMap(
      (category) => getSteelPriceMaterialCatalog(category).availableMaterials,
    ),
  );
  return steelMaterialFamilies.filter((material) => available.has(material));
}

export function getSteelPriceCommonMaterials(
  categories: readonly PriceCategory[],
): SteelMaterialFamily[] {
  if (categories.length === 0) {
    return [];
  }
  return steelMaterialFamilies.filter((material) =>
    categories.every((category) =>
      getSteelPriceMaterialCatalog(category).availableMaterials.includes(material),
    ),
  );
}

export function getSteelPriceAvailableWhiteSteelSurfaces(
  categories: readonly PriceCategory[],
): SteelWhiteSteelSurface[] {
  const available = new Set(
    categories.flatMap(
      (category) => getSteelPriceMaterialCatalog(category).availableWhiteSteelSurfaces,
    ),
  );
  return steelWhiteSteelSurfaces.filter((surface) => available.has(surface));
}

export function getSteelPriceCommonWhiteSteelSurfaces(
  categories: readonly PriceCategory[],
): SteelWhiteSteelSurface[] {
  if (categories.length === 0) {
    return [];
  }
  return steelWhiteSteelSurfaces.filter((surface) =>
    categories.every((category) =>
      getSteelPriceMaterialCatalog(category).availableWhiteSteelSurfaces.includes(surface),
    ),
  );
}

function normalizeMaterialText(value: string): string {
  return value.normalize('NFKC').trim().toUpperCase();
}

/** Normalize ERP surface labels to family values used for support and SQL filtering. */
export function normalizeSteelPriceMaterialFamily(
  value: string | undefined,
): SteelMaterialFamily | undefined {
  if (!value) {
    return undefined;
  }

  const key = normalizeMaterialText(value);
  if (key === 'OT' || key.includes('黑鐵') || key.includes('黑板')) {
    return '黑鐵';
  }
  if (
    key === 'ST' ||
    key.includes('白鐵') ||
    key.includes('不鏽鋼') ||
    key.includes('不銹鋼') ||
    key.includes('2B') ||
    key.includes('BA') ||
    key.includes('NO1') ||
    key.includes('HL') ||
    key.includes('亮面') ||
    key.includes('霧面') ||
    key.includes('沙面') ||
    key.includes('砂面')
  ) {
    return '白鐵';
  }
  if (key.includes('錏') || key.includes('鍍鋅') || key === '鋅') {
    return key === '鋅' ? '鋅' : '錏';
  }
  if (key.includes('鋁')) {
    return '鋁';
  }
  if (key.includes('塑膠')) {
    return '塑膠';
  }
  if (key === '鎢') {
    return '鎢';
  }
  return undefined;
}

export function normalizeSteelPriceWhiteSteelSurface(
  value: string | undefined,
): SteelWhiteSteelSurface | undefined {
  if (!value) {
    return undefined;
  }

  const key = normalizeMaterialText(value);
  if (key.includes('2B') || key.includes('霧面')) return '2B';
  if (key.includes('NO1')) return 'NO1';
  if (key.includes('HL') || key.includes('沙面') || key.includes('砂面')) return 'HL';
  if (key.includes('BA') || key.includes('亮面')) return 'BA';
  if (key === '白鐵' || key === '不鏽鋼' || key === '不銹鋼') return '2B';
  if (
    key === 'ST' ||
    key.includes('/ST') ||
    key.includes('ST/') ||
    key.includes('白鐵 / ST') ||
    key.includes('不鏽鋼 / ST') ||
    key.includes('不銹鋼 / ST')
  ) {
    return 'ST';
  }
  return undefined;
}

export function isSteelPriceMaterialSupported(
  category: PriceCategory,
  material: SteelMaterialFamily,
): boolean {
  return getSteelPriceMaterialCatalog(category).availableMaterials.includes(material);
}
