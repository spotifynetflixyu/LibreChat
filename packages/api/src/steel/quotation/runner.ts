import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import type {
  SteelQuotationActiveRun,
  SteelQuotationScope,
  SteelQuotationSnapshotPayload,
} from '@librechat/data-schemas';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';
import type { QuotationChildResultInput, QuotationLookupEvidence, QuotationPythonEvidence } from './protocol';
import type { QuotationChildContinuation, QuotationModelInput, QuotationRepairProgress } from './model';
import type { SteelNativeHistory } from '../native/events';
import type { SavedQuotationLookup } from './history';

import { createSteelQuotationStateService } from './state';
import { defaultQuotationCustomerMarkdown, hasQuotationOrder } from './preparation';
import { parseAssistantMarkdown } from '../ocr/result';
import { registerQuotationExecution } from './control';
import { buildDefaultSteelGlobalAgentContext } from '../native/context';
import { createSteelPostgresPool } from '../postgres';
import { executeSteelTool, createSteelToolRunState } from '../tools/execute';
import { invokeQuotationModel } from './model';
import { readQuotationHistory } from './history';
import { buildSteelQuotationStatusEvent } from '../native/events';
import {
  buildQuotationChunks,
  extractCustomerDataTable,
  parseQuotationSignal,
  stripLegacyQuotationChildSidecars,
  validateQuotationChildResult,
  finalizeQuotationMainResponse,
} from './protocol';

