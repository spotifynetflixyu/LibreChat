import { groupSteelOcrMissingPagesByFileKey } from '../ocr/failures';
import { prepareLibreChatSteelRuntimeContext } from '../runtime/context';
import { createSteelPostgresPool } from '../postgres';
import {
  listReviewedSteelAgentRules,
  listReviewedSteelOtherRules,
  listReviewedSteelOutputRules,
  listReviewedSteelQuoteDefaults,
  listReviewedSteelQuoteRules,
} from '../repositories';

import type { SteelRuntimeMessageRole } from '../runtime/types';
import type { SteelQuoteDefault } from '../repositories/defaults';
import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';
import type { SteelRepositoryClient } from '../repositories';
import type {
  PrepareSteelRuntimeContextInput,
  SteelRuntimeContext,
  SteelRuntimeContextDependencies,
  SteelRuntimeJsonObject,
} from '../runtime/context';

export const steelNativeContextVersion = 1 as const;

export const steelNativeContextModes = ['standard', 'ocr'] as const;

export type SteelNativeContextMode = (typeof steelNativeContextModes)[number];

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
  role: SteelRuntimeMessageRole;
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
  currentPaddleOcrResults?: readonly SteelRuntimeJsonObject[];
  currentOcrMarkdownResults?: readonly SteelRuntimeJsonObject[];
  currentOcrFailures?: readonly SteelRuntimeJsonObject[];
  priorActiveFileEvidence?: readonly SteelRuntimeJsonObject[];
}

export interface SteelNativeContextMetadata {
  nativeContextVersion: typeof steelNativeContextVersion;
  mode?: SteelNativeContextMode;
  renderProfile: SteelNativeRenderProfile;
  globalApplied: true;
  attachmentBytePolicy: 'metadata_references_only';
  ocrExecutionPolicy: 'preflight_paddleocr_only';
  rulePrefixOrder: typeof steelNativeInstructionPrefixSections;
}

export interface SteelNativeInstructionPrefixSlot {
  section: SteelNativeInstructionPrefixSection;
  itemCount: number;
  text?: string;
}

export interface BuildSteelNativeInstructionPrefixInput {
  runtimeContext: SteelRuntimeContext;
  mode?: SteelNativeContextMode;
}

export interface BuildSteelNativeRuntimeContextTextInput {
  runtimeContext: SteelRuntimeContext;
  mode?: SteelNativeContextMode;
}

export interface BuildSteelGlobalAgentContextInput {
  conversation: SteelNativeConversationInput;
  dependencies: SteelRuntimeContextDependencies;
  attachments?: SteelNativeContextAttachmentsInput;
  renderProfile?: SteelNativeRenderProfile;
  mode?: SteelNativeContextMode;
  prepareRuntimeContext?: (input: PrepareSteelRuntimeContextInput) => Promise<SteelRuntimeContext>;
}

export interface BuildDefaultSteelGlobalAgentContextInput
  extends Omit<BuildSteelGlobalAgentContextInput, 'dependencies'> {
  dependencies?: SteelRuntimeContextDependencies;
  runtimeRulesClient?: SteelRepositoryClient;
}

export interface SteelNativeContextSlots {
  instructionPrefix: 'top_of_context';
  runtimeContext: 'dynamic_system_tail';
}

export interface SteelNativeGlobalAgentContext {
  mode: SteelNativeContextMode;
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
  return compactText([`## ${rule.title}`, rule.prompt]).join('\n');
}

function renderQuoteDefault(quoteDefault: SteelQuoteDefault): string {
  return compactText([
    '## Quote default',
    `defaultType: ${quoteDefault.defaultType}`,
    `scopeType: ${quoteDefault.scopeType}`,
    quoteDefault.effect,
    `selector: ${JSON.stringify(quoteDefault.selector)}`,
    `defaultParameters: ${JSON.stringify(quoteDefault.defaultParameters)}`,
  ]).join('\n');
}

