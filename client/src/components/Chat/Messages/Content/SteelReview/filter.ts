import type { SteelReviewRow } from 'librechat-data-provider';

export interface SteelReviewPreviewRows {
  located: SteelReviewRow[];
  unlocated: SteelReviewRow[];
}

export function getSteelReviewPreviewRows(
  rows: readonly SteelReviewRow[],
  fileId: string | undefined,
  pageNumber: number,
  availableFileIds?: ReadonlySet<string>,
  pageCount = 0,
): SteelReviewPreviewRows {
  const located: SteelReviewRow[] = [];
  const unlocated: SteelReviewRow[] = [];
  for (const row of rows) {
    const source = row.source;
    const selectedPageIsUnavailable =
      source !== null &&
      source.fileId === fileId &&
      pageCount > 0 &&
      source.pageNumber !== null &&
      source.pageNumber > pageCount;
    if (
      !source ||
      source.pageNumber === null ||
      (availableFileIds && !availableFileIds.has(source.fileId)) ||
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
