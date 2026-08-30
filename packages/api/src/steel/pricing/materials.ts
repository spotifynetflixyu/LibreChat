import { priceCategories, type PriceCategory } from './categories';

export type SteelMaterialPriceCategory = Exclude<PriceCategory, `加工/${string}`>;

const steelPriceHotDipMaterialCategories = new Set([
  '平鐵',
  '角鐵',
  '圓管',
  '圓條',
  '扁方管',
  '方管',
  '槽鐵',
]);

export function isSteelPriceHotDipMaterialCategory(value: string): boolean {
  return steelPriceHotDipMaterialCategories.has(value);
}

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

const steelWhiteSteelSurfaceDefaultPreferences = [
  '2B',
  'ST',
  'NO1',
  'HL',
  'BA',
] as const satisfies readonly SteelWhiteSteelSurface[];

export function getSteelPriceDefaultWhiteSteelSurface(
  surfaces: readonly SteelWhiteSteelSurface[],
): SteelWhiteSteelSurface | undefined {
  return steelWhiteSteelSurfaceDefaultPreferences.find((surface) => surfaces.includes(surface));
}

export interface SteelPriceMaterialCatalogEntry {
  readonly category: SteelMaterialPriceCategory;
  readonly defaultMaterial: SteelMaterialFamily;
  readonly availableMaterials: readonly SteelMaterialFamily[];
  readonly defaultWhiteSteelSurface?: SteelWhiteSteelSurface;
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

interface SteelWhiteSteelSurfaceCatalogEntry {
  readonly defaultWhiteSteelSurface: SteelWhiteSteelSurface;
  readonly availableWhiteSteelSurfaces: readonly SteelWhiteSteelSurface[];
}

const steelWhiteSteelSurfaceCatalog: Partial<
  Record<SteelMaterialPriceCategory, SteelWhiteSteelSurfaceCatalogEntry>
> = {
  'C型鋼': { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  '五金/配件': { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  其他: { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  圓條: { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  圓管: { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  平鐵: { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  扁方管: { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  '捲門/伸縮門': {
    defaultWhiteSteelSurface: '2B',
    availableWhiteSteelSurfaces: ['ST', '2B', 'BA'],
  },
  方管: { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST', 'BA'] },
  方鐵: { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  '板/浪板': { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  '格板/隔板': { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  槽鐵: { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  網: { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
  角鐵: {
    defaultWhiteSteelSurface: '2B',
    availableWhiteSteelSurfaces: ['ST', '2B', 'BA'],
  },
  鐵板: {
    defaultWhiteSteelSurface: '2B',
    availableWhiteSteelSurfaces: ['ST', '2B', 'NO1', 'HL', 'BA'],
  },
  '門窗/門板': { defaultWhiteSteelSurface: 'ST', availableWhiteSteelSurfaces: ['ST'] },
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
  const surfaceCatalog = steelWhiteSteelSurfaceCatalog[category];
  const entry: SteelPriceMaterialCatalogEntry = {
    category,
    defaultMaterial: category === 'C型鋼' ? '錏' : '黑鐵',
    availableMaterials,
    ...(surfaceCatalog
      ? { defaultWhiteSteelSurface: surfaceCatalog.defaultWhiteSteelSurface }
      : {}),
    availableWhiteSteelSurfaces: surfaceCatalog?.availableWhiteSteelSurfaces ?? [],
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
