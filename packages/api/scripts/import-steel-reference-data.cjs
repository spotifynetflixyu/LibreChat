#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
process.env.TS_NODE_TRANSPILE_ONLY = 'true';

require('ts-node/register/transpile-only');

const { Pool } = require('pg');
const { buildSteelReferenceImportPlan } = require('../src/steel/importer/reference');

const batchSize = 500;

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
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  npm run steel:import-reference-data
  npm run steel:import-reference-data -- --apply

Default mode is a dry-run summary. Use --apply to update Supabase through
STEEL_POSTGRES_URL. Workbook-only references such as 訂單參考.xlsx and 系統訂單.xlsx
are classified but not imported as formal DB facts.
`);
}

function toJson(value) {
  return JSON.stringify(value);
}

function createTupleBuilder(values, fields) {
  const placeholders = fields.map((field) => {
    values.push(field.value);
    return field.cast ? `$${values.length}::${field.cast}` : `$${values.length}`;
  });

  return `(${placeholders.join(', ')})`;
}

async function insertBatches(client, rows, buildFields, sqlPrefix, sqlSuffix = '') {
  for (let start = 0; start < rows.length; start += batchSize) {
    const chunk = rows.slice(start, start + batchSize);
    const values = [];
    const tuples = chunk.map((row) => createTupleBuilder(values, buildFields(row)));
    await client.query(`${sqlPrefix}\n${tuples.join(',\n')}\n${sqlSuffix}`, values);
  }
}

async function loadTierIds(client, tierCodes) {
  const result = await client.query(
    `
SELECT id, code
FROM steel.customer_tiers
WHERE code = ANY($1::text[])
`,
    [tierCodes],
  );

  return new Map(result.rows.map((row) => [row.code, Number(row.id)]));
}

function getTierId(tierIds, code) {
  if (!code) {
    return null;
  }

  return tierIds.get(code) ?? null;
}

async function upsertCustomerTiers(client, plan) {
  await insertBatches(
    client,
    plan.customerTiers,
    (tier) => [
      { value: tier.code },
      { value: tier.name },
      { value: tier.priority },
      { value: toJson(tier.sourceRefs), cast: 'jsonb' },
    ],
    `
INSERT INTO steel.customer_tiers (
  code,
  name,
  priority,
  source_refs
)
VALUES`,
    `
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  priority = EXCLUDED.priority,
  source_refs = EXCLUDED.source_refs,
  updated_at = NOW()
`,
  );
}

async function upsertCustomers(client, plan, tierIds) {
  await insertBatches(
    client,
    plan.customers,
    (customer) => [
      { value: customer.erpCustomerCode },
      { value: customer.displayName },
      { value: customer.legalName },
      { value: customer.taxId },
      { value: getTierId(tierIds, customer.customerTierCode) },
      { value: customer.status },
      { value: customer.notes },
      { value: toJson(customer.metadata), cast: 'jsonb' },
      { value: customer.importLogId },
      { value: toJson(customer.sourceRefs), cast: 'jsonb' },
    ],
    `
INSERT INTO steel.customers (
  erp_customer_code,
  display_name,
  legal_name,
  tax_id,
  customer_tier_id,
  status,
  notes,
  metadata,
  import_log_id,
  source_refs
)
VALUES`,
    `
ON CONFLICT (erp_customer_code) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  legal_name = EXCLUDED.legal_name,
  tax_id = EXCLUDED.tax_id,
  customer_tier_id = EXCLUDED.customer_tier_id,
  status = EXCLUDED.status,
  notes = EXCLUDED.notes,
  metadata = EXCLUDED.metadata,
  import_log_id = EXCLUDED.import_log_id,
  source_refs = EXCLUDED.source_refs,
  updated_at = NOW()
