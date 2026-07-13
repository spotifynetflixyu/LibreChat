import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import { priceCategories, priceSubcategoriesByCategory } from '../src/steel/pricing/categories';

type DryRunRule = {
  slug: string;
  sourceFile: string;
  factType: string;
  promptLength: number;
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
const rulesDir = path.join(repoRoot, 'docs/rules');
const categoryRulesDir = path.join(rulesDir, '類別規則');
const agentRulePath = path.join(rulesDir, 'agent規則.txt');
const guidePath = path.join(categoryRulesDir, '查價方式.txt');
const plateRulePath = path.join(categoryRulesDir, '鐵板.txt');
const meshRulePath = path.join(categoryRulesDir, '網.txt');
const squareBarRulePath = path.join(categoryRulesDir, '方鐵.txt');
const longMaterialRulePath = path.join(categoryRulesDir, '長條料.txt');
const cuttingRulePath = path.join(categoryRulesDir, '切工.txt');
const outputRulePath = path.join(rulesDir, '輸出規則.txt');
const ocrRulePath = path.join(rulesDir, '其他規則', 'OCR規則.txt');
const syncScript = path.join(repoRoot, 'packages/api/scripts/sync-steel-rules.cjs');

const ruleSync = jest.requireActual<{
  buildRules: (root: string) => object[];
  syncRules: (pool: { connect: () => Promise<SyncClient> }, rules: object[]) => Promise<object[]>;
}>('./sync-steel-rules.cjs');

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
    return entry.name.endsWith('.txt') ? [path.relative(repoRoot, absolutePath)] : [];
  });
}

