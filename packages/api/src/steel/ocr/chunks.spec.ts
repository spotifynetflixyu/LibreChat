import { PDFDocument } from 'pdf-lib';

import {
  buildPdfPageChunks,
  createPdfPageRangeChunker,
  getPdfPageCount,
  normalizeOcrPageChunks,
  splitOcrPageRange,
  validateOcrPageSplit,
} from './chunks';
import { ocrPreprocessingChunkSizePagesEnvKey } from './config';

async function createPdfBytes(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([200, 200]);
  }

  return pdf.save();
}

describe('OCR preprocessing PDF chunks', () => {
  const originalChunkSizeEnv = process.env[ocrPreprocessingChunkSizePagesEnvKey];

  afterEach(() => {
    if (originalChunkSizeEnv === undefined) {
      delete process.env[ocrPreprocessingChunkSizePagesEnvKey];
      return;
    }
    process.env[ocrPreprocessingChunkSizePagesEnvKey] = originalChunkSizeEnv;
  });

  it('builds default 16-page PDF chunks', () => {
    expect(buildPdfPageChunks({ pageCount: 1 })).toEqual([
      { chunkIndex: 1, chunkCount: 1, pageStart: 1, pageEnd: 1, chunkSizePages: 16 },
    ]);
    expect(buildPdfPageChunks({ pageCount: 64 })).toHaveLength(4);
    const chunks = buildPdfPageChunks({ pageCount: 65 });
    expect(chunks).toHaveLength(5);
    expect(chunks[chunks.length - 1]).toEqual({
      chunkIndex: 5,
      chunkCount: 5,
      pageStart: 65,
      pageEnd: 65,
      chunkSizePages: 16,
    });
  });

  it('uses STEEL_OCR_PREPROCESSING_CHUNK_SIZE_PAGES when no explicit chunk size is provided', () => {
    process.env[ocrPreprocessingChunkSizePagesEnvKey] = '24';

    expect(buildPdfPageChunks({ pageCount: 51 })).toEqual([
      { chunkIndex: 1, chunkCount: 3, pageStart: 1, pageEnd: 24, chunkSizePages: 24 },
      { chunkIndex: 2, chunkCount: 3, pageStart: 25, pageEnd: 48, chunkSizePages: 24 },
      { chunkIndex: 3, chunkCount: 3, pageStart: 49, pageEnd: 51, chunkSizePages: 24 },
    ]);
  });

  it('normalizes a positive odd environment chunk size to the next even value', () => {
    process.env[ocrPreprocessingChunkSizePagesEnvKey] = '25';

    expect(buildPdfPageChunks({ pageCount: 51 })).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 26, chunkSizePages: 26 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 27, pageEnd: 51, chunkSizePages: 26 },
    ]);
  });

  it('normalizes mixed historical indexes by exact page range', () => {
    expect(
      normalizeOcrPageChunks([
        { chunkIndex: 9, chunkCount: 99, pageStart: 51, pageEnd: 100, chunkSizePages: 50 },
        { chunkIndex: 4, chunkCount: 99, pageStart: 1, pageEnd: 50, chunkSizePages: 50 },
      ]),
    ).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 50, chunkSizePages: 50 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 51, pageEnd: 100, chunkSizePages: 50 },
    ]);
  });

  it('halves a failed range down to the 4-page minimum', () => {
    expect(splitOcrPageRange({ pageStart: 1, pageEnd: 16 })).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 8, chunkSizePages: 8 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 9, pageEnd: 16, chunkSizePages: 8 },
    ]);
    expect(splitOcrPageRange({ pageStart: 9, pageEnd: 16 })).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 9, pageEnd: 12, chunkSizePages: 4 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 13, pageEnd: 16, chunkSizePages: 4 },
    ]);
    expect(splitOcrPageRange({ pageStart: 1, pageEnd: 5 })).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 4, chunkSizePages: 4 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 5, pageEnd: 5, chunkSizePages: 4 },
    ]);
    expect(splitOcrPageRange({ pageStart: 13, pageEnd: 16 })).toBeUndefined();
    expect(splitOcrPageRange({ pageStart: 1, pageEnd: 1 })).toBeUndefined();
  });

  it('validates a committed split against the expected halves', () => {
    expect(
      validateOcrPageSplit({
        parent: { pageStart: 1, pageEnd: 16 },
        children: [
          { pageStart: 9, pageEnd: 16 },
          { pageStart: 1, pageEnd: 8 },
        ],
      }),
    ).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 8, chunkSizePages: 8 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 9, pageEnd: 16, chunkSizePages: 8 },
    ]);
    expect(() =>
      validateOcrPageSplit({
        parent: { pageStart: 1, pageEnd: 16 },
        children: [
          { pageStart: 1, pageEnd: 7 },
          { pageStart: 8, pageEnd: 16 },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateOcrPageSplit({
        parent: { pageStart: 1, pageEnd: 4 },
        children: [
          { pageStart: 1, pageEnd: 2 },
          { pageStart: 3, pageEnd: 4 },
        ],
      }),
    ).toThrow();
  });

  it('falls back to 16 pages when STEEL_OCR_PREPROCESSING_CHUNK_SIZE_PAGES is invalid', () => {
    process.env[ocrPreprocessingChunkSizePagesEnvKey] = 'not-a-number';

    expect(buildPdfPageChunks({ pageCount: 17 })).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 16, chunkSizePages: 16 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 17, pageEnd: 17, chunkSizePages: 16 },
    ]);
  });

  it('reads PDF page counts and creates PDF page-range chunks without rasterizing', async () => {
    const sourcePdf = await createPdfBytes(3);

    await expect(getPdfPageCount({ pdfBytes: sourcePdf })).resolves.toBe(3);

    const createChunk = await createPdfPageRangeChunker({ pdfBytes: sourcePdf });
    const chunk = await createChunk({ pageStart: 2, pageEnd: 3 });

    await expect(getPdfPageCount({ pdfBytes: chunk })).resolves.toBe(2);
  });

  it('reuses a loaded PDF when creating multiple page-range chunks', async () => {
    const sourcePdf = await createPdfBytes(4);
    const createChunk = await createPdfPageRangeChunker({ pdfBytes: sourcePdf });

    const firstChunk = await createChunk({ pageStart: 1, pageEnd: 2 });
    const secondChunk = await createChunk({ pageStart: 3, pageEnd: 4 });

    await expect(getPdfPageCount({ pdfBytes: firstChunk })).resolves.toBe(2);
    await expect(getPdfPageCount({ pdfBytes: secondChunk })).resolves.toBe(2);
  });
});
