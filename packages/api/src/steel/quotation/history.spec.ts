import { getQuotationHistoryDelta, upsertQuotationToolContent } from './history';
import type {
  SteelNativeHistory,
  SteelNativePreflightToolCall,
  SteelNativeQuotationStatusEvent,
} from '../native/events';
import { createSteelQuotationStateService } from './state';

jest.mock('./state', () => ({
  createSteelQuotationStateService: jest.fn(),
}));

const mockedCreateService = jest.mocked(createSteelQuotationStateService);
let mockService: {
  readState: jest.Mock;
  readArtifact: jest.Mock;
  readCheckpoint: jest.Mock;
};

const ref = (operationId: string, kind: 'chunk' | 'main') => ({
  operationId,
  kind,
  artifactId: `${operationId}-artifact`,
  userId: 'owner',
  conversationId: 'conversation',
  runId: 'run-1',
  sha256: `${operationId}-sha`,
  updatedAt: new Date(),
});

const quotationRun = (overrides: Record<string, unknown> = {}) => ({
  runId: 'run-1',
  index: 1,
  status: 'interrupted',
  triggerMessageId: 'user-1',
  snapshotRef: ref('snapshot', 'main'),
  chunks: [
    { index: 1, sourceRowCount: 10, status: 'completed' },
    { index: 2, sourceRowCount: 23, status: 'pending' },
  ],
  checkpointRefs: [
    ref('split:2', 'main'),
    ref('slice:2:1', 'chunk'),
  ],
  acceptedAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const quotationStatusEvent = (
  overrides: Partial<SteelNativeQuotationStatusEvent> = {},
): SteelNativeQuotationStatusEvent => ({
  type: 'quotation_status',
  source: 'quotation_preflight',
  conversationId: 'conversation',
  runId: 'run-1',
  index: 1,
  stage: 'chunk_saved',
  status: 'running',
  completedChunks: 4,
  totalChunks: 8,
  chunkIndex: 4,
  ...overrides,
});

const quotationHistory = (event: SteelNativeQuotationStatusEvent): SteelNativeHistory => ({
  activityEvents: [event],
  preflightToolCalls: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockService = {
    readState: jest.fn().mockResolvedValue({ activeRun: quotationRun() }),
    readArtifact: jest.fn().mockResolvedValue(undefined),
    readCheckpoint: jest.fn().mockResolvedValue(undefined),
  };
  mockedCreateService.mockReturnValue(mockService as never);
});

it('reserves stable tool slots after existing signal text and before final quotation text', () => {
  const signal = { type: 'text', text: '## quote_signal\n\nstart' };
  const parts: unknown[] = [signal];
  const call: SteelNativePreflightToolCall = {
    type: 'tool_call', id: 'lookup-1', name: 'search_price_candidates',
    args: { queries: [{ queryId: 'q1' }] }, progress: 0,
  };
  expect(upsertQuotationToolContent(parts, call)).toBe(1);
  expect(upsertQuotationToolContent(parts, { ...call, id: 'lookup-2' })).toBe(2);
  const output = JSON.stringify({ ok: true, toolName: call.name, data: {} });
  expect(upsertQuotationToolContent(parts, { ...call, output, progress: 1 })).toBe(1);
  expect(parts[0]).toBe(signal);
  expect(parts[1]).toEqual({ type: 'tool_call', tool_call: {
    type: 'tool_call', id: call.id, name: call.name,
    args: JSON.stringify(call.args), output, progress: 1,
  } });
  expect(parts).toHaveLength(3);
  parts.push({ type: 'text', text: '## system_order\ncomplete' });
  expect(upsertQuotationToolContent(parts, { ...call, output, progress: 1 })).toBe(1);
  expect(parts).toHaveLength(4);
  expect(parts[3]).toEqual({ type: 'text', text: '## system_order\ncomplete' });
});

it('deduplicates a restored chunk progress event from the same execution', () => {
  const currentEvent = quotationStatusEvent({ attempt: 'execution-before-pause', message: 'live' });
  const restoredEvent = quotationStatusEvent({ attempt: 'execution-before-pause', message: 'restored' });

  expect(getQuotationHistoryDelta(quotationHistory(currentEvent), quotationHistory(restoredEvent)).activityEvents)
    .toEqual([]);
});

it('retains resumed chunk progress when the execution attempt changes', () => {
  const currentEvent = quotationStatusEvent({ attempt: 'execution-before-pause' });
  const resumedEvent = quotationStatusEvent({
    attempt: 'execution-after-resume',
    message: 'Restored from saved quotation checkpoints',
  });

  expect(getQuotationHistoryDelta(quotationHistory(currentEvent), quotationHistory(resumedEvent)).activityEvents)
    .toEqual([resumedEvent]);
});

it('rehydrates flattened progress from durable split checkpoints after interruption', async () => {
  const historyModule = await import('./history');
  const history = await historyModule.readQuotationHistory({
    scope: { userId: 'owner', conversationId: 'conversation' },
    runId: 'run-1',
  });
  const quotationEvents = history.activityEvents.filter((event) => event.type === 'quotation_status');
  expect(quotationEvents).toEqual([
    expect.objectContaining({ stage: 'chunk_saved', chunkIndex: 1, completedChunks: 1, totalChunks: 4 }),
    expect.objectContaining({ stage: 'chunk_saved', chunkIndex: 2, completedChunks: 2, totalChunks: 4 }),
    expect.objectContaining({ stage: 'interrupted', completedChunks: 2, totalChunks: 4 }),
  ]);
});

it('projects a valid slice repair event to its flattened ordinal and current progress', async () => {
  const attempt = 'slice-2-550e8400-e29b-41d4-a716-446655440000';
  const operationId = `repair:2:${attempt}:1:chunk_repair_started`;
  mockService.readState.mockResolvedValue({
    activeRun: quotationRun({
      checkpointRefs: [ref('split:2', 'main'), ref('slice:2:1', 'chunk'), ref(operationId, 'main')],
    }),
  });
  mockService.readCheckpoint.mockImplementation(async ({ operationId: requested }: { operationId: string }) =>
    requested === operationId
      ? JSON.stringify({
          type: 'quotation_status', source: 'quotation_preflight', conversationId: 'conversation',
          runId: 'run-1', index: 1, stage: 'chunk_repair_started', status: 'running',
          chunkIndex: 2, attempt, repairAttempt: 1, completedChunks: 0, totalChunks: 2,
        })
      : undefined,
  );
  const historyModule = await import('./history');
  const history = await historyModule.readQuotationHistory({
    scope: { userId: 'owner', conversationId: 'conversation' },
    runId: 'run-1',
  });
  expect(history.activityEvents).toContainEqual(expect.objectContaining({
    stage: 'chunk_repair_started', chunkIndex: 3, completedChunks: 2, totalChunks: 4,
  }));
});

it('ignores repair payloads whose canonical operation and event disagree', async () => {
  const attempt = 'slice-2-550e8400-e29b-41d4-a716-446655440000';
  const operationId = `repair:2:${attempt}:1:chunk_repair_started`;
  mockService.readState.mockResolvedValue({
    activeRun: quotationRun({
      checkpointRefs: [ref('split:2', 'main'), ref('slice:2:1', 'chunk'), ref(operationId, 'main')],
    }),
  });
  mockService.readCheckpoint.mockResolvedValue(JSON.stringify({
    type: 'quotation_status', source: 'quotation_preflight', conversationId: 'conversation',
    runId: 'run-1', index: 1, stage: 'chunk_repair_started', status: 'running',
    chunkIndex: 3, attempt, repairAttempt: 1, completedChunks: 0, totalChunks: 2,
  }));
  const historyModule = await import('./history');
  const history = await historyModule.readQuotationHistory({
    scope: { userId: 'owner', conversationId: 'conversation' },
    runId: 'run-1',
  });
  expect(history.activityEvents).not.toContainEqual(expect.objectContaining({ stage: 'chunk_repair_started' }));
});
