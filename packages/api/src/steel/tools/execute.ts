import type {
  SteelPriceItem,
  SteelCuttingPriceRecord,
  SteelPriceLookupQuery,
  SteelPriceTierValues,
  SteelPriceCategoryCandidate,
} from '../repositories';
import type {
  SteelToolResult,
  SteelToolLogger,
  SteelToolJsonObject,
  SteelToolErrorCategory,
} from './results';
import type { SteelRepositoryClient, SteelSourceRef } from '../repositories/types';
import type { PriceCategory, PriceLookupMaterialKind } from '../pricing/enums';
import type { SteelToolName } from './schemas';

import {
  compileProcessingKeyword,
  getProcessingCandidateText,
  isGenericProcessingSubcategory,
  isProcessingCandidateApplicable,
  isProcessingCandidateSpecApplicable,
  matchesProcessingKeywordTerms,
  processingPriceCategories,
} from '../pricing/processing-candidates';
import {
  filterSteelCuttingPriceGroups,
  searchSteelCustomers,
  searchSteelCuttingPriceGroups,
  searchSteelPriceCandidateGroups,
  searchSteelProcessingPriceCandidates,
} from '../repositories';
import { getExecutableSteelToolDefinition, isExecutableSteelToolName } from './registry';
import { sanitizeSteelToolOutput, steelToolRedactionVersion } from './sanitize';
import {
  getSteelPriceAvailableMaterials,
  getSteelPriceAvailableWhiteSteelSurfaces,
  getSteelPriceCommonMaterials,
  getSteelPriceCommonWhiteSteelSurfaces,
  getSteelPriceDefaultMaterial,
  getSteelPriceMaterialCatalog,
  isSteelPriceMaterialSupported,
  normalizeSteelPriceMaterialFamily,
  normalizeSteelPriceWhiteSteelSurface,
  type SteelMaterialFamily,
} from '../pricing/materials';
import { steelToolArgsSchemas } from './schemas';

type SteelRawToolOutput = { [key: string]: unknown };
type SearchCustomersInput = ReturnType<typeof steelToolArgsSchemas.search_customers.parse>;
type SearchPriceCandidatesInput = ReturnType<
  typeof steelToolArgsSchemas.search_price_candidates.parse
>;
type DispatchSteelToolArgs = SearchCustomersInput | SearchPriceCandidatesInput;

export interface SteelToolRunState {
  maxCalls: number;
  callsUsed: number;
  maxCallsByTool?: Partial<Record<SteelToolName, number>>;
  callsUsedByTool?: Partial<Record<SteelToolName, number>>;
}

export interface ExecuteSteelToolOptions {
  client: SteelRepositoryClient;
  toolName: string;
  arguments: unknown;
  providerToolCallId?: string;
  runState?: SteelToolRunState;
  log?: SteelToolLogger;
  now?: () => number;
}

export function createSteelToolRunState(
  maxCalls: number,
  maxCallsByTool?: Partial<Record<SteelToolName, number>>,
): SteelToolRunState {
  if (!Number.isInteger(maxCalls) || maxCalls < 1) {
    throw new Error('Steel tool maxCalls must be a positive integer');
  }

  Object.entries(maxCallsByTool ?? {}).forEach(([toolName, limit]) => {
    if (!Number.isInteger(limit) || (limit as number) < 1) {
      throw new Error(`Steel tool maxCallsByTool.${toolName} must be a positive integer`);
    }
  });
  return {
    maxCalls,
    callsUsed: 0,
    ...(maxCallsByTool ? { maxCallsByTool } : {}),
    ...(maxCallsByTool ? { callsUsedByTool: {} } : {}),
  };
}

function getDurationMs(startTime: number, now: () => number): number {
  return Math.max(0, now() - startTime);
}

function summarizeInput(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'args=non_object';
  }

  return `args=${Object.keys(value).sort().join(',')}`;
}

function isSourceRef(value: unknown): value is SteelSourceRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const entry = value as { [key: string]: unknown };
  return typeof entry.channel === 'string' && typeof entry.factType === 'string';
}

function collectSourceRefs(
  value: unknown,
  refs: SteelSourceRef[] = [],
  seen = new WeakSet<object>(),
): SteelSourceRef[] {
  if (value === null || value === undefined) {
    return refs;
  }

  if (isSourceRef(value)) {
    refs.push(value);
    return refs;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return refs;
    }
    seen.add(value);
    value.forEach((entry) => collectSourceRefs(entry, refs, seen));
    seen.delete(value);
    return refs;
  }

  if (typeof value !== 'object') {
    return refs;
  }

  if (seen.has(value)) {
    return refs;
  }
  seen.add(value);
  Object.values(value as { [key: string]: unknown }).forEach((entry) => {
    collectSourceRefs(entry, refs, seen);
  });
  seen.delete(value);

  return refs;
}

