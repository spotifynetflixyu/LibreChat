import type { SteelMarkdownHistoryMessage } from './history';
import { prepareSteelMarkdownHistory, projectSteelMarkdownHistory } from './history';

const reference = (title: string, kind: 'ocr_result' | 'system_order') => ({
  kind,
  source: 'ai' as const,
  snapshotId: `${kind}:generation:ai`,
  generationId: 'generation',
  outputId: `${kind}:generation`,
  messageId: 'assistant-1',
  title,
  revision: 'generation',
  sha256: 'a'.repeat(64),
  lineageId: 'lineage',
  savedAt: new Date('2026-01-01T00:00:00.000Z'),
});

describe('Steel provider Markdown history projection', () => {
  it('omits cancelled assistant data while keeping ordinary content and user examples', async () => {
    const text = 'explanation\n\n## ocr_result\n\n| partial |\n| --- |\n| 2 |\n\n## notes\n\nkeep';
    const reader = { readSteelMarkdownHistory: jest.fn() };
    const user: SteelMarkdownHistoryMessage = { messageId: 'user', text, isCreatedByUser: true, unfinished: true };
    const assistant: SteelMarkdownHistoryMessage = { messageId: 'assistant', text, isCreatedByUser: false, unfinished: true,
      content: [{ type: 'text', text }, { type: 'tool_call', id: 'keep' }] };
    const messages = await prepareSteelMarkdownHistory({ scope: { userId: 'user', conversationId: 'conversation' },
      messages: [user, assistant], reader });
    expect(messages[0]).toBe(user);
    expect(messages[1].text).toBe('explanation\n\n## notes\n\nkeep');
    expect(messages[1].content).toEqual([{ type: 'text', text: 'explanation\n\n## notes\n\nkeep' }, { type: 'tool_call', id: 'keep' }]);
    expect(reader.readSteelMarkdownHistory).not.toHaveBeenCalled();
  });
  it('replaces only bound managed sections and preserves unrelated parts and files', () => {
    const messages = [{
      messageId: 'assistant-1',
      text: 'answer\n\n## ocr_result\n\n| old |\n| --- |\n| 1 |\n\n## notes\n\nkeep',
      content: [
        { type: 'text', text: 'answer\n\n## ocr_result\n\n| old |\n| --- |\n| 1 |\n\n## notes\n\nkeep' },
        { type: 'tool_call', id: 'lookup', output: 'keep' },
      ],
      files: [{ file_id: 'keep.pdf' }],
    }];
    const clean = '## ocr_result\n\n| new |\n| --- |\n| 2 |';

    const projected = projectSteelMarkdownHistory(messages, [{
      messageId: 'assistant-1',
      kind: 'ocr_result',
      reference: reference('ocr_result', 'ocr_result'),
      effectiveMarkdown: clean,
    }]);

    expect(projected[0]).toEqual({
      ...messages[0],
      text: 'answer\n\n## ocr_result\n\n| new |\n| --- |\n| 2 |\n\n## notes\n\nkeep',
      content: [
        { type: 'text', text: 'answer\n\n## ocr_result\n\n| new |\n| --- |\n| 2 |\n\n## notes\n\nkeep' },
        { type: 'tool_call', id: 'lookup', output: 'keep' },
      ],
    });
  });

  it('updates multiple bound kinds in one pass and leaves fenced examples alone', () => {
    const messages = [{
      id: 'assistant-1',
      content: [{
        type: 'text',
        text: [
          '```md',
          '## ocr_result',
          '| fenced |',
          '```',
          '',
          '## ocr_result',
          '| old OCR |',
          '| --- |',
          '| 1 |',
          '',
          '## system_order｜報價',
          '| old order |',
          '| --- |',
          '| 1 |',
        ].join('\n'),
      }],
    }];
    const projected = projectSteelMarkdownHistory(messages, [
      {
        messageId: 'assistant-1',
        kind: 'ocr_result',
        reference: reference('ocr_result', 'ocr_result'),
        effectiveMarkdown: '## ocr_result\n\n| clean OCR |\n| --- |\n| 2 |',
      },
      {
        messageId: 'assistant-1',
        kind: 'system_order',
        reference: reference('system_order｜報價', 'system_order'),
        effectiveMarkdown: '## system_order｜報價\n\n| clean order |\n| --- |\n| 3 |',
      },
    ]);

    expect(projected[0].content).toEqual([{
      type: 'text',
      text: [
        '```md',
        '## ocr_result',
        '| fenced |',
        '```',
        '',
        '## ocr_result',
        '',
        '| clean OCR |',
        '| --- |',
        '| 2 |',
        '',
        '## system_order｜報價',
        '',
        '| clean order |',
        '| --- |',
        '| 3 |',
      ].join('\n'),
    }]);
  });

  it('fails closed for duplicate managed sections or an incomplete snapshot', () => {
    const messages = [{
      messageId: 'assistant-1',
      text: '## ocr_result\n\nfirst\n\n## ocr_result\n\nsecond',
    }];
    const projected = projectSteelMarkdownHistory(messages, [{
      messageId: 'assistant-1',
      kind: 'ocr_result',
      reference: reference('ocr_result', 'ocr_result'),
      effectiveMarkdown: '| missing heading |',
    }]);
    expect(projected).toEqual(messages);
  });

  it('extracts the exact managed section from a full human snapshot', () => {
    const messages = [{
      messageId: 'assistant-1',
      text: 'intro\n\n## ocr_result\n\n| old |\n| --- |\n| 1 |\n\n## notes\n\nkeep',
    }];
    const projected = projectSteelMarkdownHistory(messages, [{
      messageId: 'assistant-1',
      kind: 'ocr_result',
      reference: { ...reference('ocr_result', 'ocr_result'), source: 'human' },
      effectiveMarkdown: 'intro\n\n## ocr_result\n\n| human clean |\n| --- |\n| 3 |\n\n## notes\n\nnew note',
    }]);
    expect(projected[0].text).toBe(
      'intro\n\n## ocr_result\n\n| human clean |\n| --- |\n| 3 |\n\n## notes\n\nkeep',
    );
  });
});
