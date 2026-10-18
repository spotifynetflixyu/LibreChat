import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import { DynamicQueryKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type {
  SteelReviewConflict,
  SteelReviewErrorCode,
  SteelReviewPrepared,
  SteelReviewReceiptStatus,
  SteelReviewRecovery,
  SteelReviewResponse,
  SteelReviewRow,
  SteelReviewSavedSnapshot,
  SteelReviewTable,
  TMessage,
} from 'librechat-data-provider';
import type { QueryObserverResult } from '@tanstack/react-query';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  SteelReviewSaveGate,
  SteelReviewSavePhase,
  SteelReviewSaveAction,
  SteelReviewSaveState,
  SteelReviewConfirmedSave,
  SteelReviewReceiptInput,
  SteelReviewDownloadAuthority,
} from '../save';
import type {
  SteelReviewCapturedAuthority,
  SteelReviewDialogState,
  SteelReviewIdentity,
} from '../state';
import type { SteelReviewDraftState } from '../session';
import type { CapturedAuthority } from './capture';
import type { CaptureScoped } from '../authority';
import {
  applySteelReviewDrafts,
  createSteelReviewDraftState,
  getSteelReviewCommitInput,
  getSteelReviewDirtyRowIds,
  getSteelReviewPrepareInput,
  rebaseSteelReviewDraftState,
} from '../session';
import {
  isLiveCapture,
  getCaptureScopedValue,
  sameSteelReviewScope,
  isAuthorizedCurrentTable,
  isCapturedAuthorityForPrepared,
  canApplySteelReviewMessageSnapshot,
} from '../authority';
import {
  isSteelReviewSaveBusy,
  steelReviewSaveReducer,
  steelReviewRowsToMatrix,
  getSteelReviewErrorCode,
  emptySteelReviewSaveState,
  getSteelReviewErrorRecovery,
  getSteelReviewReceiptEffectKey,
} from '../save';
import {
  useCommitSteelReviewMutation,
  useGetSteelReviewReceiptQuery,
  usePrepareSteelReviewMutation,
} from '~/data-provider';
import { steelReviewDraftStateFamily, steelReviewSelectionAtom } from '../state';
import { applySteelReviewSnapshotToMessages, applySteelReviewSnapshotToResponse } from '../cache';
import { getSteelReviewUnlinkedRowIds } from '../filter';

type DraftStateUpdate =
  | SteelReviewDraftState
  | ((current: SteelReviewDraftState) => SteelReviewDraftState);

export interface SteelReviewSaveOptions {
  identity: SteelReviewIdentity;
  isOpen: boolean;
  captureId: string | undefined;
  table: SteelReviewTable | null | undefined;
  baseTable: SteelReviewTable | null | undefined;
  capturedAuthority: SteelReviewCapturedAuthority | undefined;
  /** The live table is editable apart from any save in flight. */
  canEditTable: boolean;
  draftState: SteelReviewDraftState;
  draftStateAtom: ReturnType<typeof steelReviewDraftStateFamily>;
  draftStateKey: string;
  draftRows: SteelReviewRow[];
  dirtyRowCount: number;
  setDraftStateScoped: (update: DraftStateUpdate) => void;
  setDialogState: Dispatch<SetStateAction<SteelReviewDialogState>>;
  query: Pick<QueryObserverResult<SteelReviewResponse>, 'error' | 'refetch'>;
  saveGateRef?: MutableRefObject<SteelReviewSaveGate | undefined>;
  authority: CapturedAuthority;
}

export interface SteelReviewSave {
  closeRequested: boolean;
  savePhase: SteelReviewSavePhase;
  saveErrorCode: SteelReviewErrorCode | undefined;
  saveRecovery: SteelReviewRecovery | undefined;
  confirmedSave: SteelReviewConfirmedSave | undefined;
  receiptInput: CaptureScoped<SteelReviewReceiptInput> | null;
  receiptFailed: boolean;
  saveBusy: boolean;
  canEdit: boolean;
  canSave: boolean;
  preparedForCapture: SteelReviewPrepared | undefined;
  /** Keeps the export rows in step with a draft edit made while a saved snapshot is pending. */
  updateDraftRows: (next: SteelReviewDraftState) => SteelReviewDraftState;
  getRecoveryRow: (conflict: SteelReviewConflict) => SteelReviewRow | undefined;
  resolveConflict: (conflict: SteelReviewConflict) => void;
  saveAndClose: () => Promise<void>;
  discardDraftAndClose: () => void;
  retryReceiptLookup: () => void;
  requestClose: () => void;
  continueEditing: () => void;
}