function summarizeOutput(data: SteelToolJsonObject): string {
  const summaryKeys = [
    'packets',
    'instructionPackets',
    'packetGroups',
    'instructionPacketGroups',
    'catalogFamilyCandidates',
    'defaultCandidates',
    'quoteDefaults',
    'formulaCandidates',
    'customers',
    'queryResults',
    'priceCandidates',
    'workingOrderRows',
    'memoryEntries',
  ];
  const summary = summaryKeys
    .map((key) => {
      const value = data[key];
      return Array.isArray(value) ? `${key}=${value.length}` : undefined;
    })
    .find((entry) => entry !== undefined);

  if (summary) {
    return summary;
  }

  return `keys=${Object.keys(data).length}`;
}

function hasPriceTierValue(tiers: SteelPriceTierValues): boolean {
  return Object.values(tiers).some((value) => value !== null);
}

const defaultPriceTierOrder = ['B', 'A', 'C', 'F', 'D', 'E'] as const;

function resolveTierPrices(
  tierPrices: SteelPriceTierValues,
  unitPriceBase: number | null,
): {
  tierPrices: SteelPriceTierValues;
  fallbackTiers: Array<keyof SteelPriceTierValues>;
  defaultQuoteTier: keyof SteelPriceTierValues | null;
  defaultQuoteUnitPrice: number | null;
  manualReviewNote?: string;
} {
  const defaultExplicitTier = defaultPriceTierOrder.find((tier) => tierPrices[tier] !== null);
  const fallbackUnitPrice =
    (defaultExplicitTier === undefined ? null : tierPrices[defaultExplicitTier]) ?? unitPriceBase;
  const fallbackTiers = (Object.keys(tierPrices) as Array<keyof SteelPriceTierValues>).filter(
    (tier) => tierPrices[tier] === null && fallbackUnitPrice !== null,
  );
  const resolvedTierPrices: SteelPriceTierValues = {
    A: tierPrices.A ?? fallbackUnitPrice,
    B: tierPrices.B ?? fallbackUnitPrice,
    C: tierPrices.C ?? fallbackUnitPrice,
    D: tierPrices.D ?? fallbackUnitPrice,
    E: tierPrices.E ?? fallbackUnitPrice,
    F: tierPrices.F ?? fallbackUnitPrice,
  };
  const defaultQuoteTier = defaultExplicitTier ?? (unitPriceBase === null ? null : 'B');
  const defaultQuoteUnitPrice =
    defaultExplicitTier === undefined ? unitPriceBase : tierPrices[defaultExplicitTier];

  if (fallbackTiers.length === 0) {
    return {
      tierPrices: resolvedTierPrices,
      fallbackTiers,
      defaultQuoteTier,
      defaultQuoteUnitPrice,
    };
  }

  const fallbackBasis =
    defaultExplicitTier === undefined
      ? 'unit_price_base'
      : `${defaultExplicitTier} 等級價格（B→A→C→F→D→E）`;
  return {
    tierPrices: resolvedTierPrices,
    fallbackTiers,
    defaultQuoteTier,
    defaultQuoteUnitPrice,
    manualReviewNote: `缺價等級使用 ${fallbackBasis} fallback；採用時須在補充註明並人工確認。`,
  };
}

function toSafePriceCandidate(candidate: SteelPriceItem): SteelRawToolOutput {
  const { tierPrices, tierRatios, unitPriceBase, ...candidateFields } = candidate;
  const hasTierPrices = hasPriceTierValue(tierPrices);
  const resolvedPriceTiers = resolveTierPrices(tierPrices, unitPriceBase);
  const hasResolvedTierPrices = hasPriceTierValue(resolvedPriceTiers.tierPrices);
  const hasTierRatios = hasPriceTierValue(tierRatios);
  const ratioEligible =
    !hasTierPrices &&
    hasTierRatios &&
    (candidate.valueState === 'ratio_only' || candidate.unit === 'Kg' || candidate.unit === 'M');
  const effectiveUnit = ratioEligible && candidate.unit === '支' ? 'Kg' : candidate.unit;

  if (hasResolvedTierPrices) {
    return {
      ...candidateFields,
      quoteEligible: true,
      priceSource: 'tier_price',
      quoteUnit: effectiveUnit ?? null,
      tierPrices: resolvedPriceTiers.tierPrices,
      ...(resolvedPriceTiers.fallbackTiers.length > 0
        ? { fallbackTiers: resolvedPriceTiers.fallbackTiers }
        : {}),
    };
  }

  return {
    ...candidateFields,
    quoteEligible: ratioEligible,
    priceSource: ratioEligible ? 'price_ratio' : null,
    quoteUnit: effectiveUnit ?? null,
    tierPrices: ratioEligible ? tierRatios : null,
  };
}

