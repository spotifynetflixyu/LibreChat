import type {
  SteelReviewResponse,
  SteelReviewSavedSnapshot,
  TMessage,
} from 'librechat-data-provider';
import { applySteelReviewSnapshotToMessages, applySteelReviewSnapshotToResponse } from './cache';

const snapshot = {
  operationId: 'operation-1',
  digest: 'a'.repeat(64),
  outputId: 'ocr_result:output-1',
  revision: 'revision-2',
  headers: ['品名'],
  rows: [
    {
      rowId: 'row-1',
      source: null,
      values: { 品名: { baseline: '鋼板', effective: '鍍鋅鋼板' } },
    },
  ],
  changedRows: 1,
  changedRowIds: ['row-1'],
  savedAt: '2026-10-03T00:00:00.000Z',
  messageSha256: 'b'.repeat(64),
  conversationId: 'conversation-1',
  messageId: 'message-1',
  messageText: 'saved full message',
  messageTextParts: [{ partIndex: 1, text: 'saved table part' }],
  effectiveMarkdown: 'saved effective markdown',
  displayMarkdown: 'saved display markdown',
  ownerUpdated: {
    version: 1,
    kind: 'ocr_result',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    title: 'ocr_result',
    outputId: 'ocr_result:output-1',
    revision: 'revision-2',
    effectiveVersion: 2,
    updatedAt: '2026-10-03T00:00:00.000Z',
  },
} satisfies SteelReviewSavedSnapshot;

