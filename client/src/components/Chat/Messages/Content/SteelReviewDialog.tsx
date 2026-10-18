import { useCallback, useContext, useEffect, useId, useMemo } from 'react';
import { useAtom, useStore } from 'jotai';
import { X, Plus, ChevronsUpDown, ChevronsDownUp, AlertTriangle } from 'lucide-react';
import {
  Button,
  Checkbox,
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
  TooltipAnchor,
  useMediaQuery,
} from '@librechat/client';
import type {
  SteelCatalogCandidate,
  SteelCatalogPricing,
  SteelReviewConflict,
  SteelReviewRow,
  SteelReviewSource,
  SteelProcessingMeasurement,
} from 'librechat-data-provider';
import type { MutableRefObject } from 'react';
import type { SteelReviewIdentity } from './SteelReview/state';
import type { SteelReviewDraftState } from './SteelReview/session';
import type { SteelReviewPreviewRows } from './SteelReview/filter';
import type { SteelReviewSaveStatus } from './SteelReview/Status';
import type { SteelReviewSaveGate } from './SteelReview/save';
import {
  addSteelReviewDraftRow,
  applySteelReviewDrafts,
  areSteelReviewDraftOwnersSame,
  createSteelReviewDraftState,
  deleteSteelReviewDraftRow,
  deleteSteelReviewDraftGroup,
  getSteelReviewDirtyRowIds,
  getSteelReviewDraftKey,
  getSteelReviewDraftOwnerKey,
  restoreSteelReviewDraftGroup,
  restoreSteelReviewDraftRow,
  setSteelReviewDraftCandidate,
  setSteelReviewDraftCell,
  setSteelReviewDraftMeasurement,
  setSteelReviewDraftSource,
  setSteelReviewDraftSystem,
} from './SteelReview/session';
import { useGetSteelReviewQuery } from '~/data-provider';
import {
  steelReviewDialogStateFamily,
  steelReviewDraftStateFamily,
  steelReviewIdentityKey,
  steelReviewSelectionAtom,
  steelReviewSourcePreviewKey,
  markSteelReviewRowBound,
} from './SteelReview/state';
import {
  createSteelReviewOcrContextTable,
  getSteelReviewOcrContext,
  getSteelReviewReferenceRows,
} from './SteelReview/reference';
import { getSteelReviewPreviewRows, getSteelReviewUnlinkedRowIds } from './SteelReview/filter';
import { isCurrentOwner, isLiveCapture } from './SteelReview/authority';
import { getSteelReviewSaveErrorKey, getSteelReviewErrorStatus } from './SteelReview/save';
import {
  useCapturedAuthority,
  useSteelReviewSave,
  useSteelReviewSources,
} from './SteelReview/hooks';
import SteelReviewSourcePreview from './SteelReview/SourcePreview';
import { SteelVersionsContext } from './SteelReview/heading';
import translationEn from '~/locales/en/translation.json';
import SteelReviewEditor from './SteelReview/Editor';
import SteelReviewSplit from './SteelReview/Split';
import SteelReviewBadge from './SteelReview/Badge';
import ReviewStatus from './SteelReview/Status';
import { useLocalize } from '~/hooks';

export type { SteelReviewDownloadAuthority, SteelReviewSaveGate } from './SteelReview/save';

interface SteelReviewDialogProps {
  identity: SteelReviewIdentity;
  downloadFilename?: string;
  saveGateRef?: MutableRefObject<SteelReviewSaveGate | undefined>;
}

