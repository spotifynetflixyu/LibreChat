import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import type {
  SteelQuotationActiveRun,
  SteelQuotationPendingMessageFile,
  SteelQuotationScope,
  SteelQuotationSnapshotPayload,
} from '@librechat/data-schemas';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';
import type { QuotationBackendFailure, QuotationChildResultInput, QuotationLookupEvidence, QuotationPythonEvidence } from './protocol';
import type { QuotationModelInput, QuotationRepairProgress } from './model';
import type { SteelNativeHistory } from '../native/events';
import type { SavedQuotationLookup } from './history';

import { createSteelQuotationStateService } from './state';
import { defaultQuotationCustomerMarkdown, hasQuotationOrder, isUnfinishedQuotation } from './preparation';
import { parseAssistantMarkdown } from '../ocr/result';
import { parseMarkdownTables } from '../markdown/table';
import { registerQuotationExecution } from './control';
import { buildDefaultSteelGlobalAgentContext } from '../native/context';
import { createSteelPostgresPool } from '../postgres';
import { executeSteelTool, createSteelToolRunState } from '../tools/execute';
import { invokeQuotationModel } from './model';
import { readQuotationHistory } from './history';
import { getQuotationProgress, QUOTATION_V2_SPLIT_SIZES, QUOTATION_V2_MAX_DEPTH } from './progress';
import { buildSteelQuotationStatusEvent } from '../native/events';
import {
  buildQuotationChunks,
  quotationSystemOrderColumns,
  splitQuotationChunk,
  mergeQuotationChildResults,
  QuotationProtocolError,
  extractCustomerDataTable,
  parseQuotationSignal,
  stripLegacyQuotationChildSidecars,
  validateQuotationChildResult,
  finalizeQuotationMainResponse,
  buildQuotationSystemOrder,
  buildQuotationFailureMarkdown,
  restoreQuotationChunks,
} from './protocol';

class QuotationChildFailure extends Error {}

interface SavedQuotationChild {
  backendFailure?: QuotationBackendFailure;
  markdown: string;
  sourceRowIds?: string[];
  lookupOperations: string[];
  pythonOperations: string[];
}

interface LoadedQuotationChild extends QuotationChildResultInput {
  lookupOperations: readonly string[];
  pythonOperations: readonly string[];
}

export interface QuotationProgress {
  run: SteelQuotationActiveRun;
  stage?: 'started' | 'chunk_started' | 'chunk_saved' | 'main_streaming' | QuotationRepairProgress['stage'];
  completedChunks: number;
  totalChunks: number;
  chunkIndex?: number;
  attempt?: string;
  repairAttempt?: number;
  maxRepairAttempts?: number;
  message?: string;
}

export interface QuotationRunnerInput {
  scope: SteelQuotationScope;
  modelOptions: OpenAIOAuthModelOptions;
  signal: AbortSignal;
  onHistory?(history: SteelNativeHistory): Promise<void>;
  onProgress?(progress: QuotationProgress): Promise<void>;
  onTool?(input: {
    run: SteelQuotationActiveRun;
    id: string;
    chunkIndex: number;
    attempt: string;
    arguments: SteelToolJsonObject;
    result?: SteelToolResult;
  }): Promise<void>;
  publishFinal(input: { run: SteelQuotationActiveRun; markdown: string }): Promise<void>;
  onUsage?: QuotationModelInput['onUsage'];
  onTextDelta?: QuotationModelInput['onTextDelta'];
  invokeModel?: typeof invokeQuotationModel;
  executeLookup?: (args: SteelToolJsonObject, callId: string) => Promise<SteelToolResult>;
}

let pool: ReturnType<typeof createSteelPostgresPool> | undefined;