function parseCategorySubcategories(guide: string): Map<string, string[]> {
  return new Map(
    guide
      .split(/^## /mu)
      .slice(1)
      .map((section) => {
        const [category, ...bodyLines] = section.split('\n');
        if (!category) {
          throw new Error('Missing category heading');
        }
        const subcategories = bodyLines.join('\n').match(/^次類別=\[(.*)\]$/mu)?.[1];
        return [category, subcategories ? subcategories.split('|') : []];
      }),
  );
}

describe('Steel rule sources', () => {
  it('rolls back an interrupted publication on its dedicated connection', async () => {
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

  it('cleans the retired combined long-material source path during publication', async () => {
    const client: SyncClient = {
      query: jest.fn(async () => ({ rows: [] })),
      release: jest.fn(),
    };

    await ruleSync.syncRules({ connect: async () => client }, ruleSync.buildRules(repoRoot));

    const deleteCall = client.query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM steel.rules'),
    );
    const sourceFileRefs = (deleteCall?.[1] as [string[], string[]] | undefined)?.[0] ?? [];
    expect(sourceFileRefs).toContain(
      JSON.stringify([{ sourceFile: 'docs/rules/類別規則/長條料-切工.txt' }]),
    );
    expect(client.query.mock.calls.map(([sql]) => sql.trim())).toContain('COMMIT');
  });

  it('rejects conflicting or unknown CLI flags', () => {
    for (const args of [['--dry-run', '--apply'], ['--unknown']]) {
      expect(() =>
        execFileSync(process.execPath, [syncScript, ...args], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      ).toThrow();
    }
  });

  it('syncs every current local rule exactly once', () => {
    expect(fs.existsSync(oldRulesDir)).toBe(false);
    expect(fs.existsSync(path.join(categoryRulesDir, '長條料-切工.txt'))).toBe(false);

    const summary = runDryRun();
    const sourceFiles = summary.rules.map((rule) => rule.sourceFile);
    expect(summary.mode).toBe('dry-run');
    expect(sourceFiles.sort()).toEqual(listRuleFiles(rulesDir).sort());
    expect(new Set(sourceFiles).size).toBe(sourceFiles.length);
    expect(summary.rules.every((rule) => rule.promptLength > 0)).toBe(true);
    expect(summary.rules.filter((rule) => rule.factType === 'category_rule').at(-1)?.slug).toBe(
      'steel_category_price_lookup_guide',
    );
    expect(summary.rules.map((rule) => rule.slug).sort()).toEqual([
      'steel-default-agent-instruction',
      'steel-drawing-ocr-policy',
      'steel-workbook-output-policy',
      'steel_category_price_lookup_guide',
      'steel_quote_rules_c_type',
      'steel_quote_rules_h_beam',
      'steel_quote_rules_hole',
      'steel_quote_rules_long_material',
      'steel_quote_rules_long_material_cutting',
      'steel_quote_rules_mesh',
      'steel_quote_rules_other_categories',
      'steel_quote_rules_plate',
      'steel_quote_rules_processing',
      'steel_quote_rules_square_bar',
    ]);
  });

  it('matches every category index entry to the registry', () => {
    const actual = parseCategorySubcategories(readUtf8(guidePath));
    expect([...actual.keys()]).toEqual([...priceCategories]);
    for (const [category, subcategories] of actual) {
      expect(
        subcategories.every((subcategory) =>
          (
            priceSubcategoriesByCategory[
              category as keyof typeof priceSubcategoriesByCategory
            ] as readonly string[]
          ).includes(subcategory),
        ),
      ).toBe(true);
    }
  });

  it('keeps only AI-actionable lookup behavior in the prompt', () => {
    const guide = readUtf8(guidePath);

    expect(guide).not.toContain('[category_lookup_contract]');
    expect(guide).not.toContain('query_id_generation=');
    expect(guide).not.toContain('cutting_query_timing=');
    expect(guide).not.toContain('query_limit_overflow=');
    expect(guide).toContain('加工放入同一 tool call 的 `processingQueries`');
    expect(guide).toContain('超過10筆只返回全部唯一 `productNames`');
    expect(guide).toContain('前次結果已達30');
    expect(guide).toContain('材料切工只使用同次結果的 `cuttingPrices`');
  });

  it('keeps OCR rerun, correction, organizer, and final Markdown contracts concise', () => {
    const rule = readUtf8(ocrRulePath);

    expect(rule.match(/\[ocr_shared\]/gu)).toHaveLength(1);
    expect(rule.match(/\[\/ocr_shared\]/gu)).toHaveLength(1);
    expect(rule.match(/\[ocr_organizer\]/gu)).toHaveLength(1);
    expect(rule.match(/\[\/ocr_organizer\]/gu)).toHaveLength(1);
    expect(rule).toContain('只有資料缺失、失敗，或使用者明確要求重做 OCR 時');
    expect(rule).toContain('明顯 OCR 誤判時直接修正');
    expect(rule).toContain('公式結果與 operands 不一致時，直接以 operands 重算修正');
    expect(rule).toContain('旋轉的文字或圖面先旋正再判讀');
    expect(rule).toContain('中文一律保留或轉繁體中文');
    expect(rule).toContain('開槽連續邊長');
    expect(rule).toContain('總孔數 = 每件孔數 × 件數');
    expect(rule).toContain('每筆來源列保持獨立');
    expect(rule).toContain('每列至少包含來源頁數、項次、件號、圖號或其他可追溯代號');
    expect(rule).toContain('缺值一律留空');
    expect(rule).toContain('禁止用「約、略、大約、約略」');
    expect(rule).toContain('同一 file key 的所有 chunk 合併成一張');
    expect(rule).not.toContain('OCR process 不得呼叫');
  });

  it('keeps system-order and customer-facing Markdown decisions without persistence prose', () => {
    const rule = readUtf8(outputRulePath);

    expect(rule).toContain('凡輸出的表都必須是完整最新版');
    expect(rule).toContain(
      '`型號`、`品名規格`、`材質編號`、`單位`、`數量`、`單重`、`總數`、`單價`、`計價基準`、`公式編號`、`厚度`、`寬度`、`長度`、`肚`、`類別`、`備註`',
    );
    expect(rule).toContain('孔加工列數量合計必須等於已確認總孔數');
    expect(rule).toContain('不得顯示內部等級、成本、毛利、計價基準或tier');
    expect(rule).not.toContain('沿用上一版');
    expect(rule).not.toContain('逐列 merge');
  });

  it('keeps general lookup policy out of the agent rule', () => {
    const agent = readUtf8(agentRulePath);
    const guide = readUtf8(guidePath);

    expect(agent).toContain('一律依【search_price_candidates 通用查價規則】');
    expect(agent).not.toContain('每筆 `limit` 預設30');
    expect(agent).not.toContain('ST50、SN400B');
    expect(agent).not.toContain('`ratio_only` 來源 unit');
    expect(guide).toContain('前次結果已達30');
    expect(guide).toContain('ST50、SN400B');
    expect(guide).toContain('候選有效 `unit`');
    expect(guide).not.toContain('`ratio_only` 來源 unit');
  });

  it('separates long-material lookup and cutting concerns', () => {
    const longMaterial = readUtf8(longMaterialRulePath);
    const cutting = readUtf8(cuttingRulePath);

    expect(longMaterial).toContain('平鐵、角鐵、圓管、圓條、扁方管、方管、槽鐵');
    expect(longMaterial).toContain('未標時固定6M');
    expect(longMaterial).toContain('圓條（圓鐵）');
    expect(longMaterial).toContain('`10x20x6M` 的6M是長度');
    expect(longMaterial).not.toContain('切平行斜刀=基本價×2−10');
    expect(cutting).toContain('切平行斜刀=基本價×2−10');
    expect(cutting).toContain('一支母材切 n 支且無餘料：n−1刀');
    expect(cutting).toContain('方鐵可裁切');
    expect(cutting).toContain('最相近圓條切工基本價');
    expect(cutting).toContain('鐵板、鐵軌不得借用其他類別切工');
    expect(cutting).not.toContain('未標時固定6M');
    expect(cutting).not.toContain('keyword 只用 `寬x高x壁厚`');
  });

  it('keeps protected category-specific contracts in their owners', () => {
    const plate = readUtf8(plateRulePath);
    const mesh = readUtf8(meshRulePath);
    const squareBar = readUtf8(squareBarRulePath);

    expect(plate).toContain('雷射切割 → 四方切 → 版型切型');
    expect(plate).toContain('鐵板沒有獨立自動切工價');
    expect(mesh).toContain('不使用 `keyword`');
    expect(mesh).toContain('不足一捲仍按一整丸');
    expect(squareBar).toContain('candidate `density`');
    expect(squareBar).toContain('品名沒有明示素材長度時不得自行補6M');
    expect(readUtf8(longMaterialRulePath)).toContain('方鐵是實心方形截面的長條料（實心方管）');
    expect(readUtf8(longMaterialRulePath)).toContain(
      'query、Kg 實心截面計重、素材長度來源與不補6M例外依【方鐵類別規則】',
    );
    expect(readUtf8(longMaterialRulePath)).not.toContain('## 方鐵');
  });

  it('does not duplicate substantive rule segments across files', () => {
    const ownersBySegment = new Map<string, string[]>();
    for (const sourceFile of listRuleFiles(rulesDir)) {
      const segments = readUtf8(path.join(repoRoot, sourceFile))
        .split(/[。；\n]/u)
        .map((line) => line.trim().replace(/^[-*0-9.、\s]+/u, ''))
        .filter(
          (line) =>
            Array.from(line).length >= 28 &&
            !line.startsWith('次類別=[') &&
            !line.startsWith('query_filters=') &&
            !line.startsWith('|'),
        );
      for (const segment of new Set(segments)) {
        ownersBySegment.set(segment, [...(ownersBySegment.get(segment) ?? []), sourceFile]);
      }
    }

    expect(
      [...ownersBySegment.entries()].filter(([, sourceFiles]) => sourceFiles.length > 1),
    ).toEqual([]);
  });

  it('uses only generic first-lookup keywords unless supplied by the user', () => {
    const allRules = listRuleFiles(rulesDir)
      .map((sourceFile) => readUtf8(path.join(repoRoot, sourceFile)))
      .join('\n');
    for (const keyword of [
      '黑鐵平鐵50 50x6mm',
      '黑角鐵50 50x6mm',
      '黑A鋼管 4in 101.6mm',
      '黑鐵方管 100x6',
      '黑鐵扁方管 40x80x3',
      '磨光圓鐵 10mm',
      '磨光方鐵 25mm',
    ]) {
      expect(allRules).not.toContain(`"keyword":"${keyword}"`);
    }
    expect(allRules).not.toMatch(/"stockLengthMm"\s*:\s*\[\s*"?6000"?\s*\]/u);
    expect(allRules).not.toMatch(/依\s*`?[^`\n]+\.txt`?/u);
  });
});
