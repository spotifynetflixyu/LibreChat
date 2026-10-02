import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
} from '@librechat/data-schemas';
import type { SteelQuotationScope } from '@librechat/data-schemas';
import {
  createSystemOrderRevisionService,
  formatSystemOrderRevisionInstruction,
} from './revision';
import {
  createSteelQuotationStateService,
  type SteelQuotationStateService,
} from './state';
import { createSteelOcrStateService } from '../ocr/state';
import { prepareQuotationTurn } from './preparation';

let mongoServer: MongoMemoryServer;
let stateService: SteelQuotationStateService;

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
  '| B | 1 | 1 | 20 |',
].join('\n');
const sourceOrder = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| 文字訂單 | A | 鋼板 | 2 |\n| 文字訂單 | B | 鋼板 | 1 |';
const customerA = '## customer_data\n\n| 客戶編號 | 客戶名稱 | 價格等級 | 說明 |\n| --- | --- | --- | --- |\n| CA | Acme | A |  |';

async function prepareCompletedRun(
  inputScope: SteelQuotationScope = scope,
): Promise<{ runId: string; final: string }> {
  await stateService.setOrder({ scope: inputScope, fullMarkdown: sourceOrder });
  await stateService.saveCustomer({
    scope: inputScope, customerMarkdown: customerA, customerIdentity: 'customer-a',
    triggeringMessageId: 'customer-user', responseId: 'customer-response',
    orderHash: createHash('sha256').update(sourceOrder).digest('hex'),
    selectionProvenance: { method: 'unique', lookupMessageId: 'customer-user' },
  });
  const ticket = await stateService.issueTicket({
    scope: inputScope,
    customerMarkdown: customerA,
    customerIdentity: 'customer-a',
    triggeringMessageId: 'message-1',
    selectionProvenance: { method: 'unique', lookupMessageId: 'lookup-1' },
  });
  const run = await stateService.acceptSignal({
    scope: inputScope,
    index: ticket.index,
    token: ticket.token,
    orderHash: ticket.orderHash,
    customerMarkdown: ticket.customerMarkdown,
    customerIdentity: ticket.customerIdentity,
    prompts: { child: 'child', main: 'main' },
    chunks: [{ index: 1, sourceRowCount: 2 }],
    targetMessageId: 'assistant-1',
  });
  const lease = await stateService.acquireLease({ scope: inputScope, runId: run.runId, leaseToken: 'lease-1' });
  if (!lease) throw new Error('test setup did not acquire a lease');
  const final = `${order}\n\n## customer_quote\n\n| existing |\n| --- |\n| AI text |`;
  await stateService.checkpoint({
    scope: inputScope,
    runId: run.runId,
    leaseToken: lease.leaseToken,
    operationId: 'final',
    kind: 'final',
    payload: final,
  });
  const checkpointed = await stateService.readState(inputScope);
  const checkpoint = checkpointed?.activeRun?.checkpointRefs.find((ref) => ref.operationId === 'final');
  if (!checkpoint) throw new Error('test setup did not save a final checkpoint');
  const completed = await stateService.completeRun({
    scope: inputScope,
    runId: run.runId,
    leaseToken: lease.leaseToken,
    finalRef: { ...inputScope, runId: run.runId, ...checkpoint, kind: 'final' },
  });
  if (!completed) throw new Error('test setup did not complete the run');
  return { runId: run.runId, final };
}

function createRevisionService() {
  return createSystemOrderRevisionService({
    read: stateService.readState,
    readCurrentSystemOrder: stateService.readCurrentSystemOrder,
    readCheckpoint: stateService.readCheckpoint,
    saveCurrentSystemOrder: stateService.saveCurrentSystemOrder,
  });
}

async function readSnapshot(inputScope: SteelQuotationScope = scope) {
  const revisionService = createRevisionService();
  const snapshot = await revisionService.readCurrentSystemOrder(inputScope);
  if (!snapshot) throw new Error('test setup did not produce a current snapshot');
  return snapshot;
}

