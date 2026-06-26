import mongoose from 'mongoose';
import {
  createEmptySteelOutputSheetMemorySnapshot,
  prepareLibreChatSteelRuntimeContext,
  serializeSteelRuntimeContext,
} from '../runtime/context';
import { createSteelPostgresPool } from '../postgres';
import { createMongooseSteelOutputSheetMemoryReader } from '../memory/service';
import {
  listReviewedSteelAgentRules,
  listReviewedSteelOtherRules,
  listReviewedSteelOutputRules,
  listReviewedSteelQuoteDefaults,
  listReviewedSteelQuoteRules,
} from '../repositories';

import type { SteelOAuthChatMessage, SteelOAuthChatMessageRole } from '../ai/provider';
import type { SteelQuoteDefault } from '../repositories/defaults';
import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';
import type { SteelOutputSheetMemoryReader } from '../memory/service';
import type { SteelRepositoryClient } from '../repositories';
import type {
  ListSteelOtherGlobalRulesInput,
  PrepareSteelRuntimeContextInput,
  SteelRuntimeContext,
  SteelRuntimeContextDependencies,
  SteelRuntimeContextMode,
  SteelRuntimeJsonObject,
} from '../runtime/context';

export const steelNativeContextVersion = 1 as const;
export const steelNativeDefaultRuntimeContextMode = 'compact_workbook' as const;

export const steelNativeInstructionPrefixSections = [
  'agent',
  'quote_rules',
  'output',
  'other',
] as const;

export type SteelNativeInstructionPrefixSection =
  (typeof steelNativeInstructionPrefixSections)[number];

export type SteelNativeRenderProfile =
  | 'agent_client'
  | 'agents_chat_completions'
  | 'open_responses';

export type SteelNativeAttachmentSource =
  | 'librechat_file_record'
  | 'provider_file_reference'
  | 'tool_evidence_reference';

export interface SteelNativeFileReference {
  fileId: string;
  source: SteelNativeAttachmentSource;
  mediaType: string;
  conversationId?: string;
  messageId?: string;
  filename?: string;
  pageCount?: number;
  providerFileId?: string;
  width?: number;
  height?: number;
}

export interface SteelNativeMessage {
  role: SteelOAuthChatMessageRole;
  content: string;
  messageId?: string;
  files?: readonly SteelNativeFileReference[];
}

export interface SteelNativeConversationInput {
  requestId: string;
  conversationId?: string;
  activeHistory: readonly SteelNativeMessage[];
  currentUserTurn?: SteelNativeMessage;
  edit?: {
    editMessageId: string;
    supersededAfterTurnIndex: number;
  };
}

export interface SteelNativeContextAttachmentsInput {
  currentTurnFiles?: readonly SteelNativeFileReference[];
  priorActiveFileEvidence?: readonly SteelRuntimeJsonObject[];
}

export interface SteelNativeContextMetadata {
  nativeContextVersion: typeof steelNativeContextVersion;
  contextMode: SteelRuntimeContextMode;
  renderProfile: SteelNativeRenderProfile;
  globalApplied: true;
  attachmentBytePolicy: 'metadata_references_only';
  ocrExecutionPolicy: 'agent_calls_run_file_ocr';
  rulePrefixOrder: typeof steelNativeInstructionPrefixSections;
}

export interface SteelNativeInstructionPrefixSlot {
  section: SteelNativeInstructionPrefixSection;
  itemCount: number;
  text?: string;
}

export interface BuildSteelNativeInstructionPrefixInput {
  runtimeContext: SteelRuntimeContext;
}

export interface BuildSteelNativeRuntimeContextTextInput {
  runtimeContext: SteelRuntimeContext;
  metadata: SteelNativeContextMetadata;
  attachmentReferences: readonly SteelNativeFileReference[];
}

export interface BuildSteelGlobalAgentContextInput {
  conversation: SteelNativeConversationInput;
  dependencies: SteelRuntimeContextDependencies;
  attachments?: SteelNativeContextAttachmentsInput;
  renderProfile?: SteelNativeRenderProfile;
  prepareRuntimeContext?: (
    input: PrepareSteelRuntimeContextInput,
  ) => Promise<SteelRuntimeContext>;
}

