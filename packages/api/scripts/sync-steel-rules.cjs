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

Default mode is --dry-run. --apply syncs agent, output, other, and category
rules under docs/rules into steel.rules using STEEL_POSTGRES_URL, then reads
rows back.
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

function readFileSha(repoRoot, sourceFile) {
  return sha256(fs.readFileSync(path.join(repoRoot, sourceFile)));
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

function sourceRef(sourceFile, locator, canonicalKey, fileSha, factType = 'rule') {
  return {
    channel: 'repo_docs',
    factType,
    sourceFile,
    locator,
    canonicalKey,
    sha256: fileSha,
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
  sourceRefs,
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
    sourceRefs,
  };
}

const categoryRuleMetadataByFile = {
  'docs/rules/類別規則/查價方式.txt': {
    slug: 'steel_category_price_lookup_guide',
    title: 'Steel 類別查價方式',
    locator: '類別查價方式',
    ruleSection: 'price_lookup',
    priority: 15,
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
  'docs/rules/類別規則/長管-切工.txt': {
    slug: 'steel_quote_rules_long_material_cutting',
    title: 'Steel 長條料切工類別規則',
    locator: '長條料切工類別規則',
    ruleSection: 'bar_cutting',
    priority: 24,
  },
};

function readCategoryRuleMetadata(sourceFile) {
  const metadata = categoryRuleMetadataByFile[sourceFile];
  if (!metadata) {
    throw new Error(`Missing category rule metadata for ${sourceFile}`);
  }

  return metadata;
}

function categoryRule({ sourceFile, prompt, fileSha, handbookSha }) {
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
    priority: metadata.priority,
    sourceRefs: [
      sourceRef(sourceFile, metadata.locator, metadata.slug, fileSha, 'steel_rule'),
      ...(metadata.ruleSection === 'bar_allocation'
        ? [
            sourceRef(
              'docs/reference/龍頂鋼鐵手冊__文字版.docx',
              'Page 14 鋼軌表；Page 21 方鋼表；Page 22 圓鋼表',
              'steel_density_table_handbook',
              handbookSha,
              'reference_handbook',
            ),
          ]
        : []),
    ],
  });
}