function toSafeCuttingPriceRecord(record: SteelCuttingPriceRecord): SteelRawToolOutput {
  return {
    id: record.id,
    cuttingCategory: record.cuttingCategory,
    itemName: record.itemName,
    cutType: record.cutType,
    specText: record.specText,
    inchMin: record.inchMin,
    inchMax: record.inchMax,
    mmMin: record.mmMin,
    mmMax: record.mmMax,
    heightMm: record.heightMm,
    widthMm: record.widthMm,
    thicknessMmValues: record.thicknessMmValues,
    thicknessMmMin: record.thicknessMmMin,
    thicknessMmMax: record.thicknessMmMax,
    unit: record.unit,
    tierPrices: record.tierPrices,
    notes: record.notes,
  };
}

function getPlatePriceModeRank(candidate: SteelPriceItem): number {
  const text = getProcessingCandidateText(candidate);
  if (text.includes('雷射切割')) {
    return 0;
  }
  if (text.includes('四方切')) {
    return 1;
  }
  if (/版型切型|版型切割|雷切割型|割型/u.test(text)) {
    return 2;
  }

  return 3;
}

function getSquareBarFinishRank(candidate: SteelPriceItem): number {
  const text = getProcessingCandidateText(candidate);
  return text.includes('磨光') ? 1 : 0;
}

function orderPriceCandidates(
  query: { category: PriceCategory; keyword?: string },
  candidates: readonly SteelPriceItem[],
): SteelPriceItem[] {
  if (query.category === '方鐵' && !query.keyword?.includes('磨光')) {
    return [...candidates].sort(
      (left, right) => getSquareBarFinishRank(left) - getSquareBarFinishRank(right),
    );
  }

  if (query.category !== '鐵板' || query.keyword) {
    return [...candidates];
  }

  return [...candidates].sort(
    (left, right) => getPlatePriceModeRank(left) - getPlatePriceModeRank(right),
  );
}

type PriceQuery = SearchPriceCandidatesInput['queries'][number];
type ProcessingPriceQuery = Extract<PriceQuery, { processingCategories: PriceCategory[] }>;
type MaterialPriceQuery = Exclude<PriceQuery, ProcessingPriceQuery>;

interface SupportedMaterialQuery {
  query: MaterialPriceQuery;
  categoryIndexes: readonly number[];
  materialsByCategory: readonly (readonly PriceLookupMaterialKind[])[];
}

interface UnsupportedMaterialPair {
  category: PriceCategory;
  material: PriceLookupMaterialKind;
  availableMaterials: readonly SteelMaterialFamily[];
  availableWhiteSteelSurfaces: readonly string[];
}

interface ProcessingTargetSpec {
  queryId: string;
  category: PriceCategory;
  thicknessMm?: readonly string[];
}

function isProcessingPriceQuery(
  query: SearchPriceCandidatesInput['queries'][number],
): query is ProcessingPriceQuery {
  return 'processingCategories' in query;
}

function isMaterialPriceQuery(
  query: SearchPriceCandidatesInput['queries'][number],
): query is MaterialPriceQuery {
  return !isProcessingPriceQuery(query);
}

function normalizeMaterial(
  value: string | undefined,
): PriceLookupMaterialKind | undefined {
  const surface = normalizeSteelPriceWhiteSteelSurface(value);
  if (surface) {
    return surface as PriceLookupMaterialKind;
  }
  const normalized = normalizeSteelPriceMaterialFamily(value);
  if (normalized) {
    return normalized as PriceLookupMaterialKind;
  }
  return undefined;
}

function normalizeMaterials(
  values: readonly string[] | undefined,
): PriceLookupMaterialKind[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  const normalized = values.flatMap((value) => {
    const material = normalizeMaterial(value);
    return material ? [material] : [];
  });
  return [...new Set(normalized)];
}

function normalizeUnit(value: string | undefined, category: PriceCategory): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.trim().toLowerCase() === 'kg') {
    return 'Kg';
  }
  if (category === '鐵板') {
    return value;
  }
  return value.trim() || undefined;
}

function toRepositoryMaterialQueries(
  query: MaterialPriceQuery,
  categoryIndexes: readonly number[] = query.categories.map((_, index) => index),
  materialsByCategory?: readonly (readonly PriceLookupMaterialKind[])[],
): Array<SteelPriceLookupQuery> {
  return query.categories.map((category, categoryIndex) => {
    const materials = materialsByCategory?.[categoryIndex] ??
      normalizeMaterials(query.materials) ?? [getSteelPriceDefaultMaterial(category)];
    const unit = normalizeUnit(query.unit, category);
    const originalCategoryIndex = categoryIndexes[categoryIndex] ?? categoryIndex;
    return {
      queryId: `${query.queryId}:c${originalCategoryIndex + 1}`,
      category,
      ...(query.subcategory ? { subcategory: query.subcategory } : {}),
      ...(materials.length > 0 ? { materials } : {}),
      ...(unit ? { unit } : {}),
      ...(query.thicknessMm ? { thicknessMm: query.thicknessMm } : {}),
      ...(query.stockLengthMm ? { stockLengthMm: query.stockLengthMm } : {}),
      ...(query.keyword ? { keyword: query.keyword } : {}),
    };
  });
}

