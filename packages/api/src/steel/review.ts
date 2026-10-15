import { randomUUID } from 'node:crypto';
import { SteelReviewWriteError } from '@librechat/data-schemas';
import { steelReviewReceiptQuerySchema, steelReviewReadQuerySchema } from 'librechat-data-provider';
import type {
  SteelReviewKind,
  SteelReviewReadQuery,
  SteelReviewTable,
  SteelReviewPrepared,
  SteelReviewReceiptStatus,
  SteelReviewSavedSnapshot,
} from 'librechat-data-provider';
import type {
  SteelReviewCommitInput,
  SteelReviewCommitResult,
  SteelReviewReadInput,
  SteelReviewReadRecord,
  SteelReviewReceiptLookup,
} from '@librechat/data-schemas';
import type { SteelReviewCatalogService } from './catalog';
import type { ServerRequest } from '~/types/http';

import {
  serializeSavedSnapshot,
  projectRecord,
  sidecarTarget,
  projectSidecar,
  findCanonicalTarget,
} from './review/projection';
import { SteelReviewReadError } from './review/errors';
import { createSteelReviewPreparer, isOperationCommit } from './review/prepare';
import type {
  SteelReviewPrepareInput,
  SteelReviewCommitRequest,
  SteelReviewTrustedProjection,
} from './review/prepare';
export { SteelReviewReadError } from './review/errors';
export { createSteelReviewBaselineRows } from './review/projection';

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

export interface SteelReviewWriter {
  commitSteelReview(input: SteelReviewCommitInput): Promise<SteelReviewCommitResult>;
  resolveSteelReviewReceipt?(
    input: SteelReviewCommitInput,
  ): Promise<SteelReviewCommitResult | null>;
  readSteelReviewReceipt?(input: SteelReviewReceiptLookup): Promise<SteelReviewCommitResult | null>;
}

