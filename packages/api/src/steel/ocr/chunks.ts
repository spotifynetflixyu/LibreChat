import { PDFDocument } from 'pdf-lib';

import { resolveOcrPreprocessingChunkSizePages } from './config';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

const importPdfJs = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<PdfJsModule>;

export interface OcrPreprocessingPageChunk {
  chunkIndex: number;
  chunkCount: number;
  pageStart: number;
  pageEnd: number;
  chunkSizePages: number;
}

export type OcrPageRange = Pick<OcrPreprocessingPageChunk, 'pageStart' | 'pageEnd'>;

export function getOcrPageRangeKey(range: OcrPageRange): string {
  return `${range.pageStart}:${range.pageEnd}`;
}

export function getOcrPageRangePageCount(range: OcrPageRange): number {
  return range.pageEnd - range.pageStart + 1;
}

function assertOcrPageRange(range: OcrPageRange): void {
  if (!Number.isInteger(range.pageStart) || range.pageStart < 1) {
    throw new Error('OCR page range pageStart must be a positive integer');
  }
  if (!Number.isInteger(range.pageEnd) || range.pageEnd < range.pageStart) {
    throw new Error('OCR page range pageEnd must be greater than or equal to pageStart');
  }
}

/**
 * Normalizes historical chunk metadata into the effective range identity used by OCR.
 * Chunk indexes and counts are deliberately recomputed from page ranges.
 */
export function normalizeOcrPageChunks<
  T extends OcrPageRange & Partial<OcrPreprocessingPageChunk>,
>(chunks: readonly T[]): (T & OcrPreprocessingPageChunk)[] {
  const sorted = [...chunks]
    .map((chunk) => {
      assertOcrPageRange(chunk);
      const chunkSizePages = chunk.chunkSizePages ?? getOcrPageRangePageCount(chunk);
      if (!Number.isInteger(chunkSizePages) || chunkSizePages < 1) {
        throw new Error('OCR preprocessing chunk size must be a positive integer');
      }
      return { ...chunk, chunkSizePages };
    })
    .sort((left, right) => left.pageStart - right.pageStart || left.pageEnd - right.pageEnd);

  const seen = new Set<string>();
  for (let index = 0; index < sorted.length; index += 1) {
    const chunk = sorted[index];
    const key = getOcrPageRangeKey(chunk);
    if (seen.has(key)) {
      throw new Error(`Duplicate OCR page range ${chunk.pageStart}-${chunk.pageEnd}`);
    }
    seen.add(key);
    const previous = sorted[index - 1];
    if (previous && chunk.pageStart <= previous.pageEnd) {
      throw new Error(
        `Overlapping OCR page ranges ${previous.pageStart}-${previous.pageEnd} and ${chunk.pageStart}-${chunk.pageEnd}`,
      );
    }
  }

  const chunkCount = sorted.length;
  return sorted.map((chunk, index) => ({
    ...chunk,
    chunkIndex: index + 1,
    chunkCount,
    chunkSizePages: chunk.chunkSizePages,
  }));
}

export function splitOcrPageRange(
  range: OcrPageRange,
  chunkSizePages: number = resolveOcrPreprocessingChunkSizePages(),
): [OcrPreprocessingPageChunk, OcrPreprocessingPageChunk] | undefined {
  assertOcrPageRange(range);
  if (!Number.isInteger(chunkSizePages) || chunkSizePages < 2 || chunkSizePages % 2 !== 0) {
    throw new Error('OCR preprocessing chunk size must be a positive even integer');
  }
  const retryChunkSizePages = chunkSizePages / 2;
  const pageCount = getOcrPageRangePageCount(range);
  if (pageCount <= retryChunkSizePages || pageCount > chunkSizePages) {
    return undefined;
  }
  const middle = range.pageStart + retryChunkSizePages - 1;
  return [
    {
      chunkIndex: 1,
      chunkCount: 2,
      pageStart: range.pageStart,
      pageEnd: middle,
      chunkSizePages: retryChunkSizePages,
    },
    {
      chunkIndex: 2,
      chunkCount: 2,
      pageStart: middle + 1,
      pageEnd: range.pageEnd,
      chunkSizePages: retryChunkSizePages,
    },
  ];
}