function isUsablePriceCandidate(candidate: SteelPriceItem): boolean {
  return (
    typeof candidate.erpItemCode === 'string' &&
    candidate.erpItemCode.trim() !== '' &&
    typeof candidate.productName === 'string' &&
    candidate.productName.trim() !== ''
  );
}

function getMaterialQueryMetadata(query: MaterialPriceQuery): {
  defaultMaterial: SteelMaterialFamily;
  availableMaterials: SteelMaterialFamily[];
  defaultWhiteSteelSurface: '2B';
  availableWhiteSteelSurfaces: string[];
  categoryMaterialOptions: Array<{
    category: PriceCategory;
    defaultMaterial: SteelMaterialFamily;
    availableMaterials: readonly SteelMaterialFamily[];
    defaultWhiteSteelSurface: '2B';
    availableWhiteSteelSurfaces: readonly string[];
  }>;
  mixedDefault: boolean;
} {
  const defaults = query.categories.map(getSteelPriceDefaultMaterial);
  const availableMaterials = getSteelPriceCommonMaterials(query.categories);
  const surfaces = getSteelPriceCommonWhiteSteelSurfaces(query.categories);
  return {
    defaultMaterial: defaults[0] ?? '黑鐵',
    availableMaterials,
    defaultWhiteSteelSurface: '2B',
    availableWhiteSteelSurfaces: surfaces,
    categoryMaterialOptions: query.categories.map((category) => {
      const catalog = getSteelPriceMaterialCatalog(category);
      return {
        category,
        defaultMaterial: catalog.defaultMaterial,
        availableMaterials: catalog.availableMaterials,
        defaultWhiteSteelSurface: catalog.defaultWhiteSteelSurface,
        availableWhiteSteelSurfaces: catalog.availableWhiteSteelSurfaces,
      };
    }),
    mixedDefault: new Set(defaults).size > 1,
  };
}

function getUnsupportedMaterialResult(
  query: MaterialPriceQuery,
  metadata: ReturnType<typeof getMaterialQueryMetadata>,
  unsupportedMaterials: readonly UnsupportedMaterialPair[],
): SteelRawToolOutput {
  const allowedMaterials = metadata.availableMaterials;
  const allowedSurfaces = metadata.availableWhiteSteelSurfaces;
  const surfaceTerms = new Set(['ST', '2B', 'NO1', 'HL', 'BA']);
  const unsupportedSurface = unsupportedMaterials.some(({ material }) =>
    surfaceTerms.has(material),
  );
  const issue = unsupportedSurface
    ? `unsupported material/category pairs: ${unsupportedMaterials
        .map(({ material, category }) => `${material}/${category}`)
        .join(', ')}; shared surfaces: ${allowedSurfaces.join(', ') || 'none'}`
    : `unsupported material/category pairs: ${unsupportedMaterials
        .map(({ material, category }) => `${material}/${category}`)
        .join(', ')}; shared materials: ${allowedMaterials.join(', ') || 'none'}`;
  return {
    queryId: query.queryId,
    query,
    status: unsupportedSurface
      ? 'unsupported_material_surface'
      : 'unsupported_material',
    defaultMaterial: metadata.defaultMaterial,
    availableMaterials: allowedMaterials,
    defaultWhiteSteelSurface: metadata.defaultWhiteSteelSurface,
    availableWhiteSteelSurfaces: allowedSurfaces,
    categoryMaterialOptions: metadata.categoryMaterialOptions,
    issue,
    allowedMaterials,
    ...(unsupportedSurface ? { allowedSurfaces } : {}),
    unsupportedMaterials,
  };
}

function getMixedDefaultMaterialResult(
  query: MaterialPriceQuery,
  metadata: ReturnType<typeof getMaterialQueryMetadata>,
): SteelRawToolOutput {
  const defaults = [...new Set(query.categories.map(getSteelPriceDefaultMaterial))];
  return {
    queryId: query.queryId,
    query,
    status: 'split_required_mixed_defaults',
    defaultMaterial: metadata.defaultMaterial,
    defaultMaterialGroups: defaults.map((defaultMaterial) => ({
      defaultMaterial,
      categories: query.categories.filter((category) => getSteelPriceDefaultMaterial(category) === defaultMaterial),
    })),
    availableMaterials: metadata.availableMaterials,
    defaultWhiteSteelSurface: metadata.defaultWhiteSteelSurface,
    availableWhiteSteelSurfaces: metadata.availableWhiteSteelSurfaces,
    categoryMaterialOptions: metadata.categoryMaterialOptions,
    issue: `categories have different defaults (${defaults.join(', ')}); split query by default material`,
  };
}

