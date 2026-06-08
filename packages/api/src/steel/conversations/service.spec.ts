import {
  createSteelConversationService,
  SteelConversationAccessError,
  SteelConversationNotFoundError,
  type SteelConversationRecord,
} from './service';

const createdAt = new Date('2026-05-28T00:00:00.000Z');

function createRecord(overrides: Partial<SteelConversationRecord> = {}): SteelConversationRecord {
  return {
    id: 'steel_meta_1',
    createdFrom: 'authenticated',
    status: 'active',
    userId: 'admin_1',
    libreChatConversationId: 'lc_1',
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function createDeps() {
  const repository = {
    create: jest.fn(async (record: Omit<SteelConversationRecord, 'id'>) => createRecord(record)),
    findById: jest.fn(async () => createRecord()),
  };
  const audit = {
    record: jest.fn(async () => undefined),
  };
  const token = {
    generate: jest.fn(() => 'guest-token-raw'),
    hash: jest.fn((value: string) => `hashed:${value}`),
  };

  return { audit, repository, token };
}

describe('Steel conversation service', () => {
  it('creates authenticated conversations for the existing ADMIN role seam', async () => {
    const deps = createDeps();
    const service = createSteelConversationService({
      ...deps,
      env: { STEEL_GUEST_MODE: 'false' },
      now: () => createdAt,
    });

    const result = await service.createAuthenticated({
      libreChatConversationId: 'lc_1',
      user: { id: 'admin_1', role: 'ADMIN' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'steel_meta_1',
        createdFrom: 'authenticated',
        userId: 'admin_1',
        guestTokenIssued: false,
      }),
    );
    expect(deps.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        createdFrom: 'authenticated',
        userId: 'admin_1',
        guestTokenHash: undefined,
      }),
    );
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'conversation_created',
        actorId: 'admin_1',
        actorType: 'user',
        result: 'success',
      }),
    );
  });

  it('denies non-admin authenticated creation until Steel permissions exist', async () => {
    const deps = createDeps();
    const service = createSteelConversationService({
      ...deps,
      env: { STEEL_GUEST_MODE: 'false' },
      now: () => createdAt,
    });

    await expect(
      service.createAuthenticated({
        libreChatConversationId: 'lc_1',
        user: { id: 'user_1', role: 'USER' },
      }),
    ).rejects.toThrow(SteelConversationAccessError);

    expect(deps.repository.create).not.toHaveBeenCalled();
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'access_denied',
        actorId: 'user_1',
        actorType: 'user',
        errorCategory: 'steel_quote_access_denied',
        result: 'denied',
      }),
    );
  });

  it('issues a guest token only when guest mode is enabled', async () => {
    const deps = createDeps();
    deps.repository.create.mockImplementationOnce(async (record) =>
      createRecord({ ...record, id: 'guest_meta_1' }),
    );
    const service = createSteelConversationService({
      ...deps,
      env: { STEEL_GUEST_MODE: 'true' },
      now: () => createdAt,
    });

    const result = await service.createGuest({
      libreChatConversationId: 'lc_guest_1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'guest_meta_1',
        createdFrom: 'guest',
        guestToken: 'guest-token-raw',
        guestTokenIssued: true,
      }),
    );
    expect(deps.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        createdFrom: 'guest',
        guestTokenHash: 'hashed:guest-token-raw',
        userId: undefined,
      }),
    );
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'guest_token_issued',
        actorType: 'guest',
        result: 'success',
      }),
    );
  });

  it('rejects guest creation when guest mode is disabled', async () => {
    const deps = createDeps();
    const service = createSteelConversationService({
      ...deps,
      env: { STEEL_GUEST_MODE: 'false' },
      now: () => createdAt,
    });

    await expect(service.createGuest({ libreChatConversationId: 'lc_guest_1' })).rejects.toThrow(
      SteelConversationAccessError,
    );

    expect(deps.repository.create).not.toHaveBeenCalled();
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'access_denied',
        errorCategory: 'steel_guest_mode_disabled',
        result: 'denied',
      }),
    );
  });

  it('reads authenticated owner records and hides other owners', async () => {
    const deps = createDeps();
    const service = createSteelConversationService({
      ...deps,
      env: { STEEL_GUEST_MODE: 'false' },
      now: () => createdAt,
    });

    await expect(
      service.read({
        conversationMetaId: 'steel_meta_1',
        user: { id: 'admin_1', role: 'ADMIN' },
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'steel_meta_1' }));

    await expect(
      service.read({
        conversationMetaId: 'steel_meta_1',
        user: { id: 'other_1', role: 'ADMIN' },
      }),
    ).rejects.toThrow(SteelConversationNotFoundError);
  });

  it('reads guest records only with the matching token hash', async () => {
    const deps = createDeps();
    deps.repository.findById.mockResolvedValue(
      createRecord({
        createdFrom: 'guest',
        guestTokenHash: 'hashed:guest-token-raw',
        userId: undefined,
      }),
    );
    const service = createSteelConversationService({
      ...deps,
      env: { STEEL_GUEST_MODE: 'true' },
      now: () => createdAt,
    });

    await expect(
      service.read({
        conversationMetaId: 'guest_meta_1',
        guestToken: 'guest-token-raw',
        user: null,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'steel_meta_1' }));

    await expect(
      service.read({
        conversationMetaId: 'guest_meta_1',
        guestToken: 'wrong-token',
        user: null,
      }),
    ).rejects.toThrow(SteelConversationNotFoundError);
  });
});
