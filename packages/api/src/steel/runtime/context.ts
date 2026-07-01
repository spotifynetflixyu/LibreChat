import { steelReadMarkdownUsagePolicy } from '../tools/registry';

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
  'read_markdown',
] as const satisfies readonly SteelBusinessToolName[];

export const steelRuntimeRemovedTools = [] as const satisfies readonly SteelBusinessToolName[];

export type SteelRuntimeActiveOutputSheetId = (typeof steelRuntimeActiveOutputSheetIds)[number];
export type SteelRuntimeContextMode = 'compact_workbook';
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

export interface SteelRuntimeCompactWorkbookRow {
  rowId: string;
  rowIndex: number;
  anchors: SteelRuntimeJsonObject;
}

export interface SteelRuntimeCompactWorkbookSheet {
  sheetId: SteelRuntimeActiveOutputSheetId;
  rowCount: number;
  rows: SteelRuntimeCompactWorkbookRow[];
}

export interface SteelRuntimeCompactWorkbookContext {
  sheets: Record<SteelRuntimeActiveOutputSheetId, SteelRuntimeCompactWorkbookSheet>;
  unresolvedCount: number;
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
    outputRules: SteelAgentRule[];
    otherGlobalRules: SteelRuntimeOtherGlobalRules;
  };
  outputSheets: {
    activeOnly: true;
    contextMode: SteelRuntimeContextMode;
    memoryName: 'Output Sheet Memory';
    contextName: 'Runtime Output Sheet Context';
    conversationId?: string;
    sheetIds: typeof steelRuntimeActiveOutputSheetIds;
    previousOutputSheets: FullActiveSteelOutputSheets;
    derivedIndex: SteelRuntimeDerivedIndex;
    compactWorkbook: SteelRuntimeCompactWorkbookContext;
  };
  attachments: {
    currentTurnFiles: SteelOAuthChatFile[];
    currentPaddleOcrResults: SteelRuntimeJsonObject[];
    priorActiveFileEvidence: SteelRuntimeJsonObject[];
  };
  toolPolicy: {
    aiVisibleTools: readonly SteelRuntimeAiVisibleToolName[];
    removedTools: typeof steelRuntimeRemovedTools;
    ocrCorrectionPolicy: string;
    currentPaddleOcrUsagePolicy: string;
    readMarkdownUsagePolicy: typeof steelReadMarkdownUsagePolicy;
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
  currentPaddleOcrResults?: SteelRuntimeJsonObject[];
  priorActiveFileEvidence?: SteelRuntimeJsonObject[];
}

export interface SteelRuntimeContextDependencies {
  listAgentRules(): Promise<SteelAgentRule[]>;
  listReviewedInstructionPackets(): Promise<SteelInstructionPacket[]>;
  listReviewedQuoteDefaults(): Promise<SteelQuoteDefault[]>;
  listReviewedQuoteRules(): Promise<SteelQuoteRule[]>;
  listOutputRules(): Promise<SteelAgentRule[]>;
  listOtherGlobalRules(): Promise<SteelRuntimeOtherGlobalRules>;
  readOutputSheetMemory(conversationId?: string): Promise<SteelOutputSheetMemorySnapshot>;
}

