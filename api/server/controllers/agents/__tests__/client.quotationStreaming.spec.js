const { createContentAggregator } = require('@librechat/agents');
const { GenerationJobManager } = require('@librechat/api');
const AgentClient = require('../client');
const { getDefaultHandlers } = require('../callbacks');

describe('quotation text streaming', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([null, 'quotation-stream'])('routes incremental text through the real handlers (streamId=%s)', async (streamId) => {
    const { contentParts, aggregateContent, stepMap } = createContentAggregator();
    const res = { write: jest.fn(), flush: jest.fn() };
    const emitChunk = jest.spyOn(GenerationJobManager, 'emitChunk').mockResolvedValue(undefined);
    const client = {
      contentParts,
      responseMessageId: 'quote-response',
      conversationId: 'conversation',
      options: {
        agent: { id: 'agent' },
        eventHandlers: getDefaultHandlers({
          res, streamId, contentParts, aggregateContent, stepMap, collectedUsage: [],
        }),
      },
    };
    const wiring = AgentClient.prototype.buildQuotationTextWiring.call(client, {
      configurable: { hide_sequential_outputs: true },
    });
    const deltas = [
      '## system_order\norder table\n\n## customer_quote\ncustomer table',
      '\n\n## manual_reviews\n\n',
      '| partial review',
      ' row |\n\n## notes\nreview note',
      '\n\n## quote_summary\ncomplete',
    ];
    for (let index = 0; index < deltas.length; index += 1) {
      await wiring.onText(deltas[index]);
      expect(contentParts[0].text).toBe(deltas.slice(0, index + 1).join(''));
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
      id: 'quotation:quote-response', runId: 'quote-response', index: 0,
      stepDetails: { type: 'message_creation' },
    });
    expect(events[1].data.id).toBe(events[0].data.id);
    expect(events[2].data.id).toBe(events[0].data.id);
    await wiring.onFinalText(deltas.join(''));
    expect(contentParts[0].text).toBe(deltas.join(''));
    expect(contentParts[0].text.match(/## system_order/g)).toHaveLength(1);
  });

  function setup(withHandlers = true) {
    const { contentParts, aggregateContent } = createContentAggregator();
    const signal = { type: 'text', text: '## quote_signal\n\nstart' };
    const tool = { type: 'tool_call', tool_call: { id: 'lookup', name: 'search_price_candidates' } };
    contentParts.push(signal, tool);
    const handle = jest.fn(async (event, data) => aggregateContent({ event, data }));
    const client = {
      contentParts,
      responseMessageId: 'quote-response',
      conversationId: 'conversation',
      options: {
        agent: { id: 'agent' },
        eventHandlers: withHandlers ? {
          on_run_step: { handle }, on_message_delta: { handle },
        } : undefined,
      },
    };
    return { contentParts, handle, signal, tool,
      ...AgentClient.prototype.buildQuotationTextWiring.call(client, { configurable: {} }) };
  }

  it.each([true, false])('replaces the preview once and preserves tools and later text (handlers=%s)', async (withHandlers) => {
    const wiring = setup(withHandlers);
    await wiring.onText('## system_order\n');
    await wiring.onText('preview\n');
    expect(wiring.contentParts[2].text).toBe('## system_order\npreview\n');
    const final = '## system_order\nnormalized\n\n## customer_quote\ncustomer\n\n## quote_summary\ncomplete';
    await wiring.onFinalText(final);
    expect(wiring.contentParts).toHaveLength(3);
    expect(wiring.contentParts[2].text).toBe(final);
    expect(wiring.contentParts.slice(0, 2)).toEqual([wiring.signal, wiring.tool]);
    await wiring.onText('\n\nPending reply');
    expect(wiring.contentParts[2].text).toBe(`${final}\n\nPending reply`);
    expect(wiring.contentParts[2].text.match(/## system_order/g)).toHaveLength(1);
  });

  it('publishes a restored completed main result when no new stream is needed', async () => {
    const wiring = setup();
    await wiring.onFinalText('## system_order\nrestored');
    expect(wiring.contentParts[2].text).toBe('## system_order\nrestored');
    expect(wiring.handle.mock.calls.map(([event]) => event)).toEqual(['on_run_step', 'on_message_delta']);
  });
});
