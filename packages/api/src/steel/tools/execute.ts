import {
  findSteelFormulaVersion,
  searchSteelCustomers,
  searchSteelPriceItems,
  searchSteelQuoteDefaults,
} from '../repositories';
import { getSteelToolDefinition, isSteelToolName } from './registry';
import { sanitizeSteelToolOutput, steelToolRedactionVersion } from './sanitize';
import { steelToolArgsSchemas, type SteelToolName } from './schemas';
import { generateSteelPriceSearchTerms } from '../normalization';
import { lookupSteelInstructions } from './instructions';
import { getSteelQuoteDefaultSearchInput, lookupSteelDefaults } from './defaults';

import type {
  SteelToolResult,
  SteelToolLogger,
  SteelToolJsonObject,
  SteelToolErrorCategory,
} from './results';
import type { SteelRepositoryClient, SteelSourceRef } from '../repositories/types';
import type { SteelPriceItem } from '../repositories';
import type { LookupFormulaInput } from './schemas';

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
    'packets',
    'packetGroups',
    'defaultCandidates',
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function getFormulaCodes(input: LookupFormulaInput): string[] {
  return uniqueStrings(
    input.materialContexts.flatMap((context) => context.formulaCandidates ?? []),
  );
}

function getFormulaLineRefs(input: LookupFormulaInput, code: string): string[] {
  return uniqueStrings(
    input.materialContexts
      .filter((context) => (context.formulaCandidates ?? []).includes(code))
      .flatMap((context) => context.lineRefs ?? []),
  );
}

async function lookupFormulaCandidates(
  client: SteelRepositoryClient,
  input: LookupFormulaInput,
): Promise<SteelRawToolOutput> {
  const formulaCandidates: SteelRawToolOutput[] = [];

  for (const code of getFormulaCodes(input)) {
    const formulaVersion = await findSteelFormulaVersion(client, {
      code,
      reviewState: input.reviewState,
    });

    if (!formulaVersion) {
      continue;
    }

    formulaCandidates.push({
      lineRefs: getFormulaLineRefs(input, code),
      code,
      formulaVersion,
    });
  }

  return { formulaCandidates };
}

async function searchPriceCandidates(
  client: SteelRepositoryClient,
  input: SearchPriceCandidatesInput,
): Promise<SteelRawToolOutput> {
  if (!input.candidateQueries || input.candidateQueries.length === 0) {
    const priceCandidates = await searchSteelPriceItems(client, input);

    return { priceCandidates };
  }

  if (input.originalText === undefined) {
    throw new Error('originalText is required with candidateQueries');
  }

  const searchTerms = generateSteelPriceSearchTerms({
    originalText: input.originalText,
    candidates: input.candidateQueries,
  });
  const priceCandidates: SteelPriceItem[] = [];

  for (const query of searchTerms.candidateQueries) {
    const candidates = await searchSteelPriceItems(client, {
      specKey: query.specKey,
      specKeyContains: query.specKeyContains,
      productName: query.productName,
      reviewState: input.reviewState,
      includeInactive: input.includeInactive,
      limit: input.limit,
    });

    priceCandidates.push(...candidates);
  }

  return {
    priceCandidates: dedupePriceCandidates(priceCandidates),
    searchQueries: searchTerms.candidateQueries,
    rejectedSearchQueries: searchTerms.rejectedQueries,
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
    case 'lookup_instructions': {
      const input = steelToolArgsSchemas.lookup_instructions.parse(args);

      return lookupSteelInstructions(input);
    }
    case 'lookup_defaults': {
      const input = steelToolArgsSchemas.lookup_defaults.parse(args);
      const quoteDefaults = await searchSteelQuoteDefaults(
        client,
        getSteelQuoteDefaultSearchInput(input),
      );

      return lookupSteelDefaults(input, quoteDefaults);
    }
    case 'lookup_formula': {
      const input = steelToolArgsSchemas.lookup_formula.parse(args);

      return lookupFormulaCandidates(client, input);
    }
    case 'search_customers': {
      const input = steelToolArgsSchemas.search_customers.parse(args);
      const customers = await searchSteelCustomers(client, input);

      return { customers };
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
