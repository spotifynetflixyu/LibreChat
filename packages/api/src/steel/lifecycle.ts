import { logger } from '@librechat/data-schemas';
import type { SteelQuotationScope } from '@librechat/data-schemas';
import type { SerializableJobData } from '../stream/interfaces/IJobStore';
import type { SteelResponseRequest } from './quotation/completion';
import type { GenerationJob } from '../types';
import { getSteelOcrFailureStatus } from './ocr/control';
import { createSteelQuotationStateService } from './quotation/state';
import { resolveRequestTenantId } from '../middleware/tenant';
import { createSteelOcrStateService } from './ocr/state';

type Mongoose = typeof import('mongoose');
type SteelFlowJob = Pick<
  SerializableJobData,
  'userId' | 'conversationId' | 'responseMessageId' | 'tenantId' | 'createdAt'
>;

interface SteelFlowSettlement {
  req?: SteelResponseRequest;
  conversationId?: string;
  responseId?: string;
  signal?: AbortSignal;
  failed?: boolean;
}

interface SteelFlowLifecycle {
  pauseJob(job: SteelFlowJob): Promise<void>;
  settleTurn(input: SteelFlowSettlement): Promise<void>;
}

export function createSteelFlowLifecycle(mongoose: Mongoose): SteelFlowLifecycle {
  const ocr = createSteelOcrStateService(mongoose);
  const quotation = createSteelQuotationStateService(mongoose);

  async function pauseJob(job: SteelFlowJob): Promise<void> {
    const userId = job.userId;
    const conversationId = job.conversationId;
    const responseGenerationId = job.responseMessageId;
    if (!userId || !conversationId || !responseGenerationId) return;
    const scope: SteelQuotationScope = { userId, conversationId, tenantId: job.tenantId };
    await Promise.all([
      ocr.pauseScope({ scope, responseGenerationId, executionEpoch: job.createdAt }),
      quotation.pauseTurn({
        scope,
        targetMessageId: responseGenerationId,
        executionEpoch: job.createdAt,
      }),
    ]);
  }

  async function settleTurn(input: SteelFlowSettlement): Promise<void> {
    const userId = input.req?.user?.id;
    const responseGenerationId = input.req?.steelNativeContext?.requestId ?? input.responseId;
    const conversationId =
      input.conversationId ?? input.req?.steelNativeContext?.quotation?.scope.conversationId;
    if (!input.req || !userId || !conversationId || !responseGenerationId) return;
    const scope: SteelQuotationScope = {
      userId,
      conversationId,
      tenantId: resolveRequestTenantId(input.req),
    };
    const status =
      input.signal?.aborted || input.failed ? getSteelOcrFailureStatus(input.signal) : 'completed';
    await Promise.all([
      ocr.settleTurn({
        scope,
        responseGenerationId,
        status,
        executionEpoch: input.req._resumableJobCreatedAt,
      }),
      quotation.settleTurn({
        scope,
        targetMessageId: responseGenerationId,
        status,
        executionEpoch: input.req._resumableJobCreatedAt,
      }),
    ]);
  }
  return {
    pauseJob,
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
  getCleanupJob(
    conversationId: string,
  ): Promise<Pick<GenerationJob, 'createdAt' | 'status' | 'metadata'> | undefined>;
}): (conversationId: string) => Promise<SteelFlowGeneration | null> {
  return async (conversationId) => {
    const job = await manager.getCleanupJob(conversationId);
    if (!job) return null;
    return {
      createdAt: job.createdAt,
      status: job.status,
      terminalPersistencePending: job.metadata.terminalPersistencePending,
    };
  };
}
