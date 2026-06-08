import { parseSteelOpenAIConfig, resolveSteelOpenAIOAuthAuthFilePath } from './config';
import { sendSteelOAuthChat } from './provider';
import { createSteelPostgresPool } from '../postgres';
import { executeSteelTool } from '../tools/execute';

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from '@ai-sdk/provider';
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

interface LiveWorkbookPatchRun extends LiveSteelChatRun {
  capturedGenerateRounds: CapturedGenerateRound[];
}

interface CapturedGenerateRound {
  toolChoice: LanguageModelV3CallOptions['toolChoice'];
  tools: string[];
  content: LanguageModelV3GenerateResult['content'];
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
  responseTextPatterns?: RegExp[];
  responseTextRejectPatterns?: RegExp[];
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

function findWorkbookOperation(
  response: SteelProviderChatResponse,
  sheetId: string,
  rowId: string,
  columnKey: string,
) {
  return response.workbookPatch?.operations.find(
    (operation) =>
      operation.sheetId === sheetId &&
      operation.rowId === rowId &&
      operation.columnKey === columnKey,
  );
}

function operationValueText(value: unknown): string {
  return typeof value === 'string' ? value : stringify(value);
}

function operationValueNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/u)?.[0];
  return normalized === undefined ? undefined : Number(normalized);
}

function getWorkbookPatchContextText(): string {
  return [
    'sheet id="quote_details" label="報價明細"',
    'column label="客戶原始品名" key="customer_original_item_name"',
    'column label="標準化品名" key="normalized_item_name"',
    'column label="採用產品價格品項" key="adopted_product_price_item"',
    'column label="材料單價" key="material_unit_price"',
    'column label="材料單價欄位" key="material_unit_price_field"',
    'column label="材料計價單位" key="material_pricing_unit"',
    'column label="計價數量" key="billable_quantity"',
    'column label="小計" key="subtotal"',
    'column label="信心等級" key="confidence"',
    'row id="line_1" cells: line_no=1 customer_original_item_name=null normalized_item_name=null adopted_product_price_item=null material_unit_price=null material_unit_price_field=null material_pricing_unit=null billable_quantity=null subtotal=null confidence=null',
    'sheet id="price_sources" label="價格來源"',
    'column label="客戶原始品名" key="customer_original_item_name"',
    'column label="標準化品名" key="normalized_item_name"',
    'column label="採用產品價格品項" key="adopted_product_price_item"',
    'column label="採用單價" key="adopted_unit_price"',
    'column label="單價欄位" key="unit_price_field"',
    'column label="單位" key="unit"',
    'column label="來源檔案" key="source_file"',
    'column label="信心等級" key="confidence"',
    'row id="source_1" cells: customer_original_item_name=null normalized_item_name=null adopted_product_price_item=null adopted_unit_price=null unit_price_field=null unit=null source_file=null confidence=null',
    'sheet id="interpretation_notes" label="判讀備註"',
    'column label="項目" key="item"',
    'column label="內容" key="content"',
    'column label="信心" key="confidence"',
    'column label="依據" key="evidence"',
    'row id="note_1" cells: item=null content=null confidence=null evidence=null',
  ].join('\n');
}

