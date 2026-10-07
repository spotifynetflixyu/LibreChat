import type { SteelReviewMessageMutationCheckResult } from '@librechat/data-schemas';
import type { Response, NextFunction } from 'express';
import type { ServerRequest } from '../types/http';
import { resolveRequestTenantId } from '../middleware/tenant';

export interface SteelReviewMessageGuardInput {
  userId: string;
  tenantId?: string;
  conversationId: string;
  messageId: string;
}

export interface SteelReviewMessageGuardDeps {
  checkSteelReviewMessageMutation: (
    input: SteelReviewMessageGuardInput,
  ) => Promise<SteelReviewMessageMutationCheckResult>;
}

type SteelReviewMessageRequest = ServerRequest & {
  params: {
    conversationId?: string;
    messageId?: string;
  };
};

export const STEEL_REVIEW_MESSAGE_EDIT_ERROR =
  'Managed Steel review messages must be edited through the review save contract';
export const STEEL_REVIEW_MESSAGE_NOT_FOUND_ERROR = 'Message not found';

export function createSteelReviewMessageMutationMiddleware(
  deps: SteelReviewMessageGuardDeps,
): (req: SteelReviewMessageRequest, res: Response, next: NextFunction) => Promise<void> {
  if (!deps || typeof deps.checkSteelReviewMessageMutation !== 'function') {
    throw new Error('Steel review message guard requires an injected mutation checker');
  }

  return async (req, res, next) => {
    const userId = req.user?.id;
    const conversationId = req.params.conversationId;
    const messageId = req.params.messageId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!conversationId || !messageId) {
      res.status(400).json({ error: 'Invalid message identity' });
      return;
    }

    try {
      const result = await deps.checkSteelReviewMessageMutation({
        userId,
        tenantId: resolveRequestTenantId(req),
        conversationId,
        messageId,
      });
      if (!result.ok) {
        res.status(404).json({ error: STEEL_REVIEW_MESSAGE_NOT_FOUND_ERROR });
        return;
      }
      if (result.value.managed) {
        res.status(409).json({ error: STEEL_REVIEW_MESSAGE_EDIT_ERROR });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
