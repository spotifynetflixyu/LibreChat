import type { Document } from 'mongoose';

export type SteelProviderId = 'openai_oauth_responses' | 'openai_api';
export type SteelConversationCreatedFrom = 'authenticated' | 'guest';
export type SteelConversationStatus = 'active' | 'archived';
export type SteelCapabilityStatus =
  | 'passed'
  | 'failed'
  | 'unverified'
  | 'disabled'
  | 'not_applicable';

export type SteelAuditActorType = 'user' | 'guest' | 'system';
export type SteelAuditResult = 'success' | 'denied' | 'failure';
export type SteelSourceOriginalFormat = 'xlsx' | 'xls' | 'docx' | 'doc';
export type SteelSourceNormalizedFormat = 'xlsx' | 'docx';
export type SteelSourceConversionStatus =
  | 'not_required'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export interface ISteelConversationMeta extends Document {
  libreChatConversationId?: string;
  userId?: string;
  guestTokenHash?: string;
  createdFrom: SteelConversationCreatedFrom;
  status: SteelConversationStatus;
  workbookId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelAIRun extends Document {
  conversationMetaId?: string;
  requestedProvider: SteelProviderId;
  effectiveProvider?: SteelProviderId;
  selectedModel: string;
  unsupportedSettings?: string[];
  providerSessionId?: string;
  providerConversationId?: string;
  providerResponseId?: string;
  contextRefs?: string[];
  toolCallIds?: string[];
  attachedFileRefs?: string[];
  fallbackReason?: string;
  errorCategory?: string;
  errorSummary?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelAICapability extends Document {
  provider: SteelProviderId;
  model: string;
  capability: string;
  status: SteelCapabilityStatus;
  checkedAt?: Date;
  errorCategory?: string;
  errorSummary?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelAuditLog extends Document {
  actorType: SteelAuditActorType;
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  result: SteelAuditResult;
  errorCategory?: string;
  correlationId?: string;
  metadata?: Map<string, string | number | boolean | Date>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelSourceVersion extends Document {
  projectSourceId?: string;
  sourceId?: string;
  originalFileId: string;
  originalFormat: SteelSourceOriginalFormat;
  normalizedFormat?: SteelSourceNormalizedFormat;
  normalizedFileId?: string;
  conversionStatus: SteelSourceConversionStatus;
  conversionError?: string;
  sourceFileType: string;
  parseVersion?: string;
  parseStatus: 'pending' | 'parsed' | 'failed' | 'rejected';
  extractionSummary?: string;
  reviewStatus?: 'pending' | 'approved' | 'rejected';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelWorkbook extends Document {
  conversationMetaId?: string;
  workbookId: string;
  version: number;
  status: 'active' | 'archived';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelWorkbookPatch extends Document {
  workbookId: string;
  beforeVersion: number;
  afterVersion: number;
  status: 'accepted' | 'rejected';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelToolCall extends Document {
  conversationMetaId?: string;
  aiRunId?: string;
  toolName: string;
  status: 'pending' | 'succeeded' | 'failed';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelNamedState extends Document {
  name?: string;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
