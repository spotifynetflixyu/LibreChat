import type { SteelOAuthChatFile, SteelOAuthChatMessage } from '../ai/provider';
import type { SteelQuoteDefault } from '../repositories/defaults';
import type { SteelInstructionPacket } from '../repositories/instructions';
import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';
import type { SteelJsonValue } from '../repositories/types';
import type { SteelBusinessToolName } from '../tools/schemas';

export const steelRuntimeActiveOutputSheetIds = [
  'system_order',
  'customer_data',
  'manual_review',
  'customer_quote',
] as const;

export const steelRuntimeAiVisibleTools = [
  'search_customers',
  'search_price_candidates',
  'run_file_ocr',
] as const satisfies readonly SteelBusinessToolName[];

export const steelRuntimeRemovedTools = [
  'lookup_quote_rules',
  'read_working_order_items',
] as const satisfies readonly SteelBusinessToolName[];

export type SteelRuntimeActiveOutputSheetId = (typeof steelRuntimeActiveOutputSheetIds)[number];
export type SteelRuntimeAiVisibleToolName = (typeof steelRuntimeAiVisibleTools)[number];
export type SteelRuntimeRemovedToolName = (typeof steelRuntimeRemovedTools)[number];

export interface SteelRuntimeJsonObject {
  [key: string]: SteelJsonValue | undefined;
}

export interface SteelRuntimeOutputSheetRow {
  rowId: string;
  cells: SteelRuntimeJsonObject;
}

export interface SteelRuntimeOutputSheet {
  sheetId: SteelRuntimeActiveOutputSheetId;
  rows: SteelRuntimeOutputSheetRow[];
}

export type GeneratedSteelOutputSheet = SteelRuntimeOutputSheet;

export interface FullActiveSteelOutputSheets {
  system_order: SteelRuntimeOutputSheet;
  customer_data: SteelRuntimeOutputSheet;
  manual_review: SteelRuntimeOutputSheet;
  customer_quote: SteelRuntimeOutputSheet;
}

export interface SteelRuntimeDerivedIndex {
  lineItems: SteelRuntimeJsonObject[];
  customers: SteelRuntimeJsonObject[];
  adoptedPrices: SteelRuntimeJsonObject[];
  calculations: SteelRuntimeJsonObject[];
  ocrExtracts: SteelRuntimeJsonObject[];
  unresolvedItems: SteelRuntimeJsonObject[];
}

export interface SteelOutputSheetMemorySnapshot {
  previousOutputSheets: FullActiveSteelOutputSheets;
  derivedIndex: SteelRuntimeDerivedIndex;
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
  ocrRules?: SteelAgentRule[];
  fileRules: SteelAgentRule[];
  sourcePriorityRules: SteelAgentRule[];
  markdownOutputRules: SteelAgentRule[];
  workbookOutputRules: SteelAgentRule[];
}

export interface SteelRuntimeContext {
  conversation: {
    conversationId?: string;
    requestId: string;
    activeHistory: SteelOAuthChatMessage[];
    currentUserTurn?: SteelOAuthChatMessage;
    edit?: {
      editMessageId: string;
      supersededAfterTurnIndex: number;
    };
  };
  rules: {
    agentRules: SteelAgentRule[];
    steelGlobalRules: {
      instructionPackets: SteelInstructionPacket[];
      quoteDefaults: SteelQuoteDefault[];
      quoteRules: SteelQuoteRule[];
      groupedBy: SteelGlobalRuleGroups;
    };
    otherGlobalRules: SteelRuntimeOtherGlobalRules;
  };
  outputSheets: {
    activeOnly: true;
    memoryName: 'Output Sheet Memory';
    contextName: 'Runtime Output Sheet Context';
    conversationId?: string;
    sheetIds: typeof steelRuntimeActiveOutputSheetIds;
    previousOutputSheets: FullActiveSteelOutputSheets;
    derivedIndex: SteelRuntimeDerivedIndex;
  };
  attachments: {
    currentTurnFiles: SteelOAuthChatFile[];
    priorActiveFileEvidence: SteelRuntimeJsonObject[];
    includeOcrRules: boolean;
  };
  toolPolicy: {
    aiVisibleTools: typeof steelRuntimeAiVisibleTools;
    removedTools: typeof steelRuntimeRemovedTools;
  };
}

