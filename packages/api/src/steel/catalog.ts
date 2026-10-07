import { createHash } from 'node:crypto';
import {
  steelCatalogQuerySchema,
} from 'librechat-data-provider';
import type {
  SteelCatalogCandidate,
  SteelCatalogCustomerEvidence,
  SteelCatalogPage,
  SteelCatalogQuery,
  SteelCatalogSelection,
  SteelCatalogSelectionEvidence,
} from 'librechat-data-provider';
import type { SteelReviewReadRecord, SteelReviewScope, SteelReviewReadMethods } from '@librechat/data-schemas';
import type { SteelRepositoryClient } from './repositories/types';
import type { SteelCatalogCursor } from './repositories/catalog';
import {
  decodeSteelCatalogCursor,
  encodeSteelCatalogCursor,
  resolveSteelReviewCatalogCandidate,
  searchSteelReviewCatalog,
} from './repositories/catalog';

export type SteelReviewCatalogScope = SteelReviewScope;

export interface SteelReviewCatalogClient {
  getClient(): SteelRepositoryClient | Promise<SteelRepositoryClient>;
}

export class SteelReviewCatalogError extends Error {
  readonly statusCode: 400 | 404 | 409 | 503;
  readonly code:
    | 'INVALID_REVIEW_QUERY'
    | 'REVIEW_NOT_FOUND'
    | 'CATALOG_CHANGED'
    | 'CATALOG_QUERY_FAILED';

  constructor(
    code: SteelReviewCatalogError['code'],
    statusCode: SteelReviewCatalogError['statusCode'],
    message: string,
  ) {
    super(message);
    this.name = 'SteelReviewCatalogError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface SteelReviewCatalogService {
  search(input: SteelReviewCatalogSearchInput): Promise<SteelCatalogPage>;
  resolve(input: SteelReviewCatalogResolveInput): Promise<{
    candidate: SteelCatalogCandidate;
    customer: SteelCatalogCustomerEvidence;
    evidence: SteelCatalogSelectionEvidence;
  }>;
}

export interface SteelReviewCatalogSearchInput {
  scope: SteelReviewCatalogScope;
  query: SteelCatalogQuery;
}

export interface SteelReviewCatalogResolveInput {
  scope: SteelReviewCatalogScope;
  messageId: string;
  title: string;
  outputId: string;
  revision: string;
  rowId: string;
  kind?: 'material' | 'processing';
  selection: SteelCatalogSelection;
}

function scopeKey(input: SteelReviewCatalogScope, query: SteelCatalogQuery): string {
  return createHash('sha256')
    .update(JSON.stringify([
      input.userId,
      input.tenantId ?? null,
      input.conversationId,
      query.messageId,
      query.title,
      query.outputId,
      query.revision,
      query.rowId,
      query.kind ?? 'material',
      query.parentRowId ?? null,
      query.materialCategory ?? null,
      query.materialThicknessMm ?? null,
    ]))
    .digest('hex');
}

function normalizedKeyword(keyword: string): string {
  return keyword.normalize('NFKC').trim().toLocaleLowerCase();
}

function requireCurrentMaterial(
  record: SteelReviewReadRecord | null,
  input: Pick<SteelCatalogQuery, 'outputId' | 'revision' | 'rowId' | 'title'>,
  checkRevision: boolean,
  checkRow = true,
): SteelReviewReadRecord {
  if (!record || record.state !== 'current' || record.outputId !== input.outputId ||
    (record.latestOutputId ?? record.outputId) !== record.outputId || (checkRevision && record.revision !== input.revision) ||
    record.title !== input.title) {
    throw new SteelReviewCatalogError('REVIEW_NOT_FOUND', 404, 'Review table is no longer current');
  }
  if (checkRow) {
    const row = record.rows?.find((candidate) => candidate.rowId === input.rowId);
    if (row && (row.deleted || row.system?.kind !== 'material')) {
      throw new SteelReviewCatalogError('REVIEW_NOT_FOUND', 404, 'Review material row was not found');
    }
  }
  return record;
}

function customerEvidenceForRecord(
  record: SteelReviewReadRecord,
): SteelCatalogCustomerEvidence {
  if (record.customerSnapshot) {
    const tier = steelCatalogCustomerTier(
      record.customerSnapshot.customerIdentity,
      record.customerSnapshot.customerMarkdown,
    );
    if (!tier) {
      throw new SteelReviewCatalogError('CATALOG_CHANGED', 409, 'Quotation customer tier is unavailable');
    }
    return {
      snapshotId: record.customerSnapshot.snapshotId,
      revision: steelCatalogCustomerRevision(
        record.customerSnapshot.customerIdentity,
        record.customerSnapshot.customerMarkdown,
      ),
      tier,
    };
  }
  throw new SteelReviewCatalogError('CATALOG_CHANGED', 409, 'Quotation customer evidence is unavailable');
}

function makeCursor(
  input: SteelReviewCatalogSearchInput,
  candidate: SteelCatalogCandidate,
): string {
  return encodeSteelCatalogCursor({
    field: input.query.field,
    keyword: normalizedKeyword(input.query.keyword),
    scope: scopeKey(input.scope, input.query),
    erpItemCode: candidate.erpItemCode,
    id: candidate.id,
  });
}

function parseCursor(
  input: SteelReviewCatalogSearchInput,
): SteelCatalogCursor | undefined {
  if (!input.query.cursor) return undefined;
  const cursor = decodeSteelCatalogCursor(input.query.cursor);
  if (!cursor || cursor.field !== input.query.field || cursor.keyword !== normalizedKeyword(input.query.keyword) ||
    cursor.scope !== scopeKey(input.scope, input.query)) {
    throw new SteelReviewCatalogError('INVALID_REVIEW_QUERY', 400, 'Catalog cursor is invalid');
  }
  return cursor;
}

function parseQuery(input: SteelCatalogQuery): SteelCatalogQuery {
  const parsed = steelCatalogQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new SteelReviewCatalogError('INVALID_REVIEW_QUERY', 400, 'Invalid catalog query');
  }
  return parsed.data;
}

