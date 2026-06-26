import path from 'path';
import dotenv from 'dotenv';
import { mkdir, readFile, writeFile } from 'fs/promises';

import { parseMarkdownTables } from '../markdown/table';
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
import type { SteelRuntimeJsonObject } from '../runtime/context';
import type { SteelToolResult } from '../tools/results';
import type {
  SteelOAuthChatFile,
  SteelOAuthChatMessage,
  SteelProviderToolExecutor,
  SteelProviderToolStatusCallback,
} from './provider';

const runPLQuoteLive = process.env.STEEL_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST === 'true';
const describePLQuoteLive = runPLQuoteLive ? describe : describe.skip;
const repoRoot = path.resolve(__dirname, '../../../../../');
const plPdfPath = path.join(repoRoot, 'docs/reference/example/PL.pdf');
const caseTimeoutMs = Number(
  process.env.STEEL_OPENAI_OAUTH_PL_PDF_QUOTE_TIMEOUT_MS ?? 1200000,
);
const plPdfMaxOutputTokens = Number(
  process.env.STEEL_OPENAI_OAUTH_PL_PDF_QUOTE_MAX_OUTPUT_TOKENS ?? 20000,
);
const evidenceOutputPath =
  process.env.STEEL_OPENAI_OAUTH_PL_PDF_QUOTE_EVIDENCE_PATH ??
  path.join(repoRoot, 'tmp/steel-pl-pdf-quote-live-evidence.json');

if (runPLQuoteLive) {
  dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
}

interface CapturedToolCall {
  toolName: string;
  arguments: unknown;
  result?: SteelToolResult;
}

type ToolStatusEvent = Parameters<SteelProviderToolStatusCallback>[0];

function hasRuleSection(rule: SteelAgentRule, matches: readonly string[]): boolean {
  return rule.ruleSections.some((section) => matches.some((match) => section.includes(match)));
}

