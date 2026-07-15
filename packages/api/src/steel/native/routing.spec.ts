import { stripSteelOcrPartsFromProviderMessages } from './routing';

describe('Steel native provider file routing', () => {
  const ocrFile = {
    fileId: 'drawing.pdf',
    source: 'librechat_file_record' as const,
    mediaType: 'application/pdf',
    filename: 'drawing.pdf',
  };

  it('strips OCR files from standard provider messages but keeps text and other files', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Review these files' },
          { type: 'input_file', file_id: 'drawing.pdf', filename: 'drawing.pdf' },
          { type: 'input_file', file_id: 'data.csv', filename: 'data.csv', media_type: 'text/csv' },
        ],
      },
    ];

    expect(stripSteelOcrPartsFromProviderMessages(messages, [ocrFile])).toEqual([
      expect.objectContaining({
        content: [
          { type: 'text', text: 'Review these files' },
          { type: 'input_file', file_id: 'data.csv', filename: 'data.csv', media_type: 'text/csv' },
        ],
      }),
    ]);
  });

  it('strips image parts even when their URLs are opaque', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'https://example.test/file' } }],
      },
    ];
    expect(stripSteelOcrPartsFromProviderMessages(messages)).toEqual([
      { role: 'user', content: [] },
    ]);
  });
});
