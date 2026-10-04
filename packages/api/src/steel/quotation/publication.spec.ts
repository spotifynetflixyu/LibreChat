import {
  createSteelQuotationPublicationMessageBuilder,
  projectSteelQuotationMessage,
} from './publication';

describe('Steel quotation publication message projection', () => {
  it('replaces only the reserved quotation slot and preserves the full Chat payload', () => {
    const message = {
      messageId: 'response',
      conversationId: 'conversation',
      user: 'user',
      text: 'old quotation',
      content: [
        { type: 'text', text: 'primary answer' },
        { type: 'tool_call', id: 'lookup', output: { ok: true } },
        { type: 'steer', text: 'keep this user steer' },
        { type: 'text', text: 'old quotation' },
        { type: 'reasoning', signature: 'keep this reasoning' },
      ],
      metadata: { unrelated: { retained: true }, steel: { activityEvents: ['event'] } },
    };

    const projected = projectSteelQuotationMessage({
      message,
      markdown: '## system_order\n\n| A |\n| --- |\n| 1 |',
      quotationContentIndex: 3,
    });

    expect(projected.text).toBe('primary answer ## system_order\n\n| A |\n| --- |\n| 1 |');
    expect(projected.content).toEqual([
      message.content[0],
      message.content[1],
      message.content[2],
      { type: 'text', text: '## system_order\n\n| A |\n| --- |\n| 1 |' },
      message.content[4],
    ]);
    expect(projected.metadata).toEqual(message.metadata);
    expect(message.content[3]).toEqual({ type: 'text', text: 'old quotation' });
  });

  it('adds a reserved quotation slot when the Chat host has not emitted one yet', () => {
    const projected = projectSteelQuotationMessage({
      message: {
        messageId: 'response', conversationId: 'conversation', user: 'user', text: 'primary',
        content: [{ type: 'text', text: 'primary' }, { type: 'tool_call', id: 'lookup' }],
      },
      markdown: 'final quotation',
    });

    expect(projected.text).toBe('primary final quotation');
    expect(projected.content).toEqual([
      { type: 'text', text: 'primary' },
      { type: 'tool_call', id: 'lookup' },
      { type: 'text', text: 'final quotation' },
    ]);
  });

  it('captures the settled streaming primary text and stores only normal assistant fields', async () => {
    const firstMessage = {
      type: 'message' as const,
      id: 'message-a',
      role: 'assistant' as const,
      status: 'completed' as const,
      content: [
        { type: 'output_text' as const, text: 'first', annotations: [], logprobs: [] },
        { type: 'output_text' as const, text: ' second', annotations: [], logprobs: [] },
      ],
    };
    const quotationMessage = {
      type: 'message' as const,
      id: 'message-b',
      role: 'assistant' as const,
      status: 'completed' as const,
      content: [{ type: 'output_text' as const, text: ' third', annotations: [], logprobs: [] }],
    };
    const functionCall = {
      type: 'function_call' as const,
      id: 'call-a',
      call_id: 'lookup',
      name: 'lookup',
      arguments: '{}',
      status: 'completed' as const,
    };
    const tracker = {
      items: [firstMessage, functionCall, quotationMessage],
      currentMessage: quotationMessage,
      currentContentIndex: 0,
    };
    const buildPublicationMessage = createSteelQuotationPublicationMessageBuilder({
      tracker,
      buildMessageFields: async () => ({
        sourceMessageId: 'response-a',
        conversationId: 'conversation',
        user: 'user',
        parentMessageId: null,
        isCreatedByUser: false,
        unfinished: false,
        sender: 'Agent',
        endpoint: 'agents',
        model: 'agent-1',
        finish_reason: 'stop',
        tokenCount: 12,
        processingDurationMs: 25,
        metadata: { unrelated: true },
      }),
    });
    const projected = await buildPublicationMessage({
      targetMessageId: 'response-b',
      markdown: 'final quotation',
    });

    expect(projected).toEqual({
      messageId: 'response-b',
      sourceMessageId: 'response-a',
      conversationId: 'conversation',
      user: 'user',
      parentMessageId: null,
      isCreatedByUser: false,
      unfinished: false,
      sender: 'Agent',
      endpoint: 'agents',
      model: 'agent-1',
      finish_reason: 'stop',
      tokenCount: 12,
      processingDurationMs: 25,
      metadata: { unrelated: true },
      text: 'first second third\n\nfinal quotation',
    });
    expect(projected).not.toHaveProperty('content');
    expect(tracker.items).toEqual([firstMessage, functionCall, quotationMessage]);
  });

  it('captures the nonstream aggregate once and appends the committed quotation', async () => {
    const aggregator = {
      reasoningChunks: ['reasoning'],
      textChunks: ['primary answer'],
      toolCalls: new Map([['call-1', { id: 'call-1', name: 'lookup', arguments: '{}' }]]),
      toolOutputs: new Map([['call-1', 'lookup result']]),
    };
    const buildPublicationMessage = createSteelQuotationPublicationMessageBuilder({
      aggregator,
      buildMessageFields: () => ({
        sourceMessageId: 'response-b',
        conversationId: 'conversation',
        user: 'user',
      }),
    });
    const projected = await buildPublicationMessage({
      targetMessageId: 'response-b',
      markdown: 'final quotation',
    });

    expect(projected.text).toBe('primary answer\n\nfinal quotation');
    expect(projected).not.toHaveProperty('content');
    expect(aggregator).toEqual(expect.objectContaining({
      reasoningChunks: ['reasoning'],
      textChunks: ['primary answer'],
    }));
  });

  it('retains the normal empty-prefix separator for a fresh quotation response', async () => {
    const buildPublicationMessage = createSteelQuotationPublicationMessageBuilder({
      aggregator: {
        reasoningChunks: [], textChunks: [], toolCalls: new Map(), toolOutputs: new Map(),
      },
      buildMessageFields: () => ({
        sourceMessageId: 'response', conversationId: 'conversation', user: 'user',
      }),
    });

    await expect(buildPublicationMessage({
      targetMessageId: 'response', markdown: 'final quotation',
    })).resolves.toEqual(expect.objectContaining({
      text: '\n\nfinal quotation',
    }));
  });
});