interface SavedQuotationChild {
  markdown: string;
  lookupOperations: string[];
  pythonOperations: string[];
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
  expectedOrderHash?: string;
  expectedCustomerPreparationId?: string;
  finishReason?: string;
}): Promise<SteelQuotationActiveRun | undefined> {
  if (input.finishReason !== 'stop') return undefined;
  const signal = parseQuotationSignal(input.response);
  const sections = parseAssistantMarkdown(input.response).sections;
  const hasSection = (title: string) => sections.some((section) => section.title.split(/[｜|]/u)[0]?.trim() === title);
  const customer = extractCustomerDataTable(input.response);
  if (!signal && !hasSection('customer_data')) return undefined;
  if (hasSection('customer_data') && !customer) {
    throw new Error('Customer data must contain one readable Markdown table');
  }
  if (signal && hasSection('ocr_result')) {
    throw new Error('A revised order must be confirmed before issuing a quotation signal');
  }
  const service = createSteelQuotationStateService(mongoose);
  let state = await service.readState(input.scope);
  const existingTicket = state?.tickets.find((entry) => entry.responseId === input.responseId);
  const matchesCustomer = (markdown: string) =>
    JSON.stringify(customer) === JSON.stringify(extractCustomerDataTable(markdown));
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
  const assertActive = async () => {
    controller.signal.throwIfAborted();
    const state = await service.readState(scope);
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
  const progress = async (chunkIndex?: number, attempt?: string, stage?: QuotationProgress['stage']) => {
    const active = await assertActive();
    await input.onProgress?.({
      run: active,
      completedChunks: active.chunks.filter((entry) => entry.status === 'completed').length,
      totalChunks: active.chunks.length,
      chunkIndex,
      attempt,
      ...(stage ? { stage } : {}),
    });
  };
  const checkpoint = async (operationId: string, kind: 'chunk' | 'tool' | 'main' | 'final', payload: string, chunkIndex?: number) => {
    const saved = await service.checkpoint({ ...leaseInput, operationId, kind, payload, chunkIndex });
    if (!saved) throw new Error('Quotation checkpoint lost its execution lease');
  };
  try {
    const running = await service.transitionRun({ ...leaseInput, status: 'running' });
    if (!running) throw new Error('Quotation could not start with its execution lease');
    const payload = await service.readArtifact({ scope, ref: run.snapshotRef });
    if (!payload) throw new Error('Quotation input snapshot is missing');
    const snapshot = JSON.parse(payload) as SteelQuotationSnapshotPayload;
    const chunks = buildQuotationChunks(snapshot.orderMarkdown);
    const results: QuotationChildResultInput[] = [];
    await progress(undefined, undefined, 'started');
    for (const chunk of chunks) {
      const operationId = `chunk:${chunk.chunkIndex}`;
      let stored = await service.readCheckpoint({ scope, runId, operationId });
      if (!stored) {
        const attempt = randomUUID();
        await progress(chunk.chunkIndex, attempt, 'chunk_started');
        const savedRefs = run.checkpointRefs;
        const lookupOperations = savedRefs.filter((ref) => ref.operationId.startsWith(`lookup:${chunk.chunkIndex}:`))
          .map((ref) => ref.operationId);
        const pythonOperations = savedRefs.filter((ref) => ref.operationId.startsWith(`python:${chunk.chunkIndex}:`))
          .map((ref) => ref.operationId);
        const outputRefs = savedRefs.filter((ref) => ref.operationId.startsWith(`child-output:${chunk.chunkIndex}:`));
        const historyRef = savedRefs.filter((ref) => ref.operationId.startsWith(`child-history:${chunk.chunkIndex}:`)).pop();
        let continuation: QuotationChildContinuation | undefined;
        if (historyRef || outputRefs.length || lookupOperations.length || pythonOperations.length) {
          const readSaved = async (key: string) => {
            const payload = await service.readCheckpoint({ scope, runId, operationId: key });
            if (!payload) throw new Error('Quotation continuation evidence is missing');
            return payload;
          };
          continuation = { previousOutputs: [], lookups: [], pythonEvidence: [] };
          for (const key of lookupOperations) {
            const lookup = JSON.parse(await readSaved(key)) as SavedQuotationLookup;
            if (lookup.result.toolName !== 'search_price_candidates' || !key.endsWith(`:${lookup.lookupCallId}`)) {
              throw new Error('Quotation continuation lookup is invalid');
            }
            continuation.lookups.push({ id: lookup.lookupCallId, arguments: lookup.arguments, result: lookup.result });
          }
          for (const key of pythonOperations) {
            continuation.pythonEvidence.push(JSON.parse(await readSaved(key)) as QuotationPythonEvidence);
          }
          if (historyRef) {
            const messages = JSON.parse(await readSaved(historyRef.operationId)) as unknown;
            if (!Array.isArray(messages) || messages.length < 2 ||
              messages.some((message) => !message || typeof message.type !== 'string' || !message.data)) {
              throw new Error('Saved quotation child conversation is invalid');
            }
            continuation.messages = messages;
          } else {
            for (const ref of outputRefs) {
              const saved = JSON.parse(await readSaved(ref.operationId)) as SavedQuotationChild;
              if (typeof saved.markdown !== 'string') throw new Error('Saved quotation child output is invalid');
              if (!continuation.previousOutputs.includes(saved.markdown)) continuation.previousOutputs.push(saved.markdown);
            }
          }
        }
        const toolState = createSteelToolRunState(120);
        let revision = 0;
        let historyRevision = 0;
        const generated = await (input.invokeModel ?? invokeQuotationModel)({
          role: 'child',
          childContextKey: `${runId}:${chunk.chunkIndex}`,
          prompt: snapshot.prompts.child,
          input: JSON.stringify({
            chunk: chunk.markdown,
            customer: snapshot.customerMarkdown,
          }),
          modelOptions: input.modelOptions,
          signal: controller.signal,
          assertActive: async () => { await assertActive(); },
          onUsage: input.onUsage,
          continuation,
          onChildMessages: async (messages) => {
            await checkpoint(`child-history:${chunk.chunkIndex}:${attempt}:${historyRevision++}`, 'main', JSON.stringify(messages));
          },
          onChildRepair: async (repair) => {
            const active = await assertActive();
            const event = buildSteelQuotationStatusEvent({
              ...repair,
              conversationId: scope.conversationId,
              runId, index: active.index, status: active.status,
              completedChunks: active.chunks.filter((entry) => entry.status === 'completed').length,
              totalChunks: active.chunks.length,
              chunkIndex: chunk.chunkIndex, attempt,
            });
            await checkpoint(`repair:${chunk.chunkIndex}:${attempt}:${repair.repairAttempt}:${repair.stage}`, 'main', JSON.stringify(event));
            await input.onProgress?.({ ...event, stage: repair.stage, run: active });
          },
          validateChildOutput: async (markdown) => {
            await assertActive();
            const output = JSON.stringify({ markdown, lookupOperations, pythonOperations });
            await checkpoint(`child-output:${chunk.chunkIndex}:${attempt}:${revision++}`, 'main', output);
            validateQuotationChildResult(await loadChild(chunk, output));
          },
          onPythonEvidence: async (evidence) => {
            const key = `python:${chunk.chunkIndex}:${attempt}:${evidence.toolCallId}:${evidence.type}`;
            await checkpoint(key, 'tool', JSON.stringify(evidence));
            pythonOperations.push(key);
          },
          lookup: async (id, args) => {
            await assertActive();
            await input.onTool?.({ run, id, chunkIndex: chunk.chunkIndex, attempt, arguments: args });
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
            await input.onTool?.({ run, id, chunkIndex: chunk.chunkIndex, attempt, arguments: args, result });
            return result;
          },
        });
        stored = JSON.stringify({ markdown: generated.markdown, lookupOperations, pythonOperations });
        await checkpoint(`child-output:${chunk.chunkIndex}:${attempt}`, 'main', stored);
        const candidate = await loadChild(chunk, stored);
        const validated = validateQuotationChildResult(candidate);
        stored = JSON.stringify({ markdown: validated.markdown, lookupOperations, pythonOperations });
        await checkpoint(operationId, 'chunk', stored, chunk.chunkIndex);
      }
      const loaded = await loadChild(chunk, stored);
      const validated = validateQuotationChildResult(loaded);
      results.push({
        ...loaded,
        response: validated.markdown,
        markdown: validated.markdown,
      });
      await progress(chunk.chunkIndex, undefined, 'chunk_saved');
    }
    await service.transitionRun({ ...leaseInput, status: 'aggregating' });
    await progress();
    let main = await service.readCheckpoint({ scope, runId, operationId: 'main' });
    if (!main) {
      let mainStreaming = false;
      const mainAttempt = randomUUID();
      const output = await (input.invokeModel ?? invokeQuotationModel)({
        role: 'main',
        prompt: snapshot.prompts.main,
        input: JSON.stringify({
          order: snapshot.orderMarkdown,
          customer: snapshot.customerMarkdown,
          chunks: results.map((result) => result.response ?? result.markdown ?? ''),
        }),
        modelOptions: input.modelOptions,
        signal: controller.signal,
        assertActive: async () => { await assertActive(); },
        onUsage: input.onUsage,
        onPythonEvidence: async (evidence) => {
          await assertActive();
          await checkpoint(`python:main:${mainAttempt}:${evidence.toolCallId}:${evidence.type}`, 'tool', JSON.stringify(evidence));
        },
        onTextDelta: input.onTextDelta ? async (text) => {
          controller.signal.throwIfAborted();
          if (!mainStreaming) {
            mainStreaming = true;
            await progress(undefined, undefined, 'main_streaming');
          }
          await input.onTextDelta?.(text);
        } : undefined,
      });
      main = output.markdown;
      await checkpoint(`main-output:${randomUUID()}`, 'main', main);
      finalizeQuotationMainResponse({ fullOcrResult: snapshot.orderMarkdown, mainResponse: main, childResults: results });
      await checkpoint('main', 'main', main);
    }
    await service.transitionRun({ ...leaseInput, status: 'finalizing' });
    await progress();
    const final = finalizeQuotationMainResponse({ fullOcrResult: snapshot.orderMarkdown, mainResponse: main, childResults: results });
    await checkpoint('final', 'final', final.response);
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
    await input.onProgress?.({ run: completed, completedChunks: chunks.length, totalChunks: chunks.length });
    return publish(final.response, completed);

    async function loadChild(
      chunk: ReturnType<typeof buildQuotationChunks>[number],
      serialized: string,
    ): Promise<QuotationChildResultInput> {
      const saved = JSON.parse(serialized) as SavedQuotationChild;
      const lookupEvidence: QuotationLookupEvidence[] = [];
      for (const key of saved.lookupOperations) {
        const evidence = await service.readCheckpoint({ scope, runId, operationId: key });
        if (!evidence) throw new Error('Quotation lookup evidence is missing');
        const lookup = JSON.parse(evidence) as SavedQuotationLookup;
        if (lookup.result.toolName !== 'search_price_candidates') {
          throw new Error('Quotation lookup evidence is for an unauthorized tool');
        }
        lookupEvidence.push({ lookupCallId: lookup.lookupCallId, persisted: true, result: lookup.result });
      }
      const pythonEvidence: QuotationPythonEvidence[] = [];
      for (const key of saved.pythonOperations) {
        const payload = await service.readCheckpoint({ scope, runId, operationId: key });
        if (!payload) throw new Error('Quotation Python evidence is missing');
        pythonEvidence.push(JSON.parse(payload) as QuotationPythonEvidence);
      }
      return {
        chunk,
        response: stripLegacyQuotationChildSidecars(saved.markdown),
        lookupEvidence,
        pythonEvidence,
      };
    }
  } catch (error) {
    const current = await service.readState(scope);
    if (current?.activeRun?.runId === runId && current.activeRun.status === 'cancelled') {
      await input.onProgress?.({ run: current.activeRun, completedChunks: current.activeRun.chunks.filter((chunk) => chunk.status === 'completed').length, totalChunks: current.activeRun.chunks.length });
      return { status: 'cancelled' };
    }
    const interrupted = await service.interruptRun(leaseInput);
    if (interrupted) {
      try {
        await input.onProgress?.({ run: interrupted, completedChunks: interrupted.chunks.filter((chunk) => chunk.status === 'completed').length, totalChunks: interrupted.chunks.length });
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
