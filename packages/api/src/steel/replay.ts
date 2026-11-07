import { ErrorTypes } from 'librechat-data-provider';

type FlowResumeErrorCode =
  | 'flow_not_found'
  | 'flow_expired'
  | 'flow_not_resumable';

export class SteelFlowReplayError extends Error {
  constructor(readonly code: FlowResumeErrorCode = ErrorTypes.STEEL_FLOW_NOT_RESUMABLE) {
    super('Steel flow is no longer available for recovery');
    this.name = 'SteelFlowReplayError';
  }
}
