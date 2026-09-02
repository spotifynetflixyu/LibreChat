import type { Document } from 'mongoose';

export type SteelDelegateOcrStatus =
  | 'running'
  | 'agent_running'
  | 'finalizing'
  | 'completed'
  | 'agent_failed'
  | 'save_failed'
  | 'superseded';

export type SteelDelegateOcrStage =
  | 'claiming'
  | 'preflight'
  | 'agent'
  | 'saving'
  | 'finalizing'
  | 'completed'
  | 'failed';

export type SteelDelegateOcrFailureKind = 'invalid_output' | 'persistence';

export type SteelDelegateOcrJsonPrimitive = string | number | boolean | null;
export type SteelDelegateOcrJsonValue =
  | SteelDelegateOcrJsonPrimitive
  | SteelDelegateOcrJsonValue[]
  | { [key: string]: SteelDelegateOcrJsonValue };

export interface SteelDelegateOcrToolParameters {
  prompt?: string;
  model?: string;
  systemPrompt?: string;
  outputFormat?: string;
  pageStart?: number;
  pageEnd?: number;
  [key: string]: SteelDelegateOcrJsonValue | undefined;
}

export interface SteelDelegateOcrToolFile {
  fileId: string;
  filename: string;
  storageKey?: string;
  mediaType?: string;
  pageNumber?: number;
  imageIndex?: number;
}

export interface SteelDelegateOcrFinalizedCandidate {
  token: string;
  markdown: string;
  source: 'agent' | 'backend';
  generationId?: string;
  targetMessageId?: string;
  createdAt?: Date;
}

export interface SteelDelegateOcrFinalizationJournal {
  candidateValidated: boolean;
  candidateValidatedToken?: string;
  resultPersisted: boolean;
  resultPersistedToken?: string;
  messagePersisted: boolean;
  messagePersistedToken?: string;
  claimCleared: boolean;
  claimClearedToken?: string;
}

export interface SteelDelegateOcrSupersedeProvenance {
  supersededByClaimToken: string;
  supersededByRunId?: string;
  reason: string;
  at: Date;
}

export interface ISteelDelegateOcrRun extends Document {
  conversationId: string;
  delegateOcrIndex: number;
  claimToken: string;
  activeResumeKey?: string;
  triggeringMessageId: string;
  triggeringMessageText?: string;
  toolParameters: SteelDelegateOcrToolParameters;
  files: SteelDelegateOcrToolFile[];
  status: SteelDelegateOcrStatus;
  currentStage: SteelDelegateOcrStage;
  executionLeaseToken?: string;
  executionLeaseExpiresAt?: Date;
  agentAttemptNumber: number;
  agentAttemptToken?: string;
  saveAttemptNumber: number;
  saveAttemptToken?: string;
  responseGenerationId?: string;
  targetMessageId?: string;
  finalizedCandidate?: SteelDelegateOcrFinalizedCandidate;
  failureKind?: SteelDelegateOcrFailureKind;
  finalizationJournal: SteelDelegateOcrFinalizationJournal;
  supersedeProvenance?: SteelDelegateOcrSupersedeProvenance;
  createdAt?: Date;
  updatedAt?: Date;
}
