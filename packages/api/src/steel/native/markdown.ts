import type {
  CaptureAssistantFinalMarkdownInput,
  CaptureAssistantFinalMarkdownResult,
  CaptureToolResultInput,
  CaptureToolResultResult,
  SteelOcrFileReference,
} from '../memory/service';
import type { Response } from '../../agents/responses/types';
import type { SteelToolResult } from '../tools/results';

export type SteelNativeMarkdownSkipReason =
  | 'missing_conversation_id'
  | 'missing_message_id'
  | 'missing_turn_index'
  | 'user_message'
  | 'unfinished_message'
  | 'error_message'
  | 'temporary_message'
  | 'blank_content'
  | 'missing_tool_name'
  | 'failed_tool_result';

export interface SteelNativeMarkdownWriter {
  captureAssistantFinalMarkdown(
    input: CaptureAssistantFinalMarkdownInput,
  ): Promise<CaptureAssistantFinalMarkdownResult>;
  captureToolResult(input: CaptureToolResultInput): Promise<CaptureToolResultResult>;
}

export interface SteelNativeAssistantMarkdownMessage {
  conversationId?: string;
  requestId?: string;
  messageId?: string;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  text?: string | null;
  content?: unknown;
  isCreatedByUser?: boolean;
  unfinished?: boolean;
  error?: unknown;
  temporary?: boolean;
  currentTurnFiles?: readonly SteelOcrFileReference[];
  currentOcrMarkdownResults?: readonly SteelOcrFileReference[];
}

export interface CaptureSteelNativeAssistantMarkdownInput
  extends SteelNativeAssistantMarkdownMessage {
  writer: Pick<SteelNativeMarkdownWriter, 'captureAssistantFinalMarkdown'>;
}

export interface CaptureSteelNativeToolResultInput {
  writer: Pick<SteelNativeMarkdownWriter, 'captureToolResult'>;
  conversationId?: string;
  requestId?: string;
  providerToolCallId?: string;
  toolName?: string;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  result?: SteelToolResult;
}

export interface CaptureSteelNativeResponseOutputInput {
  writer: Pick<SteelNativeMarkdownWriter, 'captureAssistantFinalMarkdown'>;
  conversationId?: string;
  responseId?: string;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  currentTurnFiles?: readonly SteelOcrFileReference[];
  currentOcrMarkdownResults?: readonly SteelOcrFileReference[];
  response: Pick<Response, 'id' | 'status' | 'output' | 'error'>;
}

export type CaptureSteelNativeAssistantMarkdownResult =
  | {
      status: 'captured';
      result: CaptureAssistantFinalMarkdownResult;
    }
  | {
      status: 'skipped';
      reason: SteelNativeMarkdownSkipReason;
    };

export type CaptureSteelNativeToolResultResult =
  | {
      status: 'captured';
      result: CaptureToolResultResult;
    }
  | {
      status: 'skipped';
      reason: SteelNativeMarkdownSkipReason;
    };

function getStringProperty(value: unknown, key: string): string | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : undefined;
}

function getNestedStringProperty(
  value: unknown,
  key: string,
  nestedKey: string,
): string | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return getStringProperty(property, nestedKey);
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      return (
        getStringProperty(part, 'text') ?? getNestedStringProperty(part, 'text', 'value') ?? ''
      );
    })
    .join('');
}

function extractOutputContentText(part: unknown): string {
  const type = getStringProperty(part, 'type');
  if (type !== 'output_text' && type !== 'text') {
    return '';
  }

  return getStringProperty(part, 'text') ?? '';
}

export function extractSteelNativeMarkdownText({
  text,
  content,
}: Pick<SteelNativeAssistantMarkdownMessage, 'text' | 'content'>): string {
  if (typeof text === 'string' && text.trim().length > 0) {
    return text;
  }

  return extractContentText(content);
}

export function extractSteelNativeResponseOutputText(response: Pick<Response, 'output'>): string {
  return response.output
    .map((item) => {
      if (item.type !== 'message') {
        return '';
      }

      return item.content.map(extractOutputContentText).join('');
    })
    .join('');
}

function getCheckpointTurnIndex({
  checkpointTurnIndex,
  turnIndex,
}: {
  checkpointTurnIndex?: number;
  turnIndex: number;
}) {
  return checkpointTurnIndex ?? Math.max(0, turnIndex - 1);
}

export async function captureSteelNativeAssistantMarkdown({
  writer,
  conversationId,
  requestId,
  messageId,
  turnIndex,
  checkpointTurnIndex,
  text,
  content,
  isCreatedByUser,
  unfinished,
  error,
  temporary,
  currentTurnFiles,
  currentOcrMarkdownResults,
}: CaptureSteelNativeAssistantMarkdownInput): Promise<CaptureSteelNativeAssistantMarkdownResult> {
  if (isCreatedByUser) {
    return { status: 'skipped', reason: 'user_message' };
  }
  if (unfinished) {
    return { status: 'skipped', reason: 'unfinished_message' };
  }
  if (error) {
    return { status: 'skipped', reason: 'error_message' };
  }
  if (temporary) {
    return { status: 'skipped', reason: 'temporary_message' };
  }
  if (!conversationId) {
    return { status: 'skipped', reason: 'missing_conversation_id' };
  }
  if (!messageId) {
    return { status: 'skipped', reason: 'missing_message_id' };
  }
  if (turnIndex === undefined) {
    return { status: 'skipped', reason: 'missing_turn_index' };
  }

  const markdown = extractSteelNativeMarkdownText({ text, content });
  if (markdown.trim().length === 0) {
    return { status: 'skipped', reason: 'blank_content' };
  }

  const result = await writer.captureAssistantFinalMarkdown({
    conversationId,
    requestId,
    messageId,
    turnIndex,
    checkpointTurnIndex: getCheckpointTurnIndex({ checkpointTurnIndex, turnIndex }),
    content: markdown,
    ...(currentTurnFiles !== undefined ? { currentTurnFiles } : {}),
    ...(currentOcrMarkdownResults !== undefined ? { currentOcrMarkdownResults } : {}),
  });

  return { status: 'captured', result };
}

export async function captureSteelNativeResponseOutput({
  writer,
  conversationId,
  responseId,
  turnIndex,
  checkpointTurnIndex,
  currentTurnFiles,
  currentOcrMarkdownResults,
  response,
}: CaptureSteelNativeResponseOutputInput): Promise<CaptureSteelNativeAssistantMarkdownResult> {
  const messageId = responseId ?? response.id;

  return captureSteelNativeAssistantMarkdown({
    writer,
    conversationId,
    requestId: messageId,
    messageId,
    turnIndex,
    checkpointTurnIndex,
    currentTurnFiles,
    currentOcrMarkdownResults,
    text: extractSteelNativeResponseOutputText(response),
    unfinished: response.status === 'in_progress' || response.status === 'incomplete',
    error: response.error ?? (response.status === 'failed' ? true : undefined),
  });
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