const currentPaddleOcrUsagePolicy =
  'attachments.currentPaddleOcrResults is authoritative same-turn PaddleOCR evidence for the matching current file keys and filenames. If it contains the current file, use that result directly; do not call read_markdown for that file and do not call paddleocr_vl again unless the user explicitly asks to rerun OCR or the result is absent/failed.';

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
  contentSource: 'provider_messages';
  messageId?: string;
  files?: SerializableSteelOAuthChatFile[];
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function collectPriorActiveFileEvidence({
  explicitEvidence,
  outputSheetMemory,
}: {
  explicitEvidence: readonly SteelRuntimeJsonObject[];
  outputSheetMemory: SteelOutputSheetMemorySnapshot;
}): SteelRuntimeJsonObject[] {
  return [...explicitEvidence, ...outputSheetMemory.derivedIndex.ocrExtracts];
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

const compactWorkbookAnchorKeys = new Set([
  '項次',
  'rowNo',
  '件號',
  'partNo',
  '型號',
  'erpItemCode',
  '品名規格',
  'productName',
  '數量',
  'quantity',
  '單價',
  'unitPrice',
  '小計',
  'subtotal',
  '客戶名稱',
  'displayName',
  '客戶等級',
  'customerTier',
  '計價基準',
  'reviewStatus',
  'reason',
  'unresolvedReason',
  '項目',
]);

function isCompactAnchorValue(value: SteelJsonValue | undefined): value is SteelJsonValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function toCompactWorkbookRow(
  row: SteelRuntimeOutputSheetRow,
  rowIndex: number,
): SteelRuntimeCompactWorkbookRow {
  const anchors = Object.entries(row.cells).reduce<SteelRuntimeJsonObject>(
    (result, [key, value]) => {
      if (compactWorkbookAnchorKeys.has(key) && isCompactAnchorValue(value)) {
        result[key] = value;
      }

      return result;
    },
    {},
  );

  return {
    rowId: row.rowId,
    rowIndex,
    anchors,
  };
}

function toCompactWorkbookSheet(
  sheet: SteelRuntimeOutputSheet,
): SteelRuntimeCompactWorkbookSheet {
  return {
    sheetId: sheet.sheetId,
    rowCount: sheet.rows.length,
    rows: sheet.rows.map((row, index) => toCompactWorkbookRow(row, index + 1)),
  };
}

function buildCompactWorkbookContext(
  outputSheets: FullActiveSteelOutputSheets,
  derivedIndex: SteelRuntimeDerivedIndex,
): SteelRuntimeCompactWorkbookContext {
  return {
    sheets: {
      system_order: toCompactWorkbookSheet(outputSheets.system_order),
      customer_data: toCompactWorkbookSheet(outputSheets.customer_data),
      manual_review: toCompactWorkbookSheet(outputSheets.manual_review),
      customer_quote: toCompactWorkbookSheet(outputSheets.customer_quote),
    },
    unresolvedCount: derivedIndex.unresolvedItems.length,
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
    contentSource: 'provider_messages',
    messageId: message.messageId,
    files: message.files?.map(toSerializableFile),
  };
}

function isSameRuntimeMessage(
  left: SteelOAuthChatMessage,
  right: SteelOAuthChatMessage | undefined,
): boolean {
  if (!right) {
    return false;
  }
  if (left.messageId && right.messageId) {
    return left.messageId === right.messageId;
  }
  return left.role === right.role && left.content === right.content;
}

function toLibreChatRuntimeMessageReference(
  message: SteelOAuthChatMessage,
): SteelOAuthChatMessage {
  return {
    role: message.role,
    content: '',
    messageId: message.messageId,
    files: message.files?.map((file) => ({ ...file })),
  };
}

function prepareLibreChatRuntimeConversation(
  conversation: SteelRuntimeContextConversationInput,
): SteelRuntimeContextConversationInput {
  const currentUserTurn =
    conversation.currentUserTurn !== undefined
      ? toLibreChatRuntimeMessageReference(conversation.currentUserTurn)
      : undefined;

  return {
    conversationId: conversation.conversationId,
    requestId: conversation.requestId,
    activeHistory: conversation.activeHistory
      .filter((message) => !isSameRuntimeMessage(message, conversation.currentUserTurn))
      .map(toLibreChatRuntimeMessageReference),
    currentUserTurn,
    edit: conversation.edit,
  };
}

export async function prepareSteelRuntimeContext({
  conversation,
  attachments,
  dependencies,
}: PrepareSteelRuntimeContextInput): Promise<SteelRuntimeContext> {
  const currentTurnFiles = attachments?.currentTurnFiles ?? [];
  const currentPaddleOcrResults = attachments?.currentPaddleOcrResults ?? [];
  const [
    outputSheetMemory,
    agentRules,
    instructionPackets,
    quoteDefaults,
    quoteRules,
    outputRules,
    otherGlobalRules,
  ] = await Promise.all([
    dependencies.readOutputSheetMemory(conversation.conversationId),
    dependencies.listAgentRules(),
    dependencies.listReviewedInstructionPackets(),
    dependencies.listReviewedQuoteDefaults(),
    dependencies.listReviewedQuoteRules(),
    dependencies.listOutputRules(),
    dependencies.listOtherGlobalRules(),
  ]);
  const activeOutputSheets = pickActiveOutputSheets(outputSheetMemory);
  const priorActiveFileEvidence = collectPriorActiveFileEvidence({
    explicitEvidence: attachments?.priorActiveFileEvidence ?? [],
    outputSheetMemory,
  });

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
      outputRules,
      otherGlobalRules,
    },
    outputSheets: {
      activeOnly: true,
      contextMode: 'compact_workbook',
      memoryName: 'Output Sheet Memory',
      contextName: 'Runtime Output Sheet Context',
      conversationId: conversation.conversationId,
      sheetIds: steelRuntimeActiveOutputSheetIds,
      previousOutputSheets: activeOutputSheets,
      derivedIndex: outputSheetMemory.derivedIndex,
      compactWorkbook: buildCompactWorkbookContext(
        activeOutputSheets,
        outputSheetMemory.derivedIndex,
      ),
    },
    attachments: {
      currentTurnFiles,
      currentPaddleOcrResults,
      priorActiveFileEvidence,
    },
    toolPolicy: {
      aiVisibleTools: steelRuntimeAiVisibleTools,
      removedTools: steelRuntimeRemovedTools,
      ocrCorrectionPolicy:
        'If the user confirms or corrects prior OCR/table content, update and return the complete latest OCR/quote Markdown from chat history and user corrections. Do not rerun OCR unless the user explicitly requests rerun OCR or supplies new/changed file evidence.',
      currentPaddleOcrUsagePolicy,
      readMarkdownUsagePolicy: steelReadMarkdownUsagePolicy,
    },
  };
}

