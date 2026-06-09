import { createEvidenceAttachmentFromFileRecord } from './attachments';

import type { SteelOAuthChatFile } from '../ai/provider';
import type { SteelEvidenceAttachment, SteelEvidenceFileRecord } from './attachments';

export interface SteelEvidenceMongoFileRecord extends SteelEvidenceFileRecord {
  user: string | { toString(): string };
  conversationId?: string;
}

export type SteelEvidenceFileFinder = (
  fileId: string,
) => Promise<SteelEvidenceMongoFileRecord | null>;

export type SteelEvidenceFileBytesReader = (
  attachment: SteelEvidenceAttachment,
) => Promise<Uint8Array>;

export interface ResolveEvidenceFileForProviderInput {
  fileId: string;
  userId: string;
  conversationId?: string;
  findFile: SteelEvidenceFileFinder;
  readFileBytes: SteelEvidenceFileBytesReader;
}

function stringifyId(value: string | { toString(): string }) {
  return typeof value === 'string' ? value : value.toString();
}

function canAccessFile({
  file,
  userId,
  conversationId,
}: {
  file: SteelEvidenceMongoFileRecord;
  userId: string;
  conversationId?: string;
}) {
  if (stringifyId(file.user) !== userId) {
    return false;
  }

  if (conversationId && file.conversationId && file.conversationId !== conversationId) {
    return false;
  }

  return true;
}

export async function resolveEvidenceFileForProvider({
  fileId,
  userId,
  conversationId,
  findFile,
  readFileBytes,
}: ResolveEvidenceFileForProviderInput): Promise<SteelOAuthChatFile> {
  const file = await findFile(fileId);

  if (!file) {
    throw new Error('Steel evidence file not found.');
  }

  if (!canAccessFile({ file, userId, conversationId })) {
    throw new Error('Steel evidence file is not accessible.');
  }

  const attachment = createEvidenceAttachmentFromFileRecord(file);
  const data = await readFileBytes(attachment);

  return {
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    data,
  };
}
