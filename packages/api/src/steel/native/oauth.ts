import type {
  JSONValue,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FilePart,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3StreamPart,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolCallPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import type { BindToolsInput } from '@librechat/agents/langchain/language_models/chat_models';
import { AIMessageChunk, type BaseMessage } from '@librechat/agents/langchain/messages';
import type { ToolCall } from '@librechat/agents/langchain/messages/tool';
import { Runnable, type RunnableConfig } from '@librechat/agents/langchain/runnables';
import type { createOpenAIOAuth as createOpenAIOAuthType } from '@openai-oauth/ai-sdk';
import type { createOpenAIOAuthTransport as createOpenAIOAuthTransportType } from '@openai-oauth/core';
import type { openaiCredentials as openaiCredentialsType } from '@openai-oauth/local';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

import type { OpenAIOAuthTokenLoader } from './credentials';

import {
  createSystemOrderNormalizer,
  normalizeSystemOrderMarkdown,
} from '../markdown/order';
import { finalizeOcrMarkdown, OCR_COMPLETION_DIRECTIVE_MARKER } from '../markdown/ocr';
import { buildCustomerQuoteFromMarkdown, createCustomerQuoteParser } from '../markdown/quote';
import { clearOpenAIOAuthCredentialInvalid, markOpenAIOAuthCredentialInvalid } from './auth-state';
import { loadOpenAIOAuthTokens } from './credentials';
import { buildSteelCodeInterpreterAuditEvent, steelNativeStreamEventName } from './events';

const dynamicImportOpenAIOAuth = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('@openai-oauth/ai-sdk')>;
const dynamicImportOpenAIOAuthCore = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('@openai-oauth/core')>;
type CreateOpenAIOAuth = typeof createOpenAIOAuthType;
type CreateOpenAIOAuthTransport = typeof createOpenAIOAuthTransportType;
type OpenAICredentials = typeof openaiCredentialsType;
type LocalOpenAIOAuthOptions = NonNullable<Parameters<OpenAICredentials>[0]>;
type MessageContentArray = Array<Record<string, unknown>>;

export interface OpenAIOAuthProviderOptions {
  authFilePath?: string;
  createOpenAIOAuth?: CreateOpenAIOAuth;
  createOpenAIOAuthTransport?: CreateOpenAIOAuthTransport;
  ensureFresh?: boolean;
  fetch?: FetchFunction;
  loadAuthTokens?: OpenAIOAuthTokenLoader;
  openaiCredentials?: OpenAICredentials;
}

export interface OpenAIOAuthModelOptions extends OpenAIOAuthProviderOptions {
  enableCodeInterpreter?: boolean;
  frequencyPenalty?: number;
  maxOutputTokens?: number;
  model: string;
  presencePenalty?: number;
  reasoningEffort?: string;
  topP?: number;
  tools?: BindToolsInput[];
}

async function loadCreateOpenAIOAuth(): Promise<CreateOpenAIOAuth> {
  const provider = await dynamicImportOpenAIOAuth('@openai-oauth/ai-sdk');
  return provider.createOpenAIOAuth;
}

async function loadCreateOpenAIOAuthTransport(): Promise<CreateOpenAIOAuthTransport> {
  const core = await dynamicImportOpenAIOAuthCore('@openai-oauth/core');
  return core.createOpenAIOAuthTransport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function createLocalOpenAIOAuthOptions({
  authFilePath,
  ensureFresh,
  fetch,
}: Pick<
  OpenAIOAuthModelOptions,
  'authFilePath' | 'ensureFresh' | 'fetch'
>): LocalOpenAIOAuthOptions {
  return omitUndefined({
    authFilePath,
    ensureFresh,
    fetch,
  }) as LocalOpenAIOAuthOptions;
}

function createLibreChatOpenAIOAuthCredentials({
  authFilePath,
  ensureFresh,
  fetch,
  loadAuthTokens = loadOpenAIOAuthTokens,
}: Pick<
  OpenAIOAuthModelOptions,
  'authFilePath' | 'ensureFresh' | 'fetch' | 'loadAuthTokens'
>): ReturnType<OpenAICredentials> {
  return {
    kind: 'openai-oauth',
    getSession: () =>
      loadAuthTokens({
        authFilePath,
        ensureFresh,
        fetch,
      }),
  };
}

function createCodexCompatibleFetch(fetchFn: FetchFunction, authFilePath?: string): FetchFunction {
  let clientVersion: string | undefined;

  return async (input, init) => {
    const requestUrl = parseUrl(input instanceof Request ? input.url : String(input));
    const requestedVersion = requestUrl?.searchParams.get('client_version')?.trim();
    if (
      requestUrl?.pathname.endsWith('/models') &&
      requestedVersion &&
      /^\d+\.\d+\.\d+$/.test(requestedVersion)
    ) {
      clientVersion = requestedVersion;
    }

    if (!requestUrl?.pathname.endsWith('/responses') || !clientVersion) {
      const response = await fetchFn(input, init);
      if (response.status === 401) {
        markOpenAIOAuthCredentialInvalid(authFilePath);
      } else if (response.ok && requestUrl?.pathname.endsWith('/responses')) {
        clearOpenAIOAuthCredentialInvalid(authFilePath);
      }
      return response;
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('originator', 'codex_cli_rs');
    headers.set('user-agent', `codex_cli_rs/${clientVersion}`);

    const response = await fetchFn(input, {
      ...init,
      headers,
    });
    if (response.status === 401) {
      markOpenAIOAuthCredentialInvalid(authFilePath);
    } else if (response.ok) {
      clearOpenAIOAuthCredentialInvalid(authFilePath);
    }
    return response;
  };
}

export async function createStatelessOpenAIOAuthProvider(
  options: OpenAIOAuthProviderOptions,
): Promise<ReturnType<CreateOpenAIOAuth>> {
  const createOpenAIOAuth = options.createOpenAIOAuth ?? (await loadCreateOpenAIOAuth());
  const createOpenAIOAuthTransport =
    options.createOpenAIOAuthTransport ?? (await loadCreateOpenAIOAuthTransport());
  const credentials = options.openaiCredentials
    ? options.openaiCredentials(createLocalOpenAIOAuthOptions(options))
    : createLibreChatOpenAIOAuthCredentials(options);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const transport = createOpenAIOAuthTransport({
    auth: () => credentials.getSession(),
    fetch: createCodexCompatibleFetch(fetchFn, options.authFilePath),
    responsesState: false,
  });
  return createOpenAIOAuth(transport);
}

function getRunnableAbortSignal(config?: Partial<RunnableConfig>): AbortSignal | undefined {
  return (config as (Partial<RunnableConfig> & { signal?: AbortSignal }) | undefined)?.signal;
}

function parseDataUrl(value: string): { data: string; mediaType: string } | undefined {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
  if (!match) {
    return undefined;
  }

  const [, mediaType, data] = match;
  if (!mediaType || data === undefined) {
    return undefined;
  }

  return { data, mediaType };
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function getTextFromContent(content: BaseMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return '';
      }
      const text = part.text;
      if (typeof text === 'string') {
        return text;
      }
      return '';
    })
    .filter((text) => text !== '')
    .join('\n');
}

function createTextPart(text: string): LanguageModelV3TextPart | undefined {
  if (text === '') {
    return undefined;
  }

  return {
    type: 'text',
    text,
  };
}

function createTextParts(text: string): LanguageModelV3TextPart[] {
  const part = createTextPart(text);
  return part ? [part] : [];
}

function toOAuthImageDetail(part: Record<string, unknown>): 'low' | 'high' {
  const imageUrl = part.image_url;
  if (!isRecord(imageUrl)) {
    return 'high';
  }

  return imageUrl.detail === 'low' ? 'low' : 'high';
}

function createImageFilePart(part: Record<string, unknown>): LanguageModelV3FilePart | undefined {
  const imageUrl = part.image_url;
  const urlValue = isRecord(imageUrl) ? imageUrl.url : imageUrl;
  if (typeof urlValue !== 'string' || urlValue === '') {
    return undefined;
  }

  const parsed = parseDataUrl(urlValue);
  if (parsed) {
    return {
      type: 'file',
      mediaType: parsed.mediaType,
      data: parsed.data,
      ...(parsed.mediaType.startsWith('image/')
        ? {
            providerOptions: {
              openai: {
                imageDetail: toOAuthImageDetail(part),
              },
            },
          }
        : {}),
    };
  }

  const url = parseUrl(urlValue);
  if (!url) {
    return undefined;
  }

  return {
    type: 'file',
    mediaType: 'image/*',
    data: url,
    providerOptions: {
      openai: {
        imageDetail: toOAuthImageDetail(part),
      },
    },
  };
}

function createInputFilePart(part: Record<string, unknown>): LanguageModelV3FilePart | undefined {
  const fileData = part.file_data;
  if (typeof fileData === 'string' && fileData !== '') {
    const parsed = parseDataUrl(fileData);
    if (!parsed) {
      return undefined;
    }

    return {
      type: 'file',
      filename: typeof part.filename === 'string' ? part.filename : undefined,
      mediaType: parsed.mediaType,
      data: parsed.data,
    };
  }

  const fileUrl = parseUrl(part.file_url);
  if (!fileUrl) {
    return undefined;
  }
  return {
    type: 'file',
    filename: typeof part.filename === 'string' ? part.filename : undefined,
    mediaType: typeof part.media_type === 'string' ? part.media_type : 'application/pdf',
    data: fileUrl,
  };
}

function createOpenAIFilePart(part: Record<string, unknown>): LanguageModelV3FilePart | undefined {
  const file = part.file;
  if (!isRecord(file)) {
    return undefined;
  }

  const fileData = file.file_data;
  if (typeof fileData !== 'string' || fileData === '') {
    return undefined;
  }

  const parsed = parseDataUrl(fileData);
  if (!parsed) {
    return undefined;
  }

  return {
    type: 'file',
    filename: typeof file.filename === 'string' ? file.filename : undefined,
    mediaType: parsed.mediaType,
    data: parsed.data,
  };
}

function toUserContentPart(
  part: Record<string, unknown>,
): LanguageModelV3TextPart | LanguageModelV3FilePart | undefined {
  if (part.type === 'text' && typeof part.text === 'string') {
    return createTextPart(part.text);
  }
  if (part.type === 'image_url' || part.type === 'image') {
    return createImageFilePart(part);
  }
  if (part.type === 'input_file') {
    return createInputFilePart(part);
  }
  if (part.type === 'file') {
    return createOpenAIFilePart(part);
  }
  return undefined;
}

function contentToUserParts(
  content: BaseMessage['content'],
): Array<LanguageModelV3TextPart | LanguageModelV3FilePart> {
  if (typeof content === 'string') {
    return createTextParts(content);
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return (content as MessageContentArray)
    .map(toUserContentPart)
    .filter((part): part is LanguageModelV3TextPart | LanguageModelV3FilePart => part != null);
}

function parseToolInput(input: unknown): unknown {
  if (typeof input !== 'string') {
    return input;
  }

  try {
    return JSON.parse(input) as unknown;
  } catch {
    return { input };
  }
}

function toAssistantToolCallPart(call: ToolCall): LanguageModelV3ToolCallPart {
  return {
    type: 'tool-call',
    toolCallId: call.id ?? call.name,
    toolName: call.name,
    input: call.args,
  };
}

function contentToAssistantParts(
  content: BaseMessage['content'],
): Array<LanguageModelV3TextPart | LanguageModelV3FilePart | LanguageModelV3ToolCallPart> {
  const parts = contentToUserParts(content);
  if (parts.length > 0) {
    return parts;
  }

  const text = getTextFromContent(content);
  return createTextParts(text);
}

function getMessageToolCalls(message: BaseMessage): ToolCall[] {
  const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.filter((call): call is ToolCall => {
    if (!isRecord(call)) {
      return false;
    }
    return typeof call.name === 'string';
  });
}

function toLanguageModelMessage(message: BaseMessage): LanguageModelV3Message | undefined {
  const type = message._getType();

  if (type === 'system') {
    return {
      role: 'system',
      content: getTextFromContent(message.content),
    };
  }

  if (type === 'human') {
    return {
      role: 'user',
      content: contentToUserParts(message.content),
    };
  }

  if (type === 'ai') {
    const content = contentToAssistantParts(message.content);
    const toolCalls = getMessageToolCalls(message).map(toAssistantToolCallPart);

    return {
      role: 'assistant',
      content: [...content, ...toolCalls],
    };
  }

  if (type === 'tool') {
    const toolMessage = message as { tool_call_id?: string; name?: string };
    const toolCallId = toolMessage.tool_call_id ?? toolMessage.name ?? 'tool_call';
    const toolName = toolMessage.name ?? 'tool';
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName,
          output: {
            type: 'text',
            value: getTextFromContent(message.content),
          },
        },
      ],
    };
  }

  return undefined;
}