export async function prepareLibreChatSteelRuntimeContext({
  conversation,
  attachments,
  dependencies,
}: PrepareSteelRuntimeContextInput): Promise<SteelRuntimeContext> {
  const runtimeConversation = prepareLibreChatRuntimeConversation(conversation);
  const currentTurnFiles = attachments?.currentTurnFiles ?? [];
  const currentPaddleOcrResults = attachments?.currentPaddleOcrResults ?? [];
  const [
    outputSheetMemory,
    agentRules,
    instructionPackets,
    quoteDefaults,
    quoteRules,
    outputRules,
    otherGlobalRules,
  ] = await Promise.all([
    dependencies.readOutputSheetMemory(runtimeConversation.conversationId),
    dependencies.listAgentRules(),
    dependencies.listReviewedInstructionPackets(),
    dependencies.listReviewedQuoteDefaults(),
    dependencies.listReviewedQuoteRules(),
    dependencies.listOutputRules(),
    dependencies.listOtherGlobalRules(),
  ]);
  const activeOutputSheets = pickActiveOutputSheets(outputSheetMemory);
  const supplementalOutputSheetMemory = createEmptySteelOutputSheetMemorySnapshot();
  const priorActiveFileEvidence = collectPriorActiveFileEvidence({
    explicitEvidence: attachments?.priorActiveFileEvidence ?? [],
    outputSheetMemory,
  });

  return {
    conversation: runtimeConversation,
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
      outputRules,
      otherGlobalRules,
    },
    outputSheets: {
      activeOnly: true,
      contextMode: 'compact_workbook',
      memoryName: 'Output Sheet Memory',
      contextName: 'Runtime Output Sheet Context',
      conversationId: runtimeConversation.conversationId,
      sheetIds: steelRuntimeActiveOutputSheetIds,
      previousOutputSheets: supplementalOutputSheetMemory.previousOutputSheets,
      derivedIndex: supplementalOutputSheetMemory.derivedIndex,
      compactWorkbook: buildCompactWorkbookContext(
        activeOutputSheets,
        outputSheetMemory.derivedIndex,
      ),
    },
    attachments: {
      currentTurnFiles,
      currentPaddleOcrResults,
      priorActiveFileEvidence,
    },
    toolPolicy: {
      aiVisibleTools: steelRuntimeAiVisibleTools,
      removedTools: steelRuntimeRemovedTools,
      ocrCorrectionPolicy:
        'If the user confirms or corrects prior OCR/table content, update and return the complete latest OCR/quote Markdown from chat history and user corrections. Do not rerun OCR unless the user explicitly requests rerun OCR or supplies new/changed file evidence.',
      currentPaddleOcrUsagePolicy,
      readMarkdownUsagePolicy: steelReadMarkdownUsagePolicy,
    },
  };
}

function summarizePreviousOutputSheets(outputSheets: FullActiveSteelOutputSheets) {
  return {
    system_order: {
      sheetId: 'system_order',
      rowCount: outputSheets.system_order.rows.length,
    },
    customer_data: {
      sheetId: 'customer_data',
      rowCount: outputSheets.customer_data.rows.length,
    },
    manual_review: {
      sheetId: 'manual_review',
      rowCount: outputSheets.manual_review.rows.length,
    },
    customer_quote: {
      sheetId: 'customer_quote',
      rowCount: outputSheets.customer_quote.rows.length,
    },
  };
}

function serializeOutputSheets(outputSheets: SteelRuntimeContext['outputSheets']) {
  return {
    activeOnly: outputSheets.activeOnly,
    contextMode: outputSheets.contextMode,
    memoryName: outputSheets.memoryName,
    contextName: outputSheets.contextName,
    conversationId: outputSheets.conversationId,
    sheetIds: outputSheets.sheetIds,
    previousOutputSheets: summarizePreviousOutputSheets(outputSheets.previousOutputSheets),
    compactWorkbook: outputSheets.compactWorkbook,
  };
}

function serializeSteelGlobalRules(rules: SteelRuntimeContext['rules']['steelGlobalRules']) {
  return {
    ...(rules.instructionPackets.length > 0
      ? { instructionPackets: rules.instructionPackets }
      : {}),
    quoteDefaults: rules.quoteDefaults,
    quoteRules: rules.quoteRules,
    groupedBy: rules.groupedBy,
  };
}

function serializeRules(rules: SteelRuntimeContext['rules']) {
  return {
    agentRules: rules.agentRules,
    steelGlobalRules: serializeSteelGlobalRules(rules.steelGlobalRules),
    outputRules: rules.outputRules,
    otherGlobalRules: rules.otherGlobalRules,
  };
}

export function serializeSteelRuntimeContext(context: SteelRuntimeContext): string {
  return JSON.stringify(
    {
      rules: serializeRules(context.rules),
      toolPolicy: context.toolPolicy,
      outputSheets: serializeOutputSheets(context.outputSheets),
      conversation: {
        ...context.conversation,
        activeHistory: context.conversation.activeHistory.map(toSerializableMessage),
        currentUserTurn:
          context.conversation.currentUserTurn !== undefined
            ? toSerializableMessage(context.conversation.currentUserTurn)
            : undefined,
      },
      attachments: {
        ...context.attachments,
        currentTurnFiles: context.attachments.currentTurnFiles.map(toSerializableFile),
      },
    },
    null,
    2,
  );
}
