import type {
  SteelQuotationActiveRun,
  SteelQuotationCheckpointRef,
  SteelQuotationChunkState,
} from '@librechat/data-schemas';

const QUOTATION_ROWS_PER_SLICE = 10;
export const QUOTATION_V2_SPLIT_SIZES = [12, 6, 3] as const;
export const QUOTATION_V2_MAX_DEPTH = QUOTATION_V2_SPLIT_SIZES.length;
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export interface QuotationWorkUnit {
  /** Flattened, one-based ordinal used by the status stream and UI. */
  chunkIndex: number;
  /** Canonical persisted quotation chunk index. */
  sourceChunkIndex: number;
  /** Recovery slice ordinal when this source chunk was split by the legacy planner. */
  sliceIndex?: number;
  /** Durable v2 recovery path when a tree replaced the canonical/legacy parent. */
  recoveryPath?: string;
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

interface QuotationV2Path {
  base: 'r' | 's';
  legacySliceIndex?: number;
  segments: readonly number[];
  depth: number;
}

interface QuotationV2Operation {
  kind: 'split' | 'leaf';
  sourceChunkIndex: number;
  path: QuotationV2Path;
}

interface QuotationV2Node {
  path: string;
  rowCount: number;
  depth: number;
  parentCompleted: boolean;
}

function parseV2Path(value: unknown): QuotationV2Path | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'r') return { base: 'r', segments: [], depth: 0 };

  const rootMatch = /^r\.(.+)$/u.exec(value);
  if (rootMatch) {
    const segments = rootMatch[1]!.split('.').map(parsePositiveInteger);
    if (segments.length === 0 || segments.length > QUOTATION_V2_MAX_DEPTH ||
      !segments.every((segment): segment is number => segment !== undefined)) return undefined;
    return { base: 'r', segments, depth: segments.length };
  }

  const legacyMatch = /^s([1-9]\d*)(?:\.(.+))?$/u.exec(value);
  if (!legacyMatch) return undefined;
  const legacySliceIndex = parsePositiveInteger(legacyMatch[1]!);
  const segments = legacyMatch[2] ? legacyMatch[2].split('.').map(parsePositiveInteger) : [];
  if (legacySliceIndex === undefined || segments.length + 1 > QUOTATION_V2_MAX_DEPTH ||
    !segments.every((segment): segment is number => segment !== undefined)) return undefined;
  return { base: 's', legacySliceIndex, segments, depth: segments.length + 1 };
}

function v2PathString(path: QuotationV2Path): string {
  const root = path.base === 'r' ? 'r' : `s${path.legacySliceIndex}`;
  return path.segments.length > 0 ? `${root}.${path.segments.join('.')}` : root;
}

/** Parse a v2 operation without trusting its checkpoint payload. */
export function parseQuotationV2Operation(operationId: unknown): QuotationV2Operation | undefined {
  if (typeof operationId !== 'string') return undefined;
  const match = /^(split|leaf)-v2:(\d+):(.+)$/u.exec(operationId);
  if (!match) return undefined;
  const sourceChunkIndex = parsePositiveInteger(match[2]!);
  const path = parseV2Path(match[3]);
  return sourceChunkIndex === undefined || !path
    ? undefined
    : { kind: match[1] as QuotationV2Operation['kind'], sourceChunkIndex, path };
}

function splitCounts(rowCount: number, depth: number): number[] | undefined {
  const size = QUOTATION_V2_SPLIT_SIZES[depth as 0 | 1 | 2];
  if (!size || !isValidSourceRowCount(rowCount)) return undefined;
  if (rowCount <= size) return [rowCount];
  const counts: number[] = [];
  for (let remaining = rowCount; remaining > 0; remaining -= size) {
    counts.push(Math.min(size, remaining));
  }
  return counts;
}

function appendV2Path(path: QuotationV2Path, segment: number): QuotationV2Path {
  return { ...path, segments: [...path.segments, segment], depth: path.depth + 1 };
}

