import {
  createSteelWorkingOrderMemoryModel,
  type ISteelWorkingOrderMemory,
} from '@librechat/data-schemas';
import { resolveOcrPreprocessingChunkSizePages } from '../ocr/config';
import { getPaddleOcrResultText } from '../ocr/text';

type Mongoose = typeof import('mongoose');
type SteelJsonPrimitive = string | number | boolean | null;
type SteelJsonValue = SteelJsonPrimitive | SteelJsonValue[] | SteelJsonObject;

interface SteelJsonObject {
  [key: string]: SteelJsonValue;
}

export {
  defaultOcrPreprocessingChunkSizePages,
  ocrPreprocessingChunkSizePagesEnvKey,
  resolveOcrPreprocessingChunkSizePages,
} from '../ocr/config';

export const ocrPreprocessingPipelineVersion = 1;
export const ocrPreprocessingOrganizerVersion = 1;

export interface CaptureToolResultInput {
  conversationId: string;
  requestId?: string;
  providerToolCallId?: string;
  toolName: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  data: unknown;
}

export interface CaptureToolResultResult {
  savedCounts: { [key: string]: number };
  totalSavedCounts?: { [key: string]: number };
  totalTableCounts?: { [key: string]: number };
}

export type SteelOcrSource = 'assistant_ocr' | 'paddleocr_mcp';

export interface SteelOcrFileReference {
  ocrFileKey?: string;
  ocrSource?: string;
  ocrPreprocessing?: SteelJsonObject;
  content?: string;
  fileId?: string;
  file_id?: string;
  id?: string;
  storageKey?: string;
  storage_key?: string;
  filepath?: string;
  path?: string;
  filename?: string;
  name?: string;
  originalname?: string;
  mediaType?: string;
  type?: string;
  mimeType?: string;
  mimetype?: string;
  pageNumber?: number;
  imageIndex?: number;
  width?: number;
  height?: number;
}

export interface SteelOcrFileDescriptor {
  ocrFileKey: string;
  fileId?: string;
  storageKey?: string;
  filename?: string;
  mediaType?: string;
  pageNumber?: number;
  imageIndex?: number;
  width?: number;
  height?: number;
}

export interface FindMissingPaddleOcrFileKeysInput {
  conversationId: string;
  files: readonly SteelOcrFileReference[];
}

export interface FindMissingPaddleOcrFileKeysResult {
  completedKeys: string[];
  missingFiles: SteelOcrFileDescriptor[];
  missingKeys: string[];
}

export interface CapturePaddleOcrResultInput {
  conversationId: string;
  requestId?: string;
  providerToolCallId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  file: SteelOcrFileReference;
  data: unknown;
}

export interface OcrPreprocessingPdfChunkReference {
  source: 's3' | 'cloudfront';
  storageKey: string;
  storageRegion?: string;
  filepath: string;
}

export interface OcrPreprocessingChunkCaptureInput {
  pipelineVersion?: number;
  sourcePdfKey: string;
  chunkIndex: number;
  chunkCount: number;
  pageStart: number;
  pageEnd: number;
  chunkSizePages?: number;
  pdfChunk?: OcrPreprocessingPdfChunkReference;
}

export interface CapturePaddleOcrChunkResultInput {
  conversationId: string;
  requestId?: string;
  providerToolCallId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  file: SteelOcrFileReference;
  chunk: OcrPreprocessingChunkCaptureInput;
  rawResultHash: string;
  data: unknown;
  includeTotals?: boolean;
}

export interface CaptureOcrPreprocessingChunkMarkdownInput {
  conversationId: string;
  requestId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  file: SteelOcrFileReference;
  chunk: OcrPreprocessingChunkCaptureInput;
  rawResultHash: string;
  ocrRuleVersion: string;
  content: string;
  includeTotals?: boolean;
}

export interface OcrPreprocessingStateInput {
  conversationId: string;
  sourcePdfKey: string;
  ocrFileKey: string;
  ocrRuleVersion: string;
  pipelineVersion?: number;
}

export interface OcrPreprocessingChunkState {
  chunkIndex: number;
  chunkCount: number;
  pageStart: number;
  pageEnd: number;
  chunkSizePages: number;
  rawSaved: boolean;
  organizedSaved: boolean;
  rawResultHash?: string;
  rawOcrText?: string;
  ocrRuleVersion?: string;
  organizedMarkdown?: string;
}

export interface OcrPreprocessingState {
  ocrFileKey: string;
  sourcePdfKey: string;
  pipelineVersion: number;
  ocrRuleVersion: string;
  chunkSizePages: number;
  chunkCount: number;
  chunks: OcrPreprocessingChunkState[];
}

