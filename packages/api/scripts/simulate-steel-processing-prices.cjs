#!/usr/bin/env node

const path = require('path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
process.env.TS_NODE_TRANSPILE_ONLY = 'true';

require('ts-node/register/transpile-only');

const { loadWorkbookRows } = require('./import-steel-price-v4.cjs');
const { loadWorkbookRows: loadCuttingWorkbookRows } = require('./import-steel-cutting-prices.cjs');
const { buildSteelPriceV4Rows } = require('../src/steel/pricing/v4');
const { filterSteelCuttingPriceGroups } = require('../src/steel/repositories/cutting');
const {
  isProcessingCandidateApplicable,
  matchesProcessingKeyword,
  processingPriceCategories,
} = require('../src/steel/pricing/processing-candidates');
const { applicableCategoriesByCuttingCategory } = require('./lib/cutting-normalize.cjs');

const DEFAULT_WORKBOOK_PATH = path.resolve(
  __dirname,
  '../../../docs/reference/products_db_v4.4.xlsx',
);
const DEFAULT_CUTTING_WORKBOOK_PATH = path.resolve(
  __dirname,
  '../../../docs/reference/切工價錢-v4.4-normalized.xlsx',
);
function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  return {
    workbookPath: path.resolve(optionValue(argv, '--workbook') ?? DEFAULT_WORKBOOK_PATH),
    cuttingWorkbookPath: path.resolve(
      optionValue(argv, '--cutting-workbook') ?? DEFAULT_CUTTING_WORKBOOK_PATH,
    ),
    categories: optionValue(argv, '--categories')
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    keyword: optionValue(argv, '--keyword'),
  };
}

function toTierValues(row, prefix) {
  return Object.fromEntries(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((tier) => [tier, row[`${prefix}${tier}`] ?? null]),
  );
}

function toCuttingCandidate(row, index) {
  return {
    ...row,
    id: index + 1,
    tierPrices: toTierValues(row, 'unitPrice'),
    tierRatios: toTierValues(row, 'priceRatio'),
  };
}

function toCuttingRecord(row, index) {
  const sharedB = row.unitPriceA ?? null;
  return {
    id: index + 1,
    cuttingCategory: row.cuttingCategory,
    itemName: row.itemName,
    cutType: row.cutType,
    specText: row.specText ?? undefined,
    inchMin: row.inchMin,
    inchMax: row.inchMax,
    mmMin: row.mmMin,
    mmMax: row.mmMax,
    heightMm: row.heightMm,
    widthMm: row.widthMm,
    thicknessMmValues: row.thicknessValues,
    thicknessMmMin: row.thicknessMin,
    thicknessMmMax: row.thicknessMax,
    unit: row.unit ?? undefined,
    tierPrices: {
      A: row.unitPriceA,
      B: row.unitPriceB ?? sharedB,
      C: row.unitPriceC,
      F: row.unitPriceF,
    },
    notes: row.notes ?? undefined,
  };
}

function buildCuttingGroups(cuttingRows) {
  return Object.entries(applicableCategoriesByCuttingCategory).map(
    ([cuttingCategory, sourceCategories]) => {
      const records = cuttingRows
        .filter((row) => row.cuttingCategory === cuttingCategory)
        .map(toCuttingRecord);
      return {
        cuttingCategory,
        sourceCategories,
        queryIds: [],
        prices: records,
        candidateMatches: [],
      };
    },
  );
}

function describeCuttingSelection(groups) {
  return groups.flatMap((group) =>
    group.prices.map((record) => ({
      cuttingCategory: group.cuttingCategory,
      itemName: record.itemName,
      tierPrices: record.tierPrices,
    })),
  );
}

function simulateCuttingPrices(rows, cuttingRows, category) {
  if (
    !Object.values(applicableCategoriesByCuttingCategory).some((categories) =>
      categories.includes(category),
    )
  ) {
    return null;
  }

  const groups = buildCuttingGroups(cuttingRows);
  const candidates = rows
    .map(toCuttingCandidate)
    .filter(
      (row) =>
        row.category === category &&
        row.active &&
        row.valueState !== 'no_price' &&
        isQuoteEligible(row),
    );
  const matches = candidates.map((candidate, index) => {
    const selected = filterSteelCuttingPriceGroups(groups, [
      { queryId: `candidate-${index + 1}`, category, candidates: [candidate] },
    ]);
    return {
      erpItemCode: candidate.erpItemCode,
      productName: candidate.productName,
      selected: describeCuttingSelection(selected),
    };
  });
  const matched = matches.filter((match) => match.selected.length > 0);

  return {
    category,
    materialCandidateCount: candidates.length,
    matchedCandidateCount: matched.length,
    unmatchedCandidateCount: candidates.length - matched.length,
    examples: matched.slice(0, 5),
  };
}

function hasValue(values) {
  return values.some((value) => value !== null);
}

function isQuoteEligible(row) {
  const tierPrices = [
    row.unitPriceA,
    row.unitPriceB,
    row.unitPriceC,
    row.unitPriceD,
    row.unitPriceE,
    row.unitPriceF,
  ];
  if (hasValue(tierPrices)) {
    return true;
  }
  const ratios = [
    row.priceRatioA,
    row.priceRatioB,
    row.priceRatioC,
    row.priceRatioD,
    row.priceRatioE,
    row.priceRatioF,
  ];
  return (
    hasValue(ratios) &&
    (row.category.startsWith('加工/') || row.unit === 'Kg' || row.unit === 'M' || row.unit === '支')
  );
}

function toDescriptor(row) {
  return {
    category: row.category,
    subcategory: row.subcategory || undefined,
    productName: row.productName || undefined,
    normalizedSpecText: row.normalizedSpecText || undefined,
    erpItemCode: row.erpItemCode,
  };
}

function simulateProcessingPrices(rows, targetCategories, keyword) {
  const targets = new Set(targetCategories);
  const processingRows = rows.filter(
    (row) =>
      row.active &&
      row.valueState !== 'no_price' &&
      processingPriceCategories.includes(row.category) &&
      isQuoteEligible(row) &&
      isProcessingCandidateApplicable(toDescriptor(row), targets) &&
      matchesProcessingKeyword(toDescriptor(row), keyword),
  );
  const byProcessingCategory = Object.fromEntries(
    processingPriceCategories.map((category) => [
      category,
      processingRows.filter((row) => row.category === category).length,
    ]),
  );

  return {
    targetCategories,
    keyword: keyword ?? null,
    totalAvailable: processingRows.length,
    selectionRequired: false,
    productNames: [],
    byProcessingCategory,
  };
}

function runSimulation(options) {
  const rows = buildSteelPriceV4Rows(loadWorkbookRows(options.workbookPath));
  const cuttingRows = loadCuttingWorkbookRows(
    options.cuttingWorkbookPath ?? DEFAULT_CUTTING_WORKBOOK_PATH,
  );
  const categories = options.categories ?? [
    ...new Set(
      rows
        .map((row) => row.category)
        .filter((category) => !processingPriceCategories.includes(category)),
    ),
  ];
  return categories.map((category) => ({
    ...simulateProcessingPrices(rows, [category], options.keyword),
    cuttingSimulation: simulateCuttingPrices(rows, cuttingRows, category),
  }));
}

if (require.main === module) {
  const result = runSimulation(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = {
  DEFAULT_CUTTING_WORKBOOK_PATH,
  isQuoteEligible,
  parseArgs,
  runSimulation,
  simulateCuttingPrices,
  simulateProcessingPrices,
};
