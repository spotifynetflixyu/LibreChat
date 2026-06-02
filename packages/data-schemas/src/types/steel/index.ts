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
export type SteelRuleProposalType =
  | 'customer_default'
  | 'material_rule'
  | 'price_override'
  | 'formula_default';
export type SteelRuleProposalStatus = 'needs_review' | 'reviewed' | 'rejected';
export type SteelRuleProposalScopeType =
  | 'customer'
  | 'customer_tier'
  | 'material_family'
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

export interface SteelRuleProposalSelectorEntry {
  key: string;
  value: SteelRuleProposalParameterValue;
}

export interface SteelRuleProposalSelector {
  materialFamily?: string;
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
  sheets: SteelWorkbookSheet[];
  status: 'active' | 'archived';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISteelWorkbookPatch extends Document {
  workbookId: string;
  beforeVersion: number;
  afterVersion: number;
  selectedWorkbookRefs?: SteelSelectedWorkbookRef[];
  operations: SteelWorkbookPatchOperation[];
  changedPaths: SteelChangedPath[];
  changedFieldSummary: SteelChangedFieldSummary[];
  status: 'accepted' | 'rejected';
  rejectedReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SteelWorkbookSheetId =
  | 'quote_details'
  | 'summary'
  | 'manual_review'
  | 'price_sources'
  | 'interpretation_notes'
  | 'system_order'
  | 'customer_quote';

export type SteelWorkbookColumnValueType =
  | 'text'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'date'
  | 'status'
  | 'formula';

export type SteelWorkbookCellValue = string | number | boolean | null;

export interface SteelWorkbookColumn {
  key: string;
  label: string;
  valueType: SteelWorkbookColumnValueType;
  editable: boolean;
  widthPx?: number;
}

export interface SteelWorkbookRow {
  id: string;
  cells: Record<string, SteelWorkbookCellValue>;
}

export interface SteelWorkbookSheet {
  id: SteelWorkbookSheetId;
  label: string;
  columns: SteelWorkbookColumn[];
  rows: SteelWorkbookRow[];
}

export interface SteelSelectedWorkbookRef {
  workbookId: string;
  workbookVersion: number;
  sheetId: SteelWorkbookSheetId;
  rowId: string;
  columnKey: string;
  displayLabel?: string;
}

export interface SteelChangedPath {
  sheetId: SteelWorkbookSheetId;
  rowId: string;
  columnKey: string;
}

export interface SteelChangedFieldSummary extends SteelChangedPath {
  label: string;
  previousValue?: SteelWorkbookCellValue;
  nextValue?: SteelWorkbookCellValue;
}

export interface SteelWorkbookPatchOperation extends SteelChangedPath {
  op: 'set_cell';
  value: SteelWorkbookCellValue;
  reason?: string;
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
  materialFamily?: string;
  productFamily?: string;
  chargeType: SteelRuleProposalChargeType;
  formulaCode: string;
  formulaVersionId?: string;
  selector: SteelRuleProposalSelector;
  proposedDefaultParameters: SteelRuleProposalDefaultParameter[];
  sourceRefs: SteelRuleProposalSourceRef[];
  createdFromConversationId: string;
  createdFromWorkbookLineId?: string;
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
