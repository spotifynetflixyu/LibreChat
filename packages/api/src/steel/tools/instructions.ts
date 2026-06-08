import { lookupSteelDefaults } from './defaults';

import type {
  SearchSteelInstructionPacketsInput,
  SteelInstructionPacket,
  SteelQuoteDefault,
} from '../repositories';
import type { SteelSourceRef } from '../repositories/types';
import type { SteelToolJsonObject, SteelToolJsonValue } from './results';
import type {
  LookupDefaultsInput,
  LookupInstructionsInput,
  LookupQuoteRulesInput,
} from './schemas';

type InstructionCatalogContext = LookupInstructionsInput['catalogContexts'][number];
type RuleLookupInput = LookupInstructionsInput | LookupQuoteRulesInput;

interface InstructionContextMatch {
  lineRefs: string[];
  catalogFamilies: string[];
  productNames: string[];
  formulaCodes: string[];
  processingTypes: string[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function inferPacketGroups(catalogCandidates: readonly string[] | undefined): string[] {
  const candidates = catalogCandidates ?? [];

  if (candidates.some((candidate) => candidate === 'c_type' || candidate === 'C型鋼')) {
    return ['c-type-quote-core'];
  }

  if (candidates.some((candidate) => candidate === 'angle' || candidate === '角鐵')) {
    return ['angle-zinc-quote-core'];
  }

  if (
    candidates.some(
      (candidate) => candidate === 'h_beam' || candidate === 'H型鋼' || candidate === 'H鋼',
    )
  ) {
    return ['h-type-quote-core'];
  }

  return [];
}

function getContextGroups(context: InstructionCatalogContext): string[] {
  return unique([
    ...(context.packetGroupHints ?? []),
    ...inferPacketGroups(context.catalogCandidates),
  ]);
}

function getRequestedGroups(input: RuleLookupInput): string[] {
  return unique([
    ...(input.packetGroupHints ?? []),
    ...input.catalogContexts.flatMap((context) => getContextGroups(context)),
  ]);
}

function getContextsForGroup(input: RuleLookupInput, group: string): InstructionCatalogContext[] {
  return input.catalogContexts.filter((context) => getContextGroups(context).includes(group));
}

function getMatchForGroup(input: RuleLookupInput, group: string): InstructionContextMatch {
  const contexts = getContextsForGroup(input, group);
  const selectedContexts = contexts.length > 0 ? contexts : input.catalogContexts;

  return {
    lineRefs: unique(selectedContexts.flatMap((context) => context.lineRefs ?? [])),
    catalogFamilies: unique(selectedContexts.flatMap((context) => context.catalogCandidates ?? [])),
    productNames: unique(selectedContexts.flatMap((context) => context.productNameCandidates ?? [])),
    formulaCodes: unique(selectedContexts.flatMap((context) => context.formulaCandidates ?? [])),
    processingTypes: unique(selectedContexts.flatMap((context) => context.processingTypes ?? [])),
  };
}

function toMatchedFacets(
  input: RuleLookupInput,
  group: string,
): { [key: string]: SteelToolJsonValue } {
  const match = getMatchForGroup(input, group);

  return {
    lineRefs: match.lineRefs,
    taskTypes: input.taskTypes,
    catalogFamilies: match.catalogFamilies,
    productNames: match.productNames,
    formulaCodes: match.formulaCodes,
    processingTypes: match.processingTypes,
  };
}

function getMatchedPacketGroup(packet: SteelInstructionPacket, requestedGroups: string[]): string {
  return (
    requestedGroups.find((group) => packet.packetGroups.includes(group)) ??
    packet.packetGroups[0] ??
    'unscoped'
  );
}

function toSourceRefOutput(sourceRef: SteelSourceRef): SteelToolJsonObject {
  return {
    channel: sourceRef.channel,
    factType: sourceRef.factType,
    sourceFile: sourceRef.sourceFile ?? null,
    sourceVersionId: sourceRef.sourceVersionId ?? null,
    locator: sourceRef.locator ?? null,
    confidence: sourceRef.confidence ?? null,
    extractedLabel: sourceRef.extractedLabel ?? null,
    canonicalKey: sourceRef.canonicalKey ?? null,
  };
}

function toPacketOutput(
  packet: SteelInstructionPacket,
  group: string,
  input: RuleLookupInput,
): SteelToolJsonObject {
  return {
    id: `instruction_packet:${packet.id}`,
    slug: packet.slug,
    version: packet.version,
    title: packet.title,
    locale: packet.locale,
    priority: packet.priority,
    confidence: packet.confidence,
    packetGroup: group,
    packetGroups: packet.packetGroups,
    matchedFacets: toMatchedFacets(input, group),
    instruction: packet.instruction,
    requiredLookups: packet.requiredLookups,
    blockingRules: packet.blockingRules,
    userVisibleNotes: packet.userVisibleNotes,
    confirmationQuestions: packet.confirmationQuestions,
    sourceRefs: packet.sourceRefs.map(toSourceRefOutput),
  };
}

function selectPackets(
  input: RuleLookupInput,
  instructionPackets: readonly SteelInstructionPacket[],
): Array<{ packet: SteelInstructionPacket; group: string }> {
  const requestedGroups = getRequestedGroups(input);
  const limit = input.limit ?? 20;
  const selectedPackets: Array<{ packet: SteelInstructionPacket; group: string }> = [];
  const seenSlugs = new Set<string>();

  if (requestedGroups.length === 0) {
    return selectedPackets;
  }

  for (const packet of instructionPackets) {
    if (selectedPackets.length >= limit) {
      break;
    }

    if (seenSlugs.has(packet.slug)) {
      continue;
    }

    const group = getMatchedPacketGroup(packet, requestedGroups);
    if (!requestedGroups.includes(group)) {
      continue;
    }

    selectedPackets.push({ packet, group });
    seenSlugs.add(packet.slug);
  }

  return selectedPackets;
}

function getPacketGroupSummaries(
  input: RuleLookupInput,
  selectedPackets: ReadonlyArray<{ packet: SteelInstructionPacket; group: string }>,
): SteelToolJsonObject[] {
  return getRequestedGroups(input).reduce<SteelToolJsonObject[]>((summaries, group) => {
    const returnedPacketSlugs = selectedPackets
      .filter(({ packet }) => packet.packetGroups.includes(group))
      .map(({ packet }) => packet.slug);

    if (returnedPacketSlugs.length > 0) {
      summaries.push({
        group,
        lineRefs: getMatchForGroup(input, group).lineRefs,
        returnedPacketSlugs,
      });
    }

    return summaries;
  }, []);
}

function isObject(value: SteelToolJsonValue): value is SteelToolJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUserVisibleNotes(defaultCandidate: SteelToolJsonObject): string[] {
  const defaultParameters = defaultCandidate.defaultParameters;

  if (!Array.isArray(defaultParameters)) {
    return [];
  }

  return defaultParameters.flatMap((parameter) => {
    if (!isObject(parameter)) {
      return [];
    }

    return parameter.parameterKey === 'userVisibleNote' && typeof parameter.value === 'string'
      ? [parameter.value]
      : [];
  });
}

function filterMergedRequiredLookups(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter(
    (value): value is string =>
      typeof value === 'string' && value !== 'lookup_instructions' && value !== 'lookup_defaults',
  );
}

function toLookupDefaultsInput(input: LookupQuoteRulesInput): LookupDefaultsInput {
  return {
    catalogContexts: input.catalogContexts,
    customerContext: input.customerContext,
    reviewState: input.reviewState,
    includeInactive: input.includeInactive,
    limit: input.limit,
  };
}

export function getSteelInstructionPacketSearchInput(
  input: RuleLookupInput,
): SearchSteelInstructionPacketsInput {
  return {
    packetGroups: getRequestedGroups(input),
    taskTypes: input.taskTypes,
    catalogFamilies: unique(
      input.catalogContexts.flatMap((context) => context.catalogCandidates ?? []),
    ),
    processingTypes: unique(
      input.catalogContexts.flatMap((context) => context.processingTypes ?? []),
    ),
    formulaCodes: unique(
      input.catalogContexts.flatMap((context) => context.formulaCandidates ?? []),
    ),
    reviewState: input.reviewState,
    includeInactive: input.includeInactive,
    limit: input.limit,
  };
}

export function getQuoteRulesDefaultsInput(input: LookupQuoteRulesInput): LookupDefaultsInput {
  return toLookupDefaultsInput(input);
}

export function lookupSteelInstructions(
  input: LookupInstructionsInput,
  instructionPackets: readonly SteelInstructionPacket[],
): SteelToolJsonObject {
  const requestedGroups = getRequestedGroups(input);
  const selectedPackets = selectPackets(input, instructionPackets);
  const packets = selectedPackets.map(({ packet, group }) => toPacketOutput(packet, group, input));

  return {
    packetGroups: getPacketGroupSummaries(input, selectedPackets),
    packets,
    notReturnedReason:
      requestedGroups.length === 0 || packets.length === 0 ? 'no_matching_packet_group' : null,
    conflicts: [],
  };
}

export function lookupSteelQuoteRules(
  input: LookupQuoteRulesInput,
  instructionPackets: readonly SteelInstructionPacket[],
  quoteDefaults: readonly SteelQuoteDefault[],
): SteelToolJsonObject {
  const instructionResult = lookupSteelInstructions(input, instructionPackets);
  const defaultsResult = lookupSteelDefaults(toLookupDefaultsInput(input), quoteDefaults);
  const instructionPacketsOutput = Array.isArray(instructionResult.packets)
    ? instructionResult.packets.filter(isObject).map((packet) => ({
        ...packet,
        requiredLookups: filterMergedRequiredLookups(packet.requiredLookups),
      }))
    : [];
  const quoteDefaultsOutput = Array.isArray(defaultsResult.defaultCandidates)
    ? defaultsResult.defaultCandidates.filter(isObject)
    : [];

  return {
    instructionPacketGroups: instructionResult.packetGroups,
    instructionPackets: instructionPacketsOutput,
    quoteDefaults: quoteDefaultsOutput,
    requiredLookups: unique(
      instructionPacketsOutput.flatMap((packet) =>
        filterMergedRequiredLookups(packet.requiredLookups),
      ),
    ),
    userVisibleNotes: unique([
      ...instructionPackets.flatMap((packet) => packet.userVisibleNotes),
      ...quoteDefaultsOutput.flatMap(readUserVisibleNotes),
    ]),
    confirmationQuestions: unique(
      instructionPackets.flatMap((packet) => packet.confirmationQuestions),
    ),
    conflicts: instructionResult.conflicts,
    notReturnedReason: {
      instructions: instructionResult.notReturnedReason,
      quoteDefaults: defaultsResult.notReturnedReason,
    },
  };
}
