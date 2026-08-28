import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

type DryRunRule = {
  slug: string;
  sourceFile: string;
  factType: string;
  promptLength: number;
  ruleKind: string;
};

type DryRunSummary = {
  mode: string;
  target: 'dev' | 'prod';
  rules: DryRunRule[];
};

type BuiltRule = {
  slug: string;
  ruleKind: string;
  priority: number;
  ruleSections: string[];
  prompt: string;
  selectors: Record<string, unknown>;
  toolPolicy: Record<string, unknown>;
  outputPolicy: Record<string, unknown>;
  sourceRefs: { sourceFile: string }[];
};

interface SyncClient {
  query: jest.Mock<Promise<{ rows: object[] }>, [string, unknown?]>;
  release: jest.Mock<void, []>;
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const oldRulesDir = path.join(repoRoot, 'docs/rules/鋼材規則');
const rulesDir = path.join(repoRoot, 'docs/rules');
const categoryRulesDir = path.join(rulesDir, '類別規則');
const syncScript = path.join(repoRoot, 'packages/api/scripts/sync-steel-rules.cjs');

const ruleSync = jest.requireActual<{
  buildRules: (root: string) => BuiltRule[];
  loadTargetEnv: (
    root: string,
    target: 'dev' | 'prod',
    environment?: NodeJS.ProcessEnv,
  ) => NodeJS.ProcessEnv;
  parseArgs: (args: string[]) => {
    apply: boolean;
    dryRun: boolean;
    help: boolean;
    target: 'dev' | 'prod';
  };
  syncRules: (pool: { connect: () => Promise<SyncClient> }, rules: object[]) => Promise<object[]>;
}>('./sync-steel-rules.cjs');

function runDryRun(target: 'dev' | 'prod' = 'dev'): DryRunSummary {
  return JSON.parse(
    execFileSync(process.execPath, [syncScript, '--dry-run', '--target', target], {
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
    for (const args of [
      ['--dry-run', '--apply'],
      ['--unknown'],
      ['--target'],
      ['--target', 'staging'],
      ['--target', 'dev', '--target', 'prod'],
    ]) {
      expect(() =>
        execFileSync(process.execPath, [syncScript, ...args], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      ).toThrow();
    }
  });

  it('selects the requested dev or prod target', () => {
    expect(ruleSync.parseArgs([]).target).toBe('dev');
    expect(ruleSync.parseArgs(['--apply', '--target', 'prod'])).toMatchObject({
      apply: true,
      target: 'prod',
    });
    expect(runDryRun('prod').target).toBe('prod');
  });

  it('loads only the selected target database URL', () => {
    const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'steel-rule-target-'));
    const environment = { STEEL_POSTGRES_URL: 'postgresql://inherited.example/dev' };
    try {
      fs.writeFileSync(
        path.join(envRoot, '.env'),
        'STEEL_POSTGRES_URL=postgresql://dev.example/steel\n',
      );
      fs.writeFileSync(
        path.join(envRoot, '.env.prod'),
        'STEEL_POSTGRES_URL=postgresql://prod.example/steel\n',
      );

      const loadedEnvironment = ruleSync.loadTargetEnv(envRoot, 'prod', environment);
      expect(loadedEnvironment.STEEL_POSTGRES_URL).toBe('postgresql://prod.example/steel');
      expect(loadedEnvironment).not.toBe(environment);
      expect(environment.STEEL_POSTGRES_URL).toBe('postgresql://inherited.example/dev');
    } finally {
      fs.rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it('syncs every current local rule exactly once', () => {
    expect(fs.existsSync(oldRulesDir)).toBe(false);
    expect(fs.existsSync(path.join(categoryRulesDir, '長條料-切工.txt'))).toBe(false);

    const summary = runDryRun();
    const sourceFiles = summary.rules.map((rule) => rule.sourceFile);
    expect(summary.mode).toBe('dry-run');
    expect(summary.rules).toHaveLength(18);
    expect(sourceFiles.sort()).toEqual(listRuleFiles(rulesDir).sort());
    expect(new Set(sourceFiles).size).toBe(sourceFiles.length);
    expect(summary.rules.every((rule) => rule.promptLength > 0)).toBe(true);
    expect(summary.rules.filter((rule) => rule.factType === 'category_rule').at(0)?.slug).toBe(
      'steel_category_price_lookup_guide',
    );
    const builtCategoryRules = ruleSync
      .buildRules(repoRoot)
      .filter((rule) => rule.sourceRefs[0]?.sourceFile.startsWith('docs/rules/類別規則/'));
    expect(builtCategoryRules[0]?.slug).toBe('steel_category_price_lookup_guide');
    expect(
      builtCategoryRules.slice(1).every((rule) => rule.priority > builtCategoryRules[0]!.priority),
    ).toBe(true);
    expect(summary.rules.map((rule) => rule.slug).sort()).toEqual([
      'steel-default-agent-instruction',
      'steel-drawing-ocr-policy',
      'steel-drawing-vision-policy',
      'steel-ocr-main-agent-organizer-policy',
      'steel-ocr-subagent-organizer-policy',
      'steel-quote-calculation-verification-policy',
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

    const builtRules = ruleSync.buildRules(repoRoot);
    const quoteCalculationRule = builtRules.find(
      (rule) => rule.slug === 'steel-quote-calculation-verification-policy',
    );
    expect(quoteCalculationRule).toMatchObject({
      ruleKind: 'output',
      priority: 10,
      ruleSections: ['system_order_calculation', 'system_order_validation'],
      selectors: {
        appliesTo: ['steel_quote_runtime', 'output_sheet_context'],
        scopeType: 'company',
        activeSheets: ['system_order'],
        confidence: 'high',
      },
      sourceRefs: [
        {
          sourceFile: 'docs/rules/報價計算驗證規則.txt',
          locator: '報價計算驗證規則',
          canonicalKey: 'steel-quote-calculation-verification-policy',
          factType: 'output_rule',
        },
      ],
    });
    expect(quoteCalculationRule?.prompt.trim()).not.toBe('');
    expect(quoteCalculationRule?.toolPolicy).not.toEqual({});
    expect(quoteCalculationRule?.outputPolicy).toEqual({
      systemOrderTotalSource: 'current_turn_python_results',
      preserveExactTotal: true,
      unitPriceSource: 'selected_candidate_tier_price',
    });
    expect(
      builtRules.findIndex((rule) => rule.slug === 'steel-quote-calculation-verification-policy'),
    ).toBeLessThan(builtRules.findIndex((rule) => rule.slug === 'steel-workbook-output-policy'));
    const workbookOutputRule = builtRules.find(
      (rule) => rule.slug === 'steel-workbook-output-policy',
    );
    expect(workbookOutputRule).toMatchObject({
      selectors: {
        activeSheets: ['system_order', 'customer_data', 'manual_review'],
        synchronizedSheetsOnCustomerTierChange: ['system_order'],
      },
      outputPolicy: {
        activeSheets: ['system_order', 'customer_data', 'manual_review'],
        synchronizedSheetsOnCustomerTierChange: ['system_order'],
      },
    });
    const ocrIndex = builtRules.findIndex((rule) => rule.slug === 'steel-drawing-ocr-policy');
    const visionIndex = builtRules.findIndex((rule) => rule.slug === 'steel-drawing-vision-policy');
    const subagentIndex = builtRules.findIndex(
      (rule) => rule.slug === 'steel-ocr-subagent-organizer-policy',
    );
    const mainAgentIndex = builtRules.findIndex(
      (rule) => rule.slug === 'steel-ocr-main-agent-organizer-policy',
    );
    expect(ocrIndex).toBeGreaterThanOrEqual(0);
    expect(visionIndex).toBe(ocrIndex + 1);
    expect(subagentIndex).toBe(visionIndex + 1);
    expect(mainAgentIndex).toBe(subagentIndex + 1);
    expect(builtRules[visionIndex]).toMatchObject({
      priority: 36,
      ruleSections: ['file_vision', 'drawing_vision', 'vision_evidence'],
      selectors: {
        otherGlobalRulesKey: 'ocrMainAgentRules',
        requiresDrawingVision: true,
        requiresExistingOcrOutput: true,
      },
      toolPolicy: {
        visionMode: 'supplemental',
        preserveOcrOnConflict: true,
      },
      outputPolicy: {
        outputFormat: 'ocr_field_supplement',
        onlyFillMissingOrReviewFields: true,
        forbidPriceLookup: true,
        forbidFormalQuote: true,
      },
      sourceRefs: [
        {
          sourceFile: 'docs/rules/其他規則/Vision規則.txt',
        },
      ],
    });
    expect(builtRules[visionIndex]?.priority).toBeGreaterThan(
      builtRules[ocrIndex]?.priority ?? Number.POSITIVE_INFINITY,
    );
    expect(builtRules[subagentIndex]).toMatchObject({
      priority: 37,
      ruleSections: ['ocr_organizer'],
      selectors: {
        otherGlobalRulesKey: 'ocrSubagentRules',
      },
      outputPolicy: {
        organizerOutputFormat: 'chunk_local_markdown_table',
        preserveSourceRows: true,
        forbidPriceLookup: true,
        forbidFormalQuote: true,
      },
      sourceRefs: [
        {
          sourceFile: 'docs/rules/其他規則/OCR子Agent整理規則.txt',
        },
      ],
    });
    expect(builtRules[mainAgentIndex]).toMatchObject({
      priority: 38,
      ruleSections: ['delegate_ocr', 'ocr_main_merge', 'final_ocr_markdown'],
      selectors: {
        otherGlobalRulesKey: 'ocrMainAgentRules',
      },
      outputPolicy: {
        delegateOutputFormat: 'plain_text_or_markdown',
        mainOutputFormat: 'final_ocr_markdown',
        mergeScope: 'same_file_key',
      },
      sourceRefs: [
        {
          sourceFile: 'docs/rules/其他規則/OCR主Agent整理規則.txt',
        },
      ],
    });
  });

  it('publishes delegate_ocr tool metadata', () => {
    const agentRule = ruleSync
      .buildRules(repoRoot)
      .find((rule) => rule.slug === 'steel-default-agent-instruction');

    expect(agentRule?.toolPolicy.availableTools).toEqual([
      'search_customers',
      'search_price_candidates',
      'delegate_ocr',
    ]);
    expect(agentRule?.sourceRefs.map(({ sourceFile }) => sourceFile)).toEqual([
      'docs/rules/agent規則.txt',
    ]);
  });

  it('publishes processing and cutting rule metadata', () => {
    const builtRules = ruleSync.buildRules(repoRoot);
    expect(builtRules.find((rule) => rule.slug === 'steel_quote_rules_processing')).toMatchObject({
      toolPolicy: {
        processingQueries: {
          '加工/切工': {
            keywordPolicy: 'omit',
            deduplicateBy: ['categories', 'processingCategories'],
            excludesAutomaticLongMaterialCutting: true,
          },
        },
      },
    });
    expect(
      builtRules.find((rule) => rule.slug === 'steel_category_price_lookup_guide'),
    ).toMatchObject({
      outputPolicy: {
        materialPriceIncludesProcessing: false,
        separateProcessingCategories: ['加工/切工', '加工/孔', '加工/折工'],
        noChargeRequiresExplicitCategoryRule: true,
      },
    });
    expect(
      builtRules.find((rule) => rule.slug === 'steel_quote_rules_long_material_cutting'),
    ).toMatchObject({
      outputPolicy: {
        drawingKnifeCount: {
          outerStraightEdge: 1,
          bevel: 1,
          cutCorner: 1,
          multiplyByQuantity: true,
        },
        separateFrom: ['加工/孔', '加工/折工'],
        missingPriceBehavior: 'retain_blank_and_manual_review',
        unitBilling: {
          source: 'price_row.unit',
          quantityByUnit: {
            刀: 'confirmed_knife_count',
            片: 'confirmed_steel_piece_count',
          },
          pieceUnitKnifeCount: 'note_only',
          pieceUnitExcludedCategories: ['圓條', '圓管', '方管', '扁方管'],
          missingOrIncompatibleUnitOrQuantity: 'blank_and_manual_review',
        },
      },
    });
  });
});
