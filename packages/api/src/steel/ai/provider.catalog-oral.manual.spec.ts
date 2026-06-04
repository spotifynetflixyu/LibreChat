import { parseSteelOpenAIConfig, resolveSteelOpenAIOAuthAuthFilePath } from './config';
import { sendSteelOAuthChat } from './provider';
import { createSteelPostgresPool } from '../postgres';
import { executeSteelTool } from '../tools/execute';

import type {
  SteelOAuthChatMessage,
  SteelProviderChatResponse,
  SteelProviderExecuteToolCallOptions,
} from './provider';
import type { SteelToolResult } from '../tools/results';

const caseTimeoutMs = Number(
  process.env.STEEL_OPENAI_OAUTH_CATALOG_ORAL_TIMEOUT_MS ??
    process.env.STEEL_OPENAI_OAUTH_C_TYPE_ORAL_TIMEOUT_MS ??
    150000,
);

interface CapturedSteelToolCall {
  toolName: string;
  arguments: unknown;
  result: SteelToolResult;
}

interface LiveSteelChatRun {
  response: SteelProviderChatResponse;
  capturedCalls: CapturedSteelToolCall[];
}

interface OralQuoteSmokeCase {
  envFlag: string;
  key: string;
  lookupResultContains?: string[];
  name: string;
  prompt: string;
  lookupArgumentContains: string[];
  priceArgumentContains: string[];
  priceArgumentPatterns?: RegExp[];
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function getToolCallIndex(calls: readonly CapturedSteelToolCall[], toolName: string): number {
  return calls.findIndex((call) => call.toolName === toolName);
}

function getToolCalls(
  calls: readonly CapturedSteelToolCall[],
  toolName: string,
): CapturedSteelToolCall[] {
  return calls.filter((call) => call.toolName === toolName);
}

function hasPositivePriceCandidate(result: SteelToolResult): boolean {
  if (!result.ok || !Array.isArray(result.data.priceCandidates)) {
    return false;
  }

  return result.data.priceCandidates.some(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'unitPrice' in candidate &&
      typeof candidate.unitPrice === 'number' &&
      candidate.unitPrice > 0,
  );
}

function summarizeCapturedCalls(calls: CapturedSteelToolCall[]) {
  return calls.map((call) => ({
    toolName: call.toolName,
    arguments: call.arguments,
    result: call.result.ok
      ? {
          ok: true,
          priceCandidateCount: Array.isArray(call.result.data.priceCandidates)
            ? call.result.data.priceCandidates.length
            : undefined,
          searchQueries: call.result.data.searchQueries,
          priceCandidates: Array.isArray(call.result.data.priceCandidates)
            ? call.result.data.priceCandidates.slice(0, 5)
            : undefined,
        }
      : {
          ok: false,
          errorCategory: call.result.errorCategory,
          errorSummary: call.result.errorSummary,
        },
  }));
}

async function runLiveSteelChat(
  messages: SteelOAuthChatMessage[],
  maxOutputTokens = 1800,
): Promise<LiveSteelChatRun> {
  const config = parseSteelOpenAIConfig(process.env);
  const authFilePath = resolveSteelOpenAIOAuthAuthFilePath(process.env);
  const client = createSteelPostgresPool();
  const capturedCalls: CapturedSteelToolCall[] = [];
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), caseTimeoutMs);

  try {
    const response = await sendSteelOAuthChat({
      abortSignal: abortController.signal,
      authFilePath,
      ensureFresh: false,
      executeSteelToolCall: async (options: SteelProviderExecuteToolCallOptions) => {
        const result = await executeSteelTool({
          client,
          toolName: options.toolName,
          arguments: options.arguments,
          providerToolCallId: options.providerToolCallId,
          runState: options.runState,
        });
        capturedCalls.push({
          toolName: options.toolName,
          arguments: options.arguments,
          result,
        });
        return result;
      },
      model: config.model,
      reasoningEffort: 'none',
      maxOutputTokens,
      steelRuntimePolicy: true,
      messages,
    });

    return { response, capturedCalls };
  } finally {
    clearTimeout(timeout);
    await client.end();
  }
}

