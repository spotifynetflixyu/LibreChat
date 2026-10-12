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
