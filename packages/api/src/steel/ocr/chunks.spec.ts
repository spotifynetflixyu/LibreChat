import { PDFDocument } from 'pdf-lib';

import {
  buildPdfPageChunks,
  createPdfPageRangeChunk,
  createPdfPageRangeChunker,
  getPdfPageCount,
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

  it('builds default 50-page PDF chunks', () => {
    expect(buildPdfPageChunks({ pageCount: 1 })).toEqual([
      { chunkIndex: 1, chunkCount: 1, pageStart: 1, pageEnd: 1, chunkSizePages: 50 },
    ]);
    expect(buildPdfPageChunks({ pageCount: 250 })).toHaveLength(5);
    expect(buildPdfPageChunks({ pageCount: 251 })).toHaveLength(6);
    const chunks = buildPdfPageChunks({ pageCount: 251 });
    expect(chunks[chunks.length - 1]).toEqual({
      chunkIndex: 6,
      chunkCount: 6,
      pageStart: 251,
      pageEnd: 251,
      chunkSizePages: 50,
    });
  });

  it('uses STEEL_OCR_PREPROCESSING_CHUNK_SIZE_PAGES when no explicit chunk size is provided', () => {
    process.env[ocrPreprocessingChunkSizePagesEnvKey] = '25';

    expect(buildPdfPageChunks({ pageCount: 51 })).toEqual([
      { chunkIndex: 1, chunkCount: 3, pageStart: 1, pageEnd: 25, chunkSizePages: 25 },
      { chunkIndex: 2, chunkCount: 3, pageStart: 26, pageEnd: 50, chunkSizePages: 25 },
      { chunkIndex: 3, chunkCount: 3, pageStart: 51, pageEnd: 51, chunkSizePages: 25 },
    ]);
  });

  it('falls back to 50 pages when STEEL_OCR_PREPROCESSING_CHUNK_SIZE_PAGES is invalid', () => {
    process.env[ocrPreprocessingChunkSizePagesEnvKey] = 'not-a-number';

    expect(buildPdfPageChunks({ pageCount: 51 })).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 50, chunkSizePages: 50 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 51, pageEnd: 51, chunkSizePages: 50 },
    ]);
  });

  it('reads PDF page counts and creates PDF page-range chunks without rasterizing', async () => {
    const sourcePdf = await createPdfBytes(3);

    await expect(getPdfPageCount({ pdfBytes: sourcePdf })).resolves.toBe(3);

    const chunk = await createPdfPageRangeChunk({
      pdfBytes: sourcePdf,
      pageStart: 2,
      pageEnd: 3,
    });

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
