import { collectSteelNativeInputFileReferences, collectSteelNativeMessages } from './turn';

describe('collectSteelNativeInputFileReferences', () => {
  it('prefers raw Open Responses parts and dedupes converted user files', () => {
    const files = collectSteelNativeInputFileReferences({
      conversationId: 'convo-1',
      requestInput: [
        {
          type: 'message',
          content: [
            { type: 'input_text', text: 'quote this' },
            { type: 'input_file', file_id: 'file-1', file_data: 'data:application/pdf;base64,AA' },
          ],
        },
        { type: 'function_call_output', content: [{ type: 'input_file', file_id: 'ignored' }] },
      ],
      inputMessages: [
        { role: 'user', files: [{ file_id: 'file-1', filename: 'dup.pdf' }] },
        {
          role: 'user',
          files: [{ fileId: 'file-2', filename: 'drawing.png', mediaType: 'image/png' }],
        },
        { role: 'assistant', files: [{ file_id: 'file-3' }] },
      ],
    });

    expect(files).toEqual([
      {
        fileId: 'file-1',
        mediaType: 'application/pdf',
        source: 'librechat_file_record',
        conversationId: 'convo-1',
      },
      {
        fileId: 'file-2',
        mediaType: 'image/png',
        source: 'librechat_file_record',
        conversationId: 'convo-1',
        filename: 'drawing.png',
      },
    ]);
  });
});

describe('collectSteelNativeMessages', () => {
  it('keeps conversational roles and returns the latest user turn', () => {
    const { activeHistory, currentUserTurn } = collectSteelNativeMessages([
      { role: 'system', content: 'rules' },
      { role: 'tool', content: 'skipped' },
      { role: 'user', content: [{ type: 'text', text: 'first' }], messageId: 'u1' },
      { role: 'assistant', content: 'answer' },
      {
        role: 'user',
        content: 'second',
        files: [{ file_id: 'file-1', media_type: 'application/pdf' }],
      },
    ]);

    expect(activeHistory.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(activeHistory[1]).toEqual({ role: 'user', content: 'first', messageId: 'u1' });
    expect(currentUserTurn).toEqual({
      role: 'user',
      content: 'second',
      files: [{ fileId: 'file-1', mediaType: 'application/pdf', source: 'librechat_file_record' }],
    });
  });
});
