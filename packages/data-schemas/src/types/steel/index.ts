import type {
  steelRuleProposalChargeTypes,
  steelRuleProposalConfidences,
  steelRuleProposalParameterValueTypes,
  steelRuleProposalScopeTypes,
  steelRuleProposalStatuses,
  steelRuleProposalTypes,
} from 'librechat-data-provider';
import type { Document } from 'mongoose';

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

export type {
  SteelReviewSourceMethods,
  SteelReviewSourcePageCountUpdate,
  SteelReviewSourceReadInput,
  SteelReviewSourceRecord,
  SteelReviewSourceScope,
} from './sources';

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

export * from './delegateOcr';
export * from './conversationOcrState';
export * from './ocrResponseAudit';
export * from './quotation';
export * from './review';

export * from './publication';
export * from './versions';
