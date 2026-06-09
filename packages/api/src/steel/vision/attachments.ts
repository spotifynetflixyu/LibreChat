import { createHash } from 'crypto';

export type SteelEvidenceAttachmentKind = 'image' | 'pdf' | 'spreadsheet' | 'unsupported';
export type SteelEvidenceStorageSource = 'local' | 's3' | 'cloudfront' | 'azure_blob' | 'firebase';

export interface SteelEvidenceFileRef {
  source: SteelEvidenceStorageSource;
  filepath: string;
  storageKey?: string;
  storageRegion?: string;
}

export interface SteelEvidenceAttachment {
  fileId: string;
  filename?: string;
  mediaType: string;
  kind: SteelEvidenceAttachmentKind;
  data?: Uint8Array;
  fileRef?: SteelEvidenceFileRef;
  bytes?: number;
  pageCount?: number;
  durable: boolean;
  sourceChannel: 'quote_conversation_evidence';
}

export interface SteelEvidenceFileRecord {
  file_id: string;
  filename: string;
  filepath: string;
  source: string;
  type: string;
  bytes: number;
  storageKey?: string;
  storageRegion?: string;
}

export interface SteelInlineEvidenceFile {
  filename?: string;
  mediaType: string;
  data: Uint8Array;
}

const xlsxMediaTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const storageSources = new Set<string>(['local', 's3', 'cloudfront', 'azure_blob', 'firebase']);

function normalizeMediaType(mediaType: string) {
  return mediaType.trim().toLowerCase();
}

function toStorageSource(source: string): SteelEvidenceStorageSource {
  if (storageSources.has(source)) {
    return source as SteelEvidenceStorageSource;
  }

  throw new Error(`Unsupported Steel evidence storage source: ${source}`);
}

function inlineFileId(file: SteelInlineEvidenceFile) {
  const hash = createHash('sha256')
    .update(file.filename ?? '')
    .update(file.mediaType)
    .update(file.data)
    .digest('hex')
    .slice(0, 16);

  return `inline_${hash}`;
}

export function classifyEvidenceAttachment(mediaType: string): SteelEvidenceAttachmentKind {
  const normalized = normalizeMediaType(mediaType);

  if (normalized.startsWith('image/')) {
    return 'image';
  }

  if (normalized === 'application/pdf') {
    return 'pdf';
  }

  if (xlsxMediaTypes.has(normalized)) {
    return 'spreadsheet';
  }

  return 'unsupported';
}

export function createEvidenceAttachmentFromFileRecord(
  record: SteelEvidenceFileRecord,
): SteelEvidenceAttachment {
  const fileRef: SteelEvidenceFileRef = {
    source: toStorageSource(record.source),
    filepath: record.filepath,
    ...(record.storageKey ? { storageKey: record.storageKey } : {}),
    ...(record.storageRegion ? { storageRegion: record.storageRegion } : {}),
  };

  return {
    fileId: record.file_id,
    filename: record.filename,
    mediaType: record.type,
    kind: classifyEvidenceAttachment(record.type),
    fileRef,
    bytes: record.bytes,
    durable: true,
    sourceChannel: 'quote_conversation_evidence',
  };
}

export function createEvidenceAttachmentFromInlineFile(
  file: SteelInlineEvidenceFile,
): SteelEvidenceAttachment {
  return {
    fileId: inlineFileId(file),
    filename: file.filename,
    mediaType: file.mediaType,
    kind: classifyEvidenceAttachment(file.mediaType),
    data: file.data,
    durable: false,
    sourceChannel: 'quote_conversation_evidence',
  };
}
