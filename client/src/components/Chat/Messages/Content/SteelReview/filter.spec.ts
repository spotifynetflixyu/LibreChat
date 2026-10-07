import type { SteelReviewRow } from 'librechat-data-provider';
import { getSteelReviewPreviewRows, getSteelReviewUnlinkedRowIds } from './filter';

const rows: SteelReviewRow[] = [
  {
    rowId: 'page-one-a',
    values: { Part: { baseline: 'A', effective: 'A' } },
    source: { fileId: 'drawing-a', pageNumber: 1, filename: 'drawing-a.pdf' },
  },
  {
    rowId: 'page-one-b',
    values: { Part: { baseline: 'B', effective: 'B' } },
    source: { fileId: 'drawing-a', pageNumber: 1, filename: 'drawing-a.pdf' },
  },
  {
    rowId: 'page-two',
    values: { Part: { baseline: 'C', effective: 'C' } },
    source: { fileId: 'drawing-a', pageNumber: 2, filename: 'drawing-a.pdf' },
  },
  {
    rowId: 'other-file',
    values: { Part: { baseline: 'D', effective: 'D' } },
    source: { fileId: 'drawing-b', pageNumber: 1, filename: 'drawing-b.pdf' },
  },
  {
    rowId: 'unlocated',
    values: { Part: { baseline: 'E', effective: 'E' } },
    source: null,
  },
  {
    rowId: 'unsupported-source',
    values: { Part: { baseline: 'F', effective: 'F' } },
    source: { fileId: 'drawing-heic', pageNumber: 1, filename: 'drawing.heic' },
  },
];

describe('Steel review source row filtering', () => {
  it('retains the saved unlinked membership while draft binding and preview change', () => {
    const membership = new Set(getSteelReviewUnlinkedRowIds(rows));
    const bound = { ...rows[4], source: rows[0].source };
    const draft = [...rows.slice(0, 4), bound, rows[5]];
    expect(getSteelReviewPreviewRows(draft, 'drawing-b', 2, undefined, 0, membership).unlocated)
      .toEqual([bound]);
    expect(getSteelReviewPreviewRows(draft, 'drawing-a', 1).located).toContain(bound);
    const savedMembership = new Set(getSteelReviewUnlinkedRowIds(draft));
    expect(getSteelReviewPreviewRows(draft, 'drawing-a', 1, undefined, 0, savedMembership).unlocated)
      .toEqual([]);
  });

  it('keeps pending processing visible for parent selection without assigning a source', () => {
    const pending = { ...rows[4], system: { kind: 'processing' as const, parentRowId: null, cascadeDeletedBy: null } };
    expect(getSteelReviewPreviewRows([pending], 'drawing-a', 1, undefined, 0, undefined,
      new Set([pending.rowId])).located).toEqual([pending]);
    expect(pending.source).toBeNull();
    expect(getSteelReviewPreviewRows([pending], 'drawing-b', 1).located).toEqual([]);
  });

  it('keeps every row on the selected file and page together and preserves unlocated rows', () => {
    expect(getSteelReviewPreviewRows(rows, 'drawing-a', 1)).toEqual({
      located: [rows[0], rows[1]],
      unlocated: [rows[4]],
    });
    expect(getSteelReviewPreviewRows(rows, 'drawing-a', 2)).toEqual({
      located: [rows[2]],
      unlocated: [rows[4]],
    });
  });

  it('keeps authorized but unavailable source rows as unlocated evidence', () => {
    expect(getSteelReviewPreviewRows(rows, 'drawing-a', 1, new Set(['drawing-a']))).toEqual({
      located: [rows[0], rows[1]],
      unlocated: [rows[3], rows[4], rows[5]],
    });
  });

  it('keeps a selected source row with a known invalid page as unlocated evidence', () => {
    expect(getSteelReviewPreviewRows(rows, 'drawing-a', 1, new Set(['drawing-a']), 1)).toEqual({
      located: [rows[0], rows[1]],
      unlocated: [rows[2], rows[3], rows[4], rows[5]],
    });
  });
});