interface SteelWorkingOrderMemoryDocument {
  _id?: unknown;
  memoryKind: string;
  sourceKind: string;
  turnIndex: number;
  createdAt?: Date;
  summary?: string;
  payload?: SteelJsonValue;
  sourceRefs?: {
    sourceKind: string;
    sourceId?: string;
    filename?: string;
    fileId?: string;
    storageKey?: string;
    mediaType?: string;
    ocrFileKey?: string;
    pageNumber?: number;
    imageIndex?: number;
    locator?: string;
  }[];
}

interface MemorySourceRef {
  sourceKind: string;
  sourceId?: string;
  filename?: string;
  fileId?: string;
  storageKey?: string;
  mediaType?: string;
  ocrFileKey?: string;
  pageNumber?: number;
  imageIndex?: number;
  locator?: string;
}

const activeSavedMemoryKinds = ['customer_fact', 'price_evidence', 'ocr_extract', 'paddleocr_preflight'];

function isJsonObject(value: SteelJsonValue | undefined): value is SteelJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeByKind(documents: SteelWorkingOrderMemoryDocument[]) {
  const counts: { [key: string]: number } = {};

  for (const document of documents) {
    if (document.memoryKind === 'ocr_extract' && isJsonObject(document.payload)) {
      const kind = getStringProperty(document.payload, 'kind');
      if (kind === 'ocr_preprocessing_chunk_markdown') {
        counts.ocr_preprocessing_chunk_markdown =
          (counts.ocr_preprocessing_chunk_markdown ?? 0) + 1;
        continue;
      }
    }

    counts[document.memoryKind] = (counts[document.memoryKind] ?? 0) + 1;
  }

  return counts;
}

function summarizeTableCounts(documents: SteelWorkingOrderMemoryDocument[]) {
  const counts: { [key: string]: number } = {};

  for (const document of documents) {
    if (document.memoryKind === 'ocr_extract') {
      if (
        isJsonObject(document.payload) &&
        getStringProperty(document.payload, 'kind') === 'ocr_preprocessing_chunk_markdown'
      ) {
        continue;
      }
      counts.ocr_table = (counts.ocr_table ?? 0) + 1;
    }
  }

  return counts;
}

async function readActiveMemoryTotals({
  SteelWorkingOrderMemory,
  conversationId,
}: {
  SteelWorkingOrderMemory: ReturnType<typeof createSteelWorkingOrderMemoryModel>;
  conversationId: string;
}) {
  const documents = await SteelWorkingOrderMemory.find({
    conversationId,
    state: 'active',
    memoryKind: { $in: activeSavedMemoryKinds },
  })
    .select({
      memoryKind: 1,
      'payload.kind': 1,
      'payload.ocrFileKey': 1,
      'payload.ocrSource': 1,
      'payload.title': 1,
    })
    .lean<SteelWorkingOrderMemoryDocument[]>();

  return {
    totalSavedCounts: summarizeByKind(documents),
    totalTableCounts: summarizeTableCounts(documents),
  };
}

