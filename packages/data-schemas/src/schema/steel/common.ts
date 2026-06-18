export const steelProviderEnum = ['openai_oauth_responses', 'openai_api'] as const;
export const steelConversationCreatedFromEnum = ['authenticated', 'guest'] as const;
export const steelConversationStatusEnum = ['active', 'archived'] as const;
export const steelConversationTurnRoleEnum = ['user', 'assistant'] as const;
export const steelConversationTurnSourceEnum = [
  'user_input',
  'assistant_final',
  'queued_steer',
] as const;
export const steelConversationTurnStateEnum = ['active', 'superseded'] as const;
export const steelQueuedSteerStatusEnum = ['queued', 'applied', 'deferred', 'superseded'] as const;
export const steelWorkingOrderMemoryKindEnum = [
  'working_order_row',
  'customer_fact',
  'price_evidence',
  'rule_evidence',
  'ocr_extract',
  'calculation_fact',
] as const;
export const steelWorkingOrderMemorySourceKindEnum = [
  'assistant_final_markdown',
  'tool_result',
  'ocr_result',
  'user_input',
] as const;
export const steelWorkingOrderMemoryStateEnum = ['active', 'superseded'] as const;
export const steelCapabilityStatusEnum = [
  'passed',
  'failed',
  'unverified',
  'disabled',
  'not_applicable',
] as const;
export const steelAuditActorTypeEnum = ['user', 'guest', 'system'] as const;
export const steelAuditResultEnum = ['success', 'denied', 'failure'] as const;
export const steelSourceOriginalFormatEnum = ['xlsx', 'xls', 'docx', 'doc'] as const;
export const steelSourceNormalizedFormatEnum = ['xlsx', 'docx'] as const;
export const steelSourceConversionStatusEnum = [
  'not_required',
  'pending',
  'succeeded',
  'failed',
  'skipped',
] as const;
