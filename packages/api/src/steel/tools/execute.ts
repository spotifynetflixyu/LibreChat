import {
  searchSteelCustomers,
  searchSteelCustomerRules,
  searchSteelInstructionPackets,
  searchSteelPriceItems,
  searchSteelQuoteRules,
  searchSteelQuoteDefaults,
} from '../repositories';
import { getExecutableSteelToolDefinition, isExecutableSteelToolName } from './registry';
import { sanitizeSteelToolOutput, steelToolRedactionVersion } from './sanitize';
import { defaultSteelPriceCustomerTierId, steelToolArgsSchemas } from './schemas';
import { toCustomerRuleArray, toQuoteRulesRuleArray } from './rules';

import type {
  SteelToolResult,
  SteelToolLogger,
  SteelToolJsonObject,
  SteelToolErrorCategory,
} from './results';
import type { SteelRepositoryClient, SteelSourceRef } from '../repositories/types';
import type { SteelCustomer, SteelPriceItem } from '../repositories';
import type { ReadWorkingOrderItemsInput, SteelToolName } from './schemas';

type SteelRawToolOutput = { [key: string]: unknown };
type LookupQuoteRulesInput = ReturnType<typeof steelToolArgsSchemas.lookup_quote_rules.parse>;
type SearchCustomersInput = ReturnType<typeof steelToolArgsSchemas.search_customers.parse>;
type SearchPriceCandidatesInput = ReturnType<
  typeof steelToolArgsSchemas.search_price_candidates.parse
>;

export interface SteelWorkingOrderMemoryReader {
  readWorkingOrderItems(input: ReadWorkingOrderItemsInput): Promise<SteelRawToolOutput>;
}

export interface SteelToolRunState {
  maxCalls: number;
  callsUsed: number;
}

export interface ExecuteSteelToolOptions {
  client: SteelRepositoryClient;
  toolName: string;
  arguments: unknown;
  memoryReader?: SteelWorkingOrderMemoryReader;
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

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getQuoteRuleKeywordExpansions(keyword: string): string[] {
  const normalized = keyword.normalize('NFKC');
  const compact = normalized.replace(/\s+/gu, '');
  const lower = compact.toLowerCase();
  const isPlateLike =
    /板/u.test(compact) ||
    /雷射切割|四方切|切清/u.test(compact) ||
    /^pl\d/u.test(lower) ||
    /[^a-z0-9]pl\d/u.test(lower) ||
    /^dnb\d/u.test(lower);

  if (!isPlateLike) {
    return [];
  }

  return ['plate', 'ot_plate', 'black_plate', '板材', '鐵板'];
}

function expandQuoteRuleKeywords(keywords: readonly string[]): string[] {
  return uniqueNonEmptyStrings(
    keywords.flatMap((keyword) => [keyword, ...getQuoteRuleKeywordExpansions(keyword)]),
  );
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

async function searchPriceCandidates(
  client: SteelRepositoryClient,
  input: SearchPriceCandidatesInput,
): Promise<SteelRawToolOutput> {
  const customerTierId = input.customerTierId ?? defaultSteelPriceCustomerTierId;
  const priceCandidates = await searchSteelPriceItems(client, {
    unfiltered: true,
    customerTierId,
    productNames: input.candidateQueries,
    limit: input.limit,
  });

  return {
    customerTierId,
    priceCandidates: dedupePriceCandidates(priceCandidates),
    searchQueries: input.candidateQueries,
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
  args: LookupQuoteRulesInput | SearchCustomersInput | SearchPriceCandidatesInput | ReadWorkingOrderItemsInput,
): Promise<SteelRawToolOutput> {
  const { client } = options;

  switch (toolName) {
    case 'lookup_quote_rules': {
      const input = args as LookupQuoteRulesInput;
      const keywords = expandQuoteRuleKeywords(input.keywords);
      const searchInput = { keywords, limit: input.limit };
      const [instructionPackets, quoteDefaults, storedQuoteRules] = await Promise.all([
        searchSteelInstructionPackets(client, searchInput),
        searchSteelQuoteDefaults(client, searchInput),
        searchSteelQuoteRules(client, searchInput),
      ]);

      return {
        keywords,
        instructionPackets,
        quoteDefaults,
        quoteRules: storedQuoteRules,
        rules: toQuoteRulesRuleArray({
          quoteRules: storedQuoteRules,
          instructionPackets: [],
          quoteDefaults: [],
        }),
      };
    }
    case 'search_customers': {
      const input = args as SearchCustomersInput;
      const customers = await searchSteelCustomers(client, input);

      return {
        customers,
        rules: await lookupCustomerRules(client, customers),
      };
    }
    case 'search_price_candidates': {
      const input = args as SearchPriceCandidatesInput;

      return searchPriceCandidates(client, input);
    }
    case 'read_working_order_items': {
      const input = args as ReadWorkingOrderItemsInput;

      if (!options.memoryReader) {
        throw new Error('Steel working order memory reader unavailable');
      }

      return options.memoryReader.readWorkingOrderItems(input);
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
