import {
  lookupSteelCatalogFamilies,
  searchSteelCatalogFamilyRules,
  searchSteelCustomers,
  searchSteelCustomerRules,
  searchSteelInstructionPackets,
  searchSteelPriceItems,
  searchSteelQuoteRules,
  searchSteelQuoteDefaults,
} from '../repositories';
import { getSteelToolDefinition, isSteelToolName } from './registry';
import { sanitizeSteelToolOutput, steelToolRedactionVersion } from './sanitize';
import { steelToolArgsSchemas, type SteelToolName } from './schemas';
import { generateSteelPriceSearchTerms } from '../normalization';
import {
  getQuoteRulesDefaultsInput,
  getSteelInstructionPacketSearchInput,
  lookupSteelQuoteRules,
} from './instructions';
import { getSteelQuoteDefaultSearchInput } from './defaults';
import { toCatalogFamilyRules, toCustomerRuleArray, toQuoteRulesRuleArray } from './rules';

import type {
  SteelToolResult,
  SteelToolLogger,
  SteelToolJsonObject,
  SteelToolErrorCategory,
} from './results';
import type { SteelRepositoryClient, SteelSourceRef } from '../repositories/types';
import type { SteelCustomer, SteelPriceItem } from '../repositories';
import type { LookupQuoteRulesInput } from './schemas';

type SteelRawToolOutput = { [key: string]: unknown };
type SearchPriceCandidatesInput = ReturnType<
  typeof steelToolArgsSchemas.search_price_candidates.parse
>;

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

function collectSourceRefs(value: unknown, refs: SteelSourceRef[] = []): SteelSourceRef[] {
  if (refs.length >= 100 || value === null || value === undefined) {
    return refs;
  }

  if (isSourceRef(value)) {
    refs.push(value);
    return refs;
  }

  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((entry) => collectSourceRefs(entry, refs));
    return refs;
  }

  if (typeof value !== 'object') {
    return refs;
  }

  Object.values(value as { [key: string]: unknown }).forEach((entry) => {
    collectSourceRefs(entry, refs);
  });

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
    'priceCandidates',
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

function dedupePriceCandidates(candidates: SteelPriceItem[]): SteelPriceItem[] {
  const seen = new Set<number>();

  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) {
      return false;
    }

    seen.add(candidate.id);
    return true;
  });
}

function normalizePriceSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function isLaserCutPlateSearch(productNames: readonly string[]): boolean {
  return productNames
    .map(normalizePriceSearchText)
    .some(
      (productName) =>
        productName.includes('ot板雷射切割') ||
        productName.includes('黑鐵板雷射切割') ||
        /m\/mot板雷射切割/u.test(productName),
    );
}

function filterPlateLaserPriceCandidates(
  candidates: SteelPriceItem[],
  productNames: readonly string[],
): SteelPriceItem[] {
  if (!isLaserCutPlateSearch(productNames)) {
    return candidates;
  }

  return candidates.filter((candidate) => candidate.unit === 'kg');
}

function interleaveDedupePriceCandidateLists(candidateLists: SteelPriceItem[][]): SteelPriceItem[] {
  const seen = new Set<number>();
  const priceCandidates: SteelPriceItem[] = [];
  const maxLength = Math.max(0, ...candidateLists.map((candidateList) => candidateList.length));

  for (let index = 0; index < maxLength; index += 1) {
    for (const candidateList of candidateLists) {
      const candidate = candidateList[index];
      if (!candidate || seen.has(candidate.id)) {
        continue;
      }

      seen.add(candidate.id);
      priceCandidates.push(candidate);
    }
  }

  return priceCandidates;
}

async function searchPriceCandidates(
  client: SteelRepositoryClient,
  input: SearchPriceCandidatesInput,
): Promise<SteelRawToolOutput> {
  if (!input.candidateQueries || input.candidateQueries.length === 0) {
    const productNames = [...new Set(input.productNames ?? [])];
    const erpItemCodes = [...new Set(input.erpItemCodes ?? [])];
    const priceCandidates = await searchSteelPriceItems(client, {
      ...input,
      productNames,
      erpItemCodes,
    });

    return {
      priceCandidates: dedupePriceCandidates(
        filterPlateLaserPriceCandidates(priceCandidates, productNames),
      ),
    };
  }

  if (input.originalText === undefined) {
    throw new Error('originalText is required with candidateQueries');
  }

  const searchTerms = generateSteelPriceSearchTerms({
    originalText: input.originalText,
    candidates: input.candidateQueries,
  });
  const candidateLists = await Promise.all(
    searchTerms.candidateQueries.map((query) => {
      const productNames = [...new Set(query.productNames ?? [])];
      const erpItemCodes = [...new Set(query.erpItemCodes ?? [])];
      return searchSteelPriceItems(client, {
        productNames,
        erpItemCodes,
        customerTierId: input.customerTierId,
        reviewState: input.reviewState,
        includeInactive: input.includeInactive,
        limit: input.limit,
      }).then((priceCandidates) =>
        filterPlateLaserPriceCandidates(priceCandidates, productNames),
      );
    }),
  );

  return {
    priceCandidates: interleaveDedupePriceCandidateLists(candidateLists),
    searchQueries: searchTerms.candidateQueries,
    rejectedSearchQueries: searchTerms.rejectedQueries,
  };
}