function getFirstText(values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeOcrLookupValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeOcrFilename(value: string | undefined): string {
  const lookupValue = normalizeOcrLookupValue(value).replace(/\\/gu, '/').split(/[?#]/u)[0];
  return (
    lookupValue
      .split('/')
      .filter((part) => part !== '')
      .pop() ?? lookupValue
  );
}

export function isSteelOcrCapableFile(file: SteelOcrFileReference): boolean {
  const mediaType = normalizeOcrLookupValue(
    getFirstText([file.mediaType, file.type, file.mimeType, file.mimetype]),
  );
  const filename = normalizeOcrFilename(
    getFirstText([file.filename, file.name, file.originalname, file.filepath, file.path]),
  );

  return (
    mediaType === 'application/pdf' ||
    mediaType.startsWith('image/') ||
    /\.(pdf|png|jpe?g|webp|bmp|gif|tiff?)$/iu.test(filename)
  );
}

export function getSteelOcrFileDescriptor(
  file: SteelOcrFileReference,
): SteelOcrFileDescriptor | undefined {
  if (!isSteelOcrCapableFile(file)) {
    return undefined;
  }

  const fileId = getFirstText([file.fileId, file.file_id, file.id]);
  const storageKey = getFirstText([file.storageKey, file.storage_key]);
  const pathKey = getFirstText([file.filepath, file.path]);
  const filename = getFirstText([file.filename, file.name, file.originalname]);
  const mediaType = getFirstText([file.mediaType, file.type, file.mimeType, file.mimetype]);
  const providedOcrFileKey = getFirstText([file.ocrFileKey]);
  const ocrFileKey =
    providedOcrFileKey !== undefined
      ? providedOcrFileKey
      : fileId !== undefined
        ? `file:${fileId}`
        : storageKey !== undefined
          ? `storage:${storageKey}`
          : pathKey !== undefined
            ? `path:${pathKey}`
            : filename !== undefined
              ? `filename:${normalizeOcrFilename(filename)}`
              : undefined;

  if (ocrFileKey === undefined) {
    return undefined;
  }

  return {
    ocrFileKey,
    ...(fileId !== undefined ? { fileId } : {}),
    ...(storageKey !== undefined ? { storageKey } : {}),
    ...(filename !== undefined ? { filename } : {}),
    ...(mediaType !== undefined ? { mediaType } : {}),
    ...(file.pageNumber !== undefined ? { pageNumber: file.pageNumber } : {}),
    ...(file.imageIndex !== undefined ? { imageIndex: file.imageIndex } : {}),
    ...(file.width !== undefined ? { width: file.width } : {}),
    ...(file.height !== undefined ? { height: file.height } : {}),
  };
}

function getUniqueOcrFileDescriptors(
  files: readonly SteelOcrFileReference[] | undefined,
): SteelOcrFileDescriptor[] {
  const descriptors: SteelOcrFileDescriptor[] = [];
  const seen = new Set<string>();

  for (const file of files ?? []) {
    const descriptor = getSteelOcrFileDescriptor(file);
    if (!descriptor || seen.has(descriptor.ocrFileKey)) {
      continue;
    }
    seen.add(descriptor.ocrFileKey);
    descriptors.push(descriptor);
  }

  return descriptors;
}

function getFactSummary(payload: SteelJsonObject): string {
  return Object.values(payload)
    .filter((value): value is string | number | boolean => {
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    })
    .map(String)
    .filter((value) => value.trim() !== '')
    .join(' ');
}


function toOcrFileMetadataPayload(descriptor: SteelOcrFileDescriptor): SteelJsonObject {
  return {
    ocrFileKey: descriptor.ocrFileKey,
    ...(descriptor.fileId !== undefined ? { fileId: descriptor.fileId } : {}),
    ...(descriptor.storageKey !== undefined ? { storageKey: descriptor.storageKey } : {}),
    ...(descriptor.filename !== undefined ? { filename: descriptor.filename } : {}),
    ...(descriptor.mediaType !== undefined ? { mediaType: descriptor.mediaType } : {}),
    ...(descriptor.pageNumber !== undefined ? { pageNumber: descriptor.pageNumber } : {}),
    ...(descriptor.imageIndex !== undefined ? { imageIndex: descriptor.imageIndex } : {}),
    ...(descriptor.width !== undefined ? { width: descriptor.width } : {}),
    ...(descriptor.height !== undefined ? { height: descriptor.height } : {}),
  };
}

function toJsonValue(value: unknown, seen = new WeakSet<object>()): SteelJsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    const output = value.map((entry) => toJsonValue(entry, seen));
    seen.delete(value);
    return output;
  }

  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);
  const output: SteelJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = toJsonValue(entry, seen);
  }
  seen.delete(value);
  return output;
}

function getArrayProperty(value: SteelJsonValue, key: string): SteelJsonValue[] {
  if (!isJsonObject(value)) {
    return [];
  }
  const property = value[key];
  return Array.isArray(property) ? property : [];
}

function getStringProperty(value: SteelJsonValue, key: string): string | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const property = value[key];
  return typeof property === 'string' ? property : undefined;
}

function getNumberProperty(value: SteelJsonValue, key: string): number | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const property = value[key];
  return typeof property === 'number' ? property : undefined;
}

function getObjectProperty(value: SteelJsonValue, key: string): SteelJsonObject | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const property = value[key];
  return isJsonObject(property) ? property : undefined;
}

function getOcrDescriptorFromPayload(payload: SteelJsonObject): SteelOcrFileDescriptor | undefined {
  const ocrFileKey = getStringProperty(payload, 'ocrFileKey');
  if (ocrFileKey === undefined) {
    return undefined;
  }

  return {
    ocrFileKey,
    ...(getStringProperty(payload, 'fileId') !== undefined
      ? { fileId: getStringProperty(payload, 'fileId') }
      : {}),
    ...(getStringProperty(payload, 'storageKey') !== undefined
      ? { storageKey: getStringProperty(payload, 'storageKey') }
      : {}),
    ...(getStringProperty(payload, 'filename') !== undefined
      ? { filename: getStringProperty(payload, 'filename') }
      : {}),
    ...(getStringProperty(payload, 'mediaType') !== undefined
      ? { mediaType: getStringProperty(payload, 'mediaType') }
      : {}),
    ...(getNumberProperty(payload, 'pageNumber') !== undefined
      ? { pageNumber: getNumberProperty(payload, 'pageNumber') }
      : {}),
    ...(getNumberProperty(payload, 'imageIndex') !== undefined
      ? { imageIndex: getNumberProperty(payload, 'imageIndex') }
      : {}),
    ...(getNumberProperty(payload, 'width') !== undefined
      ? { width: getNumberProperty(payload, 'width') }
      : {}),
    ...(getNumberProperty(payload, 'height') !== undefined
      ? { height: getNumberProperty(payload, 'height') }
      : {}),
  };
}

