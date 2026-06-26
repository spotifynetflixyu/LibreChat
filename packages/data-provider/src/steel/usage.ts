import { z } from 'zod';

export const openAIOAuthUsageWindowKeySchema = z.enum(['primary', 'secondary']);

export const openAIOAuthUsageUnavailableReasonSchema = z.enum([
  'auth_unavailable',
  'request_failed',
  'invalid_response',
]);

export const openAIOAuthUsageWindowSchema = z.object({
  key: openAIOAuthUsageWindowKeySchema,
  usedPercent: z.number().min(0).max(100),
  remainingPercent: z.number().min(0).max(100),
  limitWindowSeconds: z.number().int().positive(),
  resetAfterSeconds: z.number().nonnegative(),
  resetAt: z.string().datetime(),
  limitReached: z.boolean(),
});

export const openAIOAuthUsageRemainingSchema = z.object({
  provider: z.literal('openai_oauth_responses'),
  source: z.literal('chatgpt_wham_usage'),
  status: z.enum(['available', 'unavailable']),
  fetchedAt: z.string().datetime(),
  cacheExpiresAt: z.string().datetime().optional(),
  reason: openAIOAuthUsageUnavailableReasonSchema.optional(),
  windows: z.array(openAIOAuthUsageWindowSchema),
});

export type OpenAIOAuthUsageWindowKey = z.infer<
  typeof openAIOAuthUsageWindowKeySchema
>;

export type OpenAIOAuthUsageUnavailableReason = z.infer<
  typeof openAIOAuthUsageUnavailableReasonSchema
>;

export type OpenAIOAuthUsageWindow = z.infer<typeof openAIOAuthUsageWindowSchema>;

export type OpenAIOAuthUsageRemaining = z.infer<
  typeof openAIOAuthUsageRemainingSchema
>;
