import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type {
  OAuthCompactionAcquireInput,
  OAuthCompactionScope,
  OAuthCompactionStore,
} from '~/types';
import { createOAuthCompactionModel } from '~/models/oauthCompaction';
import { createOAuthCompactionMethods } from './oauthCompaction';

const hash = (letter: string): string => letter.repeat(64);

const scopeFor = (overrides: Partial<OAuthCompactionScope> = {}): OAuthCompactionScope => ({
  tenantId: 'tenant-a',
  userId: 'user-a',
  conversationId: 'conversation-a',
  agentId: 'agent-a',
  executionId: 'execution-a',
  accountHash: hash('a'),
  model: 'gpt-test',
  instructionsHash: hash('b'),
  ...overrides,
});

const acquireFor = (
  methods: OAuthCompactionStore,
  scope: OAuthCompactionScope,
  ownerId: string,
  now = new Date('2026-01-01T00:00:00.000Z'),
): OAuthCompactionAcquireInput => ({
  scope,
  ownerId,
  now,
  leaseExpiresAt: new Date(now.getTime() + 60_000),
  expiresAt: new Date(now.getTime() + 3_600_000),
});

let mongoServer: MongoMemoryServer;
let methods: OAuthCompactionStore;
let OAuthCompaction: ReturnType<typeof createOAuthCompactionModel>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  OAuthCompaction = createOAuthCompactionModel(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  methods = createOAuthCompactionMethods(mongoose);
});

