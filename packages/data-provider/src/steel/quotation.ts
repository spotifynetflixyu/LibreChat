import { z } from 'zod';
import type { TMessage } from '../schemas';

export const steelQuotationMessageUpdateEvent = 'steel_message_update';

export const steelQuotationMessagePublicationSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  outputId: z.string().min(1),
  sourceMessageId: z.string().min(1),
  receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  summaryReceiptSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  admissionSequence: z.number().int().positive(),
  tableContentIndex: z.number().int().nonnegative(),
  summaryContentIndex: z.number().int().nonnegative(),
  footerContentIndex: z.number().int().nonnegative(),
}).refine(({ tableContentIndex, summaryContentIndex, footerContentIndex }) =>
  tableContentIndex !== summaryContentIndex && tableContentIndex !== footerContentIndex &&
  summaryContentIndex !== footerContentIndex, {
  message: 'Quotation message partitions must use distinct slots',
});

export type SteelQuotationMessagePublication = z.infer<
  typeof steelQuotationMessagePublicationSchema
>;

export interface SteelQuotationMessageUpdate {
  message: TMessage;
  publication: SteelQuotationMessagePublication;
  update: 'order' | 'summary';
}

export const steelQuotationStatuses = [
  'idle',
  'queued',
  'running',
  'aggregating',
  'finalizing',
  'interrupted',
  'completed',
  'cancelled',
] as const;

export const steelQuotationOcrSourceSchema = z
  .object({
    source: z.enum(['ai', 'human']),
    version: z.number().int().positive(),
    savedAt: z.string().datetime(),
    messageId: z.string().min(1),
    outputId: z.string().min(1),
    title: z.string().min(1),
    revision: z.string().min(1),
    aiSavedAt: z.string().datetime().optional(),
    humanSavedAt: z.string().datetime().optional(),
  })
  .strict();

export type SteelQuotationOcrSource = z.infer<typeof steelQuotationOcrSourceSchema>;

export const steelQuotationStatusSchema = z
  .object({
    conversationId: z.string().min(1),
    index: z.number().int().nonnegative().nullable(),
    runId: z.string().min(1).optional(),
    status: z.enum(steelQuotationStatuses),
    completedChunks: z.number().int().nonnegative(),
    totalChunks: z.number().int().nonnegative(),
    canCancel: z.boolean(),
    ocrSource: steelQuotationOcrSourceSchema.optional(),
  })
  .refine(({ completedChunks, totalChunks }) => completedChunks <= totalChunks, {
    message: 'completedChunks cannot exceed totalChunks',
  });

export type SteelQuotationStatusName = (typeof steelQuotationStatuses)[number];
export type SteelQuotationStatus = z.infer<typeof steelQuotationStatusSchema>;

export function isSteelQuotationActiveStatus(status: SteelQuotationStatusName): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'aggregating' ||
    status === 'finalizing'
  );
}
