import mongoose from 'mongoose';
import { createSteelOcrRunMethods } from '@librechat/data-schemas';
import type { SteelOcrRunMethods, SteelQuotationScope } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { SteelFlowGeneration } from '../lifecycle';
import { resolveRequestTenantId } from '../../middleware/tenant';
import { abortSteelOcrExecution } from './control';

interface OcrRequest extends Request {
  user?: { id?: string; tenantId?: string };
  tenantId?: string;
}

type Action = 'pause' | 'resume' | 'retry' | 'cancel';
type Handler = (req: OcrRequest, res: Response) => Promise<void>;

export function createOcrRouteHandlers(dependencies: {
  ownsConversation(userId: string, conversationId: string): Promise<boolean>;
  runs?: SteelOcrRunMethods;
  readGeneration?(conversationId: string): Promise<SteelFlowGeneration | null>;
}): { status: Handler } & { [action in Action]: Handler } {
  const runs = dependencies.runs ?? createSteelOcrRunMethods(mongoose);
  async function scopeFor(req: OcrRequest, res: Response): Promise<SteelQuotationScope | undefined> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ code: 'authentication_required' });
      return;
    }
    const conversationId = req.params.conversationId;
    if (typeof conversationId !== 'string' || !conversationId ||
      !(await dependencies.ownsConversation(userId, conversationId))) {
      res.status(404).json({ code: 'conversation_not_found' });
      return;
    }
    return { userId, conversationId, tenantId: resolveRequestTenantId(req) };
  }
  function handler(action?: Action): Handler {
    return async (req, res) => {
      try {
        const scope = await scopeFor(req, res);
        if (!scope) return;
        const runId = req.params.runId;
        if (typeof runId !== 'string' || !runId || runId.length > 512) {
          res.status(400).json({ code: 'invalid_run_id' });
          return;
        }
        let result = action ? await runs.controlRun({ scope, runId, action }) : await runs.readRun(scope, runId);
        if (!action && result.ok && result.run.status === 'running' && !result.run.awaitingExecution &&
          result.run.executionEpoch !== undefined && dependencies.readGeneration) {
          const generation = await dependencies.readGeneration(scope.conversationId);
          if (!generation || generation.createdAt !== result.run.executionEpoch ||
            (!generation.terminalPersistencePending && !['running', 'requires_action'].includes(generation.status))) {
            await runs.settleTurn({ scope, responseGenerationId: result.run.responseGenerationId ?? '',
              executionEpoch: result.run.executionEpoch, status: 'interrupted' });
            result = await runs.readRun(scope, runId);
          }
        }
        if (!result.ok) {
          res.status(result.code === 'flow_not_found' ? 404 : 409).json({ code: result.code });
          return;
        }
        if ((action === 'pause' || action === 'cancel') && result.run.responseGenerationId) {
          abortSteelOcrExecution(scope, result.run.responseGenerationId, action === 'pause' ? 'user_pause' : 'cancelled', result.run.executionEpoch);
        }
        if (action === 'resume' || action === 'retry') {
          res.json({ runId: result.run.runId, kind: result.run.kind });
          return;
        }
        const { run } = result;
        res.json({ runId: run.runId, kind: run.kind, status: run.status, stage: run.stage,
          completedChunks: run.completedChunks, totalChunks: run.totalChunks,
          errorMessage: run.errorMessage ?? null, latestRunId: result.latestRunId });
      } catch {
        res.status(500).json({ code: 'ocr_control_failed' });
      }
    };
  }
  return { status: handler(), pause: handler('pause'), resume: handler('resume'),
    retry: handler('retry'), cancel: handler('cancel') };
}
