import type {
  SteelQuotationActiveRun,
  SteelQuotationCheckpointRef,
  SteelQuotationChunkState,
} from '@librechat/data-schemas';

export const QUOTATION_V2_SPLIT_SIZES = [12, 6, 3] as const;
export const QUOTATION_V2_MAX_DEPTH = QUOTATION_V2_SPLIT_SIZES.length;
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export interface QuotationWorkUnit {
  /** Flattened, one-based ordinal used by the status stream and UI. */
  chunkIndex: number;
  /** Canonical persisted quotation chunk index. */
  sourceChunkIndex: number;
  /** Durable v2 recovery path when a tree replaced the canonical parent. */
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

function isValidSourceRowCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function hasOperation(refs: readonly SteelQuotationCheckpointRef[], operationId: string, kind: string): boolean {
  return refs.some((ref) => ref?.kind === kind && ref?.operationId === operationId);
}

interface QuotationV2Path {
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
  if (value === 'r') return { segments: [], depth: 0 };
  const match = /^r\.(.+)$/u.exec(value);
  if (!match) return undefined;
  const segments = match[1]!.split('.').map(parsePositiveInteger);
  if (segments.length === 0 || segments.length > QUOTATION_V2_MAX_DEPTH ||
    !segments.every((segment): segment is number => segment !== undefined)) return undefined;
  return { segments, depth: segments.length };
}

function v2PathString(path: QuotationV2Path): string {
  return path.segments.length > 0 ? `r.${path.segments.join('.')}` : 'r';
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
  const match = new RegExp(`^repair:(\\d+):(${UUID_V4}):(\\d+):([^:]+)$`, 'u').exec(operationId);
  if (!match) {
    return undefined;
  }
  const sourceChunkIndex = parsePositiveInteger(match[1]!);
  const repairAttempt = parsePositiveInteger(match[3]!);
  if (sourceChunkIndex === undefined || repairAttempt === undefined) {
    return undefined;
  }
  return { sourceChunkIndex, attempt: match[2]!, repairAttempt, stage: match[4]! };
}

function getRefs(run: Pick<SteelQuotationActiveRun, 'checkpointRefs'>): readonly SteelQuotationCheckpointRef[] {
  return Array.isArray(run.checkpointRefs) ? run.checkpointRefs : [];
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

    const rootPath: QuotationV2Path = { segments: [], depth: 0 };
    const rootNode: QuotationV2Node = {
      path: 'r', rowCount: chunk.sourceRowCount, depth: 0, parentCompleted: parentComplete,
    };
    if (hasValidV2Split(operations, chunk.index, rootNode, rootPath)) {
      units.push(...expandV2Node(operations, chunk.index, rootNode));
      continue;
    }

    units.push({
      chunkIndex: 0,
      sourceChunkIndex: chunk.index,
      completed: parentComplete || operations.leaves.has(`${chunk.index}:r`),
    });
  }
  return units.map((unit, index) => ({ ...unit, chunkIndex: index + 1 }));
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

/** Return aggregate progress and optionally the flattened unit for a source chunk/path. */
export function getQuotationProgress(
  run: Pick<SteelQuotationActiveRun, 'chunks' | 'checkpointRefs'>,
  sourceChunkIndex?: number,
  recoveryPath?: string,
): QuotationProgress {
  const units = getQuotationWorkUnits(run);
  const progress: QuotationProgress = {
    completedChunks: units.filter((unit) => unit.completed).length,
    totalChunks: units.length,
  };
  if (sourceChunkIndex === undefined) return progress;
  const candidates = units.filter((unit) => unit.sourceChunkIndex === sourceChunkIndex);
  const selected = recoveryPath === undefined
    ? candidates[candidates.length - 1]
    : candidates.find((unit) => (unit.recoveryPath ?? 'r') === recoveryPath);
  return selected ? { ...progress, chunkIndex: selected.chunkIndex } : progress;
}
