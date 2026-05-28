import { z } from 'zod';

export const steelAIDrivers = ['openai_oauth_responses', 'openai_api'] as const;

export type SteelAIDriver = (typeof steelAIDrivers)[number];

export function isSteelAIDriver(value: string): value is SteelAIDriver {
  return (steelAIDrivers as readonly string[]).includes(value);
}

export const steelCapabilityIds = [
  'text',
  'streaming',
  'tool_calling',
  'structured_output',
  'workbook_patch',
  'image_input',
  'pdf_input',
  'doc_input',
  'docx_input',
  'xls_input',
  'xlsx_input',
  'file_search',
  'code_interpreter',
  'conversation_state',
] as const;

export type SteelAIDriverCapability = (typeof steelCapabilityIds)[number];

export const steelCapabilityStatusSchema = z.enum([
  'passed',
  'failed',
  'unverified',
  'disabled',
  'not_applicable',
]);

export type SteelCapabilityStatus = z.infer<typeof steelCapabilityStatusSchema>;

const steelRuntimeSettingValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.array(z.number()),
]);

export const steelRuntimeSettingsSchema = z
  .object({})
  .catchall(steelRuntimeSettingValueSchema)
  .default({});

export type SteelRuntimeSettings = z.infer<typeof steelRuntimeSettingsSchema>;

export const steelCapabilityMapSchema = z.object(
  Object.fromEntries(
    steelCapabilityIds.map((capability) => [capability, steelCapabilityStatusSchema]),
  ) as Record<SteelAIDriverCapability, typeof steelCapabilityStatusSchema>,
);

export type SteelCapabilityMap = z.infer<typeof steelCapabilityMapSchema>;

export const steelModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  model: z.string().min(1),
  provider: z.enum(steelAIDrivers),
  source: z.enum(['librechat_model_spec', 'default_preset', 'endpoint_model']),
  endpoint: z.enum(['/v1/responses', '/v1/chat/completions']),
  defaultForSteel: z.boolean(),
  requestedSettings: steelRuntimeSettingsSchema,
  capabilities: steelCapabilityMapSchema,
  disabledReason: z.string().optional(),
});

export type SteelModelOption = z.infer<typeof steelModelOptionSchema>;

export const steelProviderSmokeTestResultSchema = z.object({
  provider: z.enum(steelAIDrivers),
  model: z.string().min(1),
  capability: z.enum(steelCapabilityIds),
  status: steelCapabilityStatusSchema,
  checkedAt: z.string().min(1),
  errorCategory: z.string().optional(),
  errorSummary: z.string().optional(),
});

export type SteelProviderSmokeTestResult = z.infer<typeof steelProviderSmokeTestResultSchema>;

export const steelAIProviderErrorCategories = [
  'auth',
  'subscription_or_rate_limit',
  'provider_tool_call_unsupported',
  'provider_file_input_unsupported',
  'provider_vision_input_unsupported',
  'provider_xlsx_input_unsupported',
  'provider_hosted_tool_unsupported',
  'structured_output_invalid',
  'provider_timeout',
  'unknown',
] as const;

export const steelAIProviderErrorCategorySchema = z.enum(steelAIProviderErrorCategories);

export type SteelAIProviderErrorCategory = z.infer<typeof steelAIProviderErrorCategorySchema>;

export const steelProviderUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

export type SteelProviderUsage = z.infer<typeof steelProviderUsageSchema>;

export const steelProviderChatFileSchema = z.object({
  filename: z.string().min(1).optional(),
  mediaType: z.string().min(1),
  dataBase64: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export type SteelProviderChatFile = z.infer<typeof steelProviderChatFileSchema>;

export const steelProviderChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1),
  files: z.array(steelProviderChatFileSchema).optional(),
});

export type SteelProviderChatMessage = z.infer<typeof steelProviderChatMessageSchema>;

export const steelProviderReasoningEfforts = ['low', 'medium', 'high', 'xhigh'] as const;

export const steelProviderReasoningEffortSchema = z.enum(steelProviderReasoningEfforts);

export type SteelProviderReasoningEffort = z.infer<typeof steelProviderReasoningEffortSchema>;

export const steelProviderChatRequestSchema = z.object({
  model: z.string().min(1).optional(),
  messages: z.array(steelProviderChatMessageSchema).min(1),
  maxOutputTokens: z.number().int().positive().optional(),
  reasoningEffort: steelProviderReasoningEffortSchema.optional(),
});

export type SteelProviderChatRequest = z.infer<typeof steelProviderChatRequestSchema>;

export const steelProviderChatResponseSchema = z.object({
  provider: z.enum(steelAIDrivers),
  model: z.string().min(1),
  text: z.string(),
  responseId: z.string().min(1).optional(),
  usage: steelProviderUsageSchema.optional(),
  unsupportedSettings: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  errorCategory: steelAIProviderErrorCategorySchema.optional(),
  errorSummary: z.string().min(1).optional(),
});

export type SteelProviderChatResponse = z.infer<typeof steelProviderChatResponseSchema>;