function isOcrRule(rule: SteelAgentRule): boolean {
  return hasRuleSection(rule, ['file_ocr', 'drawing_ocr', 'vision_evidence']);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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

async function writeEvidence(evidence: Record<string, unknown>) {
  await mkdir(path.dirname(evidenceOutputPath), { recursive: true });
  await writeFile(evidenceOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

async function loadPLFile(): Promise<SteelOAuthChatFile> {
  const data = await readFile(plPdfPath);

  return {
    filename: 'PL.pdf',
    mediaType: 'application/pdf',
    data: new Uint8Array(data),
  };
}

function createPLOcrUserPrompt(): string {
  return '請處理附檔 PL.pdf。';
}

function createPLConfirmedQuoteUserPrompt(): string {
  return '確認上一輪 OCR 表格正確，請依 OCR 表單給出報價。';
}

function hasEmbeddedRuleInstruction(prompt: string): boolean {
  return /run_file_ocr|search_price_candidates|system_order|customer_quote|第一輪|不得|不要重新 OCR|工具/iu.test(
    prompt,
  );
}

function hasSecretMarker(value: unknown): boolean {
  return /access_token|authorization|Bearer|authFile/i.test(JSON.stringify(value));
}

function isPriceLookupCall(call: CapturedToolCall): boolean {
  return call.toolName === 'search_price_candidates';
}

function isOcrToolEvent(event: ToolStatusEvent): boolean {
  return event.toolName === 'run_file_ocr';
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
  if (result.toolName === 'run_file_ocr') {
    return {
      ok: true,
      toolName: result.toolName,
      durationMs: result.durationMs,
      data: {
        filename: readString(result.data.filename),
        mediaType: readString(result.data.mediaType),
        fileType: readString(result.data.fileType),
        outputMode: readString(result.data.outputMode),
        ocrEngine: readString(result.data.ocrEngine),
      },
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

function hasOcrConfirmationTable(text: string): boolean {
  return parseMarkdownTables(text).some((table) => {
    const headerText = table.headers.join(' ');
    return /來源檔案|檔案|編號|品名|規格|孔數|數量/u.test(headerText) && table.rows.length > 0;
  });
}

function hasQuoteTable(text: string): boolean {
  return parseMarkdownTables(text).some((table) => {
    const headers = new Set(table.headers);
    return headers.has('項次') && headers.has('型號') && headers.has('品名規格') && table.rows.length > 0;
  });
}

function getSuccessfulOcrEvidence(events: readonly ToolStatusEvent[]): SteelRuntimeJsonObject[] {
  return events
    .filter((event) => event.toolName === 'run_file_ocr' && event.status === 'completed')
    .flatMap((event) => {
      const result = event.result;
      if (!result?.ok || result.toolName !== 'run_file_ocr') {
        return [];
      }

      return [result.data as SteelRuntimeJsonObject];
    });
}

function createCapturingToolExecutor(
  pool: ReturnType<typeof createSteelPostgresPool>,
  capturedCalls: CapturedToolCall[],
): SteelProviderToolExecutor {
  return async (options) => {
    const result = await executeSteelTool({
      client: pool,
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
  };
}

async function createRuntimeContext({
  activeHistory,
  conversationId,
  currentTurnFiles = [],
  currentUserTurn,
  pool,
  priorActiveFileEvidence = [],
  requestId,
}: {
  activeHistory: SteelOAuthChatMessage[];
  conversationId: string;
  currentTurnFiles?: SteelOAuthChatFile[];
  currentUserTurn?: SteelOAuthChatMessage;
  pool: ReturnType<typeof createSteelPostgresPool>;
  priorActiveFileEvidence?: SteelRuntimeJsonObject[];
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
      priorActiveFileEvidence,
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
          fileRules: rules.filter((rule) => hasRuleSection(rule, ['file']) && !isOcrRule(rule)),
          sourcePriorityRules: rules.filter((rule) => hasRuleSection(rule, ['source_priority'])),
          markdownOutputRules: rules.filter((rule) => hasRuleSection(rule, ['markdown_output'])),
        };
      },
      readOutputSheetMemory: async () => createEmptySteelOutputSheetMemorySnapshot(),
    },
  });
}

describePLQuoteLive('Steel live PL.pdf OCR confirmation and quote flow', () => {
  it(
    'returns OCR confirmation first, then quotes the confirmed OCR table',
    async () => {
      const pool = createSteelPostgresPool();
      const config = parseOpenAIConfig(process.env);
      const authFilePath = resolveOpenAIOAuthAuthFilePath(process.env);
      const plFile = await loadPLFile();
      const conversationId = 'steel_live_pl_pdf_ocr_confirm';
      const ocrUserMessage: SteelOAuthChatMessage = {
        role: 'user',
        content: createPLOcrUserPrompt(),
        files: [plFile],
      };
      const quoteUserMessage: SteelOAuthChatMessage = {
        role: 'user',
        content: createPLConfirmedQuoteUserPrompt(),
      };
      const ocrCapturedCalls: CapturedToolCall[] = [];
      const quoteCapturedCalls: CapturedToolCall[] = [];
      const ocrToolEvents: ToolStatusEvent[] = [];
      const quoteToolEvents: ToolStatusEvent[] = [];

      try {
        const ocrRuntimeContext = await createRuntimeContext({
          activeHistory: [],
          conversationId,
          currentTurnFiles: [plFile],
          currentUserTurn: ocrUserMessage,
          pool,
          requestId: `steel_live_pl_pdf_ocr_${Date.now()}`,
        });
        const ocrResponse = await sendSteelOAuthChat({
          authFilePath,
          executeSteelToolCall: createCapturingToolExecutor(pool, ocrCapturedCalls),
          maxOutputTokens: plPdfMaxOutputTokens,
          model: config.model,
          messages: [ocrUserMessage],
          onToolStatus: (event) => {
            ocrToolEvents.push(event);
          },
          passThroughUnsupportedFiles: true,
          reasoningEffort: config.reasoningEffort,
          steelRuntimeContext: ocrRuntimeContext,
          steelRuntimePolicy: true,
          steelToolMaxCalls: 10,
        });
        const priorOcrEvidence = getSuccessfulOcrEvidence(ocrToolEvents);
        const quoteRuntimeContext = await createRuntimeContext({
          activeHistory: [{ role: 'assistant', content: ocrResponse.text }],
          conversationId,
          currentUserTurn: quoteUserMessage,
          pool,
          priorActiveFileEvidence: priorOcrEvidence,
          requestId: `steel_live_pl_pdf_quote_${Date.now()}`,
        });
        const quoteResponse = await sendSteelOAuthChat({
          authFilePath,
          executeSteelToolCall: createCapturingToolExecutor(pool, quoteCapturedCalls),
          maxOutputTokens: plPdfMaxOutputTokens,
          model: config.model,
          messages: [
            { role: 'assistant', content: ocrResponse.text },
            quoteUserMessage,
          ],
          onToolStatus: (event) => {
            quoteToolEvents.push(event);
          },
          passThroughUnsupportedFiles: true,
          reasoningEffort: config.reasoningEffort,
          steelRuntimeContext: quoteRuntimeContext,
          steelRuntimePolicy: true,
          steelToolMaxCalls: 10,
        });
        const evidence = {
          fixture: {
            path: 'docs/reference/example/PL.pdf',
          },
          model: config.model,
          userPrompts: {
            ocr: ocrUserMessage.content,
            quote: quoteUserMessage.content,
          },
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
          priorOcrEvidenceCount: priorOcrEvidence.length,
          ocrResponseTextPreview: ocrResponse.text.slice(0, 1200),
          ocrResponseText: ocrResponse.text,
          quoteResponseTextLength: quoteResponse.text.length,
          quoteResponseTextPreview: quoteResponse.text.slice(0, 1200),
          quoteResponseText: quoteResponse.text,
          evidenceOutputPath,
        };

        await writeEvidence(evidence);

        assertWithEvidence(
          config.model === 'gpt-5.5',
          'PL.pdf live smoke did not use gpt-5.5.',
          evidence,
        );
        assertWithEvidence(
          !hasEmbeddedRuleInstruction(ocrUserMessage.content) &&
            !hasEmbeddedRuleInstruction(quoteUserMessage.content),
          'PL.pdf live smoke user prompts embedded rule/tool instructions.',
          evidence,
        );
        assertWithEvidence(
          ocrToolEvents.filter(isOcrToolEvent).some((event) => event.status === 'started') &&
            ocrToolEvents.filter(isOcrToolEvent).some((event) => event.status === 'completed'),
          'PL.pdf first turn did not complete OCR.',
          evidence,
        );
        assertWithEvidence(
          !ocrCapturedCalls.some(isPriceLookupCall),
          'PL.pdf first OCR turn called price lookup before confirmation.',
          evidence,
        );
        assertWithEvidence(
          priorOcrEvidence.length > 0,
          'PL.pdf first OCR turn did not produce reusable OCR evidence.',
          evidence,
        );
        assertWithEvidence(
          hasOcrConfirmationTable(ocrResponse.text),
          'PL.pdf first turn did not return an OCR confirmation table.',
          evidence,
        );
        assertWithEvidence(
          quoteToolEvents.filter(isOcrToolEvent).length === 0,
          'PL.pdf confirmed quote turn reran OCR.',
          evidence,
        );
        assertWithEvidence(
          quoteCapturedCalls.some(isPriceLookupCall),
          'PL.pdf confirmed quote turn did not call price lookup.',
          evidence,
        );
        assertWithEvidence(
          hasQuoteTable(quoteResponse.text),
          'PL.pdf confirmed quote turn did not return a quote table.',
          evidence,
        );
        expect(hasSecretMarker(evidence)).toBe(false);
      } catch (error) {
        const failureEvidence = {
          fixture: {
            path: 'docs/reference/example/PL.pdf',
          },
          phase: 'pl_pdf_live_smoke',
          errorSummary: getErrorSummary(error),
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
          evidenceOutputPath,
        };

        await writeEvidence(failureEvidence);
        throw error;
      } finally {
        await pool.end();
      }
    },
    caseTimeoutMs + 10000,
  );
});
