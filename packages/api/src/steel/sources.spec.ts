import { Readable } from 'node:stream';
import { PDFDocument } from 'pdf-lib';
import type { SteelReviewSourceMethods, SteelReviewSourceRecord } from '@librechat/data-schemas';
import type { SteelReviewSourceFile } from 'librechat-data-provider';
import type { ServerRequest } from '~/types/http';
import {
  SteelReviewSourceError,
  createSteelReviewSourceService,
  createSteelReviewSourceStorageReader,
} from './sources';

const source: SteelReviewSourceRecord = {
  fileId: 'source-file',
  filename: 'drawing.pdf',
  mediaType: 'application/pdf',
  bytes: 3,
  storageSource: 'local',
  filepath: '/uploads/drawing.pdf',
};

describe('Steel review source service', () => {
  it('maps authorized metadata without exposing storage fields', async () => {
    const reader: SteelReviewSourceMethods = {
      listSteelReviewSources: jest.fn().mockResolvedValue([source]),
      readSteelReviewSource: jest.fn(),
    };
    const service = createSteelReviewSourceService({ reader });
    const result = await service.list({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    });

    expect(result).toEqual({
      sources: [{
        fileId: 'source-file',
        filename: 'drawing.pdf',
        mediaType: 'application/pdf',
        bytes: 3,
      } satisfies SteelReviewSourceFile],
    });
    expect(reader.listSteelReviewSources).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    });
  });

  it('uses the uniquely authorized record for binary streaming', async () => {
    const readSteelReviewSource = jest.fn().mockResolvedValue(source);
    const readStream = jest.fn().mockResolvedValue(Readable.from(Buffer.from('pdf')));
    const reader: SteelReviewSourceMethods = {
      listSteelReviewSources: jest.fn(),
      readSteelReviewSource,
    };
    const service = createSteelReviewSourceService({ reader, readStream });
    const request = {} as ServerRequest;
    const result = await service.readBinary({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      fileId: 'source-file',
      messageId: 'message-1',
    }, request);

    expect(result.source).toEqual({
      fileId: 'source-file',
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
      bytes: 3,
    });
    expect(readSteelReviewSource).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      fileId: 'source-file',
      messageId: 'message-1',
    });
    expect(readStream).toHaveBeenCalledWith(request, source);
    await expect(result.stream).toBeInstanceOf(Readable);
  });

  it('returns safe coded failures for invalid and missing sources', async () => {
    const reader: SteelReviewSourceMethods = {
      listSteelReviewSources: jest.fn(),
      readSteelReviewSource: jest.fn().mockResolvedValue(null),
    };
    const service = createSteelReviewSourceService({ reader });
    await expect(service.list({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: '',
    })).rejects.toMatchObject<Partial<SteelReviewSourceError>>({
      code: 'INVALID_REVIEW_SOURCE_QUERY',
      statusCode: 400,
    });
    await expect(service.readBinary({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      fileId: 'missing-file',
      messageId: 'message-1',
    }, {} as ServerRequest)).rejects.toMatchObject<Partial<SteelReviewSourceError>>({
      code: 'REVIEW_SOURCE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('adapts the selected storage strategy with the resolved authorized path', async () => {
    const request = {} as ServerRequest;
    const stream = Readable.from(Buffer.from('pdf'));
    const getDownloadStream = jest.fn().mockResolvedValue(stream);
    const resolvePath = jest.fn().mockReturnValue('/resolved/drawing.pdf');
    const readStream = createSteelReviewSourceStorageReader({
      getStrategy: jest.fn().mockReturnValue({ getDownloadStream }),
      resolvePath,
    });

    await expect(readStream(request, source)).resolves.toBe(stream);
    expect(resolvePath).toHaveBeenCalledWith(source);
    expect(getDownloadStream).toHaveBeenCalledWith(request, '/resolved/drawing.pdf');
  });

  it('returns a coded unavailable error when a strategy cannot stream', async () => {
    const readStream = createSteelReviewSourceStorageReader({
      getStrategy: jest.fn().mockReturnValue({}),
      resolvePath: jest.fn(),
    });

    await expect(readStream({} as ServerRequest, source)).rejects.toMatchObject<Partial<SteelReviewSourceError>>({
      code: 'REVIEW_SOURCE_UNAVAILABLE',
      statusCode: 501,
    });
  });

  it('returns one page for an authorized image without reading its bytes', async () => {
    const image = { ...source, filename: 'drawing.png', mediaType: 'image/png' };
    const readSteelReviewSource = jest.fn().mockResolvedValue(image);
    const readStream = jest.fn();
    const service = createSteelReviewSourceService({
      reader: {
        listSteelReviewSources: jest.fn(),
        readSteelReviewSource,
      },
      readStream,
    });

    await expect(service.readPageCount({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      fileId: image.fileId,
      messageId: 'message-1',
    }, {} as ServerRequest)).resolves.toEqual({
      source: expect.objectContaining({ fileId: image.fileId, mediaType: 'image/png' }),
      pageCount: 1,
    });
    expect(readStream).not.toHaveBeenCalled();
  });

  it('returns a safe unavailable error when an authorized PDF cannot be parsed', async () => {
    const service = createSteelReviewSourceService({
      reader: {
        listSteelReviewSources: jest.fn(),
        readSteelReviewSource: jest.fn().mockResolvedValue(source),
      },
      readStream: jest.fn().mockResolvedValue(Readable.from(Buffer.from('not-a-pdf'))),
    });

    await expect(service.readPageCount({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      fileId: source.fileId,
      messageId: 'message-1',
    }, {} as ServerRequest)).rejects.toMatchObject<Partial<SteelReviewSourceError>>({
      code: 'REVIEW_SOURCE_UNAVAILABLE',
      statusCode: 501,
    });
  });

  it('counts pages from the authorized PDF bytes', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    const bytes = await pdf.save();
    const readStream = jest.fn().mockResolvedValue(Readable.from(Buffer.from(bytes)));
    const service = createSteelReviewSourceService({
      reader: {
        listSteelReviewSources: jest.fn(),
        readSteelReviewSource: jest.fn().mockResolvedValue(source),
      },
      readStream,
    });

    await expect(service.readPageCount({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      fileId: source.fileId,
      messageId: 'message-1',
    }, {} as ServerRequest)).resolves.toEqual({
      source: expect.objectContaining({ fileId: source.fileId }),
      pageCount: 2,
    });
  });
});
