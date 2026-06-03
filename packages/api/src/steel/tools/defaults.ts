import type { SteelJsonValue, SteelQuoteDefault, SteelSourceRef } from '../repositories';
import type { SteelToolJsonObject, SteelToolJsonValue } from './results';
import type { LookupDefaultsInput } from './schemas';
import type { SearchSteelQuoteDefaultsInput } from '../repositories';

type MaterialContext = LookupDefaultsInput['materialContexts'][number];

interface MatchedDefaultContext {
  lineRefs: string[];
  materialFamilies: string[];
  formulaCodes: string[];
  chargeTypes: string[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function toChargeType(processingType: string): string | null {
  if (processingType === 'holes' || processingType === 'hole' || processingType === 'long_holes') {
    return 'hole';
  }

  if (processingType === 'head_tail_trim') {
    return 'cutting';
  }

  if (
    processingType === 'cutting' ||
    processingType === 'slotting' ||
    processingType === 'bending' ||
    processingType === 'processing' ||
    processingType === 'material'
  ) {
    return processingType;
  }

  return null;
}

function getContextChargeTypes(context: MaterialContext): string[] {
  return unique(
    (context.processingTypes ?? [])
      .map(toChargeType)
      .filter((value): value is string => value !== null),
  );
}

function getLookupChargeTypes(input: LookupDefaultsInput): string[] {
  return unique(input.materialContexts.flatMap(getContextChargeTypes));
}

function getLookupMaterialFamilies(input: LookupDefaultsInput): string[] {
  return unique(input.materialContexts.flatMap((context) => context.materialCandidates ?? []));
}

function getLookupFormulaCodes(input: LookupDefaultsInput): string[] {
  return unique(input.materialContexts.flatMap((context) => context.formulaCandidates ?? []));
}

export function getSteelQuoteDefaultSearchInput(
  input: LookupDefaultsInput,
): SearchSteelQuoteDefaultsInput {
  return {
    customerId: input.customerContext?.customerId,
    customerTierId: input.customerContext?.customerTierId,
    materialFamilies: getLookupMaterialFamilies(input),
    chargeTypes: getLookupChargeTypes(input),
    formulaCodes: getLookupFormulaCodes(input),
    reviewState: input.reviewState,
    includeInactive: input.includeInactive,
    limit: input.limit,
  };
}

function contextMatchesDefault(context: MaterialContext, quoteDefault: SteelQuoteDefault): boolean {
  if (
    quoteDefault.materialFamily &&
    !(context.materialCandidates ?? []).includes(quoteDefault.materialFamily)
  ) {
    return false;
  }

  if (
    quoteDefault.formulaCode &&
    !(context.formulaCandidates ?? []).includes(quoteDefault.formulaCode)
  ) {
    return false;
  }

  if (
    quoteDefault.chargeType &&
    !getContextChargeTypes(context).includes(quoteDefault.chargeType)
  ) {
    return false;
  }

  return true;
}

function getMatchedContexts(
  input: LookupDefaultsInput,
  quoteDefault: SteelQuoteDefault,
): MaterialContext[] {
  return input.materialContexts.filter((context) => contextMatchesDefault(context, quoteDefault));
}

function readStringArrayField(value: SteelJsonValue, key: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }

  const field = value[key];

  if (!Array.isArray(field)) {
    return [];
  }

  return field.filter((entry): entry is string => typeof entry === 'string');
}

function getMatchedContextFacets(contexts: readonly MaterialContext[]): MatchedDefaultContext {
  return {
    lineRefs: unique(contexts.flatMap((context) => context.lineRefs ?? [])),
    materialFamilies: unique(contexts.flatMap((context) => context.materialCandidates ?? [])),
    formulaCodes: unique(contexts.flatMap((context) => context.formulaCandidates ?? [])),
    chargeTypes: unique(contexts.flatMap(getContextChargeTypes)),
  };
}

function getDefaultChargeTypes(
  quoteDefault: SteelQuoteDefault,
  matchedContext: MatchedDefaultContext,
): string[] {
  if (quoteDefault.chargeType) {
    return [quoteDefault.chargeType];
  }

  const selectorChargeTypes = readStringArrayField(quoteDefault.selector, 'chargeTypes');
  return selectorChargeTypes.length > 0 ? selectorChargeTypes : matchedContext.chargeTypes;
}

function isObject(value: SteelJsonValue): value is { [key: string]: SteelJsonValue | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readInstruction(defaultParameters: SteelJsonValue): string | null {
  if (!Array.isArray(defaultParameters)) {
    return null;
  }

  for (const parameter of defaultParameters) {
    if (!isObject(parameter)) {
      continue;
    }

    if (parameter.parameterKey === 'instruction' && typeof parameter.value === 'string') {
      return parameter.value;
    }
  }

  return null;
}

function toToolJsonValue(value: SteelJsonValue): SteelToolJsonValue {
  if (Array.isArray(value)) {
    return value.map(toToolJsonValue);
  }

  if (!isObject(value)) {
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

function toDefaultCandidate(
  quoteDefault: SteelQuoteDefault,
  matchedContext: MatchedDefaultContext,
): SteelToolJsonObject {
  const instruction = readInstruction(quoteDefault.defaultParameters);
  const candidate: SteelToolJsonObject = {
    defaultId: `quote_default:${quoteDefault.id}`,
    defaultType: quoteDefault.defaultType,
    originTable: quoteDefault.originTable,
    originId: quoteDefault.originId,
    scopeType: quoteDefault.scopeType,
    customerId: quoteDefault.customerId,
    customerTierId: quoteDefault.customerTierId,
    lineRefs: matchedContext.lineRefs,
    materialFamilies: quoteDefault.materialFamily
      ? [quoteDefault.materialFamily]
      : matchedContext.materialFamilies,
    productFamilies: quoteDefault.productFamily ? [quoteDefault.productFamily] : [],
    chargeTypes: getDefaultChargeTypes(quoteDefault, matchedContext),
    formulaCodes: quoteDefault.formulaCode
      ? [quoteDefault.formulaCode]
      : matchedContext.formulaCodes,
    selector: toToolJsonValue(quoteDefault.selector),
    effect: quoteDefault.effect,
    defaultParameters: toToolJsonValue(quoteDefault.defaultParameters),
    priority: quoteDefault.priority,
    confidence: quoteDefault.confidence,
    sourceRefs: quoteDefault.sourceRefs.map(toToolSourceRef),
  };

  if (quoteDefault.originRevision) {
    candidate.originRevision = quoteDefault.originRevision;
  }

  if (instruction) {
    candidate.instruction = instruction;
  }

  return candidate;
}

export function lookupSteelDefaults(
  input: LookupDefaultsInput,
  quoteDefaults: readonly SteelQuoteDefault[],
): SteelToolJsonObject {
  const defaultCandidates = quoteDefaults
    .map((quoteDefault) => ({
      quoteDefault,
      matchedContext: getMatchedContextFacets(getMatchedContexts(input, quoteDefault)),
    }))
    .filter(({ matchedContext }) => matchedContext.lineRefs.length > 0)
    .slice(0, input.limit ?? 20)
    .map(({ quoteDefault, matchedContext }) => toDefaultCandidate(quoteDefault, matchedContext));

  return {
    defaultCandidates,
    notReturnedReason: defaultCandidates.length === 0 ? 'no_matching_defaults' : null,
  };
}
