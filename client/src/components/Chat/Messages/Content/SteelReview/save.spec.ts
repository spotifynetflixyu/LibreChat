import type {
  SteelReviewRow,
  SteelReviewConflict,
  SteelReviewRecovery,
} from 'librechat-data-provider';
import type {
  SteelReviewSaveAction,
  SteelReviewSaveState,
  SteelReviewReceiptInput,
  SteelReviewConfirmedSave,
} from './save';
import type { CaptureScoped } from './authority';
import {
  isSteelReviewSaveBusy,
  steelReviewSaveReducer,
  steelReviewRowsToMatrix,
  getSteelReviewErrorCode,
  getSteelReviewSaveErrorKey,
  getSteelReviewErrorStatus,
  emptySteelReviewSaveState,
  getSteelReviewErrorRecovery,
  getSteelReviewReceiptEffectKey,
} from './save';

const receiptInput: CaptureScoped<SteelReviewReceiptInput> = {
  captureId: 'capture-1',
  value: {
    conversationId: 'conversation-1',
    kind: 'ocr_result',
    messageId: 'message-1',
    outputId: 'ocr_result:generation-1',
    operationId: 'operation-1',
    digest: 'a'.repeat(64),
    title: 'ocr_result',
  },
};

const confirmedSave: SteelReviewConfirmedSave = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  title: 'ocr_result',
  kind: 'ocr_result',
  outputId: 'ocr_result:generation-1',
  revision: 'generation-1-save-1',
  changedRows: 1,
};

const fieldConflict: SteelReviewConflict = {
  kind: 'field',
  rowId: 'row-1',
  header: '數量',
  expected: '2',
  current: '4',
  requested: '9',
};

const sourceConflict: SteelReviewConflict = {
  kind: 'source',
  rowId: 'row-2',
  expected: null,
  current: { fileId: 'file-1', pageNumber: 1 },
  requested: { fileId: 'file-1', pageNumber: 2 },
};

const recovery: SteelReviewRecovery = {
  table: {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    outputId: 'ocr_result:generation-1',
    title: 'ocr_result',
    kind: 'ocr_result',
    revision: 'generation-1-save-2',
    latestOutputId: 'ocr_result:generation-1',
    isLatest: true,
    readOnly: false,
    effectiveMarkdown: 'effective',
    headers: ['數量'],
    rows: [],
  },
  conflicts: [fieldConflict, sourceConflict],
};

/** Any reconciliation in flight with a pending close and a failed receipt. */
const reconciling: SteelReviewSaveState = {
  closeRequested: true,
  savePhase: 'reconciling',
  saveErrorCode: 'REVIEW_CONFLICT',
  saveRecovery: recovery,
  confirmedSave,
  receiptInput,
  discardRequested: true,
  receiptFailed: true,
};

describe('steelReviewSaveReducer', () => {
  it.each<[string, SteelReviewSaveState, SteelReviewSaveAction, Partial<SteelReviewSaveState>]>([
    [
      'saving',
      { ...emptySteelReviewSaveState, savePhase: 'error', saveErrorCode: 'REVIEW_CONFLICT' },
      { type: 'saving', phase: 'preparing' },
      { savePhase: 'preparing', saveErrorCode: undefined },
    ],
    [
      'uncertain',
      { ...emptySteelReviewSaveState, savePhase: 'committing', saveErrorCode: 'REVIEW_CONFLICT' },
      { type: 'uncertain' },
      { savePhase: 'uncertain', saveErrorCode: undefined },
    ],
    [
      'saved',
      { ...emptySteelReviewSaveState, savePhase: 'committing', saveRecovery: recovery },
      { type: 'saved' },
      { savePhase: 'idle', saveErrorCode: undefined, saveRecovery: undefined },
    ],
    [
      'failed',
      { ...emptySteelReviewSaveState, savePhase: 'preparing' },
      { type: 'failed', code: 'CATALOG_CHANGED' },
      { savePhase: 'error', saveErrorCode: 'CATALOG_CHANGED' },
    ],
    [
      'stale',
      { ...emptySteelReviewSaveState, savePhase: 'committing' },
      { type: 'stale', code: 'REVIEW_INVALID_OPERATION' },
      { savePhase: 'stale', saveErrorCode: 'REVIEW_INVALID_OPERATION' },
    ],
    [
      'confirmed',
      emptySteelReviewSaveState,
      { type: 'confirmed', confirmedSave },
      { confirmedSave },
    ],
    [
      'recovery',
      emptySteelReviewSaveState,
      { type: 'recovery', recovery },
      { saveRecovery: recovery },
    ],
    [
      'close_requested',
      emptySteelReviewSaveState,
      { type: 'close_requested', value: true },
      { closeRequested: true },
    ],
    [
      'reconcile',
      { ...emptySteelReviewSaveState, savePhase: 'uncertain', receiptFailed: true },
      { type: 'reconcile', receiptInput },
      { savePhase: 'reconciling', receiptInput, discardRequested: true, receiptFailed: false },
    ],
    [
      'retry_receipt',
      { ...reconciling, discardRequested: false },
      { type: 'retry_receipt' },
      {
        savePhase: 'reconciling',
        saveErrorCode: undefined,
        discardRequested: true,
        receiptFailed: false,
      },
    ],
    [
      'receipt_failed with a code',
      { ...reconciling, receiptFailed: false, saveErrorCode: undefined },
      { type: 'receipt_failed', code: 'REVIEW_CONFLICT' },
      { saveErrorCode: 'REVIEW_CONFLICT', discardRequested: false, receiptFailed: true },
    ],
    [
      'receipt_failed with an explicit undefined code',
      { ...reconciling, receiptFailed: false },
      { type: 'receipt_failed', code: undefined },
      { saveErrorCode: undefined, discardRequested: false, receiptFailed: true },
    ],
    [
      'receipt_failed without a code',
      { ...reconciling, receiptFailed: false },
      { type: 'receipt_failed' },
      { saveErrorCode: 'REVIEW_CONFLICT', discardRequested: false, receiptFailed: true },
    ],
    [
      'receipt_stale',
      reconciling,
      { type: 'receipt_stale' },
      {
        savePhase: 'stale',
        saveErrorCode: 'REVIEW_CONFLICT',
        receiptInput: null,
        discardRequested: false,
        receiptFailed: false,
      },
    ],
    [
      'receipt_settled',
      reconciling,
      { type: 'receipt_settled' },
      {
        closeRequested: false,
        savePhase: 'idle',
        saveErrorCode: undefined,
        saveRecovery: recovery,
        confirmedSave,
        receiptInput: null,
        discardRequested: false,
        receiptFailed: false,
      },
    ],
    [
      'discarded',
      reconciling,
      { type: 'discarded' },
      {
        closeRequested: false,
        savePhase: 'idle',
        saveErrorCode: undefined,
        saveRecovery: undefined,
        confirmedSave,
        receiptInput: null,
        discardRequested: false,
        receiptFailed: false,
      },
    ],
  ])('%s', (_label, state, action, expected) => {
    expect(steelReviewSaveReducer(state, action)).toEqual({ ...state, ...expected });
  });

  it('starts a new capture from the empty state', () => {
    expect(steelReviewSaveReducer(reconciling, { type: 'reset' })).toBe(emptySteelReviewSaveState);
  });

  it('drops one resolved conflict and keeps the rest of the recovery', () => {
    const state = { ...emptySteelReviewSaveState, saveRecovery: recovery };

    expect(
      steelReviewSaveReducer(state, { type: 'conflict_resolved', conflict: fieldConflict })
        .saveRecovery,
    ).toEqual({ ...recovery, conflicts: [sourceConflict] });
  });

  it('clears the recovery once its last conflict is resolved', () => {
    const state = {
      ...emptySteelReviewSaveState,
      saveRecovery: { ...recovery, conflicts: [fieldConflict] },
    };

    expect(
      steelReviewSaveReducer(state, { type: 'conflict_resolved', conflict: fieldConflict })
        .saveRecovery,
    ).toBeUndefined();
  });

  it('keeps the state when a conflict resolves without a recovery', () => {
    expect(
      steelReviewSaveReducer(emptySteelReviewSaveState, {
        type: 'conflict_resolved',
        conflict: fieldConflict,
      }),
    ).toBe(emptySteelReviewSaveState);
  });
});