function buildProcessingPrice(
  candidates: readonly SteelPriceItem[],
  targetCategories: readonly PriceCategory[],
  requestedProcessingCategories: readonly PriceCategory[] | undefined,
  keyword: string | undefined,
  targetSpecs: readonly { queryId: string; category: PriceCategory; thicknessMm?: readonly string[] }[] | undefined,
): SteelRawToolOutput {
  const targets = new Set(targetCategories);
  const requested = requestedProcessingCategories
    ? new Set(requestedProcessingCategories)
    : undefined;
  const keywordTerms = compileProcessingKeyword(keyword);
  const applicable = candidates.flatMap<SteelRawToolOutput>((candidate) => {
    const matchedTargetSpecs =
      candidate.category === '加工/切工' && targetSpecs
        ? targetSpecs.filter(
            (targetSpec) =>
              isProcessingCandidateApplicable(candidate, new Set([targetSpec.category])) &&
              isProcessingCandidateSpecApplicable(candidate, targetSpec.thicknessMm),
          )
        : undefined;
    if (
      !isUsablePriceCandidate(candidate) ||
      (requested && !requested.has(candidate.category as PriceCategory)) ||
      !isProcessingCandidateApplicable(candidate, targets) ||
      (matchedTargetSpecs && matchedTargetSpecs.length === 0) ||
      !matchesProcessingKeywordTerms(candidate, keywordTerms)
    ) {
      return [];
    }

    const safe = toSafePriceCandidate(candidate);
    if (safe.quoteEligible !== true) {
      return [];
    }

    return [
      {
        ...safe,
      },
    ];
  });
  const availableCounts = new Map<string, number>();
  applicable.forEach((candidate) => {
    const category = String(candidate.category);
    availableCounts.set(category, (availableCounts.get(category) ?? 0) + 1);
  });
  const grouped = new Map<string, SteelRawToolOutput[]>();
  applicable.forEach((candidate) => {
    const category = String(candidate.category);
    const items = grouped.get(category) ?? [];
    items.push(candidate);
    grouped.set(category, items);
  });
  grouped.get('加工/切工')?.sort((left, right) => {
    const leftSubcategory = typeof left.subcategory === 'string' ? left.subcategory : undefined;
    const rightSubcategory = typeof right.subcategory === 'string' ? right.subcategory : undefined;
    return (
      Number(isGenericProcessingSubcategory(leftSubcategory)) -
      Number(isGenericProcessingSubcategory(rightSubcategory))
    );
  });
  const groupOrder = requestedProcessingCategories
    ? [...new Set(requestedProcessingCategories)]
    : [...processingPriceCategories];
  const availableByCategory = groupOrder.flatMap((category) => {
    const totalAvailable = availableCounts.get(category) ?? 0;
    return totalAvailable > 0 ? [{ processingCategory: category, totalAvailable }] : [];
  });

  const totalAvailable = applicable.length;
  const returnedItems = applicable.slice(0, 250);
  const returnedByCategory = new Map<string, SteelRawToolOutput[]>();
  returnedItems.forEach((candidate) => {
    const category = String(candidate.category);
    const items = returnedByCategory.get(category) ?? [];
    items.push(candidate);
    returnedByCategory.set(category, items);
  });

  return {
    queryId: null,
    targetCategories,
    defaultMaterial: getSteelPriceDefaultMaterial(targetCategories[0] ?? '其他'),
    availableMaterials: getSteelPriceAvailableMaterials(targetCategories),
    defaultWhiteSteelSurface: '2B',
    availableWhiteSteelSurfaces:
      getSteelPriceAvailableWhiteSteelSurfaces(targetCategories),
    processingCategories: requestedProcessingCategories ?? [...processingPriceCategories],
    keyword: keyword ?? null,
    targetSpecs: targetSpecs ?? [],
    totalAvailable,
    returnedCount: returnedItems.length,
    truncated: returnedItems.length < totalAvailable,
    groups: groupOrder.flatMap((category) => {
      const items = returnedByCategory.get(category) ?? [];
      return items.length > 0
        ? [{
            processingCategory: category,
            totalAvailable: grouped.get(category)?.length ?? items.length,
            returnedCount: items.length,
            truncated: items.length < (grouped.get(category)?.length ?? items.length),
            items,
          }]
        : [];
    }),
    availableByCategory,
    suggestedKeywords: [],
  };
}

