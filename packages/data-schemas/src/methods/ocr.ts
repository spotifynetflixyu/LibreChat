import { parseSteelReviewMarkdownTables } from 'librechat-data-provider';
import type { ClientSession } from 'mongoose';
import type { IConversation, SteelConversationOcrRecord, SteelQuotationScope } from '~/types';
import { createSteelConversationOcrStateModel } from '~/models/steel';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';
import { runAsSystem } from '~/config/tenantContext';

type Mongoose = typeof import('mongoose');
type ConversationModel = ReturnType<typeof createConversationModel>;
type OcrStateModel = ReturnType<typeof createSteelConversationOcrStateModel>;

interface ScopedOcrDependencies {
  Conversation: ConversationModel;
  State: OcrStateModel;
  Message: ReturnType<typeof createMessageModel>;
}

export interface SteelScopedOcrMethods {
  /**
   * Returns legacy OCR state only when the conversation ID has one active,
   * uniquely authorized owner identity. Identity and OCR share one snapshot.
   * Null means the legacy record is absent
   * or cannot be authorized because the conversation identity is missing,
   * ambiguous, expired, or belongs to another user or tenant. Database errors
   * propagate to the caller.
   */
  readScopedConversationOcrState(
    scope: SteelQuotationScope,
  ): Promise<SteelConversationOcrRecord | null>;
}

function sameTenant(left: Pick<IConversation, 'tenantId'>, scope: SteelQuotationScope): boolean {
  return scope.tenantId === undefined
    ? left.tenantId === undefined || left.tenantId === null
    : left.tenantId === scope.tenantId;
}

async function findScopedConversation(
  Conversation: ConversationModel,
  scope: SteelQuotationScope,
  session?: ClientSession,
): Promise<Pick<IConversation, 'user' | 'tenantId' | 'expiredAt'> | null> {
  if (!scope.userId || !scope.conversationId) return null;
  const conversations = await runAsSystem(async () => Conversation.find({ conversationId: scope.conversationId })
    .limit(2)
    .select({ user: 1, tenantId: 1, expiredAt: 1 })
    .session(session ?? null)
    .lean<Pick<IConversation, 'user' | 'tenantId' | 'expiredAt'>[]>());
  if (conversations.length !== 1) return null;
  const conversation = conversations[0];
  return conversation && conversation.user === scope.userId && sameTenant(conversation, scope) &&
    activeConversation(conversation)
    ? conversation
    : null;
}

export async function hasUniqueSteelOcrScope(
  Conversation: ConversationModel,
  scope: SteelQuotationScope,
  session?: ClientSession,
): Promise<boolean> {
  return (await findScopedConversation(Conversation, scope, session)) !== null;
}

/**
 * Legacy OCR state has only a conversation key. Bind that key to one active
 * conversation identity before exposing it; a shared ID cannot authorize any
 * OCR state, even when one candidate happens to match the requested owner.
 * Stored OCR also requires its owned assistant message; uniqueness alone cannot
 * attribute a historical conversation-only record to a surviving identity.
 */
export async function readScopedConversationOcrEvidence(
  scope: SteelQuotationScope,
  dependencies: ScopedOcrDependencies,
  session: ClientSession,
): Promise<{ ok: true; state: SteelConversationOcrRecord | null } | { ok: false; code: 'untrusted_ocr' }> {
  if (!await findScopedConversation(dependencies.Conversation, scope, session)) return { ok: true, state: null };
  const state = await dependencies.State.findOne({ conversationId: scope.conversationId })
    .session(session ?? null)
    .lean<SteelConversationOcrRecord>();
  if (!state?.currentOcrResultMarkdown) return { ok: true, state };
  const messageId = state.currentOcrResultMessageId;
  if (!messageId) return { ok: false, code: 'untrusted_ocr' };
  const provenance = state.currentOcrResultProvenance;
  if (provenance && (provenance.messageId !== messageId ||
    provenance.generationId !== state.currentOcrResultGenerationId)) return { ok: false, code: 'untrusted_ocr' };
  const messages = await dependencies.Message.find({
    conversationId: scope.conversationId, user: scope.userId, messageId,
    isCreatedByUser: { $ne: true }, unfinished: { $ne: true },
    $and: [activeExpirationFilter(), scope.tenantId === undefined
      ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] } : { tenantId: scope.tenantId }],
  }).limit(2).select('text').session(session ?? null).lean<Array<{ text?: string }>>();
  if (messages.length !== 1) return { ok: false, code: 'untrusted_ocr' };
  const kind = (title?: string) => title?.split(/[｜|:：]/u)[0]?.trim();
  const tables = parseSteelReviewMarkdownTables(state.currentOcrResultMarkdown)
    .filter((table) => kind(table.title) === 'ocr_result');
  if (tables.length !== 1) return { ok: false, code: 'untrusted_ocr' };
  const rendered = parseSteelReviewMarkdownTables(messages[0].text ?? '');
  const full = rendered.filter((table) => kind(table.title) === 'ocr_result');
  const updates = rendered.filter((table) => kind(table.title) === 'ocr_result_updates');
  const trustedDelta = full.length === 0 && updates.length === 1 &&
    Boolean(state.currentOcrResultGenerationId) && provenance !== undefined && provenance.generationId === state.currentOcrResultGenerationId &&
    provenance.messageId === messageId;
  return trustedDelta || (full.length === 1 && full[0].title === tables[0].title)
    ? { ok: true, state } : { ok: false, code: 'untrusted_ocr' };
}

export async function readScopedConversationOcrState(
  scope: SteelQuotationScope,
  dependencies: ScopedOcrDependencies,
  session: ClientSession,
): Promise<SteelConversationOcrRecord | null> {
  const evidence = await readScopedConversationOcrEvidence(scope, dependencies, session);
  return evidence.ok ? evidence.state : null;
}

function activeConversation(conversation: Pick<IConversation, 'expiredAt'>): boolean {
  if (conversation.expiredAt === undefined || conversation.expiredAt === null) return true;
  return conversation.expiredAt.getTime() > Date.now();
}

export function createSteelScopedOcrMethods(mongoose: Mongoose): SteelScopedOcrMethods {
  const dependencies: ScopedOcrDependencies = {
    Conversation: createConversationModel(mongoose),
    State: createSteelConversationOcrStateModel(mongoose),
    Message: createMessageModel(mongoose),
  };
  return {
    async readScopedConversationOcrState(scope) {
      if (!scope.userId || !scope.conversationId) return null;
      const session = await mongoose.startSession();
      let state: SteelConversationOcrRecord | null = null;
      try {
        await session.withTransaction(async () => {
          state = await readScopedConversationOcrState(scope, dependencies, session);
        }, { readConcern: { level: 'snapshot' } });
        return state;
      } finally {
        await session.endSession();
      }
    },
  };
}
