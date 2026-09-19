import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from '@librechat/agents/langchain/messages';

import type { AIMessageChunk, BaseMessage, StoredMessage } from '@librechat/agents/langchain/messages';
import type { QuotationPythonEvidence } from './protocol';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';

import { createOpenAIOAuthModel } from '../native/oauth';
import { createSteelNativeTool, mergeSteelToolDefinitions } from '../native/tools';
import { QuotationProtocolError } from './protocol';

export interface QuotationModelLookup {
  id: string;
  arguments: SteelToolJsonObject;
  result: SteelToolResult;
}

export interface QuotationRepairProgress {
  stage: 'chunk_repair_started' | 'chunk_repair_succeeded' | 'chunk_repair_failed';
  repairAttempt: number;
  maxRepairAttempts: number;
  message?: string;
}

export interface QuotationModelInput {
  role: 'child' | 'main' | 'preparation';
  prompt: string;
  input: string;
  modelOptions: OpenAIOAuthModelOptions;
  signal: AbortSignal;
  assertActive(): Promise<void>;
  lookup?(id: string, arguments_: SteelToolJsonObject): Promise<SteelToolResult>;
  onPythonEvidence?(evidence: QuotationPythonEvidence): Promise<void>;
  onUsage?(usage: NonNullable<AIMessageChunk['usage_metadata']>): Promise<void>;
  onTextDelta?(text: string): Promise<void>;
  validateChildOutput?(markdown: string): Promise<void>;
  onChildMessages?(messages: StoredMessage[]): Promise<void>;
  onChildRepair?(progress: QuotationRepairProgress): Promise<void>;
  maxChildRepairAttempts?: 0 | 1;
}

const quotationChildSystemContract = [
  'Quotation child output contract (this instruction overrides earlier or frozen output instructions):',
  '- Return exactly one complete 16-column ## system_order_chunk Markdown table.',
  '- Keep every required material and processing row; put any issue or missing-value explanation in the row 備註 cell.',
  '- Do not emit manual_reviews_chunk, system_order, customer_quote, quote_summary, control JSON, or prose outside the table.',
].join('\n');

const quotationMainSystemContract = [
  'Quotation main review contract (this instruction overrides earlier or frozen output instructions):',
  '- The supplied system_order is the quotation table to review. Never reproduce, rewrite, shorten, or refuse based on its length.',
  '- Return one six-column ## manual_reviews Markdown table for actual issues. Optional ## notes must follow manual_reviews. If there are no issues and no notes, return exactly: 無待複核事項。',
  '- Do not return system_order, customer_quote, or quote_summary.',
].join('\n');

function quotationRuntimePrompt(role: QuotationModelInput['role'], prompt: string): string {
  if (role === 'child') return `${prompt}\n\n${quotationChildSystemContract}`;
  if (role === 'main') return `${prompt}\n\n${quotationMainSystemContract}`;
  return prompt;
}

export interface QuotationModelResult {
  markdown: string;
  lookups: QuotationModelLookup[];
  pythonEvidence: QuotationPythonEvidence[];
}

export function quotationMessageText(message: Pick<BaseMessage, 'content'>): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content.map((part) => typeof part === 'string'
    ? part
    : part.type === 'text' && typeof part.text === 'string' ? part.text : '').join('');
}

/** Keep raw transcripts intact; do not replay leaked model delimiters as conversation syntax. */
function childProviderMessages(messages: BaseMessage[]): BaseMessage[] {
  return messages.flatMap((message) => {
    if (message.getType() !== 'ai') return [message];
    const toolCalls = (message as AIMessage).tool_calls ?? [];
    if (toolCalls.length === 0) {
      return [];
    }
    const stored = mapChatMessagesToStoredMessages([message])[0]!;
    return mapStoredMessagesToChatMessages([{ ...stored, data: {
      ...stored.data,
      content: '',
    } }])[0]!;
  });
}

