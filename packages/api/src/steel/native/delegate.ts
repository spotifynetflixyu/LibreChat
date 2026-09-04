import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { randomUUID } from 'node:crypto';
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
import { isExpiredSignedUrlError } from '../../storage/url';
import { createOpenAIOAuthModel } from './oauth';
import {
  finalizeOcrResponse,
  parseSourceMappingTable,
  validateSourceMapping,
} from '../ocr/result';
import type { SourceMappingEntry } from '../ocr/result';
import { isSteelToolName } from '../tools/registry';

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
      claimToken?: string;
      generationId?: string;
      attemptToken?: string;
    }
  | {
      phase: 'complete';
      providerToolCallId?: string;
      claimToken?: string;
      generationId?: string;
      attemptToken?: string;
    }
  | {
      phase: 'error';
      providerToolCallId?: string;
      error?: string;
      claimToken?: string;
      generationId?: string;
      attemptToken?: string;
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

export interface DelegateOcrPageRange {
  pageStart: number;
  pageEnd: number;
}

export interface DelegateOcrFileInput {
  fileKey: string;
  pageRanges?: DelegateOcrPageRange[];
}

export interface DelegateOcrArgs {
  files: DelegateOcrFileInput[];
}

const delegateOcrPageRangeSchema: z.ZodType<DelegateOcrPageRange> = z
  .object({
    pageStart: z.number().int().min(1),
    pageEnd: z.number().int().min(1),
  })
  .refine((range) => range.pageStart <= range.pageEnd, {
    message: 'pageEnd must be greater than or equal to pageStart',
  });

const delegateOcrPageRangesSchema = z
  .array(delegateOcrPageRangeSchema)
  .min(1)
  .superRefine((ranges, context) => {
    for (let index = 1; index < ranges.length; index += 1) {
      const previous = ranges[index - 1]!;
      const current = ranges[index]!;
      if (current.pageStart < previous.pageStart) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'pageRanges must be sorted by pageStart',
          path: [index, 'pageStart'],
        });
        continue;
      }
      if (current.pageStart <= previous.pageEnd) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'pageRanges must not overlap',
          path: [index, 'pageStart'],
        });
      }
    }
  });

