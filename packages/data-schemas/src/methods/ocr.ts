import type { ClientSession } from 'mongoose';
import type { IConversation, ISteelConversationOcrState, SteelQuotationScope } from '~/types';
import { createSteelConversationOcrStateModel } from '~/models/steel';
import { createConversationModel } from '~/models/convo';

type Mongoose = typeof import('mongoose');
type ConversationModel = ReturnType<typeof createConversationModel>;
type OcrStateModel = ReturnType<typeof createSteelConversationOcrStateModel>;

interface ScopedOcrDependencies {
  Conversation: ConversationModel;
  State: OcrStateModel;
}

export interface SteelScopedOcrMethods {
  /** Null means no uniquely authorized legacy record; database failures propagate. */
  /**
   * Returns legacy OCR state only when the conversation ID has one active,
   * uniquely authorized owner identity. Null means the legacy record is absent
   * or cannot be authorized because the conversation identity is missing,
   * ambiguous, expired, or belongs to another user or tenant. Database errors
   * propagate to the caller.
   */
  readScopedConversationOcrState(
    scope: SteelQuotationScope,
  ): Promise<ISteelConversationOcrState | null>;
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
  const conversations = await Conversation.find({ conversationId: scope.conversationId })
    .limit(2)
    .select({ user: 1, tenantId: 1, expiredAt: 1 })
    .session(session ?? null)
    .lean<Pick<IConversation, 'user' | 'tenantId' | 'expiredAt'>[]>();
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
 */
export async function readScopedConversationOcrState(
  scope: SteelQuotationScope,
  dependencies: ScopedOcrDependencies,
  session?: ClientSession,
): Promise<ISteelConversationOcrState | null> {
  if (!await findScopedConversation(dependencies.Conversation, scope, session)) return null;
  return dependencies.State.findOne({ conversationId: scope.conversationId })
    .session(session ?? null)
    .lean<ISteelConversationOcrState>();
}

function activeConversation(conversation: Pick<IConversation, 'expiredAt'>): boolean {
  if (conversation.expiredAt === undefined || conversation.expiredAt === null) return true;
  return conversation.expiredAt.getTime() > Date.now();
}

export function createSteelScopedOcrMethods(mongoose: Mongoose): SteelScopedOcrMethods {
  const dependencies: ScopedOcrDependencies = {
    Conversation: createConversationModel(mongoose),
    State: createSteelConversationOcrStateModel(mongoose),
  };
  return {
    readScopedConversationOcrState: (scope) => readScopedConversationOcrState(scope, dependencies),
  };
}