export async function acceptQuotationResponse(input: {
  scope: SteelQuotationScope;
  response: string;
  responseId: string;
  messageId?: string;
  messageText?: string;
  messageFiles?: readonly SteelQuotationPendingMessageFile[];
  expectedOrderHash?: string;
  expectedCustomerPreparationId?: string;
  finishReason?: string;
}): Promise<SteelQuotationActiveRun | undefined> {
  if (input.finishReason !== 'stop') return undefined;
  const signal = parseQuotationSignal(input.response);
  const sections = parseAssistantMarkdown(input.response).sections;
  const hasSection = (title: string) => sections.some((section) => section.title.split(/[｜|]/u)[0]?.trim() === title);
  const customer = extractCustomerDataTable(input.response);
  if (!signal && !hasSection('customer_data') && !hasSection('ocr_result')) return undefined;
  if (hasSection('customer_data') && !customer) {
    throw new Error('Customer data must contain one readable Markdown table');
  }
  const service = createSteelQuotationStateService(mongoose);
  let state = await service.readState(input.scope);
  const existingTicket = state?.tickets.find((entry) => entry.responseId === input.responseId);
  const matchesCustomer = (markdown: string) =>
    JSON.stringify(customer) === JSON.stringify(extractCustomerDataTable(markdown));
  if (isUnfinishedQuotation(state?.activeRun?.status) &&
    (hasSection('ocr_result') || (customer && !matchesCustomer(state?.currentCustomer?.customerMarkdown ?? '')))) {
    if (!input.messageId || (input.messageText === undefined && !input.messageFiles?.length) ||
      input.expectedOrderHash !== state?.currentOrder?.sha256 ||
      input.expectedCustomerPreparationId !== state?.currentCustomer?.preparationId) {
      throw new Error('Queued quotation correction is based on missing or stale preparation data');
    }
    await service.enqueuePendingMessage({
      scope: input.scope,
      sourceMessageId: input.messageId,
      sourceMessageText: input.messageText,
      sourceMessageFiles: input.messageFiles,
      targetMessageId: input.responseId,
      preserveExistingTarget: true,
    });
    return state?.activeRun;
  }
  if (signal && hasSection('ocr_result')) {
    throw new Error('A revised order must be confirmed before issuing a quotation signal');
  }
  if (signal && existingTicket?.acceptedRunId) {
    if (customer && !matchesCustomer(existingTicket.customerMarkdown)) {
      throw new Error('Quotation replay customer data does not match the saved run');
    }
    return service.acceptSignal({
      scope: input.scope,
      index: existingTicket.index,
      token: existingTicket.token,
      orderHash: existingTicket.orderHash,
      customerMarkdown: existingTicket.customerMarkdown,
      customerIdentity: existingTicket.customerIdentity,
      prompts: { child: 'replay', main: 'replay' },
      chunks: [],
      targetMessageId: input.responseId,
    });
  }
  if (customer && (!state?.currentCustomer || !matchesCustomer(state.currentCustomer.customerMarkdown))) {
    if (!matchesCustomer(defaultQuotationCustomerMarkdown)) {
      throw new Error('Customer Markdown does not match the saved customer lookup');
    }
    if (!input.messageId || state?.currentOrder?.sha256 !== input.expectedOrderHash ||
      state?.currentCustomer?.preparationId !== input.expectedCustomerPreparationId) {
      throw new Error('Default customer selection is based on stale preparation data');
    }
    await service.saveCustomer({
      scope: input.scope,
      customerMarkdown: defaultQuotationCustomerMarkdown,
      customerIdentity: 'explicit-default:B',
      triggeringMessageId: input.messageId,
      responseId: input.responseId,
      orderHash: state?.currentOrder?.sha256,
      expectedPreparationId: input.expectedCustomerPreparationId ?? null,
      selectionProvenance: { method: 'default_tier', selectionMessageId: input.messageId },
    });
    state = await service.readState(input.scope);
  }
  if (!signal) return undefined;
  const preparedCustomer = state?.currentCustomer;
  if (!state?.currentOrder || !hasQuotationOrder(state.currentOrder.markdown) || !preparedCustomer) {
    throw new Error('Quotation signal requires a saved complete order and customer');
  }
  const customerResolvedThisResponse = preparedCustomer.responseId === input.responseId &&
    preparedCustomer.orderHash === state.currentOrder.sha256 && customer !== undefined;
  if ((input.expectedOrderHash !== undefined && input.expectedOrderHash !== state.currentOrder.sha256) ||
    (!customerResolvedThisResponse && (input.expectedOrderHash !== state.currentOrder.sha256 ||
      input.expectedCustomerPreparationId !== preparedCustomer.preparationId))) {
    throw new Error('Quotation signal is based on stale preparation data');
  }
  if (isUnfinishedQuotation(state.activeRun?.status)) return state.activeRun;
  const chunks = buildQuotationChunks(state.currentOrder.markdown);
  const conversation = { requestId: input.responseId, conversationId: input.scope.conversationId, activeHistory: [] };
  const [child, main] = await Promise.all([
    buildDefaultSteelGlobalAgentContext({ conversation, mode: 'quote_child' }),
    buildDefaultSteelGlobalAgentContext({ conversation, mode: 'quote_main' }),
  ]);
  const ticket = await service.issueTicket({
    scope: input.scope,
    preparationId: preparedCustomer.preparationId,
    responseId: input.responseId,
    orderHash: state.currentOrder.sha256,
    customerMarkdown: preparedCustomer.customerMarkdown,
    customerIdentity: preparedCustomer.customerIdentity,
    triggeringMessageId: input.messageId ?? preparedCustomer.triggeringMessageId,
    selectionProvenance: preparedCustomer.selectionProvenance,
  });
  return service.acceptSignal({
    scope: input.scope,
    index: ticket.index,
    token: ticket.token,
    orderHash: ticket.orderHash,
    customerMarkdown: ticket.customerMarkdown,
    customerIdentity: ticket.customerIdentity,
    targetMessageId: input.responseId,
    prompts: { child: child.instructionPrefix, main: main.instructionPrefix },
    chunks: chunks.map((chunk) => ({ index: chunk.chunkIndex, sourceRowCount: chunk.sourceRows.length })),
  });
}

