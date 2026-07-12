import { buildOcrOrganizerPrompt, resolveOcrOrganizerRulesText } from './organizer';

describe('OCR organizer interface', () => {
  it('includes only the chunk-organizer section from the shared OCR rule', () => {
    const prompt = buildOcrOrganizerPrompt({
      ocrRulesText: [
        'Main-agent rerun policy.',
        '[ocr_shared]',
        'Rotate before reading and preserve Traditional Chinese.',
        '[/ocr_shared]',
        '[ocr_organizer]',
        'Preserve source rows and correct t/1 with a note.',
        'Return one chunk-local table.',
        '[/ocr_organizer]',
        'Final file-key merge policy.',
      ].join('\n'),
      file: {
        ocrFileKey: 'file:file-100',
        filename: 'quote.pdf',
      },
      chunk: {
        pipelineVersion: 1,
        sourcePdfKey: 'source.pdf',
        ocrFileKey: 'file:file-100',
        filename: 'quote.pdf',
        chunkIndex: 1,
        chunkCount: 2,
        pageStart: 1,
        pageEnd: 50,
        chunkSizePages: 50,
      },
      rawOcrText: 'RAW OCR',
    });

    expect(prompt).toContain('Preserve source rows and correct t/1 with a note.');
    expect(prompt).toContain('Return one chunk-local table.');
    expect(prompt).toContain('Rotate before reading and preserve Traditional Chinese.');
    expect(prompt).not.toContain('Main-agent rerun policy.');
    expect(prompt).not.toContain('Final file-key merge policy.');
    expect(prompt).not.toContain('[ocr_organizer]');
    expect(prompt).not.toContain('[ocr_shared]');
  });

  it('falls back to the complete rule when organizer markers are missing or invalid', () => {
    expect(resolveOcrOrganizerRulesText('Complete OCR rule')).toBe('Complete OCR rule');
    expect(resolveOcrOrganizerRulesText('[ocr_organizer]\n[/ocr_organizer]')).toBe(
      '[ocr_organizer]\n[/ocr_organizer]',
    );
    expect(resolveOcrOrganizerRulesText('[ocr_organizer]\nIncomplete')).toBe(
      '[ocr_organizer]\nIncomplete',
    );
  });

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