export const delegateOcrArgsSchema: z.ZodType<DelegateOcrArgs> = z
  .object({
    files: z
      .array(
        z
          .object({
            fileKey: z.string().trim().min(1),
            pageRanges: delegateOcrPageRangesSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .describe(
        'Files to inspect in order. PDF files require pageRanges; image pageRanges are ignored.',
      ),
  })
  .strict();

export interface DelegateOcrAvailableFile {
  fileId: string;
  filename?: string;
  mediaType?: string;
}

export interface DelegateOcrPolicy {
  resolved: true;
  allowed: boolean;
  allowedFileKeys: string[];
}

export interface ResolveDelegateOcrPolicyInput {
  currentUserTurn?: string;
  ocrTurnActive?: boolean;
  attachmentFileKeys?: readonly string[];
}

export function isResolvedDelegateOcrPolicy(value: unknown): value is DelegateOcrPolicy {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { resolved?: unknown }).resolved === true &&
    typeof (value as { allowed?: unknown }).allowed === 'boolean' &&
    Array.isArray((value as { allowedFileKeys?: unknown }).allowedFileKeys) &&
    (value as { allowedFileKeys: unknown[] }).allowedFileKeys.every(
      (key) =>
        typeof key === 'string' && key === key.trim() && /^file:[^\s:]+$/u.test(key),
    )
  );
}

export function resolveDelegateOcrPolicy({
  currentUserTurn,
  ocrTurnActive = false,
  attachmentFileKeys = [],
}: ResolveDelegateOcrPolicyInput): DelegateOcrPolicy {
  const allowedFileKeys = [
    ...new Set(
      attachmentFileKeys
        .filter(
          (fileKey): fileKey is string =>
            typeof fileKey === 'string' && /^file:[^\s:]+$/u.test(fileKey.trim()),
        )
        .map((fileKey) => fileKey.trim()),
    ),
  ];
  return {
    resolved: true,
    allowed:
      !ocrTurnActive &&
      !isDelegateOcrQuoteOnlyTurn(currentUserTurn) &&
      allowedFileKeys.length > 0,
    allowedFileKeys,
  };
}

export interface DelegateOcrFileRecord {
  fileId: string;
  filepath?: string;
  filename?: string;
  mediaType?: string;
  storageKey?: string;
  pageStart?: number;
  pageEnd?: number;
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

export interface DelegateOcrPreparedBatch {
  files: readonly DelegateOcrFileRecord[];
  signFile: SignDelegateOcrFile;
  range?: DelegateOcrPageRange;
}

export interface PrepareDelegateOcrBatchesInput {
  files: readonly DelegateOcrFileRecord[];
  fileInputs: readonly DelegateOcrFileInput[];
  storedFiles: readonly DelegateOcrStoredFileRecord[];
}

export type PrepareDelegateOcrBatches = (
  input: PrepareDelegateOcrBatchesInput,
) => Promise<readonly DelegateOcrPreparedBatch[]>;

export interface DelegateOcrDeltaMetadata {
  claimToken?: string;
  generationId?: string;
  attemptToken?: string;
}

export type DelegateOcrOnDelta = (
  delta: string,
  metadata?: DelegateOcrDeltaMetadata,
) => void | Promise<void>;

export interface DelegateOcrSelectedFileMetadata {
  fileKey: string;
  fileId: string;
  filename?: string;
  mediaType?: string;
  pageStart?: number;
  pageEnd?: number;
  pageRanges?: readonly DelegateOcrPageRange[];
}

export interface DelegateOcrSignedFile {
  file: DelegateOcrFileRecord;
  url: string;
}

export interface DelegateOcrPreprocessingInput {
  file: DelegateOcrFileRecord;
  fileInput?: DelegateOcrFileInput;
  batch: DelegateOcrPreparedBatch;
  signedFiles: readonly DelegateOcrSignedFile[];
  selectedFiles: readonly DelegateOcrSignedFile[];
  currentUserTurn: string;
  latestUserMessage: string;
  suggestedOcrResultColumns: readonly string[];
}

export interface DelegateOcrPreprocessingResult {
  organizerMarkdown?: string | readonly string[];
  paddleOcrMarkdown?: string | readonly string[];
  fallbackMarkdown?: string | readonly string[];
}

export type RunDelegateOcrPreprocessing = (
  input: DelegateOcrPreprocessingInput,
) => Promise<DelegateOcrPreprocessingResult | undefined>;

export interface DelegateOcrRunAttemptInput {
  claimToken?: string;
  generationId?: string;
  attemptNumber: number;
  attemptToken: string;
}

export interface DelegateOcrRunStore {
  beginAttempt?: (
    input: DelegateOcrRunAttemptInput,
  ) => Promise<{ attemptToken?: string } | string | void>;
  persistAttempt?: (input: DelegateOcrRunAttemptInput) => Promise<void>;
}

export interface DelegateOcrFinalizerInput {
  assistantResponse: string;
  canonicalMapping: readonly SourceMappingEntry[];
  previousOcrResultMarkdown?: string;
  suggestedOcrResultColumns: readonly string[];
  attemptNumber: number;
  attemptToken: string;
}

export interface DelegateOcrFinalizerSuccess {
  ok: true;
  finalResponse?: string;
  ocrResultMarkdown?: string;
}

export interface DelegateOcrFinalizerFailure {
  ok: false;
  reason: 'missing_ocr_result' | 'invalid_ocr_result_table' | 'mapping_mismatch' | string;
  mappingRetryable?: boolean;
}

export type DelegateOcrFinalizerResult =
  | DelegateOcrFinalizerSuccess
  | DelegateOcrFinalizerFailure
  | string
  | undefined;

export type FinalizeDelegateOcrResponse = (
  input: DelegateOcrFinalizerInput,
) => Promise<DelegateOcrFinalizerResult>;

export type SaveDelegateOcrFailure = (
  input: DelegateOcrFinalizerInput & { reason: string },
) => Promise<void>;

export interface DelegateOcrWorkflowInput {
  enabled?: boolean;
  filesOverride?: readonly DelegateOcrFileInput[];
  canonicalMapping?: readonly SourceMappingEntry[];
  previousOcrResultMarkdown?: string;
  suggestedOcrResultColumns?: readonly string[];
  runStore?: DelegateOcrRunStore;
  runPreprocessing?: RunDelegateOcrPreprocessing;
  loadSourceMapping?: (input: {
    files: readonly DelegateOcrFileRecord[];
  }) => Promise<readonly SourceMappingEntry[]>;
  loadCurrentOcrResult?: (input: {
    files: readonly DelegateOcrFileRecord[];
  }) => Promise<string | undefined>;
  finalize?: FinalizeDelegateOcrResponse;
  saveFailed?: SaveDelegateOcrFailure;
  claimToken?: string;
  generationId?: string;
  attemptToken?: string;
}

export interface InvokeDelegateOcrModelInput {
  messages: BaseMessage[];
  modelOptions: OpenAIOAuthModelOptions;
  signal?: AbortSignal;
  onDelta?: DelegateOcrOnDelta;
  attemptNumber?: number;
  attemptToken?: string;
}

export type InvokeDelegateOcrModel = (input: InvokeDelegateOcrModelInput) => Promise<string>;

export interface DelegateOcrInput {
  files: readonly DelegateOcrFileInput[];
  history?: readonly BaseMessage[];
  currentUserTurn?: string;
  modelOptions: OpenAIOAuthModelOptions;
  ocrRulesText: string;
  userId: string;
  findOwnedFiles: FindOwnedDelegateOcrFiles;
  storedFiles?: readonly DelegateOcrStoredFileRecord[];
  signFile: SignDelegateOcrFile;
  invokeModel?: InvokeDelegateOcrModel;
  prepareBatches?: PrepareDelegateOcrBatches;
  signal?: AbortSignal;
  onDelta?: DelegateOcrOnDelta;
  workflow?: DelegateOcrWorkflowInput;
}

export interface DelegateOcrExecuteInput {
  files: DelegateOcrFileInput[];
  providerToolCallId?: string;
  onDelta?: DelegateOcrOnDelta;
  claimToken?: string;
  generationId?: string;
  attemptToken?: string;
  canDispatchEvent?: (payload: DelegateOcrStreamEventPayload) => boolean | Promise<boolean>;
}

export type DelegateOcrExecute = (input: DelegateOcrExecuteInput) => Promise<string>;

export interface CreateDelegateOcrRequestExecuteInput {
  history?: readonly BaseMessage[];
  currentUserTurn?: string;
  policy?: DelegateOcrPolicy;
  modelOptions: OpenAIOAuthModelOptions;
  userId: string;
  availableFiles?: readonly DelegateOcrAvailableFile[];
  getOwnedFileRecords: (
    filter: DelegateOcrFileFilter,
  ) => Promise<DelegateOcrStoredFileRecord[]>;
  signStoredFile: (file: DelegateOcrStoredFileRecord) => Promise<string>;
  loadOcrRules: () => Promise<string>;
  invokeModel?: InvokeDelegateOcrModel;
  prepareBatches?: PrepareDelegateOcrBatches;
  signal?: AbortSignal;
  workflow?: DelegateOcrWorkflowInput;
}

export interface DelegateOcrToolInvokeConfig {
  callbacks?: RunnableConfig['callbacks'];
  configurable?: {
    delegateOcrStreaming?: boolean;
    delegateOcrClaimToken?: string;
    delegateOcrGenerationId?: string;
    delegateOcrAttemptToken?: string;
    canDispatchEvent?: (payload: DelegateOcrStreamEventPayload) => boolean | Promise<boolean>;
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

function getFilenameExtension(filename: string | undefined): string | undefined {
  if (!filename) {
    return undefined;
  }
  const basename = filename.split(/[\\/]/).at(-1) ?? filename;
  const extensionIndex = basename.lastIndexOf('.');
  if (extensionIndex <= 0 || extensionIndex === basename.length - 1) {
    return undefined;
  }
  return basename.slice(extensionIndex).toLowerCase();
}

function getAvailableFileExtension(file: DelegateOcrAvailableFile): string | undefined {
  const filenameExtension = getFilenameExtension(file.filename);
  if (filenameExtension && delegateOcrFileExtensions.has(filenameExtension)) {
    return filenameExtension;
  }
  return file.mediaType?.split(';')[0]?.trim().toLowerCase() === 'application/pdf'
    ? '.pdf'
    : undefined;
}

const delegateOcrFileExtensions = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
]);

function stripDelegateOcrFileExtension(value: string): string {
  const extension = getFilenameExtension(value);
  return extension && delegateOcrFileExtensions.has(extension)
    ? value.slice(0, -extension.length)
    : value;
}

function unwrapDelegateOcrFileKey(fileKey: string): string {
  return fileKey.startsWith('<') && fileKey.endsWith('>') ? fileKey.slice(1, -1).trim() : fileKey;
}

function getGenericDelegateOcrFileExtension(fileKey: string): string | undefined {
  const unwrapped = unwrapDelegateOcrFileKey(fileKey);
  const prefixed = /^(?:file|files|file_id):(.+)$/i.exec(unwrapped);
  const candidate = (prefixed?.[1] ?? unwrapped).trim().toLowerCase();
  return candidate === 'pdf' ? '.pdf' : undefined;
}

function parseCanonicalDelegateOcrFileKey(fileKey: string): string | undefined {
  const unwrapped = unwrapDelegateOcrFileKey(fileKey);
  const prefixed = /^(?:file|files|file_id):(.+)$/i.exec(unwrapped);
  if (prefixed) {
    const fileId = stripDelegateOcrFileExtension(prefixed[1].trim());
    return fileId ? `file:${fileId}` : undefined;
  }

  const rawFileId = stripDelegateOcrFileExtension(unwrapped);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawFileId)) {
    return `file:${rawFileId}`;
  }
  return undefined;
}

