import path from 'path';
import { logger } from '@librechat/data-schemas';
import { FileSources, inferMimeType } from 'librechat-data-provider';

const PADDLEOCR_VL_TOOL_NAME = 'paddleocr_vl';
const PADDLEOCR_MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.cif': 'image/cif',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
};

export interface PaddleOcrInputFile {
  file_id?: string;
  fileId?: string;
  id?: string;
  filename?: string;
  name?: string;
  originalname?: string;
  filepath?: string;
  source?: string;
  type?: string;
  mimetype?: string;
  mediaType?: string;
}

export interface PaddleOcrInputRequest {
  user?: { id?: string; tenantId?: string };
  body?: { files?: unknown; attachments?: unknown };
  steelNativeContext?: { currentTurnFiles?: unknown };
}

interface PaddleOcrFileFilter {
  file_id: { $in: string[] };
  user: string;
  tenantId?: string;
}

export interface PaddleOcrInputDependencies {
  getFiles(
    filter: PaddleOcrFileFilter,
    sort: Record<string, never>,
    select: Record<string, never>,
  ): Promise<PaddleOcrInputFile[] | null | undefined>;
  getStrategyFunctions(source: string): {
    getDownloadStream?: (req: PaddleOcrInputRequest | undefined, filepath: string) => Promise<NodeJS.ReadableStream>;
    getDownloadURL?: (input: { req: PaddleOcrInputRequest | undefined; file: PaddleOcrInputFile }) => Promise<string>;
  };
  streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer>;
}

