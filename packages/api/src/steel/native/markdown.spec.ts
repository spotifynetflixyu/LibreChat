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

  it('checks both fields for the requested saved Markdown section without duplicating it', () => {
    const order = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| 文字訂單 | 1 |';
    expect(extractSteelNativeMarkdownText({
      text: '請確認訂單。', content: [{ type: 'text', text: order }], sectionTitle: 'ocr_result',
    })).toBe(order);
    expect(extractSteelNativeMarkdownText({
      text: order, content: [{ type: 'text', text: order }], sectionTitle: 'ocr_result',
    })).toBe(order);
    expect(extractSteelNativeMarkdownText({
      text: order, content: [{ type: 'text', text: '請確認訂單。' }], sectionTitle: 'ocr_result',
    })).toBe(order);
  });

  it('selects complete correction content when text only contains a summary', () => {
    const correction = '說明\n\n## ocr_result_updates\n\n| 來源 | 零件編號 | 數量 |\n| --- | --- | --- |\n| F1 | P1 | 1 |\n\n尾註';
    expect(extractSteelNativeMarkdownText({
      text: '請確認訂單。',
      content: [{ type: 'text', text: correction.slice(0, 20) }, { type: 'text', text: correction.slice(20) }],
      sectionTitles: ['ocr_result_updates', 'ocr_result'],
    })).toBe(correction);
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