/**
 * The save, receipt reconciliation, and discard flows of one review dialog
 * capture. Every state transition is dropped once the capture no longer owns
 * the live selection.
 */
export function useSteelReviewSave({
  identity,
  isOpen,
  captureId,
  table,
  baseTable,
  capturedAuthority,
  canEditTable,
  draftState,
  draftStateAtom,
  draftStateKey,
  draftRows,
  dirtyRowCount,
  setDraftStateScoped,
  setDialogState,
  query,
  saveGateRef,
  authority,
}: SteelReviewSaveOptions): SteelReviewSave {
  const store = useStore();
  const queryClient = useQueryClient();
  const {
    getCapturedAuthority,
    hasActiveCapturedSession,
    hasCurrentCapturedSession,
    isCurrentCapture,
    clearSelectionForCapture,
    persistCapturedAuthority,
    clearCapturedAuthority,
  } = authority;
  const [captureUiState, setCaptureUiState] = useState<CaptureScoped<SteelReviewSaveState>>();
  useEffect(() => {
    if (!isOpen) setCaptureUiState(undefined);
  }, [isOpen]);
  const currentCaptureUi =
    captureId && captureUiState?.captureId === captureId
      ? captureUiState.value
      : emptySteelReviewSaveState;
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
  /** Applies a save transition only while this capture still owns the live selection. */
  const dispatchSave = useCallback(
    (action: SteelReviewSaveAction) => {
      if (!captureId) {
        return;
      }
      setCaptureUiState((current) => {
        if (!isLiveCapture(store.get(steelReviewSelectionAtom), captureId, identity)) {
          return current;
        }
        const previous =
          current?.captureId === captureId ? current.value : emptySteelReviewSaveState;
        return { captureId, value: steelReviewSaveReducer(previous, action) };
      });
    },
    [captureId, identity, store],
  );
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
  latestReceiptEffectKeyRef.current = receiptInput
    ? getSteelReviewReceiptEffectKey(receiptInput)
    : undefined;
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
    dispatchSave({ type: 'reset' });
  }, [captureId, dispatchSave]);
  const authorityMatchesLiveTable =
    !capturedAuthority || !table || table.outputId === capturedAuthority.outputId;
  const saveBusy = isSteelReviewSaveBusy(savePhase);
  const canEdit = canEditTable && !saveBusy;
  const canSave = canEdit && authorityMatchesLiveTable;
  useEffect(() => {
    if (!capturedAuthority || !table || authorityMatchesLiveTable) {
      return;
    }
    // Keep the prepared operation available for its commit or receipt lookup
    // while a newer live owner is being published. The receipt belongs to the
    // captured session and must be allowed to acknowledge that operation
    // before the live-owner guard can mark the dialog stale.
    if (
      getCaptureScopedValue(preparedRef, captureId) &&
      (savePhase === 'preparing' ||
        savePhase === 'committing' ||
        savePhase === 'uncertain' ||
        savePhase === 'reconciling')
    ) {
      return;
    }
    preparedRef.current = undefined;
    dispatchSave({ type: 'stale', code: 'REVIEW_CONFLICT' });
  }, [authorityMatchesLiveTable, captureId, capturedAuthority, dispatchSave, savePhase, table]);
  useEffect(() => {
    const pendingSnapshot = getCaptureScopedValue(pendingSnapshotRef, captureId);
    if (
      pendingSnapshot &&
      (table?.outputId !== pendingSnapshot.outputId || table.revision !== pendingSnapshot.revision)
    ) {
      return;
    }
    pendingSnapshotRef.current = undefined;
    exportBaseRowsRef.current = table?.rows ?? [];
    exportRowsRef.current = draftRows;
  }, [captureId, draftRows, table?.outputId, table?.revision, table?.rows]);
  useEffect(() => {
    if (!isOpen) {
      dispatchSave({ type: 'close_requested', value: false });
    }
  }, [dispatchSave, isOpen]);
  const clearRecoveryRef = useCallback(() => {
    recoveryRef.current = undefined;
  }, []);

  const adoptConflictRecovery = useCallback(
    (recovery: SteelReviewRecovery) => {
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
        current ? { ...current, table: recoveredTable } : { table: recoveredTable },
      );
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
      );
      latestDraftStateRef.current = rebased;
      setDraftStateScoped(rebased);
      exportBaseRowsRef.current = recoveredTable.rows;
      exportRowsRef.current = applySteelReviewDrafts(recoveredTable.rows, rebased);
      dispatchSave({ type: 'recovery', recovery });
    },
    [captureId, dispatchSave, identity, persistCapturedAuthority, queryClient, setDraftStateScoped],
  );
  const updateDraftRows = useCallback(
    (next: SteelReviewDraftState) => {
      if (getCaptureScopedValue(pendingSnapshotRef, captureId)) {
        exportRowsRef.current = applySteelReviewDrafts(exportBaseRowsRef.current, next);
      }
      return next;
    },
    [captureId],
  );
  const getRecoveryRow = useCallback(
    (conflict: SteelReviewConflict) =>
      getCaptureScopedValue(recoveryRef, captureId)?.table.rows.find(
        (candidate) => candidate.rowId === conflict.rowId,
      ),
    [captureId],
  );
  const resolveConflict = useCallback(
    (conflict: SteelReviewConflict) => {
      dispatchSave({ type: 'conflict_resolved', conflict });
      if (saveRecovery?.conflicts.length === 1) {
        recoveryRef.current = undefined;
      }
    },
    [dispatchSave, saveRecovery?.conflicts.length],
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
  const applyConfirmedSnapshot = useCallback(
    (
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
          applySteelReviewSnapshotToResponse(current, snapshot),
        );
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
      setDialogState((state) => ({
        ...state,
        unlinkedMembershipOwner: captureId,
        unlinkedRowIds: getSteelReviewUnlinkedRowIds(snapshot.rows),
      }));
      if (captureId) {
        pendingSnapshotRef.current = {
          captureId,
          value: { outputId: snapshot.outputId, revision: snapshot.revision },
        };
      }
      dispatchSave({
        type: 'confirmed',
        confirmedSave: {
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
        },
      });
      const currentDraft = latestDraftStateRef.current;
      const rebasedDraft = rebaseSteelReviewDraftState(
        currentDraft,
        snapshot.rows,
        submittedChangeSequence,
      );
      latestDraftStateRef.current = rebasedDraft;
      setDraftStateScoped((current) => {
        const rebased = rebaseSteelReviewDraftState(
          current,
          snapshot.rows,
          submittedChangeSequence,
        );
        exportRowsRef.current = applySteelReviewDrafts(snapshot.rows, rebased);
        return rebased;
      });
    },
    [
      captureId,
      dispatchSave,
      getCapturedAuthority,
      identity,
      persistCapturedAuthority,
      queryClient,
      setDialogState,
      setDraftStateScoped,
      table,
    ],
  );
  const applyConfirmedNoOp = useCallback(
    (currentTable: SteelReviewTable, submittedChangeSequence: number) => {
      persistCapturedAuthority({
        outputId: currentTable.outputId,
        revision: currentTable.revision,
        table: currentTable,
      });
      exportBaseRowsRef.current = currentTable.rows;
      setDialogState((state) => ({
        ...state,
        unlinkedMembershipOwner: captureId,
        unlinkedRowIds: getSteelReviewUnlinkedRowIds(currentTable.rows),
      }));
      const rebasedDraft = rebaseSteelReviewDraftState(
        latestDraftStateRef.current,
        currentTable.rows,
        submittedChangeSequence,
      );
      latestDraftStateRef.current = rebasedDraft;
      setDraftStateScoped((current) => {
        const rebased = rebaseSteelReviewDraftState(
          current,
          currentTable.rows,
          submittedChangeSequence,
        );
        exportRowsRef.current = applySteelReviewDrafts(currentTable.rows, rebased);
        return rebased;
      });
    },
    [captureId, persistCapturedAuthority, setDialogState, setDraftStateScoped],
  );
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
      dispatchSave({ type: 'saving', phase: preparedForCapture ? 'committing' : 'preparing' });
      try {
        const prepared =
          preparedForCapture ??
          (await prepareMutation.mutateAsync(
            (() => {
              const request = getSteelReviewPrepareInput(
                identity,
                baseTable,
                draftState,
                draftRows,
              );
              const recovery = getCaptureScopedValue(recoveryRef, initiatedCaptureId);
              return recovery && recovery.table.outputId === request.outputId
                ? { ...request, revision: recovery.table.revision }
                : request;
            })(),
          ));
        if (!isCurrentCapture(initiatedCaptureId, prepared.outputId)) {
          return false;
        }
        preparedRef.current = { captureId: initiatedCaptureId, value: prepared };
        dispatchSave({ type: 'saving', phase: 'committing' });
        commitAttempted = true;
        const saved = await commitMutation.mutateAsync(getSteelReviewCommitInput(prepared));
        if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
          return false;
        }
        if (saved.changedRows > 0 && !saved.savedSnapshot) {
          dispatchSave({ type: 'uncertain' });
          return false;
        }
        if (saved.changedRows === 0 && !saved.savedSnapshot) {
          const currentResult = await refetchCurrentReview();
          if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
            return false;
          }
          if (currentResult.error || !currentResult.data?.table) {
            dispatchSave({ type: 'uncertain' });
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
            dispatchSave({ type: 'uncertain' });
            return false;
          }
          if (!isAuthorizedCurrentTable(currentResult.data.table, prepared)) {
            const capturedBase = getCapturedAuthority(initiatedCaptureId)?.table;
            if (
              !sameSteelReviewScope(currentResult.data.table, prepared) ||
              !capturedBase ||
              !isCapturedAuthorityForPrepared(getCapturedAuthority(initiatedCaptureId), prepared)
            ) {
              preparedRef.current = undefined;
              dispatchSave({ type: 'stale', code: 'REVIEW_CONFLICT' });
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
            dispatchSave({ type: 'uncertain' });
            return false;
          }
          const refreshedMessages = await refetchAuthoritativeMessages();
          if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
            return false;
          }
          if (!refreshedMessages.authoritative) {
            dispatchSave({ type: 'uncertain' });
            return false;
          }
          const currentTableIsAuthorized = isAuthorizedCurrentTable(
            currentResult.data.table,
            prepared,
          );
          if (!sameSteelReviewScope(currentResult.data.table, prepared)) {
            preparedRef.current = undefined;
            dispatchSave({ type: 'stale', code: 'REVIEW_CONFLICT' });
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
            const messages = queryClient.getQueryData<TMessage[]>([
              QueryKeys.messages,
              identity.conversationId,
            ]);
            const canApplyMessageSnapshot = await canApplySteelReviewMessageSnapshot(
              messages,
              prepared,
              saved.savedSnapshot,
            );
            if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
              return false;
            }
            applyConfirmedSnapshot(
              saved.savedSnapshot,
              submittedChangeSequenceRef.current,
              canApplyMessageSnapshot,
            );
          } else {
            applyConfirmedNoOp(currentResult.data.table, submittedChangeSequenceRef.current);
          }
        }
        if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
          return false;
        }
        preparedRef.current = undefined;
        clearRecoveryRef();
        dispatchSave({ type: 'saved' });
        return true;
      } catch (error) {
        if (!isCurrentCapture(initiatedCaptureId, preparedForCapture?.outputId)) {
          return false;
        }
        const code = getSteelReviewErrorCode(error);
        const recovery = getSteelReviewErrorRecovery(error);
        if (
          code === 'REVIEW_CONFLICT' ||
          code === 'REVIEW_INVALID_OPERATION' ||
          code === 'REVIEW_NOT_FOUND'
        ) {
          preparedRef.current = undefined;
          dispatchSave({ type: 'stale', code });
          if (recovery) {
            adoptConflictRecovery(recovery);
          }
        } else if (commitAttempted) {
          dispatchSave({ type: 'uncertain' });
        } else {
          dispatchSave({ type: 'failed', code });
        }
        return false;
      }
    })();
    savePromiseRef.current = { captureId: initiatedCaptureId, value: promise };
    try {
      return await promise;
    } finally {
      if (
        savePromiseRef.current?.captureId === initiatedCaptureId &&
        savePromiseRef.current.value === promise
      ) {
        savePromiseRef.current = undefined;
      }
    }
  }, [
    adoptConflictRecovery,
    applyConfirmedNoOp,
    applyConfirmedSnapshot,
    baseTable,
    canSave,
    captureId,
    clearRecoveryRef,
    commitMutation,
    dirtyRowCount,
    dispatchSave,
    draftRows,
    draftState,
    getCapturedAuthority,
    hasActiveCapturedSession,
    identity,
    isCurrentCapture,
    prepareMutation,
    queryClient,
    refetchAuthoritativeMessages,
    refetchCurrentReview,
    savePhase,
    table,
  ]);
  const getCurrentReviewTable = useCallback(() => {
    const tableKey = DynamicQueryKeys.steelReview(
      identity.conversationId,
      identity.kind,
      identity.messageId,
      identity.title,
    );
    return queryClient.getQueryData<SteelReviewResponse>(tableKey)?.table ?? latestTableRef.current;
  }, [identity, queryClient]);
  const getExportMatrix = useCallback(() => {
    const currentTable = getCurrentReviewTable();
    return currentTable ? steelReviewRowsToMatrix(currentTable, exportRowsRef.current) : [];
  }, [getCurrentReviewTable]);
  const ensureSaved = useCallback(
    async (authority?: SteelReviewDownloadAuthority) => {
      const initiatedCaptureId = captureId;
      const initialTable = getCurrentReviewTable();
      if (
        authority &&
        (!initialTable ||
          initialTable.outputId !== authority.outputId ||
          initialTable.revision !== authority.revision)
      ) {
        return false;
      }
      const expectedAuthority = getCapturedAuthority(initiatedCaptureId);
      if (
        expectedAuthority &&
        (!initialTable || initialTable.outputId !== expectedAuthority.outputId)
      ) {
        return false;
      }
      if (!canSave && dirtyRowCount > 0) {
        return false;
      }
      if (savePhase === 'uncertain' || savePhase === 'reconciling') {
        return false;
      }
      const saved = await saveChanges();
      if (
        !saved ||
        (expectedAuthority && !hasCurrentCapturedSession(expectedAuthority, initiatedCaptureId))
      ) {
        return false;
      }
      const latestDraft = latestDraftStateRef.current;
      const currentTable = getCurrentReviewTable();
      const confirmedAuthority = getCapturedAuthority(initiatedCaptureId);
      if (
        !currentTable ||
        (authority && currentTable.outputId !== authority.outputId) ||
        (expectedAuthority && currentTable.outputId !== expectedAuthority.outputId)
      ) {
        return false;
      }
      const confirmedTable = confirmedAuthority?.table ?? currentTable;
      return getSteelReviewDirtyRowIds(confirmedTable, latestDraft).length === 0;
    },
    [
      canSave,
      captureId,
      dirtyRowCount,
      getCapturedAuthority,
      getCurrentReviewTable,
      hasCurrentCapturedSession,
      saveChanges,
      savePhase,
    ],
  );
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
    clearRecoveryRef();
    dispatchSave({ type: 'discarded' });
    clearCapturedAuthority();
    clearSelectionForCapture(captureId, capturedAuthority?.outputId);
  }, [
    capturedAuthority?.outputId,
    captureId,
    clearCapturedAuthority,
    clearRecoveryRef,
    clearSelectionForCapture,
    dispatchSave,
    draftStateKey,
    setDraftStateScoped,
  ]);
  const finishDiscardAtBoundary = useCallback(
    (rows: readonly SteelReviewRow[]) => {
      const boundary = discardBoundaryRef.current ?? latestDraftStateRef.current.changeSequence;
      const rebased = rebaseSteelReviewDraftState(latestDraftStateRef.current, rows, boundary);
      latestDraftStateRef.current = rebased;
      setDraftStateScoped(rebased);
      preparedRef.current = undefined;
      discardBoundaryRef.current = undefined;
      dispatchSave({ type: 'receipt_settled' });
      if (getSteelReviewDirtyRowIds({ rows }, rebased).length === 0) {
        clearCapturedAuthority();
        clearSelectionForCapture(captureId, getCapturedAuthority(captureId)?.outputId);
      }
    },
    [
      captureId,
      clearCapturedAuthority,
      clearSelectionForCapture,
      dispatchSave,
      getCapturedAuthority,
      setDraftStateScoped,
    ],
  );
  const requestReceiptBeforeDiscard = useCallback(() => {
    const prepared = getCaptureScopedValue(preparedRef, captureId);
    if (!prepared) {
      clearDraftAndClose();
      return;
    }
    discardBoundaryRef.current = latestDraftStateRef.current.changeSequence;
    if (!captureId) {
      return;
    }
    dispatchSave({
      type: 'reconcile',
      receiptInput: {
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
      },
    });
  }, [captureId, clearDraftAndClose, dispatchSave]);
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
    dispatchSave({ type: 'retry_receipt' });
  }, [captureId, dispatchSave, receiptInput]);
  const requestClose = useCallback(() => {
    if (saveBusy) {
      return;
    }
    if (dirtyRowCount > 0) {
      dispatchSave({ type: 'close_requested', value: true });
      return;
    }
    clearCapturedAuthority();
    clearSelectionForCapture(captureId, getCapturedAuthority(captureId)?.outputId);
  }, [
    captureId,
    clearCapturedAuthority,
    clearSelectionForCapture,
    dirtyRowCount,
    dispatchSave,
    getCapturedAuthority,
    saveBusy,
  ]);
  useEffect(() => {
    if (!discardRequested || !receiptInput) {
      return undefined;
    }
    const initiatedCaptureId = receiptInput.captureId;
    const receiptEffectKey = getSteelReviewReceiptEffectKey(receiptInput);
    // React Query may publish the newer owner while this receipt is awaiting
    // its current-review/messages reads. Keep one reconciliation alive for
    // that captured operation; callback identity changes must not cancel the
    // old operation before it can acknowledge and close its own session.
    if (receiptEffectKeyRef.current === receiptEffectKey) {
      return undefined;
    }
    receiptEffectKeyRef.current = receiptEffectKey;
    let active = true;
    const isReceiptRunActive = () =>
      active && latestReceiptEffectKeyRef.current === receiptEffectKey;
    void refetchReceipt()
      .then(async (result) => {
        if (!isReceiptRunActive() || !isCurrentCapture(initiatedCaptureId)) {
          return;
        }
        if (result.error || !result.data) {
          dispatchSave({ type: 'receipt_failed', code: getSteelReviewErrorCode(result.error) });
          return;
        }
        const status: SteelReviewReceiptStatus = result.data;
        const currentResult = await refetchCurrentReview();
        if (!isReceiptRunActive() || !isCurrentCapture(initiatedCaptureId)) {
          return;
        }
        if (currentResult.error || !currentResult.data?.table) {
          dispatchSave({ type: 'receipt_failed', code: undefined });
          return;
        }
        if (status.status === 'committed') {
          const prepared = getCaptureScopedValue(preparedRef, initiatedCaptureId);
          if (!prepared) {
            preparedRef.current = undefined;
            dispatchSave({ type: 'receipt_stale' });
            return;
          }
          if (!hasActiveCapturedSession(prepared, initiatedCaptureId)) {
            return;
          }
          const currentTableIsAuthorized = isAuthorizedCurrentTable(
            currentResult.data.table,
            prepared,
          );
          const currentTableMatchesScope = sameSteelReviewScope(currentResult.data.table, prepared);
          const capturedAuthorityMatches = isCapturedAuthorityForPrepared(
            getCapturedAuthority(initiatedCaptureId),
            prepared,
          );
          if (
            !currentTableMatchesScope ||
            (!currentTableIsAuthorized && !capturedAuthorityMatches)
          ) {
            preparedRef.current = undefined;
            dispatchSave({ type: 'receipt_stale' });
            return;
          }
          const refreshedMessages = await refetchAuthoritativeMessages();
          if (!isReceiptRunActive() || !hasActiveCapturedSession(prepared, initiatedCaptureId)) {
            return;
          }
          if (!refreshedMessages.authoritative) {
            dispatchSave({ type: 'receipt_failed' });
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
            const messages = queryClient.getQueryData<TMessage[]>([
              QueryKeys.messages,
              identity.conversationId,
            ]);
            const canApplyMessageSnapshot = await canApplySteelReviewMessageSnapshot(
              messages,
              prepared,
              status.snapshot,
            );
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
          const rebased = rebaseSteelReviewDraftState(currentDraft, status.snapshot.rows, boundary);
          latestDraftStateRef.current = rebased;
          setDraftStateScoped(rebased);
          preparedRef.current = undefined;
          discardBoundaryRef.current = undefined;
          dispatchSave({ type: 'receipt_settled' });
          if (getSteelReviewDirtyRowIds({ rows: status.snapshot.rows }, rebased).length === 0) {
            clearCapturedAuthority();
            clearSelectionForCapture(initiatedCaptureId, prepared.outputId);
          }
          return;
        }
        finishDiscardAtBoundary(currentResult.data.table.rows);
      })
      .catch(() => {
        if (isReceiptRunActive() && isCurrentCapture(initiatedCaptureId)) {
          dispatchSave({ type: 'receipt_failed', code: undefined });
        }
      })
      .finally(() => {
        if (receiptEffectKeyRef.current === receiptEffectKey) {
          receiptEffectKeyRef.current = undefined;
        }
      });
    return () => {
      if (receiptEffectKeyRef.current !== receiptEffectKey) {
        active = false;
      }
    };
  }, [
    applyConfirmedNoOp,
    applyConfirmedSnapshot,
    clearCapturedAuthority,
    clearSelectionForCapture,
    discardRequested,
    dispatchSave,
    draftStateAtom,
    finishDiscardAtBoundary,
    getCapturedAuthority,
    hasActiveCapturedSession,
    identity.conversationId,
    isCurrentCapture,
    queryClient,
    receiptInput,
    refetchAuthoritativeMessages,
    refetchCurrentReview,
    refetchReceipt,
    setDraftStateScoped,
    store,
  ]);
  const saveAndClose = useCallback(async () => {
    const initiatedCaptureId = captureId;
    const expectedAuthority = getCapturedAuthority(initiatedCaptureId);
    const saved = await saveChanges();
    if (
      !saved ||
      !table ||
      !initiatedCaptureId ||
      (expectedAuthority && !hasCurrentCapturedSession(expectedAuthority, initiatedCaptureId))
    ) {
      return;
    }
    const latestDraft = latestDraftStateRef.current;
    const confirmedTable = getCapturedAuthority(initiatedCaptureId)?.table ?? table;
    if (getSteelReviewDirtyRowIds(confirmedTable, latestDraft).length === 0) {
      dispatchSave({ type: 'close_requested', value: false });
      clearCapturedAuthority();
      clearSelectionForCapture(initiatedCaptureId, expectedAuthority?.outputId);
    }
  }, [
    captureId,
    clearCapturedAuthority,
    clearSelectionForCapture,
    dispatchSave,
    getCapturedAuthority,
    hasCurrentCapturedSession,
    saveChanges,
    table,
  ]);
  const continueEditing = useCallback(
    () => dispatchSave({ type: 'close_requested', value: false }),
    [dispatchSave],
  );
  return {
    closeRequested,
    savePhase,
    saveErrorCode,
    saveRecovery,
    confirmedSave,
    receiptInput,
    receiptFailed,
    saveBusy,
    canEdit,
    canSave,
    preparedForCapture: getCaptureScopedValue(preparedRef, captureId),
    updateDraftRows,
    getRecoveryRow,
    resolveConflict,
    saveAndClose,
    discardDraftAndClose,
    retryReceiptLookup,
    requestClose,
    continueEditing,
  };
}
