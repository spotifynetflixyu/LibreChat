import type { SteelQuoteDefault } from '../repositories/defaults';
import type { SteelInstructionPacket } from '../repositories/instructions';
import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';
import type { SteelJsonValue } from '../repositories/types';

export interface SteelRuntimeJsonObject {
  [key: string]: SteelJsonValue | undefined;
}

export interface SteelGlobalRuleGroups {
  packetGroups: string[];
  catalogFamilies: string[];
  productFamilies: string[];
  chargeTypes: string[];
  formulaCodes: string[];
  quoteRuleTypes: string[];
  quoteDefaultTypes: string[];
}

export interface SteelRuntimeOtherGlobalRules {
  ocrSubagentRules: SteelAgentRule[];
  ocrMainAgentRules: SteelAgentRule[];
  fileRules: SteelAgentRule[];
  sourcePriorityRules: SteelAgentRule[];
  markdownOutputRules: SteelAgentRule[];
}

export interface SteelRuntimeContext {
  rules: {
    agentRules: SteelAgentRule[];
    steelGlobalRules: {
      instructionPackets: SteelInstructionPacket[];
      quoteDefaults: SteelQuoteDefault[];
      quoteRules: SteelQuoteRule[];
      groupedBy: SteelGlobalRuleGroups;
    };
    outputRules: SteelAgentRule[];
    otherGlobalRules: SteelRuntimeOtherGlobalRules;
  };
  attachments: {
    currentOcrMarkdownResults: SteelRuntimeJsonObject[];
    currentOcrFailures: SteelRuntimeJsonObject[];
  };
}

export interface SteelRuntimeContextConversationInput {
  requestId: string;
}

export interface SteelRuntimeContextAttachmentsInput {
  currentOcrMarkdownResults?: SteelRuntimeJsonObject[];
  currentOcrFailures?: SteelRuntimeJsonObject[];
}

export interface SteelRuntimeContextDependencies {
  listAgentRules(): Promise<SteelAgentRule[]>;
  listReviewedInstructionPackets(): Promise<SteelInstructionPacket[]>;
  listReviewedQuoteDefaults(): Promise<SteelQuoteDefault[]>;
  listReviewedQuoteRules(): Promise<SteelQuoteRule[]>;
  listOutputRules(): Promise<SteelAgentRule[]>;
  listOtherGlobalRules(): Promise<SteelRuntimeOtherGlobalRules>;
}

export interface PrepareSteelRuntimeContextInput {
  conversation: SteelRuntimeContextConversationInput;
  attachments?: SteelRuntimeContextAttachmentsInput;
  dependencies: SteelRuntimeContextDependencies;
}


function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function buildGlobalRuleGroups({
  instructionPackets,
  quoteDefaults,
  quoteRules,
}: {
  instructionPackets: readonly SteelInstructionPacket[];
  quoteDefaults: readonly SteelQuoteDefault[];
  quoteRules: readonly SteelQuoteRule[];
}): SteelGlobalRuleGroups {
  return {
    packetGroups: uniqueStrings(instructionPackets.flatMap((packet) => packet.packetGroups)),
    catalogFamilies: uniqueStrings([
      ...quoteDefaults.map((quoteDefault) => quoteDefault.catalogFamily),
      ...quoteRules.map((quoteRule) => quoteRule.catalogFamily),
    ]),
    productFamilies: uniqueStrings([
      ...quoteDefaults.map((quoteDefault) => quoteDefault.productFamily),
      ...quoteRules.map((quoteRule) => quoteRule.productFamily),
    ]),
    chargeTypes: uniqueStrings([
      ...quoteDefaults.map((quoteDefault) => quoteDefault.chargeType),
      ...quoteRules.map((quoteRule) => quoteRule.chargeType),
    ]),
    formulaCodes: uniqueStrings([
      ...quoteDefaults.map((quoteDefault) => quoteDefault.formulaCode),
      ...quoteRules.map((quoteRule) => quoteRule.formulaCode),
    ]),
    quoteRuleTypes: uniqueStrings(quoteRules.map((quoteRule) => quoteRule.ruleType)),
    quoteDefaultTypes: uniqueStrings(quoteDefaults.map((quoteDefault) => quoteDefault.defaultType)),
  };
}

export async function prepareSteelRuntimeContext({
  conversation,
  attachments,
  dependencies,
}: PrepareSteelRuntimeContextInput): Promise<SteelRuntimeContext> {
  const [agentRules, instructionPackets, quoteDefaults, quoteRules, outputRules, otherGlobalRules] =
    await Promise.all([
      dependencies.listAgentRules(),
      dependencies.listReviewedInstructionPackets(),
      dependencies.listReviewedQuoteDefaults(),
      dependencies.listReviewedQuoteRules(),
      dependencies.listOutputRules(),
      dependencies.listOtherGlobalRules(),
    ]);

  return {
    rules: {
      agentRules,
      steelGlobalRules: {
        instructionPackets,
        quoteDefaults,
        quoteRules,
        groupedBy: buildGlobalRuleGroups({ instructionPackets, quoteDefaults, quoteRules }),
      },
      outputRules,
      otherGlobalRules,
    },
    attachments: {
      currentOcrMarkdownResults: attachments?.currentOcrMarkdownResults ?? [],
      currentOcrFailures: attachments?.currentOcrFailures ?? [],
    },
  };
}

export async function prepareLibreChatSteelRuntimeContext({
  conversation,
  attachments,
  dependencies,
}: PrepareSteelRuntimeContextInput): Promise<SteelRuntimeContext> {
  return prepareSteelRuntimeContext({
    conversation,
    attachments,
    dependencies,
  });
}
