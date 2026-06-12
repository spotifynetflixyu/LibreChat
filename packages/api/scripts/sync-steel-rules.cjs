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
      appliesTo: ['lookup_quote_rules'],
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
    ],
  };
}

function buildAgentRules(repoRoot) {
  const agent = readRulePrompt(repoRoot, 'docs/rules/agent規則.txt');
  const workbook = readRulePrompt(repoRoot, 'docs/rules/workbook規則.txt');
  const ocr = readRulePrompt(repoRoot, 'docs/rules/OCR規則.txt');
  const vision = readRulePrompt(repoRoot, 'docs/rules/vision規則.txt');

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
          'lookup_catalog_families',
          'search_customers',
          'lookup_quote_rules',
          'search_price_candidates',
          'run_file_ocr',
          'run_visual_inspection',
          'patch_quote_workbook',
          'patch_file_analysis_data',
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
      ],
    },
    {
      slug: 'steel-workbook-output-policy',
      version: 1,
      ruleType: 'workbook_output_rule',
      title: 'Steel Workbook Output Policy',
      locale: 'zh-TW',
      ruleSections: ['workbook_output', 'workbook_patch', 'system_order'],
      sheetId: null,
      selectors: { appliesTo: ['steel_quote_workbook'], locale: 'zh-TW' },
      prompt: workbook.prompt,
      toolPolicy: {
        availableTools: ['patch_quote_workbook'],
        requiredTool: 'patch_quote_workbook',
      },
      outputPolicy: {
        answerLanguage: 'zh-TW',
        requireProductRowEvidenceSource: true,
        allowedOrderEvidenceSources: ['file_analysis_data', 'user conversation'],
        fileAnalysisEvidenceTargets: [
          'quote_details.decision_evidence',
          'price_sources.note',
          'interpretation_notes.evidence',
        ],
        forbidCustomerQuoteInternalSourceRefs: true,
      },
      priority: 20,
      confidence: 'high',
      active: true,
      reviewState: 'reviewed',
      sourceRefs: [
        sourceRef(
          'docs/rules/workbook規則.txt',
          '產品 row 來源標註規則',
          'workbook_output_policy',
          workbook.sha256,
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
        sourceKinds: ['image', 'pdf', 'scanned_pdf'],
        requiresDrawingOcr: true,
        tableTypes: ['material_table', 'part_table', 'bolt_table', 'cutting_table'],
      },
      prompt: ocr.prompt,
      toolPolicy: {
        availableTools: ['run_file_ocr', 'run_visual_inspection', 'patch_file_analysis_data'],
        requiredToolOrder: ['run_file_ocr', 'patch_file_analysis_data'],
        requiredBefore: ['drawing_evidence_extraction'],
        mustMarkLowConfidence: true,
      },
      outputPolicy: {
        targetSheets: ['manual_review', 'interpretation_notes'],
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
    {
      slug: 'steel-visual-inspection-policy',
      version: 1,
      ruleType: 'tool_flow_rule',
      title: '圖像幾何判斷流程',
      locale: 'zh-TW',
      ruleSections: ['visual_inspection', 'drawing_vision', 'tool_flow'],
      sheetId: null,
      selectors: {
        sourceKinds: ['image', 'pdf', 'scanned_pdf'],
        requiresVisualInspection: true,
        inspectionTypes: [
          'holes',
          'slots',
          'continuous_edges',
          'bends',
          'cut_corners',
          'notches',
          'geometry_consistency',
        ],
      },
      prompt: vision.prompt,
      toolPolicy: {
        availableTools: ['run_visual_inspection', 'patch_file_analysis_data'],
        requiredToolOrder: ['run_file_ocr', 'patch_file_analysis_data', 'run_visual_inspection', 'patch_file_analysis_data'],
        forbidOcrInVisualInspection: true,
      },
      outputPolicy: {
        targetSheets: ['file_analysis_data', 'manual_review', 'interpretation_notes'],
        requirePatchAfterInspection: true,
        inspectionEngine: 'OpenAI OAuth vision',
      },
      priority: 36,
      confidence: 'high',
      active: true,
      reviewState: 'reviewed',
      sourceRefs: [
        sourceRef(
          'docs/rules/vision規則.txt',
          '圖像幾何判斷流程',
          'visual_inspection_policy',
          vision.sha256,
        ),
      ],
    },
  ];
}

function buildQuoteRules(repoRoot) {
  const steel = readRulePrompt(repoRoot, 'docs/rules/鋼材規則.txt');
  const cTypePrompt = getPromptSection(steel.prompt, 'C 型鋼專用規則', '----------------------------------------------------------------------');
  const hBeamPrompt = getPromptSection(steel.prompt, 'H 型鋼規則', '----------------------------------------------------------------------');
  const barPrompt = getPromptSection(steel.prompt, '長條料配料規則', '----------------------------------------------------------------------');
  const platePrompt = getPromptSection(steel.prompt, '板材重量與加工規則', undefined);
  const barCatalogFamilies = [
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
