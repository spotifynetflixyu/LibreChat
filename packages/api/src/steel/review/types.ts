import type { SteelReviewReadInput, SteelReviewReadRecord } from '@librechat/data-schemas';
import type { SteelReviewKind } from 'librechat-data-provider';
import type { ServerRequest } from '~/types/http';

export interface SteelReviewReader {
  readSteelReview(input: SteelReviewReadInput): Promise<SteelReviewReadRecord | null>;
}

export interface SteelReviewSourceIntentInput {
  userId: string;
  tenantId?: string;
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  fileId: string;
}

export interface SteelReviewSourceAuthority {
  readMetadata(input: SteelReviewSourceIntentInput): Promise<{
    fileId: string;
    filename: string;
    mediaType: string;
    pageCount?: number;
  } | null>;
  readPageCount(
    input: SteelReviewSourceIntentInput,
    request: ServerRequest,
  ): Promise<{ pageCount: number } | null>;
}
