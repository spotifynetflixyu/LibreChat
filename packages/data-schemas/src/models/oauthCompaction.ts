import type { Model } from 'mongoose';
import type { OAuthCompactionRecord } from '~/types/oauthCompaction';
import oauthCompactionSchema from '~/schema/oauthCompaction';

export function createOAuthCompactionModel(
  mongoose: typeof import('mongoose'),
): Model<OAuthCompactionRecord> {
  return (
    mongoose.models.OAuthCompaction ||
    mongoose.model<OAuthCompactionRecord>('OAuthCompaction', oauthCompactionSchema)
  );
}
