import type { Document } from 'mongoose';

export type SteelProviderId = 'openai_oauth_responses' | 'openai_api';
export type SteelConversationCreatedFrom = 'authenticated' | 'guest';
export type SteelConversationStatus = 'active' | 'archived';
export type SteelConversationTurnRole = 'user' | 'assistant';
export type SteelConversationTurnSource = 'user_input' | 'assistant_final' | 'queued_steer';
export type SteelConversationTurnState = 'active' | 'superseded';
export type SteelQueuedSteerStatus = 'queued' | 'applied' | 'deferred' | 'superseded';
export type SteelWorkingOrderMemoryKind =
  | 'working_order_row'
  | 'customer_fact'
  | 'price_evidence'
  | 'rule_evidence'
  | 'ocr_extract'
  | 'paddleocr_preflight'
  | 'calculation_fact';
export type SteelWorkingOrderMemorySourceKind =
  | 'assistant_final_markdown'
  | 'tool_result'
  | 'ocr_result'
  | 'user_input';
export type SteelWorkingOrderMemoryState = 'active' | 'superseded';
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
export type SteelRuleProposalType =
  | 'customer_default'
  | 'material_rule'
  | 'price_override'
  | 'formula_default';
export type SteelRuleProposalStatus = 'needs_review' | 'reviewed' | 'rejected';
export type SteelRuleProposalScopeType =
  | 'customer'
  | 'customer_tier'
  | 'catalog_family'
  | 'product_family'
  | 'company';
export type SteelRuleProposalChargeType =
  | 'material'
  | 'cutting'
  | 'hole'
  | 'slotting'
  | 'bending'
  | 'processing';
export type SteelRuleProposalConfidence = 'low' | 'medium' | 'high';
export type SteelRuleProposalParameterValueType = 'string' | 'number' | 'boolean' | 'null';
export type SteelRuleProposalParameterValue = string | number | boolean | null;
export type SteelJsonPrimitive = string | number | boolean | null;
export type SteelJsonValue = SteelJsonPrimitive | SteelJsonValue[] | { [key: string]: SteelJsonValue };

export interface SteelRuleProposalSelectorEntry {
  key: string;
  value: SteelRuleProposalParameterValue;
}

export interface SteelRuleProposalSelector {
  catalogFamily?: string;
  productFamily?: string;
  specification?: string;
  workType?: string;
  conditionText?: string;
  customerAlias?: string;
  additionalSelectors?: SteelRuleProposalSelectorEntry[];
}

export interface SteelRuleProposalDefaultParameter {
  key: string;
  value: SteelRuleProposalParameterValue;
  valueType: SteelRuleProposalParameterValueType;
  unit?: string;
  reason?: string;
}

export interface SteelRuleProposalSourceRef {
  channel: string;
  factType: string;
  sourceFile?: string;
  sourceVersionId?: string;
  locator?: string;
  confidence?: SteelRuleProposalConfidence;
  extractedLabel?: string;
  canonicalKey?: string;
}

export interface ISteelConversationMeta extends Document {
  libreChatConversationId?: string;
  userId?: string;
  guestTokenHash?: string;
  createdFrom: SteelConversationCreatedFrom;
  status: SteelConversationStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SteelConversationTurnRevision {
  content: string;
  revisedAt: Date;
  revisedByUserId?: string;
}

export interface SteelConversationTurnAttachmentRef {
  fileId: string;
  filename?: string;
  mediaType?: string;
}

export interface SteelConversationTurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface SteelConversationTurnFinalResponseMetadata {
  provider: SteelProviderId;
  model: string;
  responseId?: string;
  usage?: SteelConversationTurnUsage;
}

export interface SteelConversationTurnQueuedSteer {
  targetRequestId: string;
  status: SteelQueuedSteerStatus;
  appliedAt?: Date;
  deferredAt?: Date;
}

export interface ISteelConversationTurn extends Document {
  conversationId: string;
  userId?: string;
  requestId?: string;
  messageId: string;
  turnIndex: number;
  role: SteelConversationTurnRole;
  source: SteelConversationTurnSource;
  state: SteelConversationTurnState;
  content: string;
  attachments?: SteelConversationTurnAttachmentRef[];
  tableHashes?: string[];
  finalResponseMetadata?: SteelConversationTurnFinalResponseMetadata;
  queuedSteer?: SteelConversationTurnQueuedSteer;
  revisions?: SteelConversationTurnRevision[];
  supersededAt?: Date;
  supersededByMessageId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SteelWorkingOrderMemorySourceRef {
  sourceKind: string;
  sourceId?: string;
  filename?: string;
  fileId?: string;
  storageKey?: string;
  mediaType?: string;
  ocrFileKey?: string;
  pageNumber?: number;
  imageIndex?: number;
  locator?: string;
}

export interface ISteelWorkingOrderMemory extends Document {
  conversationId: string;
  requestId?: string;
  turnIndex: number;
  checkpointTurnIndex: number;
  memoryKind: SteelWorkingOrderMemoryKind;
  sourceKind: SteelWorkingOrderMemorySourceKind;
  state: SteelWorkingOrderMemoryState;
  sourceRefs?: SteelWorkingOrderMemorySourceRef[];
  summary?: string;
  payload?: SteelJsonValue;
  supersededAt?: Date;
  supersededByMessageId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SteelOcrPdfChunkArtifactFile {
  source: 's3' | 'cloudfront';
  storageKey: string;
  storageRegion?: string;
  filepath: string;
  filename: string;
  bytes: number;
  contentType: 'application/pdf';
}

export interface ISteelOcrPdfChunkArtifact extends Document {
  sourcePdfKey: string;
  sourceStorageKey?: string;
  sourceFileId?: string;
  sourceFilename?: string;
  sourceBytes?: number;
  pipelineVersion: number;
  chunkIndex: number;
  chunkCount: number;
  pageStart: number;
  pageEnd: number;
  chunkSizePages: number;
  artifact: SteelOcrPdfChunkArtifactFile;
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

export interface ISteelToolCall extends Document {
  conversationMetaId?: string;
  aiRunId?: string;
  toolName: string;
  status: 'pending' | 'succeeded' | 'failed';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelMemoryCandidate extends Document {
  proposalType: SteelRuleProposalType;
  status: SteelRuleProposalStatus;
  scopeType: SteelRuleProposalScopeType;
  customerId?: string;
  customerTierId?: string;
  catalogFamily?: string;
  productFamily?: string;
  chargeType: SteelRuleProposalChargeType;
  formulaCode: string;
  formulaVersionId?: string;
  selector: SteelRuleProposalSelector;
  proposedDefaultParameters: SteelRuleProposalDefaultParameter[];
  sourceRefs: SteelRuleProposalSourceRef[];
  createdFromConversationId: string;
  createdByUserId: string;
  reviewedByUserId?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  reason: string;
  confidence: SteelRuleProposalConfidence;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelNamedState extends Document {
  name?: string;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
