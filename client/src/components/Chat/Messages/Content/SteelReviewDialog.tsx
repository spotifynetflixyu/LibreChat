import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DynamicQueryKeys,
  QueryKeys,
  steelReviewErrorCodeSchema,
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
  SteelReviewCommit,
  SteelReviewErrorCode,
  SteelReviewKind,
  SteelReviewPrepared,
  SteelReviewReceiptStatus,
  SteelReviewResponse,
  SteelReviewRow,
  SteelReviewSavedSnapshot,
  SteelReviewSource,
  SteelReviewTable,
  TMessage,
} from 'librechat-data-provider';
import type { MutableRefObject } from 'react';
import type { SteelReviewPreviewRows } from './SteelReview/filter';
import type { SteelReviewSelection } from './SteelReview/state';
import type { TableMatrix } from './table/export';
import {
  applySteelReviewDrafts,
  areSteelReviewDraftOwnersSame,
  createSteelReviewDraftState,
  getSteelReviewDirtyRowIds,
  getSteelReviewDraftKey,
  getSteelReviewDraftOwnerKey,
  getSteelReviewDraftSource,
  getSteelReviewPrepareInput,
  rebaseSteelReviewDraftState,
  setSteelReviewDraftCell,
  setSteelReviewDraftSource,
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
  identity: SteelReviewSelection;
  downloadFilename?: string;
  saveGateRef?: MutableRefObject<SteelReviewSaveGate | undefined>;
}

type SavePhase = 'idle' | 'preparing' | 'committing' | 'uncertain' | 'stale' | 'reconciling';

type ReceiptInput = {
  conversationId: string;
  kind: SteelReviewKind;
  messageId: string;
  tableId: string;
  outputId: string;
  operationId: string;
  digest: string;
};

type SteelReviewConfirmedSave = {
  conversationId: string;
  messageId: string;
  tableId: string;
  partIndex?: number;
  kind: SteelReviewKind;
  outputId: string;
  revision: string;
  changedRows: number;
};

