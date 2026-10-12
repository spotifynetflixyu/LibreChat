import type {
  SteelReviewOcrContext,
  SteelReviewOcrLink,
  SteelReviewRow,
} from 'librechat-data-provider';

/** Reconcile links against authorized quotation evidence without changing a selected source. */
export function reconcileSteelReviewOcrLinks(
  headers: readonly string[],
  rows: readonly SteelReviewRow[],
  context: SteelReviewOcrContext | null,
): SteelReviewRow[] {
  const candidates = new Map<string, SteelReviewRow[]>();
  if (context?.headers.includes('零件編號')) {
    for (const row of context.rows) {
      const part = row.values['零件編號']?.effective?.trim();
      if (row.deleted || !part || !row.source?.fileId || row.source.pageNumber === null) continue;
      const key = JSON.stringify([part, row.source.fileId, row.source.pageNumber]);
      const matches = candidates.get(key) ?? [];
      matches.push(row);
      candidates.set(key, matches);
    }
  }
  const links = new Map<string, SteelReviewOcrLink | null>();
  for (const row of rows) {
    if (row.system?.kind === 'processing') continue;
    const part = headers.includes('備註') ? row.values['備註']?.effective?.trim() : undefined;
    let matches: SteelReviewRow[] = [];
    if (!row.deleted && part && row.source?.fileId && row.source.pageNumber !== null) {
      matches = candidates.get(JSON.stringify([part, row.source.fileId, row.source.pageNumber])) ?? [];
    }
    const match = matches.length === 1 ? matches[0] : undefined;
    const link = context && match
      ? { outputId: context.outputId, revision: context.revision, rowId: match.rowId }
      : null;
    links.set(row.rowId, link);
  }
  return rows.map((row) => {
    const linkId = row.system?.kind === 'processing' ? row.system.parentRowId : row.rowId;
    if (row.deleted || !linkId) return { ...row, ocrLink: null };
    return { ...row, ocrLink: links.get(linkId) ?? null };
  });
}
