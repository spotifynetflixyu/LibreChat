import mongoose from 'mongoose';

import type { Request, Response } from 'express';
import type { ISteelQuotationState, SteelQuotationScope } from '@librechat/data-schemas';

import { createSteelQuotationStateService } from './state';
import { abortQuotationExecution } from './control';
import { isUnfinishedQuotation } from './preparation';
import { getQuotationProgress } from './progress';

interface QuotationRequest extends Request {
  user?: { id?: string };
}

export interface QuotationStatus {
  conversationId: string; index: number | null; runId?: string; status: string;
  completedChunks: number; totalChunks: number; canCancel: boolean;
}

export function quotationStatus(state: ISteelQuotationState | null, conversationId: string): QuotationStatus {
  const run = state?.activeRun;
  const progress = run ? getQuotationProgress(run) : { completedChunks: 0, totalChunks: 0 };
  return {
    conversationId,
    index: run?.index ?? null,
    runId: run?.runId,
    status: run?.status ?? 'idle',
    completedChunks: progress.completedChunks,
    totalChunks: progress.totalChunks,
    canCancel: isUnfinishedQuotation(run?.status),
  };
}

export function createQuotationRouteHandlers(dependencies: {
  ownsConversation(userId: string, conversationId: string): Promise<boolean>;
}): { status(req: QuotationRequest, res: Response): Promise<void>; cancel(req: QuotationRequest, res: Response): Promise<void> } {
  async function scopeFor(req: QuotationRequest, res: Response): Promise<SteelQuotationScope | undefined> {
    const conversationId = req.params.conversationId;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return undefined;
    }
    if (typeof conversationId !== 'string' || !conversationId ||
      !(await dependencies.ownsConversation(userId, conversationId))) {
      res.status(404).json({ message: 'Conversation not found' });
      return undefined;
    }
    return { userId, conversationId };
  }
  return {
    async status(req: QuotationRequest, res: Response) {
      try {
        const scope = await scopeFor(req, res);
        if (!scope) return;
        const state = await createSteelQuotationStateService(mongoose).readState(scope);
        res.json(quotationStatus(state, scope.conversationId));
      } catch {
        res.status(500).json({ message: 'Could not read quotation status' });
      }
    },
    async cancel(req: QuotationRequest, res: Response) {
      try {
        const scope = await scopeFor(req, res);
        if (!scope) return;
        const index = Number(req.params.index);
        if (!Number.isSafeInteger(index) || index < 1) {
          res.status(400).json({ message: 'Invalid quotation index' });
          return;
        }
        const service = createSteelQuotationStateService(mongoose);
        const state = await service.readState(scope);
        const run = state?.activeRun;
        if (!run || run.index !== index) {
          res.status(409).json({ message: 'Quotation has changed' });
          return;
        }
        if (isUnfinishedQuotation(run.status)) {
          await service.cancelRun({ scope, runId: run.runId });
          abortQuotationExecution(scope, run.runId);
        }
        res.json(quotationStatus(await service.readState(scope), scope.conversationId));
      } catch {
        res.status(500).json({ message: 'Could not cancel quotation' });
      }
    },
  };
}
