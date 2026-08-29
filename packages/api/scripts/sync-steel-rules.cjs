#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
process.env.TS_NODE_TRANSPILE_ONLY = 'true';

require('ts-node/register/transpile-only');

const { createSteelPostgresPool } = require('../src/steel/postgres');

function findRepoRoot(startDir) {
  let current = startDir;

  while (current !== path.dirname(current)) {
    const packageJson = path.join(current, 'package.json');
    if (fs.existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
        if (parsed.name === 'LibreChat') {
          return current;
        }
      } catch {
        return current;
      }
    }

    current = path.dirname(current);
  }

  return process.cwd();
}

function loadTargetEnv(repoRoot, target, environment = process.env) {
  const envFile = target === 'prod' ? '.env.prod' : '.env';
  const envPath = path.join(repoRoot, envFile);
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${target} environment file: ${envFile}`);
  }

  const parsed = require('dotenv').parse(fs.readFileSync(envPath));
  const connectionString = parsed.STEEL_POSTGRES_URL?.trim();
  if (!connectionString) {
    throw new Error(`${envFile} must define STEEL_POSTGRES_URL`);
  }

  return {
    ...environment,
    STEEL_POSTGRES_URL: connectionString,
  };
}

function parseArgs(argv) {
  let apply = false;
  let dryRun = false;
  let help = false;
  let target = 'dev';
  let targetSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--target') {
      if (targetSeen) {
        throw new Error('--target may only be specified once.');
      }
      const value = argv[index + 1];
      if (value !== 'dev' && value !== 'prod') {
        throw new Error('--target must be either dev or prod.');
      }
      target = value;
      targetSeen = true;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (apply && dryRun) {
    throw new Error('Use either --dry-run or --apply, not both.');
  }

  return {
    apply,
    dryRun: dryRun || !apply,
    help,
    target,
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  node packages/api/scripts/sync-steel-rules.cjs --dry-run [--target dev|prod]
  node packages/api/scripts/sync-steel-rules.cjs --apply [--target dev|prod]

Default mode is --dry-run and the default target is dev. --apply loads
STEEL_POSTGRES_URL from .env for dev or .env.prod for prod, syncs agent, output,
other, and category rules under docs/rules into steel.rules, then reads rows back.
`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readRulePrompt(repoRoot, sourceFile) {
  const prompt = fs.readFileSync(path.join(repoRoot, sourceFile), 'utf8').trim();
  if (!prompt) {
    throw new Error(`${sourceFile} is empty`);
  }

  return { prompt, sha256: sha256(prompt) };
}

function listTextFiles(repoRoot, sourceDir) {
  const absoluteDir = path.join(repoRoot, sourceDir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  return fs
    .readdirSync(absoluteDir)
    .filter((entry) => entry.endsWith('.txt'))
    .sort((left, right) => left.localeCompare(right, 'zh-Hant'))
    .map((entry) => path.join(sourceDir, entry));
}

function ruleSource(sourceFile, locator, canonicalKey, fileSha, factType = 'rule') {
  return {
    channel: 'repo_docs',
    factType,
    sourceFile,
    locator,
    canonicalKey,
    sha256: fileSha,
  };
}

function toJson(value) {
  return JSON.stringify(value);
}

function unifiedRule({
  slug,
  version = 1,
  ruleKind,
  title,
  ruleSections,
  selectors,
  prompt,
  toolPolicy = {},
  outputPolicy = {},
  priority,
  source,
}) {
  return {
    slug,
    version,
    ruleKind,
    title,
    locale: 'zh-TW',
    ruleSections,
    selectors,
    prompt,
    toolPolicy,
    outputPolicy,
    priority,
    active: true,
    reviewState: 'reviewed',
    source,
  };
}

const categoryRuleMetadataByFile = {
  'docs/rules/類別規則/查價方式.txt': {
    slug: 'steel_category_price_lookup_guide',
    title: 'Steel 類別查價方式',
    locator: '類別查價方式',
    ruleSection: 'price_lookup',
    priority: 19,
    outputPolicy: {
      materialPriceIncludesProcessing: false,
      separateProcessingCategories: ['加工/切工', '加工/孔', '加工/折工'],
      noChargeRequiresExplicitCategoryRule: true,
    },
  },
  'docs/rules/類別規則/C型鋼.txt': {
    slug: 'steel_quote_rules_c_type',
    title: 'Steel C型鋼類別規則',
    locator: 'C型鋼類別規則',
    ruleSection: 'c_type',
    catalogFamily: 'c_type',
    priority: 20,
  },
  'docs/rules/類別規則/H型鋼.txt': {
    slug: 'steel_quote_rules_h_beam',
    title: 'Steel H型鋼類別規則',
    locator: 'H型鋼類別規則',
    ruleSection: 'h_beam',
    catalogFamily: 'h_beam',
    priority: 20,
  },
  'docs/rules/類別規則/鐵板.txt': {
    slug: 'steel_quote_rules_plate',
    title: 'Steel 鐵板類別規則',
    locator: '鐵板類別規則',
    ruleSection: 'plate_weight_processing',
    catalogFamily: 'plate',
    priority: 25,
  },
  'docs/rules/類別規則/孔.txt': {
    slug: 'steel_quote_rules_hole',
    title: 'Steel 孔加工類別規則',
    locator: '孔加工類別規則',
    ruleSection: 'hole_processing',
    catalogFamily: 'hole',
    priority: 23,
  },
  'docs/rules/類別規則/網.txt': {
    slug: 'steel_quote_rules_mesh',
    title: 'Steel 網類別規則',
    locator: '網類別規則',
    ruleSection: 'mesh',
    catalogFamily: 'mesh',
    priority: 22,
  },
  'docs/rules/類別規則/方鐵.txt': {
    slug: 'steel_quote_rules_square_bar',
    title: 'Steel 方鐵類別規則',
    locator: '方鐵類別規則',
    ruleSection: 'square_bar',
    catalogFamily: 'square_bar',
    priority: 22,
  },
  'docs/rules/類別規則/其他類別.txt': {
    slug: 'steel_quote_rules_other_categories',
    title: 'Steel 其他產品類別規則',
    locator: '其他產品類別規則',
    ruleSection: 'other_categories',
    priority: 22,
  },
  'docs/rules/類別規則/加工.txt': {
    slug: 'steel_quote_rules_processing',
    title: 'Steel 一般加工類別規則',
    locator: '一般加工類別規則',
    ruleSection: 'processing',
    priority: 23,
    toolPolicy: {
      processingQueries: {
        '加工/切工': {
          keywordPolicy: 'omit',
          deduplicateBy: ['categories', 'processingCategories'],
          excludesAutomaticLongMaterialCutting: true,
        },
      },
    },
  },
  'docs/rules/類別規則/長條料.txt': {
    slug: 'steel_quote_rules_long_material',
    title: 'Steel 長條料類別規則',
    locator: '長條料類別規則',
    ruleSection: 'long_material',
    priority: 23,
  },
  'docs/rules/類別規則/切工.txt': {
    slug: 'steel_quote_rules_long_material_cutting',
    title: 'Steel 長條料切工類別規則',
    locator: '長條料切工類別規則',
    ruleSection: 'bar_cutting',
    priority: 24,
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
  },
};

function readCategoryRuleMetadata(sourceFile) {
  const metadata = categoryRuleMetadataByFile[sourceFile];
  if (!metadata) {
    throw new Error(`Missing category rule metadata for ${sourceFile}`);
  }

  return metadata;
}

function categoryRule({ sourceFile, prompt, fileSha }) {
  const metadata = readCategoryRuleMetadata(sourceFile);

  return unifiedRule({
    slug: metadata.slug,
    ruleKind: 'steel',
    title: metadata.title,
    ruleSections: ['steel_category_rule', metadata.ruleSection].filter(Boolean),
    selectors: {
      appliesTo: ['steel_quote_runtime', 'steel_global_rules_context'],
      ruleType: 'category_rule',
      scopeType: metadata.catalogFamily ? 'catalog_family' : 'company',
      catalogFamily: metadata.catalogFamily,
      confidence: 'high',
    },
    prompt,
    toolPolicy: metadata.toolPolicy,
    outputPolicy: metadata.outputPolicy,
    priority: metadata.priority,
    source: ruleSource(sourceFile, metadata.locator, metadata.slug, fileSha, 'category_rule'),
  });
}

function buildRules(repoRoot) {
  const agent = readRulePrompt(repoRoot, 'docs/rules/agent規則.txt');
  const quoteCalculation = readRulePrompt(repoRoot, 'docs/rules/報價計算驗證規則.txt');
  const output = readRulePrompt(repoRoot, 'docs/rules/輸出規則.txt');
  const ocr = readRulePrompt(repoRoot, 'docs/rules/其他規則/OCR規則.txt');
  const vision = readRulePrompt(repoRoot, 'docs/rules/其他規則/Vision規則.txt');
  const ocrSubagent = readRulePrompt(repoRoot, 'docs/rules/其他規則/OCR子Agent整理規則.txt');
  const ocrMainAgent = readRulePrompt(repoRoot, 'docs/rules/其他規則/OCR主Agent整理規則.txt');
  const categoryRules = listTextFiles(repoRoot, 'docs/rules/類別規則')
    .map((sourceFile) => {
      const rule = readRulePrompt(repoRoot, sourceFile);
      return categoryRule({
        sourceFile,
        prompt: rule.prompt,
        fileSha: rule.sha256,
      });
    })
    .sort((left, right) => left.priority - right.priority || left.slug.localeCompare(right.slug));

  const rules = [
    unifiedRule({
      slug: 'steel-default-agent-instruction',
      ruleKind: 'agent',
      title: 'Steel 預設 Agent Instruction',
      ruleSections: ['agent_instruction', 'tool_flow', 'inference_order', 'confirmation_policy'],
      selectors: {
        appliesTo: ['steel_quote_runtime'],
        locale: 'zh-TW',
        confidence: 'high',
      },
      prompt: agent.prompt,
      toolPolicy: {
        availableTools: ['search_customers', 'search_price_candidates', 'delegate_ocr'],
      },
      outputPolicy: { answerLanguage: 'zh-TW' },
      priority: 10,
      source: ruleSource(
        'docs/rules/agent規則.txt',
        'Steel 預設 Agent Instruction',
        'agent_default_instruction',
        agent.sha256,
        'agent_rule',
      ),
    }),
    unifiedRule({
      slug: 'steel-quote-calculation-verification-policy',
      ruleKind: 'output',
      title: 'Steel 報價計算驗證規則',
      ruleSections: ['system_order_calculation', 'system_order_validation'],
      selectors: {
        appliesTo: ['steel_quote_runtime', 'output_sheet_context'],
        scopeType: 'company',
        activeSheets: ['system_order'],
        confidence: 'high',
      },
      prompt: quoteCalculation.prompt,
      toolPolicy: {
        requiredTool: 'OpenAI Python',
        runAfter: 'price_lookup',
      },
      outputPolicy: {
        systemOrderTotalSource: 'current_turn_python_results',
        preserveExactTotal: true,
        unitPriceSource: 'selected_candidate_tier_price',
      },
      priority: 10,
      source: ruleSource(
        'docs/rules/報價計算驗證規則.txt',
        '報價計算驗證規則',
        'steel-quote-calculation-verification-policy',
        quoteCalculation.sha256,
        'output_rule',
      ),
    }),
    unifiedRule({
      slug: 'steel-workbook-output-policy',
      ruleKind: 'output',
      title: 'Steel 輸出表單規則',
      ruleSections: ['workbook_output', 'output_policy', 'output_sheet', 'customer_tier_sync'],
      selectors: {
        appliesTo: ['steel_quote_runtime', 'output_sheet_context'],
        activeSheets: ['system_order', 'customer_data', 'manual_review'],
        synchronizedSheetsOnCustomerTierChange: ['system_order'],
        confidence: 'high',
      },
      prompt: output.prompt,
      toolPolicy: {
        availableTools: ['search_customers', 'search_price_candidates'],
      },
      outputPolicy: {
        activeSheets: ['system_order', 'customer_data', 'manual_review'],
        missingSheetBehavior: 'carry_forward_previous_active_sheet',
        emittedSheetBehavior: 'replace_previous_active_sheet',
        omittedRowsInEmittedSheet: 'clear_or_delete',
        defaultCustomerTierWhenUncertain: 'B',
        synchronizedSheetsOnCustomerTierChange: ['system_order'],
      },
      priority: 20,
      source: ruleSource(
        'docs/rules/輸出規則.txt',
        'Steel 輸出規則',
        'steel_output_sheet_policy',
        output.sha256,
        'output_rule',
      ),
    }),
    unifiedRule({
      slug: 'steel-drawing-ocr-policy',
      ruleKind: 'other',
      title: '圖面 OCR 共同規則',
      ruleSections: ['ocr_shared'],
      selectors: {
        appliesTo: ['steel_quote_runtime', 'other_global_rules'],
        includeWhenFileContext: true,
        sourceKinds: ['image', 'pdf', 'scanned_pdf'],
        confidence: 'high',
      },
      prompt: ocr.prompt,
      outputPolicy: {
        outputFormat: 'markdown_tables',
        preserveSourceRows: true,
        forbidGraphicInference: true,
      },
      priority: 35,
      source: ruleSource(
        'docs/rules/其他規則/OCR規則.txt',
        '圖面 OCR 共同規則',
        'drawing_ocr_local_table_reading',
        ocr.sha256,
        'other_rule',
      ),
    }),
    unifiedRule({
      slug: 'steel-drawing-vision-policy',
      ruleKind: 'other',
      title: '圖面加工判斷規則',
      ruleSections: ['vision_processing'],
      selectors: {
        appliesTo: ['steel_quote_runtime', 'other_global_rules'],
        includeWhenFileContext: true,
        sourceKinds: ['image', 'pdf', 'scanned_pdf'],
        confidence: 'high',
      },
      prompt: vision.prompt,
      outputPolicy: {
        outputFormat: 'processing_confirmation',
        preservePerItemQuantities: true,
        unconfirmedValueBehavior: 'leave_blank_and_review',
      },
      priority: 36,
      source: ruleSource(
        'docs/rules/其他規則/Vision規則.txt',
        '圖面加工判斷規則',
        'drawing_vision_supplemental_evidence',
        vision.sha256,
        'other_rule',
      ),
    }),
    unifiedRule({
      slug: 'steel-ocr-subagent-organizer-policy',
      ruleKind: 'other',
      title: 'OCR 整理規則',
      ruleSections: ['ocr_organizer'],
      selectors: {
        appliesTo: ['steel_quote_runtime', 'steel_ocr_preprocessing', 'other_global_rules'],
        includeWhenFileContext: true,
        confidence: 'high',
      },
      prompt: ocrSubagent.prompt,
      outputPolicy: {
        organizerOutputFormat: 'chunk_local_markdown_table',
        preserveSourceRows: true,
        forbidPriceLookup: true,
        forbidFormalQuote: true,
      },
      priority: 37,
      source: ruleSource(
        'docs/rules/其他規則/OCR子Agent整理規則.txt',
        'OCR 整理規則',
        'ocr_subagent_organizer',
        ocrSubagent.sha256,
        'other_rule',
      ),
    }),
    unifiedRule({
      slug: 'steel-ocr-main-agent-organizer-policy',
      ruleKind: 'other',
      title: 'OCR 流程與 Markdown 輸出規則',
      ruleSections: ['ocr_main_merge', 'final_ocr_markdown'],
      selectors: {
        appliesTo: ['steel_quote_runtime', 'other_global_rules'],
        includeWhenFileContext: true,
        confidence: 'high',
      },
      prompt: ocrMainAgent.prompt,
      outputPolicy: {
        mainOutputFormat: 'final_ocr_markdown',
        mergeScope: 'same_file_key',
        preserveSourceRows: true,
        integrateProcessingConfirmation: true,
        forbidPriceLookup: true,
        forbidFormalQuote: true,
      },
      priority: 38,
      source: ruleSource(
        'docs/rules/其他規則/OCR主Agent整理規則.txt',
        'OCR 流程與 Markdown 輸出規則',
        'ocr_flow_and_markdown_output',
        ocrMainAgent.sha256,
        'other_rule',
      ),
    }),
    ...categoryRules,
  ];

  return rules;
}

async function upsertRule(client, rule) {
  await client.query(
    `
INSERT INTO steel.rules (
  slug,
  version,
  rule_kind,
  title,
  locale,
  rule_sections,
  selectors,
  prompt,
  tool_policy,
  output_policy,
  priority,
  active,
  review_state,
  created_by
)
VALUES (
  $1,
  $2,
  $3,
  $4,
  $5,
  $6::text[],
  $7::jsonb,
  $8,
  $9::jsonb,
  $10::jsonb,
  $11,
  $12,
  $13,
  $14
)
ON CONFLICT (slug, version)
DO UPDATE
SET
  rule_kind = EXCLUDED.rule_kind,
  title = EXCLUDED.title,
  locale = EXCLUDED.locale,
  rule_sections = EXCLUDED.rule_sections,
  selectors = EXCLUDED.selectors,
  prompt = EXCLUDED.prompt,
  tool_policy = EXCLUDED.tool_policy,
  output_policy = EXCLUDED.output_policy,
  priority = EXCLUDED.priority,
  active = EXCLUDED.active,
  review_state = EXCLUDED.review_state,
  created_by = EXCLUDED.created_by,
  reviewed_at = NOW(),
  updated_at = NOW()
`,
    [
      rule.slug,
      rule.version,
      rule.ruleKind,
      rule.title,
      rule.locale,
      rule.ruleSections,
      toJson(rule.selectors),
      rule.prompt,
      toJson(rule.toolPolicy),
      toJson(rule.outputPolicy),
      rule.priority,
      rule.active,
      rule.reviewState,
      'sync-steel-rules',
    ],
  );
}

async function deleteRemovedRules(client, rules) {
  await client.query(
    `
DELETE FROM steel.rules
WHERE created_by = 'sync-steel-rules'
  AND NOT (slug = ANY($1::text[]))
`,
    [rules.map((rule) => rule.slug)],
  );
}

async function readBackRules(client, rules) {
  const result = await client.query(
    `
SELECT
  slug,
  version,
  rule_kind,
  rule_sections,
  active,
  review_state,
  prompt
FROM steel.rules
WHERE slug = ANY($1::text[])
ORDER BY rule_kind ASC, priority ASC, slug ASC
`,
    [rules.map((rule) => rule.slug)],
  );

  return result.rows.map(({ prompt, ...row }) => ({
    ...row,
    promptSha256: sha256(prompt || ''),
  }));
}

function summarizeRules(rules, mode, target) {
  return {
    mode,
    target,
    rules: rules.map((rule) => ({
      slug: rule.slug,
      version: rule.version,
      ruleKind: rule.ruleKind,
      ruleSections: rule.ruleSections,
      sourceFile: rule.source.sourceFile,
      factType: rule.source.factType,
      sha256: rule.source.sha256,
      promptLength: rule.prompt.length,
    })),
  };
}

async function syncRules(pool, rules) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('steel.rules:sync'))");
    await deleteRemovedRules(client, rules);
    for (const rule of rules) {
      await upsertRule(client, rule);
    }

    const rows = await readBackRules(client, rules);
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const repoRoot = findRepoRoot(path.resolve(__dirname, '..', '..', '..'));
  const rules = buildRules(repoRoot);
  const summary = summarizeRules(rules, args.apply ? 'apply' : 'dry-run', args.target);

  if (args.dryRun && !args.apply) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const targetEnv = loadTargetEnv(repoRoot, args.target);
  const pool = createSteelPostgresPool(targetEnv);

  try {
    const row = await syncRules(pool, rules);
    process.stdout.write(`${JSON.stringify({ ...summary, row }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

module.exports = {
  buildRules,
  loadTargetEnv,
  parseArgs,
  syncRules,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
