import { buildOcrOrganizerPrompt } from './organizer';

describe('OCR organizer interface', () => {
  it('builds a minimal chunk-only organizer prompt', () => {
    const prompt = buildOcrOrganizerPrompt({
      ocrRulesText: 'OCR rules text',
      file: {
        ocrFileKey: 'file:file-100',
        fileId: 'file-100',
        filename: 'quote.pdf',
      },
      chunk: {
        pipelineVersion: 1,
        sourcePdfKey: 's3://bucket/r/prod/t/tenant/uploads/original.pdf',
        ocrFileKey: 'file:file-100',
        fileId: 'file-100',
        filename: 'quote.pdf',
        chunkIndex: 3,
        chunkCount: 5,
        pageStart: 101,
        pageEnd: 150,
        chunkSizePages: 50,
      },
      rawOcrText: 'RAW OCR CHUNK 3 ONLY',
    });

    expect(prompt).toContain('OCR rules text');
    expect(prompt).toContain('file:file-100');
    expect(prompt).toContain('quote.pdf');
    expect(prompt).toContain('pages 101-150');
    expect(prompt).toContain('RAW OCR CHUNK 3 ONLY');
    expect(prompt).not.toContain('system_order');
    expect(prompt).not.toContain('priceCandidates');
    expect(prompt).not.toContain('workbook');
  });
});
