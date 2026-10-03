import type { SteelReviewSource, SteelReviewTable } from 'librechat-data-provider';
import {
  applySteelReviewDrafts,
  createSteelReviewDraftState,
  getSteelReviewDraftKey,
  getSteelReviewDraftOwnerKey,
  getSteelReviewDirtyRowIds,
  getSteelReviewPrepareInput,
  rebaseSteelReviewDraftState,
  setSteelReviewDraftCell,
  setSteelReviewDraftSource,
} from './session';

const table: SteelReviewTable = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  tableId: 'ocr_result:1',
  outputId: 'ocr_result:generation-1',
  kind: 'ocr_result',
  revision: 'revision-1',
  latestOutputId: 'ocr_result:generation-1',
  isLatest: true,
  readOnly: false,
  headers: ['品名', '數量'],
  rows: [
    {
      rowId: 'row-1',
      source: null,
      values: {
        品名: { baseline: '鋼板', effective: '鋼板' },
        數量: { baseline: '1', effective: '1' },
      },
    },
    {
      rowId: 'row-2',
      source: null,
      values: {
        品名: { baseline: '角鐵', effective: '角鐵' },
        數量: { baseline: '2', effective: '2' },
      },
    },
  ],
};

const selection = {
  conversationId: table.conversationId,
  messageId: table.messageId,
  kind: table.kind,
  tableId: table.tableId,
};

describe('Steel review local draft session', () => {
  it('keys drafts by the exact output owner and revision', () => {
    expect(getSteelReviewDraftKey(selection, table)).toBe(JSON.stringify({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      kind: 'ocr_result',
      tableId: 'ocr_result:1',
      partIndex: null,
      outputId: 'ocr_result:generation-1',
      baseRevision: 'revision-1',
    }));
    expect(getSteelReviewDraftOwnerKey(selection, table)).toBe(JSON.stringify({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      kind: 'ocr_result',
      tableId: 'ocr_result:1',
      partIndex: null,
      outputId: 'ocr_result:generation-1',
    }));
  });

  it('keeps delimiter-like owners and actual part scopes distinct', () => {
    const delimiterLike = getSteelReviewDraftKey(
      { ...selection, conversationId: 'conversation-1:message-1' },
      table,
    );
    const splitOwner = getSteelReviewDraftKey(
      { ...selection, conversationId: 'conversation-1', messageId: 'message-1:ocr_result' },
      table,
    );
    const textPart = getSteelReviewDraftKey(selection, table);
    const contentPart = getSteelReviewDraftKey({ ...selection, partIndex: 0 }, table);

    expect(delimiterLike).not.toBe(splitOwner);
    expect(textPart).not.toBe(contentPart);
    expect(getSteelReviewDraftKey(selection, { ...table, partIndex: 0 })).toBe(contentPart);
  });

  it('counts each changed trusted row once and applies its draft cells', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, table.rows[0], '品名', '鍍鋅鋼板');
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '3');
    draft = setSteelReviewDraftCell(draft, table.rows[1], '數量', '4');

    expect(getSteelReviewDirtyRowIds(table, draft)).toEqual(['row-1', 'row-2']);
    expect(applySteelReviewDrafts(table.rows, draft)).toEqual([
      {
        ...table.rows[0],
        values: {
          品名: { baseline: '鋼板', effective: '鍍鋅鋼板' },
          數量: { baseline: '1', effective: '3' },
        },
      },
      {
        ...table.rows[1],
        values: {
          品名: { baseline: '角鐵', effective: '角鐵' },
          數量: { baseline: '2', effective: '4' },
        },
      },
    ]);
  });

  it('removes a reverted cell so the row returns to a clean draft', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '3');
    expect(getSteelReviewDirtyRowIds(table, draft)).toEqual(['row-1']);

    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '1');
    expect(draft.cells).toEqual({});
    expect(getSteelReviewDirtyRowIds(table, draft)).toEqual([]);
  });

  it('does not create a draft identity for an untrusted row id', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, { ...table.rows[0], rowId: '' }, '數量', '3');
    expect(draft.cells).toEqual({});
  });

  it('stages one trusted source intent and counts source-only rows once', () => {
    const source: SteelReviewSource = {
      fileId: 'file-1',
      pageNumber: 2,
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
    };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftSource(draft, table.rows[0], source);

    expect(getSteelReviewDirtyRowIds(table, draft)).toEqual(['row-1']);
    expect(applySteelReviewDrafts(table.rows, draft)[0]?.source).toEqual(source);
    expect(getSteelReviewPrepareInput(
      selection,
      table,
      draft,
      applySteelReviewDrafts(table.rows, draft),
    ).sourceIntents).toEqual([{ rowId: 'row-1', fileId: 'file-1', pageNumber: 2 }]);
  });

  it('allows an explicit clear source intent and rebases it after save', () => {
    const source: SteelReviewSource = {
      fileId: 'file-1',
      pageNumber: 1,
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
    };
    const sourcedTable = {
      ...table,
      rows: [{ ...table.rows[0], source }],
    };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, sourcedTable));
    draft = setSteelReviewDraftSource(draft, sourcedTable.rows[0], null);
    expect(getSteelReviewPrepareInput(
      selection,
      sourcedTable,
      draft,
      applySteelReviewDrafts(sourcedTable.rows, draft),
    ).sourceIntents).toEqual([{ rowId: 'row-1', fileId: null, pageNumber: null }]);

    const rebased = rebaseSteelReviewDraftState(draft, [{ ...sourcedTable.rows[0], source: null }], draft.changeSequence);
    expect(rebased.sourceDrafts).toEqual({});
    expect(getSteelReviewDirtyRowIds({ rows: [{ ...sourcedTable.rows[0], source: null }] }, rebased)).toEqual([]);
  });

  it('preserves edits made after a confirmed save while rebasing submitted cells', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '3');
    draft = setSteelReviewDraftCell(draft, table.rows[0], '品名', '鍍鋅鋼板');
    const submittedSequence = draft.changeSequence - 1;
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '4');

    const savedRows = table.rows.map((row) => row.rowId === 'row-1'
      ? { ...row, values: { ...row.values, 品名: { ...row.values.品名, effective: '鍍鋅鋼板' } } }
      : row);
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, submittedSequence);

    expect(rebased.cells).toEqual({ 'row-1\u0000數量': '4' });
    expect(rebased.changeSequence).toBe(draft.changeSequence);
  });
});
