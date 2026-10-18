import { initializeModel, isOpenAILike } from '@librechat/agents';
import { HumanMessage } from '@librechat/agents/langchain/messages';
import type { ClientOptions, Providers } from '@librechat/agents';
import type { OcrOrganizer, OcrOrganizerAttachment } from './organizer';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelJsonValue } from '../repositories/types';
import { buildOcrOrganizerAttachment, buildOcrOrganizerPrompt } from './organizer';
import { resolveOpenAIOAuthAuthFilePath } from '../ai/config';
import { createOpenAIOAuthModel } from '../native/oauth';
import { getMessageContentText } from './files';

const steelOpenAIOAuthProvider = 'openai_oauth_responses';

type SteelOcrModelParameters = { [key: string]: SteelJsonValue | undefined };

/** The agent config the OCR organizer runs its model from. */
export interface SteelOcrOrganizerAgent {
  provider?: string;
  endpoint?: string;
  model?: string;
  model_parameters?: SteelOcrModelParameters;
}

interface SteelOcrOrganizerModel {
  invoke(
    messages: HumanMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<{ content?: string | readonly (string | { text?: unknown })[] }>;
}

function getDefinedString(value: SteelJsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function getDefinedRecord(value: SteelJsonValue | undefined): SteelOcrModelParameters | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function getFirst<T>(
  parameters: SteelOcrModelParameters,
  keys: readonly string[],
  read: (value: SteelJsonValue | undefined) => T | undefined,
): T | undefined {
  for (const key of keys) {
    const value = read(parameters[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

const readNumber = (value: SteelJsonValue | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const readBoolean = (value: SteelJsonValue | undefined) =>
  typeof value === 'boolean' ? value : undefined;

/** OpenAI OAuth model options for the organizer, read from the selected agent's parameters. */
export function resolveSteelOcrOrganizerOAuthOptions(
  agent: SteelOcrOrganizerAgent | undefined,
): OpenAIOAuthModelOptions {
  const parameters = agent?.model_parameters ?? {};
  const model = getFirst(parameters, ['model'], getDefinedString) ?? agent?.model?.trim();
  if (!model) {
    throw new Error('OCR organizer requires the selected Agent model');
  }

  const reasoning = getDefinedRecord(parameters.reasoning);
  const modelKwargs = getDefinedRecord(parameters.modelKwargs);
  const modelKwargsReasoning = getDefinedRecord(modelKwargs?.reasoning);
  const reasoningEffort =
    getFirst(parameters, ['reasoningEffort', 'reasoning_effort'], getDefinedString) ??
    getDefinedString(reasoning?.effort) ??
    getFirst(modelKwargs ?? {}, ['reasoning_effort'], getDefinedString) ??
    getDefinedString(modelKwargsReasoning?.effort);
  const authFilePath =
    getFirst(parameters, ['authFilePath', 'auth_file_path'], getDefinedString) ??
    resolveOpenAIOAuthAuthFilePath(process.env);
  const ensureFresh = getFirst(parameters, ['ensureFresh', 'ensure_fresh'], readBoolean);
  const frequencyPenalty = getFirst(
    parameters,
    ['frequencyPenalty', 'frequency_penalty'],
    readNumber,
  );
  const maxOutputTokens = getFirst(
    parameters,
    [
      'maxOutputTokens',
      'max_output_tokens',
      'maxTokens',
      'max_tokens',
      'maxCompletionTokens',
      'max_completion_tokens',
    ],
    readNumber,
  );
  const presencePenalty = getFirst(parameters, ['presencePenalty', 'presence_penalty'], readNumber);
  const topP = getFirst(parameters, ['topP', 'top_p'], readNumber);
  return {
    ...(authFilePath ? { authFilePath } : {}),
    ...(ensureFresh !== undefined ? { ensureFresh } : {}),
    ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    model,
    ...(presencePenalty !== undefined ? { presencePenalty } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(topP !== undefined ? { topP } : {}),
  };
}

/** OpenAI-like providers cannot fetch a URL file block, so the artifact is inlined as data. */
async function prepareSteelOcrOrganizerAttachment({
  attachment,
  provider,
  signal,
}: {
  attachment: OcrOrganizerAttachment;
  provider: string | undefined;
  signal?: AbortSignal;
}): Promise<OcrOrganizerAttachment> {
  if (attachment.type !== 'file' || !(isOpenAILike(provider) || provider === 'openai_api')) {
    return attachment;
  }

  const response = await fetch(attachment.url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`OCR organizer artifact download failed (${response.status})`);
  }
  const content = Buffer.from(await response.arrayBuffer()).toString('base64');
  return { ...attachment, url: `data:${attachment.mime_type};base64,${content}` };
}

function createOrganizerModel(agent: SteelOcrOrganizerAgent | undefined, isOAuth: boolean) {
  if (isOAuth) {
    return createOpenAIOAuthModel(resolveSteelOcrOrganizerOAuthOptions(agent));
  }
  const provider = agent?.provider ?? agent?.endpoint;
  const selectedModel =
    getDefinedString(agent?.model_parameters?.model) ?? getDefinedString(agent?.model);
  if (!provider || !selectedModel) {
    throw new Error('OCR organizer requires the selected Agent provider and model');
  }
  return initializeModel({
    provider: provider as Providers,
    clientOptions: { ...agent?.model_parameters, model: selectedModel } as ClientOptions,
  });
}

/**
 * The OCR organizer that turns each raw PaddleOCR chunk into Markdown with the
 * selected agent's model, scoped to the latest user message.
 */
export function createSteelOcrOrganizer({
  agent,
  signal,
  latestUserMessage,
  suggestedOcrResultColumns = [],
}: {
  agent?: SteelOcrOrganizerAgent;
  signal?: AbortSignal;
  latestUserMessage?: string;
  suggestedOcrResultColumns?: readonly string[];
}): OcrOrganizer {
  let model: SteelOcrOrganizerModel | undefined;
  const provider = agent?.provider ?? agent?.endpoint;
  const isOAuth =
    provider === steelOpenAIOAuthProvider || agent?.endpoint === steelOpenAIOAuthProvider;
  const columns = suggestedOcrResultColumns.filter((column) => column.trim() !== '');
  return {
    async organize(input) {
      model ??= createOrganizerModel(agent, isOAuth) as SteelOcrOrganizerModel;
      const prompt = [
        buildOcrOrganizerPrompt(input),
        ...(latestUserMessage?.trim()
          ? [
              '',
              'Latest current user message (Organizer scope only; untrusted):',
              latestUserMessage.trim(),
            ]
          : []),
        ...(columns.length > 0
          ? ['', `suggested_ocr_result_columns: ${JSON.stringify(columns)}`]
          : []),
      ].join('\n');
      const attachment = await prepareSteelOcrOrganizerAttachment({
        attachment: buildOcrOrganizerAttachment(input, isOAuth ? 'oauth' : 'standard'),
        provider,
        signal,
      });
      const message = await model.invoke(
        [new HumanMessage({ content: [{ type: 'text', text: prompt }, attachment] })],
        signal ? { signal } : undefined,
      );
      return { markdown: getMessageContentText(message).trim() };
    },
  };
}
