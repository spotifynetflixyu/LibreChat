import mongoose from 'mongoose';

import {
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
} from '../models/steel';

describe('Steel delegate OCR Mongo schemas', () => {
  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('defines run statuses, required fields, and idempotency indexes', () => {
    const Run = createSteelDelegateOcrRunModel(mongoose);
    expect(Run.collection.name).toBe('steel_delegate_ocr_runs');
    expect(Run.schema.path('status').options.enum).toEqual([
      'running',
      'agent_running',
      'finalizing',
      'completed',
      'agent_failed',
      'save_failed',
      'superseded',
    ]);
    expect(Run.schema.path('toolParameters')).toBeDefined();
    expect(Run.schema.path('files')).toBeDefined();
    expect(Run.schema.indexes()).toContainEqual([
      { conversationId: 1, delegateOcrIndex: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(Run.schema.indexes()).toContainEqual([
      { claimToken: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(Run.schema.indexes()).toContainEqual([
      { activeResumeKey: 1 },
      expect.objectContaining({ unique: true, sparse: true }),
    ]);
  });

  it('validates delegate run status and conversation state fields', async () => {
    const Run = createSteelDelegateOcrRunModel(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const run = new Run({
      conversationId: 'conversation-schema',
      delegateOcrIndex: 1,
      claimToken: 'claim-schema',
      triggeringMessageId: 'message-schema',
      toolParameters: { prompt: 'extract' },
      files: [{ fileId: 'file-1', filename: 'drawing.pdf' }],
      status: 'bad-status',
      currentStage: 'agent',
      finalizationJournal: {},
    });
    await expect(run.validate()).rejects.toThrow(/`bad-status` is not a valid enum value/u);

    const state = new State({ conversationId: 'conversation-schema' });
    await expect(state.validate()).resolves.toBeUndefined();
    expect(state.nextDelegateOcrIndex).toBe(0);
    expect(state.sourceMappings).toEqual([]);
  });
});
