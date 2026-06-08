import {
  getLimit,
  parseJsonObject,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
} from './types';

import type {
  SteelJsonValue,
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
} from './types';

interface SteelAgentRuleRow {
  id: string | number;
  slug: string;
  version: string | number;
  rule_type: string;
  title: string;
  locale: string;
  rule_sections: string[];
  sheet_id: string | null;
  selectors: SteelJsonValue | null;
  prompt: string;
  tool_policy: SteelJsonValue | null;
  output_policy: SteelJsonValue | null;
  priority: string | number;
  confidence: string;
  active: boolean;
  review_state: string;
  source_refs: unknown;
}

interface SteelCatalogFamilyRuleRow {
  id: string | number;
  rule_type: string;
  catalog_family: string | null;
  product_name: string | null;
  product_names: SteelJsonValue | null;
  aliases: SteelJsonValue | null;
  selectors: SteelJsonValue | null;
  prompt: string;
  priority: string | number;
  confidence: string;
  active: boolean;
  review_state: string;
  source_refs: unknown;
}

interface SteelQuoteRuleRow {
  id: string | number;
  rule_type: string;
  scope_type: string;
  catalog_family: string | null;
  product_family: string | null;
  charge_type: string | null;
  formula_code: string | null;
  selectors: SteelJsonValue | null;
  parameters: SteelJsonValue | null;
  prompt: string;
  priority: string | number;
  confidence: string;
  active: boolean;
  review_state: string;
  source_refs: unknown;
}

interface SteelCustomerRuleRow {
  id: string | number;
  rule_type: string;
  customer_id: string | number | null;
  customer_tier_id: string | number | null;
  catalog_family: string | null;
  product_family: string | null;
  charge_type: string | null;
  formula_code: string | null;
  selectors: SteelJsonValue | null;
  parameters: SteelJsonValue | null;
  prompt: string;
  priority: string | number;
  confidence: string;
  active: boolean;
  review_state: string;
  source_refs: unknown;
}

export interface SteelAgentRule extends SteelSourceBackedRecord {
  id: number;
  slug: string;
  version: number;
  ruleType: string;
  title: string;
  locale: string;
  ruleSections: string[];
  sheetId?: string;
  selectors: SteelJsonValue;
  prompt: string;
  toolPolicy: SteelJsonValue;
  outputPolicy: SteelJsonValue;
  priority: number;
  confidence: string;
  active: boolean;
  reviewState: SteelReviewState;
  sourceRefs: SteelSourceRef[];
}

export interface SteelCatalogFamilyRule extends SteelSourceBackedRecord {
  id: number;
  ruleType: string;
  catalogFamily?: string;
  productName?: string;
  productNames: string[];
  aliases: string[];
  selectors: SteelJsonValue;
  prompt: string;
  priority: number;
  confidence: string;
  active: boolean;
  reviewState: SteelReviewState;
  sourceRefs: SteelSourceRef[];
}

export interface SteelQuoteRule extends SteelSourceBackedRecord {
  id: number;
  ruleType: string;
  scopeType: string;
  catalogFamily?: string;
  productFamily?: string;
  chargeType?: string;
  formulaCode?: string;
  selectors: SteelJsonValue;
  parameters: SteelJsonValue;
  prompt: string;
  priority: number;
  confidence: string;
  active: boolean;
  reviewState: SteelReviewState;
  sourceRefs: SteelSourceRef[];
}

export interface SteelCustomerRule extends SteelSourceBackedRecord {
  id: number;
  ruleType: string;
  customerId: number | null;
  customerTierId: number | null;
  catalogFamily?: string;
  productFamily?: string;
  chargeType?: string;
  formulaCode?: string;
  selectors: SteelJsonValue;
  parameters: SteelJsonValue;
  prompt: string;
  priority: number;
  confidence: string;
  active: boolean;
  reviewState: SteelReviewState;
  sourceRefs: SteelSourceRef[];
}

