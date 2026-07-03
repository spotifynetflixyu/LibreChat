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

export function buildOcrOrganizerPrompt(input: OcrOrganizerInput): string {
  return [
    'Organize this single OCR preprocessing chunk into Steel OCR Markdown.',
    '',
    'OCR rules:',
    input.ocrRulesText,
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
