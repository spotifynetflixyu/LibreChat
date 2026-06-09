import ExcelJS from 'exceljs';

import type {
  SteelWorkbook,
  SteelWorkbookCellValue,
  SteelWorkbookColumn,
  SteelWorkbookSheet,
  SteelWorkbookSheetId,
} from 'librechat-data-provider';

const xlsxContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const unconfirmedText = '未確認';

export interface SteelWorkbookExportResult {
  buffer: Buffer;
  contentType: typeof xlsxContentType;
  filename: string;
}

export interface RenderSteelWorkbookXlsxInput {
  workbook: SteelWorkbook;
  sheetIds?: SteelWorkbookSheetId[];
}

function getColumnWidth(column: SteelWorkbookColumn): number {
  if (!column.widthPx) {
    return Math.max(12, Math.min(32, Math.ceil(column.label.length * 2)));
  }

  return Math.max(8, Math.min(40, Math.ceil(column.widthPx / 8)));
}

function getCellValue(column: SteelWorkbookColumn, value: SteelWorkbookCellValue | undefined) {
  if (value === null || value === undefined || value === '') {
    return column.valueType === 'currency' ? unconfirmedText : '';
  }

  return value;
}

function applyCellFormat(cell: ExcelJS.Cell, column: SteelWorkbookColumn) {
  if (column.valueType === 'currency' && typeof cell.value === 'number') {
    cell.numFmt = '#,##0';
    return;
  }

  if (column.valueType === 'number' && typeof cell.value === 'number') {
    cell.numFmt = column.key.includes('weight') ? '#,##0.###' : '#,##0.###';
  }
}

function getSelectedSheets(workbook: SteelWorkbook, sheetIds?: SteelWorkbookSheetId[]) {
  if (!sheetIds || sheetIds.length === 0) {
    return workbook.sheets;
  }

  return sheetIds.map((sheetId) => {
    const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet) {
      throw new Error(`Unknown workbook sheet: ${sheetId}`);
    }
    return sheet;
  });
}

function addWorksheet(workbook: ExcelJS.Workbook, sheet: SteelWorkbookSheet) {
  const worksheet = workbook.addWorksheet(sheet.label);
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.columns = sheet.columns.map((column) => ({
    key: column.key,
    header: column.label,
    width: getColumnWidth(column),
  }));

  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };
  header.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFEFEF' },
    };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    };
  });

  if (sheet.columns.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
  }

  for (const row of sheet.rows) {
    const excelRow = worksheet.addRow(
      Object.fromEntries(
        sheet.columns.map((column) => [column.key, getCellValue(column, row.cells[column.key])]),
      ),
    );
    sheet.columns.forEach((column, index) => {
      applyCellFormat(excelRow.getCell(index + 1), column);
    });
  }
}

export async function renderSteelWorkbookXlsx({
  workbook,
  sheetIds,
}: RenderSteelWorkbookXlsxInput): Promise<Buffer> {
  const output = new ExcelJS.Workbook();
  output.creator = 'LibreChat Steel';
  output.created = new Date();
  output.modified = new Date();

  for (const sheet of getSelectedSheets(workbook, sheetIds)) {
    addWorksheet(output, sheet);
  }

  const buffer = await output.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

export async function exportSteelWorkbookXlsx(
  input: RenderSteelWorkbookXlsxInput,
): Promise<SteelWorkbookExportResult> {
  return {
    buffer: await renderSteelWorkbookXlsx(input),
    contentType: xlsxContentType,
    filename: `steel-workbook-${input.workbook.id}-v${input.workbook.version}.xlsx`,
  };
}
