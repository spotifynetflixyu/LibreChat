import mongoose from 'mongoose';
import type { ISteelQuotationState, SteelQuotationScope } from '@librechat/data-schemas';
import type { SteelQuotationStatus } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { SteelFlowGeneration } from '../lifecycle';
import { resolveRequestTenantId } from '../../middleware/tenant';
import { createSteelQuotationStateService } from './state';
import { isUnfinishedQuotation } from './preparation';
import { abortQuotationExecution } from './control';
import { getQuotationProgress } from './progress';
import { quotationOcrSource } from './input';

interface QuotationRequest extends Request {
  user?: { id?: string; tenantId?: string };
  tenantId?: string;
}

export type QuotationStatus = SteelQuotationStatus;

export function quotationStatus(state: ISteelQuotationState | null, conversationId: string): QuotationStatus {
  const run = state?.activeRun;
  const progress = run ? getQuotationProgress(run) : { completedChunks: 0, totalChunks: 0 };
  return {
    conversationId,
    index: run?.index ?? null,
    runId: run?.runId,
    latestRunId: run?.runId,
    stage: run?.stage,
    errorMessage: run?.errorMessage,
    status: run?.status ?? 'idle',
    completedChunks: progress.completedChunks,
    totalChunks: progress.totalChunks,
    canCancel: isUnfinishedQuotation(run?.status),
    ...(run?.ocrSelection ? { ocrSource: quotationOcrSource(run.ocrSelection) } : {}),
  };
}

type QuotationHandler = (req: QuotationRequest, res: Response) => Promise<void>;

export function createQuotationRouteHandlers(dependencies: {
  ownsConversation(userId: string, conversationId: string): Promise<boolean>;
  readGeneration?(conversationId: string): Promise<SteelFlowGeneration | null>;
}): {
  status: QuotationHandler;
  cancel: QuotationHandler;
  pause: QuotationHandler;
} {
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
    return { userId, conversationId, tenantId: resolveRequestTenantId(req) };
  }
  function control(action: 'cancel' | 'pause'): QuotationHandler {
    return async (req, res) => {
      try {
        const scope = await scopeFor(req, res);
        if (!scope) return;
        const index = Number(req.params.index);
        if (!Number.isSafeInteger(index) || index < 1) {
          res.status(400).json({ code: 'invalid_index' });
          return;
        }
        const service = createSteelQuotationStateService(mongoose);
        const state = await service.readState(scope);
        const run = state?.activeRun;
        if (!run || run.index !== index) {
          res.status(409).json({ code: 'flow_expired' });
          return;
        }
        const input = { scope, runId: run.runId };
        if (action === 'pause') {
          const paused = await service.pauseRun(input);
          if (paused) abortQuotationExecution(scope, run.runId, 'user_pause');
        } else if (isUnfinishedQuotation(run.status)) {
          const cancelled = await service.cancelRun(input);
          if (cancelled?.status === 'cancelled') abortQuotationExecution(scope, run.runId);
        }
        const latest = await service.readState(scope);
        if (latest?.activeRun?.runId !== run.runId) {
          res.status(409).json({ code: 'flow_expired' });
          return;
        }
        res.json(quotationStatus(latest, scope.conversationId));
      } catch {
        res.status(500).json({ code: 'quotation_control_failed' });
      }
    };
  }
  return {
    async status(req: QuotationRequest, res: Response) {
      try {
        const scope = await scopeFor(req, res);
        if (!scope) return;
        const service = createSteelQuotationStateService(mongoose);
        let state = await service.readState(scope);
        const run = state?.activeRun;
        if (run?.executionEpoch !== undefined && run.status === 'running' && dependencies.readGeneration) {
          const generation = await dependencies.readGeneration(scope.conversationId);
          if (!generation || generation.createdAt !== run.executionEpoch ||
            (!generation.terminalPersistencePending && !['running', 'requires_action'].includes(generation.status))) {
            await service.settleTurn({ scope, targetMessageId: run.executionResponseId ?? run.targetMessageId,
              executionEpoch: run.executionEpoch, status: 'interrupted' });
            state = await service.readState(scope);
          }
        }
        res.json(quotationStatus(state, scope.conversationId));
      } catch {
        res.status(500).json({ message: 'Could not read quotation status' });
      }
    },
    cancel: control('cancel'),
    pause: control('pause'),
  };
}
