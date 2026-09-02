import type { Document } from 'mongoose';
import type {
  steelAIDrivers,
  steelCapabilityStatuses,
  steelRuleProposalChargeTypes,
  steelRuleProposalConfidences,
  steelRuleProposalParameterValueTypes,
  steelRuleProposalScopeTypes,
  steelRuleProposalStatuses,
  steelRuleProposalTypes,
} from 'librechat-data-provider';

export type SteelProviderId = (typeof steelAIDrivers)[number];
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
export type SteelCapabilityStatus = (typeof steelCapabilityStatuses)[number];

export type SteelSourceOriginalFormat = 'xlsx' | 'xls' | 'docx' | 'doc';
export type SteelSourceNormalizedFormat = 'xlsx' | 'docx';
export type SteelSourceConversionStatus =
  | 'not_required'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'skipped';
export type SteelRuleProposalType = (typeof steelRuleProposalTypes)[number];
export type SteelRuleProposalStatus = (typeof steelRuleProposalStatuses)[number];
export type SteelRuleProposalScopeType = (typeof steelRuleProposalScopeTypes)[number];
export type SteelRuleProposalChargeType = (typeof steelRuleProposalChargeTypes)[number];
export type SteelRuleProposalConfidence = (typeof steelRuleProposalConfidences)[number];
export type SteelRuleProposalParameterValueType =
  (typeof steelRuleProposalParameterValueTypes)[number];
export type SteelRuleProposalParameterValue = string | number | boolean | null;
export type SteelJsonPrimitive = string | number | boolean | null;
export type SteelJsonValue =
  | SteelJsonPrimitive
  | SteelJsonValue[]
  | { [key: string]: SteelJsonValue };

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
  supersededByRanges?: {
    pageStart: number;
    pageEnd: number;
  }[];
  supersededAt?: Date;
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

export * from './delegateOcr';
export * from './conversationOcrState';
