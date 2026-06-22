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

function loadRootEnv(repoRoot) {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  require('dotenv').config({ path: envPath });
}

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    dryRun: argv.includes('--dry-run') || !argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  node packages/api/scripts/sync-steel-rules.cjs --dry-run
  node packages/api/scripts/sync-steel-rules.cjs --apply

Default mode is --dry-run. --apply syncs every docs/rules/*.txt source into
reviewed Supabase Steel rules using STEEL_POSTGRES_URL, then reads rows back.
`);
}

function toJson(value) {
  return JSON.stringify(value);
}

function readRulePrompt(repoRoot, sourceFile) {
  const prompt = fs.readFileSync(path.join(repoRoot, sourceFile), 'utf8').trim();
  if (!prompt) {
    throw new Error(`${sourceFile} is empty`);
  }

  return {
    prompt,
    sha256: crypto.createHash('sha256').update(prompt, 'utf8').digest('hex'),
  };
}

function readFileSha(repoRoot, sourceFile) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(repoRoot, sourceFile)))
    .digest('hex');
}

function sourceRef(sourceFile, locator, canonicalKey, sha256, factType = 'agent_rule') {
  return {
    channel: 'repo_docs',
    factType,
    sourceFile,
    locator,
    canonicalKey,
    sha256,
  };
}

function getPromptSection(prompt, startText, endText) {
  const start = prompt.indexOf(startText);
  if (start < 0) {
    throw new Error(`Missing rule section: ${startText}`);
  }

  const end = endText ? prompt.indexOf(endText, start + startText.length) : -1;
  return prompt.slice(start, end >= 0 ? end : undefined).trim();
}

function quoteRule({
  canonicalKey,
  catalogFamily,
  locator,
  prompt,
  sha256,
  priority,
  selectors = {},
  extraSourceRefs = [],
}) {
  return {
    canonicalKey,
    ruleType: 'calculation_rule',
    scopeType: catalogFamily ? 'catalog_family' : 'company',
    catalogFamily,
    productFamily: null,
    chargeType: null,
    formulaCode: null,
    selectors: {
      appliesTo: ['steel_quote_runtime', 'steel_global_rules_context'],
      ...selectors,
    },
    parameters: [],
    prompt,
    priority,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs: [
      sourceRef(
        'docs/rules/鋼材規則.txt',
        locator,
        canonicalKey,
        sha256,
        'quote_rule',
      ),
      ...extraSourceRefs,
    ],
  };
}

function buildAgentRules(repoRoot) {
  const agent = readRulePrompt(repoRoot, 'docs/rules/agent規則.txt');
  const ocr = readRulePrompt(repoRoot, 'docs/rules/OCR規則.txt');
  const output = readRulePrompt(repoRoot, 'docs/rules/輸出規則.txt');
  const handbookSha = readFileSha(repoRoot, 'docs/reference/龍頂鋼鐵手冊__文字版.docx');

  return [
    {
      slug: 'steel-default-agent-instruction',
      version: 1,
      ruleType: 'agent_instruction_rule',
      title: 'Steel 預設 Agent Instruction',
      locale: 'zh-TW',
      ruleSections: ['agent_instruction', 'tool_flow', 'inference_order', 'confirmation_policy'],
      sheetId: null,
      selectors: { appliesTo: ['steel_quote_runtime'], locale: 'zh-TW' },
      prompt: agent.prompt,
      toolPolicy: {
        availableTools: [
          'search_customers',
          'search_price_candidates',
          'run_file_ocr',
        ],
      },
      outputPolicy: { answerLanguage: 'zh-TW' },
      priority: 10,
      confidence: 'high',
      active: true,
      reviewState: 'reviewed',
      sourceRefs: [
        sourceRef(
          'docs/rules/agent規則.txt',
          'Steel 預設 Agent Instruction',
          'agent_default_instruction',
          agent.sha256,
        ),
        sourceRef(
          'docs/reference/龍頂鋼鐵手冊__文字版.docx',
          'Page 14 鋼軌表；Page 21 方鋼表；Page 22 圓鋼表',
          'steel_density_table_handbook',
          handbookSha,
          'reference_handbook',
        ),
      ],
    },
    {
      slug: 'steel-workbook-output-policy',
      version: 1,
      ruleType: 'workbook_output_rule',
      title: 'Steel 輸出表單規則',
      locale: 'zh-TW',
      ruleSections: ['workbook_output', 'output_policy', 'output_sheet', 'customer_tier_sync'],
      sheetId: null,
      selectors: {
        appliesTo: ['steel_quote_runtime', 'output_sheet_context'],
        activeSheets: ['system_order', 'customer_data', 'manual_review', 'customer_quote'],
        synchronizedSheetsOnCustomerTierChange: ['system_order', 'customer_quote'],
      },
      prompt: output.prompt,
      toolPolicy: {
        availableTools: ['search_customers', 'search_price_candidates', 'run_file_ocr'],
      },
      outputPolicy: {
        activeSheets: ['system_order', 'customer_data', 'manual_review', 'customer_quote'],
        missingSheetBehavior: 'carry_forward_previous_active_sheet',
        emittedSheetBehavior: 'replace_previous_active_sheet',
        omittedRowsInEmittedSheet: 'clear_or_delete',
        defaultCustomerTierWhenUncertain: 'B',
        synchronizedSheetsOnCustomerTierChange: ['system_order', 'customer_quote'],
      },
      priority: 20,
      confidence: 'high',
      active: true,
      reviewState: 'reviewed',
      sourceRefs: [
        sourceRef(
          'docs/rules/輸出規則.txt',
          'Steel 輸出規則',
          'steel_output_sheet_policy',
          output.sha256,
        ),
      ],
    },
    {
      slug: 'steel-drawing-ocr-policy',
      version: 1,
      ruleType: 'inference_order_rule',
      title: '圖面表格局部判讀流程',
      locale: 'zh-TW',
      ruleSections: ['file_ocr', 'drawing_ocr', 'vision_evidence'],
      sheetId: null,
      selectors: {
        appliesTo: ['steel_quote_runtime', 'other_global_rules'],
        otherGlobalRulesKey: 'ocrRules',
        includeWhenFileContext: true,
        sourceKinds: ['image', 'pdf', 'scanned_pdf'],
        requiresDrawingOcr: true,
        tableTypes: ['material_table', 'part_table', 'bolt_table', 'cutting_table'],
      },
      prompt: ocr.prompt,
      toolPolicy: {
        availableTools: ['run_file_ocr'],
        requiredToolOrder: ['run_file_ocr'],
        requiredBefore: ['drawing_evidence_extraction'],
        mustMarkLowConfidence: true,
      },
      outputPolicy: {
        outputFormat: 'markdown_tables',
        forbidFormalAdminImport: true,
        forbidConfirmedTotalsFromOcrOnly: true,
      },
      priority: 35,
      confidence: 'high',
      active: true,
      reviewState: 'reviewed',
      sourceRefs: [
        sourceRef(
          'docs/rules/OCR規則.txt',
          '圖面表格局部判讀流程',
          'drawing_ocr_local_table_reading',
          ocr.sha256,
        ),
      ],
    },
  ];
}

function buildQuoteRules(repoRoot) {
  const steel = readRulePrompt(repoRoot, 'docs/rules/鋼材規則.txt');
  const handbookSha = readFileSha(repoRoot, 'docs/reference/龍頂鋼鐵手冊__文字版.docx');
  const cTypePrompt = getPromptSection(steel.prompt, 'C 型鋼專用規則', '----------------------------------------------------------------------');
  const hBeamPrompt = getPromptSection(steel.prompt, 'H 型鋼規則', '----------------------------------------------------------------------');
  const barPrompt = getPromptSection(steel.prompt, '長條料配料規則', '----------------------------------------------------------------------');
  const platePrompt = getPromptSection(steel.prompt, '板材重量與加工規則', undefined);
  const barCatalogFamilies = [
    'rail',
    'angle',
    'channel',
    'flat_bar',
    'rectangular_pipe',
    'round_pipe',
    'square_pipe',
    'round_bar',
    'square_bar',
  ];
  const plateCatalogFamilies = ['plate', 'galvanized_plate', 'ot_plate', 'black_plate'];

  return [
    quoteRule({
      canonicalKey: 'steel_quote_rules_c_type',
      catalogFamily: 'c_type',
      locator: 'C 型鋼專用規則',
      prompt: cTypePrompt,
      sha256: steel.sha256,
      priority: 20,
      selectors: { ruleSection: 'c_type' },
    }),
    quoteRule({
      canonicalKey: 'steel_quote_rules_h_beam',
      catalogFamily: 'h_beam',
      locator: 'H 型鋼規則',
      prompt: hBeamPrompt,
      sha256: steel.sha256,
      priority: 20,
      selectors: { ruleSection: 'h_beam' },
    }),
    ...barCatalogFamilies.map((catalogFamily) =>
      quoteRule({
        canonicalKey: `steel_quote_rules_${catalogFamily}`,
        catalogFamily,
        locator: '長條料配料規則',
        prompt: barPrompt,
        sha256: steel.sha256,
        priority: 25,
        selectors: { ruleSection: 'bar_allocation' },
        extraSourceRefs: [
          sourceRef(
            'docs/reference/龍頂鋼鐵手冊__文字版.docx',
            'Page 14 鋼軌表；Page 21 方鋼表；Page 22 圓鋼表',
            'steel_density_table_handbook',
            handbookSha,
            'reference_handbook',
          ),
        ],
      }),
    ),
    ...plateCatalogFamilies.map((catalogFamily) =>
      quoteRule({
        canonicalKey: `steel_quote_rules_${catalogFamily}`,
        catalogFamily,
        locator: '板材重量與加工規則',
        prompt: platePrompt,
        sha256: steel.sha256,
        priority: 25,
        selectors: { ruleSection: 'plate_weight_processing' },
      }),
    ),
  ];
}

function buildRules(repoRoot) {
  return {
    agentRules: buildAgentRules(repoRoot),
    quoteRules: buildQuoteRules(repoRoot),
  };
}

async function upsertAgentRule(client, rule) {
  await client.query(
    `
INSERT INTO steel.agent_rules (
  slug,
  version,
  rule_type,
  title,
  locale,
  rule_sections,
  sheet_id,
  selectors,
  prompt,
  tool_policy,
  output_policy,
  priority,
  confidence,
  active,
  review_state,
  source_refs
)
VALUES (
  $1,
  $2,
  $3,
  $4,
  $5,
  $6::text[],
  $7,
  $8::jsonb,
  $9,
  $10::jsonb,
  $11::jsonb,
  $12,
  $13,
  $14,
  $15,
  $16::jsonb
)
ON CONFLICT (slug, version)
DO UPDATE
SET
  rule_type = EXCLUDED.rule_type,
  title = EXCLUDED.title,
  locale = EXCLUDED.locale,
  rule_sections = EXCLUDED.rule_sections,
  sheet_id = EXCLUDED.sheet_id,
  selectors = EXCLUDED.selectors,
  prompt = EXCLUDED.prompt,
  tool_policy = EXCLUDED.tool_policy,
  output_policy = EXCLUDED.output_policy,
  priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence,
  active = EXCLUDED.active,
  review_state = EXCLUDED.review_state,
  source_refs = EXCLUDED.source_refs,
  updated_at = NOW()
`,
    [
      rule.slug,
      rule.version,
      rule.ruleType,
      rule.title,
      rule.locale,
      rule.ruleSections,
      rule.sheetId,
      toJson(rule.selectors),
      rule.prompt,
      toJson(rule.toolPolicy),
      toJson(rule.outputPolicy),
      rule.priority,
      rule.confidence,
      rule.active,
      rule.reviewState,
      toJson(rule.sourceRefs),
    ],
  );
}

async function upsertQuoteRule(client, rule) {
  await client.query(
    `
WITH updated AS (
  UPDATE steel.quote_rules
  SET
    rule_type = $2,
    scope_type = $3,
    catalog_family = $4,
    product_family = $5,
    charge_type = $6,
    formula_code = $7,
    selectors = $8::jsonb,
    parameters = $9::jsonb,
    prompt = $10,
    priority = $11,
    confidence = $12,
    active = $13,
    review_state = $14,
    source_refs = $15::jsonb,
    updated_at = NOW()
  WHERE source_refs @> jsonb_build_array(jsonb_build_object('canonicalKey', $1::text))
  RETURNING id
)
INSERT INTO steel.quote_rules (
  rule_type,
  scope_type,
  catalog_family,
  product_family,
  charge_type,
  formula_code,
  selectors,
  parameters,
  prompt,
  priority,
  confidence,
  active,
  review_state,
  source_refs
)
SELECT
  $2,
  $3,
  $4,
  $5,
  $6,
  $7,
  $8::jsonb,
  $9::jsonb,
  $10,
  $11,
  $12,
  $13,
  $14,
  $15::jsonb
WHERE NOT EXISTS (SELECT 1 FROM updated)
`,
    [
      rule.canonicalKey,
      rule.ruleType,
      rule.scopeType,
      rule.catalogFamily,
      rule.productFamily,
      rule.chargeType,
      rule.formulaCode,
      toJson(rule.selectors),
      toJson(rule.parameters),
      rule.prompt,
      rule.priority,
      rule.confidence,
      rule.active,
      rule.reviewState,
      toJson(rule.sourceRefs),
    ],
  );
}

async function deleteRemovedQuoteRules(client, rules) {
  await client.query(
    `
DELETE FROM steel.quote_rules
WHERE source_refs @> '[{"sourceFile":"docs/rules/鋼材規則.txt"}]'::jsonb
  AND NOT (source_refs @> ANY($1::jsonb[]))
`,
    [
      rules.map((rule) =>
        JSON.stringify([{ canonicalKey: rule.canonicalKey, sourceFile: rule.sourceRefs[0].sourceFile }]),
      ),
    ],
  );
}

async function readBackAgentRules(client, rules) {
  const result = await client.query(
    `
SELECT
  slug,
  version,
  rule_type,
  rule_sections,
  active,
  review_state,
  source_refs
FROM steel.agent_rules
WHERE slug = ANY($1::text[])
ORDER BY slug ASC
`,
    [rules.map((rule) => rule.slug)],
  );

  return result.rows;
}

async function readBackQuoteRules(client, rules) {
  const result = await client.query(
    `
SELECT
  id,
  rule_type,
  scope_type,
  active,
  review_state,
  source_refs
FROM steel.quote_rules
WHERE source_refs @> ANY($1::jsonb[])
ORDER BY id ASC
`,
    [
      rules.map((rule) =>
        JSON.stringify([{ canonicalKey: rule.canonicalKey, sourceFile: rule.sourceRefs[0].sourceFile }]),
      ),
    ],
  );

  return result.rows;
}

function summarizeRules(rules, mode) {
  return {
    mode,
    agentRules: rules.agentRules.map((rule) => ({
      slug: rule.slug,
      version: rule.version,
      ruleType: rule.ruleType,
      ruleSections: rule.ruleSections,
      sourceFile: rule.sourceRefs[0].sourceFile,
      sha256: rule.sourceRefs[0].sha256,
      promptLength: rule.prompt.length,
    })),
    quoteRules: rules.quoteRules.map((rule) => ({
      canonicalKey: rule.canonicalKey,
      ruleType: rule.ruleType,
      scopeType: rule.scopeType,
      catalogFamily: rule.catalogFamily,
      sourceFile: rule.sourceRefs[0].sourceFile,
      sha256: rule.sourceRefs[0].sha256,
      promptLength: rule.prompt.length,
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const repoRoot = findRepoRoot(path.resolve(__dirname, '..', '..', '..'));
  loadRootEnv(repoRoot);
  const rules = buildRules(repoRoot);
  const summary = summarizeRules(rules, args.apply ? 'apply' : 'dry-run');

  if (args.dryRun && !args.apply) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const client = createSteelPostgresPool();

  try {
    for (const rule of rules.agentRules) {
      await upsertAgentRule(client, rule);
    }

    await deleteRemovedQuoteRules(client, rules.quoteRules);

    for (const rule of rules.quoteRules) {
      await upsertQuoteRule(client, rule);
    }

    const row = {
      agentRules: await readBackAgentRules(client, rules.agentRules),
      quoteRules: await readBackQuoteRules(client, rules.quoteRules),
    };

    process.stdout.write(`${JSON.stringify({ ...summary, row }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
