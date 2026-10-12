import type { SteelReviewRow } from 'librechat-data-provider';

export interface SteelReviewProjection {
  previewCalculations: boolean;
  hasManualTotal: (rowId: string) => boolean;
  hasSelectedCandidate: (rowId: string) => boolean;
  preservesCandidateTotal: (rowId: string, parentRowId: string | null | undefined) => boolean;
}

export interface SteelReviewMode {
  isEditableHeader: (header: string) => boolean;
  defersHeader: (header: string) => boolean;
  usesCatalog: (row: SteelReviewRow, header: string) => header is '型號' | '品名規格';
  usesCategoryMenu: (header: string) => boolean;
  projectRows: (rows: SteelReviewRow[], context: SteelReviewProjection) => SteelReviewRow[];
}
