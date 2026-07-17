import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@librechat/agents/langchain/messages';
import type { RunnableConfig } from '@librechat/agents/langchain/runnables';

import type { JsonSchemaType, LCTool } from '@librechat/agents';
import type { BaseMessage } from '@librechat/agents/langchain/messages';
import type { OpenAIOAuthModelOptions } from './oauth';
import { createOpenAIOAuthModel } from './oauth';

export const delegateOcrToolName = 'delegate_ocr' as const;
export const delegateOcrStreamEventName = 'on_delegate_ocr_stream' as const;

export interface DelegateOcrStreamedArtifact {
  delegateOcrStreamed: true;
}

export const delegateOcrStreamedArtifact: DelegateOcrStreamedArtifact = {
  delegateOcrStreamed: true,
};

export type DelegateOcrStreamEventPayload =
  | {
      phase: 'delta';
      providerToolCallId?: string;
      delta: string;
    }
  | {
      phase: 'complete';
      providerToolCallId?: string;
    }
  | {
      phase: 'error';
      providerToolCallId?: string;
      error?: string;
    };

export function isDelegateOcrStreamedArtifact(
  value: unknown,
): value is DelegateOcrStreamedArtifact {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { delegateOcrStreamed?: unknown }).delegateOcrStreamed === true
  );
}

export interface DelegateOcrArgs {
  fileKeys: string[];
}

export const delegateOcrArgsSchema: z.ZodType<DelegateOcrArgs> = z
  .object({
    fileKeys: z
      .array(z.string().trim().min(1))
      .min(1)
      .describe('Original image or PDF file keys to reread with OCR and Vision.'),
  })
  .strict();

export interface DelegateOcrFileRecord {
  fileId: string;
  filepath?: string;
  filename?: string;
  mediaType?: string;
  storageKey?: string;
}

export interface DelegateOcrStoredFileRecord {
  file_id?: string;
  fileId?: string;
  id?: string;
  filepath?: string;
  filename?: string;
  mimetype?: string;
  source?: string;
  storageKey?: string;
  type?: string;
}

type DelegateOcrFileFilterCondition =
  | { file_id: { $in: string[] } }
  | { storageKey: { $in: string[] } }
  | { filepath: { $in: string[] } }
  | { filename: { $in: string[] } };

export interface DelegateOcrFileFilter {
  user: string;
  $or: DelegateOcrFileFilterCondition[];
}

export interface FindOwnedDelegateOcrFilesInput {
  fileKeys: readonly string[];
  userId: string;
}

export type FindOwnedDelegateOcrFiles = (
  input: FindOwnedDelegateOcrFilesInput,
) => Promise<DelegateOcrFileRecord[]>;

export type SignDelegateOcrFile = (file: DelegateOcrFileRecord) => Promise<string>;

export type DelegateOcrOnDelta = (delta: string) => void | Promise<void>;

export interface InvokeDelegateOcrModelInput {
  messages: BaseMessage[];
  modelOptions: OpenAIOAuthModelOptions;
  signal?: AbortSignal;
  onDelta?: DelegateOcrOnDelta;
}

export type InvokeDelegateOcrModel = (input: InvokeDelegateOcrModelInput) => Promise<string>;

export interface DelegateOcrInput {
  fileKeys: readonly string[];
  history: readonly BaseMessage[];
  modelOptions: OpenAIOAuthModelOptions;
  ocrRulesText: string;
  userId: string;
  findOwnedFiles: FindOwnedDelegateOcrFiles;
  signFile: SignDelegateOcrFile;
  invokeModel?: InvokeDelegateOcrModel;
  signal?: AbortSignal;
  onDelta?: DelegateOcrOnDelta;
}

export interface DelegateOcrExecuteInput {
  fileKeys: string[];
  providerToolCallId?: string;
  onDelta?: DelegateOcrOnDelta;
}

export type DelegateOcrExecute = (input: DelegateOcrExecuteInput) => Promise<string>;