describe('OAuth compaction storage', () => {
  it('rejects a null tenant from direct model writes', async () => {
    const record = new OAuthCompaction({
      ...scopeFor(),
      tenantId: null,
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    });
    await expect(record.validate()).rejects.toMatchObject({
      errors: { tenantId: expect.any(Object) },
    });
  });

  it('rejects empty usage prefixes at both storage boundaries', async () => {
    const scope = scopeFor();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const state = {
      coveredHashes: [hash('c')],
      opaque: '{"type":"compaction","encrypted_content":"private"}',
      usage: { inputTokens: 80, inputHashes: [], shapingHash: hash('d') },
      expiresAt: new Date(now.getTime() + 3_600_000),
    };
    await expect(new OAuthCompaction({ ...scope, ...state }).validate()).rejects.toMatchObject({
      errors: { 'usage.inputHashes': expect.any(Object) },
    });
    await methods.acquireOAuthCompaction(acquireFor(methods, scope, 'owner', now));
    await expect(
      methods.saveOAuthCompaction({
        scope,
        ownerId: 'owner',
        expectedRevision: 0,
        state,
        now,
      }),
    ).rejects.toThrow('usage is invalid');
  });

  it('persists and restores private state when the application has no tenant', async () => {
    const scope = { ...scopeFor(), tenantId: '' };
    const now = new Date('2026-01-01T00:00:00.000Z');
    await methods.acquireOAuthCompaction(acquireFor(methods, scope, 'owner-a', now));
    const opaque = '{"type":"compaction","encrypted_content":"private"}';
    await expect(
      methods.saveOAuthCompaction({
        scope,
        ownerId: 'owner-a',
        expectedRevision: 0,
        state: {
          coveredHashes: [hash('c')],
          opaque,
          expiresAt: new Date(now.getTime() + 3_600_000),
        },
        now,
      }),
    ).resolves.toBe(true);
    await methods.releaseOAuthCompaction({ scope, ownerId: 'owner-a' });
    await expect(
      methods.acquireOAuthCompaction(acquireFor(methods, scope, 'owner-b', now)),
    ).resolves.toMatchObject({ ok: true, state: { opaque }, revision: 1 });
  });

  it('builds the scope and TTL indexes and keeps opaque private by default', async () => {
    const scope = scopeFor();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const acquired = await methods.acquireOAuthCompaction(
      acquireFor(methods, scope, 'owner-a', now),
    );
    expect(acquired).toEqual({ ok: true, state: null, revision: 0 });

    await methods.saveOAuthCompaction({
      scope,
      ownerId: 'owner-a',
      expectedRevision: 0,
      state: {
        coveredHashes: [hash('c')],
        opaque: '{"type":"compaction","encrypted_content":"private"}',
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
      now: new Date(now.getTime() + 1_000),
    });

    const stored = await OAuthCompaction.findOne(scope).lean();
    expect(stored?.opaque).toBeUndefined();
    expect(
      await OAuthCompaction.findOne({ ...scope })
        .select('+opaque')
        .lean(),
    ).toEqual(
      expect.objectContaining({
        opaque: '{"type":"compaction","encrypted_content":"private"}',
      }),
    );

    const indexes = await OAuthCompaction.listIndexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'oauth_compaction_scope', unique: true }),
        expect.objectContaining({ name: 'oauth_compaction_ttl', expireAfterSeconds: 0 }),
      ]),
    );
  });

  it('allows only one owner to acquire a scope during a duplicate-key race', async () => {
    const scope = scopeFor();
    const results = await Promise.all([
      methods.acquireOAuthCompaction(acquireFor(methods, scope, 'owner-a')),
      methods.acquireOAuthCompaction(acquireFor(methods, scope, 'owner-b')),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: 'busy' }]);

    const independent = await methods.acquireOAuthCompaction(
      acquireFor(methods, scopeFor({ model: 'gpt-other' }), 'owner-b'),
    );
    expect(independent.ok).toBe(true);
  });

  it('uses revision and lease CAS and release preserves the last good state', async () => {
    const scope = scopeFor();
    const initial = await methods.acquireOAuthCompaction(acquireFor(methods, scope, 'owner-a'));
    if (!initial.ok) throw new Error('initial acquisition unexpectedly busy');
    const now = new Date('2026-01-01T00:00:01.000Z');
    const state = {
      coveredHashes: [hash('c')],
      opaque: '{"type":"compaction","encrypted_content":"private"}',
      usage: { inputTokens: 123, inputHashes: [hash('d')], shapingHash: hash('e') },
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    };
    expect(
      await methods.saveOAuthCompaction({
        scope,
        ownerId: 'owner-a',
        expectedRevision: initial.revision,
        state,
        now,
      }),
    ).toBe(true);
    expect(
      await methods.saveOAuthCompaction({
        scope,
        ownerId: 'owner-a',
        expectedRevision: initial.revision,
        state,
        now,
      }),
    ).toBe(false);

    await methods.releaseOAuthCompaction({ scope, ownerId: 'owner-a' });
    const resumed = await methods.acquireOAuthCompaction(
      acquireFor(methods, scope, 'owner-b', new Date('2026-01-01T00:01:00.000Z')),
    );
    expect(resumed).toEqual({
      ok: true,
      revision: 1,
      state: expect.objectContaining(state),
    });
    expect(
      await methods.saveOAuthCompaction({
        scope,
        ownerId: 'owner-a',
        expectedRevision: 1,
        state,
        now: new Date('2026-01-01T00:01:01.000Z'),
      }),
    ).toBe(false);
  });

  it('reclaims expired leases with good state and fences an expired state', async () => {
    const scope = scopeFor();
    const firstNow = new Date('2026-01-01T00:00:00.000Z');
    await methods.acquireOAuthCompaction(acquireFor(methods, scope, 'owner-a', firstNow));
    await methods.saveOAuthCompaction({
      scope,
      ownerId: 'owner-a',
      expectedRevision: 0,
      state: {
        coveredHashes: [hash('c')],
        opaque: '{"type":"compaction","encrypted_content":"private"}',
        expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      },
      now: new Date('2026-01-01T00:00:01.000Z'),
    });
    await OAuthCompaction.updateOne(scope, {
      $set: { leaseExpiresAt: new Date('2025-12-31T23:59:59.000Z') },
    });
    const reclaimed = await methods.acquireOAuthCompaction(
      acquireFor(methods, scope, 'owner-b', new Date('2026-01-01T00:01:00.000Z')),
    );
    expect(reclaimed).toEqual({ ok: true, revision: 1, state: expect.any(Object) });

    await OAuthCompaction.updateOne(scope, {
      $set: {
        leaseExpiresAt: new Date('2025-12-31T23:59:59.000Z'),
        expiresAt: new Date('2025-12-31T23:59:59.000Z'),
      },
    });
    const fresh = await methods.acquireOAuthCompaction(
      acquireFor(methods, scope, 'owner-c', new Date('2026-01-01T00:02:00.000Z')),
    );
    expect(fresh).toEqual({ ok: true, state: null, revision: 2 });
    expect(
      await methods.saveOAuthCompaction({
        scope,
        ownerId: 'owner-b',
        expectedRevision: 1,
        state: {
          coveredHashes: [hash('f')],
          opaque: '{"type":"compaction","encrypted_content":"stale"}',
          expiresAt: new Date('2026-01-01T01:00:00.000Z'),
        },
        now: new Date('2026-01-01T00:02:01.000Z'),
      }),
    ).toBe(false);
  });

  it('deletes only the requested user, tenant, and conversations', async () => {
    const scopes = [
      scopeFor({ conversationId: 'conversation-a', tenantId: 'tenant-a', userId: 'user-a' }),
      scopeFor({ conversationId: 'conversation-b', tenantId: 'tenant-b', userId: 'user-a' }),
      scopeFor({ conversationId: 'conversation-a', tenantId: 'tenant-a', userId: 'user-b' }),
    ];
    for (const [index, scope] of scopes.entries()) {
      await methods.acquireOAuthCompaction(acquireFor(methods, scope, `owner-${index}`));
      await methods.releaseOAuthCompaction({ scope, ownerId: `owner-${index}` });
    }

    await expect(
      methods.deleteOAuthCompaction({
        userId: 'user-a',
        tenantId: 'tenant-a',
        conversationIds: ['conversation-a'],
      }),
    ).resolves.toBe(1);
    expect(await OAuthCompaction.countDocuments()).toBe(2);
    await expect(methods.deleteOAuthCompaction({ userId: 'user-a' })).resolves.toBe(1);
    expect(await OAuthCompaction.countDocuments()).toBe(1);
    await expect(methods.deleteOAuthCompaction({ userId: 'user-b' })).resolves.toBe(1);
    expect(await OAuthCompaction.countDocuments()).toBe(0);
  });
});
