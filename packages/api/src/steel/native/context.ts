import { normalizeOcrOrganizerFileKey } from '../ocr/organizer';
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

export const steelNativeContextModes = ['standard', 'ocr', 'delegate_ocr'] as const;

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
  currentPaddleOcrStatuses?: readonly SteelRuntimeJsonObject[];
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
  attachmentReferences?: readonly SteelNativeFileReference[];
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

function readValidOcrPreprocessingMetadata(
  result: SteelRuntimeJsonObject,
): { chunkCount: number; pageRanges: { pageStart: number; pageEnd: number }[] } | undefined {
  const preprocessing = result.ocrPreprocessing;
  if (!preprocessing || typeof preprocessing !== 'object' || Array.isArray(preprocessing)) {
    return undefined;
  }

  const chunkCount = preprocessing.chunkCount;
  const pageRanges = preprocessing.pageRanges;
  const partial = preprocessing.partial === true;
  if (
    typeof chunkCount !== 'number' ||
    !Number.isInteger(chunkCount) ||
    chunkCount < 1 ||
    !Array.isArray(pageRanges) ||
    pageRanges.length === 0 ||
    pageRanges.length !== chunkCount
  ) {
    return undefined;
  }

  const normalizedRanges: { pageStart: number; pageEnd: number }[] = [];
  for (const range of pageRanges) {
    if (!range || typeof range !== 'object' || Array.isArray(range)) {
      return undefined;
    }
    const pageStart = range.pageStart;
    const pageEnd = range.pageEnd;
    if (
      typeof pageStart !== 'number' ||
      !Number.isInteger(pageStart) ||
      pageStart < 1 ||
      typeof pageEnd !== 'number' ||
      !Number.isInteger(pageEnd) ||
      pageEnd < pageStart
    ) {
      return undefined;
    }
    const previous = normalizedRanges[normalizedRanges.length - 1];
    if (previous && (pageStart <= previous.pageEnd || (!partial && pageStart !== previous.pageEnd + 1))) {
      return undefined;
    }
    normalizedRanges.push({ pageStart, pageEnd });
  }

  return { chunkCount, pageRanges: normalizedRanges };
}

function normalizeSafeSteelAiUrl(value: string | undefined): string | undefined {
  if (!value || value.trim() === '') {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

interface NativeOcrFailureGroup {
  fileKey: string;
  fileUrl: string;
  stage: string;
  ranges: { pageStart: number; pageEnd: number }[];
}

function getNativeOcrFailureStage(failure: SteelRuntimeJsonObject): string {
  const stage = typeof failure.stage === 'string' ? failure.stage.trim().toLowerCase() : '';
  if (stage === 'paddleocr') {
    return stage;
  }
  return ['artifacts', 'organizer', 'merge', 'preflight', 'state'].includes(stage)
    ? stage
    : 'generic';
}

function readNativeOcrFailureRange(
  failure: SteelRuntimeJsonObject,
): { pageStart: number; pageEnd: number } | undefined {
  const mediaType = typeof failure.mediaType === 'string' ? failure.mediaType.trim() : '';
  if (mediaType.toLowerCase().startsWith('image/')) {
    return undefined;
  }
  const pageStart = failure.pageStart;
  const pageEnd = failure.pageEnd;
  if (
    typeof pageStart !== 'number' ||
    !Number.isSafeInteger(pageStart) ||
    pageStart < 1 ||
    typeof pageEnd !== 'number' ||
    !Number.isSafeInteger(pageEnd) ||
    pageEnd < pageStart
  ) {
    return undefined;
  }
  return { pageStart, pageEnd };
}

function renderNativePaddleOcrStatus(result: SteelRuntimeJsonObject): string {
  if (result.paddleocr !== 'ok' && result.paddleocr !== 'fail') {
    return '';
  }
  const { safeFileKey } = readOcrFileKey(result);
  if (!safeFileKey) {
    return '';
  }
  const chunkIndex =
    typeof result.chunkIndex === 'number' &&
    Number.isSafeInteger(result.chunkIndex) &&
    result.chunkIndex >= 1
      ? result.chunkIndex
      : 'unavailable';
  const chunkCount =
    typeof result.chunkCount === 'number' &&
    Number.isSafeInteger(result.chunkCount) &&
    result.chunkCount >= 1
      ? result.chunkCount
      : 'unavailable';
  const range = readNativeOcrFailureRange(result);
  return [
    `paddleocr_status: ${result.paddleocr}`,
    `file_key: ${safeFileKey}`,
    `chunk_index: ${chunkIndex}`,
    `chunk_count: ${chunkCount}`,
    `page_range: ${
      range
        ? range.pageStart === range.pageEnd
          ? range.pageStart
          : `${range.pageStart}-${range.pageEnd}`
        : 'unavailable'
    }`,
  ].join('\n');
}

function mergeNativeOcrFailureRanges(
  ranges: readonly { pageStart: number; pageEnd: number }[],
): { pageStart: number; pageEnd: number }[] {
  const sortedRanges = [...ranges].sort(
    (left, right) => left.pageStart - right.pageStart || left.pageEnd - right.pageEnd,
  );
  const mergedRanges: { pageStart: number; pageEnd: number }[] = [];
  for (const range of sortedRanges) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && range.pageStart <= previous.pageEnd + 1) {
      previous.pageEnd = Math.max(previous.pageEnd, range.pageEnd);
      continue;
    }
    mergedRanges.push({ ...range });
  }
  return mergedRanges;
}

