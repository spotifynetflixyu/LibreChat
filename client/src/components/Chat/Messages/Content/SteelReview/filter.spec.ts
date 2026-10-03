import type { SteelReviewRow } from 'librechat-data-provider';
import { getSteelReviewPreviewRows } from './filter';

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
