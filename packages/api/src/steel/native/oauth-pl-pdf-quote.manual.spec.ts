import path from 'path';
import dotenv from 'dotenv';
import { mkdir, readFile, writeFile } from 'fs/promises';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@librechat/agents/langchain/messages';
import { parseMarkdownTables } from '../markdown/table';
import { createSteelPostgresPool } from '../postgres';
import { createEmptySteelOutputSheetMemorySnapshot } from '../runtime/context';
import { createSteelToolRunState, executeSteelTool } from '../tools/execute';
import { parseOpenAIConfig, resolveOpenAIOAuthAuthFilePath } from '../ai/config';
import {
  buildSteelGlobalAgentContext,
  createSteelContextDependencies,
} from './context';
import { createOpenAIOAuthModel } from './oauth';
import { mergeSteelToolDefinitions, resolveSteelProviderToolName } from './tools';

import type { LCTool } from '@librechat/agents';
import type { AIMessageChunk, BaseMessage } from '@librechat/agents/langchain/messages';
import type { ToolCall } from '@librechat/agents/langchain/messages/tool';
import type { BindToolsInput } from '@librechat/agents/langchain/language_models/chat_models';
import type { SteelOAuthChatFile } from '../ai/provider';
import type { SteelToolResult } from '../tools/results';
import type { SteelNativeFileReference, SteelNativeMessage } from './context';
import type { SteelProviderToolName } from '../tools/registry';

const runNativePLQuoteLive =
  process.env.STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST === 'true';
const describeNativePLQuoteLive = runNativePLQuoteLive ? describe : describe.skip;
const repoRoot = path.resolve(__dirname, '../../../../../');
const plPdfPath = path.join(repoRoot, 'docs/reference/example/PL.pdf');
const caseTimeoutMs = Number(
  process.env.STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_TIMEOUT_MS ?? 1200000,
);
const maxOutputTokens = Number(
  process.env.STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_MAX_OUTPUT_TOKENS ?? 20000,
);
const evidenceOutputPath =
  process.env.STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_EVIDENCE_PATH ??
  path.join(repoRoot, 'tmp/steel-native-openai-oauth-pl-pdf-quote-live-evidence.json');

if (runNativePLQuoteLive) {
  dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
}

interface CapturedNativeToolCall {
  nativeToolName: string;
  toolName: SteelProviderToolName;
  arguments: unknown;
  providerToolCallId: string;
  result: SteelToolResult;
}

