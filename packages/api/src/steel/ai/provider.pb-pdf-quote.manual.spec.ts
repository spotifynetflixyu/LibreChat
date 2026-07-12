import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { readFile, mkdir, writeFile } from 'fs/promises';

import { parseMarkdownTables, type SteelMarkdownTable } from '../markdown/table';
import { createSteelPostgresPool } from '../postgres';
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
import { executeSteelTool } from '../tools/execute';
import { parseOpenAIConfig, resolveOpenAIOAuthAuthFilePath } from './config';
import { sendSteelOAuthChat } from './provider';

import type { SteelAgentRule } from '../repositories/rules';
import type { SteelToolJsonObject, SteelToolJsonValue, SteelToolResult } from '../tools/results';
import type {
  SteelOAuthChatFile,
  SteelOAuthChatMessage,
  SteelProviderToolExecutor,
  SteelProviderToolStatusCallback,
} from './provider';

const runPBQuoteLive = process.env.STEEL_OPENAI_OAUTH_PB_PDF_QUOTE_LIVE_TEST === 'true';
const describePBQuoteLive = runPBQuoteLive ? describe : describe.skip;
const repoRoot = path.resolve(__dirname, '../../../../../');
const pbPdfPath = path.join(repoRoot, 'docs/reference/example/PB.pdf');
const pbPdfExpectedPageCount = 71;
const caseTimeoutMs = Number(process.env.STEEL_OPENAI_OAUTH_PB_PDF_QUOTE_TIMEOUT_MS ?? 1200000);
const pbPdfMaxOutputTokens = Number(
  process.env.STEEL_OPENAI_OAUTH_PB_PDF_QUOTE_MAX_OUTPUT_TOKENS ?? 20000,
);
const evidenceOutputPath =
  process.env.STEEL_OPENAI_OAUTH_PB_PDF_QUOTE_EVIDENCE_PATH ??
  path.join(repoRoot, 'tmp/steel-pb-pdf-quote-live-evidence.json');