export async function invokeQuotationModel(input: QuotationModelInput): Promise<QuotationModelResult> {
  const child = input.role === 'child';
  const runtimePrompt = quotationRuntimePrompt(input.role, input.prompt);
  const enablePython = child || input.role === 'main';
  const maxChildRepairAttempts = input.maxChildRepairAttempts ?? 1;
  const definitions = child
    ? mergeSteelToolDefinitions({ aiVisibleTools: ['search_price_candidates'] }).toolDefinitions
      .filter((tool) => tool.name === 'search_price_candidates')
    : [];
  const pythonEvidence: QuotationPythonEvidence[] = [];
  const lookups: QuotationModelLookup[] = [];
  const model = createOpenAIOAuthModel({
    ...input.modelOptions,
    enableCodeInterpreter: enablePython,
    tools: definitions,
    onCodeInterpreterEvidence: enablePython ? async (evidence) => {
      await input.assertActive();
      pythonEvidence.push(evidence);
      await input.onPythonEvidence?.(evidence);
    } : undefined,
  });
  const messages: BaseMessage[] = [new SystemMessage(runtimePrompt), new HumanMessage(input.input)];
  let providerMessages: BaseMessage[] = [...messages];
  const persistMessages = async () => {
    if (child && input.onChildMessages) {
      await input.assertActive();
      await input.onChildMessages(mapChatMessagesToStoredMessages(messages));
    }
  };
  const lookupMessage = async (lookup: QuotationModelLookup) => new ToolMessage({
    name: 'search_price_candidates',
    tool_call_id: lookup.id,
    content: (await createSteelNativeTool({
      nativeToolName: 'search_price_candidates',
      steelToolName: 'search_price_candidates',
      execute: async () => lookup.result,
    }).invoke(lookup.arguments)).content,
  });
  let lookupBaseline = 0;
  const freshLookupCompleted = () => {
    const callIds = new Set(providerMessages.slice(2).flatMap((message) =>
      message.getType() === 'ai' ? ((message as AIMessage).tool_calls ?? []).map((call) => call.id) : []));
    return lookups.slice(lookupBaseline).some((lookup) => callIds.has(lookup.id));
  };
  let repairs = 0;
  for (let step = 0; step < 24; step += 1) {
    input.signal.throwIfAborted();
    await input.assertActive();
    let response: AIMessageChunk;
    if (input.role === 'main' && input.onTextDelta) {
      let combined: AIMessageChunk | undefined;
      let lastActiveCheck = Date.now();
      const stream = await model.stream(messages, { signal: input.signal });
      for await (const part of stream) {
        input.signal.throwIfAborted();
        combined = combined ? combined.concat(part) : part;
        if (combined.tool_calls?.length || combined.tool_call_chunks?.length) {
          throw new Error('Quotation main model cannot execute tools');
        }
        const text = quotationMessageText(part);
        if (text) {
          if (Date.now() - lastActiveCheck >= 3000) {
            await input.assertActive();
            lastActiveCheck = Date.now();
          }
          input.signal.throwIfAborted();
          await input.onTextDelta(text);
        }
      }
      input.signal.throwIfAborted();
      if (!combined) throw new Error('Quotation model did not complete its output');
      await input.assertActive();
      response = combined;
    } else {
      const invokeConfig = child
        ? {
          signal: input.signal,
          toolChoice: freshLookupCompleted()
            ? { type: 'auto' as const }
            : { type: 'tool' as const, toolName: 'search_price_candidates' },
        }
        : { signal: input.signal };
      response = await model.invoke(child ? childProviderMessages(providerMessages) : [...providerMessages], invokeConfig);
    }
    await input.assertActive();
    if (response.usage_metadata) {
      await input.onUsage?.(response.usage_metadata);
    }
    const calls = response.tool_calls ?? [];
    if (child) {
      messages.push(response);
      await persistMessages();
    }
    if (calls.length > 0) providerMessages.push(response);
    if (calls.length === 0) {
      const finishReason = response.response_metadata.finish_reason;
      if (finishReason !== 'stop' && !(child && finishReason === 'length')) {
        throw new Error('Quotation model did not complete its output');
      }
      const markdown = quotationMessageText(response);
      if (child) {
        try {
          await input.validateChildOutput?.(markdown);
          if (!freshLookupCompleted()) {
            throw new QuotationProtocolError('invalid_child_result', 'This quotation attempt requires a search_price_candidates result before completion.');
          }
          if (finishReason === 'length') {
            throw new QuotationProtocolError('invalid_child_result', 'Quotation child output was truncated by the output limit.');
          }
          if (lookups.length === 0) {
            throw new QuotationProtocolError('invalid_child_result', 'Quotation chunk requires a search_price_candidates attempt');
          }
        } catch (error) {
          input.signal.throwIfAborted();
          if (!(error instanceof QuotationProtocolError) || error.code !== 'invalid_child_result') {
            throw error;
          }
          await input.assertActive();
          if (repairs >= maxChildRepairAttempts) {
            if (maxChildRepairAttempts > 0) {
              await input.onChildRepair?.({ stage: 'chunk_repair_failed', repairAttempt: repairs,
                maxRepairAttempts: maxChildRepairAttempts, message: error.message });
            }
            throw error;
          }
          repairs += 1;
          lookupBaseline = lookups.length;
          providerMessages = [new SystemMessage(runtimePrompt), new HumanMessage(input.input)];
          await persistMessages();
          await input.onChildRepair?.({ stage: 'chunk_repair_started', repairAttempt: repairs,
            maxRepairAttempts: maxChildRepairAttempts, message: error.message });
          continue;
        }
        if (repairs > 0) {
          await input.onChildRepair?.({ stage: 'chunk_repair_succeeded', repairAttempt: repairs,
            maxRepairAttempts: maxChildRepairAttempts });
        }
      }
      return { markdown, lookups, pythonEvidence };
    }
    if (!child || !input.lookup) {
      throw new Error('Quotation main model cannot execute tools');
    }
    for (const call of calls) {
      if (call.name !== 'search_price_candidates' || !call.id) {
        throw new Error('Quotation child requested an unauthorized tool');
      }
      await input.assertActive();
      input.signal.throwIfAborted();
      const args = call.args as SteelToolJsonObject;
      const result = await input.lookup(call.id, args);
      await input.assertActive();
      const lookup = { id: call.id, arguments: args, result };
      lookups.push(lookup);
      const toolMessage = await lookupMessage(lookup);
      messages.push(toolMessage);
      providerMessages.push(toolMessage);
      await persistMessages();
    }
  }
  throw new Error('Quotation chunk exceeded the tool-step limit');
}