interface NativeTurnResult {
  text: string;
  messages: BaseMessage[];
  capturedCalls: CapturedNativeToolCall[];
  roundCount: number;
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

function getErrorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function createPLFileReference(conversationId: string): SteelNativeFileReference {
  return {
    fileId: 'manual-live-pl-pdf',
    source: 'librechat_file_record',
    mediaType: 'application/pdf',
    conversationId,
    messageId: 'manual-live-user-ocr',
    filename: 'PL.pdf',
  };
}

function createPLOcrUserPrompt(): string {
  return '請處理附檔 PL.pdf。';
}

function createPLConfirmedQuoteUserPrompt(): string {
  return '確認上一輪 OCR 表格正確，請依 OCR 表單給出報價。';
}

function hasEmbeddedRuleInstruction(prompt: string): boolean {
  return /PaddleOCR|paddleocr_vl|search_price_candidates|system_order|customer_quote|第一輪|不得|不要重新 OCR|工具/iu.test(
    prompt,
  );
}

function hasSecretMarker(value: unknown): boolean {
  return /access_token|authorization|Bearer|authFile/i.test(JSON.stringify(value));
}

function toBase64DataUrl(file: SteelOAuthChatFile): string {
  if (!(file.data instanceof Uint8Array)) {
    throw new Error('PL.pdf live smoke expected Uint8Array fixture data.');
  }

  return `data:${file.mediaType};base64,${Buffer.from(file.data).toString('base64')}`;
}

function getMessageText(message: AIMessageChunk): string {
  return typeof message.content === 'string' ? message.content : '';
}

function getToolCalls(message: AIMessageChunk): ToolCall[] {
  return Array.isArray(message.tool_calls) ? message.tool_calls : [];
}

function createAssistantMessage(message: AIMessageChunk): AIMessage {
  return new AIMessage({
    content: getMessageText(message),
    tool_calls: getToolCalls(message),
  });
}

function createToolMessage(call: ToolCall, result: SteelToolResult): ToolMessage {
  return new ToolMessage({
    content: JSON.stringify(result),
    tool_call_id: call.id ?? call.name,
    name: call.name,
  });
}

function toBindableTools(toolDefinitions: readonly LCTool[]): BindToolsInput[] {
  return toolDefinitions.map(
    (definition) =>
      ({
        type: 'function',
        function: {
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
        },
      }) as BindToolsInput,
  );
}

function createNativeSystemMessages({
  instructionPrefix,
  runtimeContextText,
}: {
  instructionPrefix: string;
  runtimeContextText: string;
}): BaseMessage[] {
  return [new SystemMessage(instructionPrefix), new SystemMessage(runtimeContextText)];
}

function createOcrHumanMessage(prompt: string, file: SteelOAuthChatFile): HumanMessage {
  return new HumanMessage({
    content: [
      {
        type: 'text',
        text: prompt,
      },
      {
        type: 'input_file',
        filename: file.filename,
        file_data: toBase64DataUrl(file),
      },
    ],
  });
}

function createNativeUserTurn({
  content,
  files,
  messageId,
}: {
  content: string;
  files?: readonly SteelNativeFileReference[];
  messageId: string;
}): SteelNativeMessage {
  return {
    role: 'user',
    content,
    messageId,
    ...(files ? { files } : {}),
  };
}

function createNativeAssistantTurn({
  content,
  messageId,
}: {
  content: string;
  messageId: string;
}): SteelNativeMessage {
  return {
    role: 'assistant',
    content,
    messageId,
  };
}

function messageHasProviderFilePart(message: BaseMessage): boolean {
  const content = message.content;
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((part) => {
    if (typeof part !== 'object' || part === null || !('type' in part)) {
      return false;
    }

    return part.type === 'input_file' || part.type === 'file' || part.type === 'image_url';
  });
}

function messagesHaveProviderFilePart(messages: readonly BaseMessage[]): boolean {
  return messages.some(messageHasProviderFilePart);
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
    return (
      headers.has('項次') &&
      headers.has('型號') &&
      headers.has('品名規格') &&
      table.rows.length > 0
    );
  });
}