export interface SearchSteelAgentRulesInput {
  ruleTypes?: readonly string[];
  ruleSections?: readonly string[];
  sheetIds?: readonly string[];
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

export interface SearchSteelCatalogFamilyRulesInput {
  searchText?: string;
  catalogFamilies?: readonly string[];
  productNames?: readonly string[];
  ruleTypes?: readonly string[];
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

export interface SearchSteelQuoteRulesInput {
  catalogFamilies?: readonly string[];
  productFamilies?: readonly string[];
  chargeTypes?: readonly string[];
  formulaCodes?: readonly string[];
  ruleTypes?: readonly string[];
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

export interface SearchSteelCustomerRulesInput {
  customerIds?: readonly number[];
  customerTierIds?: readonly number[];
  catalogFamilies?: readonly string[];
  productFamilies?: readonly string[];
  chargeTypes?: readonly string[];
  formulaCodes?: readonly string[];
  ruleTypes?: readonly string[];
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function uniquePositive(values: readonly number[] | undefined): number[] {
  return [...new Set((values ?? []).filter((value) => Number.isInteger(value) && value > 0))];
}

function readStringArray(value: SteelJsonValue | string[] | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: string[] = [];

  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim() !== '') {
      output.push(entry);
    }
  }

  return output;
}

function addTextArrayFilter(
  where: string[],
  values: SteelSqlParameter[],
  column: string,
  matches: readonly string[] | undefined,
) {
  const uniqueMatches = uniqueNonEmpty(matches);

  if (uniqueMatches.length === 0) {
    return;
  }

  values.push(uniqueMatches);
  where.push(`${column} = ANY($${values.length}::text[])`);
}

function addNullableTextArrayFilter(
  where: string[],
  values: SteelSqlParameter[],
  column: string,
  matches: readonly string[] | undefined,
) {
  const uniqueMatches = uniqueNonEmpty(matches);

  if (uniqueMatches.length === 0) {
    return;
  }

  values.push(uniqueMatches);
  where.push(`(${column} IS NULL OR ${column} = ANY($${values.length}::text[]))`);
}

function addRuleTypesFilter(
  where: string[],
  values: SteelSqlParameter[],
  ruleTypes: readonly string[] | undefined,
) {
  addTextArrayFilter(where, values, 'rule_type', ruleTypes);
}

function addLimit(values: SteelSqlParameter[], limit: number | undefined): string {
  values.push(getLimit(limit));
  return `$${values.length}`;
}

function toAgentRule(row: SteelAgentRuleRow): SteelAgentRule {
  return {
    id: parseRequiredNumber(row.id),
    slug: row.slug,
    version: parseRequiredNumber(row.version),
    ruleType: row.rule_type,
    title: row.title,
    locale: row.locale,
    ruleSections: readStringArray(row.rule_sections),
    sheetId: parseNullableString(row.sheet_id),
    selectors: parseJsonObject(row.selectors),
    prompt: row.prompt,
    toolPolicy: parseJsonObject(row.tool_policy),
    outputPolicy: parseJsonObject(row.output_policy),
    priority: parseRequiredNumber(row.priority),
    confidence: row.confidence,
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

function toCatalogFamilyRule(row: SteelCatalogFamilyRuleRow): SteelCatalogFamilyRule {
  return {
    id: parseRequiredNumber(row.id),
    ruleType: row.rule_type,
    catalogFamily: parseNullableString(row.catalog_family),
    productName: parseNullableString(row.product_name),
    productNames: readStringArray(row.product_names),
    aliases: readStringArray(row.aliases),
    selectors: parseJsonObject(row.selectors),
    prompt: row.prompt,
    priority: parseRequiredNumber(row.priority),
    confidence: row.confidence,
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

function toQuoteRule(row: SteelQuoteRuleRow): SteelQuoteRule {
  return {
    id: parseRequiredNumber(row.id),
    ruleType: row.rule_type,
    scopeType: row.scope_type,
    catalogFamily: parseNullableString(row.catalog_family),
    productFamily: parseNullableString(row.product_family),
    chargeType: parseNullableString(row.charge_type),
    formulaCode: parseNullableString(row.formula_code),
    selectors: parseJsonObject(row.selectors),
    parameters: parseJsonObject(row.parameters),
    prompt: row.prompt,
    priority: parseRequiredNumber(row.priority),
    confidence: row.confidence,
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

function toCustomerRule(row: SteelCustomerRuleRow): SteelCustomerRule {
  return {
    id: parseRequiredNumber(row.id),
    ruleType: row.rule_type,
    customerId: parseNullableNumber(row.customer_id),
    customerTierId: parseNullableNumber(row.customer_tier_id),
    catalogFamily: parseNullableString(row.catalog_family),
    productFamily: parseNullableString(row.product_family),
    chargeType: parseNullableString(row.charge_type),
    formulaCode: parseNullableString(row.formula_code),
    selectors: parseJsonObject(row.selectors),
    parameters: parseJsonObject(row.parameters),
    prompt: row.prompt,
    priority: parseRequiredNumber(row.priority),
    confidence: row.confidence,
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function searchSteelAgentRules(
  client: SteelRepositoryClient,
  input: SearchSteelAgentRulesInput,
): Promise<SteelAgentRule[]> {
  const where = ['review_state = $1'];
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];

  if (!input.includeInactive) {
    where.push('active = true');
  }

  addRuleTypesFilter(where, values, input.ruleTypes);

  const ruleSections = uniqueNonEmpty(input.ruleSections);
  if (ruleSections.length > 0) {
    values.push(ruleSections);
    where.push(`rule_sections && $${values.length}::text[]`);
  }

  const sheetIds = uniqueNonEmpty(input.sheetIds);
  if (sheetIds.length > 0) {
    values.push(sheetIds);
    where.push(`(sheet_id IS NULL OR sheet_id = ANY($${values.length}::text[]))`);
  }

  const result = await client.query<SteelAgentRuleRow>(
    `
SELECT
  id,
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
FROM steel.agent_rules
WHERE ${where.join('\n  AND ')}
ORDER BY priority ASC, id ASC
LIMIT ${addLimit(values, input.limit)}
`,
    values,
  );

  return result.rows.map(toAgentRule);
}

export async function searchSteelCatalogFamilyRules(
  client: SteelRepositoryClient,
  input: SearchSteelCatalogFamilyRulesInput,
): Promise<SteelCatalogFamilyRule[]> {
  const where = ['review_state = $1'];
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];
  const associationFilters: string[] = [];

  if (!input.includeInactive) {
    where.push('active = true');
  }

  addRuleTypesFilter(where, values, input.ruleTypes);

  const catalogFamilies = uniqueNonEmpty(input.catalogFamilies);
  if (catalogFamilies.length > 0) {
    values.push(catalogFamilies);
    associationFilters.push(`catalog_family = ANY($${values.length}::text[])`);
  }

  const productNames = uniqueNonEmpty(input.productNames);
  if (productNames.length > 0) {
    values.push(productNames);
    associationFilters.push(`(
      product_name = ANY($${values.length}::text[])
      OR product_names ?| $${values.length}::text[]
      OR aliases ?| $${values.length}::text[]
    )`);
  }

  const searchText = input.searchText?.trim();
  if (searchText) {
    values.push(`%${searchText}%`);
    associationFilters.push(`(
      product_name ILIKE $${values.length}
      OR product_names::text ILIKE $${values.length}
      OR aliases::text ILIKE $${values.length}
      OR selectors::text ILIKE $${values.length}
      OR prompt ILIKE $${values.length}
    )`);
  }

  if (associationFilters.length > 0) {
    where.push(`(${associationFilters.join('\n  OR ')})`);
  }

  const result = await client.query<SteelCatalogFamilyRuleRow>(
    `
SELECT
  id,
  rule_type,
  catalog_family,
  product_name,
  product_names,
  aliases,
  selectors,
  prompt,
  priority,
  confidence,
  active,
  review_state,
  source_refs
FROM steel.catalog_family_rules
WHERE ${where.join('\n  AND ')}
ORDER BY priority ASC, id ASC
LIMIT ${addLimit(values, input.limit)}
`,
    values,
  );

  return result.rows.map(toCatalogFamilyRule);
}

export async function searchSteelQuoteRules(
  client: SteelRepositoryClient,
  input: SearchSteelQuoteRulesInput,
): Promise<SteelQuoteRule[]> {
  const where = ['review_state = $1'];
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];
  const scopeFilters = ["scope_type = 'company'"];

  if (!input.includeInactive) {
    where.push('active = true');
  }

  addRuleTypesFilter(where, values, input.ruleTypes);

  const catalogFamilies = uniqueNonEmpty(input.catalogFamilies);
  if (catalogFamilies.length > 0) {
    values.push(catalogFamilies);
    scopeFilters.push(`catalog_family = ANY($${values.length}::text[])`);
  }

  const productFamilies = uniqueNonEmpty(input.productFamilies);
  if (productFamilies.length > 0) {
    values.push(productFamilies);
    scopeFilters.push(`product_family = ANY($${values.length}::text[])`);
  }

  where.push(`(${scopeFilters.join(' OR ')})`);
  addNullableTextArrayFilter(where, values, 'charge_type', input.chargeTypes);
  addNullableTextArrayFilter(where, values, 'formula_code', input.formulaCodes);

  const result = await client.query<SteelQuoteRuleRow>(
    `
SELECT
  id,
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
FROM steel.quote_rules
WHERE ${where.join('\n  AND ')}
ORDER BY
  CASE scope_type
    WHEN 'catalog_family' THEN 0
    WHEN 'product_family' THEN 1
    ELSE 2
  END ASC,
  priority ASC,
  id ASC
LIMIT ${addLimit(values, input.limit)}
`,
    values,
  );

  return result.rows.map(toQuoteRule);
}

export async function searchSteelCustomerRules(
  client: SteelRepositoryClient,
  input: SearchSteelCustomerRulesInput,
): Promise<SteelCustomerRule[]> {
  const where = ['review_state = $1'];
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];
  const customerFilters: string[] = [];

  if (!input.includeInactive) {
    where.push('active = true');
  }

  addRuleTypesFilter(where, values, input.ruleTypes);

  const customerIds = uniquePositive(input.customerIds);
  if (customerIds.length > 0) {
    values.push(customerIds);
    customerFilters.push(`customer_id = ANY($${values.length}::bigint[])`);
  }

  const customerTierIds = uniquePositive(input.customerTierIds);
  if (customerTierIds.length > 0) {
    values.push(customerTierIds);
    customerFilters.push(`customer_tier_id = ANY($${values.length}::bigint[])`);
  }

  if (customerFilters.length > 0) {
    where.push(`(${customerFilters.join(' OR ')})`);
  }

  addNullableTextArrayFilter(where, values, 'catalog_family', input.catalogFamilies);
  addNullableTextArrayFilter(where, values, 'product_family', input.productFamilies);
  addNullableTextArrayFilter(where, values, 'charge_type', input.chargeTypes);
  addNullableTextArrayFilter(where, values, 'formula_code', input.formulaCodes);

  const result = await client.query<SteelCustomerRuleRow>(
    `
SELECT
  id,
  rule_type,
  customer_id,
  customer_tier_id,
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
FROM steel.customer_rules
WHERE ${where.join('\n  AND ')}
ORDER BY
  CASE
    WHEN customer_id IS NOT NULL THEN 0
    WHEN customer_tier_id IS NOT NULL THEN 1
    ELSE 2
  END ASC,
  priority ASC,
  id ASC
LIMIT ${addLimit(values, input.limit)}
`,
    values,
  );

  return result.rows.map(toCustomerRule);
}
