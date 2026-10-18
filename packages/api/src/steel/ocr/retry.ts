import type { Agents } from 'librechat-data-provider';
import type { SteelStepTextReset } from '../native/stream';

/** An OCR preflight turn runs its main agent at most this many times (two retries). */
export const STEEL_OCR_TURN_MAX_ATTEMPTS = 3;

/** The turn fields that decide whether an OCR preflight main agent may be retried. */
export interface SteelOcrTurnContext {
  ocrTurnActive?: boolean;
  delegateOcrResume?: object;
  delegateOcrPolicy?: { allowed?: boolean };
  quotation?: { resume?: boolean };
}

/**
 * Only an OCR preflight turn retries its main agent as a whole: delegate_ocr
 * retries its own attempts, and a quotation resume owns the turn.
 */
export function isSteelOcrPreflightTurn(context: SteelOcrTurnContext | undefined): boolean {
  return (
    context?.ocrTurnActive === true &&
    context.delegateOcrResume == null &&
    context.delegateOcrPolicy?.allowed !== true &&
    context.quotation?.resume !== true
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
  /** One main-agent attempt over the turn's prepared OCR context. Saved OCR chunks are reused. */
  run(): Promise<void>;
  /** A stop request or a terminal error class is not retried. */
  isRetryable(error: unknown): boolean;
}

/**
 * Reruns a failed OCR preflight main agent up to {@link STEEL_OCR_TURN_MAX_ATTEMPTS}
 * times. Before a retry the failed attempt's steps are cleared on the client and
 * dropped from the aggregated content, so the next attempt streams over them.
 */
export async function runSteelOcrTurnWithRetries(
  input: RunSteelOcrTurnWithRetriesInput,
): Promise<void> {
  const { contentParts, stepMap } = input;
  if (!isSteelOcrPreflightTurn(input.context) || !contentParts || !stepMap) {
    return input.run();
  }
  for (let attempt = 1; ; attempt += 1) {
    const contentLength = contentParts.length;
    const indexOffset = input.getIndexOffset();
    const knownStepIds = new Set(stepMap.keys());
    try {
      await input.run();
      return;
    } catch (error) {
      if (
        attempt >= STEEL_OCR_TURN_MAX_ATTEMPTS ||
        input.getIndexOffset() !== indexOffset ||
        !input.isRetryable(error)
      ) {
        throw error;
      }
      for (const stepId of [...stepMap.keys()]) {
        if (knownStepIds.has(stepId)) {
          continue;
        }
        await input.resetStepText?.(stepId);
        stepMap.delete(stepId);
      }
      contentParts.length = contentLength;
    }
  }
}
