import { steelReviewErrorCodeSchema, steelReviewRecoverySchema } from 'librechat-data-provider';
import type {
  SteelReviewConflict,
  SteelReviewErrorCode,
  SteelReviewKind,
  SteelReviewRecovery,
  SteelReviewRow,
  SteelReviewTable,
} from 'librechat-data-provider';
import type { TableMatrix } from '../table/export';
import type { CaptureScoped } from './authority';
import { getSteelErrorResponse } from '~/utils/steel';

export type SteelReviewSavePhase =
  | 'idle'
  | 'preparing'
  | 'committing'
  | 'uncertain'
  | 'stale'
  | 'error'
  | 'reconciling';

/** The committed-operation receipt a reconciliation looks up. */
export type SteelReviewReceiptInput = {
  conversationId: string;
  kind: SteelReviewKind;
  messageId: string;
  outputId: string;
  operationId: string;
  digest: string;
  title: string;
};

export type SteelReviewConfirmedSave = {
  conversationId: string;
  messageId: string;
  title: string;
  kind: SteelReviewKind;
  outputId: string;
  revision: string;
  changedRows: number;
  customerQuoteChangedRows?: number;
  customerQuoteTotal?: string | null;
};

/** The save and close state of one dialog capture. */
export type SteelReviewSaveState = {
  closeRequested: boolean;
  savePhase: SteelReviewSavePhase;
  saveErrorCode?: SteelReviewErrorCode;
  saveRecovery?: SteelReviewRecovery;
  confirmedSave?: SteelReviewConfirmedSave;
  receiptInput: CaptureScoped<SteelReviewReceiptInput> | null;
  discardRequested: boolean;
  receiptFailed: boolean;
};

export const emptySteelReviewSaveState: SteelReviewSaveState = {
  closeRequested: false,
  savePhase: 'idle',
  receiptInput: null,
  discardRequested: false,
  receiptFailed: false,
};

export type SteelReviewSaveAction =
  /** A new capture starts from an empty save state. */
  | { type: 'reset' }
  /** A prepare or commit request is in flight. */
  | { type: 'saving'; phase: 'preparing' | 'committing' }
  /** The commit outcome is unknown until its receipt is reconciled. */
  | { type: 'uncertain' }
  /** The save finished; any conflict recovery is resolved. */
  | { type: 'saved' }
  /** The save failed before any commit was attempted. */
  | { type: 'failed'; code?: SteelReviewErrorCode }
  /** The captured operation can no longer be applied to the live owner. */
  | { type: 'stale'; code: SteelReviewErrorCode }
  | { type: 'confirmed'; confirmedSave: SteelReviewConfirmedSave }
  | { type: 'recovery'; recovery: SteelReviewRecovery | undefined }
  /** One conflict was resolved by taking the latest value. */
  | { type: 'conflict_resolved'; conflict: SteelReviewConflict }
  | { type: 'close_requested'; value: boolean }
  /** Look up the receipt of an uncertain commit before discarding the draft. */
  | { type: 'reconcile'; receiptInput: CaptureScoped<SteelReviewReceiptInput> }
  | { type: 'retry_receipt' }
  /** The receipt lookup failed; `code` replaces the error code when present. */
  | { type: 'receipt_failed'; code?: SteelReviewErrorCode }
  /** The receipt belongs to an operation the live owner no longer accepts. */
  | { type: 'receipt_stale' }
  /** The receipt was applied (or the draft discarded) and the dialog stays open. */
  | { type: 'receipt_settled' }
  /** The draft was discarded and the dialog closes; a confirmed save stays visible. */
  | { type: 'discarded' };

const settledReceipt: Partial<SteelReviewSaveState> = {
  receiptInput: null,
  receiptFailed: false,
  discardRequested: false,
  closeRequested: false,
  saveErrorCode: undefined,
  savePhase: 'idle',
};

export interface SteelReviewDownloadAuthority {
  outputId: string;
  revision: string;
}

export interface SteelReviewSaveGate {
  isOpen: boolean;
  ensureSaved: (authority?: SteelReviewDownloadAuthority) => Promise<boolean>;
  getMatrix: () => TableMatrix;
}