async function searchPriceCandidates(
  client: SteelRepositoryClient,
  input: SearchPriceCandidatesInput,
): Promise<SteelRawToolOutput> {
  const materialQueries = input.queries.filter(isMaterialPriceQuery);
  const processingQueries = input.queries.filter(isProcessingPriceQuery);
  const metadataByQueryId = new Map<string, ReturnType<typeof getMaterialQueryMetadata>>();
  const precomputedMaterialResults = new Map<string, SteelRawToolOutput>();
  const unsupportedMaterialsByQueryId = new Map<string, UnsupportedMaterialPair[]>();
  const supportedMaterialQueries: SupportedMaterialQuery[] = [];
  materialQueries.forEach((query) => {
    const metadata = getMaterialQueryMetadata(query);
    metadataByQueryId.set(query.queryId, metadata);
    if (metadata.mixedDefault && query.materials === undefined) {
      precomputedMaterialResults.set(query.queryId, getMixedDefaultMaterialResult(query, metadata));
      return;
    }
    if (query.materials === undefined) {
      supportedMaterialQueries.push({
        query,
        categoryIndexes: query.categories.map((_, categoryIndex) => categoryIndex),
        materialsByCategory: query.categories.map((category) => [
          getSteelPriceDefaultMaterial(category),
        ]),
      });
      return;
    }
    const normalizedMaterials = normalizeMaterials(query.materials) ?? [];
    const supportedMaterialsByCategory = query.categories.map((category) => {
      const catalog = getSteelPriceMaterialCatalog(category);
      return normalizedMaterials.filter((material) => {
        const family = normalizeSteelPriceMaterialFamily(material);
        const surface = normalizeSteelPriceWhiteSteelSurface(material);
        return (
          family !== undefined &&
          isSteelPriceMaterialSupported(category, family) &&
          (surface === undefined || catalog.availableWhiteSteelSurfaces.includes(surface))
        );
      });
    });
    const unsupportedMaterials = query.categories.flatMap((category) => {
      const catalog = getSteelPriceMaterialCatalog(category);
      return normalizedMaterials.flatMap((material) => {
        const family = normalizeSteelPriceMaterialFamily(material);
        const surface = normalizeSteelPriceWhiteSteelSurface(material);
        const supported =
          family !== undefined &&
          isSteelPriceMaterialSupported(category, family) &&
          (surface === undefined || catalog.availableWhiteSteelSurfaces.includes(surface));
        return supported
          ? []
          : [{
              category,
              material,
              availableMaterials: catalog.availableMaterials,
              availableWhiteSteelSurfaces: catalog.availableWhiteSteelSurfaces,
            }];
      });
    });
    if (unsupportedMaterials.length > 0) {
      unsupportedMaterialsByQueryId.set(query.queryId, unsupportedMaterials);
    }
    const supportedCategoryIndexes = supportedMaterialsByCategory.flatMap((materials, index) =>
      materials.length > 0 ? [index] : [],
    );
    if (supportedCategoryIndexes.length === 0) {
      precomputedMaterialResults.set(
        query.queryId,
        getUnsupportedMaterialResult(query, metadata, unsupportedMaterials),
      );
      return;
    }
    supportedMaterialQueries.push({
      query: {
        ...query,
        categories: supportedCategoryIndexes.map((categoryIndex) =>
          query.categories[categoryIndex],
        ),
      },
      categoryIndexes: supportedCategoryIndexes,
      materialsByCategory: supportedCategoryIndexes.map(
        (categoryIndex) => supportedMaterialsByCategory[categoryIndex] ?? [],
      ),
    });
  });

  const expandedMaterialQueries = supportedMaterialQueries.flatMap(
    ({ query, categoryIndexes, materialsByCategory }) =>
      toRepositoryMaterialQueries(query, categoryIndexes, materialsByCategory),
  );
  const allRepositoryQueries = expandedMaterialQueries;
  const automaticProcessingQueries =
    processingQueries.length > 0
      ? []
      : supportedMaterialQueries.length > 0
      ? [
            {
              queryId: 'p1',
              categories: [
                ...new Set(supportedMaterialQueries.flatMap(({ query }) => query.categories)),
              ],
              processingCategories: ['加工/切工' as const],
              targetSpecs: supportedMaterialQueries.flatMap(({ query }) =>
                query.categories.map<ProcessingTargetSpec>((category) => ({
                  queryId: query.queryId,
                  category,
                  ...(query.thicknessMm ? { thicknessMm: query.thicknessMm } : {}),
                })),
              ),
            },
          ]
        : [];
  const processingPriceQueries = [...automaticProcessingQueries, ...processingQueries];
  const processingCategories = [
    ...new Set(processingPriceQueries.flatMap((query) => query.processingCategories)),
  ];
  const [repositoryGroups, cuttingPrices, processingCandidates] = await Promise.all([
    allRepositoryQueries.length > 0
      ? searchSteelPriceCandidateGroups(client, { queries: allRepositoryQueries })
      : Promise.resolve([]),
    allRepositoryQueries.length > 0
      ? searchSteelCuttingPriceGroups(client, allRepositoryQueries)
      : Promise.resolve([]),
    processingCategories.length > 0
      ? searchSteelProcessingPriceCandidates(client, {
          categories: processingCategories,
        })
      : Promise.resolve([]),
  ]);
  const groupsByIndex = new Map(repositoryGroups.map((group) => [group.queryIndex, group]));
  const cuttingCandidateMatches = expandedMaterialQueries.map((query, queryIndex) => ({
    queryId: query.queryId,
    category: query.category,
    candidates: groupsByIndex.get(queryIndex)?.candidates ?? [],
  }));
  const filteredCuttingPrices = filterSteelCuttingPriceGroups(
    cuttingPrices,
    cuttingCandidateMatches,
  );
  const expandedQueryToInputQuery = new Map<string, string>();
  supportedMaterialQueries.forEach(({ query, categoryIndexes }) => {
    categoryIndexes.forEach((categoryIndex) => {
      expandedQueryToInputQuery.set(`${query.queryId}:c${categoryIndex + 1}`, query.queryId);
    });
  });
  let matchedQueryCount = 0;
  let candidateCount = 0;
  let categoryCandidateCount = 0;
  let materialOffset = 0;
  const computedMaterialResults = new Map<string, SteelRawToolOutput>();
  supportedMaterialQueries.forEach(({ query: supportedQuery }) => {
    const combinedCandidates: SteelPriceItem[] = [];
    const categoryCandidates: SteelPriceCategoryCandidate[] = [];
    const seenPriceRowIds = new Set<number>();
    supportedQuery.categories.forEach((category, categoryIndex) => {
      const repositoryGroup = groupsByIndex.get(materialOffset + categoryIndex);
      const orderedCandidates = orderPriceCandidates(
        { category, keyword: supportedQuery.keyword },
        repositoryGroup?.candidates ?? [],
      );
      orderedCandidates.forEach((candidate) => {
        if (!isUsablePriceCandidate(candidate)) {
          return;
        }
        if (seenPriceRowIds.has(candidate.id)) return;
        seenPriceRowIds.add(candidate.id);
        combinedCandidates.push(candidate);
      });
      categoryCandidates.push(...(repositoryGroup?.categoryCandidates ?? []));
    });
    materialOffset += supportedQuery.categories.length;
    const totalAvailable = combinedCandidates.length;
    const candidates = combinedCandidates.slice(0, 250).map(toSafePriceCandidate);
    const metadata = metadataByQueryId.get(supportedQuery.queryId)!;
    const matched = totalAvailable > 0 || categoryCandidates.length > 0;

    candidateCount += totalAvailable;
    categoryCandidateCount += categoryCandidates.length;
    matchedQueryCount += matched ? 1 : 0;

    computedMaterialResults.set(supportedQuery.queryId, {
      queryId: supportedQuery.queryId,
      query: materialQueries.find((materialQuery) => materialQuery.queryId === supportedQuery.queryId) ?? supportedQuery,
      status: matched ? 'ok' : 'no_match',
      candidates,
      totalAvailable,
      returnedCount: candidates.length,
      truncated: candidates.length < totalAvailable,
      defaultMaterial: metadata.defaultMaterial,
      availableMaterials: metadata.availableMaterials,
      defaultWhiteSteelSurface: metadata.defaultWhiteSteelSurface,
      availableWhiteSteelSurfaces: metadata.availableWhiteSteelSurfaces,
      categoryMaterialOptions: metadata.categoryMaterialOptions,
      categoryCandidates,
      ...(unsupportedMaterialsByQueryId.has(supportedQuery.queryId)
        ? { unsupportedMaterials: unsupportedMaterialsByQueryId.get(supportedQuery.queryId) }
        : {}),
    });
  });
  const queryResults = materialQueries.map(
    (query) =>
      precomputedMaterialResults.get(query.queryId) ?? computedMaterialResults.get(query.queryId)!,
  );
  const processingQueryResults: SteelRawToolOutput[] = processingPriceQueries.map((query) => ({
    ...buildProcessingPrice(
      processingCandidates,
      query.categories,
      query.processingCategories,
      'keyword' in query ? query.keyword : undefined,
      'targetSpecs' in query ? query.targetSpecs : undefined,
    ),
    queryId: query.queryId,
  }));
  const processingPrice = {
    maxQueries: 3,
    queryResults: processingQueryResults,
  };
  const explicitProcessingResults = processingQueryResults.slice(
    automaticProcessingQueries.length,
  );
  const matchedProcessingQueryCount = explicitProcessingResults.filter(
    (result) =>
      typeof result.totalAvailable === 'number' && result.totalAvailable > 0,
  ).length;
  const totalMatchedQueryCount =
    matchedQueryCount + matchedProcessingQueryCount;

  return {
    queryResults,
    cuttingPrices: filteredCuttingPrices.map((group) => ({
      ...group,
      queryIds: [
        ...new Set(group.queryIds.map((queryId) => expandedQueryToInputQuery.get(queryId) ?? queryId)),
      ],
      candidateMatches: group.candidateMatches.map((match) => ({
        ...match,
        queryId: expandedQueryToInputQuery.get(match.queryId) ?? match.queryId,
      })),
      prices: group.prices.map(toSafeCuttingPriceRecord),
    })),
    summary: {
      queryCount: input.queries.length,
      groupCount: queryResults.length,
      matchedQueryCount: totalMatchedQueryCount,
      noMatchQueryCount: input.queries.length - totalMatchedQueryCount,
      candidateCount,
      categoryCandidateCount,
    },
    processingPrice,
  };
}

