import { randomUUID } from 'crypto';
import type { SteelFlowStatus } from 'librechat-data-provider';
import type { ClientSession } from 'mongoose';
import type { ISteelOcrRun, SteelQuotationScope } from '~/types';
import { createSteelOcrRunModel } from '~/models/steel';

type Mongoose = typeof import('mongoose');
export type SteelOcrRunRecord = Pick<ISteelOcrRun,
  'runId' | 'kind' | 'status' | 'stage' | 'completedChunks' | 'totalChunks' | 'errorMessage' | 'awaitingExecution' |
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
  completedChunks?: number;
  totalChunks?: number;
}
export type SteelOcrControlResult =
  | { ok: true; run: SteelOcrRunRecord; latestRunId: string }
  | { ok: false; code: 'flow_expired' | 'flow_not_found' | 'flow_invalid_state' };

export interface SteelOcrRunMethods {
  createPreflightRun(input: SteelOcrTurnInput & { triggeringMessageId: string }): Promise<SteelOcrRunRecord>;
  updatePreflightRun(input: SteelOcrProgressInput): Promise<boolean>;
  settleTurn(input: SteelOcrSettleInput): Promise<void>;
  pauseScope(input: { scope: SteelQuotationScope; responseGenerationId?: string; executionEpoch?: number }): Promise<void>;
  readRun(scope: SteelQuotationScope, runId: string): Promise<SteelOcrControlResult>;
  controlRun(input: { scope: SteelQuotationScope; runId: string; action: 'pause' | 'resume' | 'retry' | 'cancel' }): Promise<SteelOcrControlResult>;
}

export function createSteelOcrRunMethods(mongoose: Mongoose): SteelOcrRunMethods {
  const Run = createSteelOcrRunModel(mongoose);
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
    const updated = await Run.updateOne({ ...scoped(input.scope), runId: input.runId, status: 'running', awaitingExecution: { $ne: true } }, {
      $set: { stage: input.stage,
        ...(input.completedChunks !== undefined ? { completedChunks: input.completedChunks } : {}),
        ...(input.totalChunks !== undefined ? { totalChunks: input.totalChunks } : {}) },
    });
    return updated.matchedCount === 1;
  }
  async function settleTurn(input: SteelOcrSettleInput): Promise<void> {
    await Run.updateMany({ ...scoped(input.scope), ...(input.executionEpoch !== undefined
      ? { executionEpoch: input.executionEpoch } : { responseGenerationId: input.responseGenerationId }), status: 'running', awaitingExecution: { $ne: true } }, {
      $set: { status: input.status,
        ...(input.status === 'failed' ? { errorMessage: 'OCR processing failed.' } : {}),
        ...(input.status === 'completed' ? { stage: 'completed' } : {}) },
      $unset: { executionLeaseToken: 1, executionLeaseExpiresAt: 1 },
    });
  }
  async function pauseScope(input: { scope: SteelQuotationScope; responseGenerationId?: string; executionEpoch?: number }): Promise<void> {
    const generationFilter = input.responseGenerationId ? { responseGenerationId: input.responseGenerationId } : {};
    await Run.updateMany({ ...scoped(input.scope), status: { $in: ['running', 'interrupted'] }, awaitingExecution: { $ne: true },
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
  async function controlRun(input: { scope: SteelQuotationScope; runId: string; action: 'pause' | 'resume' | 'retry' | 'cancel' }): Promise<SteelOcrControlResult> {
    return mongoose.connection.transaction(async (session): Promise<SteelOcrControlResult> => {
      const result = await readRunInSession(input.scope, input.runId, session);
      if (!result.ok) return result;
      if (input.action !== 'pause' && result.latestRunId !== input.runId) return { ok: false, code: 'flow_expired' };
      const allowed: { [action in typeof input.action]: readonly SteelFlowStatus[] } = {
        pause: ['running', 'paused'], resume: ['paused', 'interrupted'], retry: ['failed'],
        cancel: ['running', 'paused', 'interrupted', 'failed', 'cancelled'],
      };
      if (!allowed[input.action].includes(result.run.status)) return { ok: false, code: 'flow_invalid_state' };
      const statuses = { cancel: 'cancelled', pause: 'paused', resume: 'running', retry: 'running' } as const;
      const status = statuses[input.action];
      const run = await Run.findOneAndUpdate({ ...scoped(input.scope), runId: input.runId, status: result.run.status }, {
        $set: { status, awaitingExecution: input.action === 'resume' || input.action === 'retry' }, $unset: { executionLeaseToken: 1, executionLeaseExpiresAt: 1, errorMessage: 1 },
      }, { new: true, session }).lean<SteelOcrRunRecord>();
      if (!run) return { ok: false, code: 'flow_invalid_state' };
      return { ok: true, run, latestRunId: result.latestRunId };
    });
  }
  return { createPreflightRun, updatePreflightRun, settleTurn, pauseScope, readRun, controlRun };
}