`,
  );
}

async function upsertCatalogFamilies(client, plan) {
  await insertBatches(
    client,
    plan.catalogFamilies,
    (family) => [
      { value: family.key },
      { value: family.displayNameZh },
      { value: toJson(family.aliases), cast: 'jsonb' },
      { value: toJson(family.metadata), cast: 'jsonb' },
      { value: toJson(family.sourceRefs), cast: 'jsonb' },
      { value: family.active },
      { value: family.reviewState },
    ],
    `
INSERT INTO steel.catalog_families (
  key,
  display_name_zh,
  aliases,
  metadata,
  source_refs,
  active,
  review_state
)
VALUES`,
    `
ON CONFLICT (key)
DO UPDATE
SET
  display_name_zh = EXCLUDED.display_name_zh,
  aliases = EXCLUDED.aliases,
  metadata = EXCLUDED.metadata,
  source_refs = EXCLUDED.source_refs,
  active = EXCLUDED.active,
  review_state = EXCLUDED.review_state,
  updated_at = NOW()
`,
  );
}

async function upsertPriceCategories(client, plan) {
  await insertBatches(
    client,
    plan.priceCategories,
    (category) => [
      { value: category.code },
      { value: category.name },
      { value: category.catalogFamily },
      { value: category.defaultUnit },
      { value: toJson(category.metadata), cast: 'jsonb' },
      { value: toJson(category.sourceRefs), cast: 'jsonb' },
    ],
    `
INSERT INTO steel.price_categories (
  code,
  name,
  catalog_family,
  default_unit,
  metadata,
  source_refs
)
VALUES`,
    `
ON CONFLICT (code)
DO UPDATE
SET
  name = EXCLUDED.name,
  catalog_family = EXCLUDED.catalog_family,
  default_unit = EXCLUDED.default_unit,
  metadata = EXCLUDED.metadata,
  source_refs = EXCLUDED.source_refs,
  updated_at = NOW()
`,
  );
}

async function loadCategoryIds(client, categoryCodes) {
  const result = await client.query(
    `
SELECT id, code
FROM steel.price_categories
WHERE code = ANY($1::text[])
`,
    [categoryCodes],
  );

  return new Map(result.rows.map((row) => [row.code, Number(row.id)]));
}

function getCategoryId(categoryIds, code) {
  return categoryIds.get(code) ?? null;
}

async function replacePriceItems(client, plan, tierIds, categoryIds) {
  await client.query(
    `
DELETE FROM steel.price_items
WHERE last_import_log_id = $1
  OR source_refs @> $2::jsonb
`,
    ['docs-reference-product-prices-v1', '[{"sourceFile":"docs/reference/產品價格.xlsx"}]'],
  );

  await insertBatches(
    client,
    plan.priceItems,
    (item) => [
      { value: item.erpItemCode },
      { value: getCategoryId(categoryIds, item.categoryCode) },
      { value: getTierId(tierIds, item.customerTierCode) },
      { value: item.specKey },
      { value: item.productName },
      { value: item.catalogFamily },
      { value: item.materialGrade },
      { value: item.unit },
      { value: item.unitPrice },
      { value: item.productPriceUnitWeight },
      { value: item.productPriceUnitWeightUnit },
      { value: item.currency },
      { value: item.active },
      { value: item.valueState },
      { value: item.reviewState },
      { value: toJson(item.metadata), cast: 'jsonb' },
      { value: item.importLogId },
      { value: toJson(item.sourceRefs), cast: 'jsonb' },
    ],
    `
INSERT INTO steel.price_items (
  erp_item_code,
  category_id,
  customer_tier_id,
  spec_key,
  product_name,
  catalog_family,
  material_grade,
  unit,
  unit_price,
  product_price_unit_weight,
  product_price_unit_weight_unit,
  currency,
  active,
  value_state,
  review_state,
  metadata,
  last_import_log_id,
  source_refs
)
VALUES`,
    `
