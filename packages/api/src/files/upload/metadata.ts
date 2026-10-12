import { open, readFile } from 'node:fs/promises';

import { getPdfPageCount } from '~/steel/ocr/chunks';

const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');

export type UploadFileMetadata =
  | { kind: 'not-pdf' }
  | { kind: 'pdf'; pageCount: number }
  | { kind: 'metadata-unavailable'; reason: 'pdf-parse' };

export interface UploadFileWriterFile {
  path: string;
}

export interface UploadFileWriterDeps<TFile extends { metadata?: object }, TResult> {
  file: UploadFileWriterFile;
  createFile: (file: TFile, disableTTL?: boolean) => Promise<TResult>;
  readPrefix?: (filePath: string) => Promise<Uint8Array>;
  readFile?: (filePath: string) => Promise<Uint8Array>;
  getPdfPageCount?: (input: { pdfBytes: Uint8Array }) => Promise<number>;
}

export interface UploadFileWriters<TFile extends { metadata?: object }, TResult> {
  prepareOriginalFile(): Promise<UploadFileMetadata>;
  writeOriginalFile(file: TFile, disableTTL?: boolean): Promise<TResult>;
  writeDerivedFile(file: TFile, disableTTL?: boolean): Promise<TResult>;
}

async function readPdfPrefix(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, 'r');
  const prefix = Buffer.alloc(PDF_SIGNATURE.length);
  try {
    const { bytesRead } = await handle.read(prefix, 0, PDF_SIGNATURE.length, 0);
    return prefix.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function describeUploadFile(
  filePath: string,
  readPrefix: (path: string) => Promise<Uint8Array>,
  readBytes: (path: string) => Promise<Uint8Array>,
  countPdfPages: (input: { pdfBytes: Uint8Array }) => Promise<number>,
): Promise<UploadFileMetadata> {
  const prefix = await readPrefix(filePath);
  if (Buffer.compare(Buffer.from(prefix), PDF_SIGNATURE) !== 0) {
    return { kind: 'not-pdf' };
  }

  const pdfBytes = await readBytes(filePath);
  try {
    const pageCount = await countPdfPages({ pdfBytes });
    return Number.isInteger(pageCount) && pageCount > 0
      ? { kind: 'pdf', pageCount }
      : { kind: 'metadata-unavailable', reason: 'pdf-parse' };
  } catch {
    return { kind: 'metadata-unavailable', reason: 'pdf-parse' };
  }
}

function stripPageCount<T extends object>(metadata: T | undefined): T | undefined {
  if (metadata == null || !Object.prototype.hasOwnProperty.call(metadata, 'pageCount')) {
    return metadata;
  }
  const copy = { ...metadata } as T & { pageCount?: number };
  delete copy.pageCount;
  return copy;
}

function applyMetadata<TFile extends { metadata?: object }>(
  file: TFile,
  metadata: object | undefined,
  pageCount?: number,
): TFile {
  if (metadata == null && pageCount == null) {
    const copy = { ...file } as TFile & { metadata?: object };
    delete copy.metadata;
    return copy;
  }

  const nextMetadata = pageCount == null ? metadata : { ...metadata, pageCount };
  return { ...file, metadata: nextMetadata } as TFile;
}

/**
 * Creates the two upload persistence paths. The original path receives a page count only after
 * the server has inspected the staged bytes; the derived path always removes client-supplied page
 * count metadata. The original inspection is memoized so repeated writes cannot re-read the file.
 */
export function createUploadFileWriters<TFile extends { metadata?: object }, TResult>({
  file,
  createFile,
  readPrefix: readPrefixFile = readPdfPrefix,
  readFile: readBytes = async (filePath) => readFile(filePath),
  getPdfPageCount: countPdfPages = getPdfPageCount,
}: UploadFileWriterDeps<TFile, TResult>): UploadFileWriters<TFile, TResult> {
  let metadataPromise: Promise<UploadFileMetadata> | undefined;
  const prepareOriginalFile = (): Promise<UploadFileMetadata> => {
    metadataPromise ??= describeUploadFile(file.path, readPrefixFile, readBytes, countPdfPages);
    return metadataPromise;
  };

  return {
    prepareOriginalFile,
    async writeOriginalFile(fileInfo, disableTTL = true) {
      const metadata = await prepareOriginalFile();
      const preservedMetadata = stripPageCount(fileInfo.metadata);
      const pageCount = metadata.kind === 'pdf' ? metadata.pageCount : undefined;
      return createFile(applyMetadata(fileInfo, preservedMetadata, pageCount), disableTTL);
    },
    async writeDerivedFile(fileInfo, disableTTL = true) {
      const preservedMetadata = stripPageCount(fileInfo.metadata);
      return createFile(applyMetadata(fileInfo, preservedMetadata), disableTTL);
    },
  };
}