function isCurrentOwner(
  table: SteelReviewTable | null | undefined,
  owner: Omit<SteelReviewConfirmedSave, 'changedRows'>,
): boolean {
  return Boolean(
    table &&
    table.conversationId === owner.conversationId &&
    table.messageId === owner.messageId &&
    table.tableId === owner.tableId &&
    table.partIndex === owner.partIndex &&
    table.kind === owner.kind &&
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

function isAuthorizedCurrentTable(
  table: SteelReviewTable | null | undefined,
  prepared: SteelReviewPrepared,
  snapshot: SteelReviewSavedSnapshot,
): boolean {
  return Boolean(
    table &&
    table.conversationId === prepared.conversationId &&
    table.messageId === prepared.messageId &&
    table.tableId === prepared.tableId &&
    table.partIndex === prepared.partIndex &&
    table.kind === prepared.kind &&
    table.outputId === prepared.outputId &&
    table.latestOutputId === prepared.outputId &&
    table.isLatest &&
    (table.revision === prepared.revision || table.revision === snapshot.revision),
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
    table.tableId === prepared.tableId &&
    table.partIndex === prepared.partIndex &&
    table.kind === prepared.kind &&
    table.outputId === prepared.outputId &&
    table.latestOutputId === prepared.outputId &&
    table.isLatest &&
    table.revision === prepared.revision,
  );
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

function rowsToMatrix(table: Pick<SteelReviewTable, 'headers'>, rows: readonly SteelReviewRow[]): TableMatrix {
  return [
    table.headers,
    ...rows.map((row) => table.headers.map((header) => row.values[header]?.effective ?? '')),
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
  const queryClient = useQueryClient();
  const [selection, setSelection] = useAtom(steelReviewSelectionAtom);
  const isOpen = selection != null &&
    selection.conversationId === identity.conversationId &&
    selection.messageId === identity.messageId &&
    selection.kind === identity.kind &&
    selection.tableId === identity.tableId &&
    selection.partIndex === identity.partIndex;
  const query = useGetSteelReviewQuery(isOpen ? identity : null, { retry: false });
  const isNotFound = getErrorStatus(query.error) === 404;
  const table = query.data?.table;
  const dialogStateKey = steelReviewIdentityKey(identity);
  const [dialogState, setDialogState] = useAtom(steelReviewDialogStateFamily(dialogStateKey));
  const draftStateKey = table
    ? getSteelReviewDraftKey(identity, table)
    : `pending:${dialogStateKey}`;
  const draftStateAtomKey = table
    ? getSteelReviewDraftOwnerKey(identity, table)
    : `pending:${dialogStateKey}`;
  const [draftState, setDraftState] = useAtom(steelReviewDraftStateFamily(draftStateAtomKey));
  const [closeRequested, setCloseRequested] = useState(false);
  const [savePhase, setSavePhase] = useState<SavePhase>('idle');
  const [saveErrorCode, setSaveErrorCode] = useState<SteelReviewErrorCode>();
  const [confirmedSave, setConfirmedSave] = useState<SteelReviewConfirmedSave>();
  const [receiptInput, setReceiptInput] = useState<ReceiptInput | null>(null);
  const [discardRequested, setDiscardRequested] = useState(false);
  const [receiptFailed, setReceiptFailed] = useState(false);
  const submittedChangeSequenceRef = useRef(0);
  const discardBoundaryRef = useRef<number>();
  const preparedRef = useRef<SteelReviewPrepared>();
  const exportRowsRef = useRef<readonly SteelReviewRow[]>([]);
  const exportBaseRowsRef = useRef<readonly SteelReviewRow[]>([]);
  const pendingSnapshotRef = useRef<{ outputId: string; revision: string }>();
  const prepareMutation = usePrepareSteelReviewMutation();
  const commitMutation = useCommitSteelReviewMutation();
  const receiptQuery = useGetSteelReviewReceiptQuery(receiptInput, {
    enabled: false,
    retry: false,
  });
  const receiptQueryRefetchRef = useRef(receiptQuery.refetch);
  receiptQueryRefetchRef.current = receiptQuery.refetch;
  const refetchReceipt = useCallback(() => receiptQueryRefetchRef.current(), []);
  const {
    selectedFileId,
    pageNumber,
    pageCount,
    fullScreen,
  } = dialogState;
  const canEdit = Boolean(table && table.kind === 'ocr_result' && table.isLatest && !table.readOnly);
  const dirtyRowIds = useMemo(
    () => (table && canEdit ? getSteelReviewDirtyRowIds(table, draftState) : []),
    [canEdit, draftState, table],
  );
  const dirtyRowCount = dirtyRowIds.length;
  const draftRows = useMemo(
    () => (table ? applySteelReviewDrafts(table.rows, draftState) : []),
    [draftState, table],
  );
  useEffect(() => {
    const pendingSnapshot = pendingSnapshotRef.current;
    if (pendingSnapshot && (
      table?.outputId !== pendingSnapshot.outputId ||
      table.revision !== pendingSnapshot.revision
    )) {
      return;
    }
    pendingSnapshotRef.current = undefined;
    exportBaseRowsRef.current = table?.rows ?? [];
    exportRowsRef.current = draftRows;
  }, [draftRows, table?.outputId, table?.revision, table?.rows]);
  const sourcesQuery = useGetSteelReviewSourcesQuery(
    isOpen
      ? {
          conversationId: identity.conversationId,
          kind: identity.kind,
          messageId: identity.messageId,
          tableId: identity.tableId,
        }
      : null,
    { enabled: isOpen && !!table },
  );
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const selectedSource = useMemo(
    () => sources.find((source) => source.fileId === selectedFileId) ?? sources[0],
    [selectedFileId, sources],
  );
  const selectedSourceId = selectedSource?.fileId;
  const selectedSourcePage = useMemo(
    () => table?.rows.find((row) => row.source?.fileId === selectedSource?.fileId)?.source?.pageNumber,
    [selectedSource?.fileId, table?.rows],
  );
  const sourceCorrectionRow = useMemo(
    () => table?.rows.find((row) => row.rowId === dialogState.sourceCorrectionRowId),
    [dialogState.sourceCorrectionRowId, table?.rows],
  );
  const sourceCorrectionDraft = sourceCorrectionRow?.rowId
    ? getSteelReviewDraftSource(draftState, sourceCorrectionRow.rowId)
    : undefined;
  const sourceCorrection = sourceCorrectionRow?.rowId
    ? sourceCorrectionDraft === undefined ? sourceCorrectionRow.source : sourceCorrectionDraft
    : undefined;
  const sourceCorrectionFile = sourceCorrection?.fileId
    ? sources.find((source) => source.fileId === sourceCorrection.fileId)
    : undefined;
  const sourcePageCountQuery = useGetSteelReviewSourcePageCountQuery(
    isOpen && canEdit && sourceCorrection?.fileId && sourceCorrectionFile?.mediaType !== undefined &&
      !sourceCorrectionFile.mediaType.startsWith('image/')
      ? {
          conversationId: identity.conversationId,
          kind: identity.kind,
          messageId: identity.messageId,
          fileId: sourceCorrection.fileId,
        }
      : null,
    {
      enabled: isOpen && canEdit && !!sourceCorrection?.fileId &&
        sourceCorrectionFile?.mediaType !== undefined &&
        !sourceCorrectionFile.mediaType.startsWith('image/'),
    },
  );
  useEffect(() => {
    if (draftState.ownerKey === draftStateKey) {
      return;
    }
    if (areSteelReviewDraftOwnersSame(draftState.ownerKey, draftStateKey)) {
      setDraftState((current) => ({ ...current, ownerKey: draftStateKey }));
      return;
    }
    setDraftState(createSteelReviewDraftState(draftStateKey));
  }, [draftState.ownerKey, draftStateKey, setDraftState]);
  useEffect(() => {
    if (!isOpen) {
      setCloseRequested(false);
    }
  }, [isOpen]);
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
  const onCellChange = useCallback(
    (row: SteelReviewRow, header: string, value: string) => {
      if (!table || !canEdit || !row.rowId) {
        return;
      }
      setDraftState((current) => {
        const ownerDraft = current.ownerKey === draftStateKey
          ? current
          : createSteelReviewDraftState(draftStateKey);
        const baseRow = table.rows.find((candidate) => candidate.rowId === row.rowId) ?? row;
        const next = setSteelReviewDraftCell(ownerDraft, baseRow, header, value);
        if (pendingSnapshotRef.current) {
          exportRowsRef.current = applySteelReviewDrafts(exportBaseRowsRef.current, next);
        }
        return next;
      });
    },
    [canEdit, draftStateKey, setDraftState, table],
  );
  const onSourceEdit = useCallback((row: SteelReviewRow) => {
    if (!canEdit || !row.rowId) {
      return;
    }
    setDialogState((state) => ({ ...state, sourceCorrectionRowId: row.rowId }));
  }, [canEdit, setDialogState]);
  const onSourceChange = useCallback(
    (row: SteelReviewRow, source: SteelReviewSource | null) => {
      if (!table || !canEdit || !row.rowId) {
        return;
      }
      setDraftState((current) => {
        const ownerDraft = current.ownerKey === draftStateKey
          ? current
          : createSteelReviewDraftState(draftStateKey);
        const baseRow = table.rows.find((candidate) => candidate.rowId === row.rowId) ?? row;
        const next = setSteelReviewDraftSource(ownerDraft, baseRow, source);
        if (pendingSnapshotRef.current) {
          exportRowsRef.current = applySteelReviewDrafts(exportBaseRowsRef.current, next);
        }
        return next;
      });
    },
    [canEdit, draftStateKey, setDraftState, table],
  );
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
  const savePromiseRef = useRef<Promise<boolean>>();
  const applyConfirmedSnapshot = useCallback((snapshot: SteelReviewSavedSnapshot, submittedChangeSequence: number) => {
    const tableKey = DynamicQueryKeys.steelReview(
      identity.conversationId,
      identity.kind,
      identity.messageId,
      identity.tableId,
      table?.partIndex ?? identity.partIndex,
    );
    queryClient.setQueryData<SteelReviewResponse>(tableKey, (current) =>
      applySteelReviewSnapshotToResponse(current, snapshot));
    queryClient.setQueryData<TMessage[]>(
      [QueryKeys.messages, identity.conversationId],
      (current) => applySteelReviewSnapshotToMessages(current, identity.kind, snapshot),
    );
    exportBaseRowsRef.current = snapshot.rows;
    exportRowsRef.current = snapshot.rows;
    pendingSnapshotRef.current = { outputId: snapshot.outputId, revision: snapshot.revision };
    setConfirmedSave({
      conversationId: snapshot.conversationId,
      messageId: snapshot.messageId,
      tableId: identity.tableId,
      partIndex: table?.partIndex ?? identity.partIndex,
      kind: identity.kind,
      outputId: snapshot.outputId,
      revision: snapshot.revision,
      changedRows: snapshot.changedRows,
    });
    const currentDraft = latestDraftStateRef.current;
    const rebasedDraft = rebaseSteelReviewDraftState(currentDraft, snapshot.rows, submittedChangeSequence);
    latestDraftStateRef.current = rebasedDraft;
    setDraftState((current) => {
      const rebased = rebaseSteelReviewDraftState(current, snapshot.rows, submittedChangeSequence);
      exportRowsRef.current = applySteelReviewDrafts(snapshot.rows, rebased);
      return rebased;
    });
  }, [identity, queryClient, setConfirmedSave, setDraftState, table?.partIndex]);
  const applyConfirmedNoOp = useCallback((currentTable: SteelReviewTable, submittedChangeSequence: number) => {
    exportBaseRowsRef.current = currentTable.rows;
    const rebasedDraft = rebaseSteelReviewDraftState(
      latestDraftStateRef.current,
      currentTable.rows,
      submittedChangeSequence,
    );
    latestDraftStateRef.current = rebasedDraft;
    setDraftState((current) => {
      const rebased = rebaseSteelReviewDraftState(current, currentTable.rows, submittedChangeSequence);
      exportRowsRef.current = applySteelReviewDrafts(currentTable.rows, rebased);
      return rebased;
    });
  }, [setDraftState]);
  const saveChanges = useCallback(async (): Promise<boolean> => {
    const existingPromise = savePromiseRef.current;
    if (existingPromise) {
      return existingPromise;
    }
    if (!table || !canEdit) {
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
      if (!preparedRef.current) {
        submittedChangeSequenceRef.current = draftState.changeSequence;
      }
      setSaveErrorCode(undefined);
      setSavePhase(preparedRef.current ? 'committing' : 'preparing');
      try {
        const prepared = preparedRef.current ?? await prepareMutation.mutateAsync(
          getSteelReviewPrepareInput(identity, table, draftState, draftRows),
        );
        preparedRef.current = prepared;
        setSavePhase('committing');
        commitAttempted = true;
        const saved = await commitMutation.mutateAsync(prepared as SteelReviewCommit);
        if (saved.changedRows > 0 && !saved.savedSnapshot) {
          setSavePhase('uncertain');
          return false;
        }
        if (saved.changedRows === 0 && !saved.savedSnapshot) {
          const currentResult = await refetchCurrentReview();
          if (currentResult.error || !currentResult.data?.table) {
            setSavePhase('uncertain');
            setSaveErrorCode(undefined);
            return false;
          }
          if (!isAuthorizedCurrentNoOpTable(currentResult.data.table, prepared)) {
            preparedRef.current = undefined;
            setSavePhase('stale');
            setSaveErrorCode('REVIEW_CONFLICT');
            return false;
          }
          applyConfirmedNoOp(currentResult.data.table, submittedChangeSequenceRef.current);
        }
        if (saved.savedSnapshot) {
          const currentResult = await refetchCurrentReview();
          if (currentResult.error || !currentResult.data?.table) {
            setSavePhase('uncertain');
            setSaveErrorCode(undefined);
            return false;
          }
          if (!isAuthorizedCurrentTable(currentResult.data.table, prepared, saved.savedSnapshot)) {
            preparedRef.current = undefined;
            setSavePhase('stale');
            setSaveErrorCode('REVIEW_CONFLICT');
            return false;
          }
          applyConfirmedSnapshot(saved.savedSnapshot, submittedChangeSequenceRef.current);
        }
        preparedRef.current = undefined;
        setSavePhase('idle');
        setSaveErrorCode(undefined);
        return true;
      } catch (error) {
        const code = getErrorCode(error);
        if (code === 'REVIEW_CONFLICT' || code === 'REVIEW_INVALID_OPERATION' || code === 'REVIEW_NOT_FOUND') {
          preparedRef.current = undefined;
          setSavePhase('stale');
          setSaveErrorCode(code);
          void refetchCurrentReview();
        } else if (commitAttempted) {
          setSavePhase('uncertain');
          setSaveErrorCode(undefined);
        } else {
          setSavePhase('idle');
          setSaveErrorCode(code);
        }
        return false;
      }
    })();
    savePromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (savePromiseRef.current === promise) {
        savePromiseRef.current = undefined;
      }
    }
  }, [applyConfirmedNoOp, applyConfirmedSnapshot, canEdit, commitMutation, dirtyRowCount, draftRows, draftState.changeSequence, identity, prepareMutation, refetchCurrentReview, savePhase, table]);
  const getCurrentReviewTable = useCallback(() => {
    const tableKey = DynamicQueryKeys.steelReview(
      identity.conversationId,
      identity.kind,
      identity.messageId,
      identity.tableId,
      latestTableRef.current?.partIndex ?? identity.partIndex,
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
    const initialTable = getCurrentReviewTable();
    if (authority && (!initialTable || initialTable.outputId !== authority.outputId || initialTable.revision !== authority.revision)) {
      return false;
    }
    if (savePhase === 'uncertain' || savePhase === 'reconciling') {
      return false;
    }
    const saved = await saveChanges();
    if (!saved) {
      return saved;
    }
    const latestDraft = latestDraftStateRef.current;
    const currentTable = getCurrentReviewTable();
    if (!currentTable || (authority && currentTable.outputId !== authority.outputId)) {
      return false;
    }
    return getSteelReviewDirtyRowIds(currentTable, latestDraft).length === 0;
  }, [getCurrentReviewTable, saveChanges, savePhase]);
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
    setDraftState(createSteelReviewDraftState(draftStateKey));
    latestDraftStateRef.current = createSteelReviewDraftState(draftStateKey);
    preparedRef.current = undefined;
    discardBoundaryRef.current = undefined;
    setSavePhase('idle');
    setSaveErrorCode(undefined);
    setReceiptFailed(false);
    setReceiptInput(null);
    setDiscardRequested(false);
    setCloseRequested(false);
    setSelection(null);
  }, [draftStateKey, setDraftState, setSelection]);
  const finishDiscardAtBoundary = useCallback((rows: readonly SteelReviewRow[]) => {
    const boundary = discardBoundaryRef.current ?? latestDraftStateRef.current.changeSequence;
    const rebased = rebaseSteelReviewDraftState(latestDraftStateRef.current, rows, boundary);
    latestDraftStateRef.current = rebased;
    setDraftState(rebased);
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
      setSelection(null);
      return;
    }
    setCloseRequested(false);
  }, [setDraftState, setSelection]);
  const requestReceiptBeforeDiscard = useCallback(() => {
    const prepared = preparedRef.current;
    if (!prepared) {
      clearDraftAndClose();
      return;
    }
    discardBoundaryRef.current = latestDraftStateRef.current.changeSequence;
    setReceiptFailed(false);
    setSavePhase('reconciling');
    setReceiptInput({
      conversationId: prepared.conversationId,
      kind: prepared.kind,
      messageId: prepared.messageId,
      tableId: prepared.tableId,
      outputId: prepared.outputId,
      operationId: prepared.operationId,
      digest: prepared.digest,
    });
    setDiscardRequested(true);
  }, [clearDraftAndClose]);
  const discardDraftAndClose = useCallback(() => {
    if (savePhase === 'uncertain' || savePhase === 'reconciling') {
      requestReceiptBeforeDiscard();
      return;
    }
    clearDraftAndClose();
  }, [clearDraftAndClose, requestReceiptBeforeDiscard, savePhase]);
  const retryReceiptLookup = useCallback(() => {
    if (!receiptInput) {
      return;
    }
    setReceiptFailed(false);
    setSaveErrorCode(undefined);
    setSavePhase('reconciling');
    setDiscardRequested(true);
  }, [receiptInput]);
  const requestClose = useCallback(() => {
    if (dirtyRowCount > 0 || savePhase === 'preparing' || savePhase === 'committing' ||
      savePhase === 'uncertain' || savePhase === 'reconciling') {
      setCloseRequested(true);
      return;
    }
    setSelection(null);
  }, [dirtyRowCount, savePhase, setSelection]);
  useEffect(() => {
    if (!discardRequested || !receiptInput) {
      return undefined;
    }
    let active = true;
    void refetchReceipt().then(async (result) => {
      if (!active) {
        return;
      }
      setDiscardRequested(false);
      if (result.error || !result.data) {
        setSavePhase('reconciling');
        setSaveErrorCode(getErrorCode(result.error));
        setReceiptFailed(true);
        return;
      }
      const status: SteelReviewReceiptStatus = result.data;
      const currentResult = await refetchCurrentReview();
      if (currentResult.error || !currentResult.data?.table) {
        setSavePhase('reconciling');
        setSaveErrorCode(undefined);
        setReceiptFailed(true);
        return;
      }
      if (status.status === 'committed') {
        const prepared = preparedRef.current;
        if (!prepared || !isAuthorizedCurrentTable(currentResult.data.table, prepared, status.snapshot)) {
          preparedRef.current = undefined;
          setSavePhase('stale');
          setSaveErrorCode('REVIEW_CONFLICT');
          setReceiptInput(null);
          setReceiptFailed(false);
          return;
        }
        const boundary = discardBoundaryRef.current ?? submittedChangeSequenceRef.current;
        applyConfirmedSnapshot(status.snapshot, boundary);
        const rebased = rebaseSteelReviewDraftState(
          latestDraftStateRef.current,
          status.snapshot.rows,
          boundary,
        );
        latestDraftStateRef.current = rebased;
        setDraftState(rebased);
        preparedRef.current = undefined;
        discardBoundaryRef.current = undefined;
        setReceiptInput(null);
        setReceiptFailed(false);
        setSaveErrorCode(undefined);
        setSavePhase('idle');
        if (getSteelReviewDirtyRowIds({ rows: status.snapshot.rows }, rebased).length === 0) {
          setCloseRequested(false);
          setSelection(null);
        } else {
          setCloseRequested(false);
        }
        return;
      }
      finishDiscardAtBoundary(currentResult.data.table.rows);
    }).catch(() => {
      if (active) {
        setDiscardRequested(false);
        setSavePhase('reconciling');
        setSaveErrorCode(undefined);
        setReceiptFailed(true);
      }
    });
    return () => {
      active = false;
    };
  }, [applyConfirmedSnapshot, discardRequested, finishDiscardAtBoundary, receiptInput, refetchCurrentReview, refetchReceipt, setDraftState, setSelection]);
  const saveAndClose = useCallback(async () => {
    const saved = await saveChanges();
    if (!saved || !table) {
      return;
    }
    const latestDraft = latestDraftStateRef.current;
    if (getSteelReviewDirtyRowIds(table, latestDraft).length === 0) {
      setCloseRequested(false);
      setSelection(null);
    }
  }, [saveChanges, setSelection, table]);
  const downloadCsv = useCallback(async () => {
    if (!(await ensureSaved())) {
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
  }, [downloadFilename, ensureSaved, getExportMatrix]);
  const saveBusy = savePhase === 'preparing' || savePhase === 'committing' || savePhase === 'reconciling';
  const saveDisabled = !canEdit || dirtyRowCount === 0 || saveBusy;
  const saveErrorKey = getSaveErrorKey(savePhase, saveErrorCode);
  const preparedRowCount = saveBusy && preparedRef.current && table &&
    isCurrentOwner(table, preparedRef.current)
    ? preparedRef.current.caption.changedRows
    : undefined;
  const confirmedRowCount = confirmedSave && isCurrentOwner(table, confirmedSave)
    ? confirmedSave.changedRows
    : getCurrentLastSaveCount(table);
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
              {sourcesQuery.isLoading && (
                <p aria-live="polite" role="status">
                  {localize('com_ui_steel_review_sources_loading')}
                </p>
              )}
              {sourcesQuery.isError && (
                <div className="space-y-2" role="alert">
                  <p>{localize('com_ui_steel_review_sources_error')}</p>
                  <Button type="button" variant="outline" onClick={() => void sourcesQuery.refetch()}>
                    {localize('com_ui_retry')}
                  </Button>
                </div>
              )}
              {sources.length > 0 && (
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
                      <SelectContent>
                        {sources.map((source) => (
                          <SelectItem key={source.fileId} value={source.fileId}>
                            {source.filename}
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
                        <SelectContent>
                          {Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1).map((page) => (
                            <SelectItem key={page} value={String(page)}>
                              {page}
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
                  stateKey={steelReviewSourcePreviewKey(identity, selectedSource.fileId)}
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
                      changeSource: localize('com_ui_steel_review_change_source'),
                      sourceFile: localize('com_ui_steel_review_source_file'),
                      sourcePage: localize('com_ui_steel_review_source_page'),
                      sourceNoPage: localize('com_ui_steel_review_source_no_page'),
                      clearSource: localize('com_ui_steel_review_clear_source'),
                      sourceActions: localize('com_ui_steel_review_source_actions'),
                      sourcePageLoading: localize('com_ui_steel_review_source_page_loading'),
                      sourcePageUnavailable: localize('com_ui_steel_review_source_page_unavailable'),
                      sourcePageRetry: localize('com_ui_retry'),
                    }}
                    onCellChange={onCellChange}
                    sourcePageCountError={sourcePageCountQuery.isError}
                    onSourcePageRetry={() => void sourcePageCountQuery.refetch()}
                    onSourceEdit={canEdit ? onSourceEdit : undefined}
                    onSourceChange={canEdit ? onSourceChange : undefined}
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
                          changeSource: localize('com_ui_steel_review_change_source'),
                          sourceFile: localize('com_ui_steel_review_source_file'),
                          sourcePage: localize('com_ui_steel_review_source_page'),
                          sourceNoPage: localize('com_ui_steel_review_source_no_page'),
                          clearSource: localize('com_ui_steel_review_clear_source'),
                          sourceActions: localize('com_ui_steel_review_source_actions'),
                          sourcePageLoading: localize('com_ui_steel_review_source_page_loading'),
                          sourcePageUnavailable: localize('com_ui_steel_review_source_page_unavailable'),
                          sourcePageRetry: localize('com_ui_retry'),
                        }}
                        onCellChange={onCellChange}
                        sourcePageCountError={sourcePageCountQuery.isError}
                        onSourcePageRetry={() => void sourcePageCountQuery.refetch()}
                        onSourceEdit={canEdit ? onSourceEdit : undefined}
                        onSourceChange={canEdit ? onSourceChange : undefined}
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
                    changeSource: localize('com_ui_steel_review_change_source'),
                    sourceFile: localize('com_ui_steel_review_source_file'),
                    sourcePage: localize('com_ui_steel_review_source_page'),
                    sourceNoPage: localize('com_ui_steel_review_source_no_page'),
                    clearSource: localize('com_ui_steel_review_clear_source'),
                    sourceActions: localize('com_ui_steel_review_source_actions'),
                    sourcePageLoading: localize('com_ui_steel_review_source_page_loading'),
                    sourcePageUnavailable: localize('com_ui_steel_review_source_page_unavailable'),
                    sourcePageRetry: localize('com_ui_retry'),
                  }}
                  onCellChange={onCellChange}
                  sourcePageCountError={sourcePageCountQuery.isError}
                  onSourcePageRetry={() => void sourcePageCountQuery.refetch()}
                  onSourceEdit={canEdit ? onSourceEdit : undefined}
                  onSourceChange={canEdit ? onSourceChange : undefined}
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
                {localize('com_ui_steel_review_save_caption', { 0: preparedRowCount })}
              </span>
            )}
            {confirmedRowCount !== undefined && preparedRowCount === undefined && (
              <span className="text-sm text-text-secondary" role="status">
                {localize('com_ui_steel_review_updated_caption', { 0: confirmedRowCount })}
              </span>
            )}
            {saveBusy && (
              <span role="status">
                {localize(savePhase === 'reconciling'
                  ? 'com_ui_steel_review_reconciling'
                  : 'com_ui_steel_review_saving')}
              </span>
            )}
            {(saveErrorCode || savePhase === 'uncertain' || savePhase === 'stale' ||
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
                disabled={saveBusy || !canEdit || dirtyRowCount === 0}
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