const smokeCases: OralQuoteSmokeCase[] = [
  {
    envFlag: 'STEEL_OPENAI_OAUTH_C_TYPE_ORAL_TEST',
    key: 'c-type',
    name: 'uses lookup_instructions before c_type price lookup and derives the 100x2.3 candidate',
    prompt: 'C型鋼 100x50x20 2.3t 一支多少？',
    lookupArgumentContains: ['c_type'],
    priceArgumentContains: ['c_type', '100x2.3', '錏輕型鋼'],
  },
  {
    envFlag: 'STEEL_OPENAI_OAUTH_H_BEAM_ORAL_TEST',
    key: 'h-beam',
    lookupResultContains: [
      '6M',
      '9M',
      '10M',
      '12M',
      '7M',
      '8M',
      '11M',
      '13M',
      '14M',
      '15M',
      '+0.3 元/kg',
    ],
    name: 'uses lookup_instructions before h_beam price lookup and derives the H 100x50 candidate',
    prompt: 'H型鋼 100x50x5/7x6M 一支多少？',
    lookupArgumentContains: ['h_beam'],
    priceArgumentContains: ['h_beam'],
    priceArgumentPatterns: [/100.*50/i],
  },
  {
    envFlag: 'STEEL_OPENAI_OAUTH_ANGLE_ORAL_TEST',
    key: 'angle',
    name: 'uses lookup_instructions before angle price lookup and derives the 30x2.5 candidate',
    prompt: '錏成型角鐵30*2.5*6M 一支多少？',
    lookupArgumentContains: ['angle'],
    priceArgumentContains: ['angle'],
    priceArgumentPatterns: [/30.*2\.5/i],
  },
];

describe('Steel OpenAI OAuth oral quote smoke', () => {
  for (const smokeCase of smokeCases) {
    const itCase = process.env[smokeCase.envFlag] === 'true' ? it : it.skip;

    itCase(
      smokeCase.name,
      async () => {
        const { response, capturedCalls } = await runLiveSteelChat([
          { role: 'user', content: smokeCase.prompt },
        ]);
        const lookupIndex = getToolCallIndex(capturedCalls, 'lookup_instructions');
        const priceIndex = getToolCallIndex(capturedCalls, 'search_price_candidates');
        const successfulPriceCall = capturedCalls.find(
          (call) =>
            call.toolName === 'search_price_candidates' && hasPositivePriceCandidate(call.result),
        );
        const lookupResult = stringify(capturedCalls[lookupIndex]?.result);
        const priceArguments = stringify(successfulPriceCall?.arguments);
        const serializedResult = stringify({ response, capturedCalls });

        expect(lookupIndex).toBeGreaterThanOrEqual(0);
        expect(priceIndex).toBeGreaterThan(lookupIndex);
        const lookupArguments = stringify(capturedCalls[lookupIndex]?.arguments);
        for (const expected of smokeCase.lookupArgumentContains) {
          expect(lookupArguments).toContain(expected);
        }
        for (const expected of smokeCase.lookupResultContains ?? []) {
          expect(lookupResult).toContain(expected);
        }
        if (successfulPriceCall === undefined) {
          throw new Error(
            `Missing positive ${smokeCase.key} price lookup. Calls: ${stringify(
              summarizeCapturedCalls(capturedCalls),
            )}`,
          );
        }
        for (const expected of smokeCase.priceArgumentContains) {
          expect(priceArguments).toContain(expected);
        }
        for (const expectedPattern of smokeCase.priceArgumentPatterns ?? []) {
          expect(priceArguments).toMatch(expectedPattern);
        }
        expect(serializedResult).not.toMatch(/access_token|authorization|Bearer|authFile/i);
      },
      caseTimeoutMs + 10000,
    );
  }
});

const runAngleBoundedOral = process.env.STEEL_OPENAI_OAUTH_ANGLE_BOUNDED_ORAL_TEST === 'true';
const describeAngleBoundedOral = runAngleBoundedOral ? describe : describe.skip;

