import { z } from 'zod';

import { steelSelectedWorkbookRefSchema } from './workbooks';

export const steelConversationMessageRequestSchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1),
  selectedProvider: z.string().min(1).optional(),
  selectedModel: z.string().min(1).optional(),
  selectedWorkbookRefs: z.array(steelSelectedWorkbookRefSchema).default([]),
});

export type SteelConversationMessageRequest = z.infer<
  typeof steelConversationMessageRequestSchema
>;

export interface SteelConversationMeta {
  id: string;
  conversationId: string;
  userId?: string;
  guestTokenIssued: boolean;
  workbookId?: string;
  createdAt: string;
  updatedAt: string;
}