export async function runQuotationPreflight(input: QuotationRunnerInput): Promise<{
  status: 'completed' | 'cancelled' | 'busy' | 'idle';
  markdown?: string;
}> {
  const service = createSteelQuotationStateService(mongoose);
  const initial = await service.readState(input.scope);
  const run = initial?.activeRun;
  if (!run) return { status: 'idle' };
  if (input.onHistory) {
    await input.onHistory(await readQuotationHistory({ scope: input.scope, runId: run.runId }));
  }
  if (run.status === 'cancelled') return { status: 'cancelled' };
  const scope = input.scope;
  const runId = run.runId;
  const publish = async (markdown: string, completedRun: SteelQuotationActiveRun) => {
    const receipt = await service.getArtifact({ scope, runId, operationId: 'published' });
    if (!receipt) {
      await input.publishFinal({ run: completedRun, markdown });
      const marked = await service.markPublished({ scope, runId, targetMessageId: completedRun.targetMessageId, finalSha256: createHash('sha256').update(markdown).digest('hex') });
      if (!marked) throw new Error('Quotation publication was superseded');
    }
    return { status: 'completed' as const, markdown };
  };
  if (run.status === 'completed') {
    const markdown = await service.readCheckpoint({ scope, runId, operationId: 'final' });
    if (!markdown) throw new Error('Completed quotation has no final artifact');
    return publish(markdown, run);
  }
  const lease = await service.acquireLease({ scope, runId });
  if (!lease) return { status: 'busy' };
  const leaseInput = { scope, runId, leaseToken: lease.leaseToken };
  const executionAttempt = randomUUID();
  const registration = registerQuotationExecution(scope, runId);
  const controller = registration.controller;
  const abort = () => controller.abort(input.signal.reason);
  if (input.signal.aborted) abort();
  else input.signal.addEventListener('abort', abort, { once: true });
  const heartbeat = setInterval(() => {
    service.heartbeatLease(leaseInput).then((renewed) => {
      if (!renewed) controller.abort(new Error('Quotation execution lease ended'));
    }).catch((error: Error) => controller.abort(error));
  }, 3000);
  heartbeat.unref();
  const operational = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      controller.abort(error);
      throw error;
    }
  };
  const assertActive = async () => {
    controller.signal.throwIfAborted();
    const state = await operational(() => service.readState(scope));
    const active = state?.activeRun;
    if (!active || active.runId !== runId || active.leaseToken !== lease.leaseToken ||
      active.status === 'cancelled' || active.status === 'completed' ||
      !active.leaseExpiresAt || new Date(active.leaseExpiresAt).getTime() <= Date.now()) {
      const error = new Error('Quotation execution is no longer active');
      controller.abort(error);
      throw error;
    }
    return active;
  };
  const progress = async (chunkIndex?: number, attempt?: string, stage?: QuotationProgress['stage'], sliceIndex?: number, recoveryPath?: string) => {
    const active = await assertActive();
    await input.onProgress?.({
      run: active,
      ...getQuotationProgress(active, chunkIndex, sliceIndex, recoveryPath),
      attempt: attempt ?? executionAttempt,
      ...(stage ? { stage } : {}),
    });
  };
  const checkpoint = async (operationId: string, kind: 'chunk' | 'tool' | 'main' | 'final', payload: string, chunkIndex?: number) => {
    try {
      const saved = await service.checkpoint({ ...leaseInput, operationId, kind, payload, chunkIndex });
      if (!saved) throw new Error('Quotation checkpoint lost its execution lease');
    } catch (error) {
      controller.abort(error);
      throw error;
    }
  };
  let interruptedChunkIndex: number | undefined;
  try {
    const running = await service.transitionRun({ ...leaseInput, status: 'running' });
    if (!running) throw new Error('Quotation could not start with its execution lease');
    const payload = await service.readArtifact({ scope, ref: run.snapshotRef });
    if (!payload) throw new Error('Quotation input snapshot is missing');
    const snapshot = JSON.parse(payload) as SteelQuotationSnapshotPayload;
    const chunks = restoreQuotationChunks(snapshot.orderMarkdown, run.chunks);
    const results: QuotationChildResultInput[] = [];
    const recoveryPolicy = await readCheckpoint('recovery-policy');
    if (!recoveryPolicy) {
      await checkpoint('recovery-policy', 'main', JSON.stringify({ version: 2, retrySizes: QUOTATION_V2_SPLIT_SIZES }));
    }
    await progress(undefined, undefined, 'started');
    for (const chunk of chunks) {
      interruptedChunkIndex = chunk.chunkIndex;
      const operationId = `chunk:${chunk.chunkIndex}`;
      const stored = await readCheckpoint(operationId);
      const legacySplit = await readCheckpoint(`split:${chunk.chunkIndex}`);
      const treeSplit = await readCheckpoint(`split-v2:${chunk.chunkIndex}:r`);
      const children: LoadedQuotationChild[] = [];
      if (legacySplit) {
        const slices = splitQuotationChunk(chunk, 10);
        const plan = JSON.parse(legacySplit) as { version: number; rowsPerSlice: number; sourceRowIds: string[][] };
        if (plan.version !== 1 || plan.rowsPerSlice !== 10 || JSON.stringify(plan.sourceRowIds) !==
          JSON.stringify(slices.map((slice) => slice.sourceRows.map((row) => row.sourceRowId)))) {
          throw new Error('Saved quotation recovery plan does not match its source rows');
        }
        if (!run.checkpointRefs.some((ref) => ref.operationId === `split:${chunk.chunkIndex}`)) {
          await checkpoint(`split:${chunk.chunkIndex}`, 'main', legacySplit);
        }
        for (let index = 0; index < slices.length; index += 1) {
          const saved = await readCheckpoint(`slice:${chunk.chunkIndex}:${index + 1}`);
          children.push(...await recoverChild(slices[index]!, `s${index + 1}`, 1, saved));
        }
      } else if (stored && !treeSplit) {
        children.push(await loadChild(chunk, stored));
        await progress(chunk.chunkIndex, undefined, 'chunk_saved');
      } else {
        const rejectedParent = !recoveryPolicy && !treeSplit && run.interruption?.reason === 'error' &&
          run.interruption.chunkIndex === chunk.chunkIndex;
        children.push(...await recoverChild(chunk, 'r', 0, undefined, rejectedParent));
      }
      if (!stored) {
        const lookupOperations = children.flatMap((child) => child.lookupOperations);
        const pythonOperations = children.flatMap((child) => child.pythonOperations);
        await checkpoint(operationId, 'chunk', JSON.stringify({
          markdown: mergeQuotationChildResults(chunk, children), lookupOperations, pythonOperations,
          sourceRowIds: chunk.sourceRows.map((row) => row.sourceRowId),
          ...(children.length === 1 && children[0]!.backendFailure ? { backendFailure: children[0]!.backendFailure } : {}),
        }), chunk.chunkIndex);
      }
      for (const child of children) {
        const validated = validateQuotationChildResult(child);
        results.push({ ...child, response: validated.markdown, markdown: validated.markdown });
      }
    }
    interruptedChunkIndex = undefined;
    await service.transitionRun({ ...leaseInput, status: 'aggregating' });
    await progress();
    const final = finalizeQuotationMainResponse({
      fullOcrResult: snapshot.orderMarkdown,
      mainResponse: buildQuotationSystemOrder({ fullOcrResult: snapshot.orderMarkdown, childResults: results }),
      childResults: results,
    });
    const systemOrder = final.systemOrderMarkdown;
    await checkpoint('system-order:normalized', 'main', systemOrder);
    if (input.onTextDelta) {
      await progress(undefined, undefined, 'main_streaming');
      await input.onTextDelta(systemOrder);
    }
    let reviewOutput = await service.readCheckpoint({ scope, runId, operationId: 'main-reviews' });
    if (!reviewOutput) {
      // A previously validated main checkpoint can be resumed without asking the model again.
      const legacyMain = await service.readCheckpoint({ scope, runId, operationId: 'main' });
      if (legacyMain) {
        const sections = parseAssistantMarkdown(legacyMain).sections.filter((section) =>
          ['manual_reviews', 'manual_review', 'notes'].includes(section.title));
        reviewOutput = sections.map((section) =>
          `## ${section.title === 'notes' ? 'notes' : 'manual_reviews'}\n\n${section.body.trim()}`)
          .join('\n\n') || '無待複核事項。';
      } else {
        const mainAttempt = randomUUID();
        const output = await (input.invokeModel ?? invokeQuotationModel)({
          role: 'main',
          prompt: snapshot.prompts.main,
          input: JSON.stringify({
            order: snapshot.orderMarkdown,
            customer: snapshot.customerMarkdown,
            system_order: systemOrder,
          }),
          modelOptions: input.modelOptions,
          signal: controller.signal,
          assertActive: async () => { await assertActive(); },
          onUsage: input.onUsage ? (usage) => operational(() => input.onUsage!(usage)) : undefined,
          onPythonEvidence: async (evidence) => {
            await assertActive();
            await checkpoint(`python:main:${mainAttempt}:${evidence.toolCallId}:${evidence.type}`, 'tool', JSON.stringify(evidence));
          },
        });
        reviewOutput = output.markdown || '無待複核事項。';
        await checkpoint(`main-output:${randomUUID()}`, 'main', reviewOutput);
      }
      await checkpoint('main-reviews', 'main', reviewOutput);
    }
    await service.transitionRun({ ...leaseInput, status: 'finalizing' });
    await progress();
    // Review prose is model-owned. Counting display rows never gates the saved quotation.
    const reviews = reviewOutput.trim() === '無待複核事項。' ? '' : reviewOutput.trim();
    const reviewDocument = parseAssistantMarkdown(reviews);
    const reviewSections = reviewDocument.sections;
    const reviewDisplay = [reviewDocument.preamble.trim(),
      ...reviewSections.filter((section) => section.title !== 'notes').map((section) => section.raw.trim()),
      ...reviewSections.filter((section) => section.title === 'notes').map((section) => section.raw.trim()),
    ].filter(Boolean).join('\n\n');
    const reviewCount = reviewSections
      .filter((section) => ['manual_reviews', 'manual_review'].includes(section.title))
      .flatMap((section) => parseMarkdownTables(section.body))
      .reduce((count, table) => count + table.rows.length, 0);
    const failedMaterialCount = results.reduce((count, child) =>
      count + (child.backendFailure ? child.chunk.sourceRows.length : 0), 0);
    const completion = reviewCount > 0
      ? `查價輸出完成：共 ${final.rows.length} 筆 system_order、${reviewCount} 項待複核事項。`
      : reviews || failedMaterialCount > 0 ? `查價輸出完成：共 ${final.rows.length} 筆 system_order。` : final.summary;
    const categoryColumn = quotationSystemOrderColumns.indexOf('類別');
    const materialCount = final.rows.filter((row) => !row[categoryColumn]?.trim().startsWith('加工/')).length;
    const sourceCount = chunks.reduce((count, chunk) => count + chunk.sourceRows.length, 0);
    const processingCount = final.rows.length - materialCount;
    const failureSummary = failedMaterialCount > 0
      ? `\n\n${failedMaterialCount} 個材料項次報價失敗，已保留 OCR 原值及空白報價欄位，需人工複核。` : '';
    const summary = `${completion}\n\n項次核對：材料項次 ${materialCount}／原始訂單 ${sourceCount} 項；加工列 ${processingCount} 筆。${failureSummary}`;
    const completedResponse = [final.systemOrderMarkdown, final.customerQuoteMarkdown, reviewDisplay, `## quote_summary\n\n${summary}`]
      .filter(Boolean).join('\n\n');
    await checkpoint('final', 'final', completedResponse);
    const state = await assertActive();
    const finalPointer = state.checkpointRefs.find((entry) => entry.operationId === 'final');
    if (!finalPointer) throw new Error('Quotation final checkpoint is missing');
    const completed = await service.completeRun({
      ...leaseInput,
      finalRef: { ...scope, ...finalPointer, runId, kind: 'final' },
      targetMessageId: run.targetMessageId,
    });
    if (!completed) throw new Error('Quotation completion lost its execution lease');
    clearInterval(heartbeat);
    await input.onProgress?.({ run: completed, ...getQuotationProgress(completed) });
    return publish(completedResponse, completed);

    async function readCheckpoint(operationId: string): Promise<string | undefined> {
      try {
        return await service.readCheckpoint({ scope, runId, operationId });
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    }

    async function recoverChild(
      chunk: ReturnType<typeof buildQuotationChunks>[number],
      path: string,
      depth: number,
      legacyOutput?: string,
      rejectedParent = false,
    ): Promise<LoadedQuotationChild[]> {
      await assertActive();
      const leafOperation = `leaf-v2:${chunk.chunkIndex}:${path}`;
      const splitOperation = `split-v2:${chunk.chunkIndex}:${path}`;
      const [saved, split] = await Promise.all([readCheckpoint(leafOperation), readCheckpoint(splitOperation)]);
      if ((saved || legacyOutput) && !split) {
        const loaded = await loadChild(chunk, (saved ?? legacyOutput)!);
        validateQuotationChildResult(loaded);
        if (saved && !run.checkpointRefs.some((ref) => ref.operationId === leafOperation)) {
          await checkpoint(leafOperation, 'chunk', saved);
        }
        await progress(chunk.chunkIndex, undefined, 'chunk_saved', undefined, path);
        return [loaded];
      }
      let failureReason = '報價子 Agent 未能產出有效結果';
      if (!split && !rejectedParent) {
        let output: string;
        try {
          output = await generateChild(chunk, path);
        } catch (error) {
          await assertActive();
          if (!(error instanceof QuotationChildFailure)) throw error;
          failureReason = error.message;
          output = '';
        }
        if (output) {
          await checkpoint(leafOperation, 'chunk', output);
          const loaded = await loadChild(chunk, output);
          await progress(chunk.chunkIndex, undefined, 'chunk_saved', undefined, path);
          return [loaded];
        }
      }
      if (depth === QUOTATION_V2_MAX_DEPTH) {
        if (split) throw new Error('Quotation recovery exceeds its retry limit');
        const backendFailure: QuotationBackendFailure = { retryDepth: 3, reason: failureReason };
        const output = JSON.stringify({
          markdown: buildQuotationFailureMarkdown(chunk, failureReason), backendFailure,
          sourceRowIds: chunk.sourceRows.map((row) => row.sourceRowId), lookupOperations: [], pythonOperations: [],
        });
        await checkpoint(leafOperation, 'chunk', output);
        const loaded = await loadChild(chunk, output);
        validateQuotationChildResult(loaded);
        await progress(chunk.chunkIndex, undefined, 'chunk_saved', undefined, path);
        return [loaded];
      }
      const rowsPerSlice = QUOTATION_V2_SPLIT_SIZES[depth as 0 | 1 | 2]!;
      const slices = splitQuotationChunk(chunk, rowsPerSlice);
      const sourceRowIds = slices.map((slice) => slice.sourceRows.map((row) => row.sourceRowId));
      if (split) {
        const plan = JSON.parse(split) as { version: number; depth: number; rowsPerSlice: number; sourceRowIds: string[][] };
        if (plan.version !== 2 || plan.depth !== depth || plan.rowsPerSlice !== rowsPerSlice ||
          JSON.stringify(plan.sourceRowIds) !== JSON.stringify(sourceRowIds)) {
          throw new Error('Saved quotation recovery plan does not match its source rows');
        }
        if (!run.checkpointRefs.some((ref) => ref.operationId === splitOperation)) {
          await checkpoint(splitOperation, 'main', split);
        }
      } else {
        await checkpoint(splitOperation, 'main', JSON.stringify({ version: 2, depth, rowsPerSlice, sourceRowIds }));
      }
      const children: LoadedQuotationChild[] = [];
      for (let index = 0; index < slices.length; index += 1) {
        children.push(...await recoverChild(slices[index]!, `${path}.${index + 1}`, depth + 1));
      }
      return children;
    }

    async function generateChild(
      chunk: ReturnType<typeof buildQuotationChunks>[number],
      recoveryPath: string,
    ): Promise<string> {
      const attempt = `node-${recoveryPath}-${randomUUID()}`;
      await progress(chunk.chunkIndex, attempt, 'chunk_started', undefined, recoveryPath);
      const lookupOperations: string[] = [];
      const pythonOperations: string[] = [];
      const toolState = createSteelToolRunState(120);
      let revision = 0;
      let historyRevision = 0;
      let generated: Awaited<ReturnType<typeof invokeQuotationModel>>;
      try {
        generated = await (input.invokeModel ?? invokeQuotationModel)({
          role: 'child',
          maxChildRepairAttempts: 0,
          prompt: snapshot.prompts.child,
          input: JSON.stringify({
            chunk: chunk.markdown,
            customer: snapshot.customerMarkdown,
          }),
          modelOptions: input.modelOptions,
          signal: controller.signal,
          assertActive: async () => { await assertActive(); },
          onUsage: input.onUsage ? (usage) => operational(() => input.onUsage!(usage)) : undefined,
          onChildMessages: async (messages) => {
            await checkpoint(`child-history:${chunk.chunkIndex}:${attempt}:${historyRevision++}`, 'main', JSON.stringify(messages));
          },
          onChildRepair: async (repair) => {
            const active = await assertActive();
            const event = buildSteelQuotationStatusEvent({
              ...repair,
              conversationId: scope.conversationId,
              runId, index: active.index, status: active.status,
              ...getQuotationProgress(active),
              chunkIndex: chunk.chunkIndex, attempt,
            });
            await checkpoint(`repair:${chunk.chunkIndex}:${attempt}:${repair.repairAttempt}:${repair.stage}`, 'main', JSON.stringify(event));
            await operational(async () => input.onProgress?.({
              ...event, ...getQuotationProgress(active, chunk.chunkIndex, undefined, recoveryPath),
              stage: repair.stage, run: active,
            }));
          },
          validateChildOutput: async (markdown) => {
            await assertActive();
            const output = JSON.stringify({ markdown, lookupOperations, pythonOperations,
              sourceRowIds: chunk.sourceRows.map((row) => row.sourceRowId) });
            await checkpoint(`child-output:${chunk.chunkIndex}:${attempt}:${revision++}`, 'main', output);
            validateQuotationChildResult({ ...await loadChild(chunk, output), allowManualReviews: false });
          },
          onPythonEvidence: async (evidence) => {
            const key = `python:${chunk.chunkIndex}:${attempt}:${evidence.toolCallId}:${evidence.type}`;
            await checkpoint(key, 'tool', JSON.stringify(evidence));
            pythonOperations.push(key);
          },
          lookup: async (id, args) => {
            await assertActive();
            await operational(async () => input.onTool?.({ run, id, chunkIndex: chunk.chunkIndex, attempt, arguments: args }));
            const result = input.executeLookup
              ? await input.executeLookup(args, id)
              : await executeSteelTool({
                client: pool ??= createSteelPostgresPool(),
                toolName: 'search_price_candidates',
                arguments: args,
                providerToolCallId: id,
                runState: toolState,
              });
            await assertActive();
            const key = `lookup:${chunk.chunkIndex}:${attempt}:${id}`;
            await checkpoint(key, 'tool', JSON.stringify({ lookupCallId: id, arguments: args, result }));
            lookupOperations.push(key);
            await operational(async () => input.onTool?.({ run, id, chunkIndex: chunk.chunkIndex, attempt, arguments: args, result }));
            return result;
          },
        });
      } catch (error) {
        await assertActive();
        throw new QuotationChildFailure(error instanceof QuotationProtocolError
          ? '報價表格不完整或格式無效' : '報價子 Agent 執行失敗');
      }
      const sourceRowIds = chunk.sourceRows.map((row) => row.sourceRowId);
      let stored = JSON.stringify({ markdown: generated.markdown, lookupOperations, pythonOperations, sourceRowIds });
      await checkpoint(`child-output:${chunk.chunkIndex}:${attempt}`, 'main', stored);
      const candidate = await loadChild(chunk, stored);
      let validated: ReturnType<typeof validateQuotationChildResult>;
      try {
        validated = validateQuotationChildResult({ ...candidate, allowManualReviews: false });
      } catch (error) {
        if (!(error instanceof QuotationProtocolError)) throw error;
        throw new QuotationChildFailure('報價表格不完整或格式無效');
      }
      stored = JSON.stringify({ markdown: validated.markdown, lookupOperations, pythonOperations, sourceRowIds });
      return stored;
    }

    async function loadChild(
      chunk: ReturnType<typeof buildQuotationChunks>[number],
      serialized: string,
    ): Promise<LoadedQuotationChild> {
      try {
        const saved = JSON.parse(serialized) as SavedQuotationChild;
        if (saved.sourceRowIds && JSON.stringify(saved.sourceRowIds) !==
          JSON.stringify(chunk.sourceRows.map((row) => row.sourceRowId))) {
          throw new Error('Saved quotation chunk does not match its source rows');
        }
        const lookupEvidence: QuotationLookupEvidence[] = [];
        for (const key of saved.lookupOperations) {
          const evidence = await readCheckpoint(key);
          if (!evidence) throw new Error('Quotation lookup evidence is missing');
          const lookup = JSON.parse(evidence) as SavedQuotationLookup;
          if (lookup.result.toolName !== 'search_price_candidates') {
            throw new Error('Quotation lookup evidence is for an unauthorized tool');
          }
          lookupEvidence.push({ lookupCallId: lookup.lookupCallId, persisted: true, result: lookup.result });
        }
        const pythonEvidence: QuotationPythonEvidence[] = [];
        for (const key of saved.pythonOperations) {
          const payload = await readCheckpoint(key);
          if (!payload) throw new Error('Quotation Python evidence is missing');
          const parsed = JSON.parse(payload) as QuotationPythonEvidence;
          pythonEvidence.push(parsed);
        }
        return {
          chunk,
          response: stripLegacyQuotationChildSidecars(saved.markdown),
          lookupEvidence,
          pythonEvidence,
          lookupOperations: saved.lookupOperations,
          pythonOperations: saved.pythonOperations,
          ...(saved.backendFailure ? { backendFailure: saved.backendFailure } : {}),
        };
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    }
  } catch (error) {
    const current = await service.readState(scope);
    if (current?.activeRun?.runId === runId && current.activeRun.status === 'cancelled') {
      await input.onProgress?.({ run: current.activeRun, ...getQuotationProgress(current.activeRun) });
      return { status: 'cancelled' };
    }
    const interrupted = await service.interruptRun({
      ...leaseInput,
      interruption: {
        reason: input.signal.aborted ? 'paused' : 'error',
        ...(interruptedChunkIndex !== undefined && { chunkIndex: interruptedChunkIndex }),
      },
    });
    if (interrupted) {
      try {
        await input.onProgress?.({ run: interrupted, ...getQuotationProgress(interrupted) });
      } catch {
        // The durable interrupted state remains authoritative if the stream has closed.
      }
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    input.signal.removeEventListener('abort', abort);
    registration.dispose();
  }
}