function toMemorySourceRefs({
  providerToolCallId,
  sourceRefs,
}: {
  providerToolCallId?: string;
  sourceRefs: SteelJsonValue[];
}): MemorySourceRef[] {
  return sourceRefs.filter(isJsonObject).map((ref) => ({
    sourceKind:
      [getStringProperty(ref, 'channel'), getStringProperty(ref, 'factType')]
        .filter((entry): entry is string => entry !== undefined)
        .join(':') || 'tool_result',
    sourceId: providerToolCallId,
    filename: getStringProperty(ref, 'filename') ?? getStringProperty(ref, 'sourceFile'),
    fileId: getStringProperty(ref, 'fileId') ?? getStringProperty(ref, 'file_id'),
    storageKey: getStringProperty(ref, 'storageKey') ?? getStringProperty(ref, 'storage_key'),
    mediaType: getStringProperty(ref, 'mediaType') ?? getStringProperty(ref, 'mimeType'),
    ocrFileKey: getStringProperty(ref, 'ocrFileKey'),
    pageNumber: getNumberProperty(ref, 'pageNumber') ?? getNumberProperty(ref, 'page'),
    imageIndex: getNumberProperty(ref, 'imageIndex'),
    locator: getStringProperty(ref, 'locator'),
  }));
}

function getCustomerSummary(payload: SteelJsonObject): string {
  return [
    getStringProperty(payload, 'displayName'),
    getStringProperty(payload, 'erpCustomerCode'),
    isJsonObject(payload.customerTier)
      ? getStringProperty(payload.customerTier, 'code')
      : undefined,
  ]
    .filter((entry): entry is string => entry !== undefined && entry.trim() !== '')
    .join(' ');
}

function getPriceSummary(payload: SteelJsonObject): string {
  return [
    getStringProperty(payload, 'erpItemCode'),
    getStringProperty(payload, 'productName'),
    getStringProperty(payload, 'specKey'),
  ]
    .filter((entry): entry is string => entry !== undefined && entry.trim() !== '')
    .join(' ');
}

function createToolMemoryDocument(input: {
  conversationId: string;
  requestId?: string;
  providerToolCallId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  memoryKind: string;
  sourceKind: 'tool_result' | 'ocr_result';
  payload: SteelJsonObject;
  summary: string;
  sourceRefs?: MemorySourceRef[];
}) {
  return {
    conversationId: input.conversationId,
    requestId: input.requestId,
    turnIndex: input.turnIndex,
    checkpointTurnIndex: input.checkpointTurnIndex,
    memoryKind: input.memoryKind,
    sourceKind: input.sourceKind,
    state: 'active',
    summary: input.summary,
    payload: input.payload,
    sourceRefs:
      input.sourceRefs && input.sourceRefs.length > 0
        ? input.sourceRefs
        : [
            {
              sourceKind: input.sourceKind,
              sourceId: input.providerToolCallId,
            },
          ],
  };
}

function getGroupedPriceCandidates(data: SteelJsonObject) {
  return getArrayProperty(data, 'queryResults')
    .filter(isJsonObject)
    .flatMap((queryResult) => {
      const queryId = getStringProperty(queryResult, 'queryId');
      if (!queryId) {
        return [];
      }

      return getArrayProperty(queryResult, 'candidates')
        .filter(isJsonObject)
        .map((candidate) => ({ candidate, queryId }));
    });
}

