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
