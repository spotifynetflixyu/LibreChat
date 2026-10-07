import type { SteelReviewOcrContext, SteelReviewRow } from 'librechat-data-provider';
import { reconcileSteelReviewOcrLinks } from './ocr';

function makeRow(rowId: string, part: string, pageNumber: number, processing = false): SteelReviewRow {
  return {
    rowId,
    values: { 備註: { baseline: part, effective: part } },
    source: { fileId: 'drawing', pageNumber },
    system: {
      kind: processing ? 'processing' : 'material',
      parentRowId: processing ? 'material' : null,
      cascadeDeletedBy: null,
    },
  };
}

function makeContext(rows: SteelReviewRow[]): SteelReviewOcrContext {
  return {
    title: 'ocr_result', outputId: 'ocr-output', revision: 'human-v3', headers: ['零件編號'],
    rows: rows.map((row) => ({
      rowId: row.rowId,
      source: row.source,
      values: { 零件編號: row.values['備註'] },
    })),
  };
}

describe('trusted OCR link reconciliation', () => {
  it('uses the selected file/page to disambiguate repeated part numbers after a manual source intent', () => {
    const row = makeRow('material', 'D3', 2);
    const context = makeContext([makeRow('ocr-1', 'D3', 1), makeRow('ocr-2', 'D3', 2)]);
    const result = reconcileSteelReviewOcrLinks(['備註'], [row], context);

    expect(result[0].ocrLink?.rowId).toBe('ocr-2');
    expect(result[0].source).toEqual(row.source);
    expect(result[0].values).toEqual(row.values);
    expect(row.ocrLink).toBeUndefined();
  });

  it('leaves duplicate candidates on the same source page unlinked', () => {
    const context = makeContext([makeRow('ocr-1', 'D3', 1), makeRow('ocr-2', 'D3', 1)]);
    const result = reconcileSteelReviewOcrLinks(['備註'], [makeRow('material', 'D3', 1)], context);

    expect(result[0].ocrLink).toBeNull();
  });

  it('makes processing follow its material link and clears links for deleted materials', () => {
    const context = makeContext([makeRow('ocr-d3', 'D3', 1)]);
    const rows = [makeRow('material', 'D3', 1), makeRow('processing', 'D3', 1, true)];
    const result = reconcileSteelReviewOcrLinks(['備註'], rows, context);
    expect(result[1].ocrLink).toEqual(result[0].ocrLink);

    const deleted = reconcileSteelReviewOcrLinks(['備註'], [{ ...rows[0], deleted: true }, rows[1]], context);
    expect(deleted.map((row) => row.ocrLink)).toEqual([null, null]);
  });

  it('clears links when the immutable context has no authorized evidence', () => {
    const row = { ...makeRow('material', 'D3', 1), ocrLink: { outputId: 'old', revision: 'old', rowId: 'old' } };
    const result = reconcileSteelReviewOcrLinks(['備註'], [row], null);

    expect(result[0].ocrLink).toBeNull();
    expect(result[0].source).toEqual(row.source);
  });
});
