import type { SteelReviewKind } from 'librechat-data-provider';
import type { SteelReviewMode } from './types';
import { systemReviewMode } from './system';
import { ocrReviewMode } from './ocr';

export function getSteelReviewMode(kind: SteelReviewKind): SteelReviewMode {
  return kind === 'system_order' ? systemReviewMode : ocrReviewMode;
}