ON CONFLICT (erp_item_code, (COALESCE(customer_tier_id, 0)))
WHERE erp_item_code IS NOT NULL
DO UPDATE
SET
  spec_key = EXCLUDED.spec_key,
  product_name = EXCLUDED.product_name,
  category_id = EXCLUDED.category_id,
  catalog_family = EXCLUDED.catalog_family,
  material_grade = EXCLUDED.material_grade,
  unit = EXCLUDED.unit,
  unit_price = EXCLUDED.unit_price,
  product_price_unit_weight = EXCLUDED.product_price_unit_weight,
  product_price_unit_weight_unit = EXCLUDED.product_price_unit_weight_unit,
  currency = EXCLUDED.currency,
  active = EXCLUDED.active,
  value_state = EXCLUDED.value_state,
  review_state = EXCLUDED.review_state,
  metadata = EXCLUDED.metadata,
  last_import_log_id = EXCLUDED.last_import_log_id,
  source_refs = EXCLUDED.source_refs,
  updated_at = NOW()
`,
  );
}

async function replaceCuttingPrices(client, plan) {
  await client.query(
    `
DELETE FROM steel.cutting_prices
WHERE import_log_id = $1
  OR source_refs @> $2::jsonb
`,
    ['docs-reference-cutting-prices-v1', '[{"sourceFile":"docs/reference/切工價錢.xlsx"}]'],
  );

  await insertBatches(
    client,
    plan.cuttingPrices,
    (price) => [
      { value: price.productFamily },
      { value: price.cutType },
      { value: price.specKey },
      { value: price.lengthM },
      { value: price.unit },
      { value: price.unitPrice },
      { value: price.surchargePerKg },
      { value: price.currency },
      { value: price.active },
      { value: price.valueState },
      { value: price.reviewState },
      { value: toJson(price.metadata), cast: 'jsonb' },
      { value: price.importLogId },
      { value: toJson(price.sourceRefs), cast: 'jsonb' },
    ],
    `
INSERT INTO steel.cutting_prices (
  product_family,
  cut_type,
  spec_key,
  length_m,
  unit,
  unit_price,
  surcharge_per_kg,
  currency,
  active,
  value_state,
  review_state,
  metadata,
  import_log_id,
  source_refs
)
VALUES`,
  );
}

async function upsertFormulas(client, plan) {
  await insertBatches(
    client,
    plan.formulaVersions,
    (formula) => [
      { value: formula.code },
      { value: formula.versionSeq },
      { value: formula.displayName },
      { value: formula.sourceExpression },
      { value: toJson(formula.formulaBody), cast: 'jsonb' },
      { value: formula.compiledFormula, cast: 'jsonb' },
      { value: toJson(formula.allowedVariables), cast: 'jsonb' },
      { value: formula.active },
      { value: formula.reviewState },
      { value: toJson(formula.sourceRefs), cast: 'jsonb' },
      { value: 'steel-reference-importer' },
    ],
    `
INSERT INTO steel.formula_versions (
  code,
  version_seq,
  display_name,
  source_expression,
  formula_body,
  compiled_formula,
  allowed_variables,
  active,
  review_state,
  source_refs,
  created_by
)
VALUES`,
    `
ON CONFLICT (code, version_seq) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  source_expression = EXCLUDED.source_expression,
  formula_body = EXCLUDED.formula_body,
  compiled_formula = EXCLUDED.compiled_formula,
  allowed_variables = EXCLUDED.allowed_variables,
  active = EXCLUDED.active,
  review_state = EXCLUDED.review_state,
  source_refs = EXCLUDED.source_refs,
  updated_at = NOW()
`,
  );
}

async function replaceQuoteDefaults(client, plan, tierIds) {
  await client.query(
    `