function toPrompt(messages: BaseMessage[]): LanguageModelV3Prompt {
  return messages
    .map(toLanguageModelMessage)
    .filter((message): message is LanguageModelV3Message => message != null);
}

function isZodSchema(value: unknown): value is ZodTypeAny {
  return isRecord(value) && isRecord(value._def);
}

function toJsonSchema(value: unknown): LanguageModelV3FunctionTool['inputSchema'] {
  if (isZodSchema(value)) {
    return zodToJsonSchema(value) as LanguageModelV3FunctionTool['inputSchema'];
  }

  if (isRecord(value)) {
    return value as LanguageModelV3FunctionTool['inputSchema'];
  }

  return {
    type: 'object',
    properties: {},
  };
}

function getToolFunction(tool: BindToolsInput): Record<string, unknown> | undefined {
  if (!isRecord(tool)) {
    return undefined;
  }

  if (tool.type === 'function' && isRecord(tool.function)) {
    return tool.function;
  }

  return tool;
}

function toLanguageModelTool(tool: BindToolsInput): LanguageModelV3FunctionTool | undefined {
  const fn = getToolFunction(tool);
  if (!fn || typeof fn.name !== 'string') {
    return undefined;
  }

  return {
    type: 'function',
    name: fn.name,
    description: typeof fn.description === 'string' ? fn.description : undefined,
    inputSchema: toJsonSchema(fn.parameters ?? fn.schema),
  };
}

