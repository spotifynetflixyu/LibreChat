import { buildAgentAdditionalInstructions, buildAgentInstructions } from '../../agents/context';

import type { SteelNativeGlobalAgentContext } from './context';

export interface SteelNativeMutableAgentConfig {
  id?: string;
  instructions?: string;
  additional_instructions?: string;
  [key: string]: unknown;
}

export interface ApplySteelNativeGlobalContextInput {
  agent: SteelNativeMutableAgentConfig;
  context: Pick<SteelNativeGlobalAgentContext, 'instructionPrefix' | 'runtimeContextText'>;
}

export interface ApplySteelNativeGlobalContextToAgentsInput {
  agents: Iterable<SteelNativeMutableAgentConfig>;
  context: Pick<SteelNativeGlobalAgentContext, 'instructionPrefix' | 'runtimeContextText'>;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function applySteelNativeGlobalContextToAgentConfig({
  agent,
  context,
}: ApplySteelNativeGlobalContextInput): SteelNativeMutableAgentConfig {
  agent.instructions = buildAgentInstructions({
    globalInstructionPrefix: trimOrUndefined(context.instructionPrefix),
    baseInstructions: trimOrUndefined(agent.instructions),
  });
  agent.additional_instructions = buildAgentAdditionalInstructions({
    additionalInstructions: trimOrUndefined(agent.additional_instructions),
    sharedRunContext: trimOrUndefined(context.runtimeContextText),
  });

  return agent;
}

export function applySteelNativeGlobalContextToAgentConfigs({
  agents,
  context,
}: ApplySteelNativeGlobalContextToAgentsInput): SteelNativeMutableAgentConfig[] {
  return Array.from(agents, (agent) =>
    applySteelNativeGlobalContextToAgentConfig({ agent, context }),
  );
}
