import type {
  SteelReviewSourceMethods,
  SteelReviewSourceReadInput,
  SteelReviewSourceRecord,
} from '~/types';
import {
  createSteelReviewSourceAuthorization,
  type SteelReviewAuthorizedFile,
} from './steelSourceAuthorization';

export type { SteelReviewSourceMethods };

type Mongoose = typeof import('mongoose');

const imageMediaTypes: Readonly<Record<string, string>> = Object.freeze({
  'image/avif': 'image/avif',
  'image/bmp': 'image/bmp',
  'image/gif': 'image/gif',
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/tiff': 'image/tiff',
  'image/webp': 'image/webp',
});

const imageExtensionMediaTypes: Readonly<Record<string, string>> = Object.freeze({
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
});

function sourceType(type: string, filename: string): 'pdf' | 'image' | undefined {
  const normalizedType = type.toLowerCase();
  if (normalizedType === 'application/pdf' || normalizedType.endsWith('/pdf')) {
    return 'pdf';
  }
  if (imageMediaTypes[normalizedType]) {
    return 'image';
  }
  const normalizedFilename = filename.toLowerCase();
  if (normalizedFilename.endsWith('.pdf')) {
    return 'pdf';
  }
  if (/\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/u.test(normalizedFilename)) {
    return 'image';
  }
  return undefined;
}

function canonicalMediaType(type: string, filename: string, kind: 'pdf' | 'image'): string | undefined {
  if (kind === 'pdf') {
    return 'application/pdf';
  }
  const normalizedType = type.toLowerCase();
  if (imageMediaTypes[normalizedType]) {
    return imageMediaTypes[normalizedType];
  }
  const extension = filename.toLowerCase().match(/\.([^.]+)$/u)?.[1];
  return imageExtensionMediaTypes[extension ?? ''];
}

function toRecord(file: SteelReviewAuthorizedFile): SteelReviewSourceRecord | null {
  const kind = sourceType(file.type, file.filename);
  const mediaType = kind ? canonicalMediaType(file.type, file.filename, kind) : undefined;
  if (!kind || !mediaType) {
    return null;
  }
  return {
    fileId: file.file_id,
    filename: file.filename,
    mediaType,
    ...(typeof file.bytes === 'number' ? { bytes: file.bytes } : {}),
    storageSource: file.source,
    filepath: file.filepath,
    ...(file.storageKey ? { storageKey: file.storageKey } : {}),
    ...(file.storageRegion ? { storageRegion: file.storageRegion } : {}),
    ...(file.model ? { model: file.model } : {}),
  };
}

export function createSteelReviewSourceMethods(mongoose: Mongoose): SteelReviewSourceMethods {
  const authorizeFiles = createSteelReviewSourceAuthorization(mongoose);

  const findAuthorized = async (
    input: Parameters<SteelReviewSourceMethods['listSteelReviewSources']>[0],
    fileId?: string,
  ): Promise<SteelReviewSourceRecord[]> => {
    const files = await authorizeFiles(input, fileId ? [fileId] : undefined);

    const records = new Map<string, SteelReviewSourceRecord>();
    for (const file of files.values()) {
      const record = toRecord(file);
      if (!record) {
        continue;
      }
      records.set(record.fileId, record);
    }
    return [...records.values()].sort((left, right) =>
      left.filename.localeCompare(right.filename) || left.fileId.localeCompare(right.fileId));
  };

  return {
    async listSteelReviewSources(input) {
      return findAuthorized(input);
    },

    async readSteelReviewSource(input: SteelReviewSourceReadInput) {
      const [record] = await findAuthorized(input, input.fileId);
      return record ?? null;
    },
  };
}