export interface BuildDefaultSteelGlobalAgentContextInput
  extends Omit<BuildSteelGlobalAgentContextInput, 'dependencies'> {
  dependencies?: SteelRuntimeContextDependencies;
  runtimeRulesClient?: SteelRepositoryClient;
  createOutputSheetMemoryReader?: (conversationId: string) => SteelOutputSheetMemoryReader;
}

export interface SteelNativeContextSlots {
  instructionPrefix: 'top_of_context';
  runtimeContext: 'dynamic_system_tail';
}

export interface SteelNativeGlobalAgentContext {
  instructionPrefix: string;
  runtimeContextText: string;
  runtimeContext: SteelRuntimeContext;
  metadata: SteelNativeContextMetadata;
  contextSlots: SteelNativeContextSlots;
  attachmentReferences: readonly SteelNativeFileReference[];
  instructionPrefixSections: readonly SteelNativeInstructionPrefixSlot[];
}

type SteelNativeJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly SteelNativeJsonValue[]
  | { readonly [key: string]: SteelNativeJsonValue | undefined };

function compactText(values: readonly (string | undefined)[]): string[] {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
}

function renderJson(value: SteelNativeJsonValue): string {
  return JSON.stringify(value, null, 2);
}

function renderAgentRule(rule: SteelAgentRule): string {
  return compactText([
    `## ${rule.slug}`,
    rule.title,
    `ruleType: ${rule.ruleType}`,
    `ruleSections: ${rule.ruleSections.join(', ')}`,
    rule.prompt,
    rule.toolPolicy === null ? undefined : `toolPolicy: ${JSON.stringify(rule.toolPolicy)}`,
    rule.outputPolicy === null ? undefined : `outputPolicy: ${JSON.stringify(rule.outputPolicy)}`,
  ]).join('\n');
}

function renderQuoteDefault(quoteDefault: SteelQuoteDefault): string {
  return compactText([
    `## quote_default:${quoteDefault.id}`,
    `defaultType: ${quoteDefault.defaultType}`,
    `scopeType: ${quoteDefault.scopeType}`,
    quoteDefault.effect,
    `selector: ${JSON.stringify(quoteDefault.selector)}`,
    `defaultParameters: ${JSON.stringify(quoteDefault.defaultParameters)}`,
  ]).join('\n');
}

function renderQuoteRule(quoteRule: SteelQuoteRule): string {
  return compactText([
    `## quote_rule:${quoteRule.id}`,
    `ruleType: ${quoteRule.ruleType}`,
    `scopeType: ${quoteRule.scopeType}`,
    quoteRule.catalogFamily ? `catalogFamily: ${quoteRule.catalogFamily}` : undefined,
    quoteRule.productFamily ? `productFamily: ${quoteRule.productFamily}` : undefined,
    quoteRule.chargeType ? `chargeType: ${quoteRule.chargeType}` : undefined,
    quoteRule.formulaCode ? `formulaCode: ${quoteRule.formulaCode}` : undefined,
    quoteRule.prompt,
    `selectors: ${JSON.stringify(quoteRule.selectors)}`,
    `parameters: ${JSON.stringify(quoteRule.parameters)}`,
  ]).join('\n');
}

function buildSlot(
  section: SteelNativeInstructionPrefixSection,
  title: string,
  items: readonly string[],
): SteelNativeInstructionPrefixSlot {
  const renderedItems = compactText(items);

  return {
    section,
    itemCount: renderedItems.length,
    text: renderedItems.length > 0 ? [`# ${title}`, ...renderedItems].join('\n\n') : undefined,
  };
}

function buildOtherRuleItems(runtimeContext: SteelRuntimeContext): string[] {
  const otherGlobalRules = runtimeContext.rules.otherGlobalRules;

  return [
    ...(otherGlobalRules.ocrRules ?? []).map(renderAgentRule),
    ...otherGlobalRules.fileRules.map(renderAgentRule),
    ...otherGlobalRules.sourcePriorityRules.map(renderAgentRule),
    ...otherGlobalRules.markdownOutputRules.map(renderAgentRule),
  ];
}

