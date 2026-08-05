const AgentClient = require('../client');

/** Minimal post-(maybe-)summary snapshot. baseUsed = maxContextTokens(1000) -
 *  remainingContextTokens(700) = 300, so the marker (summaryUsedTokens) is 300. */
const snapshot = (summaryTokens) => ({
  runId: 'run-1',
  agentId: 'agent-1',
  breakdown: {
    maxContextTokens: 1000,
    instructionTokens: 50,
    systemMessageTokens: 50,
    dynamicInstructionTokens: 0,
    toolSchemaTokens: 0,
    summaryTokens,
    toolCount: 0,
    toolTokenCounts: { search: 12 },
    messageCount: 1,
    messageTokens: 20,
    availableForMessages: 900,
  },
  contextBudget: 1000,
  remainingContextTokens: 700,
  prePruneContextTokens: 300,
  effectiveInstructionTokens: 50,
  calibrationRatio: 1,
});

const primary = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
const summarizationUsage = { ...primary, usage_type: 'summarization' };
const primaryFor = (runId, output_tokens) => ({
  input_tokens: 10,
  output_tokens,
  total_tokens: 10 + output_tokens,
  provider: 'openAI',
  runId,
});

function buildMeta({ snap, latestUsageIndex, usageEvents, chatCompletionAborted = false }) {
  const self = {
    collectedThoughtSignatures: null,
    chatCompletionAborted,
    usageEmitSink: usageEvents,
    contextUsageSink: snap
      ? { latest: snap, count: 1, latestUsageIndex }
      : { latest: null, count: 0 },
  };
  return AgentClient.prototype.buildResponseMetadata.call(self);
}

describe('AgentClient.buildResponseMetadata — snapshot persistence + summary marker', () => {
  it('persists the snapshot when a primary usage follows it (normal turn)', () => {
    const meta = buildMeta({ snap: snapshot(0), latestUsageIndex: 0, usageEvents: [primary] });
    expect(meta.contextUsage).toBeDefined();
    expect(meta.summaryUsedTokens).toBeUndefined();
  });

  it('persists the post-summary snapshot when the only pre-primary usage is the summarization', () => {
    /** A summarized turn: the summarization usage precedes the post-summary
     *  snapshot (index 1), then the model's primary usage follows it. The old
     *  count guard miscounted and dropped this; the new guard keeps it. The
     *  marker subtracts the summarization output (5): the generated summary is in
     *  the snapshot baseline (summaryTokens) AND the response tokenCount, so
     *  300 − 5 = 295 keeps the client estimate from counting it twice. */
    const meta = buildMeta({
      snap: snapshot(80),
      latestUsageIndex: 1,
      usageEvents: [summarizationUsage, primary],
    });
    expect(meta.contextUsage).toBeDefined();
    expect(meta.summaryUsedTokens).toBe(295);
  });

  it('persists the snapshot and summary marker when the final call emitted no usage', () => {
    /** Interrupted summarized turn: no primary usage follows the latest snapshot,
     *  so the pre-invoke snapshot persists without a completed output delta. The
     *  coarse marker survives so the client estimate still caps discarded history.
     *  The summarization output (5) is subtracted (300 − 5 = 295). */
    const meta = buildMeta({
      snap: snapshot(80),
      latestUsageIndex: 1,
      usageEvents: [summarizationUsage],
    });
    expect(meta.contextUsage).toBeDefined();
    expect(meta.contextUsage.completedOutputTokens).toBeUndefined();
    expect(meta.summaryUsedTokens).toBe(295);
  });

  it('persists the snapshot without completed output when the final call emits no usage', () => {
    const meta = buildMeta({
      snap: snapshot(0),
      latestUsageIndex: 1,
      usageEvents: [primary],
    });
    expect(meta.contextUsage).toBeDefined();
    expect(meta.contextUsage.completedOutputTokens).toBeUndefined();
    expect(meta.summaryUsedTokens).toBeUndefined();
  });

  it('omits the snapshot when the response was aborted', () => {
    const meta = buildMeta({
      snap: snapshot(0),
      latestUsageIndex: 1,
      usageEvents: [primary],
      chatCompletionAborted: true,
    });
    expect(meta.contextUsage).toBeUndefined();
    expect(meta.summaryUsedTokens).toBeUndefined();
  });

  it('persists raw snapshot when only a parallel run produced post-snapshot usage', () => {
    /** The only post-snapshot usage belongs to a sibling run (run-2), so the
     *  snapshot persists without attributing run-2 output to run-1. */
    const meta = buildMeta({
      snap: snapshot(0),
      latestUsageIndex: 0,
      usageEvents: [primaryFor('run-2', 99)],
    });
    expect(meta.contextUsage).toBeDefined();
    expect(meta.contextUsage.completedOutputTokens).toBeUndefined();
    expect(meta.contextUsage.breakdown.toolTokenCounts).toEqual({ search: 12 });
  });

  it('persists with the snapshot run output when its own primary usage follows', () => {
    const meta = buildMeta({
      snap: snapshot(0),
      latestUsageIndex: 0,
      usageEvents: [primaryFor('run-2', 99), primaryFor('run-1', 7)],
    });
    expect(meta.contextUsage).toBeDefined();
    expect(meta.contextUsage.completedOutputTokens).toBe(7);
  });

  it('subtracts earlier tool-loop output from the summary marker (interrupted turn)', () => {
    /** Multi-call summarized turn stopped before the final usage: the earlier
     *  call (output 40) is baked into baseUsed (300), so the marker is 300 − 40 =
     *  260. No primary follows the snapshot, so it persists without a completed
     *  output delta; the marker must not double-count the 40 in tokenCount. */
    const meta = buildMeta({
      snap: snapshot(80),
      latestUsageIndex: 1,
      usageEvents: [primaryFor('run-1', 40)],
    });
    expect(meta.contextUsage).toBeDefined();
    expect(meta.contextUsage.completedOutputTokens).toBeUndefined();
    expect(meta.summaryUsedTokens).toBe(260);
  });

  it('subtracts only this run’s earlier output, not a parallel run’s', () => {
    const meta = buildMeta({
      snap: snapshot(80),
      latestUsageIndex: 2,
      usageEvents: [primaryFor('run-2', 999), primaryFor('run-1', 40), primaryFor('run-1', 5)],
    });
    /** baseUsed 300 − run-1's earlier 40 = 260; run-2's 999 is ignored. */
    expect(meta.summaryUsedTokens).toBe(260);
    /** run-1's own primary follows the snapshot → snapshot persisted with output 5. */
    expect(meta.contextUsage.completedOutputTokens).toBe(5);
  });
});
