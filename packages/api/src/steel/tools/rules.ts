import type {
  SteelCatalogFamily,
  SteelCatalogFamilyRule,
  SteelCustomerRule,
  SteelQuoteRule,
  SteelQuoteDefault,
} from '../repositories';
import type { SteelJsonValue, SteelSourceRef } from '../repositories/types';
import type { SteelToolJsonObject, SteelToolJsonValue } from './results';

type RuleScopeType =
  | 'company'
  | 'customer'
  | 'customer_tier'
  | 'catalog_family'
  | 'product_family'
  | 'product_name';

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function toToolSourceRef(sourceRef: SteelSourceRef): SteelToolJsonObject {
  const output: SteelToolJsonObject = {
    channel: sourceRef.channel,
    factType: sourceRef.factType,
  };

  for (const key of [
    'sourceFile',
    'sourceVersionId',
    'locator',
    'confidence',
    'extractedLabel',
    'canonicalKey',
  ] as const) {
    const value = sourceRef[key];

    if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
}

function toToolJsonValue(value: SteelJsonValue): SteelToolJsonValue {
  if (Array.isArray(value)) {
    return value.map(toToolJsonValue);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const output: SteelToolJsonObject = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      output[key] = toToolJsonValue(entry);
    }
  }

  return output;
}

function isObject(value: unknown): value is SteelToolJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readObject(value: SteelToolJsonValue | undefined): SteelToolJsonObject {
  return isObject(value) ? value : {};
}

function readStringArray(value: SteelToolJsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readNumber(value: SteelToolJsonValue | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

function readString(value: SteelToolJsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readSourceRefs(value: SteelToolJsonValue | undefined): SteelToolJsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isObject);
}

function readParameterInstruction(value: SteelToolJsonValue | undefined): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const parameter of value) {
    if (!isObject(parameter)) {
      continue;
    }

    if (parameter.parameterKey === 'instruction' && typeof parameter.value === 'string') {
      return parameter.value;
    }
  }

  return null;
}

function readSelectorProductNames(selector: SteelToolJsonObject): string[] {
  const productNames = readStringArray(selector.productNames);
  const productName = readString(selector.productName);

  return unique(productName ? [productName, ...productNames] : productNames);
}

function readScopeType(value: SteelToolJsonValue | undefined): RuleScopeType {
  if (
    value === 'customer' ||
    value === 'customer_tier' ||
    value === 'catalog_family' ||
    value === 'product_family' ||
    value === 'product_name'
  ) {
    return value;
  }

  return 'company';
}

function toRuleScope(input: {
  type: RuleScopeType;
  customerId?: number | null;
  customerTierId?: number | null;
  catalogFamilies?: readonly string[];
  productNames?: readonly string[];
  chargeTypes?: readonly string[];
  formulaCodes?: readonly string[];
}): SteelToolJsonObject {
  return {
    type: input.type,
    customerId: input.customerId ?? null,
    customerTierId: input.customerTierId ?? null,
    catalogFamilies: unique(input.catalogFamilies ?? []),
    productNames: unique(input.productNames ?? []),
    chargeTypes: unique(input.chargeTypes ?? []),
    formulaCodes: unique(input.formulaCodes ?? []),
  };
}

function readQuoteDefaultPrompt(candidate: SteelToolJsonObject): string {
  return (
    readString(candidate.instruction) ??
    readParameterInstruction(candidate.defaultParameters) ??
    readString(candidate.effect) ??
    'Apply this reviewed quote default when its scope and selector match the quote context.'
  );
}

export function toCatalogFamilyRule(family: SteelCatalogFamily): SteelToolJsonObject {
  const productNames = unique([family.displayNameZh, ...family.aliases]);
  const aliasesText = productNames.length > 0 ? productNames.join(', ') : family.displayNameZh;

  return {
    id: `catalog_family:${family.key}`,
    ruleType: 'catalog_family_inference',
    scope: toRuleScope({
      type: 'catalog_family',
      catalogFamilies: [family.key],
      productNames,
    }),
    prompt: `Use reviewed catalog family ${family.key} (${family.displayNameZh}) as a candidate when customer wording matches aliases: ${aliasesText}. AI must choose this key for later tools only when the quote evidence supports it, otherwise ask the user to confirm.`,
    priority: 100,
    confidence: family.reviewState === 'reviewed' && family.active ? 'high' : 'medium',
    sourceRefs: family.sourceRefs.map(toToolSourceRef),
  };
}