export function resolveDelegateOcrFileKeys(
  fileKeys: readonly string[],
  availableFiles: readonly DelegateOcrAvailableFile[] | undefined,
): string[] {
  const requestedKeys = fileKeys
    .filter((fileKey): fileKey is string => typeof fileKey === 'string')
    .map((fileKey) => fileKey.trim())
    .filter(Boolean);
  const hasAvailableFiles = availableFiles !== undefined && availableFiles.length > 0;

  const fileIdsByAlias = new Map<string, Set<string>>();
  const fileIdsByExtension = new Map<string, Set<string>>();
  const addAlias = (alias: string | undefined, fileId: string) => {
    const normalizedAlias = alias?.trim().toLowerCase();
    if (!normalizedAlias) {
      return;
    }
    const fileIds = fileIdsByAlias.get(normalizedAlias) ?? new Set<string>();
    fileIds.add(fileId);
    fileIdsByAlias.set(normalizedAlias, fileIds);
  };

  for (const file of availableFiles ?? []) {
    const fileId = file.fileId.trim();
    if (!fileId) {
      continue;
    }
    const extension = getAvailableFileExtension(file);
    addAlias(fileId, fileId);
    addAlias(`file:${fileId}`, fileId);
    addAlias(`files:${fileId}`, fileId);
    addAlias(file.filename, fileId);
    addAlias(file.filename ? `filename:${file.filename}` : undefined, fileId);
    addAlias(extension ? `${fileId}${extension}` : undefined, fileId);
    addAlias(extension ? `file:${fileId}${extension}` : undefined, fileId);
    addAlias(extension ? `files:${fileId}${extension}` : undefined, fileId);
    if (extension) {
      const fileIds = fileIdsByExtension.get(extension) ?? new Set<string>();
      fileIds.add(fileId);
      fileIdsByExtension.set(extension, fileIds);
    }
  }

  const unresolvedKeys: string[] = [];
  const resolvedKeys: string[] = [];
  for (const fileKey of requestedKeys) {
    if (fileKey.startsWith('storage:') || fileKey.startsWith('path:')) {
      resolvedKeys.push(fileKey);
      continue;
    }
    const fileIds = fileIdsByAlias.get(fileKey.toLowerCase());
    if (fileIds && fileIds.size > 1) {
      throw new Error(`delegate_ocr attachment file key is ambiguous: ${fileKey}`);
    }
    if (fileIds?.size === 1) {
      resolvedKeys.push(`file:${[...fileIds][0]}`);
      continue;
    }

    const genericExtension = hasAvailableFiles
      ? getGenericDelegateOcrFileExtension(fileKey)
      : undefined;
    if (genericExtension) {
      const matchingFileIds = fileIdsByExtension.get(genericExtension);
      if (matchingFileIds && matchingFileIds.size > 1) {
        throw new Error(`delegate_ocr attachment file key is ambiguous: ${fileKey}`);
      }
      if (matchingFileIds?.size === 1) {
        resolvedKeys.push(`file:${[...matchingFileIds][0]}`);
        continue;
      }
      unresolvedKeys.push(fileKey);
      continue;
    }

    const parsedFileKey = parseCanonicalDelegateOcrFileKey(fileKey);
    if (parsedFileKey) {
      resolvedKeys.push(parsedFileKey);
      continue;
    }

    if (fileKey.startsWith('filename:')) {
      resolvedKeys.push(fileKey);
      continue;
    }

    if (!hasAvailableFiles) {
      resolvedKeys.push(fileKey);
      continue;
    }
    unresolvedKeys.push(fileKey);
  }

  if (unresolvedKeys.length > 0) {
    throw new Error(
      `delegate_ocr could not resolve attachment file keys: ${unresolvedKeys.join(', ')}`,
    );
  }

  const uniqueResolved = new Set(resolvedKeys);
  if (uniqueResolved.size !== resolvedKeys.length) {
    throw new Error('delegate_ocr duplicate attachment file keys are not allowed');
  }
  return resolvedKeys;
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

export function isDelegateOcrQuoteOnlyTurn(currentUserTurn: string | undefined): boolean {
  const text = String(currentUserTurn ?? '').trim();
  if (!text) {
    return false;
  }
  const quoteIntentPattern =
    /(?:報|报)\s*(?:個|个|一個|一个)?\s*(?:價|价)|估價|估价|價格|价格|單價|单价|價錢|价钱|多少錢|多少钱|多少費用|多少费用|費用|费用|金額|金额|總價|总价|總計|总计|怎麼賣|怎么卖|quote|pricing|price|cost|estimate|how\s+much/giu;
  const clauseBoundaries = [
    '，',
    ',',
    '。',
    '.',
    '；',
    ';',
    '！',
    '!',
    '？',
    '?',
    '：',
    ':',
    '但是',
    '但',
    '不過',
    '不过',
    '而是',
    '改成',
    '改為',
    '改为',
    'however',
    'but',
  ];

  for (const match of text.matchAll(quoteIntentPattern)) {
    const beforeMatch = text.slice(0, match.index);
    let clauseStart = 0;
    for (const boundary of clauseBoundaries) {
      const boundaryIndex = beforeMatch.toLowerCase().lastIndexOf(boundary);
      if (boundaryIndex >= 0) {
        clauseStart = Math.max(clauseStart, boundaryIndex + boundary.length);
      }
    }
    const clausePrefix = beforeMatch.slice(clauseStart).slice(-40);
    const inspectionTerms =
      /看圖|看图|核對|核对|核查|附件|ocr|vision|檢查|检查|檢視|检视|解析|辨識|辨识|讀取|读取|pdf|圖片|图片|inspect|review|verify|check/iu;
    const chineseNegators = [
      ...clausePrefix.matchAll(/不要|不用|不需(?:要)?|無需|无需|暫不|暂不|先不|不想|別|别/gu),
    ];
    const lastChineseNegator = chineseNegators.at(-1);
    const chineseNegated =
      lastChineseNegator != null &&
      !inspectionTerms.test(
        clausePrefix.slice((lastChineseNegator.index ?? 0) + lastChineseNegator[0].length),
      );
    const englishNegators = [
      ...clausePrefix.matchAll(
        /don't|dont|do\s+not|no\s+need(?:\s+to|\s+for)?|not\s+now|without/giu,
      ),
    ];
    const lastEnglishNegator = englishNegators.at(-1);
    const englishNegated =
      lastEnglishNegator != null &&
      !inspectionTerms.test(
        clausePrefix.slice((lastEnglishNegator.index ?? 0) + lastEnglishNegator[0].length),
      );
    const afterMatch = text.slice((match.index ?? 0) + match[0].length);
    const chinesePostfixNegated =
      /^(?:\s*先\s*)?(?:不要|不用(?:了)?|不需(?:要)?|無需|无需|暫不|暂不|先不|不想|別|别)\s*(?=$|[，,。\.；;！!？?：:]|但是|但|不過|不过|而是|改成|改為|改为|however|but)/iu.test(
        afterMatch,
      );
    if (!chineseNegated && !englishNegated && !chinesePostfixNegated) {
      return true;
    }
  }
  return false;
}

export function normalizeDelegateOcrPageRanges(
  ranges: readonly DelegateOcrPageRange[] | undefined,
): DelegateOcrPageRange[] | undefined {
  if (!ranges || ranges.length === 0) {
    return undefined;
  }
  const sorted = [...ranges]
    .map((range) => ({ pageStart: range.pageStart, pageEnd: range.pageEnd }))
    .sort((first, second) => first.pageStart - second.pageStart || first.pageEnd - second.pageEnd);
  const merged: DelegateOcrPageRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.pageStart <= previous.pageEnd + 1) {
      previous.pageEnd = Math.max(previous.pageEnd, range.pageEnd);
      continue;
    }
    merged.push(range);
  }
  return merged;
}

