import type { SteelOcrFileReference } from '../memory/service';
import type { OcrPreprocessingFile } from './preprocess';
import type { OcrPreprocessingPageChunk } from './chunks';
import { parseAssistantMarkdown } from '../markdown/parser';
import { parseOcrResultTable } from './result';
import { buildPdfPageChunks } from './chunks';

/** A file as Steel OCR reads it from a turn attachment or a stored file record. */
export interface SteelOcrFile extends SteelOcrFileReference {
  sourceCode?: string;
  sourcePdfKey?: string;
  source?: string;
  pageStart?: number;
  pageEnd?: number;
}

/** An OCR preprocessing file with its owner-scoped source identity. */
export interface SteelOcrPreprocessingSourceFile extends OcrPreprocessingFile {
  sourceFilename: string;
  sourceCode?: string;
  source?: string;
}

export interface SteelOcrPreprocessingRules {
  ocrRulesText: string;
  ocrRuleVersion: string;
}

interface SteelOcrMessageContentPart {
  text?: unknown;
}

export interface SteelOcrMessage {
  content?: string | readonly (string | SteelOcrMessageContentPart | null | undefined)[] | null;
}

export function getSteelFileId(file: SteelOcrFileReference | null | undefined): string | undefined {
  const fileId = file?.fileId ?? file?.file_id ?? file?.id;
  return typeof fileId === 'string' && fileId.trim() !== '' ? fileId : undefined;
}

/** The last canonical `## ocr_result` section of an assistant response. */
export function extractCanonicalDelegateOcrResult(markdown: string): string | undefined {
  const sections = parseAssistantMarkdown(markdown).sections.filter(
    (section) => section.title.trim() === 'ocr_result',
  );
  return sections[sections.length - 1]?.raw?.trim() || undefined;
}

export function isPdfSteelFile(file: SteelOcrFileReference | null | undefined): boolean {
  const mediaType = String(file?.mediaType ?? file?.mimeType ?? file?.mimetype ?? file?.type ?? '')
    .trim()
    .toLowerCase();
  if (mediaType === 'application/pdf') {
    return true;
  }
  const filename = String(
    file?.filename ?? file?.name ?? file?.originalname ?? file?.filepath ?? '',
  )
    .trim()
    .toLowerCase();
  return filename.endsWith('.pdf');
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//iu.test(value);
}

function getSteelSourcePdfKey(
  file: SteelOcrFile,
  fileRecord: SteelOcrFileReference | undefined,
): string | undefined {
  return (
    fileRecord?.storageKey ??
    fileRecord?.filepath ??
    file.storageKey ??
    file.filepath ??
    file.ocrFileKey
  );
}

/** Combines a selected OCR file with its stored record into a preprocessing file. */
export function toSteelOcrPreprocessingFile(
  file: SteelOcrFile & { ocrFileKey: string },
  fileRecord?: SteelOcrFileReference,
): SteelOcrPreprocessingSourceFile | undefined {
  const sourcePdfKey = getSteelSourcePdfKey(file, fileRecord);
  if (!sourcePdfKey) {
    return undefined;
  }

  const sourceFilename = typeof fileRecord?.filename === 'string' ? fileRecord.filename.trim() : '';

  return {
    ...file,
    fileId: file.fileId ?? fileRecord?.file_id,
    filename: file.filename ?? fileRecord?.filename,
    mediaType: file.mediaType ?? fileRecord?.type ?? fileRecord?.mimetype,
    filepath: file.filepath ?? fileRecord?.filepath,
    storageKey: file.storageKey ?? fileRecord?.storageKey,
    ocrFileKey: file.ocrFileKey,
    sourcePdfKey,
    sourceFilename,
  };
}

/** The plain text of a message whose content is a string or a list of text parts. */
export function getMessageContentText(message: SteelOcrMessage | null | undefined): string {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        return typeof part?.text === 'string' ? part.text : '';
      })
      .filter((text) => text.trim() !== '')
      .join('\n');
  }
  return String(content ?? '');
}

/** One whole-file chunk for images and other single-page OCR sources. */
export function buildSingleOriginalOcrChunk(): OcrPreprocessingPageChunk[] {
  return buildPdfPageChunks({ pageCount: 1, chunkSizePages: 1 });
}

/** The `ocr_result` headers of a previous answer, offered to the organizer as its columns. */
export function getSuggestedOcrResultColumns(markdown: unknown): string[] {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return [];
  }
  const parsedDocument = parseAssistantMarkdown(markdown);
  const resultSection = parsedDocument.sections.find(({ title }) => title === 'ocr_result');
  const parsedTable = parseOcrResultTable(resultSection?.body ?? markdown);
  return parsedTable.ok ? [...parsedTable.table.headers] : [];
}
