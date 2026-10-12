import { ContentTypes, ToolCallTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import { getToolMeta } from '../outcome';

const toPart = (output: string): TMessageContentParts =>
  ({
    type: ContentTypes.TOOL_CALL,
    [ContentTypes.TOOL_CALL]: {
      id: 'call-1',
      type: ToolCallTypes.TOOL_CALL,
      name: 'slow_echo_mcp_e2e-memory',
      args: '{"delay_ms":10}',
      output,
      runStepStatus: 'completed',
    },
  }) as unknown as TMessageContentParts;

describe('getToolMeta persisted tool output', () => {
  it('classifies a failed JSON result envelope as failed', () => {
    const output = JSON.stringify({
      status: 'fail',
      error:
        'Error: Tool "slow_echo_mcp_e2e-memory" input failed schema validation. Missing required fields: text. Use this tool\'s declared arguments. Please fix your mistakes.',
    });

    expect(getToolMeta(toPart(output))).toEqual(expect.objectContaining({ failed: true }));
  });

  it('classifies a failed JSON envelope from errorMessage alone', () => {
    const output = JSON.stringify({
      status: 'fail',
      errorMessage:
        'Error: Tool "slow_echo_mcp_e2e-memory" input failed schema validation. Missing required fields: text. Use this tool\'s declared arguments. Please fix your mistakes.',
    });

    expect(getToolMeta(toPart(output))).toEqual(expect.objectContaining({ failed: true }));
  });

  it('keeps classifying a plain tool-call error as failed', () => {
    expect(getToolMeta(toPart('Error: tool call failed: request timed out'))).toEqual(
      expect.objectContaining({ failed: true }),
    );
  });

  it('does not classify a successful JSON result envelope as failed', () => {
    expect(getToolMeta(toPart('{"status":"success","result":"ok"}'))).toEqual(
      expect.objectContaining({ failed: false }),
    );
  });

  it('does not classify ambiguous JSON data as failed', () => {
    expect(getToolMeta(toPart('{"status":"fail","result":"validation details"}'))).toEqual(
      expect.objectContaining({ failed: false }),
    );
  });

  it('requires the normal error semantics even when a success envelope has an error field', () => {
    expect(
      getToolMeta(
        toPart('{"status":"success","error":"Error: tool call failed: stale result"}'),
      ),
    ).toEqual(expect.objectContaining({ failed: false }));
  });
});