export function buildSteelNativeInstructionPrefix({
  runtimeContext,
}: BuildSteelNativeInstructionPrefixInput): {
  instructionPrefix: string;
  sections: SteelNativeInstructionPrefixSlot[];
} {
  const sections = [
    buildSlot(
      'agent',
      'Steel Agent Rules',
      runtimeContext.rules.agentRules.map(renderAgentRule),
    ),
    buildSlot('quote_rules', 'Steel Quote Rules', [
      ...runtimeContext.rules.steelGlobalRules.quoteDefaults.map(renderQuoteDefault),
      ...runtimeContext.rules.steelGlobalRules.quoteRules.map(renderQuoteRule),
    ]),
    buildSlot(
      'output',
      'Steel Output Rules',
      runtimeContext.rules.outputRules.map(renderAgentRule),
    ),
    buildSlot('other', 'Steel Other Rules', buildOtherRuleItems(runtimeContext)),
  ];

  return {
    instructionPrefix: compactText(sections.map((section) => section.text)).join('\n\n'),
    sections,
  };
}

function hasRuleSection(rule: SteelAgentRule, matches: readonly string[]): boolean {
  return rule.ruleSections.some((section) => matches.some((match) => section.includes(match)));
}

function isOcrRule(rule: SteelAgentRule): boolean {
  return hasRuleSection(rule, ['file_ocr', 'drawing_ocr', 'vision_evidence']);
}

function filterOtherGlobalRules(
  rules: readonly SteelAgentRule[],
  { includeOcrRules }: ListSteelOtherGlobalRulesInput,
) {
  const ocrRules = rules.filter(isOcrRule);

  return {
    ocrRules: includeOcrRules ? ocrRules : undefined,
    fileRules: rules.filter((rule) => hasRuleSection(rule, ['file']) && !isOcrRule(rule)),
    sourcePriorityRules: rules.filter((rule) => hasRuleSection(rule, ['source_priority'])),
    markdownOutputRules: rules.filter((rule) => hasRuleSection(rule, ['markdown_output'])),
  };
}

let defaultSteelNativeRulesClient: ReturnType<typeof createSteelPostgresPool> | undefined;

function getDefaultSteelNativeRulesClient() {
  defaultSteelNativeRulesClient ??= createSteelPostgresPool();
  return defaultSteelNativeRulesClient;
}

function createDefaultOutputSheetMemoryReader(conversationId: string) {
  return createMongooseSteelOutputSheetMemoryReader(mongoose, conversationId);
}

function resolveSteelNativeContextList<T>(load: () => Promise<T[]>): Promise<T[]> {
  // Global Steel context is fail-open so unavailable Steel rule tables do not block ordinary chat.
  return load().catch(() => []);
}

export function createSteelContextDependencies({
  conversationId,
  createOutputSheetMemoryReader = createDefaultOutputSheetMemoryReader,
  runtimeRulesClient,
}: {
  conversationId?: string;
  createOutputSheetMemoryReader?: (conversationId: string) => SteelOutputSheetMemoryReader;
  runtimeRulesClient?: SteelRepositoryClient;
} = {}): SteelRuntimeContextDependencies {
  let agentRulesPromise: Promise<SteelAgentRule[]> | undefined;
  let otherRulesPromise: Promise<SteelAgentRule[]> | undefined;
  let outputRulesPromise: Promise<SteelAgentRule[]> | undefined;
  let quoteDefaultsPromise: Promise<SteelQuoteDefault[]> | undefined;
  let quoteRulesPromise: Promise<SteelQuoteRule[]> | undefined;
  const getClient = () => runtimeRulesClient ?? getDefaultSteelNativeRulesClient();

  return {
    listAgentRules() {
      agentRulesPromise ??= resolveSteelNativeContextList(() =>
        listReviewedSteelAgentRules(getClient()),
      );
      return agentRulesPromise;
    },
    listReviewedInstructionPackets() {
      return Promise.resolve([]);
    },
    listReviewedQuoteDefaults() {
      quoteDefaultsPromise ??= resolveSteelNativeContextList(() =>
        listReviewedSteelQuoteDefaults(getClient()),
      );
      return quoteDefaultsPromise;
    },
    listReviewedQuoteRules() {
      quoteRulesPromise ??= resolveSteelNativeContextList(() =>
        listReviewedSteelQuoteRules(getClient()),
      );
      return quoteRulesPromise;
    },
    listOutputRules() {
      outputRulesPromise ??= resolveSteelNativeContextList(() =>
        listReviewedSteelOutputRules(getClient()),
      );
      return outputRulesPromise;
    },
    async listOtherGlobalRules(input) {
      otherRulesPromise ??= resolveSteelNativeContextList(() =>
        listReviewedSteelOtherRules(getClient()),
      );
      return filterOtherGlobalRules(await otherRulesPromise, input);
    },
    async readOutputSheetMemory() {
      if (!conversationId) {
        return createEmptySteelOutputSheetMemorySnapshot();
      }

      return createOutputSheetMemoryReader(conversationId).readOutputSheetMemory();
    },
  };
}

