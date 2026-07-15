import { isSteelOcrCapableFile } from '../memory/service';

import type { SteelNativeFileReference } from './context';

type ProviderMessageRecord = {
  content?: unknown;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is ProviderMessageRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getFileId(part: ProviderMessageRecord): string | undefined {
  return typeof part.file_id === 'string' ? part.file_id : undefined;
}

function getDataUrlMediaType(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^data:([^;,]+);base64,/iu.exec(value);
  return match?.[1];
}

function getPartUrl(part: ProviderMessageRecord): string | undefined {
  if (typeof part.file_data === 'string') {
    return part.file_data;
  }
  const imageUrl = part.image_url;
  if (typeof imageUrl === 'string') {
    return imageUrl;
  }
  if (isRecord(imageUrl) && typeof imageUrl.url === 'string') {
    return imageUrl.url;
  }
  return undefined;
}

function isOcrProviderPart(
  part: ProviderMessageRecord,
  refsById: ReadonlyMap<string, SteelNativeFileReference>,
): boolean {
  const fileId = getFileId(part);
  const associatedFile = fileId !== undefined ? refsById.get(fileId) : undefined;
  if (associatedFile) {
    return isSteelOcrCapableFile({
      fileId: associatedFile.fileId,
      mediaType: associatedFile.mediaType,
      filename: associatedFile.filename,
    });
  }

  if (part.type === 'input_image' || part.type === 'image_url' || part.type === 'image') {
    return true;
  }

  const mediaType =
    (typeof part.media_type === 'string' && part.media_type) ||
    (typeof part.mediaType === 'string' && part.mediaType) ||
    getDataUrlMediaType(part.file_data) ||
    getDataUrlMediaType(getPartUrl(part));
  const filename = typeof part.filename === 'string' ? part.filename : undefined;
  if (mediaType === undefined && filename === undefined) {
    return false;
  }

  return isSteelOcrCapableFile({ mediaType, filename });
}

function cloneMessageWithContent<T>(message: T, content: readonly unknown[]): T {
  if (!isRecord(message)) {
    return message;
  }
  const clone = Object.create(Object.getPrototypeOf(message)) as ProviderMessageRecord;
  Object.assign(clone, message, { content });
  return clone as T;
}

/**
 * Removes only OCR-capable file parts from provider-bound messages. A URL with
 * no MIME type, filename, or associated file reference is intentionally kept.
 */
export function stripSteelOcrPartsFromProviderMessages<T>(
  messages: readonly T[],
  associatedFiles: readonly SteelNativeFileReference[] = [],
): T[] {
  const refsById = new Map(associatedFiles.map((file) => [file.fileId, file]));
  return messages.map((message) => {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      return message;
    }

    const content = message.content.filter(
      (part) => !isRecord(part) || !isOcrProviderPart(part, refsById),
    );
    return content.length === message.content.length
      ? message
      : cloneMessageWithContent(message, content);
  });
}
