import type {
  SteelQuotationActiveRun,
  SteelQuotationCheckpointRef,
  SteelQuotationChunkState,
} from '@librechat/data-schemas';

const QUOTATION_ROWS_PER_SLICE = 10;
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export interface QuotationWorkUnit {
  /** Flattened, one-based ordinal used by the status stream and UI. */
  chunkIndex: number;
  /** Canonical persisted quotation chunk index. */
  sourceChunkIndex: number;
  /** Recovery slice ordinal when this source chunk was split. */
  sliceIndex?: number;
  completed: boolean;
}

export interface QuotationProgress {
  completedChunks: number;
  totalChunks: number;
  chunkIndex?: number;
}

export interface QuotationRepairOperation {
  sourceChunkIndex: number;
  sliceIndex?: number;
  attempt: string;
  repairAttempt: number;
  stage: string;
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === value ? parsed : undefined;
}

function parseNonNegativeInteger(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && String(parsed) === value ? parsed : undefined;
}

function isValidSourceRowCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function hasOperation(refs: readonly SteelQuotationCheckpointRef[], operationId: string, kind: string): boolean {
  return refs.some((ref) => ref?.kind === kind && ref?.operationId === operationId);
}

function parseSplitOperation(operationId: unknown): number | undefined {
  if (typeof operationId !== 'string') {
    return undefined;
  }
  const match = /^split:(\d+)$/u.exec(operationId);
  return match ? parsePositiveInteger(match[1]!) : undefined;
}

function parseSliceOperation(operationId: unknown): { sourceChunkIndex: number; sliceIndex: number } | undefined {
  if (typeof operationId !== 'string') {
    return undefined;
  }
  const match = /^slice:(\d+):(\d+)$/u.exec(operationId);
  if (!match) {
    return undefined;
  }
  const sourceChunkIndex = parsePositiveInteger(match[1]!);
  const sliceIndex = parsePositiveInteger(match[2]!);
  return sourceChunkIndex === undefined || sliceIndex === undefined
    ? undefined
    : { sourceChunkIndex, sliceIndex };
}

function parseLegacySliceOperation(operationId: unknown): { sourceChunkIndex: number; sliceIndex: number } | undefined {
  if (typeof operationId !== 'string') {
    return undefined;
  }
  const match = new RegExp(`^child-history:(\\d+):slice-(\\d+)-${UUID_V4}:(\\d+)$`, 'u').exec(operationId);
  if (!match) {
    return undefined;
  }
  const sourceChunkIndex = parsePositiveInteger(match[1]!);
  const sliceIndex = parsePositiveInteger(match[2]!);
  const revision = parseNonNegativeInteger(match[3]!);
  return sourceChunkIndex === undefined || sliceIndex === undefined || revision === undefined
    ? undefined
    : { sourceChunkIndex, sliceIndex };
}

/** Parse the canonical durable repair operation id without trusting payload fields. */
export function parseQuotationRepairOperation(operationId: unknown): QuotationRepairOperation | undefined {
  if (typeof operationId !== 'string') {
    return undefined;
  }
  const match = new RegExp(
    `^repair:(\\d+):((?:slice-(\\d+)-)?${UUID_V4}):(\\d+):([^:]+)$`,
    'u',
  ).exec(operationId);
  if (!match) {
    return undefined;
  }
  const sourceChunkIndex = parsePositiveInteger(match[1]!);
  const sliceIndex = match[3] ? parsePositiveInteger(match[3]) : undefined;
  const repairAttempt = parsePositiveInteger(match[4]!);
  if (sourceChunkIndex === undefined || repairAttempt === undefined || (match[3] && sliceIndex === undefined)) {
    return undefined;
  }
  return {
    sourceChunkIndex,
    ...(sliceIndex !== undefined ? { sliceIndex } : {}),
    attempt: match[2]!,
    repairAttempt,
    stage: match[5]!,
  };
}

function getRefs(run: Pick<SteelQuotationActiveRun, 'checkpointRefs'>): readonly SteelQuotationCheckpointRef[] {
  return Array.isArray(run.checkpointRefs) ? run.checkpointRefs : [];
}

