import type { SteelReviewRow, SteelReviewTable } from 'librechat-data-provider';
import {
  createSteelReviewOcrContextTable,
  getSteelReviewReferenceRows,
} from './reference';

function makeRow(
  rowId: string,
  fileId: string,
  pageNumber: number,
  remark: string,
  extra: Partial<SteelReviewRow> = {},
): SteelReviewRow {
  return {
    rowId,
    source: { fileId, pageNumber },
    values: { 備註: { baseline: remark, effective: remark } },
    ...extra,
  };
}

function makeTable(
  systemRows: readonly SteelReviewRow[],
  contextRows: readonly SteelReviewRow[],
  contextIdentity = { outputId: 'ocr-output-1', revision: 'ocr-revision-1' },
): SteelReviewTable {
  return {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    outputId: 'system-output-1',
    title: 'system_order｜報價單',
    kind: 'system_order',
    revision: 'system-revision-1',
    latestOutputId: 'system-output-1',
    isLatest: true,
    readOnly: false,
    headers: ['備註'],
    rows: [...systemRows],
    ocrContext: {
      title: 'ocr_result｜PL.pdf',
      ...contextIdentity,
      headers: ['備註'],
      rows: [...contextRows],
    },
  };
}

function withLink(
  row: SteelReviewRow,
  outputId = 'ocr-output-1',
  revision = 'ocr-revision-1',
  rowId = row.rowId,
): SteelReviewRow {
  return { ...row, ocrLink: { outputId, revision, rowId } };
}

describe('Steel Review OCR references', () => {
  it('shows exact persisted OCR rows for the selected page', () => {
    const contextRows = [
      makeRow('ocr-p1-a', 'drawing.pdf', 1, 'A'),
      makeRow('ocr-p1-b', 'drawing.pdf', 1, 'B'),
      makeRow('ocr-p2', 'drawing.pdf', 2, 'C'),
    ];
    const systemRows = [
      withLink(
        makeRow('system-a', 'drawing.pdf', 1, 'A'),
        'ocr-output-1',
        'ocr-revision-1',
        'ocr-p1-a',
      ),
      withLink(
        makeRow('system-b', 'drawing.pdf', 1, 'B'),
        'ocr-output-1',
        'ocr-revision-1',
        'ocr-p1-b',
      ),
    ];
    const result = getSteelReviewReferenceRows(
      makeTable(systemRows, contextRows),
      systemRows,
      'drawing.pdf',
      1,
    );

    expect(result.mode).toBe('linked');
    expect(result.rows.map((row) => row.rowId)).toEqual(['ocr-p1-a', 'ocr-p1-b']);
  });

  it('filters exact links by page and keeps the reference table read-only', () => {
    const contextRows = [
      makeRow('ocr-p1', 'drawing.pdf', 1, 'A'),
      makeRow('ocr-p2', 'drawing.pdf', 2, 'B'),
    ];
    const systemRows = [
      withLink(
        makeRow('system-p2', 'drawing.pdf', 2, 'B'),
        'ocr-output-1',
        'ocr-revision-1',
        'ocr-p2',
      ),
    ];
    const table = makeTable(systemRows, contextRows);
    const result = getSteelReviewReferenceRows(table, systemRows, 'drawing.pdf', 2);
    const context = table.ocrContext;
    if (!context) throw new Error('expected OCR context');
    const referenceTable = createSteelReviewOcrContextTable(table, context);

    expect(result.rows.map((row) => row.rowId)).toEqual(['ocr-p2']);
    expect(referenceTable.kind).toBe('ocr_result');
    expect(referenceTable.readOnly).toBe(true);
    expect(referenceTable.rows.map((row) => row.rowId)).toEqual(['ocr-p1', 'ocr-p2']);
  });

  it('uses page-level context for unbound rows without implying a link', () => {
    const contextRows = [
      makeRow('ocr-p1-a', 'drawing.pdf', 1, 'A'),
      makeRow('ocr-p1-b', 'drawing.pdf', 1, 'B'),
    ];
    const systemRows = [makeRow('system-unbound', 'drawing.pdf', 1, 'unbound')];
    const result = getSteelReviewReferenceRows(
      makeTable(systemRows, contextRows),
      systemRows,
      'drawing.pdf',
      1,
    );

    expect(result.mode).toBe('context');
    expect(result.rows.map((row) => row.rowId)).toEqual(['ocr-p1-a', 'ocr-p1-b']);
    expect(systemRows[0].ocrLink).toBeUndefined();
  });

  it('rejects mismatched identities and falls back to the selected page context', () => {
    const contextRows = [makeRow('ocr-p1', 'drawing.pdf', 1, 'A')];
    const systemRows = [
      withLink(makeRow('system-a', 'drawing.pdf', 1, 'A'), 'old-output', 'old-revision', 'ocr-p1'),
    ];
    const result = getSteelReviewReferenceRows(
      makeTable(systemRows, contextRows),
      systemRows,
      'drawing.pdf',
      1,
    );

    expect(result.mode).toBe('context');
    expect(result.rows.map((row) => row.rowId)).toEqual(['ocr-p1']);
  });

  it('rejects an exact link after a draft source or remark change', () => {
    const contextRows = [makeRow('ocr-p1', 'drawing.pdf', 1, 'A')];
    const baseRow = withLink(
      makeRow('system-a', 'drawing.pdf', 1, 'A'),
      'ocr-output-1',
      'ocr-revision-1',
      'ocr-p1',
    );
    const changedSource = withLink(
      makeRow('system-a', 'other.pdf', 1, 'A'),
      'ocr-output-1',
      'ocr-revision-1',
      'ocr-p1',
    );
    const changedRemark = makeRow('system-a', 'drawing.pdf', 1, 'changed');
    const table = makeTable([baseRow], contextRows);

    expect(getSteelReviewReferenceRows(table, [changedSource], 'other.pdf', 1).mode).toBe('none');
    expect(getSteelReviewReferenceRows(table, [changedRemark], 'drawing.pdf', 1).mode).toBe(
      'context',
    );
  });

  it('does not flash OCR rows before a system page is displayed', () => {
    const table = makeTable([], [makeRow('ocr-p1', 'drawing.pdf', 1, 'A')]);

    expect(getSteelReviewReferenceRows(table, [], 'drawing.pdf', 1)).toEqual({
      mode: 'none',
      rows: [],
    });
    expect(getSteelReviewReferenceRows(table, [], undefined, 1)).toEqual({
      mode: 'none',
      rows: [],
    });
  });
});