function createWorkbookPatchSmokeToolResult(toolName: string): SteelToolResult {
  if (toolName === 'lookup_quote_rules') {
    return {
      ok: true,
      toolName,
      data: {
        catalogFamilyKey: 'c_type',
        ruleSummary:
          'C 型鋼材質不明時，使用 productNames [錏輕型鋼]；價格表 unit=kg 時必須用 kg/m * 長度 * 元/kg 算小計。',
        customerContext: {
          tierKnown: false,
          defaultCustomerTierId: 2,
          defaultCustomerTierCode: 'B',
        },
        requiredLookups: ['search_price_candidates'],
        workbookRules: [
          'positive reviewed price candidate exists and amount is calculable -> call patch_quote_workbook',
          'write quote_details, price_sources, interpretation_notes, summary, manual_review, system_order, customer_quote',
          'quote_details 小計 uses internal key subtotal',
        ],
      },
      sourceRefs: [
        {
          channel: 'steel_db',
          factType: 'instruction_packet',
          sourceFile: 'steel.instruction_packets',
          locator: 'c_type',
          confidence: 'reviewed',
        },
      ],
      durationMs: 1,
      redactionVersion: 1,
    };
  }

  if (toolName === 'search_price_candidates') {
    return {
      ok: true,
      toolName,
      data: {
        searchQueries: ['錏輕型鋼 100x2.3', '白鐵輕型鋼 100x2.3'],
        priceCandidates: [
          {
            itemCode: 'CCG10023',
            productName: '錏輕型鋼',
            displayName: '錏輕型鋼 100*2.3',
            specKey: '100x2.3',
            unit: 'kg',
            unitPrice: 26.8,
            priceField: 'priceB',
            customerTierId: 2,
            productPriceUnitWeight: 4,
            productPriceUnitWeightUnit: 'kg_per_m',
            requestedLengthM: 6,
            billableWeightKg: 24,
            subtotal: 643.2,
            sourceFile: '產品價格.xlsx',
            sourceSheet: 'Sheet1',
            sourceRow: 1560,
          },
          {
            itemCode: 'CCS10020',
            productName: '白鐵輕型鋼',
            displayName: '白鐵輕型鋼 100*2.3',
            specKey: '100x2.3',
            unit: 'kg',
            unitPrice: 100,
            priceField: 'priceB',
            customerTierId: 2,
            productPriceUnitWeight: 4,
            productPriceUnitWeightUnit: 'kg_per_m',
            requestedLengthM: 6,
            billableWeightKg: 24,
            subtotal: 2400,
            sourceFile: '產品價格.xlsx',
            sourceSheet: 'Sheet1',
            sourceRow: 1581,
          },
        ],
      },
      sourceRefs: [
        {
          channel: 'reference',
          factType: 'product_price',
          sourceFile: '產品價格.xlsx',
          locator: 'Sheet1 row 1560',
          confidence: 'reviewed',
        },
      ],
      durationMs: 1,
      redactionVersion: 1,
    };
  }

  return {
    ok: false,
    toolName,
    errorCategory: 'unknown_tool',
    errorSummary: `Unexpected workbook patch smoke tool: ${toolName}`,
    durationMs: 1,
    redactionVersion: 1,
  };
}

