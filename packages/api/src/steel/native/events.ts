import type {
  CaptureSteelNativeAssistantMarkdownResult,
  CaptureSteelNativeToolResultResult,
} from './markdown';

export const steelNativeStreamEventName = 'steel_event' as const;

export type SteelNativeEventSource =
  | 'assistant_markdown'
  | 'ocr_preprocessing'
  | 'paddleocr_preflight'
  | 'responses_output'
  | 'tool_result';

export type SteelNativeSavedCounts = Record<string, number>;
export type SteelNativeTableCounts = Record<string, number>;

export interface SteelNativeEventBase {
  source: SteelNativeEventSource;
  conversationId?: string;
  requestId?: string;
  messageId?: string;
  toolName?: string;
  providerToolCallId?: string;
}

export interface SteelNativeParseStatusEvent extends SteelNativeEventBase {
  type: 'parse_status';
  message: string;
  parseStatus: 'saved' | 'partial' | 'skipped';
  errorMessage?: string;
  failedKeys?: readonly string[];
  savedCounts?: SteelNativeSavedCounts;
  savedTableCounts?: SteelNativeTableCounts;
  totalSavedCounts?: SteelNativeSavedCounts;
  totalTableCounts?: SteelNativeTableCounts;
}

export interface SteelNativeMemorySavedEvent extends SteelNativeEventBase {
  type: 'memory_saved';
  message: string;
  savedCounts: SteelNativeSavedCounts;
  savedTableCounts?: SteelNativeTableCounts;
  totalSavedCounts?: SteelNativeSavedCounts;
  totalTableCounts?: SteelNativeTableCounts;
}

export type SteelNativeStreamEvent = SteelNativeParseStatusEvent | SteelNativeMemorySavedEvent;

export interface SteelNativeEventEnvelope {
  event: typeof steelNativeStreamEventName;
  data: SteelNativeStreamEvent;
}

type CapturedSteelNativeResult =
  | Extract<CaptureSteelNativeAssistantMarkdownResult, { status: 'captured' }>['result']
  | Extract<CaptureSteelNativeToolResultResult, { status: 'captured' }>['result'];

export interface BuildSteelNativeEventEnvelopesInput extends SteelNativeEventBase {
  capture: CaptureSteelNativeAssistantMarkdownResult | CaptureSteelNativeToolResultResult;
}

export interface SteelPaddleOcrPreflightActivityResult {
  status: 'completed' | 'partial' | 'skipped';
  completedKeys?: readonly string[];
  attemptedKeys?: readonly string[];
  failedKeys?: readonly string[];
  errorMessage?: string;
  skippedReason?: string;
  totalSavedCounts?: SteelNativeSavedCounts;
  totalTableCounts?: SteelNativeTableCounts;
}

export interface BuildSteelPaddleOcrPreflightEventEnvelopesInput
  extends Omit<SteelNativeEventBase, 'source'> {
  preflight: SteelPaddleOcrPreflightActivityResult;
}

export type SteelOcrPreprocessingProgress =
  | {
      stage: 'pdf_chunks_ready';
      pageCount: number;
      chunkCount: number;
      source: 'fetched' | 'uploaded';
    }
  | { stage: 'paddleocr_chunk_started'; chunkIndex: number; chunkCount: number }
  | { stage: 'paddleocr_chunk_saved'; chunkIndex: number; chunkCount: number }
  | { stage: 'organizer_chunk_started'; chunkIndex: number; chunkCount: number }
  | { stage: 'organizer_chunk_saved'; chunkIndex: number; chunkCount: number }
  | { stage: 'merged_markdowns_read'; chunkCount: number }
  | { stage: 'processing_with_merged_markdown'; chunkCount: number }
  | { stage: 'failed'; errorMessage: string };

export interface BuildSteelOcrPreprocessingEventEnvelopesInput
  extends Omit<SteelNativeEventBase, 'source'> {
  ocrFileKey: string;
  progress: SteelOcrPreprocessingProgress;
}

function hasSavedCounts(
  savedCounts?: SteelNativeSavedCounts,
): savedCounts is SteelNativeSavedCounts {
  if (!savedCounts) {
    return false;
  }

  return Object.values(savedCounts).some((count) => Number.isFinite(count) && count > 0);
}

function captureCountMetadata(result: CapturedSteelNativeResult) {
  return {
    ...('savedTableCounts' in result && hasSavedCounts(result.savedTableCounts)
      ? { savedTableCounts: result.savedTableCounts }
      : {}),
    ...('totalSavedCounts' in result && hasSavedCounts(result.totalSavedCounts)
      ? { totalSavedCounts: result.totalSavedCounts }
      : {}),
    ...('totalTableCounts' in result && hasSavedCounts(result.totalTableCounts)
      ? { totalTableCounts: result.totalTableCounts }
      : {}),
  };
}

function preflightCountMetadata(preflight: SteelPaddleOcrPreflightActivityResult) {
  return {
    ...('totalSavedCounts' in preflight && hasSavedCounts(preflight.totalSavedCounts)
      ? { totalSavedCounts: preflight.totalSavedCounts }
      : {}),
    ...('totalTableCounts' in preflight && hasSavedCounts(preflight.totalTableCounts)
      ? { totalTableCounts: preflight.totalTableCounts }
      : {}),
  };
}

