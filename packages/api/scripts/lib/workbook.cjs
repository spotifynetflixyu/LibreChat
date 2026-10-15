const XLSX = require('xlsx');

/** Opens a workbook with formatted cell text, as every Steel price script reads it. */
function readWorkbook(workbookPath) {
  return XLSX.readFile(workbookPath, { raw: false, cellDates: false });
}

/**
 * Reads one sheet as formatted text, checks that its header row is exactly
 * `headers`, and returns the rows below it keyed by those headers.
 */
function readSheetRecords(workbook, { sheetName, headers, headerRowIndex = 0, headerError }) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Workbook missing ${sheetName} sheet`);
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const actual = (matrix[headerRowIndex] || []).map(String);
  if (actual.length !== headers.length || actual.some((header, index) => header !== headers[index])) {
    throw new Error(headerError);
  }
  return matrix
    .slice(headerRowIndex + 1)
    .map((cells) => Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ''])));
}

module.exports = { readWorkbook, readSheetRecords };