export function toCatalogFamilyStoredRule(rule: SteelCatalogFamilyRule): SteelToolJsonObject {
  const productNames = unique([
    ...(rule.productName ? [rule.productName] : []),
    ...rule.productNames,
  ]);
  const aliases = unique(rule.aliases);
  const output: SteelToolJsonObject = {
    id: `catalog_family_rule:${rule.id}`,
    ruleType: rule.ruleType,
    scope: toRuleScope({
      type: productNames.length > 0 ? 'product_name' : 'catalog_family',
      catalogFamilies: rule.catalogFamily ? [rule.catalogFamily] : [],
      productNames,
    }),
    prompt: rule.prompt,
    priority: rule.priority,
    confidence: rule.confidence,
    sourceRefs: rule.sourceRefs.map(toToolSourceRef),
  };

  if (aliases.length > 0) {
    output.aliases = aliases;
  }

  if (isObject(rule.selectors)) {
    output.selectors = toToolJsonValue(rule.selectors);
  }

  return output;
}

export function toInstructionPacketRule(packet: SteelToolJsonObject): SteelToolJsonObject {
  const matchedFacets = readObject(packet.matchedFacets);
  const catalogFamilies = readStringArray(matchedFacets.catalogFamilies);
  const productNames = readStringArray(matchedFacets.productNames);
  const formulaCodes = readStringArray(matchedFacets.formulaCodes);
  const processingTypes = readStringArray(matchedFacets.processingTypes);

  return {
    id: readString(packet.id) ?? `instruction_packet:${readString(packet.slug) ?? 'unknown'}`,
    ruleType: 'instruction_packet',
    scope: toRuleScope({
      type: catalogFamilies.length > 0 ? 'catalog_family' : 'company',
      catalogFamilies,
      productNames,
      chargeTypes: processingTypes,
      formulaCodes,
    }),
    prompt: readString(packet.instruction) ?? '',
    priority: readNumber(packet.priority) ?? 100,
    confidence: readString(packet.confidence) ?? 'medium',
    matchedFacets,
    sourceRefs: readSourceRefs(packet.sourceRefs),
  };
}

export function toQuoteDefaultCandidateRule(candidate: SteelToolJsonObject): SteelToolJsonObject {
  const selector = readObject(candidate.selector);
  const catalogFamilies = readStringArray(candidate.catalogFamilies);
  const productNames = unique([
    ...readStringArray(candidate.productNames),
    ...readSelectorProductNames(selector),
  ]);
  const chargeTypes = readStringArray(candidate.chargeTypes);
  const formulaCodes = readStringArray(candidate.formulaCodes);
  const lineRefs = readStringArray(candidate.lineRefs);

  const rule: SteelToolJsonObject = {
    id: readString(candidate.defaultId) ?? 'quote_default:unknown',
    ruleType: 'quote_default',
    scope: toRuleScope({
      type: readScopeType(candidate.scopeType),
      customerId: readNumber(candidate.customerId),
      customerTierId: readNumber(candidate.customerTierId),
      catalogFamilies,
      productNames,
      chargeTypes,
      formulaCodes,
    }),
    prompt: readQuoteDefaultPrompt(candidate),
    priority: readNumber(candidate.priority) ?? 100,
    confidence: readString(candidate.confidence) ?? 'medium',
    sourceRefs: readSourceRefs(candidate.sourceRefs),
  };

  if (lineRefs.length > 0) {
    rule.matchedFacets = {
      lineRefs,
      catalogFamilies,
      formulaCodes,
      chargeTypes,
    };
  }

  return rule;
}

