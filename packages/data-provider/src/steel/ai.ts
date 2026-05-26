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
  'xlsx_input',
  'file_search',
  'code_interpreter',
  'conversation_state',
] as const;

export type SteelAIDriverCapability = (typeof steelCapabilityIds)[number];

export const steelFallbackEnvKeys = [
  'STEEL_FALLBACK_REQUIRE_CAPABILITY_PASSED',
  'STEEL_FALLBACK_ON_FILE_INPUT_UNSUPPORTED',
  'STEEL_FALLBACK_ON_VISION_INPUT_UNSUPPORTED',
  'STEEL_FALLBACK_ON_XLSX_INPUT_UNSUPPORTED',
  'STEEL_FALLBACK_ON_HOSTED_TOOL_UNSUPPORTED',
] as const;

export type SteelFallbackEnvKey = (typeof steelFallbackEnvKeys)[number];

export const steelCapabilityStatusSchema = z.enum([
  'passed',
  'failed',
  'not_run',
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

export type SteelAIProviderErrorCategory =
  | 'auth'
  | 'subscription_or_rate_limit'
  | 'provider_tool_call_unsupported'
  | 'provider_file_input_unsupported'
  | 'provider_vision_input_unsupported'
  | 'provider_xlsx_input_unsupported'
  | 'provider_hosted_tool_unsupported'
  | 'structured_output_invalid'
  | 'provider_timeout'
  | 'unknown';
