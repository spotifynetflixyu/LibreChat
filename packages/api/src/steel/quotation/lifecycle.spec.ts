import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  createSteelQuotationArtifactModel,
  createSteelQuotationInputMethods,
  createSteelQuotationStateModel,
  STEEL_QUOTATION_INPUT_TTL_MS,
} from '@librechat/data-schemas';
import type {
  SteelQuotationActiveRun,
  SteelQuotationScope,
  SteelQuotationTicket,
} from '@librechat/data-schemas';
import { createSteelQuotationStateService } from './state';

const prompts = {
  child: 'child quotation rules',
  main: 'main quotation rules',
};

const scope: SteelQuotationScope = {
  userId: 'user-quotation-lifecycle',
  conversationId: 'conversation-quotation-lifecycle',
};

let mongoServer: MongoMemoryReplSet;
let service: ReturnType<typeof createSteelQuotationStateService>;
let State: ReturnType<typeof createSteelQuotationStateModel>;
let Artifact: ReturnType<typeof createSteelQuotationArtifactModel>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function prepareTicket(
  inputScope: SteelQuotationScope = scope,
  now?: Date,
): Promise<SteelQuotationTicket> {
  await service.setOrder({ scope: inputScope, fullMarkdown: '# system_order\n| row |', now });
  return service.issueTicket({
    scope: inputScope,
    customerMarkdown: '## customer_data\n| name | A |',
    customerIdentity: 'customer-a',
    triggeringMessageId: `message-${inputScope.userId}`,
    selectionProvenance: { method: 'unique' },
    now,
  });
}

async function acceptRun(
  inputScope: SteelQuotationScope = scope,
  now?: Date,
): Promise<{ ticket: SteelQuotationTicket; run: SteelQuotationActiveRun }> {
  const ticket = await prepareTicket(inputScope, now);
  const run = await service.acceptSignal({
    scope: inputScope,
    index: ticket.index,
    token: ticket.token,
    orderHash: ticket.orderHash,
    customerMarkdown: ticket.customerMarkdown,
    customerIdentity: ticket.customerIdentity,
    prompts,
    chunks: [{ index: 1, sourceRowCount: 1 }],
    now,
  });
  return { ticket, run };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('timed out waiting for MongoDB state');
}

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger',
      args: ['--setParameter', 'ttlMonitorSleepSecs=1'],
    },
  });
  await mongoose.connect(mongoServer.getUri());
  State = createSteelQuotationStateModel(mongoose);
  Artifact = createSteelQuotationArtifactModel(mongoose);
  await Promise.all([State.createIndexes(), Artifact.createIndexes()]);
  service = createSteelQuotationStateService(mongoose);
});

