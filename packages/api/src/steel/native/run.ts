import { resolveLocalToolsForBinding } from '@librechat/agents';
import type { AgentInputs } from '@librechat/agents';
import type { BaseMessage } from '@librechat/agents/langchain/messages';
import type { OpenAIReasoningEffort } from '../ai/config';
import { parseOpenAIConfig, resolveOpenAIOAuthAuthFilePath } from '../ai/config';
import { delegateOcrToolName, normalizeDelegateOcrChunk } from './delegate';
import { createOpenAIOAuthGraphModel } from './oauth';

interface OpenAIOAuthAgentIdentity {
  endpoint?: string | null;
  provider?: string | null;
}

const openAIOAuthProvider = 'openai_oauth_responses';

export function getLatestHumanMessageText(messages?: BaseMessage[]): string {
  const latestHumanMessage = [...(messages ?? [])]
    .reverse()
    .find((message) => (message.getType?.() ?? message._getType?.()) === 'human');
  return normalizeDelegateOcrChunk(latestHumanMessage?.content);
}

type OpenAIOAuthGraph = {
  agentContexts?: Map<
    string,
    {
      systemRunnable?: ReturnType<
        NonNullable<Parameters<typeof createOpenAIOAuthGraphModel>[0]['getSystemRunnable']>
      >;
      getToolsForBinding?: () => Parameters<typeof resolveLocalToolsForBinding>[0]['tools'];
    }
  >;
  overrideModel?: unknown;
  toolExecution?: Parameters<typeof resolveLocalToolsForBinding>[0]['toolExecution'];
};

export function isOpenAIOAuthAgent(agent: OpenAIOAuthAgentIdentity | undefined): boolean {
  return agent?.provider === openAIOAuthProvider || agent?.endpoint === openAIOAuthProvider;
}

function getRecordValue(record: Record<string, unknown> | undefined, key: string): unknown {
  return record ? record[key] : undefined;
}

function getStringValue(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = getRecordValue(record, key);
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function getRecordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = getRecordValue(record, key);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getOpenAIOAuthReasoningEffort(
  clientOptions: Record<string, unknown> | undefined,
): string | undefined {
  const modelKwargs = getRecordField(clientOptions, 'modelKwargs');
  const reasoning = getRecordField(clientOptions, 'reasoning');
  const modelKwargsReasoning = getRecordField(modelKwargs, 'reasoning');

  return (
    getStringValue(clientOptions, 'reasoningEffort') ??
    getStringValue(clientOptions, 'reasoning_effort') ??
    getStringValue(reasoning, 'effort') ??
    getStringValue(modelKwargs, 'reasoning_effort') ??
    getStringValue(modelKwargsReasoning, 'effort')
  );
}

function getNumberValue(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = getRecordValue(record, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBooleanValue(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = getRecordValue(record, key);
  return typeof value === 'boolean' ? value : undefined;
}

export function getOpenAIOAuthModelOptions(
  agentInput: AgentInputs,
  reasoningEffortOverride?: OpenAIReasoningEffort,
) {
  const clientOptions = agentInput.clientOptions as Record<string, unknown> | undefined;
  const openAIConfig = parseOpenAIConfig(process.env);
  const model = getStringValue(clientOptions, 'model') ?? openAIConfig.model;

  return {
    authFilePath:
      getStringValue(clientOptions, 'authFilePath') ?? resolveOpenAIOAuthAuthFilePath(process.env),
    ensureFresh: getBooleanValue(clientOptions, 'ensureFresh'),
    frequencyPenalty: getNumberValue(clientOptions, 'frequencyPenalty'),
    maxOutputTokens:
      getNumberValue(clientOptions, 'maxOutputTokens') ??
      getNumberValue(clientOptions, 'maxTokens') ??
      getNumberValue(clientOptions, 'maxCompletionTokens'),
    model,
    presencePenalty: getNumberValue(clientOptions, 'presencePenalty'),
    reasoningEffort:
      reasoningEffortOverride ??
      getOpenAIOAuthReasoningEffort(clientOptions) ??
      openAIConfig.reasoningEffort,
    topP: getNumberValue(clientOptions, 'topP'),
  };
}

export function applyOpenAIOAuthGraphOverride({
  agentInput,
  quotationPreparation,
  openAIOAuthReasoningEffortOverride,
  run,
  sourceAgent,
}: {
  agentInput?: AgentInputs;
  quotationPreparation?: boolean;
  openAIOAuthReasoningEffortOverride?: OpenAIReasoningEffort;
  run: unknown;
  sourceAgent?: OpenAIOAuthAgentIdentity;
}): void {
  if (!agentInput || !isOpenAIOAuthAgent(sourceAgent)) {
    return;
  }

  const graph = (run as { Graph?: OpenAIOAuthGraph }).Graph;
  if (!graph) {
    return;
  }

  const agentId = agentInput.agentId;
  graph.overrideModel = createOpenAIOAuthGraphModel({
    modelOptions: {
      ...getOpenAIOAuthModelOptions(agentInput, openAIOAuthReasoningEffortOverride),
      quotationPreparation,
    },
    terminalToolNames: [delegateOcrToolName],
    getSystemRunnable: () => graph.agentContexts?.get(agentId)?.systemRunnable,
    getTools: () =>
      resolveLocalToolsForBinding({
        tools: graph.agentContexts?.get(agentId)?.getToolsForBinding?.(),
        toolExecution: graph.toolExecution,
      }),
  });
}
