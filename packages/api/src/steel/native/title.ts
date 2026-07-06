import { HumanMessage, SystemMessage } from '@librechat/agents/langchain/messages';
import type { AIMessageChunk } from '@librechat/agents/langchain/messages';
import type { RunnableConfig } from '@librechat/agents/langchain/runnables';
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

export interface GenerateOpenAIOAuthTitleInput {
  contentParts?: OpenAIOAuthTitleContentPart[];
  createOpenAIOAuth?: OpenAIOAuthModelOptions['createOpenAIOAuth'];
  inputText: string;
  model?: string;
  titlePrompt?: string;
  titlePromptTemplate?: string;
  signal?: AbortSignal;
}

export interface GenerateOpenAIOAuthTitleResult {
  model: string;
  title: string;
  usage?: OpenAIOAuthTitleUsage;
}

const defaultTitlePrompt = `Provide a concise, 5-word-or-less title for the conversation. Only return the title itself.

Conversation:
{convo}`;

const defaultTitleTemplate = 'User: {input}\nAI: {output}';

function getTextParts(contentParts: OpenAIOAuthTitleContentPart[] | undefined): string {
  return (contentParts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter((text) => text.trim() !== '')
    .join('\n');
}

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
  contentParts,
  inputText,
  titlePromptTemplate,
}: Pick<
  GenerateOpenAIOAuthTitleInput,
  'contentParts' | 'inputText' | 'titlePromptTemplate'
>): string {
  const output = getTextParts(contentParts);
  const content = [`User: ${inputText}`, output ? `AI: ${output}` : ''].filter(Boolean).join('\n');
  return replaceTemplateValues(titlePromptTemplate ?? defaultTitleTemplate, {
    content,
    input: inputText,
    output,
  }).trim();
}

function createTitlePrompt({
  conversation,
  inputText,
  outputText,
  titlePrompt,
}: {
  conversation: string;
  inputText: string;
  outputText: string;
  titlePrompt?: string;
}): string {
  const prompt = titlePrompt ?? defaultTitlePrompt;
  const rendered = replaceTemplateValues(prompt, {
    content: conversation,
    input: inputText,
    output: outputText,
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

export async function generateOpenAIOAuthTitle({
  contentParts,
  createOpenAIOAuth,
  inputText,
  model,
  signal,
  titlePrompt,
  titlePromptTemplate,
}: GenerateOpenAIOAuthTitleInput): Promise<GenerateOpenAIOAuthTitleResult> {
  const config = parseOpenAIConfig(process.env);
  const selectedModel = model || config.model;
  const outputText = getTextParts(contentParts);
  const conversation = createConversationText({
    contentParts,
    inputText,
    titlePromptTemplate,
  });
  const prompt = createTitlePrompt({
    conversation,
    inputText,
    outputText,
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
  const runnableConfig: RunnableConfig | undefined = signal
    ? ({ signal } as RunnableConfig)
    : undefined;
  const message = await titleModel.invoke(
    [new SystemMessage('Generate only a concise conversation title.'), new HumanMessage(prompt)],
    runnableConfig,
  );

  return {
    model: selectedModel,
    title: getMessageText(message),
    usage: getUsage(message),
  };
}
