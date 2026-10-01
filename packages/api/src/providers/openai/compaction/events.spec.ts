import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import { createOAuthCompactionEventHandler } from './events';

const data = { id: 'compact', runId: 'run', agentId: 'agent', executionId: 'main' };
it('persists only public lifecycle markers and preserves subsequent text', async () => {
  const contentParts: TMessageContentParts[] = [];
  const emitForJob = jest.fn(async () => undefined);
  const handler = createOAuthCompactionEventHandler({ contentParts, emitForJob });
  await handler.handle('on_context_compaction', {
    input: { ...data, phase: 'started', opaque: 'SECRET' },
  });
  contentParts.push({ type: ContentTypes.TEXT, text: 'answer' });
  await handler.handle('on_context_compaction', { input: { ...data, phase: 'completed' } });
  expect(contentParts[0]).toEqual({
    type: ContentTypes.SUMMARY,
    content: [],
    nativeCompaction: { ...data, phase: 'completed' },
  });
  expect(contentParts[1]).toEqual({ type: ContentTypes.TEXT, text: 'answer' });
  expect(JSON.stringify(emitForJob.mock.calls)).not.toContain('SECRET');
  await handler.handle('on_context_compaction', { input: { ...data, phase: 'started' } });
  expect(emitForJob).toHaveBeenCalledTimes(2);
});
it('ignores malformed or hidden sequential-agent events', async () => {
  const contentParts: TMessageContentParts[] = [];
  const emitForJob = jest.fn(async () => undefined);
  const handler = createOAuthCompactionEventHandler({ contentParts, emitForJob });
  await handler.handle('on_context_compaction', { input: { ...data, phase: 'arbitrary' } });
  await handler.handle(
    'on_context_compaction',
    { input: { ...data, phase: 'started' } },
    { hide_sequential_outputs: true, last_agent_id: 'other' },
  );
  expect(contentParts).toEqual([]);
  expect(emitForJob).not.toHaveBeenCalled();
});
