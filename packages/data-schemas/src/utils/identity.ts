import { createHash } from 'node:crypto';
import { encodeSteelReviewTitleOwner } from 'librechat-data-provider';
import type { SteelReviewTitleOwner } from 'librechat-data-provider';

export function steelReviewTitleStorageId(owner: SteelReviewTitleOwner): string {
  return `${owner.kind}:title:${createHash('sha256').update(encodeSteelReviewTitleOwner(owner)).digest('hex')}`;
}
