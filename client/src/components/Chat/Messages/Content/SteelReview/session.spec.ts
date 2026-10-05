import {
  applySteelReviewOperations,
  normalizeSteelReviewLedgerRows,
} from 'librechat-data-provider';
import type { SteelCatalogCandidate, SteelReviewRow, SteelReviewSource, SteelReviewTable } from 'librechat-data-provider';
import {
  addSteelReviewDraftRow,
  applySteelReviewDrafts,
  canRedoSteelReviewDraft,
  canUndoSteelReviewDraft,
  clearSteelReviewDraftHistory,
  compileSteelReviewOperations,
  createSteelReviewDraftState,
  deleteSteelReviewDraftRow,
  deleteSteelReviewDraftGroup,
  areSteelReviewDraftOwnersSame,
  getSteelReviewDraftKey,
  getSteelReviewDraftOwnerKey,
  getSteelReviewDirtyRowIds,
  getSteelReviewPrepareInput,
  rebaseSteelReviewDraftState,
  restoreSteelReviewDraftGroup,
  setSteelReviewDraftCell,
  getSteelReviewDraftMeasurement,
  finishSteelReviewDraftHistory,
  setSteelReviewDraftSource,
  setSteelReviewDraftSystem,
  setSteelReviewDraftMeasurement,
  setSteelReviewDraftCandidate,
  undoSteelReviewDraft,
  redoSteelReviewDraft,
  restoreSteelReviewDraftRow,
} from './session';

