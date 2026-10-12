import { z } from 'zod';

export const steelMarkdownVersionSchema = z.object({
  kind: z.enum(['ocr_result', 'system_order', 'customer_data']),
  messageId: z.string().min(1),
  title: z.string().min(1),
  outputId: z.string().min(1),
  revision: z.string().min(1),
  latest: z.boolean(),
  saves: z.number().int().nonnegative(),
});
export const steelMarkdownVersionsSchema = z.object({ versions: z.array(steelMarkdownVersionSchema) });
export type SteelMarkdownVersion = z.infer<typeof steelMarkdownVersionSchema>;
export type SteelMarkdownVersions = z.infer<typeof steelMarkdownVersionsSchema>;
