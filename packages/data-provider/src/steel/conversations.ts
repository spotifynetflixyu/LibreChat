import { z } from 'zod';

export const steelConversationCreatedFromSchema = z.enum(['authenticated', 'guest']);

export const steelConversationStatusSchema = z.enum(['active', 'archived']);

export const steelAuthenticatedConversationRequestSchema = z.object({
  libreChatConversationId: z.string().min(1),
});

export type SteelAuthenticatedConversationRequest = z.infer<
  typeof steelAuthenticatedConversationRequestSchema
>;

export const steelGuestConversationRequestSchema = z.object({
  libreChatConversationId: z.string().min(1),
});

export type SteelGuestConversationRequest = z.infer<typeof steelGuestConversationRequestSchema>;

export const steelConversationReadResponseSchema = z.object({
  id: z.string().min(1),
  libreChatConversationId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  createdFrom: steelConversationCreatedFromSchema,
  status: steelConversationStatusSchema,
  guestTokenIssued: z.boolean(),
  guestToken: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type SteelConversationReadResponse = z.infer<typeof steelConversationReadResponseSchema>;

export const steelConversationMessageRequestSchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1),
  selectedProvider: z.string().min(1).optional(),
  selectedModel: z.string().min(1).optional(),
});

export type SteelConversationMessageRequest = z.infer<typeof steelConversationMessageRequestSchema>;

export interface SteelConversationMeta {
  id: string;
  libreChatConversationId?: string;
  conversationId?: string;
  userId?: string;
  createdFrom?: z.infer<typeof steelConversationCreatedFromSchema>;
  status?: z.infer<typeof steelConversationStatusSchema>;
  guestTokenIssued: boolean;
  createdAt: string;
  updatedAt: string;
}