const table: SteelReviewTable = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  title: 'ocr_result',
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
  title: table.title,
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
      title: 'ocr_result',
      outputId: 'ocr_result:generation-1',
      baseRevision: 'revision-1',
    }));
    expect(getSteelReviewDraftOwnerKey(selection, table)).toBe(JSON.stringify({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      kind: 'ocr_result',
      title: 'ocr_result',
      outputId: 'ocr_result:generation-1',
    }));
  });

  it('compares only validated logical owners and ignores capture suffixes', () => {
    const firstCapture = getSteelReviewDraftOwnerKey(selection, table, 'capture-1');
    const secondCapture = getSteelReviewDraftOwnerKey(selection, table, 'capture-2');

    expect(areSteelReviewDraftOwnersSame(firstCapture, secondCapture)).toBe(true);
    expect(areSteelReviewDraftOwnersSame(firstCapture, getSteelReviewDraftOwnerKey({
      ...selection,
      title: 'ocr_result｜second',
    }, table, 'capture-2'))).toBe(false);
    expect(areSteelReviewDraftOwnersSame('{}', '{}')).toBe(false);
    expect(areSteelReviewDraftOwnersSame('{"messageId":"message-1"}', '{"messageId":"message-1"}')).toBe(false);
    expect(areSteelReviewDraftOwnersSame('{"conversationId":"conversation-1","messageId":"message-1","kind":"other","title":"ocr_result","outputId":"ocr_result:generation-1"}',
      '{"conversationId":"conversation-1","messageId":"message-1","kind":"other","title":"ocr_result","outputId":"ocr_result:generation-1"}')).toBe(false);
    expect(areSteelReviewDraftOwnersSame(`${firstCapture}:malformed`, `${firstCapture}:malformed`)).toBe(false);
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
    const titledTable = { ...table, title: 'ocr_result｜second' };
    const contentPart = getSteelReviewDraftKey({ ...selection, title: titledTable.title }, titledTable);

    expect(delimiterLike).not.toBe(splitOwner);
    expect(textPart).not.toBe(contentPart);
    expect(getSteelReviewDraftKey({ ...selection, title: titledTable.title }, titledTable)).toBe(contentPart);
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

  it('keeps system additions and binding edits in one typed operation stream', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:run-1',
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '鋼板', effective: '鋼板' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'processing', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '加工/切割', effective: '加工/切割' }, 數量: { baseline: '1', effective: '1' } },
        },
      ],
    };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey({ ...selection, kind: 'system_order', title: 'system_order' }, systemTable));
    draft = setSteelReviewDraftSystem(draft, systemTable.rows[1], {
      kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null,
    });
    const projected = applySteelReviewDrafts(systemTable.rows, draft);
    expect(compileSteelReviewOperations(systemTable, draft, projected)).toEqual([{
      type: 'update', rowId: 'processing-1', binding: { parentRowId: 'material-1' },
    }]);
    const added = addSteelReviewDraftRow(draft, systemTable, systemTable.rows[0], null, {
      kind: 'material', parentRowId: null, cascadeDeletedBy: null,
    });
    const add = compileSteelReviewOperations(systemTable, added, applySteelReviewDrafts(systemTable.rows, added))
      .find((operation) => operation.type === 'add');
    expect(add).toMatchObject({ type: 'add', system: { kind: 'material', parentRowId: null } });

    const addedProcessing = addSteelReviewDraftRow(added, systemTable, systemTable.rows[0], null, {
      kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null,
    });
    const processingAdd = compileSteelReviewOperations(
      systemTable,
      addedProcessing,
      applySteelReviewDrafts(systemTable.rows, addedProcessing),
    ).find((operation) => operation.type === 'add' && operation.system?.kind === 'processing');
    expect(processingAdd).toMatchObject({
      type: 'add',
      position: { kind: 'after', rowId: 'material-1' },
      system: { kind: 'processing', parentRowId: 'material-1' },
    });
    expect(processingAdd).not.toHaveProperty('source');
  });

  it('stages measurement metadata as one undoable operation and preserves an explicit clear', () => {
    const processing: SteelReviewRow = {
      rowId: 'processing-measurement',
      source: null,
      system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null },
      values: {
        類別: { baseline: '加工/切工', effective: '加工/切工' },
        單位: { baseline: '刀', effective: '刀' },
        總數: { baseline: '2', effective: '2' },
      },
      calculation: { measurement: { mode: 'perPiece', amount: '1', unit: '刀' } },
    };
    const measurement = { mode: 'perPiece' as const, amount: '2', unit: '刀' };
    let draft = createSteelReviewDraftState('measurement-owner');
    draft = setSteelReviewDraftMeasurement(draft, processing, measurement);
    expect(getSteelReviewDraftMeasurement(draft, processing.rowId)).toEqual(measurement);
    expect(compileSteelReviewOperations({ headers: Object.keys(processing.values), rows: [processing] }, draft,
      applySteelReviewDrafts([processing], draft))).toEqual([{
        type: 'update', rowId: processing.rowId, measurement,
      }]);
    draft = setSteelReviewDraftMeasurement(draft, processing, null);
    expect(getSteelReviewDraftMeasurement(draft, processing.rowId)).toBeNull();
    expect(compileSteelReviewOperations({ headers: Object.keys(processing.values), rows: [processing] }, draft,
      applySteelReviewDrafts([processing], draft))).toEqual([{
        type: 'update', rowId: processing.rowId, measurement: null,
      }]);
  });

  it('orders a new material before dependent binding and classification after a later price edit', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:dependency-order',
      rows: [
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'processing', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '加工/切割', effective: '加工/切割' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'unassigned-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'unassigned', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '', effective: '' }, 數量: { baseline: '1', effective: '1' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    draft = addSteelReviewDraftRow(draft, systemTable, undefined, null, {
      kind: 'material', parentRowId: null, cascadeDeletedBy: null,
    });
    const addedMaterial = Object.values(draft.rowStates).find((row) => row.origin === 'manual')!;
    draft = setSteelReviewDraftSystem(draft, systemTable.rows[0]!, {
      kind: 'processing', parentRowId: addedMaterial.rowId, cascadeDeletedBy: null,
    });
    draft = setSteelReviewDraftSystem(draft, systemTable.rows[1]!, {
      kind: 'processing', parentRowId: addedMaterial.rowId, cascadeDeletedBy: null,
    });
    draft = setSteelReviewDraftCell(draft, addedMaterial, '數量', '7');

    const operations = compileSteelReviewOperations(
      systemTable,
      draft,
      applySteelReviewDrafts(systemTable.rows, draft),
    );
    const operationOrder = operations.map((operation) => {
      if (operation.type === 'classify') return 'classify';
      return operation.rowId;
    });
    expect(operationOrder).toEqual([
      addedMaterial.rowId,
      'processing-1',
      'classify',
    ]);
  });

  it('activates a classified material before binding its child while retaining the later parent edit order', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:classify-activation',
      headers: ['類別', '品名', '單價'],
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'unassigned', parentRowId: null, cascadeDeletedBy: null },
          values: {
            類別: { baseline: '', effective: '' }, 品名: { baseline: '鋼板', effective: '鋼板' },
            單價: { baseline: '10', effective: '10' },
          },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'processing', parentRowId: null, cascadeDeletedBy: null },
          values: {
            類別: { baseline: '加工/切割', effective: '加工/切割' }, 品名: { baseline: '加工', effective: '加工' },
            單價: { baseline: '', effective: '' },
          },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    draft = setSteelReviewDraftSystem(draft, systemTable.rows[0]!, {
      kind: 'material', parentRowId: null, cascadeDeletedBy: null,
    });
    let projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftSystem(draft, projected[1]!, {
      kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null,
    });
    projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftCell(draft, projected[0]!, '單價', '7');
    const operations = compileSteelReviewOperations(
      systemTable,
      draft,
      applySteelReviewDrafts(systemTable.rows, draft),
    );

    expect(operations).toEqual([
      { type: 'classify', rowId: 'material-1', system: { kind: 'material', parentRowId: null } },
      { type: 'update', rowId: 'processing-1', binding: { parentRowId: 'material-1' } },
      { type: 'update', rowId: 'material-1', changes: [{ header: '單價', value: '7' }] },
    ]);
  });

  it('activates a restored material before existing and added processing rows while retaining the later parent edit order', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:restore-activation',
      headers: ['品名', '單價'],
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '鋼板', effective: '鋼板' }, 單價: { baseline: '10', effective: '10' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'processing', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '加工', effective: '加工' }, 單價: { baseline: '', effective: '' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    draft = restoreSteelReviewDraftRow(draft, systemTable.rows[0]!);
    let projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftSystem(draft, projected[1]!, {
      kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null,
    });
    draft = addSteelReviewDraftRow(draft, systemTable, projected[0], null, {
      kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null,
    });
    projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftCell(draft, projected[0]!, '單價', '7');
    const addedProcessing = projected.find((row) => row.origin === 'manual')!;
    const operations = compileSteelReviewOperations(
      systemTable,
      draft,
      applySteelReviewDrafts(systemTable.rows, draft),
    );

    expect(operations).toEqual([
      { type: 'restore', rowId: 'material-1' },
      expect.objectContaining({ type: 'add', rowId: addedProcessing.rowId,
        system: { kind: 'processing', parentRowId: 'material-1' } }),
      { type: 'update', rowId: 'processing-1', binding: { parentRowId: 'material-1' } },
      { type: 'update', rowId: 'material-1', changes: [{ header: '單價', value: '7' }] },
    ]);
  });

  it('orders a group restore before a child edit and the later parent edit', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:group-restore-activation',
      headers: ['品名', '單價'],
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '鋼板', effective: '鋼板' }, 單價: { baseline: '10', effective: '10' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: 'material-1' },
          values: { 品名: { baseline: '加工', effective: '加工' }, 單價: { baseline: '5', effective: '5' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    draft = restoreSteelReviewDraftGroup(draft, systemTable.rows, systemTable.rows[0]!);
    let projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftCell(draft, projected[1]!, '單價', '6');
    projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftCell(draft, projected[0]!, '單價', '7');
    const operations = compileSteelReviewOperations(
      systemTable,
      draft,
      applySteelReviewDrafts(systemTable.rows, draft),
    );

    expect(operations).toEqual([
      { type: 'restore', rowId: 'material-1' },
      { type: 'update', rowId: 'processing-1', changes: [{ header: '單價', value: '6' }] },
      { type: 'update', rowId: 'material-1', changes: [{ header: '單價', value: '7' }] },
    ]);
  });

  it('waits for the original cascade parent before rebinding a restored child elsewhere', () => {
    const sourceTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:original-cascade-activation',
      headers: ['品名', '單價'],
      rows: [
        {
          rowId: 'material-old', source: null, origin: 'ai', deleted: true,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '舊鋼板', effective: '舊鋼板' }, 單價: { baseline: '10', effective: '10' } },
        },
        {
          rowId: 'material-new', source: null, origin: 'ai', deleted: false,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '新鋼板', effective: '新鋼板' }, 單價: { baseline: '20', effective: '20' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'processing', parentRowId: 'material-old', cascadeDeletedBy: 'material-old' },
          values: { 品名: { baseline: '加工', effective: '加工' }, 單價: { baseline: '5', effective: '5' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, sourceTable));
    draft = restoreSteelReviewDraftGroup(draft, sourceTable.rows, sourceTable.rows[0]!);
    let projected = applySteelReviewDrafts(sourceTable.rows, draft);
    draft = setSteelReviewDraftSystem(draft, projected[2]!, {
      kind: 'processing', parentRowId: 'material-new', cascadeDeletedBy: null,
    });
    projected = applySteelReviewDrafts(sourceTable.rows, draft);
    draft = setSteelReviewDraftCell(draft, projected[0]!, '單價', '11');
    const operations = compileSteelReviewOperations(
      sourceTable,
      draft,
      applySteelReviewDrafts(sourceTable.rows, draft),
    );

    expect(operations).toEqual([
      { type: 'restore', rowId: 'material-old' },
      { type: 'update', rowId: 'processing-1', binding: { parentRowId: 'material-new' } },
      { type: 'update', rowId: 'material-old', changes: [{ header: '單價', value: '11' }] },
    ]);
  });

  it('deletes a child after group restore without emitting a duplicate child restore', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:group-restore-redelete',
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '鋼板', effective: '鋼板' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: 'material-1' },
          values: { 品名: { baseline: '加工', effective: '加工' }, 數量: { baseline: '1', effective: '1' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    draft = restoreSteelReviewDraftGroup(draft, systemTable.rows, systemTable.rows[0]!);
    const restoredRows = applySteelReviewDrafts(systemTable.rows, draft);
    draft = deleteSteelReviewDraftRow(draft, restoredRows[1]!, true);
    const operations = compileSteelReviewOperations(
      systemTable,
      draft,
      applySteelReviewDrafts(systemTable.rows, draft),
    );

    expect(operations).toEqual([
      { type: 'restore', rowId: 'material-1' },
      { type: 'delete', rowId: 'processing-1' },
    ]);
  });

  it('keeps an individually deleted child tombstoned through later group delete and restore in the shared applier', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:group-restore-applier',
      headers: ['品名', '數量'],
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '鋼板', effective: '鋼板' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: 'material-1' },
          values: { 品名: { baseline: '加工一', effective: '加工一' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-2', source: null, origin: 'ai', deleted: true,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: 'material-1' },
          values: { 品名: { baseline: '加工二', effective: '加工二' }, 數量: { baseline: '2', effective: '2' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    const apply = (
      currentRows: readonly SteelReviewRow[],
      operations: ReturnType<typeof compileSteelReviewOperations>,
    ) => applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows(currentRows),
      expectedRows: normalizeSteelReviewLedgerRows(currentRows),
      headers: systemTable.headers,
      operations,
    });

    let restoreDraft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    restoreDraft = restoreSteelReviewDraftGroup(restoreDraft, systemTable.rows, systemTable.rows[0]!);
    const restoredRows = applySteelReviewDrafts(systemTable.rows, restoreDraft);
    restoreDraft = deleteSteelReviewDraftRow(restoreDraft, restoredRows[1]!, true);
    const restoreOperations = compileSteelReviewOperations(
      systemTable,
      restoreDraft,
      applySteelReviewDrafts(systemTable.rows, restoreDraft),
    );
    const restored = apply(systemTable.rows, restoreOperations);
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    expect(restored.currentRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
      deleted: true,
      system: { cascadeDeletedBy: null },
    });
    expect(restored.currentRows.find((row) => row.rowId === 'processing-2')).toMatchObject({
      deleted: false,
      system: { cascadeDeletedBy: null },
    });

    const restoredTable = { ...systemTable, rows: restored.currentRows };
    let deleteDraft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, restoredTable));
    deleteDraft = deleteSteelReviewDraftGroup(deleteDraft, restoredTable.rows, restoredTable.rows[0]!, restoredTable.rows);
    const deleted = apply(restoredTable.rows, compileSteelReviewOperations(
      restoredTable,
      deleteDraft,
      applySteelReviewDrafts(restoredTable.rows, deleteDraft),
    ));
    expect(deleted).toMatchObject({ ok: true });
    if (!deleted.ok) return;
    expect(deleted.currentRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
      deleted: true,
      system: { cascadeDeletedBy: null },
    });
    expect(deleted.currentRows.find((row) => row.rowId === 'processing-2')).toMatchObject({
      deleted: true,
      system: { cascadeDeletedBy: 'material-1' },
    });

    const deletedTable = { ...systemTable, rows: deleted.currentRows };
    const finalDraft = restoreSteelReviewDraftGroup(
      createSteelReviewDraftState(getSteelReviewDraftKey(identity, deletedTable)),
      deletedTable.rows,
      deletedTable.rows[0]!,
    );
    const final = apply(deletedTable.rows, compileSteelReviewOperations(
      deletedTable,
      finalDraft,
      applySteelReviewDrafts(deletedTable.rows, finalDraft),
    ));
    expect(final).toMatchObject({ ok: true });
    if (!final.ok) return;
    expect(final.currentRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
      deleted: true,
      system: { cascadeDeletedBy: null },
    });
    expect(final.currentRows.find((row) => row.rowId === 'processing-2')).toMatchObject({
      deleted: false,
      system: { cascadeDeletedBy: null },
    });
  });

  it('compiles group restore, rebound child, and parent redelete for the shared applier', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:rebound-applier',
      rows: [
        {
          rowId: 'material-a', source: null, origin: 'ai', deleted: true,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '材料A', effective: '材料A' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'material-b', source: null, origin: 'ai', deleted: false,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '材料B', effective: '材料B' }, 數量: { baseline: '2', effective: '2' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'processing', parentRowId: 'material-a', cascadeDeletedBy: 'material-a' },
          values: { 品名: { baseline: '加工', effective: '加工' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-2', source: null, origin: 'ai', deleted: true,
          system: { kind: 'processing', parentRowId: 'material-a', cascadeDeletedBy: 'material-a' },
          values: { 品名: { baseline: '加工二', effective: '加工二' }, 數量: { baseline: '2', effective: '2' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    draft = restoreSteelReviewDraftGroup(draft, systemTable.rows, systemTable.rows[0]!);
    let projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftSystem(draft, projected.find((row) => row.rowId === 'processing-1')!, {
      kind: 'processing', parentRowId: 'material-b', cascadeDeletedBy: null,
    });
    projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = deleteSteelReviewDraftGroup(draft, projected, projected.find((row) => row.rowId === 'material-a')!, systemTable.rows);
    const operations = compileSteelReviewOperations(
      systemTable,
      draft,
      applySteelReviewDrafts(systemTable.rows, draft),
    );
    expect(operations).toEqual([
      { type: 'restore', rowId: 'processing-1' },
      { type: 'update', rowId: 'processing-1', binding: { parentRowId: 'material-b' } },
    ]);

    const applied = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows(systemTable.rows),
      expectedRows: normalizeSteelReviewLedgerRows(systemTable.rows),
      headers: systemTable.headers,
      operations,
    });
    expect(applied).toMatchObject({ ok: true });
    if (!applied.ok) return;
    expect(applied.currentRows.find((row) => row.rowId === 'material-a')).toMatchObject({ deleted: true });
    expect(applied.currentRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
      deleted: false,
      system: { kind: 'processing', parentRowId: 'material-b', cascadeDeletedBy: null },
    });
    expect(applied.currentRows.find((row) => row.rowId === 'processing-2')).toMatchObject({
      deleted: true,
      system: { cascadeDeletedBy: 'material-a' },
    });
    expect(applied.expectedRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
      deleted: false,
      system: { kind: 'processing', parentRowId: 'material-b', cascadeDeletedBy: null },
    });

    const deleted = applySteelReviewOperations({
      currentRows: applied.currentRows,
      expectedRows: applied.expectedRows,
      headers: systemTable.headers,
      operations: [{ type: 'delete', rowId: 'processing-1' }],
    });
    expect(deleted).toMatchObject({ ok: true });
    if (!deleted.ok) return;
    const restored = applySteelReviewOperations({
      currentRows: deleted.currentRows,
      expectedRows: deleted.expectedRows,
      headers: systemTable.headers,
      operations: [{ type: 'restore', rowId: 'processing-1' }],
    });
    expect(restored).toMatchObject({ ok: true });
    if (restored.ok) {
      expect(restored.currentRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
        deleted: false,
        system: { kind: 'processing', parentRowId: 'material-b', cascadeDeletedBy: null },
      });
      expect(restored.expectedRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
        deleted: false,
        system: { kind: 'processing', parentRowId: 'material-b', cascadeDeletedBy: null },
      });
    }
  });

  it('retains cascade provenance for a no-binding child edit across group redelete', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:no-binding-group-redelete',
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '鋼板', effective: '鋼板' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null },
          values: { 品名: { baseline: '加工', effective: '加工' }, 數量: { baseline: '1', effective: '1' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    draft = deleteSteelReviewDraftGroup(draft, systemTable.rows, systemTable.rows[0]!, systemTable.rows);
    let projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = restoreSteelReviewDraftGroup(draft, projected, systemTable.rows[0]!);
    projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftCell(draft, projected[1]!, '數量', '6');
    projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftCell(draft, projected[0]!, '數量', '7');
    projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = deleteSteelReviewDraftGroup(draft, projected, projected[0]!, systemTable.rows);
    const operations = compileSteelReviewOperations(systemTable, draft, applySteelReviewDrafts(systemTable.rows, draft));
    expect(operations).toEqual([
      { type: 'update', rowId: 'processing-1', changes: [{ header: '數量', value: '6' }] },
      { type: 'update', rowId: 'material-1', changes: [{ header: '數量', value: '7' }] },
      { type: 'delete', rowId: 'material-1' },
    ]);
    const applied = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows(systemTable.rows),
      expectedRows: normalizeSteelReviewLedgerRows(systemTable.rows),
      headers: systemTable.headers,
      operations,
    });
    expect(applied).toMatchObject({ ok: true });
    if (applied.ok) {
      expect(applied.currentRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
        deleted: true,
        system: { cascadeDeletedBy: 'material-1' },
      });
      expect(applied.expectedRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
        deleted: true,
        system: { cascadeDeletedBy: 'material-1' },
      });
    }
  });

  it('projects material source changes onto processing rows and preserves a later rebind', () => {
    const sourceOne: SteelReviewSource = { fileId: 'file-1', pageNumber: 1, filename: 'alpha.pdf' };
    const sourceTwo: SteelReviewSource = { fileId: 'file-2', pageNumber: 2, filename: 'beta.pdf' };
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:source-1',
      headers: ['來源', '頁碼', '品名', '數量'],
      rows: [
        {
          rowId: 'material-1', source: sourceOne, origin: 'ai', deleted: false,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: {
            來源: { baseline: 'F1', effective: 'F1' }, 頁碼: { baseline: '1', effective: '1' },
            品名: { baseline: '鋼板', effective: '鋼板' }, 數量: { baseline: '1', effective: '1' },
          },
        },
        {
          rowId: 'material-2', source: sourceTwo, origin: 'ai', deleted: false,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: {
            來源: { baseline: 'F2', effective: 'F2' }, 頁碼: { baseline: '2', effective: '2' },
            品名: { baseline: '角鐵', effective: '角鐵' }, 數量: { baseline: '2', effective: '2' },
          },
        },
        {
          rowId: 'processing-1', source: sourceOne, origin: 'ai', deleted: false,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null },
          values: {
            來源: { baseline: 'F1', effective: 'F1' }, 頁碼: { baseline: '1', effective: '1' },
            品名: { baseline: '加工', effective: '加工' }, 數量: { baseline: '1', effective: '1' },
          },
        },
      ],
    };
    const systemSelection = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(systemSelection, systemTable));
    draft = setSteelReviewDraftSource(draft, systemTable.rows[0]!, sourceTwo);
    let projected = applySteelReviewDrafts(systemTable.rows, draft);
    expect(projected.find((row) => row.rowId === 'processing-1')).toMatchObject({ source: sourceTwo });
    expect(compileSteelReviewOperations(systemTable, draft, projected)).toEqual([
      { type: 'update', rowId: 'material-1', source: { fileId: 'file-2', pageNumber: 2 } },
    ]);

    const firstBinding = draft.changeSequence + 1;
    draft = setSteelReviewDraftSystem(draft, systemTable.rows[2]!, {
      kind: 'processing', parentRowId: 'material-2', cascadeDeletedBy: null,
    });
    expect(draft.systemVersions['processing-1']).toBe(firstBinding);
    draft = setSteelReviewDraftSystem(draft, systemTable.rows[2]!, {
      kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null,
    });
    projected = applySteelReviewDrafts(systemTable.rows, draft);
    const processing = projected.find((row) => row.rowId === 'processing-1');
    expect(processing).toMatchObject({ source: sourceTwo, system: { parentRowId: 'material-1' } });

    const savedRows = systemTable.rows.map((row) => {
      if (row.rowId === 'material-1') return { ...row, source: sourceTwo };
      if (row.rowId === 'processing-1') {
        return { ...row, system: { ...row.system!, parentRowId: 'material-2' }, source: sourceTwo };
      }
      return row;
    });
    const rebased = rebaseSteelReviewDraftState(draft, savedRows, firstBinding);
    const rebasedRows = applySteelReviewDrafts(savedRows, rebased);
    expect(rebasedRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
      source: sourceTwo,
      system: { parentRowId: 'material-1' },
    });
    expect(compileSteelReviewOperations({ ...systemTable, rows: savedRows }, rebased, rebasedRows)).toEqual([
      { type: 'update', rowId: 'processing-1', binding: { parentRowId: 'material-1' } },
    ]);
  });

  it('compiles group delete and restore as one parent intent while preserving child edits and tombstones', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:group-1',
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '鋼板', effective: '鋼板' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null },
          values: { 品名: { baseline: '加工/切割', effective: '加工/切割' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-2', source: null, origin: 'ai', deleted: true,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null },
          values: { 品名: { baseline: '加工/孔', effective: '加工/孔' }, 數量: { baseline: '1', effective: '1' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    const initialDraft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    const material = systemTable.rows[0]!;
    const groupDeletedDraft = deleteSteelReviewDraftGroup(initialDraft, systemTable.rows, material, systemTable.rows);
    let draft = groupDeletedDraft;
    const deletedRows = applySteelReviewDrafts(systemTable.rows, draft);
    expect(compileSteelReviewOperations(systemTable, draft, deletedRows)).toEqual([
      { type: 'delete', rowId: 'material-1' },
    ]);

    const editedChild = deletedRows.find((row) => row.rowId === 'processing-1')!;
    draft = setSteelReviewDraftCell(draft, editedChild, '數量', '7');
    const editedOperations = compileSteelReviewOperations(systemTable, draft, applySteelReviewDrafts(systemTable.rows, draft));
    expect(editedOperations).toEqual([
      { type: 'update', rowId: 'processing-1', changes: [{ header: '數量', value: '7' }] },
      { type: 'delete', rowId: 'material-1' },
    ]);
    expect(editedOperations.some((operation) => operation.type === 'delete' && operation.rowId === 'processing-1')).toBe(false);

    const restoredDraft = restoreSteelReviewDraftGroup(groupDeletedDraft, deletedRows, material);
    const deletedTable = { ...systemTable, rows: deletedRows };
    const restoredRows = applySteelReviewDrafts(deletedRows, restoredDraft);
    expect(restoredRows.find((row) => row.rowId === 'processing-1')).toMatchObject({ deleted: false,
      system: { cascadeDeletedBy: null } });
    expect(restoredRows.find((row) => row.rowId === 'processing-2')?.deleted).toBe(true);
    expect(compileSteelReviewOperations(deletedTable, restoredDraft, restoredRows)).toEqual([
      { type: 'restore', rowId: 'material-1' },
    ]);
  });

  it('cancels an unsaved material group against the saved child relation', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:unsaved-group-cancel',
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '鋼板', effective: '鋼板' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-1', source: { fileId: 'file-original', pageNumber: 1, filename: 'alpha.pdf' }, origin: 'ai', deleted: false,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null },
          values: { 品名: { baseline: '加工', effective: '加工' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-2', source: { fileId: 'file-original-2', pageNumber: 2, filename: 'alpha-2.pdf' }, origin: 'ai', deleted: false,
          system: { kind: 'unassigned', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '', effective: '' }, 數量: { baseline: '1', effective: '1' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let draft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    draft = addSteelReviewDraftRow(draft, systemTable, undefined, {
      fileId: 'file-new', pageNumber: 2, filename: 'beta.pdf',
    }, {
      kind: 'material', parentRowId: null, cascadeDeletedBy: null,
    });
    const addedMaterial = Object.values(draft.rowStates).find((row) => row.origin === 'manual')!;
    draft = setSteelReviewDraftSystem(draft, systemTable.rows[1]!, {
      kind: 'processing', parentRowId: addedMaterial.rowId, cascadeDeletedBy: null,
    });
    draft = setSteelReviewDraftSystem(draft, systemTable.rows[2]!, {
      kind: 'processing', parentRowId: addedMaterial.rowId, cascadeDeletedBy: null,
    });
    let projected = applySteelReviewDrafts(systemTable.rows, draft);
    draft = setSteelReviewDraftCell(draft, projected.find((row) => row.rowId === 'processing-1')!, '數量', '7');
    projected = applySteelReviewDrafts(systemTable.rows, draft);
    const deleted = deleteSteelReviewDraftGroup(draft, projected, addedMaterial, systemTable.rows);
    const deletedRows = applySteelReviewDrafts(systemTable.rows, deleted);

    expect(deletedRows.find((row) => row.rowId === addedMaterial.rowId)).toBeUndefined();
    expect(deletedRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
      deleted: true,
      system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null },
      source: { fileId: 'file-original', pageNumber: 1 },
      values: { 數量: { effective: '7' } },
    });
    expect(deletedRows.find((row) => row.rowId === 'processing-2')).toMatchObject({
      deleted: true,
      system: { kind: 'unassigned', parentRowId: null, cascadeDeletedBy: null },
      source: { fileId: 'file-original-2', pageNumber: 2 },
    });
    expect(compileSteelReviewOperations(systemTable, deleted, deletedRows)).toEqual([
      { type: 'delete', rowId: 'processing-2' },
      { type: 'update', rowId: 'processing-1', changes: [{ header: '數量', value: '7' }] },
      { type: 'delete', rowId: 'processing-1' },
    ]);

    const undoneRows = applySteelReviewDrafts(systemTable.rows, undoSteelReviewDraft(deleted));
    expect(undoneRows.find((row) => row.rowId === addedMaterial.rowId)).toMatchObject({ deleted: false });
    expect(undoneRows.find((row) => row.rowId === 'processing-1')).toMatchObject({
      deleted: false,
      system: { parentRowId: addedMaterial.rowId },
    });
  });

  it('orders classification before update and deletion, including a restored tombstone chain', () => {
    const row = {
      rowId: 'unassigned-1', source: null, origin: 'ai' as const, deleted: false,
      system: { kind: 'unassigned' as const, parentRowId: null, cascadeDeletedBy: null },
      values: { 品名: { baseline: '', effective: '' }, 單價: { baseline: '10', effective: '10' } },
    };
    const activeTable: SteelReviewTable = {
      ...table, kind: 'system_order', title: 'system_order', outputId: 'system_order:compound-active',
      headers: ['品名', '單價'], rows: [row],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    let activeDraft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, activeTable));
    activeDraft = setSteelReviewDraftSystem(activeDraft, row, {
      kind: 'material', parentRowId: null, cascadeDeletedBy: null,
    });
    const classified = applySteelReviewDrafts(activeTable.rows, activeDraft)[0]!;
    activeDraft = setSteelReviewDraftCell(activeDraft, classified, '單價', '7');
    const edited = applySteelReviewDrafts(activeTable.rows, activeDraft)[0]!;
    activeDraft = deleteSteelReviewDraftRow(activeDraft, edited, true);
    expect(compileSteelReviewOperations(activeTable, activeDraft, applySteelReviewDrafts(activeTable.rows, activeDraft)).map((operation) => operation.type)).toEqual([
      'classify', 'update', 'delete',
    ]);

    const deletedRow = { ...row, deleted: true };
    const deletedTable = { ...activeTable, outputId: 'system_order:compound-restored', rows: [deletedRow] };
    let restoredDraft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, deletedTable));
    restoredDraft = restoreSteelReviewDraftRow(restoredDraft, deletedRow);
    const restored = applySteelReviewDrafts(deletedTable.rows, restoredDraft)[0]!;
    restoredDraft = setSteelReviewDraftSystem(restoredDraft, restored, {
      kind: 'material', parentRowId: null, cascadeDeletedBy: null,
    });
    const restoredClassified = applySteelReviewDrafts(deletedTable.rows, restoredDraft)[0]!;
    restoredDraft = setSteelReviewDraftCell(restoredDraft, restoredClassified, '單價', '7');
    const restoredEdited = applySteelReviewDrafts(deletedTable.rows, restoredDraft)[0]!;
    restoredDraft = deleteSteelReviewDraftRow(restoredDraft, restoredEdited, true);
    expect(compileSteelReviewOperations(deletedTable, restoredDraft, applySteelReviewDrafts(deletedTable.rows, restoredDraft)).map((operation) => operation.type)).toEqual([
      'restore', 'classify', 'update', 'delete',
    ]);
  });

  it('keeps an individually deleted bound child restorable while its parent stays active', () => {
    const systemTable: SteelReviewTable = {
      ...table,
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:child-restore',
      rows: [
        {
          rowId: 'material-1', source: null, origin: 'ai', deleted: false,
          system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
          values: { 品名: { baseline: '鋼板', effective: '鋼板' }, 數量: { baseline: '1', effective: '1' } },
        },
        {
          rowId: 'processing-1', source: null, origin: 'ai', deleted: true,
          system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null },
          values: { 品名: { baseline: '加工/切割', effective: '加工/切割' }, 數量: { baseline: '1', effective: '1' } },
        },
      ],
    };
    const identity = { ...selection, kind: 'system_order' as const, title: 'system_order' };
    const initialDraft = createSteelReviewDraftState(getSteelReviewDraftKey(identity, systemTable));
    const child = systemTable.rows[1]!;
    const restoredDraft = restoreSteelReviewDraftRow(initialDraft, child);
    expect(compileSteelReviewOperations(
      systemTable,
      restoredDraft,
      applySteelReviewDrafts(systemTable.rows, restoredDraft),
    )).toEqual([{ type: 'restore', rowId: child.rowId }]);
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

describe('material calculation draft intent', () => {
  const headers = ['型號', '品名規格', '材質編號', '單位', '數量', '單重', '總數', '單價', '計價基準', '公式編號', '厚度', '寬度', '長度', '肚', '類別', '備註'];
  const values = ['PL', 'plate', 'M1', 'kg', '2', '0.942', '1.884', '10', '2', '', '6', '100', '200', '', '鐵板', '原厚度 99 mm'];
  const material: SteelReviewRow = {
    rowId: 'material', origin: 'ai', deleted: false, source: null,
    system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
    values: Object.fromEntries(headers.map((header, index) => [header, { baseline: values[index], effective: values[index] }])),
    calculation: { candidate: { erpItemCode: 'PL', category: '鐵板', ruleVersion: 'steel-weight-v1', exactPhysical: { density: '7.85' } } },
  };
  const materialTable: SteelReviewTable = { ...table, kind: 'system_order', title: 'system_order', headers, rows: [material] };

  it('previews exact dimensions while transporting only explicit raw input and preserving undo', () => {
    const draft = setSteelReviewDraftCell(createSteelReviewDraftState('owner'), material, '厚度', '0.1 inch');
    const projected = applySteelReviewDrafts(materialTable.rows, draft);
    expect(projected[0].values['厚度'].effective).toBe('2.54');
    expect(projected[0].values['單重'].effective).toBe('0.39878');
    expect(projected[0].values['總數'].effective).toBe('0.79756');
    expect(compileSteelReviewOperations(materialTable, draft, projected)).toEqual([
      { type: 'update', rowId: 'material', changes: [{ header: '厚度', value: '0.1 inch' }] },
    ]);
    expect(getSteelReviewDirtyRowIds(materialTable, draft)).toEqual(['material']);
    expect(applySteelReviewDrafts(materialTable.rows, undoSteelReviewDraft(draft))[0].values).toEqual(material.values);
  });

  it('retains a final manual return to saved total after quantity changed', () => {
    let draft = setSteelReviewDraftCell(createSteelReviewDraftState('owner'), material, '數量', '3');
    draft = finishSteelReviewDraftHistory(draft);
    draft = setSteelReviewDraftCell(draft, material, '總數', '99');
    draft = setSteelReviewDraftCell(draft, material, '總數', '1.884');
    const projected = applySteelReviewDrafts(materialTable.rows, draft);
    expect(projected[0].values['總數'].effective).toBe('1.884');
    expect(compileSteelReviewOperations(materialTable, draft, projected)).toEqual([
      { type: 'update', rowId: 'material', changes: [{ header: '數量', value: '3' }, { header: '總數', value: '1.884' }] },
    ]);
    expect(applySteelReviewDrafts(materialTable.rows, undoSteelReviewDraft(draft))[0].values['總數'].effective).toBe('2.826');
    expect(applySteelReviewDrafts(materialTable.rows, redoSteelReviewDraft(undoSteelReviewDraft(draft)))[0].values['總數'].effective).toBe('1.884');
  });

  it('keeps explicitly manual weight when quantity changes even with candidate evidence', () => {
    let draft = setSteelReviewDraftCell(createSteelReviewDraftState('owner'), material, '單重', '2.5');
    draft = setSteelReviewDraftCell(draft, material, '數量', '3');
    const projected = applySteelReviewDrafts(materialTable.rows, draft);
    expect(projected[0].values['單重'].effective).toBe('2.5');
    expect(projected[0].values['總數'].effective).toBe('7.5');
    expect(compileSteelReviewOperations(materialTable, draft, projected)).toEqual([
      { type: 'update', rowId: 'material', changes: [{ header: '單重', value: '2.5' }, { header: '數量', value: '3' }] },
    ]);
  });

  it('preserves outputs with missing inputs and does not reweight price edits', () => {
    const empty = setSteelReviewDraftCell(createSteelReviewDraftState('owner'), material, '長度', '');
    const missing = applySteelReviewDrafts(materialTable.rows, empty)[0];
    expect(missing.values['長度'].effective).toBe('');
    expect(missing.values['單重']).toEqual(material.values['單重']);
    expect(missing.values['總數']).toEqual(material.values['總數']);
    const manual = { ...material, values: { ...material.values, '單重': { baseline: '0.942', effective: '2.5' } } };
    const price = setSteelReviewDraftCell(createSteelReviewDraftState('owner'), manual, '單價', '11');
    expect(applySteelReviewDrafts([manual], price)[0].values['單重'].effective).toBe('2.5');
  });

  it('does not create net changes or operations for a same-value edit alone', () => {
    const draft = setSteelReviewDraftCell(createSteelReviewDraftState('owner'), material, '總數', '1.884');
    const projected = applySteelReviewDrafts(materialTable.rows, draft);
    expect(getSteelReviewDirtyRowIds(materialTable, draft)).toEqual([]);
    expect(compileSteelReviewOperations(materialTable, draft, projected)).toEqual([]);
  });
});

describe('Steel Review catalog candidate intent', () => {
  const headers = ['型號', '品名規格', '材質編號', '類別', '單位', '數量', '單價', '厚度', '寬度', '長度', '備註'];
  const candidate: SteelCatalogCandidate = {
    id: 'catalog-1', revision: 'a'.repeat(64), erpItemCode: 'SC-1', productName: 'Plate', specKey: '400mm',
    category: '鐵板', subcategory: null, formulaCode: null, material: 'SS400', unit: 'kg', costBasis: 'kg', valueState: 'confirmed',
    unitWeightValue: null, unitWeightBasis: null, density: '7.85', thicknessMinMm: '2', thicknessMaxMm: '6',
    widthMm: '400', heightMm: null, lengthMm: null, outerDiameterMm: null, webMm: null, flangeMm: null, lipMm: null,
    sheetWidthMm: null, sheetLengthMm: null, unitPrice: '2',
    calculation: { erpItemCode: 'SC-1', category: '鐵板', ruleVersion: 'steel-catalog-v1', exactPhysical: { density: '7.85' } },
    label: 'SC-1 Plate 400mm',
  };
  const material: SteelReviewRow = {
    rowId: 'material-1', origin: 'ai', deleted: false,
    source: { fileId: 'drawing-1', pageNumber: 1, filename: 'drawing.pdf', mediaType: 'application/pdf' },
    system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
    values: Object.fromEntries(headers.map((header) => [header, {
      baseline: header === '數量' ? '3' : '', effective: header === '數量' ? '3' : '',
    }])),
  };
  const processing: SteelReviewRow = {
    rowId: 'processing-1', origin: 'ai', deleted: false, source: material.source,
    system: { kind: 'processing', parentRowId: material.rowId, cascadeDeletedBy: null },
    values: Object.fromEntries(headers.map((header) => [header, {
      baseline: header === '備註' ? 'SC-OLD' : '', effective: header === '備註' ? 'SC-OLD' : '',
    }])),
  };
  const table: Pick<SteelReviewTable, 'headers' | 'rows'> = { headers, rows: [material, processing] };
  const customer = { snapshotId: 'customer-1', revision: 'customer-revision-1', tier: 'B' as const };

  it('records one identity-only replacement, preserves children, and retains later quantity edits in order', () => {
    const selected = setSteelReviewDraftCandidate(createSteelReviewDraftState('owner'), table, material, candidate, customer);
    const selectedRows = applySteelReviewDrafts(table.rows, selected);
    const edited = setSteelReviewDraftCell(selected, selectedRows.find((row) => row.rowId === material.rowId)!, '數量', '5');
    const projected = applySteelReviewDrafts(table.rows, edited);
    expect(projected.find((row) => row.rowId === material.rowId)?.values['型號']?.effective).toBe('SC-1');
    expect(projected.find((row) => row.rowId === material.rowId)?.values['品名規格']?.effective).toBe('Plate 400mm');
    expect(projected.find((row) => row.rowId === material.rowId)?.values['材質編號']?.effective).toBe('SS400');
    expect(projected.find((row) => row.rowId === processing.rowId)).toEqual(processing);
    expect(compileSteelReviewOperations(table, edited, projected)).toEqual([
      { type: 'replace_material', rowId: material.rowId, selection: { id: candidate.id, revision: candidate.revision, evidence: customer } },
      { type: 'update', rowId: material.rowId, changes: [{ header: '數量', value: '5' }] },
    ]);
  });

  it('serializes a selected new material as add then authenticated replacement and later edits', () => {
    let draft = addSteelReviewDraftRow(createSteelReviewDraftState('owner'), table, material, null, { kind: 'material', parentRowId: null, cascadeDeletedBy: null });
    const added = applySteelReviewDrafts(table.rows, draft).find((row) => row.origin === 'manual')!;
    draft = setSteelReviewDraftCandidate(draft, table, added, candidate, customer);
    const selected = applySteelReviewDrafts(table.rows, draft).find((row) => row.rowId === added.rowId)!;
    draft = setSteelReviewDraftCell(draft, selected, '厚度', '3');
    const operations = compileSteelReviewOperations(table, draft, applySteelReviewDrafts(table.rows, draft));
    expect(operations.map((operation) => operation.type)).toEqual(['add', 'replace_material', 'update']);
    expect(operations[0]).toMatchObject({ system: { kind: 'material', parentRowId: null } });
    expect(operations[0].type === 'add' && operations[0].changes.some(({ header }) => header === '單價')).toBe(false);
    expect(operations[1]).toEqual({ type: 'replace_material', rowId: added.rowId,
      selection: { id: candidate.id, revision: candidate.revision, evidence: customer } });
    expect(operations[2]).toEqual({ type: 'update', rowId: added.rowId, changes: [{ header: '厚度', value: '3' }] });
  });

  it('undoes and redoes the candidate as one history event', () => {
    const selected = setSteelReviewDraftCandidate(createSteelReviewDraftState('owner'), table, material, candidate, customer);
    const undone = undoSteelReviewDraft(selected);
    expect(applySteelReviewDrafts(table.rows, undone).find((row) => row.rowId === material.rowId)?.values['型號']?.effective).toBe('');
    expect(applySteelReviewDrafts(table.rows, redoSteelReviewDraft(undone)).find((row) => row.rowId === material.rowId)?.values['型號']?.effective).toBe('SC-1');
  });

  it('lets candidate dimensions supersede earlier size edits while preserving quantity', () => {
    const beforeSelection = setSteelReviewDraftCell(createSteelReviewDraftState('owner'), material, '厚度', '10');
    const beforeRow = applySteelReviewDrafts(table.rows, beforeSelection).find((row) => row.rowId === material.rowId)!;
    const selected = setSteelReviewDraftCandidate(beforeSelection, table, beforeRow, candidate, customer);
    const projected = applySteelReviewDrafts(table.rows, selected).find((row) => row.rowId === material.rowId)!;

    expect(projected.values['厚度']?.effective).toBe('');
    expect(projected.values['數量']?.effective).toBe('3');
    expect(compileSteelReviewOperations(table, selected, [projected, processing])).toEqual([
      { type: 'replace_material', rowId: material.rowId, selection: { id: candidate.id, revision: candidate.revision, evidence: customer } },
    ]);
  });
});
