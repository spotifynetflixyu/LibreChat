import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import type {
  JSONValue,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3ToolCall,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ToolChoice,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { SteelOpenAIReasoningEffort } from './config';
import {
  patchFileAnalysisDataToolInputSchema,
  steelProviderWorkbookPatchProposalSchema,
  type SteelProviderFileAnalysisPatchProposal,
  type SteelProviderWorkbookPatchProposal,
  type SteelWorkbookSheetId,
} from 'librechat-data-provider';
import { createSteelPostgresPool } from '../postgres';
import { searchSteelAgentRules, type SteelAgentRule } from '../repositories';
import {
  createSteelToolRunState,
  executeSteelTool,
  type SteelToolRunState,
} from '../tools/execute';
import { getSteelToolDefinitions, isSteelToolName } from '../tools/registry';
import type { SteelToolResult } from '../tools/results';
import {
  steelToolArgsSchemas,
  type RunFileOcrInput,
  type RunVisualInspectionInput,
  type SteelBusinessToolName,
} from '../tools/schemas';
import { getSteelPdfPageCount, prepareSteelImagePage, runSteelFileOcr } from '../vision/ocr';
import {
  buildSemanticWorkbookPatchOperations,
  steelSemanticWorkbookPatchSchema,
  type SteelSemanticWorkbookPatch,
} from '../workbook/semantic';
import {
  getFirstWorkbookSubtotalMismatch,
  type WorkbookSubtotalMismatch,
} from '../workbook/subtotals';
import type { SteelRepositoryClient } from '../repositories';
import type { SteelFileOcrSourceFile, SteelFileOcrOptions } from '../vision/ocr';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('openai-oauth-provider')>;

type CreateOpenAIOAuth = typeof createOpenAIOAuthType;
type SteelBusinessToolCall = LanguageModelV3ToolCall & { toolName: SteelBusinessToolName };
type SearchPriceCandidatesInput = ReturnType<
  typeof steelToolArgsSchemas.search_price_candidates.parse
>;
type SearchPriceCandidateQuery =
  NonNullable<SearchPriceCandidatesInput['candidateQueries']>[number];
type FileOcrToolCall = LanguageModelV3ToolCall & { toolName: 'run_file_ocr' };
type VisualInspectionToolCall = LanguageModelV3ToolCall & { toolName: 'run_visual_inspection' };
type SemanticWorkbookPatchToolCall = LanguageModelV3ToolCall & {
  toolName: 'patch_quote_workbook';
};
type WorkbookPatchToolCall = SemanticWorkbookPatchToolCall;
type FileAnalysisPatchToolCall = LanguageModelV3ToolCall & {
  toolName: 'patch_file_analysis_data';
};
type SteelRoundTool = LanguageModelV3FunctionTool;
type WorkbookPatchOperation = SteelProviderWorkbookPatchProposal['operations'][number];
type WorkbookPatchMissingCell = {
  sheetId: SteelWorkbookSheetId;
  columnKey: string;
};
type WorkbookPatchCompletion = {
  required: boolean;
  missingSheetIds: readonly SteelWorkbookSheetId[];
  missingCells: readonly WorkbookPatchMissingCell[];
};
type SteelProviderRoundTiming = {
  round: number;
  generationDurationMs: number;
  toolDurationMs: number;
  workbookCompletionDurationMs: number;
  promptMessageCount: number;
  generatedToolCallCount: number;
  workbookPatchOperationCount: number;
  workbookCompletionRequired: boolean;
  workbookCompletionComplete?: boolean;
  missingWorkbookSheetCount: number;
  missingWorkbookCellCount: number;
};
type SteelProviderTimings = {
  totalDurationMs: number;
  generationDurationMs: number;
  toolDurationMs: number;
  workbookCompletionDurationMs: number;
  roundCount: number;
  rounds: SteelProviderRoundTiming[];
};
const workbookPatchCompletionSheetIds = [
  'system_order',
  'manual_review',
  'customer_quote',
] as const satisfies readonly SteelWorkbookSheetId[];
type WorkbookPatchCompletionSheetId = (typeof workbookPatchCompletionSheetIds)[number];
const workbookPatchCompletionColumnKeysBySheet = {
  system_order: ['model_code', 'item_spec'],
  manual_review: ['confirmation_needed'],
  customer_quote: ['item_spec', 'subtotal'],
} satisfies Record<WorkbookPatchCompletionSheetId, readonly string[]>;

const catalogFamilyPriceLookupInstruction =
  'When calling search_price_candidates, batch related product-name text, specification fragments, and ERP code prefixes into one search_price_candidates call using productNames, erpItemCodes, or candidateQueries; do not call the tool once per keyword, material alternative, or line when they can be represented together. Use productNames for Chinese names, material/surface words, oral product names, formal product-name text, and specification fragments such as 75*2.3, 3/8, 1.2*4\'*8\'(28.5), or 150*75*5/7*6M(84). For PL plate specs such as PL6*80 or PL16*96, derive OT black-iron laser-cut productNames such as 6.0m/mOT板雷射切割 or 16.0m/mOT板雷射切割; do not use square-cut plate productNames. Use erpItemCodes only for exact ERP item codes or code prefixes, which are normally made of English letters and digits, such as CCG, CCG07523, BNG, or DNB70. Do not put Chinese names or size/spec text in erpItemCodes, and do not put ERP codes in productNames. Do not pass the raw full user text as a candidate, and mark the result as provisional/low confidence when appropriate. For multiple inferred candidates, use productNames/erpItemCodes directly or candidateQueries when each candidate needs its own confidence/reason. Domain-specific code prefixes and material defaults belong to lookup_quote_rules / Steel material rules; use those reviewed rules before applying a prefix family.';

const defaultCustomerTierId = 2;
const defaultCustomerTierCode = 'B';

export interface SteelProviderExecuteToolCallOptions {
  toolName: string;
  arguments: unknown;
  providerToolCallId: string;
  runState: SteelToolRunState;
}

export type SteelProviderToolExecutor = (
  options: SteelProviderExecuteToolCallOptions,
) => Promise<SteelToolResult>;

export type SteelProviderFileOcrExecutor = (
  options: SteelFileOcrOptions,
) => Promise<SteelToolResult>;

export interface SteelProviderVisualInspectionOptions {
  arguments: RunVisualInspectionInput;
  files: readonly SteelFileOcrSourceFile[];
  providerToolCallId: string;
}

export type SteelProviderVisualInspectionExecutor = (
  options: SteelProviderVisualInspectionOptions,
) => Promise<SteelToolResult>;

export type SteelProviderToolStatusCallback = (event: {
  toolName: string;
  status: 'started' | 'completed' | 'failed';
  message?: string;
  result?: SteelToolResult;
  errorSummary?: string;
  fileAnalysisPatch?: SteelProviderFileAnalysisPatchProposal;
}) => void | Promise<void>;

export type SteelOAuthChatMessageRole = 'system' | 'user' | 'assistant';

export interface SteelOAuthChatFile {
  filename?: string;
  mediaType: string;
  data: Uint8Array | string | URL;
  pageCount?: number;
}

export interface SteelOAuthChatMessage {
  role: SteelOAuthChatMessageRole;
  content: string;
  files?: SteelOAuthChatFile[];
}

export interface SteelProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface SteelProviderChatResponse {
  provider: 'openai_oauth_responses';
  model: string;
  text: string;
  responseId?: string;
  usage?: SteelProviderUsage;
  timings?: SteelProviderTimings;
  unsupportedSettings: string[];
  warnings: string[];
  workbookPatch?: SteelProviderWorkbookPatchProposal;
  fileAnalysisPatch?: SteelProviderFileAnalysisPatchProposal;
}

export interface SendSteelOAuthChatOptions {
  abortSignal?: AbortSignal;
  authFilePath?: string;
  createOpenAIOAuth?: CreateOpenAIOAuth;
  ensureFresh?: boolean;
  executeFileOcr?: SteelProviderFileOcrExecutor;
  executeVisualInspection?: SteelProviderVisualInspectionExecutor;
  executeSteelToolCall?: SteelProviderToolExecutor;
  fetch?: FetchFunction;
  maxOutputTokens?: number;
  messages: SteelOAuthChatMessage[];
  model: string;
  onReasoningSummary?: (summary: string) => void;
  onToolStatus?: SteelProviderToolStatusCallback;
  passThroughUnsupportedFiles?: boolean;
  reasoningEffort: SteelOpenAIReasoningEffort;
  steelToolMaxCalls?: number;
  steelRuntimePolicy?: boolean;
  agentRulesClient?: SteelRepositoryClient;
  workbookContextText?: string;
  workbookPatchTool?: boolean;
}

async function loadCreateOpenAIOAuth(): Promise<typeof createOpenAIOAuthType> {
  const provider = await dynamicImport('openai-oauth-provider');
  return provider.createOpenAIOAuth;
}

let defaultSteelToolClient: ReturnType<typeof createSteelPostgresPool> | undefined;
let steelBusinessFunctionTools: LanguageModelV3FunctionTool[] | undefined;

function getDefaultSteelToolClient() {
  defaultSteelToolClient ??= createSteelPostgresPool();
  return defaultSteelToolClient;
}

async function executeDefaultSteelToolCall({
  toolName,
  arguments: args,
  providerToolCallId,
  runState,
}: SteelProviderExecuteToolCallOptions): Promise<SteelToolResult> {
  return executeSteelTool({
    client: getDefaultSteelToolClient(),
    toolName,
    arguments: args,
    providerToolCallId,
    runState,
  });
}

async function executeDefaultFileOcr(options: SteelFileOcrOptions): Promise<SteelToolResult> {
  return runSteelFileOcr(options);
}

async function runOpenAIOAuthVisualInspection({
  arguments: args,
  files,
  model,
  openai,
  providerToolCallId: _providerToolCallId,
  visualInspectionInstruction,
}: SteelProviderVisualInspectionOptions & {
  model: string;
  openai: ReturnType<CreateOpenAIOAuth>;
  visualInspectionInstruction: string;
}): Promise<SteelToolResult> {
  const startTime = Date.now();
  let tempDir: string | undefined;

  try {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'steel-visual-inspection-'));
    const image = await prepareSteelImagePage({
      files,
      input: args,
      outputDir: tempDir,
    });
    const inspectionPrompt = [
      visualInspectionInstruction,
      `inspection_types=${args.inspection_types.join(', ')}`,
      `user_prompt=${args.prompt}`,
      `source filename=${image.filename}; page=${image.page ?? ''}; imageIndex=${image.imageIndex ?? ''}; dpi=${image.dpi ?? ''}`,
    ].join('\n\n');
    const result = await openai(model).doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: inspectionPrompt },
            {
              type: 'file',
              filename: `${image.filename}${image.page ? `.page-${image.page}` : ''}.png`,
              mediaType: 'image/png',
              data: Buffer.from(image.data).toString('base64'),
              providerOptions: {
                openai: {
                  imageDetail: 'high',
                },
              },
            },
          ],
        },
      ],
      providerOptions: {
        openai: {
          reasoningEffort: 'medium',
        },
      },
    });

    return {
      ok: true,
      toolName: 'run_visual_inspection',
      data: {
        filename: image.filename,
        mediaType: image.mediaType,
        page: image.page ?? null,
        imageIndex: image.imageIndex ?? null,
        dpi: image.dpi ?? null,
        width: image.width ?? null,
        height: image.height ?? null,
        inspectionEngine: 'OpenAI OAuth vision',
        inspectionTypes: args.inspection_types,
        text: getGeneratedText(result),
      },
      sourceRefs: [],
      durationMs: Math.max(0, Date.now() - startTime),
      redactionVersion: 1,
    };
  } catch (error) {
    return createProviderToolErrorResult('run_visual_inspection', startTime, error);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function getSteelBusinessFunctionTools(): LanguageModelV3FunctionTool[] {
  steelBusinessFunctionTools ??= getSteelToolDefinitions().map((definition) => ({
    type: 'function',
    name: definition.name,
    description: definition.description,
    inputSchema: zodToJsonSchema(definition.argsSchema, {
      $refStrategy: 'none',
    }) as LanguageModelV3FunctionTool['inputSchema'],
  }));

  return steelBusinessFunctionTools;
}

function isVisualEvidenceFile(file: SteelOAuthChatFile): boolean {
  return getFileSourceKinds(file).length > 0;
}

function getRunFileOcrInventoryText(
  files: readonly SteelOAuthChatFile[],
  fileIndexOffset: number,
): string | undefined {
  const entries = files
    .map((file, index) => {
      if (!isVisualEvidenceFile(file)) {
        return undefined;
      }

      const pageCountText =
        isPdfMediaType(file.mediaType) && file.pageCount !== undefined
          ? `; pageCount=${file.pageCount}; pages=1-${file.pageCount}`
          : '';

      return `- fileIndex=${fileIndexOffset + index}; filename=${file.filename ?? '(unnamed)'}; mediaType=${file.mediaType}${pageCountText}`;
    })
    .filter((entry): entry is string => entry !== undefined);

  return entries.length > 0
    ? `run_file_ocr files available for server-side OCR:\n${entries.join('\n')}`
    : undefined;
}

function toLanguageModelMessage(
  message: SteelOAuthChatMessage,
  {
    omitVisualEvidenceFileParts = false,
    ocrAvailableVisualEvidenceFiles,
    visualFileIndexOffset = 0,
  }: {
    omitVisualEvidenceFileParts?: boolean;
    ocrAvailableVisualEvidenceFiles?: ReadonlySet<SteelOAuthChatFile>;
    visualFileIndexOffset?: number;
  } = {},
): LanguageModelV3Message {
  if (message.role === 'system') {
    return {
      role: 'system',
      content: message.content,
    };
  }

  const files = message.files ?? [];
  const ocrInventoryFiles =
    ocrAvailableVisualEvidenceFiles === undefined
      ? files
      : files.filter((file) => ocrAvailableVisualEvidenceFiles.has(file));
  const inventoryText = omitVisualEvidenceFileParts
    ? getRunFileOcrInventoryText(ocrInventoryFiles, visualFileIndexOffset)
    : undefined;

  return {
    role: message.role,
    content: [
      {
        type: 'text',
        text: inventoryText ? `${message.content}\n\n${inventoryText}` : message.content,
      },
      ...files
        .filter((file) => !omitVisualEvidenceFileParts || !isVisualEvidenceFile(file))
        .map((file) => {
          const mediaType = file.mediaType.trim().toLowerCase();

          return {
            type: 'file' as const,
            filename: file.filename,
            mediaType: file.mediaType,
            data: file.data,
            ...(mediaType.startsWith('image/')
              ? {
                  providerOptions: {
                    openai: {
                      imageDetail: 'high',
                    },
                  },
                }
              : {}),
          };
        }),
    ],
  };
}

function toPrompt(
  messages: SteelOAuthChatMessage[],
  {
    omitVisualEvidenceFileParts = false,
    ocrAvailableVisualEvidenceFiles,
  }: {
    omitVisualEvidenceFileParts?: boolean;
    ocrAvailableVisualEvidenceFiles?: readonly SteelOAuthChatFile[];
  } = {},
): LanguageModelV3Prompt {
  let visualFileIndexOffset = 0;
  const ocrAvailableVisualEvidenceFileSet =
    ocrAvailableVisualEvidenceFiles !== undefined
      ? new Set(ocrAvailableVisualEvidenceFiles)
      : undefined;

  return messages.map((message) => {
    const promptMessage = toLanguageModelMessage(message, {
      omitVisualEvidenceFileParts,
      ocrAvailableVisualEvidenceFiles: ocrAvailableVisualEvidenceFileSet,
      visualFileIndexOffset,
    });
    visualFileIndexOffset += (message.files ?? []).filter((file) => {
      return (
        isVisualEvidenceFile(file) &&
        (ocrAvailableVisualEvidenceFileSet === undefined ||
          ocrAvailableVisualEvidenceFileSet.has(file))
      );
    }).length;

    return promptMessage;
  });
}

const steelAgentRuleSections = [
  'agent_instruction',
  'tool_flow',
  'inference_order',
  'confirmation_policy',
] as const;
const steelWorkbookRuleTypes = ['workbook_output_rule'] as const;
const steelOcrRuleSections = ['file_ocr', 'drawing_ocr', 'vision_evidence'] as const;
const steelOcrRuleTypes = ['inference_order_rule', 'tool_flow_rule', 'output_policy_rule'] as const;
const steelVisualInspectionRuleSections = [
  'visual_inspection',
  'drawing_vision',
  'tool_flow',
] as const;
const steelVisualInspectionRuleTypes = ['tool_flow_rule', 'output_policy_rule'] as const;

type VisualEvidenceSourceKind = 'image' | 'pdf' | 'scanned_pdf';

function getFileSourceKinds(file: SteelOAuthChatFile): VisualEvidenceSourceKind[] {
  const mediaType = file.mediaType.trim().toLowerCase();

  if (mediaType.startsWith('image/')) {
    return ['image'];
  }

  if (mediaType === 'application/pdf') {
    return ['pdf', 'scanned_pdf'];
  }

  return [];
}

function getVisualEvidenceSourceKindsFromFiles(files: readonly SteelOAuthChatFile[]) {
  const sourceKinds = new Set<VisualEvidenceSourceKind>();

  for (const file of files) {
    for (const sourceKind of getFileSourceKinds(file)) {
      sourceKinds.add(sourceKind);
    }
  }

  return [...sourceKinds];
}

function getLatestUserMessage(
  messages: readonly SteelOAuthChatMessage[],
): SteelOAuthChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message;
    }
  }

  return undefined;
}