function buildRules(repoRoot) {
  const agent = readRulePrompt(repoRoot, 'docs/rules/agent規則.txt');
  const output = readRulePrompt(repoRoot, 'docs/rules/輸出規則.txt');
  const ocr = readRulePrompt(repoRoot, 'docs/rules/其他規則/OCR規則.txt');
  const handbookSha = readFileSha(repoRoot, 'docs/reference/龍頂鋼鐵手冊__文字版.docx');
  const categoryRules = listTextFiles(repoRoot, 'docs/rules/類別規則').map((sourceFile) => {
    const rule = readRulePrompt(repoRoot, sourceFile);
    return categoryRule({
      sourceFile,
      prompt: rule.prompt,
      fileSha: rule.sha256,
      handbookSha,
    });
  });

  return [
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
        availableTools: [
          'search_customers',
          'search_price_candidates',
          'read_markdown',
        ],
      },
      outputPolicy: { answerLanguage: 'zh-TW' },
      priority: 10,
      sourceRefs: [
        sourceRef(
          'docs/rules/agent規則.txt',
          'Steel 預設 Agent Instruction',
          'agent_default_instruction',
          agent.sha256,
          'agent_rule',
        ),
        sourceRef(
          'docs/reference/龍頂鋼鐵手冊__文字版.docx',
          'Page 14 鋼軌表；Page 21 方鋼表；Page 22 圓鋼表',
          'steel_density_table_handbook',
          handbookSha,
          'reference_handbook',
        ),
      ],
    }),
    unifiedRule({
      slug: 'steel-workbook-output-policy',
      ruleKind: 'output',
      title: 'Steel 輸出表單規則',
      ruleSections: ['workbook_output', 'output_policy', 'output_sheet', 'customer_tier_sync'],
      selectors: {
        appliesTo: ['steel_quote_runtime', 'output_sheet_context'],
        activeSheets: ['system_order', 'customer_data', 'manual_review', 'customer_quote'],
        synchronizedSheetsOnCustomerTierChange: ['system_order', 'customer_quote'],
        confidence: 'high',
      },
      prompt: output.prompt,
      toolPolicy: {
        availableTools: [
          'search_customers',
          'search_price_candidates',
          'read_markdown',
        ],
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
      sourceRefs: [
        sourceRef(
          'docs/rules/輸出規則.txt',
          'Steel 輸出規則',
          'steel_output_sheet_policy',
          output.sha256,
          'output_rule',
        ),
      ],
    }),
    unifiedRule({
      slug: 'steel-drawing-ocr-policy',
      ruleKind: 'other',
      title: '圖面表格局部判讀流程',
      ruleSections: ['file_ocr', 'drawing_ocr', 'vision_evidence'],
      selectors: {
        appliesTo: ['steel_quote_runtime', 'other_global_rules'],
        otherGlobalRulesKey: 'ocrRules',
        includeWhenFileContext: true,
        sourceKinds: ['image', 'pdf', 'scanned_pdf'],
        requiresDrawingOcr: true,
        tableTypes: ['material_table', 'part_table', 'bolt_table', 'cutting_table'],
        confidence: 'high',
      },
      prompt: ocr.prompt,
      toolPolicy: {
        ocrEngine: 'PaddleOCR MCP OCR',
        requiredMcpTool: 'paddleocr_vl',
        requiredBefore: ['drawing_evidence_extraction'],
        mustMarkLowConfidence: true,
      },
      outputPolicy: {
        outputFormat: 'markdown_tables',
        forbidFormalAdminImport: true,
        forbidConfirmedTotalsFromOcrOnly: true,
      },
      priority: 35,
      sourceRefs: [
        sourceRef(
          'docs/rules/其他規則/OCR規則.txt',
          '圖面表格局部判讀流程',
          'drawing_ocr_local_table_reading',
          ocr.sha256,
          'other_rule',
        ),
      ],
    }),
    ...categoryRules,
  ];
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
  source_refs
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
  $14::jsonb
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
  source_refs = EXCLUDED.source_refs,
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
      toJson(rule.sourceRefs),
    ],
  );
}

async function deleteRemovedRules(client, rules) {
  const legacyCategoryRuleSourceFiles = [
    'docs/rules/鋼材規則.txt',
    'docs/rules/鋼材規則/C型鋼.txt',
    'docs/rules/鋼材規則/H型鋼.txt',
    'docs/rules/鋼材規則/鐵板.txt',
    'docs/rules/鋼材規則/孔.txt',
    'docs/rules/鋼材規則/長管-切工.txt',
  ];
  const sourceFiles = [
    'docs/rules/agent規則.txt',
    'docs/rules/輸出規則.txt',
    'docs/rules/OCR規則.txt',
    'docs/rules/其他規則/OCR規則.txt',
    ...legacyCategoryRuleSourceFiles,
    ...rules.flatMap((rule) => rule.sourceRefs.map((ref) => ref.sourceFile)),
  ];
  const sourceFileRefs = [...new Set(sourceFiles)].map((sourceFile) =>
    JSON.stringify([{ sourceFile }]),
  );

  await client.query(
    `
DELETE FROM steel.rules
WHERE source_refs @> ANY($1::jsonb[])
  AND NOT (slug = ANY($2::text[]))
`,
    [sourceFileRefs, rules.map((rule) => rule.slug)],
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
  source_refs
FROM steel.rules
WHERE slug = ANY($1::text[])
ORDER BY rule_kind ASC, priority ASC, slug ASC
`,
    [rules.map((rule) => rule.slug)],
  );

  return result.rows;
}

function summarizeRules(rules, mode) {
  return {
    mode,
    rules: rules.map((rule) => ({
      slug: rule.slug,
      version: rule.version,
      ruleKind: rule.ruleKind,
      ruleSections: rule.ruleSections,
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
    await deleteRemovedRules(client, rules);
    for (const rule of rules) {
      await upsertRule(client, rule);
    }

    const row = await readBackRules(client, rules);
    process.stdout.write(`${JSON.stringify({ ...summary, row }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
