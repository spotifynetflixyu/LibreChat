import { ContentTypes } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';

import { getPersistedSteelPreflightToolCallParts } from './steel';

describe('persisted Steel preflight tool calls', () => {
  it('renders persisted price-search arguments and output through the native tool card', () => {
    const args = {
      queries: [{ categories: ['鐵板'], materials: ['黑鐵'], thicknessMm: ['1.5'] }],
    };
    const output = JSON.stringify({
      ok: true,
      toolName: 'search_price_candidates',
      data: { queryResults: [{ queryId: 'q1', candidates: [] }] },
    });

    const parts = getPersistedSteelPreflightToolCallParts({
      steel: {
        preflightToolCalls: [
          {
            type: 'tool_call',
            id: 'quotation-run-1-chunk-0-attempt-1-call-1',
            name: 'steel_search_price_candidates',
            args,
            output,
            progress: 1,
          },
        ],
      },
    } as TMessage['metadata']);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: ContentTypes.TOOL_CALL,
      tool_call: {
        id: 'quotation-run-1-chunk-0-attempt-1-call-1',
        name: 'steel_search_price_candidates',
        args,
        output,
        runStepStatus: 'completed',
        progress: 1,
      },
    });
  });
});