function getToolCaptureDocuments(input: CaptureToolResultInput) {
  const data = toJsonValue(input.data);
  if (!isJsonObject(data)) {
    return [];
  }

  if (input.toolName === 'search_customers') {
    return getArrayProperty(data, 'customers')
      .filter(isJsonObject)
      .map((customer) =>
        createToolMemoryDocument({
          ...input,
          memoryKind: 'customer_fact',
          sourceKind: 'tool_result',
          payload: customer,
          summary: getCustomerSummary(customer) || getFactSummary(customer),
          sourceRefs: toMemorySourceRefs({
            providerToolCallId: input.providerToolCallId,
            sourceRefs: getArrayProperty(customer, 'sourceRefs'),
          }),
        }),
      );
  }

  if (input.toolName === 'search_price_candidates') {
    const providerToolCallId = input.providerToolCallId;
    if (!providerToolCallId) {
      return [];
    }

    return getGroupedPriceCandidates(data).map(({ candidate, queryId }) =>
      createToolMemoryDocument({
        ...input,
        memoryKind: 'price_evidence',
        sourceKind: 'tool_result',
        payload: {
          ...candidate,
          queryRef: {
            providerToolCallId,
            queryId,
          },
        },
        summary: getPriceSummary(candidate) || getFactSummary(candidate),
        sourceRefs: toMemorySourceRefs({
          providerToolCallId: input.providerToolCallId,
          sourceRefs: getArrayProperty(candidate, 'sourceRefs'),
        }),
      }),
    );
  }

  return [];
}

function toPaddleOcrEvidencePayload(payload: SteelJsonObject): SteelJsonObject {
  const text = getPaddleOcrResultText(payload.result);
  return {
    ...payload,
    kind: 'paddleocr_mcp_result',
    ocrSource: 'paddleocr_mcp',
    ocrEngine: 'paddleocr_vl',
    ...(text !== undefined ? { content: text } : {}),
  };
}

function getOcrPreprocessingMetadata(payload: SteelJsonObject): SteelJsonObject | undefined {
  return getObjectProperty(payload, 'ocrPreprocessing');
}

function isOcrPreprocessingKind(payload: SteelJsonObject, kind: string): boolean {
  return getStringProperty(payload, 'kind') === kind;
}

function getRequiredChunkNumber(
  metadata: SteelJsonObject,
  key: 'chunkIndex' | 'chunkCount' | 'pageStart' | 'pageEnd' | 'chunkSizePages',
): number | undefined {
  const value = getNumberProperty(metadata, key);
  return value !== undefined && value > 0 ? value : undefined;
}

function toPartialOcrPreprocessingChunkState(
  document: SteelWorkingOrderMemoryDocument,
): OcrPreprocessingChunkState | undefined {
  if (!isJsonObject(document.payload)) {
    return undefined;
  }
  const metadata = getOcrPreprocessingMetadata(document.payload);
  if (!metadata) {
    return undefined;
  }
  const chunkIndex = getRequiredChunkNumber(metadata, 'chunkIndex');
  const chunkCount = getRequiredChunkNumber(metadata, 'chunkCount');
  const pageStart = getRequiredChunkNumber(metadata, 'pageStart');
  const pageEnd = getRequiredChunkNumber(metadata, 'pageEnd');
  const chunkSizePages = getRequiredChunkNumber(metadata, 'chunkSizePages');
  if (
    chunkIndex === undefined ||
    chunkCount === undefined ||
    pageStart === undefined ||
    pageEnd === undefined ||
    chunkSizePages === undefined
  ) {
    return undefined;
  }

  return {
    chunkIndex,
    chunkCount,
    pageStart,
    pageEnd,
    chunkSizePages,
    rawSaved: false,
    organizedSaved: false,
    ...(getStringProperty(metadata, 'rawResultHash') !== undefined
      ? { rawResultHash: getStringProperty(metadata, 'rawResultHash') }
      : {}),
    ...(getStringProperty(metadata, 'ocrRuleVersion') !== undefined
      ? { ocrRuleVersion: getStringProperty(metadata, 'ocrRuleVersion') }
      : {}),
  };
}

function toOcrPreprocessingState({
  input,
  documents,
}: {
  input: Required<OcrPreprocessingStateInput>;
  documents: SteelWorkingOrderMemoryDocument[];
}): OcrPreprocessingState {
  const chunksByIndex = new Map<number, OcrPreprocessingChunkState>();

  for (const document of documents) {
    if (!isJsonObject(document.payload)) {
      continue;
    }
    const metadata = getOcrPreprocessingMetadata(document.payload);
    if (!metadata) {
      continue;
    }
    const isCurrentRule = getStringProperty(metadata, 'ocrRuleVersion') === input.ocrRuleVersion;

    const nextChunk = toPartialOcrPreprocessingChunkState(document);
    if (!nextChunk) {
      continue;
    }
    const currentChunk = chunksByIndex.get(nextChunk.chunkIndex) ?? nextChunk;

    if (
      document.memoryKind === 'paddleocr_preflight' &&
      isOcrPreprocessingKind(document.payload, 'paddleocr_mcp_chunk_result')
    ) {
      chunksByIndex.set(nextChunk.chunkIndex, {
        ...nextChunk,
        ...currentChunk,
        rawResultHash: nextChunk.rawResultHash ?? currentChunk.rawResultHash,
        rawOcrText: getPaddleOcrResultText(document.payload.result) ?? currentChunk.rawOcrText,
        rawSaved: true,
      });
      continue;
    }

    if (
      document.memoryKind === 'ocr_extract' &&
      isCurrentRule &&
      isOcrPreprocessingKind(document.payload, 'ocr_preprocessing_chunk_markdown')
    ) {
      chunksByIndex.set(nextChunk.chunkIndex, {
        ...nextChunk,
        ...currentChunk,
        rawResultHash: nextChunk.rawResultHash ?? currentChunk.rawResultHash,
        ocrRuleVersion: nextChunk.ocrRuleVersion ?? currentChunk.ocrRuleVersion,
        organizedSaved: true,
        organizedMarkdown: getStringProperty(document.payload, 'content') ?? '',
      });
    }
  }

  const chunks = [...chunksByIndex.values()].sort(
    (left, right) => left.chunkIndex - right.chunkIndex,
  );
  const firstChunk = chunks[0];

  return {
    ocrFileKey: input.ocrFileKey,
    sourcePdfKey: input.sourcePdfKey,
    pipelineVersion: input.pipelineVersion,
    ocrRuleVersion: input.ocrRuleVersion,
    chunkSizePages: firstChunk?.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages(),
    chunkCount: firstChunk?.chunkCount ?? 0,
    chunks,
  };
}