DELETE FROM steel.quote_defaults
WHERE origin_table = ANY($1::text[])
`,
    [['docs/reference/H型鋼.txt', 'docs/reference/切工價錢.xlsx']],
  );

  await insertBatches(
    client,
    plan.quoteDefaults,
    (defaultRow) => [
      { value: defaultRow.defaultType },
      { value: defaultRow.originTable },
      { value: defaultRow.originId },
      { value: defaultRow.originRevision },
      { value: defaultRow.scopeType },
      { value: null },
      { value: getTierId(tierIds, defaultRow.customerTierCode) },
      { value: defaultRow.catalogFamily },
      { value: defaultRow.productFamily },
      { value: defaultRow.chargeType },
      { value: defaultRow.formulaCode },
      { value: toJson(defaultRow.selector), cast: 'jsonb' },
      { value: defaultRow.effect },
      { value: toJson(defaultRow.defaultParameters), cast: 'jsonb' },
      { value: defaultRow.priority },
      { value: defaultRow.confidence },
      { value: toJson(defaultRow.sourceRefs), cast: 'jsonb' },
      { value: defaultRow.active },
      { value: defaultRow.reviewState },
    ],
    `
INSERT INTO steel.quote_defaults (
  default_type,
  origin_table,
  origin_id,
  origin_revision,
  scope_type,
  customer_id,
  customer_tier_id,
  catalog_family,
  product_family,
  charge_type,
  formula_code,
  selector,
  effect,
  default_parameters,
  priority,
  confidence,
  source_refs,
  active,
  review_state
)
VALUES`,
  );
}

async function getVerificationCounts(client) {
  const result = await client.query(`
SELECT
  (SELECT COUNT(*)::int FROM steel.catalog_families WHERE metadata->>'importLogId' = 'docs-reference-catalog-families-v1') AS catalog_families,
  (SELECT COUNT(*)::int FROM steel.price_categories WHERE metadata->>'importLogId' = 'docs-reference-price-categories-v1') AS price_categories,
  (SELECT COUNT(*)::int FROM steel.customers WHERE import_log_id = 'docs-reference-customers-v1') AS customers,
  (SELECT COUNT(*)::int FROM steel.price_items WHERE last_import_log_id = 'docs-reference-product-prices-v1') AS price_items,
  (SELECT COUNT(*)::int FROM steel.cutting_prices WHERE import_log_id = 'docs-reference-cutting-prices-v1') AS cutting_prices,
  (
    SELECT COUNT(*)::int
    FROM steel.formula_versions
    WHERE source_refs @> '[{"sourceFile":"docs/reference/公式編號.xlsx"}]'::jsonb
  ) AS formula_versions,
  (
    SELECT COUNT(*)::int
    FROM steel.quote_defaults
    WHERE origin_table = ANY(ARRAY['docs/reference/H型鋼.txt', 'docs/reference/切工價錢.xlsx'])
  ) AS quote_defaults
`);

  return result.rows[0];
}

async function applyPlan(plan) {
  const connectionString = process.env.STEEL_POSTGRES_URL?.trim();
  if (!connectionString) {
    throw new Error('STEEL_POSTGRES_URL is required for --apply');
  }

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    max: 3,
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path = steel, public');
    await upsertCustomerTiers(client, plan);
    const tierIds = await loadTierIds(
      client,
      plan.customerTiers.map((tier) => tier.code),
    );
    await upsertCustomers(client, plan, tierIds);
    await upsertCatalogFamilies(client, plan);
    await upsertPriceCategories(client, plan);
    const categoryIds = await loadCategoryIds(
      client,
      plan.priceCategories.map((category) => category.code),
    );
    await replacePriceItems(client, plan, tierIds, categoryIds);
    await replaceCuttingPrices(client, plan);
    await upsertFormulas(client, plan);
    await replaceQuoteDefaults(client, plan, tierIds);
    const verification = await getVerificationCounts(client);
    await client.query('COMMIT');
    return verification;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const repoRoot = findRepoRoot(process.cwd());
  loadRootEnv(repoRoot);

  const referenceDir = path.join(repoRoot, 'docs/reference');
  const plan = buildSteelReferenceImportPlan({ referenceDir });
  const dryRun = !args.apply;

  const output = {
    mode: dryRun ? 'dry-run' : 'apply',
    referenceDir,
    factSources: plan.factSources,
    workbookOnlySources: plan.workbookOnlySources,
    summary: plan.summary,
    verification: dryRun ? null : await applyPlan(plan),
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
