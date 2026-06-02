import type {
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import type { SteelOpenAIReasoningEffort } from './config';
import {
  requiredSteelWorkbookSheetIds,
  steelProviderWorkbookPatchProposalSchema,
  type SteelProviderWorkbookPatchProposal,
} from 'librechat-data-provider';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('openai-oauth-provider')>;

type CreateOpenAIOAuth = typeof createOpenAIOAuthType;

export type SteelOAuthChatMessageRole = 'system' | 'user' | 'assistant';

export interface SteelOAuthChatFile {
  filename?: string;
  mediaType: string;
  data: Uint8Array | string | URL;
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
  unsupportedSettings: string[];
  warnings: string[];
  workbookPatch?: SteelProviderWorkbookPatchProposal;
}

export interface SendSteelOAuthChatOptions {
  abortSignal?: AbortSignal;
  authFilePath?: string;
  createOpenAIOAuth?: CreateOpenAIOAuth;
  ensureFresh?: boolean;
  fetch?: FetchFunction;
  maxOutputTokens?: number;
  messages: SteelOAuthChatMessage[];
  model: string;
  passThroughUnsupportedFiles?: boolean;
  reasoningEffort: SteelOpenAIReasoningEffort;
  workbookContextText?: string;
  workbookPatchTool?: boolean;
}

async function loadCreateOpenAIOAuth(): Promise<typeof createOpenAIOAuthType> {
  const provider = await dynamicImport('openai-oauth-provider');
  return provider.createOpenAIOAuth;
}

function toLanguageModelMessage(message: SteelOAuthChatMessage): LanguageModelV3Message {
  if (message.role === 'system') {
    return {
      role: 'system',
      content: message.content,
    };
  }

  return {
    role: message.role,
    content: [
      {
        type: 'text',
        text: message.content,
      },
      ...(message.files ?? []).map((file) => {
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

function toPrompt(messages: SteelOAuthChatMessage[]): LanguageModelV3Prompt {
  return messages.map(toLanguageModelMessage);
}

function getWorkbookPatchInstruction(workbookContextText?: string): string {
  const instruction = [
    'You can update the visible Steel workbook by calling the patch_workbook tool.',
    'Use the tool when the user asks to set or update an explicit workbook cell.',
    'Use workbook structure context to resolve visible sheet, row, and column labels into internal sheetId, rowId, and columnKey values.',
    'Do not ask the user for internal workbook ids or keys when the target can be resolved from context.',
    'If the target sheet, row, column, or value is still ambiguous after checking context, ask a short clarification instead of calling the tool.',
    'Do not only describe a workbook update when the update should be applied.',
  ].join(' ');

  return workbookContextText
    ? `${instruction}\n\nWorkbook structure context:\n${workbookContextText}`
    : instruction;
}

function toPromptWithWorkbookPatchTool(
  messages: SteelOAuthChatMessage[],
  workbookContextText?: string,
): LanguageModelV3Prompt {
  return [
    {
      role: 'system',
      content: getWorkbookPatchInstruction(workbookContextText),
    },
    ...toPrompt(messages),
  ];
}

const workbookPatchFunctionTool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'patch_workbook',
  description:
    'Propose explicit workbook cell updates for the current Steel quote workbook. The backend validates and applies the operations.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['operations'],
    properties: {
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'sheetId', 'rowId', 'columnKey', 'value', 'reason'],
          properties: {
            op: { type: 'string', const: 'set_cell' },
            sheetId: { type: 'string', enum: [...requiredSteelWorkbookSheetIds] },
            rowId: { type: 'string', minLength: 1 },
            columnKey: { type: 'string', minLength: 1 },
            value: { type: ['string', 'number', 'boolean', 'null'] },
            reason: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
};

function getGeneratedText(result: LanguageModelV3GenerateResult): string {
  return result.content.reduce((text, part) => {
    if (part.type !== 'text') {
      return text;
    }

    return `${text}${part.text}`;
  }, '');
}

function getWorkbookPatch(
  result: LanguageModelV3GenerateResult,
): SteelProviderWorkbookPatchProposal | undefined {
  const operations = result.content.flatMap((part) => {
    if (part.type !== 'tool-call' || part.toolName !== 'patch_workbook') {
      return [];
    }

    const parsed = steelProviderWorkbookPatchProposalSchema.parse(JSON.parse(part.input));
    return parsed.operations;
  });

  return operations.length > 0 ? { operations } : undefined;
}

function getWarningText(warning: SharedV3Warning): string {
  if (warning.type === 'other') {
    return warning.message;
  }

  return warning.details ? `${warning.feature}: ${warning.details}` : warning.feature;
}

function getUsage(result: LanguageModelV3GenerateResult): SteelProviderChatResponse['usage'] {
  const inputTokens = result.usage.inputTokens.total;
  const outputTokens = result.usage.outputTokens.total;
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

export async function sendSteelOAuthChat({
  abortSignal,
  authFilePath,
  createOpenAIOAuth: injectedCreateOpenAIOAuth,
  ensureFresh = true,
  fetch,
  maxOutputTokens,
  messages,
  model,
  passThroughUnsupportedFiles,
  reasoningEffort,
  workbookContextText,
  workbookPatchTool,
}: SendSteelOAuthChatOptions): Promise<SteelProviderChatResponse> {
  const createOpenAIOAuth = injectedCreateOpenAIOAuth ?? (await loadCreateOpenAIOAuth());
  const openai = createOpenAIOAuth({
    authFilePath,
    ensureFresh,
    fetch,
    responsesState: false,
  });

  const result = await openai(model).doGenerate({
    abortSignal,
    prompt: workbookPatchTool
      ? toPromptWithWorkbookPatchTool(messages, workbookContextText)
      : toPrompt(messages),
    maxOutputTokens,
    ...(workbookPatchTool
      ? {
          tools: [workbookPatchFunctionTool],
          toolChoice: { type: 'auto' as const },
        }
      : {}),
    providerOptions: {
      openai: {
        passThroughUnsupportedFiles,
        reasoningEffort,
      },
    },
  });

  const workbookPatch = getWorkbookPatch(result);

  return {
    provider: 'openai_oauth_responses',
    model,
    text: getGeneratedText(result),
    responseId: result.response?.id,
    usage: getUsage(result),
    unsupportedSettings: [],
    warnings: result.warnings.map(getWarningText),
    ...(workbookPatch ? { workbookPatch } : {}),
  };
}