async function runLiveWorkbookPatchChat(
  messages: SteelOAuthChatMessage[],
  maxOutputTokens = 2600,
): Promise<LiveWorkbookPatchRun> {
  const config = parseSteelOpenAIConfig(process.env);
  const authFilePath = resolveSteelOpenAIOAuthAuthFilePath(process.env);
  const capturedCalls: CapturedSteelToolCall[] = [];
  const capturedGenerateRounds: CapturedGenerateRound[] = [];
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), caseTimeoutMs);
  const { createOpenAIOAuth } = await import('openai-oauth-provider');

  try {
    const response = await sendSteelOAuthChat({
      abortSignal: abortController.signal,
      authFilePath,
      createOpenAIOAuth: (options) => {
        const provider = createOpenAIOAuth(options);

        return ((selectedModel: string) => {
          const languageModel = provider(selectedModel);

          return {
            ...languageModel,
            doGenerate: async (callOptions: LanguageModelV3CallOptions) => {
              const result = await languageModel.doGenerate(callOptions);
              capturedGenerateRounds.push({
                toolChoice: callOptions.toolChoice,
                tools: callOptions.tools?.map((tool) => tool.name) ?? [],
                content: result.content,
              });
              return result;
            },
          } satisfies LanguageModelV3;
        }) as ReturnType<typeof createOpenAIOAuth>;
      },
      ensureFresh: false,
      executeSteelToolCall: async (options: SteelProviderExecuteToolCallOptions) => {
        const result = createWorkbookPatchSmokeToolResult(options.toolName);
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
      workbookPatchTool: true,
      workbookContextText: getWorkbookPatchContextText(),
      messages,
    });

    return { response, capturedCalls, capturedGenerateRounds };
  } catch (error) {
    const details = [
      `Captured calls before failure: ${stringify(summarizeCapturedCalls(capturedCalls))}`,
      `Captured model rounds before failure: ${stringify(capturedGenerateRounds)}`,
    ].join('\n');
    if (error instanceof Error) {
      throw new Error(`${error.message}\n${details}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runLiveSteelChat(
  messages: SteelOAuthChatMessage[],
  maxOutputTokens = 1800,
): Promise<LiveSteelChatRun> {
  const config = parseSteelOpenAIConfig(process.env);
  const authFilePath = resolveSteelOpenAIOAuthAuthFilePath(process.env);
  const client = createSteelPostgresPool();
  const capturedCalls: CapturedSteelToolCall[] = [];
  const capturedGenerateRounds: CapturedGenerateRound[] = [];
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), caseTimeoutMs);
  const { createOpenAIOAuth } = await import('openai-oauth-provider');

  try {
    const response = await sendSteelOAuthChat({
      abortSignal: abortController.signal,
      authFilePath,
      createOpenAIOAuth: (options) => {
        const provider = createOpenAIOAuth(options);

        return ((selectedModel: string) => {
          const languageModel = provider(selectedModel);

          return {
            ...languageModel,
            doGenerate: async (callOptions: LanguageModelV3CallOptions) => {
              const result = await languageModel.doGenerate(callOptions);
              capturedGenerateRounds.push({
                toolChoice: callOptions.toolChoice,
                tools: callOptions.tools?.map((tool) => tool.name) ?? [],
                content: result.content,
              });
              return result;
            },
          } satisfies LanguageModelV3;
        }) as ReturnType<typeof createOpenAIOAuth>;
      },
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
  } catch (error) {
    const details = [
      `Captured calls before failure: ${stringify(summarizeCapturedCalls(capturedCalls))}`,
      `Captured model rounds before failure: ${stringify(capturedGenerateRounds)}`,
    ].join('\n');
    if (error instanceof Error) {
      throw new Error(`${error.message}\n${details}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    await client.end();
  }
}

const smokeCases: OralQuoteSmokeCase[] = [
  {
    envFlag: 'STEEL_OPENAI_OAUTH_C_TYPE_ORAL_TEST',
    key: 'c-type',
    name: 'uses lookup_quote_rules before c_type price lookup and derives the 100x2.3 candidate',
    prompt: 'C100x50x20x2.3t 6M 一支多少？',
    lookupArgumentContains: ['c_type'],
    priceArgumentContains: ['c_type', '100x2.3', '錏輕型鋼', '"customerTierId":2'],
    responseTextPatterns: [
      /24\s*(?:kg|公斤)/u,
      /(?:價格\s*B|B\s*(?:價|級))[\s\S]*(?:26\.8|643\.2)|(?:預設|主價格)[\s\S]*B/u,
      /價格\s*B|B\s*價/u,
      /客戶名稱|客戶/u,
      /600\s*[～~-]\s*643\.2|624(?:\.0)?|643\.2/u,
      /白鐵輕型鋼|黑鐵輕型鋼/u,
    ],
    responseTextRejectPatterns: [/最高|最貴/u, /單位重/u, /reviewed\s*價格/i],
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
    name: 'uses lookup_quote_rules before h_beam price lookup and derives the H 100x50 candidate',
    prompt: 'H型鋼 100x50x5/7x6M 一支多少？',
    lookupArgumentContains: ['h_beam'],
    priceArgumentContains: ['h_beam'],
    priceArgumentPatterns: [/100.*50/i],
  },
  {
    envFlag: 'STEEL_OPENAI_OAUTH_ANGLE_ORAL_TEST',
    key: 'angle',
    name: 'uses lookup_quote_rules before angle price lookup and derives the 30x2.5 candidate',
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
        const lookupIndex = getToolCallIndex(capturedCalls, 'lookup_quote_rules');
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
        for (const expectedPattern of smokeCase.responseTextPatterns ?? []) {
          expect(response.text).toMatch(expectedPattern);
        }
        for (const rejectedPattern of smokeCase.responseTextRejectPatterns ?? []) {
          expect(response.text).not.toMatch(rejectedPattern);
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
      const firstLookupIndex = getToolCallIndex(firstRun.capturedCalls, 'lookup_quote_rules');
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
      const lookupIndex = getToolCallIndex(run.capturedCalls, 'lookup_quote_rules');
      const priceIndex = getToolCallIndex(run.capturedCalls, 'search_price_candidates');
      const lookupResult = stringify(run.capturedCalls[lookupIndex]?.result);
      const pricePayload = stringify(getToolCalls(run.capturedCalls, 'search_price_candidates'));
      const serialized = stringify(run);

      expect(lookupIndex).toBeGreaterThanOrEqual(0);
      expect(priceIndex).toBeGreaterThan(lookupIndex);
      expect(getToolCallIndex(run.capturedCalls, 'lookup_defaults')).toBe(-1);
      expect(stringify(run.capturedCalls[lookupIndex]?.arguments)).toContain('h_beam');
      expect(stringify(run.capturedCalls[lookupIndex]?.arguments)).toMatch(/cutting|slotting|hole/);
      expect(lookupResult).toContain('H 型鋼切工');
      expect(lookupResult).toContain('開槽 KZZB10');
      expect(lookupResult).toContain('沖孔 KZZB11');
      expect(pricePayload).toContain('H型鋼');
      expect(pricePayload).toContain('開槽加工');
      expect(pricePayload).toContain('沖孔加工');
      expect(pricePayload).toContain('unitPrice');
      expect(lookupResult).toMatch(/開槽|沖孔|另計/);
      expect(run.response.text).toMatch(/切工|對半切/);
      expect(run.response.text).toMatch(/開槽|KZZB10/);
      expect(run.response.text).toMatch(/沖孔|KZZB11|4[-－]?Ø?22/i);
      expect(run.response.text).toMatch(/確認|另計|暫估|預估|候選/);
      expect(serialized).not.toMatch(/access_token|authorization|Bearer|authFile/i);
    },
    caseTimeoutMs + 30000,
  );
});

const runWorkbookPatch = process.env.STEEL_OPENAI_OAUTH_WORKBOOK_PATCH_TEST === 'true';
const describeWorkbookPatch = runWorkbookPatch ? describe : describe.skip;

describeWorkbookPatch('Steel OpenAI OAuth workbook patch smoke', () => {
  it(
    'emits workbook patch operations for quote details, price sources, notes, and subtotal',
    async () => {
      const run = await runLiveWorkbookPatchChat(
        [
          {
            role: 'user',
            content:
              'C型鋼 C100x50x20x2.3t 6M 一支多少？請先依序查 lookup_quote_rules 與 search_price_candidates，拿到 positive reviewed candidate 後優先呼叫 patch_quote_workbook，更新報價明細、價格來源、判讀備註、總結、人工複核、系統訂單、給客戶用，並回覆小計與改動重點。',
          },
        ],
        2800,
      );
      const lookupIndex = getToolCallIndex(run.capturedCalls, 'lookup_quote_rules');
      const priceIndex = getToolCallIndex(run.capturedCalls, 'search_price_candidates');
      const operations = run.response.workbookPatch?.operations ?? [];
      const quoteDetailsSubtotal = findWorkbookOperation(
        run.response,
        'quote_details',
        'line_1',
        'subtotal',
      );
      const quoteDetailsUnitPrice = findWorkbookOperation(
        run.response,
        'quote_details',
        'line_1',
        'material_unit_price',
      );
      const quoteDetailsQuantity = findWorkbookOperation(
        run.response,
        'quote_details',
        'line_1',
        'billable_quantity',
      );
      const quoteDetailsAdoptedItem = findWorkbookOperation(
        run.response,
        'quote_details',
        'line_1',
        'adopted_product_price_item',
      );
      const priceSourceItem = findWorkbookOperation(
        run.response,
        'price_sources',
        'source_1',
        'adopted_product_price_item',
      );
      const interpretationNote = findWorkbookOperation(
        run.response,
        'interpretation_notes',
        'note_1',
        'content',
      );
      const subtotalValue = operationValueNumber(quoteDetailsSubtotal?.value);
      const unitPriceValue = operationValueNumber(quoteDetailsUnitPrice?.value);
      const quantityValue = operationValueNumber(quoteDetailsQuantity?.value);
      const serialized = stringify({
        response: run.response,
        capturedCalls: run.capturedCalls,
        capturedGenerateRounds: run.capturedGenerateRounds,
      });

      expect(lookupIndex).toBeGreaterThanOrEqual(0);
      expect(priceIndex).toBeGreaterThan(lookupIndex);
      expect(stringify(run.capturedCalls[lookupIndex]?.arguments)).toContain('c_type');
      expect(stringify(run.capturedCalls[priceIndex]?.arguments)).toContain('"customerTierId":2');
      expect(operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: 'set_cell',
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'subtotal',
          }),
        ]),
      );
      expect(operations.some((operation) => operation.sheetId === 'price_sources')).toBe(true);
      expect(operations.some((operation) => operation.sheetId === 'interpretation_notes')).toBe(
        true,
      );
      expect(unitPriceValue).toBe(26.8);
      expect(quantityValue).toBe(24);
      expect(subtotalValue).toBeGreaterThanOrEqual(643);
      expect(subtotalValue).toBeLessThanOrEqual(644);
      expect(operationValueText(quoteDetailsAdoptedItem?.value)).toMatch(/錏輕型鋼|100\*?2\.3/u);
      expect(operationValueText(priceSourceItem?.value)).toMatch(/錏輕型鋼|CCG10023|100\*?2\.3/u);
      expect(operationValueText(interpretationNote?.value)).toMatch(/小計|643|24\s*kg|錏輕型鋼/u);
      expect(run.response.text).toMatch(/小計|643|改動|更新/u);
      expect(serialized).not.toMatch(/access_token|authorization|Bearer|authFile/i);
    },
    caseTimeoutMs + 30000,
  );
});