describe('Steel review confirmed snapshot cache', () => {
  it('updates only the exact message and text part while preserving other content and owners', () => {
    const otherMetadata = { steelReview: { system_order: { state: 'untouched' } } };
    const messages = [
      {
        messageId: 'message-1',
        text: 'old full message',
        content: [
          { type: 'text', text: 'prefix' },
          { type: 'text', text: 'old table part' },
          { type: 'image_url', image_url: { url: 'image' } },
        ],
        metadata: otherMetadata,
      },
      { messageId: 'message-2', text: 'other message' },
    ] as unknown as TMessage[];

    const updated = applySteelReviewSnapshotToMessages(messages, 'ocr_result', snapshot);

    expect(updated?.[0]).toMatchObject({
      messageId: 'message-1',
      text: 'saved full message',
      content: [
        { type: 'text', text: 'prefix' },
        { type: 'text', text: 'saved table part' },
        { type: 'image_url', image_url: { url: 'image' } },
      ],
      metadata: {
        steelReview: {
          system_order: { state: 'untouched' },
          ocr_result: snapshot.ownerUpdated,
        },
      },
    });
    expect(updated?.[0]?.metadata).not.toHaveProperty('steelQuotation');
    expect(updated?.[1]).toBe(messages[1]);
  });

  it('updates only the system_order owner while preserving quotation publication identity', () => {
    const orderSnapshot: SteelReviewSavedSnapshot = {
      ...snapshot,
      outputId: 'system_order:output-1',
      messageText: 'saved order message',
      messageTextParts: [
        { partIndex: 1, text: 'saved order table' },
        { partIndex: 2, text: 'saved order summary' },
        { partIndex: 3, text: 'saved order footer' },
      ],
      ownerUpdated: {
        ...snapshot.ownerUpdated,
        kind: 'system_order',
        outputId: 'system_order:output-1',
      },
    };
    const quotation = {
      version: 1,
      runId: 'run-1',
      outputId: 'system_order:output-1',
      sourceMessageId: 'message-1',
      receiptSha256: 'c'.repeat(64),
      admissionSequence: 4,
      tableContentIndex: 1,
      summaryContentIndex: 2,
      footerContentIndex: 3,
    };
    const updated = applySteelReviewSnapshotToMessages(
      [
        {
          messageId: 'message-1',
          text: 'old',
          content: [
            { type: 'text', text: 'old order intro' },
            { type: 'text', text: 'old order table' },
            { type: 'text', text: 'old order summary' },
            { type: 'text', text: 'old order footer' },
          ],
          metadata: { steelQuotation: quotation },
        } as unknown as TMessage,
      ],
      'system_order',
      orderSnapshot,
    );

    expect(updated?.[0]).toMatchObject({
      text: 'old order intro saved order table old order summary old order footer',
      content: [
        { type: 'text', text: 'old order intro' },
        { type: 'text', text: 'saved order table' },
        { type: 'text', text: 'old order summary' },
        { type: 'text', text: 'old order footer' },
      ],
    });
    expect(updated?.[0]?.metadata?.steelQuotation).toEqual({
      ...quotation,
      ownerUpdated: expect.objectContaining({ effectiveVersion: 2 }),
    });
  });

  it('preserves live system_order prose when a confirmed snapshot has empty non-table parts', () => {
    const orderSnapshot: SteelReviewSavedSnapshot = {
      ...snapshot,
      outputId: 'system_order:output-1',
      messageText: 'saved order table without the live summary',
      messageTextParts: [
        { partIndex: 1, text: 'saved order table' },
        { partIndex: 2, text: '' },
        { partIndex: 3, text: '' },
      ],
      ownerUpdated: {
        ...snapshot.ownerUpdated,
        kind: 'system_order',
        outputId: 'system_order:output-1',
        effectiveVersion: 2,
      },
    };
    const quotation = {
      version: 1,
      runId: 'run-1',
      outputId: 'system_order:output-1',
      sourceMessageId: 'message-1',
      receiptSha256: 'c'.repeat(64),
      admissionSequence: 4,
      tableContentIndex: 1,
      summaryContentIndex: 2,
      footerContentIndex: 3,
    };
    const updated = applySteelReviewSnapshotToMessages(
      [
        {
          messageId: 'message-1',
          text: 'streamed order response',
          content: [
            { type: 'text', text: 'live order intro' },
            { type: 'text', text: 'old order table' },
            { type: 'text', text: 'live order summary' },
            { type: 'text', text: 'live order footer' },
          ],
          metadata: { steelQuotation: quotation },
        } as unknown as TMessage,
      ],
      'system_order',
      orderSnapshot,
    );

    expect(updated?.[0]).toMatchObject({
      text: 'live order intro saved order table live order summary live order footer',
      content: [
        { type: 'text', text: 'live order intro' },
        { type: 'text', text: 'saved order table' },
        { type: 'text', text: 'live order summary' },
        { type: 'text', text: 'live order footer' },
      ],
      metadata: {
        steelQuotation: {
          ...quotation,
          ownerUpdated: expect.objectContaining({ effectiveVersion: 2 }),
        },
      },
    });
  });

  it('preserves a published message when the confirmation owner version is missing', () => {
    const { ownerUpdated: _ownerUpdated, ...snapshotWithoutOwner } = snapshot;
    const orderSnapshot = {
      ...snapshotWithoutOwner,
      outputId: 'system_order:output-1',
      messageText: 'should not replace the live response',
      messageTextParts: [{ partIndex: 1, text: 'stale saved table' }],
    } satisfies SteelReviewSavedSnapshot;
    const quotation = {
      version: 1,
      runId: 'run-1',
      outputId: 'system_order:output-1',
      sourceMessageId: 'message-1',
      receiptSha256: 'c'.repeat(64),
      admissionSequence: 4,
      tableContentIndex: 1,
      summaryContentIndex: 2,
      footerContentIndex: 3,
    };
    const message = {
      messageId: 'message-1',
      text: 'current live response',
      content: [
        { type: 'text', text: 'live intro' },
        { type: 'text', text: 'current table' },
        { type: 'text', text: 'live summary' },
        { type: 'text', text: 'live footer' },
      ],
      metadata: { steelQuotation: quotation },
    } as unknown as TMessage;

    const updated = applySteelReviewSnapshotToMessages(
      [message],
      'system_order',
      orderSnapshot,
    );

    expect(updated?.[0]).toBe(message);
  });

  it('does not replace a newer local system_order owner with an older snapshot', () => {
    const orderSnapshot: SteelReviewSavedSnapshot = {
      ...snapshot,
      outputId: 'system_order:output-1',
      messageTextParts: [{ partIndex: 1, text: 'stale saved order table' }],
      ownerUpdated: {
        ...snapshot.ownerUpdated,
        kind: 'system_order',
        outputId: 'system_order:output-1',
        effectiveVersion: 2,
      },
    };
    const quotation = {
      version: 1,
      runId: 'run-1',
      outputId: 'system_order:output-1',
      sourceMessageId: 'message-1',
      receiptSha256: 'c'.repeat(64),
      admissionSequence: 4,
      tableContentIndex: 1,
      summaryContentIndex: 2,
      footerContentIndex: 3,
      ownerUpdated: { effectiveVersion: 3 },
    };
    const message = {
      messageId: 'message-1',
      text: 'current order response',
      content: [
        { type: 'text', text: 'current intro' },
        { type: 'text', text: 'current table' },
        { type: 'text', text: 'current summary' },
        { type: 'text', text: 'current footer' },
      ],
      metadata: { steelQuotation: quotation },
    } as unknown as TMessage;

    const updated = applySteelReviewSnapshotToMessages(
      [message],
      'system_order',
      orderSnapshot,
    );

    expect(updated?.[0]).toBe(message);
  });

  it('does not apply a delayed snapshot from an older system_order output', () => {
    const orderSnapshot: SteelReviewSavedSnapshot = {
      ...snapshot,
      outputId: 'system_order:output-1',
      messageTextParts: [{ partIndex: 1, text: 'delayed old table' }],
      ownerUpdated: {
        ...snapshot.ownerUpdated,
        kind: 'system_order',
        outputId: 'system_order:output-1',
        effectiveVersion: 5,
      },
    };
    const message = {
      messageId: 'message-1',
      text: 'current newer order response',
      content: [
        { type: 'text', text: 'current intro' },
        { type: 'text', text: 'current newer table' },
        { type: 'text', text: 'current summary' },
        { type: 'text', text: 'current footer' },
      ],
      metadata: {
        steelQuotation: {
          version: 1,
          runId: 'run-2',
          outputId: 'system_order:output-2',
          sourceMessageId: 'message-1',
          receiptSha256: 'd'.repeat(64),
          admissionSequence: 5,
          tableContentIndex: 1,
          summaryContentIndex: 2,
          footerContentIndex: 3,
        },
      },
    } as unknown as TMessage;

    const updated = applySteelReviewSnapshotToMessages(
      [message],
      'system_order',
      orderSnapshot,
    );

    expect(updated?.[0]).toBe(message);
  });

  it('does not fabricate quotation identity for a legacy system_order message', () => {
    const orderSnapshot: SteelReviewSavedSnapshot = {
      ...snapshot,
      outputId: 'system_order:legacy-output',
      ownerUpdated: {
        ...snapshot.ownerUpdated,
        kind: 'system_order',
        outputId: 'system_order:legacy-output',
      },
    };
    const updated = applySteelReviewSnapshotToMessages(
      [
        {
          messageId: 'message-1',
          text: 'old',
          metadata: {
            steelReview: {
              system_order: { effectiveVersion: 3 },
            },
          },
        } as unknown as TMessage,
      ],
      'system_order',
      orderSnapshot,
    );

    expect(updated?.[0]?.metadata).not.toHaveProperty('steelQuotation');
    expect(updated?.[0]?.metadata?.steelReview).toMatchObject({
      system_order: { effectiveVersion: 2 },
    });
  });

  it('applies a confirmed snapshot only to the matching live review owner', () => {
    const response = {
      table: {
        conversationId: snapshot.conversationId,
        messageId: snapshot.messageId,
        title: 'ocr_result',
        outputId: snapshot.outputId,
        kind: 'ocr_result' as const,
        revision: 'revision-1',
        latestOutputId: snapshot.outputId,
        isLatest: true,
        readOnly: false,
        headers: snapshot.headers,
        rows: snapshot.rows,
      },
    } as SteelReviewResponse;

    const updated = applySteelReviewSnapshotToResponse(response, snapshot);
    const foreign = applySteelReviewSnapshotToResponse(
      { ...response, table: { ...response.table!, messageId: 'message-2' } },
      snapshot,
    );

    expect(updated?.table).toMatchObject({
      revision: 'revision-2',
      rows: snapshot.rows,
      humanSavedAt: snapshot.savedAt,
      updated: true,
      previousVersion: false,
    });
    expect(foreign).toEqual({ ...response, table: { ...response.table!, messageId: 'message-2' } });
  });
});