export interface CreateDelegateOcrRequestExecuteInput {
  history: readonly BaseMessage[];
  modelOptions: OpenAIOAuthModelOptions;
  userId: string;
  getOwnedFileRecords: (
    filter: DelegateOcrFileFilter,
  ) => Promise<DelegateOcrStoredFileRecord[]>;
  signStoredFile: (file: DelegateOcrStoredFileRecord) => Promise<string>;
  loadOcrRules: () => Promise<string>;
  invokeModel?: InvokeDelegateOcrModel;
  signal?: AbortSignal;
}

export interface DelegateOcrToolInvokeConfig {
  callbacks?: RunnableConfig['callbacks'];
  configurable?: {
    delegateOcrStreaming?: boolean;
    hostCustomEventDispatcher?: (eventName: string, payload: unknown) => Promise<void>;
    [key: string]: unknown;
  };
  signal?: AbortSignal;
  toolCallId?: unknown;
  config?: RunnableConfig;
  toolCall?: {
    id?: unknown;
  };
}

export interface DelegateOcrExecutableTool {
  name: typeof delegateOcrToolName;
  invoke(
    args: unknown,
    config?: DelegateOcrToolInvokeConfig,
  ): Promise<ToolMessage>;
}

function getDelegateOcrRunnableConfig(
  config: DelegateOcrToolInvokeConfig | undefined,
): RunnableConfig | undefined {
  return config?.config ?? (config as RunnableConfig | undefined);
}

