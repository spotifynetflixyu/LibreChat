const fs = require('fs/promises');
const JSZip = require('jszip');

const cuttingTableNames = {
  cutting_prices: 'CuttingPricesTable',
  cutting_supplements: 'CuttingSupplementsTable',
};

const worksheetPathPattern = /^xl\/worksheets\/sheet\d+\.xml$/;
const dimensionPattern = /<(?:[\w.-]+:)?dimension\b[^>]*\bref="([^"]+)"[^>]*>/;
const autoFilterPattern =
  /<(?:[\w.-]+:)?autoFilter\b[^>]*(?:\/>|>[\s\S]*?<\/(?:[\w.-]+:)?autoFilter>)/;
const sheetDataPattern = /<\/(?:[\w.-]+:)?sheetData>|<(?:[\w.-]+:)?sheetData\b[^>]*\/>/;
const cellReferencePattern = /<(?:[\w.-]+:)?c\b[^>]*\br="([A-Z]+)(\d+)"/g;

function columnNumber(name) {
  let value = 0;
  for (const character of name) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value;
}

function columnName(number) {
  let value = number;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellBoundsRange(xml) {
  let minColumn = Number.POSITIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxColumn = 0;
  let maxRow = 0;
  for (const match of xml.matchAll(cellReferencePattern)) {
    const column = columnNumber(match[1]);
    const row = Number(match[2]);
    minColumn = Math.min(minColumn, column);
    minRow = Math.min(minRow, row);
    maxColumn = Math.max(maxColumn, column);
    maxRow = Math.max(maxRow, row);
  }
  if (maxColumn === 0 || maxRow === 0) {
    return null;
  }
  return `${columnName(minColumn)}${minRow}:${columnName(maxColumn)}${maxRow}`;
}

function addWorksheetAutoFilter(xml) {
  const range = xml.match(dimensionPattern)?.[1] ?? cellBoundsRange(xml);
  if (!range) {
    return { xml, range: null };
  }
  const prefix = xml.match(/<([\w.-]+:)?worksheet\b/)?.[1] ?? '';
  const autoFilter = `<${prefix}autoFilter ref="${range}" />`;
  if (autoFilterPattern.test(xml)) {
    return { xml: xml.replace(autoFilterPattern, autoFilter), range };
  }
  if (!sheetDataPattern.test(xml)) {
    return { xml, range: null };
  }
  return {
    xml: xml.replace(sheetDataPattern, (sheetData) => `${sheetData}${autoFilter}`),
    range,
  };
}

async function addWorksheetAutoFiltersToXlsx(filePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const filters = [];
  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (!worksheetPathPattern.test(entryPath) || entry.dir) {
      continue;
    }
    const currentXml = await entry.async('string');
    const updated = addWorksheetAutoFilter(currentXml);
    if (!updated.range) {
      continue;
    }
    zip.file(entryPath, updated.xml);
    filters.push({ path: entryPath, range: updated.range });
  }
  if (filters.length === 0) {
    return filters;
  }
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const tempPath = `${filePath}.worksheet-filters.tmp`;
  try {
    await fs.writeFile(tempPath, output);
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
  return filters;
}

function enableCuttingHeaderFilters(sheet, used, sheetName) {
  const existingTables = sheet.tables.items;
  const existingStyle = existingTables[0]?.style;
  for (const table of existingTables) {
    table.delete();
  }
  const table = sheet.tables.add(used.address, true, cuttingTableNames[sheetName]);
  if (existingStyle) {
    table.style = existingStyle;
  }
  table.showFilterButton = true;
}

module.exports = {
  addWorksheetAutoFilter,
  addWorksheetAutoFiltersToXlsx,
  enableCuttingHeaderFilters,
};
