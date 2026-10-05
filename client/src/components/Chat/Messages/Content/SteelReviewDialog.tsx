import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useStore } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Maximize2, Minimize2 } from 'lucide-react';
import {
  DynamicQueryKeys,
  QueryKeys,
  dataService,
  steelReviewErrorCodeSchema,
  steelReviewRecoverySchema,
} from 'librechat-data-provider';
import {
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@librechat/client';
import type {
  SteelReviewErrorCode,
  SteelReviewConflict,
  SteelReviewKind,
  SteelReviewPrepared,
  SteelReviewReceiptStatus,
  SteelReviewResponse,
  SteelReviewRecovery,
  SteelReviewRow,
  SteelReviewSavedSnapshot,
  SteelReviewSource,
  SteelReviewSystemState,
  SteelReviewTable,
  TMessage,
} from 'librechat-data-provider';
import type { MutableRefObject } from 'react';
import type { SteelReviewCapturedAuthority, SteelReviewIdentity, SteelReviewSelection } from './SteelReview/state';
import type { SteelReviewDraftState } from './SteelReview/session';
import type { SteelReviewPreviewRows } from './SteelReview/filter';
import type { TableMatrix } from './table/export';
import {
  addSteelReviewDraftRow,
  applySteelReviewDrafts,
  areSteelReviewDraftOwnersSame,
  canRedoSteelReviewDraft,
  canUndoSteelReviewDraft,
  clearSteelReviewDraftHistory,
  createSteelReviewDraftState,
  deleteSteelReviewDraftRow,
  deleteSteelReviewDraftGroup,
  finishSteelReviewDraftHistory,
  getSteelReviewDirtyRowIds,
  getSteelReviewDraftKey,
  getSteelReviewDraftOwnerKey,
  getSteelReviewDraftSource,
  getSteelReviewCommitInput,
  getSteelReviewPrepareInput,
  rebaseSteelReviewDraftState,
  redoSteelReviewDraft,
  restoreSteelReviewDraftGroup,
  restoreSteelReviewDraftRow,
  setSteelReviewDraftCell,
  setSteelReviewDraftSource,
  setSteelReviewDraftSystem,
  undoSteelReviewDraft,
} from './SteelReview/session';
import {
  useCommitSteelReviewMutation,
  useGetSteelReviewQuery,
  useGetSteelReviewReceiptQuery,
  useGetSteelReviewSourceQuery,
  useGetSteelReviewSourcePageCountQuery,
  useGetSteelReviewSourcesQuery,
  usePrepareSteelReviewMutation,
} from '~/data-provider';
import {
  steelReviewDialogStateFamily,
  steelReviewDraftStateFamily,
  steelReviewIdentityKey,
  steelReviewSelectionAtom,
  steelReviewSourcePreviewKey,
  sameSteelReviewIdentity,
} from './SteelReview/state';
import {
  applySteelReviewSnapshotToMessages,
  applySteelReviewSnapshotToResponse,
} from './SteelReview/cache';
import SteelReviewSourcePreview from './SteelReview/SourcePreview';
import { getSteelReviewPreviewRows } from './SteelReview/filter';
import SteelReviewEditor from './SteelReview/Editor';
import { createCsvBlob } from './table/export';
import { triggerDownload } from '~/utils';
import { useLocalize } from '~/hooks';

export interface SteelReviewDownloadAuthority {
  outputId: string;
  revision: string;
}

export interface SteelReviewSaveGate {
  isOpen: boolean;
  ensureSaved: (authority?: SteelReviewDownloadAuthority) => Promise<boolean>;
  getMatrix: () => TableMatrix;
}

interface SteelReviewDialogProps {
  identity: SteelReviewIdentity;
  downloadFilename?: string;
  saveGateRef?: MutableRefObject<SteelReviewSaveGate | undefined>;
}

type SavePhase = 'idle' | 'preparing' | 'committing' | 'uncertain' | 'stale' | 'error' | 'reconciling';

type ReceiptInput = {
  conversationId: string;
  kind: SteelReviewKind;
  messageId: string;
  outputId: string;
  operationId: string;
  digest: string;
  title: string;
};

type SteelReviewConfirmedSave = {
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

type SteelReviewScope = SteelReviewIdentity;

type CaptureScoped<T> = {
  captureId: string;
  value: T;
};

type CaptureUiState = {
  closeRequested: boolean;
  savePhase: SavePhase;
  saveErrorCode?: SteelReviewErrorCode;
  saveRecovery?: SteelReviewRecovery;
  confirmedSave?: SteelReviewConfirmedSave;
  receiptInput: CaptureScoped<ReceiptInput> | null;
  discardRequested: boolean;
  receiptFailed: boolean;
};

const emptyCaptureUiState: CaptureUiState = {
  closeRequested: false,
  savePhase: 'idle',
  receiptInput: null,
  discardRequested: false,
  receiptFailed: false,
};

function getCaptureScopedValue<T>(
  ref: MutableRefObject<CaptureScoped<T> | undefined>,
  captureId: string | undefined,
): T | undefined {
  return captureId && ref.current?.captureId === captureId ? ref.current.value : undefined;
}

function getReceiptEffectKey(receiptInput: CaptureScoped<ReceiptInput>): string {
  return [
    receiptInput.captureId,
    receiptInput.value.outputId,
    receiptInput.value.operationId,
    receiptInput.value.digest,
  ].join(':');
}

function sameSteelReviewScope(
  left: SteelReviewScope | null | undefined,
  right: SteelReviewScope | null | undefined,
): boolean {
  return Boolean(left && right && sameSteelReviewIdentity(left, right));
}

function isCapturedAuthorityForPrepared(
  authority: SteelReviewCapturedAuthority | undefined,
  prepared: SteelReviewPrepared,
): boolean {
  return Boolean(authority && authority.outputId === prepared.outputId &&
    authority.table.outputId === prepared.outputId &&
    sameSteelReviewScope(authority.table, prepared));
}

function isSameCapturedAuthorityOwner(
  left: SteelReviewCapturedAuthority | undefined,
  right: SteelReviewCapturedAuthority | undefined,
): boolean {
  return Boolean(left && right && left.outputId === right.outputId &&
    left.table.outputId === right.table.outputId &&
    sameSteelReviewScope(left.table, right.table));
}

function isCurrentCapturedSession(
  selection: SteelReviewSelection | null | undefined,
  identity: SteelReviewIdentity,
  authority: SteelReviewCapturedAuthority | undefined,
  expectedAuthority: SteelReviewCapturedAuthority | undefined,
): boolean {
  return Boolean(selection && sameSteelReviewIdentity(selection, identity) &&
    isSameCapturedAuthorityOwner(authority, expectedAuthority));
}

function isCapturedSessionActive(
  selection: SteelReviewSelection | null | undefined,
  identity: SteelReviewIdentity,
  authority: SteelReviewCapturedAuthority | undefined,
  prepared: SteelReviewPrepared,
): boolean {
  return Boolean(selection &&
    sameSteelReviewIdentity(selection, identity) &&
    sameSteelReviewScope(selection, prepared) &&
    isCapturedAuthorityForPrepared(authority, prepared));
}

function isCurrentOwner(
  table: SteelReviewTable | null | undefined,
  owner: Omit<SteelReviewConfirmedSave, 'changedRows'>,
): boolean {
  return Boolean(
    table &&
    table.conversationId === owner.conversationId &&
    table.messageId === owner.messageId &&
    table.kind === owner.kind &&
    table.title === owner.title &&
    table.outputId === owner.outputId &&
    table.revision === owner.revision &&
    table.isLatest,
  );
}

function getCurrentLastSaveCount(table: SteelReviewTable | null | undefined): number | undefined {
  const lastSave = table?.lastSave;
  const snapshot = lastSave?.snapshot;
  if (!lastSave || !snapshot || lastSave.revision !== table?.revision ||
    lastSave.changedRows !== snapshot.changedRows ||
    snapshot.conversationId !== table?.conversationId ||
    snapshot.messageId !== table?.messageId ||
    snapshot.outputId !== table?.outputId || snapshot.revision !== table?.revision) {
    return undefined;
  }
  return snapshot.changedRows > 0 ? snapshot.changedRows : undefined;
}

function getCurrentLastSaveCaption(table: SteelReviewTable | null | undefined): {
  customerQuoteChangedRows?: number;
  customerQuoteTotal?: string | null;
} | undefined {
  const lastSave = table?.lastSave;
  const snapshot = lastSave?.snapshot;
  if (!lastSave || !snapshot || lastSave.revision !== table?.revision ||
    snapshot.conversationId !== table?.conversationId || snapshot.messageId !== table?.messageId ||
    snapshot.outputId !== table?.outputId || snapshot.revision !== table?.revision) {
    return undefined;
  }
  return snapshot.caption
    ? {
        ...(snapshot.caption.customerQuoteChangedRows !== undefined
          ? { customerQuoteChangedRows: snapshot.caption.customerQuoteChangedRows }
          : {}),
        ...(snapshot.caption.customerQuoteTotal !== undefined
          ? { customerQuoteTotal: snapshot.caption.customerQuoteTotal }
          : {}),
      }
    : undefined;
}

function isAuthorizedCurrentTable(
  table: SteelReviewTable | null | undefined,
  prepared: SteelReviewPrepared,
): boolean {
  return Boolean(
    table &&
    table.conversationId === prepared.conversationId &&
    table.messageId === prepared.messageId &&
    table.kind === prepared.kind &&
    table.title === prepared.title &&
    table.outputId === prepared.outputId &&
    table.latestOutputId === prepared.outputId &&
    table.isLatest,
  );
}

function isAuthorizedCurrentNoOpTable(
  table: SteelReviewTable | null | undefined,
  prepared: SteelReviewPrepared,
): boolean {
  return Boolean(
    table &&
    table.conversationId === prepared.conversationId &&
    table.messageId === prepared.messageId &&
    table.kind === prepared.kind &&
    table.title === prepared.title &&
    table.outputId === prepared.outputId &&
    table.latestOutputId === prepared.outputId &&
    table.isLatest,
  );
}

async function canApplySteelReviewMessageSnapshot(
  messages: readonly TMessage[] | undefined,
  prepared: SteelReviewPrepared,
  snapshot: SteelReviewSavedSnapshot,
): Promise<boolean> {
  if (!messages) {
    return true;
  }
  const message = messages.find((candidate) => candidate.messageId === snapshot.messageId);
  if (!message) {
    return false;
  }
  if (message.text === snapshot.messageText) {
    return true;
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return false;
  }
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(message.text));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return hash === prepared.messageSha256;
  } catch {
    return false;
  }
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('status' in response)) {
    return undefined;
  }
  return typeof response.status === 'number' ? response.status : undefined;
}

function getErrorCode(error: unknown): SteelReviewErrorCode | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('data' in response)) {
    return undefined;
  }
  const data = response.data;
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return undefined;
  }
  const parsed = steelReviewErrorCodeSchema.safeParse(data.code);
  return parsed.success ? parsed.data : undefined;
}

function getErrorRecovery(error: unknown): SteelReviewRecovery | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('data' in response)) {
    return undefined;
  }
  const data = response.data;
  if (typeof data !== 'object' || data === null || !('recovery' in data)) {
    return undefined;
  }
  const parsed = steelReviewRecoverySchema.safeParse(data.recovery);
  return parsed.success ? parsed.data : undefined;
}

function rowsToMatrix(table: Pick<SteelReviewTable, 'headers'>, rows: readonly SteelReviewRow[]): TableMatrix {
  return [
    table.headers,
    ...rows.filter((row) => !row.deleted)
      .map((row) => table.headers.map((header) => row.values[header]?.effective ?? '')),
  ];
}