async function emitLog(
  options: ExecuteSteelToolOptions,
  status: 'success' | 'error',
  durationMs: number,
  outputSummary: string,
  sourceRefs: SteelSourceRef[],
  errorCategory?: SteelToolErrorCategory,
) {
  await options.log?.({
    toolName: options.toolName,
    providerToolCallId: options.providerToolCallId,
    status,
    durationMs,
    inputSummary: summarizeInput(options.arguments),
    outputSummary,
    sourceRefs,
    errorCategory,
    redactionVersion: steelToolRedactionVersion,
  });
}

async function errorResult(
  options: ExecuteSteelToolOptions,
  startTime: number,
  errorCategory: SteelToolErrorCategory,
  errorSummary: string,
): Promise<SteelToolResult> {
  const now = options.now ?? Date.now;
  const durationMs = getDurationMs(startTime, now);

  await emitLog(options, 'error', durationMs, errorSummary, [], errorCategory);

  return {
    ok: false,
    toolName: options.toolName,
    errorCategory,
    errorSummary,
    durationMs,
    redactionVersion: steelToolRedactionVersion,
  };
}

async function dispatchSteelTool(
  options: ExecuteSteelToolOptions,
  toolName: SteelToolName,
  args: DispatchSteelToolArgs,
): Promise<SteelRawToolOutput> {
  const { client } = options;

  switch (toolName) {
    case 'search_customers': {
      const input = args as SearchCustomersInput;
      const customers = await searchSteelCustomers(client, input);

      return {
        customers,
      };
    }
    case 'search_price_candidates': {
      const input = args as SearchPriceCandidatesInput;

      return searchPriceCandidates(client, input);
    }
    default:
      throw new Error(`Unhandled Steel tool: ${toolName}`);
  }
}

