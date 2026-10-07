import {
  steelReviewKinds,
  steelReviewSourceBinaryQuerySchema,
  steelReviewSourceQuerySchema,
} from 'librechat-data-provider';
import type {
  SteelReviewSourceMethods,
  SteelReviewSourceReadInput,
  SteelReviewSourceRecord,
} from '@librechat/data-schemas';
import type {
  SteelReviewKind,
  SteelReviewSourceFile,
  SteelReviewSourceQuery,
} from 'librechat-data-provider';
import type { Readable } from 'node:stream';
import type { ServerRequest } from '~/types/http';
import { getPdfPageCount } from './ocr/chunks';

export interface SteelReviewSourceListInput extends SteelReviewSourceQuery {
  userId: string;
  tenantId?: string;
  conversationId: string;
  kind: SteelReviewKind;
}

export interface SteelReviewSourceBinaryInput {
  userId: string;
  tenantId?: string;
  conversationId: string;
  kind: SteelReviewKind;
  fileId: string;
  messageId: string;
}

export type SteelReviewSourcePageCountInput = SteelReviewSourceBinaryInput;

export interface SteelReviewSourceStreamReader {
  (request: ServerRequest, source: SteelReviewSourceRecord): Promise<Readable>;
}

interface SteelReviewStorageStreamReader {
  (request: ServerRequest, filepath: string): Promise<Readable>;
}

export interface SteelReviewSourceServiceDeps {
  reader: SteelReviewSourceMethods;
  readStream?: SteelReviewSourceStreamReader;
}

export interface SteelReviewSourceStorageReaderDeps {
  getStrategy: (source: string) => {
    getDownloadStream?: SteelReviewStorageStreamReader;
  };
  resolvePath: (file: Pick<SteelReviewSourceRecord, 'filepath' | 'storageKey'>) => string;
}

export interface SteelReviewSourceService {
  list(input: SteelReviewSourceListInput): Promise<{ sources: SteelReviewSourceFile[] }>;
  readBinary(
    input: SteelReviewSourceBinaryInput,
    request: ServerRequest,
  ): Promise<{ source: SteelReviewSourceFile; stream: Readable }>;
  readMetadata(input: SteelReviewSourceBinaryInput): Promise<SteelReviewSourceFile | null>;
  readPageCount(
    input: SteelReviewSourcePageCountInput,
    request: ServerRequest,
  ): Promise<{ source: SteelReviewSourceFile; pageCount: number }>;
}

export class SteelReviewSourceError extends Error {
  readonly statusCode: 400 | 404 | 501;
  readonly code:
    | 'INVALID_REVIEW_SOURCE_QUERY'
    | 'REVIEW_SOURCE_NOT_FOUND'
    | 'REVIEW_SOURCE_UNAVAILABLE';

  constructor(
    code: SteelReviewSourceError['code'],
    statusCode: SteelReviewSourceError['statusCode'],
    message: string,
  ) {
    super(message);
    this.name = 'SteelReviewSourceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createSteelReviewSourceStorageReader({
  getStrategy,
  resolvePath,
}: SteelReviewSourceStorageReaderDeps): SteelReviewSourceStreamReader {
  return async (request, source) => {
    const getDownloadStream = getStrategy(source.storageSource).getDownloadStream;
    if (!getDownloadStream) {
      throw new SteelReviewSourceError(
        'REVIEW_SOURCE_UNAVAILABLE',
        501,
        'Review source preview unavailable',
      );
    }
    return getDownloadStream(request, resolvePath(source));
  };
}

function publicSource(source: SteelReviewSourceRecord): SteelReviewSourceFile {
  return {
    fileId: source.fileId,
    filename: source.filename,
    mediaType: source.mediaType,
    ...(source.bytes !== undefined ? { bytes: source.bytes } : {}),
  };
}

async function readStreamBytes(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function validateScope(input: SteelReviewSourceListInput): SteelReviewSourceQuery {
  const result = steelReviewSourceQuerySchema.safeParse({
    messageId: input.messageId,
    title: input.title,
  });
  if (!result.success || !steelReviewKinds.includes(input.kind)) {
    throw new SteelReviewSourceError(
      'INVALID_REVIEW_SOURCE_QUERY',
      400,
      'Invalid review source query',
    );
  }
  return result.data;
}

export function createSteelReviewSourceService({
  reader,
  readStream,
}: SteelReviewSourceServiceDeps): SteelReviewSourceService {
  const readAuthorizedSource = async (
    input: SteelReviewSourceBinaryInput,
  ): Promise<SteelReviewSourceRecord | null> => {
    const query = steelReviewSourceBinaryQuerySchema.safeParse({ messageId: input.messageId });
    if (!query.success || !steelReviewKinds.includes(input.kind) || !input.fileId) {
      throw new SteelReviewSourceError(
        'INVALID_REVIEW_SOURCE_QUERY',
        400,
        'Invalid review source query',
      );
    }
    return reader.readSteelReviewSource({
      userId: input.userId,
      ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
      conversationId: input.conversationId,
      messageId: query.data.messageId,
      kind: input.kind,
      fileId: input.fileId,
    } satisfies SteelReviewSourceReadInput);
  };

  return {
    async list(input) {
      const query = validateScope(input);
      const sources = await reader.listSteelReviewSources({
        userId: input.userId,
        ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
        conversationId: input.conversationId,
        messageId: query.messageId,
        kind: input.kind,
        title: query.title,
      });
      return { sources: sources.map(publicSource) };
    },

    async readBinary(input, request) {
      const source = await readAuthorizedSource(input);
      if (!source) {
        throw new SteelReviewSourceError(
          'REVIEW_SOURCE_NOT_FOUND',
          404,
          'Review source not found',
        );
      }
      if (!readStream) {
        throw new SteelReviewSourceError(
          'REVIEW_SOURCE_UNAVAILABLE',
          501,
          'Review source preview unavailable',
        );
      }
      return { source: publicSource(source), stream: await readStream(request, source) };
    },

    async readMetadata(input) {
      const source = await readAuthorizedSource(input);
      return source ? publicSource(source) : null;
    },

    async readPageCount(input, request) {
      const source = await readAuthorizedSource(input);
      if (!source) {
        throw new SteelReviewSourceError('REVIEW_SOURCE_NOT_FOUND', 404, 'Review source not found');
      }
      if (!readStream) {
        throw new SteelReviewSourceError('REVIEW_SOURCE_UNAVAILABLE', 501, 'Review source preview unavailable');
      }
      try {
        if (source.mediaType.toLowerCase().startsWith('image/')) {
          return { source: publicSource(source), pageCount: 1 };
        }
        const bytes = await readStreamBytes(await readStream(request, source));
        const pageCount = await getPdfPageCount({ pdfBytes: bytes });
        return { source: publicSource(source), pageCount };
      } catch {
        throw new SteelReviewSourceError(
          'REVIEW_SOURCE_UNAVAILABLE',
          501,
          'Review source page count unavailable',
        );
      }
    },
  };
}