if (runPBQuoteLive) {
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

interface RuntimeRuleReadback {
  slug: string;
  ruleKind: string;
  reviewState: string;
  active: boolean;
  sha256: string;
  promptLength: number;
  sourceFile?: string;
  includes: Record<string, boolean>;
}

interface TablePayload {
  [key: string]: string;
}

type ToolStatusEvent = Parameters<SteelProviderToolStatusCallback>[0];

const expectedSystemOrderHeaders = [
  '型號',
  '品名規格',
  '材質編號',
  '單位',
  '數量',
  '單重',
  '總數',
  '單價',
  '計價基準',
  '公式編號',
  '厚度',
  '寬度',
  '長度',
  '肚',
  '類別',
  '備註',
] as const;

function hasRuleSection(rule: SteelAgentRule, matches: readonly string[]): boolean {
  return rule.ruleSections.some((section) => matches.some((match) => section.includes(match)));
}

function isOcrRule(rule: SteelAgentRule): boolean {
  return hasRuleSection(rule, ['file_ocr', 'drawing_ocr', 'vision_evidence']);
}

function isObject(value: SteelToolJsonValue | undefined): value is SteelToolJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function hasHeaders(table: SteelMarkdownTable, headers: readonly string[]): boolean {
  return headers.every((header) => table.headers.includes(header));
}

function hasExactHeaders(table: SteelMarkdownTable, headers: readonly string[]): boolean {
  return (
    table.headers.length === headers.length &&
    table.headers.every((header, index) => header === headers[index])
  );
}

function findSystemOrderTables(text: string): SteelMarkdownTable[] {
  return parseMarkdownTables(text).filter((table) => hasHeaders(table, ['型號']));
}

function findFirstMarkdownTable(text: string): SteelMarkdownTable | undefined {
  return parseMarkdownTables(text)[0];
}

function toPayload(headers: readonly string[], row: readonly string[]): TablePayload {
  return headers.reduce<TablePayload>((payload, header, index) => {
    payload[header] = row[index] ?? '';
    return payload;
  }, {});
}

function toPayloads(table: SteelMarkdownTable | undefined): TablePayload[] {
  return table?.rows.map((row) => toPayload(table.headers, row)) ?? [];
}

function toPayloadsFromTables(tables: readonly SteelMarkdownTable[]): TablePayload[] {
  return tables.flatMap((table) => toPayloads(table));
}

function getRowIdentityText(row: TablePayload): string {
  return [
    row['型號'],
    row['品名規格'],
    row['品名'],
    row['類別'],
    row['加工類型'],
    row['備註'],
    row['說明'],
    row['信心 / 備註'],
    row['信心 / 人工複核'],
  ]
    .filter((value) => value !== undefined && value.trim().length > 0)
    .join(' ');
}

function isMaterialModelCode(value: string | undefined): boolean {
  return /^(?:DNB|BNB|ENB|SNB|CCG|EHS)/iu.test(value?.trim() ?? '');
}

function isHoleQuoteRow(row: TablePayload): boolean {
  const modelCode = row['型號'];
  const productName = row['品名規格'];
  const processingText = [row['加工類型'], row['類別'], row['原始規格']]
    .filter((value) => value !== undefined && value.trim().length > 0)
    .join(' ');

  if (isMaterialModelCode(modelCode)) {
    return false;
  }

  return (
    /^(?:DZA|BKZZ|KZZ)/iu.test(modelCode?.trim() ?? '') ||
    /孔加工|沖孔|鑽孔|鐵板鑽孔|拓孔|長孔|hole/iu.test(productName ?? '') ||
    /孔|沖孔|鑽孔|拓孔|長孔|hole/iu.test(processingText)
  );
}

function isMaterialQuoteRow(row: TablePayload): boolean {
  const identity = getRowIdentityText(row);
  return !isHoleQuoteRow(row) && /鋼|鐵|板|管|角|槽|扁|PL|PB|OT|ST/iu.test(identity);
}

function extractPositiveNumbers(value: string | undefined): number[] {
  return [...(value ?? '').matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/gu)]
    .map((match) => Number(match[0].replace(/,/gu, '')))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function extractFirstPositiveNumber(value: string | undefined): number | undefined {
  return extractPositiveNumbers(value)[0];
}

function findHeaderIndex(headers: readonly string[], pattern: RegExp): number {
  return headers.findIndex((header) => pattern.test(header));
}

function getOcrHoleCountSummary(text: string) {
  const summary = parseMarkdownTables(text).reduce(
    (current, table) => {
      const perPieceIndex = findHeaderIndex(table.headers, /孔數\s*\/\s*件|每件孔數/u);
      const totalIndex = findHeaderIndex(table.headers, /總孔數|孔數總計|孔總數/u);
      const hasPerPieceColumn = current.hasPerPieceColumn || perPieceIndex >= 0;
      const hasTotalColumn = current.hasTotalColumn || totalIndex >= 0;
      const total =
        totalIndex >= 0
          ? table.rows.reduce((rowTotal, row) => {
              return rowTotal + (extractFirstPositiveNumber(row[totalIndex]) ?? 0);
            }, current.total)
          : current.total;

      return {
        hasPerPieceColumn,
        hasTotalColumn,
        total,
      };
    },
    {
      hasPerPieceColumn: false,
      hasTotalColumn: false,
      total: 0,
    },
  );

  return {
    ...summary,
    total: Math.round(summary.total),
  };
}

function getQuoteRowQuantity(row: TablePayload): number {
  return (
    extractFirstPositiveNumber(row['數量']) ??
    extractFirstPositiveNumber(row['計價量']) ??
    extractFirstPositiveNumber(row['總孔數']) ??
    extractFirstPositiveNumber(row['孔數']) ??
    0
  );
}

function sumQuoteRowQuantities(rows: readonly TablePayload[]): number {
  return Math.round(rows.reduce((total, row) => total + getQuoteRowQuantity(row), 0));
}

function hasNumericPriceBasis(rows: readonly TablePayload[]): boolean {
  return rows.length > 0 && rows.every((row) => /^[1-6]$/u.test(row['計價基準'] ?? ''));
}

function hasPositiveQuoteAmount(row: TablePayload): boolean {
  return Object.entries(row).some(([header, value]) => {
    return (
      /單價|小計|總價|金額|價格|報價/u.test(header) && extractPositiveNumbers(value).length > 0
    );
  });
}

function summarizeToolResult(result: SteelToolResult | undefined) {
  if (!result) {
    return undefined;
  }
  if (!result.ok) {
    return {
      ok: false,
      toolName: result.toolName,
      errorCategory: result.errorCategory,
      errorSummary: result.errorSummary,
      durationMs: result.durationMs,
    };
  }
  return {
    ok: true,
    toolName: result.toolName,
    durationMs: result.durationMs,
  };
}

function summarizeToolEvent(event: ToolStatusEvent) {
  return {
    toolName: event.toolName,
    status: event.status,
    message: event.message,
    result: summarizeToolResult(event.result),
    errorSummary: event.errorSummary,
  };
}

function getErrorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertWithEvidence(
  condition: unknown,
  message: string,
  evidence: Record<string, unknown>,
): asserts condition {
  if (condition) {
    return;
  }

  throw new Error(`${message}\n${JSON.stringify(evidence, null, 2)}`);
}

async function loadPBFile(): Promise<SteelOAuthChatFile> {
  const data = await readFile(pbPdfPath);

  return {
    filename: 'PB.pdf',
    mediaType: 'application/pdf',
    pageCount: pbPdfExpectedPageCount,
    data: new Uint8Array(data),
  };
}

function createPBOcrUserPrompt(): string {
  return '請處理附檔 PB.pdf。';
}

function createPBConfirmedQuoteUserPrompt(): string {
  return '確認上一輪資料正確，請產生報價。';
}

function hasEmbeddedRuleInstruction(prompt: string): boolean {
  return /PaddleOCR|paddleocr_vl|search_price_candidates|system_order|customer_quote|第一輪|不得|不要重新 OCR|每一筆|獨立報價列/iu.test(
    prompt,
  );
}

function isPriceLookupCall(call: CapturedToolCall): boolean {
  return call.toolName === 'search_price_candidates';
}

function countOcrProductRows(text: string): number {
  return parseMarkdownTables(text)
    .filter((table) => {
      const headerText = table.headers.join(' ');
      return (
        /件號|品項|品名|規格|材質|厚度|尺寸/u.test(headerText) &&
        !/單價|小計|總價|報價總額/u.test(headerText)
      );
    })
    .reduce((count, table) => count + table.rows.length, 0);
}

function hasPerRoundTimings(response: Awaited<ReturnType<typeof sendSteelOAuthChat>>): boolean {
  return (
    response.timings !== undefined &&
    response.timings.rounds.length === response.timings.roundCount &&
    response.timings.rounds.every((round) => {
      return (
        typeof round.round === 'number' &&
        typeof round.generationDurationMs === 'number' &&
        typeof round.toolDurationMs === 'number' &&
        typeof round.promptMessageCount === 'number' &&
        typeof round.generatedToolCallCount === 'number'
      );
    })
  );
}

async function writeEvidence(evidence: Record<string, unknown>) {
  await mkdir(path.dirname(evidenceOutputPath), { recursive: true });
  await writeFile(evidenceOutputPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function readRuntimeRuleEvidence(
  pool: ReturnType<typeof createSteelPostgresPool>,
): Promise<RuntimeRuleReadback[]> {
  const requiredFragments = {
    'steel-default-agent-instruction': [
      'OCR 與報價階段',
      '本輪有 PDF／image 且需 OCR 時',
      '該輪停止於確認階段',
      '不查價',
      '使用者後續明確確認或修正 OCR 資料後才進入報價',
    ],
    'steel-workbook-output-policy': [
      '報價階段第一張表必須是 `system_order` 逐項明細',
      '`型號`、`品名規格`、`材質編號`、`單位`、`數量`',
      '`單重`、`總數`、`單價`、`計價基準`、`公式編號`',
      '`計價基準`只填1至6（A至F）',
      '孔、切工、折工、刀、開槽、切角、缺口與其他／外包加工',
      '孔加工列數量合計必須等於已確認總孔數',
      '最後一列為`總計`',
    ],
  };
  const slugs = Object.keys(requiredFragments);
  const { rows } = await pool.query(
    `SELECT slug, prompt, rule_kind, review_state, active, source_refs
     FROM steel.rules
     WHERE slug = ANY($1::text[])
     ORDER BY slug`,
    [slugs],
  );

  return rows.map((row) => {
    const slug = String(row.slug);
    const prompt = String(row.prompt);
    const fragments = requiredFragments[slug as keyof typeof requiredFragments] ?? [];

    return {
      slug,
      ruleKind: String(row.rule_kind),
      reviewState: String(row.review_state),
      active: row.active === true,
      sha256: crypto.createHash('sha256').update(prompt).digest('hex'),
      promptLength: prompt.length,
      sourceFile: row.source_refs?.[0]?.sourceFile,
      includes: Object.fromEntries(
        fragments.map((fragment) => [fragment, prompt.includes(fragment)]),
      ),
    };
  });
}

function hasAllRequiredRuntimeRules(rules: readonly RuntimeRuleReadback[]): boolean {
  return (
    rules.length === 2 &&
    rules.every((rule) => {
      return (
        rule.active &&
        rule.reviewState === 'reviewed' &&
        Object.values(rule.includes).every((included) => included)
      );
    })
  );
}

function createCapturingToolExecutor(
  pool: ReturnType<typeof createSteelPostgresPool>,
  capturedCalls: CapturedToolCall[],
): SteelProviderToolExecutor {
  return async (options) => {
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
}

async function createRuntimeContext({
  activeHistory,
  conversationId,
  currentTurnFiles = [],
  currentUserTurn,
  pool,
  requestId,
}: {
  activeHistory: SteelOAuthChatMessage[];
  conversationId: string;
  currentTurnFiles?: SteelOAuthChatFile[];
  currentUserTurn: SteelOAuthChatMessage;
  pool: ReturnType<typeof createSteelPostgresPool>;
  requestId: string;
}) {
  return prepareSteelRuntimeContext({
    conversation: {
      conversationId,
      requestId,
      activeHistory,
      currentUserTurn,
    },
    attachments: {
      currentTurnFiles,
    },
    dependencies: {
      listAgentRules: () => listReviewedSteelAgentRules(pool),
      listReviewedInstructionPackets: async () => [],
      listReviewedQuoteDefaults: async () => [],
      listReviewedQuoteRules: () => listReviewedSteelQuoteRules(pool),
      listOutputRules: () => listReviewedSteelOutputRules(pool),
      listOtherGlobalRules: async () => {
        const rules = await listReviewedSteelOtherRules(pool);
        const ocrRules = rules.filter(isOcrRule);
        return {
          ocrRules,
          fileRules: rules.filter((rule) => hasRuleSection(rule, ['file']) && !isOcrRule(rule)),
          sourcePriorityRules: rules.filter((rule) => hasRuleSection(rule, ['source_priority'])),
          markdownOutputRules: rules.filter((rule) => hasRuleSection(rule, ['markdown_output'])),
        };
      },
      readOutputSheetMemory: async () => createEmptySteelOutputSheetMemorySnapshot(),
    },
  });
}

describePBQuoteLive('Steel live PB.pdf OCR confirmation and quote flow', () => {
  it(
    'returns OCR confirmation first, then quotes confirmed OCR rows as independent order lines',
    async () => {
      const pool = createSteelPostgresPool();
      const config = parseOpenAIConfig(process.env);
      const authFilePath = resolveOpenAIOAuthAuthFilePath(process.env);
      const pbFile = await loadPBFile();
      const runtimeRuleEvidence = await readRuntimeRuleEvidence(pool);
      assertWithEvidence(
        hasAllRequiredRuntimeRules(runtimeRuleEvidence),
        'PB.pdf live smoke did not use the expected reviewed active DB runtime rules.',
        { runtimeRuleEvidence },
      );
      const ocrUserMessage: SteelOAuthChatMessage = {
        role: 'user',
        content: createPBOcrUserPrompt(),
        files: [pbFile],
      };
      const quoteUserMessage: SteelOAuthChatMessage = {
        role: 'user',
        content: createPBConfirmedQuoteUserPrompt(),
      };
      const ocrCapturedCalls: CapturedToolCall[] = [];
      const quoteCapturedCalls: CapturedToolCall[] = [];
      const ocrToolEvents: ToolStatusEvent[] = [];
      const quoteToolEvents: ToolStatusEvent[] = [];

      try {
        const ocrRuntimeContext = await createRuntimeContext({
          activeHistory: [],
          conversationId: 'steel_live_pb_pdf_ocr_confirm',
          currentTurnFiles: [pbFile],
          currentUserTurn: ocrUserMessage,
          pool,
          requestId: `steel_live_pb_pdf_ocr_${Date.now()}`,
        });
        const ocrResponse = await (async () => {
          try {
            return await sendSteelOAuthChat({
              authFilePath,
              executeSteelToolCall: createCapturingToolExecutor(pool, ocrCapturedCalls),
              maxOutputTokens: pbPdfMaxOutputTokens,
              model: config.model,
              onToolStatus: (event) => {
                ocrToolEvents.push(event);
              },
              passThroughUnsupportedFiles: true,
              reasoningEffort: config.reasoningEffort,
              steelRuntimeContext: ocrRuntimeContext,
              steelRuntimePolicy: true,
              steelToolMaxCalls: 10,
              messages: [ocrUserMessage],
            });
          } catch (error) {
            const failureEvidence = {
              fixture: {
                path: 'docs/reference/example/PB.pdf',
                pageCount: pbPdfExpectedPageCount,
              },
              runtimeRuleEvidence,
              phase: 'ocr_confirmation',
              errorSummary: getErrorSummary(error),
              toolEvents: ocrToolEvents.map(summarizeToolEvent),
              capturedToolCalls: ocrCapturedCalls.map((call) => ({
                toolName: call.toolName,
                arguments: call.arguments,
                result: summarizeToolResult(call.result),
              })),
              evidenceOutputPath,
            };

            await writeEvidence(failureEvidence);
            throw new Error(
              `PB.pdf live OCR confirmation failed before final response.\n${JSON.stringify(
                failureEvidence,
                null,
                2,
              )}`,
            );
          }
        })();
        const removedOcrEvents = ocrToolEvents.filter((event) => event.toolName === 'run_file_ocr');
        const ocrProductRowCount = countOcrProductRows(ocrResponse.text);
        const ocrHoleCountSummary = getOcrHoleCountSummary(ocrResponse.text);
        const quoteRuntimeContext = await createRuntimeContext({
          activeHistory: [{ role: 'assistant', content: ocrResponse.text }],
          conversationId: 'steel_live_pb_pdf_ocr_confirm',
          currentUserTurn: quoteUserMessage,
          pool,
          requestId: `steel_live_pb_pdf_quote_${Date.now()}`,
        });
        const quoteResponse = await sendSteelOAuthChat({
          authFilePath,
          executeSteelToolCall: createCapturingToolExecutor(pool, quoteCapturedCalls),
          maxOutputTokens: pbPdfMaxOutputTokens,
          model: config.model,
          onToolStatus: (event) => {
            quoteToolEvents.push(event);
          },
          passThroughUnsupportedFiles: true,
          reasoningEffort: config.reasoningEffort,
          steelRuntimeContext: quoteRuntimeContext,
          steelRuntimePolicy: true,
          steelToolMaxCalls: 10,
          messages: [{ role: 'assistant', content: ocrResponse.text }, quoteUserMessage],
        });
        const priceCandidates = quoteCapturedCalls.flatMap((call) =>
          getPriceCandidates(call.result),
        );
        const firstQuoteTable = findFirstMarkdownTable(quoteResponse.text);
        const systemOrderTables = findSystemOrderTables(quoteResponse.text);
        const systemOrderRows = toPayloadsFromTables(systemOrderTables);
        const materialRows = systemOrderRows.filter(isMaterialQuoteRow);
        const holeQuoteRows = systemOrderRows.filter(
          (row) => isHoleQuoteRow(row) && hasPositiveQuoteAmount(row),
        );
        const holeQuoteQuantityTotal = sumQuoteRowQuantities(holeQuoteRows);
        const evidence = {
          fixture: {
            path: 'docs/reference/example/PB.pdf',
            pageCount: pbPdfExpectedPageCount,
          },
          userPrompts: {
            ocr: ocrUserMessage.content,
            quote: quoteUserMessage.content,
          },
          runtimeRuleEvidence,
          ocrTimings: ocrResponse.timings,
          quoteTimings: quoteResponse.timings,
          ocrProductRowCount,
          ocrHoleCountSummary,
          ocrToolEvents: ocrToolEvents.map(summarizeToolEvent),
          quoteToolEvents: quoteToolEvents.map(summarizeToolEvent),
          ocrCapturedToolCalls: ocrCapturedCalls.map((call) => ({
            toolName: call.toolName,
            arguments: call.arguments,
            result: summarizeToolResult(call.result),
          })),
          quoteCapturedToolCalls: quoteCapturedCalls.map((call) => ({
            toolName: call.toolName,
            arguments: call.arguments,
            result: summarizeToolResult(call.result),
          })),
          priceCandidateSummary: priceCandidates,
          firstQuoteTableHeaders: firstQuoteTable?.headers,
          firstQuoteTableRowCount: firstQuoteTable?.rows.length,
          systemOrderTableCount: systemOrderTables.length,
          expectedSystemOrderHeaders,
          systemOrderTables: systemOrderTables.map((table) => ({
            headers: table.headers,
            rowCount: table.rows.length,
            hasExactHeaders: hasExactHeaders(table, expectedSystemOrderHeaders),
          })),
          systemOrderRowCount: systemOrderRows.length,
          hasNumericPriceBasis: hasNumericPriceBasis(systemOrderRows),
          materialRows: materialRows.map(getRowIdentityText),
          holeQuoteRows: holeQuoteRows.map(getRowIdentityText),
          holeQuoteQuantityTotal,
          ocrResponseTextPreview: ocrResponse.text.slice(0, 1200),
          ocrResponseText: ocrResponse.text,
          quoteResponseTextLength: quoteResponse.text.length,
          quoteResponseTextPreview: quoteResponse.text.slice(0, 1200),
          quoteResponseText: quoteResponse.text,
          evidenceOutputPath,
        };

        await writeEvidence(evidence);

        assertWithEvidence(
          hasAllRequiredRuntimeRules(runtimeRuleEvidence),
          'PB.pdf live smoke did not use the expected reviewed active DB runtime rules.',
          evidence,
        );
        assertWithEvidence(
          !hasEmbeddedRuleInstruction(ocrUserMessage.content) &&
            !hasEmbeddedRuleInstruction(quoteUserMessage.content),
          'PB.pdf live smoke user prompts embedded rule/tool instructions instead of relying on DB runtime rules.',
          evidence,
        );
        expect(hasPerRoundTimings(ocrResponse)).toBe(true);
        expect(hasPerRoundTimings(quoteResponse)).toBe(true);
        expect(removedOcrEvents).toHaveLength(0);
        expect(ocrCapturedCalls.some(isPriceLookupCall)).toBe(false);
        expect(ocrProductRowCount).toBeGreaterThan(0);
        assertWithEvidence(
          ocrHoleCountSummary.hasPerPieceColumn &&
            ocrHoleCountSummary.hasTotalColumn &&
            ocrHoleCountSummary.total > 0,
          'PB.pdf OCR confirmation did not include explicit per-piece and total hole counts.',
          evidence,
        );
        expect(quoteToolEvents.filter((event) => event.toolName === 'run_file_ocr')).toHaveLength(
          0,
        );
        expect(quoteCapturedCalls.some(isPriceLookupCall)).toBe(true);
        expect(priceCandidates.some((candidate) => candidate.priceKind === 'product')).toBe(true);
        expect(
          priceCandidates.some(
            (candidate) => candidate.priceKind === 'hole' || candidate.category === '孔',
          ),
        ).toBe(true);
        assertWithEvidence(
          systemOrderTables.length > 0,
          'PB.pdf quote response did not include a system_order-compatible Markdown table.',
          evidence,
        );
        assertWithEvidence(
          firstQuoteTable !== undefined && hasHeaders(firstQuoteTable, ['型號']),
          'PB.pdf quote response did not put the system_order detail table first.',
          evidence,
        );
        assertWithEvidence(
          firstQuoteTable !== undefined &&
            hasExactHeaders(firstQuoteTable, expectedSystemOrderHeaders),
          'PB.pdf first system_order table did not use the fixed ERP column order.',
          evidence,
        );
        assertWithEvidence(
          systemOrderTables.every((table) => hasExactHeaders(table, expectedSystemOrderHeaders)),
          'PB.pdf system_order continuation tables did not all use the fixed ERP column order.',
          evidence,
        );
        assertWithEvidence(
          hasNumericPriceBasis(systemOrderRows),
          'PB.pdf system_order price basis did not use numeric customer-tier values.',
          evidence,
        );
        assertWithEvidence(
          materialRows.length >= ocrProductRowCount,
          'PB.pdf system_order table did not preserve every OCR product row as a material row.',
          evidence,
        );
        assertWithEvidence(
          systemOrderRows.length > ocrProductRowCount,
          'PB.pdf quote response did not add independent processing rows beyond OCR product rows.',
          evidence,
        );
        assertWithEvidence(
          holeQuoteRows.length > 0,
          'PB.pdf system_order table did not include a priced hole-processing row.',
          evidence,
        );
        assertWithEvidence(
          holeQuoteQuantityTotal === ocrHoleCountSummary.total,
          'PB.pdf hole-processing quote quantity did not match confirmed OCR total hole count.',
          evidence,
        );
        expect(JSON.stringify(evidence)).not.toMatch(/access_token|authorization|Bearer|authFile/i);
      } finally {
        await pool.end();
      }
    },
    caseTimeoutMs + 10000,
  );
});
