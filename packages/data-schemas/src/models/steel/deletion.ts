import type { ConversationDeletionHooks, ConversationDeletionScope } from '~/methods/conversation';
import { fenceSteelConversationWrites, readSteelConversationDeletionScope } from './lifecycle';
import {
  createSteelReviewOutputModel,
  createSteelDelegateOcrRunModel,
  createSteelQuotationStateModel,
  createSteelOcrResponseAuditModel,
  createSteelQuotationArtifactModel,
  createSteelWorkingOrderMemoryModel,
  createSteelConversationOcrStateModel,
} from '.';

type Mongoose = typeof import('mongoose');

const DELETE_ATTEMPTS = 3;

function ownerScopeFilter(userId: string, scopes: readonly ConversationDeletionScope[]) {
  return {
    userId,
    $or: scopes.map(({ conversationId, tenantId }) => ({
      conversationId,
      ...(tenantId === undefined
        ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
        : { tenantId }),
    })),
  };
}

/**
 * Deletes the owner-scoped Steel state of the conversations. OCR state keyed
 * only by conversation id is deleted for `fencedConversationIds`, whose
 * ownership the deletion fence has proven.
 */
async function deleteSteelConversationState(
  mongoose: Mongoose,
  userId: string,
  scopes: readonly ConversationDeletionScope[],
  fencedConversationIds: readonly string[],
): Promise<void> {
  if (scopes.length === 0) {
    return;
  }
  const ownerFilter = ownerScopeFilter(userId, scopes);
  const fencedFilter = { conversationId: { $in: fencedConversationIds } };
  const deleteAttempt = () =>
    Promise.all([
      createSteelQuotationStateModel(mongoose).deleteMany(ownerFilter),
      createSteelQuotationArtifactModel(mongoose).deleteMany(ownerFilter),
      createSteelReviewOutputModel(mongoose).deleteMany(ownerFilter),
      createSteelOcrResponseAuditModel(mongoose).deleteMany(ownerFilter),
      createSteelConversationOcrStateModel(mongoose).deleteMany(fencedFilter),
      createSteelDelegateOcrRunModel(mongoose).deleteMany(fencedFilter),
      createSteelWorkingOrderMemoryModel(mongoose).deleteMany(fencedFilter),
    ]);

  let lastError: unknown;
  for (let attempt = 1; attempt <= DELETE_ATTEMPTS; attempt += 1) {
    try {
      await deleteAttempt();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < DELETE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }
  }
  throw lastError;
}

function fencedIds(
  scopes: readonly ConversationDeletionScope[],
  fenced: readonly boolean[],
): string[] {
  return scopes
    .filter((_scope, index) => fenced[index])
    .map(({ conversationId }) => conversationId);
}

/**
 * Conversation deletion hooks that fence Steel writes for each deleted
 * conversation and delete its Steel state before and after the conversation
 * documents are removed.
 */
export function createSteelConversationDeletionHooks(
  mongoose: Mongoose,
): ConversationDeletionHooks {
  return {
    async hasDeletedConversation(userId, scope) {
      const deletion = await readSteelConversationDeletionScope(mongoose, { userId, ...scope });
      return deletion.deleted;
    },
    async beforeDeleteConversations(userId, scopes) {
      const fenced = await Promise.all(
        scopes.map((scope) => fenceSteelConversationWrites(mongoose, { userId, ...scope })),
      );
      await deleteSteelConversationState(mongoose, userId, scopes, fencedIds(scopes, fenced));
    },
    async afterDeleteConversations(userId, scopes) {
      const deletions = await Promise.all(
        scopes.map((scope) => readSteelConversationDeletionScope(mongoose, { userId, ...scope })),
      );
      const fenced = deletions.map(({ deleted }) => deleted);
      await deleteSteelConversationState(mongoose, userId, scopes, fencedIds(scopes, fenced));
    },
  };
}