export function createSteelNativeContextMetadata({
  contextMode,
  renderProfile = 'agent_client',
}: {
  contextMode: SteelRuntimeContextMode;
  renderProfile?: SteelNativeRenderProfile;
}): SteelNativeContextMetadata {
  return {
    nativeContextVersion: steelNativeContextVersion,
    contextMode,
    renderProfile,
    globalApplied: true,
    attachmentBytePolicy: 'metadata_references_only',
    ocrExecutionPolicy: 'agent_calls_run_file_ocr',
    rulePrefixOrder: steelNativeInstructionPrefixSections,
  };
}

function toRuntimeMessage(message: SteelNativeMessage): SteelOAuthChatMessage {
  return {
    role: message.role,
    content: message.content,
    messageId: message.messageId,
  };
}

function isSameNativeMessage(
  left: SteelNativeMessage,
  right: SteelNativeMessage | undefined,
): boolean {
  if (!right) {
    return false;
  }
  if (left.messageId && right.messageId) {
    return left.messageId === right.messageId;
  }
  return left.role === right.role && left.content === right.content;
}

function toLibreChatMessageReference(message: SteelNativeMessage): SteelNativeMessage {
  return {
    role: message.role,
    content: '',
    messageId: message.messageId,
    files: message.files?.map((file) => ({ ...file })),
  };
}

export function prepareLibreChatSteelChatContext(
  conversation: SteelNativeConversationInput,
): SteelNativeConversationInput {
  const currentUserTurn =
    conversation.currentUserTurn !== undefined
      ? toLibreChatMessageReference(conversation.currentUserTurn)
      : undefined;

  return {
    conversationId: conversation.conversationId,
    requestId: conversation.requestId,
    activeHistory: conversation.activeHistory
      .filter((message) => !isSameNativeMessage(message, conversation.currentUserTurn))
      .map(toLibreChatMessageReference),
    currentUserTurn,
    edit: conversation.edit,
  };
}

function toRuntimeConversationInput(
  conversation: SteelNativeConversationInput,
): PrepareSteelRuntimeContextInput['conversation'] {
  return {
    requestId: conversation.requestId,
    conversationId: conversation.conversationId,
    activeHistory: conversation.activeHistory.map(toRuntimeMessage),
    currentUserTurn:
      conversation.currentUserTurn !== undefined
        ? toRuntimeMessage(conversation.currentUserTurn)
        : undefined,
    edit: conversation.edit,
  };
}

function getFileReferenceKey(file: SteelNativeFileReference): string {
  return [file.source, file.fileId, file.messageId ?? '', file.providerFileId ?? ''].join(':');
}

