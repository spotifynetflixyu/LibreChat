import { createHash } from 'node:crypto';
import type { FilterQuery, Model } from 'mongoose';
import type {
  ISteelQuotationArtifact,
  ISteelReviewOutput,
  SteelMarkdownKind,
  SteelMarkdownReference,
  SteelReviewReceipt,
  SteelReviewSavedSnapshotRecord,
} from '~/types';
import {
  createSteelQuotationArtifactModel,
  createSteelReviewOutputModel,
} from '~/models/steel';

const markdownKinds: readonly SteelMarkdownKind[] = [
  'ocr_result',
  'system_order',
  'customer_data',
];

export interface SteelMarkdownHistoryMessage {
  messageId: string;
  metadata?: Record<string, unknown>;
}

export interface SteelMarkdownHistoryReadInput {
  userId: string;
  conversationId: string;
  tenantId?: string;
  messages: readonly SteelMarkdownHistoryMessage[];
}

export interface SteelMarkdownHistoryRecord {
  messageId: string;
  kind: SteelMarkdownKind;
  reference: SteelMarkdownReference;
  effectiveMarkdown: string;
}

export interface SteelMarkdownHistoryMethods {
  readSteelMarkdownHistory(
    input: SteelMarkdownHistoryReadInput,
  ): Promise<SteelMarkdownHistoryRecord[]>;
}

type Mongoose = typeof import('mongoose');
type BoundReference = { messageId: string; reference: SteelMarkdownReference };