export interface SteelRuntimeContextConversationInput {
  conversationId?: string;
  requestId: string;
  activeHistory: SteelOAuthChatMessage[];
  currentUserTurn?: SteelOAuthChatMessage;
  edit?: {
    editMessageId: string;
    supersededAfterTurnIndex: number;
  };
}

export interface SteelRuntimeContextAttachmentsInput {
  currentTurnFiles?: SteelOAuthChatFile[];
  priorActiveFileEvidence?: SteelRuntimeJsonObject[];
}

export interface ListSteelOtherGlobalRulesInput {
  includeOcrRules: boolean;
}

export interface SteelRuntimeContextDependencies {
  listAgentRules(): Promise<SteelAgentRule[]>;
  listReviewedInstructionPackets(): Promise<SteelInstructionPacket[]>;
  listReviewedQuoteDefaults(): Promise<SteelQuoteDefault[]>;
  listReviewedQuoteRules(): Promise<SteelQuoteRule[]>;
  listOtherGlobalRules(
    input: ListSteelOtherGlobalRulesInput,
  ): Promise<SteelRuntimeOtherGlobalRules>;
  readOutputSheetMemory(conversationId?: string): Promise<SteelOutputSheetMemorySnapshot>;
}

export interface PrepareSteelRuntimeContextInput {
  conversation: SteelRuntimeContextConversationInput;
  attachments?: SteelRuntimeContextAttachmentsInput;
  dependencies: SteelRuntimeContextDependencies;
}

export interface ResolveNextSteelOutputSheetsInput {
  previousOutputSheets: FullActiveSteelOutputSheets;
  generatedSheets: readonly GeneratedSteelOutputSheet[];
}

interface SerializableSteelOAuthChatFile {
  filename?: string;
  mediaType: string;
  pageCount?: number;
}

