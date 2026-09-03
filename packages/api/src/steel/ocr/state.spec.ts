import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createSteelConversationOcrStateModel, createSteelDelegateOcrRunModel } from '@librechat/data-schemas';

import { createSteelDelegateOcrStateService } from './state';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Steel delegate OCR state', () => {
  it('claims indexes atomically and materializes idempotently', async () => {
    const service = createSteelDelegateOcrStateService(mongoose);
    const first = await service.claimNewDelegateOcrIndex({
      conversationId: 'conversation-state',
      triggeringMessageId: 'message-1',
      claimToken: 'claim-1',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(first).toEqual(expect.objectContaining({ delegateOcrIndex: 1, claimToken: 'claim-1' }));
    await expect(
      service.claimNewDelegateOcrIndex({
        conversationId: 'conversation-state',
        triggeringMessageId: 'message-2',
        claimToken: 'claim-2',
        now: new Date('2026-01-01T00:00:01.000Z'),
      }),
    ).resolves.toBeUndefined();

    const input = {
      conversationId: 'conversation-state',
      delegateOcrIndex: 1,
      claimToken: 'claim-1',
      triggeringMessageId: 'message-1',
      toolParameters: { prompt: 'extract' },
      files: [{ fileId: 'file-1', filename: 'drawing.pdf' }],
    };
    const run = await service.materializeDelegateOcrRun(input);
    const same = await service.materializeDelegateOcrRun(input);
    expect(run._id).toEqual(same._id);
    expect(await service.findResumableDelegateOcrRun(input)).toEqual(
      expect.objectContaining({ claimToken: 'claim-1' }),
    );
  });

  it('heals terminal and expired orphan claims before allocating the next index', async () => {
    const service = createSteelDelegateOcrStateService(mongoose);
    await service.claimNewDelegateOcrIndex({
      conversationId: 'conversation-heal-terminal',
      triggeringMessageId: 'message-1',
      claimToken: 'claim-1',
    });
    await service.materializeDelegateOcrRun({
      conversationId: 'conversation-heal-terminal',
      delegateOcrIndex: 1,
      claimToken: 'claim-1',
      triggeringMessageId: 'message-1',
      toolParameters: {},
      files: [],
    });
    await service.transitionDelegateOcrRun({ claimToken: 'claim-1', status: 'completed' });
    await expect(
      service.claimNewDelegateOcrIndex({
        conversationId: 'conversation-heal-terminal',
        triggeringMessageId: 'message-2',
        claimToken: 'claim-2',
      }),
    ).resolves.toEqual(expect.objectContaining({ delegateOcrIndex: 2, claimToken: 'claim-2' }));

    const claimedAt = new Date('2026-01-01T00:00:00.000Z');
    await service.claimNewDelegateOcrIndex({
      conversationId: 'conversation-heal-orphan',
      triggeringMessageId: 'message-1',
      claimToken: 'orphan-1',
      now: claimedAt,
    });
    await expect(
      service.claimNewDelegateOcrIndex({
        conversationId: 'conversation-heal-orphan',
        triggeringMessageId: 'message-2',
        claimToken: 'orphan-2',
        now: new Date(claimedAt.getTime() + 60_001),
      }),
    ).resolves.toEqual(expect.objectContaining({ delegateOcrIndex: 2, claimToken: 'orphan-2' }));
  });

  it('keeps source mappings stable and never recycles codes', async () => {
    const service = createSteelDelegateOcrStateService(mongoose);
    const first = await service.allocateDelegateSourceMapping({
      conversationId: 'conversation-mapping',
      fileId: 'file-1',
      sourceFilename: 'first.pdf',
    });
    const repeated = await service.allocateDelegateSourceMapping({
      conversationId: 'conversation-mapping',
      fileId: 'file-1',
      sourceFilename: 'changed.pdf',
    });
    const second = await service.allocateDelegateSourceMapping({
      conversationId: 'conversation-mapping',
      fileId: 'file-2',
      sourceFilename: 'second.pdf',
    });
    expect(first).toEqual({ fileId: 'file-1', sourceCode: 'F1', sourceFilename: 'first.pdf' });
    expect(repeated).toEqual(first);
    expect(second.sourceCode).toBe('F2');
  });

  it('returns the winning source mapping when the same file is allocated concurrently', async () => {
    const service = createSteelDelegateOcrStateService(mongoose);
    const [first, second] = await Promise.all([
      service.allocateDelegateSourceMapping({
        conversationId: 'conversation-mapping-race',
        fileId: 'file-1',
        sourceFilename: 'drawing.pdf',
      }),
      service.allocateDelegateSourceMapping({
        conversationId: 'conversation-mapping-race',
        fileId: 'file-1',
        sourceFilename: 'drawing.pdf',
      }),
    ]);
    expect(first).toEqual(second);
    await expect(service.readSourceMappings('conversation-mapping-race')).resolves.toHaveLength(1);
  });

  it('clears claims only with exact token and rejects stale result generation', async () => {
    const service = createSteelDelegateOcrStateService(mongoose);
    await service.claimNewDelegateOcrIndex({
      conversationId: 'conversation-cas',
      triggeringMessageId: 'message-1',
      claimToken: 'claim-cas',
    });
    await service.materializeDelegateOcrRun({
      conversationId: 'conversation-cas',
      delegateOcrIndex: 1,
      claimToken: 'claim-cas',
      triggeringMessageId: 'message-1',
      toolParameters: {},
      files: [],
    });
    const lease = await service.acquireDelegateExecutionLease({
      claimToken: 'claim-cas',
      leaseToken: 'lease-cas',
    });
    await expect(
      service.upsertCurrentOcrResult({
        conversationId: 'conversation-cas',
        claimToken: 'stale-claim',
        executionLeaseToken: 'lease-cas',
        generationId: 'generation-1',
        attemptNumber: 1,
        markdown: 'stale',
        delegateOcrIndex: 1,
      }),
    ).resolves.toBeNull();
    await expect(
      service.upsertCurrentOcrResult({
        conversationId: 'conversation-cas',
        claimToken: 'claim-cas',
        executionLeaseToken: lease?.executionLeaseToken,
        generationId: 'generation-1',
        attemptNumber: 1,
        markdown: 'current',
        delegateOcrIndex: 1,
      }),
    ).resolves.toEqual(expect.objectContaining({ currentOcrResultMarkdown: 'current' }));
    await expect(
      service.clearCompletedDelegateClaim({
        conversationId: 'conversation-cas',
        claimToken: 'wrong-claim',
        delegateOcrIndex: 1,
        executionLeaseToken: 'lease-cas',
      }),
    ).resolves.toBeNull();
    await expect(
      service.clearCompletedDelegateClaim({
        conversationId: 'conversation-cas',
        claimToken: 'claim-cas',
        delegateOcrIndex: 1,
        executionLeaseToken: 'lease-cas',
      }),
    ).resolves.toEqual(expect.objectContaining({ currentOcrResultMarkdown: 'current' }));
    await service.claimNewDelegateOcrIndex({
      conversationId: 'conversation-cas',
      triggeringMessageId: 'message-2',
      claimToken: 'claim-next',
    });
    await expect(
      service.upsertCurrentOcrResult({
        conversationId: 'conversation-cas',
        claimToken: 'claim-cas',
        executionLeaseToken: 'lease-cas',
        generationId: 'generation-stale',
        attemptNumber: 2,
        markdown: 'must not overwrite N+1',
        delegateOcrIndex: 1,
      }),
    ).resolves.toBeNull();
  });

  it('saves regular OCR results without delegate claim and rejects stale generation', async () => {
    const service = createSteelDelegateOcrStateService(mongoose);
    await expect(
      service.upsertCurrentOcrResult({
        conversationId: 'conversation-regular-result',
        generationId: 'generation-regular',
        attemptNumber: 1,
        markdown: 'regular result',
      }),
    ).resolves.toEqual(expect.objectContaining({ currentOcrResultMarkdown: 'regular result' }));
    await expect(
      service.upsertCurrentOcrResult({
        conversationId: 'conversation-regular-result',
        generationId: 'generation-stale',
        attemptNumber: 1,
        markdown: 'stale result',
      }),
    ).resolves.toBeNull();
    await expect(service.readCurrentOcrResult('conversation-regular-result')).resolves.toEqual(
      expect.objectContaining({ markdown: 'regular result', generationId: 'generation-regular' }),
    );
    await expect(service.readConversationOcrState('conversation-regular-result')).resolves.toEqual(
      expect.objectContaining({ sourceMappings: [] }),
    );
  });

  it('acquires, reclaims, and guards execution leases', async () => {
    const service = createSteelDelegateOcrStateService(mongoose);
    await service.claimNewDelegateOcrIndex({
      conversationId: 'conversation-lease',
      triggeringMessageId: 'message-lease',
      claimToken: 'claim-lease',
    });
    await service.materializeDelegateOcrRun({
      conversationId: 'conversation-lease',
      delegateOcrIndex: 1,
      claimToken: 'claim-lease',
      triggeringMessageId: 'message-lease',
      toolParameters: {},
      files: [],
    });
    const now = new Date('2026-01-01T00:00:00.000Z');
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken: 'claim-lease',
        leaseToken: 'lease-1',
        now,
        leaseDurationMs: 1000,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ executionLeaseToken: 'lease-1' }),
    );
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken: 'claim-lease',
        leaseToken: 'lease-2',
        now,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken: 'claim-lease',
        leaseToken: 'lease-2',
        now: new Date(now.getTime() + 1001),
      }),
    ).resolves.toEqual(expect.objectContaining({ executionLeaseToken: 'lease-2' }));
  });

  it('takes over resumable leases with compare-and-set fencing', async () => {
    const service = createSteelDelegateOcrStateService(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const conversationId = 'conversation-resume-cas';
    const triggeringMessageId = 'message-resume-cas';
    const claimToken = 'claim-resume-cas';
    await service.claimNewDelegateOcrIndex({
      conversationId,
      triggeringMessageId,
      claimToken,
    });
    await service.materializeDelegateOcrRun({
      conversationId,
      delegateOcrIndex: 1,
      claimToken,
      triggeringMessageId,
      toolParameters: {},
      files: [],
    });
    const initialLease = await service.acquireDelegateExecutionLease({
      claimToken,
      leaseToken: 'lease-resume-old',
    });
    expect(initialLease?.executionLeaseToken).toBe('lease-resume-old');
    await State.updateOne(
      { conversationId },
      { $set: { 'activeDelegateClaim.executionLeaseToken': 'lease-state-stale' } },
    );

    const differentMessage = await service.acquireDelegateExecutionLease({
      claimToken,
      leaseToken: 'lease-resume-wrong-message',
      expectedConversationId: conversationId,
      expectedDelegateOcrIndex: 1,
      expectedTriggeringMessageId: 'message-other',
      expectedLeaseToken: 'lease-resume-old',
    });
    expect(differentMessage).toBeUndefined();

    const takeover = await service.acquireDelegateExecutionLease({
      claimToken,
      leaseToken: 'lease-resume-new',
      expectedConversationId: conversationId,
      expectedDelegateOcrIndex: 1,
      expectedTriggeringMessageId: triggeringMessageId,
      expectedLeaseToken: 'lease-resume-old',
    });
    expect(takeover?.executionLeaseToken).toBe('lease-resume-new');
    await expect(service.readActiveDelegateClaim(conversationId)).resolves.toEqual(
      expect.objectContaining({ executionLeaseToken: 'lease-resume-new' }),
    );
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken,
        leaseToken: 'lease-resume-second',
        expectedConversationId: conversationId,
        expectedDelegateOcrIndex: 1,
        expectedTriggeringMessageId: triggeringMessageId,
        expectedLeaseToken: 'lease-resume-old',
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.transitionDelegateOcrRun({
        claimToken,
        executionLeaseToken: 'lease-resume-old',
        status: 'completed',
      }),
    ).resolves.toBeNull();
    await expect(
      service.upsertCurrentOcrResult({
        conversationId,
        claimToken,
        executionLeaseToken: 'lease-resume-old',
        generationId: 'generation-old',
        attemptNumber: 1,
        markdown: 'stale result',
        delegateOcrIndex: 1,
      }),
    ).resolves.toBeNull();
    await expect(
      service.clearCompletedDelegateClaim({
        conversationId,
        claimToken,
        delegateOcrIndex: 1,
        executionLeaseToken: 'lease-resume-old',
      }),
    ).resolves.toBeNull();
    await expect(service.readActiveDelegateClaim(conversationId)).resolves.toEqual(
      expect.objectContaining({ executionLeaseToken: 'lease-resume-new' }),
    );

    await expect(
      service.transitionDelegateOcrRun({
        claimToken,
        executionLeaseToken: 'lease-resume-new',
        status: 'agent_failed',
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 'agent_failed' }));
    await State.updateOne(
      { conversationId },
      { $unset: { 'activeDelegateClaim.executionLeaseToken': 1 } },
    );
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken,
        leaseToken: 'lease-resume-final',
        expectedConversationId: conversationId,
        expectedDelegateOcrIndex: 1,
        expectedTriggeringMessageId: triggeringMessageId,
        expectedLeaseToken: 'lease-resume-new',
      }),
    ).resolves.toEqual(expect.objectContaining({ executionLeaseToken: 'lease-resume-final' }));
    await expect(service.readActiveDelegateClaim(conversationId)).resolves.toEqual(
      expect.objectContaining({ executionLeaseToken: 'lease-resume-final' }),
    );
  });

  it('matches missing and explicit null lease tokens, but never reclaims terminal runs', async () => {
    const service = createSteelDelegateOcrStateService(mongoose);
    const Run = createSteelDelegateOcrRunModel(mongoose);
    const createRun = async (
      suffix: string,
      status?: 'completed' | 'superseded' | 'save_failed',
    ) => {
      const conversationId = `conversation-null-cas-${suffix}`;
      const triggeringMessageId = `message-null-cas-${suffix}`;
      const claimToken = `claim-null-cas-${suffix}`;
      await service.claimNewDelegateOcrIndex({ conversationId, triggeringMessageId, claimToken });
      await service.materializeDelegateOcrRun({
        conversationId,
        delegateOcrIndex: 1,
        claimToken,
        triggeringMessageId,
        toolParameters: {},
        files: [],
      });
      if (status) {
        await service.transitionDelegateOcrRun({ claimToken, status });
      }
      return { conversationId, triggeringMessageId, claimToken };
    };

    const missing = await createRun('missing');
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken: missing.claimToken,
        leaseToken: 'lease-null-missing',
        expectedConversationId: missing.conversationId,
        expectedDelegateOcrIndex: 1,
        expectedTriggeringMessageId: missing.triggeringMessageId,
        expectedLeaseToken: null,
      }),
    ).resolves.toEqual(expect.objectContaining({ executionLeaseToken: 'lease-null-missing' }));

    const explicitNull = await createRun('explicit');
    await Run.updateOne(
      { claimToken: explicitNull.claimToken },
      { $set: { executionLeaseToken: null } },
    );
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken: explicitNull.claimToken,
        leaseToken: 'lease-null-explicit',
        expectedConversationId: explicitNull.conversationId,
        expectedDelegateOcrIndex: 1,
        expectedTriggeringMessageId: explicitNull.triggeringMessageId,
        expectedLeaseToken: null,
      }),
    ).resolves.toEqual(expect.objectContaining({ executionLeaseToken: 'lease-null-explicit' }));

    const terminal = await createRun('terminal', 'completed');
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken: terminal.claimToken,
        leaseToken: 'lease-terminal',
        expectedConversationId: terminal.conversationId,
        expectedDelegateOcrIndex: 1,
        expectedTriggeringMessageId: terminal.triggeringMessageId,
        expectedLeaseToken: null,
      }),
    ).resolves.toBeUndefined();

    const superseded = await createRun('superseded', 'superseded');
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken: superseded.claimToken,
        leaseToken: 'lease-superseded',
        expectedConversationId: superseded.conversationId,
        expectedDelegateOcrIndex: 1,
        expectedTriggeringMessageId: superseded.triggeringMessageId,
        expectedLeaseToken: null,
      }),
    ).resolves.toBeUndefined();

    const failed = await createRun('failed', 'save_failed');
    await expect(
      service.acquireDelegateExecutionLease({
        claimToken: failed.claimToken,
        leaseToken: 'lease-save-failed',
        expectedConversationId: failed.conversationId,
        expectedDelegateOcrIndex: 1,
        expectedTriggeringMessageId: failed.triggeringMessageId,
        expectedLeaseToken: null,
      }),
    ).resolves.toEqual(expect.objectContaining({ executionLeaseToken: 'lease-save-failed' }));
    await expect(service.findResumableDelegateOcrRun(failed)).resolves.toEqual(
      expect.objectContaining({ status: 'save_failed' }),
    );
    await expect(
      service.findResumableDelegateOcrRun({
        conversationId: failed.conversationId,
        triggeringMessageId: 'message-different',
      }),
    ).resolves.toBeNull();
  });

  it('creates expected collections and indexes', () => {
    const Run = createSteelDelegateOcrRunModel(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    expect(Run.collection.name).toBe('steel_delegate_ocr_runs');
    expect(State.collection.name).toBe('steel_conversation_ocr_state');
    expect(Run.schema.indexes()).toContainEqual([
      { conversationId: 1, delegateOcrIndex: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(State.schema.path('conversationId').options.unique).toBe(true);
  });
});