function getVisualEvidenceFilesFromMessage(
  message?: SteelOAuthChatMessage,
): SteelFileOcrSourceFile[] {
  return (message?.files ?? []).filter(isVisualEvidenceFile);
}

function getVisualEvidenceFiles(
  messages: readonly SteelOAuthChatMessage[],
): SteelFileOcrSourceFile[] {
  const files: SteelFileOcrSourceFile[] = [];

  for (const message of messages) {
    for (const file of message.files ?? []) {
      if (getFileSourceKinds(file).length === 0) {
        continue;
      }

      files.push(file);
    }
  }

  return files;
}

function hasSavedFileAnalysisContext(messages: readonly SteelOAuthChatMessage[]): boolean {
  return messages.some((message) => {
    return (
      message.role === 'system' &&
      message.content.includes('Latest saved file_analysis_data workspace')
    );
  });
}

function latestUserRequestsFileOcr(messages: readonly SteelOAuthChatMessage[]): boolean {
  const latestUserMessage = getLatestUserMessage(messages);
  const text = latestUserMessage?.content.trim() ?? '';
  if (!text) {
    return false;
  }

  return (
    /\b(?:go|continue|resume)\b/i.test(text) ||
    /^(繼續|接續)$/.test(text) ||
    /\bocr\b/i.test(text) ||
    /(?:重新|重跑|重做|再跑)\s*(?:OCR|ocr|讀取|判讀|分析|辨識|掃描)/.test(text) ||
    /(?:重讀|重看|重掃|重辨識)/.test(text) ||
    /(?:re[-\s]?ocr|re[-\s]?read|re[-\s]?analy[sz]e|rerun)/i.test(text) ||
    /繼續\s*(?:OCR|ocr|讀取檔案|處理.*(?:PDF|pdf|附件|頁))/.test(text)
  );
}

async function getMessagesWithPdfPageCounts(
  messages: readonly SteelOAuthChatMessage[],
): Promise<SteelOAuthChatMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      const files = message.files;
      if (!files) {
        return message;
      }

      const filesWithPageCounts = await Promise.all(
        files.map(async (file) => {
          if (!isPdfMediaType(file.mediaType) || file.pageCount !== undefined) {
            return file;
          }

          try {
            return {
              ...file,
              pageCount: await getSteelPdfPageCount(file),
            };
          } catch {
            return file;
          }
        }),
      );

      if (filesWithPageCounts.every((file, index) => file === files[index])) {
        return message;
      }

      return {
        ...message,
        files: filesWithPageCounts,
      };
    }),
  );
}

