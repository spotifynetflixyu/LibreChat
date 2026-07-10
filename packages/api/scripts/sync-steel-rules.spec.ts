import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import { priceCategories, priceSubcategoriesByCategory } from '../src/steel/pricing/categories';

type DryRunRule = {
  slug: string;
  sourceFile: string;
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
    expect(summary.rules.map((rule) => rule.slug)).toContain('steel_category_price_lookup_guide');
  });

  it('documents every price category and non-empty subcategory from the registry', () => {
    const guide = readUtf8(guidePath);

    for (const category of priceCategories) {
      expect(guide).toContain(`## ${category}`);
      for (const subcategory of priceSubcategoriesByCategory[category]) {
        if (subcategory) {
          expect(guide).toContain(`\`${subcategory}\``);
        }
      }
    }

    expect(guide).toContain('`扁鐵`');
    expect(guide).not.toMatch(/`扁`/u);
  });

  it('documents grouped query IDs, limits, material enums, and safe ratio pricing', () => {
    const guide = readUtf8(guidePath);

    expect(guide).toContain('queryId');
    expect(guide).toContain('queryResults');
    expect(guide).toMatch(/一次[^\n]*search_price_candidates/u);
    expect(guide).toMatch(/預設[^\n]*30/u);
    expect(guide).toMatch(/超過[^\n]*100[^\n]*100/u);
    expect(guide).toContain('黑鐵、白鐵、鋁、錏、鎢、塑膠');
    expect(guide).toContain('category_rule_pending');
    expect(guide).toMatch(/ratio_only[^\n]*(Kg|M)[^\n]*(Kg|M)/u);
    expect(guide).toMatch(/缺少[^\n]*價格[^\n]*(未知|人工複核)/u);
  });

  it('uses current category-rule terminology in runtime instructions', () => {
    const agentRule = readUtf8(path.join(repoRoot, 'docs/rules/agent規則.txt'));
    const runtimeInstructions = readUtf8(
      path.join(repoRoot, 'packages/api/src/steel/tools/instructions.ts'),
    );

    expect(agentRule).toContain('類別規則');
    expect(agentRule).not.toContain('鋼材規則');
    expect(runtimeInstructions).toContain('類別規則');
    expect(runtimeInstructions).not.toContain('鋼材規則');
  });
});
