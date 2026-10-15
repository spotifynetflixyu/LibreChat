import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, DynamicQueryKeys, Constants } from 'librechat-data-provider';
import type { EventSubmission, SteelQuotationMessageUpdate, TMessage } from 'librechat-data-provider';
import { isSteelQuotationMessageUpdate, mergeSteelQuotationMessageUpdate } from '~/utils/steelQuotation';

/** Streamed response ids may carry a trailing `_` placeholder suffix. */
function normalizeMessageId(id: string): string {
  return id.replace(/_+$/, '');
}

function sameMessageId(left: string, right: string): boolean {
  return left === right || normalizeMessageId(left) === normalizeMessageId(right);
}

/**
 * Applies Steel quotation `message_update` publications to the owned assistant
 * row of the current submission, queueing them until that row exists.
 */
export default function useSteelQuotationUpdates({
  getMessages,
  setMessages,
  syncStepMessage,
}: {
  getMessages: () => TMessage[] | undefined;
  setMessages: (messages: TMessage[]) => void;
  syncStepMessage: (message: TMessage) => void;
}) {
  const queryClient = useQueryClient();
  /** A committed quotation can be published before the stream's `created`
   * event has installed its assistant placeholder. Keep it local to this
   * hook/run and drain it when that owned row appears; never append a second
   * row merely to make an early publication visible. */
  const pendingSteelMessageUpdatesRef = useRef(new Map<string, SteelQuotationMessageUpdate[]>());

  const responseIdsForSubmission = useCallback((submission: EventSubmission): Set<string> => {
    const ids = new Set<string>();
    const add = (value?: string | null) => {
      if (typeof value !== 'string' || value.length === 0) return;
      ids.add(value);
      ids.add(normalizeMessageId(value));
    };
    add(submission.initialResponse?.messageId);
    add(submission.initialResponse?.responseMessageId);
    add(submission.userMessage?.responseMessageId);
    return ids;
  }, []);

  const isOwnedSteelMessageUpdate = useCallback(
    (update: SteelQuotationMessageUpdate, submission: EventSubmission): boolean => {
      const message = update.message;
      if (message.isCreatedByUser !== false || !message.messageId) return false;
      const ownedConversationIds = [
        submission.conversation?.conversationId,
        submission.userMessage?.conversationId,
        submission.initialResponse?.conversationId,
      ].filter(
        (conversationId): conversationId is string =>
          typeof conversationId === 'string' &&
          conversationId.length > 0 &&
          conversationId !== Constants.NEW_CONVO &&
          conversationId !== Constants.PENDING_CONVO,
      );
      if (
        message.conversationId &&
        ownedConversationIds.length > 0 &&
        !ownedConversationIds.includes(message.conversationId)
      ) {
        return false;
      }

      const targetIds = responseIdsForSubmission(submission);
      const targetIdsForUpdate = [message.messageId, update.publication.sourceMessageId];
      const initialTarget = targetIdsForUpdate.some(
        (id) => targetIds.has(id) || targetIds.has(normalizeMessageId(id)),
      );
      if (initialTarget) return true;

      /** A replay may address an assistant already present in the submission
       * history. This is scoped to a concrete saved conversation; a NEW or
       * PENDING submission has no conversation authority for an arbitrary id. */
      if (ownedConversationIds.length === 0) return false;
      if (
        submission.messages.some(
          (candidate) =>
            candidate.isCreatedByUser === false &&
            targetIdsForUpdate.some((id) => sameMessageId(candidate.messageId, id)),
        )
      ) {
        return true;
      }

      return false;
    },
    [responseIdsForSubmission],
  );

  const drainPendingSteelMessageUpdates = useCallback(
    (candidateMessages: TMessage[]): TMessage[] => {
      let nextMessages = candidateMessages;
      for (const [targetMessageId, updates] of pendingSteelMessageUpdatesRef.current) {
        const orderedUpdates = [...updates].sort((left, right) => {
          if (left.update !== right.update) {
            return left.update === 'order' ? -1 : 1;
          }
          return left.update === 'order'
            ? left.publication.admissionSequence - right.publication.admissionSequence
            : 0;
        });
        const targetIndex = nextMessages.findIndex(
          (candidate) =>
            sameMessageId(candidate.messageId, targetMessageId) ||
            updates.some(({ message }) => sameMessageId(candidate.messageId, message.messageId)),
        );
        if (targetIndex < 0) {
          continue;
        }

        let current = nextMessages[targetIndex];
        for (const update of orderedUpdates) {
          current = mergeSteelQuotationMessageUpdate(current, update);
        }
        pendingSteelMessageUpdatesRef.current.delete(targetMessageId);
        if (current === nextMessages[targetIndex]) {
          continue;
        }
        if (nextMessages === candidateMessages) {
          nextMessages = [...candidateMessages];
        }
        nextMessages[targetIndex] = current;
        syncStepMessage(current);
      }
      return nextMessages;
    },
    [syncStepMessage],
  );
  const queuePendingSteelMessageUpdate = useCallback((update: SteelQuotationMessageUpdate) => {
    const targetMessageId = update.publication.sourceMessageId;
    const pending = pendingSteelMessageUpdatesRef.current.get(targetMessageId) ?? [];
    const duplicate = pending.some(
      (item) =>
        item.update === update.update &&
        item.publication.runId === update.publication.runId &&
        item.publication.outputId === update.publication.outputId &&
        item.publication.sourceMessageId === update.publication.sourceMessageId &&
        item.publication.receiptSha256 === update.publication.receiptSha256 &&
        item.publication.summaryReceiptSha256 === update.publication.summaryReceiptSha256 &&
        item.publication.admissionSequence === update.publication.admissionSequence,
    );
    if (!duplicate) {
      pending.push(update);
      pendingSteelMessageUpdatesRef.current.set(targetMessageId, pending);
    }
  }, []);
  const invalidateSteelOrderPublication = useCallback(
    (update: SteelQuotationMessageUpdate, submission: EventSubmission) => {
      if (update.update !== 'order') return;
      const conversationId =
        update.message.conversationId ??
        [
          submission.conversation?.conversationId,
          submission.userMessage?.conversationId,
          submission.initialResponse?.conversationId,
        ].find(
          (value): value is string =>
            typeof value === 'string' &&
            value.length > 0 &&
            value !== Constants.NEW_CONVO &&
            value !== Constants.PENDING_CONVO,
        );
      if (!conversationId) return;
      void queryClient.invalidateQueries(DynamicQueryKeys.steelMarkdownVersions(conversationId));
      void queryClient.invalidateQueries(DynamicQueryKeys.steelQuotationStatus(conversationId));
      /** Steel review keys include kind/message/title, while a publication
       * carries only the committed message snapshot. The conversation prefix
       * refreshes the system_order owner without guessing those display keys. */
      void queryClient.invalidateQueries([QueryKeys.steelReview, conversationId]);
    },
    [queryClient],
  );
  const messageUpdateHandler = useCallback(
    (data: unknown, submission: EventSubmission) => {
      if (!isSteelQuotationMessageUpdate(data)) {
        return;
      }
      const { message } = data;
      if (!isOwnedSteelMessageUpdate(data, submission)) {
        return;
      }
      invalidateSteelOrderPublication(data, submission);

      const liveMessages = getMessages();
      const cachedMessages = message.conversationId
        ? queryClient.getQueryData<TMessage[]>([QueryKeys.messages, message.conversationId])
        : undefined;
      let currentMessages = liveMessages?.some(
        (candidate) =>
          candidate.messageId === message.messageId ||
          candidate.messageId === data.publication.sourceMessageId,
      )
        ? liveMessages
        : (cachedMessages ?? liveMessages);
      if (!currentMessages) {
        queuePendingSteelMessageUpdate(data);
        return;
      }
      currentMessages = drainPendingSteelMessageUpdates(currentMessages);
      const current = currentMessages?.find(
        (candidate) =>
          sameMessageId(candidate.messageId, message.messageId) ||
          sameMessageId(candidate.messageId, data.publication.sourceMessageId),
      );
      // The publication must never create a second assistant row before the
      // response step/created event has established the owned row.
      if (!current) {
        queuePendingSteelMessageUpdate(data);
        return;
      }

      const merged = mergeSteelQuotationMessageUpdate(current, data);
      if (merged === current) {
        return;
      }
      const nextMessages = currentMessages.map((candidate) =>
        candidate.messageId === current.messageId ? merged : candidate,
      );
      setMessages(nextMessages);
      if (message.conversationId) {
        queryClient.setQueryData<TMessage[]>(
          [QueryKeys.messages, message.conversationId],
          nextMessages,
        );
      }
      syncStepMessage(merged);
    },
    [
      getMessages,
      isOwnedSteelMessageUpdate,
      invalidateSteelOrderPublication,
      queuePendingSteelMessageUpdate,
      queryClient,
      drainPendingSteelMessageUpdates,
      setMessages,
      syncStepMessage,
    ],
  );

  return { messageUpdateHandler, drainPendingSteelMessageUpdates };
}