function renderNativeOcrFailureRanges(
  ranges: readonly { pageStart: number; pageEnd: number }[],
): string {
  const mergedRanges = mergeNativeOcrFailureRanges(ranges);
  return mergedRanges.length > 0
    ? mergedRanges
        .map(({ pageStart, pageEnd }) =>
          pageStart === pageEnd ? String(pageStart) : `${pageStart}-${pageEnd}`,
        )
        .join(', ')
    : 'unavailable';
}

function readOcrFileKey(result: SteelRuntimeJsonObject): {
  rawFileKey: string;
  safeFileKey: string;
} {
  const rawFileKey = typeof result.ocrFileKey === 'string' ? result.ocrFileKey.trim() : '';
  let fileId: string | undefined;
  if (typeof result.fileId === 'string') {
    fileId = result.fileId;
  } else if (typeof result.file_id === 'string') {
    fileId = result.file_id;
  } else if (typeof result.id === 'string') {
    fileId = result.id;
  }
  const safeFileKey =
    rawFileKey || fileId
      ? normalizeOcrOrganizerFileKey({ fileKey: rawFileKey || fileId || '', fileId })
      : '';
  return { rawFileKey, safeFileKey };
}

function replaceLeadingOcrFileLabel(content: string, rawFileKey: string, safeFileKey: string) {
  if (!rawFileKey || !safeFileKey || rawFileKey === safeFileKey) {
    return content;
  }
  const rawLabel = `<${rawFileKey}>`;
  return content.startsWith(rawLabel)
    ? `<${safeFileKey}>${content.slice(rawLabel.length)}`
    : content;
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

function sortOcrRules(rules: readonly SteelAgentRule[]): SteelAgentRule[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => {
      const priorityOrder = getRulePriority(left.rule) - getRulePriority(right.rule);
      return priorityOrder !== 0 ? priorityOrder : left.index - right.index;
    })
    .map(({ rule }) => rule);
}

function buildOcrMainRuleItems(
  runtimeContext: SteelRuntimeContext,
  sections: readonly ('ocr_main_merge' | 'final_ocr_markdown')[],
): string[] {
  return sortOcrRules(runtimeContext.rules.otherGlobalRules.ocrMainRules)
    .map((rule) => {
      const prompt = rule.prompt.trim();
      const extracted = sections.flatMap((section) => {
        const marker = new RegExp(`\\[${section}\\][\\s\\S]*?\\[\\/${section}\\]`, 'u').exec(
          prompt,
        )?.[0];
        return marker ? [marker] : [];
      });
      if (extracted.length === 0) {
        return '';
      }
      if (extracted.join('\n') === prompt) {
        return renderAgentRule(rule);
      }
      return compactText([`## ${rule.title}`, extracted.join('\n')]).join('\n');
    });
}

