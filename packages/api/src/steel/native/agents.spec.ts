import {
  applySteelNativeGlobalContextToAgentConfig,
  applySteelNativeGlobalContextToAgentConfigs,
} from './agents';

import type { SteelNativeMutableAgentConfig } from './agents';

describe('Steel native agent context helpers', () => {
  it('prepends Steel instructions and appends Steel runtime context', () => {
    const agent = {
      id: 'agent-1',
      instructions: 'Base instructions',
      additional_instructions: 'Existing dynamic context',
    };

    applySteelNativeGlobalContextToAgentConfig({
      agent,
      context: {
        instructionPrefix: 'Steel global prefix',
        runtimeContextText: 'Steel runtime tail',
      },
    });

    expect(agent.instructions).toBe('Steel global prefix\n\nBase instructions');
    expect(agent.additional_instructions).toBe(
      'Existing dynamic context\n\nSteel runtime tail',
    );
  });

  it('applies the same Steel context to every initialized run agent', () => {
    const primary: SteelNativeMutableAgentConfig = {
      id: 'primary',
      instructions: 'Primary',
    };
    const handoff: SteelNativeMutableAgentConfig = {
      id: 'handoff',
      additional_instructions: 'Handoff dynamic',
    };

    const updated = applySteelNativeGlobalContextToAgentConfigs({
      agents: [primary, handoff],
      context: {
        instructionPrefix: 'Steel prefix',
        runtimeContextText: 'Steel runtime',
      },
    });

    expect(updated).toEqual([primary, handoff]);
    expect(primary.instructions).toBe('Steel prefix\n\nPrimary');
    expect(primary.additional_instructions).toBe('Steel runtime');
    expect(handoff.instructions).toBe('Steel prefix');
    expect(handoff.additional_instructions).toBe('Handoff dynamic\n\nSteel runtime');
  });
});
