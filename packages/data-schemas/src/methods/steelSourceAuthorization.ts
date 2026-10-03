import type { ClientSession, FilterQuery } from 'mongoose';
import type { IMongoFile, IMessage, SteelReviewSourceScope } from '~/types';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';
import { createFileModel } from '~/models/file';

type Mongoose = typeof import('mongoose');

type TenantFilter =
  | { tenantId: string }
  | { $or: Array<{ tenantId: { $exists: false } } | { tenantId: null }> };

export type SteelReviewAuthorizedFile = Pick<
  IMongoFile,
  | 'file_id'
  | 'filename'
  | 'type'
  | 'bytes'
  | 'source'
  | 'filepath'
  | 'storageKey'
  | 'storageRegion'
  | 'model'
> & {
  conversationId?: string;
  messageId?: string;
};

type ScopedMessage = Pick<IMessage, 'messageId' | 'conversationId' | 'user' | 'files'> & {
  tenantId?: string | null;
  expiredAt?: Date | null;
};

type SteelReviewSourceOwnerContext = {
  conversation: {
    conversationId: string;
    user?: string;
    tenantId?: string | null;
    expiredAt?: Date | null;
  };
  message: ScopedMessage;
};

function tenantFilter(tenantId?: string): TenantFilter {
  return tenantId === undefined
    ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
    : { tenantId };
}

function messageFileIds(files: IMessage['files'] | undefined): string[] {
  return (files ?? []).flatMap((file) => {
    if (typeof file !== 'object' || file === null || Array.isArray(file) || !('file_id' in file)) {
      return [];
    }
    const fileId = file.file_id;
    return typeof fileId === 'string' && fileId.length > 0 ? [fileId] : [];
  });
}

function fileFilter(
  input: SteelReviewSourceScope,
  messageIds: readonly string[],
  attachedFileIds: readonly string[],
  requestedFileIds: readonly string[] | undefined,
): FilterQuery<IMongoFile> {
  const anchors: FilterQuery<IMongoFile>[] = [{ conversationId: input.conversationId }];
  if (messageIds.length > 0) {
    anchors.push({ conversationId: null, messageId: { $in: messageIds } });
  }
  if (attachedFileIds.length > 0) {
    anchors.push({ conversationId: null, file_id: { $in: attachedFileIds } });
  }

  const clauses: FilterQuery<IMongoFile>[] = [
    { user: input.userId },
    tenantFilter(input.tenantId),
    { $or: anchors },
    activeExpirationFilter(),
  ];
  if (requestedFileIds && requestedFileIds.length > 0) {
    clauses.push({ file_id: { $in: requestedFileIds } });
  }
  return { $and: clauses };
}

function groupByFileId(files: readonly SteelReviewAuthorizedFile[]): Map<string, SteelReviewAuthorizedFile[]> {
  const grouped = new Map<string, SteelReviewAuthorizedFile[]>();
  for (const file of files) {
    const group = grouped.get(file.file_id);
    if (group) {
      group.push(file);
    } else {
      grouped.set(file.file_id, [file]);
    }
  }
  return grouped;
}

function hasOnlyRequestedConversation(conversations: ReadonlySet<string>, requestedConversationId: string): boolean {
  return conversations.size > 0 && [...conversations].every((conversationId) => conversationId === requestedConversationId);
}

function matchesTenantScope(actual: string | null | undefined, expected?: string): boolean {
  return expected === undefined ? actual == null : actual === expected;
}

function isActive(expiredAt: Date | null | undefined): boolean {
  return expiredAt == null || expiredAt > new Date();
}

function isValidOwnerContext(
  context: SteelReviewSourceOwnerContext,
  input: SteelReviewSourceScope,
): boolean {
  return context.conversation.conversationId === input.conversationId &&
    context.conversation.user === input.userId &&
    matchesTenantScope(context.conversation.tenantId, input.tenantId) &&
    isActive(context.conversation.expiredAt) &&
    context.message.messageId === input.messageId &&
    context.message.conversationId === input.conversationId &&
    context.message.user === input.userId &&
    matchesTenantScope(context.message.tenantId, input.tenantId) &&
    isActive(context.message.expiredAt);
}