function updates(snapshot: { sha256: string }, row = '| A | 2 | 3 | 10 |'): string {
  return [
    '## system_order_updates',
    '',
    '| base_hash | row_index | 品名規格 | 數量 | 總數 | 單價 |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${snapshot.sha256} | 1 ${row.slice(row.indexOf('| A'))}`,
  ].join('\n');
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  stateService = createSteelQuotationStateService(mongoose);
});

beforeEach(async () => {
  await Promise.all([
    createSteelQuotationStateModel(mongoose).createIndexes(),
    createSteelQuotationArtifactModel(mongoose).createIndexes(),
  ]);
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Steel system-order revisions', () => {
  it('fences a revision when the customer changes between its read and save', async () => {
    const { runId, final } = await prepareCompletedRun();
    const original = await readSnapshot();
    const service = createSystemOrderRevisionService({
      read: stateService.readState,
      readCurrentSystemOrder: stateService.readCurrentSystemOrder,
      readCheckpoint: stateService.readCheckpoint,
      saveCurrentSystemOrder: async (input) => {
        const before = await stateService.readState(scope);
        await stateService.saveCustomer({
          scope,
          customerIdentity: 'explicit-default:B',
          customerMarkdown: '## customer_data\n\n| 價格等級 |\n| --- |\n| B |',
          triggeringMessageId: 'tier-change', responseId: 'tier-change-response',
          orderHash: before?.currentOrder?.sha256,
          expectedPreparationId: before?.currentCustomer?.preparationId,
          selectionProvenance: { method: 'default_tier', selectionMessageId: 'tier-change' },
        });
        return stateService.saveCurrentSystemOrder(input);
      },
    });
    expect(await service.finalizeSystemOrderUpdates({
      scope, response: updates(original), responseId: 'racing-correction',
    })).toEqual({ ok: false, code: 'concurrent_change' });
    expect(await stateService.hasSystemOrder(scope)).toBe(false);
    const state = await stateService.readState(scope);
    expect(state?.currentSystemOrder).toBeUndefined();
    expect(state?.currentCustomer?.customerIdentity).toBe('explicit-default:B');
    expect(await service.readCurrentSystemOrder(scope)).toBeUndefined();
    expect(await service.finalizeSystemOrderUpdates({
      scope, response: updates(original), responseId: 'old-customer-correction',
    })).toEqual({ ok: false, code: 'missing_current_system_order' });
    expect(await stateService.readCheckpoint({ scope, runId, operationId: 'final' })).toBe(final);
  });

  it('keeps a prior quote historical after a saved OCR order changes', async () => {
    const { runId, final } = await prepareCompletedRun();
    const original = await readSnapshot();
    await stateService.markPublished({
      scope, runId, finalSha256: createHash('sha256').update(final).digest('hex'),
    });
    expect(await stateService.hasSystemOrder(scope)).toBe(true);
    const revisedOrder = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| 文字訂單 | A | 鋼板 | 3 |';
    await createSteelOcrStateService(mongoose).upsertCurrentOcrResult({
      conversationId: scope.conversationId, generationId: 'ocr-change', attemptNumber: 1, markdown: revisedOrder,
    });
    const prepared = await prepareQuotationTurn({
      scope, messageId: 'confirm-new-order', responseId: 'new-response', text: '請確認新訂單',
    });
    expect(prepared.instruction).toContain(JSON.stringify({
      hasOcrResult: true, hasCustomerData: true, hasSystemOrder: false, shouldAskToQuote: true,
    }));
    expect(prepared.instruction).not.toMatch(/^## system_order_revision\s*$/mu);
    expect(await stateService.hasSystemOrder(scope)).toBe(false);
    expect(await createRevisionService().finalizeSystemOrderUpdates({
      scope, response: updates(original), responseId: 'old-order-correction',
    })).toEqual({ ok: false, code: 'missing_current_system_order' });
    expect(await stateService.readCheckpoint({ scope, runId, operationId: 'final' })).toBe(final);
  });

  it('falls back to the completed final artifact and formats a row-indexed revision table', async () => {
    const { runId } = await prepareCompletedRun();
    const snapshot = await readSnapshot();
    expect(snapshot.runId).toBe(runId);
    expect(snapshot.markdown).toContain('## system_order｜報價單');
    expect(formatSystemOrderRevisionInstruction(snapshot)).toContain(
      `| ${snapshot.sha256} | 1 |`,
    );
    expect((await createSteelQuotationArtifactModel(mongoose).countDocuments({ ...scope, runId }))).toBe(2);
  });

  it('merges valid updates, rebuilds the deterministic customer quote, and leaves the final artifact immutable', async () => {
    const { runId, final } = await prepareCompletedRun();
    const snapshot = await readSnapshot();
    const response = updates(snapshot);
    const result = await createRevisionService().finalizeSystemOrderUpdates({
      scope,
      response,
      responseId: 'revision-response-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain('| A | 2 | 3 | 10 |');
    expect(result.markdown).toContain('## customer_quote');
    expect(result.markdown).toContain('| 總計 |  | 50 |');
    expect(result.markdown).not.toContain('AI text');
    expect(result.markdown).toMatch(/## quote_summary\n\n報價表修正完成：共 2 筆 system_order。$/u);
    expect(result.snapshot.markdown).toContain('| B | 1 | 1 | 20 |');
    expect(result.snapshot.sha256).toBe(
      (await stateService.readState(scope))?.currentSystemOrder?.sha256,
    );
    const replay = await createRevisionService().finalizeSystemOrderUpdates({
      scope,
      response,
      responseId: 'revision-response-1',
    });
    expect(replay.ok).toBe(true);
    expect(replay.ok && replay.snapshot.sha256).toBe(result.snapshot.sha256);
    expect(replay.ok && replay.markdown).toBe(result.markdown);
    expect(await stateService.readCheckpoint({ scope, runId, operationId: 'final' })).toBe(final);
  });

  it('rejects invalid base hashes, duplicate rows, and quantity changes with stale totals', async () => {
    await prepareCompletedRun();
    const snapshot = await readSnapshot();
    const service = createRevisionService();
    const invalidBase = await service.finalizeSystemOrderUpdates({
      scope,
      response: updates({ sha256: '0'.repeat(64) }),
      responseId: 'revision-response-invalid-base',
    });
    expect(invalidBase).toEqual({ ok: false, code: 'invalid_base_hash' });

    const duplicate = [
      '## system_order_updates', '',
      '| base_hash | row_index | 品名規格 | 數量 | 總數 | 單價 |',
      '| --- | --- | --- | --- | --- | --- |',
      `| ${snapshot.sha256} | 1 | A | 2 | 2 | 10 |`,
      `| ${snapshot.sha256} | 1 | A | 2 | 2 | 10 |`,
    ].join('\n');
    expect(await service.finalizeSystemOrderUpdates({
      scope,
      response: duplicate,
      responseId: 'revision-response-duplicate',
    })).toEqual({ ok: false, code: 'duplicate_row_index' });

  });

  it('allows only one concurrent correction through the scoped CAS and replays its response idempotently', async () => {
    await prepareCompletedRun();
    const snapshot = await readSnapshot();
    const service = createRevisionService();
    const response = updates(snapshot);
    const results = await Promise.all([
      service.finalizeSystemOrderUpdates({ scope, response, responseId: 'same-response' }),
      service.finalizeSystemOrderUpdates({ scope, response, responseId: 'same-response' }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results[0]).toEqual(results[1]);

    const state = await stateService.readState(scope);
    expect(state?.currentSystemOrder?.responseId).toBe('same-response');
    expect(state?.activeRun?.status).toBe('completed');
  });

  it('reads and CAS-writes a legacy tenantless completed state for an authoritative tenant', async () => {
    const legacyScope: SteelQuotationScope = {
      userId: 'legacy-user',
      conversationId: 'legacy-conversation',
    };
    const authoritativeScope: SteelQuotationScope = {
      ...legacyScope,
      tenantId: 'tenant-authoritative',
    };
    await prepareCompletedRun(legacyScope);
    const snapshot = await readSnapshot(authoritativeScope);
    const result = await createRevisionService().finalizeSystemOrderUpdates({
      scope: authoritativeScope,
      response: updates(snapshot),
      responseId: 'legacy-tenant-revision',
    });
    expect(result.ok).toBe(true);
    expect((await stateService.readState(authoritativeScope))?.currentSystemOrder?.responseId).toBe(
      'legacy-tenant-revision',
    );
  });

  it('keeps tenant isolation for explicit tenant state and artifact references', async () => {
    const explicitScope: SteelQuotationScope = {
      userId: 'explicit-user',
      conversationId: 'explicit-conversation',
      tenantId: 'tenant-a',
    };
    const mismatchedScope: SteelQuotationScope = {
      ...explicitScope,
      tenantId: 'tenant-b',
    };
    const undefinedTenantScope: SteelQuotationScope = {
      userId: explicitScope.userId,
      conversationId: explicitScope.conversationId,
    };
    await stateService.ensureState(explicitScope);
    expect(await stateService.readState(mismatchedScope)).toBeNull();
    expect(await stateService.readState(undefinedTenantScope)).toBeNull();

    const explicitRef = await stateService.writeArtifact({
      scope: explicitScope,
      runId: 'explicit-run',
      operationId: 'explicit-artifact',
      kind: 'archive',
      payload: 'explicit tenant artifact',
    });
    expect(explicitRef.tenantId).toBe('tenant-a');
    expect(await stateService.readArtifact({ scope: mismatchedScope, ref: explicitRef })).toBeUndefined();
    expect(await stateService.readArtifact({ scope: undefinedTenantScope, ref: explicitRef })).toBeUndefined();

    const legacyArtifactScope: SteelQuotationScope = {
      userId: 'legacy-artifact-user',
      conversationId: 'legacy-artifact-conversation',
    };
    const legacyArtifactTenantScope: SteelQuotationScope = {
      ...legacyArtifactScope,
      tenantId: 'tenant-a',
    };
    const legacyRef = await stateService.writeArtifact({
      scope: legacyArtifactScope,
      runId: 'legacy-artifact-run',
      operationId: 'legacy-artifact',
      kind: 'archive',
      payload: 'legacy artifact',
    });
    expect(legacyRef.tenantId).toBeUndefined();
    expect(await stateService.readArtifact({ scope: legacyArtifactTenantScope, ref: legacyRef })).toBe(
      'legacy artifact',
    );

    await prepareCompletedRun(scope);
    expect((await stateService.readState(scope))?.activeRun?.snapshotRef.tenantId).toBe(scope.tenantId);
  });

  it('retains the original quotation collection indexes', () => {
    const stateIndexes = createSteelQuotationStateModel(mongoose).schema.indexes();
    const artifactIndexes = createSteelQuotationArtifactModel(mongoose).schema.indexes();
    expect(stateIndexes.some(([keys, options]) =>
      JSON.stringify(keys) === JSON.stringify({ userId: 1, conversationId: 1 }) && options.unique === true,
    )).toBe(true);
    expect(artifactIndexes.some(([keys, options]) =>
      JSON.stringify(keys) === JSON.stringify({ userId: 1, conversationId: 1, runId: 1, operationId: 1, sha256: 1 }) &&
      options.unique === true,
    )).toBe(true);
    expect(artifactIndexes.some(([keys]) =>
      JSON.stringify(keys) === JSON.stringify({ userId: 1, conversationId: 1, runId: 1, operationId: 1 }),
    )).toBe(true);
    expect(stateIndexes.every(([keys]) => !('tenantId' in keys))).toBe(true);
    expect(artifactIndexes.every(([keys]) => !('tenantId' in keys))).toBe(true);
  });

  it('does not fall back to the immutable original after a saved revision is corrupt', async () => {
    await prepareCompletedRun();
    const service = createRevisionService();
    const original = await readSnapshot();
    expect((await service.finalizeSystemOrderUpdates({
      scope, response: updates(original), responseId: 'saved-revision',
    })).ok).toBe(true);
    await createSteelQuotationStateModel(mongoose).updateOne(scope, {
      $set: { 'currentSystemOrder.sha256': '0'.repeat(64) },
    });
    expect(await service.readCurrentSystemOrder(scope)).toBeUndefined();
    expect(await service.finalizeSystemOrderUpdates({
      scope, response: updates(original), responseId: 'stale-correction',
    })).toEqual({ ok: false, code: 'missing_current_system_order' });
    expect((await stateService.readState(scope))?.currentSystemOrder?.responseId).toBe('saved-revision');
  });
});
