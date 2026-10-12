import { isSteelReviewSourceAssociationHeader } from 'librechat-data-provider';
import type { SteelReviewMode } from './types';

export const ocrReviewMode: SteelReviewMode = {
  isEditableHeader: (header) => !isSteelReviewSourceAssociationHeader(header),
  defersHeader: () => false,
  usesCatalog: (_row, _header): _header is '型號' | '品名規格' => false,
  usesCategoryMenu: (header) => header === '類別',
  projectRows: (rows) => rows,
};
