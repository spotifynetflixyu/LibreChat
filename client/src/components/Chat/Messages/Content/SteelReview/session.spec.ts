import type { SteelReviewSource, SteelReviewTable } from 'librechat-data-provider';
import {
  addSteelReviewDraftRow,
  applySteelReviewDrafts,
  canRedoSteelReviewDraft,
  canUndoSteelReviewDraft,
  clearSteelReviewDraftHistory,
  createSteelReviewDraftState,
  deleteSteelReviewDraftRow,
  getSteelReviewDraftKey,
  getSteelReviewDraftOwnerKey,
  getSteelReviewDirtyRowIds,
  getSteelReviewPrepareInput,
  rebaseSteelReviewDraftState,
  setSteelReviewDraftCell,
  finishSteelReviewDraftHistory,
  setSteelReviewDraftSource,
  undoSteelReviewDraft,
  redoSteelReviewDraft,
  restoreSteelReviewDraftRow,
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
  it('clears undo and redo stacks after an authoritative save', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '3');
    draft = undoSteelReviewDraft(draft);
    draft = redoSteelReviewDraft(draft);
    expect(canUndoSteelReviewDraft(draft)).toBe(true);
    expect(canRedoSteelReviewDraft(draft)).toBe(false);
    const cleared = clearSteelReviewDraftHistory(draft);
    expect(canUndoSteelReviewDraft(cleared)).toBe(false);
    expect(canRedoSteelReviewDraft(cleared)).toBe(false);
    expect(cleared.cells).toEqual(draft.cells);
  });

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

  it('stages one typed source operation and counts source-only rows once', () => {
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
    ).operations).toEqual([{ type: 'update', rowId: 'row-1', source: { fileId: 'file-1', pageNumber: 2 } }]);
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
    ).operations).toEqual([{ type: 'update', rowId: 'row-1', source: { fileId: null, pageNumber: null } }]);

    const rebased = rebaseSteelReviewDraftState(draft, [{ ...sourcedTable.rows[0], source: null }], draft.changeSequence);
    expect(rebased.sourceDrafts).toEqual({});
    expect(getSteelReviewDirtyRowIds({ rows: [{ ...sourcedTable.rows[0], source: null }] }, rebased)).toEqual([]);
  });

  it('keeps legacy omitted media metadata omitted while projecting a page correction', () => {
    const sourcedRow = {
      ...table.rows[0],
      values: {
        ...table.rows[0].values,
        來源: { baseline: 'A', effective: 'A' },
        頁碼: { baseline: '1', effective: '1' },
      },
      source: { fileId: 'file-1', pageNumber: 1, filename: 'drawing.pdf' },
    };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftSource(draft, sourcedRow, {
      fileId: 'file-1', pageNumber: 2, filename: 'drawing.pdf', mediaType: 'application/pdf',
    });

    const [projected] = applySteelReviewDrafts([sourcedRow], draft);
    expect(projected?.source).toEqual({ fileId: 'file-1', pageNumber: 2, filename: 'drawing.pdf' });
    expect(projected?.values.來源?.effective).toBe('A');
    expect(projected?.values.頁碼?.effective).toBe('2');
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

  it('keeps identical manual rows independent and drops an add-delete before save', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = addSteelReviewDraftRow(draft, table, table.rows[0], null);
    const first = applySteelReviewDrafts(table.rows, draft).find((row) => row.origin === 'manual');
    draft = addSteelReviewDraftRow(draft, table, table.rows[0], null);
    const rows = applySteelReviewDrafts(table.rows, draft);
    const manuals = rows.filter((row) => row.origin === 'manual');
    expect(manuals).toHaveLength(2);
    expect(manuals[0]?.rowId).not.toBe(manuals[1]?.rowId);
    expect(manuals[0]?.values.品名).toEqual({ baseline: null, effective: '' });
    draft = deleteSteelReviewDraftRow(draft, first!, false);
    expect(applySteelReviewDrafts(table.rows, draft).filter((row) => row.origin === 'manual')).toHaveLength(1);
  });

  it('projects cell edits onto newly inserted rows before prepare', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = addSteelReviewDraftRow(draft, table, undefined, null);
    const added = applySteelReviewDrafts(table.rows, draft).find((row) => row.origin === 'manual');
    expect(added).toBeDefined();
    draft = setSteelReviewDraftCell(draft, added!, '品名', 'MANUAL-DUPLICATE');
    expect(applySteelReviewDrafts(table.rows, draft).find((row) => row.rowId === added?.rowId)?.values.品名.effective)
      .toBe('MANUAL-DUPLICATE');
  });

  it('anchors a row added after a new row to the original trusted anchor', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = addSteelReviewDraftRow(draft, table, table.rows[0], null);
    const first = applySteelReviewDrafts(table.rows, draft).find((row) => row.origin === 'manual');
    draft = addSteelReviewDraftRow(draft, table, first, null);
    const manuals = applySteelReviewDrafts(table.rows, draft).filter((row) => row.origin === 'manual');
    expect(manuals[0]?.insertion).toEqual({ kind: 'after', rowId: 'row-1', ordinal: 0 });
    expect(manuals[1]?.insertion).toEqual({ kind: 'after', rowId: 'row-1', ordinal: 1 });
  });

  it('emits a typed source intent for a newly inserted sourced row', () => {
    const source: SteelReviewSource = { fileId: 'file-1', pageNumber: 2, filename: 'drawing.pdf' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = addSteelReviewDraftRow(draft, table, undefined, source);
    const input = getSteelReviewPrepareInput(selection, table, draft, applySteelReviewDrafts(table.rows, draft));
    expect(input.operations).toEqual([
      expect.objectContaining({ type: 'add', source: { fileId: 'file-1', pageNumber: 2 } }),
    ]);
  });

  it('undoes and redoes a row insertion and delete without network state', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = addSteelReviewDraftRow(draft, table, undefined, null);
    const added = applySteelReviewDrafts(table.rows, draft).find((row) => row.origin === 'manual');
    expect(canUndoSteelReviewDraft(draft)).toBe(true);
    draft = undoSteelReviewDraft(draft);
    expect(applySteelReviewDrafts(table.rows, draft)).toHaveLength(table.rows.length);
    expect(canRedoSteelReviewDraft(draft)).toBe(true);
    draft = redoSteelReviewDraft(draft);
    expect(applySteelReviewDrafts(table.rows, draft)).toHaveLength(table.rows.length + 1);
    draft = deleteSteelReviewDraftRow(draft, added!, false);
    expect(applySteelReviewDrafts(table.rows, draft)).toHaveLength(table.rows.length);
  });

  it('keeps a saved manual deletion as a tombstone and restores its stable id', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    const manual = { ...table.rows[0], rowId: 'manual-saved', origin: 'manual' as const, deleted: false };
    draft = deleteSteelReviewDraftRow(draft, manual, true);
    const deleted = draft.rowStates['manual-saved'];
    expect(deleted?.deleted).toBe(true);
    draft = restoreSteelReviewDraftRow(draft, deleted!);
    expect(draft.rowStates['manual-saved']?.deleted).toBe(false);
  });

  it('rebases semantic cell history so undo after save restores the pre-save value', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '2');
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '78');
    const savedRows = [{
      ...table.rows[0],
      values: { ...table.rows[0].values, 數量: { baseline: '1', effective: '78' } },
    }];
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, draft.changeSequence);
    const undone = undoSteelReviewDraft(rebased);
    expect(applySteelReviewDrafts(savedRows, undone)[0]?.values.數量.effective).toBe('1');
    const redone = redoSteelReviewDraft(undone);
    expect(applySteelReviewDrafts(savedRows, redone)[0]?.values.數量.effective).toBe('78');
  });

  it('keeps the original focused value as the undo target after Save', () => {
    const sourceRow = {
      ...table.rows[0],
      values: { ...table.rows[0].values, 數量: { baseline: '2', effective: '2' } },
    };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, sourceRow, '數量', '7');
    draft = setSteelReviewDraftCell(draft, sourceRow, '數量', '78');
    const savedRows = [{ ...sourceRow, values: { ...sourceRow.values, 數量: { baseline: '2', effective: '78' } } }];
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, draft.changeSequence);
    expect(applySteelReviewDrafts(savedRows, undoSteelReviewDraft(rebased))[0]?.values.數量.effective).toBe('2');
  });

  it('starts a new focused history group after each confirmed save', () => {
    const initial = {
      ...table.rows[0],
      values: { ...table.rows[0].values, 數量: { baseline: '2', effective: '2' } },
    };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, initial, '數量', '78');
    const saved78 = [{ ...initial, values: { ...initial.values, 數量: { baseline: '2', effective: '78' } } }];
    draft = rebaseSteelReviewDraftState(draft, saved78, draft.changeSequence);
    draft = setSteelReviewDraftCell(draft, saved78[0]!, '數量', '9');
    const saved9 = [{ ...saved78[0]!, values: { ...saved78[0]!.values, 數量: { baseline: '2', effective: '9' } } }];
    const rebased = rebaseSteelReviewDraftState(draft, saved9, draft.changeSequence);
    expect(applySteelReviewDrafts(saved9, undoSteelReviewDraft(rebased))[0]?.values.數量.effective).toBe('78');
  });

  it('restores the saved row baseline after undoing one grouped cell edit', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '78');
    const savedRows = [{
      ...table.rows[0],
      values: { ...table.rows[0].values, 數量: { baseline: '1', effective: '78' } },
    }];
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, draft.changeSequence);
    expect(applySteelReviewDrafts(savedRows, undoSteelReviewDraft(rebased))[0]?.values.數量.effective).toBe('1');
  });

  it('treats an undo back to the confirmed value as net clean', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '7');
    draft = undoSteelReviewDraft(draft);

    expect(applySteelReviewDrafts(table.rows, draft)[0]?.values.數量.effective).toBe('1');
    expect(getSteelReviewDirtyRowIds(table, draft)).toEqual([]);
  });

  it('starts a new focused history group after Enter or blur', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '7');
    draft = finishSteelReviewDraftHistory(draft);
    draft = setSteelReviewDraftCell(draft, table.rows[0], '數量', '8');

    const firstUndo = undoSteelReviewDraft(draft);
    expect(applySteelReviewDrafts(table.rows, firstUndo)[0]?.values.數量.effective).toBe('7');
    expect(applySteelReviewDrafts(table.rows, undoSteelReviewDraft(firstUndo))[0]?.values.數量.effective).toBe('1');
  });

  it('rebases a saved manual row with its confirmed values before undoing deletion', () => {
    const savedManual = {
      rowId: 'manual-saved',
      origin: 'manual' as const,
      deleted: false,
      insertion: { kind: 'end' as const, ordinal: 0 },
      source: { fileId: 'file-1', pageNumber: 2, filename: 'drawing.pdf' },
      values: {
        品名: { baseline: null, effective: 'MANUAL-ONLY' },
        數量: { baseline: null, effective: '4' },
      },
    };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = deleteSteelReviewDraftRow(draft, { ...savedManual, values: {
      品名: { baseline: null, effective: '' },
      數量: { baseline: null, effective: '' },
    } }, true);
    const savedRows = [...table.rows, { ...savedManual, deleted: true }];
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, draft.changeSequence);

    const restored = applySteelReviewDrafts(savedRows, undoSteelReviewDraft(rebased))
      .find((row) => row.rowId === savedManual.rowId);
    expect(restored).toMatchObject({
      deleted: false,
      source: savedManual.source,
      values: savedManual.values,
    });
  });

  it('allocates the next ordinal after a saved tombstoned row', () => {
    const tableWithTombstone: SteelReviewTable = {
      ...table,
      rows: [
        ...table.rows,
        {
          rowId: 'manual-tombstone',
          origin: 'manual',
          deleted: true,
          insertion: { kind: 'end', ordinal: 0 },
          source: null,
          values: { 品名: { baseline: null, effective: 'old' }, 數量: { baseline: null, effective: '1' } },
        },
      ],
    };
    const draft = addSteelReviewDraftRow(
      createSteelReviewDraftState(getSteelReviewDraftKey(selection, tableWithTombstone)),
      tableWithTombstone,
      undefined,
      null,
    );
    expect(Object.values(draft.rowStates)[0]?.insertion).toEqual({ kind: 'end', ordinal: 1 });
  });

  it('rebases grouped source history across a confirmed page save', () => {
    const sourceOne: SteelReviewSource = { fileId: 'file-1', pageNumber: 1, filename: 'drawing.pdf' };
    const sourceTwo: SteelReviewSource = { ...sourceOne, pageNumber: 2 };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    const sourced = { ...table.rows[0], source: sourceOne };
    draft = setSteelReviewDraftSource(draft, sourced, sourceTwo);
    const savedRows = [{ ...sourced, source: sourceTwo }];
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, draft.changeSequence);
    expect(applySteelReviewDrafts(savedRows, undoSteelReviewDraft(rebased))[0]?.source?.pageNumber).toBe(1);
    expect(applySteelReviewDrafts(savedRows, redoSteelReviewDraft(undoSteelReviewDraft(rebased)))[0]?.source?.pageNumber).toBe(2);
  });

  it('undoes source menu choices one operation at a time', () => {
    const sourceOne: SteelReviewSource = { fileId: 'file-1', pageNumber: 1, filename: 'drawing.pdf' };
    const sourceTwo: SteelReviewSource = { fileId: 'file-2', pageNumber: 1, filename: 'other.pdf' };
    const sourceThree: SteelReviewSource = { ...sourceTwo, pageNumber: 2 };
    const sourced = { ...table.rows[0], source: sourceOne };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftSource(draft, sourced, sourceTwo);
    draft = setSteelReviewDraftSource(draft, sourced, sourceThree);
    const savedRows = [{ ...sourced, source: sourceThree }];
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, draft.changeSequence);
    const afterFirstUndo = undoSteelReviewDraft(rebased);
    expect(applySteelReviewDrafts(savedRows, afterFirstUndo)[0]?.source).toEqual(sourceTwo);
    expect(applySteelReviewDrafts(savedRows, undoSteelReviewDraft(afterFirstUndo))[0]?.source).toEqual(sourceOne);
  });

  it('keeps source and business history attached to one row after Save', () => {
    const sourceOne: SteelReviewSource = { fileId: 'file-1', pageNumber: 1, filename: 'drawing.pdf' };
    const sourceTwo: SteelReviewSource = { ...sourceOne, pageNumber: 2 };
    const sourced = { ...table.rows[0], source: sourceOne };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = setSteelReviewDraftCell(draft, sourced, '數量', '7');
    draft = setSteelReviewDraftSource(draft, sourced, sourceTwo);
    const savedRows = [{
      ...sourced,
      source: sourceTwo,
      values: { ...sourced.values, 數量: { baseline: '1', effective: '7' } },
    }];
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, draft.changeSequence);
    const afterSourceUndo = undoSteelReviewDraft(rebased);
    expect(applySteelReviewDrafts(savedRows, afterSourceUndo)[0]).toMatchObject({
      source: sourceOne,
      values: { 數量: { effective: '7' } },
    });
    expect(applySteelReviewDrafts(savedRows, undoSteelReviewDraft(afterSourceUndo))[0]).toMatchObject({
      source: sourceOne,
      values: { 數量: { effective: '1' } },
    });
  });

  it('rebases an inserted row history into a manual tombstone after save', () => {
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(selection, table));
    draft = addSteelReviewDraftRow(draft, table, undefined, null);
    const savedRows = [...table.rows, ...applySteelReviewDrafts(table.rows, draft).filter((row) => row.origin === 'manual')];
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, draft.changeSequence);
    const undone = undoSteelReviewDraft(rebased);
    expect(applySteelReviewDrafts(savedRows, undone).find((row) => row.origin === 'manual')?.deleted).toBe(true);
    expect(applySteelReviewDrafts(savedRows, redoSteelReviewDraft(undone)).find((row) => row.origin === 'manual')?.deleted).toBe(false);
  });
});
