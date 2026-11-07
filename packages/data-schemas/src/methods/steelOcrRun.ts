import { randomUUID } from 'crypto';
import type { SteelFlowStatus } from 'librechat-data-provider';
import type { ClientSession } from 'mongoose';
import type { ISteelOcrRun, SteelQuotationScope } from '~/types';
import { createSteelConversationOcrStateModel, createSteelOcrRunModel } from '~/models/steel';

type Mongoose = typeof import('mongoose');
export type SteelOcrRunRecord = Pick<ISteelOcrRun,
  'runId' | 'kind' | 'status' | 'stage' | 'completedChunks' | 'totalChunks' | 'errorMessage' |
  'conversationId' | 'responseGenerationId' | 'executionEpoch' | 'triggeringMessageId'>;
export interface SteelOcrTurnInput {
  scope: SteelQuotationScope;
  responseGenerationId: string;
  executionEpoch?: number;
}
export interface SteelOcrSettleInput extends SteelOcrTurnInput {
  status: Extract<SteelFlowStatus, 'completed' | 'failed' | 'interrupted' | 'paused'>;
}
export interface SteelOcrProgressInput {
  scope: SteelQuotationScope;
  runId: string;
  stage: string;
  responseGenerationId: string;
  executionEpoch?: number;
  completedChunks?: number;
  totalChunks?: number;
}
export type SteelOcrControlResult =
  | { ok: true; run: SteelOcrRunRecord; latestRunId: string }
  | { ok: false; code: 'flow_expired' | 'flow_not_found' | 'flow_invalid_state' };

export interface SteelOcrResumeTarget {
  scope: SteelQuotationScope;
  kind: ISteelOcrRun['kind'];
  runId: string;
  sourceMessageId: string;
}

type SteelOcrResumeResult =
  | { ok: true; run: ISteelOcrRun }
  | { ok: false; code: 'flow_expired' | 'flow_not_found' | 'flow_not_resumable' };

type SteelOcrResumeClaim = SteelOcrResumeTarget & SteelOcrTurnInput & {
  lease?: { token: string; expiresAt: Date };
};

export interface SteelOcrRunMethods {
  createPreflightRun(input: SteelOcrTurnInput & { triggeringMessageId: string }): Promise<SteelOcrRunRecord>;
  updatePreflightRun(input: SteelOcrProgressInput): Promise<boolean>;
  settleTurn(input: SteelOcrSettleInput): Promise<void>;
  pauseScope(input: { scope: SteelQuotationScope; responseGenerationId?: string; executionEpoch?: number }): Promise<void>;
  readRun(scope: SteelQuotationScope, runId: string): Promise<SteelOcrControlResult>;
  readResumeRun(input: SteelOcrResumeTarget): Promise<SteelOcrResumeResult>;
  claimResumeRun(input: SteelOcrResumeClaim): Promise<SteelOcrResumeResult>;
  controlRun(input: { scope: SteelQuotationScope; runId: string; action: 'pause' | 'cancel' }): Promise<SteelOcrControlResult>;
}