describeAngleBoundedOral('Steel OpenAI OAuth 亞L30x30 bounded-options smoke', () => {
  it(
    'returns a highest-confidence provisional quote, bounded options, and supports a follow-up selection',
    async () => {
      const firstPrompt = '亞L30x30 一支多少？';
      const firstRun = await runLiveSteelChat([{ role: 'user', content: firstPrompt }], 2200);
      const firstLookupIndex = getToolCallIndex(firstRun.capturedCalls, 'lookup_instructions');
      const firstPriceIndex = getToolCallIndex(firstRun.capturedCalls, 'search_price_candidates');
      const firstSuccessfulPriceCall = firstRun.capturedCalls.find(
        (call) =>
          call.toolName === 'search_price_candidates' && hasPositivePriceCandidate(call.result),
      );
      const firstSerialized = stringify(firstRun);

      expect(firstLookupIndex).toBeGreaterThanOrEqual(0);
      expect(firstPriceIndex).toBeGreaterThan(firstLookupIndex);
      expect(stringify(firstRun.capturedCalls[firstLookupIndex]?.arguments)).toContain('angle');
      if (firstSuccessfulPriceCall === undefined) {
        throw new Error(
          `Missing positive 亞L30x30 bounded quote. Calls: ${stringify(
            summarizeCapturedCalls(firstRun.capturedCalls),
          )}`,
        );
      }
      expect(firstSerialized).toContain('錏成型角鐵');
      expect(firstSerialized).toContain('194.3');
      expect(firstSerialized).not.toContain('"productName":"亞L30x30"');
      expect(firstRun.response.text).toMatch(/194(?:\.3|\.30)?/);
      expect(firstRun.response.text).toMatch(/錏成型角鐵/);
      expect(firstRun.response.text).toMatch(
        /候選|選項|確認|暫估|預估|最高信心|最接近|如果你要的是/,
      );
      expect(firstSerialized).not.toMatch(/access_token|authorization|Bearer|authFile/i);

      const secondRun = await runLiveSteelChat(
        [
          { role: 'user', content: firstPrompt },
          { role: 'assistant', content: firstRun.response.text },
          { role: 'user', content: '先用錏成型角鐵30*2.5*6M，第1級價格。' },
        ],
        1800,
      );
      const secondSerialized = stringify(secondRun);
      const secondSuccessfulPriceCall = secondRun.capturedCalls.find(
        (call) =>
          call.toolName === 'search_price_candidates' && hasPositivePriceCandidate(call.result),
      );

      if (secondSuccessfulPriceCall === undefined) {
        throw new Error(
          `Missing positive follow-up selected quote. Calls: ${stringify(
            summarizeCapturedCalls(secondRun.capturedCalls),
          )}`,
        );
      }
      expect(secondSerialized).toContain('錏成型角鐵');
      expect(secondSerialized).toContain('30x2.5');
      expect(secondSerialized).toContain('194.3');
      expect(secondRun.response.text).toMatch(/194(?:\.3|\.30)?/);
      expect(secondRun.response.text).toMatch(/第\s*1\s*級|1\s*級|tier 1|一級/i);
      expect(secondSerialized).not.toMatch(/access_token|authorization|Bearer|authFile/i);
    },
    caseTimeoutMs * 2 + 20000,
  );
});

const runHBeamProcessing = process.env.STEEL_OPENAI_OAUTH_H_BEAM_PROCESSING_TEST === 'true';
const describeHBeamProcessing = runHBeamProcessing ? describe : describe.skip;

describeHBeamProcessing('Steel OpenAI OAuth H 型鋼 processing smoke', () => {
  it(
    'looks up H-beam cutting, slotting, and hole rules before quoting processing work',
    async () => {
      const run = await runLiveSteelChat(
        [
          {
            role: 'user',
            content: 'H型鋼 100x50x5/7x6M 一支，對半切，另開槽1處、沖孔4-Ø22，報價怎麼抓？',
          },
        ],
        2400,
      );
      const lookupIndex = getToolCallIndex(run.capturedCalls, 'lookup_instructions');
      const priceIndex = getToolCallIndex(run.capturedCalls, 'search_price_candidates');
      const defaultsIndex = getToolCallIndex(run.capturedCalls, 'lookup_defaults');
      const lookupResult = stringify(run.capturedCalls[lookupIndex]?.result);
      const defaultsPayload = stringify(getToolCalls(run.capturedCalls, 'lookup_defaults'));
      const pricePayload = stringify(getToolCalls(run.capturedCalls, 'search_price_candidates'));
      const serialized = stringify(run);

      expect(lookupIndex).toBeGreaterThanOrEqual(0);
      expect(priceIndex).toBeGreaterThan(lookupIndex);
      expect(defaultsIndex === -1 || defaultsIndex > lookupIndex).toBe(true);
      expect(stringify(run.capturedCalls[lookupIndex]?.arguments)).toContain('h_beam');
      expect(stringify(run.capturedCalls[lookupIndex]?.arguments)).toMatch(/cutting|slotting|hole/);
      expect(lookupResult).toContain('H 型鋼切工');
      expect(lookupResult).toContain('開槽 KZZB10');
      expect(lookupResult).toContain('沖孔 KZZB11');
      expect(pricePayload).toContain('H型鋼');
      expect(pricePayload).toContain('開槽加工');
      expect(pricePayload).toContain('沖孔加工');
      expect(pricePayload).toContain('unitPrice');
      if (defaultsIndex >= 0) {
        expect(defaultsPayload).toMatch(/開槽|沖孔|另計|requiresConfirmation/);
      } else {
        expect(lookupResult).toMatch(/開槽|沖孔|另計/);
      }
      expect(run.response.text).toMatch(/切工|對半切/);
      expect(run.response.text).toMatch(/開槽|KZZB10/);
      expect(run.response.text).toMatch(/沖孔|KZZB11|4[-－]?Ø?22/i);
      expect(run.response.text).toMatch(/確認|另計|暫估|預估|候選/);
      expect(serialized).not.toMatch(/access_token|authorization|Bearer|authFile/i);
    },
    caseTimeoutMs + 30000,
  );
});
