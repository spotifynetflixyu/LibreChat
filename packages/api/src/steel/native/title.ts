import { Providers, TitleMethod, initializeModel } from '@librechat/agents';
import { EModelEndpoint } from 'librechat-data-provider';
import type { Runnable, RunnableConfig } from '@librechat/agents/langchain/runnables';
import { HumanMessage, SystemMessage } from '@librechat/agents/langchain/messages';
import { PromptTemplate } from '@librechat/agents/langchain/prompts';
import { RunnableLambda, RunnableSequence } from '@librechat/agents/langchain/runnables';
import type { AIMessageChunk } from '@librechat/agents/langchain/messages';
import type { ChatModelInstance, ClientOptions, RunTitleOptions } from '@librechat/agents';
import type { OpenAIOAuthModelOptions } from './oauth';
import { parseOpenAIConfig, resolveOpenAIOAuthAuthFilePath } from '../ai/config';
import { createOpenAIOAuthModel } from './oauth';

export interface OpenAIOAuthTitleContentPart {
  text?: string;
  type?: string;
}

export interface OpenAIOAuthTitleUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface GenerateTitleInput {
  endpoint?: string;
  provider: RunTitleOptions['provider'] | string;
  clientOptions?: ClientOptions;
  contentParts?: OpenAIOAuthTitleContentPart[];
  createOpenAIOAuth?: OpenAIOAuthModelOptions['createOpenAIOAuth'];
  inputText: string;
  skipLanguage?: boolean;
  titleMethod?: TitleMethod;
  titlePrompt?: string;
  titlePromptTemplate?: string;
  chainOptions?: Partial<RunnableConfig>;
}

export interface GenerateTitleResult {
  language?: string;
  model?: string;
  title?: string;
  usage?: OpenAIOAuthTitleUsage;
}

const defaultTitlePrompt = `Provide a concise, 5-word-or-less title for the conversation. Only return the title itself.

Conversation:
{convo}`;

const structuredTitlePrompt = `Analyze this conversation and provide:
1. The detected language of the conversation
2. A concise title in the detected language (5 words or less, no punctuation or quotation)

{convo}`;

const defaultTitleTemplate = 'User: {input}';

const titleSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description:
        'A concise title for the conversation in 5 words or less, without punctuation or quotation',
    },
  },
  required: ['title'],
} as const;

const combinedTitleSchema = {
  type: 'object',
  properties: {
    language: {
      type: 'string',
      description: 'The detected language of the conversation',
    },
    title: {
      type: 'string',
      description:
        'A concise title for the conversation in 5 words or less, without punctuation or quotation',
    },
  },
  required: ['language', 'title'],
} as const;

type TitleResult = Pick<GenerateTitleResult, 'language' | 'title'>;
type StructuredTitleModel = ChatModelInstance & {
  withStructuredOutput: (schema: typeof titleSchema | typeof combinedTitleSchema) => Runnable;
};

function replaceTemplateValues(
  template: string,
  values: {
    content: string;
    input: string;
    output: string;
  },
): string {
  return template
    .replaceAll('{{content}}', values.content)
    .replaceAll('{content}', values.content)
    .replaceAll('{{conversation}}', values.content)
    .replaceAll('{conversation}', values.content)
    .replaceAll('{{convo}}', values.content)
    .replaceAll('{convo}', values.content)
    .replaceAll('{{input}}', values.input)
    .replaceAll('{input}', values.input)
    .replaceAll('{{output}}', values.output)
    .replaceAll('{output}', values.output);
}

function createConversationText({
  inputText,
  titlePromptTemplate,
}: Pick<GenerateTitleInput, 'inputText' | 'titlePromptTemplate'>): string {
  const output = '';
  const content = `User: ${inputText}`;
  return replaceTemplateValues(titlePromptTemplate ?? defaultTitleTemplate, {
    content,
    input: inputText,
    output,
  }).trim();
}

function normalizeTitlePrompt(titlePrompt?: string): string | undefined {
  if (!titlePrompt) {
    return undefined;
  }

  const normalized = titlePrompt
    .replaceAll('{{content}}', '{convo}')
    .replaceAll('{content}', '{convo}')
    .replaceAll('{{conversation}}', '{convo}')
    .replaceAll('{conversation}', '{convo}')
    .replaceAll('{{convo}}', '{convo}');

  if (normalized.includes('{convo}')) {
    return normalized;
  }

  return `${normalized.trim()}\n\nConversation:\n{convo}`;
}

function createTitlePrompt({
  conversation,
  inputText,
  titlePrompt,
}: {
  conversation: string;
  inputText: string;
  titlePrompt?: string;
}): string {
  const prompt = normalizeTitlePrompt(titlePrompt) ?? defaultTitlePrompt;
  const rendered = replaceTemplateValues(prompt, {
    content: conversation,
    input: inputText,
    output: '',
  }).trim();

  if (rendered.includes(conversation)) {
    return rendered;
  }

  return `${rendered}\n\nConversation:\n${conversation}`;
}

function getMessageText(message: AIMessageChunk): string {
  if (typeof message.content === 'string') {
    return message.content.trim();
  }

  if (!Array.isArray(message.content)) {
    return '';
  }

  return message.content
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('')
    .trim();
}

