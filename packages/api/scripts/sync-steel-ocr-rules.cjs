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
  npm --workspace packages/api run steel:sync-ocr-rules -- --dry-run
  npm --workspace packages/api run steel:sync-ocr-rules -- --apply

Default mode is --dry-run. --apply upserts docs/rules/OCR規則.txt into
steel.agent_rules using STEEL_POSTGRES_URL, then reads the row back.
`);
}

function toJson(value) {
  return JSON.stringify(value);
}

function buildOcrRule(repoRoot) {
  const sourceFile = 'docs/rules/OCR規則.txt';
  const sourcePath = path.join(repoRoot, sourceFile);
  const prompt = fs.readFileSync(sourcePath, 'utf8').trim();
  const sha256 = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');

  if (!prompt) {
    throw new Error(`${sourceFile} is empty`);
  }

  return {
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
    prompt,
    toolPolicy: {
      availableTools: ['run_file_ocr', 'patch_file_analysis_data'],
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
      {
        channel: 'repo_docs',
        factType: 'agent_rule',
        sourceFile,
        locator: '圖面表格局部判讀流程',
        canonicalKey: 'drawing_ocr_local_table_reading',
        sha256,
      },
    ],
  };
}

async function upsertOcrRule(client, rule) {
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

async function readBackOcrRule(client, rule) {
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
WHERE slug = $1
  AND version = $2
`,
    [rule.slug, rule.version],
  );

  return result.rows[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const repoRoot = findRepoRoot(path.resolve(__dirname, '..', '..', '..'));
  loadRootEnv(repoRoot);
  const rule = buildOcrRule(repoRoot);
  const summary = {
    slug: rule.slug,
    version: rule.version,
    ruleType: rule.ruleType,
    ruleSections: rule.ruleSections,
    sourceFile: rule.sourceRefs[0].sourceFile,
    sha256: rule.sourceRefs[0].sha256,
    promptLength: rule.prompt.length,
    mode: args.apply ? 'apply' : 'dry-run',
  };

  if (args.dryRun && !args.apply) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const client = createSteelPostgresPool();

  try {
    await upsertOcrRule(client, rule);
    const row = await readBackOcrRule(client, rule);
    process.stdout.write(`${JSON.stringify({ ...summary, row }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
