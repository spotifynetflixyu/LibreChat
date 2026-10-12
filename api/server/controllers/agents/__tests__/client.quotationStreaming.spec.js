const { createContentAggregator } = require('@librechat/agents');
const { GenerationJobManager } = require('@librechat/api');
const AgentClient = require('../client');
const { getDefaultHandlers } = require('../callbacks');

const publication = {
  version: 1,
  runId: 'quote-run',
  outputId: 'system_order:quote-run',
  sourceMessageId: 'quote-response',
  receiptSha256: 'a'.repeat(64),
  admissionSequence: 1,
  tableContentIndex: 1,
  summaryContentIndex: 2,
  footerContentIndex: 3,
};

describe('quotation summary streaming', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([null, 'quotation-stream'])('streams main prose in its own slot (streamId=%s)', async (streamId) => {
    const { contentParts, aggregateContent, stepMap } = createContentAggregator();
    contentParts.push({ type: 'text', text: 'primary' });
    const res = { write: jest.fn(), flush: jest.fn() };
    const emitChunk = jest.spyOn(GenerationJobManager, 'emitChunk').mockResolvedValue(undefined);
    const client = {
      contentParts,
      stepMap,
      responseMessageId: 'quote-response',
      conversationId: 'conversation',
      options: {
        req: { user: { id: 'user' } },
        agent: { id: 'agent' },
        eventHandlers: getDefaultHandlers({
          res, streamId, contentParts, aggregateContent, stepMap, collectedUsage: [],
        }),
      },
      buildResponseMetadata: () => ({}),
    };
    const wiring = AgentClient.prototype.buildQuotationTextWiring.call(client, {
      configurable: { hide_sequential_outputs: true },
    });
    wiring.onCommittedMessage({
      messageId: 'quote-response', conversationId: 'conversation', user: 'user',
      text: '## system_order\nbackend table', metadata: { steelQuotation: publication },
    });
    const deltas = ['## manual_reviews\n\n', '| partial review', ' row |\n\n## notes\nreview note'];
    for (let index = 0; index < deltas.length; index += 1) {
      await wiring.onText(deltas[index]);
      expect(contentParts[2].text).toBe(deltas.slice(0, index + 1).join(''));
    }
    const events = streamId
      ? emitChunk.mock.calls.map(([, event]) => event)
      : res.write.mock.calls
        .flatMap(([chunk]) => String(chunk).split('\n'))
        .filter((chunk) => chunk.startsWith('data: '))
        .map((chunk) => JSON.parse(chunk.slice(6).trim()));
    expect(events.map(({ event }) => event)).toEqual([
      'on_run_step', ...deltas.map(() => 'on_message_delta'),
    ]);
    expect(events[0].data).toMatchObject({
      id: 'quotation:quote-response', runId: 'quote-response', index: 2,
      stepDetails: { type: 'message_creation' },
    });
    expect(contentParts[1].text).toBe('');
    expect(JSON.stringify(events)).not.toContain('system_order');
    expect(contentParts[3].text).toBe('');
  });

  it('builds the initial publication from the same response and preserves unrelated content', () => {
    const { contentParts } = createContentAggregator();
    const primary = { type: 'text', text: 'primary answer' };
    const tool = { type: 'tool_call', tool_call: { id: 'lookup', name: 'lookup' } };
    contentParts.push(primary, tool);
    const client = {
      contentParts,
      responseMessageId: 'source-response', conversationId: 'conversation', parentMessageId: 'parent',
      options: { req: { user: { id: 'user' } }, agent: { id: 'agent', name: 'Steel Agent' } },
      buildResponseMetadata: () => ({ traceId: 'trace' }),
    };
    const wiring = AgentClient.prototype.buildQuotationTextWiring.call(client, { configurable: {} });
    const snapshot = wiring.buildPublicationMessage({
      targetMessageId: 'canonical-response', markdown: '## system_order\nbackend table',
    });
    expect(snapshot).toMatchObject({
      messageId: 'canonical-response', sourceMessageId: 'source-response',
      conversationId: 'conversation', user: 'user', parentMessageId: 'parent',
      metadata: { traceId: 'trace' },
      content: [primary, tool, { type: 'text', text: '## system_order\nbackend table' }],
    });
    expect(contentParts).toEqual([primary, tool]);
  });
});
