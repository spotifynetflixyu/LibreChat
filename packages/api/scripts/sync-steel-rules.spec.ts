import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import { priceCategories, priceSubcategoriesByCategory } from '../src/steel/pricing/categories';

type DryRunRule = {
  slug: string;
  sourceFile: string;
  factType: string;
};

type DryRunSummary = {
  mode: string;
  rules: DryRunRule[];
};

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const oldRulesDir = path.join(repoRoot, 'docs/rules/鋼材規則');
const categoryRulesDir = path.join(repoRoot, 'docs/rules/類別規則');
const guidePath = path.join(categoryRulesDir, '查價方式.txt');
const syncScript = path.join(repoRoot, 'packages/api/scripts/sync-steel-rules.cjs');

function readUtf8(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function runDryRun(): DryRunSummary {
  return JSON.parse(
    execFileSync(process.execPath, [syncScript, '--dry-run'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }),
  ) as DryRunSummary;
}

function listRuleFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listRuleFiles(absolutePath);
    }
    if (!entry.name.endsWith('.txt')) {
      return [];
    }
    return [path.relative(repoRoot, absolutePath)];
  });
}

function parseLookupContract(guide: string): Record<string, string> {
  const block = guide.match(
    /\[category_lookup_contract\]\n([\s\S]*?)\n\[\/category_lookup_contract\]/u,
  );
  if (!block?.[1]) {
    throw new Error('Missing category lookup contract metadata');
  }

  return Object.fromEntries(
    block[1].split('\n').map((line) => {
      const separator = line.indexOf('=');
      if (separator < 1) {
        throw new Error(`Invalid category lookup contract metadata: ${line}`);
      }
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
}

function parseCategorySubcategories(guide: string): Map<string, string[]> {
  const sections = guide.split(/^## /mu).slice(1);

  return new Map(
    sections.map((section) => {
      const [category, ...bodyLines] = section.split('\n');
      const subcategoryLine = bodyLines
        .join('\n')
        .match(/^次類別=\[(.*)\];空白=unfiltered$/mu)?.[1];
      if (!category || subcategoryLine === undefined) {
        throw new Error(`Missing structured subcategory metadata for ${category ?? 'unknown'}`);
      }
      return [category, subcategoryLine ? subcategoryLine.split('|') : []];
    }),
  );
}

describe('Steel category rule sources', () => {
  it('uses only the renamed category rules directory in sync metadata', () => {
    expect(fs.existsSync(oldRulesDir)).toBe(false);
    expect(fs.existsSync(categoryRulesDir)).toBe(true);

    const summary = runDryRun();
    const syncedCategoryFiles = summary.rules
      .map((rule) => rule.sourceFile)
      .filter((sourceFile) => sourceFile.startsWith('docs/rules/類別規則/'))
      .sort();
    const currentCategoryFiles = fs
      .readdirSync(categoryRulesDir)
      .filter((fileName) => fileName.endsWith('.txt'))
      .map((fileName) => `docs/rules/類別規則/${fileName}`)
      .sort();
    const syncedSourceFiles = summary.rules.map((rule) => rule.sourceFile).sort();

    expect(summary.mode).toBe('dry-run');
    expect(syncedCategoryFiles).toEqual(currentCategoryFiles);
    expect(syncedSourceFiles).toEqual(listRuleFiles(path.join(repoRoot, 'docs/rules')).sort());
    expect(summary.rules.every((rule) => !rule.sourceFile.includes('鋼材規則'))).toBe(true);
    expect(summary.rules.map((rule) => rule.slug).sort()).toEqual([
      'steel-default-agent-instruction',
      'steel-drawing-ocr-policy',
      'steel-workbook-output-policy',
      'steel_category_price_lookup_guide',
      'steel_quote_rules_c_type',
      'steel_quote_rules_h_beam',
      'steel_quote_rules_hole',
      'steel_quote_rules_long_material_cutting',
      'steel_quote_rules_plate',
    ]);
    expect(
      summary.rules
        .filter((rule) => rule.sourceFile.startsWith('docs/rules/類別規則/'))
        .map((rule) => rule.factType),
    ).toEqual(Array(currentCategoryFiles.length).fill('category_rule'));
  });

  it('exactly matches every category section subcategory metadata to the registry', () => {
    const subcategoriesByCategory = parseCategorySubcategories(readUtf8(guidePath));

    expect([...subcategoriesByCategory.keys()]).toEqual([...priceCategories]);
    expect(Object.fromEntries(subcategoriesByCategory)).toEqual(
      Object.fromEntries(
        priceCategories.map((category) => [
          category,
          priceSubcategoriesByCategory[category].filter(Boolean),
        ]),
      ),
    );
    expect(subcategoriesByCategory.get('加工/其他')).toEqual([
      'C型鋼',
      'H型鋼',
      'L',
      'U',
      '丸條',
      '加工',
      '圓管',
      '扁鐵',
      '捲門/伸縮門',
      '網',
      '角鐵',
      '鐵板',
    ]);
  });

  it('exposes the canonical grouped-query and pricing safety contract', () => {
    expect(parseLookupContract(readUtf8(guidePath))).toEqual({
      schema_version: 'v4.2',
      tool: 'search_price_candidates',
      grouping: 'one_call_multiple_queries',
      request_identity: 'queryId',
      response_identity: 'queryResults.queryId',
      query_limit_default: '30',
      query_limit_max: '100',
      query_limit_overflow: 'clamp',
      query_filters: 'category|subcategory|material|thicknessMm|erpItemCode|keyword|limit',
      material_enum: '黑鐵|白鐵|鋁|錏|鋅|鎢|塑膠',
      cutting_query_timing: 'after_price_queries',
      cutting_query_filter: 'category_contains_only',
      cutting_query_limit: 'unbounded',
      cutting_output: 'cuttingPrices',
      ratio_quoteable_units: 'Kg|M',
      ratio_unsupported_action: 'category_rule_pending',
      missing_price_action: 'manual_review',
      empty_subcategory: 'unfiltered',
    });
  });
});