export interface PrepareMCPToolArgumentsInput {
  req?: PaddleOcrInputRequest;
  userId?: string;
  requestBody?: { files?: unknown; attachments?: unknown };
  toolName: string;
  toolArguments: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isLikelyBase64Input(value: string): boolean {
  const normalized = value.replace(/\s/g, '');
  return normalized.length > 128 && /^[A-Za-z0-9+/]+={0,2}$/.test(normalized);
}

function isInlinePaddleInput(value: string): boolean {
  const trimmed = value.trim();
  return /^data:/i.test(trimmed) || isLikelyBase64Input(trimmed);
}

function isUrlPaddleInput(value: string): boolean {
  return /^(?:https?|file):\/\//i.test(value.trim());
}

function isDirectPaddleInput(value: string): boolean {
  return isInlinePaddleInput(value) || /^https?:\/\//i.test(value.trim());
}

function isLocalPathPaddleInput(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^file:\/\//i.test(trimmed) ||
    /^\/[^/]/.test(trimmed) ||
    /^\.\.?(?:[\\/]|$)/.test(trimmed) ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    /^\\\\/.test(trimmed)
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanExtractedPaddleInput(value: string): string {
  return value
    .trim()
    .replace(/^[<"'([`]+/g, '')
    .replace(/[>"'\])`,.]+$/g, '');
}

/** Extracts the plausible file references, URLs and data URLs a model may wrap in prose or labels. */
function collectPaddleInputCandidates(value: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    if (typeof raw !== 'string') return;
    const candidate = cleanExtractedPaddleInput(raw);
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };
  const original = cleanExtractedPaddleInput(value);
  add(original);
  for (const match of original.matchAll(/\bdata:[^\s"'<>]+/gi)) add(match[0]);
  for (const match of original.matchAll(/\b(?:https?|file):\/\/[^\s"'<>]+/gi)) add(match[0]);
  for (const match of original.matchAll(/\bfile:(?!\/\/)([A-Za-z0-9][A-Za-z0-9._~-]*)/gi)) {
    add(`file:${match[1]}`);
    add(match[1]);
  }
  let labelStripped = original;
  for (let i = 0; i < 3; i++) {
    const match = labelStripped.match(/^[A-Za-z][A-Za-z0-9_-]{0,63}\s*[:=]\s*(.+)$/);
    if (!match || /^data:/i.test(labelStripped) || /^(?:https?|file):\/\//i.test(labelStripped)) {
      break;
    }
    labelStripped = cleanExtractedPaddleInput(match[1]);
    add(labelStripped);
  }
  return candidates;
}

function normalizeFileName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return '';
  }
  const trimmed = value.trim();
  const normalizedInput = trimmed.startsWith('file:') ? trimmed.slice('file:'.length) : trimmed;
  const normalizedPath = safeDecode(normalizedInput.split(/[?#]/)[0]).replace(/\\/g, '/');
  return path.basename(normalizedPath).toLowerCase();
}

function getFileId(file: PaddleOcrInputFile | Record<string, unknown>): string | undefined {
  const id = file.file_id ?? file.fileId ?? file.id;
  return typeof id === 'string' ? id : undefined;
}

function collectRequestFileRefs(
  requestBody: PrepareMCPToolArgumentsInput['requestBody'],
  req: PaddleOcrInputRequest | undefined,
): unknown[] {
  return [
    requestBody?.files,
    requestBody?.attachments,
    req?.body?.files,
    req?.body?.attachments,
    req?.steelNativeContext?.currentTurnFiles,
  ].flatMap((value) => (Array.isArray(value) ? value.filter(Boolean) : []));
}

function fileMatchesInputName(file: PaddleOcrInputFile, inputData: string): boolean {
  for (const candidate of collectPaddleInputCandidates(inputData)) {
    const inputName = normalizeFileName(candidate);
    if (!inputName) continue;
    if (String(getFileId(file) ?? '').trim().toLowerCase() === inputName) return true;
    if (
      [file.filename, file.name, file.originalname, file.filepath].some(
        (fileCandidate) => normalizeFileName(fileCandidate) === inputName,
      )
    ) {
      return true;
    }
  }
  return false;
}

function getPaddleInputLogLabel(inputData: string): string {
  const directInput = collectPaddleInputCandidates(inputData).find(isUrlPaddleInput);
  if (!directInput) {
    return inputData;
  }
  try {
    const url = new URL(directInput);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return directInput.replace(/[?#].*$/u, '');
  }
}

function getMediaTypeForFile(file: PaddleOcrInputFile, inputData: string): string {
  const explicitType = file.type ?? file.mimetype ?? file.mediaType;
  const normalizedExplicitType = typeof explicitType === 'string' ? explicitType.trim().toLowerCase() : '';
  if (explicitType && normalizedExplicitType !== '' && normalizedExplicitType !== 'application/octet-stream') {
    return explicitType.trim();
  }
  const fileName = normalizeFileName(
    file.filename ?? file.name ?? file.originalname ?? file.filepath ?? inputData,
  );
  return (
    inferMimeType(fileName, '') ||
    PADDLEOCR_MEDIA_TYPES_BY_EXTENSION[path.extname(fileName).toLowerCase()] ||
    'application/octet-stream'
  );
}

/**
 * Resolves PaddleOCR `input_data` that names a current-request attachment into
 * a clean download URL (S3) or an inline data URL, so the MCP server never
 * receives local paths or stale signed links.
 */
export function createSteelMCPToolArgumentPreparer(
  deps: PaddleOcrInputDependencies,
): (input: PrepareMCPToolArgumentsInput) => Promise<unknown> {
  async function getRequestFileRecords(
    req: PaddleOcrInputRequest | undefined,
    userId: string | undefined,
    requestBody: PrepareMCPToolArgumentsInput['requestBody'],
  ): Promise<PaddleOcrInputFile[]> {
    const fileIds = new Set<string>();
    for (const ref of collectRequestFileRefs(requestBody, req)) {
      if (!isPlainObject(ref)) continue;
      const fileId = getFileId(ref);
      if (fileId) fileIds.add(fileId);
    }
    const ownerId = req?.user?.id ?? userId;
    if (!ownerId || fileIds.size === 0) {
      return [];
    }
    const filter: PaddleOcrFileFilter = {
      file_id: { $in: Array.from(fileIds) },
      user: ownerId,
      ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}),
    };
    const records = new Map<string, PaddleOcrInputFile>();
    for (const file of (await deps.getFiles(filter, {}, {})) ?? []) {
      records.set(getFileId(file) ?? `${file.filename ?? ''}:${file.filepath ?? ''}`, file);
    }
    return Array.from(records.values());
  }

  async function resolvePaddleOcrInputData(
    input: PrepareMCPToolArgumentsInput,
    inputData: string,
  ): Promise<string> {
    const trimmedInput = inputData.trim();
    const candidates = collectPaddleInputCandidates(trimmedInput);
    const files = await getRequestFileRecords(input.req, input.userId, input.requestBody);
    const matchedFile = files.find((file) => fileMatchesInputName(file, trimmedInput));
    if (!matchedFile) {
      const directInput = candidates.find(isDirectPaddleInput);
      if (directInput) {
        return directInput;
      }
      if (candidates.some(isLocalPathPaddleInput)) {
        throw new Error(
          'Unsupported PaddleOCR input_data: local paths are not allowed. Use a current file id, filename, http(s) URL, or data URL.',
        );
      }
      return inputData;
    }

    const label = matchedFile.filename ?? trimmedInput;
    if (!matchedFile.filepath) {
      throw new Error(`Matched attachment "${label}" has no downloadable filepath`);
    }
    const source = matchedFile.source ?? FileSources.local;
    const { getDownloadStream, getDownloadURL } = deps.getStrategyFunctions(source);
    const { req } = input;
    const attachmentLabel = matchedFile.filename ?? matchedFile.file_id ?? trimmedInput;

    if (source === FileSources.s3) {
      if (typeof getDownloadURL !== 'function') {
        throw new Error(`Matched attachment "${label}" cannot create a download URL`);
      }
      const downloadUrl = await getDownloadURL({ req, file: matchedFile });
      logger.debug(
        `[MCP][PaddleOCR] Resolved input_data "${getPaddleInputLogLabel(trimmedInput)}" from current request attachment "${attachmentLabel}" using a clean storage download URL.`,
      );
      return downloadUrl;
    }

    if (typeof getDownloadStream !== 'function') {
      throw new Error(`Matched attachment "${label}" is not downloadable`);
    }
    const mediaType = getMediaTypeForFile(matchedFile, trimmedInput);
    const buffer = await deps.streamToBuffer(await getDownloadStream(req, matchedFile.filepath));
    logger.debug(
      `[MCP][PaddleOCR] Resolved input_data "${getPaddleInputLogLabel(trimmedInput)}" from current request attachment "${attachmentLabel}".`,
    );
    return `data:${mediaType};base64,${buffer.toString('base64')}`;
  }

  return async function prepareMCPToolArguments(input: PrepareMCPToolArgumentsInput): Promise<unknown> {
    const { toolName, toolArguments } = input;
    if (
      toolName !== PADDLEOCR_VL_TOOL_NAME ||
      !isPlainObject(toolArguments) ||
      typeof toolArguments.input_data !== 'string'
    ) {
      return toolArguments;
    }
    const inputData = toolArguments.input_data;
    const resolvedInputData = await resolvePaddleOcrInputData(input, inputData);
    return resolvedInputData === inputData ? toolArguments : { ...toolArguments, input_data: resolvedInputData };
  };
}
