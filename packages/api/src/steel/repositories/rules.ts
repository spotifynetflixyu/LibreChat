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

export type SteelRuleKind = 'agent' | 'output' | 'steel' | 'other';

interface SteelUnifiedRuleRow {
  id: string | number;
  slug: string;
  version: string | number;
  rule_kind: string;
  title: string;
  locale: string;
  rule_sections: string[];
  selectors: SteelJsonValue | null;
  prompt: string;
  tool_policy: SteelJsonValue | null;
  output_policy: SteelJsonValue | null;
  priority: string | number;
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

export interface SearchSteelRulesInput {
  keywords?: readonly string[];
  ruleKinds?: readonly SteelRuleKind[];
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

export interface SearchSteelAgentRulesInput extends SearchSteelRulesInput {
  ruleTypes?: readonly string[];
  ruleSections?: readonly string[];
  sheetIds?: readonly string[];
}

export interface SearchSteelQuoteRulesInput extends SearchSteelRulesInput {
  catalogFamilies?: readonly string[];
  productFamilies?: readonly string[];
  chargeTypes?: readonly string[];
  formulaCodes?: readonly string[];
  ruleTypes?: readonly string[];
}

export interface SearchSteelCustomerRulesInput extends SearchSteelQuoteRulesInput {
  customerIds?: readonly number[];
  customerTierIds?: readonly number[];
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function readJsonObjectField(value: SteelJsonValue, key: string): SteelJsonValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value[key];
}

function readStringField(value: SteelJsonValue, key: string): string | undefined {
  const field = readJsonObjectField(value, key);

  return typeof field === 'string' && field.trim() !== '' ? field : undefined;
}

function readNumberField(value: SteelJsonValue, key: string): number | null {
  const field = readJsonObjectField(value, key);

  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function readStringArray(value: SteelJsonValue | string[] | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as unknown[]).filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim() !== '',
  );
}

function toRuleKind(value: string): SteelRuleKind {
  if (value === 'agent' || value === 'output' || value === 'steel' || value === 'other') {
    return value;
  }

  throw new Error(`Unexpected Steel rule_kind: ${value}`);
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

function addKeywordContainsFilter(
  where: string[],
  values: SteelSqlParameter[],
  keywords: readonly string[] | undefined,
) {
  const uniqueKeywords = uniqueNonEmpty(keywords);
  if (uniqueKeywords.length === 0) {
    return;
  }

  const clauses = uniqueKeywords.map((keyword) => {
    values.push(`%${keyword}%`);
    const placeholder = `$${values.length}`;
    return `(
      slug ILIKE ${placeholder}
      OR title ILIKE ${placeholder}
      OR rule_sections::text ILIKE ${placeholder}
      OR selectors::text ILIKE ${placeholder}
      OR prompt ILIKE ${placeholder}
      OR tool_policy::text ILIKE ${placeholder}
      OR output_policy::text ILIKE ${placeholder}
    )`;
  });

  where.push(`(${clauses.join('\n  OR ')})`);
}

function addCommonRuleFilters(
  where: string[],
  values: SteelSqlParameter[],
  input: SearchSteelRulesInput,
) {
  values.push(input.reviewState ?? 'reviewed');
  where.push(`review_state = $${values.length}`);

  if (!input.includeInactive) {
    where.push('active = true');
  }

  const ruleKinds = uniqueNonEmpty(input.ruleKinds);
  if (ruleKinds.length > 0) {
    values.push(ruleKinds);
    where.push(`rule_kind = ANY($${values.length}::text[])`);
  }

  addKeywordContainsFilter(where, values, input.keywords);
}

function getRuleQuery(
  input: SearchSteelRulesInput,
): { sql: string; values: SteelSqlParameter[] } {
  const where: string[] = [];
  const values: SteelSqlParameter[] = [];

  addCommonRuleFilters(where, values, input);
  values.push(getLimit(input.limit));

  return {
    sql: `
SELECT
  id,
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
FROM steel.rules
WHERE ${where.join('\n  AND ')}
ORDER BY
  priority ASC,
  id ASC
LIMIT $${values.length}
`,
    values,
  };
}

function parseSelectors(row: SteelUnifiedRuleRow): SteelJsonValue {
  return parseJsonObject(row.selectors);
}

function parseToolPolicy(row: SteelUnifiedRuleRow): SteelJsonValue {
  return parseJsonObject(row.tool_policy);
}

function parseOutputPolicy(row: SteelUnifiedRuleRow): SteelJsonValue {
  return parseJsonObject(row.output_policy);
}

function toAgentRule(row: SteelUnifiedRuleRow): SteelAgentRule {
  const selectors = parseSelectors(row);

  return {
    id: parseRequiredNumber(row.id),
    slug: row.slug,
    version: parseRequiredNumber(row.version),
    ruleType: toRuleKind(row.rule_kind),
    title: row.title,
    locale: row.locale,
    ruleSections: readStringArray(row.rule_sections),
    sheetId: readStringField(selectors, 'sheetId'),
    selectors,
    prompt: row.prompt,
    toolPolicy: parseToolPolicy(row),
    outputPolicy: parseOutputPolicy(row),
    priority: parseRequiredNumber(row.priority),
    confidence: readStringField(selectors, 'confidence') ?? 'high',
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

function toQuoteRule(row: SteelUnifiedRuleRow): SteelQuoteRule {
  const selectors = parseSelectors(row);
  const toolPolicy = parseToolPolicy(row);

  return {
    id: parseRequiredNumber(row.id),
    ruleType: readStringField(selectors, 'ruleType') ?? toRuleKind(row.rule_kind),
    scopeType: readStringField(selectors, 'scopeType') ?? 'company',
    catalogFamily: readStringField(selectors, 'catalogFamily'),
    productFamily: readStringField(selectors, 'productFamily'),
    chargeType: readStringField(selectors, 'chargeType'),
    formulaCode: readStringField(selectors, 'formulaCode'),
    selectors,
    parameters: toolPolicy,
    prompt: row.prompt,
    priority: parseRequiredNumber(row.priority),
    confidence: readStringField(selectors, 'confidence') ?? 'high',
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

function toCustomerRule(row: SteelUnifiedRuleRow): SteelCustomerRule {
  const selectors = parseSelectors(row);
  const quoteRule = toQuoteRule(row);

  return {
    ...quoteRule,
    customerId: readNumberField(selectors, 'customerId'),
    customerTierId: parseNullableNumber(readNumberField(selectors, 'customerTierId')),
  };
}

export async function searchSteelRules(
  client: SteelRepositoryClient,
  input: SearchSteelRulesInput,
): Promise<SteelAgentRule[]> {
  const query = getRuleQuery(input);
  const result = await client.query<SteelUnifiedRuleRow>(query.sql, query.values);

  return result.rows.map(toAgentRule);
}

export async function searchSteelAgentRules(
  client: SteelRepositoryClient,
  input: SearchSteelAgentRulesInput,
): Promise<SteelAgentRule[]> {
  const query = getRuleQuery({
    ...input,
    ruleKinds: input.ruleKinds ?? ['agent'],
  });
  const result = await client.query<SteelUnifiedRuleRow>(query.sql, query.values);

  return result.rows.map(toAgentRule);
}

export async function listReviewedSteelAgentRules(
  client: SteelRepositoryClient,
): Promise<SteelAgentRule[]> {
  return listReviewedSteelRulesByKind(client, 'agent');
}

async function listReviewedSteelRulesByKind(
  client: SteelRepositoryClient,
  ruleKind: SteelRuleKind,
): Promise<SteelAgentRule[]> {
  const result = await client.query<SteelUnifiedRuleRow>(
    `
SELECT
  id,
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
FROM steel.rules
WHERE review_state = $1
  AND active = true
  AND rule_kind = $2
ORDER BY priority ASC, id ASC
`,
    ['reviewed', ruleKind],
  );

  return result.rows.map(toAgentRule);
}

export async function listReviewedSteelOutputRules(
  client: SteelRepositoryClient,
): Promise<SteelAgentRule[]> {
  return listReviewedSteelRulesByKind(client, 'output');
}

export async function listReviewedSteelOtherRules(
  client: SteelRepositoryClient,
): Promise<SteelAgentRule[]> {
  return listReviewedSteelRulesByKind(client, 'other');
}

export async function searchSteelQuoteRules(
  client: SteelRepositoryClient,
  input: SearchSteelQuoteRulesInput,
): Promise<SteelQuoteRule[]> {
  const query = getRuleQuery({
    ...input,
    ruleKinds: input.ruleKinds ? undefined : ['steel'],
  });
  const result = await client.query<SteelUnifiedRuleRow>(query.sql, query.values);

  return result.rows.map(toQuoteRule);
}

export async function listReviewedSteelQuoteRules(
  client: SteelRepositoryClient,
): Promise<SteelQuoteRule[]> {
  const result = await client.query<SteelUnifiedRuleRow>(
    `
SELECT
  id,
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
FROM steel.rules
WHERE review_state = $1
  AND active = true
  AND rule_kind = 'steel'
ORDER BY priority ASC, id ASC
`,
    ['reviewed'],
  );

  return result.rows.map(toQuoteRule);
}

export async function searchSteelCustomerRules(
  client: SteelRepositoryClient,
  input: SearchSteelCustomerRulesInput,
): Promise<SteelCustomerRule[]> {
  const query = getRuleQuery({
    ...input,
    ruleKinds: input.ruleKinds ? undefined : ['steel'],
  });
  const result = await client.query<SteelUnifiedRuleRow>(query.sql, query.values);

  return result.rows.map(toCustomerRule);
}