function renderQuoteRule(quoteRule: SteelQuoteRule): string {
  return quoteRule.prompt.trim();
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

function getRulePriority(rule: SteelAgentRule): number {
  return typeof rule.priority === 'number' ? rule.priority : Number.MAX_SAFE_INTEGER;
}

function buildOcrRuleItems(runtimeContext: SteelRuntimeContext): string[] {
  const ocrRules = runtimeContext.rules.otherGlobalRules.ocrMainAgentRules;
  const orderedRules = ocrRules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => {
      const priorityOrder = getRulePriority(left.rule) - getRulePriority(right.rule);
      return priorityOrder !== 0 ? priorityOrder : left.index - right.index;
    });

  return [
    ...orderedRules.map(({ rule }) => renderAgentRule(rule)),
  ];
}

export function buildSteelNativeInstructionPrefix({
  runtimeContext,
  mode = 'standard',
}: BuildSteelNativeInstructionPrefixInput): {
  instructionPrefix: string;
  sections: SteelNativeInstructionPrefixSlot[];
} {
  const sections =
    mode === 'ocr'
      ? [
          buildSlot('agent', 'Steel Agent Rules', []),
          buildSlot('quote_rules', 'Steel Quote Defaults and Category Rules', []),
          buildSlot('output', 'Steel Output Rules', []),
          buildSlot('other', 'Steel OCR Rules', buildOcrRuleItems(runtimeContext)),
        ]
      : [
          buildSlot('agent', 'Steel Agent Rules', runtimeContext.rules.agentRules.map(renderAgentRule)),
          buildSlot('quote_rules', 'Steel Quote Defaults and Category Rules', [
            ...runtimeContext.rules.steelGlobalRules.quoteDefaults.map(renderQuoteDefault),
            ...runtimeContext.rules.steelGlobalRules.quoteRules.map(renderQuoteRule),
          ]),
          buildSlot(
            'output',
            'Steel Output Rules',
            runtimeContext.rules.outputRules.map(renderAgentRule),
          ),
          buildSlot('other', 'Steel Other Rules', []),
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
  return hasRuleSection(rule, [
    'file_ocr',
    'drawing_ocr',
    'vision_evidence',
    'ocr_main_merge',
    'final_ocr_markdown',
  ]);
}

function isOcrOrganizerRule(rule: SteelAgentRule): boolean {
  return hasRuleSection(rule, ['ocr_organizer']);
}

function filterOtherGlobalRules(rules: readonly SteelAgentRule[]) {
  const ocrMainAgentRules = rules.filter(isOcrRule);

  return {
    ocrSubagentRules: rules.filter(isOcrOrganizerRule),
    ocrMainAgentRules,
    fileRules: rules.filter(
      (rule) => hasRuleSection(rule, ['file']) && !isOcrRule(rule) && !isOcrOrganizerRule(rule),
    ),
    sourcePriorityRules: rules.filter((rule) => hasRuleSection(rule, ['source_priority'])),
    markdownOutputRules: rules.filter((rule) => hasRuleSection(rule, ['markdown_output'])),
  };
}

let defaultSteelNativeRulesClient: ReturnType<typeof createSteelPostgresPool> | undefined;

function getDefaultSteelNativeRulesClient() {
  defaultSteelNativeRulesClient ??= createSteelPostgresPool();
  return defaultSteelNativeRulesClient;
}

function resolveSteelNativeContextList<T>(load: () => Promise<T[]>): Promise<T[]> {
  // Global Steel context is fail-open so unavailable Steel rule tables do not block ordinary chat.
  return load().catch(() => []);
}

export function createSteelContextDependencies({
  runtimeRulesClient,
}: {
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
    async listOtherGlobalRules() {
      otherRulesPromise ??= resolveSteelNativeContextList(() =>
        listReviewedSteelOtherRules(getClient()),
      );
      return filterOtherGlobalRules(await otherRulesPromise);
    },
  };
}

export function createSteelNativeContextMetadata({
  mode = 'standard',
  renderProfile = 'agent_client',
}: {
  mode?: SteelNativeContextMode;
  renderProfile?: SteelNativeRenderProfile;
}): SteelNativeContextMetadata {
  return {
    nativeContextVersion: steelNativeContextVersion,
    mode,
    renderProfile,
    globalApplied: true,
    attachmentBytePolicy: 'metadata_references_only',
    ocrExecutionPolicy: 'preflight_paddleocr_only',
    rulePrefixOrder: steelNativeInstructionPrefixSections,
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
  return { requestId: conversation.requestId };
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

export function buildSteelNativeRuntimeContextText({
  runtimeContext,
  mode = 'standard',
}: BuildSteelNativeRuntimeContextTextInput): string {
  if (
    mode !== 'ocr' ||
    (runtimeContext.attachments.currentOcrMarkdownResults.length === 0 &&
      runtimeContext.attachments.currentOcrFailures.length === 0)
  ) {
    return '';
  }

  const missingPagesByFileKey = groupSteelOcrMissingPagesByFileKey(
    runtimeContext.attachments.currentOcrFailures,
  );
  const failuresByFileKey = new Map<
    string,
    { filename: string; stages: Set<string>; errors: Set<string> }
  >();
  for (const failure of runtimeContext.attachments.currentOcrFailures) {
    const key = typeof failure.ocrFileKey === 'string' ? failure.ocrFileKey : 'unknown';
    const current = failuresByFileKey.get(key) ?? {
      filename: typeof failure.filename === 'string' ? failure.filename : 'unknown',
      stages: new Set<string>(),
      errors: new Set<string>(),
    };
    current.stages.add(typeof failure.stage === 'string' ? failure.stage : 'unknown');
    current.errors.add(
      typeof failure.errorMessage === 'string' ? failure.errorMessage : 'PaddleOCR failed',
    );
    failuresByFileKey.set(key, current);
  }
  const failures = [...failuresByFileKey.entries()]
    .map(([key, failure]) => {
      const missingPages = missingPagesByFileKey[key];
      return [
        '## OCR file failed',
        `filename: ${failure.filename}`,
        `file: ${key}`,
        `stage: ${[...failure.stages].join(', ')}`,
        `error: ${[...failure.errors].join('; ')}`,
        `missing_pages: ${missingPages?.join(', ') ?? 'unavailable (entire file failed)'}`,
        'partial Markdown: none',
        'action: tell the user the missing pages and offer resubmit or AI OCR regenerate',
        'regenerate: use AI OCR only for these missing pages or failed file',
        'annotation: mark every AI OCR recovered row or field as AI OCR',
      ].join('\n');
    })
    .join('\n\n');
  const markdown = runtimeContext.attachments.currentOcrMarkdownResults
    .map((result) => (typeof result.content === 'string' ? result.content.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
  return [failures, markdown].filter(Boolean).join('\n\n');
}

export async function buildSteelGlobalAgentContext({
  conversation,
  dependencies,
  attachments,
  renderProfile = 'agent_client',
  mode = 'standard',
  prepareRuntimeContext = prepareLibreChatSteelRuntimeContext,
}: BuildSteelGlobalAgentContextInput): Promise<SteelNativeGlobalAgentContext> {
  const attachmentReferences = collectAttachmentReferences({ conversation, attachments });
  const preparedRuntimeContext = await prepareRuntimeContext({
    conversation: toRuntimeConversationInput(conversation),
    attachments: {
      currentOcrMarkdownResults:
        attachments?.currentOcrMarkdownResults !== undefined
          ? [...attachments.currentOcrMarkdownResults]
          : undefined,
      currentOcrFailures:
        attachments?.currentOcrFailures !== undefined
          ? [...attachments.currentOcrFailures]
          : undefined,
    },
    dependencies,
  });
  const runtimeContext = preparedRuntimeContext;
  const metadata = createSteelNativeContextMetadata({
    mode,
    renderProfile,
  });
  const { instructionPrefix, sections } = buildSteelNativeInstructionPrefix({
    runtimeContext,
    mode,
  });

  return {
    instructionPrefix,
    runtimeContextText: buildSteelNativeRuntimeContextText({
      runtimeContext,
      mode,
    }),
    runtimeContext,
    mode,
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
  ...input
}: BuildDefaultSteelGlobalAgentContextInput): Promise<SteelNativeGlobalAgentContext> {
  return buildSteelGlobalAgentContext({
    ...input,
    dependencies:
      dependencies ??
      createSteelContextDependencies({
        runtimeRulesClient,
      }),
  });
}