interface SerializableSteelOAuthChatMessage {
  role: SteelOAuthChatMessage['role'];
  content: string;
  messageId?: string;
  files?: SerializableSteelOAuthChatFile[];
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function hasOcrRelevantMediaType(file: SteelOAuthChatFile): boolean {
  const mediaType = file.mediaType.trim().toLowerCase();

  return mediaType.startsWith('image/') || mediaType === 'application/pdf';
}

function shouldIncludeOcrRules({
  currentTurnFiles,
  priorActiveFileEvidence,
}: {
  currentTurnFiles: readonly SteelOAuthChatFile[];
  priorActiveFileEvidence: readonly SteelRuntimeJsonObject[];
}): boolean {
  return currentTurnFiles.some(hasOcrRelevantMediaType) || priorActiveFileEvidence.length > 0;
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

function pickActiveOutputSheets(
  snapshot: SteelOutputSheetMemorySnapshot,
): FullActiveSteelOutputSheets {
  return {
    system_order: snapshot.previousOutputSheets.system_order,
    customer_data: snapshot.previousOutputSheets.customer_data,
    manual_review: snapshot.previousOutputSheets.manual_review,
    customer_quote: snapshot.previousOutputSheets.customer_quote,
  };
}

function createEmptyRuntimeOutputSheet(
  sheetId: SteelRuntimeActiveOutputSheetId,
): SteelRuntimeOutputSheet {
  return {
    sheetId,
    rows: [],
  };
}

export function createEmptySteelOutputSheetMemorySnapshot(): SteelOutputSheetMemorySnapshot {
  return {
    previousOutputSheets: {
      system_order: createEmptyRuntimeOutputSheet('system_order'),
      customer_data: createEmptyRuntimeOutputSheet('customer_data'),
      manual_review: createEmptyRuntimeOutputSheet('manual_review'),
      customer_quote: createEmptyRuntimeOutputSheet('customer_quote'),
    },
    derivedIndex: {
      lineItems: [],
      customers: [],
      adoptedPrices: [],
      calculations: [],
      ocrExtracts: [],
      unresolvedItems: [],
    },
  };
}

function cloneOutputSheet(sheet: SteelRuntimeOutputSheet): SteelRuntimeOutputSheet {
  return {
    sheetId: sheet.sheetId,
    rows: sheet.rows.map((row) => ({
      rowId: row.rowId,
      cells: { ...row.cells },
    })),
  };
}

export function resolveNextSteelOutputSheets({
  previousOutputSheets,
  generatedSheets,
}: ResolveNextSteelOutputSheetsInput): FullActiveSteelOutputSheets {
  const generatedBySheetId = new Map<SteelRuntimeActiveOutputSheetId, GeneratedSteelOutputSheet>(
    generatedSheets.map((sheet) => [sheet.sheetId, sheet]),
  );
  const getNextSheet = (sheetId: SteelRuntimeActiveOutputSheetId) =>
    cloneOutputSheet(generatedBySheetId.get(sheetId) ?? previousOutputSheets[sheetId]);

  return {
    system_order: getNextSheet('system_order'),
    customer_data: getNextSheet('customer_data'),
    manual_review: getNextSheet('manual_review'),
    customer_quote: getNextSheet('customer_quote'),
  };
}

function toSerializableFile(file: SteelOAuthChatFile): SerializableSteelOAuthChatFile {
  return {
    filename: file.filename,
    mediaType: file.mediaType,
    pageCount: file.pageCount,
  };
}

function toSerializableMessage(message: SteelOAuthChatMessage): SerializableSteelOAuthChatMessage {
  return {
    role: message.role,
    content: message.content,
    messageId: message.messageId,
    files: message.files?.map(toSerializableFile),
  };
}

export async function prepareSteelRuntimeContext({
  conversation,
  attachments,
  dependencies,
}: PrepareSteelRuntimeContextInput): Promise<SteelRuntimeContext> {
  const currentTurnFiles = attachments?.currentTurnFiles ?? [];
  const priorActiveFileEvidence = attachments?.priorActiveFileEvidence ?? [];
  const includeOcrRules = shouldIncludeOcrRules({
    currentTurnFiles,
    priorActiveFileEvidence,
  });
  const [
    agentRules,
    instructionPackets,
    quoteDefaults,
    quoteRules,
    otherGlobalRules,
    outputSheetMemory,
  ] = await Promise.all([
    dependencies.listAgentRules(),
    dependencies.listReviewedInstructionPackets(),
    dependencies.listReviewedQuoteDefaults(),
    dependencies.listReviewedQuoteRules(),
    dependencies.listOtherGlobalRules({ includeOcrRules }),
    dependencies.readOutputSheetMemory(conversation.conversationId),
  ]);

  return {
    conversation,
    rules: {
      agentRules,
      steelGlobalRules: {
        instructionPackets,
        quoteDefaults,
        quoteRules,
        groupedBy: buildGlobalRuleGroups({
          instructionPackets,
          quoteDefaults,
          quoteRules,
        }),
      },
      otherGlobalRules,
    },
    outputSheets: {
      activeOnly: true,
      memoryName: 'Output Sheet Memory',
      contextName: 'Runtime Output Sheet Context',
      conversationId: conversation.conversationId,
      sheetIds: steelRuntimeActiveOutputSheetIds,
      previousOutputSheets: pickActiveOutputSheets(outputSheetMemory),
      derivedIndex: outputSheetMemory.derivedIndex,
    },
    attachments: {
      currentTurnFiles,
      priorActiveFileEvidence,
      includeOcrRules,
    },
    toolPolicy: {
      aiVisibleTools: steelRuntimeAiVisibleTools,
      removedTools: steelRuntimeRemovedTools,
    },
  };
}

export function serializeSteelRuntimeContext(context: SteelRuntimeContext): string {
  return JSON.stringify(
    {
      conversation: {
        ...context.conversation,
        activeHistory: context.conversation.activeHistory.map(toSerializableMessage),
        currentUserTurn:
          context.conversation.currentUserTurn !== undefined
            ? toSerializableMessage(context.conversation.currentUserTurn)
            : undefined,
      },
      rules: context.rules,
      outputSheets: context.outputSheets,
      attachments: {
        ...context.attachments,
        currentTurnFiles: context.attachments.currentTurnFiles.map(toSerializableFile),
      },
      toolPolicy: context.toolPolicy,
    },
    null,
    2,
  );
}
