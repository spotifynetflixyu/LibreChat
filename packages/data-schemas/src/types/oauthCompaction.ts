import { Buffer } from 'node:buffer';

export const MAX_OAUTH_COMPACTION_IDENTIFIER_LENGTH = 512;
export const MAX_OAUTH_COMPACTION_HASHES = 100_000;
export const MAX_OAUTH_COMPACTION_OPAQUE_BYTES: number = 8 * 1024 * 1024;
export const OAUTH_COMPACTION_SHA256_PATTERN: RegExp = /^[a-f0-9]{64}$/i;

export interface OAuthCompactionScope {
  tenantId: string;
  userId: string;
  conversationId: string;
  agentId: string;
  executionId: string;
  accountHash: string;
  model: string;
  instructionsHash: string;
}

export interface OAuthCompactionUsage {
  inputTokens: number;
  inputHashes: string[];
  shapingHash: string;
}

export interface OAuthCompactionState {
  revision: number;
  coveredHashes: string[];
  opaque: string;
  usage?: OAuthCompactionUsage;
  updatedAt: Date;
  expiresAt: Date;
}

export interface OAuthCompactionAcquireInput {
  scope: OAuthCompactionScope;
  ownerId: string;
  now: Date;
  leaseExpiresAt: Date;
  expiresAt: Date;
}

export interface OAuthCompactionSaveInput {
  scope: OAuthCompactionScope;
  ownerId: string;
  expectedRevision: number;
  state: Pick<OAuthCompactionState, 'coveredHashes' | 'opaque' | 'usage' | 'expiresAt'>;
  now: Date;
}

export interface OAuthCompactionDeleteInput {
  userId: string;
  conversationIds?: string[];
  tenantId?: string;
}

export type OAuthCompactionAcquireResult =
  | { ok: true; state: OAuthCompactionState | null; revision: number }
  | { ok: false; code: 'busy' };

export interface OAuthCompactionStore {
  acquireOAuthCompaction(input: OAuthCompactionAcquireInput): Promise<OAuthCompactionAcquireResult>;
  saveOAuthCompaction(input: OAuthCompactionSaveInput): Promise<boolean>;
  releaseOAuthCompaction(input: { scope: OAuthCompactionScope; ownerId: string }): Promise<void>;
  deleteOAuthCompaction(input: OAuthCompactionDeleteInput): Promise<number>;
}

export interface OAuthCompactionRecord extends OAuthCompactionScope {
  ownerId?: string;
  leaseExpiresAt?: Date;
  revision: number;
  coveredHashes: string[];
  opaque?: string;
  usage?: OAuthCompactionUsage;
  updatedAt: Date;
  expiresAt: Date;
}

export function isOAuthCompactionSha256(value: string): boolean {
  return typeof value === 'string' && OAUTH_COMPACTION_SHA256_PATTERN.test(value);
}

export function isOAuthCompactionOpaque(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_OAUTH_COMPACTION_OPAQUE_BYTES) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false;
    }
    const payload = parsed as { type?: unknown; encrypted_content?: unknown };
    return (
      payload.type === 'compaction' &&
      typeof payload.encrypted_content === 'string' &&
      payload.encrypted_content.length > 0 &&
      JSON.stringify(parsed) === value
    );
  } catch {
    return false;
  }
}