export function toQuoteRule(rule: SteelQuoteRule): SteelToolJsonObject {
  const output: SteelToolJsonObject = {
    id: `quote_rule:${rule.id}`,
    ruleType: rule.ruleType,
    scope: toRuleScope({
      type: readScopeType(rule.scopeType),
      catalogFamilies: rule.catalogFamily ? [rule.catalogFamily] : [],
      chargeTypes: rule.chargeType ? [rule.chargeType] : [],
      formulaCodes: rule.formulaCode ? [rule.formulaCode] : [],
    }),
    prompt: rule.prompt,
    priority: rule.priority,
    confidence: rule.confidence,
    sourceRefs: rule.sourceRefs.map(toToolSourceRef),
  };

  if (rule.productFamily) {
    output.scope = {
      ...readObject(output.scope),
      productFamilies: [rule.productFamily],
    };
  }

  if (isObject(rule.selectors)) {
    output.selectors = toToolJsonValue(rule.selectors);
  }

  if (Array.isArray(rule.parameters)) {
    output.parameters = toToolJsonValue(rule.parameters);
  }

  return output;
}

export function toCustomerRule(rule: SteelCustomerRule): SteelToolJsonObject {
  const output: SteelToolJsonObject = {
    id: `customer_rule:${rule.id}`,
    ruleType: rule.ruleType,
    scope: toRuleScope({
      type: rule.customerId !== null ? 'customer' : 'customer_tier',
      customerId: rule.customerId,
      customerTierId: rule.customerTierId,
      catalogFamilies: rule.catalogFamily ? [rule.catalogFamily] : [],
      chargeTypes: rule.chargeType ? [rule.chargeType] : [],
      formulaCodes: rule.formulaCode ? [rule.formulaCode] : [],
    }),
    prompt: rule.prompt,
    priority: rule.priority,
    confidence: rule.confidence,
    sourceRefs: rule.sourceRefs.map(toToolSourceRef),
  };

  if (rule.productFamily) {
    output.scope = {
      ...readObject(output.scope),
      productFamilies: [rule.productFamily],
    };
  }

  if (isObject(rule.selectors)) {
    output.selectors = toToolJsonValue(rule.selectors);
  }

  if (Array.isArray(rule.parameters)) {
    output.parameters = toToolJsonValue(rule.parameters);
  }

  return output;
}

export function toQuoteDefaultRule(quoteDefault: SteelQuoteDefault): SteelToolJsonObject {
  const selector = toToolJsonValue(quoteDefault.selector);
  const defaultParameters = toToolJsonValue(quoteDefault.defaultParameters);
  const selectorObject = readObject(selector);

  return toQuoteDefaultCandidateRule({
    defaultId: `quote_default:${quoteDefault.id}`,
    scopeType: quoteDefault.scopeType,
    customerId: quoteDefault.customerId,
    customerTierId: quoteDefault.customerTierId,
    catalogFamilies: quoteDefault.catalogFamily ? [quoteDefault.catalogFamily] : [],
    productNames: [],
    chargeTypes: quoteDefault.chargeType ? [quoteDefault.chargeType] : [],
    formulaCodes: quoteDefault.formulaCode ? [quoteDefault.formulaCode] : [],
    selector,
    effect: quoteDefault.effect,
    defaultParameters,
    priority: quoteDefault.priority,
    confidence: quoteDefault.confidence,
    sourceRefs: quoteDefault.sourceRefs.map(toToolSourceRef),
  });
}

export function toQuoteRulesRuleArray(input: {
  instructionPackets: readonly SteelToolJsonObject[];
  quoteDefaults: readonly SteelToolJsonObject[];
  quoteRules?: readonly SteelQuoteRule[];
}): SteelToolJsonObject[] {
  return [
    ...(input.quoteRules ?? []).map(toQuoteRule),
    ...input.instructionPackets.map(toInstructionPacketRule),
    ...input.quoteDefaults.map(toQuoteDefaultCandidateRule),
  ];
}

export function toCatalogFamilyRules(input: {
  families: readonly SteelCatalogFamily[];
  rules: readonly SteelCatalogFamilyRule[];
}): SteelToolJsonObject[] {
  return [
    ...input.rules.map(toCatalogFamilyStoredRule),
    ...input.families.map(toCatalogFamilyRule),
  ];
}

export function toCustomerRuleArray(rules: readonly SteelCustomerRule[]): SteelToolJsonObject[] {
  return rules.map(toCustomerRule);
}