function summarizeToolResult(result: SteelToolResult) {
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

function summarizeToolCall(call: CapturedNativeToolCall) {
  return {
    nativeToolName: call.nativeToolName,
    toolName: call.toolName,
    arguments: call.arguments,
    providerToolCallId: call.providerToolCallId,
    result: summarizeToolResult(call.result),
  };
}

function summarizeMessages(messages: readonly BaseMessage[]) {
  return messages.map((message) => ({
    type: message._getType(),
    textLength: typeof message.content === 'string' ? message.content.length : undefined,
    hasProviderFilePart: messageHasProviderFilePart(message),
  }));
}

function isRemovedOcrCall(call: CapturedNativeToolCall): boolean {
  return call.toolName === 'run_file_ocr';
}

function isPriceLookupCall(call: CapturedNativeToolCall): boolean {
  return call.toolName === 'search_price_candidates';
}

async function executeNativeToolCall({
  call,
  capturedCalls,
  pool,
  runState,
}: {
  call: ToolCall;
  capturedCalls: CapturedNativeToolCall[];
  pool: ReturnType<typeof createSteelPostgresPool>;
  runState: ReturnType<typeof createSteelToolRunState>;
}): Promise<ToolMessage> {
  const steelToolName = resolveSteelProviderToolName(call.name);
  if (!steelToolName) {
    throw new Error(`Native OAuth PL.pdf live smoke received non-Steel tool: ${call.name}`);
  }

  const providerToolCallId = call.id ?? call.name;
  const result = await executeSteelTool({
    client: pool,
    toolName: steelToolName,
    arguments: call.args,
    providerToolCallId,
    runState,
    outputSheetMemoryReader: {
      readOutputSheetMemory: async () => createEmptySteelOutputSheetMemorySnapshot(),
    },
  });

  capturedCalls.push({
    nativeToolName: call.name,
    toolName: steelToolName,
    arguments: call.args,
    providerToolCallId,
    result,
  });

  return createToolMessage(call, result);
}

async function runNativeToolLoop({
  initialMessages,
  maxToolRounds,
  model,
  pool,
}: {
  initialMessages: BaseMessage[];
  maxToolRounds: number;
  model: ReturnType<typeof createOpenAIOAuthModel>;
  pool: ReturnType<typeof createSteelPostgresPool>;
}): Promise<NativeTurnResult> {
  const messages = [...initialMessages];
  const capturedCalls: CapturedNativeToolCall[] = [];
  const runState = createSteelToolRunState(maxToolRounds * 4);

  for (let round = 0; round <= maxToolRounds; round += 1) {
    const response = await model.invoke(messages);
    const toolCalls = getToolCalls(response);

    if (toolCalls.length === 0) {
      messages.push(new AIMessage(getMessageText(response)));
      return {
        text: getMessageText(response),
        messages,
        capturedCalls,
        roundCount: round + 1,
      };
    }

    if (round >= maxToolRounds) {
      throw new Error('Native OAuth PL.pdf live smoke exceeded tool round limit.');
    }

    messages.push(createAssistantMessage(response));
    for (const call of toolCalls) {
      messages.push(
        await executeNativeToolCall({
          call,
          capturedCalls,
          pool,
          runState,
        }),
      );
    }
  }

  throw new Error('Native OAuth PL.pdf live smoke loop exited unexpectedly.');
}

describeNativePLQuoteLive('OpenAI OAuth PL.pdf quote live smoke', () => {
  it(
    'returns OCR confirmation first, then quotes from confirmed OCR evidence',
    async () => {
      const pool = createSteelPostgresPool();
      const config = parseOpenAIConfig(process.env);
      const authFilePath = resolveOpenAIOAuthAuthFilePath(process.env);
      const conversationId = 'steel_native_live_pl_pdf_ocr_confirm';
      const plFile = await loadPLFile();
      const plFileReference = createPLFileReference(conversationId);
      const ocrPrompt = createPLOcrUserPrompt();
      const quotePrompt = createPLConfirmedQuoteUserPrompt();
      const ocrUserTurn = createNativeUserTurn({
        content: ocrPrompt,
        files: [plFileReference],
        messageId: 'manual-live-user-ocr',
      });
      const quoteUserTurn = createNativeUserTurn({
        content: quotePrompt,
        messageId: 'manual-live-user-quote',
      });

      try {
        const ocrContext = await buildSteelGlobalAgentContext({
          conversation: {
            conversationId,
            requestId: `steel_native_pl_pdf_ocr_${Date.now()}`,
            activeHistory: [],
            currentUserTurn: ocrUserTurn,
          },
          attachments: {
            currentTurnFiles: [plFileReference],
          },
          dependencies: createSteelContextDependencies({
            runtimeRulesClient: pool,
          }),
        });
        const ocrTools = mergeSteelToolDefinitions({
          runtimeContext: ocrContext.runtimeContext,
        });
        const ocrModel = createOpenAIOAuthModel({
          authFilePath,
          maxOutputTokens,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
        }).bindTools(toBindableTools(ocrTools.toolDefinitions));
        const ocrInitialMessages = [
          ...createNativeSystemMessages(ocrContext),
          createOcrHumanMessage(ocrPrompt, plFile),
        ];
        const ocrResult = await runNativeToolLoop({
          initialMessages: ocrInitialMessages,
          maxToolRounds: 8,
          model: ocrModel,
          pool,
        });
        const quoteContext = await buildSteelGlobalAgentContext({
          conversation: {
            conversationId,
            requestId: `steel_native_pl_pdf_quote_${Date.now()}`,
            activeHistory: [
              ocrUserTurn,
              createNativeAssistantTurn({
                content: ocrResult.text,
                messageId: 'manual-live-assistant-ocr',
              }),
            ],
            currentUserTurn: quoteUserTurn,
          },
          dependencies: createSteelContextDependencies({
            runtimeRulesClient: pool,
          }),
        });
        const quoteTools = mergeSteelToolDefinitions({
          runtimeContext: quoteContext.runtimeContext,
        });
        const quoteModel = createOpenAIOAuthModel({
          authFilePath,
          maxOutputTokens,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
        }).bindTools(toBindableTools(quoteTools.toolDefinitions));
        const quoteInitialMessages = [
          ...createNativeSystemMessages(quoteContext),
          new HumanMessage(ocrPrompt),
          new AIMessage(ocrResult.text),
          new HumanMessage(quotePrompt),
        ];
        const quoteResult = await runNativeToolLoop({
          initialMessages: quoteInitialMessages,
          maxToolRounds: 8,
          model: quoteModel,
          pool,
        });
        const evidence = {
          fixture: {
            path: 'docs/reference/example/PL.pdf',
          },
          model: config.model,
          userPrompts: {
            ocr: ocrPrompt,
            quote: quotePrompt,
          },
          ocrContext: {
            instructionPrefixLength: ocrContext.instructionPrefix.length,
            runtimeContextTextLength: ocrContext.runtimeContextText.length,
            attachmentReferenceCount: ocrContext.attachmentReferences.length,
            aiVisibleTools: ocrContext.runtimeContext.toolPolicy.aiVisibleTools,
          },
          quoteContext: {
            instructionPrefixLength: quoteContext.instructionPrefix.length,
            runtimeContextTextLength: quoteContext.runtimeContextText.length,
            attachmentReferenceCount: quoteContext.attachmentReferences.length,
            aiVisibleTools: quoteContext.runtimeContext.toolPolicy.aiVisibleTools,
          },
          ocrMessages: summarizeMessages(ocrInitialMessages),
          quoteMessages: summarizeMessages(quoteInitialMessages),
          ocrCapturedToolCalls: ocrResult.capturedCalls.map(summarizeToolCall),
          quoteCapturedToolCalls: quoteResult.capturedCalls.map(summarizeToolCall),
          ocrRoundCount: ocrResult.roundCount,
          quoteRoundCount: quoteResult.roundCount,
          ocrResponseTextPreview: ocrResult.text.slice(0, 1200),
          ocrResponseText: ocrResult.text,
          quoteResponseTextLength: quoteResult.text.length,
          quoteResponseTextPreview: quoteResult.text.slice(0, 1200),
          quoteResponseText: quoteResult.text,
          evidenceOutputPath,
        };

        await writeEvidence(evidence);

        assertWithEvidence(
          config.model === 'gpt-5.5',
          'Native PL.pdf live smoke did not use gpt-5.5.',
          evidence,
        );
        assertWithEvidence(
          !hasEmbeddedRuleInstruction(ocrPrompt) && !hasEmbeddedRuleInstruction(quotePrompt),
          'Native PL.pdf live smoke user prompts embedded rule/tool instructions.',
          evidence,
        );
        assertWithEvidence(
          messagesHaveProviderFilePart(ocrInitialMessages),
          'Native PL.pdf first turn did not send the provider PDF file part.',
          evidence,
        );
        assertWithEvidence(
          !messagesHaveProviderFilePart(quoteInitialMessages),
          'Native PL.pdf confirmed quote turn re-uploaded a provider file part.',
          evidence,
        );
        assertWithEvidence(
          !ocrResult.capturedCalls.some(isRemovedOcrCall),
          'Native PL.pdf first turn called removed run_file_ocr.',
          evidence,
        );
        assertWithEvidence(
          !ocrResult.capturedCalls.some(isPriceLookupCall),
          'Native PL.pdf first OCR turn called price lookup before confirmation.',
          evidence,
        );
        assertWithEvidence(
          hasOcrConfirmationTable(ocrResult.text),
          'Native PL.pdf first turn did not return an OCR confirmation table.',
          evidence,
        );
        assertWithEvidence(
          !quoteResult.capturedCalls.some(isRemovedOcrCall),
          'Native PL.pdf confirmed quote turn called removed run_file_ocr.',
          evidence,
        );
        assertWithEvidence(
          quoteResult.capturedCalls.some(isPriceLookupCall),
          'Native PL.pdf confirmed quote turn did not call price lookup.',
          evidence,
        );
        assertWithEvidence(
          hasQuoteTable(quoteResult.text),
          'Native PL.pdf confirmed quote turn did not return a quote table.',
          evidence,
        );
        expect(hasSecretMarker(evidence)).toBe(false);
      } catch (error) {
        const failureEvidence = {
          fixture: {
            path: 'docs/reference/example/PL.pdf',
          },
          phase: 'native_openai_oauth_pl_pdf_live_smoke',
          errorSummary: getErrorSummary(error),
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