export function steelReviewSaveReducer(
  state: SteelReviewSaveState,
  action: SteelReviewSaveAction,
): SteelReviewSaveState {
  switch (action.type) {
    case 'reset':
      return emptySteelReviewSaveState;
    case 'saving':
      return { ...state, savePhase: action.phase, saveErrorCode: undefined };
    case 'uncertain':
      return { ...state, savePhase: 'uncertain', saveErrorCode: undefined };
    case 'saved':
      return { ...state, savePhase: 'idle', saveErrorCode: undefined, saveRecovery: undefined };
    case 'failed':
      return { ...state, savePhase: 'error', saveErrorCode: action.code };
    case 'stale':
      return { ...state, savePhase: 'stale', saveErrorCode: action.code };
    case 'confirmed':
      return { ...state, confirmedSave: action.confirmedSave };
    case 'recovery':
      return { ...state, saveRecovery: action.recovery };
    case 'conflict_resolved': {
      if (!state.saveRecovery) {
        return state;
      }
      const conflicts = state.saveRecovery.conflicts.filter(
        (candidate) => candidate !== action.conflict,
      );
      return {
        ...state,
        saveRecovery: conflicts.length > 0 ? { ...state.saveRecovery, conflicts } : undefined,
      };
    }
    case 'close_requested':
      return { ...state, closeRequested: action.value };
    case 'reconcile':
      return {
        ...state,
        receiptFailed: false,
        savePhase: 'reconciling',
        receiptInput: action.receiptInput,
        discardRequested: true,
      };
    case 'retry_receipt':
      return {
        ...state,
        receiptFailed: false,
        saveErrorCode: undefined,
        savePhase: 'reconciling',
        discardRequested: true,
      };
    case 'receipt_failed':
      return {
        ...state,
        discardRequested: false,
        savePhase: 'reconciling',
        receiptFailed: true,
        ...('code' in action ? { saveErrorCode: action.code } : {}),
      };
    case 'receipt_stale':
      return {
        ...state,
        discardRequested: false,
        savePhase: 'stale',
        saveErrorCode: 'REVIEW_CONFLICT',
        receiptInput: null,
        receiptFailed: false,
      };
    case 'receipt_settled':
      return { ...state, ...settledReceipt };
    case 'discarded':
      return { ...state, ...settledReceipt, saveRecovery: undefined };
  }
}

export function getSteelReviewReceiptEffectKey(
  receiptInput: CaptureScoped<SteelReviewReceiptInput>,
): string {
  return [
    receiptInput.captureId,
    receiptInput.value.outputId,
    receiptInput.value.operationId,
    receiptInput.value.digest,
  ].join(':');
}

export function isSteelReviewSaveBusy(phase: SteelReviewSavePhase): boolean {
  return phase === 'preparing' || phase === 'committing' || phase === 'reconciling';
}

export function getSteelReviewErrorStatus(error: unknown): number | undefined {
  const status = getSteelErrorResponse(error)?.status;
  return typeof status === 'number' ? status : undefined;
}

export function getSteelReviewErrorCode(error: unknown): SteelReviewErrorCode | undefined {
  const parsed = steelReviewErrorCodeSchema.safeParse(getSteelErrorResponse(error)?.data?.code);
  return parsed.success ? parsed.data : undefined;
}

export function getSteelReviewErrorRecovery(error: unknown): SteelReviewRecovery | undefined {
  const parsed = steelReviewRecoverySchema.safeParse(getSteelErrorResponse(error)?.data?.recovery);
  return parsed.success ? parsed.data : undefined;
}

export type SteelReviewSaveErrorKey =
  | 'com_ui_steel_review_save_uncertain'
  | 'com_ui_steel_review_save_conflict'
  | 'com_ui_steel_review_save_stale'
  | 'com_ui_steel_review_receipt_error'
  | 'com_ui_steel_review_save_error'
  | 'com_ui_steel_review_catalog_changed';

export function getSteelReviewSaveErrorKey(
  phase: SteelReviewSavePhase,
  code?: SteelReviewErrorCode,
): SteelReviewSaveErrorKey {
  if (phase === 'uncertain') {
    return 'com_ui_steel_review_save_uncertain';
  }
  if (code === 'CATALOG_CHANGED') {
    return 'com_ui_steel_review_catalog_changed';
  }
  if (code === 'REVIEW_CONFLICT') {
    return 'com_ui_steel_review_save_conflict';
  }
  if (code === 'REVIEW_INVALID_OPERATION') {
    return 'com_ui_steel_review_save_stale';
  }
  if (phase === 'reconciling') {
    return 'com_ui_steel_review_receipt_error';
  }
  return 'com_ui_steel_review_save_error';
}

/** The visible (non-deleted) review rows as a header-first export matrix. */
export function steelReviewRowsToMatrix(
  table: Pick<SteelReviewTable, 'headers'>,
  rows: readonly SteelReviewRow[],
): TableMatrix {
  return [
    table.headers,
    ...rows
      .filter((row) => !row.deleted)
      .map((row) => table.headers.map((header) => row.values[header]?.effective ?? '')),
  ];
}
