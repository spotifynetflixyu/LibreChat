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

export const openAIOAuthTokenUnavailableReasonSchema = z.enum([
  'auth_unavailable',
  'refresh_failed',
]);

export const openAIOAuthTokenAccessStatusSchema = z.enum(['valid', 'expired', 'unknown']);

export const openAIOAuthTokenLoginUnavailableReasonSchema = z.enum(['codex_cli_unavailable']);

export const openAIOAuthTokenLoginStatusReasonSchema = z.enum([
  'codex_cli_unavailable',
  'auth_path_unsupported',
  'login_already_running',
  'login_failed',
  'login_not_found',
  'login_timeout',
]);

export const openAIOAuthTokenStatusSchema = z.object({
  provider: z.literal('openai_oauth_responses'),
  status: z.enum(['available', 'unavailable']),
  fetchedAt: z.string().datetime(),
  reason: openAIOAuthTokenUnavailableReasonSchema.optional(),
  accessToken: z.object({
    status: openAIOAuthTokenAccessStatusSchema,
    expiresAt: z.string().datetime().optional(),
    expiresInSeconds: z.number().int().nonnegative().optional(),
  }),
  refresh: z.object({
    available: z.boolean(),
  }),
  login: z.object({
    available: z.boolean(),
    reason: openAIOAuthTokenLoginUnavailableReasonSchema.optional(),
  }),
});

export const openAIOAuthTokenLoginStatusSchema = z.object({
  status: z.enum(['unavailable', 'pending', 'succeeded', 'failed']),
  sessionId: z.string().optional(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  reason: openAIOAuthTokenLoginStatusReasonSchema.optional(),
  device: z
    .object({
      verificationUri: z.string().url().optional(),
      userCode: z.string().optional(),
    })
    .optional(),
  token: openAIOAuthTokenStatusSchema.optional(),
});

export type OpenAIOAuthUsageWindowKey = z.infer<typeof openAIOAuthUsageWindowKeySchema>;

export type OpenAIOAuthUsageUnavailableReason = z.infer<
  typeof openAIOAuthUsageUnavailableReasonSchema
>;

export type OpenAIOAuthUsageWindow = z.infer<typeof openAIOAuthUsageWindowSchema>;

export type OpenAIOAuthUsageRemaining = z.infer<typeof openAIOAuthUsageRemainingSchema>;

export type OpenAIOAuthTokenStatus = z.infer<typeof openAIOAuthTokenStatusSchema>;

export type OpenAIOAuthTokenLoginStatus = z.infer<typeof openAIOAuthTokenLoginStatusSchema>;