function reserveToolCall(
  runState: SteelToolRunState | undefined,
  toolName: string,
): boolean {
  if (!runState) {
    return true;
  }

  if (runState.callsUsed >= runState.maxCalls) {
    return false;
  }

  const maxCallsForTool = runState.maxCallsByTool?.[toolName as SteelToolName];
  const callsUsedForTool = runState.callsUsedByTool?.[toolName as SteelToolName] ?? 0;
  if (maxCallsForTool !== undefined && callsUsedForTool >= maxCallsForTool) {
    return false;
  }

  runState.callsUsed += 1;
  if (runState.maxCallsByTool) {
    runState.callsUsedByTool ??= {};
    runState.callsUsedByTool[toolName as SteelToolName] = callsUsedForTool + 1;
  }
  return true;
}

export async function executeSteelTool(options: ExecuteSteelToolOptions): Promise<SteelToolResult> {
  const now = options.now ?? Date.now;
  const startTime = now();

  if (!isExecutableSteelToolName(options.toolName)) {
    return errorResult(
      options,
      startTime,
      'unknown_tool',
      `Unknown Steel tool: ${options.toolName}`,
    );
  }

  if (!reserveToolCall(options.runState, options.toolName)) {
    return errorResult(options, startTime, 'rate_limited', 'Steel tool call limit exceeded');
  }

  const definition = getExecutableSteelToolDefinition(options.toolName);
  const parsedArgs = definition.argsSchema.safeParse(options.arguments);

  if (!parsedArgs.success) {
    return errorResult(
      options,
      startTime,
      'invalid_arguments',
      parsedArgs.error.issues.map((issue) => issue.message).join('; '),
    );
  }

  try {
    const rawData = await dispatchSteelTool(options, options.toolName, parsedArgs.data);
    const data = sanitizeSteelToolOutput(rawData);
    const sourceRefs = collectSourceRefs(data);
    const durationMs = getDurationMs(startTime, now);

    await emitLog(options, 'success', durationMs, summarizeOutput(data), sourceRefs);

    return {
      ok: true,
      toolName: options.toolName,
      data,
      sourceRefs,
      durationMs,
      redactionVersion: steelToolRedactionVersion,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Steel tool repository error';
    return errorResult(options, startTime, 'repository_error', message);
  }
}
