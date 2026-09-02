import type { Document } from 'mongoose';

export interface SteelActiveDelegateClaim {
  claimToken: string;
  triggeringMessageId: string;
  delegateOcrIndex: number;
  responseGenerationId?: string;
  executionLeaseToken?: string;
  phase: 'claimed' | 'agent_running' | 'finalizing';
  claimedAt: Date;
  updatedAt: Date;
}

export interface SteelSupersededClaimRecovery {
  claimToken: string;
  delegateOcrIndex: number;
  supersededByClaimToken: string;
  reason: string;
  at: Date;
}

export interface SteelConversationOcrSourceMapping {
  fileId: string;
  sourceCode: string;
  sourceFilename: string;
  createdAt?: Date;
}

export interface SteelConversationOcrResultProvenance {
  generationId: string;
  attemptNumber: number;
  messageId?: string;
  claimToken?: string;
  updatedAt?: Date;
}

export interface ISteelConversationOcrState extends Document {
  conversationId: string;
  nextDelegateOcrIndex: number;
  activeDelegateClaim?: SteelActiveDelegateClaim;
  supersededClaimRecovery?: SteelSupersededClaimRecovery;
  sourceMappings: SteelConversationOcrSourceMapping[];
  currentOcrResultMarkdown?: string;
  currentOcrResultMessageId?: string;
  currentOcrResultIndex?: number;
  currentOcrResultGenerationId?: string;
  currentOcrResultAttemptNumber?: number;
  currentOcrResultProvenance?: SteelConversationOcrResultProvenance;
  createdAt?: Date;
  updatedAt?: Date;
}