function collectAttachmentReferences({
  conversation,
  attachments,
}: {
  conversation: SteelNativeConversationInput;
  attachments?: SteelNativeContextAttachmentsInput;
}): SteelNativeFileReference[] {
  const filesByKey = new Map<string, SteelNativeFileReference>();
  const addFiles = (files: readonly SteelNativeFileReference[] | undefined) => {
    for (const file of files ?? []) {
      filesByKey.set(getFileReferenceKey(file), file);
    }
  };

  for (const message of conversation.activeHistory) {
    addFiles(message.files);
  }
  addFiles(conversation.currentUserTurn?.files);
  addFiles(attachments?.currentTurnFiles);

  return [...filesByKey.values()];
}

function createNativeRuntimeDependencies(
  dependencies: SteelRuntimeContextDependencies,
): SteelRuntimeContextDependencies {
  return {
    ...dependencies,
    listOtherGlobalRules: () => dependencies.listOtherGlobalRules({ includeOcrRules: true }),
  };
}

function markNativeGlobalAttachments(runtimeContext: SteelRuntimeContext): SteelRuntimeContext {
  return {
    ...runtimeContext,
    attachments: {
      ...runtimeContext.attachments,
      includeOcrRules: true,
    },
  };
}

function toSerializableFileReference(file: SteelNativeFileReference): SteelRuntimeJsonObject {
  return {
    fileId: file.fileId,
    source: file.source,
    mediaType: file.mediaType,
    conversationId: file.conversationId,
    messageId: file.messageId,
    filename: file.filename,
    pageCount: file.pageCount,
    providerFileId: file.providerFileId,
    width: file.width,
    height: file.height,
  };
}

export function buildSteelNativeRuntimeContextText({
  runtimeContext,
  metadata,
  attachmentReferences,
}: BuildSteelNativeRuntimeContextTextInput): string {
  const parts = [
    `# Steel Native Context Metadata\n${JSON.stringify(metadata, null, 2)}`,
    `# Steel Runtime Context\n${serializeSteelRuntimeContext(runtimeContext)}`,
  ];

  if (attachmentReferences.length > 0) {
    parts.push(
      `# Steel Native File References\n${JSON.stringify(
        attachmentReferences.map(toSerializableFileReference),
        null,
        2,
      )}`,
    );
  }

  return parts.join('\n\n');
}

export async function buildSteelGlobalAgentContext({
  conversation,
  dependencies,
  attachments,
  renderProfile = 'agent_client',
  prepareRuntimeContext = prepareLibreChatSteelRuntimeContext,
}: BuildSteelGlobalAgentContextInput): Promise<SteelNativeGlobalAgentContext> {
  const attachmentReferences = collectAttachmentReferences({ conversation, attachments });
  const preparedRuntimeContext = await prepareRuntimeContext({
    conversation: toRuntimeConversationInput(conversation),
    attachments: {
      priorActiveFileEvidence:
        attachments?.priorActiveFileEvidence !== undefined
          ? [...attachments.priorActiveFileEvidence]
          : undefined,
    },
    dependencies: createNativeRuntimeDependencies(dependencies),
  });
  const runtimeContext = markNativeGlobalAttachments(preparedRuntimeContext);
  const metadata = createSteelNativeContextMetadata({
    contextMode: runtimeContext.outputSheets.contextMode,
    renderProfile,
  });
  const { instructionPrefix, sections } = buildSteelNativeInstructionPrefix({
    runtimeContext,
  });

  return {
    instructionPrefix,
    runtimeContextText: buildSteelNativeRuntimeContextText({
      runtimeContext,
      metadata,
      attachmentReferences,
    }),
    runtimeContext,
    metadata,
    contextSlots: {
      instructionPrefix: 'top_of_context',
      runtimeContext: 'dynamic_system_tail',
    },
    attachmentReferences,
    instructionPrefixSections: sections,
  };
}

export async function buildDefaultSteelGlobalAgentContext({
  dependencies,
  runtimeRulesClient,
  createOutputSheetMemoryReader,
  ...input
}: BuildDefaultSteelGlobalAgentContextInput): Promise<SteelNativeGlobalAgentContext> {
  return buildSteelGlobalAgentContext({
    ...input,
    dependencies:
      dependencies ??
      createSteelContextDependencies({
        conversationId: input.conversation.conversationId,
        createOutputSheetMemoryReader,
        runtimeRulesClient,
      }),
  });
}
