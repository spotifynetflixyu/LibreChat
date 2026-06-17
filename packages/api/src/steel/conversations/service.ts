import crypto from 'crypto';

import { canAccessSteelAdmin, parseSteelGuestMode, type SteelAccessUser } from '../access';

export type SteelConversationCreatedFrom = 'authenticated' | 'guest';
export type SteelConversationStatus = 'active' | 'archived';
export type SteelAuditActorType = 'user' | 'guest' | 'system';
export type SteelAuditResult = 'success' | 'denied' | 'failure';

export interface SteelConversationRecord {
  id: string;
  libreChatConversationId?: string;
  userId?: string;
  guestTokenHash?: string;
  createdFrom: SteelConversationCreatedFrom;
  status: SteelConversationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SteelConversationResponse {
  id: string;
  libreChatConversationId?: string;
  userId?: string;
  createdFrom: SteelConversationCreatedFrom;
  status: SteelConversationStatus;
  guestTokenIssued: boolean;
  guestToken?: string;
  createdAt: string;
  updatedAt: string;
}

interface SteelConversationCreateInput {
  libreChatConversationId?: string;
  userId?: string;
  guestTokenHash?: string;
  createdFrom: SteelConversationCreatedFrom;
  status: SteelConversationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SteelConversationRepository {
  create(record: SteelConversationCreateInput): Promise<SteelConversationRecord>;
  findById(id: string): Promise<SteelConversationRecord | null>;
}

export interface SteelAuditEvent {
  actorType: SteelAuditActorType;
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  result: SteelAuditResult;
  errorCategory?: string;
  correlationId?: string;
}

export interface SteelAuditRecorder {
  record(event: SteelAuditEvent): Promise<void>;
}

interface SteelTokenProvider {
  generate(): string;
  hash(value: string): string;
}

interface SteelConversationServiceDeps {
  repository: SteelConversationRepository;
  audit: SteelAuditRecorder;
  token?: SteelTokenProvider;
  env?: { [key: string]: string | undefined; STEEL_GUEST_MODE?: string };
  now?: () => Date;
}

interface CreateAuthenticatedInput {
  libreChatConversationId?: string;
  user: SteelAccessUser | null;
}

interface CreateGuestInput {
  libreChatConversationId?: string;
}

interface ReadConversationInput {
  conversationMetaId: string;
  user?: SteelAccessUser | null;
  guestToken?: string;
}

export class SteelConversationAccessError extends Error {
  readonly statusCode = 403;

  constructor(
    message: string,
    readonly errorCategory: string,
  ) {
    super(message);
    this.name = 'SteelConversationAccessError';
  }
}

export class SteelConversationNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Steel conversation not found');
    this.name = 'SteelConversationNotFoundError';
  }
}

export class SteelConversationUnauthenticatedError extends Error {
  readonly statusCode = 401;

  constructor() {
    super('Steel conversation access requires login or guest token');
    this.name = 'SteelConversationUnauthenticatedError';
  }
}

function createDefaultTokenProvider(): SteelTokenProvider {
  return {
    generate() {
      return crypto.randomBytes(32).toString('base64url');
    },
    hash(value: string) {
      return crypto.createHash('sha256').update(value).digest('hex');
    },
  };
}

function toResponse(
  record: SteelConversationRecord,
  guestToken?: string,
): SteelConversationResponse {
  return {
    id: record.id,
    libreChatConversationId: record.libreChatConversationId,
    userId: record.userId,
    createdFrom: record.createdFrom,
    status: record.status,
    guestTokenIssued: record.createdFrom === 'guest',
    ...(guestToken ? { guestToken } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function recordDenied(
  audit: SteelAuditRecorder,
  actorType: SteelAuditActorType,
  errorCategory: string,
  actorId?: string,
) {
  await audit.record({
    action: 'access_denied',
    actorId,
    actorType,
    errorCategory,
    result: 'denied',
  });
}

export function createSteelConversationService({
  repository,
  audit,
  token = createDefaultTokenProvider(),
  env = process.env,
  now = () => new Date(),
}: SteelConversationServiceDeps) {
  return {
    async createAuthenticated({
      libreChatConversationId,
      user,
    }: CreateAuthenticatedInput): Promise<SteelConversationResponse> {
      if (!canAccessSteelAdmin(user)) {
        await recordDenied(
          audit,
          user?.id ? 'user' : 'system',
          'steel_quote_access_denied',
          user?.id,
        );
        throw new SteelConversationAccessError(
          'Steel quote access is not enabled for this account',
          'steel_quote_access_denied',
        );
      }

      const timestamp = now();
      const record = await repository.create({
        libreChatConversationId,
        userId: user?.id,
        guestTokenHash: undefined,
        createdFrom: 'authenticated',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await audit.record({
        action: 'conversation_created',
        actorId: user?.id,
        actorType: 'user',
        result: 'success',
        targetId: record.id,
        targetType: 'steel_conversation_meta',
      });

      return toResponse(record);
    },

    async createGuest({
      libreChatConversationId,
    }: CreateGuestInput): Promise<SteelConversationResponse> {
      if (!parseSteelGuestMode(env)) {
        await recordDenied(audit, 'guest', 'steel_guest_mode_disabled');
        throw new SteelConversationAccessError(
          'Steel guest mode is disabled',
          'steel_guest_mode_disabled',
        );
      }

      const rawToken = token.generate();
      const timestamp = now();
      const record = await repository.create({
        libreChatConversationId,
        userId: undefined,
        guestTokenHash: token.hash(rawToken),
        createdFrom: 'guest',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await audit.record({
        action: 'guest_token_issued',
        actorType: 'guest',
        result: 'success',
        targetId: record.id,
        targetType: 'steel_conversation_meta',
      });

      return toResponse(record, rawToken);
    },

    async read({
      conversationMetaId,
      user,
      guestToken,
    }: ReadConversationInput): Promise<SteelConversationResponse> {
      const record = await repository.findById(conversationMetaId);
      if (!record) {
        throw new SteelConversationNotFoundError();
      }

      if (record.createdFrom === 'authenticated') {
        if (!user?.id) {
          throw new SteelConversationUnauthenticatedError();
        }
        if (record.userId !== user.id) {
          throw new SteelConversationNotFoundError();
        }
        return toResponse(record);
      }

      if (!parseSteelGuestMode(env)) {
        await recordDenied(audit, 'guest', 'steel_guest_mode_disabled');
        throw new SteelConversationAccessError(
          'Steel guest mode is disabled',
          'steel_guest_mode_disabled',
        );
      }
      if (!guestToken || record.guestTokenHash !== token.hash(guestToken)) {
        throw new SteelConversationNotFoundError();
      }

      return toResponse(record);
    },
  };
}
