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
  hasUnusableProcessingProductName,
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
  searchSteelPricesByErpItemCodes,
  searchSteelProcessingPriceCandidates,
} from '../repositories';
import { getExecutableSteelToolDefinition, isExecutableSteelToolName } from './registry';
import { sanitizeSteelToolOutput, steelToolRedactionVersion } from './sanitize';
import { priceLookupMaterialKinds } from '../pricing/enums';
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

export function createSteelToolRunState(maxCalls: number): SteelToolRunState {
  if (!Number.isInteger(maxCalls) || maxCalls < 1) {
    throw new Error('Steel tool maxCalls must be a positive integer');
  }

  return {
    maxCalls,
    callsUsed: 0,
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

function getLongMaterialBillingPolicy(candidate: SteelPriceItem): SteelRawToolOutput {
  if (!['圓條', '圓管', '方管', '扁方管'].includes(candidate.category)) {
    return {};
  }
  if (candidate.unit === 'Kg') {
    return { materialBillingMode: 'weight' };
  }
  if (candidate.unit === '支' || candidate.unit === '只') {
    return {
      materialBillingMode: 'whole_stock',
      cuttingFeePolicy: 'add_when_cut',
    };
  }

  return { materialBillingMode: 'direct_unit' };
}

function toSafePriceCandidate(candidate: SteelPriceItem): SteelRawToolOutput {
  const { tierPrices, tierRatios, unitPriceBase, ...candidateFields } = candidate;
  const pricingOptions: SteelRawToolOutput[] = [];
  const skippedPricingOptions: SteelRawToolOutput[] = [];
  const hasTierPrices = hasPriceTierValue(tierPrices);
  const resolvedPriceTiers = resolveTierPrices(tierPrices, unitPriceBase);
  const hasResolvedTierPrices = hasPriceTierValue(resolvedPriceTiers.tierPrices);
  const hasTierRatios = hasPriceTierValue(tierRatios);
  const ratioAsKgTierPrice =
    candidate.valueState === 'ratio_only' &&
    (candidate.unit === 'Kg' || candidate.unit === '支') &&
    !hasTierPrices &&
    hasTierRatios;
  const ratioAsProcessingTierPrice =
    candidate.valueState === 'ratio_only' &&
    candidate.category.startsWith('加工/') &&
    !hasTierPrices &&
    hasTierRatios;
  const effectiveCandidate = ratioAsKgTierPrice ? { ...candidate, unit: 'Kg' } : candidate;
  const effectiveCandidateFields = ratioAsKgTierPrice
    ? { ...candidateFields, unit: 'Kg' }
    : candidateFields;

  if (hasResolvedTierPrices) {
    pricingOptions.push({
      source: 'tier_price',
      quoteEligible: true,
      quoteUnit: candidate.unit ?? null,
      tierPrices: resolvedPriceTiers.tierPrices,
      defaultQuoteTier: resolvedPriceTiers.defaultQuoteTier,
      defaultQuoteUnitPrice: resolvedPriceTiers.defaultQuoteUnitPrice,
      ...(resolvedPriceTiers.fallbackTiers.length > 0
        ? {
            fallbackTiers: resolvedPriceTiers.fallbackTiers,
            manualReviewRequired: true,
            manualReviewNotes: [resolvedPriceTiers.manualReviewNote],
          }
        : {}),
    });
  }

  if (ratioAsKgTierPrice) {
    pricingOptions.push({
      source: 'tier_price',
      quoteEligible: true,
      quoteUnit: 'Kg',
      tierPrices: tierRatios,
    });
  } else if (ratioAsProcessingTierPrice) {
    pricingOptions.push({
      source: 'tier_price',
      quoteEligible: true,
      quoteUnit: candidate.unit ?? null,
      tierPrices: tierRatios,
    });
  } else if (hasTierRatios && (candidate.unit === 'Kg' || candidate.unit === 'M')) {
    pricingOptions.push({
      source: 'price_ratio',
      quoteEligible: true,
      quoteUnit: candidate.unit,
      tierPrices: tierRatios,
    });
  } else if (hasTierRatios) {
    skippedPricingOptions.push({
      source: 'price_ratio',
      status: 'skipped',
      reason: 'category_rule_pending',
      quoteEligible: false,
      quoteUnit: candidate.unit ?? null,
    });
  }

  return {
    ...effectiveCandidateFields,
    ...getLongMaterialBillingPolicy(effectiveCandidate),
    quoteEligible: pricingOptions.length > 0,
    pricingOptions,
    skippedPricingOptions,
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

const materialCandidateSelectionThreshold = 20;

type PriceQuery = SearchPriceCandidatesInput['queries'][number];
type ProcessingPriceQuery = Extract<PriceQuery, { processingCategories: PriceCategory[] }>;
type ExactPriceQuery = Extract<PriceQuery, { erpItemCodes: string[] }>;
type MaterialPriceQuery = Exclude<PriceQuery, ProcessingPriceQuery | ExactPriceQuery>;

interface ProcessingTargetSpec {
  queryId: string;
  category: PriceCategory;
  thicknessMm?: readonly string[];
}

function isExactPriceQuery(
  query: SearchPriceCandidatesInput['queries'][number],
): query is ExactPriceQuery {
  return 'erpItemCodes' in query;
}

function isProcessingPriceQuery(
  query: SearchPriceCandidatesInput['queries'][number],
): query is ProcessingPriceQuery {
  return 'processingCategories' in query;
}

function isMaterialPriceQuery(
  query: SearchPriceCandidatesInput['queries'][number],
): query is MaterialPriceQuery {
  return !isExactPriceQuery(query) && !isProcessingPriceQuery(query);
}

function normalizeMaterial(
  value: string | undefined,
  category: PriceCategory,
  thicknessMm: readonly string[] | undefined,
): PriceLookupMaterialKind | undefined {
  const key = value?.normalize('NFKC').trim().toUpperCase();
  if (key && (key.includes('2B') || key.includes('霧面'))) return '2B';
  if (key?.includes('NO1')) return 'NO1';
  if (key && (/(?:^|[\s/])HL(?:$|[\s/])/u.test(key) || key === 'STHL' || /[沙砂]面/u.test(key))) {
    return 'HL';
  }
  if (key && (/(?:^|[\s/])BA(?:$|[\s/])/u.test(key) || key === 'STBA' || key.includes('亮面'))) {
    return 'BA';
  }
  if (key === '熱浸鍍' || key === '熱浸鍍鋅' || key === '熱進鍍鋅') return '錏';
  if (key && priceLookupMaterialKinds.includes(key as PriceLookupMaterialKind)) {
    return key as PriceLookupMaterialKind;
  }
  if (key === '不鏽鋼' || key?.includes('白鐵')) return '白鐵';
  if (key === 'ST') {
    if (category !== '鐵板' || !thicknessMm || thicknessMm.length === 0) return '白鐵';
    const thicknesses = thicknessMm.map(Number);
    if (thicknesses.every((thickness) => thickness < 3)) return '2B';
    if (thicknesses.every((thickness) => thickness >= 3)) return 'NO1';
    return '白鐵';
  }
  return undefined;
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
): Array<SteelPriceLookupQuery> {
  return query.categories.map((category, categoryIndex) => {
    const material = normalizeMaterial(query.material, category, query.thicknessMm);
    const unit = normalizeUnit(query.unit, category);
    return {
      queryId: `${query.queryId}:c${categoryIndex + 1}`,
      category,
      ...(query.subcategory ? { subcategory: query.subcategory } : {}),
      ...(material ? { material } : {}),
      ...(unit ? { unit } : {}),
      ...(query.thicknessMm ? { thicknessMm: query.thicknessMm } : {}),
      ...(query.stockLengthMm ? { stockLengthMm: query.stockLengthMm } : {}),
      ...(query.keyword ? { keyword: query.keyword } : {}),
    };
  });
}

const candidateRefFields = [
  'lengthMm',
  'unitWeightValue',
  'thicknessMinMm',
  'thicknessMaxMm',
  'widthMm',
  'heightMm',
  'outerDiameterMm',
  'nominalInch',
  'webMm',
  'flangeMm',
  'lipMm',
  'sheetWidthMm',
  'sheetLengthMm',
  'unit',
] as const satisfies readonly (keyof SteelPriceItem)[];

function toCandidateRef(candidate: SteelPriceItem): SteelRawToolOutput | undefined {
  if (
    typeof candidate.erpItemCode !== 'string' ||
    candidate.erpItemCode.trim() === '' ||
    !candidate.productName ||
    candidate.productName.trim() === ''
  ) {
    return undefined;
  }

  const ref: SteelRawToolOutput = {
    erpItemCode: candidate.erpItemCode,
    productName: candidate.productName,
    category: candidate.category,
  };
  for (const field of candidateRefFields) {
    const value = candidate[field];
    if (value !== null && value !== undefined) {
      ref[field] = value;
    }
  }
  return ref;
}

function isUsablePriceCandidate(candidate: SteelPriceItem): boolean {
  return (
    typeof candidate.erpItemCode === 'string' &&
    candidate.erpItemCode.trim() !== '' &&
    typeof candidate.productName === 'string' &&
    candidate.productName.trim() !== ''
  );
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
        ...(matchedTargetSpecs
          ? { matchedQueryIds: matchedTargetSpecs.map(({ queryId }) => queryId) }
          : {}),
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
  const availableByCategory = processingPriceCategories.flatMap((category) => {
    const totalAvailable = availableCounts.get(category) ?? 0;
    return totalAvailable > 0 ? [{ processingCategory: category, totalAvailable }] : [];
  });

  return {
    queryId: null,
    targetCategories,
    processingCategories: requestedProcessingCategories ?? [...processingPriceCategories],
    keyword: keyword ?? null,
    targetSpecs: targetSpecs ?? [],
    totalAvailable: applicable.length,
    returnedCount: applicable.length,
    selectionRequired: false,
    truncated: false,
    groups: processingPriceCategories.flatMap((category) => {
      const items = grouped.get(category) ?? [];
      return items.length > 0
        ? [{ processingCategory: category, totalAvailable: items.length, items }]
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
  const exactQueries = input.queries.filter(isExactPriceQuery);
  const materialQueries = input.queries.filter(isMaterialPriceQuery);
  const processingQueries = input.queries.filter(isProcessingPriceQuery);

  const exactRequestedCodes = exactQueries.flatMap((query) => query.erpItemCodes);
  if (exactQueries.length > 0 && materialQueries.length === 0 && processingQueries.length === 0) {
    const requestedErpItemCodes = [...new Set(exactRequestedCodes)];
    const selectedCandidates = await searchSteelPricesByErpItemCodes(client, requestedErpItemCodes);
    const candidatesByErpItemCode = new Map(
      selectedCandidates
        .filter(
          (candidate) =>
            isUsablePriceCandidate(candidate) && !hasUnusableProcessingProductName(candidate),
        )
        .map((candidate) => [candidate.erpItemCode, toSafePriceCandidate(candidate)]),
    );
    const buildExactResult = (query: ExactPriceQuery): SteelRawToolOutput => {
      const candidates = query.erpItemCodes.flatMap((erpItemCode) => {
        const candidate = candidatesByErpItemCode.get(erpItemCode);
        return candidate ? [candidate] : [];
      });
      const missingErpItemCodes = query.erpItemCodes.filter(
        (erpItemCode) => !candidatesByErpItemCode.has(erpItemCode),
      );
      return {
        ...(exactQueries.length > 1 ? { queryId: query.queryId } : {}),
        erpItemCodes: query.erpItemCodes,
        candidates,
        missingErpItemCodes,
        nextAction: missingErpItemCodes.length === 0 ? 'use_candidates' : 'manual_review',
      };
    };

    if (exactQueries.length === 1) {
      return buildExactResult(exactQueries[0]!);
    }

    return { exactResults: exactQueries.map(buildExactResult) };
  }

  const expandedMaterialQueries = materialQueries.flatMap(toRepositoryMaterialQueries);
  const allRepositoryQueries = expandedMaterialQueries;
  const automaticProcessingQueries =
    processingQueries.length > 0
      ? []
      : materialQueries.length > 0
        ? [
            {
              queryId: 'p1',
              categories: [...new Set(materialQueries.flatMap((query) => query.categories))],
              processingCategories: ['加工/切工' as const],
              targetSpecs: materialQueries.flatMap((query) =>
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
  materialQueries.forEach((query) => {
    query.categories.forEach((_, categoryIndex) => {
      expandedQueryToInputQuery.set(`${query.queryId}:c${categoryIndex + 1}`, query.queryId);
    });
  });
  let matchedQueryCount = 0;
  let candidateCount = 0;
  let categoryCandidateCount = 0;
  let materialOffset = 0;
  const queryResults = materialQueries.map((query) => {
    const combinedCandidates: SteelPriceItem[] = [];
    const categoryCandidates: SteelPriceCategoryCandidate[] = [];
    const seenErpItemCodes = new Set<string>();
    let omittedCandidateCount = 0;
    query.categories.forEach((category, categoryIndex) => {
      const repositoryGroup = groupsByIndex.get(materialOffset + categoryIndex);
      const orderedCandidates = orderPriceCandidates(
        { category, keyword: query.keyword },
        repositoryGroup?.candidates ?? [],
      );
      orderedCandidates.forEach((candidate) => {
        if (!isUsablePriceCandidate(candidate)) {
          omittedCandidateCount += 1;
          return;
        }
        if (seenErpItemCodes.has(candidate.erpItemCode)) return;
        seenErpItemCodes.add(candidate.erpItemCode);
        combinedCandidates.push(candidate);
      });
      categoryCandidates.push(...(repositoryGroup?.categoryCandidates ?? []));
    });
    materialOffset += query.categories.length;
    const allCandidates = combinedCandidates.map(toSafePriceCandidate);
    const selectionRequired = allCandidates.length > materialCandidateSelectionThreshold;
    const candidates = selectionRequired ? [] : allCandidates;
    const candidateRefs = selectionRequired
      ? combinedCandidates.reduce<{ refs: SteelRawToolOutput[]; omitted: number }>(
          (result, candidate) => {
            const ref = toCandidateRef(candidate);
            if (!ref || typeof ref.erpItemCode !== 'string') {
              result.omitted += 1;
              return result;
            }
            if (result.refs.some((item) => item.erpItemCode === ref.erpItemCode)) {
              return result;
            }
            result.refs.push(ref);
            return result;
          },
          { refs: [], omitted: 0 },
        )
      : { refs: [], omitted: 0 };
    const matched = allCandidates.length > 0 || categoryCandidates.length > 0;

    candidateCount += allCandidates.length;
    categoryCandidateCount += categoryCandidates.length;
    matchedQueryCount += matched ? 1 : 0;

    return {
      queryId: query.queryId,
      query,
      status: matched ? 'ok' : 'no_match',
      candidates,
      ...(selectionRequired ? { candidateRefs: candidateRefs.refs } : {}),
      totalAvailable: allCandidates.length,
      returnedCount: candidates.length,
      selectionRequired,
      nextAction: selectionRequired
        ? 'select_erp_item_codes'
        : matched
          ? 'use_candidates'
          : 'retry_query_once',
      ...(omittedCandidateCount + candidateRefs.omitted > 0
        ? { candidateRefsOmittedCount: omittedCandidateCount + candidateRefs.omitted }
        : {}),
      categoryCandidates,
      issues:
        omittedCandidateCount + candidateRefs.omitted > 0
          ? [
              `candidate_refs_omitted_missing_display_fields:${
                omittedCandidateCount + candidateRefs.omitted
              }`,
            ]
          : [],
    };
  });
  const processingQueryResults = processingPriceQueries.map((query) => ({
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
  let exactResults: SteelRawToolOutput[] = [];
  if (exactQueries.length > 0) {
    const requestedErpItemCodes = [...new Set(exactRequestedCodes)];
    const selectedCandidates = await searchSteelPricesByErpItemCodes(client, requestedErpItemCodes);
    const candidatesByErpItemCode = new Map(
      selectedCandidates
        .filter(
          (candidate) =>
            isUsablePriceCandidate(candidate) && !hasUnusableProcessingProductName(candidate),
        )
        .map((candidate) => [candidate.erpItemCode, toSafePriceCandidate(candidate)]),
    );
    exactResults = exactQueries.map((query) => {
      const candidates = query.erpItemCodes.flatMap((erpItemCode) => {
        const candidate = candidatesByErpItemCode.get(erpItemCode);
        return candidate ? [candidate] : [];
      });
      const missingErpItemCodes = query.erpItemCodes.filter(
        (erpItemCode) => !candidatesByErpItemCode.has(erpItemCode),
      );
      return {
        queryId: query.queryId,
        erpItemCodes: query.erpItemCodes,
        candidates,
        missingErpItemCodes,
        nextAction: missingErpItemCodes.length === 0 ? 'use_candidates' : 'manual_review',
      };
    });
  }

  const explicitProcessingResults = processingQueryResults.slice(
    automaticProcessingQueries.length,
  );
  const matchedProcessingQueryCount = explicitProcessingResults.filter(
    (result) =>
      typeof result.totalAvailable === 'number' && result.totalAvailable > 0,
  ).length;
  const matchedExactQueryCount = exactResults.filter(
    (result) => Array.isArray(result.candidates) && result.candidates.length > 0,
  ).length;
  const totalMatchedQueryCount =
    matchedQueryCount + matchedProcessingQueryCount + matchedExactQueryCount;

  return {
    queryResults,
    ...(exactResults.length > 0 ? { exactResults } : {}),
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

function reserveToolCall(runState: SteelToolRunState | undefined): boolean {
  if (!runState) {
    return true;
  }

  if (runState.callsUsed >= runState.maxCalls) {
    return false;
  }

  runState.callsUsed += 1;
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

  if (!reserveToolCall(options.runState)) {
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
