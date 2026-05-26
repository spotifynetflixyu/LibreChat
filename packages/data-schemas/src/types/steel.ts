import type { Document } from 'mongoose';

export interface ISteelConversationMeta extends Document {
  libreChatConversationId?: string;
  userId?: string;
  guestTokenHash?: string;
  createdFrom: 'authenticated' | 'guest';
  status: 'active' | 'archived';
  workbookId?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelAIRun extends Document {
  conversationMetaId?: string;
  requestedProvider: 'openai_oauth_responses' | 'openai_api';
  effectiveProvider?: 'openai_oauth_responses' | 'openai_api';
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
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelAICapability extends Document {
  provider: 'openai_oauth_responses' | 'openai_api';
  model: string;
  capability: string;
  status: 'passed' | 'failed' | 'not_run' | 'disabled' | 'not_applicable';
  checkedAt?: Date;
  errorCategory?: string;
  errorSummary?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