export function validateOcrPageSplit(input: {
  parent: OcrPageRange & Pick<OcrPreprocessingPageChunk, 'chunkSizePages'>;
  children: readonly OcrPageRange[];
}): [OcrPageRange, OcrPageRange] {
  const expected = splitOcrPageRange(input.parent, input.parent.chunkSizePages);
  if (!expected || input.children.length !== 2) {
    throw new Error('OCR split must replace one eligible range with two contiguous retry ranges');
  }
  const actual = normalizeOcrPageChunks(input.children).map(({ pageStart, pageEnd }) => ({
    pageStart,
    pageEnd,
  }));
  const expectedRanges = expected.map(({ pageStart, pageEnd }) => ({ pageStart, pageEnd }));
  if (JSON.stringify(actual) !== JSON.stringify(expectedRanges)) {
    throw new Error('OCR split children must be the two contiguous retry ranges');
  }
  return expectedRanges as [OcrPageRange, OcrPageRange];
}

export function buildPdfPageChunks(input: {
  pageCount: number;
  chunkSizePages?: number;
}): OcrPreprocessingPageChunk[] {
  const chunkSizePages = input.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages();
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1) {
    throw new Error('PDF page count must be a positive integer');
  }
  if (!Number.isInteger(chunkSizePages) || chunkSizePages < 1) {
    throw new Error('OCR preprocessing chunk size must be a positive integer');
  }

  const chunkCount = Math.ceil(input.pageCount / chunkSizePages);

  return Array.from({ length: chunkCount }, (_, index) => {
    const pageStart = index * chunkSizePages + 1;
    const pageEnd = Math.min(input.pageCount, pageStart + chunkSizePages - 1);

    return {
      chunkIndex: index + 1,
      chunkCount,
      pageStart,
      pageEnd,
      chunkSizePages,
    };
  });
}

export async function getPdfPageCount(input: { pdfBytes: Uint8Array }): Promise<number> {
  let pdfJs: PdfJsModule;
  try {
    pdfJs = await importPdfJs('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (error) {
    if (String(error).includes('experimental-vm-modules')) {
      const pdf = await PDFDocument.load(input.pdfBytes);
      return pdf.getPageCount();
    }
    throw error;
  }
  const { getDocument } = pdfJs;
  const data = new Uint8Array(input.pdfBytes);
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;

  try {
    return pdf.numPages;
  } finally {
    await pdf.destroy();
  }
}

function assertPdfPageRange(input: { pageStart: number; pageEnd: number }) {
  if (!Number.isInteger(input.pageStart) || input.pageStart < 1) {
    throw new Error('PDF chunk pageStart must be a positive integer');
  }
  if (!Number.isInteger(input.pageEnd) || input.pageEnd < input.pageStart) {
    throw new Error('PDF chunk pageEnd must be greater than or equal to pageStart');
  }
}

async function createPdfPageRangeChunkFromDocument(input: {
  sourcePdf: PDFDocument;
  pageStart: number;
  pageEnd: number;
}): Promise<Uint8Array> {
  assertPdfPageRange(input);
  if (input.pageEnd > input.sourcePdf.getPageCount()) {
    throw new Error('PDF chunk pageEnd exceeds source PDF page count');
  }

  const chunkPdf = await PDFDocument.create();
  const pageIndices = Array.from(
    { length: input.pageEnd - input.pageStart + 1 },
    (_, index) => input.pageStart - 1 + index,
  );
  const copiedPages = await chunkPdf.copyPages(input.sourcePdf, pageIndices);

  for (const page of copiedPages) {
    chunkPdf.addPage(page);
  }

  return chunkPdf.save();
}

export async function createPdfPageRangeChunker(input: {
  pdfBytes: Uint8Array;
}): Promise<(range: { pageStart: number; pageEnd: number }) => Promise<Uint8Array>> {
  const sourcePdf = await PDFDocument.load(input.pdfBytes);
  return ({ pageStart, pageEnd }) =>
    createPdfPageRangeChunkFromDocument({
      sourcePdf,
      pageStart,
      pageEnd,
    });
}

export async function createPdfPageRangeChunk(input: {
  pdfBytes: Uint8Array;
  pageStart: number;
  pageEnd: number;
}): Promise<Uint8Array> {
  const createChunk = await createPdfPageRangeChunker({ pdfBytes: input.pdfBytes });
  return createChunk({
    pageStart: input.pageStart,
    pageEnd: input.pageEnd,
  });
}
