import { HumanMessage, SystemMessage } from '@librechat/agents/langchain/messages';
import type { AIMessageChunk } from '@librechat/agents/langchain/messages';
import type { RunnableConfig } from '@librechat/agents/langchain/runnables';
import type { SteelRuntimeContextDependencies } from '../runtime/context';
import type { OpenAIOAuthModelOptions } from './oauth';
import { resolveOpenAIOAuthAuthFilePath } from '../ai/config';
import { createOpenAIOAuthModel } from './oauth';

const DEFAULT_OPENAI_TITLE_MODEL = 'gpt-6-luna';
const OPENAI_TITLE_REASONING_EFFORT = 'none';

export interface OpenAIOAuthTitleUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface OpenAIOAuthTitleInput {
  createOpenAIOAuth?: OpenAIOAuthModelOptions['createOpenAIOAuth'];
  createOpenAIOAuthTransport?: OpenAIOAuthModelOptions['createOpenAIOAuthTransport'];
  inputText: string;
  openaiCredentials?: OpenAIOAuthModelOptions['openaiCredentials'];
  titlePrompt?: string;
  titlePromptTemplate?: string;
  chainOptions?: Partial<RunnableConfig>;
}

export interface OpenAIOAuthTitleResult {
  model: string;
  title: string;
  usage?: OpenAIOAuthTitleUsage;
}

const defaultTitlePrompt = `Provide a concise, 5-word-or-less title for the conversation. Only return the title itself.

Conversation:
{convo}`;

const defaultTitleTemplate = 'User: {input}';

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
}: Pick<OpenAIOAuthTitleInput, 'inputText' | 'titlePromptTemplate'>): string {
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

function getTitleSettings(): { model: string; reasoningEffort: string } {
  return {
    model: process.env.OPENAI_TITLE_MODEL?.trim() || DEFAULT_OPENAI_TITLE_MODEL,
    reasoningEffort:
      process.env.OPENAI_TITLE_REASONING_EFFORT?.trim() || OPENAI_TITLE_REASONING_EFFORT,
  };
}

/**
 * Titles an OpenAI OAuth (Codex) conversation through the Responses transport,
 * which the agents SDK title chain cannot reach. Every other provider uses
 * the SDK's `Run.generateTitle`.
 */
export async function generateOpenAIOAuthTitle({
  chainOptions,
  createOpenAIOAuth,
  createOpenAIOAuthTransport,
  inputText,
  openaiCredentials,
  titlePrompt,
  titlePromptTemplate,
}: OpenAIOAuthTitleInput): Promise<OpenAIOAuthTitleResult> {
  const settings = getTitleSettings();
  const conversation = createConversationText({ inputText, titlePromptTemplate });
  const prompt = createTitlePrompt({ conversation, inputText, titlePrompt });
  const titleModel = createOpenAIOAuthModel({
    authFilePath: resolveOpenAIOAuthAuthFilePath(process.env),
    createOpenAIOAuth,
    createOpenAIOAuthTransport,
    maxOutputTokens: 64,
    enableCodeInterpreter: false,
    model: settings.model,
    openaiCredentials,
    reasoningEffort: settings.reasoningEffort,
  });
  const message = await titleModel.invoke(
    [new SystemMessage('Generate only a concise conversation title.'), new HumanMessage(prompt)],
    chainOptions,
  );

  return {
    model: settings.model,
    title: getMessageText(message),
    usage: getUsage(message),
  };
}

/** An attachment as carried on the agents client options. */
export interface SteelTitleAttachment {
  filename?: string | null;
  name?: string | null;
  originalname?: string | null;
}

const firstFilenameMarker = '{{first_filename}}';

function getAttachmentFilename(file: SteelTitleAttachment | null | undefined): string | undefined {
  const filename = file?.filename ?? file?.name ?? file?.originalname;
  return typeof filename === 'string' ? filename.trim() || undefined : undefined;
}

/**
 * Appends attachment filenames and the managed conversation-title rule to the
 * endpoint title prompt; turns without attachments keep the prompt unchanged.
 */
export async function resolveSteelTitlePrompt({
  titlePrompt,
  attachments,
  dependencies,
}: {
  titlePrompt?: string;
  attachments?: readonly (SteelTitleAttachment | null | undefined)[] | null;
  dependencies: Pick<SteelRuntimeContextDependencies, 'listOtherGlobalRules'>;
}): Promise<string | undefined> {
  const filenames = [
    ...new Set((attachments ?? []).map(getAttachmentFilename).filter(Boolean)),
  ] as string[];
  if (filenames.length === 0) {
    return titlePrompt;
  }
  const { titleRules } = await dependencies.listOtherGlobalRules();
  const guidance = [
    `File name(s): ${filenames.join('、')}`,
    ...titleRules.map((rule) => rule.prompt.replaceAll(firstFilenameMarker, () => filenames[0])),
  ].join('\n');
  return [titlePrompt, guidance].filter(Boolean).join('\n\n');
}
