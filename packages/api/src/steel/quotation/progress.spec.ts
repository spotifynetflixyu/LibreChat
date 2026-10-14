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

const v2ref = (operationId: string, kind: SteelQuotationCheckpointRef['kind'] = 'chunk') => ref(operationId, kind);

const chunk = (index: number, sourceRowCount: number, status: SteelQuotationChunkState['status'] = 'pending'): SteelQuotationChunkState => ({
  index,
  sourceRowCount,
  status,
});

const run = (chunks: SteelQuotationChunkState[], checkpointRefs: SteelQuotationCheckpointRef[] = []) =>
  ({ chunks, checkpointRefs }) as Pick<SteelQuotationActiveRun, 'chunks' | 'checkpointRefs'>;

describe('quotation progress projection', () => {
  it('projects a successful twenty-four-row root beside a partial twelve-to-six-to-three tree', () => {
    const quotation = run([
      chunk(1, 24),
      chunk(2, 24),
    ], [
      v2ref('leaf-v2:1:r'),
      v2ref('split-v2:2:r', 'main'),
      v2ref('split-v2:2:r.2', 'main'),
      v2ref('split-v2:2:r.2.1', 'main'),
      v2ref('leaf-v2:2:r.1'),
      v2ref('leaf-v2:2:r.2.1.1'),
      v2ref('leaf-v2:2:r.2.2'),
    ]);
    expect(getQuotationWorkUnits(quotation).map((unit) => ({
      sourceChunkIndex: unit.sourceChunkIndex,
      recoveryPath: unit.recoveryPath,
      completed: unit.completed,
    }))).toEqual([
      { sourceChunkIndex: 1, recoveryPath: undefined, completed: true },
      { sourceChunkIndex: 2, recoveryPath: 'r.1', completed: true },
      { sourceChunkIndex: 2, recoveryPath: 'r.2.1.1', completed: true },
      { sourceChunkIndex: 2, recoveryPath: 'r.2.1.2', completed: false },
      { sourceChunkIndex: 2, recoveryPath: 'r.2.2', completed: true },
    ]);
    expect(getQuotationProgress(quotation)).toEqual({ completedChunks: 4, totalChunks: 5 });
    expect(getQuotationProgress(quotation, 2, 'r.2.1.2')).toEqual({
      completedChunks: 4, totalChunks: 5, chunkIndex: 4,
    });
  });

  it('keeps a crash after a v2 split visible as incomplete child leaves', () => {
    const quotation = run([chunk(1, 24)], [v2ref('split-v2:1:r', 'main')]);
    expect(getQuotationWorkUnits(quotation)).toEqual([
      { chunkIndex: 1, sourceChunkIndex: 1, recoveryPath: 'r.1', completed: false },
      { chunkIndex: 2, sourceChunkIndex: 1, recoveryPath: 'r.2', completed: false },
    ]);
  });

  it('retains a one-row retry through same-sized nodes until depth three', () => {
    const paused = run([chunk(1, 1)], [
      v2ref('split-v2:1:r', 'main'),
      v2ref('split-v2:1:r.1', 'main'),
    ]);
    expect(getQuotationWorkUnits(paused)).toEqual([
      { chunkIndex: 1, sourceChunkIndex: 1, recoveryPath: 'r.1.1', completed: false },
    ]);

    const saved = run([chunk(1, 1)], [
      v2ref('split-v2:1:r', 'main'),
      v2ref('split-v2:1:r.1', 'main'),
      v2ref('split-v2:1:r.1.1', 'main'),
      v2ref('leaf-v2:1:r.1.1.1'),
    ]);
    expect(getQuotationWorkUnits(saved)).toEqual([
      { chunkIndex: 1, sourceChunkIndex: 1, recoveryPath: 'r.1.1.1', completed: true },
    ]);
  });

  it('keeps a one-row remainder after a root split visible through its retry tree', () => {
    const quotation = run([chunk(1, 13)], [
      v2ref('split-v2:1:r', 'main'),
      v2ref('leaf-v2:1:r.1'),
      v2ref('split-v2:1:r.2', 'main'),
      v2ref('split-v2:1:r.2.1', 'main'),
      v2ref('leaf-v2:1:r.2.1.1'),
    ]);
    expect(getQuotationWorkUnits(quotation)).toEqual([
      { chunkIndex: 1, sourceChunkIndex: 1, recoveryPath: 'r.1', completed: true },
      { chunkIndex: 2, sourceChunkIndex: 1, recoveryPath: 'r.2.1.1', completed: true },
    ]);
    expect(getQuotationProgress(quotation)).toEqual({ completedChunks: 2, totalChunks: 2 });
  });

  it('ignores orphan, malformed, wrong-kind, and over-depth v2 operations', () => {
    const quotation = run([chunk(1, 24)], [
      v2ref('split-v2:1:r', 'chunk'),
      v2ref('split-v2:1:r.1', 'main'),
      v2ref('split-v2:1:r.1.1.1', 'main'),
      v2ref('leaf-v2:1:r.1', 'main'),
      v2ref('leaf-v2:1:r.1.1.1.1'),
      v2ref('leaf-v2:1:r.bad'),
    ]);
    expect(getQuotationWorkUnits(quotation)).toEqual([
      { chunkIndex: 1, sourceChunkIndex: 1, completed: false },
    ]);
  });

  it('uses deterministic flattened ordinals without retaining a split parent', () => {
    const quotation = run([chunk(1, 30), chunk(2, 10)], [
      v2ref('split-v2:1:r', 'main'),
      v2ref('leaf-v2:1:r.1'),
      v2ref('leaf-v2:1:r.2'),
      v2ref('leaf-v2:1:r.3'),
      v2ref('leaf-v2:2:r'),
    ]);
    expect(getQuotationWorkUnits(quotation).map((unit) => [unit.chunkIndex, unit.sourceChunkIndex, unit.recoveryPath])).toEqual([
      [1, 1, 'r.1'], [2, 1, 'r.2'], [3, 1, 'r.3'], [4, 2, undefined],
    ]);
    expect(getQuotationProgress(quotation, 2, 'r')).toEqual({
      completedChunks: 4, totalChunks: 4, chunkIndex: 4,
    });
  });
});