async function lookupCustomerRules(
  client: SteelRepositoryClient,
  customers: readonly SteelCustomer[],
): Promise<SteelRawToolOutput[]> {
  const customerIds = customers.map((customer) => customer.id);
  const customerTierIds = customers
    .map((customer) => customer.customerTier?.id)
    .filter((id): id is number => id !== undefined);

  if (customerIds.length === 0 && customerTierIds.length === 0) {
    return [];
  }

  return toCustomerRuleArray(
    await searchSteelCustomerRules(client, {
      customerIds,
      customerTierIds,
      limit: 100,
    }),
  );
}

async function lookupInstructionPackets(
  client: SteelRepositoryClient,
  input: LookupQuoteRulesInput,
) {
  const searchInput = getSteelInstructionPacketSearchInput(input);

  if (!searchInput.packetGroups || searchInput.packetGroups.length === 0) {
    return [];
  }

  return searchSteelInstructionPackets(client, searchInput);
}

function getQuoteRuleSearchInput(input: LookupQuoteRulesInput) {
  const defaultSearchInput = getSteelQuoteDefaultSearchInput(getQuoteRulesDefaultsInput(input));

  return {
    catalogFamilies: defaultSearchInput.catalogFamilies,
    chargeTypes: defaultSearchInput.chargeTypes,
    formulaCodes: defaultSearchInput.formulaCodes,
    reviewState: input.reviewState,
    includeInactive: input.includeInactive,
    limit: input.limit,
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
  client: SteelRepositoryClient,
  toolName: SteelToolName,
  args: unknown,
): Promise<SteelRawToolOutput> {
  switch (toolName) {
    case 'lookup_quote_rules': {
      const input = steelToolArgsSchemas.lookup_quote_rules.parse(args);
      const instructionPackets = await lookupInstructionPackets(client, input);
      const quoteDefaults = await searchSteelQuoteDefaults(
        client,
        getSteelQuoteDefaultSearchInput(getQuoteRulesDefaultsInput(input)),
      );
      const storedQuoteRules = await searchSteelQuoteRules(client, getQuoteRuleSearchInput(input));

      const quoteRules = lookupSteelQuoteRules(input, instructionPackets, quoteDefaults);
      const instructionRulePackets = Array.isArray(quoteRules.instructionPackets)
        ? quoteRules.instructionPackets.filter(
            (packet): packet is SteelToolJsonObject =>
              typeof packet === 'object' && packet !== null && !Array.isArray(packet),
          )
        : [];
      const quoteDefaultRules = Array.isArray(quoteRules.quoteDefaults)
        ? quoteRules.quoteDefaults.filter(
            (quoteDefault): quoteDefault is SteelToolJsonObject =>
              typeof quoteDefault === 'object' &&
              quoteDefault !== null &&
              !Array.isArray(quoteDefault),
          )
        : [];

      return {
        ...quoteRules,
        rules: toQuoteRulesRuleArray({
          quoteRules: storedQuoteRules,
          instructionPackets: instructionRulePackets,
          quoteDefaults: quoteDefaultRules,
        }),
      };
    }
    case 'lookup_catalog_families': {
      const input = steelToolArgsSchemas.lookup_catalog_families.parse(args);
      const catalogFamilyCandidates = await lookupSteelCatalogFamilies(client, input);
      const catalogFamilyRules = await searchSteelCatalogFamilyRules(client, {
        searchText: input.searchText,
        catalogFamilies: catalogFamilyCandidates.map((candidate) => candidate.key),
        productNames: catalogFamilyCandidates.flatMap((candidate) => [
          candidate.displayNameZh,
          ...candidate.aliases,
        ]),
        reviewState: input.reviewState,
        includeInactive: input.includeInactive,
        limit: input.limit,
      });

      return {
        catalogFamilyCandidates,
        rules: toCatalogFamilyRules({
          families: catalogFamilyCandidates,
          rules: catalogFamilyRules,
        }),
        selectionPolicy:
          'AI must choose catalogFamilies from candidates or ask the user; backend returns vocabulary candidates only.',
      };
    }
    case 'search_customers': {
      const input = steelToolArgsSchemas.search_customers.parse(args);
      const customers = await searchSteelCustomers(client, input);

      return {
        customers,
        rules: await lookupCustomerRules(client, customers),
      };
    }
    case 'search_price_candidates': {
      const input = steelToolArgsSchemas.search_price_candidates.parse(args);

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

  if (!isSteelToolName(options.toolName)) {
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

  const definition = getSteelToolDefinition(options.toolName);
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
    const rawData = await dispatchSteelTool(options.client, options.toolName, parsedArgs.data);
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
