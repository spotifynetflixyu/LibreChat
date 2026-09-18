import type {
  SteelQuotationActiveRun,
  SteelQuotationCheckpointRef,
  SteelQuotationChunkState,
} from '@librechat/data-schemas';

import { getQuotationProgress, getQuotationWorkUnits } from './progress';

const ref = (operationId: string, kind: SteelQuotationCheckpointRef['kind']): SteelQuotationCheckpointRef => ({
  operationId,
  kind,
  artifactId: `${operationId}-artifact`,
  sha256: `${operationId}-sha`,
  updatedAt: new Date(),
});

const chunk = (index: number, sourceRowCount: number, status: SteelQuotationChunkState['status'] = 'pending'): SteelQuotationChunkState => ({
  index,
  sourceRowCount,
  status,
});

const run = (chunks: SteelQuotationChunkState[], checkpointRefs: SteelQuotationCheckpointRef[] = []) =>
  ({ chunks, checkpointRefs }) as Pick<SteelQuotationActiveRun, 'chunks' | 'checkpointRefs'>;

describe('quotation progress projection', () => {
  it('expands original six chunks to eight display units when source chunk four has thirty rows', () => {
    const projected = getQuotationWorkUnits(run([
      chunk(1, 10, 'completed'),
      chunk(2, 10, 'completed'),
      chunk(3, 10, 'completed'),
      chunk(4, 30),
      chunk(5, 10),
      chunk(6, 10),
    ], [ref('split:4', 'main')]));

    expect(projected.map((unit) => [unit.chunkIndex, unit.sourceChunkIndex, unit.sliceIndex])).toEqual([
      [1, 1, undefined],
      [2, 2, undefined],
      [3, 3, undefined],
      [4, 4, 1],
      [5, 4, 2],
      [6, 4, 3],
      [7, 5, undefined],
      [8, 6, undefined],
    ]);
    expect(getQuotationProgress(run([
      chunk(1, 10, 'completed'),
      chunk(2, 10, 'completed'),
      chunk(3, 10, 'completed'),
      chunk(4, 30),
      chunk(5, 10),
      chunk(6, 10),
    ], [ref('split:4', 'main')]))).toEqual({ completedChunks: 3, totalChunks: 8 });
  });

  it('maps an unsplit source chunk to its flattened ordinal after an earlier split', () => {
    const quotation = run([
      chunk(1, 10, 'completed'),
      chunk(2, 10, 'completed'),
      chunk(3, 10, 'completed'),
      chunk(4, 30, 'completed'),
      chunk(5, 10, 'completed'),
      chunk(6, 10),
    ], [ref('split:4', 'main'), ref('chunk:4', 'chunk')]);

    expect(getQuotationProgress(quotation, 5)).toEqual({
      completedChunks: 7,
      totalChunks: 8,
      chunkIndex: 7,
    });
  });

  it('reports partial ten, ten, three slice completion and then parent completion', () => {
    const partial = run([chunk(4, 23)], [
      ref('split:4', 'main'),
      ref('slice:4:1', 'chunk'),
      ref('slice:4:2', 'chunk'),
    ]);
    expect(getQuotationWorkUnits(partial).map((unit) => unit.completed)).toEqual([true, true, false]);
    expect(getQuotationProgress(partial)).toEqual({ completedChunks: 2, totalChunks: 3 });
    expect(getQuotationProgress(partial, 4, 2)).toEqual({ completedChunks: 2, totalChunks: 3, chunkIndex: 2 });

    const completed = run([chunk(4, 23, 'completed')], [
      ref('split:4', 'main'),
      ref('chunk:4', 'chunk'),
    ]);
    expect(getQuotationWorkUnits(completed).map((unit) => unit.completed)).toEqual([true, true, true]);
    expect(getQuotationProgress(completed)).toEqual({ completedChunks: 3, totalChunks: 3 });
  });

  it('detects a legacy orphan slice history ref and ignores malformed or out-of-range refs', () => {
    const legacy = run([chunk(4, 23)], [
      ref('child-history:4:slice-1-550e8400-e29b-41d4-a716-446655440000:0', 'main'),
      ref('child-history:4:slice-2-not-a-uuid:0', 'main'),
      ref('slice:4:99', 'chunk'),
      ref('split:4', 'chunk'),
    ]);
    expect(getQuotationWorkUnits(legacy).map((unit) => unit.completed)).toEqual([false, false, false]);
    expect(getQuotationProgress(legacy)).toEqual({ completedChunks: 0, totalChunks: 3 });
  });

  it('uses legacy history only to preserve a split layout without marking work complete', () => {
    const quotation = run([
      chunk(1, 10, 'completed'),
      chunk(2, 10, 'completed'),
      chunk(3, 10, 'completed'),
      chunk(4, 30),
      chunk(5, 10),
      chunk(6, 10),
    ], [ref('child-history:4:slice-1-550e8400-e29b-41d4-a716-446655440000:0', 'main')]);
    expect(getQuotationProgress(quotation)).toEqual({ completedChunks: 3, totalChunks: 8 });
  });

  it('does not double count a completed parent alongside its slices', () => {
    const quotation = run([chunk(4, 23, 'completed')], [
      ref('split:4', 'main'),
      ref('slice:4:1', 'chunk'),
      ref('slice:4:2', 'chunk'),
      ref('chunk:4', 'chunk'),
    ]);
    expect(getQuotationProgress(quotation)).toEqual({ completedChunks: 3, totalChunks: 3 });
    expect(getQuotationWorkUnits(quotation)).toHaveLength(3);
  });

  it('accepts an interrupted run with the durable partial split layout', () => {
    const quotation = run([chunk(4, 30)], [ref('split:4', 'main'), ref('slice:4:1', 'chunk')]);
    expect(getQuotationProgress(quotation, 4, 3)).toEqual({
      completedChunks: 1,
      totalChunks: 3,
      chunkIndex: 3,
    });
  });
});
