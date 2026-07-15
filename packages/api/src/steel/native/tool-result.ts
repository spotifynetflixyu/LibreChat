import type {
  CaptureToolResultInput,
  CaptureToolResultResult,
} from '../memory/service';
import type { SteelToolResult } from '../tools/results';

export type SteelNativeToolResultSkipReason =
  | 'missing_conversation_id'
  | 'missing_message_id'
  | 'missing_turn_index'
  | 'user_message'
  | 'unfinished_message'
  | 'error_message'
  | 'temporary_message'
  | 'blank_content'
  | 'missing_tool_name'
  | 'missing_provider_tool_call_id'
  | 'failed_tool_result';

export interface CaptureSteelNativeToolResultInput {
  writer: Pick<SteelNativeToolResultWriter, 'captureToolResult'>;
  conversationId?: string;
  requestId?: string;
  providerToolCallId?: string;
  toolName?: string;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  result?: SteelToolResult;
}

export interface SteelNativeToolResultWriter {
  captureToolResult(input: CaptureToolResultInput): Promise<CaptureToolResultResult>;
}

export type CaptureSteelNativeToolResultResult =
  | {
      status: 'captured';
      result: CaptureToolResultResult;
    }
  | {
      status: 'skipped';
      reason: SteelNativeToolResultSkipReason;
    };

function getCheckpointTurnIndex({
  checkpointTurnIndex,
  turnIndex,
}: {
  checkpointTurnIndex?: number;
  turnIndex: number;
}) {
  return checkpointTurnIndex ?? Math.max(0, turnIndex - 1);
}

function hasProviderToolCallId(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export async function captureSteelNativeToolResult({
  writer,
  conversationId,
  requestId,
  providerToolCallId,
  toolName,
  turnIndex,
  checkpointTurnIndex,
  result,
}: CaptureSteelNativeToolResultInput): Promise<CaptureSteelNativeToolResultResult> {
  if (!conversationId) {
    return { status: 'skipped', reason: 'missing_conversation_id' };
  }
  if (turnIndex === undefined) {
    return { status: 'skipped', reason: 'missing_turn_index' };
  }
  if (!result?.ok) {
    return { status: 'skipped', reason: 'failed_tool_result' };
  }

  const resolvedToolName = toolName ?? result.toolName;
  if (!resolvedToolName) {
    return { status: 'skipped', reason: 'missing_tool_name' };
  }
  if (resolvedToolName === 'search_price_candidates' && !hasProviderToolCallId(providerToolCallId)) {
    return { status: 'skipped', reason: 'missing_provider_tool_call_id' };
  }

  const captureResult = await writer.captureToolResult({
    conversationId,
    requestId,
    providerToolCallId,
    toolName: resolvedToolName,
    turnIndex,
    checkpointTurnIndex: getCheckpointTurnIndex({ checkpointTurnIndex, turnIndex }),
    data: result.data,
  });

  return { status: 'captured', result: captureResult };
}
