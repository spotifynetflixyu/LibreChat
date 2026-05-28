export const steelProviderEnum = ['openai_oauth_responses', 'openai_api'] as const;
export const steelConversationCreatedFromEnum = ['authenticated', 'guest'] as const;
export const steelConversationStatusEnum = ['active', 'archived'] as const;
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