export function createSteelOcrRunMethods(mongoose: Mongoose): SteelOcrRunMethods {
  const Run = createSteelOcrRunModel(mongoose);
  const State = createSteelConversationOcrStateModel(mongoose);
  function scoped(scope: SteelQuotationScope) {
    return { conversationId: scope.conversationId, userId: scope.userId,
      tenantId: scope.tenantId ?? { $exists: false } };
  }
  async function createPreflightRun(input: SteelOcrTurnInput & { triggeringMessageId: string }): Promise<SteelOcrRunRecord> {
    const runId = randomUUID();
    const run = await Run.findOneAndUpdate(
      { ...scoped(input.scope), kind: 'preflight', responseGenerationId: input.responseGenerationId, executionEpoch: input.executionEpoch },
      { $setOnInsert: { ...input.scope, runId, kind: 'preflight', status: 'running', stage: 'preflight',
        responseGenerationId: input.responseGenerationId, executionEpoch: input.executionEpoch, triggeringMessageId: input.triggeringMessageId,
        delegateOcrIndex: 0, claimToken: runId, toolParameters: {}, files: [] } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean<SteelOcrRunRecord>();
    if (!run) throw new Error('OCR run creation returned no document');
    return run;
  }
  async function updatePreflightRun(input: SteelOcrProgressInput): Promise<boolean> {
    const updated = await Run.updateOne({ ...scoped(input.scope), runId: input.runId, responseGenerationId: input.responseGenerationId, executionEpoch: input.executionEpoch, status: 'running' }, {
      $set: { stage: input.stage,
        ...(input.completedChunks !== undefined ? { completedChunks: input.completedChunks } : {}),
        ...(input.totalChunks !== undefined ? { totalChunks: input.totalChunks } : {}) },
    });
    return updated.matchedCount === 1;
  }
  async function settleTurn(input: SteelOcrSettleInput): Promise<void> {
    await Run.updateMany({ ...scoped(input.scope), ...(input.executionEpoch !== undefined
      ? { executionEpoch: input.executionEpoch } : { responseGenerationId: input.responseGenerationId }), status: 'running' }, {
      $set: { status: input.status,
        ...(input.status === 'failed' ? { errorMessage: 'OCR processing failed.' } : {}),
        ...(input.status === 'completed' ? { stage: 'completed' } : {}) },
      $unset: { executionLeaseToken: 1, executionLeaseExpiresAt: 1 },
    });
  }
  async function pauseScope(input: { scope: SteelQuotationScope; responseGenerationId?: string; executionEpoch?: number }): Promise<void> {
    const generationFilter = input.responseGenerationId ? { responseGenerationId: input.responseGenerationId } : {};
    await Run.updateMany({ ...scoped(input.scope), status: { $in: ['running', 'interrupted'] },
      ...(input.executionEpoch !== undefined ? { executionEpoch: input.executionEpoch }
        : generationFilter) }, {
      $set: { status: 'paused' }, $unset: { executionLeaseToken: 1, executionLeaseExpiresAt: 1 },
    });
  }
  async function readRunInSession(scope: SteelQuotationScope, runId: string, session?: ClientSession): Promise<SteelOcrControlResult> {
    const run = await Run.findOne({ ...scoped(scope), runId }, null, { session }).lean<SteelOcrRunRecord>();
    if (!run) return { ok: false, code: 'flow_not_found' };
    const latest = await Run.findOne({ ...scoped(scope), kind: run.kind }, null, { session })
      .sort({ createdAt: -1, _id: -1 }).lean<SteelOcrRunRecord>();
    if (!latest) return { ok: false, code: 'flow_not_found' };
    return { ok: true, run, latestRunId: latest.runId };
  }
  function readRun(scope: SteelQuotationScope, runId: string): Promise<SteelOcrControlResult> {
    return readRunInSession(scope, runId);
  }
  async function readResumeRun(
    input: SteelOcrResumeTarget,
    session?: ClientSession,
  ): Promise<SteelOcrResumeResult> {
    const scope = { ...scoped(input.scope), kind: input.kind };
    const run = await Run.findOne({ ...scope, runId: input.runId }, null, { session }).lean<ISteelOcrRun>();
    if (!run || (run.responseGenerationId !== input.sourceMessageId &&
      !run.resumeSourceMessageIds?.includes(input.sourceMessageId))) {
      return { ok: false, code: 'flow_not_found' };
    }
    const latest = await Run.findOne(scope, { runId: 1 }, { session })
      .sort({ createdAt: -1, _id: -1 }).lean<Pick<ISteelOcrRun, 'runId'>>();
    if (latest?.runId !== run.runId) return { ok: false, code: 'flow_expired' };
    if (!['paused', 'interrupted', 'failed'].includes(run.status)) {
      return { ok: false, code: 'flow_not_resumable' };
    }
    return { ok: true, run };
  }

  function claimResumeRun(input: SteelOcrResumeClaim): Promise<SteelOcrResumeResult> {
    return mongoose.connection.transaction(async (session): Promise<SteelOcrResumeResult> => {
      const result = await readResumeRun(input, session);
      if (!result.ok) return result;
      const { run } = result;
      if (input.kind === 'delegate') {
        if (!input.lease) return { ok: false, code: 'flow_not_resumable' };
        const state = await State.updateOne({
          conversationId: input.scope.conversationId,
          'activeDelegateClaim.claimToken': run.claimToken,
          'activeDelegateClaim.delegateOcrIndex': run.delegateOcrIndex,
          'activeDelegateClaim.triggeringMessageId': run.triggeringMessageId,
        }, {
          $set: {
            'activeDelegateClaim.executionLeaseToken': input.lease.token,
            'activeDelegateClaim.responseGenerationId': input.responseGenerationId,
          },
        }, { session });
        if (state.matchedCount !== 1) return { ok: false, code: 'flow_not_resumable' };
      }
      const claimed = await Run.findOneAndUpdate({
        ...scoped(input.scope),
        runId: run.runId,
        kind: input.kind,
        status: run.status,
      }, {
        $set: {
          status: 'running',
          responseGenerationId: input.responseGenerationId,
          ...(input.executionEpoch !== undefined && { executionEpoch: input.executionEpoch }),
          ...(input.lease && {
            executionLeaseToken: input.lease.token,
            executionLeaseExpiresAt: input.lease.expiresAt,
          }),
        },
        $addToSet: { resumeSourceMessageIds: run.responseGenerationId },
        $unset: {
          errorMessage: 1,
          ...(input.executionEpoch === undefined && { executionEpoch: 1 }),
        },
      }, { session, new: true }).lean<ISteelOcrRun>();
      if (!claimed) throw new Error('OCR recovery claim lost its transaction snapshot');
      return { ok: true, run: claimed };
    });
  }

  async function controlRun(input: { scope: SteelQuotationScope; runId: string; action: 'pause' | 'cancel' }): Promise<SteelOcrControlResult> {
    return mongoose.connection.transaction(async (session): Promise<SteelOcrControlResult> => {
      const result = await readRunInSession(input.scope, input.runId, session);
      if (!result.ok) return result;
      if (input.action !== 'pause' && result.latestRunId !== input.runId) return { ok: false, code: 'flow_expired' };
      const allowed: { [action in typeof input.action]: readonly SteelFlowStatus[] } = {
        pause: ['running', 'paused'],
        cancel: ['running', 'paused', 'interrupted', 'failed', 'cancelled'],
      };
      if (!allowed[input.action].includes(result.run.status)) return { ok: false, code: 'flow_invalid_state' };
      const status = input.action === 'pause' ? 'paused' : 'cancelled';
      const run = await Run.findOneAndUpdate({ ...scoped(input.scope), runId: input.runId, status: result.run.status }, {
        $set: { status }, $unset: { executionLeaseToken: 1, executionLeaseExpiresAt: 1, errorMessage: 1 },
      }, { new: true, session }).lean<SteelOcrRunRecord>();
      if (!run) return { ok: false, code: 'flow_invalid_state' };
      return { ok: true, run, latestRunId: result.latestRunId };
    });
  }
  return { createPreflightRun, updatePreflightRun, settleTurn, pauseScope, readRun, readResumeRun, claimResumeRun, controlRun };
}