export default function SteelReviewDialog({ identity, saveGateRef }: SteelReviewDialogProps) {
  const localize = useLocalize();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const versions = useContext(SteelVersionsContext);
  const sourceEditorLabels = useMemo(
    () => ({
      emptyCategory: localize('com_ui_no_category'),
      action: localize('com_ui_steel_review_action'),
      deleteRow: localize('com_ui_steel_review_delete_row'),
      restoreRow: localize('com_ui_steel_review_restore_row'),
    }),
    [localize],
  );
  const [selection, setSelection] = useAtom(steelReviewSelectionAtom);
  const store = useStore();
  const isOpen =
    selection != null &&
    selection.conversationId === identity.conversationId &&
    selection.messageId === identity.messageId &&
    selection.kind === identity.kind &&
    selection.title === identity.title;
  const query = useGetSteelReviewQuery(isOpen ? identity : null, { retry: false });
  const isNotFound = getSteelReviewErrorStatus(query.error) === 404;
  const liveTable = query.data?.table;
  const liveVersion =
    liveTable &&
    versions.get(
      JSON.stringify([liveTable.messageId, liveTable.kind, liveTable.title, liveTable.outputId]),
    );
  const table = useMemo(
    () =>
      liveTable && liveVersion?.latest === false
        ? { ...liveTable, isLatest: false, readOnly: true, previousVersion: true }
        : liveTable,
    [liveTable, liveVersion?.latest],
  );
  const captureId = selection?.captureId;
  const dialogStateKey = `${steelReviewIdentityKey(identity)}:${captureId ?? 'pending'}`;
  const [dialogState, setDialogState] = useAtom(steelReviewDialogStateFamily(dialogStateKey));
  const {
    getCapturedAuthority,
    hasActiveCapturedSession,
    hasCurrentCapturedSession,
    isCurrentCapture,
    clearSelectionForCapture,
    persistCapturedAuthority,
    clearCapturedAuthority,
  } = useCapturedAuthority({ identity, isOpen, captureId, selection, setSelection, table });
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
  const setDraftStateScoped = useCallback(
    (
      update: SteelReviewDraftState | ((current: SteelReviewDraftState) => SteelReviewDraftState),
    ) => {
      if (!captureId) {
        return;
      }
      setDraftState((current) => {
        if (!isLiveCapture(store.get(steelReviewSelectionAtom), captureId, identity)) {
          return current;
        }
        return typeof update === 'function' ? update(current) : update;
      });
    },
    [captureId, identity, setDraftState, store],
  );
  const dirtyRowIds = useMemo(
    () => (baseTable ? getSteelReviewDirtyRowIds(baseTable, draftState) : []),
    [baseTable, draftState],
  );
  const dirtyRowCount = dirtyRowIds.length;
  const draftRows = useMemo(
    () =>
      baseTable
        ? applySteelReviewDrafts(baseTable.rows, draftState, true, baseTable.sourceMappings)
        : [],
    [baseTable, draftState],
  );
  const canEditTable = Boolean(
    table &&
      (table.kind === 'ocr_result' || table.kind === 'system_order') &&
      table.isLatest &&
      table.latestOutputId === table.outputId &&
      !table.readOnly &&
      (!capturedAuthority || table.outputId === capturedAuthority.outputId),
  );
  const {
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
    preparedForCapture,
    updateDraftRows,
    getRecoveryRow,
    resolveConflict,
    saveAndClose,
    discardDraftAndClose,
    retryReceiptLookup,
    requestClose,
    continueEditing,
  } = useSteelReviewSave({
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
    authority: {
      getCapturedAuthority,
      hasActiveCapturedSession,
      hasCurrentCapturedSession,
      isCurrentCapture,
      clearSelectionForCapture,
      persistCapturedAuthority,
      clearCapturedAuthority,
    },
  });
  const { unlinkedMode, unlinkedRowIds } = dialogState;
  const canEditStructure = canEdit;
  const canEditSources =
    canEdit && (table?.kind === 'ocr_result' || table?.kind === 'system_order');
  const {
    sources,
    sourcesReady,
    selectedSource,
    pageCount,
    pageNumber,
    sourceCorrectionFile,
    sourceCorrectionRow,
    sourceCorrectionPageCount,
    sourceCorrectionPageLoading,
    sourceCorrectionPageError,
    sourceCorrectionCanConfirm,
    sourcesQuery,
    sourceQuery,
    sourcePageCountQuery,
    onPageCount,
    goPrevious,
    goNext,
  } = useSteelReviewSources({
    identity,
    isOpen,
    tableKind: table?.kind,
    baseTableKind: baseTable?.kind,
    draftRows,
    dialogState,
    setDialogState,
    canEditSources,
  });
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
  const previewRows: SteelReviewPreviewRows = useMemo(
    () =>
      getSteelReviewPreviewRows(
        draftRows,
        selectedSource?.fileId,
        pageNumber,
        new Set(sources.map((source) => source.fileId)),
        pageCount,
        unlinkedMode ? new Set(unlinkedRowIds) : undefined,
        new Set(
          draftRows
            .filter((row) => {
              if (row.system?.kind !== 'processing' || row.system.parentRowId) return false;
              const editingSource =
                draftState.rowStates[row.rowId]?.source ??
                baseTable?.rows.find((candidate) => candidate.rowId === row.rowId)?.source;
              return (
                editingSource?.fileId === selectedSource?.fileId &&
                editingSource?.pageNumber === pageNumber
              );
            })
            .map((row) => row.rowId),
        ),
      ),
    [
      baseTable,
      draftRows,
      draftState.rowStates,
      pageCount,
      pageNumber,
      selectedSource?.fileId,
      sources,
      unlinkedMode,
      unlinkedRowIds,
    ],
  );
  let editorRows = draftRows;
  if (!sourcesReady) editorRows = [];
  else if (unlinkedMode) editorRows = previewRows.unlocated;
  else if (selectedSource) editorRows = previewRows.located;
  const ocrContext =
    baseTable?.kind === 'system_order' ? getSteelReviewOcrContext(baseTable) : null;
  const ocrReferenceTable = useMemo(
    () =>
      ocrContext && baseTable ? createSteelReviewOcrContextTable(baseTable, ocrContext) : undefined,
    [baseTable, ocrContext],
  );
  const ocrReference =
    baseTable && ocrReferenceTable && !unlinkedMode
      ? getSteelReviewReferenceRows(
          baseTable,
          editorRows,
          selectedSource?.fileId,
          pageNumber,
          baseTable.rows,
        )
      : { mode: 'none' as const, rows: [] };
  const ocrReferenceDraft = useMemo(
    () =>
      ocrReferenceTable
        ? createSteelReviewDraftState(
            `ocr-reference:${getSteelReviewDraftKey(identity, ocrReferenceTable)}`,
          )
        : undefined,
    [identity, ocrReferenceTable],
  );
  const recoveryIndicators = useMemo(() => {
    const fileIds = new Set<string>();
    const pageKeys = new Set<string>();
    let hasUnlocated = false;
    if (!saveRecovery) {
      return { fileIds, pageKeys, hasUnlocated };
    }
    const rowsById = new Map(saveRecovery.table.rows.map((row) => [row.rowId, row]));
    const addSource = (
      source: { fileId: string | null; pageNumber: number | null } | null | undefined,
    ) => {
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
  const membershipOwner = captureId ? captureId : undefined;
  useEffect(() => {
    if (!membershipOwner || !baseTable || dialogState.unlinkedMembershipOwner === membershipOwner)
      return;
    setDialogState((state) => ({
      ...state,
      unlinkedMembershipOwner: membershipOwner,
      unlinkedRowIds: getSteelReviewUnlinkedRowIds(baseTable.rows),
    }));
  }, [baseTable, dialogState.unlinkedMembershipOwner, membershipOwner, setDialogState]);
  useEffect(() => {
    if (
      !membershipOwner ||
      dialogState.unlinkedMembershipOwner !== membershipOwner ||
      !unlinkedMode
    )
      return;
    const manualUnlinkedIds = draftRows
      .filter(
        (row) =>
          row.origin === 'manual' &&
          !row.deleted &&
          (!row.source?.fileId || row.source.pageNumber === null),
      )
      .map((row) => row.rowId);
    if (manualUnlinkedIds.every((rowId) => unlinkedRowIds.includes(rowId))) return;
    setDialogState((state) => ({
      ...state,
      unlinkedRowIds: [...new Set([...state.unlinkedRowIds, ...manualUnlinkedIds])],
    }));
  }, [
    dialogState.unlinkedMembershipOwner,
    draftRows,
    membershipOwner,
    setDialogState,
    unlinkedMode,
    unlinkedRowIds,
  ]);
  const onCellChange = useCallback(
    (row: SteelReviewRow, header: string, value: string) => {
      if (!table || !canEdit || saveBusy || !row.rowId) {
        return;
      }
      setDraftStateScoped((current) => {
        const ownerDraft =
          current.ownerKey === draftStateKey ? current : createSteelReviewDraftState(draftStateKey);
        const baseRow =
          (baseTable?.rows ?? []).find((candidate) => candidate.rowId === row.rowId) ?? row;
        return updateDraftRows(setSteelReviewDraftCell(ownerDraft, baseRow, header, value));
      });
    },
    [baseTable, canEdit, draftStateKey, saveBusy, setDraftStateScoped, table, updateDraftRows],
  );

  const onMeasurementChange = useCallback(
    (row: SteelReviewRow, measurement: SteelProcessingMeasurement | null) => {
      if (!table || !canEdit || saveBusy || !row.rowId || row.system?.kind !== 'processing') return;
      setDraftStateScoped((current) => {
        const ownerDraft =
          current.ownerKey === draftStateKey ? current : createSteelReviewDraftState(draftStateKey);
        return setSteelReviewDraftMeasurement(ownerDraft, row, measurement);
      });
    },
    [canEdit, draftStateKey, saveBusy, setDraftStateScoped, table],
  );

  const onCandidateChange = useCallback(
    (row: SteelReviewRow, candidate: SteelCatalogCandidate, pricing: SteelCatalogPricing) => {
      const editTable = baseTable ?? table;
      if (
        !editTable ||
        !canEdit ||
        saveBusy ||
        !row.rowId ||
        row.deleted ||
        !row.system ||
        row.system.kind === 'unassigned'
      )
        return;
      const parent =
        row.system.kind === 'processing'
          ? draftRows.find((material) => material.rowId === row.system?.parentRowId)
          : undefined;
      setDraftStateScoped((current) => {
        const ownerDraft =
          current.ownerKey === draftStateKey ? current : createSteelReviewDraftState(draftStateKey);
        return setSteelReviewDraftCandidate(ownerDraft, editTable, row, candidate, pricing, parent);
      });
    },
    [baseTable, table, canEdit, saveBusy, draftRows, draftStateKey, setDraftStateScoped],
  );

  const onSourceEdit = useCallback(
    (row: SteelReviewRow) => {
      if (
        !canEditSources ||
        saveBusy ||
        !row.rowId ||
        row.system?.kind === 'processing' ||
        !selectedSource
      ) {
        return;
      }
      setDialogState((state) => ({
        ...state,
        sourceCorrectionRowId: row.rowId,
        sourceCorrectionFileId: selectedSource.fileId,
        sourceCorrectionPageNumber: selectedSource.mediaType.startsWith('image/') ? 1 : pageNumber,
      }));
    },
    [canEditSources, pageNumber, saveBusy, selectedSource, setDialogState],
  );
  const onSourceChange = useCallback(
    (row: SteelReviewRow, source: SteelReviewSource | null) => {
      if (
        !table ||
        !canEditSources ||
        saveBusy ||
        !row.rowId ||
        row.system?.kind === 'processing'
      ) {
        return;
      }
      setDraftStateScoped((current) => {
        const ownerDraft =
          current.ownerKey === draftStateKey ? current : createSteelReviewDraftState(draftStateKey);
        const baseRow =
          (baseTable?.rows ?? []).find((candidate) => candidate.rowId === row.rowId) ?? row;
        return updateDraftRows(setSteelReviewDraftSource(ownerDraft, baseRow, source));
      });
    },
    [
      baseTable,
      canEditSources,
      draftStateKey,
      saveBusy,
      setDraftStateScoped,
      table,
      updateDraftRows,
    ],
  );
  const closeSourceCorrection = useCallback(() => {
    setDialogState((state) => ({
      ...state,
      sourceCorrectionRowId: undefined,
      sourceCorrectionFileId: undefined,
      sourceCorrectionPageNumber: undefined,
    }));
  }, [setDialogState]);
  const confirmSourceCorrection = useCallback(() => {
    if (!sourceCorrectionCanConfirm || !sourceCorrectionRow || !sourceCorrectionFile) return;
    const selectedPage = dialogState.sourceCorrectionPageNumber ?? 1;
    onSourceChange(sourceCorrectionRow, {
      fileId: sourceCorrectionFile.fileId,
      filename: sourceCorrectionFile.filename,
      mediaType: sourceCorrectionFile.mediaType,
      pageNumber: selectedPage,
    });
    setDialogState((state) => ({
      ...markSteelReviewRowBound(state, sourceCorrectionRow.rowId),
      selectedFileId: sourceCorrectionFile.fileId,
      pageNumber: selectedPage,
      initializedSourceId: sourceCorrectionFile.fileId,
    }));
    closeSourceCorrection();
  }, [
    closeSourceCorrection,
    dialogState.sourceCorrectionPageNumber,
    onSourceChange,
    setDialogState,
    sourceCorrectionCanConfirm,
    sourceCorrectionFile,
    sourceCorrectionRow,
  ]);
  const applyLatestConflictValue = useCallback(
    (conflict: SteelReviewConflict) => {
      const row = getRecoveryRow(conflict);
      if (!row) {
        return;
      }
      if (conflict.kind === 'field') {
        onCellChange(row, conflict.header, conflict.current ?? '');
      } else if (conflict.kind === 'measurement') {
        onMeasurementChange(row, conflict.current);
      } else if (conflict.kind === 'source') {
        const latest = conflict.current;
        const source =
          latest && latest.fileId
            ? {
                fileId: latest.fileId,
                pageNumber: latest.pageNumber,
                ...sources.find((candidate) => candidate.fileId === latest.fileId),
              }
            : null;
        onSourceChange(row, source);
      }
      resolveConflict(conflict);
    },
    [getRecoveryRow, onCellChange, onMeasurementChange, onSourceChange, resolveConflict, sources],
  );
  const onAddRow = useCallback(() => {
    const editTable = baseTable ?? table;
    if (!editTable || !canEditStructure || saveBusy || !sourcesReady) return;
    setDraftStateScoped((current) => {
      const ownerDraft =
        current.ownerKey === draftStateKey ? current : createSteelReviewDraftState(draftStateKey);
      const anchor = [...draftRows]
        .reverse()
        .find(
          (row) =>
            !row.deleted &&
            (unlinkedMode ||
              !selectedSource ||
              (row.source?.fileId === selectedSource.fileId &&
                row.source.pageNumber === pageNumber)),
        );
      const source =
        !unlinkedMode && selectedSource
          ? {
              fileId: selectedSource.fileId,
              pageNumber,
              filename: selectedSource.filename,
              mediaType: selectedSource.mediaType,
            }
          : null;
      const system =
        editTable.kind === 'system_order'
          ? { kind: 'unassigned' as const, parentRowId: null, cascadeDeletedBy: null }
          : undefined;
      return updateDraftRows(addSteelReviewDraftRow(ownerDraft, editTable, anchor, source, system));
    });
  }, [
    baseTable,
    canEditStructure,
    draftRows,
    draftStateKey,
    pageNumber,
    saveBusy,
    selectedSource,
    setDraftStateScoped,
    sourcesReady,
    table,
    unlinkedMode,
    updateDraftRows,
  ]);
  const onClassify = useCallback(
    (row: SteelReviewRow, kind: 'material' | 'processing') => {
      if (
        !canEditStructure ||
        saveBusy ||
        table?.kind !== 'system_order' ||
        row.system?.kind !== 'unassigned'
      )
        return;
      setDraftStateScoped((current) => {
        const ownerDraft =
          current.ownerKey === draftStateKey ? current : createSteelReviewDraftState(draftStateKey);
        return updateDraftRows(
          setSteelReviewDraftSystem(ownerDraft, row, {
            kind,
            parentRowId: null,
            cascadeDeletedBy: null,
          }),
        );
      });
    },
    [canEditStructure, draftStateKey, saveBusy, setDraftStateScoped, table?.kind, updateDraftRows],
  );
  const onDeleteGroup = useCallback(
    (row: SteelReviewRow) => {
      const editTable = baseTable ?? table;
      if (
        !editTable ||
        !canEditStructure ||
        saveBusy ||
        editTable.kind !== 'system_order' ||
        row.system?.kind !== 'material'
      )
        return;
      setDraftStateScoped((current) => {
        const ownerDraft =
          current.ownerKey === draftStateKey ? current : createSteelReviewDraftState(draftStateKey);
        const currentRows = applySteelReviewDrafts(editTable.rows, ownerDraft);
        return updateDraftRows(
          deleteSteelReviewDraftGroup(ownerDraft, currentRows, row, editTable.rows),
        );
      });
    },
    [
      baseTable,
      canEditStructure,
      draftStateKey,
      saveBusy,
      setDraftStateScoped,
      table,
      updateDraftRows,
    ],
  );
  const onDeleteRow = useCallback(
    (row: SteelReviewRow) => {
      const editTable = baseTable ?? table;
      if (!editTable || !canEditStructure || saveBusy) return;
      setDraftStateScoped((current) => {
        const ownerDraft =
          current.ownerKey === draftStateKey ? current : createSteelReviewDraftState(draftStateKey);
        const isSaved = editTable.rows.some((candidate) => candidate.rowId === row.rowId);
        return updateDraftRows(deleteSteelReviewDraftRow(ownerDraft, row, isSaved));
      });
    },
    [
      baseTable,
      canEditStructure,
      draftStateKey,
      saveBusy,
      setDraftStateScoped,
      table,
      updateDraftRows,
    ],
  );
  const onRestoreRow = useCallback(
    (row: SteelReviewRow) => {
      if (!(baseTable ?? table) || !canEditStructure || saveBusy) return;
      setDraftStateScoped((current) => {
        const ownerDraft =
          current.ownerKey === draftStateKey ? current : createSteelReviewDraftState(draftStateKey);
        return updateDraftRows(
          row.system?.kind === 'material'
            ? restoreSteelReviewDraftGroup(ownerDraft, draftRows, row)
            : restoreSteelReviewDraftRow(ownerDraft, row),
        );
      });
    },
    [
      baseTable,
      canEditStructure,
      draftRows,
      draftStateKey,
      saveBusy,
      setDraftStateScoped,
      table,
      updateDraftRows,
    ],
  );
  const saveDisabled = !canSave || dirtyRowCount === 0 || saveBusy;
  const saveLabel =
    dirtyRowCount === 0
      ? localize('com_ui_steel_review_save')
      : localize('com_ui_steel_review_save_count', {
          0: dirtyRowCount,
          defaultValue: `${localize('com_ui_steel_review_save')} ({{0}})`,
        });
  const saveErrorKey = getSteelReviewSaveErrorKey(savePhase, saveErrorCode);
  const preparedRowCount =
    saveBusy && preparedForCapture && table && isCurrentOwner(table, preparedForCapture)
      ? preparedForCapture.caption.changedRows
      : undefined;
  const confirmedRowCount =
    confirmedSave && isCurrentOwner(table, confirmedSave) ? confirmedSave.changedRows : undefined;
  const isSystemOrder = table?.kind === 'system_order';
  const ocrReferenceContentId = useId();
  const ocrReferenceCollapsed = dialogState.ocrReferenceCollapsed === true;
  const ocrReferenceToggleLabel = localize(
    ocrReferenceCollapsed ? 'com_ui_expand' : 'com_ui_collapse',
  );
  const preparedQuoteRowCount = preparedForCapture?.caption.customerQuoteChangedRows;
  const confirmedQuoteRowCount =
    confirmedSave && isCurrentOwner(table, confirmedSave)
      ? confirmedSave.customerQuoteChangedRows
      : undefined;
  const quoteTotal =
    preparedForCapture?.caption.customerQuoteTotal ?? confirmedSave?.customerQuoteTotal ?? null;

  const hasSaveError = Boolean(
    saveErrorCode ||
      ['uncertain', 'stale', 'error'].includes(savePhase) ||
      (savePhase === 'reconciling' && receiptFailed),
  );
  const savingRowCount = preparedRowCount ?? dirtyRowCount;
  let saveStatus: SteelReviewSaveStatus | undefined;
  if (hasSaveError) {
    saveStatus = { kind: 'error', message: localize(saveErrorKey) };
  } else if (saveBusy) {
    let message = localize('com_ui_steel_review_saving');
    if (savePhase === 'reconciling') {
      message = localize('com_ui_steel_review_reconciling');
    } else if (preparedRowCount !== undefined && isSystemOrder) {
      const key =
        preparedRowCount === 1
          ? 'com_ui_steel_review_system_saving_caption_one'
          : 'com_ui_steel_review_system_saving_caption';
      message = localize(key, {
        0: preparedRowCount,
        1: preparedQuoteRowCount ?? 0,
        2: quoteTotal ?? '—',
        defaultValue: translationEn[key],
      });
    } else if (savingRowCount > 0) {
      const key =
        savingRowCount === 1
          ? 'com_ui_steel_review_saving_count_one'
          : 'com_ui_steel_review_saving_count';
      message = localize(key, {
        0: savingRowCount,
        defaultValue: translationEn[key],
      });
    }
    saveStatus = { kind: 'saving', message };
  } else if (confirmedRowCount !== undefined) {
    saveStatus = {
      kind: 'success',
      message: isSystemOrder
        ? localize('com_ui_steel_review_system_updated_caption', {
            0: confirmedRowCount,
            1: confirmedQuoteRowCount ?? 0,
            2: quoteTotal ?? '—',
          })
        : localize('com_ui_steel_review_updated_caption', { 0: confirmedRowCount }),
    };
  }

  const sourceControls =
    !query.isLoading && !query.isError && table && (sources.length > 0 || !sourcesReady) ? (
      <div
        className={
          isDesktop
            ? 'grid min-w-0 flex-1 grid-cols-[minmax(0,16rem)_auto] items-center justify-center gap-3'
            : 'grid min-w-0 grid-cols-[minmax(0,12rem)_auto] items-center justify-center gap-3 rounded-md border border-border-light p-3'
        }
      >
        <label className="flex min-w-0 flex-col gap-1 text-sm text-text-secondary">
          <span className="sr-only">{localize('com_ui_steel_review_source')}</span>
          <Select
            value={selectedSource?.fileId ?? ''}
            disabled={!sourcesReady}
            onValueChange={(value) =>
              setDialogState((state) => ({
                ...state,
                selectedFileId: value || undefined,
                pageNumber: 1,
                initializedSourceId: value || undefined,
              }))
            }
          >
            <SelectTrigger aria-label={localize('com_ui_steel_review_source')} className="w-full">
              <SelectValue placeholder={localize('com_ui_steel_review_source')} />
            </SelectTrigger>
            <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
              {sources.map((source) => (
                <SelectItem key={source.fileId} value={source.fileId}>
                  <span className="inline-flex items-center gap-2">
                    {source.filename}
                    {recoveryIndicators.fileIds.has(source.fileId) && (
                      <span
                        className="text-text-destructive"
                        role="img"
                        aria-label={localize('com_ui_steel_review_conflicts_on_file')}
                      >
                        <AlertTriangle className="size-4" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            aria-label={localize('com_ui_steel_review_previous_page')}
            onClick={goPrevious}
            disabled={!sourcesReady || pageNumber <= 1}
          >
            ‹
          </Button>
          <label className="flex flex-col gap-1 text-sm text-text-secondary">
            <span className="sr-only">{localize('com_ui_steel_review_page')}</span>
            <Select
              value={String(pageNumber)}
              disabled={!sourcesReady}
              onValueChange={(value) =>
                setDialogState((state) => ({ ...state, pageNumber: Number(value) }))
              }
            >
              <SelectTrigger aria-label={localize('com_ui_steel_review_page')} className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
                {Array.from(
                  { length: Math.max(1, pageCount, pageNumber) },
                  (_, index) => index + 1,
                ).map((page) => (
                  <SelectItem key={page} value={String(page)}>
                    <span className="inline-flex items-center gap-2">
                      {page}
                      {recoveryIndicators.pageKeys.has(`${selectedSource?.fileId}:${page}`) && (
                        <span
                          className="text-text-destructive"
                          role="img"
                          aria-label={localize('com_ui_steel_review_conflicts_on_page')}
                        >
                          <AlertTriangle className="size-4" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button
            type="button"
            variant="outline"
            aria-label={localize('com_ui_steel_review_next_page')}
            onClick={goNext}
            disabled={!sourcesReady || (pageCount > 0 && pageNumber >= pageCount)}
          >
            ›
          </Button>
        </div>
      </div>
    ) : null;

  const saveFeedback = (
    <ReviewStatus status={saveStatus}>
      {receiptFailed && receiptInput && (
        <Button type="button" variant="outline" size="sm" onClick={retryReceiptLookup}>
          {localize('com_ui_steel_review_receipt_retry')}
        </Button>
      )}
    </ReviewStatus>
  );
  const sourceNavigation = saveStatus ? (
    <div
      className={`flex min-h-10 min-w-0 items-center justify-center ${isDesktop ? 'flex-1' : 'shrink-0'}`}
    >
      {saveFeedback}
    </div>
  ) : (
    sourceControls
  );

  return (
    <OGDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && isOpen) requestClose();
      }}
    >
      <OGDialogContent
        aria-label={localize('com_ui_steel_review_title')}
        aria-describedby={undefined}
        showCloseButton={false}
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-4 overflow-hidden rounded-none p-4"
        onEscapeKeyDown={(event) => {
          if (saveBusy || dialogState.sourceCorrectionRowId) {
            event.preventDefault();
            return;
          }
          const input = event.target;
          if (
            (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) &&
            input.dataset.steelReviewDeferred
          ) {
            event.preventDefault();
            input.blur();
          }
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault();
          const input = document.activeElement;
          if (
            (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) &&
            input.dataset.steelReviewDeferred
          ) {
            input.blur();
          }
        }}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            target.isContentEditable ||
            ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
          ) {
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
        <OGDialogTitle className="sr-only">{localize('com_ui_steel_review_title')}</OGDialogTitle>
        <div className="min-h-0 flex-1" aria-live="polite">
          {query.isLoading && <p>{localize('com_ui_steel_review_loading')}</p>}
          {!query.isLoading &&
            (isNotFound || (!query.isError && (!table || table.rows.length === 0))) && (
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
            <div className="flex h-full min-h-0 flex-col gap-3">
              {sourcesReady && sourcesQuery.isError && (
                <div className="space-y-2" role="alert">
                  <p>{localize('com_ui_steel_review_sources_error')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void sourcesQuery.refetch()}
                  >
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
                      const conflictRowIndex = saveRecovery.table.rows.findIndex(
                        (row) => row.rowId === conflict.rowId,
                      );
                      const conflictRowLabel = localize(
                        'com_ui_steel_review_conflict_row_context',
                        {
                          0: conflictRowIndex >= 0 ? conflictRowIndex + 1 : '?',
                        },
                      );
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
                        const formatSource = (
                          source: { fileId: string | null; pageNumber: number | null } | null,
                        ) =>
                          source
                            ? `${sources.find((candidate) => candidate.fileId === source.fileId)?.filename ?? localize('com_ui_steel_review_unlocated')}/${source.pageNumber ?? '∅'}`
                            : '∅';
                        conflictValues = localize('com_ui_steel_review_conflict_values', {
                          0: conflictRowLabel,
                          1: formatSource(conflict.expected),
                          2: formatSource(conflict.current),
                          3: formatSource(conflict.requested),
                        });
                      } else if (conflict.kind === 'measurement') {
                        conflictLabel = localize('com_ui_steel_review_conflict_measurement');
                        conflictValues = localize('com_ui_steel_review_conflict_values', {
                          0: conflictRowLabel,
                          1: conflict.expected?.mode ?? '∅',
                          2: conflict.current?.mode ?? '∅',
                          3: conflict.requested?.mode ?? '∅',
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
                      const actionable =
                        conflict.kind === 'field' ||
                        conflict.kind === 'source' ||
                        conflict.kind === 'measurement';
                      return (
                        <div
                          key={`${conflict.kind}:${conflict.rowId}:${conflictLabel}`}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span>
                            {conflictLabel} · {conflictValues}
                          </span>
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
                    <span
                      className="text-text-destructive"
                      role="img"
                      aria-label={localize('com_ui_steel_review_conflicts_unlocated')}
                    >
                      <AlertTriangle className="size-4" aria-hidden="true" />
                    </span>
                  )}
                </div>
              )}
              <SteelReviewSplit
                label={localize('com_ui_steel_review_resize_panels')}
                kind={table.kind}
                hasReference={Boolean(
                  sourcesReady &&
                    ocrReferenceTable &&
                    ocrReferenceDraft &&
                    ocrReference.rows.length > 0 &&
                    !ocrReferenceCollapsed,
                )}
                preview={
                  <>
                    {!sourcesReady && (
                      <div
                        className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 rounded-md bg-surface-secondary p-6 text-sm text-text-secondary"
                        role={sourcesQuery.isError ? 'alert' : 'status'}
                        aria-live="polite"
                      >
                        <p>
                          {localize(
                            sourcesQuery.isError
                              ? 'com_ui_steel_review_sources_error'
                              : 'com_ui_steel_review_sources_loading',
                          )}
                        </p>
                        {sourcesQuery.isError && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void sourcesQuery.refetch()}
                          >
                            {localize('com_ui_retry')}
                          </Button>
                        )}
                      </div>
                    )}
                    {selectedSource && (
                      <div className="relative flex min-h-0 flex-1">
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
                            fit: localize('com_ui_fit'),
                            loading: localize('com_ui_steel_review_preview_loading'),
                            retry: localize('com_ui_retry'),
                            unavailable: localize('com_ui_steel_review_preview_unavailable'),
                            canvas: localize('com_ui_steel_review_preview_canvas'),
                          }}
                        />
                        {isDesktop && (
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            aria-label={localize('com_ui_close')}
                            className="absolute right-3 top-3"
                            disabled={saveBusy}
                            onClick={requestClose}
                          >
                            <X className="size-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                }
              >
                {sourcesReady &&
                  ocrReferenceTable &&
                  ocrReferenceDraft &&
                  ocrReference.rows.length > 0 && (
                    <section className="shrink-0 space-y-2" aria-label={ocrReferenceTable.title}>
                      <h2 className="flex items-center gap-2 text-base font-semibold">
                        <span className="min-w-0 break-words">{ocrReferenceTable.title}</span>
                        <SteelReviewBadge table={ocrReferenceTable} showReadOnly />
                        <TooltipAnchor
                          description={ocrReferenceToggleLabel}
                          side="top"
                          render={
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              className="ml-auto shrink-0"
                              aria-label={ocrReferenceToggleLabel}
                              aria-expanded={!ocrReferenceCollapsed}
                              aria-controls={ocrReferenceContentId}
                              onClick={() =>
                                setDialogState((state) => ({
                                  ...state,
                                  ocrReferenceCollapsed: !state.ocrReferenceCollapsed,
                                }))
                              }
                            >
                              {ocrReferenceCollapsed ? (
                                <ChevronsUpDown className="size-4" aria-hidden="true" />
                              ) : (
                                <ChevronsDownUp className="size-4" aria-hidden="true" />
                              )}
                            </Button>
                          }
                        />
                      </h2>
                      <div id={ocrReferenceContentId} hidden={ocrReferenceCollapsed}>
                        <SteelReviewEditor
                          isDesktop={isDesktop}
                          table={ocrReferenceTable}
                          rows={ocrReference.rows}
                          draft={ocrReferenceDraft}
                          labels={{
                            table: localize('com_ui_steel_review_table_label'),
                            readonly: localize('com_ui_steel_review_cell_readonly'),
                            ...sourceEditorLabels,
                          }}
                          onCellChange={() => undefined}
                          canEdit={false}
                        />
                      </div>
                    </section>
                  )}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                  <div className="flex shrink-0 items-center gap-2 md:flex-1">
                    <h2 className="whitespace-nowrap text-base font-semibold">{table.title}</h2>
                    {(() => {
                      const version = versions.get(
                        JSON.stringify([table.messageId, table.kind, table.title, table.outputId]),
                      );
                      return <SteelReviewBadge table={table} version={version} />;
                    })()}
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <Checkbox
                        aria-label={localize('com_ui_steel_review_unlinked')}
                        checked={unlinkedMode}
                        onCheckedChange={(checked) =>
                          setDialogState((state) => ({ ...state, unlinkedMode: checked === true }))
                        }
                        disabled={saveBusy || !sourcesReady}
                      />
                      <span>{localize('com_ui_steel_review_unlinked')}</span>
                    </label>
                    {canEditStructure && (
                      <TooltipAnchor
                        description={localize('com_ui_steel_review_add_row')}
                        render={
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            aria-label={localize('com_ui_steel_review_add_row')}
                            onClick={onAddRow}
                            disabled={saveBusy || !sourcesReady}
                          >
                            <Plus className="size-4" aria-hidden="true" />
                          </Button>
                        }
                      />
                    )}
                  </div>
                </div>
                <SteelReviewEditor
                  isDesktop={isDesktop}
                  fillHeight
                  table={table}
                  rows={editorRows}
                  draft={draftState}
                  labels={{
                    table: localize('com_ui_steel_review_table_label'),
                    readonly: localize('com_ui_steel_review_cell_readonly'),
                    edit: localize('com_ui_edit'),
                    reset: localize('com_ui_reset'),
                    cancel: localize('com_ui_cancel'),
                    confirm: localize('com_ui_confirm'),
                    ...sourceEditorLabels,
                    bind: localize('com_ui_steel_review_bind'),
                    bound: localize('com_ui_steel_review_bound'),
                    classify: localize('com_ui_steel_review_classify'),
                    material: localize('com_ui_steel_review_material'),
                    processing: localize('com_ui_steel_review_processing'),
                  }}
                  onCellChange={onCellChange}
                  onCandidateChange={onCandidateChange}
                  canEdit={canEdit}
                  onSourceEdit={canEditSources ? onSourceEdit : undefined}
                  onDeleteRow={canEditStructure ? onDeleteRow : undefined}
                  onRestoreRow={canEditStructure ? onRestoreRow : undefined}
                  onDeleteGroup={
                    table.kind === 'system_order' && canEditStructure ? onDeleteGroup : undefined
                  }
                  onClassify={
                    table.kind === 'system_order' && canEditStructure ? onClassify : undefined
                  }
                  systemMaterials={draftRows}
                />
              </SteelReviewSplit>
            </div>
          )}
        </div>
        {!isDesktop && !closeRequested && sourceNavigation}
        {!closeRequested && (
          <div className="flex shrink-0 items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="w-28 shrink-0"
              disabled={saveBusy}
              onClick={requestClose}
            >
              {localize('com_ui_close')}
            </Button>
            {isDesktop && sourceNavigation}
            <Button
              type="button"
              variant="submit"
              className="w-28 shrink-0"
              disabled={saveDisabled}
              aria-busy={saveBusy}
              onClick={() => void saveAndClose()}
            >
              {saveLabel}
            </Button>
          </div>
        )}
        {closeRequested && (
          <div
            className="space-y-3 rounded-md border border-border-light bg-surface-secondary p-3"
            role="alertdialog"
            aria-label={localize('com_ui_steel_review_close_confirm')}
          >
            <p className="text-sm">{localize('com_ui_steel_review_close_confirm')}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={saveBusy} onClick={continueEditing}>
                {localize('com_ui_steel_review_continue_editing')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={saveBusy}
                onClick={discardDraftAndClose}
              >
                {localize('com_ui_steel_review_discard_unsaved')}
              </Button>
              <Button
                type="button"
                variant="submit"
                disabled={saveDisabled}
                aria-busy={saveBusy}
                onClick={() => void saveAndClose()}
              >
                {saveLabel}
              </Button>
            </div>
          </div>
        )}
        {closeRequested && saveFeedback}
        <OGDialog
          open={Boolean(dialogState.sourceCorrectionRowId)}
          onOpenChange={(open) => {
            if (!open) closeSourceCorrection();
          }}
        >
          <OGDialogContent
            aria-label={localize('com_ui_steel_review_bind_title')}
            className="w-[min(92vw,32rem)]"
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <OGDialogHeader>
              <OGDialogTitle>{localize('com_ui_steel_review_bind_title')}</OGDialogTitle>
              <OGDialogDescription>
                {localize('com_ui_steel_review_bind_description')}
              </OGDialogDescription>
            </OGDialogHeader>
            <div className="space-y-4">
              <label className="flex flex-col gap-1 text-sm text-text-secondary">
                <span>{localize('com_ui_steel_review_source_file')}</span>
                <Select
                  value={dialogState.sourceCorrectionFileId ?? ''}
                  onValueChange={(value) =>
                    setDialogState((state) => ({
                      ...state,
                      sourceCorrectionFileId: value,
                      sourceCorrectionPageNumber: 1,
                    }))
                  }
                >
                  <SelectTrigger aria-label={localize('com_ui_steel_review_source_file')}>
                    <SelectValue placeholder={localize('com_ui_steel_review_source_file')} />
                  </SelectTrigger>
                  <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
                    {sources.map((source) => (
                      <SelectItem key={source.fileId} value={source.fileId}>
                        {source.filename}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-text-secondary">
                <span>{localize('com_ui_steel_review_source_page')}</span>
                {sourceCorrectionPageLoading && (
                  <span role="status">{localize('com_ui_steel_review_source_page_loading')}</span>
                )}
                {!sourceCorrectionPageLoading && sourceCorrectionPageError && (
                  <span className="flex items-center gap-2" role="alert">
                    <span>{localize('com_ui_steel_review_source_page_unavailable')}</span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void sourcePageCountQuery.refetch()}
                    >
                      {localize('com_ui_steel_review_source_page_retry')}
                    </Button>
                  </span>
                )}
                {!sourceCorrectionPageLoading && !sourceCorrectionPageError && (
                  <Select
                    value={String(dialogState.sourceCorrectionPageNumber ?? 1)}
                    onValueChange={(value) =>
                      setDialogState((state) => ({
                        ...state,
                        sourceCorrectionPageNumber: Number(value),
                      }))
                    }
                  >
                    <SelectTrigger aria-label={localize('com_ui_steel_review_source_page')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
                      {Array.from(
                        { length: Math.max(0, sourceCorrectionPageCount) },
                        (_, index) => index + 1,
                      ).map((page) => (
                        <SelectItem key={page} value={String(page)}>
                          {page}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeSourceCorrection}>
                  {localize('com_ui_cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={!sourceCorrectionCanConfirm || saveBusy}
                  onClick={confirmSourceCorrection}
                >
                  {localize('com_ui_confirm')}
                </Button>
              </div>
            </div>
          </OGDialogContent>
        </OGDialog>
      </OGDialogContent>
    </OGDialog>
  );
}
