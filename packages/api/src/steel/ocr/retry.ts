import type { Agents } from 'librechat-data-provider';
import type { SteelStepTextReset } from '../native/reset';

/** Every OCR step (PaddleOCR call, Organizer chunk, main OCR agent) runs at most this many times. */
export const STEEL_OCR_MAX_ATTEMPTS = 3;

/** Every OCR retry waits this long first. */
export const STEEL_OCR_RETRY_DELAY_MS = 3000;

export const STEEL_OCR_CHUNK_FAILED_CODE = 'STEEL_OCR_CHUNK_FAILED';

/** An OCR result chunk could not be produced; the turn fails without a rerun. */
export class SteelOcrChunkError extends Error {
  readonly code: typeof STEEL_OCR_CHUNK_FAILED_CODE = STEEL_OCR_CHUNK_FAILED_CODE;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SteelOcrChunkError';
  }
}

/** One failed OCR file or page range in the turn error. */
export interface SteelOcrFailureDetail {
  label: string;
  stage: string;
  errorMessage: string;
  pageStart?: number;
  pageEnd?: number;
}

export function createSteelOcrChunkError(
  failures: readonly SteelOcrFailureDetail[],
): SteelOcrChunkError {
  const details = failures.map(({ label, stage, errorMessage, pageStart, pageEnd }) => {
    const pages =
      pageStart !== undefined && pageEnd !== undefined ? ` pages ${pageStart}-${pageEnd}` : '';
    return `${label}${pages} (${stage}): ${errorMessage}`;
  });
  return new SteelOcrChunkError(
    details.length > 0 ? `OCR failed: ${details.join('; ')}` : 'OCR failed',
  );
}

export function isSteelOcrChunkError(error: unknown): boolean {
  return (
    error instanceof SteelOcrChunkError ||
    (Boolean(error) &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code === STEEL_OCR_CHUNK_FAILED_CODE)
  );
}

function readErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const status = candidate.status ?? candidate.statusCode ?? candidate.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/** A client error other than a timeout, conflict or rate limit fails the same way on every attempt. */
export function isTerminalSteelOcrModelError(error: unknown): boolean {
  const status = readErrorStatus(error);
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429
  );
}

export function sleepSteelOcrDelay({
  signal,
  delay = STEEL_OCR_RETRY_DELAY_MS,
  abortMessage = 'OCR retry aborted',
}: {
  signal?: AbortSignal;
  delay?: number;
  abortMessage?: string;
}): Promise<void> {
  const abortError = () => {
    const error = new Error(abortMessage);
    error.name = 'AbortError';
    return error;
  };
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RunWithSteelOcrRetriesInput<T> {
  run(attemptNumber: number): Promise<T>;
  /** A stop request and a terminal model error are never retried. */
  isRetryable?(error: unknown): boolean;
  /** Called after the delay, before the next attempt starts. */
  onRetry?(attemptNumber: number): void | Promise<void>;
  signal?: AbortSignal;
}

/**
 * Runs one OCR step up to {@link STEEL_OCR_MAX_ATTEMPTS} times, waiting
 * {@link STEEL_OCR_RETRY_DELAY_MS} before each retry. The last error is thrown.
 */
export async function runWithSteelOcrRetries<T>(input: RunWithSteelOcrRetriesInput<T>): Promise<T> {
  for (let attemptNumber = 1; ; attemptNumber += 1) {
    try {
      return await input.run(attemptNumber);
    } catch (error) {
      if (
        attemptNumber >= STEEL_OCR_MAX_ATTEMPTS ||
        input.signal?.aborted ||
        isSteelOcrChunkError(error) ||
        isTerminalSteelOcrModelError(error) ||
        input.isRetryable?.(error) === false
      ) {
        throw error;
      }
    }
    await sleepSteelOcrDelay({ signal: input.signal });
    await input.onRetry?.(attemptNumber + 1);
  }
}

/** The turn fields that decide whether an OCR preflight main agent may be retried. */
export interface SteelOcrTurnContext {
  ocrTurnActive?: boolean;
  delegateOcrPolicy?: { allowed?: boolean };
}

/**
 * Only an OCR preflight turn retries its main agent as a whole: delegate_ocr
 * retries its own attempts, and a quotation resume owns the turn.
 */
export function isSteelOcrPreflightTurn(context: SteelOcrTurnContext | undefined): boolean {
  return (
    context?.ocrTurnActive === true &&
    context.delegateOcrPolicy?.allowed !== true
  );
}

export interface RunSteelOcrTurnWithRetriesInput {
  /** The turn's Steel context; any other turn runs exactly once. */
  context: SteelOcrTurnContext | undefined;
  contentParts?: Agents.MessageContentComplex[] | null;
  stepMap?: Map<string, { index: number }> | null;
  resetStepText?: SteelStepTextReset;
  /** Parts inserted outside the graph (steers, labels) shift indices; a retry cannot replay them. */
  getIndexOffset(): number;
  /** One main-agent attempt over the turn's prepared OCR context. Every OCR chunk is already saved. */
  run(): Promise<void>;
  /** A stop request or a terminal error class is not retried. */
  isRetryable(error: unknown): boolean;
  signal?: AbortSignal;
}

/**
 * Reruns a failed OCR preflight main agent up to {@link STEEL_OCR_MAX_ATTEMPTS}
 * times. Before a retry the failed attempt's steps are cleared on the client and
 * dropped from the aggregated content, so the next attempt streams over them.
 * After the last attempt the streamed text stays and the error is thrown.
 */
export async function runSteelOcrTurnWithRetries(
  input: RunSteelOcrTurnWithRetriesInput,
): Promise<void> {
  const { contentParts, stepMap } = input;
  if (!isSteelOcrPreflightTurn(input.context) || !contentParts || !stepMap) {
    return input.run();
  }
  let contentLength = 0;
  let indexOffset = 0;
  let knownStepIds = new Set<string>();
  return runWithSteelOcrRetries({
    signal: input.signal,
    run: () => {
      contentLength = contentParts.length;
      indexOffset = input.getIndexOffset();
      knownStepIds = new Set(stepMap.keys());
      return input.run();
    },
    isRetryable: (error) => input.getIndexOffset() === indexOffset && input.isRetryable(error),
    onRetry: async () => {
      for (const stepId of [...stepMap.keys()]) {
        if (knownStepIds.has(stepId)) {
          continue;
        }
        await input.resetStepText?.(stepId);
        stepMap.delete(stepId);
      }
      contentParts.length = contentLength;
    },
  });
}
