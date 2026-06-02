import {
  findSteelOrderItems,
  findSteelFormulaVersion,
  searchSteelCustomers,
  searchSteelPriceItems,
  searchSteelWeightSpecs,
  searchSteelCuttingPrices,
  searchSteelHolePrices,
  searchSteelMaterialRules,
  searchSteelSourceChunks,
  searchSteelProcessingPrices,
} from '../repositories';
import { getSteelToolDefinition, isSteelToolName } from './registry';
import { sanitizeSteelToolOutput, steelToolRedactionVersion } from './sanitize';
import { steelToolArgsSchemas, type SteelToolName } from './schemas';
import { resolveSteelQuoteItemCandidates } from '../normalization';
import { rankSteelPriceCandidates } from '../pricing';

import type {
  SteelToolResult,
  SteelToolLogger,
  SteelToolJsonObject,
  SteelToolErrorCategory,
} from './results';
import type { SteelRepositoryClient, SteelSourceRef } from '../repositories/types';

type SteelRawToolOutput = { [key: string]: unknown };

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
  if (refs.length >= 20 || value === null || value === undefined) {
    return refs;
  }

  if (isSourceRef(value)) {
    refs.push(value);
    return refs;
  }

  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((entry) => collectSourceRefs(entry, refs));
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
    'customers',
    'priceCandidates',
    'weightSpecs',
    'cuttingPrices',
    'holePrices',
    'processingPrices',
    'materialRules',
    'orderItems',
    'sourceChunks',
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

  if ('matchedCustomer' in data) {
    return data.matchedCustomer === null ? 'matchedCustomer=none' : 'matchedCustomer=1';
  }

  if ('formulaVersion' in data) {
    return data.formulaVersion === null ? 'formulaVersion=none' : 'formulaVersion=1';
  }

  return `keys=${Object.keys(data).length}`;
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
    case 'lookup_customer': {
      const input = steelToolArgsSchemas.lookup_customer.parse(args);
      const candidates = await searchSteelCustomers(client, {
        searchText: input.searchText,
        limit: 2,
      });

      return {
        matchedCustomer: candidates.length === 1 ? candidates[0] : null,
        candidates,
        confidence: candidates.length === 1 ? 'high' : 'low',
        manualReviewRequired: candidates.length !== 1,
      };
    }
    case 'search_customers': {
      const input = steelToolArgsSchemas.search_customers.parse(args);
      const customers = await searchSteelCustomers(client, input);

      return { customers };
    }
    case 'normalize_quote_item': {
      const input = steelToolArgsSchemas.normalize_quote_item.parse(args);
      const normalization = resolveSteelQuoteItemCandidates(input);

      return { normalization };
    }
    case 'search_price_candidates': {
      const input = steelToolArgsSchemas.search_price_candidates.parse(args);
      const priceCandidates = await searchSteelPriceItems(client, input);

      return { priceCandidates };
    }
    case 'rank_price_candidates': {
      const input = steelToolArgsSchemas.rank_price_candidates.parse(args);
      const priceDecision = rankSteelPriceCandidates(input);

      return { priceDecision };
    }
    case 'lookup_spec_price': {
      const input = steelToolArgsSchemas.lookup_spec_price.parse(args);
      const priceCandidates = await searchSteelPriceItems(client, input);

      return { priceCandidates };
    }
    case 'lookup_weight_spec': {
      const input = steelToolArgsSchemas.lookup_weight_spec.parse(args);
      const weightSpecs = await searchSteelWeightSpecs(client, input);

      return { weightSpecs };
    }
    case 'lookup_cutting_price': {
      const input = steelToolArgsSchemas.lookup_cutting_price.parse(args);
      const cuttingPrices = await searchSteelCuttingPrices(client, input);

      return { cuttingPrices };
    }
    case 'lookup_hole_price': {
      const input = steelToolArgsSchemas.lookup_hole_price.parse(args);
      const holePrices = await searchSteelHolePrices(client, input);

      return { holePrices };
    }
    case 'lookup_processing_price': {
      const input = steelToolArgsSchemas.lookup_processing_price.parse(args);
      const processingPrices = await searchSteelProcessingPrices(client, input);

      return { processingPrices };
    }
    case 'lookup_material_rules': {
      const input = steelToolArgsSchemas.lookup_material_rules.parse(args);
      const materialRules = await searchSteelMaterialRules(client, input);

      return { materialRules };
    }
    case 'lookup_formula_version': {
      const input = steelToolArgsSchemas.lookup_formula_version.parse(args);
      const formulaVersion = await findSteelFormulaVersion(client, input);

      return { formulaVersion };
    }
    case 'find_order_items': {
      const input = steelToolArgsSchemas.find_order_items.parse(args);
      const orderItems = await findSteelOrderItems(client, input);

      return { orderItems };
    }
    case 'search_source_chunks': {
      const input = steelToolArgsSchemas.search_source_chunks.parse(args);
      const sourceChunks = await searchSteelSourceChunks(client, input);

      return { sourceChunks };
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
