import { steelFlowReplaySchema } from 'librechat-data-provider';
import { createSteelOcrRunMethods, logger } from '@librechat/data-schemas';
import type { SteelQuotationScope } from '@librechat/data-schemas';
import type { SteelFlowReplay } from 'librechat-data-provider';
import type { SerializableJobData } from '../stream/interfaces/IJobStore';
import type { SteelResponseRequest } from './quotation/completion';
import type { SteelOcrFileReference } from './memory/service';
import type { GenerationJob } from '../types';
import { registerSteelOcrExecution, getSteelOcrFailureStatus } from './ocr/control';
import { isSteelFlowRecoverable, SteelFlowReplayError } from './replay';
import { createSteelQuotationStateService } from './quotation/state';
import { resolveRequestTenantId } from '../middleware/tenant';
import { getSteelOcrFileDescriptor } from './memory/service';
import { createSteelOcrStateService } from './ocr/state';

type Mongoose = typeof import('mongoose');
type SteelFlowJob = Pick<SerializableJobData, 'userId' | 'conversationId' | 'responseMessageId' | 'tenantId' | 'createdAt'>;

interface SteelFlowSettlement {
  req?: SteelResponseRequest;
  conversationId?: string;
  responseId?: string;
  signal?: AbortSignal;
  failed?: boolean;
}

interface SteelFlowReplayInput {
  scope: SteelQuotationScope;
  body?: { steelFlowReplay?: unknown; isRegenerate?: boolean };
  parentMessageId?: string;
  files?: readonly SteelOcrFileReference[];
  readMessage(input: { user: string; messageId: string }): Promise<{
    conversationId?: string | null;
    isCreatedByUser?: boolean;
    parentMessageId?: string | null;
  } | null>;
}

interface SteelFlowLifecycle {
  readReplay(input: SteelFlowReplayInput): Promise<SteelFlowReplay | undefined>;
  pauseJob(job: SteelFlowJob): Promise<void>;
  settleTurn(input: SteelFlowSettlement): Promise<void>;
  registerTurn(input: SteelFlowSettlement & { controller: AbortController }): () => void;
}

export function createSteelFlowLifecycle(mongoose: Mongoose): SteelFlowLifecycle {
  const ocr = createSteelOcrStateService(mongoose);
  const quotation = createSteelQuotationStateService(mongoose);

  async function readReplay({
    scope,
    body,
    parentMessageId,
    files,
    readMessage,
  }: SteelFlowReplayInput): Promise<SteelFlowReplay | undefined> {
    if (body?.steelFlowReplay === undefined) return undefined;
    const parsed = steelFlowReplaySchema.safeParse(body.steelFlowReplay);
    if (!parsed.success || body.isRegenerate !== true) {
      throw new SteelFlowReplayError();
    }
    const target = parsed.data;
    const [source, result] = await Promise.all([
      readMessage({ user: scope.userId, messageId: target.sourceMessageId }),
      target.kind === 'quotation'
        ? undefined
        : createSteelOcrRunMethods(mongoose).readRun(scope, target.runId),
    ]);
    if (
      !source ||
      source.conversationId !== scope.conversationId ||
      source.isCreatedByUser !== false ||
      !parentMessageId ||
      source.parentMessageId !== parentMessageId
    ) {
      throw new SteelFlowReplayError();
    }
    if (target.kind === 'quotation') return target;
    if (
      !result?.ok ||
      result.latestRunId !== target.runId ||
      result.run.kind !== target.kind ||
      !isSteelFlowRecoverable(result.run.status)
    ) {
      throw new SteelFlowReplayError();
    }
    if (
      target.kind === 'preflight' &&
      (result.run.responseGenerationId !== target.sourceMessageId ||
        !files?.some((file) => getSteelOcrFileDescriptor(file)))
    ) {
      throw new SteelFlowReplayError();
    }
    return target;
  }

  async function pauseJob(job: SteelFlowJob): Promise<void> {
    const userId = job.userId;
    const conversationId = job.conversationId;
    const responseGenerationId = job.responseMessageId;
    if (!userId || !conversationId || !responseGenerationId) return;
    const scope: SteelQuotationScope = { userId, conversationId, tenantId: job.tenantId };
    await Promise.all([
      ocr.pauseScope({ scope, responseGenerationId, executionEpoch: job.createdAt }),
      quotation.pauseTurn({ scope, targetMessageId: responseGenerationId, executionEpoch: job.createdAt }),
    ]);
  }

  async function settleTurn(input: SteelFlowSettlement): Promise<void> {
    const userId = input.req?.user?.id;
    const responseGenerationId = input.req?.steelNativeContext?.requestId ?? input.responseId;
    const conversationId = input.conversationId ?? input.req?.steelNativeContext?.quotation?.scope.conversationId;
    if (!input.req || !userId || !conversationId || !responseGenerationId) return;
    const scope: SteelQuotationScope = { userId, conversationId, tenantId: resolveRequestTenantId(input.req) };
    const status = input.signal?.aborted || input.failed ? getSteelOcrFailureStatus(input.signal) : 'completed';
    await Promise.all([
      ocr.settleTurn({ scope, responseGenerationId, status, executionEpoch: input.req._resumableJobCreatedAt }),
      quotation.settleTurn({ scope, targetMessageId: responseGenerationId, status, executionEpoch: input.req._resumableJobCreatedAt }),
    ]);
  }
  return {
    readReplay,
    pauseJob,
    registerTurn(input) {
      const userId = input.req?.user?.id;
      const generationId = input.req?.steelNativeContext?.requestId;
      if (!input.req || !userId || !input.conversationId || !generationId) return () => undefined;
      return registerSteelOcrExecution({ userId, conversationId: input.conversationId,
        tenantId: resolveRequestTenantId(input.req) }, generationId, input.controller,
      input.req._resumableJobCreatedAt);
    },
    async settleTurn(input) {
      try {
        await settleTurn(input);
      } catch {
        logger.error('[Steel] Could not persist terminal flow status');
      }
    },
  };
}

export interface SteelFlowGeneration {
  createdAt: number;
  status: string;
  terminalPersistencePending?: boolean;
}

export function createSteelGenerationReader(manager: {
  getCleanupJob(conversationId: string): Promise<Pick<GenerationJob, 'createdAt' | 'status' | 'metadata'> | undefined>;
}): (conversationId: string) => Promise<SteelFlowGeneration | null> {
  return async (conversationId) => {
    const job = await manager.getCleanupJob(conversationId);
    if (!job) return null;
    return { createdAt: job.createdAt, status: job.status,
      terminalPersistencePending: job.metadata.terminalPersistencePending };
  };
}
