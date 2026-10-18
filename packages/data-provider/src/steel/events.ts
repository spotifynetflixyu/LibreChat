import { z } from 'zod';
import { steelQuotationOcrSourceSchema } from './quotation';

export const steelNativeStreamEventName = 'steel_event' as const;

/** Discards the streamed text of one run step before a failed Steel attempt is retried. */
export const steelContentResetEvent = 'on_steel_content_reset' as const;

export interface SteelContentResetEventData {
  /** The message-creation run step whose text is cleared. */
  id: string;
}

export const steelNativeErrorMessageMaxLength = 512;
export const steelNativePreflightToolCallMaxCount = 100;
export const steelNativePreflightToolCallIdMaxBytes = 256;
export const steelNativePreflightToolCallOutputMaxBytes: number = 4 * 1024;
/** Price lookup results keep the provider's compact payload rather than the OCR card shape. */
export const steelNativePriceSearchOutputMaxBytes: number = 12 * 1024 * 1024;

const paddleOcrFieldMaxLength = 256;
const paddleOcrErrorCodeMaxLength = 128;

export function steelUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isUnsafeTextCharacter(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/** Redacts URLs and credentials from an error text and bounds its length. */
export function sanitizeSteelErrorMessage(value: string): string | undefined {
  const normalized = value
    .replace(/https?:\/\/[^\s<>"'`]+/gi, '[redacted-url]')
    .replace(
      /\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|authorization|credential|password|secret|signature|sig|token|key)\s*[:=]\s*[^\s&;,]+/gi,
      (match) => `${match.slice(0, match.search(/[:=]/) + 1)}[REDACTED]`,
    )
    .replace(/\bBearer\s+[^\s"'`]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-z0-9_-]+/gi, 'sk-[REDACTED]')
    .split('')
    .map((character) => (isUnsafeTextCharacter(character.charCodeAt(0)) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return undefined;
  }
  return normalized.length <= steelNativeErrorMessageMaxLength
    ? normalized
    : `${normalized.slice(0, steelNativeErrorMessageMaxLength - 3)}...`;
}

const safeInteger = z.number().int().safe();
const nonNegativeInteger = safeInteger.min(0);
const positiveInteger = safeInteger.min(1);
const countMapSchema = z.record(z.number().finite());
const optionalErrorMessageSchema = z.string().transform(sanitizeSteelErrorMessage).optional();

const pageRangeSchema = z
  .object({ pageStart: positiveInteger, pageEnd: positiveInteger })
  .refine(({ pageStart, pageEnd }) => pageEnd >= pageStart);

export const steelNativeEventSourceSchema = z.enum([
  'ocr_preprocessing',
  'paddleocr_preflight',
  'delegate_ocr_preflight',
  'quotation_preflight',
  'tool_result',
  'quote_runtime',
]);

export const steelNativeDelegateOcrStageSchema = z.enum([
  'resume',
  'paddleocr',
  'organizer',
  'agent',
  'reconciliation',
  'saving',
  'summary',
  'response',
]);

export const steelNativeDelegateOcrStatusSchema = z.enum([
  'started',
  'progress',
  'retrying',
  'succeeded',
  'failed',
  'replaced',
]);

export const steelNativeQuotationStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'aggregating',
  'finalizing',
  'interrupted',
  'completed',
  'cancelled',
]);

const baseFields = {
  conversationId: z.string().optional(),
  requestId: z.string().optional(),
  messageId: z.string().optional(),
  toolName: z.string().optional(),
  providerToolCallId: z.string().optional(),
};

const countFields = {
  savedTableCounts: countMapSchema.optional(),
  totalSavedCounts: countMapSchema.optional(),
  totalTableCounts: countMapSchema.optional(),
};

const parseStatusEventSchema = z.object({
  ...baseFields,
  ...countFields,
  type: z.literal('parse_status'),
  source: steelNativeEventSourceSchema,
  message: z.string(),
  parseStatus: z.enum(['saved', 'partial', 'skipped']),
  errorMessage: optionalErrorMessageSchema,
  failedKeys: z.array(z.string()).optional(),
  missingPageRangesByFileKey: z.record(z.array(pageRangeSchema)).optional(),
  savedCounts: countMapSchema.optional(),
});

const memorySavedEventSchema = z.object({
  ...baseFields,
  ...countFields,
  type: z.literal('memory_saved'),
  source: steelNativeEventSourceSchema,
  message: z.string(),
  savedCounts: countMapSchema,
});

const delegateOcrStatusEventSchema = z.object({
  ...baseFields,
  type: z.literal('delegate_ocr_status'),
  source: z.literal('delegate_ocr_preflight'),
  delegateOcrIndex: positiveInteger,
  stage: steelNativeDelegateOcrStageSchema,
  status: steelNativeDelegateOcrStatusSchema,
  message: z.string(),
  errorMessage: optionalErrorMessageSchema,
  chunkIndex: nonNegativeInteger.optional(),
  chunkCount: positiveInteger.optional(),
});

const quotationStatusEventSchema = z.object({
  ...baseFields,
  type: z.literal('quotation_status'),
  source: z.literal('quotation_preflight'),
  conversationId: z.string().min(1),
  index: nonNegativeInteger,
  runId: z.string().min(1).optional(),
  stage: z.string().min(1),
  status: steelNativeQuotationStatusSchema,
  completedChunks: nonNegativeInteger,
  totalChunks: nonNegativeInteger,
  message: z.string().optional(),
  chunkIndex: nonNegativeInteger.optional(),
  attempt: z.string().min(1).optional(),
  repairAttempt: positiveInteger.optional(),
  maxRepairAttempts: positiveInteger.optional(),
  ocrSource: steelQuotationOcrSourceSchema.optional(),
});

const quoteAuditEventSchema = z.object({
  ...baseFields,
  type: z.literal('quote_audit'),
  source: z.literal('quote_runtime'),
  stage: z.literal('stage_1'),
  status: z.literal('executed'),
  message: z.literal('Code Interpreter executed'),
  toolName: z.literal('code_interpreter'),
  providerToolCallId: z.string().min(1).optional(),
});

const quotationRepairStages = new Set([
  'chunk_repair_started',
  'chunk_repair_succeeded',
  'chunk_repair_failed',
]);

/**
 * The single Steel activity event contract shared by live SSE, persisted
 * message metadata and resume replay. Unknown fields are stripped and error
 * texts are sanitized, so a parsed event is always the canonical form.
 */
export const steelNativeActivityEventSchema = z
  .discriminatedUnion('type', [
    parseStatusEventSchema,
    memorySavedEventSchema,
    delegateOcrStatusEventSchema,
    quotationStatusEventSchema,
    quoteAuditEventSchema,
  ])
  .superRefine((event, ctx) => {
    if (event.type !== 'quotation_status') {
      return;
    }
    const invalid =
      event.completedChunks > event.totalChunks ||
      (event.repairAttempt !== undefined &&
        event.maxRepairAttempts !== undefined &&
        event.repairAttempt > event.maxRepairAttempts) ||
      (quotationRepairStages.has(event.stage) && event.chunkIndex === undefined);
    if (invalid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid quotation status event' });
    }
  });

export type SteelNativeActivityEvent = z.infer<typeof steelNativeActivityEventSchema>;
export type SteelNativeEventSource = z.infer<typeof steelNativeEventSourceSchema>;
export type SteelNativeDelegateOcrStage = z.infer<typeof steelNativeDelegateOcrStageSchema>;
export type SteelNativeDelegateOcrStatus = z.infer<typeof steelNativeDelegateOcrStatusSchema>;
export type SteelNativeQuotationStatus = z.infer<typeof steelNativeQuotationStatusSchema>;
export type SteelNativeSavedCounts = Record<string, number>;
export type SteelNativeTableCounts = Record<string, number>;
export type SteelOcrMissingPageRangesByFileKey = Record<
  string,
  readonly { pageStart: number; pageEnd: number }[]
>;

export function parseSteelNativeActivityEvent(
  value: unknown,
): SteelNativeActivityEvent | undefined {
  const parsed = steelNativeActivityEventSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const paddleOcrErrorTextSchema = z
  .string()
  .transform(sanitizeSteelErrorMessage)
  .refine((value): value is string => value !== undefined);

const paddleOcrIdentityFields = {
  ocrEngine: z.literal('paddleocr_vl'),
  ocrFileKey: z.string().max(paddleOcrFieldMaxLength),
  filename: z.string().max(paddleOcrFieldMaxLength),
  chunkIndex: nonNegativeInteger,
  chunkCount: positiveInteger,
  pageStart: positiveInteger,
  pageEnd: positiveInteger,
  dataSizeBytes: nonNegativeInteger,
};

const paddleOcrOutputSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        status: z.literal('ok'),
        paddleocr: z.literal('ok'),
        ...paddleOcrIdentityFields,
      })
      .strict(),
    z
      .object({
        status: z.literal('fail'),
        paddleocr: z.literal('fail'),
        ...paddleOcrIdentityFields,
        attemptsUsed: positiveInteger,
        errorCode: z.string().min(1).max(paddleOcrErrorCodeMaxLength).optional(),
        error: paddleOcrErrorTextSchema,
        errorMessage: paddleOcrErrorTextSchema,
      })
      .strict(),
  ])
  .refine(({ pageStart, pageEnd }) => pageEnd >= pageStart);

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