function digest(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

function tenantFilter(tenantId?: string): FilterQuery<ISteelQuotationArtifact> {
  return tenantId === undefined
    ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
    : { tenantId };
}

function scopeFilter(input: SteelMarkdownHistoryReadInput): FilterQuery<ISteelQuotationArtifact> {
  return {
    userId: input.userId,
    conversationId: input.conversationId,
    ...tenantFilter(input.tenantId),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function date(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseAiReference(
  value: unknown,
  kind: SteelMarkdownKind,
  messageId: string,
): SteelMarkdownReference | undefined {
  const candidate = record(value);
  if (!candidate || candidate.kind !== kind || candidate.source !== 'ai' ||
    candidate.messageId !== messageId) {
    return undefined;
  }
  const snapshotId = text(candidate.snapshotId);
  const generationId = text(candidate.generationId);
  const outputId = text(candidate.outputId);
  const title = text(candidate.title);
  const revision = text(candidate.revision);
  const sha256 = text(candidate.sha256);
  const lineageId = text(candidate.lineageId);
  const savedAt = date(candidate.savedAt);
  if (!snapshotId || !generationId || !outputId || !title || !revision ||
    !sha256 || !/^[a-f0-9]{64}$/u.test(sha256) || !lineageId || !savedAt) {
    return undefined;
  }
  const operationId = candidate.operationId === undefined
    ? undefined
    : text(candidate.operationId);
  if (candidate.operationId !== undefined && !operationId) {
    return undefined;
  }
  return {
    kind,
    source: 'ai',
    snapshotId,
    generationId,
    outputId,
    messageId,
    title,
    revision,
    sha256,
    lineageId,
    savedAt,
    ...(operationId ? { operationId } : {}),
  };
}

function boundReferences(messages: readonly SteelMarkdownHistoryMessage[]): BoundReference[] {
  const result: BoundReference[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (!message.messageId) {
      continue;
    }
    const owners = record(message.metadata?.steelMarkdownOwners);
    if (!owners) {
      continue;
    }
    for (const kind of markdownKinds) {
      const owner = record(owners[kind]);
      const reference = parseAiReference(owner, kind, message.messageId);
      if (!reference) {
        continue;
      }
      const key = [reference.kind, reference.messageId, reference.outputId, reference.title,
        reference.revision, reference.sha256].join('\u0000');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ messageId: message.messageId, reference });
    }
  }
  return result;
}

function sameReference(left: SteelMarkdownReference, right: SteelMarkdownReference): boolean {
  return left.kind === right.kind && left.source === right.source &&
    left.snapshotId === right.snapshotId && left.generationId === right.generationId &&
    left.outputId === right.outputId && left.messageId === right.messageId &&
    left.title === right.title && left.revision === right.revision &&
    left.sha256 === right.sha256 && left.lineageId === right.lineageId &&
    left.savedAt.getTime() === right.savedAt.getTime() &&
    left.operationId === right.operationId;
}

function artifactFor(
  artifacts: readonly ISteelQuotationArtifact[],
  reference: SteelMarkdownReference,
): { baselineMarkdown: string } | undefined {
  const matches = artifacts.filter((artifact) => {
    const snapshot = artifact.markdownPublication;
    return snapshot !== undefined && sameReference(snapshot.reference, reference) &&
      snapshot.reference.source === 'ai';
  });
  if (matches.length !== 1) {
    return undefined;
  }
  const baselineMarkdown = matches[0]?.markdownPublication?.baselineMarkdown;
  if (!baselineMarkdown || digest(baselineMarkdown) !== reference.sha256) {
    return undefined;
  }
  return { baselineMarkdown };
}

function receiptSnapshot(
  output: ISteelReviewOutput,
  reference: SteelMarkdownReference,
  baselineMarkdown: string,
): { receipt: SteelReviewReceipt; snapshot: SteelReviewSavedSnapshotRecord } | undefined {
  if (output.aiBaselineMarkdown !== baselineMarkdown || output.effectiveMarkdown === undefined) {
    return undefined;
  }
  const candidates = (output.receipts ?? [])
    .filter((receipt) => receipt.changedRows > 0 && receipt.snapshot !== undefined)
    .map((receipt) => ({ receipt, snapshot: receipt.snapshot! }))
    .filter(({ receipt, snapshot }) => snapshot.outputId === reference.outputId &&
      snapshot.messageId === reference.messageId && snapshot.title === reference.title &&
      snapshot.operationId === receipt.operationId && snapshot.revision === receipt.revision && snapshot.revision === output.revision &&
      typeof snapshot.effectiveMarkdown === 'string' && snapshot.effectiveMarkdown.length > 0 &&
      output.effectiveMarkdown === snapshot.effectiveMarkdown &&
      date(snapshot.savedAt) !== undefined &&
      (snapshot.aiBaselineMarkdown === undefined || snapshot.aiBaselineMarkdown === baselineMarkdown));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function humanReference(
  reference: SteelMarkdownReference,
  receipt: SteelReviewReceipt,
  snapshot: SteelReviewSavedSnapshotRecord,
): SteelMarkdownReference | undefined {
  const savedAt = date(snapshot.savedAt);
  if (!savedAt || !snapshot.effectiveMarkdown) {
    return undefined;
  }
  return {
    ...reference,
    source: 'human',
    snapshotId: `${reference.outputId}:${receipt.operationId}`,
    operationId: receipt.operationId,
    revision: snapshot.revision,
    sha256: digest(snapshot.effectiveMarkdown),
    savedAt,
  };
}

export function createSteelHistoryMethods(mongoose: Mongoose): SteelMarkdownHistoryMethods {
  const Artifact = createSteelQuotationArtifactModel(mongoose) as Model<ISteelQuotationArtifact>;
  const Output = createSteelReviewOutputModel(mongoose) as Model<ISteelReviewOutput>;

  async function readSteelMarkdownHistory(
    input: SteelMarkdownHistoryReadInput,
  ): Promise<SteelMarkdownHistoryRecord[]> {
    const bound = boundReferences(input.messages);
    if (!input.userId || !input.conversationId || bound.length === 0) {
      return [];
    }
    const messageIds = [...new Set(bound.map(({ messageId }) => messageId))];
    const outputIds = [...new Set(bound.map(({ reference }) => reference.outputId))];
    const baseFilter = scopeFilter(input);
    const [artifacts, outputs] = await Promise.all([
      Artifact.find({
        ...baseFilter,
        'markdownPublication.reference.messageId': { $in: messageIds },
        'markdownPublication.reference.kind': { $in: markdownKinds },
      }).select({ markdownPublication: 1 }).lean<ISteelQuotationArtifact[]>(),
      Output.find({
        ...baseFilter,
        messageId: { $in: messageIds },
        outputId: { $in: outputIds },
        kind: { $in: markdownKinds },
      }).select({
        kind: 1,
        messageId: 1,
        title: 1,
        outputId: 1,
        revision: 1,
        aiBaselineMarkdown: 1,
        effectiveMarkdown: 1,
        receipts: 1,
      }).lean<ISteelReviewOutput[]>(),
    ]);
    const ownerKey = (owner: Pick<SteelMarkdownReference, 'kind' | 'messageId' | 'outputId' | 'title'>): string =>
      JSON.stringify([owner.kind, owner.messageId, owner.outputId, owner.title]);
    const artifactsByOwner = new Map<string, ISteelQuotationArtifact[]>();
    for (const artifact of artifacts) {
      if (!artifact.markdownPublication) continue;
      const key = ownerKey(artifact.markdownPublication.reference);
      const bucket = artifactsByOwner.get(key) ?? [];
      bucket.push(artifact);
      artifactsByOwner.set(key, bucket);
    }
    const outputsByOwner = new Map<string, ISteelReviewOutput[]>();
    for (const output of outputs) {
      if (!output.title) continue;
      const key = ownerKey({ ...output, title: output.title });
      const bucket = outputsByOwner.get(key) ?? [];
      bucket.push(output);
      outputsByOwner.set(key, bucket);
    }
    const records: SteelMarkdownHistoryRecord[] = [];
    for (const { messageId, reference } of bound) {
      const artifact = artifactFor(artifactsByOwner.get(ownerKey(reference)) ?? [], reference);
      if (!artifact) {
        continue;
      }
      const outputMatches = outputsByOwner.get(ownerKey(reference)) ?? [];
      const output = outputMatches.length === 1 ? outputMatches[0] : undefined;
      const human = output
        ? receiptSnapshot(output, reference, artifact.baselineMarkdown)
        : undefined;
      if (human) {
        const resolvedReference = humanReference(reference, human.receipt, human.snapshot);
        if (resolvedReference) {
          records.push({ messageId, kind: reference.kind, reference: resolvedReference,
            effectiveMarkdown: human.snapshot.effectiveMarkdown });
          continue;
        }
      }
      records.push({ messageId, kind: reference.kind, reference,
        effectiveMarkdown: artifact.baselineMarkdown });
    }
    return records;
  }

  return { readSteelMarkdownHistory };
}
