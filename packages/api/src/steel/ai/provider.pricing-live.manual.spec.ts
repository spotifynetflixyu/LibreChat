import path from 'path';
import dotenv from 'dotenv';

import type { SteelToolJsonObject, SteelToolJsonValue, SteelToolResult } from '../tools/results';
import type { SteelAgentRule } from '../repositories/rules';
import type { SteelProviderToolExecutor } from './provider';

import { parseSteelOpenAIConfig, resolveSteelOpenAIOAuthAuthFilePath } from './config';
import {
  listReviewedSteelAgentRules,
  listReviewedSteelOtherRules,
  listReviewedSteelOutputRules,
  listReviewedSteelQuoteRules,
} from '../repositories';
import {
  createEmptySteelOutputSheetMemorySnapshot,
  prepareSteelRuntimeContext,
} from '../runtime/context';
import { createSteelPostgresPool } from '../postgres';
import { executeSteelTool } from '../tools/execute';
import { steelToolArgsSchemas } from '../tools/schemas';
import { sendSteelOAuthChat } from './provider';

const runPricingLive = process.env.STEEL_OPENAI_OAUTH_PRICING_LIVE_TEST === 'true';
const describePricingLive = runPricingLive ? describe : describe.skip;

if (runPricingLive) {
  dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
}

interface CapturedToolCall {
  toolName: string;
  arguments: unknown;
  result?: SteelToolResult;
}

interface PriceCandidateSnapshot {
  priceKind?: string;
  category?: string;
  subcategory?: string;
  productName?: string;
  erpItemCode?: string;
  unit?: string;
}

function hasRuleSection(rule: SteelAgentRule, matches: readonly string[]): boolean {
  return rule.ruleSections.some((section) => matches.some((match) => section.includes(match)));
}

function isOcrRule(rule: SteelAgentRule): boolean {
  return hasRuleSection(rule, ['file_ocr', 'drawing_ocr', 'vision_evidence']);
}

function isObject(value: SteelToolJsonValue | undefined): value is SteelToolJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasLongMaterialPriceLookup(value: unknown): boolean {
  const parsed = steelToolArgsSchemas.search_price_candidates.safeParse(value);

  return (
    parsed.success &&
    'queries' in parsed.data &&
    parsed.data.queries.some((query) => query.category === 'H型鋼')
  );
}

function readString(value: SteelToolJsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getPriceCandidates(result: SteelToolResult | undefined): PriceCandidateSnapshot[] {
  if (!result?.ok) {
    return [];
  }

  const candidates = result.data.priceCandidates;
  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates.filter(isObject).map((candidate) => ({
    priceKind: readString(candidate.priceKind),
    category: readString(candidate.category),
    subcategory: readString(candidate.subcategory),
    productName: readString(candidate.productName),
    erpItemCode: readString(candidate.erpItemCode),
    unit: readString(candidate.unit),
  }));
}

function extractNumbers(text: string): number[] {
  return [...text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/gu)].map((match) =>
    Number(match[0].replace(/,/gu, '')),
  );
}

function hasApproxNumber(numbers: readonly number[], expected: number, tolerance: number): boolean {
  return numbers.some((value) => Math.abs(value - expected) <= tolerance);
}

