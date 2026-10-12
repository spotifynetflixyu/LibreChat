import { PDFDocument } from 'pdf-lib';

import { getPdfPageCount } from '~/steel/ocr/chunks';
import { createUploadFileWriters } from './metadata';

describe('upload file metadata writers', () => {
  async function makePdf(pageCount: number): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < pageCount; index += 1) {
      pdf.addPage();
    }
    return pdf.save();
  }

  it('counts the staged PDF once and keeps trusted metadata on the original writer', async () => {
    const pdfBytes = await makePdf(3);
    const readPrefix = jest.fn().mockResolvedValue(pdfBytes.subarray(0, 5));
    const readFile = jest.fn().mockResolvedValue(pdfBytes);
    const countPdfPages = jest.fn(getPdfPageCount);
    const createFile = jest.fn().mockResolvedValue({ file_id: 'file-1' });
    const writers = createUploadFileWriters({
      file: { path: '/tmp/three-page.pdf' },
      createFile,
      readPrefix,
      readFile,
      getPdfPageCount: countPdfPages,
    });

    await expect(writers.prepareOriginalFile()).resolves.toEqual({ kind: 'pdf', pageCount: 3 });
    await writers.writeOriginalFile({
      metadata: { destinationChosen: true, pageCount: 99 },
    });
    await writers.writeOriginalFile({
      metadata: { destinationChosen: false, pageCount: 88 },
    });
    await writers.writeDerivedFile({
      metadata: { extracted: true, pageCount: 77 },
    });

    expect(readPrefix).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(countPdfPages).toHaveBeenCalledTimes(1);
    expect(createFile.mock.calls[0][0]).toEqual({
      metadata: { destinationChosen: true, pageCount: 3 },
    });
    expect(createFile.mock.calls[1][0]).toEqual({
      metadata: { destinationChosen: false, pageCount: 3 },
    });
    expect(createFile.mock.calls[2][0]).toEqual({ metadata: { extracted: true } });
  });

  it('does not read or count non-PDF uploads', async () => {
    const readPrefix = jest.fn().mockResolvedValue(Buffer.from('hello'));
    const readFile = jest.fn();
    const countPdfPages = jest.fn();
    const createFile = jest.fn().mockResolvedValue({ file_id: 'file-1' });
    const writers = createUploadFileWriters({
      file: { path: '/tmp/readme.txt' },
      createFile,
      readPrefix,
      readFile,
      getPdfPageCount: countPdfPages,
    });

    await expect(writers.prepareOriginalFile()).resolves.toEqual({ kind: 'not-pdf' });
    await writers.writeOriginalFile({ metadata: { pageCount: 22, label: 'text' } });

    expect(readFile).not.toHaveBeenCalled();
    expect(countPdfPages).not.toHaveBeenCalled();
    expect(createFile.mock.calls[0][0]).toEqual({ metadata: { label: 'text' } });
  });

  it('retains upload compatibility when a PDF parser cannot read the bytes', async () => {
    const createFile = jest.fn().mockResolvedValue({ file_id: 'file-1' });
    const writers = createUploadFileWriters({
      file: { path: '/tmp/broken.pdf' },
      createFile,
      readPrefix: jest.fn().mockResolvedValue(Buffer.from('%PDF-')),
      readFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-broken')),
      getPdfPageCount: jest.fn().mockRejectedValue(new Error('parser details stay internal')),
    });

    await expect(writers.prepareOriginalFile()).resolves.toEqual({
      kind: 'metadata-unavailable',
      reason: 'pdf-parse',
    });
    await writers.writeOriginalFile({ metadata: { destinationChosen: true, pageCount: 10 } });
    expect(createFile.mock.calls[0][0]).toEqual({ metadata: { destinationChosen: true } });
  });

  it('propagates staged-file I/O failures', async () => {
    const writers = createUploadFileWriters({
      file: { path: '/tmp/missing.pdf' },
      createFile: jest.fn(),
      readPrefix: jest.fn().mockRejectedValue(new Error('read failed')),
    });

    await expect(writers.prepareOriginalFile()).rejects.toThrow('read failed');
  });
});
