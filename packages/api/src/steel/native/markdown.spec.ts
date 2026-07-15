import {
  extractSteelNativeMarkdownText,
  extractSteelNativeResponseOutputText,
} from './markdown';

import type { Response } from '../../agents/responses/types';

describe('Steel native Markdown extraction', () => {
  it('extracts text from normalized content blocks', () => {
    expect(
      extractSteelNativeMarkdownText({
        content: [
          { type: 'text', text: '| 項次 | 品名 |\n' },
          { text: { value: '| 1 | 鋼板 |\n' } },
          { type: 'tool_call', name: 'search_customers' },
        ],
      }),
    ).toBe('| 項次 | 品名 |\n| 1 | 鋼板 |\n');
  });

  it('prefers non-blank text over content blocks', () => {
    expect(
      extractSteelNativeMarkdownText({
        text: 'final text',
        content: [{ type: 'text', text: 'stale content' }],
      }),
    ).toBe('final text');
  });

  it('extracts Open Responses output text parts', () => {
    const response = {
      id: 'resp_1',
      output: [
        {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            { type: 'output_text', text: '| 項次 | 品名 |\n', annotations: [], logprobs: [] },
            { type: 'output_text', text: '| 1 | 鋼板 |\n', annotations: [], logprobs: [] },
          ],
        },
      ],
    } as Pick<Response, 'output'>;

    expect(extractSteelNativeResponseOutputText(response)).toBe(
      '| 項次 | 品名 |\n| 1 | 鋼板 |\n',
    );
  });
});