function readSelectorStrings(rule: SteelAgentRule, key: string): string[] {
  const selectors = rule.selectors;

  if (typeof selectors !== 'object' || selectors === null || Array.isArray(selectors)) {
    return [];
  }

  const value = selectors[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

function matchesOcrSourceKind(rule: SteelAgentRule, sourceKinds: readonly string[]) {
  const selectorSourceKinds = readSelectorStrings(rule, 'sourceKinds');

  if (selectorSourceKinds.length === 0) {
    return true;
  }

  return selectorSourceKinds.some((sourceKind) => sourceKinds.includes(sourceKind));
}

function formatOcrRuleInstruction(rule: SteelAgentRule) {
  const source = rule.sourceRefs[0];
  const provenance = [
    source?.sourceFile ? `sourceFile=${source.sourceFile}` : undefined,
    source?.locator ? `locator=${source.locator}` : undefined,
    source?.canonicalKey ? `canonicalKey=${source.canonicalKey}` : undefined,
    source?.sha256 ? `sha256=${source.sha256}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  return provenance
    ? `${rule.prompt.trim()}\nOCR rule provenance: ${provenance}`
    : rule.prompt.trim();
}

async function getSteelRuntimePolicyInstruction(client: SteelRepositoryClient): Promise<string> {
  const rules = await searchSteelAgentRules(client, {
    ruleSections: steelAgentRuleSections,
    limit: 100,
  });
  const prompts = rules.map((rule) => rule.prompt.trim()).filter(Boolean);

  if (prompts.length === 0) {
    throw new Error('steel.agent_rules did not return reviewed Agent Prompt rules.');
  }

  return prompts.join('\n\n');
}

async function getSteelWorkbookOutputInstruction(
  client: SteelRepositoryClient,
  workbookContextText?: string,
): Promise<string> {
  const rules = await searchSteelAgentRules(client, {
    ruleTypes: steelWorkbookRuleTypes,
    limit: 100,
  });
  const prompts = rules.map((rule) => rule.prompt.trim()).filter(Boolean);

  if (prompts.length === 0) {
    throw new Error('steel.agent_rules did not return reviewed workbook output rules.');
  }

  const instruction = prompts.join('\n\n');

  return workbookContextText
    ? `${instruction}\n\nWorkbook structure context:\n${workbookContextText}`
    : instruction;
}

async function getSteelOcrInstruction(
  client: SteelRepositoryClient,
  sourceKinds: readonly VisualEvidenceSourceKind[],
): Promise<string> {
  const rules = await searchSteelAgentRules(client, {
    ruleTypes: steelOcrRuleTypes,
    ruleSections: steelOcrRuleSections,
    limit: 100,
  });
  const prompts = rules
    .filter((rule) => matchesOcrSourceKind(rule, sourceKinds))
    .map(formatOcrRuleInstruction)
    .filter(Boolean);

  if (prompts.length === 0) {
    throw new Error('steel.agent_rules did not return reviewed OCR rules.');
  }

  return prompts.join('\n\n');
}

async function getSteelVisualInspectionInstruction(
  client: SteelRepositoryClient,
  sourceKinds: readonly VisualEvidenceSourceKind[],
): Promise<string> {
  const rules = await searchSteelAgentRules(client, {
    ruleTypes: steelVisualInspectionRuleTypes,
    ruleSections: steelVisualInspectionRuleSections,
    limit: 100,
  });
  const prompts = rules
    .filter((rule) => matchesOcrSourceKind(rule, sourceKinds))
    .map(formatOcrRuleInstruction)
    .filter(Boolean);

  if (prompts.length === 0) {
    throw new Error('steel.agent_rules did not return reviewed visual inspection rules.');
  }

  return prompts.join('\n\n');
}

function toPromptWithSystemInstruction(
  messages: SteelOAuthChatMessage[],
  systemInstruction: string,
  {
    omitVisualEvidenceFileParts = false,
    ocrAvailableVisualEvidenceFiles,
  }: {
    omitVisualEvidenceFileParts?: boolean;
    ocrAvailableVisualEvidenceFiles?: readonly SteelOAuthChatFile[];
  } = {},
): LanguageModelV3Prompt {
  return [
    {
      role: 'system',
      content: systemInstruction,
    },
    ...toPrompt(messages, { omitVisualEvidenceFileParts, ocrAvailableVisualEvidenceFiles }),
  ];
}

async function getSystemInstruction({
  agentRulesClient,
  steelRuntimePolicy,
  workbookContextText,
  workbookPatchTool,
  ocrSourceKinds,
}: {
  agentRulesClient?: SteelRepositoryClient;
  steelRuntimePolicy?: boolean;
  workbookContextText?: string;
  workbookPatchTool?: boolean;
  ocrSourceKinds?: readonly VisualEvidenceSourceKind[];
}): Promise<string | undefined> {
  const hasOcrRules = (ocrSourceKinds?.length ?? 0) > 0;

  if ((steelRuntimePolicy || workbookPatchTool || hasOcrRules) && !agentRulesClient) {
    throw new Error('steel.agent_rules client is required for Steel runtime rules.');
  }

  const instructions = [
    ...(steelRuntimePolicy && agentRulesClient
      ? [await getSteelRuntimePolicyInstruction(agentRulesClient)]
      : []),
    ...(hasOcrRules && agentRulesClient
      ? [await getSteelOcrInstruction(agentRulesClient, ocrSourceKinds ?? [])]
      : []),
    ...(hasOcrRules && agentRulesClient
      ? [await getSteelVisualInspectionInstruction(agentRulesClient, ocrSourceKinds ?? [])]
      : []),
    ...(workbookPatchTool && agentRulesClient
      ? [await getSteelWorkbookOutputInstruction(agentRulesClient, workbookContextText)]
      : []),
  ];

  return instructions.length > 0 ? instructions.join('\n\n') : undefined;
}

const semanticWorkbookPatchFunctionTool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'patch_quote_workbook',
  description:
    'Propose a compact semantic Steel quote workbook update. Use this for quote/order results; backend projects the semantic quote data into validated workbook cell updates across all relevant sheets. To remove existing workbook rows, send explicit deleteRows with sheetId and rowIds; omitting quoteLines never deletes rows.',
  inputSchema: zodToJsonSchema(steelSemanticWorkbookPatchSchema, {
    $refStrategy: 'none',
  }) as LanguageModelV3FunctionTool['inputSchema'],
};

const fileAnalysisPatchFunctionTool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'patch_file_analysis_data',
  description:
    'Patch the single conversation-scoped Steel file_analysis_data workspace for unconfirmed PDF/image/drawing interpretation. Process one page/image at a time, patch after each PaddleOCR MCP result, include sourceKey/page/imageIndex/ocrEngine/ocrStatus refs for rows, and reuse row ids or sourceKey when reprocessing. Do not use this for confirmed quote workbook rows.',
  inputSchema: zodToJsonSchema(patchFileAnalysisDataToolInputSchema, {
    $refStrategy: 'none',
  }) as LanguageModelV3FunctionTool['inputSchema'],
};

const fileOcrFunctionTool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'run_file_ocr',
  description:
    'Run the configured Steel OCR engine on exactly one uploaded image or one PDF page. Use this before interpreting uploaded PDF/image/table/drawing content and before patch_file_analysis_data. For multi-page PDFs, call once per page with high DPI.',
  inputSchema: zodToJsonSchema(steelToolArgsSchemas.run_file_ocr, {
    $refStrategy: 'none',
  }) as LanguageModelV3FunctionTool['inputSchema'],
};

const visualInspectionFunctionTool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'run_visual_inspection',
  description:
    'Run visual-only inspection on exactly one uploaded image or rendered PDF page after OCR has been patched, only when OCR/table/user data is missing a required geometric value for review or pricing. Use this to fill missing holes, slots, continuous slotted-edge length, bends, cut corners, notches, or geometry consistency. Do not call it when OCR/table data already provides the needed value, and do not use it to OCR text or tables.',
  inputSchema: zodToJsonSchema(steelToolArgsSchemas.run_visual_inspection, {
    $refStrategy: 'none',
  }) as LanguageModelV3FunctionTool['inputSchema'],
};

function getGeneratedText(result: LanguageModelV3GenerateResult): string {
  return result.content.reduce((text, part) => {
    if (part.type !== 'text') {
      return text;
    }

    return `${text}${part.text}`;
  }, '');
}

function requiresReviewedPriceLookup(messages: SteelOAuthChatMessage[]): boolean {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  if (!latestUserMessage) {
    return false;
  }

  return /一支多少|多少錢|報價|價格|單價|price/i.test(latestUserMessage.content);
}

function isSteelBusinessToolCall(part: LanguageModelV3GenerateResult['content'][number]) {
  return part.type === 'tool-call' && isSteelToolName(part.toolName);
}

function getSteelBusinessToolCalls(result: LanguageModelV3GenerateResult): SteelBusinessToolCall[] {
  return result.content.filter(isSteelBusinessToolCall) as SteelBusinessToolCall[];
}

function parseToolCallInput(call: LanguageModelV3ToolCall): unknown {
  return JSON.parse(call.input);
}

function createInvalidToolInputResult(call: LanguageModelV3ToolCall): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'invalid_arguments',
    errorSummary: 'Steel tool input must be valid JSON.',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function createInstructionLookupRequiredResult(call: LanguageModelV3ToolCall): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'invalid_arguments',
    errorSummary:
      'lookup_quote_rules is required before category-dependent Steel lookups. When AI has selected a catalog/category key from oral order evidence, first call lookup_quote_rules with the interpreted order context, then call search_price_candidates.',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function createToolExecutionErrorResult(
  call: LanguageModelV3ToolCall,
  error: unknown,
): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'repository_error',
    errorSummary: error instanceof Error ? error.message : 'Steel tool execution failed.',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function createProviderToolErrorResult(
  toolName: string,
  startTime: number,
  error: unknown,
): SteelToolResult {
  return {
    ok: false,
    toolName,
    errorCategory: 'repository_error',
    errorSummary: error instanceof Error ? error.message : `${toolName} execution failed.`,
    durationMs: Math.max(0, Date.now() - startTime),
    redactionVersion: 1,
  };
}

function isFatalSteelToolResult(result: SteelToolResult): boolean {
  return !result.ok && ['rate_limited', 'repository_error'].includes(result.errorCategory);
}

function getFatalSteelToolErrorMessage(call: SteelBusinessToolCall, result: SteelToolResult) {
  if (result.ok) {
    return '';
  }

  return `Steel tool ${call.toolName} failed: ${result.errorSummary}`;
}

function toJsonValue(value: unknown): JSONValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return null;
  }

  return JSON.parse(serialized) as JSONValue;
}

function hasUnknownCustomerTierContext(input: unknown): boolean {
  if (!isJsonObject(input)) {
    return false;
  }

  const customerContext = input.customerContext;
  return isJsonObject(customerContext) && customerContext.tierKnown === false;
}

function getKnownCustomerTierIdFromContext(input: unknown): number | undefined {
  if (!isJsonObject(input)) {
    return undefined;
  }

  const customerContext = input.customerContext;
  if (!isJsonObject(customerContext) || customerContext.tierKnown !== true) {
    return undefined;
  }

  return typeof customerContext.customerTierId === 'number'
    ? customerContext.customerTierId
    : undefined;
}

function getPreferredCustomerSearchTierId(result: SteelToolResult): number | undefined {
  if (!result.ok || !Array.isArray(result.data.customers)) {
    return undefined;
  }

  const tierIds = new Set<number>();
  let bTierId: number | undefined;
  for (const customer of result.data.customers) {
    if (!isJsonObject(customer) || !isJsonObject(customer.customerTier)) {
      continue;
    }

    const tier = customer.customerTier;
    const tierId = tier.id;
    if (typeof tierId === 'number') {
      tierIds.add(tierId);
    }
    const tierCode = typeof tier.code === 'string' ? tier.code.trim().toUpperCase() : '';
    const tierName = typeof tier.name === 'string' ? tier.name.trim().toUpperCase() : '';
    if (typeof tierId === 'number' && (tierCode === 'B' || tierName === 'B級')) {
      bTierId = tierId;
    }
  }

  if (tierIds.size === 1) {
    return [...tierIds][0];
  }

  return bTierId;
}

function withDefaultCustomerTierFilter({
  forceDefaultCustomerTier,
  input,
  selectedCustomerTierId,
}: {
  forceDefaultCustomerTier: boolean;
  input: unknown;
  selectedCustomerTierId?: number;
}): unknown {
  if (!isJsonObject(input)) {
    return input;
  }

  if (!forceDefaultCustomerTier && typeof input.customerTierId === 'number') {
    return input;
  }

  if (!forceDefaultCustomerTier && selectedCustomerTierId !== undefined) {
    return {
      ...input,
      customerTierId: selectedCustomerTierId,
    };
  }

  return {
    ...input,
    customerTierId: defaultCustomerTierId,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function isSearchPriceCoalesceCompatible(
  left: SearchPriceCandidatesInput,
  right: SearchPriceCandidatesInput,
): boolean {
  return (
    left.customerTierId === right.customerTierId &&
    left.reviewState === right.reviewState &&
    left.includeInactive === right.includeInactive &&
    left.limit === right.limit
  );
}

function toBatchedPriceCandidate(
  input: SearchPriceCandidatesInput,
  index: number,
): SearchPriceCandidateQuery[] {
  const directCandidate =
    input.productNames !== undefined || input.erpItemCodes !== undefined
      ? [
          {
            queryId: `batched_price_query_${index}`,
            productNames: input.productNames,
            erpItemCodes: input.erpItemCodes,
            confidence: 'medium' as const,
            reason: 'Batched from same provider-round search_price_candidates calls.',
          },
        ]
      : [];

  return [...directCandidate, ...(input.candidateQueries ?? [])];
}

function getBatchedSearchOriginalText(inputs: readonly SearchPriceCandidatesInput[]): string {
  const originalTexts = uniqueStrings(
    inputs
      .map((input) => input.originalText)
      .filter((value): value is string => value !== undefined),
  );
  if (originalTexts.length > 0) {
    return originalTexts.join('；');
  }

  const derivedTexts = uniqueStrings(
    inputs.flatMap((input) => [
      ...(input.productNames ?? []),
      ...(input.erpItemCodes ?? []),
    ]).filter((value): value is string => value !== undefined),
  );

  return derivedTexts.length > 0 ? derivedTexts.join('；') : 'batched price candidate search';
}

function createBatchedSearchPriceInput(
  inputs: readonly SearchPriceCandidatesInput[],
): SearchPriceCandidatesInput | undefined {
  if (inputs.length < 2) {
    return undefined;
  }

  const [firstInput] = inputs;
  if (!firstInput) {
    return undefined;
  }

  if (!inputs.every((input) => isSearchPriceCoalesceCompatible(firstInput, input))) {
    return undefined;
  }

  const candidateQueries = inputs.flatMap((input, index) => {
    return toBatchedPriceCandidate(input, index + 1);
  });
  if (candidateQueries.length === 0 || candidateQueries.length > 10) {
    return undefined;
  }

  return steelToolArgsSchemas.search_price_candidates.parse({
    originalText: getBatchedSearchOriginalText(inputs),
    candidateQueries,
    customerTierId: firstInput.customerTierId,
    reviewState: firstInput.reviewState,
    includeInactive: firstInput.includeInactive,
    limit: firstInput.limit,
  });
}

interface ExecutedSteelToolCall {
  call: SteelBusinessToolCall;
  input: unknown;
  result: SteelToolResult;
}

interface ExecutedFileOcrToolCall {
  call: FileOcrToolCall;
  input: RunFileOcrInput;
  result: SteelToolResult;
}

interface ExecutedVisualInspectionToolCall {
  call: VisualInspectionToolCall;
  input: RunVisualInspectionInput;
  result: SteelToolResult;
}

interface ParsedWorkbookPatchToolCall {
  call: WorkbookPatchToolCall;
  input: SteelSemanticWorkbookPatch;
  patchProposal: SteelProviderWorkbookPatchProposal;
  projectedFromSemantic: boolean;
}

interface ParsedFileAnalysisPatchToolCall {
  call: FileAnalysisPatchToolCall;
  input: SteelProviderFileAnalysisPatchProposal;
}

interface FileAnalysisPdfPageProgress {
  fileId: string;
  filename?: string;
  mediaType: string;
  pageCount?: number;
  completedPages: Set<number>;
  failedPages: Set<number>;
  skippedPages: Set<number>;
}

interface PendingFileAnalysisPdfPage {
  fileId: string;
  filename?: string;
  page: number;
  pageCount: number;
}

function isPdfMediaType(mediaType: string): boolean {
  return mediaType.trim().toLowerCase().includes('pdf');
}

function getFileAnalysisOcrStatus(sourceRef: {
  fileId: string;
  ocrStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
}): 'pending' | 'processing' | 'completed' | 'failed' | 'skipped' | undefined {
  return sourceRef.ocrStatus;
}

function getFileAnalysisProgressKey(source: { fileId?: string; filename?: string }) {
  const filename = source.filename?.trim().toLowerCase();
  if (filename) {
    return `filename:${filename}`;
  }

  const fileId = source.fileId?.trim();
  return fileId ? `fileId:${fileId}` : undefined;
}

function getFileAnalysisProgress(
  progressByFileId: Map<string, FileAnalysisPdfPageProgress>,
  source: {
    fileId?: string;
    filename?: string;
    mediaType: string;
    pageCount?: number;
  },
): FileAnalysisPdfPageProgress | undefined {
  const key = getFileAnalysisProgressKey(source);
  if (!key) {
    return undefined;
  }

  const current = progressByFileId.get(key);
  if (current) {
    current.fileId = source.fileId ?? current.fileId;
    current.filename = source.filename ?? current.filename;
    current.mediaType = source.mediaType || current.mediaType;
    current.pageCount = source.pageCount ?? current.pageCount;
    return current;
  }

  const next = {
    fileId: source.fileId ?? source.filename ?? key,
    filename: source.filename,
    mediaType: source.mediaType,
    pageCount: source.pageCount,
    completedPages: new Set<number>(),
    failedPages: new Set<number>(),
    skippedPages: new Set<number>(),
  };
  progressByFileId.set(key, next);
  return next;
}

function trackFileAnalysisPdfPageProgress(
  progressByFileId: Map<string, FileAnalysisPdfPageProgress>,
  parsedCalls: readonly ParsedFileAnalysisPatchToolCall[],
): void {
  for (const parsedCall of parsedCalls) {
    for (const sourceFile of parsedCall.input.sourceFiles) {
      if (isPdfMediaType(sourceFile.mediaType) && sourceFile.pageCount !== undefined) {
        getFileAnalysisProgress(progressByFileId, sourceFile);
      }
    }

    for (const patch of parsedCall.input.patches) {
      for (const row of patch.upsertRows) {
        const sourceRef = row.sourceRef;
        if (!sourceRef?.page || !isPdfMediaType(sourceRef.mediaType)) {
          continue;
        }

        const progress = getFileAnalysisProgress(progressByFileId, sourceRef);
        if (!progress) {
          continue;
        }
        const ocrStatus = getFileAnalysisOcrStatus(sourceRef);
        if (ocrStatus === 'failed') {
          progress.failedPages.add(sourceRef.page);
        } else if (ocrStatus === 'skipped') {
          progress.skippedPages.add(sourceRef.page);
        } else if (ocrStatus === 'completed') {
          progress.completedPages.add(sourceRef.page);
        }
      }
    }
  }
}

function trackVisualEvidencePdfPageProgress(
  progressByFileId: Map<string, FileAnalysisPdfPageProgress>,
  files: readonly SteelFileOcrSourceFile[],
): void {
  for (const file of files) {
    if (!isPdfMediaType(file.mediaType) || file.pageCount === undefined) {
      continue;
    }

    getFileAnalysisProgress(progressByFileId, {
      fileId: file.filename,
      filename: file.filename,
      mediaType: file.mediaType,
      pageCount: file.pageCount,
    });
  }
}

function getPendingFileAnalysisPdfPage(
  progressByFileId: Map<string, FileAnalysisPdfPageProgress>,
): PendingFileAnalysisPdfPage | undefined {
  for (const progress of progressByFileId.values()) {
    if (!isPdfMediaType(progress.mediaType) || !progress.pageCount || progress.pageCount <= 1) {
      continue;
    }

    for (let page = 1; page <= progress.pageCount; page += 1) {
      const pageDone =
        progress.completedPages.has(page) ||
        progress.failedPages.has(page) ||
        progress.skippedPages.has(page);
      if (!pageDone) {
        return {
          fileId: progress.fileId,
          filename: progress.filename,
          page,
          pageCount: progress.pageCount,
        };
      }
    }
  }

  return undefined;
}

function hasTrackedFileAnalysisPdf(
  progressByFileId: Map<string, FileAnalysisPdfPageProgress>,
): boolean {
  for (const progress of progressByFileId.values()) {
    if (isPdfMediaType(progress.mediaType)) {
      return true;
    }
  }

  return false;
}

async function executeSteelBusinessToolCalls({
  calls,
  executeSteelToolCall,
  forceDefaultCustomerTier,
  hasInstructionLookupResult,
  runState,
  selectedCustomerTierId,
}: {
  calls: SteelBusinessToolCall[];
  executeSteelToolCall: SteelProviderToolExecutor;
  forceDefaultCustomerTier: boolean;
  hasInstructionLookupResult: boolean;
  runState: SteelToolRunState;
  selectedCustomerTierId?: number;
}): Promise<ExecutedSteelToolCall[]> {
  const executedCalls: ExecutedSteelToolCall[] = [];
  const coalescedToolCallIds = new Set<string>();

  for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
    const call = calls[callIndex];
    if (!call || coalescedToolCallIds.has(call.toolCallId)) {
      continue;
    }

    let input: unknown;
    let result: SteelToolResult;
    try {
      input = parseToolCallInput(call);
    } catch {
      input = {};
      result = createInvalidToolInputResult(call);
      executedCalls.push({
        call,
        input,
        result,
      });
      continue;
    }

    if (call.toolName === 'search_price_candidates') {
      const parsedSearchInput = steelToolArgsSchemas.search_price_candidates.safeParse(input);
      if (parsedSearchInput.success) {
        const groupedCalls: Array<{
          call: SteelBusinessToolCall;
          input: unknown;
          searchInput: SearchPriceCandidatesInput;
        }> = [{ call, input, searchInput: parsedSearchInput.data }];

        for (const siblingCall of calls.slice(callIndex + 1)) {
          if (
            siblingCall.toolName !== 'search_price_candidates' ||
            coalescedToolCallIds.has(siblingCall.toolCallId)
          ) {
            continue;
          }

          let siblingInput: unknown;
          try {
            siblingInput = parseToolCallInput(siblingCall);
          } catch {
            continue;
          }

          const parsedSiblingSearchInput =
            steelToolArgsSchemas.search_price_candidates.safeParse(siblingInput);
          if (
            parsedSiblingSearchInput.success &&
            isSearchPriceCoalesceCompatible(parsedSearchInput.data, parsedSiblingSearchInput.data)
          ) {
            groupedCalls.push({
              call: siblingCall,
              input: siblingInput,
              searchInput: parsedSiblingSearchInput.data,
            });
          }
        }

        const batchedInput = createBatchedSearchPriceInput(
          groupedCalls.map(({ searchInput }) => searchInput),
        );
        if (batchedInput) {
          const executionInput = withDefaultCustomerTierFilter({
            forceDefaultCustomerTier,
            input: batchedInput,
            selectedCustomerTierId,
          });

          try {
            result = await executeSteelToolCall({
              toolName: call.toolName,
              arguments: executionInput,
              providerToolCallId: call.toolCallId,
              runState,
            });
          } catch (error) {
            result = createToolExecutionErrorResult(call, error);
          }

          for (const groupedCall of groupedCalls) {
            coalescedToolCallIds.add(groupedCall.call.toolCallId);
            executedCalls.push({
              call: groupedCall.call,
              input: groupedCall.input,
              result,
            });
          }

          if (isFatalSteelToolResult(result)) {
            throw new Error(getFatalSteelToolErrorMessage(call, result));
          }
          continue;
        }
      }
    }

    const executionInput =
      call.toolName === 'search_price_candidates'
        ? withDefaultCustomerTierFilter({
            forceDefaultCustomerTier,
            input,
            selectedCustomerTierId,
          })
        : input;

    try {
      result = await executeSteelToolCall({
        toolName: call.toolName,
        arguments: executionInput,
        providerToolCallId: call.toolCallId,
        runState,
      });
    } catch (error) {
      result = createToolExecutionErrorResult(call, error);
    }

    if (isFatalSteelToolResult(result)) {
      executedCalls.push({
        call,
        input: executionInput,
        result,
      });
      throw new Error(getFatalSteelToolErrorMessage(call, result));
    }

    executedCalls.push({
      call,
      input: executionInput,
      result,
    });
  }

  return executedCalls;
}

async function executeFileOcrToolCalls({
  calls,
  executeFileOcr,
  files,
}: {
  calls: FileOcrToolCall[];
  executeFileOcr: SteelProviderFileOcrExecutor;
  files: readonly SteelFileOcrSourceFile[];
}): Promise<ExecutedFileOcrToolCall[]> {
  const executedCalls: ExecutedFileOcrToolCall[] = [];

  for (const call of calls) {
    let input: RunFileOcrInput;
    let result: SteelToolResult;
    try {
      input = steelToolArgsSchemas.run_file_ocr.parse(parseToolCallInput(call));
    } catch {
      input = { filename: call.toolCallId };
      result = createInvalidToolInputResult(call);
      executedCalls.push({ call, input, result });
      continue;
    }

    result = await executeFileOcr({
      arguments: input,
      files,
      providerToolCallId: call.toolCallId,
    });
    executedCalls.push({ call, input, result });
  }

  return executedCalls;
}

async function executeVisualInspectionToolCalls({
  calls,
  executeVisualInspection,
  files,
  onToolStatus,
}: {
  calls: VisualInspectionToolCall[];
  executeVisualInspection: SteelProviderVisualInspectionExecutor;
  files: readonly SteelFileOcrSourceFile[];
  onToolStatus?: SteelProviderToolStatusCallback;
}): Promise<ExecutedVisualInspectionToolCall[]> {
  const executedCalls: ExecutedVisualInspectionToolCall[] = [];

  for (const call of calls) {
    let input: RunVisualInspectionInput;
    let result: SteelToolResult;
    try {
      input = steelToolArgsSchemas.run_visual_inspection.parse(parseToolCallInput(call));
    } catch {
      input = {
        filename: call.toolCallId,
        inspection_types: ['geometry_consistency'],
        prompt: 'Invalid visual inspection input.',
      };
      result = createInvalidToolInputResult(call);
      executedCalls.push({ call, input, result });
      continue;
    }

    await onToolStatus?.({ toolName: call.toolName, status: 'started' });
    try {
      result = await executeVisualInspection({
        arguments: input,
        files,
        providerToolCallId: call.toolCallId,
      });
      await onToolStatus?.({
        toolName: call.toolName,
        status: result.ok ? 'completed' : 'failed',
        result,
        errorSummary: result.ok ? undefined : result.errorSummary,
      });
    } catch (error) {
      const errorSummary = error instanceof Error ? error.message : `${call.toolName} failed.`;
      await onToolStatus?.({
        toolName: call.toolName,
        status: 'failed',
        errorSummary,
      });
      throw error;
    }
    executedCalls.push({ call, input, result });
  }

  return executedCalls;
}

function toAssistantToolCallMessage(
  executedCalls: ExecutedSteelToolCall[],
  workbookPatchCalls: ParsedWorkbookPatchToolCall[] = [],
  fileAnalysisPatchCalls: ParsedFileAnalysisPatchToolCall[] = [],
  fileOcrCalls: ExecutedFileOcrToolCall[] = [],
  visualInspectionCalls: ExecutedVisualInspectionToolCall[] = [],
): LanguageModelV3Message {
  return {
    role: 'assistant',
    content: [
      ...visualInspectionCalls.map(({ call, input }) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input,
      })),
      ...fileOcrCalls.map(({ call, input }) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input,
      })),
      ...executedCalls.map(({ call, input }) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input,
      })),
      ...workbookPatchCalls.map(({ call, input }) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input,
      })),
      ...fileAnalysisPatchCalls.map(({ call, input }) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input,
      })),
    ],
  };
}

function getMissingProvisionalWorkbookPatchSheetIds(
  operations: readonly WorkbookPatchOperation[],
): SteelWorkbookSheetId[] {
  const touchedSheetIds = new Set(operations.map((operation) => operation.sheetId));
  return workbookPatchCompletionSheetIds.filter((sheetId) => !touchedSheetIds.has(sheetId));
}

function isMeaningfulWorkbookPatchValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  return typeof value !== 'string' || value.trim().length > 0;
}

function getPatchedWorkbookColumnKeysBySheet(
  operations: readonly WorkbookPatchOperation[],
): Map<SteelWorkbookSheetId, Set<string>> {
  const columnKeysBySheet = new Map<SteelWorkbookSheetId, Set<string>>();
  for (const operation of operations) {
    if (operation.op !== 'set_cell') {
      continue;
    }

    if (!isMeaningfulWorkbookPatchValue(operation.value)) {
      continue;
    }

    const columnKeys = columnKeysBySheet.get(operation.sheetId) ?? new Set<string>();
    columnKeys.add(operation.columnKey);
    columnKeysBySheet.set(operation.sheetId, columnKeys);
  }

  return columnKeysBySheet;
}

function getMissingWorkbookPatchCells(
  operations: readonly WorkbookPatchOperation[],
): WorkbookPatchMissingCell[] {
  const columnKeysBySheet = getPatchedWorkbookColumnKeysBySheet(operations);
  return workbookPatchCompletionSheetIds.flatMap((sheetId) => {
    const patchedColumnKeys = columnKeysBySheet.get(sheetId);
    return workbookPatchCompletionColumnKeysBySheet[sheetId]
      .filter((columnKey) => !patchedColumnKeys?.has(columnKey))
      .map((columnKey) => ({ sheetId, columnKey }));
  });
}

function getWorkbookPatchCompletion(
  operations: readonly WorkbookPatchOperation[],
): WorkbookPatchCompletion {
  return {
    required: true,
    missingSheetIds: getMissingProvisionalWorkbookPatchSheetIds(operations),
    missingCells: getMissingWorkbookPatchCells(operations),
  };
}

function isWorkbookPatchCompletionComplete(completion?: WorkbookPatchCompletion): boolean {
  return (
    completion === undefined ||
    (completion.missingSheetIds.length === 0 && completion.missingCells.length === 0)
  );
}

function getWorkbookPatchCompletionProgressMessage(
  completion?: WorkbookPatchCompletion,
): string {
  const missingTargets = [
    ...(completion?.missingSheetIds ?? []),
    ...((completion?.missingCells ?? []).map(({ sheetId, columnKey }) => `${sheetId}.${columnKey}`)),
  ];
  const missingTargetText =
    missingTargets.length > 0 ? ` missing ${missingTargets.join(', ')};` : '';

  return `patch_quote_workbook workbook completion:${missingTargetText} asking AI to fill derivable workbook fields before final answer`;
}

async function emitWorkbookPatchCompletionProgress({
  completion,
  onToolStatus,
}: {
  completion?: WorkbookPatchCompletion;
  onToolStatus?: SteelProviderToolStatusCallback;
}): Promise<void> {
  await onToolStatus?.({
    toolName: 'patch_quote_workbook',
    status: 'started',
    message: getWorkbookPatchCompletionProgressMessage(completion),
  });
}

function toWorkbookPatchToolResultValue(
  parsedCall: ParsedWorkbookPatchToolCall,
  completion?: WorkbookPatchCompletion,
  {
    subtotalMismatch,
  }: {
    subtotalMismatch?: WorkbookSubtotalMismatch;
  } = {},
): JSONValue {
  const operationCount = parsedCall.patchProposal.operations.length;
  const deletedRowIds = parsedCall.patchProposal.operations
    .filter((operation): operation is Extract<WorkbookPatchOperation, { op: 'delete_row' }> => {
      return operation.op === 'delete_row';
    })
    .map((operation) => `${operation.sheetId}.${operation.rowId}`);
  const projectedFields = parsedCall.projectedFromSemantic
    ? {
        projectedOperationCount: operationCount,
        projectedDeleteRowCount: deletedRowIds.length,
        projectedDeletedRows: deletedRowIds,
      }
    : {};
  if (subtotalMismatch) {
    const instruction = subtotalMismatch.unknownSubtotalLineRefs
      ? 'Workbook summary.totalAmount cannot be numeric while any line subtotal is unknown. Call patch_quote_workbook again with summary.totalAmount set to 未確認 or provide reviewed/user-confirmed line subtotals before answering.'
      : 'Workbook summary.totalAmount must equal the sum of line subtotal values. Call patch_quote_workbook again with corrected summary.totalAmount before answering.';

    return toJsonValue({
      ok: true,
      toolName: parsedCall.call.toolName,
      operationCount,
      ...projectedFields,
      complete: false,
      subtotalMismatch,
      instruction,
    });
  }

  if (completion?.required && !isWorkbookPatchCompletionComplete(completion)) {
    return toJsonValue({
      ok: true,
      toolName: parsedCall.call.toolName,
      operationCount,
      ...projectedFields,
      complete: false,
      missingSheetIds: completion.missingSheetIds,
      missingCells: completion.missingCells,
      instruction:
        'Semantic workbook patch projected but incomplete for this Steel quote update. Call patch_quote_workbook again with the same lineId and any derivable missing semantic fields for system_order, manual_review, and customer_quote. Include customerData when customer search candidates exist, and include top-level customerQuoteTotal when the customer-facing quote sheet has a total row. Do not hand-write workbook cell operations. If a value cannot be derived, leave that target cell blank and record the missing material/customer/source/calculation evidence in manual_review. Do not answer the user until the workbook patch is complete enough for this turn.',
    });
  }

  return toJsonValue({
    ok: true,
    toolName: parsedCall.call.toolName,
    operationCount,
    ...projectedFields,
    ...(completion?.required ? { complete: true, missingSheetIds: [], missingCells: [] } : {}),
    instruction:
      'Semantic workbook patch captured for backend validation and application. Now answer the user in Traditional Chinese with only the interpreted order information, new 小計 amount when updated, and key workbook changes. Do not list a per-field diff or long search/candidate fields. Do not answer only with a field count such as 已更新 workbook：N 個欄位. Do not call patch_quote_workbook again unless another workbook update is needed.',
  });
}

function toFileAnalysisPatchToolResultValue(
  parsedCall: ParsedFileAnalysisPatchToolCall,
): JSONValue {
  const rowCount = parsedCall.input.patches.reduce(
    (count, patch) => count + patch.upsertRows.length,
    0,
  );
  const columnCount = parsedCall.input.patches.reduce(
    (count, patch) => count + patch.upsertColumns.length,
    0,
  );

  return toJsonValue({
    ok: true,
    toolName: parsedCall.call.toolName,
    sheetIds: parsedCall.input.patches.map((patch) => patch.sheetId),
    sourceFileCount: parsedCall.input.sourceFiles.length,
    rowCount,
    columnCount,
    instruction:
      'patch_file_analysis_data 已收到並會交由 backend 持久化。現在請用繁體中文簡短摘要本輪 patch 內容：來源檔案/頁碼/圖片序號、新增或更新的列、ocrStatus、低信心/人工複核項目、以及用戶需要核對的位置。若同一 PDF、檔案批次或圖片批次還有待處理頁面或圖片，必須依 page/imageIndex 升冪自動接續下一個 run_file_ocr，不要停下來等待用戶輸入 go；只有用戶 stop/abort、中斷續跑、OCR 錯誤或規則要求人工停下時才停止。不要只回答已更新 N 個欄位。',
  });
}

function toToolResultMessage(
  executedCalls: ExecutedSteelToolCall[],
  workbookPatchCalls: ParsedWorkbookPatchToolCall[] = [],
  workbookPatchCompletion?: WorkbookPatchCompletion,
  options: {
    subtotalMismatch?: WorkbookSubtotalMismatch;
  } = {},
  fileAnalysisPatchCalls: ParsedFileAnalysisPatchToolCall[] = [],
  fileOcrCalls: ExecutedFileOcrToolCall[] = [],
  visualInspectionCalls: ExecutedVisualInspectionToolCall[] = [],
): LanguageModelV3Message {
  return {
    role: 'tool',
    content: [
      ...visualInspectionCalls.map(({ call, result }) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: {
          type: 'json' as const,
          value: toJsonValue(result),
        },
      })),
      ...fileOcrCalls.map(({ call, result }) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: {
          type: 'json' as const,
          value: toJsonValue(result),
        },
      })),
      ...executedCalls.map(({ call, result }) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: {
          type: 'json' as const,
          value: toJsonValue(result),
        },
      })),
      ...workbookPatchCalls.map((parsedCall) => ({
        type: 'tool-result' as const,
        toolCallId: parsedCall.call.toolCallId,
        toolName: parsedCall.call.toolName,
        output: {
          type: 'json' as const,
          value: toWorkbookPatchToolResultValue(parsedCall, workbookPatchCompletion, options),
        },
      })),
      ...fileAnalysisPatchCalls.map((parsedCall) => ({
        type: 'tool-result' as const,
        toolCallId: parsedCall.call.toolCallId,
        toolName: parsedCall.call.toolName,
        output: {
          type: 'json' as const,
          value: toFileAnalysisPatchToolResultValue(parsedCall),
        },
      })),
    ],
  };
}

function getRequiredPriceLookupReminderMessage(): LanguageModelV3Message {
  return {
    role: 'system',
    content: `This Steel price request still requires reviewed lookup. For oral material/category wording, call lookup_catalog_families first to retrieve reviewed catalog key candidates. If the user provided a customer name, call search_customers in the initial lookup round when available, then pass the selected customer context to lookup_quote_rules. If search_customers returns multiple customer/tier candidates and one candidate is B tier, use B tier first for provisional calculation and keep the candidates pending confirmation. If you have selected a catalog/category key and lookup_quote_rules has not completed for this interpreted order context, call lookup_quote_rules first; otherwise call search_price_candidates with AI-derived candidate queries before answering. ${catalogFamilyPriceLookupInstruction} When the user did not provide a customer or customer tier is unknown/not found, use default price ${defaultCustomerTierCode} by passing customerTierId ${defaultCustomerTierId}; keep the notice short, for example 目前用 價格B：26.8 元/kg, and say separately that a customer name can be used to look up that customer's quote price. Do not add highest/most-expensive wording.`,
  };
}

function getProvisionalWorkbookPatchReminderMessage(
  missingSheetIds: readonly SteelWorkbookSheetId[] = workbookPatchCompletionSheetIds,
  missingCells: readonly WorkbookPatchMissingCell[] = [],
): LanguageModelV3Message {
  const missingSheetText =
    missingSheetIds.length > 0 ? ` Missing sheets: ${missingSheetIds.join(', ')}.` : '';
  const missingCellText =
    missingCells.length > 0
      ? ` Missing cells: ${missingCells
          .map(({ sheetId, columnKey }) => `${sheetId}.${columnKey}`)
          .join(', ')}.`
      : '';

  return {
    role: 'system',
    content: `This Steel quote update still requires a complete-enough semantic workbook patch for this turn.${missingSheetText}${missingCellText} Call patch_quote_workbook to update only the AI-facing quote sheets when values are available: system_order, manual_review, customer_quote (label 報價單), and customer_data (label 客戶資料) when customer search candidates exist. Do not hand-write workbook cell operations; backend projection owns cell operation generation. Fill semantic fields when derivable from user text, workbook context, reviewed tool results, or calculation_results. If the user provided a customer/vendor name and search_customers returned candidates, include semantic customerData rows with customerCode, vendorName, priceTier, confirmationStatus, and note. Use calculation_results before interpreted quote items when both exist. Leave missing semantic values blank when material, customer, source, or calculation context is unavailable, and record the missing context in manual_review instead of inventing values. 未確認單價或金額不可填 0; write 未確認 instead. customer_quote / 報價單 must not expose customer tier, source refs, search keywords, candidates, AI/internal notes, cost, or margin. After the patch result, summarize only the interpreted order information, new 小計 amount when updated, and key workbook changes; do not list a per-field diff or answer only with a field count.`,
  };
}

function getPendingFileAnalysisPdfPageReminderMessage({
  fileId,
  filename,
  page,
  pageCount,
}: PendingFileAnalysisPdfPage): LanguageModelV3Message {
  const fileLabel = filename ? `${filename} (${fileId})` : fileId;

  return {
    role: 'system',
    content: `The previous response tried to answer before finishing all PDF pages. ${fileLabel} has ${pageCount} pages, and page ${page} is still pending. Do not answer the user yet. Call run_file_ocr now for filename="${filename ?? fileId}", page=${page}, output_mode="markdown", dpi=400. After that OCR result, call patch_file_analysis_data for page ${page}, then continue the next page if any remain.`,
  };
}

function isJsonObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPositivePriceCandidate(result: SteelToolResult): boolean {
  if (!result.ok) {
    return false;
  }

  const priceCandidates = result.data.priceCandidates;
  if (!Array.isArray(priceCandidates)) {
    return false;
  }

  return priceCandidates.some((candidate) => {
    return (
      isJsonObject(candidate) && typeof candidate.unitPrice === 'number' && candidate.unitPrice > 0
    );
  });
}

function isCompletedPriceLookup(result: SteelToolResult): boolean {
  return result.ok || result.errorCategory !== 'invalid_arguments';
}

function getReasoningSummaries(result: LanguageModelV3GenerateResult): string[] {
  return result.content
    .filter(
      (
        part,
      ): part is Extract<LanguageModelV3GenerateResult['content'][number], { type: 'reasoning' }> =>
        part.type === 'reasoning',
    )
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0);
}

function isWorkbookPatchToolCall(
  part: LanguageModelV3GenerateResult['content'][number],
): part is WorkbookPatchToolCall {
  return part.type === 'tool-call' && part.toolName === 'patch_quote_workbook';
}

function getWorkbookPatchToolCalls(result: LanguageModelV3GenerateResult): WorkbookPatchToolCall[] {
  return result.content.filter(isWorkbookPatchToolCall);
}

function isFileAnalysisPatchToolCall(
  part: LanguageModelV3GenerateResult['content'][number],
): part is FileAnalysisPatchToolCall {
  return part.type === 'tool-call' && part.toolName === 'patch_file_analysis_data';
}

function getFileAnalysisPatchToolCalls(
  result: LanguageModelV3GenerateResult,
): FileAnalysisPatchToolCall[] {
  return result.content.filter(isFileAnalysisPatchToolCall);
}

function isFileOcrToolCall(
  part: LanguageModelV3GenerateResult['content'][number],
): part is FileOcrToolCall {
  return part.type === 'tool-call' && part.toolName === 'run_file_ocr';
}

function getFileOcrToolCalls(result: LanguageModelV3GenerateResult): FileOcrToolCall[] {
  return result.content.filter(isFileOcrToolCall);
}

function isVisualInspectionToolCall(
  part: LanguageModelV3GenerateResult['content'][number],
): part is VisualInspectionToolCall {
  return part.type === 'tool-call' && part.toolName === 'run_visual_inspection';
}

function getVisualInspectionToolCalls(
  result: LanguageModelV3GenerateResult,
): VisualInspectionToolCall[] {
  return result.content.filter(isVisualInspectionToolCall);
}

function parseWorkbookPatchToolCalls(
  calls: WorkbookPatchToolCall[],
): ParsedWorkbookPatchToolCall[] {
  return calls.map((call) => {
    const input = JSON.parse(call.input);
    const semanticPatch = steelSemanticWorkbookPatchSchema.parse(input);
    const patchProposal = steelProviderWorkbookPatchProposalSchema.parse({
      operations: buildSemanticWorkbookPatchOperations(semanticPatch),
    });

    return {
      call,
      input: semanticPatch,
      patchProposal,
      projectedFromSemantic: true,
    };
  });
}

function parseFileAnalysisPatchToolCalls(
  calls: FileAnalysisPatchToolCall[],
): ParsedFileAnalysisPatchToolCall[] {
  return calls.map((call) => {
    const input = patchFileAnalysisDataToolInputSchema.parse(JSON.parse(call.input));

    return {
      call,
      input,
    };
  });
}

function getFileAnalysisSourceFileKey(sourceFile: {
  fileId: string;
  filename?: string;
  mediaType: string;
}): string {
  return sourceFile.fileId || `${sourceFile.filename ?? ''}:${sourceFile.mediaType}`;
}

function mergeFileAnalysisPatchProposal(
  current: SteelProviderFileAnalysisPatchProposal | undefined,
  next: SteelProviderFileAnalysisPatchProposal,
): SteelProviderFileAnalysisPatchProposal {
  if (!current) {
    return {
      ...next,
      sourceFiles: [...next.sourceFiles],
      patches: [...next.patches],
    };
  }

  const sourceFilesByKey = new Map(
    current.sourceFiles.map((sourceFile) => [getFileAnalysisSourceFileKey(sourceFile), sourceFile]),
  );
  for (const sourceFile of next.sourceFiles) {
    const key = getFileAnalysisSourceFileKey(sourceFile);
    sourceFilesByKey.set(key, {
      ...sourceFilesByKey.get(key),
      ...sourceFile,
    });
  }

  return {
    fileAnalysisDataId: next.fileAnalysisDataId ?? current.fileAnalysisDataId,
    sourceFiles: [...sourceFilesByKey.values()],
    patches: [...current.patches, ...next.patches],
    summary: next.summary ?? current.summary,
  };
}

function mergeFileAnalysisPatchCalls(
  current: SteelProviderFileAnalysisPatchProposal | undefined,
  parsedCalls: readonly ParsedFileAnalysisPatchToolCall[],
): SteelProviderFileAnalysisPatchProposal | undefined {
  return parsedCalls.reduce(
    (patch, parsedCall) => mergeFileAnalysisPatchProposal(patch, parsedCall.input),
    current,
  );
}

function getWorkbookPatchFromOperations(
  operations: WorkbookPatchOperation[],
): SteelProviderWorkbookPatchProposal | undefined {
  return operations.length > 0 ? { operations } : undefined;
}

function getWarningText(warning: SharedV3Warning): string {
  if (warning.type === 'other') {
    return warning.message;
  }

  return warning.details ? `${warning.feature}: ${warning.details}` : warning.feature;
}

function getSteelToolChoice({
  hasReviewedPriceResult,
  mustGetReviewedPriceResult,
}: {
  hasReviewedPriceResult: boolean;
  mustGetReviewedPriceResult: boolean;
}): LanguageModelV3ToolChoice {
  if (!mustGetReviewedPriceResult || hasReviewedPriceResult) {
    return { type: 'auto' };
  }

  return { type: 'required' };
}

function sumTokenTotals(
  results: LanguageModelV3GenerateResult[],
  getTotal: (result: LanguageModelV3GenerateResult) => number | undefined,
) {
  const totals = results
    .map(getTotal)
    .filter((value): value is number => typeof value === 'number');

  return totals.length > 0 ? totals.reduce((sum, value) => sum + value, 0) : undefined;
}

function getUsage(results: LanguageModelV3GenerateResult[]): SteelProviderChatResponse['usage'] {
  const inputTokens = sumTokenTotals(results, (result) => result.usage.inputTokens.total);
  const outputTokens = sumTokenTotals(results, (result) => result.usage.outputTokens.total);
  const totalTokens =
    typeof inputTokens === 'number' && typeof outputTokens === 'number'
      ? inputTokens + outputTokens
      : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function getWarnings(results: LanguageModelV3GenerateResult[]): string[] {
  return results.flatMap((result) => result.warnings.map(getWarningText));
}

function sumRoundTimings(
  rounds: readonly SteelProviderRoundTiming[],
  getDuration: (round: SteelProviderRoundTiming) => number,
) {
  return rounds.reduce((total, round) => total + getDuration(round), 0);
}

function getProviderTimings({
  rounds,
  startedAt,
}: {
  rounds: readonly SteelProviderRoundTiming[];
  startedAt: number;
}): SteelProviderTimings {
  return {
    totalDurationMs: Math.max(0, Date.now() - startedAt),
    generationDurationMs: sumRoundTimings(rounds, (round) => round.generationDurationMs),
    toolDurationMs: sumRoundTimings(rounds, (round) => round.toolDurationMs),
    workbookCompletionDurationMs: sumRoundTimings(
      rounds,
      (round) => round.workbookCompletionDurationMs,
    ),
    roundCount: rounds.length,
    rounds: [...rounds],
  };
}

function countGeneratedToolCalls(result: LanguageModelV3GenerateResult): number {
  return result.content.filter((part) => part.type === 'tool-call').length;
}

export async function sendSteelOAuthChat({
  abortSignal,
  agentRulesClient,
  authFilePath,
  createOpenAIOAuth: injectedCreateOpenAIOAuth,
  ensureFresh = true,
  executeFileOcr = executeDefaultFileOcr,
  executeVisualInspection,
  executeSteelToolCall = executeDefaultSteelToolCall,
  fetch,
  maxOutputTokens,
  messages,
  model,
  onReasoningSummary,
  onToolStatus,
  passThroughUnsupportedFiles,
  reasoningEffort,
  steelToolMaxCalls,
  steelRuntimePolicy,
  workbookContextText,
  workbookPatchTool,
}: SendSteelOAuthChatOptions): Promise<SteelProviderChatResponse> {
  const providerStartedAt = Date.now();
  const messagesWithPdfPageCounts =
    steelRuntimePolicy === true ? await getMessagesWithPdfPageCounts(messages) : messages;
  const allVisualEvidenceFiles =
    steelRuntimePolicy === true ? getVisualEvidenceFiles(messagesWithPdfPageCounts) : [];
  const latestUserVisualEvidenceFiles =
    steelRuntimePolicy === true
      ? getVisualEvidenceFilesFromMessage(getLatestUserMessage(messagesWithPdfPageCounts))
      : [];
  const shouldEnableFileOcr =
    latestUserVisualEvidenceFiles.length > 0 ||
    (latestUserRequestsFileOcr(messagesWithPdfPageCounts) && allVisualEvidenceFiles.length > 0);
  const visualEvidenceFiles = shouldEnableFileOcr
    ? latestUserVisualEvidenceFiles.length > 0
      ? latestUserVisualEvidenceFiles
      : allVisualEvidenceFiles
    : [];
  const fileAnalysisPatchTool =
    visualEvidenceFiles.length > 0 || hasSavedFileAnalysisContext(messagesWithPdfPageCounts);
  const ocrSourceKinds =
    steelRuntimePolicy === true ? getVisualEvidenceSourceKindsFromFiles(visualEvidenceFiles) : [];
  const shouldLoadAgentRules =
    steelRuntimePolicy === true || workbookPatchTool === true || ocrSourceKinds.length > 0;
  const systemInstruction = await getSystemInstruction({
    agentRulesClient: shouldLoadAgentRules
      ? (agentRulesClient ?? getDefaultSteelToolClient())
      : undefined,
    steelRuntimePolicy,
    workbookContextText,
    workbookPatchTool,
    ocrSourceKinds,
  });
  const rulesClient = shouldLoadAgentRules
    ? (agentRulesClient ?? getDefaultSteelToolClient())
    : undefined;
  const visualInspectionInstruction =
    ocrSourceKinds.length > 0 && rulesClient
      ? await getSteelVisualInspectionInstruction(rulesClient, ocrSourceKinds)
      : '';
  const createOpenAIOAuth = injectedCreateOpenAIOAuth ?? (await loadCreateOpenAIOAuth());
  const openai = createOpenAIOAuth({
    authFilePath,
    ensureFresh,
    fetch,
    responsesState: false,
  });
  const executeVisualInspectionTool =
    executeVisualInspection ??
    ((options: SteelProviderVisualInspectionOptions) =>
      runOpenAIOAuthVisualInspection({
        ...options,
        model,
        openai,
        visualInspectionInstruction,
      }));
  const tools = [
    ...(steelRuntimePolicy ? getSteelBusinessFunctionTools() : []),
    ...(workbookPatchTool ? [semanticWorkbookPatchFunctionTool] : []),
    ...(visualEvidenceFiles.length > 0 ? [fileOcrFunctionTool, visualInspectionFunctionTool] : []),
    ...(fileAnalysisPatchTool ? [fileAnalysisPatchFunctionTool] : []),
  ] satisfies SteelRoundTool[];
  const runState = createSteelToolRunState(steelToolMaxCalls ?? Number.MAX_SAFE_INTEGER);
  const omitVisualEvidenceFileParts = allVisualEvidenceFiles.length > 0;
  let prompt = systemInstruction
    ? toPromptWithSystemInstruction(messagesWithPdfPageCounts, systemInstruction, {
        omitVisualEvidenceFileParts,
        ocrAvailableVisualEvidenceFiles: visualEvidenceFiles,
      })
    : toPrompt(messagesWithPdfPageCounts, {
        omitVisualEvidenceFileParts,
        ocrAvailableVisualEvidenceFiles: visualEvidenceFiles,
      });
  const generationResults: LanguageModelV3GenerateResult[] = [];
  const mustGetReviewedPriceResult =
    steelRuntimePolicy === true && requiresReviewedPriceLookup(messages);
  const mustGetProvisionalWorkbookPatch = mustGetReviewedPriceResult && workbookPatchTool === true;
  let hasReviewedPriceResult = false;
  let hasInstructionLookupResult = false;
  let hasPositiveReviewedPriceCandidate = false;
  let forceDefaultCustomerTier = true;
  let selectedCustomerTierId: number | undefined;
  let hasWorkbookPatch = false;
  const workbookPatchOperations: WorkbookPatchOperation[] = [];
  let fileAnalysisPatch: SteelProviderFileAnalysisPatchProposal | undefined;
  const fileAnalysisPdfPageProgress = new Map<string, FileAnalysisPdfPageProgress>();
  trackVisualEvidencePdfPageProgress(fileAnalysisPdfPageProgress, visualEvidenceFiles);
  let forcedFileOcrPage: PendingFileAnalysisPdfPage | undefined;
  const roundTimings: SteelProviderRoundTiming[] = [];

  for (let round = 0; steelToolMaxCalls === undefined || round <= steelToolMaxCalls; round += 1) {
    const toolChoice: LanguageModelV3ToolChoice = forcedFileOcrPage
      ? { type: 'tool', toolName: 'run_file_ocr' }
      : getSteelToolChoice({
          hasReviewedPriceResult,
          mustGetReviewedPriceResult,
        });
    forcedFileOcrPage = undefined;
    const promptMessageCount = prompt.length;
    const generationStartedAt = Date.now();
    const result = await openai(model).doGenerate({
      abortSignal,
      prompt,
      maxOutputTokens,
      ...(tools.length > 0
        ? {
            tools,
            toolChoice,
          }
        : {}),
      providerOptions: {
        openai: {
          passThroughUnsupportedFiles,
          reasoningEffort,
          ...(onReasoningSummary ? { reasoningSummary: 'auto' as const } : {}),
        },
      },
    });
    const generationDurationMs = Math.max(0, Date.now() - generationStartedAt);
    let toolDurationMs = 0;

    generationResults.push(result);
    for (const summary of getReasoningSummaries(result)) {
      onReasoningSummary?.(summary);
    }
    const workbookPatchCalls = workbookPatchTool ? getWorkbookPatchToolCalls(result) : [];
    const parsedWorkbookPatchCalls = parseWorkbookPatchToolCalls(workbookPatchCalls);
    const parsedFileAnalysisPatchCalls = parseFileAnalysisPatchToolCalls(
      getFileAnalysisPatchToolCalls(result),
    );
    trackFileAnalysisPdfPageProgress(fileAnalysisPdfPageProgress, parsedFileAnalysisPatchCalls);
    const pendingFileAnalysisPdfPageAfterPatch =
      visualEvidenceFiles.length > 0
        ? getPendingFileAnalysisPdfPage(fileAnalysisPdfPageProgress)
        : undefined;
    const fileOcrToolCalls = visualEvidenceFiles.length > 0 ? getFileOcrToolCalls(result) : [];
    const fileOcrStartedAt = Date.now();
    const executedFileOcrCalls = await executeFileOcrToolCalls({
      calls: fileOcrToolCalls,
      executeFileOcr,
      files: visualEvidenceFiles,
    });
    toolDurationMs += Math.max(0, Date.now() - fileOcrStartedAt);
    const visualInspectionToolCalls =
      visualEvidenceFiles.length > 0 ? getVisualInspectionToolCalls(result) : [];
    const visualInspectionStartedAt = Date.now();
    const executedVisualInspectionCalls = await executeVisualInspectionToolCalls({
      calls: visualInspectionToolCalls,
      executeVisualInspection: executeVisualInspectionTool,
      files: visualEvidenceFiles,
      onToolStatus,
    });
    toolDurationMs += Math.max(0, Date.now() - visualInspectionStartedAt);
    if (parsedFileAnalysisPatchCalls.length > 0) {
      fileAnalysisPatch = mergeFileAnalysisPatchCalls(
        fileAnalysisPatch,
        parsedFileAnalysisPatchCalls,
      );
      const fileAnalysisPatchStatusMessage = pendingFileAnalysisPdfPageAfterPatch
        ? 'patch_file_analysis_data received; preparing OCR continuation'
        : hasTrackedFileAnalysisPdf(fileAnalysisPdfPageProgress)
          ? 'patch_file_analysis_data received; OCR complete; preparing summary'
          : 'patch_file_analysis_data received; preparing summary';
      for (const parsedCall of parsedFileAnalysisPatchCalls) {
        await onToolStatus?.({
          toolName: parsedCall.call.toolName,
          status: 'completed',
          message: fileAnalysisPatchStatusMessage,
          fileAnalysisPatch: parsedCall.input,
        });
      }
    }
    const workbookSubtotalMismatch = getFirstWorkbookSubtotalMismatch(
      parsedWorkbookPatchCalls.map(({ input }) => input),
    );
    const acceptedWorkbookPatchCalls = workbookSubtotalMismatch ? [] : parsedWorkbookPatchCalls;
    workbookPatchOperations.push(
      ...acceptedWorkbookPatchCalls.flatMap(({ patchProposal }) => patchProposal.operations),
    );
    hasWorkbookPatch = workbookPatchOperations.length > 0;
    const requiresWorkbookPatchCompletion =
      (mustGetProvisionalWorkbookPatch && hasPositiveReviewedPriceCandidate) ||
      (steelRuntimePolicy === true && hasWorkbookPatch);
    const workbookCompletionStartedAt = Date.now();
    const workbookPatchCompletion = requiresWorkbookPatchCompletion
      ? getWorkbookPatchCompletion(workbookPatchOperations)
      : undefined;
    const hasCompleteWorkbookPatch =
      workbookPatchCompletion === undefined ||
      (hasWorkbookPatch && isWorkbookPatchCompletionComplete(workbookPatchCompletion));
    const workbookCompletionDurationMs = Math.max(0, Date.now() - workbookCompletionStartedAt);
    let recordedRoundTiming = false;
    const recordRoundTiming = () => {
      if (recordedRoundTiming) {
        return;
      }

      recordedRoundTiming = true;
      roundTimings.push({
        round,
        generationDurationMs,
        toolDurationMs,
        workbookCompletionDurationMs,
        promptMessageCount,
        generatedToolCallCount: countGeneratedToolCalls(result),
        workbookPatchOperationCount: acceptedWorkbookPatchCalls.reduce(
          (count, parsedCall) => count + parsedCall.patchProposal.operations.length,
          0,
        ),
        workbookCompletionRequired: requiresWorkbookPatchCompletion,
        workbookCompletionComplete: requiresWorkbookPatchCompletion
          ? hasCompleteWorkbookPatch
          : undefined,
        missingWorkbookSheetCount: workbookPatchCompletion?.missingSheetIds.length ?? 0,
        missingWorkbookCellCount: workbookPatchCompletion?.missingCells.length ?? 0,
      });
    };

    if (requiresWorkbookPatchCompletion && !hasCompleteWorkbookPatch) {
      await emitWorkbookPatchCompletionProgress({
        completion: workbookPatchCompletion,
        onToolStatus,
      });
    }

    const steelBusinessToolCalls = steelRuntimePolicy ? getSteelBusinessToolCalls(result) : [];
    if (steelBusinessToolCalls.length === 0) {
      if (executedFileOcrCalls.length > 0 || executedVisualInspectionCalls.length > 0) {
        if (executedFileOcrCalls.some(({ result: toolResult }) => toolResult.ok)) {
          await onToolStatus?.({
            toolName: 'patch_file_analysis_data',
            status: 'started',
            message: 'patch_file_analysis_data waiting for AI to convert OCR result',
          });
        }
        prompt = [
          ...prompt,
          toAssistantToolCallMessage(
            [],
            [],
            parsedFileAnalysisPatchCalls,
            executedFileOcrCalls,
            executedVisualInspectionCalls,
          ),
          toToolResultMessage(
            [],
            [],
            undefined,
            {},
            parsedFileAnalysisPatchCalls,
            executedFileOcrCalls,
            executedVisualInspectionCalls,
          ),
        ];
        recordRoundTiming();
        continue;
      }

      if (mustGetReviewedPriceResult && !hasReviewedPriceResult) {
        prompt = [...prompt, getRequiredPriceLookupReminderMessage()];
        recordRoundTiming();
        continue;
      }

      if (workbookSubtotalMismatch && parsedWorkbookPatchCalls.length > 0) {
        prompt = [
          ...prompt,
          toAssistantToolCallMessage(
            [],
            parsedWorkbookPatchCalls,
            parsedFileAnalysisPatchCalls,
            executedFileOcrCalls,
            executedVisualInspectionCalls,
          ),
          toToolResultMessage(
            [],
            parsedWorkbookPatchCalls,
            workbookPatchCompletion,
            {
              subtotalMismatch: workbookSubtotalMismatch,
            },
            parsedFileAnalysisPatchCalls,
            executedFileOcrCalls,
            executedVisualInspectionCalls,
          ),
        ];
        recordRoundTiming();
        continue;
      }

      if (parsedWorkbookPatchCalls.length > 0 && requiresWorkbookPatchCompletion) {
        prompt = [
          ...prompt,
          toAssistantToolCallMessage(
            [],
            parsedWorkbookPatchCalls,
            parsedFileAnalysisPatchCalls,
            executedFileOcrCalls,
            executedVisualInspectionCalls,
          ),
          toToolResultMessage(
            [],
            parsedWorkbookPatchCalls,
            workbookPatchCompletion,
            {},
            parsedFileAnalysisPatchCalls,
            executedFileOcrCalls,
            executedVisualInspectionCalls,
          ),
        ];
        recordRoundTiming();
        continue;
      }

      if (parsedFileAnalysisPatchCalls.length > 0) {
        const nextPrompt = [
          ...prompt,
          toAssistantToolCallMessage(
            [],
            [],
            parsedFileAnalysisPatchCalls,
            executedFileOcrCalls,
            executedVisualInspectionCalls,
          ),
          toToolResultMessage(
            [],
            [],
            undefined,
            {},
            parsedFileAnalysisPatchCalls,
            executedFileOcrCalls,
            executedVisualInspectionCalls,
          ),
        ];
        const pendingFileAnalysisPdfPage = pendingFileAnalysisPdfPageAfterPatch;
        if (pendingFileAnalysisPdfPage) {
          forcedFileOcrPage = pendingFileAnalysisPdfPage;
          prompt = [
            ...nextPrompt,
            getPendingFileAnalysisPdfPageReminderMessage(pendingFileAnalysisPdfPage),
          ];
        } else {
          prompt = nextPrompt;
        }
        recordRoundTiming();
        continue;
      }

      if (requiresWorkbookPatchCompletion && !hasCompleteWorkbookPatch) {
        prompt = [
          ...prompt,
          getProvisionalWorkbookPatchReminderMessage(
            workbookPatchCompletion?.missingSheetIds,
            workbookPatchCompletion?.missingCells,
          ),
        ];
        recordRoundTiming();
        continue;
      }

      const pendingFileAnalysisPdfPage =
        visualEvidenceFiles.length > 0
          ? getPendingFileAnalysisPdfPage(fileAnalysisPdfPageProgress)
          : undefined;
      if (pendingFileAnalysisPdfPage) {
        forcedFileOcrPage = pendingFileAnalysisPdfPage;
        prompt = [
          ...prompt,
          getPendingFileAnalysisPdfPageReminderMessage(pendingFileAnalysisPdfPage),
        ];
        recordRoundTiming();
        continue;
      }

      recordRoundTiming();
      break;
    }

    const steelBusinessToolsStartedAt = Date.now();
    const executedCalls = await executeSteelBusinessToolCalls({
      calls: steelBusinessToolCalls,
      executeSteelToolCall,
      forceDefaultCustomerTier,
      hasInstructionLookupResult,
      runState,
      selectedCustomerTierId,
    });
    toolDurationMs += Math.max(0, Date.now() - steelBusinessToolsStartedAt);
    if (
      executedCalls.some(
        ({ call, result: toolResult }) => call.toolName === 'lookup_quote_rules' && toolResult.ok,
      )
    ) {
      hasInstructionLookupResult = true;
    }
    const customerTierContextCalls = executedCalls.filter(
      ({ call, result: toolResult }) => call.toolName === 'lookup_quote_rules' && toolResult.ok,
    );
    const knownCustomerTierId = customerTierContextCalls
      .map(({ input }) => getKnownCustomerTierIdFromContext(input))
      .find((tierId) => tierId !== undefined);
    const searchedCustomerTierId = executedCalls
      .filter(({ call }) => call.toolName === 'search_customers')
      .map(({ result: toolResult }) => getPreferredCustomerSearchTierId(toolResult))
      .find((tierId) => tierId !== undefined);
    const nextSelectedCustomerTierId =
      knownCustomerTierId ?? searchedCustomerTierId ?? selectedCustomerTierId;
    if (nextSelectedCustomerTierId !== undefined) {
      selectedCustomerTierId = nextSelectedCustomerTierId;
      forceDefaultCustomerTier = false;
    } else if (customerTierContextCalls.some(({ input }) => hasUnknownCustomerTierContext(input))) {
      forceDefaultCustomerTier = true;
    }
    const priceLookupCalls = executedCalls.filter(
      ({ call }) => call.toolName === 'search_price_candidates',
    );
    if (priceLookupCalls.length > 0) {
      hasReviewedPriceResult =
        hasReviewedPriceResult ||
        priceLookupCalls.some(({ result: toolResult }) => isCompletedPriceLookup(toolResult));
      hasPositiveReviewedPriceCandidate =
        hasPositiveReviewedPriceCandidate ||
        priceLookupCalls.some(({ result: toolResult }) => hasPositivePriceCandidate(toolResult));
    }

    const nextPrompt = [
      ...prompt,
      toAssistantToolCallMessage(
        executedCalls,
        parsedWorkbookPatchCalls,
        parsedFileAnalysisPatchCalls,
        executedFileOcrCalls,
        executedVisualInspectionCalls,
      ),
      toToolResultMessage(
        executedCalls,
        parsedWorkbookPatchCalls,
        workbookPatchCompletion,
        {
          subtotalMismatch: workbookSubtotalMismatch,
        },
        parsedFileAnalysisPatchCalls,
        executedFileOcrCalls,
        executedVisualInspectionCalls,
      ),
    ];
    if (mustGetReviewedPriceResult && !hasReviewedPriceResult) {
      prompt = [...nextPrompt, getRequiredPriceLookupReminderMessage()];
    } else if (workbookSubtotalMismatch) {
      prompt = nextPrompt;
    } else if (requiresWorkbookPatchCompletion && !hasCompleteWorkbookPatch) {
      prompt = [
        ...nextPrompt,
        getProvisionalWorkbookPatchReminderMessage(
          workbookPatchCompletion?.missingSheetIds,
          workbookPatchCompletion?.missingCells,
        ),
      ];
    } else {
      prompt = nextPrompt;
    }
    recordRoundTiming();
  }

  if (mustGetReviewedPriceResult && !hasReviewedPriceResult) {
    throw new Error(
      'search_price_candidates was required before answering this Steel price request.',
    );
  }

  const finalWorkbookPatchCompletion =
    (mustGetProvisionalWorkbookPatch && hasPositiveReviewedPriceCandidate) ||
    (steelRuntimePolicy === true && hasWorkbookPatch)
      ? getWorkbookPatchCompletion(workbookPatchOperations)
      : undefined;
  if (
    ((mustGetProvisionalWorkbookPatch && hasPositiveReviewedPriceCandidate) ||
      (steelRuntimePolicy === true && hasWorkbookPatch)) &&
    (!hasWorkbookPatch || !isWorkbookPatchCompletionComplete(finalWorkbookPatchCompletion))
  ) {
    const missingSheetIds = finalWorkbookPatchCompletion?.missingSheetIds ?? [];
    const missingCells =
      finalWorkbookPatchCompletion?.missingCells
        .map(({ sheetId, columnKey }) => `${sheetId}.${columnKey}`)
        .join(', ') ?? '';
    throw new Error(
      `complete patch_quote_workbook was required before answering this Steel quote update. Missing sheets: ${missingSheetIds.join(', ')}. Missing cells: ${missingCells}`,
    );
  }

  const result = generationResults[generationResults.length - 1];
  if (!result) {
    throw new Error('OpenAI OAuth provider did not return a Steel chat result.');
  }

  const workbookPatch = getWorkbookPatchFromOperations(workbookPatchOperations);

  return {
    provider: 'openai_oauth_responses',
    model,
    text: getGeneratedText(result),
    responseId: result.response?.id,
    usage: getUsage(generationResults),
    timings: getProviderTimings({ rounds: roundTimings, startedAt: providerStartedAt }),
    unsupportedSettings: [],
    warnings: getWarnings(generationResults),
    ...(workbookPatch ? { workbookPatch } : {}),
    ...(fileAnalysisPatch ? { fileAnalysisPatch } : {}),
  };
}
