export interface OcrPreprocessingChunkIdentity {
  pipelineVersion: number;
  sourcePdfKey: string;
  ocrFileKey: string;
  fileId?: string;
  filename?: string;
  chunkIndex: number;
  chunkCount: number;
  pageStart: number;
  pageEnd: number;
  chunkSizePages: number;
}

export interface OcrOrganizerInput {
  ocrRulesText: string;
  file: {
    ocrFileKey: string;
    fileId?: string;
    filename?: string;
  };
  chunk: OcrPreprocessingChunkIdentity;
  rawOcrText: string;
}

export interface OcrOrganizer {
  organize(input: OcrOrganizerInput): Promise<{ markdown: string }>;
}

const organizerRulesStart = '[ocr_organizer]';
const organizerRulesEnd = '[/ocr_organizer]';
const sharedRulesStart = '[ocr_shared]';
const sharedRulesEnd = '[/ocr_shared]';

function getMarkedRules(
  rules: string,
  startMarker: string,
  endMarker: string,
): string | undefined | null {
  const startIndex = rules.indexOf(startMarker);
  const endIndex = rules.indexOf(endMarker);
  if (startIndex < 0 && endIndex < 0) {
    return undefined;
  }
  const hasOneStart = startIndex >= 0 && startIndex === rules.lastIndexOf(startMarker);
  const hasOneEnd = endIndex >= 0 && endIndex === rules.lastIndexOf(endMarker);
  if (!hasOneStart || !hasOneEnd || endIndex <= startIndex) {
    return null;
  }

  return rules.slice(startIndex + startMarker.length, endIndex).trim() || null;
}

export function resolveOcrOrganizerRulesText(rules: string): string {
  const fallback = rules.trim();
  const organizerRules = getMarkedRules(rules, organizerRulesStart, organizerRulesEnd);
  const sharedRules = getMarkedRules(rules, sharedRulesStart, sharedRulesEnd);
  if (!organizerRules || sharedRules === null) {
    return fallback;
  }

  return [sharedRules, organizerRules]
    .filter((section): section is string => Boolean(section))
    .join('\n\n');
}

export function buildOcrOrganizerPrompt(input: OcrOrganizerInput): string {
  return [
    'Organize this single OCR preprocessing chunk into Steel OCR Markdown.',
    '',
    'OCR rules:',
    resolveOcrOrganizerRulesText(input.ocrRulesText),
    '',
    'File:',
    `ocrFileKey: ${input.file.ocrFileKey}`,
    input.file.fileId !== undefined ? `fileId: ${input.file.fileId}` : undefined,
    input.file.filename !== undefined ? `filename: ${input.file.filename}` : undefined,
    '',
    'Chunk:',
    `sourcePdfKey: ${input.chunk.sourcePdfKey}`,
    `chunk: ${input.chunk.chunkIndex}/${input.chunk.chunkCount}`,
    `pages ${input.chunk.pageStart}-${input.chunk.pageEnd}`,
    '',
    'Raw OCR result:',
    input.rawOcrText,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}
