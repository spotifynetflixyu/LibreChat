import { z } from 'zod';

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

export const steelQuotationStatusSchema = z
  .object({
    conversationId: z.string().min(1),
    index: z.number().int().nonnegative().nullable(),
    runId: z.string().min(1).optional(),
    status: z.enum(steelQuotationStatuses),
    completedChunks: z.number().int().nonnegative(),
    totalChunks: z.number().int().nonnegative(),
    canCancel: z.boolean(),
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