describePricingLive('Steel live pricing quote smoke', () => {
  it(
    'quotes plate, H beam material, and H beam cutting with effective price candidates',
    async () => {
      const pool = createSteelPostgresPool();
      const config = parseSteelOpenAIConfig(process.env);
      const authFilePath = resolveSteelOpenAIOAuthAuthFilePath(process.env);
      const capturedCalls: CapturedToolCall[] = [];
      const executeToolCall: SteelProviderToolExecutor = async (options) => {
        const captured: CapturedToolCall = {
          toolName: options.toolName,
          arguments: options.arguments,
        };
        capturedCalls.push(captured);
        captured.result = await executeSteelTool({
          client: pool,
          toolName: options.toolName,
          arguments: options.arguments,
          providerToolCallId: options.providerToolCallId,
          runState: options.runState,
        });
        return captured.result;
      };

      try {
        const runtimeContext = await prepareSteelRuntimeContext({
          conversation: {
            conversationId: 'steel_live_pricing_smoke',
            requestId: `steel_live_pricing_smoke_${Date.now()}`,
            activeHistory: [],
            currentUserTurn: {
              role: 'user',
              content: 'live pricing smoke',
            },
          },
          dependencies: {
            listAgentRules: () => listReviewedSteelAgentRules(pool),
            listReviewedInstructionPackets: async () => [],
            listReviewedQuoteDefaults: async () => [],
            listReviewedQuoteRules: () => listReviewedSteelQuoteRules(pool),
            listOutputRules: () => listReviewedSteelOutputRules(pool),
            listOtherGlobalRules: async ({ includeOcrRules }) => {
              const rules = await listReviewedSteelOtherRules(pool);
              const ocrRules = rules.filter(isOcrRule);
              return {
                ocrRules: includeOcrRules ? ocrRules : undefined,
                fileRules: rules.filter(
                  (rule) => hasRuleSection(rule, ['file']) && !isOcrRule(rule),
                ),
                sourcePriorityRules: rules.filter((rule) =>
                  hasRuleSection(rule, ['source_priority']),
                ),
                markdownOutputRules: rules.filter((rule) =>
                  hasRuleSection(rule, ['markdown_output']),
                ),
              };
            },
            readOutputSheetMemory: async () => createEmptySteelOutputSheetMemorySnapshot(),
          },
        });
        const response = await sendSteelOAuthChat({
          authFilePath,
          executeSteelToolCall: executeToolCall,
          maxOutputTokens: 2400,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
          steelRuntimeContext: runtimeContext,
          steelRuntimePolicy: true,
          steelToolMaxCalls: 6,
          messages: [
            {
              role: 'user',
              content: [
                '請用價格B報價，必須先查產品價格資料，不可自行假設單價。',
                '項目1：OT黑鐵鐵板 PL6*80*1000，數量1片，材料費用板材雷射切割 kg 單價計算。',
                '項目2：H型鋼 200*100*5.5/8*10M，一支，材料費用 kg 單價計算。',
                '項目3：同一支 H型鋼 200*100，10M 切成兩支 5M，不修頭尾，切工另列，切工刀數1刀。',
                'H型鋼同時需要產品價格與切工價格時，search_price_candidates 只需要查 H型鋼，切工候選由後端自動帶回。',
                '最後請用 Markdown 表格列出採用價格來源、單價、重量或刀數、各項小計與總計。',
              ].join('\n'),
            },
          ],
        });
        const priceCandidates = capturedCalls.flatMap((call) => getPriceCandidates(call.result));
        const responseNumbers = extractNumbers(response.text);
        const serializedEvidence = JSON.stringify({
          response,
          capturedCalls,
        });

        expect(capturedCalls.some((call) => call.toolName === 'search_price_candidates')).toBe(true);
        expect(
          capturedCalls.some(
            (call) => call.toolName === 'search_price_candidates' && hasLongMaterialPriceLookup(call.arguments),
          ),
        ).toBe(true);
        expect(priceCandidates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              priceKind: 'product',
              category: '鐵板/鋼板',
              erpItemCode: 'DNB70060',
            }),
            expect.objectContaining({
              priceKind: 'product',
              category: 'H型鋼',
              erpItemCode: 'EHS201010',
            }),
            expect.objectContaining({
              priceKind: 'cutting',
              category: '切工/切割',
              subcategory: 'H型鋼',
              unit: '刀',
            }),
          ]),
        );
        expect(response.text).toMatch(/鐵板|PL6/u);
        expect(response.text).toMatch(/H型鋼/u);
        expect(response.text).toMatch(/切工|切割/u);
        expect(hasApproxNumber(responseNumbers, 145.07, 2)).toBe(true);
        expect(hasApproxNumber(responseNumbers, 5935.6, 5)).toBe(true);
        expect(hasApproxNumber(responseNumbers, 125, 0.5)).toBe(true);
        expect(serializedEvidence).not.toMatch(/access_token|authorization|Bearer|authFile/i);
      } finally {
        await pool.end();
      }
    },
    240000,
  );
});
