import { useCallback, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DynamicQueryKeys } from 'librechat-data-provider';
import type {
  SteelReviewKind,
  SteelReviewRow,
  SteelReviewSourceFile,
  SteelReviewSourcePageCount,
} from 'librechat-data-provider';
import type { Dispatch, SetStateAction } from 'react';
import type { SteelReviewDialogState, SteelReviewIdentity } from '../state';
import {
  useGetSteelReviewSourceQuery,
  useGetSteelReviewSourcesQuery,
  useGetSteelReviewSourcePageCountQuery,
} from '~/data-provider';

export interface SteelReviewSourcesOptions {
  identity: SteelReviewIdentity;
  isOpen: boolean;
  tableKind: SteelReviewKind | undefined;
  baseTableKind: SteelReviewKind | undefined;
  draftRows: readonly SteelReviewRow[];
  dialogState: SteelReviewDialogState;
  setDialogState: Dispatch<SetStateAction<SteelReviewDialogState>>;
  canEditSources: boolean;
}

export interface SteelReviewSources {
  sources: SteelReviewSourceFile[];
  sourcesReady: boolean;
  selectedSource: SteelReviewSourceFile | undefined;
  selectedSourceId: string | undefined;
  pageCount: number;
  pageNumber: number;
  sourceCorrectionFile: SteelReviewSourceFile | undefined;
  sourceCorrectionRow: SteelReviewRow | undefined;
  sourceCorrectionPageCount: number;
  sourceCorrectionPageLoading: boolean;
  sourceCorrectionPageError: boolean;
  sourceCorrectionCanConfirm: boolean;
  sourcesQuery: ReturnType<typeof useGetSteelReviewSourcesQuery>;
  sourceQuery: ReturnType<typeof useGetSteelReviewSourceQuery>;
  sourcePageCountQuery: ReturnType<typeof useGetSteelReviewSourcePageCountQuery>;
  onPageCount: (count: number) => void;
  goPrevious: () => void;
  goNext: () => void;
}