beforeEach(async () => {
  await Promise.all([State.deleteMany({}), Artifact.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Steel quotation temporary input lifecycle', () => {
  it('fences delayed tickets and admission until the original completed run has a valid publication receipt', async () => {
    const firstTicket = await prepareTicket();
    const delayedTicket = await prepareTicket();
    const admission = (ticket: SteelQuotationTicket) => ({
      scope, index: ticket.index, token: ticket.token, orderHash: ticket.orderHash,
      customerMarkdown: ticket.customerMarkdown, customerIdentity: ticket.customerIdentity,
      prompts, chunks: [{ index: 1, sourceRowCount: 1 }],
    });
    const first = await service.acceptSignal(admission(firstTicket));
    const lease = await service.acquireLease({ scope, runId: first.runId, leaseToken: 'publication-race' });
    if (!lease) throw new Error('Missing lease');
    const finalRef = await service.writeArtifact({ scope, runId: first.runId, operationId: 'final',
      kind: 'final', payload: 'completed unpublished result', leaseToken: lease.leaseToken });
    await service.checkpoint({ scope, runId: first.runId, operationId: 'final', kind: 'final',
      artifactRef: finalRef, leaseToken: lease.leaseToken });
    await service.completeRun({ scope, runId: first.runId, finalRef, leaseToken: lease.leaseToken });
    const completed = (await service.readState(scope))?.activeRun;
    if (!completed) throw new Error('Missing completed run');
    const before = await service.readState(scope);
    const issue = () => service.issueTicket({ scope, customerMarkdown: firstTicket.customerMarkdown,
      customerIdentity: firstTicket.customerIdentity, triggeringMessageId: 'late-response',
      selectionProvenance: firstTicket.selectionProvenance });
    await expect(issue()).rejects.toThrow('unfinished or unpublished');
    await expect(service.saveCustomer({ scope, customerMarkdown: 'changed customer',
      customerIdentity: 'changed', triggeringMessageId: 'late-customer', responseId: 'late-customer-response',
      orderHash: firstTicket.orderHash, selectionProvenance: firstTicket.selectionProvenance }))
      .rejects.toThrow('unfinished or unpublished');
    await expect(service.acceptSignal(admission(delayedTicket))).rejects.toMatchObject({ code: 'concurrent_change' });
    expect((await service.readState(scope))?.tickets).toEqual(before?.tickets);
    expect((await service.readState(scope))?.activeRun).toEqual(completed);
    expect(await Artifact.countDocuments({ ...scope, kind: 'snapshot' })).toBe(1);
    expect(await Artifact.countDocuments({ ...scope, kind: 'archive' })).toBe(0);

    // A checkpoint alone is insufficient: the durable receipt and final hash must verify.
    await State.updateOne(scope, { $push: { 'activeRun.checkpointRefs': {
      operationId: 'published', kind: 'final', artifactId: 'missing', sha256: 'missing', updatedAt: new Date(),
    } } });
    await expect(issue()).rejects.toThrow('unfinished or unpublished');
    await expect(service.acceptSignal(admission(delayedTicket))).rejects.toMatchObject({ code: 'concurrent_change' });
    await State.updateOne(scope, { $set: { 'activeRun.checkpointRefs': completed.checkpointRefs } });
    await service.markPublished({ scope, runId: first.runId, finalSha256: finalRef.sha256 });
    const methods = createSteelQuotationInputMethods(mongoose);
    let raced = false;
    const delayedIssuer = createSteelQuotationStateService(mongoose, {
      ...methods,
      async isSteelQuotationRunPublished(inputScope, run) {
        const published = await methods.isSteelQuotationRunPublished(inputScope, run);
        if (published && !raced) {
          raced = true;
          const next = await service.acceptSignal(admission(delayedTicket));
          const nextLease = await service.acquireLease({ scope, runId: next.runId, leaseToken: 'late-ticket-race' });
          if (!nextLease) throw new Error('Missing next lease');
          const nextFinal = await service.writeArtifact({ scope, runId: next.runId, operationId: 'final',
            kind: 'final', payload: 'next unpublished result', leaseToken: nextLease.leaseToken });
          await service.checkpoint({ scope, runId: next.runId, operationId: 'final', kind: 'final',
            artifactRef: nextFinal, leaseToken: nextLease.leaseToken });
          await service.completeRun({ scope, runId: next.runId, finalRef: nextFinal, leaseToken: nextLease.leaseToken });
        }
        return published;
      },
    });
    // Complete another admitted run between the issuer's publication check and ticket CAS.
    await expect(delayedIssuer.issueTicket({ scope, customerMarkdown: firstTicket.customerMarkdown,
      customerIdentity: firstTicket.customerIdentity, triggeringMessageId: 'delayed-ticket-cas',
      selectionProvenance: firstTicket.selectionProvenance })).rejects.toThrow('unfinished or unpublished');
    const afterRace = await service.readState(scope);
    expect(afterRace?.activeRun?.runId).toBe(delayedTicket.token);
    expect(afterRace?.activeRun?.status).toBe('completed');
    expect(afterRace?.tickets).toHaveLength(2);
    expect(afterRace?.nextSignalIndex).toBe(2);
    expect(await Artifact.countDocuments({ ...scope, kind: 'snapshot' })).toBe(1);
    expect(await Artifact.countDocuments({ ...scope, runId: first.runId, kind: 'archive' })).toBe(1);
  });

  it('admits one immutable input, records its TTL, and blocks generic snapshot recreation', async () => {
    const ticket = await prepareTicket();
    const admission = {
      scope,
      index: ticket.index,
      token: ticket.token,
      orderHash: ticket.orderHash,
      customerMarkdown: ticket.customerMarkdown,
      customerIdentity: ticket.customerIdentity,
      prompts,
      chunks: [{ index: 1, sourceRowCount: 1 }],
    } as const;
    const runs = await Promise.all([
      service.acceptSignal(admission),
      service.acceptSignal(admission),
    ]);
    expect(new Set(runs.map((run) => run.runId))).toEqual(new Set([runs[0].runId]));

    const snapshots = await Artifact.find({
      ...scope,
      runId: runs[0].runId,
      operationId: 'snapshot',
      kind: 'snapshot',
    }).lean();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].expiresAt).toEqual(expect.any(Date));
    expect(snapshots[0].expiresAt?.getTime()).toBe(
      snapshots[0].createdAt!.getTime() + STEEL_QUOTATION_INPUT_TTL_MS,
    );
    await expect(service.writeArtifact({
      scope,
      runId: runs[0].runId,
      operationId: 'snapshot-recreated',
      kind: 'snapshot',
      payload: 'recreated input',
    })).rejects.toThrow('Quotation OCR input is unavailable or changed');
  });

  it('cancels only the scoped snapshot, retains runtime artifacts, and allows a fresh ticket', async () => {
    const first = await acceptRun();
    const lease = await service.acquireLease({
      scope,
      runId: first.run.runId,
      leaseToken: 'cancel-lease',
    });
    if (!lease) throw new Error('test setup did not acquire a lease');
    await service.checkpoint({
      scope,
      runId: first.run.runId,
      leaseToken: lease.leaseToken,
      operationId: 'chunk:1',
      kind: 'chunk',
      payload: 'saved chunk',
      chunkIndex: 1,
    });
    const finalPayload = 'saved final';
    await service.writeArtifact({
      scope,
      runId: first.run.runId,
      operationId: 'final',
      kind: 'final',
      payload: finalPayload,
      leaseToken: lease.leaseToken,
    });
    const foreignPayload = 'foreign artifact';
    const foreignScope = { userId: 'foreign-user', conversationId: 'foreign-conversation' };
    await Artifact.create({
      ...foreignScope,
      runId: 'foreign-run',
      operationId: 'chunk:1',
      kind: 'chunk',
      sha256: sha256(foreignPayload),
      payload: foreignPayload,
    });

    await expect(service.cancelRun({ scope, runId: first.run.runId })).resolves.toEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );
    await expect(service.cancelRun({ scope, runId: first.run.runId })).resolves.toEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(await Artifact.countDocuments({ ...scope, runId: first.run.runId, operationId: 'snapshot' })).toBe(0);
    expect(await Artifact.countDocuments({ ...scope, runId: first.run.runId, operationId: 'chunk:1' })).toBe(1);
    expect(await Artifact.countDocuments({ ...scope, runId: first.run.runId, operationId: 'final' })).toBe(1);
    expect(await Artifact.countDocuments(foreignScope)).toBe(1);
    expect((await service.readState(scope))?.tickets[0]?.acceptedRunId).toBe(first.run.runId);

    await expect(service.acceptSignal({
      scope,
      index: first.ticket.index,
      token: first.ticket.token,
      orderHash: first.ticket.orderHash,
      customerMarkdown: first.ticket.customerMarkdown,
      customerIdentity: first.ticket.customerIdentity,
      prompts,
      chunks: [{ index: 1, sourceRowCount: 1 }],
    })).resolves.toEqual(expect.objectContaining({ runId: first.run.runId, status: 'cancelled' }));

    const nextTicket = await service.issueTicket({
      scope,
      customerMarkdown: first.ticket.customerMarkdown,
      customerIdentity: first.ticket.customerIdentity,
      triggeringMessageId: 'fresh-message',
      selectionProvenance: { method: 'unique' },
    });
    const nextRun = await service.acceptSignal({
      scope,
      index: nextTicket.index,
      token: nextTicket.token,
      orderHash: nextTicket.orderHash,
      customerMarkdown: nextTicket.customerMarkdown,
      customerIdentity: nextTicket.customerIdentity,
      prompts,
      chunks: [{ index: 1, sourceRowCount: 1 }],
    });
    expect(nextRun.runId).not.toBe(first.run.runId);
    expect(nextRun.status).toBe('queued');
  });

  it('retires expired leased runs, fences late mutations, heals a missing TTL snapshot, and permits a new run', async () => {
    const acceptedAt = new Date();
    const first = await acceptRun();
    const lease = await service.acquireLease({
      scope,
      runId: first.run.runId,
      leaseToken: 'expired-lease',
      now: acceptedAt,
    });
    expect(lease).toBeDefined();
    const finalPayload = 'late final';
    const finalRef = await service.writeArtifact({
      scope,
      runId: first.run.runId,
      operationId: 'final',
      kind: 'final',
      payload: finalPayload,
      leaseToken: lease!.leaseToken,
      now: acceptedAt,
    });
    await State.updateOne(
      { ...scope, 'activeRun.runId': first.run.runId },
      { $set: { 'activeRun.acceptedAt': new Date(acceptedAt.getTime() - STEEL_QUOTATION_INPUT_TTL_MS - 1_000) } },
    );
    await Artifact.deleteOne({ ...scope, runId: first.run.runId, operationId: 'snapshot' });
    const expiredAt = new Date();

    await expect(service.heartbeatLease({
      scope,
      runId: first.run.runId,
      leaseToken: lease!.leaseToken,
      now: expiredAt,
    })).resolves.toBeUndefined();
    await expect(service.checkpoint({
      scope,
      runId: first.run.runId,
      leaseToken: lease!.leaseToken,
      operationId: 'chunk:late',
      kind: 'chunk',
      payload: 'late checkpoint',
      chunkIndex: 1,
      now: expiredAt,
    })).resolves.toBeUndefined();
    await expect(service.completeRun({
      scope,
      runId: first.run.runId,
      leaseToken: lease!.leaseToken,
      finalRef,
      now: expiredAt,
    })).resolves.toBeUndefined();
    expect((await service.readState(scope))?.activeRun?.status).toBe('cancelled');
    expect(await Artifact.countDocuments({ ...scope, runId: first.run.runId, operationId: 'snapshot' })).toBe(0);

    const nextTicket = await service.issueTicket({
      scope,
      customerMarkdown: first.ticket.customerMarkdown,
      customerIdentity: first.ticket.customerIdentity,
      triggeringMessageId: 'after-expiry',
      selectionProvenance: { method: 'unique' },
    });
    const nextRun = await service.acceptSignal({
      scope,
      index: nextTicket.index,
      token: nextTicket.token,
      orderHash: nextTicket.orderHash,
      customerMarkdown: nextTicket.customerMarkdown,
      customerIdentity: nextTicket.customerIdentity,
      prompts,
      chunks: [{ index: 1, sourceRowCount: 1 }],
    });
    expect(nextRun.runId).not.toBe(first.run.runId);
  });

  it('rolls back cancellation when scoped snapshot deletion fails and succeeds on retry', async () => {
    const prepared = await acceptRun();
    const originalDeleteOne = Artifact.collection.deleteOne.bind(Artifact.collection);
    const deleteSpy = jest.spyOn(Artifact.collection, 'deleteOne')
      .mockImplementationOnce(async () => {
        throw new Error('injected snapshot delete failure');
      })
      .mockImplementation((...args) => originalDeleteOne(...args));
    try {
      await expect(service.cancelRun({ scope, runId: prepared.run.runId })).rejects.toThrow(
        'injected snapshot delete failure',
      );
    } finally {
      deleteSpy.mockRestore();
    }
    const rolledBack = await State.findOne(scope).lean();
    expect(rolledBack?.activeRun?.status).toBe('queued');
    expect(rolledBack?.activeRun?.leaseToken).toBeUndefined();
    expect(await Artifact.countDocuments({ ...scope, runId: prepared.run.runId, operationId: 'snapshot' })).toBe(1);

    await expect(service.cancelRun({ scope, runId: prepared.run.runId })).resolves.toEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(await Artifact.countDocuments({ ...scope, runId: prepared.run.runId, operationId: 'snapshot' })).toBe(0);
  });

  it('lets MongoDB TTL delete only expired snapshots while final and publication artifacts remain', async () => {
    const prepared = await acceptRun();
    const finalPayload = 'published final';
    const finalSha256 = sha256(finalPayload);
    await Artifact.create({
      ...scope,
      runId: prepared.run.runId,
      operationId: 'final',
      kind: 'final',
      sha256: finalSha256,
      payload: finalPayload,
    });
    const publicationPayload = JSON.stringify({ finalSha256 });
    await Artifact.create({
      ...scope,
      runId: prepared.run.runId,
      operationId: 'published',
      kind: 'final',
      sha256: sha256(publicationPayload),
      payload: publicationPayload,
    });
    await Artifact.updateOne(
      { ...scope, runId: prepared.run.runId, operationId: 'snapshot' },
      { $set: { expiresAt: new Date(Date.now() + 1_000) } },
    );

    await waitFor(async () =>
      (await Artifact.countDocuments({ ...scope, runId: prepared.run.runId, operationId: 'snapshot' })) === 0,
    );
    expect(await Artifact.countDocuments({ ...scope, runId: prepared.run.runId, operationId: 'final' })).toBe(1);
    expect(await Artifact.countDocuments({ ...scope, runId: prepared.run.runId, operationId: 'published' })).toBe(1);
    expect(await Artifact.countDocuments({ expiresAt: { $exists: true } })).toBe(0);
  });
});
