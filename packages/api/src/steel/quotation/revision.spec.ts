import type {
  SteelQuotationCurrentSystemOrder,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import type { SystemOrderRevisionDependencies } from './revision';
import {
  canonicalizeSystemOrderMarkdown,
  createSystemOrderRevisionService,
  formatSystemOrderRevisionInstruction,
} from './revision';

const scope: SteelQuotationScope = {
  tenantId: 'tenant-revision',
  userId: 'user-revision',
  conversationId: 'conversation-revision',
};

const order = [
  '## system_order｜報價單',
  '',
  '| 品名規格 | 數量 | 總數 | 單價 |',
  '| --- | --- | --- | --- |',
  '| A | 2 | 2 | 10 |',
].join('\n');

function createDependencies() {
  const calls = { read: 0, checkpoint: 0, save: 0 };
  const dependencies: SystemOrderRevisionDependencies = {
    read: async () => {
      calls.read += 1;
      return null;
    },
    readCurrentSystemOrder: async () => undefined,
    readCheckpoint: async () => {
      calls.checkpoint += 1;
      return undefined;
    },
    saveCurrentSystemOrder: async () => {
      calls.save += 1;
      return undefined;
    },
  };
  return { calls, dependencies };
}

function revisionService(calls?: ReturnType<typeof createDependencies>) {
  const state = calls ?? createDependencies();
  return { ...state, service: createSystemOrderRevisionService(state.dependencies) };
}

describe('Steel system-order full-output retirement', () => {
  it('formats a complete correction instruction without retired headings', () => {
    const snapshot: SteelQuotationCurrentSystemOrder = {
      runId: 'run-1',
      sha256: 'a'.repeat(64),
      markdown: order,
      responseId: 'response-1',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const instruction = formatSystemOrderRevisionInstruction(snapshot);

    expect(instruction).toContain('complete ## system_order');
    expect(instruction).not.toContain('## system_order_revision');
    expect(instruction).not.toContain('## system_order_updates');
  });

  it.each([
    'system_order_updates',
    'system_order_revision',
    'ocr_result_updates',
    'ocr_deletions',
    'customer_data_updates',
  ])('rejects a real %s control before reading or writing state', async (title) => {
    const context = revisionService();
    const response = `## ${title}\n\n| value |\n| --- |\n| retired |`;

    await expect(context.service.prepareSystemOrderUpdates({
      scope,
      response,
      responseId: `retired-${title}`,
    })).resolves.toEqual({ ok: false, code: 'retired_control_section' });
    await expect(context.service.finalizeSystemOrderUpdates({
      scope,
      response,
      responseId: `retired-final-${title}`,
    })).resolves.toEqual({ ok: false, code: 'retired_control_section' });
    expect(context.calls).toEqual({ read: 0, checkpoint: 0, save: 0 });
  });

  it('rejects mixed full and delta output before any state access', async () => {
    const context = revisionService();
    const response = `${order}\n\n## system_order_updates\n\n| value |\n| --- |\n| retired |`;

    await expect(context.service.finalizeSystemOrderUpdates({
      scope,
      response,
      responseId: 'mixed-response',
    })).resolves.toEqual({ ok: false, code: 'retired_control_section' });
    expect(context.calls).toEqual({ read: 0, checkpoint: 0, save: 0 });
  });

  it('ignores fenced and quoted historical controls', async () => {
    const context = revisionService();
    const response = [
      'Example historical response:',
      '> ## system_order_updates',
      '> | value |',
      '> | --- |',
      '> | old |',
      '',
      '```markdown',
      '## system_order_revision',
      '',
      '| value |',
      '| --- |',
      '| old |',
      '```',
      '',
      '## system_order｜報價單',
      '',
      '| 品名規格 | 數量 | 總數 | 單價 |',
      '| --- | --- | --- | --- |',
      '| A | 2 | 2 | 10 |',
    ].join('\n');

    await expect(context.service.finalizeSystemOrderUpdates({
      scope,
      response,
      responseId: 'fenced-history',
    })).resolves.toEqual({ ok: false, code: 'no_revision' });
    expect(context.calls).toEqual({ read: 0, checkpoint: 0, save: 0 });
  });

  it('keeps a complete system-order response out of the retired revision service', async () => {
    const context = revisionService();

    await expect(context.service.finalizeSystemOrderUpdates({
      scope,
      response: order,
      responseId: 'full-response',
    })).resolves.toEqual({ ok: false, code: 'no_revision' });
    expect(context.calls).toEqual({ read: 0, checkpoint: 0, save: 0 });
  });

  it('still canonicalizes complete system-order data for full publication callers', () => {
    const result = canonicalizeSystemOrderMarkdown(order);
    expect(result?.markdown).toBe(order);
    expect(result?.sha256).toHaveLength(64);
  });
});