/**
 * Resolves the internal file projection shared by the review row and source
 * readers. Legacy files without a conversationId require one physical record
 * and a same-owner active message anchor; a file.messageId is evidence only
 * after that message is resolved in the authorized owner scope.
 */
export function createSteelReviewSourceAuthorization(mongoose: Mongoose) {
  const Conversation = createConversationModel(mongoose);
  const Message = createMessageModel(mongoose);
  const File = createFileModel(mongoose);

  return async function resolveAuthorizedFiles(
    input: SteelReviewSourceScope,
    requestedFileIds?: readonly string[],
    session?: ClientSession,
    ownerContext?: SteelReviewSourceOwnerContext,
  ): Promise<ReadonlyMap<string, SteelReviewAuthorizedFile>> {
    const uniqueRequestedFileIds = requestedFileIds
      ? [...new Set(requestedFileIds.filter((fileId) => fileId.length > 0))]
      : undefined;
    if (!mongoose.Types.ObjectId.isValid(input.userId)) {
      return new Map();
    }

    const conversationFilter: FilterQuery<{ conversationId: string; user: string }> = {
      $and: [
        { conversationId: input.conversationId, user: input.userId },
        tenantFilter(input.tenantId),
        activeExpirationFilter(),
      ],
    };
    const scopedMessageFilter: FilterQuery<ScopedMessage> = {
      $and: [
        { conversationId: input.conversationId, user: input.userId },
        tenantFilter(input.tenantId),
        activeExpirationFilter(),
      ],
    };
    const clickedMessageFilter: FilterQuery<ScopedMessage> = {
      $and: [
        { conversationId: input.conversationId, user: input.userId, messageId: input.messageId },
        tenantFilter(input.tenantId),
        activeExpirationFilter(),
      ],
    };

    const reusableOwnerContext = ownerContext && isValidOwnerContext(ownerContext, input)
      ? ownerContext
      : undefined;
    const conversationQuery = reusableOwnerContext
      ? undefined
      : Conversation.findOne(conversationFilter).select({ conversationId: 1 });
    const scopedMessagesQuery = Message.find(scopedMessageFilter)
      .select({ messageId: 1, conversationId: 1, user: 1, files: 1 });
    const clickedMessagesQuery = reusableOwnerContext
      ? undefined
      : Message.find(clickedMessageFilter)
        .select({ messageId: 1, conversationId: 1, user: 1, files: 1 });
    if (session) {
      conversationQuery?.session(session);
      scopedMessagesQuery.session(session);
      clickedMessagesQuery?.session(session);
    }
    const [conversation, scopedMessages, clickedMessages] = await Promise.all([
      reusableOwnerContext
        ? Promise.resolve(reusableOwnerContext.conversation)
        : conversationQuery!.lean(),
      scopedMessagesQuery.lean<ScopedMessage[]>(),
      reusableOwnerContext
        ? Promise.resolve([reusableOwnerContext.message])
        : clickedMessagesQuery!.lean<ScopedMessage[]>(),
    ]);
    if (!conversation || clickedMessages.length !== 1) {
      return new Map();
    }
    if (uniqueRequestedFileIds && uniqueRequestedFileIds.length === 0) {
      return new Map();
    }

    const messageIds = [...new Set(scopedMessages.map((message) => message.messageId).filter(Boolean))];
    const attachedFileIds = [...new Set(scopedMessages.flatMap((message) => messageFileIds(message.files)))];
    const filesQuery = File.find(fileFilter(input, messageIds, attachedFileIds, uniqueRequestedFileIds))
      .select({
        file_id: 1,
        filename: 1,
        type: 1,
        bytes: 1,
        source: 1,
        filepath: 1,
        storageKey: 1,
        storageRegion: 1,
        model: 1,
        conversationId: 1,
        messageId: 1,
      });
    if (session) {
      filesQuery.session(session);
    }
    const files = await filesQuery.lean<SteelReviewAuthorizedFile[]>();
    const candidateGroups = groupByFileId(files);
    const uniqueCandidates = new Map<string, SteelReviewAuthorizedFile>();
    for (const [fileId, group] of candidateGroups) {
      if (group.length === 1) {
        uniqueCandidates.set(fileId, group[0]);
      }
    }
    if (uniqueCandidates.size === 0) {
      return new Map();
    }

    const legacyFileIds = [...uniqueCandidates.values()]
      .filter((file) => file.conversationId == null)
      .map((file) => file.file_id);
    if (legacyFileIds.length === 0) {
      return uniqueCandidates;
    }

    const legacyMessageIds = [...new Set([...uniqueCandidates.values()].flatMap((file) => (
      file.conversationId == null && file.messageId ? [file.messageId] : []
    )))];
    const globalLegacyFilesQuery = File.find({
      $and: [
        { user: input.userId, file_id: { $in: legacyFileIds } },
        tenantFilter(input.tenantId),
        activeExpirationFilter(),
      ],
    }).select({ file_id: 1, filename: 1, type: 1, bytes: 1, source: 1, filepath: 1, storageKey: 1, storageRegion: 1, model: 1, conversationId: 1, messageId: 1 });
    const messageAnchorsQuery = legacyMessageIds.length > 0
      ? Message.find({
        $and: [
          { user: input.userId, messageId: { $in: legacyMessageIds } },
          tenantFilter(input.tenantId),
          activeExpirationFilter(),
        ],
      }).select({ messageId: 1, conversationId: 1, user: 1, files: 1 })
      : undefined;
    const attachmentAnchorsQuery = Message.find({
      $and: [
        { user: input.userId, 'files.file_id': { $in: legacyFileIds } },
        tenantFilter(input.tenantId),
        activeExpirationFilter(),
      ],
    }).select({ messageId: 1, conversationId: 1, user: 1, files: 1 });
    if (session) {
      globalLegacyFilesQuery.session(session);
      messageAnchorsQuery?.session(session);
      attachmentAnchorsQuery.session(session);
    }
    const [globalLegacyFiles, messageAnchors, attachmentAnchors] = await Promise.all([
      globalLegacyFilesQuery.lean<SteelReviewAuthorizedFile[]>(),
      messageAnchorsQuery
        ? messageAnchorsQuery.lean<ScopedMessage[]>()
        : Promise.resolve([] as ScopedMessage[]),
      attachmentAnchorsQuery.lean<ScopedMessage[]>(),
    ]);
    const globalGroups = groupByFileId(globalLegacyFiles);
    const authorized = new Map<string, SteelReviewAuthorizedFile>();
    for (const [fileId, candidate] of uniqueCandidates) {
      if (candidate.conversationId != null) {
        authorized.set(fileId, candidate);
        continue;
      }
      const globalGroup = globalGroups.get(fileId);
      if (!globalGroup || globalGroup.length !== 1) {
        continue;
      }
      const globalFile = globalGroup[0];
      const conversations = new Set<string>();
      for (const message of attachmentAnchors) {
        if (messageFileIds(message.files).includes(fileId)) {
          conversations.add(message.conversationId);
        }
      }
      if (globalFile.messageId) {
        const resolvedMessages = messageAnchors.filter((message) => message.messageId === globalFile.messageId);
        if (resolvedMessages.length === 1) {
          conversations.add(resolvedMessages[0].conversationId);
        } else if (resolvedMessages.length > 1) {
          continue;
        }
      }
      if (hasOnlyRequestedConversation(conversations, input.conversationId)) {
        authorized.set(fileId, globalFile);
      }
    }
    return authorized;
  };
}
