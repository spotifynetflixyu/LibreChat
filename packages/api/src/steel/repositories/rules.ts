import { parseJsonObject, parseRequiredNumber, parseReviewState } from './types';

import type { SteelJsonValue, SteelRepositoryClient, SteelReviewState } from './types';

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
}

export interface SteelAgentRule {
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
}

export interface SteelQuoteRule {
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
  };
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
  review_state
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
  review_state
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
