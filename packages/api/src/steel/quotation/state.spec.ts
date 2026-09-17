import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
} from '@librechat/data-schemas';

import type {
  SteelQuotationActiveRun,
  SteelQuotationCustomerPreparation,
  SteelQuotationScope,
  SteelQuotationTicket,
} from '@librechat/data-schemas';
import {
  createSteelQuotationStateService as createService,
  MAX_QUOTATION_ARTIFACT_BYTES,
} from './state';

let mongoServer: MongoMemoryServer;
let service: ReturnType<typeof createService>;

const scope: SteelQuotationScope = {
  userId: 'user-quotation-state',
  conversationId: 'conversation-quotation-state',
};
const prompts = {
  child: 'child rules and category rules',
  main: 'main rules and output contract',
};

async function prepareRun(
  inputScope: SteelQuotationScope = scope,
  order = '# system_order\n| row |',
): Promise<{ ticket: SteelQuotationTicket; run: SteelQuotationActiveRun }> {
  await service.setOrder({ scope: inputScope, fullMarkdown: order, revision: 'r1' });
  const ticket = await service.issueTicket({
    scope: inputScope,
    customerMarkdown: '## customer_data\n| name | A |',
    customerIdentity: 'customer-a',
    triggeringMessageId: 'user-message-1',
    selectionProvenance: { method: 'unique', lookupMessageId: 'lookup-1' },
  });
  if (!ticket) {
    throw new Error('test setup did not issue a quotation ticket');
  }
  const run = await service.acceptSignal({
    scope: inputScope,
    index: ticket.index,
    token: ticket.token,
    orderHash: ticket.orderHash,
    customerMarkdown: ticket.customerMarkdown,
    customerIdentity: ticket.customerIdentity,
    prompts,
    chunks: [{ index: 1, sourceRowCount: 1 }],
    targetMessageId: 'assistant-target-1',
  });
  return { ticket, run };
}

async function prepareCustomer(
  inputScope: SteelQuotationScope = scope,
  responseId = 'response-1',
  order = '# system_order\n| row |',
): Promise<SteelQuotationCustomerPreparation> {
  await service.setOrder({ scope: inputScope, fullMarkdown: order });
  return service.saveCustomer({
    scope: inputScope,
    customerMarkdown: '## customer_data\n| name | A |',
    customerIdentity: 'customer-a',
    triggeringMessageId: `message-${responseId}`,
    responseId,
    selectionProvenance: { method: 'unique', lookupMessageId: 'lookup-1' },
    orderHash: String((await service.readState(inputScope))?.currentOrder?.sha256),
  });
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  service = createService(mongoose);
});