function requestedCustomerRunId(outputId: string): string | undefined {
  const prefix = 'system_order:';
  if (!outputId.startsWith(prefix)) {
    return undefined;
  }
  const runId = outputId.slice(prefix.length);
  return runId.length > 0 ? runId : undefined;
}

export function createSteelReviewCatalogService({
  reader,
  client,
  pageSize = 25,
}: {
  reader: SteelReviewReadMethods;
  client: SteelReviewCatalogClient;
  pageSize?: number;
}): SteelReviewCatalogService {
  const defaultPageSize = Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : 25;

  async function authorize(
    scope: SteelReviewCatalogScope,
    query: Pick<SteelCatalogQuery, 'messageId' | 'title' | 'outputId' | 'revision' | 'rowId'>,
    checkRevision: boolean,
    checkRow = true,
  ): Promise<SteelReviewReadRecord> {
    const customerRunId = requestedCustomerRunId(query.outputId);
    return requireCurrentMaterial(
      await reader.readSteelReview({
        ...scope,
        kind: 'system_order',
        messageId: query.messageId,
        title: query.title,
        ...(customerRunId ? { customerRunId } : {}),
      }),
      query,
      checkRevision,
      checkRow,
    );
  }

  return {
    async search(input): Promise<SteelCatalogPage> {
      const query = parseQuery(input.query);
      const record = await authorize(input.scope, query, true, query.kind !== 'processing');
      const customerEvidence = customerEvidenceForRecord(record);
      const cursor = parseCursor({ ...input, query });
      let result: Awaited<ReturnType<typeof searchSteelReviewCatalog>>;
      try {
        const catalogClient = await client.getClient();
        result = await searchSteelReviewCatalog(catalogClient, {
          field: query.field,
          keyword: query.keyword,
          ...(cursor ? { cursor } : {}),
          limit: query.limit ?? defaultPageSize,
          tier: customerEvidence.tier,
          ...(query.kind ? { kind: query.kind } : {}),
          ...(query.parentRowId ? { parentRowId: query.parentRowId } : {}),
          ...(query.materialCategory !== undefined ? { materialCategory: query.materialCategory } : {}),
          ...(query.materialThicknessMm !== undefined ? { materialThicknessMm: query.materialThicknessMm } : {}),
        });
      } catch {
        throw new SteelReviewCatalogError('CATALOG_QUERY_FAILED', 503, 'Catalog query failed');
      }
      const last = result.candidates[result.candidates.length - 1];
      return {
        options: result.candidates,
        nextCursor: result.hasMore && last ? makeCursor({ ...input, query }, last) : null,
        hasMore: result.hasMore,
        complete: query.cursor === undefined && result.exhausted,
        customer: customerEvidence,
      };
    },

    async resolve(input) {
      const query = {
        messageId: input.messageId,
        title: input.title,
        outputId: input.outputId,
        revision: input.revision,
        rowId: input.rowId,
      } as const;
      const record = await authorize(input.scope, query, false, input.kind !== 'processing');
      const customerEvidence = customerEvidenceForRecord(record);
      if (input.selection.evidence.snapshotId !== customerEvidence.snapshotId ||
        input.selection.evidence.revision !== customerEvidence.revision ||
        input.selection.evidence.tier !== customerEvidence.tier) {
        throw new SteelReviewCatalogError('CATALOG_CHANGED', 409, 'Catalog customer evidence changed');
      }
      let candidate: SteelCatalogCandidate | null;
      try {
        const catalogClient = await client.getClient();
        candidate = await resolveSteelReviewCatalogCandidate(catalogClient, {
          id: input.selection.id,
          tier: customerEvidence.tier,
          ...(input.kind ? { kind: input.kind } : {}),
        });
      } catch {
        throw new SteelReviewCatalogError('CATALOG_QUERY_FAILED', 503, 'Catalog query failed');
      }
      if (!candidate || candidate.revision !== input.selection.revision) {
        throw new SteelReviewCatalogError('CATALOG_CHANGED', 409, 'Catalog candidate changed');
      }
      if (input.kind !== 'processing' && candidate.category.startsWith('加工/')) {
        throw new SteelReviewCatalogError('CATALOG_CHANGED', 409, 'Catalog candidate is not a material');
      }
      return {
        candidate,
        customer: customerEvidence,
        evidence: {
          rowId: input.rowId,
          candidateId: candidate.id,
          candidateRevision: candidate.revision,
          customerSnapshotId: customerEvidence.snapshotId,
          customerRevision: customerEvidence.revision,
          customerTier: customerEvidence.tier,
          unitPrice: candidate.unitPrice,
        },
      };
    },
  };
}

export function steelCatalogCustomerRevision(customerIdentity: string, customerMarkdown: string): string {
  return createHash('sha256')
    .update(JSON.stringify([customerIdentity, customerMarkdown]))
    .digest('hex');
}

export function steelCatalogCustomerTier(customerIdentity: string, customerMarkdown: string): SteelCatalogCustomerEvidence['tier'] | null {
  const markdownTier = customerMarkdown.match(/\|\s*[^|]*\|\s*[^|]*\|\s*([A-F])\s*\|/iu)?.[1]?.toUpperCase();
  const identityTier = customerIdentity.match(/(?:^|:)\s*([A-F])$/iu)?.[1]?.toUpperCase();
  const tier = markdownTier ?? identityTier;
  return tier && /^[A-F]$/u.test(tier) ? tier as SteelCatalogCustomerEvidence['tier'] : null;
}

export function createSteelReviewCatalogClient(
  createClient: () => SteelRepositoryClient,
): SteelReviewCatalogClient {
  let client: SteelRepositoryClient | undefined;
  return { getClient: () => (client ??= createClient()) };
}
