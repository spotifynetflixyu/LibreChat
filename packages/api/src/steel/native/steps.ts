import { Constants, StepEvents, StepTypes, ToolCallTypes } from 'librechat-data-provider';

/**
 * Run-step events that render a backend-executed Steel tool call (PaddleOCR
 * preflight, quotation price lookups) as a normal tool card in the chat.
 */

export interface SteelToolCallPayload {
  id: string;
  name: string;
  args: string;
  output?: string;
  type: typeof ToolCallTypes.TOOL_CALL;
}

export interface SteelToolCallStepInput {
  stepId: string;
  providerToolCallId: string;
  toolName: string;
  index: number;
}

export interface SteelRunStepEvent {
  event: string;
  data: {
    runId: string;
    id: string;
    type: typeof StepTypes.TOOL_CALLS;
    index: number;
    stepDetails: { type: typeof StepTypes.TOOL_CALLS; tool_calls: SteelToolCallPayload[] };
  };
}

export interface SteelRunStepDeltaEvent {
  event: string;
  data: {
    id: string;
    delta: {
      type: typeof StepTypes.TOOL_CALLS;
      tool_calls: (SteelToolCallPayload & { index: number })[];
    };
  };
}

export interface SteelRunStepCompletedEvent {
  event: string;
  data: {
    result: {
      id: string;
      index: number;
      tool_call: SteelToolCallPayload & { progress: 1 };
    };
  };
}

/** Serializes a tool payload for a tool card; unserializable values become a JSON error. */
export function stringifySteelPaddleOcrPayload(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      error: 'PaddleOCR payload could not be serialized',
      message: error instanceof Error ? error.message : undefined,
    });
  }
}

export function createSteelPaddleOcrToolCall({
  providerToolCallId,
  toolName,
  args,
  output,
}: {
  providerToolCallId: string;
  toolName: string;
  args: unknown;
  output?: unknown;
}): SteelToolCallPayload {
  return {
    id: providerToolCallId,
    name: toolName,
    args: stringifySteelPaddleOcrPayload(args),
    ...(output !== undefined ? { output: stringifySteelPaddleOcrPayload(output) } : {}),
    type: ToolCallTypes.TOOL_CALL,
  };
}

export function createSteelPaddleOcrRunStepEvent({
  requestId,
  stepId,
  providerToolCallId,
  toolName,
  index,
}: SteelToolCallStepInput & { requestId?: string }): SteelRunStepEvent {
  return {
    event: StepEvents.ON_RUN_STEP,
    data: {
      runId: requestId ?? Constants.USE_PRELIM_RESPONSE_MESSAGE_ID,
      id: stepId,
      type: StepTypes.TOOL_CALLS,
      index,
      stepDetails: {
        type: StepTypes.TOOL_CALLS,
        tool_calls: [createSteelPaddleOcrToolCall({ providerToolCallId, toolName, args: '' })],
      },
    },
  };
}

export function createSteelPaddleOcrRunStepDeltaEvent({
  stepId,
  providerToolCallId,
  toolName,
  args,
  index,
}: SteelToolCallStepInput & { args: unknown }): SteelRunStepDeltaEvent {
  return {
    event: StepEvents.ON_RUN_STEP_DELTA,
    data: {
      id: stepId,
      delta: {
        type: StepTypes.TOOL_CALLS,
        tool_calls: [
          { index, ...createSteelPaddleOcrToolCall({ providerToolCallId, toolName, args }) },
        ],
      },
    },
  };
}

export function createSteelPaddleOcrRunStepCompletedEvent({
  stepId,
  providerToolCallId,
  toolName,
  args,
  output,
  index,
}: SteelToolCallStepInput & { args: unknown; output: unknown }): SteelRunStepCompletedEvent {
  return {
    event: StepEvents.ON_RUN_STEP_COMPLETED,
    data: {
      result: {
        id: stepId,
        index,
        tool_call: {
          ...createSteelPaddleOcrToolCall({ providerToolCallId, toolName, args, output }),
          progress: 1,
        },
      },
    },
  };
}
