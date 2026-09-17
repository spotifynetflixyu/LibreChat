import type { SteelQuotationScope } from '@librechat/data-schemas';

const executions = new Map<string, AbortController>();

function executionKey(scope: SteelQuotationScope, runId: string): string {
  return JSON.stringify([scope.userId, scope.conversationId, runId]);
}

export function registerQuotationExecution(scope: SteelQuotationScope, runId: string): { controller: AbortController; dispose(): void } {
  const key = executionKey(scope, runId);
  // The caller already owns the newly acquired durable lease. A previous
  // local execution may still be unwinding after its lease expired.
  executions.get(key)?.abort(new Error('Quotation execution was superseded'));
  const controller = new AbortController();
  executions.set(key, controller);
  return {
    controller,
    dispose() {
      if (executions.get(key) === controller) executions.delete(key);
    },
  };
}

export function abortQuotationExecution(scope: SteelQuotationScope, runId: string): void {
  executions.get(executionKey(scope, runId))?.abort(new Error('Quotation cancelled'));
}