function getValidSliceIndexes(
  refs: readonly SteelQuotationCheckpointRef[],
  sourceChunkIndex: number,
  sliceCount: number,
): Set<number> {
  const indexes = new Set<number>();
  for (const ref of refs) {
    if (ref?.kind !== 'chunk') {
      continue;
    }
    const parsed = parseSliceOperation(ref.operationId);
    if (parsed?.sourceChunkIndex === sourceChunkIndex && parsed.sliceIndex <= sliceCount) {
      indexes.add(parsed.sliceIndex);
    }
  }
  return indexes;
}

function hasLegacySplitEvidence(
  refs: readonly SteelQuotationCheckpointRef[],
  sourceChunkIndex: number,
  sliceCount: number,
): boolean {
  return refs.some((ref) => {
    if (ref?.kind !== 'main') {
      return false;
    }
    const parsed = parseLegacySliceOperation(ref.operationId);
    return parsed?.sourceChunkIndex === sourceChunkIndex && parsed.sliceIndex <= sliceCount;
  });
}

function isSplitChunk(
  refs: readonly SteelQuotationCheckpointRef[],
  chunk: SteelQuotationChunkState,
): boolean {
  if (!isValidSourceRowCount(chunk.sourceRowCount)) {
    return false;
  }
  const sliceCount = Math.ceil(chunk.sourceRowCount / QUOTATION_ROWS_PER_SLICE);
  if (refs.some((ref) => ref?.kind === 'main' && parseSplitOperation(ref.operationId) === chunk.index)) {
    return true;
  }
  return getValidSliceIndexes(refs, chunk.index, sliceCount).size > 0 ||
    hasLegacySplitEvidence(refs, chunk.index, sliceCount);
}

function isParentComplete(refs: readonly SteelQuotationCheckpointRef[], chunk: SteelQuotationChunkState): boolean {
  return chunk.status === 'completed' || hasOperation(refs, `chunk:${chunk.index}`, 'chunk');
}

/**
 * Project canonical quotation chunks and durable recovery evidence into the
 * flattened units exposed to status consumers. Persisted operation ids remain
 * canonical; this function only produces the outgoing view.
 */
export function getQuotationWorkUnits(
  run: Pick<SteelQuotationActiveRun, 'chunks' | 'checkpointRefs'>,
): QuotationWorkUnit[] {
  const refs = getRefs(run);
  const chunks = Array.isArray(run.chunks)
    ? [...run.chunks].filter((chunk) => Number.isSafeInteger(chunk?.index) && chunk.index > 0)
      .sort((left, right) => left.index - right.index)
    : [];
  const units: QuotationWorkUnit[] = [];
  for (const chunk of chunks) {
    const parentComplete = isParentComplete(refs, chunk);
    if (isSplitChunk(refs, chunk)) {
      const sliceCount = Math.ceil(chunk.sourceRowCount / QUOTATION_ROWS_PER_SLICE);
      const completedSlices = getValidSliceIndexes(refs, chunk.index, sliceCount);
      for (let sliceIndex = 1; sliceIndex <= sliceCount; sliceIndex += 1) {
        units.push({
          chunkIndex: units.length + 1,
          sourceChunkIndex: chunk.index,
          sliceIndex,
          completed: parentComplete || completedSlices.has(sliceIndex),
        });
      }
      continue;
    }
    units.push({
      chunkIndex: units.length + 1,
      sourceChunkIndex: chunk.index,
      completed: parentComplete,
    });
  }
  return units;
}

/** Return aggregate progress and optionally the flattened unit for a source/slice. */
export function getQuotationProgress(
  run: Pick<SteelQuotationActiveRun, 'chunks' | 'checkpointRefs'>,
  sourceChunkIndex?: number,
  sliceIndex?: number,
): QuotationProgress {
  const units = getQuotationWorkUnits(run);
  const progress: QuotationProgress = {
    completedChunks: units.filter((unit) => unit.completed).length,
    totalChunks: units.length,
  };
  if (sourceChunkIndex === undefined) {
    return progress;
  }
  const candidates = units.filter((unit) => unit.sourceChunkIndex === sourceChunkIndex);
  const selected = sliceIndex === undefined
    ? candidates[candidates.length - 1]
    : candidates.find((unit) => unit.sliceIndex === sliceIndex);
  return selected ? { ...progress, chunkIndex: selected.chunkIndex } : progress;
}