const paddleOcrCardOutputSchema = z.string().transform((value, ctx) => {
  const parsed =
    steelUtf8ByteLength(value) <= steelNativePreflightToolCallOutputMaxBytes
      ? paddleOcrOutputSchema.safeParse(parseJson(value))
      : undefined;
  if (!parsed?.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid PaddleOCR card output' });
    return z.NEVER;
  }
  return JSON.stringify(parsed.data);
});

type SteelJsonValue =
  | string
  | number
  | boolean
  | null
  | SteelJsonValue[]
  | { [key: string]: SteelJsonValue };

const steelJsonValueSchema: z.ZodType<SteelJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(steelJsonValueSchema),
    z.record(steelJsonValueSchema),
  ]),
);

const priceSearchToolNameSchema = z.enum([
  'search_price_candidates',
  'steel_search_price_candidates',
]);

const priceSearchOutputSchema = z
  .object({ toolName: priceSearchToolNameSchema })
  .and(
    z.union([
      z.object({ ok: z.literal(true), data: z.record(z.unknown()) }),
      z.object({ ok: z.literal(false), errorCategory: z.string(), errorSummary: z.string() }),
    ]),
  );

const priceSearchCardOutputSchema = z
  .string()
  .refine(
    (value) =>
      steelUtf8ByteLength(value) <= steelNativePriceSearchOutputMaxBytes &&
      priceSearchOutputSchema.safeParse(parseJson(value)).success,
  );

