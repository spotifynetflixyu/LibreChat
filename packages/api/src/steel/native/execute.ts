import mongoose from 'mongoose';
import { logger } from '@librechat/data-schemas';
import { Constants } from 'librechat-data-provider';
import type { SteelQuotationScope } from '@librechat/data-schemas';
import type { LCTool, LCToolRegistry } from '@librechat/agents';
import type { Response } from 'express';
import type { SteelOcrFileDescriptor, SteelOcrFileReference } from '../memory/service';
import type { SteelNativeToolExecute, SteelNativeToolVisibilityOptions } from './tools';
import type { SteelRepositoryClient } from '../repositories/types';
import type { SteelToolRunState } from '../tools/execute';
import type { SteelNativeEventRequest } from './stream';
import {
  bindQuotationCustomerResult,
  hasQuotationOrder,
  isUnfinishedQuotation,
} from '../quotation/preparation';
import {
  createMongooseSteelWorkingOrderMemoryWriter,
  getSteelOcrFileDescriptor,
} from '../memory/service';
import { mergeSteelToolDefinitions, prepareSteelNativeToolConfig } from './tools';
import { createSteelToolRunState, executeSteelTool } from '../tools/execute';
import { createSteelQuotationStateService } from '../quotation/state';
import { PADDLE_OCR_MCP_SERVER_NAME } from '../ocr/diagnostics';
import { buildSteelNativeEventEnvelopes } from './events';
import { captureSteelNativeToolResult } from './tool-result';
import { emitSteelNativeEvents } from './stream';

const defaultSteelNativeToolMaxCalls = 8;

const steelNativeToolPerToolLimits = Object.freeze({
  search_price_candidates: 2,
});

/** The request fields Steel native tool execution reads. */
export interface SteelNativeToolRequest extends SteelNativeEventRequest {
  body?: {
    conversationId?: string;
    files?: readonly unknown[];
    attachments?: readonly unknown[];
  };
  steelNativeContext?: SteelNativeEventRequest['steelNativeContext'] & {
    conversationId?: string;
    requestId?: string;
    currentTurnFiles?: readonly unknown[];
    assistantTurnIndex?: number;
    memoryCheckpointTurnIndex?: number;
    quotation?: { scope: SteelQuotationScope; messageId: string };
  };
}

/**
 * The provider event handlers load native tools on demand for each tool round.
 * Keep the budget keyed by the request/run-scoped MCP context (or the request
 * itself when no context is available) so reloaded tool instances share one
 * cap without introducing process-global state.
 */
const steelNativeToolRunStates = new WeakMap<object, SteelToolRunState>();

export function getSteelNativeToolRunState({
  req,
  requestScopedConnections,
}: {
  req: object;
  requestScopedConnections?: object | null;
}): SteelToolRunState {
  const scope = requestScopedConnections ?? req;
  let runState = steelNativeToolRunStates.get(scope);
  if (!runState) {
    runState = createSteelToolRunState(
      defaultSteelNativeToolMaxCalls,
      steelNativeToolPerToolLimits,
    );
    steelNativeToolRunStates.set(scope, runState);
  }
  return runState;
}

export function getSteelRequestConversationId(req: SteelNativeToolRequest): string | undefined {
  const conversationId = req.body?.conversationId ?? req.steelNativeContext?.conversationId;
  return typeof conversationId === 'string' && conversationId.trim() !== ''
    ? conversationId
    : undefined;
}

function collectSteelOcrCandidateDescriptors(
  req: SteelNativeToolRequest | undefined,
  requestAttachments: readonly unknown[] | undefined,
): SteelOcrFileDescriptor[] {
  const candidateGroups = [
    req?.steelNativeContext?.currentTurnFiles,
    requestAttachments,
    req?.body?.files,
    req?.body?.attachments,
  ];
  const candidates: SteelOcrFileDescriptor[] = [];
  const seen = new Set<string>();

  for (const group of candidateGroups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const file of group) {
      if (!file || typeof file !== 'object') {
        continue;
      }
      const descriptor = getSteelOcrFileDescriptor(file as SteelOcrFileReference);
      if (!descriptor || seen.has(descriptor.ocrFileKey)) {
        continue;
      }
      seen.add(descriptor.ocrFileKey);
      candidates.push(descriptor);
    }
  }

  return candidates;
}

