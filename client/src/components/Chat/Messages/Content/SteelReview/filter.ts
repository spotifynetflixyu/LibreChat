import type { SteelReviewRow } from 'librechat-data-provider';

export interface SteelReviewPreviewRows {
  located: SteelReviewRow[];
  unlocated: SteelReviewRow[];
}

export function getSteelReviewPreviewRows(
  rows: readonly SteelReviewRow[],
  fileId: string | undefined,
  pageNumber: number,
): SteelReviewPreviewRows {
  const located: SteelReviewRow[] = [];
  const unlocated: SteelReviewRow[] = [];
  for (const row of rows) {
    const source = row.source;
    if (!source || source.pageNumber === null) {
      unlocated.push(row);
      continue;
    }
    if (source.fileId === fileId && source.pageNumber === pageNumber) {
      located.push(row);
    }
  }
  return { located, unlocated };
}