const preflightCardFields = {
  type: z.literal('tool_call'),
  id: z
    .string()
    .min(1)
    .refine((id) => steelUtf8ByteLength(id) <= steelNativePreflightToolCallIdMaxBytes),
  progress: z.union([z.literal(0), z.literal(1)]),
};

const paddleOcrPreflightCardSchema = z.object({
  ...preflightCardFields,
  name: z.string().regex(/^paddleocr_vl(?:(?:---|_mcp_)[A-Za-z0-9_-]+)?$/),
  args: z
    .object({
      input_data: z.string().optional(),
      output_mode: z.literal('detailed'),
      return_images: z.boolean(),
      use_doc_orientation_classify: z.boolean(),
      use_doc_unwarping: z.boolean(),
      use_layout_detection: z.boolean(),
    })
    .strict(),
  output: paddleOcrCardOutputSchema.optional(),
});

const priceSearchPreflightCardSchema = z.object({
  ...preflightCardFields,
  name: priceSearchToolNameSchema,
  args: z.object({ queries: z.array(z.record(steelJsonValueSchema)).min(1).max(100) }).strict(),
  output: priceSearchCardOutputSchema.optional(),
});

/** A persisted preflight tool-call card: a PaddleOCR chunk or a price lookup. */
export const steelNativePreflightToolCallSchema = z.union([
  priceSearchPreflightCardSchema,
  paddleOcrPreflightCardSchema,
]);

export type SteelNativePreflightToolCall = z.infer<typeof steelNativePreflightToolCallSchema>;

export function parseSteelNativePreflightToolCall(
  value: unknown,
): SteelNativePreflightToolCall | undefined {
  const parsed = steelNativePreflightToolCallSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Whether a canonical card output records a failed PaddleOCR chunk or price lookup. */
export function isFailedSteelPreflightOutput(output: string): boolean {
  const parsed = parseJson(output) as { ok?: unknown; status?: unknown } | undefined;
  return parsed?.ok === false || parsed?.status === 'fail';
}
