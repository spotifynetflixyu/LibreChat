const cuttingTableNames = {
  cutting_prices: 'CuttingPricesTable',
  cutting_supplements: 'CuttingSupplementsTable',
};

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

module.exports = { enableCuttingHeaderFilters };
