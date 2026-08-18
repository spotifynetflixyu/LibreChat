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

  it('strips nested OpenAI file blocks for historical PDFs but keeps non-OCR documents', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Use the existing OCR table' },
          {
            type: 'file',
            file: {
              filename: 'BH.pdf',
              file_data: 'data:application/pdf;base64,cGRm',
            },
          },
          {
            type: 'file',
            file: {
              filename: 'prices.csv',
              file_data: 'data:text/csv;base64,Y29sMQ==',
            },
          },
        ],
      },
    ];

    expect(stripSteelOcrPartsFromProviderMessages(messages)).toEqual([
      expect.objectContaining({
        content: [
          { type: 'text', text: 'Use the existing OCR table' },
          {
            type: 'file',
            file: {
              filename: 'prices.csv',
              file_data: 'data:text/csv;base64,Y29sMQ==',
            },
          },
        ],
      }),
    ]);
  });
});