function getPaddleOcrSummary(payload: SteelJsonObject): string {
  const filename = getStringProperty(payload, 'filename');
  const result = isJsonObject(payload.result) ? payload.result : undefined;
  const text =
    (result ? getStringProperty(result, 'text') : undefined) ??
    (result ? getStringProperty(result, 'markdown') : undefined) ??
    getFactSummary(payload);

  return ['PaddleOCR', filename, text?.replace(/\s+/gu, ' ')]
    .filter((entry): entry is string => entry !== undefined && entry.trim() !== '')
    .join(' ');
}

function createPaddleOcrPayload({
  file,
  data,
}: Pick<CapturePaddleOcrResultInput, 'file' | 'data'>): SteelJsonObject | undefined {
  const descriptor = getSteelOcrFileDescriptor(file);
  if (!descriptor) {
    return undefined;
  }

  return {
    kind: 'paddleocr_mcp_result',
    ocrSource: 'paddleocr_mcp',
    ocrEngine: 'paddleocr_vl',
    ...toOcrFileMetadataPayload(descriptor),
    result: toJsonValue(data),
  };
}

function toOcrPreprocessingPdfChunkPayload(
  pdfChunk: OcrPreprocessingPdfChunkReference,
): SteelJsonObject {
  return {
    source: pdfChunk.source,
    storageKey: pdfChunk.storageKey,
    ...(pdfChunk.storageRegion !== undefined ? { storageRegion: pdfChunk.storageRegion } : {}),
    filepath: pdfChunk.filepath,
  };
}

function createPaddleOcrChunkPayload({
  file,
  chunk,
  rawResultHash,
  data,
}: Pick<CapturePaddleOcrChunkResultInput, 'file' | 'chunk' | 'rawResultHash' | 'data'>):
  | SteelJsonObject
  | undefined {
  const descriptor = getSteelOcrFileDescriptor(file);
  if (!descriptor || chunk.pdfChunk === undefined) {
    return undefined;
  }

  return {
    kind: 'paddleocr_mcp_chunk_result',
    ocrSource: 'paddleocr_mcp',
    ocrEngine: 'paddleocr_vl',
    ...toOcrFileMetadataPayload(descriptor),
    ocrPreprocessing: {
      pipelineVersion: chunk.pipelineVersion ?? ocrPreprocessingPipelineVersion,
      sourcePdfKey: chunk.sourcePdfKey,
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      chunkSizePages: chunk.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages(),
      pdfChunk: toOcrPreprocessingPdfChunkPayload(chunk.pdfChunk),
      rawResultHash,
    },
    result: toJsonValue(data),
  };
}

function createOcrPreprocessingChunkMarkdownPayload({
  file,
  chunk,
  rawResultHash,
  ocrRuleVersion,
  content,
}: Pick<
  CaptureOcrPreprocessingChunkMarkdownInput,
  'file' | 'chunk' | 'rawResultHash' | 'ocrRuleVersion' | 'content'
>): SteelJsonObject | undefined {
  const descriptor = getSteelOcrFileDescriptor(file);
  if (!descriptor) {
    return undefined;
  }

  return {
    kind: 'ocr_preprocessing_chunk_markdown',
    ocrSource: 'ocr_preprocessing_subagent',
    ...toOcrFileMetadataPayload(descriptor),
    content,
    ocrPreprocessing: {
      pipelineVersion: chunk.pipelineVersion ?? ocrPreprocessingPipelineVersion,
      sourcePdfKey: chunk.sourcePdfKey,
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      chunkSizePages: chunk.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages(),
      rawResultHash,
      ocrRuleVersion,
      organizerVersion: ocrPreprocessingOrganizerVersion,
    },
  };
}