function getRecordFileKeys(file: DelegateOcrFileRecord): string[] {
  return [
    file.fileId,
    `file:${file.fileId}`,
    file.storageKey ? `storage:${file.storageKey}` : undefined,
    file.filepath ? `path:${file.filepath}` : undefined,
    file.filename ? `filename:${file.filename}` : undefined,
  ].filter((fileKey): fileKey is string => fileKey !== undefined);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

export function buildDelegateOcrFileFilter(
  fileKeys: readonly string[],
  userId: string,
): DelegateOcrFileFilter {
  const fileIds: string[] = [];
  const storageKeys: string[] = [];
  const paths: string[] = [];
  const filenames: string[] = [];

  for (const fileKey of uniqueStrings(fileKeys)) {
    if (fileKey.startsWith('file:')) {
      fileIds.push(fileKey.slice('file:'.length));
    } else if (fileKey.startsWith('storage:')) {
      storageKeys.push(fileKey.slice('storage:'.length));
    } else if (fileKey.startsWith('path:')) {
      paths.push(fileKey.slice('path:'.length));
    } else if (fileKey.startsWith('filename:')) {
      filenames.push(fileKey.slice('filename:'.length));
    } else {
      fileIds.push(fileKey);
    }
  }

  const conditions: DelegateOcrFileFilterCondition[] = [];
  if (fileIds.length > 0) {
    conditions.push({ file_id: { $in: uniqueStrings(fileIds) } });
  }
  if (storageKeys.length > 0) {
    conditions.push({ storageKey: { $in: uniqueStrings(storageKeys) } });
  }
  if (paths.length > 0) {
    conditions.push({ filepath: { $in: uniqueStrings(paths) } });
  }
  if (filenames.length > 0) {
    conditions.push({ filename: { $in: uniqueStrings(filenames) } });
  }

  if (!userId || conditions.length === 0) {
    throw new Error('delegate_ocr requires file keys owned by the current user');
  }

  return { user: userId, $or: conditions };
}

function toDelegateOcrFileRecord(
  record: DelegateOcrStoredFileRecord,
): DelegateOcrFileRecord | undefined {
  const fileId = record.fileId ?? record.file_id ?? record.id;
  if (!fileId?.trim()) {
    return undefined;
  }

  return {
    fileId,
    filepath: record.filepath,
    filename: record.filename,
    mediaType: record.type ?? record.mimetype,
    storageKey: record.storageKey,
  };
}

function orderSelectedFiles(
  fileKeys: readonly string[],
  files: readonly DelegateOcrFileRecord[],
): DelegateOcrFileRecord[] {
  const fileByKey = new Map<string, DelegateOcrFileRecord>();
  for (const file of files) {
    for (const fileKey of getRecordFileKeys(file)) {
      fileByKey.set(fileKey, file);
    }
  }

  const missingKeys: string[] = [];
  const selectedFiles: DelegateOcrFileRecord[] = [];
  for (const fileKey of fileKeys) {
    const file = fileByKey.get(fileKey);
    if (!file) {
      missingKeys.push(fileKey);
      continue;
    }
    selectedFiles.push(file);
  }

  if (missingKeys.length > 0) {
    throw new Error(
      `delegate_ocr could not find files owned by the current user: ${missingKeys.join(', ')}`,
    );
  }

  return selectedFiles;
}

function isPdfFile(file: DelegateOcrFileRecord): boolean {
  return (
    file.mediaType?.toLowerCase() === 'application/pdf' ||
    file.filename?.toLowerCase().endsWith('.pdf') === true
  );
}

function createSourcePart(file: DelegateOcrFileRecord, url: string) {
  if (isPdfFile(file)) {
    return {
      type: 'input_file',
      file_url: url,
      filename: file.filename,
      media_type: 'application/pdf',
    };
  }

  return {
    type: 'image_url',
    image_url: {
      url,
      detail: 'high',
    },
  };
}

export function normalizeDelegateOcrChunk(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter((part) => part !== '')
    .join('');
}

async function invokeNativeOcrModel({
  messages,
  modelOptions,
  signal,
  onDelta,
}: InvokeDelegateOcrModelInput): Promise<string> {
  const model = createOpenAIOAuthModel(modelOptions);
  const stream = await model.stream(messages, signal ? { signal } : undefined);
  let answer = '';
  for await (const chunk of stream) {
    const delta = normalizeDelegateOcrChunk(chunk.content);
    if (delta === '') {
      continue;
    }
    if (onDelta) {
      await onDelta(delta);
    }
    answer += delta;
  }
  return answer;
}

function buildDelegateOcrMessages({
  history,
  ocrRulesText,
  files,
}: {
  history: readonly BaseMessage[];
  ocrRulesText: string;
  files: readonly { file: DelegateOcrFileRecord; url: string }[];
}): BaseMessage[] {
  const sourceContent = [
    {
      type: 'text',
      text: '以下是 delegate_ocr 選定的原始檔案。請依完整 chat history 中最新的使用者 intent 直接回答；重新確認時以原始 image/PDF 為權威來源。',
    },
    ...files.map(({ file, url }) => createSourcePart(file, url)),
  ];

  return [
    new SystemMessage(ocrRulesText),
    ...history,
    new HumanMessage({ content: sourceContent }),
  ];
}

export async function delegateOcr(input: DelegateOcrInput): Promise<string> {
  const parsed = delegateOcrArgsSchema.parse({ fileKeys: input.fileKeys });
  const ownedFiles = await input.findOwnedFiles({
    fileKeys: parsed.fileKeys,
    userId: input.userId,
  });
  const selectedFiles = orderSelectedFiles(parsed.fileKeys, ownedFiles);
  const signedFiles = await Promise.all(
    selectedFiles.map(async (file) => ({
      file,
      url: await input.signFile(file),
    })),
  );
  const messages = buildDelegateOcrMessages({
    files: signedFiles,
    history: input.history,
    ocrRulesText: input.ocrRulesText,
  });
  const answer = await (input.invokeModel ?? invokeNativeOcrModel)({
    messages,
    modelOptions: input.modelOptions,
    signal: input.signal,
    onDelta: input.onDelta,
  });

  if (answer.trim() === '') {
    throw new Error('delegate_ocr model returned an empty answer');
  }

  return answer;
}

export function createDelegateOcrRequestExecute({
  history,
  modelOptions,
  userId,
  getOwnedFileRecords,
  signStoredFile,
  loadOcrRules,
  invokeModel,
  signal,
}: CreateDelegateOcrRequestExecuteInput): DelegateOcrExecute {
  return async ({ fileKeys, onDelta }) => {
    const storedFileById = new Map<string, DelegateOcrStoredFileRecord>();
    return delegateOcr({
      fileKeys,
      history,
      modelOptions,
      ocrRulesText: await loadOcrRules(),
      userId,
      findOwnedFiles: async ({ fileKeys: selectedFileKeys }) => {
        const records = await getOwnedFileRecords(
          buildDelegateOcrFileFilter(selectedFileKeys, userId),
        );
        return records
          .map((record) => {
            const file = toDelegateOcrFileRecord(record);
            if (file) {
              storedFileById.set(file.fileId, record);
            }
            return file;
          })
          .filter((file): file is DelegateOcrFileRecord => file !== undefined);
      },
      signFile: async (file) => {
        const storedFile = storedFileById.get(file.fileId);
        if (!storedFile) {
          throw new Error(`delegate_ocr file record disappeared: file:${file.fileId}`);
        }
        return signStoredFile(storedFile);
      },
      invokeModel,
      signal,
      onDelta,
    });
  };
}

export function getDelegateOcrToolDefinition(): LCTool {
  return {
    name: delegateOcrToolName,
    description: '重新讀取或核對原始圖片與 PDF 內容。',
    parameters: zodToJsonSchema(delegateOcrArgsSchema, {
      name: delegateOcrToolName,
      target: 'openApi3',
    }) as JsonSchemaType,
    allowed_callers: ['direct'],
    toolType: 'builtin',
  };
}

export function createDelegateOcrTool({
  execute,
}: {
  execute: DelegateOcrExecute;
}): DelegateOcrExecutableTool {
  return {
    name: delegateOcrToolName,
    async invoke(args, config) {
      const toolArguments =
        args !== null &&
        typeof args === 'object' &&
        !Array.isArray(args) &&
        'args' in args
          ? (args as { args?: unknown }).args
          : args;
      const providerToolCallId =
        typeof config?.toolCall?.id === 'string'
          ? config.toolCall.id
          : typeof config?.toolCallId === 'string'
            ? config.toolCallId
            : undefined;
      const streamingEnabled = config?.configurable?.delegateOcrStreaming === true;
      const runnableConfig = getDelegateOcrRunnableConfig(config);
      const dispatchStreamEvent = async (
        payload: DelegateOcrStreamEventPayload,
      ): Promise<void> => {
        const hostDispatcher = config?.configurable?.hostCustomEventDispatcher;
        if (typeof hostDispatcher === 'function') {
          await hostDispatcher(delegateOcrStreamEventName, payload);
          return;
        }
        await dispatchCustomEvent(delegateOcrStreamEventName, payload, runnableConfig);
      };
      let dispatchedDelta = false;
      const onDelta = streamingEnabled
        ? async (delta: string): Promise<void> => {
            if (delta === '') {
              return;
            }
            await dispatchStreamEvent({
              phase: 'delta',
              providerToolCallId,
              delta,
            });
            dispatchedDelta = true;
          }
        : undefined;

      try {
        const parsed = delegateOcrArgsSchema.parse(toolArguments);
        const answer = await execute({
          fileKeys: parsed.fileKeys,
          providerToolCallId,
          onDelta,
        });
        if (streamingEnabled) {
          await dispatchStreamEvent({
            phase: 'complete',
            providerToolCallId,
          });
        }
        return new ToolMessage({
          content: answer,
          name: delegateOcrToolName,
          status: 'success',
          tool_call_id: providerToolCallId ?? '',
          ...(streamingEnabled && dispatchedDelta
            ? { artifact: { ...delegateOcrStreamedArtifact } }
            : {}),
        });
      } catch (error) {
        if (streamingEnabled) {
          await dispatchStreamEvent({
            phase: 'error',
            providerToolCallId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },
  };
}