function toLanguageModelTools(
  tools?: BindToolsInput[],
  enableCodeInterpreter?: boolean,
): Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool> | undefined {
  const converted: Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool> = (tools ?? [])
    .map(toLanguageModelTool)
    .filter((tool): tool is LanguageModelV3FunctionTool => tool != null);

  if (enableCodeInterpreter) {
    converted.push({
      type: 'provider',
      id: 'openai.code_interpreter',
      name: 'code_interpreter',
      args: {},
    });
  }

  return converted.length > 0 ? converted : undefined;
}

function toJsonValue(value: unknown): JSONValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, toJsonValue(entryValue)]),
    );
  }

  return String(value);
}

function toToolCall(part: LanguageModelV3ToolCall): ToolCall {
  const args = parseToolInput(part.input);

  return {
    id: part.toolCallId,
    name: part.toolName,
    args: isRecord(args) ? args : { input: toJsonValue(args) },
    type: 'tool_call',
  };
}

function getGeneratedText(content: LanguageModelV3GenerateResult['content']): string {
  return content.reduce((text, part) => {
    if (part.type !== 'text') {
      return text;
    }

    return `${text}${part.text}`;
  }, '');
}

function toUsageMetadata(usage?: LanguageModelV3Usage): AIMessageChunk['usage_metadata'] {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.inputTokens.total;
  const outputTokens = usage.outputTokens.total;
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

function getFinishReason(
  finishReason?: LanguageModelV3GenerateResult['finishReason'],
): string | undefined {
  return finishReason?.raw ?? finishReason?.unified;
}

function createResponseMetadata({
  finishReason,
  model,
  response,
}: {
  finishReason?: LanguageModelV3GenerateResult['finishReason'];
  model: string;
  response?: LanguageModelV3GenerateResult['response'];
}): AIMessageChunk['response_metadata'] {
  return omitUndefined({
    id: response?.id,
    finish_reason: getFinishReason(finishReason),
    model: response?.modelId ?? model,
    model_provider: 'openai_oauth_responses',
  });
}

function hasCurrentTurnPriceResult(messages: BaseMessage[]): boolean {
  let foundPriceResult = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message._getType() === 'human') {
      return foundPriceResult;
    }

    if (message._getType() !== 'tool') {
      continue;
    }

    const toolName = (message as BaseMessage & { name?: unknown }).name;
    if (toolName === 'search_price_candidates') {
      foundPriceResult = true;
    }
  }

  return false;
}

