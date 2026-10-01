import { Schema } from 'mongoose';
import type { OAuthCompactionRecord, OAuthCompactionUsage } from '~/types/oauthCompaction';
import {
  isOAuthCompactionOpaque,
  isOAuthCompactionSha256,
  MAX_OAUTH_COMPACTION_HASHES,
  MAX_OAUTH_COMPACTION_IDENTIFIER_LENGTH,
  MAX_OAUTH_COMPACTION_OPAQUE_BYTES,
} from '~/types/oauthCompaction';

const boundedIdentifier = (allowEmpty = false) => ({
  type: String,
  required: !allowEmpty,
  maxlength: MAX_OAUTH_COMPACTION_IDENTIFIER_LENGTH,
  validate: {
    validator: (value: string) => typeof value === 'string' && (allowEmpty || value.length > 0),
    message: 'OAuth compaction identifiers must not be empty',
  },
});

const boundedSha256 = () => ({
  type: String,
  required: true,
  maxlength: MAX_OAUTH_COMPACTION_IDENTIFIER_LENGTH,
  validate: {
    validator: isOAuthCompactionSha256,
    message: 'OAuth compaction hash must be a SHA-256 value',
  },
});

const oauthCompactionUsageSchema = new Schema<OAuthCompactionUsage>(
  {
    inputTokens: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    inputHashes: {
      type: [String],
      required: true,
      validate: [
        {
          validator: (value: string[]) =>
            value.length > 0 && value.length <= MAX_OAUTH_COMPACTION_HASHES,
          message: 'OAuth compaction input hashes must be non-empty and within the limit',
        },
        {
          validator: (value: string[]) => value.every(isOAuthCompactionSha256),
          message: 'OAuth compaction input hashes must be SHA-256 values',
        },
      ],
    },
    shapingHash: {
      type: String,
      required: true,
      validate: {
        validator: isOAuthCompactionSha256,
        message: 'OAuth compaction shaping hash must be a SHA-256 value',
      },
    },
  },
  { _id: false },
);

const oauthCompactionSchema: Schema<OAuthCompactionRecord> = new Schema<OAuthCompactionRecord>(
  {
    tenantId: { ...boundedIdentifier(true), default: '' },
    userId: boundedIdentifier(),
    conversationId: boundedIdentifier(),
    agentId: boundedIdentifier(),
    executionId: boundedIdentifier(),
    accountHash: boundedSha256(),
    model: boundedIdentifier(),
    instructionsHash: boundedSha256(),
    ownerId: {
      type: String,
      maxlength: MAX_OAUTH_COMPACTION_IDENTIFIER_LENGTH,
      validate: {
        validator: (value: string) => value.length > 0,
        message: 'OAuth compaction owner must not be empty',
      },
    },
    leaseExpiresAt: { type: Date },
    revision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
    coveredHashes: {
      type: [String],
      required: true,
      default: [],
      validate: [
        {
          validator: (value: string[]) => value.length <= MAX_OAUTH_COMPACTION_HASHES,
          message: 'Too many OAuth compaction covered hashes',
        },
        {
          validator: (value: string[]) => value.every(isOAuthCompactionSha256),
          message: 'OAuth compaction covered hashes must be SHA-256 values',
        },
      ],
    },
    opaque: {
      type: String,
      select: false,
      maxlength: MAX_OAUTH_COMPACTION_OPAQUE_BYTES,
      validate: {
        validator: isOAuthCompactionOpaque,
        message: 'OAuth compaction opaque state must be compact JSON within the size limit',
      },
    },
    usage: { type: oauthCompactionUsageSchema },
    updatedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
);

oauthCompactionSchema.index(
  {
    tenantId: 1,
    userId: 1,
    conversationId: 1,
    agentId: 1,
    executionId: 1,
    accountHash: 1,
    model: 1,
    instructionsHash: 1,
  },
  { unique: true, name: 'oauth_compaction_scope' },
);
oauthCompactionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'oauth_compaction_ttl' },
);

export default oauthCompactionSchema;