beforeEach(async () => {
  // dropDatabase removes indexes too; each concurrency test needs the same
  // uniqueness guarantees required by the deployed quotation collections.
  await Promise.all([
    createSteelQuotationStateModel(mongoose).createIndexes(),
    createSteelQuotationArtifactModel(mongoose).createIndexes(),
  ]);
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Steel quotation state service', () => {
  it('creates one authority under concurrent first requests', async () => {
    const states = await Promise.all(Array.from({ length: 16 }, () => service.ensureState(scope)));
    expect(new Set(states.map((state) => String(state._id))).size).toBe(1);
    expect(await createSteelQuotationStateModel(mongoose).countDocuments(scope)).toBe(1);
  });

  it('accepts a signal once under competing delivery and grants one live lease', async () => {
    await service.setOrder({ scope, fullMarkdown: '# order' });
    const ticket = await service.issueTicket({
      scope,
      customerMarkdown: '# customer',
      customerIdentity: 'customer-a',
      triggeringMessageId: 'message-1',
      selectionProvenance: { method: 'selected', selectionMessageId: 'message-1' },
    });
    if (!ticket) {
      throw new Error('ticket missing');
    }
    const input = {
      scope,
      index: ticket.index,
      token: ticket.token,
      orderHash: ticket.orderHash,
      customerMarkdown: ticket.customerMarkdown,
      customerIdentity: ticket.customerIdentity,
      prompts,
      chunks: [{ index: 1, sourceRowCount: 1 }],
    };
    const accepted = await Promise.all([
      service.acceptSignal(input),
      service.acceptSignal(input),
    ]);
    expect(accepted[0].runId).toBe(accepted[1].runId);
    expect(accepted[0].snapshotRef.sha256).toBe(accepted[1].snapshotRef.sha256);

    const leases = await Promise.all([
      service.acquireLease({ scope, runId: accepted[0].runId, leaseToken: 'lease-a' }),
      service.acquireLease({ scope, runId: accepted[0].runId, leaseToken: 'lease-b' }),
    ]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    const state = await service.readState(scope);
    expect(state?.activeRun?.leaseToken).toBe(
      leases[0]?.leaseToken ?? leases[1]?.leaseToken,
    );
  });

  it('saves a customer without allocating an index and retains it when the order changes', async () => {
    const preparation = await prepareCustomer();
    const saved = await service.readState(scope);
    expect(preparation.preparationId).toEqual(expect.any(String));
    expect(saved?.nextSignalIndex).toBe(0);
    expect(saved?.currentCustomer).toEqual(preparation);

    await service.clearCustomer({ scope, responseId: 'other-response' });
    expect((await service.readState(scope))?.currentCustomer?.preparationId).toBe(
      preparation.preparationId,
    );
    await service.clearCustomer({ scope, responseId: 'response-1' });
    expect((await service.readState(scope))?.currentCustomer).toBeUndefined();

    const retainedPreparation = await service.saveCustomer({
      scope,
      customerMarkdown: preparation.customerMarkdown,
      customerIdentity: preparation.customerIdentity,
      triggeringMessageId: preparation.triggeringMessageId,
      responseId: preparation.responseId,
      selectionProvenance: preparation.selectionProvenance,
      orderHash: String((await service.readState(scope))?.currentOrder?.sha256),
    });
    await service.setOrder({ scope, fullMarkdown: '# revised order' });
    const revised = await service.readState(scope);
    expect(revised?.currentCustomer).toEqual(retainedPreparation);
    expect(revised?.nextSignalIndex).toBe(0);
  });

  it('supports customer preparation before OCR and clears by observed preparation ID', async () => {
    const preparation = await service.saveCustomer({
      scope,
      customerMarkdown: '## customer_data\n| name | B |',
      customerIdentity: 'customer-before-ocr',
      triggeringMessageId: 'customer-message',
      responseId: 'customer-response',
      selectionProvenance: { method: 'default_tier' },
    });
    expect(preparation.orderHash).toBeUndefined();
    expect((await service.readState(scope))?.nextSignalIndex).toBe(0);

    await service.setOrder({ scope, fullMarkdown: '# OCR order' });
    expect((await service.readState(scope))?.currentCustomer).toEqual(preparation);

    await service.clearCustomer({
      scope,
      responseId: 'later-response',
      preparationId: preparation.preparationId,
    });
    expect((await service.readState(scope))?.currentCustomer).toBeUndefined();
  });

  it('returns the existing preparation for an idempotent response and fences expected replacements', async () => {
    const first = await prepareCustomer();
    if (!first.orderHash) throw new Error('test setup did not save an order hash');
    const firstOrderHash = first.orderHash;
    const repeated = await service.saveCustomer({
      scope,
      customerMarkdown: first.customerMarkdown,
      customerIdentity: first.customerIdentity,
      triggeringMessageId: first.triggeringMessageId,
      responseId: first.responseId,
      selectionProvenance: first.selectionProvenance,
      orderHash: firstOrderHash,
      expectedPreparationId: 'already-replaced',
    });
    expect(repeated.preparationId).toBe(first.preparationId);

    const second = await service.saveCustomer({
      scope,
      customerMarkdown: '## customer_data\n| name | C |',
      customerIdentity: 'customer-c',
      triggeringMessageId: 'message-2',
      responseId: 'response-2',
      selectionProvenance: { method: 'selected', selectionMessageId: 'selection-2' },
      orderHash: firstOrderHash,
      expectedPreparationId: first.preparationId,
    });
    expect(second.preparationId).not.toBe(first.preparationId);
    await expect(service.saveCustomer({
      scope,
      customerMarkdown: '## customer_data\n| name | D |',
      customerIdentity: 'customer-d',
      triggeringMessageId: 'message-3',
      responseId: 'response-3',
      selectionProvenance: { method: 'unique' },
      orderHash: firstOrderHash,
      expectedPreparationId: first.preparationId,
    })).rejects.toThrow('changed since it was read');
  });

  it('rejects stale and mismatched customer preparations before ticket allocation', async () => {
    const preparation = await prepareCustomer();
    const orderHash = preparation.orderHash;
    if (!orderHash) throw new Error('test setup did not save an order hash');
    await expect(service.saveCustomer({
      scope,
      customerMarkdown: preparation.customerMarkdown,
      customerIdentity: preparation.customerIdentity,
      triggeringMessageId: preparation.triggeringMessageId,
      responseId: 'stale-response',
      selectionProvenance: preparation.selectionProvenance,
      orderHash: 'stale-order-hash',
    })).rejects.toThrow('stale');
    await expect(service.issueTicket({
      scope,
      customerMarkdown: preparation.customerMarkdown,
      customerIdentity: preparation.customerIdentity,
      triggeringMessageId: preparation.triggeringMessageId,
      selectionProvenance: preparation.selectionProvenance,
      preparationId: 'wrong-preparation',
      responseId: preparation.responseId,
      orderHash,
    })).rejects.toThrow('current customer preparation');

    const ticket = await service.issueTicket({
      scope,
      customerMarkdown: preparation.customerMarkdown,
      customerIdentity: preparation.customerIdentity,
      triggeringMessageId: preparation.triggeringMessageId,
      selectionProvenance: preparation.selectionProvenance,
      preparationId: preparation.preparationId,
      responseId: preparation.responseId,
      orderHash,
    });
    await service.saveCustomer({
      scope,
      customerMarkdown: preparation.customerMarkdown,
      customerIdentity: 'different-customer',
      triggeringMessageId: 'message-2',
      responseId: 'response-2',
      selectionProvenance: { method: 'unique' },
      orderHash,
    });
    await expect(service.acceptSignal({
      scope,
      index: ticket.index,
      token: ticket.token,
      orderHash,
      customerMarkdown: ticket.customerMarkdown,
      customerIdentity: ticket.customerIdentity,
      prompts,
      chunks: [],
    })).rejects.toThrow('customer preparation');
    expect((await service.readState(scope))?.nextSignalIndex).toBe(1);
  });

  it('allocates one response-bound ticket and index under concurrent retries', async () => {
    const preparation = await prepareCustomer();
    const orderHash = preparation.orderHash;
    if (!orderHash) throw new Error('test setup did not save an order hash');
    const issueInput = {
      scope,
      customerMarkdown: preparation.customerMarkdown,
      customerIdentity: preparation.customerIdentity,
      triggeringMessageId: preparation.triggeringMessageId,
      selectionProvenance: preparation.selectionProvenance,
      preparationId: preparation.preparationId,
      responseId: preparation.responseId,
      orderHash,
    };
    const tickets = await Promise.all(
      Array.from({ length: 16 }, () => service.issueTicket(issueInput)),
    );
    expect(new Set(tickets.map((ticket) => ticket.token)).size).toBe(1);
    expect(new Set(tickets.map((ticket) => ticket.index))).toEqual(new Set([1]));
    const state = await service.readState(scope);
    expect(state?.nextSignalIndex).toBe(1);
    expect(state?.tickets).toHaveLength(1);
    await expect(service.issueTicket({
      ...issueInput,
      customerIdentity: 'tampered-customer',
    })).rejects.toThrow('response binding');
    const nextResponseTicket = await service.issueTicket({
      ...issueInput,
      responseId: 'new-response',
      triggeringMessageId: 'new-confirmation-message',
    });
    expect(nextResponseTicket.index).toBe(2);
    expect(nextResponseTicket.preparationId).toBe(preparation.preparationId);
  });

  it('invalidates old tickets when the order hash changes and fences order edits during a run', async () => {
    await service.setOrder({ scope, fullMarkdown: '# first' });
    const staleTicket = await service.issueTicket({
      scope,
      customerMarkdown: '# customer',
      customerIdentity: 'customer-a',
      triggeringMessageId: 'message-1',
      selectionProvenance: { method: 'default_tier' },
    });
    if (!staleTicket) {
      throw new Error('ticket missing');
    }
    await service.setOrder({ scope, fullMarkdown: '# second' });
    await expect(
      service.acceptSignal({
        scope,
        index: staleTicket.index,
        token: staleTicket.token,
        orderHash: staleTicket.orderHash,
        customerMarkdown: staleTicket.customerMarkdown,
        customerIdentity: staleTicket.customerIdentity,
        prompts,
        chunks: [],
      }),
    ).rejects.toThrow('ticket');

    const prepared = await prepareRun(scope, '# active');
    await expect(service.setOrder({ scope, fullMarkdown: '# blocked' })).rejects.toThrow(
      'unfinished',
    );
    await service.cancelRun({ scope, runId: prepared.run.runId });
    await expect(service.setOrder({ scope, fullMarkdown: '# blocked' })).resolves.toEqual(
      expect.objectContaining({ currentOrder: expect.objectContaining({ markdown: '# blocked' }) }),
    );
  });

  it('stores immutable artifacts, reuses checkpoints, and blocks stale writes after cancellation', async () => {
    const prepared = await prepareRun();
    const lease = await service.acquireLease({
      scope,
      runId: prepared.run.runId,
      leaseToken: 'lease-checkpoint',
    });
    if (!lease) {
      throw new Error('lease missing');
    }
    const checkpointInput = {
      scope,
      runId: prepared.run.runId,
      leaseToken: lease.leaseToken,
      operationId: 'chunk:1',
      kind: 'chunk' as const,
      payload: '## system_order_chunk\n| row |',
      chunkIndex: 1,
    };
    await expect(service.checkpoint(checkpointInput)).resolves.toEqual(expect.anything());
    await expect(service.checkpoint(checkpointInput)).resolves.toEqual(expect.anything());
    await expect(
      service.writeArtifact({
        scope,
        runId: prepared.run.runId,
        operationId: 'chunk:1',
        kind: 'chunk',
        payload: 'different payload',
        leaseToken: lease.leaseToken,
      }),
    ).rejects.toThrow('different immutable artifact');
    await expect(
      service.readCheckpoint({ scope, runId: prepared.run.runId, operationId: 'chunk:1' }),
    ).resolves.toContain('system_order_chunk');

    await service.cancelRun({ scope, runId: prepared.run.runId });
    await expect(
      service.checkpoint({ ...checkpointInput, payload: 'late payload', operationId: 'chunk:2' }),
    ).resolves.toBeUndefined();
    await expect(
      service.completeRun({
        scope,
        runId: prepared.run.runId,
        leaseToken: lease.leaseToken,
        finalRef: prepared.run.snapshotRef,
      }),
    ).rejects.toThrow('final artifact');
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    const artifacts = await Artifact.countDocuments({
      userId: scope.userId,
      conversationId: scope.conversationId,
      runId: prepared.run.runId,
    });
    expect(artifacts).toBe(2);
    expect(MAX_QUOTATION_ARTIFACT_BYTES).toBeGreaterThan(1_000_000);
  });

  it('detects historical final orders while ignoring raw and main artifacts by scope', async () => {
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    expect(await service.hasSystemOrder(scope)).toBe(false);
    await Artifact.create({
      userId: scope.userId,
      conversationId: scope.conversationId,
      runId: 'raw-run',
      operationId: 'raw',
      kind: 'main',
      sha256: 'raw-sha',
      payload: 'raw snapshot',
    });
    expect(await service.hasSystemOrder(scope)).toBe(false);
    await Artifact.create({
      userId: scope.userId,
      conversationId: scope.conversationId,
      runId: 'historical-run',
      operationId: 'final',
      kind: 'final',
      sha256: 'historical-sha',
      payload: 'historical final',
    });
    expect(await service.hasSystemOrder(scope)).toBe(true);

    const latest = await prepareRun(scope, '# latest order');
    await service.cancelRun({ scope, runId: latest.run.runId });
    expect((await service.readState(scope))?.activeRun?.status).toBe('cancelled');
    expect(await service.hasSystemOrder(scope)).toBe(true);
    expect(await service.hasSystemOrder({ userId: 'other-owner', conversationId: scope.conversationId })).toBe(false);
  });

  it('keeps cancellation terminal until a new signal creates a fresh run', async () => {
    const first = await prepareRun();
    const lease = await service.acquireLease({ scope, runId: first.run.runId });
    if (!lease) throw new Error('lease missing');
    await service.checkpoint({ scope, runId: first.run.runId, leaseToken: lease.leaseToken,
      operationId: 'chunk:1', kind: 'chunk', payload: 'saved old quotation', chunkIndex: 1 });
    await service.cancelRun({ scope, runId: first.run.runId });
    await expect(service.acquireLease({ scope, runId: first.run.runId })).resolves.toBeUndefined();
    const repeated = await service.acceptSignal({ scope, index: first.ticket.index,
      token: first.ticket.token, orderHash: first.ticket.orderHash,
      customerMarkdown: first.ticket.customerMarkdown, customerIdentity: first.ticket.customerIdentity,
      prompts, chunks: [{ index: 1, sourceRowCount: 1 }] });
    expect(repeated).toEqual(expect.objectContaining({ runId: first.run.runId, status: 'cancelled' }));
    const ticket = await service.issueTicket({ scope, customerMarkdown: first.ticket.customerMarkdown,
      customerIdentity: first.ticket.customerIdentity, triggeringMessageId: 'new-quotation-request',
      selectionProvenance: { method: 'unique' } });
    expect(ticket.index).toBeGreaterThan(first.ticket.index);
    const next = await service.acceptSignal({ scope, index: ticket.index, token: ticket.token,
      orderHash: ticket.orderHash, customerMarkdown: ticket.customerMarkdown,
      customerIdentity: ticket.customerIdentity, prompts, chunks: [{ index: 1, sourceRowCount: 1 }] });
    expect(next.runId).not.toBe(first.run.runId);
    expect(next.status).toBe('queued');
    expect(next.chunks.every((chunk) => chunk.status !== 'completed')).toBe(true);
    expect(next.checkpointRefs).toHaveLength(0);
    await expect(service.acquireLease({ scope, runId: first.run.runId })).resolves.toBeUndefined();
    await expect(service.acquireLease({ scope, runId: next.runId })).resolves.toBeDefined();
  });

  it('archives terminal runs so a duplicate signal can recover the original run', async () => {
    const first = await prepareRun();
    const lease = await service.acquireLease({ scope, runId: first.run.runId, leaseToken: 'lease-final' });
    if (!lease) {
      throw new Error('lease missing');
    }
    const finalRef = await service.writeArtifact({
      scope,
      runId: first.run.runId,
      operationId: 'final',
      kind: 'final',
      payload: 'finalized response',
      leaseToken: lease.leaseToken,
    });
    await service.checkpoint({
      scope,
      runId: first.run.runId,
      leaseToken: lease.leaseToken,
      operationId: 'final',
      kind: 'final',
      artifactRef: finalRef,
    });
    await expect(
      service.completeRun({ scope, runId: first.run.runId, leaseToken: lease.leaseToken, finalRef }),
    ).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
    await expect(
      service.markPublished({ scope, runId: first.run.runId, finalSha256: 'wrong-sha' }),
    ).resolves.toBeUndefined();
    await expect(
      service.markPublished({
        scope,
        runId: first.run.runId,
        finalSha256: finalRef.sha256,
        targetMessageId: 'assistant-target-1',
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
    await expect(
      service.markPublished({ scope, runId: first.run.runId, finalSha256: finalRef.sha256 }),
    ).resolves.toEqual(expect.objectContaining({ status: 'completed' }));

    await service.setOrder({ scope, fullMarkdown: '# next order' });
    const secondTicket = await service.issueTicket({
      scope,
      customerMarkdown: '# customer',
      customerIdentity: 'customer-a',
      triggeringMessageId: 'message-2',
      selectionProvenance: { method: 'unique' },
    });
    if (!secondTicket) {
      throw new Error('second ticket missing');
    }
    await service.acceptSignal({
      scope,
      index: secondTicket.index,
      token: secondTicket.token,
      orderHash: secondTicket.orderHash,
      customerMarkdown: secondTicket.customerMarkdown,
      customerIdentity: secondTicket.customerIdentity,
      prompts,
      chunks: [],
    });
    await expect(
      service.acceptSignal({
        scope,
        index: first.ticket.index,
        token: first.ticket.token,
        orderHash: first.ticket.orderHash,
        customerMarkdown: first.ticket.customerMarkdown,
        customerIdentity: first.ticket.customerIdentity,
        prompts,
        chunks: first.run.chunks.map((chunk) => ({ index: chunk.index, sourceRowCount: chunk.sourceRowCount })),
      }),
    ).resolves.toEqual(expect.objectContaining({ runId: first.run.runId, status: 'completed' }));
    await expect(
      service.markPublished({ scope, runId: first.run.runId, finalSha256: finalRef.sha256 }),
    ).resolves.toBeUndefined();
  });

  it('claims pending messages in order, reclaims expired claims, and completes idempotently', async () => {
    await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'source-1',
      sourceMessageText: 'first pending message',
      sourceMessageFiles: [{ fileId: 'file-1', filename: 'order.pdf' }],
    });
    const duplicate = await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'source-1',
      sourceMessageText: 'first pending message',
    });
    expect(duplicate.status).toBe('pending');
    const firstClaim = await service.claimPendingMessage({
      scope,
      claimToken: 'claim-1',
      now: new Date(0),
    });
    expect(firstClaim?.sourceMessageId).toBe('source-1');
    expect(firstClaim?.sourceMessageFiles).toEqual([{ fileId: 'file-1', filename: 'order.pdf' }]);
    await expect(
      service.renewPendingClaim({
        scope,
        sourceMessageId: 'source-1',
        claimToken: 'claim-1',
        now: new Date(100),
      }),
    ).resolves.toEqual(expect.objectContaining({ claimToken: 'claim-1' }));
    await expect(
      service.savePendingResult({
        scope,
        sourceMessageId: 'source-1',
        claimToken: 'claim-1',
        markdown: 'prepared response',
        targetMessageId: 'stable-target',
        now: new Date(1),
      }),
    ).resolves.toEqual(expect.objectContaining({ markdown: 'prepared response' }));
    const reclaimed = await service.claimPendingMessage({
      scope,
      claimToken: 'claim-2',
      now: new Date(61_000),
    });
    expect(reclaimed?.claimToken).toBe('claim-2');
    expect(reclaimed?.resultMarkdown).toBe('prepared response');
    expect(reclaimed?.targetMessageId).toBe('stable-target');
    await expect(
      service.completePendingMessage({
        scope,
        sourceMessageId: 'source-1',
        claimToken: 'claim-1',
        targetMessageId: 'stale-target',
        now: new Date(61_001),
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.completePendingMessage({
        scope,
        sourceMessageId: 'source-1',
        claimToken: 'claim-2',
        targetMessageId: 'stable-target',
        now: new Date(61_001),
      }),
    ).resolves.toEqual({ sourceMessageId: 'source-1', targetMessageId: 'stable-target' });
    await expect(
      service.completePendingMessage({
        scope,
        sourceMessageId: 'source-1',
        claimToken: 'different-token',
        targetMessageId: 'other-target',
        now: new Date(62_000),
      }),
    ).resolves.toEqual({ sourceMessageId: 'source-1', targetMessageId: 'stable-target' });

    const otherScope: SteelQuotationScope = { userId: 'other-user', conversationId: scope.conversationId };
    expect(await service.readState(otherScope)).toBeNull();
    expect(await service.deleteConversation(scope)).toEqual({ stateDeleted: 1, artifactsDeleted: 2 });
    expect(await service.readState(scope)).toBeNull();
  });

  it('keeps FIFO pending claims serialized when the earliest message is live', async () => {
    await service.enqueuePendingMessage({ scope, sourceMessageId: 'fifo-1', sourceMessageText: 'one' });
    await service.enqueuePendingMessage({ scope, sourceMessageId: 'fifo-2', sourceMessageText: 'two' });
    const claims = await Promise.all([
      service.claimPendingMessage({ scope, claimToken: 'fifo-claim-a' }),
      service.claimPendingMessage({ scope, claimToken: 'fifo-claim-b' }),
    ]);
    const winner = claims.find((claim) => claim !== undefined);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(winner?.sourceMessageId).toBe('fifo-1');
    expect(await service.claimPendingMessage({ scope })).toBeUndefined();
    if (!winner) {
      throw new Error('FIFO claim missing');
    }
    await service.savePendingResult({
      scope,
      sourceMessageId: winner.sourceMessageId,
      claimToken: winner.claimToken,
      markdown: 'one done',
      now: new Date(),
    });
    await service.completePendingMessage({
      scope,
      sourceMessageId: winner.sourceMessageId,
      claimToken: winner.claimToken,
      now: new Date(),
    });
    expect((await service.claimPendingMessage({ scope }))?.sourceMessageId).toBe('fifo-2');
  });

  it('archives completed queue entries while retaining idempotent completion receipts', async () => {
    for (let index = 1; index <= 64; index += 1) {
      const sourceMessageId = `bounded-${index}`;
      const claimTime = new Date(10_000 + index);
      await service.enqueuePendingMessage({
        scope,
        sourceMessageId,
        sourceMessageText: `correction-${index}`,
        targetMessageId: `target-${index}`,
        now: claimTime,
      });
      const claim = await service.claimPendingMessage({
        scope,
        claimToken: `claim-${index}`,
        now: claimTime,
      });
      if (!claim) {
        throw new Error(`claim missing for ${sourceMessageId}`);
      }
      await service.savePendingResult({
        scope,
        sourceMessageId,
        claimToken: claim.claimToken,
        markdown: `result-${index}`,
        now: claimTime,
      });
      await service.completePendingMessage({
        scope,
        sourceMessageId,
        claimToken: claim.claimToken,
        now: claimTime,
      });
    }

    await service.enqueuePendingMessage({
      scope,
      sourceMessageId: 'bounded-65',
      sourceMessageText: 'correction-65',
      targetMessageId: 'target-65',
      now: new Date(20_000),
    });
    const state = await service.readState(scope);
    expect(state?.pendingMessages).toHaveLength(1);
    expect(state?.pendingMessages[0]?.sourceMessageId).toBe('bounded-65');
    await expect(
      service.enqueuePendingMessage({
        scope,
        sourceMessageId: 'bounded-1',
        sourceMessageText: 'correction-1',
        targetMessageId: 'target-1',
      }),
    ).resolves.toEqual(expect.objectContaining({
      status: 'completed',
      completedTargetMessageId: 'target-1',
    }));
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    expect(await Artifact.countDocuments({
      userId: scope.userId,
      conversationId: scope.conversationId,
    })).toBe(128);
  });
});
