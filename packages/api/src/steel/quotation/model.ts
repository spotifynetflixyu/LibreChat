import { HumanMessage, SystemMessage, ToolMessage } from '@librechat/agents/langchain/messages';

import type { AIMessageChunk, BaseMessage } from '@librechat/agents/langchain/messages';
import type { QuotationPythonEvidence } from './protocol';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';

import { createOpenAIOAuthModel } from '../native/oauth';
import { createSteelNativeTool, mergeSteelToolDefinitions } from '../native/tools';

export interface QuotationModelLookup {
  id: string;
  arguments: SteelToolJsonObject;
  result: SteelToolResult;
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

export async function invokeQuotationModel(input: QuotationModelInput): Promise<QuotationModelResult> {
  const child = input.role === 'child';
  const definitions = child
    ? mergeSteelToolDefinitions({ aiVisibleTools: ['search_price_candidates'] }).toolDefinitions
      .filter((tool) => tool.name === 'search_price_candidates')
    : [];
  const pythonEvidence: QuotationPythonEvidence[] = [];
  const lookups: QuotationModelLookup[] = [];
  const model = createOpenAIOAuthModel({
    ...input.modelOptions,
    enableCodeInterpreter: child,
    tools: definitions,
    onCodeInterpreterEvidence: child ? async (evidence) => {
      await input.assertActive();
      pythonEvidence.push(evidence);
      await input.onPythonEvidence?.(evidence);
    } : undefined,
  });
  const messages: BaseMessage[] = [
    new SystemMessage(input.prompt),
    new HumanMessage(input.input),
  ];
  for (let step = 0; step < 24; step += 1) {
    input.signal.throwIfAborted();
    await input.assertActive();
    const response = await model.invoke(messages, { signal: input.signal });
    await input.assertActive();
    if (response.usage_metadata) {
      await input.onUsage?.(response.usage_metadata);
    }
    const calls = response.tool_calls ?? [];
    if (calls.length === 0) {
      if (response.response_metadata.finish_reason !== 'stop') {
        throw new Error('Quotation model did not complete its output');
      }
      if (child && lookups.length === 0) {
        throw new Error('Quotation chunk requires a search_price_candidates attempt');
      }
      return { markdown: quotationMessageText(response), lookups, pythonEvidence };
    }
    if (!child || !input.lookup) {
      throw new Error('Quotation main model cannot execute tools');
    }
    messages.push(response);
    for (const call of calls) {
      if (call.name !== 'search_price_candidates' || !call.id) {
        throw new Error('Quotation child requested an unauthorized tool');
      }
      await input.assertActive();
      input.signal.throwIfAborted();
      const args = call.args as SteelToolJsonObject;
      const result = await input.lookup(call.id, args);
      await input.assertActive();
      lookups.push({ id: call.id, arguments: args, result });
      messages.push(new ToolMessage({
        name: call.name,
        tool_call_id: call.id,
        content: (await createSteelNativeTool({ nativeToolName: call.name, steelToolName: 'search_price_candidates', execute: async () => result }).invoke(args)).content,
      }));
    }
  }
  throw new Error('Quotation chunk exceeded the tool-step limit');
}
