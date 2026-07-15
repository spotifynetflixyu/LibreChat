import {
  filterSteelCuttingPriceGroups,
  searchSteelCustomers,
  searchSteelCuttingPriceGroups,
  searchSteelPriceCandidateGroups,
  searchSteelPricesByProductNames,
  searchSteelProcessingPriceCandidates,
} from '../repositories';
import {
  hasUnusableProcessingProductName,
  isProcessingCandidateApplicable,
  matchesProcessingKeyword,
  processingPriceCategories,
} from '../pricing/processing-candidates';
import { getExecutableSteelToolDefinition, isExecutableSteelToolName } from './registry';
import { sanitizeSteelToolOutput, steelToolRedactionVersion } from './sanitize';
import { steelToolArgsSchemas } from './schemas';

import type {
  SteelToolResult,
  SteelToolLogger,
  SteelToolJsonObject,
  SteelToolErrorCategory,
} from './results';
import type { SteelRepositoryClient, SteelSourceRef } from '../repositories/types';
import type { SteelPriceItem, SteelPriceTierValues } from '../repositories';
import type { PriceCategory } from '../pricing/enums';
import type { SteelToolName } from './schemas';

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
  const {
    tierPrices,
    tierRatios,
    unitPriceBase: _unitPriceBase,
    ...candidateFields
  } = candidate;
  const pricingOptions: SteelRawToolOutput[] = [];
  const skippedPricingOptions: SteelRawToolOutput[] = [];
  const hasTierPrices = hasPriceTierValue(tierPrices);
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

  if (hasTierPrices) {
    pricingOptions.push({
      source: 'tier_price',
      quoteEligible: true,
      quoteUnit: candidate.unit ?? null,
      tierPrices,
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

function getPlatePriceModeRank(candidate: SteelPriceItem): number {
  const text = `${candidate.productName ?? ''} ${candidate.normalizedSpecText ?? ''}`;
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
  const text = `${candidate.productName ?? ''} ${candidate.normalizedSpecText ?? ''}`;
  return text.includes('磨光') ? 1 : 0;
}

function orderPriceCandidates(
  query: SearchPriceCandidatesInput['queries'][number],
  candidates: readonly SteelPriceItem[],
): SteelPriceItem[] {
  if (query.mode === 'category_discovery') {
    return [...candidates];
  }

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

const processingPriceItemLimit = 10;

const suggestedProcessingKeywords: Partial<Record<string, readonly string[]>> = {
  '加工/切工': ['剪床', '雷射', '鋸床', '水刀', '火', '外形切割', '直線切割'],
  '加工/孔': ['沖床', '雷射', '鑽床', '水刀', '圓孔', '方孔', '菱形孔', '長孔', '橢圓孔'],
  '加工/折工': ['折型符號', '厚度', '長度'],
  '加工/其他': ['滾圓', '端板', '喇叭桶', '壓花', '拋光', '雷射畫線'],
};

function getProcessingQueries(input: SearchPriceCandidatesInput) {
  if (input.processingQueries) {
    return input.processingQueries;
  }

  const categories = [
    ...new Set(
      input.queries.flatMap((query) => {
        if (query.mode === 'category_discovery' || query.category.startsWith('加工/')) {
          return [];
        }
        return [query.category];
      }),
    ),
  ];

  return categories.length > 0 ? [{ queryId: 'p1', categories }] : [];
}

function buildProcessingPrice(
  candidates: readonly SteelPriceItem[],
  targetCategories: readonly PriceCategory[],
  requestedProcessingCategories: readonly PriceCategory[] | undefined,
  keyword: string | undefined,
  productNames: readonly string[] | undefined,
): SteelRawToolOutput {
  const targets = new Set(targetCategories);
  const requested = requestedProcessingCategories
    ? new Set(requestedProcessingCategories)
    : undefined;
  const requestedProductNames = productNames
    ? new Set(productNames.map((name) => name.normalize('NFKC').trim()))
    : undefined;
  const applicable = candidates.flatMap((candidate) => {
    if (
      (requested && !requested.has(candidate.category as PriceCategory)) ||
      (requestedProductNames &&
        (!candidate.productName ||
          !requestedProductNames.has(candidate.productName.normalize('NFKC').trim()))) ||
      (!requestedProductNames && !isProcessingCandidateApplicable(candidate, targets)) ||
      !matchesProcessingKeyword(candidate, keyword)
    ) {
      return [];
    }

    const safe = toSafePriceCandidate(candidate);
    return safe.quoteEligible === true ? [safe] : [];
  });
  const availableCounts = new Map<string, number>();
  applicable.forEach((candidate) => {
    const category = String(candidate.category);
    availableCounts.set(category, (availableCounts.get(category) ?? 0) + 1);
  });
  const allProductNames = [
    ...new Set(
      applicable.flatMap((candidate) =>
        typeof candidate.productName === 'string' ? [candidate.productName] : [],
      ),
    ),
  ];
  const selectionRequired = !requestedProductNames && applicable.length > processingPriceItemLimit;
  const returnedCandidates = selectionRequired ? [] : applicable;
  const grouped = new Map<string, SteelRawToolOutput[]>();
  returnedCandidates.forEach((candidate) => {
    const category = String(candidate.category);
    const items = grouped.get(category) ?? [];
    items.push(candidate);
    grouped.set(category, items);
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
    requestedProductNames: productNames ?? [],
    discoveryItemLimit: processingPriceItemLimit,
    totalAvailable: applicable.length,
    returnedCount: returnedCandidates.length,
    selectionRequired,
    productNames: selectionRequired ? allProductNames : [],
    truncated: false,
    groups: processingPriceCategories.flatMap((category) => {
      const items = grouped.get(category) ?? [];
      return items.length > 0
        ? [{ processingCategory: category, totalAvailable: items.length, items }]
        : [];
    }),
    availableByCategory,
    suggestedKeywords: availableByCategory.flatMap((group) =>
      group.totalAvailable > processingPriceItemLimit
        ? (suggestedProcessingKeywords[group.processingCategory] ?? [])
        : [],
    ),
  };
}

async function searchPriceCandidates(
  client: SteelRepositoryClient,
  input: SearchPriceCandidatesInput,
): Promise<SteelRawToolOutput> {
  if (input.productNames) {
    const candidates = await searchSteelPricesByProductNames(client, input.productNames);
    const productNamePrices = candidates
      .filter((candidate) => !hasUnusableProcessingProductName(candidate))
      .map(toSafePriceCandidate);

    return {
      productNames: input.productNames,
      productNamePrices,
      summary: {
        requestedProductNameCount: input.productNames.length,
        priceCount: productNamePrices.length,
      },
    };
  }

  const processingQueries = getProcessingQueries(input);
  const [repositoryGroups, cuttingPrices, processingCandidates] = await Promise.all([
    searchSteelPriceCandidateGroups(client, { queries: input.queries }),
    searchSteelCuttingPriceGroups(client, input.queries),
    processingQueries.length > 0
      ? searchSteelProcessingPriceCandidates(client)
      : Promise.resolve([]),
  ]);
  const groupsByIndex = new Map(repositoryGroups.map((group) => [group.queryIndex, group]));
  const candidatesByCategory = new Map<PriceCategory, SteelPriceItem[]>();
  input.queries.forEach((query, queryIndex) => {
    if (query.mode === 'category_discovery') {
      return;
    }
    const candidates = candidatesByCategory.get(query.category) ?? [];
    const seen = new Set(candidates.map((candidate) => candidate.id));
    (groupsByIndex.get(queryIndex)?.candidates ?? []).forEach((candidate) => {
      if (!seen.has(candidate.id)) {
        seen.add(candidate.id);
        candidates.push(candidate);
      }
    });
    candidatesByCategory.set(query.category, candidates);
  });
  const cuttingCandidateMatches = input.queries.flatMap((query) => {
    if (query.mode === 'category_discovery') {
      return [];
    }
    return [
      {
        queryId: query.queryId,
        category: query.category,
        candidates: candidatesByCategory.get(query.category) ?? [],
      },
    ];
  });
  const filteredCuttingPrices = filterSteelCuttingPriceGroups(
    cuttingPrices,
    cuttingCandidateMatches,
  );
  let matchedQueryCount = 0;
  let candidateCount = 0;
  let categoryCandidateCount = 0;
  const queryResults = input.queries.map((query, queryIndex) => {
    const repositoryGroup = groupsByIndex.get(queryIndex);
    const candidates = orderPriceCandidates(query, repositoryGroup?.candidates ?? []).map(
      toSafePriceCandidate,
    );
    const categoryCandidates = repositoryGroup?.categoryCandidates ?? [];
    const matched = candidates.length > 0 || categoryCandidates.length > 0;

    candidateCount += candidates.length;
    categoryCandidateCount += categoryCandidates.length;
    matchedQueryCount += matched ? 1 : 0;

    return {
      queryId: query.queryId,
      query,
      status: matched ? 'ok' : 'no_match',
      candidates,
      categoryCandidates,
      issues: [],
    };
  });
  const processingQueryResults = processingQueries.map((query) => ({
    ...buildProcessingPrice(
      processingCandidates,
      'categories' in query ? query.categories : [],
      'processingCategories' in query ? query.processingCategories : undefined,
      'keyword' in query ? query.keyword : undefined,
      'productNames' in query && Array.isArray(query.productNames)
        ? query.productNames.filter((value): value is string => typeof value === 'string')
        : undefined,
    ),
    queryId: query.queryId,
  }));
  const processingPrice = {
    maxQueries: 3,
    maxDiscoveryItemsPerQuery: processingPriceItemLimit,
    queryResults: processingQueryResults,
  };
  return {
    queryResults,
    cuttingPrices: filteredCuttingPrices,
    summary: {
      queryCount: input.queries.length,
      groupCount: queryResults.length,
      matchedQueryCount,
      noMatchQueryCount: input.queries.length - matchedQueryCount,
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
