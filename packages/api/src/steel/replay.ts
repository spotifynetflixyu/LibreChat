import { ErrorTypes } from 'librechat-data-provider';
import type { SteelFlowStatus } from 'librechat-data-provider';

export function isSteelFlowRecoverable(status: SteelFlowStatus): boolean {
  return status === 'paused' || status === 'interrupted' || status === 'failed';
}

export class SteelFlowReplayError extends Error {
  readonly code = ErrorTypes.STEEL_FLOW_REPLAY_UNAVAILABLE;

  constructor() {
    super('Steel flow is no longer available for recovery');
    this.name = 'SteelFlowReplayError';
  }
}