function isCompletedTextResult(
  finishReason?: LanguageModelV3GenerateResult['finishReason'],
): boolean {
  return finishReason?.unified === 'stop' || finishReason?.raw === 'stop';
}

function renderCustomerQuoteInsertion(
  beforeQuote: string,
  quoteMarkdown: string,
  afterQuote: string,
): string {
  let beforeSeparator = '\n\n';
  if (/(?:\r?\n){2}$/.test(beforeQuote)) {
    beforeSeparator = '';
  } else if (/\r?\n$/.test(beforeQuote)) {
    beforeSeparator = '\n';
  }

  if (afterQuote === '') {
    return `${beforeSeparator}${quoteMarkdown}`;
  }

  const normalizedAfter = afterQuote.replace(/^(?:\r?\n)+/, '');
  return `${beforeSeparator}${quoteMarkdown}\n\n${normalizedAfter}`;
}

function composeCustomerQuote(text: string): string | undefined {
  const quote = buildCustomerQuoteFromMarkdown(text);
  if (!quote) {
    return undefined;
  }

  const beforeQuote = text.slice(0, quote.sourceEnd);
  const afterQuote = text.slice(quote.sourceEnd);
  return `${beforeQuote}${renderCustomerQuoteInsertion(beforeQuote, quote.markdown, afterQuote)}`;
}

function hasClientToolCall(content: LanguageModelV3GenerateResult['content']): boolean {
  return content.some((part) => part.type === 'tool-call' && part.providerExecuted !== true);
}

function hasOcrCompletionDirective(messages: BaseMessage[]): boolean {
  return messages.some((message) =>
    getTextFromContent(message.content)
      .split(/\r?\n/u)
      .some((line) => line === OCR_COMPLETION_DIRECTIVE_MARKER),
  );
}

