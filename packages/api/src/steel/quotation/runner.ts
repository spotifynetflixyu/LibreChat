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
import type { QuotationModelInput } from './model';

import { createSteelQuotationStateService } from './state';
import { registerQuotationExecution } from './control';
import { buildDefaultSteelGlobalAgentContext } from '../native/context';
import { createSteelPostgresPool } from '../postgres';
import { executeSteelTool, createSteelToolRunState } from '../tools/execute';
import { invokeQuotationModel } from './model';
import {
  buildQuotationChunks,
  extractCustomerDataTable,
  parseQuotationSignal,
  validateQuotationChildResult,
  finalizeQuotationMainResponse,
} from './protocol';

interface SavedQuotationChild {
  markdown: string;
  lookupOperations: string[];
  pythonOperations: string[];
}

interface SavedQuotationLookup {
  lookupCallId: string;
  arguments: SteelToolJsonObject;
  result: SteelToolResult;
}

export interface QuotationProgress {
  run: SteelQuotationActiveRun;
  completedChunks: number;
  totalChunks: number;
  chunkIndex?: number;
  attempt?: string;
}

export interface QuotationRunnerInput {
  scope: SteelQuotationScope;
  modelOptions: OpenAIOAuthModelOptions;
  signal: AbortSignal;
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
  invokeModel?: typeof invokeQuotationModel;
  executeLookup?: (args: SteelToolJsonObject, callId: string) => Promise<SteelToolResult>;
}

let pool: ReturnType<typeof createSteelPostgresPool> | undefined;

export async function acceptQuotationResponse(input: {
  scope: SteelQuotationScope;
  response: string;
  responseId: string;
  finishReason?: string;
}): Promise<SteelQuotationActiveRun | undefined> {
  if (input.finishReason !== 'stop') return undefined;
  const signal = parseQuotationSignal(input.response);
  if (!signal) return undefined;
  if (/^##\s+ocr_result\s*$/mu.test(input.response)) {
    throw new Error('A revised order must be confirmed before issuing a quotation signal');
  }
  const service = createSteelQuotationStateService(mongoose);
  const state = await service.readState(input.scope);
  const ticket = state?.tickets.find((entry) => entry.index === signal.index && entry.token === signal.token);
  const customer = extractCustomerDataTable(input.response);
  if (!ticket || !state?.currentOrder || !customer ||
    JSON.stringify(customer) !== JSON.stringify(extractCustomerDataTable(ticket.customerMarkdown))) {
    throw new Error('Quotation signal does not match the saved order and customer');
  }
  const chunks = buildQuotationChunks(state.currentOrder.markdown);
  const conversation = { requestId: input.responseId, conversationId: input.scope.conversationId, activeHistory: [] };
  const [child, main] = await Promise.all([
    buildDefaultSteelGlobalAgentContext({ conversation, mode: 'quote_child' }),
    buildDefaultSteelGlobalAgentContext({ conversation, mode: 'quote_main' }),
  ]);
  return service.acceptSignal({
    scope: input.scope,
    index: signal.index,
    token: signal.token,
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
  const progress = async (chunkIndex?: number, attempt?: string) => {
    const active = await assertActive();
    await input.onProgress?.({
      run: active,
      completedChunks: active.chunks.filter((entry) => entry.status === 'completed').length,
      totalChunks: active.chunks.length,
      chunkIndex,
      attempt,
    });
  };
  const checkpoint = async (operationId: string, kind: 'chunk' | 'tool' | 'main' | 'final', payload: string, chunkIndex?: number) => {
    const saved = await service.checkpoint({ ...leaseInput, operationId, kind, payload, chunkIndex });
    if (!saved) throw new Error('Quotation checkpoint lost its execution lease');
  };
  try {
    const payload = await service.readArtifact({ scope, ref: run.snapshotRef });
    if (!payload) throw new Error('Quotation input snapshot is missing');
    const snapshot = JSON.parse(payload) as SteelQuotationSnapshotPayload;
    const chunks = buildQuotationChunks(snapshot.orderMarkdown);
    const results: QuotationChildResultInput[] = [];
    await progress();
    for (const chunk of chunks) {
      const operationId = `chunk:${chunk.chunkIndex}`;
      let stored = await service.readCheckpoint({ scope, runId, operationId });
      if (!stored) {
        const attempt = randomUUID();
        await progress(chunk.chunkIndex, attempt);
        const lookupOperations: string[] = [];
        const pythonOperations: string[] = [];
        const toolState = createSteelToolRunState(120);
        const generated = await (input.invokeModel ?? invokeQuotationModel)({
          role: 'child',
          prompt: snapshot.prompts.child,
          input: JSON.stringify({ chunk, customer: snapshot.customerMarkdown, categoryRows: chunks.filter((item) => item.category === chunk.category).flatMap((item) => item.sourceRows) }),
          modelOptions: input.modelOptions,
          signal: controller.signal,
          assertActive: async () => { await assertActive(); },
          onUsage: input.onUsage,
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
        validateQuotationChildResult(candidate);
        await checkpoint(operationId, 'chunk', stored, chunk.chunkIndex);
      }
      results.push(await loadChild(chunk, stored));
      await progress(chunk.chunkIndex);
    }
    await service.transitionRun({ ...leaseInput, status: 'aggregating' });
    await progress();
    let main = await service.readCheckpoint({ scope, runId, operationId: 'main' });
    if (!main) {
      const output = await (input.invokeModel ?? invokeQuotationModel)({
        role: 'main',
        prompt: snapshot.prompts.main,
        input: JSON.stringify({ order: snapshot.orderMarkdown, customer: snapshot.customerMarkdown, chunks: results.map((result) => ({ chunkIndex: result.chunk.chunkIndex, markdown: result.response })) }),
        modelOptions: input.modelOptions,
        signal: controller.signal,
        assertActive: async () => { await assertActive(); },
        onUsage: input.onUsage,
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

    async function loadChild(chunk: ReturnType<typeof buildQuotationChunks>[number], serialized: string): Promise<QuotationChildResultInput> {
      const saved = JSON.parse(serialized) as SavedQuotationChild;
      const lookupEvidence: QuotationLookupEvidence[] = [];
      for (const key of saved.lookupOperations) {
        const evidence = await service.readCheckpoint({ scope, runId, operationId: key });
        if (!evidence) throw new Error('Quotation lookup evidence is missing');
        const lookup = JSON.parse(evidence) as SavedQuotationLookup;
        if (lookup.result.ok) lookupEvidence.push({ lookupCallId: lookup.lookupCallId, persisted: true, result: lookup.result });
      }
      if (lookupEvidence.length === 0) throw new Error('Quotation has no persisted successful lookup');
      const pythonEvidence: QuotationPythonEvidence[] = [];
      for (const key of saved.pythonOperations) {
        const payload = await service.readCheckpoint({ scope, runId, operationId: key });
        if (!payload) throw new Error('Quotation Python evidence is missing');
        pythonEvidence.push(JSON.parse(payload) as QuotationPythonEvidence);
      }
      const customer = extractCustomerDataTable(snapshot.customerMarkdown);
      const tier = customer?.rows[0]?.[customer.headers.indexOf('價格等級')];
      if (!tier || !/^[A-F]$/.test(tier)) throw new Error('Quotation customer tier is missing');
      return { chunk, response: saved.markdown, lookupEvidence, pythonEvidence, customerTier: tier as 'A' | 'B' | 'C' | 'D' | 'E' | 'F' };
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