/** Adds the PaddleOCR MCP server to the agent tools when the turn carries OCR-able files. */
export function addSteelPaddleOcrMcpTool(
  selectedTools: string[],
  req: SteelNativeToolRequest | undefined,
  requestAttachments?: readonly unknown[],
): string[] {
  const serverSuffix = `${Constants.mcp_delimiter}${PADDLE_OCR_MCP_SERVER_NAME}`;
  const serverToken = `${Constants.mcp_all}${serverSuffix}`;
  if (selectedTools.some((tool) => tool === serverToken || tool?.endsWith(serverSuffix))) {
    return selectedTools;
  }

  const ocrableFiles = collectSteelOcrCandidateDescriptors(req, requestAttachments);
  if (ocrableFiles.length === 0) {
    return selectedTools;
  }

  logger.debug('[Steel OCR] Injecting PaddleOCR MCP server during tool initialization', {
    serverName: PADDLE_OCR_MCP_SERVER_NAME,
    files: ocrableFiles.map((file) => ({
      fileId: file.fileId,
      filename: file.filename,
      mediaType: file.mediaType,
    })),
  });
  return [...selectedTools, serverToken];
}

interface SteelToolDefinitionsResult {
  toolDefinitions?: readonly LCTool[];
  toolRegistry?: LCToolRegistry;
}

/** Merges the Steel native tool definitions into a tool-loading result and applies turn visibility. */
export function mergeSteelNativeToolDefinitions<T extends SteelToolDefinitionsResult>(
  result: T,
  visibilityOptions: SteelNativeToolVisibilityOptions = {},
): T & { toolDefinitions: LCTool[]; toolRegistry: LCToolRegistry } {
  const merged = mergeSteelToolDefinitions({
    toolDefinitions: result.toolDefinitions ?? [],
    toolRegistry: result.toolRegistry,
  });
  const visible = prepareSteelNativeToolConfig(
    { toolDefinitions: merged.toolDefinitions, toolRegistry: merged.toolRegistry },
    visibilityOptions,
  );

  return {
    ...result,
    toolDefinitions: visible.toolDefinitions,
    toolRegistry: visible.toolRegistry,
  };
}

export interface CreateSteelNativeToolExecuteInput {
  req: SteelNativeToolRequest;
  res?: Response;
  streamId?: string | null;
  runState: SteelToolRunState;
  client: SteelRepositoryClient;
}

/**
 * Executes Steel native tools for one request: quotation turns may only look up
 * customers against a saved order, every result is captured into working-order
 * memory, and the capture is streamed as Steel activity.
 */
export function createSteelNativeToolExecute({
  req,
  res,
  streamId,
  runState,
  client,
}: CreateSteelNativeToolExecuteInput): SteelNativeToolExecute {
  const conversationId = getSteelRequestConversationId(req);
  let workingOrderMemoryWriter:
    | ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>
    | undefined;

  return async ({ toolName, arguments: args, providerToolCallId }) => {
    const context = req.steelNativeContext;
    const quotation = context?.quotation;
    let quotationLookupState;
    if (quotation) {
      if (toolName === 'search_price_candidates') {
        throw new Error('Price lookup is only available inside quotation chunks');
      }
      quotationLookupState = await createSteelQuotationStateService(mongoose).readState(
        quotation.scope,
      );
      if (
        !hasQuotationOrder(quotationLookupState?.currentOrder?.markdown) ||
        isUnfinishedQuotation(quotationLookupState?.activeRun?.status)
      ) {
        throw new Error('Customer lookup requires a saved order and no unfinished quotation');
      }
    }
    let result = await executeSteelTool({
      client,
      toolName,
      arguments: args,
      providerToolCallId,
      runState,
    });
    if (quotation && toolName === 'search_customers' && quotationLookupState?.currentOrder) {
      result = await bindQuotationCustomerResult({
        scope: quotation.scope,
        messageId: quotation.messageId,
        responseId: requireQuotationResponseId(context?.requestId),
        expectedOrderHash: quotationLookupState.currentOrder.sha256,
        expectedCustomerPreparationId: quotationLookupState.currentCustomer?.preparationId,
        result,
      });
    }
    workingOrderMemoryWriter ??= createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const captureResult = await captureSteelNativeToolResult({
      writer: workingOrderMemoryWriter,
      conversationId,
      requestId: context?.requestId,
      providerToolCallId,
      toolName,
      turnIndex: context?.assistantTurnIndex,
      checkpointTurnIndex: context?.memoryCheckpointTurnIndex,
      result,
    });

    logger.debug('[ToolService] Steel native tool result capture', {
      toolName,
      providerToolCallId,
      status: captureResult.status,
      reason: captureResult.status === 'skipped' ? captureResult.reason : undefined,
      savedCounts:
        captureResult.status === 'captured' ? captureResult.result.savedCounts : undefined,
    });
    await emitSteelNativeEvents({
      req,
      res,
      streamId,
      events: buildSteelNativeEventEnvelopes({
        source: 'tool_result',
        conversationId,
        requestId: context?.requestId,
        toolName,
        providerToolCallId,
        capture: captureResult,
      }),
    });

    return result;
  };
}

function requireQuotationResponseId(requestId: string | undefined): string {
  if (!requestId) {
    throw new Error('Customer lookup requires the quotation response id');
  }
  return requestId;
}