function shouldInspectCodeInterpreter(
  messages: BaseMessage[],
  options: OpenAIOAuthModelOptions,
): boolean {
  return options.enableCodeInterpreter !== false && hasCurrentTurnPriceResult(messages);
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const property = value[key];
  return typeof property === 'string' && property !== '' ? property : undefined;
}

function getSteelQuoteAuditEventInput(
  config?: Partial<RunnableConfig>,
): Omit<Parameters<typeof buildSteelCodeInterpreterAuditEvent>[0], 'stage'> {
  const configurable = config?.configurable;
  const requestBodyRecord = isRecord(configurable) ? configurable.requestBody : undefined;

  return {
    conversationId: getStringProperty(configurable, 'thread_id'),
    requestId:
      getStringProperty(configurable, 'requestId') ??
      getStringProperty(requestBodyRecord, 'requestId'),
    messageId:
      getStringProperty(requestBodyRecord, 'messageId') ??
      getStringProperty(configurable, 'message_id'),
    providerToolCallId: getStringProperty(configurable, 'providerToolCallId'),
    toolName: getStringProperty(configurable, 'toolName'),
  };
}

type SteelCodeInterpreterAuditStage = 'stage_1' | 'stage_2';
type SteelCodeInterpreterAuditPart =
  | LanguageModelV3GenerateResult['content'][number]
  | LanguageModelV3StreamPart;

function isProviderCodeInterpreterToolCall(
  part: SteelCodeInterpreterAuditPart,
): part is LanguageModelV3ToolCall {
  return (
    part.type === 'tool-call' &&
    part.toolName === 'code_interpreter' &&
    part.providerExecuted === true
  );
}