function createPaddleOcrSourceRef({
  providerToolCallId,
  payload,
}: {
  providerToolCallId?: string;
  payload: SteelJsonObject;
}): MemorySourceRef[] {
  const descriptor = getOcrDescriptorFromPayload(payload);

  return [
    {
      sourceKind: 'paddleocr_mcp',
      sourceId: providerToolCallId,
      ...(descriptor !== undefined ? toOcrFileMetadataPayload(descriptor) : {}),
    },
  ];
}

export function createMongooseSteelWorkingOrderMemoryWriter(mongoose: Mongoose) {
  const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);

  return {
    async captureToolResult(input: CaptureToolResultInput): Promise<CaptureToolResultResult> {
      const documents = getToolCaptureDocuments(input);
      if (documents.length === 0) {
        return { savedCounts: {} };
      }

      await SteelWorkingOrderMemory.insertMany(documents);
      const totals = await readActiveMemoryTotals({
        SteelWorkingOrderMemory,
        conversationId: input.conversationId,
      });
      return {
        savedCounts: summarizeByKind(documents),
        ...totals,
      };
    },

    async findMissingPaddleOcrFileKeys({
      conversationId,
      files,
    }: FindMissingPaddleOcrFileKeysInput): Promise<FindMissingPaddleOcrFileKeysResult> {
      const descriptors = getUniqueOcrFileDescriptors(files);
      const keys = descriptors.map((descriptor) => descriptor.ocrFileKey);
      if (keys.length === 0) {
        return {
          completedKeys: [],
          missingFiles: [],
          missingKeys: [],
        };
      }

      const documents = await SteelWorkingOrderMemory.find({
        conversationId,
        state: 'active',
        memoryKind: 'paddleocr_preflight',
        sourceKind: 'ocr_result',
        'payload.ocrFileKey': { $in: keys },
        'payload.ocrSource': 'paddleocr_mcp',
      }).lean<SteelWorkingOrderMemoryDocument[]>();
      const completedSet = new Set(
        documents
          .map((document) =>
            isJsonObject(document.payload)
              ? getStringProperty(document.payload, 'ocrFileKey')
              : undefined,
          )
          .filter((key): key is string => key !== undefined),
      );
      const missingFiles = descriptors.filter(
        (descriptor) => !completedSet.has(descriptor.ocrFileKey),
      );

      return {
        completedKeys: keys.filter((key) => completedSet.has(key)),
        missingFiles,
        missingKeys: missingFiles.map((descriptor) => descriptor.ocrFileKey),
      };
    },

    async readOcrPreprocessingState(
      input: OcrPreprocessingStateInput,
    ): Promise<OcrPreprocessingState> {
      const pipelineVersion = input.pipelineVersion ?? ocrPreprocessingPipelineVersion;
      const documents = await SteelWorkingOrderMemory.find({
        conversationId: input.conversationId,
        state: 'active',
        memoryKind: { $in: ['paddleocr_preflight', 'ocr_extract'] },
        'payload.ocrFileKey': input.ocrFileKey,
        'payload.ocrPreprocessing.sourcePdfKey': input.sourcePdfKey,
        'payload.ocrPreprocessing.pipelineVersion': pipelineVersion,
      })
        .sort({ 'payload.ocrPreprocessing.chunkIndex': 1, turnIndex: 1, createdAt: 1 })
        .lean<SteelWorkingOrderMemoryDocument[]>();

      return toOcrPreprocessingState({
        input: {
          ...input,
          pipelineVersion,
        },
        documents,
      });
    },

    async capturePaddleOcrResult(
      input: CapturePaddleOcrResultInput,
    ): Promise<CaptureToolResultResult> {
      const payload = createPaddleOcrPayload(input);
      if (!payload) {
        return { savedCounts: {} };
      }

      await SteelWorkingOrderMemory.deleteMany({
        conversationId: input.conversationId,
        memoryKind: 'paddleocr_preflight',
        'payload.ocrFileKey': getStringProperty(payload, 'ocrFileKey'),
      });
      await SteelWorkingOrderMemory.create(
        createToolMemoryDocument({
          conversationId: input.conversationId,
          requestId: input.requestId,
          providerToolCallId: input.providerToolCallId,
          turnIndex: input.turnIndex,
          checkpointTurnIndex: input.checkpointTurnIndex,
          memoryKind: 'paddleocr_preflight',
          sourceKind: 'ocr_result',
          payload,
          summary: getPaddleOcrSummary(payload),
          sourceRefs: createPaddleOcrSourceRef({
            providerToolCallId: input.providerToolCallId,
            payload,
          }),
        }),
      );

      const totals = await readActiveMemoryTotals({
        SteelWorkingOrderMemory,
        conversationId: input.conversationId,
      });

      return {
        savedCounts: { paddleocr_preflight: 1 },
        ...totals,
      };
    },

    async capturePaddleOcrChunkResult(
      input: CapturePaddleOcrChunkResultInput,
    ): Promise<CaptureToolResultResult> {
      const payload = createPaddleOcrChunkPayload(input);
      if (!payload) {
        return { savedCounts: {} };
      }
      const pipelineVersion = input.chunk.pipelineVersion ?? ocrPreprocessingPipelineVersion;
      const chunkSizePages = input.chunk.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages();

      await SteelWorkingOrderMemory.deleteMany({
        conversationId: input.conversationId,
        memoryKind: 'paddleocr_preflight',
        'payload.ocrFileKey': getStringProperty(payload, 'ocrFileKey'),
        'payload.ocrPreprocessing.sourcePdfKey': input.chunk.sourcePdfKey,
        'payload.ocrPreprocessing.pipelineVersion': pipelineVersion,
        'payload.ocrPreprocessing.chunkIndex': input.chunk.chunkIndex,
        'payload.ocrPreprocessing.pageStart': input.chunk.pageStart,
        'payload.ocrPreprocessing.pageEnd': input.chunk.pageEnd,
      });
      await SteelWorkingOrderMemory.create(
        createToolMemoryDocument({
          conversationId: input.conversationId,
          requestId: input.requestId,
          providerToolCallId: input.providerToolCallId,
          turnIndex: input.turnIndex,
          checkpointTurnIndex: input.checkpointTurnIndex,
          memoryKind: 'paddleocr_preflight',
          sourceKind: 'ocr_result',
          payload: {
            ...payload,
            ocrPreprocessing: {
              ...getOcrPreprocessingMetadata(payload),
              chunkSizePages,
            },
          },
          summary: getPaddleOcrSummary(payload),
          sourceRefs: createPaddleOcrSourceRef({
            providerToolCallId: input.providerToolCallId,
            payload,
          }),
        }),
      );

      const totals =
        input.includeTotals === false
          ? undefined
          : await readActiveMemoryTotals({
              SteelWorkingOrderMemory,
              conversationId: input.conversationId,
            });

      return {
        savedCounts: { paddleocr_preflight: 1 },
        ...(totals ?? {}),
      };
    },

    async captureOcrPreprocessingChunkMarkdown(
      input: CaptureOcrPreprocessingChunkMarkdownInput,
    ): Promise<CaptureToolResultResult> {
      const payload = createOcrPreprocessingChunkMarkdownPayload(input);
      if (!payload) {
        return { savedCounts: {} };
      }
      const pipelineVersion = input.chunk.pipelineVersion ?? ocrPreprocessingPipelineVersion;

      await SteelWorkingOrderMemory.deleteMany({
        conversationId: input.conversationId,
        memoryKind: 'ocr_extract',
        'payload.kind': 'ocr_preprocessing_chunk_markdown',
        'payload.ocrFileKey': getStringProperty(payload, 'ocrFileKey'),
        'payload.ocrPreprocessing.sourcePdfKey': input.chunk.sourcePdfKey,
        'payload.ocrPreprocessing.pipelineVersion': pipelineVersion,
        'payload.ocrPreprocessing.ocrRuleVersion': input.ocrRuleVersion,
        'payload.ocrPreprocessing.chunkIndex': input.chunk.chunkIndex,
        'payload.ocrPreprocessing.pageStart': input.chunk.pageStart,
        'payload.ocrPreprocessing.pageEnd': input.chunk.pageEnd,
      });
      await SteelWorkingOrderMemory.create(
        createToolMemoryDocument({
          conversationId: input.conversationId,
          requestId: input.requestId,
          turnIndex: input.turnIndex,
          checkpointTurnIndex: input.checkpointTurnIndex,
          memoryKind: 'ocr_extract',
          sourceKind: 'ocr_result',
          payload,
          summary: getFactSummary(payload),
          sourceRefs: createPaddleOcrSourceRef({
            payload,
          }),
        }),
      );

      const totals =
        input.includeTotals === false
          ? undefined
          : await readActiveMemoryTotals({
              SteelWorkingOrderMemory,
              conversationId: input.conversationId,
            });

      return {
        savedCounts: { ocr_preprocessing_chunk_markdown: 1 },
        ...(totals ?? {}),
      };
    },

  };
}
