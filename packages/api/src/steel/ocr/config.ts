export const ocrPreprocessingChunkSizePagesEnvKey = 'STEEL_OCR_PREPROCESSING_CHUNK_SIZE_PAGES';
export const defaultOcrPreprocessingChunkSizePages = 50;

export function resolveOcrPreprocessingChunkSizePages(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[ocrPreprocessingChunkSizePagesEnvKey]?.trim();
  if (!raw) {
    return defaultOcrPreprocessingChunkSizePages;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return defaultOcrPreprocessingChunkSizePages;
  }

  return value % 2 === 0 ? value : value + 1;
}
