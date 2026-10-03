import type { FilterQuery } from 'mongoose';
import type {
  IMongoFile,
  SteelReviewSourceMethods,
  SteelReviewSourceReadInput,
  SteelReviewSourceRecord,
  SteelReviewSourceScope,
} from '~/types';
import type { IMessage } from '~/types';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';
import { createFileModel } from '~/models/file';

export type { SteelReviewSourceMethods };

type Mongoose = typeof import('mongoose');

type TenantFilter = { tenantId: string } | { $or: Array<{ tenantId: { $exists: false } } | { tenantId: null }> };

type SteelReviewFile = Pick<
  IMongoFile,
  'file_id' | 'filename' | 'type' | 'bytes' | 'source' | 'filepath' | 'storageKey' | 'storageRegion' | 'model'
>;

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

function tenantFilter(tenantId?: string): TenantFilter {
  return tenantId === undefined
    ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
    : { tenantId };
}

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

function messageFileIds(files: IMessage['files'] | undefined): string[] {
  return (files ?? []).flatMap((file) => {
    if (typeof file !== 'object' || file === null || Array.isArray(file)) {
      return [];
    }
    if (!('file_id' in file)) {
      return [];
    }
    const fileId = file.file_id;
    return typeof fileId === 'string' && fileId.length > 0 ? [fileId] : [];
  });
}

function toRecord(file: SteelReviewFile): SteelReviewSourceRecord | null {
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
  const Conversation = createConversationModel(mongoose);
  const Message = createMessageModel(mongoose);
  const File = createFileModel(mongoose);

  const readScope = async (input: SteelReviewSourceScope) => {
    const [conversation, messages] = await Promise.all([
      Conversation.findOne({
        $and: [
          { conversationId: input.conversationId, user: input.userId },
          tenantFilter(input.tenantId),
          activeExpirationFilter(),
        ],
      })
        .select({ conversationId: 1 })
        .lean(),
      Message.find({
        $and: [
          {
            conversationId: input.conversationId,
            user: input.userId,
          },
          tenantFilter(input.tenantId),
          activeExpirationFilter(),
        ],
      })
        .select({ messageId: 1, files: 1 })
        .lean<Array<Pick<IMessage, 'messageId' | 'files'>>>(),
    ]);
    if (!conversation || !messages.some((message) => message.messageId === input.messageId)) {
      return null;
    }
    const messageIds = messages.map((message) => message.messageId).filter(Boolean);
    const attachedFileIds = [...new Set(messages.flatMap((message) => messageFileIds(message.files)))];
    return { messageIds, attachedFileIds };
  };

  const findAuthorized = async (
    input: SteelReviewSourceScope,
    fileId?: string,
  ): Promise<SteelReviewSourceRecord[]> => {
    const scope = await readScope(input);
    if (!scope) {
      return [];
    }
    const fileFilter: FilterQuery<IMongoFile> = {
      $and: [
        { user: input.userId },
        tenantFilter(input.tenantId),
        {
          $or: [
            { conversationId: input.conversationId },
            { conversationId: null, messageId: { $in: scope.messageIds } },
            { conversationId: null, file_id: { $in: scope.attachedFileIds } },
          ],
        },
        activeExpirationFilter(),
        ...(fileId ? [{ file_id: fileId }] : []),
      ],
    };
    const files = await File.find(fileFilter)
      .select({
        file_id: 1,
        filename: 1,
        type: 1,
        bytes: 1,
        source: 1,
        filepath: 1,
        storageKey: 1,
        storageRegion: 1,
        model: 1,
      })
      .lean<SteelReviewFile[]>();

    const records = new Map<string, SteelReviewSourceRecord>();
    const seenFileIds = new Set<string>();
    for (const file of files) {
      if (seenFileIds.has(file.file_id)) {
        records.delete(file.file_id);
        continue;
      }
      seenFileIds.add(file.file_id);
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