export function parseDelegateOcrPageRangesFromTurn(
  currentUserTurn: string | undefined,
): DelegateOcrPageRange[] | undefined {
  if (!currentUserTurn?.trim()) {
    return undefined;
  }
  const ranges: DelegateOcrPageRange[] = [];
  const pageRangeExpression =
    /(?:(?:第\s*)?(\d+)\s*頁?\s*[-–—~至到]\s*(?:第\s*)?(\d+)\s*頁|(?:pages?|p(?:age)?)\s*(\d+)\s*[-–—~至到]\s*(\d+))/giu;
  for (const match of currentUserTurn.matchAll(pageRangeExpression)) {
    const start = Number(match[1] ?? match[3]);
    const end = Number(match[2] ?? match[4]);
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
      ranges.push({ pageStart: start, pageEnd: end });
    }
  }
  const pageExpression = /(?:第\s*(\d+)\s*頁|(?:pages?|p(?:age)?)\s*(\d+))/giu;
  for (const match of currentUserTurn.matchAll(pageExpression)) {
    const page = Number(match[1] ?? match[2]);
    if (Number.isInteger(page) && page > 0) {
      ranges.push({ pageStart: page, pageEnd: page });
    }
  }
  return normalizeDelegateOcrPageRanges(ranges);
}

