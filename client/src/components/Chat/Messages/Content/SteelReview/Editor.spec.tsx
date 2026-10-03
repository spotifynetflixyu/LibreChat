import type { SteelReviewTable } from 'librechat-data-provider';
import { isSteelReviewCellEditable } from './Editor';

const table = {
  kind: 'ocr_result' as const,
  isLatest: true,
  readOnly: false,
} as SteelReviewTable;

describe('Steel review local editor gates', () => {
  it('allows only latest editable OCR business cells', () => {
    expect(isSteelReviewCellEditable(table, '品名規格')).toBe(true);
    expect(isSteelReviewCellEditable(table, '來源檔案')).toBe(false);
    expect(isSteelReviewCellEditable(table, '頁碼')).toBe(false);
  });

  it('keeps system order and historical output cells read-only', () => {
    expect(isSteelReviewCellEditable({ ...table, kind: 'system_order' }, '品名規格')).toBe(false);
    expect(isSteelReviewCellEditable({ ...table, isLatest: false }, '品名規格')).toBe(false);
    expect(isSteelReviewCellEditable({ ...table, readOnly: true }, '品名規格')).toBe(false);
  });
});