function buildDelegateOcrRuleItems(runtimeContext: SteelRuntimeContext): string[] {
  return [
    ...sortOcrRules(runtimeContext.rules.otherGlobalRules.ocrSharedRules).map(renderAgentRule),
    ...sortOcrRules(runtimeContext.rules.otherGlobalRules.ocrVisionRules).map(renderAgentRule),
    ...buildOcrMainRuleItems(runtimeContext, ['final_ocr_markdown']),
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
          buildSlot(
            'other',
            'Steel OCR Rules',
            buildOcrMainRuleItems(runtimeContext, ['ocr_main_merge', 'final_ocr_markdown']),
          ),
        ]
      : mode === 'delegate_ocr'
        ? [
            buildSlot('agent', 'Steel Agent Rules', []),
            buildSlot('quote_rules', 'Steel Quote Defaults and Category Rules', []),
            buildSlot('output', 'Steel Output Rules', []),
            buildSlot(
              'other',
              'Steel Delegate OCR Rules',
              buildDelegateOcrRuleItems(runtimeContext),
            ),
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

function hasRuleSection(
  rule: SteelAgentRule,
  sections: readonly string[],
  markers: readonly string[] = [],
): boolean {
  if (rule.ruleSections.some((section) => sections.includes(section))) {
    return true;
  }

  return markers.some((marker) => rule.prompt.includes(marker));
}

const explicitOcrRuleSections = [
  'ocr_shared',
  'vision_processing',
  'ocr_main_flow',
  'ocr_organizer',
] as const;

function hasExplicitOcrRuleSection(rule: SteelAgentRule): boolean {
  return rule.ruleSections.some((section) =>
    explicitOcrRuleSections.some((knownSection) => knownSection === section),
  );
}

function isOcrSharedRule(rule: SteelAgentRule): boolean {
  if (hasExplicitOcrRuleSection(rule)) {
    return hasRuleSection(rule, ['ocr_shared']);
  }

  return hasRuleSection(rule, ['ocr_shared'], ['[ocr_shared]']);
}

function isOcrVisionRule(rule: SteelAgentRule): boolean {
  if (hasExplicitOcrRuleSection(rule)) {
    return hasRuleSection(rule, ['vision_processing']);
  }

  return hasRuleSection(rule, ['ocr_vision'], ['[ocr_vision]']);
}

function isOcrMainRule(rule: SteelAgentRule): boolean {
  if (hasExplicitOcrRuleSection(rule)) {
    return hasRuleSection(rule, ['ocr_main_flow']);
  }

  return hasRuleSection(
    rule,
    [],
    ['[ocr_main]', '[ocr_main_merge]', '[final_ocr_markdown]'],
  );
}

function isOcrOrganizerRule(rule: SteelAgentRule): boolean {
  if (hasExplicitOcrRuleSection(rule)) {
    return hasRuleSection(rule, ['ocr_organizer']);
  }

  return hasRuleSection(rule, ['ocr_organizer'], ['[ocr_organizer]']);
}

function filterOtherGlobalRules(rules: readonly SteelAgentRule[]) {
  const ocrSharedRules = rules.filter(isOcrSharedRule);
  const ocrVisionRules = rules.filter(isOcrVisionRule);
  const ocrMainRules = rules.filter(isOcrMainRule);
  const ocrOrganizerRules = rules.filter(isOcrOrganizerRule);
  const ocrRuleSet = new Set([
    ...ocrSharedRules,
    ...ocrVisionRules,
    ...ocrMainRules,
    ...ocrOrganizerRules,
  ]);

  return {
    ocrSharedRules,
    ocrVisionRules,
    ocrMainRules,
    ocrOrganizerRules,
    fileRules: rules.filter(
      (rule) => hasRuleSection(rule, ['file', 'file_policy']) && !ocrRuleSet.has(rule),
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
  attachmentReferences = [],
}: BuildSteelNativeRuntimeContextTextInput): string {
  const referencesByFileKey = new Map<string, { filename?: string; mediaType?: string }>();
  for (const reference of attachmentReferences) {
    const fileId = reference.fileId.trim();
    if (!fileId) {
      continue;
    }
    const fileKey = fileId.startsWith('file:') ? fileId : `file:${fileId}`;
    const current = referencesByFileKey.get(fileKey) ?? {};
    const filename = reference.filename?.trim();
    const mediaType = reference.mediaType.trim();
    referencesByFileKey.set(fileKey, {
      filename: current.filename ?? (filename || undefined),
      mediaType: current.mediaType ?? (mediaType || undefined),
    });
  }
  const attachmentContext = [...referencesByFileKey.entries()]
    .map(([fileKey, reference]) =>
      [
        `file_key: ${fileKey}`,
        reference.filename ? `source_filename: ${JSON.stringify(reference.filename)}` : '',
        reference.mediaType ? `media_type: ${JSON.stringify(reference.mediaType)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
  const attachmentContextText = attachmentContext
    ? `# Source attachment metadata\n${attachmentContext}`
    : '';

  const paddleOcrStatusFileKeys = new Set<string>();
  const paddleOcrStatusRangeKeys = new Set<string>();
  for (const status of runtimeContext.attachments.currentPaddleOcrStatuses) {
    const { safeFileKey } = readOcrFileKey(status);
    if (!safeFileKey) {
      continue;
    }
    paddleOcrStatusFileKeys.add(safeFileKey);
    const range = readNativeOcrFailureRange(status);
    if (range) {
      paddleOcrStatusRangeKeys.add(`${safeFileKey}:${range.pageStart}-${range.pageEnd}`);
    }
  }
  const hasPaddleOcrStatus = (
    fileKey: string,
    range?: { pageStart: number; pageEnd: number },
  ): boolean =>
    range
      ? paddleOcrStatusRangeKeys.has(`${fileKey}:${range.pageStart}-${range.pageEnd}`)
      : paddleOcrStatusFileKeys.has(fileKey);
  const paddleOcrStatuses = runtimeContext.attachments.currentPaddleOcrStatuses
    .map(renderNativePaddleOcrStatus)
    .filter(Boolean)
    .join('\n\n');
  const markdown = runtimeContext.attachments.currentOcrMarkdownResults
    .map((result) => {
      const content = typeof result.content === 'string' ? result.content.trim() : '';
      if (!content) {
        return '';
      }

      const { rawFileKey, safeFileKey } = readOcrFileKey(result);
      const filename = typeof result.filename === 'string' ? result.filename.trim() : '';
      const preprocessing = readValidOcrPreprocessingMetadata(result);
      const pageRangeText = preprocessing?.pageRanges
        .map(({ pageStart, pageEnd }) =>
          pageStart === pageEnd ? String(pageStart) : `${pageStart}-${pageEnd}`,
        )
        .join(', ');
      const statusPageRanges = preprocessing?.pageRanges.length
        ? preprocessing.pageRanges
        : [undefined];
      const legacyPaddleOcrStatuses = safeFileKey
        ? statusPageRanges
            .map((range, index) =>
              hasPaddleOcrStatus(safeFileKey, range)
                ? ''
                : [
                    'paddleocr_status: ok',
                    `file_key: ${safeFileKey}`,
                    `chunk_index: ${index + 1}`,
                    `page_range: ${
                      range
                        ? range.pageStart === range.pageEnd
                          ? range.pageStart
                          : `${range.pageStart}-${range.pageEnd}`
                        : 'unavailable'
                    }`,
                  ].join('\n'),
            )
            .filter(Boolean)
            .join('\n\n')
        : '';
      return [
        ...(mode === 'ocr' ? [] : [legacyPaddleOcrStatuses]),
        safeFileKey ? `file_key: ${safeFileKey}` : '',
        filename ? `source_filename: ${JSON.stringify(filename)}` : '',
        pageRangeText ? `page_ranges: ${pageRangeText}` : '',
        preprocessing ? `chunk_count: ${preprocessing.chunkCount}` : '',
        replaceLeadingOcrFileLabel(content, rawFileKey, safeFileKey),
      ]
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  if (mode === 'ocr') {
    const currentTurnOcrDirective = markdown
      ? [
          '# Current-turn OCR completion directive',
          'Apply [ocr_main_merge] and [final_ocr_markdown].',
          'Your final answer MUST contain only per-source consolidated OCR table(s), an optional `manual_review` section/table, and the required OCR completion summary.',
          'Do not output page headings or page details. Do not output explanatory prose, bullet lists, calculations, or duplicate tables.',
          'Satisfy any other user intent only within those allowed sections, even when the current user turn includes metadata such as customer name.',
        ].join('\n')
      : '';
    return [markdown, currentTurnOcrDirective].filter(Boolean).join('\n\n');
  }

  if (
    runtimeContext.attachments.currentPaddleOcrStatuses.length === 0 &&
    runtimeContext.attachments.currentOcrMarkdownResults.length === 0 &&
    runtimeContext.attachments.currentOcrFailures.length === 0
  ) {
    return attachmentContextText;
  }

  const paddleOcrFailures: string[] = [];
  const failuresByGroup = new Map<string, NativeOcrFailureGroup>();
  for (const failure of runtimeContext.attachments.currentOcrFailures) {
    const { safeFileKey } = readOcrFileKey(failure);
    const fileKey = safeFileKey || 'unknown';
    const fileUrl = [failure.fileUrl, failure.ocrFileUrl]
      .filter((value): value is string => typeof value === 'string')
      .map(normalizeSafeSteelAiUrl)
      .find((value): value is string => value !== undefined);
    const stage = getNativeOcrFailureStage(failure);
    if (stage === 'paddleocr') {
      const range = readNativeOcrFailureRange(failure);
      if (hasPaddleOcrStatus(fileKey, range)) {
        continue;
      }
      const chunkIndex =
        typeof failure.chunkIndex === 'number' &&
        Number.isSafeInteger(failure.chunkIndex) &&
        failure.chunkIndex >= 1
          ? failure.chunkIndex
          : 'unavailable';
      paddleOcrFailures.push(
        [
          'ocr_failure_stage: paddleocr',
          'paddleocr_status: fail',
          `file_key: ${fileKey}`,
          `chunk_index: ${chunkIndex}`,
          `page_range: ${
            range
              ? range.pageStart === range.pageEnd
                ? range.pageStart
                : `${range.pageStart}-${range.pageEnd}`
              : 'unavailable'
          }`,
        ].join('\n'),
      );
      continue;
    }
    const groupKey = `${stage}\u0000${fileKey}\u0000${fileUrl ?? 'unavailable'}`;
    const current =
      failuresByGroup.get(groupKey) ?? {
        fileKey,
        fileUrl: fileUrl ?? 'unavailable',
        stage,
        ranges: [],
      };
    const range = readNativeOcrFailureRange(failure);
    if (range) {
      current.ranges.push(range);
    }
    failuresByGroup.set(groupKey, current);
  }
  const otherFailures = [...failuresByGroup.values()].map((failure) => {
    const commonFields = [
      `file_key: ${failure.fileKey}`,
      `failed_page_ranges: ${renderNativeOcrFailureRanges(failure.ranges)}`,
      `file_url: ${failure.fileUrl}`,
    ];
    return [`ocr_failure_stage: ${failure.stage}`, ...commonFields].join('\n');
  });
  const failures = [...paddleOcrFailures, ...otherFailures].join('\n\n');
  return [attachmentContextText, paddleOcrStatuses, failures, markdown]
    .filter(Boolean)
    .join('\n\n');
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
      currentPaddleOcrStatuses:
        attachments?.currentPaddleOcrStatuses !== undefined
          ? [...attachments.currentPaddleOcrStatuses]
          : undefined,
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
      attachmentReferences,
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
