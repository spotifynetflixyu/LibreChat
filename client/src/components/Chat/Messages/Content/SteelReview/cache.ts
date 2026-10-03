import type {
  SteelReviewKind,
  SteelReviewResponse,
  SteelReviewSavedSnapshot,
} from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function applySteelReviewSnapshotToMessages(
  messages: readonly t.TMessage[] | undefined,
  kind: SteelReviewKind,
  snapshot: SteelReviewSavedSnapshot,
): t.TMessage[] | undefined {
  if (!messages) {
    return undefined;
  }

  return messages.map((message) => {
    if (message.messageId !== snapshot.messageId) {
      return message;
    }

    const content = snapshot.messageTextParts && Array.isArray(message.content)
      ? message.content.map((part, partIndex) => {
          const savedPart = snapshot.messageTextParts?.find((candidate) => candidate.partIndex === partIndex);
          if (!savedPart || part.type !== 'text' || typeof part.text !== 'string') {
            return part;
          }
          return { ...part, text: savedPart.text };
        })
      : message.content;

    const currentMetadata = isRecord(message.metadata) ? message.metadata : {};
    const currentOwners = isRecord(currentMetadata.steelReview)
      ? currentMetadata.steelReview
      : {};
    const metadata = snapshot.ownerUpdated
      ? {
          ...currentMetadata,
          steelReview: {
            ...currentOwners,
            [kind]: snapshot.ownerUpdated,
          },
        }
      : message.metadata;

    return {
      ...message,
      text: snapshot.messageText,
      ...(content ? { content } : {}),
      ...(metadata ? { metadata } : {}),
    };
  });
}

export function applySteelReviewSnapshotToResponse(
  response: SteelReviewResponse | undefined,
  snapshot: SteelReviewSavedSnapshot,
): SteelReviewResponse | undefined {
  if (!response?.table || response.table.messageId !== snapshot.messageId ||
    response.table.outputId !== snapshot.outputId) {
    return response;
  }

  return {
    ...response,
    table: {
      ...response.table,
      revision: snapshot.revision,
      rows: snapshot.rows,
      humanSavedAt: snapshot.savedAt,
      updated: true,
      previousVersion: false,
      ...(snapshot.ownerUpdated ? { ownerUpdated: snapshot.ownerUpdated } : {}),
      effectiveMarkdown: snapshot.effectiveMarkdown,
      displayMarkdown: snapshot.displayMarkdown,
      lastSave: {
        operationId: snapshot.operationId,
        digest: snapshot.digest,
        revision: snapshot.revision,
        changedRows: snapshot.changedRows,
        changedRowIds: snapshot.changedRowIds,
        savedAt: snapshot.savedAt,
        snapshot,
      },
    },
  };
}