function getDelegateOcrCurrentTurn(input: DelegateOcrInput): string {
  if (typeof input.currentUserTurn === 'string' && input.currentUserTurn.trim() !== '') {
    return input.currentUserTurn;
  }
  const latestUserMessage = [...(input.history ?? [])]
    .reverse()
    .find((message) => message.getType?.() === 'human');
  return normalizeDelegateOcrChunk(latestUserMessage?.content);
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
  currentUserTurn,
  ocrRulesText,
  files,
}: {
  currentUserTurn: string;
  ocrRulesText: string;
  files: readonly { file: DelegateOcrFileRecord; url: string }[];
}): BaseMessage[] {
  const sourceContent = [
    {
      type: 'text',
      text: [
        '以下是 delegate_ocr 選定的原始檔案。請依目前使用者請求回答；重新確認時以原始 image/PDF 為權威來源。',
        ...files
          .filter(({ file }) => file.pageStart !== undefined && file.pageEnd !== undefined)
          .map(
            ({ file }) =>
              `此批次 PDF 來源對應原始頁碼 ${file.pageStart}-${file.pageEnd}（含首尾頁）。`,
          ),
      ].join('\n'),
    },
    ...files.map(({ file, url }) => createSourcePart(file, url)),
  ];

  return [
    new SystemMessage(ocrRulesText),
    new HumanMessage(currentUserTurn),
    new HumanMessage({ content: sourceContent }),
  ];
}

function toSelectedFileMetadata(
  fileInput: DelegateOcrFileInput,
  file: DelegateOcrFileRecord,
): DelegateOcrSelectedFileMetadata {
  return {
    fileKey: fileInput.fileKey,
    fileId: file.fileId,
    ...(file.filename ? { filename: file.filename } : {}),
    ...(file.mediaType ? { mediaType: file.mediaType } : {}),
    ...(file.pageStart !== undefined ? { pageStart: file.pageStart } : {}),
    ...(file.pageEnd !== undefined ? { pageEnd: file.pageEnd } : {}),
    ...(fileInput.pageRanges ? { pageRanges: fileInput.pageRanges } : {}),
  };
}

function toMarkdownList(value: string | readonly string[] | undefined): string[] {
  if (typeof value === 'string') {
    return value.trim() === '' ? [] : [value];
  }
  return (value ?? []).filter((markdown): markdown is string => typeof markdown === 'string' && markdown.trim() !== '');
}

type DelegateOcrModelTool = NonNullable<OpenAIOAuthModelOptions['tools']>[number];

function getDelegateOcrModelToolName(tool: DelegateOcrModelTool): string | undefined {
  if (typeof tool !== 'object' || tool === null) {
    return undefined;
  }
  if (
    'type' in tool &&
    tool.type === 'function' &&
    'function' in tool &&
    typeof tool.function === 'object' &&
    tool.function !== null &&
    'name' in tool.function &&
    typeof tool.function.name === 'string'
  ) {
    return tool.function.name;
  }
  if ('name' in tool && typeof tool.name === 'string') {
    return tool.name;
  }
  return undefined;
}

function isDelegateOcrSteelTool(tool: DelegateOcrModelTool): boolean {
  const toolName = getDelegateOcrModelToolName(tool);
  if (!toolName || toolName === delegateOcrToolName) {
    return toolName === delegateOcrToolName;
  }
  const normalizedName = toolName.startsWith('steel_')
    ? toolName.slice('steel_'.length)
    : toolName;
  return isSteelToolName(normalizedName);
}

function hasValidatedCanonicalMappingPrefix(
  markdown: string,
  canonicalMapping: readonly SourceMappingEntry[],
): boolean {
  const match =
    /^ {0,3}##(?!#)[ \t]+source_file_mapping[ \t]*\r?\n([\s\S]*?)(?=\r?\n {0,3}##(?!#)[ \t]+ocr_result[ \t]*\r?\n)/imu.exec(
      markdown,
    );
  if (!match?.[1]) {
    return false;
  }
  const parsed = parseSourceMappingTable(match[1].trim());
  return parsed.ok && validateSourceMapping(parsed.table, canonicalMapping).ok;
}

export function buildDelegateOcrWorkflowMessages(input: {
  ocrRulesText: string;
  canonicalMapping: readonly SourceMappingEntry[];
  previousOcrResultMarkdown?: string;
  suggestedOcrResultColumns: readonly string[];
  selectedFiles: readonly DelegateOcrSelectedFileMetadata[];
  organizerMarkdown: readonly string[];
}): BaseMessage[] {
  const packet = {
    source_file_mapping: input.canonicalMapping,
    previous_ocr_result_markdown: input.previousOcrResultMarkdown ?? '',
    suggested_ocr_result_columns: input.suggestedOcrResultColumns,
    selected_files: input.selectedFiles,
    organizer_markdown: input.organizerMarkdown,
  };
  return [
    new SystemMessage(input.ocrRulesText),
    new HumanMessage({
      content: [
        {
          type: 'text',
          text: [
            'Delegate OCR canonical packet. Use only the backend-authored source mapping and Organizer Markdown below.',
            'The original user request is intentionally scoped to Organizer and is not included in this packet.',
            JSON.stringify(packet),
          ].join('\n'),
        },
      ],
    }),
  ];
}