function getUsage(message: AIMessageChunk): OpenAIOAuthTitleUsage | undefined {
  const inputTokens = message.usage_metadata?.input_tokens;
  const outputTokens = message.usage_metadata?.output_tokens;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    return undefined;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };
}

function isOpenAIOAuthTitleRequest({
  endpoint,
  provider,
}: Pick<GenerateTitleInput, 'endpoint' | 'provider'>): boolean {
  return endpoint === EModelEndpoint.openAIOAuth || provider === EModelEndpoint.openAIOAuth;
}

function getClientModel(clientOptions: ClientOptions | undefined): string | undefined {
  const options = clientOptions as Partial<{ model: string }> | undefined;
  return typeof options?.model === 'string' ? options.model : undefined;
}

function isStructuredTitleModel(model: ChatModelInstance): model is StructuredTitleModel {
  const candidate = model as ChatModelInstance & { withStructuredOutput?: unknown };
  return typeof candidate.withStructuredOutput === 'function';
}

async function invokeCompletionTitle({
  chainOptions,
  conversation,
  inputText,
  model,
  titlePrompt,
}: {
  chainOptions?: Partial<RunnableConfig>;
  conversation: string;
  inputText: string;
  model: ChatModelInstance;
  titlePrompt?: string;
}): Promise<TitleResult> {
  const prompt = PromptTemplate.fromTemplate(
    normalizeTitlePrompt(titlePrompt) ?? defaultTitlePrompt,
  );
  const extractTitle = new RunnableLambda({
    func: (response: AIMessageChunk): TitleResult => ({
      title: getMessageText(response),
    }),
  });
  const chain = RunnableSequence.from([prompt, model, extractTitle]);
  return (await chain.invoke(
    {
      convo: conversation,
      input: inputText,
      output: '',
    },
    chainOptions,
  )) as TitleResult;
}

async function invokeStructuredTitle({
  chainOptions,
  conversation,
  inputText,
  model,
  skipLanguage,
  titlePrompt,
}: {
  chainOptions?: Partial<RunnableConfig>;
  conversation: string;
  inputText: string;
  model: ChatModelInstance;
  skipLanguage?: boolean;
  titlePrompt?: string;
}): Promise<TitleResult> {
  if (!isStructuredTitleModel(model)) {
    return invokeCompletionTitle({ chainOptions, conversation, inputText, model, titlePrompt });
  }

  const prompt = PromptTemplate.fromTemplate(
    normalizeTitlePrompt(titlePrompt) ?? structuredTitlePrompt,
  );
  const input = {
    convo: conversation,
    input: inputText,
    output: '',
  };
  const chain = RunnableSequence.from([
    prompt,
    model.withStructuredOutput(skipLanguage ? titleSchema : combinedTitleSchema),
  ]);

  const result = (await chain.invoke(input, chainOptions)) as TitleResult;
  return skipLanguage
    ? result
    : {
        language: result.language ?? 'English',
        title: result.title ?? '',
      };
}

async function generateResponsesTitle({
  chainOptions,
  clientOptions,
  createOpenAIOAuth,
  inputText,
  titlePrompt,
  titlePromptTemplate,
}: GenerateTitleInput): Promise<GenerateTitleResult> {
  const config = parseOpenAIConfig(process.env);
  const selectedModel = getClientModel(clientOptions) || config.model;
  const conversation = createConversationText({
    inputText,
    titlePromptTemplate,
  });
  const prompt = createTitlePrompt({
    conversation,
    inputText,
    titlePrompt,
  });
  const titleModel = createOpenAIOAuthModel({
    authFilePath: resolveOpenAIOAuthAuthFilePath(process.env),
    createOpenAIOAuth,
    maxOutputTokens: 64,
    model: selectedModel,
    reasoningEffort: 'none',
    temperature: 0.2,
  });
  const message = await titleModel.invoke(
    [new SystemMessage('Generate only a concise conversation title.'), new HumanMessage(prompt)],
    chainOptions,
  );

  return {
    model: selectedModel,
    title: getMessageText(message),
    usage: getUsage(message),
  };
}

export async function generateTitle(input: GenerateTitleInput): Promise<GenerateTitleResult> {
  if (isOpenAIOAuthTitleRequest(input)) {
    return generateResponsesTitle(input);
  }

  const conversation = createConversationText({
    inputText: input.inputText,
    titlePromptTemplate: input.titlePromptTemplate,
  });
  const model = initializeModel({
    provider: input.provider as Providers,
    clientOptions: input.clientOptions,
  }) as ChatModelInstance;
  const titleMethod = input.titleMethod ?? TitleMethod.COMPLETION;
  const result =
    titleMethod === TitleMethod.COMPLETION
      ? await invokeCompletionTitle({
          chainOptions: input.chainOptions,
          conversation,
          inputText: input.inputText,
          model,
          titlePrompt: input.titlePrompt,
        })
      : await invokeStructuredTitle({
          chainOptions: input.chainOptions,
          conversation,
          inputText: input.inputText,
          model,
          skipLanguage: input.skipLanguage,
          titlePrompt: input.titlePrompt,
        });

  return {
    ...result,
    model: getClientModel(input.clientOptions),
  };
}
