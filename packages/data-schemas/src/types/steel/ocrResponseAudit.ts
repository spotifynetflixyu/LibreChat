import type { Document } from 'mongoose';

export type SteelOcrResponseAuditStage =
  | 'normal_request'
  | 'responses'
  | 'pending'
  | 'delegate';

export interface ISteelOcrResponseAudit extends Document {
  userId: string;
  tenantId?: string;
  conversationId: string;
  messageId: string;
  generationId: string;
  attemptId?: string;
  attemptNumber: number;
  sourceStage: SteelOcrResponseAuditStage;
  baseRevision?: string;
  baseHash: string;
  rawResponse: string;
  rawResponseHash: string;
  idempotencyKey: string;
  createdAt?: Date;
}
