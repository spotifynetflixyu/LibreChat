import type { SteelQuotationScope } from '@librechat/data-schemas';

const executions = new Map<string, Set<AbortController>>();
function executionKey(scope: SteelQuotationScope, generationId: string, executionEpoch?: number): string {
  return JSON.stringify([scope.userId, scope.tenantId, scope.conversationId,
    executionEpoch !== undefined ? executionEpoch : generationId]);
}

export function registerSteelOcrExecution(scope: SteelQuotationScope, generationId: string,
  controller: AbortController, executionEpoch?: number): () => void {
  const key = executionKey(scope, generationId, executionEpoch);
  const controllers = executions.get(key) ?? new Set<AbortController>();
  controllers.add(controller);
  executions.set(key, controllers);
  return () => {
    controllers.delete(controller);
    if (controllers.size === 0 && executions.get(key) === controllers) executions.delete(key);
  };
}

export async function runWithSteelOcrExecution<T>(input: {
  scope?: SteelQuotationScope;
  responseGenerationId?: string;
  executionEpoch?: number;
  signal?: AbortSignal;
}, execute: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  if (!input.scope || !input.responseGenerationId) return execute(input.signal);
  const controller = new AbortController();
  const dispose = registerSteelOcrExecution(input.scope, input.responseGenerationId, controller, input.executionEpoch);
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  try {
    return await execute(signal);
  } finally {
    dispose();
  }
}

export function abortSteelOcrExecution(scope: SteelQuotationScope, generationId: string,
  reason: 'user_pause' | 'cancelled', executionEpoch?: number): void {
  for (const controller of executions.get(executionKey(scope, generationId, executionEpoch)) ?? []) {
    controller.abort(reason);
  }
}

export function getSteelOcrFailureStatus(signal?: AbortSignal): 'failed' | 'paused' | 'interrupted' {
  if (!signal?.aborted) return 'failed';
  return signal.reason === 'user_pause' ? 'paused' : 'interrupted';
}