export async function delegateOcr(input: DelegateOcrInput): Promise<string> {
  const currentUserTurn = getDelegateOcrCurrentTurn(input);
  const delegateModelOptions = {
    ...input.modelOptions,
    tools: (input.modelOptions.tools ?? []).filter((tool) => !isDelegateOcrSteelTool(tool)),
  };
  const parsed = delegateOcrArgsSchema.parse({
    files: input.workflow?.filesOverride ?? input.files,
  });
  const fileKeys = parsed.files.map(({ fileKey }) => fileKey);
  const ownedFiles = await input.findOwnedFiles({
    fileKeys,
    userId: input.userId,
  });
  const selectedFiles = orderSelectedFiles(fileKeys, ownedFiles);
  const batches = input.prepareBatches
    ? await input.prepareBatches({
        files: selectedFiles,
        fileInputs: parsed.files,
        storedFiles: input.storedFiles ?? [],
      })
    : [{ files: selectedFiles, signFile: input.signFile }];
  if (batches.length === 0) {
    throw new Error('delegate_ocr could not prepare any OCR batches');
  }

  const workflow = input.workflow;
  const workflowEnabled = Boolean(
    workflow &&
      (workflow.runPreprocessing ||
        workflow.loadSourceMapping ||
        workflow.loadCurrentOcrResult ||
        workflow.finalize ||
        workflow.runStore),
  );
  let canonicalMapping = workflow?.canonicalMapping ?? [];
  let previousOcrResultMarkdown = workflow?.previousOcrResultMarkdown;
  if (workflow?.loadSourceMapping) {
    canonicalMapping = await workflow.loadSourceMapping({ files: selectedFiles });
  }
  if (workflow?.loadCurrentOcrResult) {
    previousOcrResultMarkdown = await workflow.loadCurrentOcrResult({ files: selectedFiles });
  }

  const signedBatches: Array<{
    batch: DelegateOcrPreparedBatch;
    signedFiles: DelegateOcrSignedFile[];
  }> = [];
  for (const batch of batches) {
    try {
      signedBatches.push({
        batch,
        signedFiles: await Promise.all(
          batch.files.map(async (file) => ({ file, url: await batch.signFile(file) })),
        ),
      });
    } catch (error) {
      const rangeLabel = batch.range;
      const suffix = rangeLabel ? ` for pages ${rangeLabel.pageStart}-${rangeLabel.pageEnd}` : '';
      throw new Error(
        `delegate_ocr failed${suffix}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  const suggestedOcrResultColumns = workflow?.suggestedOcrResultColumns ?? [];
  const organizerMarkdown: string[] = [];
  if (workflow?.runPreprocessing) {
    for (const { batch, signedFiles } of signedBatches) {
      const file = batch.files[0];
      if (!file) {
        continue;
      }
      const fileInput = parsed.files.find(({ fileKey }) => {
        const fileId = fileKey.startsWith('file:') ? fileKey.slice('file:'.length) : fileKey;
        return file.fileId === fileId || file.fileId.startsWith(`${fileId}#`);
      });
      const result = await workflow.runPreprocessing({
        file,
        fileInput,
        batch,
        signedFiles,
        selectedFiles: signedFiles,
        currentUserTurn,
        latestUserMessage: currentUserTurn,
        suggestedOcrResultColumns,
      });
      if (result) {
        organizerMarkdown.push(
          ...toMarkdownList(result.organizerMarkdown),
        );
      }
    }
  }

  const selectedMetadata = selectedFiles.map((file, index) =>
    toSelectedFileMetadata(
      parsed.files[index] ?? { fileKey: `file:${file.fileId}` },
      file,
    ),
  );
  if (workflowEnabled) {
    for (let agentAttempt = 1; agentAttempt <= 3; agentAttempt += 1) {
      const attemptToken =
        workflow?.attemptToken && agentAttempt === 1 ? workflow.attemptToken : randomUUID();
      const attemptInput: DelegateOcrRunAttemptInput = {
        claimToken: workflow?.claimToken,
        generationId: workflow?.generationId,
        attemptNumber: agentAttempt,
        attemptToken,
      };
      if (workflow?.runStore?.beginAttempt) {
        const begun = await workflow.runStore.beginAttempt(attemptInput);
        if (typeof begun === 'string' && begun.trim() !== '') {
          attemptInput.attemptToken = begun;
        } else if (
          begun !== null &&
          typeof begun === 'object' &&
          typeof begun.attemptToken === 'string' &&
          begun.attemptToken.trim() !== ''
        ) {
          attemptInput.attemptToken = begun.attemptToken;
        }
      }
      await workflow?.runStore?.persistAttempt?.(attemptInput);
      const messages = buildDelegateOcrWorkflowMessages({
        ocrRulesText: input.ocrRulesText,
        canonicalMapping,
        previousOcrResultMarkdown,
        suggestedOcrResultColumns,
        selectedFiles: selectedMetadata,
        organizerMarkdown,
      });
      /** Hold only the short mapping prefix. Once its canonical pairs are
       * validated, release it and stream the rest live. A rejected mapping is
       * never emitted, so retries cannot contaminate the accepted response. */
      let bufferedDelta = '';
      let mappingReleased = false;
      const answer = await (input.invokeModel ?? invokeNativeOcrModel)({
        messages,
        modelOptions: delegateModelOptions,
        signal: input.signal,
        attemptNumber: agentAttempt,
        attemptToken: attemptInput.attemptToken,
        onDelta: input.onDelta
          ? async (delta, metadata) => {
              const deltaMetadata = {
                claimToken: workflow?.claimToken,
                generationId: workflow?.generationId,
                attemptToken: metadata?.attemptToken ?? attemptInput.attemptToken,
              };
              if (mappingReleased) {
                await input.onDelta?.(delta, deltaMetadata);
                return;
              }
              bufferedDelta += delta;
              if (hasValidatedCanonicalMappingPrefix(bufferedDelta, canonicalMapping)) {
                mappingReleased = true;
                const acceptedPrefix = bufferedDelta;
                bufferedDelta = '';
                await input.onDelta?.(acceptedPrefix, deltaMetadata);
              }
            }
          : undefined,
      });
      if (answer.trim() === '') {
        throw new Error('delegate_ocr model returned an empty answer');
      }
      let finalized: DelegateOcrFinalizerResult = undefined;
      if (workflow?.finalize) {
        finalized = await workflow.finalize({
          assistantResponse: answer,
          canonicalMapping,
          previousOcrResultMarkdown,
          suggestedOcrResultColumns,
          attemptNumber: agentAttempt,
          attemptToken: attemptInput.attemptToken,
        });
      } else if (canonicalMapping.length > 0) {
        const result = finalizeOcrResponse({
          assistantResponse: answer,
          previousOcrMarkdown: previousOcrResultMarkdown,
          canonicalMapping,
          delegateSummary: true,
          agentKind: 'delegate_ocr',
        });
        finalized = result.ok
          ? { ok: true, finalResponse: result.finalResponse, ocrResultMarkdown: result.ocrResultMarkdown }
          : { ok: false, reason: result.reason, mappingRetryable: result.mappingRetryable };
      }
      if (finalized === undefined || typeof finalized === 'string') {
        const accepted =
          typeof finalized === 'string' && finalized.trim() !== '' ? finalized : answer;
        if (!mappingReleased) {
          await input.onDelta?.(accepted, {
            claimToken: workflow?.claimToken,
            generationId: workflow?.generationId,
            attemptToken: attemptInput.attemptToken,
          });
        }
        return accepted;
      }
      if (finalized.ok) {
        const accepted = finalized.finalResponse ?? answer;
        if (!mappingReleased) {
          await input.onDelta?.(accepted, {
            claimToken: workflow?.claimToken,
            generationId: workflow?.generationId,
            attemptToken: attemptInput.attemptToken,
          });
        }
        return accepted;
      }
      if (finalized.reason === 'mapping_mismatch' && finalized.mappingRetryable !== false) {
        if (agentAttempt < 3) {
          continue;
        }
        await workflow?.saveFailed?.({
          assistantResponse: answer,
          canonicalMapping,
          previousOcrResultMarkdown,
          suggestedOcrResultColumns,
          attemptNumber: agentAttempt,
          attemptToken: attemptInput.attemptToken,
          reason: finalized.reason,
        });
        throw new Error('目前 AI model 暫時不可用，建議先切換別的 model。');
      }
      await workflow?.saveFailed?.({
        assistantResponse: answer,
        canonicalMapping,
        previousOcrResultMarkdown,
        suggestedOcrResultColumns,
        attemptNumber: agentAttempt,
        attemptToken: attemptInput.attemptToken,
        reason: finalized.reason,
      });
      throw new Error(`delegate_ocr ${finalized.reason}`);
    }
    throw new Error('目前 AI model 暫時不可用，建議先切換別的 model。');
  }
  const attemptToken = workflow?.attemptToken || randomUUID();

  const answers: string[] = [];
  for (const entry of signedBatches) {
    const { batch } = entry;
    if (answers.length > 0 && input.onDelta) {
      await input.onDelta('\n\n');
    }
    let signedFiles = entry.signedFiles;
    let answer: string;
    let retriedExpiredUrl = false;
    const throwBatchFailure = (error: unknown): never => {
      const rangeLabel = batch.range;
      const suffix = rangeLabel ? ` for pages ${rangeLabel.pageStart}-${rangeLabel.pageEnd}` : '';
      throw new Error(
        `delegate_ocr failed${suffix}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    };
    while (true) {
      const messages = buildDelegateOcrMessages({
        files: signedFiles,
        currentUserTurn,
        ocrRulesText: input.ocrRulesText,
      });
      let emittedDelta = false;
      try {
        answer = await (input.invokeModel ?? invokeNativeOcrModel)({
          messages,
          modelOptions: delegateModelOptions,
          signal: input.signal,
          attemptNumber: 1,
          attemptToken,
          onDelta: input.onDelta
            ? async (delta) => {
                if (delta !== '') {
                  emittedDelta = true;
                }
                await input.onDelta?.(delta);
              }
            : undefined,
        });
        break;
      } catch (error) {
        if (!retriedExpiredUrl && !emittedDelta && isExpiredSignedUrlError(error)) {
          retriedExpiredUrl = true;
          try {
            signedFiles = await Promise.all(
              batch.files.map(async (file) => ({ file, url: await batch.signFile(file) })),
            );
          } catch (signError) {
            throwBatchFailure(signError);
          }
          continue;
        }
        throwBatchFailure(error);
      }
    }
    if (answer.trim() === '') {
      const rangeLabel = batch.range;
      throw new Error(
        rangeLabel
          ? `delegate_ocr model returned an empty answer for pages ${rangeLabel.pageStart}-${rangeLabel.pageEnd}`
          : 'delegate_ocr model returned an empty answer',
      );
    }
    answers.push(answer);
  }

  return answers.join('\n\n');
}

/** Explicit coordinator entry point for delegate-scoped preprocessing and finalization. */
export async function runDelegateOcrWorkflow(
  input: DelegateOcrInput & { workflow: DelegateOcrWorkflowInput },
): Promise<string> {
  return delegateOcr(input);
}

export function createDelegateOcrRequestExecute({
  history,
  currentUserTurn,
  policy,
  modelOptions,
  userId,
  availableFiles,
  getOwnedFileRecords,
  signStoredFile,
  loadOcrRules,
  invokeModel,
  prepareBatches,
  signal,
  workflow,
}: CreateDelegateOcrRequestExecuteInput): DelegateOcrExecute {
  return async ({ files, onDelta }) => {
    const parsed = delegateOcrArgsSchema.parse({ files });
    const storedFileById = new Map<string, DelegateOcrStoredFileRecord>();
    const resolvedFileKeys = resolveDelegateOcrFileKeys(
      parsed.files.map(({ fileKey }) => fileKey),
      availableFiles,
    );
    const resolvedFiles = parsed.files.map((file, index) => ({
      ...file,
      fileKey: resolvedFileKeys[index]!,
    }));
    if (
      !isResolvedDelegateOcrPolicy(policy) ||
      policy.allowed !== true ||
      policy.allowedFileKeys.length === 0
    ) {
      throw new Error('delegate_ocr policy is unavailable or unresolved');
    }
    const allowedFileKeys = new Set(policy.allowedFileKeys);
    const unauthorizedKeys = resolvedFileKeys.filter((key) => !allowedFileKeys.has(key));
    if (unauthorizedKeys.length > 0) {
      throw new Error(
        `delegate_ocr attachment file keys are not allowed: ${unauthorizedKeys.join(', ')}`,
      );
    }
    const rulesText = await loadOcrRules();
    return delegateOcr({
      files: resolvedFiles,
      history,
      currentUserTurn,
      modelOptions,
      ocrRulesText: rulesText,
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
      prepareBatches: prepareBatches
        ? ({ files, fileInputs }) =>
            prepareBatches({
              files,
              fileInputs,
              storedFiles: [...storedFileById.values()],
            })
        : undefined,
      invokeModel,
      signal,
      onDelta,
      workflow,
    });
  };
}

export function getDelegateOcrToolDefinition(): LCTool {
  return {
    name: delegateOcrToolName,
    description:
      'Use this tool only when you must independently reopen original attached images or PDF chunks with Vision to verify uncertain visual evidence. Do not call it when the user directly supplies or corrects a value, asks only to update or organize confirmed OCR/table data, or the request can be answered from confirmed data. Quote and pricing requests forbid this tool. Pass one or more files in order, using only `file_key` and `page_ranges` shown in source attachment or OCR metadata; do not invent either value. Map `file_key` to `fileKey`. Every PDF requires its own non-empty `pageRanges`; multiple ranges are supported. Image `pageRanges` are ignored.',
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
      const claimToken = config?.configurable?.delegateOcrClaimToken;
      const generationId = config?.configurable?.delegateOcrGenerationId;
      const attemptToken = config?.configurable?.delegateOcrAttemptToken;
      const canDispatchEvent = config?.configurable?.canDispatchEvent;
      const streamingEnabled = config?.configurable?.delegateOcrStreaming === true;
      const runnableConfig = getDelegateOcrRunnableConfig(config);
      const dispatchStreamEvent = async (
        payload: DelegateOcrStreamEventPayload,
      ): Promise<boolean> => {
        if (canDispatchEvent && !(await canDispatchEvent(payload))) {
          return false;
        }
        const hostDispatcher = config?.configurable?.hostCustomEventDispatcher;
        if (typeof hostDispatcher === 'function') {
          await hostDispatcher(delegateOcrStreamEventName, payload);
          return true;
        }
        await dispatchCustomEvent(delegateOcrStreamEventName, payload, runnableConfig);
        return true;
      };
      let activeAttemptToken = attemptToken;
      let dispatchedDelta = false;
      const onDelta = streamingEnabled
        ? async (delta: string, metadata?: DelegateOcrDeltaMetadata): Promise<void> => {
            if (delta === '') {
              return;
            }
            activeAttemptToken = metadata?.attemptToken ?? activeAttemptToken;
            const dispatched = await dispatchStreamEvent({
              phase: 'delta',
              providerToolCallId,
              delta,
              ...(claimToken ? { claimToken } : {}),
              ...(generationId ? { generationId } : {}),
              ...(activeAttemptToken ? { attemptToken: activeAttemptToken } : {}),
            });
            dispatchedDelta = dispatched || dispatchedDelta;
          }
        : undefined;

      try {
        const parsed = delegateOcrArgsSchema.parse(toolArguments);
        const answer = await execute({
          files: parsed.files,
          providerToolCallId,
          onDelta,
          claimToken,
          generationId,
          attemptToken,
          canDispatchEvent,
        });
        if (streamingEnabled) {
          await dispatchStreamEvent({
            phase: 'complete',
            providerToolCallId,
            ...(claimToken ? { claimToken } : {}),
            ...(generationId ? { generationId } : {}),
            ...(activeAttemptToken ? { attemptToken: activeAttemptToken } : {}),
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
            ...(claimToken ? { claimToken } : {}),
            ...(generationId ? { generationId } : {}),
            ...(activeAttemptToken ? { attemptToken: activeAttemptToken } : {}),
          });
        }
        throw error;
      }
    },
  };
}
