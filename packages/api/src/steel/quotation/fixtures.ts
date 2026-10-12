import { createHash } from 'node:crypto';

import {
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
} from '@librechat/data-schemas';

import type {
  ISteelQuotationState,
  SteelQuotationActiveRun,
  SteelQuotationArtifactRef,
  SteelQuotationCustomerPreparation,
  SteelQuotationCurrentSystemOrder,
  SteelQuotationScope,
} from '@librechat/data-schemas';

type Mongoose = typeof import('mongoose');

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function ref(
  scope: SteelQuotationScope,
  runId: string,
  operationId: string,
  kind: 'final',
  sha256: string,
): SteelQuotationArtifactRef {
  return {
    artifactId: `${runId}:${operationId}:${sha256}`,
    userId: scope.userId,
    conversationId: scope.conversationId,
    ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
    runId,
    operationId,
    kind,
    sha256,
  };
}

export async function seedCompletedRun(input: {
  mongoose: Mongoose;
  scope: SteelQuotationScope;
  run: SteelQuotationActiveRun;
  targetMessageId?: string;
}): Promise<ISteelQuotationState | null> {
  const State = createSteelQuotationStateModel(input.mongoose);
  const now = new Date();
  const activeRun: SteelQuotationActiveRun = {
    ...input.run,
    status: 'completed',
    ...(input.targetMessageId ? { targetMessageId: input.targetMessageId } : {}),
    updatedAt: now,
  };
  delete activeRun.leaseToken;
  delete activeRun.leaseExpiresAt;
  const state = await State.findOneAndUpdate(
    { userId: input.scope.userId, conversationId: input.scope.conversationId, tenantId: input.scope.tenantId ?? null,
      'activeRun.runId': input.run.runId },
    { $set: { activeRun, updatedAt: now } },
    { new: true },
  ).lean<ISteelQuotationState>();
  return state;
}

export async function seedLegacyPublication(input: {
  mongoose: Mongoose;
  scope: SteelQuotationScope;
  run: SteelQuotationActiveRun;
  markdown: string;
  currentSystemOrder?: SteelQuotationCurrentSystemOrder;
  targetMessageId?: string;
}): Promise<{
  finalRef: SteelQuotationArtifactRef;
  publicationRef: SteelQuotationArtifactRef;
  state: ISteelQuotationState | null;
}> {
  const Artifact = createSteelQuotationArtifactModel(input.mongoose);
  const targetMessageId = input.targetMessageId ?? input.run.targetMessageId;
  const finalSha256 = hash(input.markdown);
  const publicationPayload = JSON.stringify({ finalSha256 });
  const finalRef = ref(input.scope, input.run.runId, 'final', 'final', finalSha256);
  const publicationRef = ref(
    input.scope,
    input.run.runId,
    'published',
    'final',
    hash(publicationPayload),
  );
  const now = new Date();
  await Artifact.create([
    {
      ...input.scope,
      runId: input.run.runId,
      operationId: 'final',
      kind: 'final',
      sha256: finalSha256,
      payload: input.markdown,
      createdAt: now,
      updatedAt: now,
    },
    {
      ...input.scope,
      runId: input.run.runId,
      operationId: 'published',
      kind: 'final',
      sha256: publicationRef.sha256,
      payload: publicationPayload,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const completed = await seedCompletedRun({
    mongoose: input.mongoose,
    scope: input.scope,
    run: input.run,
    targetMessageId,
  });
  const State = createSteelQuotationStateModel(input.mongoose);
  const checkpointRefs = [
    ...input.run.checkpointRefs.filter((entry) => entry.operationId !== 'final' && entry.operationId !== 'published'),
    { ...finalRef, updatedAt: now },
    { ...publicationRef, updatedAt: now },
  ];
  const systemOrder = input.currentSystemOrder ?? {
    runId: input.run.runId,
    ...(targetMessageId ? { messageId: targetMessageId } : {}),
    sha256: finalSha256,
    markdown: input.markdown,
    updatedAt: now,
  };
  const ticket = completed?.tickets.find((entry) => entry.acceptedRunId === input.run.runId);
  const currentCustomer: SteelQuotationCustomerPreparation | undefined = ticket
    ? {
        preparationId: ticket.preparationId ?? `legacy-preparation:${input.run.runId}`,
        customerMarkdown: ticket.customerMarkdown,
        customerIdentity: ticket.customerIdentity,
        orderHash: ticket.orderHash,
        triggeringMessageId: ticket.triggeringMessageId,
        responseId: ticket.responseId ?? ticket.triggeringMessageId,
        selectionProvenance: ticket.selectionProvenance,
      }
    : undefined;
  const state = await State.findOneAndUpdate(
    { userId: input.scope.userId, conversationId: input.scope.conversationId, tenantId: input.scope.tenantId ?? null,
      'activeRun.runId': input.run.runId },
    { $set: {
      'activeRun.checkpointRefs': checkpointRefs,
      currentSystemOrder: systemOrder,
      ...(currentCustomer ? { currentCustomer } : {}),
      updatedAt: now,
    } },
    { new: true },
  ).lean<ISteelQuotationState>();
  await Artifact.deleteOne({ ...input.scope, runId: input.run.runId, operationId: 'snapshot', kind: 'snapshot' });
  return { finalRef, publicationRef, state: state ?? completed };
}