type SteelReviewSaveErrorKey =
  | 'com_ui_steel_review_save_uncertain'
  | 'com_ui_steel_review_save_conflict'
  | 'com_ui_steel_review_save_stale'
  | 'com_ui_steel_review_receipt_error'
  | 'com_ui_steel_review_save_error';

function getSaveErrorKey(phase: SavePhase, code?: SteelReviewErrorCode): SteelReviewSaveErrorKey {
  if (phase === 'uncertain') {
    return 'com_ui_steel_review_save_uncertain';
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

export default function SteelReviewDialog({
  identity,
  downloadFilename = 'steel-review.csv',
  saveGateRef,
}: SteelReviewDialogProps) {
  const localize = useLocalize();
  const sourceEditorLabels = useMemo(() => ({
    changeSource: localize('com_ui_steel_review_change_source'),
    sourceFile: localize('com_ui_steel_review_source_file'),
    sourcePage: localize('com_ui_steel_review_source_page'),
    sourceNoPage: localize('com_ui_steel_review_source_no_page'),
    clearSource: localize('com_ui_steel_review_clear_source'),
    sourceActions: localize('com_ui_steel_review_source_actions'),
    sourcePageLoading: localize('com_ui_steel_review_source_page_loading'),
    sourcePageUnavailable: localize('com_ui_steel_review_source_page_unavailable'),
    sourcePageRetry: localize('com_ui_retry'),
    rowActions: localize('com_ui_steel_review_row_actions'),
    deleteRow: localize('com_ui_steel_review_delete_row'),
    restoreRow: localize('com_ui_steel_review_restore_row'),
  }), [localize]);
  const queryClient = useQueryClient();
  const [selection, setSelection] = useAtom(steelReviewSelectionAtom);
  const store = useStore();
  const isOpen = selection != null &&
    selection.conversationId === identity.conversationId &&
    selection.messageId === identity.messageId &&
    selection.kind === identity.kind &&
    selection.title === identity.title;
  const query = useGetSteelReviewQuery(isOpen ? identity : null, { retry: false });
  const isNotFound = getErrorStatus(query.error) === 404;
  const table = query.data?.table;
  const captureId = selection?.captureId;
  const dialogStateKey = `${steelReviewIdentityKey(identity)}:${captureId ?? 'pending'}`;
  const [dialogState, setDialogState] = useAtom(steelReviewDialogStateFamily(dialogStateKey));
  const capturedAuthorityRef = useRef<CaptureScoped<SteelReviewCapturedAuthority>>();
  const getCapturedAuthority = useCallback((expectedCaptureId = captureId) => {
    if (!expectedCaptureId) {
      return undefined;
    }
    if (capturedAuthorityRef.current?.captureId === expectedCaptureId) {
      return capturedAuthorityRef.current.value;
    }
    return selection?.captureId === expectedCaptureId
      ? selection.capturedAuthority
      : undefined;
  }, [captureId, selection]);
  const capturedAuthority = getCapturedAuthority();
  const capturedTable = capturedAuthority?.table;
  const baseTable = capturedTable ?? table;
  const draftStateKey = baseTable
    ? `${getSteelReviewDraftKey(identity, baseTable)}:${captureId ?? 'pending'}`
    : `pending:${dialogStateKey}`;
  const draftStateAtomKey = baseTable
    ? getSteelReviewDraftOwnerKey(identity, baseTable, captureId)
    : `pending:${dialogStateKey}`;
  const draftStateAtom = steelReviewDraftStateFamily(draftStateAtomKey);
  const [draftState, setDraftState] = useAtom(draftStateAtom);
  const setDraftStateScoped = useCallback((
    update: SteelReviewDraftState | ((current: SteelReviewDraftState) => SteelReviewDraftState),
  ) => {
    if (!captureId) {
      return;
    }
    setDraftState((current) => {
      const liveSelection = store.get(steelReviewSelectionAtom);
      if (!liveSelection || liveSelection.captureId !== captureId ||
        !sameSteelReviewIdentity(liveSelection, identity)) {
        return current;
      }
      return typeof update === 'function' ? update(current) : update;
    });
  }, [captureId, identity, setDraftState, store]);
  const [captureUiState, setCaptureUiState] = useState<CaptureScoped<CaptureUiState>>();
  const currentCaptureUi = captureId && captureUiState?.captureId === captureId
    ? captureUiState.value
    : emptyCaptureUiState;
  const {
    closeRequested,
    savePhase,
    saveErrorCode,
    saveRecovery,
    confirmedSave,
    receiptInput,
    discardRequested,
    receiptFailed,
  } = currentCaptureUi;
  const setCaptureUiValue = useCallback(function setCaptureUiValue<K extends keyof CaptureUiState>(
    field: K,
    value: CaptureUiState[K] | ((current: CaptureUiState[K]) => CaptureUiState[K]),
  ) {
    if (!captureId) {
      return;
    }
    setCaptureUiState((current) => {
      const liveSelection = store.get(steelReviewSelectionAtom);
      if (!liveSelection || liveSelection.captureId !== captureId ||
        !sameSteelReviewIdentity(liveSelection, identity)) {
        return current;
      }
      const previous = current?.captureId === captureId ? current.value : emptyCaptureUiState;
      const nextValue = typeof value === 'function'
        ? (value as (current: CaptureUiState[K]) => CaptureUiState[K])(previous[field])
        : value;
      return {
        captureId,
        value: { ...previous, [field]: nextValue },
      };
    });
  }, [captureId, identity, setCaptureUiState, store]);
  const setCloseRequested = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    setCaptureUiValue('closeRequested', value);
  }, [setCaptureUiValue]);
  const setSavePhase = useCallback((value: SavePhase | ((current: SavePhase) => SavePhase)) => {
    setCaptureUiValue('savePhase', value);
  }, [setCaptureUiValue]);
  const setSaveErrorCode = useCallback((value: SteelReviewErrorCode | undefined | ((current: SteelReviewErrorCode | undefined) => SteelReviewErrorCode | undefined)) => {
    setCaptureUiValue('saveErrorCode', value);
  }, [setCaptureUiValue]);
  const setSaveRecovery = useCallback((value: SteelReviewRecovery | undefined | ((current: SteelReviewRecovery | undefined) => SteelReviewRecovery | undefined)) => {
    setCaptureUiValue('saveRecovery', value);
  }, [setCaptureUiValue]);
  const setConfirmedSave = useCallback((value: SteelReviewConfirmedSave | undefined | ((current: SteelReviewConfirmedSave | undefined) => SteelReviewConfirmedSave | undefined)) => {
    setCaptureUiValue('confirmedSave', value);
  }, [setCaptureUiValue]);
  const setReceiptInput = useCallback((value: CaptureScoped<ReceiptInput> | null) => {
    setCaptureUiValue('receiptInput', value);
  }, [setCaptureUiValue]);
  const setDiscardRequested = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    setCaptureUiValue('discardRequested', value);
  }, [setCaptureUiValue]);
  const setReceiptFailed = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    setCaptureUiValue('receiptFailed', value);
  }, [setCaptureUiValue]);
  const previousCaptureIdRef = useRef<string>();
  const submittedChangeSequenceRef = useRef(0);
  const discardBoundaryRef = useRef<number>();
  const preparedRef = useRef<CaptureScoped<SteelReviewPrepared>>();
  const recoveryRef = useRef<CaptureScoped<SteelReviewRecovery>>();
  const exportRowsRef = useRef<readonly SteelReviewRow[]>([]);
  const exportBaseRowsRef = useRef<readonly SteelReviewRow[]>([]);
  const pendingSnapshotRef = useRef<CaptureScoped<{ outputId: string; revision: string }>>();
  const receiptEffectKeyRef = useRef<string>();
  const latestReceiptEffectKeyRef = useRef<string>();
  latestReceiptEffectKeyRef.current = receiptInput ? getReceiptEffectKey(receiptInput) : undefined;
  const prepareMutation = usePrepareSteelReviewMutation();
  const commitMutation = useCommitSteelReviewMutation();
  const receiptQuery = useGetSteelReviewReceiptQuery(receiptInput?.value ?? null, {
    enabled: false,
    retry: false,
  });
  const receiptQueryRefetchRef = useRef(receiptQuery.refetch);
  receiptQueryRefetchRef.current = receiptQuery.refetch;
  const refetchReceipt = useCallback(() => receiptQueryRefetchRef.current(), []);
  useEffect(() => {
    if (previousCaptureIdRef.current === captureId) {
      return;
    }
    previousCaptureIdRef.current = captureId;
    preparedRef.current = undefined;
    recoveryRef.current = undefined;
    savePromiseRef.current = undefined;
    pendingSnapshotRef.current = undefined;
    discardBoundaryRef.current = undefined;
    submittedChangeSequenceRef.current = 0;
    exportRowsRef.current = [];
    exportBaseRowsRef.current = [];
    setSaveRecovery(undefined);
    setConfirmedSave(undefined);
    setReceiptInput(null);
    setDiscardRequested(false);
    setReceiptFailed(false);
    setCloseRequested(false);
    setSaveErrorCode(undefined);
    setSavePhase('idle');
  }, [captureId, setCloseRequested, setConfirmedSave, setDiscardRequested, setReceiptFailed, setReceiptInput, setSaveErrorCode, setSavePhase, setSaveRecovery]);
  const {
    selectedFileId,
    pageNumber,
    pageCount,
    fullScreen,
  } = dialogState;
  useEffect(() => {
    if (!isOpen) {
      capturedAuthorityRef.current = undefined;
      return;
    }
    if (selection?.capturedAuthority) {
      capturedAuthorityRef.current = { captureId: selection.captureId, value: selection.capturedAuthority };
      return;
    }
    if (!captureId || !table || !table.outputId || !table.revision ||
      capturedAuthorityRef.current?.captureId === captureId) {
      return;
    }
    const authority = {
      outputId: table.outputId,
      revision: table.revision,
      table,
    };
    capturedAuthorityRef.current = { captureId, value: authority };
    setSelection((current) => {
      if (!sameSteelReviewIdentity(current, identity) || current.captureId !== captureId) {
        return current;
      }
      return { ...current, capturedAuthority: authority };
    });
  }, [captureId, identity, isOpen, selection?.captureId, selection?.capturedAuthority, setSelection, table]);
  const hasActiveCapturedSession = useCallback((
    prepared: SteelReviewPrepared,
    expectedCaptureId = captureId,
  ) => {
    const currentSelection = store.get(steelReviewSelectionAtom);
    if (!expectedCaptureId || currentSelection?.captureId !== expectedCaptureId) {
      return false;
    }
    return isCapturedSessionActive(
      currentSelection,
      identity,
      currentSelection.capturedAuthority ?? getCapturedAuthority(expectedCaptureId),
      prepared,
    );
  }, [captureId, getCapturedAuthority, identity, store]);
  const isCurrentCapture = useCallback((expectedCaptureId: string, expectedOutputId?: string) => {
    const currentSelection = store.get(steelReviewSelectionAtom);
    if (!currentSelection || currentSelection.captureId !== expectedCaptureId ||
      !sameSteelReviewIdentity(currentSelection, identity)) {
      return false;
    }
    if (!expectedOutputId) {
      return true;
    }
    const authority = currentSelection.capturedAuthority ?? getCapturedAuthority(expectedCaptureId);
    return !authority || authority.outputId === expectedOutputId;
  }, [getCapturedAuthority, identity, store]);
  const hasCurrentCapturedSession = useCallback((
    expectedAuthority: SteelReviewCapturedAuthority | undefined,
    expectedCaptureId = captureId,
  ) => {
    const currentSelection = store.get(steelReviewSelectionAtom);
    if (!expectedCaptureId || currentSelection?.captureId !== expectedCaptureId) {
      return false;
    }
    return isCurrentCapturedSession(
      currentSelection,
      identity,
      currentSelection.capturedAuthority ?? getCapturedAuthority(expectedCaptureId),
      expectedAuthority,
    );
  }, [captureId, getCapturedAuthority, identity, store]);
  const clearSelectionForCapture = useCallback((
    expectedCaptureId: string | undefined,
    expectedOutputId?: string,
  ) => {
    if (!expectedCaptureId) {
      return;
    }
    setSelection((current) => {
      if (!current || current.captureId !== expectedCaptureId ||
        !sameSteelReviewIdentity(current, identity)) {
        return current;
      }
      if (expectedOutputId && current.capturedAuthority &&
        current.capturedAuthority.outputId !== expectedOutputId) {
        return current;
      }
      return null;
    });
  }, [identity, setSelection]);
  const persistCapturedAuthority = useCallback((authority: {
    outputId: string;
    revision: string;
    table: SteelReviewTable;
  }, expectedCaptureId = captureId) => {
    if (!expectedCaptureId) {
      return;
    }
    capturedAuthorityRef.current = { captureId: expectedCaptureId, value: authority };
    setSelection((current) => {
      if (!sameSteelReviewIdentity(current, identity) || current.captureId !== expectedCaptureId) {
        return current;
      }
      return { ...current, capturedAuthority: authority };
    });
  }, [captureId, identity, setSelection]);
  const clearCapturedAuthority = useCallback((expectedCaptureId = captureId) => {
    if (!expectedCaptureId || capturedAuthorityRef.current?.captureId !== expectedCaptureId) {
      return;
    }
    capturedAuthorityRef.current = undefined;
    setSelection((current) => {
      if (!sameSteelReviewIdentity(current, identity) || current.captureId !== expectedCaptureId || !current.capturedAuthority) {
        return current;
      }
      const { capturedAuthority: _capturedAuthority, ...identityOnly } = current;
      return identityOnly;
    });
  }, [captureId, identity, setSelection]);
  const authorityMatchesLiveTable = !capturedAuthority || !table ||
    table.outputId === capturedAuthority.outputId;
  const canEdit = Boolean(table && (table.kind === 'ocr_result' || table.kind === 'system_order') && table.isLatest &&
    table.latestOutputId === table.outputId && !table.readOnly &&
    (!capturedAuthority || table.outputId === capturedAuthority.outputId));
  const canEditStructure = canEdit;
  const canEditSources = canEdit && (table?.kind === 'ocr_result' || table?.kind === 'system_order');
  const canSave = canEdit && authorityMatchesLiveTable;
  useEffect(() => {
    if (!capturedAuthority || !table || authorityMatchesLiveTable) {
      return;
    }
    // Keep the prepared operation available for its commit or receipt lookup
    // while a newer live owner is being published. The receipt belongs to the
    // captured session and must be allowed to acknowledge that operation
    // before the live-owner guard can mark the dialog stale.
    if (getCaptureScopedValue(preparedRef, captureId) && (
      savePhase === 'preparing' || savePhase === 'committing' ||
      savePhase === 'uncertain' || savePhase === 'reconciling'
    )) {
      return;
    }
    preparedRef.current = undefined;
    setSavePhase('stale');
    setSaveErrorCode('REVIEW_CONFLICT');
  }, [authorityMatchesLiveTable, captureId, capturedAuthority, saveErrorCode, savePhase, setSaveErrorCode, setSavePhase, table]);
  const dirtyRowIds = useMemo(
    () => (baseTable ? getSteelReviewDirtyRowIds(baseTable, draftState) : []),
    [baseTable, draftState],
  );
  const dirtyRowCount = dirtyRowIds.length;
  const draftRows = useMemo(
    () => (baseTable ? applySteelReviewDrafts(baseTable.rows, draftState) : []),
    [baseTable, draftState],
  );
  useEffect(() => {
    const pendingSnapshot = getCaptureScopedValue(pendingSnapshotRef, captureId);
    if (pendingSnapshot && (
      table?.outputId !== pendingSnapshot.outputId ||
      table.revision !== pendingSnapshot.revision
    )) {
      return;
    }
    pendingSnapshotRef.current = undefined;
    exportBaseRowsRef.current = table?.rows ?? [];
    exportRowsRef.current = draftRows;
  }, [captureId, draftRows, table?.outputId, table?.revision, table?.rows]);
  const sourcesQuery = useGetSteelReviewSourcesQuery(
    isOpen && Boolean(table?.kind)
      ? {
          conversationId: identity.conversationId,
          kind: identity.kind,
          messageId: identity.messageId,
          title: identity.title,
        }
      : null,
    { enabled: isOpen && Boolean(table?.kind) },
  );
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const selectedSource = useMemo(
    () => sources.find((source) => source.fileId === selectedFileId) ?? sources[0],
    [selectedFileId, sources],
  );
  const selectedSourceId = selectedSource?.fileId;
  const selectedSourcePage = useMemo(
    () => draftRows.find((row) => row.source?.fileId === selectedSource?.fileId)?.source?.pageNumber,
    [draftRows, selectedSource?.fileId],
  );
  const sourceCorrectionRow = useMemo(
    () => draftRows.find((row) => row.rowId === dialogState.sourceCorrectionRowId),
    [dialogState.sourceCorrectionRowId, draftRows],
  );
  const sourceCorrectionDraft = sourceCorrectionRow?.rowId
    ? getSteelReviewDraftSource(draftState, sourceCorrectionRow.rowId)
    : undefined;
  let sourceCorrection: SteelReviewSource | null | undefined;
  if (sourceCorrectionRow?.rowId) {
    sourceCorrection = sourceCorrectionDraft === undefined ? sourceCorrectionRow.source : sourceCorrectionDraft;
  }
  const sourceCorrectionFile = sourceCorrection?.fileId
    ? sources.find((source) => source.fileId === sourceCorrection.fileId)
    : undefined;
  const sourcePageCountQuery = useGetSteelReviewSourcePageCountQuery(
    isOpen && canEditSources && sourceCorrection?.fileId && sourceCorrectionFile?.mediaType !== undefined &&
      !sourceCorrectionFile.mediaType.startsWith('image/')
      ? {
          conversationId: identity.conversationId,
          kind: identity.kind,
          messageId: identity.messageId,
          fileId: sourceCorrection.fileId,
        }
      : null,
    {
      enabled: isOpen && canEditSources && !!sourceCorrection?.fileId &&
        sourceCorrectionFile?.mediaType !== undefined &&
        !sourceCorrectionFile.mediaType.startsWith('image/'),
    },
  );
  useEffect(() => {
    if (draftState.ownerKey === draftStateKey) {
      return;
    }
    if (areSteelReviewDraftOwnersSame(draftState.ownerKey, draftStateKey)) {
      setDraftStateScoped((current) => ({ ...current, ownerKey: draftStateKey }));
      return;
    }
    setDraftStateScoped(createSteelReviewDraftState(draftStateKey));
  }, [draftState.ownerKey, draftStateKey, setDraftStateScoped]);
  useEffect(() => {
    if (!isOpen) {
      setCloseRequested(false);
    }
  }, [isOpen, setCloseRequested]);
  useEffect(() => {
    setDialogState((state) => {
      if (state.isOpen === isOpen) {
        return state;
      }
      return {
        ...state,
        isOpen,
        selectedFileId: undefined,
        pageNumber: 1,
        pageCount: 0,
        fullScreen: false,
        initializedSourceId: undefined,
        sourceCorrectionRowId: undefined,
      };
    });
  }, [isOpen, setDialogState]);
  useEffect(() => {
    setDialogState((state) => {
      if (!selectedSourceId) {
        if (!state.selectedFileId && !state.initializedSourceId && state.pageNumber === 1) {
          return state;
        }
        return {
          ...state,
          selectedFileId: undefined,
          pageNumber: 1,
          initializedSourceId: undefined,
        };
      }
      if (state.initializedSourceId === selectedSourceId) {
        return state;
      }
      return {
        ...state,
        selectedFileId: selectedSourceId,
        pageNumber: selectedSourcePage ?? 1,
        initializedSourceId: selectedSourceId,
      };
    });
  }, [selectedSourceId, selectedSourcePage, setDialogState]);
  useEffect(() => {
    if (selectedSourceId) {
      setDialogState((state) => ({ ...state, pageCount: 0 }));
    }
  }, [selectedSourceId, setDialogState]);
  const sourceQuery = useGetSteelReviewSourceQuery(
    isOpen && selectedSource
      ? {
          conversationId: identity.conversationId,
          kind: identity.kind,
          messageId: identity.messageId,
          fileId: selectedSource.fileId,
        }
      : null,
    { enabled: isOpen && !!selectedSource },
  );
  const previewRows: SteelReviewPreviewRows = useMemo(
    () => getSteelReviewPreviewRows(
      draftRows,
      selectedSource?.fileId,
      pageNumber,
      new Set(sources.map((source) => source.fileId)),
      pageCount,
    ),
    [draftRows, pageCount, pageNumber, selectedSource?.fileId, sources],
  );
  const recoveryIndicators = useMemo(() => {
    const fileIds = new Set<string>();
    const pageKeys = new Set<string>();
    let hasUnlocated = false;
    if (!saveRecovery) {
      return { fileIds, pageKeys, hasUnlocated };
    }
    const rowsById = new Map(saveRecovery.table.rows.map((row) => [row.rowId, row]));
    const addSource = (source: { fileId: string | null; pageNumber: number | null } | null | undefined) => {
      if (!source?.fileId) {
        hasUnlocated = true;
        return;
      }
      fileIds.add(source.fileId);
      if (source.pageNumber !== null) {
        pageKeys.add(`${source.fileId}:${source.pageNumber}`);
      }
    };
    for (const conflict of saveRecovery.conflicts) {
      if (conflict.kind === 'source') {
        addSource(conflict.current);
        addSource(conflict.requested);
        continue;
      }
      addSource(rowsById.get(conflict.rowId)?.source);
    }
    return { fileIds, pageKeys, hasUnlocated };
  }, [saveRecovery]);
  const onCellChange = useCallback(
    (row: SteelReviewRow, header: string, value: string) => {
      if (!table || !canEdit || !row.rowId) {
        return;
      }
      setDraftStateScoped((current) => {
        const ownerDraft = current.ownerKey === draftStateKey
          ? current
          : createSteelReviewDraftState(draftStateKey);
        const baseRow = (baseTable?.rows ?? []).find((candidate) => candidate.rowId === row.rowId) ?? row;
        const next = setSteelReviewDraftCell(ownerDraft, baseRow, header, value);
        if (getCaptureScopedValue(pendingSnapshotRef, captureId)) {
          exportRowsRef.current = applySteelReviewDrafts(exportBaseRowsRef.current, next);
        }
        return next;
      });
    },
    [baseTable, canEdit, captureId, draftStateKey, setDraftStateScoped, table],
  );

  const clearRecovery = useCallback(() => {
    recoveryRef.current = undefined;
    setSaveRecovery(undefined);
  }, [setSaveRecovery]);

  const adoptConflictRecovery = useCallback((recovery: SteelReviewRecovery) => {
    if (!captureId) {
      return;
    }
    const recoveredTable = recovery.table;
    const tableKey = DynamicQueryKeys.steelReview(
      identity.conversationId,
      identity.kind,
      identity.messageId,
      identity.title,
    );
    queryClient.setQueryData<SteelReviewResponse>(tableKey, (current) =>
      current ? { ...current, table: recoveredTable } : { table: recoveredTable });
    latestTableRef.current = recoveredTable;
    persistCapturedAuthority({
      outputId: recoveredTable.outputId,
      revision: recoveredTable.revision,
      table: recoveredTable,
    });
    recoveryRef.current = { captureId, value: recovery };
    const rebased = rebaseSteelReviewDraftState(
      latestDraftStateRef.current,
      recoveredTable.rows,
      0,
      { preserveUnchangedRows: true },
    );
    latestDraftStateRef.current = rebased;
    setDraftStateScoped(rebased);
    exportBaseRowsRef.current = recoveredTable.rows;
    exportRowsRef.current = applySteelReviewDrafts(recoveredTable.rows, rebased);
    setSaveRecovery(recovery);
  }, [captureId, identity, persistCapturedAuthority, queryClient, setDraftStateScoped, setSaveRecovery]);

  const onCellHistoryBoundary = useCallback(() => {
    setDraftStateScoped((current) => finishSteelReviewDraftHistory(current));
  }, [setDraftStateScoped]);
  const onSourceEdit = useCallback((row: SteelReviewRow) => {
    if (!canEditSources || !row.rowId || (table?.kind === 'system_order' && row.system?.kind !== 'material')) {
      return;
    }
    setDialogState((state) => ({ ...state, sourceCorrectionRowId: row.rowId }));
  }, [canEditSources, setDialogState, table?.kind]);
  const onSourceChange = useCallback(
    (row: SteelReviewRow, source: SteelReviewSource | null) => {
      if (!table || !canEditSources || !row.rowId || (table.kind === 'system_order' && row.system?.kind !== 'material')) {
        return;
      }
      setDraftStateScoped((current) => {
        const ownerDraft = current.ownerKey === draftStateKey
          ? current
          : createSteelReviewDraftState(draftStateKey);
        const baseRow = (baseTable?.rows ?? []).find((candidate) => candidate.rowId === row.rowId) ?? row;
        const next = setSteelReviewDraftSource(ownerDraft, baseRow, source);
        if (getCaptureScopedValue(pendingSnapshotRef, captureId)) {
          exportRowsRef.current = applySteelReviewDrafts(exportBaseRowsRef.current, next);
        }
        return next;
      });
    },
    [baseTable, canEditSources, captureId, draftStateKey, setDraftStateScoped, table],
  );
  const applyLatestConflictValue = useCallback((conflict: SteelReviewConflict) => {
    const recovery = getCaptureScopedValue(recoveryRef, captureId);
    const row = recovery?.table.rows.find((candidate) => candidate.rowId === conflict.rowId);
    if (!row) {
      return;
    }
    if (conflict.kind === 'field') {
      onCellChange(row, conflict.header, conflict.current ?? '');
    } else if (conflict.kind === 'source') {
      const latest = conflict.current;
      const source = latest && latest.fileId
        ? {
            fileId: latest.fileId,
            pageNumber: latest.pageNumber,
            ...sources.find((candidate) => candidate.fileId === latest.fileId),
          }
        : null;
      onSourceChange(row, source);
    }
    setSaveRecovery((current) => {
      if (!current) return current;
      const remaining = current.conflicts.filter((candidate) => candidate !== conflict);
      return remaining.length > 0 ? { ...current, conflicts: remaining } : undefined;
    });
    if (saveRecovery?.conflicts.length === 1) {
      recoveryRef.current = undefined;
    }
  }, [captureId, onCellChange, onSourceChange, saveRecovery?.conflicts.length, setSaveRecovery, sources]);
  const updateDraftRows = useCallback((next: typeof draftState) => {
    if (getCaptureScopedValue(pendingSnapshotRef, captureId)) {
      exportRowsRef.current = applySteelReviewDrafts(exportBaseRowsRef.current, next);
    }
    return next;
  }, [captureId]);
  const onAddRow = useCallback(() => {
    const editTable = baseTable ?? table;
    if (!editTable || !canEditStructure) return;
    setDraftStateScoped((current) => {
      const ownerDraft = current.ownerKey === draftStateKey
        ? current
        : createSteelReviewDraftState(draftStateKey);
      const anchor = [...draftRows].reverse().find((row) => !row.deleted && (
        !selectedSource || (row.source?.fileId === selectedSource.fileId && row.source.pageNumber === pageNumber)
      ));
      const source = selectedSource
        ? {
            fileId: selectedSource.fileId,
            pageNumber,
            filename: selectedSource.filename,
            mediaType: selectedSource.mediaType,
          }
        : null;
      return updateDraftRows(addSteelReviewDraftRow(ownerDraft, editTable, anchor, source));
    });
  }, [baseTable, canEditStructure, draftRows, draftStateKey, pageNumber, selectedSource, setDraftStateScoped, table, updateDraftRows]);
  const onAddSystemRow = useCallback((kind: 'material' | 'processing', selectedParentId?: string, anchorRow?: SteelReviewRow) => {
    const editTable = baseTable ?? table;
    if (!editTable || !canEditStructure || editTable.kind !== 'system_order') return;
    const parent = kind === 'processing'
      ? draftRows.find((row) => !row.deleted && row.system?.kind === 'material' && row.rowId === selectedParentId)
      : undefined;
    if (kind === 'processing' && !parent) return;
    const system: SteelReviewSystemState = {
      kind,
      parentRowId: parent?.rowId ?? null,
      cascadeDeletedBy: null,
    };
    const source = kind === 'material' && selectedSource
      ? {
          fileId: selectedSource.fileId,
          pageNumber,
          filename: selectedSource.filename,
          mediaType: selectedSource.mediaType,
        }
      : null;
    setDraftStateScoped((current) => {
      const ownerDraft = current.ownerKey === draftStateKey
        ? current
        : createSteelReviewDraftState(draftStateKey);
      const anchor = kind === 'processing'
        ? parent
        : anchorRow ?? [...draftRows].reverse().find((row) => !row.deleted);
      return updateDraftRows(addSteelReviewDraftRow(ownerDraft, editTable, anchor, source, system));
    });
  }, [baseTable, canEditStructure, draftRows, draftStateKey, pageNumber, selectedSource, setDraftStateScoped, table, updateDraftRows]);
  const onAddProcessingUnder = useCallback((row: SteelReviewRow) => {
    onAddSystemRow('processing', row.rowId, row);
  }, [onAddSystemRow]);
  const onBindProcessing = useCallback((row: SteelReviewRow, parentRowId: string | null) => {
    if (!canEditStructure || table?.kind !== 'system_order' || row.system?.kind !== 'processing') return;
    setDraftStateScoped((current) => {
      const ownerDraft = current.ownerKey === draftStateKey
        ? current
        : createSteelReviewDraftState(draftStateKey);
      return updateDraftRows(setSteelReviewDraftSystem(ownerDraft, row, {
        kind: 'processing',
        parentRowId,
        cascadeDeletedBy: row.system?.cascadeDeletedBy ?? null,
      }));
    });
  }, [canEditStructure, draftStateKey, setDraftStateScoped, table?.kind, updateDraftRows]);
  const onClassify = useCallback((row: SteelReviewRow, kind: 'material' | 'processing') => {
    if (!canEditStructure || table?.kind !== 'system_order' || row.system?.kind !== 'unassigned') return;
    const parentRowId = kind === 'processing' ? dialogState.processingParentId ?? null : null;
    setDraftStateScoped((current) => {
      const ownerDraft = current.ownerKey === draftStateKey
        ? current
        : createSteelReviewDraftState(draftStateKey);
      return updateDraftRows(setSteelReviewDraftSystem(ownerDraft, row, {
        kind,
        parentRowId,
        cascadeDeletedBy: null,
      }));
    });
  }, [canEditStructure, dialogState.processingParentId, draftStateKey, setDraftStateScoped, table?.kind, updateDraftRows]);
  const onDeleteGroup = useCallback((row: SteelReviewRow) => {
    const editTable = baseTable ?? table;
    if (!editTable || !canEditStructure || editTable.kind !== 'system_order' || row.system?.kind !== 'material') return;
    setDraftStateScoped((current) => updateDraftRows(deleteSteelReviewDraftGroup(current, draftRows, row)));
  }, [baseTable, canEditStructure, draftRows, setDraftStateScoped, table, updateDraftRows]);
  const onDeleteRow = useCallback((row: SteelReviewRow) => {
    const editTable = baseTable ?? table;
    if (!editTable || !canEditStructure) return;
    setDraftStateScoped((current) => {
      const ownerDraft = current.ownerKey === draftStateKey
        ? current
        : createSteelReviewDraftState(draftStateKey);
      const isSaved = editTable.rows.some((candidate) => candidate.rowId === row.rowId);
      return updateDraftRows(deleteSteelReviewDraftRow(ownerDraft, row, isSaved));
    });
  }, [baseTable, canEditStructure, draftStateKey, setDraftStateScoped, table, updateDraftRows]);
  const onRestoreRow = useCallback((row: SteelReviewRow) => {
    if (!(baseTable ?? table) || !canEditStructure) return;
    setDraftStateScoped((current) => {
      const ownerDraft = current.ownerKey === draftStateKey
        ? current
        : createSteelReviewDraftState(draftStateKey);
      return updateDraftRows(row.system?.kind === 'material'
        ? restoreSteelReviewDraftGroup(ownerDraft, draftRows, row)
        : restoreSteelReviewDraftRow(ownerDraft, row));
    });
  }, [baseTable, canEditStructure, draftRows, draftStateKey, setDraftStateScoped, table, updateDraftRows]);
  const onUndo = useCallback(() => {
    setDraftStateScoped((current) => updateDraftRows(undoSteelReviewDraft(current)));
  }, [setDraftStateScoped, updateDraftRows]);
  const onRedo = useCallback(() => {
    setDraftStateScoped((current) => updateDraftRows(redoSteelReviewDraft(current)));
  }, [setDraftStateScoped, updateDraftRows]);
  const latestDraftStateRef = useRef(draftState);
  latestDraftStateRef.current = draftState;
  const latestTableRef = useRef(table);
  latestTableRef.current = table;
  const reviewQueryErrorRef = useRef(query.error);
  reviewQueryErrorRef.current = query.error;
  const reviewQueryRefetchRef = useRef(query.refetch);
  reviewQueryRefetchRef.current = query.refetch;
  const refetchCurrentReview = useCallback(async () => {
    if (typeof reviewQueryRefetchRef.current !== 'function') {
      return {
        data: undefined,
        error: reviewQueryErrorRef.current ?? new Error('Review authority refetch unavailable'),
      };
    }
    return reviewQueryRefetchRef.current();
  }, []);
  const refetchAuthoritativeMessages = useCallback(async () => {
    const queryKey = [QueryKeys.messages, identity.conversationId] as const;
    const messagesAtRequestStart = queryClient.getQueryData<TMessage[]>(queryKey);
    try {
      const messages = await queryClient.fetchQuery<TMessage[]>(
        queryKey,
        async () => {
          const fetched = await dataService.getMessagesByConvoId(identity.conversationId);
          const currentMessages = queryClient.getQueryData<TMessage[]>(queryKey);
          if (messagesAtRequestStart !== undefined && currentMessages !== messagesAtRequestStart) {
            return currentMessages ?? fetched;
          }
          return fetched;
        },
        { staleTime: 0 },
      );
      return { messages, authoritative: true };
    } catch {
      return { messages: queryClient.getQueryData<TMessage[]>(queryKey), authoritative: false };
    }
  }, [identity.conversationId, queryClient]);
  const savePromiseRef = useRef<CaptureScoped<Promise<boolean>>>();
  const applyConfirmedSnapshot = useCallback((
    snapshot: SteelReviewSavedSnapshot,
    submittedChangeSequence: number,
    applyMessageSnapshot = true,
    applyReviewSnapshot = true,
  ) => {
    const tableKey = DynamicQueryKeys.steelReview(
      identity.conversationId,
      identity.kind,
      identity.messageId,
      identity.title,
    );
    if (applyReviewSnapshot) {
      queryClient.setQueryData<SteelReviewResponse>(tableKey, (current) =>
        applySteelReviewSnapshotToResponse(current, snapshot));
    }
    if (applyMessageSnapshot) {
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, identity.conversationId],
        (current) => applySteelReviewSnapshotToMessages(current, identity.kind, snapshot),
      );
    }
    const capturedBase = getCapturedAuthority()?.table ?? table;
    if (capturedBase) {
      persistCapturedAuthority({
        outputId: snapshot.outputId,
        revision: snapshot.revision,
        table: {
          ...capturedBase,
          outputId: snapshot.outputId,
          latestOutputId: snapshot.outputId,
          revision: snapshot.revision,
          rows: snapshot.rows,
          isLatest: true,
          readOnly: false,
        },
      });
    }
    exportBaseRowsRef.current = snapshot.rows;
    exportRowsRef.current = snapshot.rows;
    if (captureId) {
      pendingSnapshotRef.current = {
        captureId,
        value: { outputId: snapshot.outputId, revision: snapshot.revision },
      };
    }
    setConfirmedSave({
      conversationId: snapshot.conversationId,
      messageId: snapshot.messageId,
      title: identity.title,
      kind: identity.kind,
      outputId: snapshot.outputId,
      revision: snapshot.revision,
      changedRows: snapshot.changedRows,
      ...(snapshot.caption?.customerQuoteChangedRows !== undefined
        ? { customerQuoteChangedRows: snapshot.caption.customerQuoteChangedRows }
        : {}),
      ...(snapshot.caption?.customerQuoteTotal !== undefined
        ? { customerQuoteTotal: snapshot.caption.customerQuoteTotal }
        : {}),
    });
    const currentDraft = latestDraftStateRef.current;
    const rebasedDraft = clearSteelReviewDraftHistory(
      rebaseSteelReviewDraftState(currentDraft, snapshot.rows, submittedChangeSequence),
    );
    latestDraftStateRef.current = rebasedDraft;
    setDraftStateScoped((current) => {
      const rebased = clearSteelReviewDraftHistory(
        rebaseSteelReviewDraftState(current, snapshot.rows, submittedChangeSequence),
      );
      exportRowsRef.current = applySteelReviewDrafts(snapshot.rows, rebased);
      return rebased;
    });
  }, [captureId, getCapturedAuthority, identity, persistCapturedAuthority, queryClient, setConfirmedSave, setDraftStateScoped, table]);
  const applyConfirmedNoOp = useCallback((
    currentTable: SteelReviewTable,
    submittedChangeSequence: number,
  ) => {
    persistCapturedAuthority({
      outputId: currentTable.outputId,
      revision: currentTable.revision,
      table: currentTable,
    });
    exportBaseRowsRef.current = currentTable.rows;
    const rebasedDraft = clearSteelReviewDraftHistory(rebaseSteelReviewDraftState(
      latestDraftStateRef.current,
      currentTable.rows,
      submittedChangeSequence,
    ));
    latestDraftStateRef.current = rebasedDraft;
    setDraftStateScoped((current) => {
      const rebased = clearSteelReviewDraftHistory(
        rebaseSteelReviewDraftState(current, currentTable.rows, submittedChangeSequence),
      );
      exportRowsRef.current = applySteelReviewDrafts(currentTable.rows, rebased);
      return rebased;
    });
  }, [persistCapturedAuthority, setDraftStateScoped]);
  const saveChanges = useCallback(async (): Promise<boolean> => {
    const initiatedCaptureId = captureId;
    if (!initiatedCaptureId) {
      return false;
    }
    const existingPromise = getCaptureScopedValue(savePromiseRef, initiatedCaptureId);
    if (existingPromise) {
      return existingPromise;
    }
    if (!table || !baseTable || !canSave) {
      return true;
    }
    if (savePhase === 'reconciling') {
      return false;
    }
    if (savePhase === 'uncertain' && dirtyRowCount === 0) {
      return false;
    }
    if (dirtyRowCount === 0) {
      return true;
    }

    const promise = (async () => {
      let commitAttempted = false;
      const preparedForCapture = getCaptureScopedValue(preparedRef, initiatedCaptureId);
      if (!preparedForCapture) {
        submittedChangeSequenceRef.current = draftState.changeSequence;
      }
      setSaveErrorCode(undefined);
      setSavePhase(preparedForCapture ? 'committing' : 'preparing');
      try {
        const prepared = preparedForCapture ?? await prepareMutation.mutateAsync((() => {
          const request = getSteelReviewPrepareInput(identity, baseTable, draftState, draftRows);
          const recovery = getCaptureScopedValue(recoveryRef, initiatedCaptureId);
          return recovery && recovery.table.outputId === request.outputId
            ? { ...request, revision: recovery.table.revision }
            : request;
        })());
        if (!isCurrentCapture(initiatedCaptureId, prepared.outputId)) {
          return false;
        }
        preparedRef.current = { captureId: initiatedCaptureId, value: prepared };
        setSavePhase('committing');
        commitAttempted = true;
        const saved = await commitMutation.mutateAsync(getSteelReviewCommitInput(prepared));
        if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
          return false;
        }
        if (saved.changedRows > 0 && !saved.savedSnapshot) {
          setSavePhase('uncertain');
          return false;
        }
        if (saved.changedRows === 0 && !saved.savedSnapshot) {
          const currentResult = await refetchCurrentReview();
          if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
            return false;
          }
          if (currentResult.error || !currentResult.data?.table) {
            setSavePhase('uncertain');
            setSaveErrorCode(undefined);
            return false;
          }
          // Refresh the rendered conversation before any owner/revision guard
          // can return early. A held response may finish after a foreign save
          // or a new AI publication, and the immutable receipt must never be
          // allowed to leave the chat on its older message text.
          const refreshedMessages = await refetchAuthoritativeMessages();
          if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
            return false;
          }
          if (!refreshedMessages.authoritative) {
            setSavePhase('uncertain');
            return false;
          }
          if (!isAuthorizedCurrentNoOpTable(currentResult.data.table, prepared)) {
            const capturedBase = getCapturedAuthority(initiatedCaptureId)?.table;
            if (!sameSteelReviewScope(currentResult.data.table, prepared) ||
              !capturedBase || !isCapturedAuthorityForPrepared(getCapturedAuthority(initiatedCaptureId), prepared)) {
              preparedRef.current = undefined;
              setSavePhase('stale');
              setSaveErrorCode('REVIEW_CONFLICT');
              return false;
            }
            // The committed no-op belongs to the captured session even when a
            // newer AI output was published before the response arrived. Clear
            // that session's history without adopting the newer live table.
            applyConfirmedNoOp(capturedBase, submittedChangeSequenceRef.current);
          } else {
            applyConfirmedNoOp(currentResult.data.table, submittedChangeSequenceRef.current);
          }
        }
        if (saved.savedSnapshot) {
          const currentResult = await refetchCurrentReview();
          if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
            return false;
          }
          if (currentResult.error || !currentResult.data?.table) {
            setSavePhase('uncertain');
            setSaveErrorCode(undefined);
            return false;
          }
          const refreshedMessages = await refetchAuthoritativeMessages();
          if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
            return false;
          }
          if (!refreshedMessages.authoritative) {
            setSavePhase('uncertain');
            return false;
          }
          const currentTableIsAuthorized = isAuthorizedCurrentTable(currentResult.data.table, prepared);
          if (!sameSteelReviewScope(currentResult.data.table, prepared)) {
            preparedRef.current = undefined;
            setSavePhase('stale');
            setSaveErrorCode('REVIEW_CONFLICT');
            return false;
          }
          if (!currentTableIsAuthorized) {
            // The receipt is authoritative for the operation that was already
            // committed. Rebase the old captured session, while leaving the
            // newer live review/message projection untouched and read-only.
            applyConfirmedSnapshot(
              saved.savedSnapshot,
              submittedChangeSequenceRef.current,
              false,
              false,
            );
          } else if (currentResult.data.table.revision === saved.savedSnapshot.revision) {
            const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, identity.conversationId]);
            const canApplyMessageSnapshot = await canApplySteelReviewMessageSnapshot(messages, prepared, saved.savedSnapshot);
            if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
              return false;
            }
            applyConfirmedSnapshot(saved.savedSnapshot, submittedChangeSequenceRef.current, canApplyMessageSnapshot);
          } else {
            applyConfirmedNoOp(currentResult.data.table, submittedChangeSequenceRef.current);
          }
        }
        if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
          return false;
        }
        preparedRef.current = undefined;
        clearRecovery();
        setSavePhase('idle');
        setSaveErrorCode(undefined);
        return true;
      } catch (error) {
        if (!isCurrentCapture(initiatedCaptureId, preparedForCapture?.outputId)) {
          return false;
        }
        const code = getErrorCode(error);
        const recovery = getErrorRecovery(error);
        if (code === 'REVIEW_CONFLICT' || code === 'REVIEW_INVALID_OPERATION' || code === 'REVIEW_NOT_FOUND') {
          preparedRef.current = undefined;
          setSavePhase('stale');
          setSaveErrorCode(code);
          if (recovery) {
            adoptConflictRecovery(recovery);
          }
          void refetchCurrentReview();
        } else if (commitAttempted) {
          setSavePhase('uncertain');
          setSaveErrorCode(undefined);
        } else {
          setSavePhase('error');
          setSaveErrorCode(code);
        }
        return false;
      }
    })();
    savePromiseRef.current = { captureId: initiatedCaptureId, value: promise };
    try {
      return await promise;
    } finally {
      if (savePromiseRef.current?.captureId === initiatedCaptureId && savePromiseRef.current.value === promise) {
        savePromiseRef.current = undefined;
      }
    }
  }, [adoptConflictRecovery, applyConfirmedNoOp, applyConfirmedSnapshot, baseTable, canSave, captureId, clearRecovery, commitMutation, dirtyRowCount, draftRows, draftState, getCapturedAuthority, hasActiveCapturedSession, identity, isCurrentCapture, prepareMutation, queryClient, refetchAuthoritativeMessages, refetchCurrentReview, savePhase, setSaveErrorCode, setSavePhase, table]);
  const getCurrentReviewTable = useCallback(() => {
    const tableKey = DynamicQueryKeys.steelReview(
      identity.conversationId,
      identity.kind,
      identity.messageId,
      identity.title,
    );
    return queryClient.getQueryData<SteelReviewResponse>(tableKey)?.table ?? latestTableRef.current;
  }, [identity, queryClient]);
  const getExportMatrix = useCallback(
    () => {
      const currentTable = getCurrentReviewTable();
      return currentTable ? rowsToMatrix(currentTable, exportRowsRef.current) : [];
    },
    [getCurrentReviewTable],
  );
  const ensureSaved = useCallback(async (authority?: SteelReviewDownloadAuthority) => {
    const initiatedCaptureId = captureId;
    const initialTable = getCurrentReviewTable();
    if (authority && (!initialTable || initialTable.outputId !== authority.outputId || initialTable.revision !== authority.revision)) {
      return false;
    }
    const expectedAuthority = getCapturedAuthority(initiatedCaptureId);
    if (expectedAuthority && (!initialTable ||
      initialTable.outputId !== expectedAuthority.outputId)) {
      return false;
    }
    if (!canSave && dirtyRowCount > 0) {
      return false;
    }
    if (savePhase === 'uncertain' || savePhase === 'reconciling') {
      return false;
    }
    const saved = await saveChanges();
    if (!saved || (expectedAuthority && !hasCurrentCapturedSession(expectedAuthority, initiatedCaptureId))) {
      return false;
    }
    const latestDraft = latestDraftStateRef.current;
    const currentTable = getCurrentReviewTable();
    const confirmedAuthority = getCapturedAuthority(initiatedCaptureId);
    if (!currentTable || (authority && currentTable.outputId !== authority.outputId) ||
      (expectedAuthority && currentTable.outputId !== expectedAuthority.outputId)) {
      return false;
    }
    const confirmedTable = confirmedAuthority?.table ?? currentTable;
    return getSteelReviewDirtyRowIds(confirmedTable, latestDraft).length === 0;
  }, [canSave, captureId, dirtyRowCount, getCapturedAuthority, getCurrentReviewTable, hasCurrentCapturedSession, saveChanges, savePhase]);
  useEffect(() => {
    if (!saveGateRef) {
      return undefined;
    }
    saveGateRef.current = { isOpen, ensureSaved, getMatrix: getExportMatrix };
    return () => {
      saveGateRef.current = undefined;
    };
  }, [ensureSaved, getExportMatrix, isOpen, saveGateRef]);
  const clearDraftAndClose = useCallback(() => {
    setDraftStateScoped(createSteelReviewDraftState(draftStateKey));
    latestDraftStateRef.current = createSteelReviewDraftState(draftStateKey);
    preparedRef.current = undefined;
    discardBoundaryRef.current = undefined;
    setSavePhase('idle');
    setSaveErrorCode(undefined);
    clearRecovery();
    setReceiptFailed(false);
    setReceiptInput(null);
    setDiscardRequested(false);
    setCloseRequested(false);
    clearCapturedAuthority();
    clearSelectionForCapture(captureId, capturedAuthority?.outputId);
  }, [captureId, capturedAuthority?.outputId, clearCapturedAuthority, clearRecovery, clearSelectionForCapture, draftStateKey, setCloseRequested, setDiscardRequested, setDraftStateScoped, setReceiptFailed, setReceiptInput, setSaveErrorCode, setSavePhase]);
  const finishDiscardAtBoundary = useCallback((rows: readonly SteelReviewRow[]) => {
    const boundary = discardBoundaryRef.current ?? latestDraftStateRef.current.changeSequence;
    const rebased = rebaseSteelReviewDraftState(latestDraftStateRef.current, rows, boundary);
    latestDraftStateRef.current = rebased;
    setDraftStateScoped(rebased);
    preparedRef.current = undefined;
    discardBoundaryRef.current = undefined;
    setReceiptFailed(false);
    setReceiptInput(null);
    setDiscardRequested(false);
    setSaveErrorCode(undefined);
    setSavePhase('idle');
    const remainingDirtyRows = getSteelReviewDirtyRowIds({ rows }, rebased);
    if (remainingDirtyRows.length === 0) {
      setCloseRequested(false);
      clearCapturedAuthority();
      clearSelectionForCapture(captureId, getCapturedAuthority(captureId)?.outputId);
      return;
    }
    setCloseRequested(false);
  }, [captureId, clearCapturedAuthority, clearSelectionForCapture, getCapturedAuthority, setCloseRequested, setDiscardRequested, setDraftStateScoped, setReceiptFailed, setReceiptInput, setSaveErrorCode, setSavePhase]);
  const requestReceiptBeforeDiscard = useCallback(() => {
    const prepared = getCaptureScopedValue(preparedRef, captureId);
    if (!prepared) {
      clearDraftAndClose();
      return;
    }
    discardBoundaryRef.current = latestDraftStateRef.current.changeSequence;
    setReceiptFailed(false);
    setSavePhase('reconciling');
    if (!captureId) {
      return;
    }
    setReceiptInput({
      captureId,
      value: {
        conversationId: prepared.conversationId,
        kind: prepared.kind,
        messageId: prepared.messageId,
        outputId: prepared.outputId,
        operationId: prepared.operationId,
        digest: prepared.digest,
        title: prepared.title,
      },
    });
    setDiscardRequested(true);
  }, [captureId, clearDraftAndClose, setDiscardRequested, setReceiptFailed, setReceiptInput, setSavePhase]);
  const discardDraftAndClose = useCallback(() => {
    if (savePhase === 'uncertain' || savePhase === 'reconciling') {
      requestReceiptBeforeDiscard();
      return;
    }
    clearDraftAndClose();
  }, [clearDraftAndClose, requestReceiptBeforeDiscard, savePhase]);
  const retryReceiptLookup = useCallback(() => {
    if (!receiptInput || receiptInput.captureId !== captureId) {
      return;
    }
    setReceiptFailed(false);
    setSaveErrorCode(undefined);
    setSavePhase('reconciling');
    setDiscardRequested(true);
  }, [captureId, receiptInput, setDiscardRequested, setReceiptFailed, setSaveErrorCode, setSavePhase]);
  const requestClose = useCallback(() => {
    if (dirtyRowCount > 0 || savePhase === 'preparing' || savePhase === 'committing' ||
      savePhase === 'uncertain' || savePhase === 'reconciling') {
      setCloseRequested(true);
      return;
    }
    clearCapturedAuthority();
    clearSelectionForCapture(captureId, getCapturedAuthority(captureId)?.outputId);
  }, [captureId, clearCapturedAuthority, clearSelectionForCapture, dirtyRowCount, getCapturedAuthority, savePhase, setCloseRequested]);
  useEffect(() => {
    if (!discardRequested || !receiptInput) {
      return undefined;
    }
    const initiatedCaptureId = receiptInput.captureId;
    const receiptEffectKey = getReceiptEffectKey(receiptInput);
    // React Query may publish the newer owner while this receipt is awaiting
    // its current-review/messages reads. Keep one reconciliation alive for
    // that captured operation; callback identity changes must not cancel the
    // old operation before it can acknowledge and close its own session.
    if (receiptEffectKeyRef.current === receiptEffectKey) {
      return undefined;
    }
    receiptEffectKeyRef.current = receiptEffectKey;
    let active = true;
    const isReceiptRunActive = () => active && latestReceiptEffectKeyRef.current === receiptEffectKey;
    void refetchReceipt().then(async (result) => {
      if (!isReceiptRunActive() || !isCurrentCapture(initiatedCaptureId)) {
        return;
      }
      if (result.error || !result.data) {
        setDiscardRequested(false);
        setSavePhase('reconciling');
        setSaveErrorCode(getErrorCode(result.error));
        setReceiptFailed(true);
        return;
      }
      const status: SteelReviewReceiptStatus = result.data;
      const currentResult = await refetchCurrentReview();
      if (!isReceiptRunActive() || !isCurrentCapture(initiatedCaptureId)) {
        return;
      }
      if (currentResult.error || !currentResult.data?.table) {
        setDiscardRequested(false);
        setSavePhase('reconciling');
        setSaveErrorCode(undefined);
        setReceiptFailed(true);
        return;
      }
      if (status.status === 'committed') {
        const prepared = getCaptureScopedValue(preparedRef, initiatedCaptureId);
        if (!prepared) {
          preparedRef.current = undefined;
          setDiscardRequested(false);
          setSavePhase('stale');
          setSaveErrorCode('REVIEW_CONFLICT');
          setReceiptInput(null);
          setReceiptFailed(false);
          return;
        }
        if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
          return;
        }
        const currentTableIsAuthorized = isAuthorizedCurrentTable(currentResult.data.table, prepared);
        const currentTableMatchesScope = sameSteelReviewScope(currentResult.data.table, prepared);
        const capturedAuthorityMatches = isCapturedAuthorityForPrepared(
          getCapturedAuthority(initiatedCaptureId),
          prepared,
        );
        if (!currentTableMatchesScope || (!currentTableIsAuthorized && !capturedAuthorityMatches)) {
          preparedRef.current = undefined;
          setDiscardRequested(false);
          setSavePhase('stale');
          setSaveErrorCode('REVIEW_CONFLICT');
          setReceiptInput(null);
          setReceiptFailed(false);
          return;
        }
        const refreshedMessages = await refetchAuthoritativeMessages();
        if (!isReceiptRunActive() || !hasActiveCapturedSession(prepared, initiatedCaptureId)) {
          return;
        }
        if (!refreshedMessages.authoritative) {
          setDiscardRequested(false);
          setSavePhase('reconciling');
          setReceiptFailed(true);
          return;
        }
        if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
          return;
        }
        const boundary = discardBoundaryRef.current ?? submittedChangeSequenceRef.current;
        if (!currentTableIsAuthorized) {
          // The receipt confirms the captured operation even if the live owner
          // changed while the request was in flight. Rebase only that old
          // session and leave the authoritative new-AI query/message intact.
          applyConfirmedSnapshot(status.snapshot, boundary, false, false);
        } else if (currentResult.data.table.revision === status.snapshot.revision) {
          const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, identity.conversationId]);
          const canApplyMessageSnapshot = await canApplySteelReviewMessageSnapshot(messages, prepared, status.snapshot);
          if (!isReceiptRunActive() || !hasActiveCapturedSession(prepared, initiatedCaptureId)) {
            return;
          }
          applyConfirmedSnapshot(status.snapshot, boundary, canApplyMessageSnapshot);
        } else {
          applyConfirmedNoOp(currentResult.data.table, boundary);
        }
        if (!isReceiptRunActive() || !hasActiveCapturedSession(prepared, initiatedCaptureId)) {
          return;
        }
        // A same-capture remount may have accepted later local input while
        // this receipt was awaiting the authoritative reads. Read the live
        // Jotai atom before rebasing so the old continuation cannot restore
        // its stale draft snapshot over that input.
        const currentDraft = store.get(draftStateAtom);
        const rebased = rebaseSteelReviewDraftState(
          currentDraft,
          status.snapshot.rows,
          boundary,
        );
        latestDraftStateRef.current = rebased;
        setDraftStateScoped(rebased);
        preparedRef.current = undefined;
        discardBoundaryRef.current = undefined;
        setReceiptInput(null);
        setReceiptFailed(false);
        setDiscardRequested(false);
        setSaveErrorCode(undefined);
        setSavePhase('idle');
        if (getSteelReviewDirtyRowIds({ rows: status.snapshot.rows }, rebased).length === 0) {
          setCloseRequested(false);
          clearCapturedAuthority();
          clearSelectionForCapture(initiatedCaptureId, prepared.outputId);
        } else {
          setCloseRequested(false);
        }
        return;
      }
      finishDiscardAtBoundary(currentResult.data.table.rows);
    }).catch(() => {
      if (isReceiptRunActive() && isCurrentCapture(initiatedCaptureId)) {
        setDiscardRequested(false);
        setSavePhase('reconciling');
        setSaveErrorCode(undefined);
        setReceiptFailed(true);
      }
    }).finally(() => {
      if (receiptEffectKeyRef.current === receiptEffectKey) {
        receiptEffectKeyRef.current = undefined;
      }
    });
    return () => {
      if (receiptEffectKeyRef.current !== receiptEffectKey) {
        active = false;
      }
    };
  }, [applyConfirmedNoOp, applyConfirmedSnapshot, clearCapturedAuthority, clearSelectionForCapture, discardRequested, draftStateAtom, finishDiscardAtBoundary, getCapturedAuthority, hasActiveCapturedSession, identity.conversationId, isCurrentCapture, queryClient, receiptInput, refetchAuthoritativeMessages, refetchCurrentReview, refetchReceipt, setCloseRequested, setDiscardRequested, setDraftStateScoped, setReceiptFailed, setReceiptInput, setSaveErrorCode, setSavePhase, store]);
  const saveAndClose = useCallback(async () => {
    const initiatedCaptureId = captureId;
    const expectedAuthority = getCapturedAuthority(initiatedCaptureId);
    const saved = await saveChanges();
    if (!saved || !table || !initiatedCaptureId ||
      (expectedAuthority && !hasCurrentCapturedSession(expectedAuthority, initiatedCaptureId))) {
      return;
    }
    const latestDraft = latestDraftStateRef.current;
    const confirmedTable = getCapturedAuthority(initiatedCaptureId)?.table ?? table;
    if (getSteelReviewDirtyRowIds(confirmedTable, latestDraft).length === 0) {
      setCloseRequested(false);
      clearCapturedAuthority();
      clearSelectionForCapture(initiatedCaptureId, expectedAuthority?.outputId);
    }
  }, [captureId, clearCapturedAuthority, clearSelectionForCapture, getCapturedAuthority, hasCurrentCapturedSession, saveChanges, setCloseRequested, table]);
  const downloadCsv = useCallback(async () => {
    const initiatedCaptureId = captureId;
    const expectedAuthority = getCapturedAuthority(initiatedCaptureId);
    if (!(await ensureSaved())) {
      return;
    }
    if (!initiatedCaptureId || (expectedAuthority && !hasCurrentCapturedSession(expectedAuthority, initiatedCaptureId))) {
      return;
    }
    const matrix = getExportMatrix();
    if (matrix.length === 0) {
      return;
    }
    triggerDownload(
      URL.createObjectURL(createCsvBlob(matrix)),
      downloadFilename,
    );
  }, [captureId, downloadFilename, ensureSaved, getCapturedAuthority, getExportMatrix, hasCurrentCapturedSession]);
  const saveBusy = savePhase === 'preparing' || savePhase === 'committing' || savePhase === 'reconciling';
  const saveDisabled = !canSave || dirtyRowCount === 0 || saveBusy;
  const saveErrorKey = getSaveErrorKey(savePhase, saveErrorCode);
  const preparedForCapture = getCaptureScopedValue(preparedRef, captureId);
  const preparedRowCount = saveBusy && preparedForCapture && table &&
    isCurrentOwner(table, preparedForCapture)
    ? preparedForCapture.caption.changedRows
    : undefined;
  const confirmedRowCount = confirmedSave && isCurrentOwner(table, confirmedSave)
    ? confirmedSave.changedRows
    : getCurrentLastSaveCount(table);
  const isSystemOrder = table?.kind === 'system_order';
  const preparedQuoteRowCount = preparedForCapture?.caption.customerQuoteChangedRows;
  const lastSaveCaption = getCurrentLastSaveCaption(table);
  const confirmedQuoteRowCount = confirmedSave && isCurrentOwner(table, confirmedSave)
    ? confirmedSave.customerQuoteChangedRows
    : lastSaveCaption?.customerQuoteChangedRows;
  const quoteTotal = preparedForCapture?.caption.customerQuoteTotal ?? confirmedSave?.customerQuoteTotal ??
    lastSaveCaption?.customerQuoteTotal ?? null;
  const onPageCount = useCallback((count: number) => {
    setDialogState((state) => ({
      ...state,
      pageCount: count,
      pageNumber: count > 0 ? Math.min(state.pageNumber, count) : state.pageNumber,
    }));
  }, [setDialogState]);
  const goPrevious = useCallback(() => {
    setDialogState((state) => ({ ...state, pageNumber: Math.max(1, state.pageNumber - 1) }));
  }, [setDialogState]);
  const goNext = useCallback(() => {
    setDialogState((state) => ({
      ...state,
      pageNumber: Math.min(state.pageCount || state.pageNumber + 1, state.pageNumber + 1),
    }));
  }, [setDialogState]);

  return (
    <OGDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && isOpen) requestClose();
      }}
    >
      <OGDialogContent
        aria-label={localize('com_ui_steel_review_title')}
        className={fullScreen
          ? 'fixed inset-0 left-0 top-0 flex h-screen w-screen max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-4 overflow-hidden rounded-none p-6'
          : 'flex max-h-[95vh] w-[min(96vw,96rem)] max-w-none flex-col gap-4 overflow-hidden p-6'}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
            return;
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goPrevious();
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            goNext();
          }
        }}
      >
        <OGDialogHeader className="shrink-0 pr-10">
          <OGDialogTitle className="text-left text-xl font-semibold">
            {localize('com_ui_steel_review_title')}
          </OGDialogTitle>
          <OGDialogDescription className="text-left">
            {localize(canEdit ? 'com_ui_steel_review_editable' : 'com_ui_steel_review_readonly')}
          </OGDialogDescription>
        </OGDialogHeader>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            aria-label={localize(fullScreen ? 'com_ui_steel_review_exit_fullscreen' : 'com_ui_steel_review_fullscreen')}
            onClick={() => setDialogState((state) => ({ ...state, fullScreen: !state.fullScreen }))}
          >
            {fullScreen ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto" aria-live="polite">
          {query.isLoading && <p>{localize('com_ui_steel_review_loading')}</p>}
          {!query.isLoading && (isNotFound || (!query.isError && (!table || table.rows.length === 0))) && (
            <p>{localize('com_ui_steel_review_empty')}</p>
          )}
          {!query.isLoading && query.isError && !isNotFound && (
            <div className="space-y-3" role="alert">
              <p>{localize('com_ui_steel_review_error')}</p>
              <Button type="button" variant="outline" onClick={() => void query.refetch()}>
                {localize('com_ui_retry')}
              </Button>
            </div>
          )}
          {!query.isLoading && !query.isError && table && (
            <div className="space-y-4">
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2" aria-label={localize('com_ui_steel_review_row_actions')}>
                  {canEditStructure && (
                    table.kind === 'system_order' ? (
                      <>
                        <Button type="button" variant="outline" onClick={() => onAddSystemRow('material')} disabled={saveBusy}>
                          {localize('com_ui_steel_review_add_material')}
                        </Button>
                        <Select
                          value={dialogState.processingParentId ?? ''}
                          onValueChange={(value) => setDialogState((state) => ({ ...state, processingParentId: value || undefined }))}
                        >
                          <SelectTrigger aria-label={localize('com_ui_steel_review_parent')} className="w-48">
                            <SelectValue placeholder={localize('com_ui_steel_review_parent')} />
                          </SelectTrigger>
                          <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
                            {draftRows.filter((row) => !row.deleted && row.system?.kind === 'material').map((row) => {
                              const name = Object.values(row.values).find((cell) => (cell.effective ?? '').trim())?.effective ?? row.rowId;
                              return <SelectItem key={row.rowId} value={row.rowId}>{name}</SelectItem>;
                            })}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onAddSystemRow('processing', dialogState.processingParentId)}
                          disabled={saveBusy || !dialogState.processingParentId}
                        >
                          {localize('com_ui_steel_review_add_processing')}
                        </Button>
                      </>
                    ) : (
                      <Button type="button" variant="outline" onClick={onAddRow} disabled={saveBusy}>
                        {localize('com_ui_steel_review_add_row')}
                      </Button>
                    )
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onUndo}
                    disabled={saveBusy || !canUndoSteelReviewDraft(draftState)}
                  >
                    {localize('com_ui_steel_review_undo')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onRedo}
                    disabled={saveBusy || !canRedoSteelReviewDraft(draftState)}
                  >
                    {localize('com_ui_steel_review_redo')}
                  </Button>
                </div>
              )}
              {(table.kind === 'ocr_result' || table.kind === 'system_order') && sourcesQuery.isLoading && (
                <p aria-live="polite" role="status">
                  {localize('com_ui_steel_review_sources_loading')}
                </p>
              )}
              {(table.kind === 'ocr_result' || table.kind === 'system_order') && sourcesQuery.isError && (
                <div className="space-y-2" role="alert">
                  <p>{localize('com_ui_steel_review_sources_error')}</p>
                  <Button type="button" variant="outline" onClick={() => void sourcesQuery.refetch()}>
                    {localize('com_ui_retry')}
                  </Button>
                </div>
              )}
              {saveRecovery && (
                <div
                  className="space-y-2 rounded-md border border-status-error-border bg-status-error-subtle p-3 text-text-destructive"
                  role="region"
                  aria-live="polite"
                  aria-label={localize('com_ui_steel_review_conflicts')}
                >
                  <p className="font-medium">{localize('com_ui_steel_review_conflicts')}</p>
                  <div className="space-y-2 text-sm">
                    {saveRecovery.conflicts.map((conflict) => {
                      const conflictRowIndex = saveRecovery.table.rows.findIndex((row) => row.rowId === conflict.rowId);
                      const conflictRowLabel = localize('com_ui_steel_review_conflict_row_context', {
                        0: conflictRowIndex >= 0 ? conflictRowIndex + 1 : '?',
                      });
                      let conflictLabel = localize('com_ui_steel_review_conflict_insertion');
                      let conflictValues = '';
                      if (conflict.kind === 'field') {
                        conflictLabel = `${localize('com_ui_steel_review_conflict_field')}: ${conflict.header}`;
                        conflictValues = localize('com_ui_steel_review_conflict_values', {
                          0: conflictRowLabel,
                          1: conflict.expected ?? '∅',
                          2: conflict.current ?? '∅',
                          3: conflict.requested ?? '∅',
                        });
                      } else if (conflict.kind === 'source') {
                        conflictLabel = localize('com_ui_steel_review_conflict_source');
                        const formatSource = (source: { fileId: string | null; pageNumber: number | null } | null) =>
                          source
                            ? `${sources.find((candidate) => candidate.fileId === source.fileId)?.filename ?? localize('com_ui_steel_review_unlocated')}/${source.pageNumber ?? '∅'}`
                            : '∅';
                        conflictValues = localize('com_ui_steel_review_conflict_values', {
                          0: conflictRowLabel,
                          1: formatSource(conflict.expected),
                          2: formatSource(conflict.current),
                          3: formatSource(conflict.requested),
                        });
                      } else if (conflict.kind === 'activity') {
                        conflictLabel = localize('com_ui_steel_review_conflict_activity');
                        conflictValues = localize('com_ui_steel_review_conflict_row', {
                          0: conflictRowLabel,
                          1: conflict.reason,
                        });
                      } else if (conflict.kind === 'insertion') {
                        conflictValues = localize('com_ui_steel_review_conflict_row', {
                          0: conflictRowLabel,
                          1: conflict.reason,
                        });
                      } else {
                        conflictLabel = localize('com_ui_steel_review_conflict_binding');
                        conflictValues = localize('com_ui_steel_review_conflict_values', {
                          0: conflictRowLabel,
                          1: conflict.expected ?? '∅',
                          2: conflict.current ?? '∅',
                          3: conflict.requested ?? '∅',
                        });
                      }
                      const actionable = conflict.kind === 'field' || conflict.kind === 'source';
                      return (
                        <div key={`${conflict.kind}:${conflict.rowId}:${conflictLabel}`} className="flex flex-wrap items-center gap-2">
                          <span>{conflictLabel} · {conflictValues}</span>
                          {actionable && (
                            <Button
                              type="button"
                              variant="outline"
                              aria-label={`${localize('com_ui_steel_review_use_latest_value')} · ${conflictRowLabel} · ${conflictLabel}`}
                              onClick={() => applyLatestConflictValue(conflict)}
                            >
                              {localize('com_ui_steel_review_use_latest_value')}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {recoveryIndicators.hasUnlocated && (
                    <span className="text-text-destructive" role="img" aria-label={localize('com_ui_steel_review_conflicts_unlocated')}>
                      <AlertTriangle className="size-4" aria-hidden="true" />
                    </span>
                  )}
                </div>
              )}
              {(table.kind === 'ocr_result' || table.kind === 'system_order') && sources.length > 0 && (
                <div className="grid gap-3 rounded-md border border-border-light p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="flex min-w-0 flex-col gap-1 text-sm text-text-secondary">
                    <span>{localize('com_ui_steel_review_source')}</span>
                    <Select
                      value={selectedSource?.fileId ?? ''}
                      onValueChange={(value) => setDialogState((state) => ({
                        ...state,
                        selectedFileId: value || undefined,
                        pageNumber: 1,
                        initializedSourceId: undefined,
                      }))}
                    >
                      <SelectTrigger
                        aria-label={localize('com_ui_steel_review_source')}
                        className="w-full"
                      >
                        <SelectValue placeholder={localize('com_ui_steel_review_source')} />
                      </SelectTrigger>
                      <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
                        {sources.map((source) => (
                          <SelectItem key={source.fileId} value={source.fileId}>
                            <span className="inline-flex items-center gap-2">
                              {source.filename}
                              {recoveryIndicators.fileIds.has(source.fileId) && (
                                <span className="text-text-destructive" role="img" aria-label={localize('com_ui_steel_review_conflicts_on_file')}>
                                  <AlertTriangle className="size-4" aria-hidden="true" />
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <div className="flex items-end gap-2">
                    <Button type="button" variant="outline" aria-label={localize('com_ui_steel_review_previous_page')} onClick={goPrevious} disabled={pageNumber <= 1}>
                      ‹
                    </Button>
                    <label className="flex flex-col gap-1 text-sm text-text-secondary">
                      <span>{localize('com_ui_steel_review_page')}</span>
                      <Select
                        value={String(pageNumber)}
                        onValueChange={(value) => setDialogState((state) => ({ ...state, pageNumber: Number(value) }))}
                      >
                        <SelectTrigger
                          aria-label={localize('com_ui_steel_review_page')}
                          className="w-20"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
                          {Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1).map((page) => (
                            <SelectItem key={page} value={String(page)}>
                              <span className="inline-flex items-center gap-2">
                                {page}
                                {recoveryIndicators.pageKeys.has(`${selectedSource.fileId}:${page}`) && (
                                  <span className="text-text-destructive" role="img" aria-label={localize('com_ui_steel_review_conflicts_on_page')}>
                                    <AlertTriangle className="size-4" aria-hidden="true" />
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <Button type="button" variant="outline" aria-label={localize('com_ui_steel_review_next_page')} onClick={goNext} disabled={pageCount > 0 && pageNumber >= pageCount}>
                      ›
                    </Button>
                  </div>
                </div>
              )}
              {selectedSource && (
                <SteelReviewSourcePreview
                    stateKey={`${steelReviewSourcePreviewKey(identity, selectedSource.fileId)}:${captureId ?? 'pending'}`}
                  source={selectedSource}
                  pageNumber={pageNumber}
                  blob={sourceQuery.data}
                  loading={sourceQuery.isLoading}
                  error={sourceQuery.isError}
                  onRetry={() => void sourceQuery.refetch()}
                  onPageCount={onPageCount}
                  labels={{
                    zoomIn: localize('com_ui_steel_review_zoom_in'),
                    zoomOut: localize('com_ui_steel_review_zoom_out'),
                    loading: localize('com_ui_steel_review_preview_loading'),
                    retry: localize('com_ui_retry'),
                    unavailable: localize('com_ui_steel_review_preview_unavailable'),
                    canvas: localize('com_ui_steel_review_preview_canvas'),
                  }}
                />
              )}
              {selectedSource ? (
                <>
                  <SteelReviewEditor
                    table={table}
                    rows={previewRows.located}
                    draft={draftState}
                    sources={sources}
                    sourceCorrectionRowId={dialogState.sourceCorrectionRowId}
                    sourcePageCount={sourcePageCountQuery.data?.pageCount}
                    sourcePageCountLoading={sourcePageCountQuery.isLoading}
                    labels={{
                      table: localize('com_ui_steel_review_table_label'),
                      readonly: localize('com_ui_steel_review_cell_readonly'),
                      ...sourceEditorLabels,
                      bindProcessing: localize('com_ui_steel_review_bind_processing'),
                      parent: localize('com_ui_steel_review_parent'),
                      deleteGroup: localize('com_ui_steel_review_delete_group'),
                      addProcessingUnder: localize('com_ui_steel_review_add_processing_under'),
                      classify: localize('com_ui_steel_review_classify'),
                      material: localize('com_ui_steel_review_material'),
                      processing: localize('com_ui_steel_review_processing'),
                    }}
                    onCellChange={onCellChange}
                    onCellHistoryBoundary={onCellHistoryBoundary}
                    canEdit={canEdit}
                    sourcePageCountError={sourcePageCountQuery.isError}
                    onSourcePageRetry={() => void sourcePageCountQuery.refetch()}
                    onSourceEdit={canEditSources ? onSourceEdit : undefined}
                    onSourceChange={canEditSources ? onSourceChange : undefined}
                    onDeleteRow={canEditStructure ? onDeleteRow : undefined}
                    onRestoreRow={canEditStructure ? onRestoreRow : undefined}
                    onSystemChange={table.kind === 'system_order' && canEditStructure ? onBindProcessing : undefined}
                    onDeleteGroup={table.kind === 'system_order' && canEditStructure ? onDeleteGroup : undefined}
                    onAddProcessingUnder={table.kind === 'system_order' && canEditStructure ? onAddProcessingUnder : undefined}
                    onClassify={table.kind === 'system_order' && canEditStructure ? onClassify : undefined}
                    systemMaterials={draftRows}
                  />
                  {previewRows.unlocated.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">{localize('com_ui_steel_review_unlocated')}</h3>
                      <SteelReviewEditor
                        table={table}
                        rows={previewRows.unlocated}
                        draft={draftState}
                        sources={sources}
                        sourceCorrectionRowId={dialogState.sourceCorrectionRowId}
                        sourcePageCount={sourcePageCountQuery.data?.pageCount}
                        sourcePageCountLoading={sourcePageCountQuery.isLoading}
                        labels={{
                          table: localize('com_ui_steel_review_unlocated'),
                          readonly: localize('com_ui_steel_review_cell_readonly'),
                          ...sourceEditorLabels,
                          bindProcessing: localize('com_ui_steel_review_bind_processing'),
                          parent: localize('com_ui_steel_review_parent'),
                          deleteGroup: localize('com_ui_steel_review_delete_group'),
                          addProcessingUnder: localize('com_ui_steel_review_add_processing_under'),
                          classify: localize('com_ui_steel_review_classify'),
                          material: localize('com_ui_steel_review_material'),
                          processing: localize('com_ui_steel_review_processing'),
                        }}
                        onCellChange={onCellChange}
                        onCellHistoryBoundary={onCellHistoryBoundary}
                        canEdit={canEdit}
                        sourcePageCountError={sourcePageCountQuery.isError}
                        onSourcePageRetry={() => void sourcePageCountQuery.refetch()}
                        onSourceEdit={canEditSources ? onSourceEdit : undefined}
                        onSourceChange={canEditSources ? onSourceChange : undefined}
                        onDeleteRow={canEditStructure ? onDeleteRow : undefined}
                        onRestoreRow={canEditStructure ? onRestoreRow : undefined}
                        onSystemChange={table.kind === 'system_order' && canEditStructure ? onBindProcessing : undefined}
                        onDeleteGroup={table.kind === 'system_order' && canEditStructure ? onDeleteGroup : undefined}
                        onAddProcessingUnder={table.kind === 'system_order' && canEditStructure ? onAddProcessingUnder : undefined}
                        onClassify={table.kind === 'system_order' && canEditStructure ? onClassify : undefined}
                        systemMaterials={draftRows}
                      />
                    </div>
                  )}
                </>
              ) : (
                <SteelReviewEditor
                  table={table}
                  rows={draftRows}
                  draft={draftState}
                  sources={sources}
                  sourceCorrectionRowId={dialogState.sourceCorrectionRowId}
                  sourcePageCount={sourcePageCountQuery.data?.pageCount}
                  sourcePageCountLoading={sourcePageCountQuery.isLoading}
                  labels={{
                    table: localize('com_ui_steel_review_table_label'),
                    readonly: localize('com_ui_steel_review_cell_readonly'),
                    ...sourceEditorLabels,
                    bindProcessing: localize('com_ui_steel_review_bind_processing'),
                    parent: localize('com_ui_steel_review_parent'),
                    deleteGroup: localize('com_ui_steel_review_delete_group'),
                    addProcessingUnder: localize('com_ui_steel_review_add_processing_under'),
                    classify: localize('com_ui_steel_review_classify'),
                    material: localize('com_ui_steel_review_material'),
                    processing: localize('com_ui_steel_review_processing'),
                  }}
                  onCellChange={onCellChange}
                  onCellHistoryBoundary={onCellHistoryBoundary}
                  canEdit={canEdit}
                  sourcePageCountError={sourcePageCountQuery.isError}
                  onSourcePageRetry={() => void sourcePageCountQuery.refetch()}
                  onSourceEdit={canEditSources ? onSourceEdit : undefined}
                  onSourceChange={canEditSources ? onSourceChange : undefined}
                  onDeleteRow={canEditStructure ? onDeleteRow : undefined}
                  onRestoreRow={canEditStructure ? onRestoreRow : undefined}
                  onSystemChange={table.kind === 'system_order' && canEditStructure ? onBindProcessing : undefined}
                  onDeleteGroup={table.kind === 'system_order' && canEditStructure ? onDeleteGroup : undefined}
                  onAddProcessingUnder={table.kind === 'system_order' && canEditStructure ? onAddProcessingUnder : undefined}
                  onClassify={table.kind === 'system_order' && canEditStructure ? onClassify : undefined}
                  systemMaterials={draftRows}
                />
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <Button
              type="button"
              variant="outline"
              disabled={saveDisabled}
              aria-busy={saveBusy}
              onClick={() => void saveChanges()}
            >
              {localize('com_ui_steel_review_save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!table || saveBusy}
              aria-busy={saveBusy}
              onClick={() => void downloadCsv()}
            >
              {localize('com_ui_download_table_csv')}
            </Button>
            {dirtyRowCount > 0 && (
              <span className="text-sm text-text-secondary">
                {localize('com_ui_steel_review_unsaved_caption', { 0: dirtyRowCount })}
              </span>
            )}
            {preparedRowCount !== undefined && (
              <span className="text-sm text-text-secondary" role="status">
                {isSystemOrder
                  ? localize('com_ui_steel_review_system_save_caption', {
                    0: preparedRowCount,
                    1: preparedQuoteRowCount ?? 0,
                    2: quoteTotal ?? '—',
                  })
                  : localize('com_ui_steel_review_save_caption', { 0: preparedRowCount })}
              </span>
            )}
            {confirmedRowCount !== undefined && preparedRowCount === undefined && (
              <span className="text-sm text-text-secondary" role="status">
                {isSystemOrder
                  ? localize('com_ui_steel_review_system_updated_caption', {
                    0: confirmedRowCount,
                    1: confirmedQuoteRowCount ?? 0,
                    2: quoteTotal ?? '—',
                  })
                  : localize('com_ui_steel_review_updated_caption', { 0: confirmedRowCount })}
              </span>
            )}
            {saveBusy && (
              <span role="status">
                {localize(savePhase === 'reconciling'
                  ? 'com_ui_steel_review_reconciling'
                  : 'com_ui_steel_review_saving')}
              </span>
            )}
            {(saveErrorCode || savePhase === 'uncertain' || savePhase === 'stale' || savePhase === 'error' ||
              (savePhase === 'reconciling' && receiptFailed)) && (
              <span role="alert">{localize(saveErrorKey)}</span>
            )}
            {receiptFailed && receiptInput && (
              <Button type="button" variant="outline" onClick={retryReceiptLookup}>
                {localize('com_ui_steel_review_receipt_retry')}
              </Button>
            )}
          </div>
          <Button type="button" onClick={requestClose}>{localize('com_ui_close')}</Button>
        </div>
        {closeRequested && (
          <div className="space-y-3 rounded-md border border-border-light bg-surface-secondary p-3" role="alertdialog" aria-label={localize('com_ui_steel_review_close_confirm')}>
            <p className="text-sm">{localize('com_ui_steel_review_close_confirm')}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saveBusy || !canSave || dirtyRowCount === 0}
                aria-busy={saveBusy}
                onClick={() => void saveAndClose()}
              >
                {localize('com_ui_steel_review_save_updates')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saveBusy}
                onClick={discardDraftAndClose}
              >
                {localize('com_ui_steel_review_discard_unsaved')}
              </Button>
              <Button type="button" onClick={() => setCloseRequested(false)}>
                {localize('com_ui_steel_review_continue_editing')}
              </Button>
            </div>
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