function createSteelCodeInterpreterAuditDispatcher(
  config?: Partial<RunnableConfig>,
): (
  stage: SteelCodeInterpreterAuditStage,
  parts: SteelCodeInterpreterAuditPart[],
) => Promise<void> {
  const seen = new Set<string>();
  const eventInput = getSteelQuoteAuditEventInput(config);

  return async (stage, parts) => {
    if (!config) {
      return;
    }

    for (const part of parts) {
      if (!isProviderCodeInterpreterToolCall(part)) {
        continue;
      }

      const providerToolCallId = part.toolCallId !== '' ? part.toolCallId : undefined;
      const key = `${stage}:${providerToolCallId ?? ''}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      await dispatchCustomEvent(
        steelNativeStreamEventName,
        buildSteelCodeInterpreterAuditEvent({
          ...eventInput,
          stage,
          providerToolCallId,
        }),
        config as RunnableConfig,
      );
    }
  };
}

function toMessageChunk(result: LanguageModelV3GenerateResult, model: string): AIMessageChunk {
  const toolCalls = result.content
    .filter(
      (part): part is LanguageModelV3ToolCall =>
        part.type === 'tool-call' && part.providerExecuted !== true,
    )
    .map(toToolCall);

  return new AIMessageChunk({
    content: getGeneratedText(result.content),
    response_metadata: createResponseMetadata({
      finishReason: result.finishReason,
      model,
      response: result.response,
    }),
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage_metadata: toUsageMetadata(result.usage),
  });
}

function createCallOptions({
  config,
  messages,
  options,
  toolChoice,
  tools,
}: {
  config?: Partial<RunnableConfig>;
  messages: BaseMessage[];
  options: OpenAIOAuthModelOptions;
  toolChoice?: LanguageModelV3CallOptions['toolChoice'];
  tools?: BindToolsInput[];
}): LanguageModelV3CallOptions {
  const languageModelTools = toLanguageModelTools(tools, options.enableCodeInterpreter !== false);

  return omitUndefined({
    abortSignal: getRunnableAbortSignal(config),
    frequencyPenalty: options.frequencyPenalty,
    maxOutputTokens: options.maxOutputTokens,
    presencePenalty: options.presencePenalty,
    prompt: toPrompt(messages),
    topP: options.topP,
    ...(languageModelTools
      ? {
          tools: languageModelTools,
          toolChoice: toolChoice ?? { type: 'auto' as const },
        }
      : {}),
    ...(options.reasoningEffort
      ? {
          providerOptions: {
            openai: {
              reasoningEffort: options.reasoningEffort,
            },
          },
        }
      : {}),
  }) as LanguageModelV3CallOptions;
}

function toStreamToolCallChunk(part: LanguageModelV3ToolCall, model: string): AIMessageChunk {
  return new AIMessageChunk({
    content: '',
    response_metadata: createResponseMetadata({ model }),
    tool_calls: [toToolCall(part)],
  });
}

function toStreamTextChunk(delta: string, model: string): AIMessageChunk {
  return new AIMessageChunk({
    content: delta,
    response_metadata: createResponseMetadata({ model }),
  });
}

function toStreamFinalChunk({
  finishReason,
  model,
  response,
  usage,
}: {
  finishReason?: LanguageModelV3GenerateResult['finishReason'];
  model: string;
  response?: LanguageModelV3GenerateResult['response'];
  usage?: LanguageModelV3Usage;
}): AIMessageChunk {
  return new AIMessageChunk({
    content: '',
    response_metadata: createResponseMetadata({
      finishReason,
      model,
      response,
    }),
    usage_metadata: toUsageMetadata(usage),
  });
}

export class OpenAIOAuthModel extends Runnable<BaseMessage[], AIMessageChunk, RunnableConfig> {
  readonly providerId = 'openai_oauth_responses';

  lc_namespace: string[] = ['librechat', 'openai_oauth'];

  private providerModel: LanguageModelV3 | undefined;

  constructor(private readonly options: OpenAIOAuthModelOptions) {
    super();
  }

  bindTools(tools: BindToolsInput[]): OpenAIOAuthModel {
    return new OpenAIOAuthModel({
      ...this.options,
      tools,
    });
  }

  async invoke(messages: BaseMessage[], config?: Partial<RunnableConfig>): Promise<AIMessageChunk> {
    const providerModel = await this.getProviderModel();
    const ocrMode = hasOcrCompletionDirective(messages);
    const inspectCodeInterpreter = shouldInspectCodeInterpreter(messages, this.options);
    const dispatchCodeInterpreterAudit = createSteelCodeInterpreterAuditDispatcher(config);
    const result = await providerModel.doGenerate(
      createCallOptions({
        config,
        messages,
        options: this.options,
        tools: this.options.tools,
      }),
    );

    if (inspectCodeInterpreter) {
      await dispatchCodeInterpreterAudit('stage_1', result.content);
    }

    const generatedText = getGeneratedText(result.content);
    if (ocrMode) {
      const finalizedText =
        isCompletedTextResult(result.finishReason) &&
        !result.content.some((part) => part.type === 'error') &&
        !hasClientToolCall(result.content)
          ? finalizeOcrMarkdown(generatedText)
          : generatedText;
      if (finalizedText === generatedText) {
        return toMessageChunk(result, this.options.model);
      }

      return toMessageChunk(
        {
          ...result,
          content: [
            { type: 'text', text: finalizedText },
            ...result.content.filter((part) => part.type !== 'text'),
          ],
        },
        this.options.model,
      );
    }

    const normalizedText =
      inspectCodeInterpreter &&
      !result.content.some((part) => part.type === 'error') &&
      !hasClientToolCall(result.content) &&
      isCompletedTextResult(result.finishReason)
        ? normalizeSystemOrderMarkdown(generatedText)
        : undefined;
    const finalizedText = normalizedText
      ? (composeCustomerQuote(normalizedText) ?? normalizedText)
      : undefined;
    if (!finalizedText || finalizedText === generatedText) {
      return toMessageChunk(result, this.options.model);
    }

    return toMessageChunk(
      {
        ...result,
        content: [
          { type: 'text', text: finalizedText },
          ...result.content.filter((part) => part.type !== 'text'),
        ],
      },
      this.options.model,
    );
  }

  protected async *_streamIterator(
    messages: BaseMessage[],
    config?: Partial<RunnableConfig>,
  ): AsyncGenerator<AIMessageChunk> {
    const providerModel = await this.getProviderModel();

    if (typeof providerModel.doStream !== 'function') {
      yield await this.invoke(messages, config);
      return;
    }

    const result = await providerModel.doStream(
      createCallOptions({
        config,
        messages,
        options: this.options,
        tools: this.options.tools,
      }),
    );

    const ocrMode = hasOcrCompletionDirective(messages);
    const inspectCodeInterpreter = shouldInspectCodeInterpreter(messages, this.options);
    const dispatchCodeInterpreterAudit = createSteelCodeInterpreterAuditDispatcher(config);
    const reader = result.stream.getReader();

    if (ocrMode) {
      let generatedText = '';
      let response: LanguageModelV3GenerateResult['response'];
      let usage: LanguageModelV3Usage | undefined;
      let finishReason: LanguageModelV3GenerateResult['finishReason'] | undefined;
      let completed = false;
      let streamError: Error | undefined;
      let hasClientTool = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            completed = true;
            break;
          }

          if (inspectCodeInterpreter) {
            await dispatchCodeInterpreterAudit('stage_1', [value]);
          }

          if (value.type === 'text-delta') {
            generatedText += value.delta;
            if (value.delta !== '') {
              yield toStreamTextChunk(value.delta, this.options.model);
            }
            continue;
          }

          if (value.type === 'response-metadata') {
            response = value;
            continue;
          }

          if (value.type === 'finish') {
            usage = value.usage;
            finishReason = value.finishReason;
            continue;
          }

          if (value.type === 'error') {
            streamError =
              value.error instanceof Error ? value.error : new Error(String(value.error));
            break;
          }

          if (
            (value.type === 'tool-call' && value.providerExecuted !== true) ||
            (value.type === 'tool-input-start' && value.providerExecuted !== true)
          ) {
            hasClientTool = true;
            if (value.type === 'tool-call') {
              yield toStreamToolCallChunk(value, this.options.model);
            }
          }
        }
      } catch (error) {
        streamError = error instanceof Error ? error : new Error(String(error));
      } finally {
        if (!completed) {
          await reader.cancel().catch(() => undefined);
        }
        reader.releaseLock();
      }

      if (streamError) {
        throw streamError;
      }

      if (!hasClientTool && isCompletedTextResult(finishReason)) {
        const finalizedText = finalizeOcrMarkdown(generatedText);
        if (
          finalizedText.startsWith(generatedText) &&
          finalizedText.length > generatedText.length
        ) {
          yield toStreamTextChunk(finalizedText.slice(generatedText.length), this.options.model);
        }
      }
      yield toStreamFinalChunk({ finishReason, model: this.options.model, response, usage });
      return;
    }

    const quoteParser = inspectCodeInterpreter ? createCustomerQuoteParser() : undefined;
    const orderNormalizer = inspectCodeInterpreter ? createSystemOrderNormalizer() : undefined;
    let generatedText = '';
    let emittedTextLength = 0;
    let response: LanguageModelV3GenerateResult['response'];
    let usage: LanguageModelV3Usage | undefined;
    let finishReason: LanguageModelV3GenerateResult['finishReason'] | undefined;
    let bypassQuote = false;
    let completed = false;
    let streamError: Error | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          completed = true;
          break;
        }

        if (inspectCodeInterpreter) {
          await dispatchCodeInterpreterAudit('stage_1', [value]);
        }

        if (value.type === 'text-delta') {
          if (!quoteParser || !orderNormalizer) {
            yield toStreamTextChunk(value.delta, this.options.model);
            continue;
          }

          if (bypassQuote) {
            generatedText += value.delta;
            yield toStreamTextChunk(value.delta, this.options.model);
            emittedTextLength = generatedText.length;
            continue;
          }

          const normalizedDelta = orderNormalizer.append(value.delta);
          generatedText += normalizedDelta;
          quoteParser.append(normalizedDelta);
          const safeEnd = quoteParser.getSafeTextEnd();
          if (safeEnd > emittedTextLength) {
            yield toStreamTextChunk(
              generatedText.slice(emittedTextLength, safeEnd),
              this.options.model,
            );
            emittedTextLength = safeEnd;
          }
          continue;
        }

        if (
          (value.type === 'tool-call' && value.providerExecuted !== true) ||
          (value.type === 'tool-input-start' && value.providerExecuted !== true) ||
          value.type === 'error'
        ) {
          const pendingText = orderNormalizer?.finish({ raw: true }) ?? '';
          generatedText += pendingText;
          if (generatedText.length > emittedTextLength) {
            yield toStreamTextChunk(generatedText.slice(emittedTextLength), this.options.model);
            emittedTextLength = generatedText.length;
          }

          if (value.type === 'error') {
            throw value.error instanceof Error ? value.error : new Error(String(value.error));
          }
          bypassQuote = true;
          if (value.type === 'tool-call' && value.providerExecuted !== true) {
            yield toStreamToolCallChunk(value, this.options.model);
          }
          continue;
        }

        if (value.type === 'response-metadata') {
          response = value;
        } else if (value.type === 'finish') {
          usage = value.usage;
          finishReason = value.finishReason;
        }
      }
    } catch (error) {
      streamError = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (!completed) {
        await reader.cancel().catch(() => undefined);
      }
      reader.releaseLock();
    }

    if (streamError) {
      generatedText += orderNormalizer?.finish({ raw: true }) ?? '';
      if (generatedText.length > emittedTextLength) {
        yield toStreamTextChunk(generatedText.slice(emittedTextLength), this.options.model);
      }
      throw streamError;
    }

    if (orderNormalizer && !bypassQuote) {
      const pendingText = orderNormalizer.finish({ raw: !isCompletedTextResult(finishReason) });
      generatedText += pendingText;
      quoteParser?.append(pendingText);
    }

    const quote =
      quoteParser && !bypassQuote && isCompletedTextResult(finishReason)
        ? quoteParser.finish()
        : undefined;
    if (quote && emittedTextLength <= quote.sourceEnd) {
      if (quote.sourceEnd > emittedTextLength) {
        yield toStreamTextChunk(
          generatedText.slice(emittedTextLength, quote.sourceEnd),
          this.options.model,
        );
      }

      const beforeQuote = generatedText.slice(0, quote.sourceEnd);
      const afterQuote = generatedText.slice(quote.sourceEnd);
      yield toStreamTextChunk(
        renderCustomerQuoteInsertion(beforeQuote, quote.markdown, afterQuote),
        this.options.model,
      );
      emittedTextLength = generatedText.length;
    } else if (generatedText.length > emittedTextLength) {
      yield toStreamTextChunk(generatedText.slice(emittedTextLength), this.options.model);
    }
    yield toStreamFinalChunk({ finishReason, model: this.options.model, response, usage });
  }

  private async getProviderModel(): Promise<LanguageModelV3> {
    if (this.providerModel) {
      return this.providerModel;
    }

    const provider = await createStatelessOpenAIOAuthProvider(this.options);
    this.providerModel = provider(this.options.model);
    return this.providerModel;
  }
}

export function createOpenAIOAuthModel(options: OpenAIOAuthModelOptions): OpenAIOAuthModel {
  return new OpenAIOAuthModel(options);
}

export interface OpenAIOAuthGraphModelOptions {
  boundTools?: BindToolsInput[];
  getSystemRunnable?: () =>
    | Runnable<BaseMessage[], BaseMessage[], RunnableConfig<Record<string, unknown>>>
    | undefined;
  getTools?: () => BindToolsInput[] | undefined;
  modelOptions: Omit<OpenAIOAuthModelOptions, 'tools'>;
  terminalToolNames?: readonly string[];
}

export class OpenAIOAuthGraphModel extends Runnable<BaseMessage[], AIMessageChunk, RunnableConfig> {
  readonly providerId = 'openai_oauth_responses';

  lc_namespace: string[] = ['librechat', 'openai_oauth'];

  constructor(private readonly options: OpenAIOAuthGraphModelOptions) {
    super();
  }

  private async prepareMessages(
    messages: BaseMessage[],
    config?: Partial<RunnableConfig>,
  ): Promise<BaseMessage[]> {
    if (messages[0]?._getType() === 'system') {
      return messages;
    }

    const systemRunnable = this.options.getSystemRunnable?.();
    if (!systemRunnable) {
      return messages;
    }

    return systemRunnable.invoke(messages, config as RunnableConfig<Record<string, unknown>>);
  }

  private getTools(): BindToolsInput[] | undefined {
    return this.options.boundTools ?? this.options.getTools?.();
  }

  private getTerminalToolResponse(messages: BaseMessage[]): AIMessageChunk | undefined {
    let terminalMessage: BaseMessage | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message._getType() !== 'tool') {
        break;
      }
      const toolName = (message as BaseMessage & { name?: unknown }).name;
      if (typeof toolName === 'string' && this.options.terminalToolNames?.includes(toolName)) {
        terminalMessage = message;
        break;
      }
    }
    if (!terminalMessage) {
      return undefined;
    }

    const artifact = (terminalMessage as BaseMessage & { artifact?: unknown }).artifact;
    return new AIMessageChunk({
      content:
        artifact !== null &&
        typeof artifact === 'object' &&
        !Array.isArray(artifact) &&
        (artifact as { delegateOcrStreamed?: unknown }).delegateOcrStreamed === true
          ? ''
          : terminalMessage.content,
    });
  }

  bindTools(tools: BindToolsInput[]): OpenAIOAuthGraphModel {
    return new OpenAIOAuthGraphModel({
      ...this.options,
      boundTools: tools,
    });
  }

  async invoke(messages: BaseMessage[], config?: Partial<RunnableConfig>): Promise<AIMessageChunk> {
    const terminalResponse = this.getTerminalToolResponse(messages);
    if (terminalResponse) {
      return terminalResponse;
    }

    const preparedMessages = await this.prepareMessages(messages, config);
    return createOpenAIOAuthModel({
      ...this.options.modelOptions,
      tools: this.getTools(),
    }).invoke(preparedMessages, config);
  }

  protected async *_streamIterator(
    messages: BaseMessage[],
    config?: Partial<RunnableConfig>,
  ): AsyncGenerator<AIMessageChunk> {
    const terminalResponse = this.getTerminalToolResponse(messages);
    if (terminalResponse) {
      yield terminalResponse;
      return;
    }

    const preparedMessages = await this.prepareMessages(messages, config);
    const stream = await createOpenAIOAuthModel({
      ...this.options.modelOptions,
      tools: this.getTools(),
    }).stream(preparedMessages, config);

    for await (const chunk of stream) {
      yield chunk;
    }
  }
}

export function createOpenAIOAuthGraphModel(
  options: OpenAIOAuthGraphModelOptions,
): OpenAIOAuthGraphModel {
  return new OpenAIOAuthGraphModel(options);
}
