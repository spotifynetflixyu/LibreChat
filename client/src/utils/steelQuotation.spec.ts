import { ContentTypes } from 'librechat-data-provider';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';
import {
  mergeSteelQuotationMainSnapshot,
  mergeSteelQuotationMessageUpdate,
} from './steelQuotation';

const publication = {
  version: 1 as const,
  runId: 'run-1',
  outputId: 'system_order:run-1',
  sourceMessageId: 'response-1',
  receiptSha256: 'a'.repeat(64),
  admissionSequence: 1,
  tableContentIndex: 0,
  summaryContentIndex: 1,
  footerContentIndex: 2,
};

const message = (overrides: Partial<TMessage> = {}): TMessage => ({
  messageId: 'response-1',
  conversationId: 'conversation-1',
  parentMessageId: 'user-1',
  isCreatedByUser: false,
  sender: 'Assistant',
  text: '',
  content: [],
  ...overrides,
});

const text = (value: string): TMessageContentParts => ({
  type: ContentTypes.TEXT,
  text: value,
});

const error = (value: string): TMessageContentParts => ({
  type: ContentTypes.ERROR,
  error: value,
});

describe('Steel quotation message partitions', () => {
  it('waits for the matching committed order before accepting a summary', () => {
    const current = message();
    expect(mergeSteelQuotationMessageUpdate(current, {
      message: message({ content: [text('table'), text('summary'), text('footer')] }),
      publication, update: 'summary',
    })).toBe(current);
    const order = mergeSteelQuotationMessageUpdate(current, {
      message: message({ content: [text('table'), text(''), text('')] }),
      publication, update: 'order',
    });
    expect(order.content?.[0]).toEqual(text('table'));
  });

  it('loads a newer human version on a committed order replay with the same receipt', () => {
    const current = message({ metadata: {
      steelQuotation: publication,
      steelReview: { system_order: { outputId: publication.outputId, effectiveVersion: 2 } },
    }, content: [text('v2 table'), text('live summary'), text('footer')] });
    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: message({ metadata: {
        steelReview: { system_order: { outputId: publication.outputId, effectiveVersion: 3 } },
      }, content: [text('v3 table'), text('saved summary'), text('footer')] }),
      publication, update: 'order',
    });
    expect(updated.content?.[0]).toEqual(text('v3 table'));
    expect(updated.metadata).toMatchObject({ steelReview: { system_order: { effectiveVersion: 3 } } });
  });

  it('keeps publication identity coherent until a newer stripped snapshot receives its order event', () => {
    const current = message({ metadata: { steelQuotation: publication },
      content: [text('old table'), text('old summary'), text('old footer')] });
    const newer = { ...publication, admissionSequence: 2, receiptSha256: 'd'.repeat(64) };
    const pending = mergeSteelQuotationMainSnapshot(current, message({
      metadata: { steelQuotation: newer }, content: [text(''), text('new summary'), text('')],
    }));
    expect(pending).toBe(current);
    const committed = mergeSteelQuotationMessageUpdate(pending, {
      message: message({ content: [text('new table'), text(''), text('')] }),
      publication: newer, update: 'order',
    });
    expect(committed.content).toEqual([text('new table'), text(''), text('')]);
    expect(committed.metadata).toMatchObject({ steelQuotation: newer });
  });

  it('replaces obsolete partitions when a newer order publication arrives', () => {
    const orderPublication = { ...publication, admissionSequence: 2 };
    const current = message({
      metadata: {
        steelQuotation: {
          ...publication,
          outputId: 'system_order:old',
          receiptSha256: 'b'.repeat(64),
        },
      },
      content: [
        text('old table'),
        text('live summary'),
        { type: ContentTypes.TOOL_CALL, tool_call: { id: 'tool-1', name: 'lookup', args: '{}' } },
      ],
    });
    const incoming = message({
      text: 'new table',
      content: [text('new table'), text('unused summary'), text('unused footer')],
    });

    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: incoming,
      publication: orderPublication,
      update: 'order',
    });

    expect(updated.content).toEqual([
      text('new table'),
      text('unused summary'),
      text('unused footer'),
    ]);
    expect(updated.metadata).toMatchObject({ steelQuotation: orderPublication });
    expect(updated.text).toBe('new table unused summary unused footer');
  });

  it('ignores a delayed AI order event after a human owner has advanced to v2', () => {
    const current = message({
      metadata: {
        steelQuotation: {
          ...publication,
          receiptSha256: 'b'.repeat(64),
        },
        steelReview: {
          system_order: {
            outputId: publication.outputId,
            effectiveVersion: 2,
          },
        },
      },
      content: [text('human table'), text('summary')],
    });

    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: message({ content: [text('AI v1 table'), text('AI summary')] }),
      publication,
      update: 'order',
    });

    expect(updated).toBe(current);
  });

  it('lets a newer quotation admission reset an older human version', () => {
    const current = message({
      metadata: {
        steelQuotation: { ...publication, outputId: 'system_order:old' },
        steelReview: {
          system_order: { outputId: 'system_order:old', effectiveVersion: 4 },
        },
      },
      content: [text('old human table'), text('old summary')],
    });
    const nextPublication = {
      ...publication,
      admissionSequence: 2,
      outputId: 'system_order:new',
      receiptSha256: 'c'.repeat(64),
    };

    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: message({ content: [text('new table'), text('new summary')] }),
      publication: nextPublication,
      update: 'order',
    });

    expect(updated).not.toBe(current);
    expect(updated.content?.[0]).toEqual(text('new table'));
  });

  it('rejects an older admission even when its output identity differs', () => {
    const current = message({
      metadata: {
        steelQuotation: { ...publication, admissionSequence: 3 },
      },
      content: [text('current table')],
    });

    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: message({ content: [text('stale table')] }),
      publication: {
        ...publication,
        admissionSequence: 2,
        outputId: 'system_order:stale',
        receiptSha256: 'd'.repeat(64),
      },
      update: 'order',
    });

    expect(updated).toBe(current);
  });

  it('updates summary and footer partitions while retaining the latest table', () => {
    const current = message({
      metadata: { steelQuotation: { ...publication, ownerUpdated: { effectiveVersion: 3 } } },
      content: [text('human table'), text('old summary'), text('old footer')],
    });
    const incoming = message({
      content: [text('stale AI table'), text('new summary'), text('new footer')],
    });

    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: incoming,
      publication: { ...publication, summaryReceiptSha256: 'c'.repeat(64) },
      update: 'summary',
    });

    expect(updated.content).toEqual([text('human table'), text('new summary'), text('new footer')]);
    expect(updated.metadata).toMatchObject({
      steelQuotation: { ownerUpdated: { effectiveVersion: 3 } },
    });
  });

  it('does not treat a summary event with the order receipt as a duplicate order event', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [text('table'), text('old summary'), text('old footer')],
    });
    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: message({ content: [text('stale table'), text('new summary'), text('new footer')] }),
      publication,
      update: 'summary',
    });

    expect(updated.content).toEqual([text('table'), text('new summary'), text('new footer')]);
  });

  it('rejects a summary from an older admission after a newer order is current', () => {
    const currentPublication = {
      ...publication,
      admissionSequence: 2,
      receiptSha256: 'b'.repeat(64),
      outputId: 'system_order:new',
    };
    const current = message({
      metadata: { steelQuotation: currentPublication },
      content: [text('new table'), text('current summary'), text('current footer')],
    });
    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: message({ content: [text('old table'), text('old summary'), text('old footer')] }),
      publication: {
        ...publication,
        outputId: 'system_order:old',
        receiptSha256: 'a'.repeat(64),
        admissionSequence: 1,
      },
      update: 'summary',
    });

    expect(updated).toBe(current);
  });

  it('protects the table when a terminal main snapshot arrives from an older stream copy', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [text('human table'), text('live summary'), text('committed footer')],
    });
    const updated = mergeSteelQuotationMainSnapshot(
      current,
      message({
        content: [text('AI table'), text('terminal summary'), text('')],
      }),
    );

    expect(updated.content).toEqual([
      text('human table'),
      text('terminal summary'),
      text('committed footer'),
    ]);
  });

  it('protects the reviewed table across a delta and the terminal main snapshot', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [text('reviewed table'), text('live summary'), text('committed footer')],
    });
    const delta = mergeSteelQuotationMainSnapshot(
      current,
      message({
        metadata: { steelQuotation: publication },
        content: [text('stale delta table'), text('delta summary'), text('')],
      }),
    );
    const terminal = mergeSteelQuotationMainSnapshot(
      delta,
      message({ content: [text('stale terminal table'), text('terminal summary'), text('')] }),
    );

    expect(delta.content?.[0]).toEqual(text('reviewed table'));
    expect(terminal.content).toEqual([
      text('reviewed table'),
      text('terminal summary'),
      text('committed footer'),
    ]);
  });

  it('preserves canonical review and markdown owner metadata while merging an order event', () => {
    const currentPublication = {
      ...publication,
      outputId: 'system_order:current',
      receiptSha256: 'e'.repeat(64),
    };
    const nextPublication = {
      ...currentPublication,
      admissionSequence: 2,
      receiptSha256: 'f'.repeat(64),
    };
    const current = message({
      metadata: {
        steelQuotation: currentPublication,
        steelReview: {
          system_order: { outputId: currentPublication.outputId, effectiveVersion: 2 },
        },
        steelMarkdownOwners: { system_order: { outputId: currentPublication.outputId } },
      },
      content: [text('old table')],
    });
    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: message({
        metadata: {
          steelReview: {
            system_order: { outputId: currentPublication.outputId, effectiveVersion: 2 },
          },
          extra: 'incoming',
        },
        content: [text('new table')],
      }),
      publication: nextPublication,
      update: 'order',
    });

    expect(updated.metadata).toMatchObject({
      extra: 'incoming',
      steelReview: { system_order: { effectiveVersion: 2 } },
      steelMarkdownOwners: { system_order: { outputId: currentPublication.outputId } },
    });
  });

  it('preserves newer same-output owners from the current cache on a main snapshot', () => {
    const current = message({
      metadata: {
        steelQuotation: { ...publication, ownerUpdated: { effectiveVersion: 2 } },
        steelReview: { system_order: { outputId: publication.outputId, effectiveVersion: 2 } },
        steelMarkdownOwners: {
          system_order: { outputId: publication.outputId, effectiveVersion: 2 },
        },
      },
      content: [text('human table'), text('human summary'), text('human footer')],
    });
    const updated = mergeSteelQuotationMainSnapshot(
      current,
      message({
        metadata: {
          steelQuotation: { ...publication, ownerUpdated: { effectiveVersion: 1 } },
          steelReview: { system_order: { outputId: publication.outputId, effectiveVersion: 1 } },
          steelMarkdownOwners: {
            system_order: { outputId: publication.outputId, effectiveVersion: 1 },
          },
        },
        content: [text('AI table'), text('AI summary'), text('AI footer')],
      }),
    );

    expect(updated.metadata).toMatchObject({
      steelReview: { system_order: { effectiveVersion: 2 } },
      steelMarkdownOwners: { system_order: { effectiveVersion: 2 } },
      steelQuotation: { ownerUpdated: { effectiveVersion: 2 } },
    });
  });

  it('lets a new receipt reset a same-output human version on the next admission', () => {
    const current = message({
      metadata: {
        steelQuotation: { ...publication, ownerUpdated: { effectiveVersion: 4 } },
        steelReview: {
          system_order: { outputId: publication.outputId, effectiveVersion: 4 },
        },
      },
      content: [text('old human table')],
    });
    const incomingPublication = {
      ...publication,
      admissionSequence: 2,
      receiptSha256: 'd'.repeat(64),
    };
    const updated = mergeSteelQuotationMessageUpdate(current, {
      message: message({
        metadata: {
          steelReview: {
            system_order: { outputId: publication.outputId, effectiveVersion: 1 },
          },
        },
        content: [text('new table')],
      }),
      publication: incomingPublication,
      update: 'order',
    });

    expect(updated.content?.[0]).toEqual(text('new table'));
    expect(updated.metadata).toMatchObject({
      steelReview: { system_order: { effectiveVersion: 1 } },
      steelQuotation: { receiptSha256: incomingPublication.receiptSha256 },
    });
  });

  it('does not carry a human owner into a newer publication snapshot', () => {
    const current = message({
      metadata: {
        steelQuotation: { ...publication, ownerUpdated: { effectiveVersion: 4 } },
        steelReview: {
          system_order: { outputId: publication.outputId, effectiveVersion: 4 },
        },
        steelMarkdownOwners: {
          system_order: { outputId: publication.outputId, effectiveVersion: 4 },
        },
      },
      content: [text('old human table'), text('old summary'), text('old footer')],
    });
    const updated = mergeSteelQuotationMainSnapshot(
      current,
      message({
        metadata: {
          steelQuotation: {
            ...publication,
            admissionSequence: 2,
            receiptSha256: 'd'.repeat(64),
            ownerUpdated: { effectiveVersion: 1 },
          },
          steelReview: {
            system_order: { outputId: publication.outputId, effectiveVersion: 1 },
          },
          steelMarkdownOwners: {
            system_order: { outputId: publication.outputId, effectiveVersion: 1 },
          },
        },
        content: [text('new table'), text('new summary'), text('new footer')],
      }),
    );

    expect(updated.metadata).toMatchObject({
      steelReview: { system_order: { effectiveVersion: 1 } },
      steelMarkdownOwners: { system_order: { effectiveVersion: 1 } },
      steelQuotation: { ownerUpdated: { effectiveVersion: 1 } },
    });
    expect(updated.content).toEqual([text('new table'), text('new summary'), text('new footer')]);
  });

  it('preserves a committed footer even when a terminal snapshot sends an empty slot', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [text('human table'), text('live summary'), text('committed footer')],
    });
    const updated = mergeSteelQuotationMainSnapshot(
      current,
      message({ content: [text('AI table'), text('terminal summary'), text('')] }),
    );

    expect(updated.content?.[2]).toEqual(text('committed footer'));
  });

  it('keeps committed partitions ahead of an error that collides with the table slot', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [text('reviewed table'), text('committed summary'), text('committed footer')],
    });
    const updated = mergeSteelQuotationMainSnapshot(
      current,
      message({ content: [error('quotation failed'), text('ignored summary'), text('')] }),
    );

    expect(updated.content).toEqual([
      text('reviewed table'),
      text('committed summary'),
      text('committed footer'),
      error('quotation failed'),
    ]);
  });

  it('keeps nonempty persisted summary and footer when cached slots are blank', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [text('reviewed table'), text(''), text('')],
    });
    const updated = mergeSteelQuotationMainSnapshot(
      current,
      message({
        content: [error('quotation failed'), text('persisted summary'), text('persisted footer')],
      }),
    );

    expect(updated.content).toEqual([
      text('reviewed table'),
      text('persisted summary'),
      text('persisted footer'),
      error('quotation failed'),
    ]);
  });

  it('replaces partial cached prose with the canonical terminal prose while preserving the reviewed table', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [text('reviewed table'), text('partial summary'), text('stale footer')],
    });
    const updated = mergeSteelQuotationMainSnapshot(current, message({
      metadata: { steelQuotation: publication },
      content: [text('AI table'), text('complete summary'), text('complete footer'), error('quotation failed')],
    }));
    expect(updated.content).toEqual([
      text('reviewed table'), text('complete summary'), text('complete footer'), error('quotation failed'),
    ]);
  });

  it('accepts the full canonical final message without relying on a separate summary event', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [text('reviewed table'), text('partial summary'), text('')],
    });
    const updated = mergeSteelQuotationMainSnapshot(current, message({
      metadata: { steelQuotation: publication },
      content: [text('AI table'), text('complete summary'), text('backend footer')],
    }));
    expect(updated.content).toEqual([
      text('reviewed table'), text('complete summary'), text('backend footer'),
    ]);
  });

  it('deduplicates an error repeated by saved and terminal snapshots', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [text('reviewed table'), text('committed summary'), text('committed footer')],
    });
    const saved = mergeSteelQuotationMainSnapshot(
      current,
      message({ content: [error('quotation failed'), text(''), text('')] }),
    );
    const terminal = mergeSteelQuotationMainSnapshot(
      saved,
      message({ content: [error('quotation failed'), text(''), text('')] }),
    );

    expect(terminal.content?.filter((part) => part.type === ContentTypes.ERROR)).toEqual([
      error('quotation failed'),
    ]);
  });

  it('retains a distinct error appended after an existing canonical error', () => {
    const current = message({
      metadata: { steelQuotation: publication },
      content: [
        text('reviewed table'),
        text('committed summary'),
        text('committed footer'),
        error('first failure'),
      ],
    });
    const updated = mergeSteelQuotationMainSnapshot(
      current,
      message({ content: [error('second failure'), text(''), text('')] }),
    );

    expect(updated.content?.filter((part) => part.type === ContentTypes.ERROR)).toEqual([
      error('first failure'),
      error('second failure'),
    ]);
  });

  it('keeps a full canonical error snapshot intact without cached quotation order', () => {
    const incoming = message({
      metadata: { steelQuotation: publication },
      content: [
        text('canonical table'),
        text('canonical summary'),
        text('canonical footer'),
        error('quotation failed'),
      ],
    });

    const updated = mergeSteelQuotationMainSnapshot(undefined, incoming);

    expect(updated).toBe(incoming);
    expect(updated.content).toEqual([
      text('canonical table'),
      text('canonical summary'),
      text('canonical footer'),
      error('quotation failed'),
    ]);
  });

  it('retains the reviewed owner while appending an error after the committed table', () => {
    const current = message({
      metadata: {
        steelQuotation: publication,
        steelReview: { system_order: { outputId: publication.outputId, effectiveVersion: 3 } },
      },
      content: [text('reviewed table'), text('committed summary'), text('committed footer')],
    });
    const updated = mergeSteelQuotationMainSnapshot(
      current,
      message({ content: [error('quotation failed'), text(''), text('')] }),
    );

    expect(updated.metadata).toMatchObject({
      steelReview: { system_order: { outputId: publication.outputId, effectiveVersion: 3 } },
    });
    expect(updated.content?.at(-1)).toEqual(error('quotation failed'));
  });

  it('leaves ordinary errors without quotation publication unchanged', () => {
    const incoming = message({
      text: 'ordinary failure',
      error: true,
      content: [error('ordinary failure')],
    });

    const updated = mergeSteelQuotationMainSnapshot(message(), incoming);

    expect(updated).toBe(incoming);
  });
});
