import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import type {
  ISteelQuotationArtifact,
  SteelQuotationActiveRun,
  SteelQuotationScope,
} from '~/types';
import { createSteelQuotationArtifactModel } from '~/models/steel';

type ArtifactModel = ReturnType<typeof createSteelQuotationArtifactModel>;

const hashText = (text: string): string => createHash('sha256').update(text).digest('hex');
const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

function parseObject(payload: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(payload);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function hasEarlyOrderPublication(
  scope: SteelQuotationScope,
  run: SteelQuotationActiveRun,
  receiptArtifact: Pick<ISteelQuotationArtifact, 'sha256' | 'payload'> | null | undefined,
  normalizedArtifact: Pick<ISteelQuotationArtifact, 'sha256' | 'payload'> | null | undefined,
  baselineArtifact: Pick<ISteelQuotationArtifact, 'sha256' | 'payload' | 'markdownPublication'> | null | undefined,
): boolean {
  const receiptRef = run.checkpointRefs.find((ref) => ref.operationId === 'order-published' && ref.kind === 'main');
  const normalizedRef = run.checkpointRefs.find((ref) => ref.operationId === 'system-order:normalized' && ref.kind === 'main');
  const scopedRef = (ref: typeof receiptRef | undefined): boolean => Boolean(ref && ref.userId === scope.userId &&
    ref.conversationId === scope.conversationId && ref.tenantId === scope.tenantId && ref.runId === run.runId);
  if (!receiptRef || !receiptArtifact || receiptRef.sha256 !== receiptArtifact.sha256 ||
    !scopedRef(receiptRef) || receiptRef.artifactId !== `${run.runId}:order-published:${receiptRef.sha256}` ||
    receiptArtifact.sha256 !== hashText(receiptArtifact.payload)) return false;
  const receipt = parseObject(receiptArtifact.payload);
  const receiptKeys = receipt ? Object.keys(receipt).sort() : [];
  if (receiptKeys.join(',') !== 'inputSnapshotSha256,normalizedSha256,outputId,runId,systemOrderSha256,targetMessageId,version' ||
    receipt?.version !== 1 || !isSha256(receipt.inputSnapshotSha256) || receipt.inputSnapshotSha256 !== run.snapshotRef.sha256 ||
    !isSha256(receipt.normalizedSha256) || !isSha256(receipt.systemOrderSha256) ||
    readString(receipt.runId) !== run.runId ||
    readString(receipt.targetMessageId) !== run.targetMessageId ||
    readString(receipt.outputId) !== `system_order:${run.runId}` ||
    receipt.normalizedSha256 !== receipt.systemOrderSha256 || !normalizedRef || !scopedRef(normalizedRef) ||
    normalizedRef.artifactId !== `${run.runId}:system-order:normalized:${normalizedRef.sha256}` ||
    !normalizedArtifact || normalizedRef.sha256 !== receipt.normalizedSha256 ||
    normalizedArtifact.sha256 !== normalizedRef.sha256 || normalizedArtifact.sha256 !== hashText(normalizedArtifact.payload)) return false;
  if (!baselineArtifact || baselineArtifact.sha256 !== hashText(baselineArtifact.payload)) return false;
  const publication = baselineArtifact.markdownPublication;
  const reference = publication?.reference;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return false;
  return reference.source === 'ai' && reference.kind === 'system_order' &&
    reference.outputId === `system_order:${run.runId}` &&
    reference.messageId === run.targetMessageId &&
    reference.sha256 === readString(receipt.systemOrderSha256) &&
    typeof publication?.baselineMarkdown === 'string' &&
    hashText(publication.baselineMarkdown) === readString(receipt.systemOrderSha256);
}

function tenantFilter(scope: SteelQuotationScope): Record<string, unknown> {
  return scope.tenantId === undefined
    ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
    : { tenantId: scope.tenantId };
}

function scopeFilter(scope: SteelQuotationScope): Record<string, unknown> {
  return {
    userId: scope.userId,
    conversationId: scope.conversationId,
    ...tenantFilter(scope),
  };
}

function isScope(scope: SteelQuotationScope): boolean {
  return scope.userId.length > 0 && scope.conversationId.length > 0;
}

export function createSteelQuotationPublicationProof(
  Artifact: ArtifactModel,
  session?: ClientSession,
): {
  isPublished: (scope: SteelQuotationScope, run: SteelQuotationActiveRun) => Promise<boolean>;
} {
  return {
    async isPublished(scope, run) {
      if (!isScope(scope) || run.status !== 'completed') return false;
      const orderRef = run.checkpointRefs.find((ref) => ref.operationId === 'order-published' && ref.kind === 'main');
      if (orderRef) {
        const normalizedRef = run.checkpointRefs.find((ref) => ref.operationId === 'system-order:normalized' && ref.kind === 'main');
        if (!normalizedRef) return false;
        const receiptQuery = Artifact.findOne({ ...scopeFilter(scope), runId: run.runId, operationId: 'order-published', kind: 'main', sha256: orderRef.sha256 })
          .session(session ?? null).lean<ISteelQuotationArtifact>();
        const normalizedQuery = Artifact.findOne({ ...scopeFilter(scope), runId: run.runId, operationId: 'system-order:normalized', kind: 'main',
          sha256: normalizedRef.sha256 })
          .session(session ?? null).lean<ISteelQuotationArtifact>();
        const baselineQuery = Artifact.findOne({ ...scopeFilter(scope), runId: `markdown:quotation:${run.runId}`, operationId: 'ai:system_order', kind: 'main' })
          .session(session ?? null).lean<ISteelQuotationArtifact>();
        const [receiptArtifact, normalizedArtifact, baselineArtifact] = session
          ? [await receiptQuery, await normalizedQuery, await baselineQuery]
          : await Promise.all([receiptQuery, normalizedQuery, baselineQuery]);
        return hasEarlyOrderPublication(scope, run, receiptArtifact, normalizedArtifact, baselineArtifact);
      }
      const published = run.checkpointRefs.find((ref) => ref.operationId === 'published' && ref.kind === 'final');
      const final = run.checkpointRefs.find((ref) => ref.operationId === 'final' && ref.kind === 'final');
      if (!published || !final) return false;
      const receiptQuery = Artifact.findOne({ ...scopeFilter(scope), runId: run.runId,
        operationId: 'published', kind: 'final', sha256: published.sha256 })
        .session(session ?? null).lean<ISteelQuotationArtifact>();
      const finalQuery = Artifact.findOne({ ...scopeFilter(scope), runId: run.runId,
        operationId: 'final', kind: 'final', sha256: final.sha256 })
        .session(session ?? null).lean<ISteelQuotationArtifact>();
      const [receipt, finalArtifact] = session
        ? [await receiptQuery, await finalQuery]
        : await Promise.all([receiptQuery, finalQuery]);
      return Boolean(receipt && finalArtifact && receipt.sha256 === hashText(receipt.payload) &&
        finalArtifact.sha256 === hashText(finalArtifact.payload) &&
        receipt.payload === JSON.stringify({ finalSha256: finalArtifact.sha256 }));
    },
  };
}
