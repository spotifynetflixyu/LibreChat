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
  'provider_terminated',
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

export const steelProviderRoundTimingSchema = z.object({
  round: z.number().int().nonnegative(),
  generationDurationMs: z.number().nonnegative(),
  toolDurationMs: z.number().nonnegative(),
  promptMessageCount: z.number().int().nonnegative(),
  generatedToolCallCount: z.number().int().nonnegative(),
});

export const steelProviderTimingsSchema = z.object({
  totalDurationMs: z.number().nonnegative(),
  generationDurationMs: z.number().nonnegative(),
  toolDurationMs: z.number().nonnegative(),
  roundCount: z.number().int().nonnegative(),
  rounds: z.array(steelProviderRoundTimingSchema),
});

export type SteelProviderTimings = z.infer<typeof steelProviderTimingsSchema>;

const steelProviderChatFileBaseSchema = z.object({
  filename: z.string().min(1).optional(),
  mediaType: z.string().min(1),
});

export const steelProviderChatFileSchema = z.union([
  steelProviderChatFileBaseSchema.extend({
    dataBase64: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    fileId: z.string().min(1).optional(),
  }),
  steelProviderChatFileBaseSchema.extend({
    fileId: z.string().min(1),
    dataBase64: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
  }),
]);

export type SteelProviderChatFile = z.infer<typeof steelProviderChatFileSchema>;

export const steelProviderChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1),
  messageId: z.string().min(1).optional(),
  files: z.array(steelProviderChatFileSchema).optional(),
});

export type SteelProviderChatMessage = z.infer<typeof steelProviderChatMessageSchema>;

export const steelProviderReasoningEfforts = ['low', 'medium', 'high', 'xhigh'] as const;

export const steelProviderReasoningEffortSchema = z.enum(steelProviderReasoningEfforts);

export type SteelProviderReasoningEffort = z.infer<typeof steelProviderReasoningEffortSchema>;

export const steelProviderChatRequestSchema = z
  .object({
    conversationId: z.string().min(1).optional(),
    editMessageId: z.string().min(1).optional(),
    messageSource: z.enum(['user_input', 'queued_steer']).optional(),
    model: z.string().min(1).optional(),
    messages: z.array(steelProviderChatMessageSchema).min(1),
    maxOutputTokens: z.number().int().positive().optional(),
    reasoningEffort: steelProviderReasoningEffortSchema.optional(),
  })
  .strict();

export type SteelProviderChatRequest = z.input<typeof steelProviderChatRequestSchema>;

export interface SteelProviderChatResponse {
  conversationId?: string;
  provider: SteelAIDriver;
  model: string;
  text: string;
  responseId?: string;
  usage?: SteelProviderUsage;
  timings?: SteelProviderTimings;
  unsupportedSettings: string[];
  warnings: string[];
  errorCategory?: SteelAIProviderErrorCategory;
  errorSummary?: string;
}

export const steelProviderChatResponseSchema: z.ZodType<
  SteelProviderChatResponse,
  z.ZodTypeDef,
  unknown
> = z.object({
  conversationId: z.string().min(1).optional(),
  provider: z.enum(steelAIDrivers),
  model: z.string().min(1),
  text: z.string(),
  responseId: z.string().min(1).optional(),
  usage: steelProviderUsageSchema.optional(),
  timings: steelProviderTimingsSchema.optional(),
  unsupportedSettings: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  errorCategory: steelAIProviderErrorCategorySchema.optional(),
  errorSummary: z.string().min(1).optional(),
});

const steelProviderChatStreamToolStatusSchema = z.enum(['started', 'completed', 'failed']);

const steelProviderChatStreamProgressEventSchema = z.object({
  type: z.literal('progress'),
  stage: z.string().min(1),
  message: z.string().min(1),
});

const steelProviderChatStreamLookupEventSchema = z.object({
  type: z.literal('lookup'),
  status: steelProviderChatStreamToolStatusSchema,
  toolName: z.string().min(1),
  message: z.string().min(1),
  ok: z.boolean().optional(),
});

const steelProviderChatStreamToolEventSchema = z.object({
  type: z.literal('tool'),
  status: steelProviderChatStreamToolStatusSchema,
  toolName: z.string().min(1),
  message: z.string().min(1),
  ok: z.boolean().optional(),
});

const steelProviderChatStreamReasoningEventSchema = z.object({
  type: z.literal('reasoning'),
  summary: z.string().min(1),
});

const steelProviderChatStreamMemoryLoadedEventSchema = z.object({
  type: z.literal('memory_loaded'),
  message: z.string().min(1),
  resultCount: z.number().int().nonnegative().optional(),
});

const steelProviderChatStreamMemoryReadEventSchema = z.object({
  type: z.literal('memory_read'),
  message: z.string().min(1),
  mode: z.string().min(1).optional(),
  resultCount: z.number().int().nonnegative().optional(),
});

const steelProviderChatStreamMemorySavedEventSchema = z.object({
  type: z.literal('memory_saved'),
  message: z.string().min(1),
  savedCounts: z.record(z.number().int().nonnegative()),
});

const steelProviderChatStreamParseStatusEventSchema = z.object({
  type: z.literal('parse_status'),
  message: z.string().min(1),
  parseStatus: z.enum(['saved', 'partial', 'skipped']),
  savedCounts: z.record(z.number().int().nonnegative()).optional(),
});

const steelProviderChatStreamSteerEventSchema = z.object({
  type: z.enum(['steer_queued', 'steer_applied', 'steer_deferred', 'steer_superseded']),
  message: z.string().min(1),
});

const steelProviderChatStreamTextEventSchema = z.object({
  type: z.literal('text'),
  delta: z.string(),
});

const steelProviderChatStreamDoneEventSchema = z.object({
  type: z.literal('done'),
  response: steelProviderChatResponseSchema,
});

const steelProviderChatStreamErrorEventSchema = z.object({
  type: z.literal('error'),
  errorCategory: steelAIProviderErrorCategorySchema,
  errorSummary: z.string().min(1),
});

export const steelProviderChatStreamEventSchema = z.discriminatedUnion('type', [
  steelProviderChatStreamProgressEventSchema,
  steelProviderChatStreamLookupEventSchema,
  steelProviderChatStreamToolEventSchema,
  steelProviderChatStreamReasoningEventSchema,
  steelProviderChatStreamMemoryLoadedEventSchema,
  steelProviderChatStreamMemoryReadEventSchema,
  steelProviderChatStreamMemorySavedEventSchema,
  steelProviderChatStreamParseStatusEventSchema,
  steelProviderChatStreamSteerEventSchema,
  steelProviderChatStreamTextEventSchema,
  steelProviderChatStreamDoneEventSchema,
  steelProviderChatStreamErrorEventSchema,
]);

export type SteelProviderChatStreamEvent = z.infer<typeof steelProviderChatStreamEventSchema>;

export function parseSteelProviderChatStreamLine(
  line: string,
): SteelProviderChatStreamEvent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return steelProviderChatStreamEventSchema.parse(JSON.parse(trimmed));
}
