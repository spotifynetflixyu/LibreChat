import type { SteelReviewRow } from 'librechat-data-provider';

export interface SteelReviewPreviewRows {
  located: SteelReviewRow[];
  unlocated: SteelReviewRow[];
}

export function isSteelReviewSourceComplete(row: Pick<SteelReviewRow, 'source'>): boolean {
  return Boolean(row.source?.fileId && row.source.pageNumber !== null);
}

export function getSteelReviewUnlinkedRowIds(rows: readonly SteelReviewRow[]): string[] {
  return rows
    .filter((row) => !isSteelReviewSourceComplete(row))
    .map((row) => row.rowId);
}

export function getSteelReviewPreviewRows(
  rows: readonly SteelReviewRow[],
  fileId: string | undefined,
  pageNumber: number,
  availableFileIds?: ReadonlySet<string>,
  pageCount = 0,
  unlinkedRowIds?: ReadonlySet<string>,
  pendingProcessingRowIds?: ReadonlySet<string>,
): SteelReviewPreviewRows {
  const located: SteelReviewRow[] = [];
  const unlocated: SteelReviewRow[] = [];
  for (const row of rows) {
    const source = row.source;
    // Keep the editing row visible until matching Notes supply its material source.
    if (!unlinkedRowIds && pendingProcessingRowIds?.has(row.rowId)) {
      located.push(row);
      continue;
    }
    if (unlinkedRowIds && unlinkedRowIds.has(row.rowId)) {
      unlocated.push(row);
      continue;
    }
    if (unlinkedRowIds && !unlinkedRowIds.has(row.rowId)) {
      if (source?.fileId === fileId && source?.pageNumber === pageNumber) {
        located.push(row);
      }
      continue;
    }
    const selectedPageIsUnavailable =
      source !== null &&
      source.fileId === fileId &&
      pageCount > 0 &&
      source.pageNumber !== null &&
      source.pageNumber > pageCount;
    const sourceFileIsUnavailable = source !== null && availableFileIds !== undefined &&
      !availableFileIds.has(source.fileId);
    if (
      !source ||
      source.pageNumber === null ||
      sourceFileIsUnavailable ||
      selectedPageIsUnavailable
    ) {
      unlocated.push(row);
      continue;
    }
    if (source.fileId === fileId && source.pageNumber === pageNumber) {
      located.push(row);
    }
  }
  return { located, unlocated };
}
