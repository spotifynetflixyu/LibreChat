import type { SteelNativeFileReference, SteelNativeMessage } from './context';
import type { SteelRuntimeMessageRole } from '../runtime/types';
import { extractSteelNativeMarkdownText } from './markdown';

interface SteelNativeInputFilePart {
  type?: string;
  file_id?: string;
  fileId?: string;
  file_data?: string;
  media_type?: string;
  mediaType?: string;
  filename?: string;
}

/** A LibreChat or OpenAI-compatible message as it reaches the agents controllers. */
export interface SteelNativeInputMessage {
  role?: string;
  content?: unknown;
  messageId?: string;
  files?: readonly SteelNativeInputFilePart[] | null;
}

/** One Open Responses `input` item; only `message` items can carry files. */
export interface SteelNativeOpenResponsesInputItem {
  type?: string;
  content?: unknown;
}

const steelNativeMessageRoles: ReadonlySet<string> = new Set<SteelRuntimeMessageRole>([
  'system',
  'user',
  'assistant',
]);

function isSteelNativeMessageRole(role: string | undefined): role is SteelRuntimeMessageRole {
  return role !== undefined && steelNativeMessageRoles.has(role);
}

function isInputFilePart(part: unknown): part is SteelNativeInputFilePart {
  if (part == null || typeof part !== 'object') {
    return false;
  }
  const type = (part as SteelNativeInputFilePart).type;
  return type === 'input_file' || type === 'input_image';
}

function getInputFileParts(content: unknown): SteelNativeInputFilePart[] {
  return Array.isArray(content) ? content.filter(isInputFilePart) : [];
}

function getDataUrlMediaType(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return /^data:([^;,]+);base64,/i.exec(value)?.[1];
}

function addFileReference(
  filesById: Map<string, SteelNativeFileReference>,
  part: SteelNativeInputFilePart,
  conversationId: string | undefined,
): void {
  const fileId = part.file_id ?? part.fileId;
  if (typeof fileId !== 'string' || fileId.trim() === '' || filesById.has(fileId)) {
    return;
  }
  const mediaType =
    (typeof part.mediaType === 'string' ? part.mediaType : undefined) ??
    (typeof part.media_type === 'string' ? part.media_type : undefined) ??
    getDataUrlMediaType(part.file_data) ??
    'application/octet-stream';
  filesById.set(fileId, {
    fileId,
    mediaType,
    source: 'librechat_file_record',
    ...(conversationId ? { conversationId } : {}),
    ...(typeof part.filename === 'string' && part.filename.trim() !== ''
      ? { filename: part.filename }
      : {}),
  });
}

function addMessageFileReferences(
  filesById: Map<string, SteelNativeFileReference>,
  message: SteelNativeInputMessage,
  conversationId: string | undefined,
): void {
  for (const part of getInputFileParts(message.content)) {
    addFileReference(filesById, part, conversationId);
  }
  for (const file of message.files ?? []) {
    const fileId = file?.file_id ?? file?.fileId;
    if (typeof fileId === 'string' && fileId.trim() !== '') {
      addFileReference(filesById, { ...file, file_id: fileId }, conversationId);
    }
  }
}

/** Files attached to the current turn, from the raw Open Responses input first, then the converted user messages. */
export function collectSteelNativeInputFileReferences({
  requestInput,
  inputMessages,
  conversationId,
}: {
  requestInput?: unknown;
  inputMessages?: readonly SteelNativeInputMessage[];
  conversationId?: string;
}): SteelNativeFileReference[] {
  const filesById = new Map<string, SteelNativeFileReference>();
  const items: readonly SteelNativeOpenResponsesInputItem[] = Array.isArray(requestInput)
    ? requestInput
    : [];
  for (const item of items) {
    if (item?.type !== 'message') {
      continue;
    }
    for (const part of getInputFileParts(item.content)) {
      addFileReference(filesById, part, conversationId);
    }
  }
  for (const message of inputMessages ?? []) {
    if (message?.role === 'user') {
      addMessageFileReferences(filesById, message, conversationId);
    }
  }
  return [...filesById.values()];
}

/** Projects controller messages onto Steel history and returns the latest user turn. */
export function collectSteelNativeMessages(
  messages: readonly SteelNativeInputMessage[] | undefined,
  conversationId?: string,
): { activeHistory: SteelNativeMessage[]; currentUserTurn?: SteelNativeMessage } {
  const activeHistory: SteelNativeMessage[] = [];
  let currentUserTurn: SteelNativeMessage | undefined;
  for (const message of messages ?? []) {
    const role = message?.role;
    if (!isSteelNativeMessageRole(role)) {
      continue;
    }
    const filesById = new Map<string, SteelNativeFileReference>();
    if (role === 'user') {
      addMessageFileReferences(filesById, message, conversationId);
    }
    const steelMessage: SteelNativeMessage = {
      role,
      content: extractSteelNativeMarkdownText({ content: message.content }),
      ...(typeof message.messageId === 'string' ? { messageId: message.messageId } : {}),
      ...(filesById.size > 0 ? { files: [...filesById.values()] } : {}),
    };
    activeHistory.push(steelMessage);
    if (role === 'user') {
      currentUserTurn = steelMessage;
    }
  }
  return { activeHistory, currentUserTurn };
}