/** The review sources, the selected source page, and the source-correction page count. */
export function useSteelReviewSources({
  identity,
  isOpen,
  tableKind,
  baseTableKind,
  draftRows,
  dialogState,
  setDialogState,
  canEditSources,
}: SteelReviewSourcesOptions): SteelReviewSources {
  const queryClient = useQueryClient();
  const { selectedFileId, pageNumber: storedPageNumber, pageCount: storedPageCount } = dialogState;
  const sourcesQuery = useGetSteelReviewSourcesQuery(
    isOpen && Boolean(tableKind)
      ? {
          conversationId: identity.conversationId,
          kind: identity.kind,
          messageId: identity.messageId,
          title: identity.title,
        }
      : null,
    { enabled: isOpen && Boolean(tableKind) },
  );
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const sourcesReady = sourcesQuery.data !== undefined;
  const firstBoundSystemSourceId = useMemo(() => {
    if (baseTableKind !== 'system_order') {
      return undefined;
    }
    const authorizedFileIds = new Set(sources.map((source) => source.fileId));
    return draftRows.find(
      (row) =>
        !row.deleted &&
        row.system &&
        row.system.kind !== 'unassigned' &&
        row.source?.fileId &&
        row.source.pageNumber !== null &&
        authorizedFileIds.has(row.source.fileId),
    )?.source?.fileId;
  }, [baseTableKind, draftRows, sources]);
  const selectedSource = useMemo(
    () =>
      sources.find((source) => source.fileId === selectedFileId) ??
      (!selectedFileId && firstBoundSystemSourceId
        ? sources.find((source) => source.fileId === firstBoundSystemSourceId)
        : undefined) ??
      sources[0],
    [firstBoundSystemSourceId, selectedFileId, sources],
  );
  const selectedSourceId = selectedSource?.fileId;
  const pageCount =
    selectedSource?.pageCount ??
    (dialogState.initializedSourceId === selectedSourceId ? storedPageCount : 0);
  const selectedSourcePage = useMemo(
    () =>
      draftRows.find(
        (row) =>
          !row.deleted &&
          row.system &&
          row.system.kind !== 'unassigned' &&
          row.source?.fileId === selectedSource?.fileId &&
          row.source?.pageNumber !== null,
      )?.source?.pageNumber ??
      draftRows.find((row) => row.source?.fileId === selectedSource?.fileId)?.source?.pageNumber,
    [draftRows, selectedSource?.fileId],
  );
  const pageNumber =
    selectedSourceId && dialogState.initializedSourceId !== selectedSourceId
      ? (selectedSourcePage ?? 1)
      : storedPageNumber;
  const sourceCorrectionFile = dialogState.sourceCorrectionFileId
    ? sources.find((source) => source.fileId === dialogState.sourceCorrectionFileId)
    : undefined;
  let sourceCorrectionKnownPageCount = 0;
  if (sourceCorrectionFile?.mediaType.startsWith('image/')) {
    sourceCorrectionKnownPageCount = 1;
  } else if (sourceCorrectionFile?.pageCount) {
    sourceCorrectionKnownPageCount = sourceCorrectionFile.pageCount;
  } else if (sourceCorrectionFile?.fileId === selectedSourceId && pageCount > 0) {
    sourceCorrectionKnownPageCount = pageCount;
  } else if (sourceCorrectionFile) {
    sourceCorrectionKnownPageCount =
      queryClient.getQueryData<SteelReviewSourcePageCount>(
        DynamicQueryKeys.steelReviewSourcePageCount(
          identity.conversationId,
          identity.kind,
          identity.messageId,
          sourceCorrectionFile.fileId,
        ),
      )?.pageCount ?? 0;
  }
  const sourcePageCountQuery = useGetSteelReviewSourcePageCountQuery(
    isOpen &&
      canEditSources &&
      dialogState.sourceCorrectionFileId &&
      sourceCorrectionFile?.mediaType !== undefined &&
      !sourceCorrectionFile.mediaType.startsWith('image/')
      ? {
          conversationId: identity.conversationId,
          kind: identity.kind,
          messageId: identity.messageId,
          fileId: dialogState.sourceCorrectionFileId,
        }
      : null,
    {
      enabled:
        isOpen &&
        canEditSources &&
        !!dialogState.sourceCorrectionFileId &&
        sourceCorrectionFile?.mediaType !== undefined &&
        !sourceCorrectionFile.mediaType.startsWith('image/') &&
        sourceCorrectionKnownPageCount === 0,
    },
  );
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
        unlinkedMode: false,
        unlinkedRowIds: [],
        unlinkedMembershipOwner: undefined,
        initializedSourceId: undefined,
        sourceCorrectionRowId: undefined,
        sourceCorrectionFileId: undefined,
        sourceCorrectionPageNumber: undefined,
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
  const sourceCorrectionRow = useMemo(
    () => draftRows.find((row) => row.rowId === dialogState.sourceCorrectionRowId),
    [dialogState.sourceCorrectionRowId, draftRows],
  );
  const sourceCorrectionPageCount =
    sourceCorrectionKnownPageCount || sourcePageCountQuery.data?.pageCount || 0;
  const sourceCorrectionPageLoading =
    sourceCorrectionPageCount === 0 && sourcePageCountQuery.isLoading;
  const sourceCorrectionPageError = sourceCorrectionPageCount === 0 && sourcePageCountQuery.isError;
  const sourceCorrectionCanConfirm = Boolean(
    sourceCorrectionRow?.rowId &&
      dialogState.sourceCorrectionFileId &&
      dialogState.sourceCorrectionPageNumber &&
      sourceCorrectionPageCount > 0 &&
      dialogState.sourceCorrectionPageNumber <= sourceCorrectionPageCount &&
      !sourceCorrectionPageLoading &&
      !sourceCorrectionPageError,
  );
  const onPageCount = useCallback(
    (count: number) => {
      if (count > 0 && selectedSourceId) {
        queryClient.setQueryData<SteelReviewSourcePageCount>(
          DynamicQueryKeys.steelReviewSourcePageCount(
            identity.conversationId,
            identity.kind,
            identity.messageId,
            selectedSourceId,
          ),
          { pageCount: count },
        );
      }
      setDialogState((state) => ({
        ...state,
        pageCount: count,
        pageNumber: count > 0 ? Math.min(state.pageNumber, count) : state.pageNumber,
      }));
    },
    [
      identity.conversationId,
      identity.kind,
      identity.messageId,
      queryClient,
      selectedSourceId,
      setDialogState,
    ],
  );
  const goPrevious = useCallback(() => {
    setDialogState((state) => ({ ...state, pageNumber: Math.max(1, state.pageNumber - 1) }));
  }, [setDialogState]);
  const goNext = useCallback(() => {
    setDialogState((state) => ({
      ...state,
      pageNumber: Math.min(state.pageCount || state.pageNumber + 1, state.pageNumber + 1),
    }));
  }, [setDialogState]);
  return {
    sources,
    sourcesReady,
    selectedSource,
    selectedSourceId,
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
  };
}