describe('getSteelReviewSaveErrorKey', () => {
  it.each([
    ['uncertain', 'REVIEW_CONFLICT', 'com_ui_steel_review_save_uncertain'],
    ['error', 'CATALOG_CHANGED', 'com_ui_steel_review_catalog_changed'],
    ['stale', 'REVIEW_CONFLICT', 'com_ui_steel_review_save_conflict'],
    ['stale', 'REVIEW_INVALID_OPERATION', 'com_ui_steel_review_save_stale'],
    ['reconciling', undefined, 'com_ui_steel_review_receipt_error'],
    ['reconciling', 'REVIEW_CONFLICT', 'com_ui_steel_review_save_conflict'],
    ['error', undefined, 'com_ui_steel_review_save_error'],
  ] as const)('maps %s with %s to %s', (phase, code, key) => {
    expect(getSteelReviewSaveErrorKey(phase, code)).toBe(key);
  });
});

describe('isSteelReviewSaveBusy', () => {
  it.each([
    ['idle', false],
    ['preparing', true],
    ['committing', true],
    ['reconciling', true],
    ['uncertain', false],
    ['stale', false],
    ['error', false],
  ] as const)('%s is busy: %s', (phase, busy) => {
    expect(isSteelReviewSaveBusy(phase)).toBe(busy);
  });
});

describe('Steel review error parsing', () => {
  const conflictError = {
    response: { status: 409, data: { code: 'REVIEW_CONFLICT', recovery: { conflicts: 'bad' } } },
  };

  it('reads the status and a known error code from an HTTP error', () => {
    expect(getSteelReviewErrorStatus(conflictError)).toBe(409);
    expect(getSteelReviewErrorCode(conflictError)).toBe('REVIEW_CONFLICT');
  });

  it('ignores unknown codes, malformed recoveries, and non-HTTP errors', () => {
    expect(getSteelReviewErrorCode({ response: { data: { code: 'NOT_A_CODE' } } })).toBeUndefined();
    expect(getSteelReviewErrorRecovery(conflictError)).toBeUndefined();
    expect(getSteelReviewErrorStatus(new Error('connection lost'))).toBeUndefined();
  });
});

describe('getSteelReviewReceiptEffectKey', () => {
  it('keys a receipt run by its capture and committed operation', () => {
    expect(getSteelReviewReceiptEffectKey(receiptInput)).toBe(
      `capture-1:ocr_result:generation-1:operation-1:${'a'.repeat(64)}`,
    );
  });
});

describe('steelReviewRowsToMatrix', () => {
  it('exports the visible rows under the table headers', () => {
    const rows: SteelReviewRow[] = [
      { rowId: 'row-1', source: null, values: { 品名: { baseline: 'A', effective: 'B' } } },
      { rowId: 'row-2', source: null, deleted: true, values: {} },
      { rowId: 'row-3', source: null, values: {} },
    ];

    expect(steelReviewRowsToMatrix({ headers: ['品名', '數量'] }, rows)).toEqual([
      ['品名', '數量'],
      ['B', ''],
      ['', ''],
    ]);
  });
});
