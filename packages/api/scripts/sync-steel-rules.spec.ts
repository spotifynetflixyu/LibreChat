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

interface SyncClient {
  query: jest.Mock<Promise<{ rows: object[] }>, [string, unknown?]>;
  release: jest.Mock<void, []>;
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const oldRulesDir = path.join(repoRoot, 'docs/rules/鋼材規則');
const categoryRulesDir = path.join(repoRoot, 'docs/rules/類別規則');
const agentRulePath = path.join(repoRoot, 'docs/rules/agent規則.txt');
const guidePath = path.join(categoryRulesDir, '查價方式.txt');
const plateRulePath = path.join(categoryRulesDir, '鐵板.txt');
const syncScript = path.join(repoRoot, 'packages/api/scripts/sync-steel-rules.cjs');

const ruleSync = require('./sync-steel-rules.cjs') as {
  buildRules: (root: string) => object[];
  syncRules: (pool: { connect: () => Promise<SyncClient> }, rules: object[]) => Promise<object[]>;
};

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
  it('rolls back an interrupted rule publication on its dedicated connection', async () => {
    const client: SyncClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO steel.rules')) {
          throw new Error('injected upsert failure');
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };

    await expect(
      ruleSync.syncRules(
        { connect: async () => client },
        ruleSync.buildRules(repoRoot).slice(0, 1),
      ),
    ).rejects.toThrow('injected upsert failure');

    const sql = client.query.mock.calls.map(([statement]) => statement.trim());
    expect(sql).toContain('BEGIN');
    expect(sql.some((statement) => statement.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rejects conflicting or unknown CLI flags before syncing', () => {
    expect(() =>
      execFileSync(process.execPath, [syncScript, '--dry-run', '--apply'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow();
    expect(() =>
      execFileSync(process.execPath, [syncScript, '--unknown'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow();
  });

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
    expect(summary.rules.filter((rule) => rule.factType === 'category_rule').at(-1)?.slug).toBe(
      'steel_category_price_lookup_guide',
    );
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
      tool: 'search_price_candidates',
      grouping: 'one_call_multiple_queries',
      request_identity: 'query_order',
      response_identity: 'queryResults_array_order',
      query_id_generation: 'q{index+1}',
      query_count_limit: 'unbounded',
      query_limit_default: '30',
      query_limit_max: '100',
      query_limit_overflow: 'clamp',
      query_filters: 'category|subcategory|material|thicknessMm|erpItemCode|keyword|limit',
      material_enum: '黑鐵|白鐵|鋁|錏|鋅|鎢|塑膠',
      cutting_query_timing: 'parallel_with_price_queries',
      cutting_query_filter: 'category_contains_only',
      cutting_query_limit: 'unbounded',
      cutting_output: 'cuttingPrices',
      cutting_output_filter: 'matched_candidate_spec',
      cutting_no_match_output: 'omit',
      ratio_quoteable_units: 'Kg|M',
      ratio_unsupported_action: 'category_rule_pending',
      missing_price_action: 'manual_review',
      missing_thickness_selection: 'minimum_quoteable_thickness',
      material_line_rounding: 'ceil_final_subtotal_twd',
      empty_subcategory: 'unfiltered',
    });
  });

  it('uses category-based first lookups with data-backed category filters', () => {
    const agentRule = readUtf8(agentRulePath);
    const guide = readUtf8(guidePath);
    const plateRule = readUtf8(plateRulePath);

    expect(agentRule).toContain('首次 lookup 一律以已判定的 `category` 為基礎');
    expect(agentRule).toContain('`erpItemCode` 是價格候選返回後才能取得的 DB 識別欄位');
    expect(agentRule).toContain('不得作為首次 lookup 的前提');
    expect(agentRule).toContain('只有 category 未知時');
    expect(agentRule).toContain('ST50、SN400B 等表單代號只保留在判讀/備註');
    expect(agentRule).toContain(
      '只有品名或規格可以作為價格 keyword，任何代號都不得作為價格 keyword',
    );
    expect(agentRule).toContain('某筆 query 已回傳規格精確且 `quoteEligible: true` 的可用候選後');
    expect(agentRule).toContain('修正查詢只可包含前次 `no_match`');
    expect(agentRule).toContain('不得原樣重送未修改的失敗 query');
    expect(agentRule).toContain('只有前次候選數等於前次 limit');
    expect(agentRule).toContain('整批沒有 query 數量上限');
    expect(guide).toContain('首次 lookup 一律以已判定的 `category` 為基礎');
    expect(guide).toContain('`erpItemCode` 是價格候選返回後才能取得的 DB 識別欄位');
    expect(guide).toContain('不得作為首次 lookup 的前提');
    expect(guide).toContain('整批沒有 query 數量上限');
    expect(guide).toContain('ST50、SN400B 等表單代號只保留在判讀/備註');
    expect(guide).toContain('只有品名或規格可以作為價格 keyword，任何代號都不得作為價格 keyword');
    expect(guide).toContain('某筆 query 已回傳規格精確且 `quoteEligible: true` 的可用候選後');
    expect(guide).toContain('只有前次候選數等於前次 limit');
    expect(plateRule).toContain(
      '{"category":"加工/孔","subcategory":"鐵板","keyword":"鑽孔","thicknessMm":["15"]}',
    );
    expect(plateRule).not.toContain('erpItemCode');
  });

  it('keeps every concrete category first lookup category-based and removes inferred ERP queries', () => {
    const concreteGuide = readUtf8(guidePath).split('\n三、各類別\n')[1];
    const concreteRuleFiles = fs
      .readdirSync(categoryRulesDir)
      .filter(
        (fileName) =>
          fileName.endsWith('.txt') && fileName !== '查價方式.txt' && fileName !== '長管-切工.txt',
      );

    expect(concreteGuide).toBeDefined();
    expect(concreteGuide).toContain('`高度x翼寬x腹板厚/翼板厚` 加入 `keyword`');
    const queryLines =
      concreteGuide?.split('\n').filter((line) => line.startsWith('- 查詢：')) ?? [];
    expect(queryLines).toHaveLength(priceCategories.length);
    for (const line of queryLines) {
      expect(line).toContain('category');
      expect(line).not.toContain('erpItemCode');
    }
    for (const fileName of concreteRuleFiles) {
      const rule = readUtf8(path.join(categoryRulesDir, fileName));
      if (fileName === 'H型鋼.txt') {
        expect(rule).toContain('完整斷面 `keyword`');
        expect(rule).toContain('不得再疊加 `thicknessMm`');
        expect(rule).toContain('不得再以拆分尺寸、改寫分隔符、加入相同厚度或放大 limit');
        expect(rule).toContain('H 型鋼材料 query 不另送 `加工/切工` query');
        expect(rule).toContain('不得依 Ø24、Ø22 等不同孔徑拆成多筆 query');
        expect(rule).toContain('KZZB11');
        expect(rule).toContain('unitWeightValue ÷ (lengthMm ÷ 1000)');
      }
      expect(rule).not.toContain('erpItemCode');
    }
    expect(concreteGuide).toContain('`寬x厚` canonical `keyword`');
    expect(concreteGuide).toContain('`高度x寬度x腹厚/翼厚` canonical `keyword`');
    expect(concreteGuide).toContain('`邊長x壁厚` canonical `keyword`');
    expect(concreteGuide).toContain('圖面 `150x150x6` 必須轉成價格 keyword `150x6`');
    expect(concreteGuide).toContain('H 型鋼的 KZZB11 `沖孔加工` 不以孔徑作價格 key');
    expect(concreteGuide).toContain('`寬x高x壁厚` canonical `keyword`');
    expect(concreteGuide).toContain(
      '{"category":"圓鐵","material":"黑鐵","keyword":"磨光圓鐵 10mm"}',
    );
    expect(concreteGuide).toContain(
      '{"category":"方鐵","material":"黑鐵","keyword":"磨光方鐵 25mm"}',
    );
    expect(concreteGuide).toContain(
      '{"category":"平鐵","material":"黑鐵","keyword":"黑鐵平鐵50 50x6mm"}',
    );
    expect(concreteGuide).toContain(
      '{"category":"角鐵","material":"黑鐵","keyword":"黑角鐵50 50x6mm"}',
    );
    expect(concreteGuide).toContain(
      '{"category":"槽鐵","material":"黑鐵","keyword":"槽鐵200 200x90x8/13.5"}',
    );
    expect(concreteGuide).toContain(
      '{"category":"圓管","subcategory":"鋼管","material":"黑鐵","keyword":"黑A鋼管 4in 101.6mm"}',
    );
    expect(concreteGuide).toContain(
      '{"category":"方管","material":"黑鐵","keyword":"黑鐵方管 100x6"}',
    );
    expect(concreteGuide).toContain('{"category":"鐵軌","keyword":"12K"}');
    expect(concreteGuide).toContain('鐵板沒有獨立自動切工價');
  });
});