function v2Operations(refs: readonly SteelQuotationCheckpointRef[]): {
  splits: Set<string>;
  leaves: Set<string>;
} {
  const splits = new Set<string>();
  const leaves = new Set<string>();
  for (const ref of refs) {
    const operation = parseQuotationV2Operation(ref?.operationId);
    if (!operation) continue;
    const key = `${operation.sourceChunkIndex}:${v2PathString(operation.path)}`;
    if (operation.kind === 'split' && ref.kind === 'main') splits.add(key);
    if (operation.kind === 'leaf' && ref.kind === 'chunk') leaves.add(key);
  }
  return { splits, leaves };
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

function hasLegacySplitEvidence(
  refs: readonly SteelQuotationCheckpointRef[],
  sourceChunkIndex: number,
  sliceCount: number,
): boolean {
  if (refs.some((ref) => ref?.kind === 'main' && parseSplitOperation(ref.operationId) === sourceChunkIndex)) {
    return true;
  }
  return refs.some((ref) => {
    if (ref?.kind === 'chunk') {
      const parsed = parseSliceOperation(ref.operationId);
      return parsed?.sourceChunkIndex === sourceChunkIndex && parsed.sliceIndex <= sliceCount;
    }
    if (ref?.kind === 'main') {
      const parsed = parseLegacySliceOperation(ref.operationId);
      return parsed?.sourceChunkIndex === sourceChunkIndex && parsed.sliceIndex <= sliceCount;
    }
    return false;
  });
}

function legacySliceCompleted(
  refs: readonly SteelQuotationCheckpointRef[],
  sourceChunkIndex: number,
  sliceIndex: number,
): boolean {
  return refs.some((ref) => {
    if (ref?.kind !== 'chunk') return false;
    const parsed = parseSliceOperation(ref.operationId);
    return parsed?.sourceChunkIndex === sourceChunkIndex && parsed.sliceIndex === sliceIndex;
  });
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
  const operations = v2Operations(refs);
  const chunks = Array.isArray(run.chunks)
    ? [...run.chunks].filter((chunk) => Number.isSafeInteger(chunk?.index) && chunk.index > 0)
      .sort((left, right) => left.index - right.index)
    : [];
  const units: QuotationWorkUnit[] = [];
  for (const chunk of chunks) {
    const parentComplete = isParentComplete(refs, chunk);
    if (!isValidSourceRowCount(chunk.sourceRowCount)) {
      units.push({ chunkIndex: 0, sourceChunkIndex: chunk.index, completed: parentComplete });
      continue;
    }

    const rootPath: QuotationV2Path = { base: 'r', segments: [], depth: 0 };
    const rootNode: QuotationV2Node = {
      path: 'r', rowCount: chunk.sourceRowCount, depth: 0, parentCompleted: parentComplete,
    };
    if (hasValidV2Split(operations, chunk.index, rootNode, rootPath)) {
      units.push(...expandV2Node(operations, chunk.index, rootNode));
      continue;
    }

    const rootLeafCompleted = parentComplete || operations.leaves.has(`${chunk.index}:r`);
    const sliceCount = Math.ceil(chunk.sourceRowCount / QUOTATION_ROWS_PER_SLICE);
    if (hasLegacySplitEvidence(refs, chunk.index, sliceCount)) {
      const legacyCounts = legacySliceCounts(chunk.sourceRowCount);
      for (let sliceIndex = 1; sliceIndex <= sliceCount; sliceIndex += 1) {
        const basePath: QuotationV2Path = { base: 's', legacySliceIndex: sliceIndex, segments: [], depth: 1 };
        const baseNode: QuotationV2Node = {
          path: v2PathString(basePath),
          rowCount: legacyCounts[sliceIndex - 1]!,
          depth: 1,
          parentCompleted: parentComplete || legacySliceCompleted(refs, chunk.index, sliceIndex),
        };
        if (hasValidV2Split(operations, chunk.index, baseNode, basePath)) {
          units.push(...expandV2Node(operations, chunk.index, baseNode));
        } else {
          units.push({
            chunkIndex: 0,
            sourceChunkIndex: chunk.index,
            sliceIndex,
            completed: baseNode.parentCompleted,
          });
        }
      }
      continue;
    }
    units.push({
      chunkIndex: 0,
      sourceChunkIndex: chunk.index,
      completed: rootLeafCompleted,
    });
  }
  return units.map((unit, index) => ({ ...unit, chunkIndex: index + 1 }));
}

function legacySliceCounts(rowCount: number): number[] {
  const counts: number[] = [];
  for (let remaining = rowCount; remaining > 0; remaining -= QUOTATION_ROWS_PER_SLICE) {
    counts.push(Math.min(QUOTATION_ROWS_PER_SLICE, remaining));
  }
  return counts;
}

function hasValidV2Split(
  operations: ReturnType<typeof v2Operations>,
  sourceChunkIndex: number,
  node: QuotationV2Node,
  path: QuotationV2Path,
): boolean {
  return node.depth < QUOTATION_V2_MAX_DEPTH &&
    splitCounts(node.rowCount, node.depth) !== undefined &&
    operations.splits.has(`${sourceChunkIndex}:${v2PathString(path)}`);
}

function expandV2Node(
  operations: ReturnType<typeof v2Operations>,
  sourceChunkIndex: number,
  node: QuotationV2Node,
): QuotationWorkUnit[] {
  const path = parseV2Path(node.path)!;
  const counts = hasValidV2Split(operations, sourceChunkIndex, node, path)
    ? splitCounts(node.rowCount, node.depth)
    : undefined;
  if (counts) {
    return counts.flatMap((rowCount, index) => expandV2Node(operations, sourceChunkIndex, {
      path: v2PathString(appendV2Path(path, index + 1)),
      rowCount,
      depth: node.depth + 1,
      parentCompleted: node.parentCompleted,
    }));
  }
  return [{
    chunkIndex: 0,
    sourceChunkIndex,
    recoveryPath: node.path,
    completed: node.parentCompleted || operations.leaves.has(`${sourceChunkIndex}:${node.path}`),
  }];
}

/** Return aggregate progress and optionally the flattened unit for a source/slice/path. */
export function getQuotationProgress(
  run: Pick<SteelQuotationActiveRun, 'chunks' | 'checkpointRefs'>,
  sourceChunkIndex?: number,
  sliceIndex?: number,
  recoveryPath?: string,
): QuotationProgress {
  const units = getQuotationWorkUnits(run);
  const progress: QuotationProgress = {
    completedChunks: units.filter((unit) => unit.completed).length,
    totalChunks: units.length,
  };
  if (sourceChunkIndex === undefined) return progress;
  const candidates = units.filter((unit) => unit.sourceChunkIndex === sourceChunkIndex);
  let selected: QuotationWorkUnit | undefined;
  if (recoveryPath !== undefined) {
    selected = candidates.find((unit) => unit.recoveryPath === recoveryPath);
    if (!selected && recoveryPath === 'r') {
      selected = candidates.find((unit) => unit.recoveryPath === undefined && unit.sliceIndex === undefined);
    }
    if (!selected) {
      const match = /^s(\d+)$/u.exec(recoveryPath);
      const legacySlice = match ? parsePositiveInteger(match[1]!) : undefined;
      if (legacySlice !== undefined) selected = candidates.find((unit) => unit.sliceIndex === legacySlice);
    }
  } else if (sliceIndex !== undefined) {
    selected = candidates.find((unit) => unit.sliceIndex === sliceIndex);
  } else {
    selected = candidates[candidates.length - 1];
  }
  return selected ? { ...progress, chunkIndex: selected.chunkIndex } : progress;
}