export function createSteelReviewService({
  reader,
  writer,
  sourceAuthority,
  catalogService,
}: {
  reader: SteelReviewReader;
  writer?: SteelReviewWriter;
  sourceAuthority?: SteelReviewSourceAuthority;
  catalogService?: SteelReviewCatalogService;
}) {
  const {
    parsePreparePayload,
    parseCommitPayload,
    operationRequestDigest,
    operationPreparedFromReceipt,
    loadSourceEvidence,
    buildTrustedOperationPrepared,
    projectPrepared,
  } = createSteelReviewPreparer({ reader, sourceAuthority, catalogService });

  async function resolveReceiptStatus(
    input: SteelReviewReceiptLookup,
  ): Promise<SteelReviewReceiptStatus> {
    const parsed = steelReviewReceiptQuerySchema.safeParse({
      messageId: input.messageId,
      outputId: input.outputId,
      operationId: input.operationId,
      digest: input.digest,
      title: input.title,
    });
    if (!parsed.success) {
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review receipt query');
    }
    if (!writer?.readSteelReviewReceipt) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Steel review receipt unavailable');
    }
    const result = await writer.readSteelReviewReceipt(input);
    if (!result) {
      return { status: 'absent' };
    }
    if (!result.snapshot) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review receipt snapshot is unavailable');
    }
    return {
      status: 'committed',
      snapshot: serializeSavedSnapshot(result.snapshot),
    };
  }

  return {
    async read(input: SteelReviewReadInput): Promise<{ table: SteelReviewTable }> {
      const query = steelReviewReadQuerySchema.safeParse({
        messageId: input.messageId,
        title: input.title,
      });
      if (!query.success) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review table');
      }
      const record = await reader.readSteelReview(input);
      if (!record) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      if (record.title !== input.title) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      const sidecarTargetCandidate = sidecarTarget(record, record.tableId, input.title);
      const sidecar = projectSidecar(record, sidecarTargetCandidate);
      if (sidecar && sidecarTargetCandidate) {
        return { table: sidecar };
      }
      if (!record.markdown) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      const table = findCanonicalTarget(record, record.tableId, input.title);
      if (!table) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      const projected = projectRecord(record, table, record.tableId);
      if (!projected) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table not found');
      }
      return { table: projected };
    },

    receipt: (input: SteelReviewReceiptLookup): Promise<SteelReviewReceiptStatus> =>
      resolveReceiptStatus(input),

    async prepare(input: SteelReviewPrepareInput): Promise<SteelReviewPrepared> {
      const payload = parsePreparePayload(input);
      const prepared = await buildTrustedOperationPrepared(input, payload, randomUUID());
      return projectPrepared(payload, prepared);
    },

    async commit(input: SteelReviewCommitRequest): Promise<
      SteelReviewPrepared & {
        savedAt: string;
        changedRows: number;
        changedRowIds: string[];
        savedSnapshot?: SteelReviewSavedSnapshot;
      }
    > {
      if (!writer) {
        throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Steel review save unavailable');
      }
      const payload = parseCommitPayload(input);
      if (isOperationCommit(payload)) {
        if (writer.readSteelReviewReceipt) {
          const receipt = await writer.readSteelReviewReceipt({
            userId: input.userId,
            ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
            conversationId: payload.conversationId,
            kind: payload.kind,
            messageId: payload.messageId,
            title: payload.title,
            outputId: payload.outputId,
            operationId: payload.operationId,
            digest: payload.digest,
          });
          if (receipt) {
            const requestDigest = operationRequestDigest(payload, input);
            if (
              receipt.requestDigest !== requestDigest &&
              receipt.snapshot?.requestDigest !== requestDigest
            ) {
              throw new SteelReviewWriteError(
                'REVIEW_INVALID_OPERATION',
                'Review operation request changed',
              );
            }
            const prepared = operationPreparedFromReceipt(payload, receipt);
            return {
              ...prepared,
              savedAt: receipt.savedAt.toISOString(),
              changedRows: receipt.changedRows,
              changedRowIds: receipt.changedRowIds,
              ...(receipt.snapshot
                ? { savedSnapshot: serializeSavedSnapshot(receipt.snapshot) }
                : {}),
            } as SteelReviewPrepared & {
              savedAt: string;
              changedRows: number;
              changedRowIds: string[];
              savedSnapshot?: SteelReviewSavedSnapshot;
            };
          }
        }
        let trusted: SteelReviewTrustedProjection;
        const sourceEvidence = await loadSourceEvidence(input as SteelReviewPrepareInput, payload);
        try {
          trusted = await buildTrustedOperationPrepared(
            input as SteelReviewPrepareInput,
            payload,
            payload.operationId,
            undefined,
            sourceEvidence,
          );
        } catch (error) {
          if (
            error instanceof SteelReviewReadError &&
            error.code === 'REVIEW_NOT_FOUND' &&
            error.message === 'Review table is no longer current'
          ) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', error.message);
          }
          throw error;
        }
        if (payload.digest !== trusted.digest) {
          throw new SteelReviewWriteError(
            'REVIEW_INVALID_OPERATION',
            'Review operation digest mismatch',
          );
        }
        const trustedOperation = trusted;
        const trustedInternal = trusted;
        const result = await writer.commitSteelReview({
          ...trustedInternal,
          userId: input.userId,
          ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
          operationDigest: trustedOperation.digest,
          ...(trustedOperation.requestDigest
            ? { requestDigest: trustedOperation.requestDigest }
            : {}),
          operationRequest: payload,
          prepareOperation: async (currentRecord) => {
            const currentTrusted = await buildTrustedOperationPrepared(
              input as SteelReviewPrepareInput,
              payload,
              payload.operationId,
              currentRecord,
              sourceEvidence,
            );
            const currentOperation = currentTrusted;
            if (
              currentOperation.digest !== payload.digest ||
              currentOperation.requestDigest !== trustedOperation.requestDigest
            ) {
              throw new SteelReviewWriteError(
                'REVIEW_INVALID_OPERATION',
                'Review operation digest mismatch',
              );
            }
            return {
              ...currentTrusted,
              userId: input.userId,
              ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
              operationDigest: currentOperation.digest,
              ...(currentOperation.requestDigest
                ? { requestDigest: currentOperation.requestDigest }
                : {}),
              operationRequest: payload,
            };
          },
        });
        // The first response and an exact receipt replay must expose the same
        // safe operation projection. Build both from the immutable saved
        // snapshot so internal owner/auth fields and the mutable prepare
        // preview cannot leak into only one of the two responses.
        const savedProjection = result.snapshot
          ? operationPreparedFromReceipt(payload, result)
          : (() => {
              const { operationId: _operationId, digest: _digest, ...operationRequest } = payload;
              return {
                conversationId: payload.conversationId,
                messageId: payload.messageId,
                title: payload.title,
                kind: payload.kind,
                outputId: result.outputId,
                revision: result.revision,
                operations: payload.operations,
                operationRequest,
                ...(result.headers ? { headers: result.headers } : {}),
                rows: result.rows ?? trustedInternal.rows,
                messageSha256: result.messageSha256,
                effectiveMarkdown: result.effectiveMarkdown,
                displayMarkdown: result.displayMarkdown,
                ...(result.target ? { target: result.target } : {}),
                ...(result.targetText !== undefined ? { targetText: result.targetText } : {}),
                ...(result.replacementText !== undefined
                  ? { replacementText: result.replacementText }
                  : {}),
                ...(result.cleanReplacementText !== undefined
                  ? { cleanReplacementText: result.cleanReplacementText }
                  : {}),
                ...(result.aiBaselineMarkdown !== undefined
                  ? { aiBaselineMarkdown: result.aiBaselineMarkdown }
                  : {}),
                ...(result.aiRawMarkdown !== undefined
                  ? { aiRawMarkdown: result.aiRawMarkdown }
                  : {}),
                ...(result.sourceMappings ? { sourceMappings: result.sourceMappings } : {}),
                ...(result.selectionEvidence
                  ? { selectionEvidence: result.selectionEvidence }
                  : {}),
                ...(result.caption ? { caption: result.caption } : {}),
              };
            })();
        return {
          ...savedProjection,
          savedAt: result.savedAt.toISOString(),
          changedRows: result.changedRows,
          changedRowIds: result.changedRowIds,
          ...(result.snapshot ? { savedSnapshot: serializeSavedSnapshot(result.snapshot) } : {}),
        } as SteelReviewPrepared & {
          savedAt: string;
          changedRows: number;
          changedRowIds: string[];
          savedSnapshot?: SteelReviewSavedSnapshot;
        };
      }
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
    },
  };
}

export type SteelReviewService = ReturnType<typeof createSteelReviewService>;

export function parseSteelReviewQuery(query: Record<string, unknown>): SteelReviewReadQuery {
  const result = steelReviewReadQuerySchema.safeParse(query);
  if (!result.success) {
    throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review table');
  }
  return result.data;
}