function baseEvent(input: SteelNativeEventBase): SteelNativeEventBase {
  return {
    source: input.source,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.providerToolCallId ? { providerToolCallId: input.providerToolCallId } : {}),
  };
}

export function buildSteelNativeEventEnvelopes({
  capture,
  ...input
}: BuildSteelNativeEventEnvelopesInput): SteelNativeEventEnvelope[] {
  if (capture.status !== 'captured') {
    return [];
  }

  const events: SteelNativeEventEnvelope[] = [];
  const eventBase = baseEvent(input);

  if ('parseStatus' in capture.result) {
    const savedCounts = hasSavedCounts(capture.result.savedCounts)
      ? capture.result.savedCounts
      : undefined;
    const countMetadata = captureCountMetadata(capture.result);
    events.push({
      event: steelNativeStreamEventName,
      data: {
        type: 'parse_status',
        message: `Markdown parse ${capture.result.parseStatus}`,
        parseStatus: capture.result.parseStatus,
        ...(savedCounts ? { savedCounts } : {}),
        ...countMetadata,
        ...eventBase,
      },
    });
  }

  if (hasSavedCounts(capture.result.savedCounts)) {
    const countMetadata = captureCountMetadata(capture.result);
    events.push({
      event: steelNativeStreamEventName,
      data: {
        type: 'memory_saved',
        message: 'Working Order Memory saved',
        savedCounts: capture.result.savedCounts,
        ...countMetadata,
        ...eventBase,
      },
    });
  }

  return events;
}

function getPaddleOcrSavedCount(preflight: SteelPaddleOcrPreflightActivityResult): number {
  const failedKeys = new Set(preflight.failedKeys ?? []);
  return (preflight.attemptedKeys ?? []).filter((key) => !failedKeys.has(key)).length;
}

function getPaddleOcrParseStatus(
  preflight: SteelPaddleOcrPreflightActivityResult,
): SteelNativeParseStatusEvent['parseStatus'] | undefined {
  if (preflight.status === 'completed') {
    return undefined;
  }

  if (preflight.status === 'partial') {
    return 'partial';
  }

  if (preflight.skippedReason === 'all_files_already_have_paddleocr') {
    return 'skipped';
  }

  return undefined;
}

export function buildSteelPaddleOcrPreflightEventEnvelopes({
  preflight,
  ...input
}: BuildSteelPaddleOcrPreflightEventEnvelopesInput): SteelNativeEventEnvelope[] {
  const savedCount = getPaddleOcrSavedCount(preflight);
  const parseStatus = getPaddleOcrParseStatus(preflight);
  const eventBase = baseEvent({ ...input, source: 'paddleocr_preflight' });
  const savedCounts = savedCount > 0 ? { paddleocr_preflight: savedCount } : undefined;
  const countMetadata = preflightCountMetadata(preflight);
  const events: SteelNativeEventEnvelope[] = [];

  if (parseStatus) {
    events.push({
      event: steelNativeStreamEventName,
      data: {
        type: 'parse_status',
        message: `PaddleOCR preflight ${parseStatus}`,
        parseStatus,
        ...(savedCounts ? { savedCounts } : {}),
        ...(preflight.errorMessage
          ? {
              errorMessage: preflight.errorMessage,
              failedKeys: preflight.failedKeys ?? [],
            }
          : {}),
        ...countMetadata,
        ...eventBase,
      },
    });
  }

  if (savedCounts) {
    events.push({
      event: steelNativeStreamEventName,
      data: {
        type: 'memory_saved',
        message: 'PaddleOCR preflight saved',
        savedCounts,
        ...countMetadata,
        ...eventBase,
      },
    });
  }

  return events;
}

export function buildSteelOcrPreprocessingEventEnvelopes({
  ocrFileKey,
  progress,
  ...input
}: BuildSteelOcrPreprocessingEventEnvelopesInput): SteelNativeEventEnvelope[] {
  const eventBase = baseEvent({ ...input, source: 'ocr_preprocessing' });

  switch (progress.stage) {
    case 'pdf_chunks_ready':
      const message =
        progress.source === 'fetched'
          ? `Fetched pdf chunks (${progress.pageCount} pages / ${progress.chunkCount} chunks) (${ocrFileKey})`
          : `Uploaded pdf to S3 (${progress.pageCount} pages / ${progress.chunkCount} chunks) (${ocrFileKey})`;
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'paddleocr_chunk_started':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Running paddleocr_vl in PaddleOCR (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'paddleocr_chunk_saved':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Ran paddleocr_vl in PaddleOCR (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'memory_saved',
            message: `PaddleOCR preflight saved (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            savedCounts: { paddleocr_preflight: 1 },
            ...eventBase,
          },
        },
      ];
    case 'organizer_chunk_started':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Running OCR markdown process (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'organizer_chunk_saved':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Ran OCR markdown process (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'memory_saved',
            message: `Saved OCR markdown (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            savedCounts: { ocr_preprocessing_chunk_markdown: 1 },
            ...eventBase,
          },
        },
      ];
    case 'merged_markdowns_read':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Read OCR markdowns (${ocrFileKey}: ${progress.chunkCount} chunks)`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'processing_with_merged_markdown':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Processing pdf with OCR markdowns (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'failed':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `ocr preprocessing failed (${ocrFileKey})`,
            parseStatus: 'partial',
            errorMessage: progress.errorMessage,
            failedKeys: [ocrFileKey],
            ...eventBase,
          },
        },
      ];
    default:
      return [];
  }
}
