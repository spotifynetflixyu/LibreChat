import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { SteelMarkdownAdmission, SteelMarkdownPublicationInput } from '~/types';
import {
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '~/models/steel';
import { createSteelQuotationInputMethods } from './steelQuotationInput';
import { createMessageMethods } from './message';
import { createModels } from '~/models';

const scope = { userId: '507f1f77bcf86cd799439011', conversationId: '019c6e27-e55b-73d1-87d8-4e01f1f75043' };
const markdown = '## ocr_result\n\n| 來源 | 零件編號 | 數量 |\n| --- | --- | --- |\n| 文字訂單 | P1 | 2 |';
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

let server: MongoMemoryReplSet;

function publication(admission: SteelMarkdownAdmission): SteelMarkdownPublicationInput {
  return {
    scope,
    admission,
    rawMarkdown: markdown,
    message: {
      messageId: admission.responseId,
      conversationId: scope.conversationId,
      user: scope.userId,
      text: markdown,
      isCreatedByUser: false,
      unfinished: false,
    },
    targets: [{
      kind: 'ocr_result',
      title: 'ocr_result',
      outputId: `ocr_result:${admission.generationId}`,
      revision: admission.generationId,
      baselineMarkdown: markdown,
      headers: ['來源', '零件編號', '數量'],
      rows: [{
        rowId: sha(`${`ocr_result:${admission.generationId}`}:0:${JSON.stringify(['文字訂單', 'P1', '2'])}`),
        source: null,
        values: {
          來源: { baseline: '文字訂單', effective: '文字訂單' },
          零件編號: { baseline: 'P1', effective: 'P1' },
          數量: { baseline: '2', effective: '2' },
        },
      }],
    }],
    ocr: { attemptNumber: 1 },
  };
}

async function publishBaseAi(generationId = 'ocr-generation'): Promise<void> {
  const methods = createMessageMethods(mongoose);
  const admission = await methods.admitSteelMarkdown({
    scope,
    responseId: 'assistant-ocr',
    generationId,
  });
  if (!admission) throw new Error('Missing OCR admission');
  const published = await methods.publishSteelMarkdown(publication(admission));
  if (!published.ok) throw new Error(`Publication failed: ${published.code}`);
}

async function saveHumanReference(savedAt: Date): Promise<void> {
  const State = createSteelQuotationStateModel(mongoose);
  const state = await State.findOne(scope).lean();
  const ai = state?.markdownPublication?.current?.ocr_result?.ai;
  if (!ai) throw new Error('Missing AI reference');
  const humanMarkdown = `${markdown}\n\n<!-- human ${savedAt.toISOString()} -->`;
  const outputId = ai.outputId;
  const operationId = `human-${savedAt.getTime()}`;
  const human = {
    ...ai,
    source: 'human' as const,
    snapshotId: `${outputId}:${operationId}`,
    operationId,
    revision: `human-${savedAt.getTime()}`,
    sha256: sha(humanMarkdown),
    version: 2,
    savedAt,
  };
  const Output = createSteelReviewOutputModel(mongoose);
  await Output.deleteMany({ ...scope, outputId });
  await Output.create({
    userId: scope.userId,
    conversationId: scope.conversationId,
    kind: 'ocr_result',
    messageId: ai.messageId,
    tableId: `ocr_result:${ai.title}`,
    title: ai.title,
    outputId,
    revision: human.revision,
    state: 'current',
    headers: ['來源'],
    rows: [{ rowId: 'human-row', values: { 來源: { baseline: '文字訂單', effective: '文字訂單' } }, source: null }],
    aiUpdatedAt: ai.savedAt,
    aiRawMarkdown: markdown,
    aiBaselineMarkdown: markdown,
    humanMarkdown,
    humanSavedAt: savedAt,
    effectiveMarkdown: humanMarkdown,
    displayMarkdown: humanMarkdown,
    receipts: [{
      operationId,
      digest: `digest-${operationId}`,
      revision: human.revision,
      changedRows: 1,
      changedRowIds: ['human-row'],
      savedAt,
      snapshot: {
        operationId,
        digest: `digest-${operationId}`,
        outputId,
        title: ai.title,
        revision: human.revision,
        headers: ['來源'],
        rows: [{ rowId: 'human-row', values: { 來源: { baseline: '文字訂單', effective: '文字訂單' } }, source: null }],
        changedRows: 1,
        changedRowIds: ['human-row'],
        savedAt,
        messageSha256: sha(markdown),
        conversationId: scope.conversationId,
        messageId: ai.messageId,
        messageText: markdown,
        effectiveMarkdown: humanMarkdown,
        displayMarkdown: humanMarkdown,
      },
    }],
  });
  await State.updateOne(scope, { $set: { 'markdownPublication.lastHumanOcr': human } });
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  const models = createModels(mongoose);
  await Promise.all(Object.values(models).map((model) => model.init()));
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (server) await server.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  await mongoose.models.Conversation.create({ ...scope, user: scope.userId, endpoint: 'agents' });
});

it('prepares and admits one immutable OCR input, then replays the accepted ticket', async () => {
  const publicationMethods = createMessageMethods(mongoose);
  const admission = await publicationMethods.admitSteelMarkdown({
    scope,
    responseId: 'assistant-ocr',
    generationId: 'ocr-generation',
  });
  if (!admission) throw new Error('Missing OCR admission');
  const published = await publicationMethods.publishSteelMarkdown(publication(admission));
  if (!published.ok) throw new Error(`Publication failed: ${published.code}`);

  const inputMethods = createSteelQuotationInputMethods(mongoose);
  const initial = await inputMethods.readSteelQuotationOcrInput(scope);
  if (!initial.ok || !initial.input) throw new Error('Missing published OCR input');
  expect(initial.input.selection.selected.source).toBe('ai');
  expect(initial.input.selection.version).toBe(1);

  const stateModel = createSteelQuotationStateModel(mongoose);
  const prepared = await inputMethods.prepareSteelQuotationOcrInput({
    scope,
    expectedOrderHash: (await stateModel.findOne(scope).lean())?.currentOrder?.sha256 ?? null,
  });
  if (!prepared.ok || !prepared.input) throw new Error('Missing prepared OCR input');

  const orderHash = prepared.state.currentOrder?.sha256;
  if (!orderHash) throw new Error('Missing prepared order hash');
  const ticket = {
    index: 1,
    token: 'quotation-ticket',
    orderHash,
    customerMarkdown: '## customer_data\n\nB',
    customerIdentity: 'B',
    triggeringMessageId: 'user-turn',
    selectionProvenance: { method: 'unique' as const },
    issuedAt: new Date(),
    preparationId: 'customer-preparation',
    responseId: 'customer-response',
  };
  await stateModel.updateOne(scope, {
    $set: {
      currentCustomer: {
        preparationId: ticket.preparationId,
        customerMarkdown: ticket.customerMarkdown,
        customerIdentity: ticket.customerIdentity,
        triggeringMessageId: ticket.triggeringMessageId,
        responseId: 'customer-response',
        selectionProvenance: { method: 'unique' },
      },
      tickets: [ticket],
    },
  });

  const request = {
    scope,
    index: ticket.index,
    token: ticket.token,
    orderHash,
    customerMarkdown: ticket.customerMarkdown,
    customerIdentity: ticket.customerIdentity,
    prompts: { child: 'child', main: 'main' },
    chunks: [{ index: 1, sourceRowCount: 1 }],
    selection: prepared.input.selection,
  };
  // An unselected candidate appearing still invalidates the original admission proof.
  const originalState = await stateModel.findOne(scope).lean();
  const originalAi = originalState?.markdownPublication?.current?.ocr_result?.ai;
  if (!originalAi) throw new Error('Missing original AI reference');
  await saveHumanReference(new Date(originalAi.savedAt.getTime() - 1));
  expect(await inputMethods.admitSteelQuotationOcrInput(request)).toEqual({ ok: false, code: 'concurrent_change' });
  expect(await createSteelQuotationArtifactModel(mongoose).countDocuments({ ...scope, kind: 'snapshot' })).toBe(0);
  expect((await stateModel.findOne(scope).lean())?.activeRun).toBeUndefined();
  await stateModel.updateOne(scope, { $unset: { 'markdownPublication.lastHumanOcr': 1 } });
  await stateModel.updateOne(scope, { $set: { 'markdownPublication.current.ocr_result.ai.revision': 'changed-revision' } });
  expect(await inputMethods.admitSteelQuotationOcrInput(request)).toEqual({ ok: false, code: 'concurrent_change' });
  expect(await createSteelQuotationArtifactModel(mongoose).countDocuments({ ...scope, kind: 'snapshot' })).toBe(0);
  await stateModel.updateOne(scope, { $set: { 'markdownPublication.current.ocr_result.ai': originalAi } });
  expect(await inputMethods.admitSteelQuotationOcrInput({ ...request, chunks: [{ index: 0, sourceRowCount: 1 }] }))
    .toEqual({ ok: false, code: 'invalid_snapshot' });
  expect(await inputMethods.admitSteelQuotationOcrInput({ ...request, chunks: [request.chunks[0], request.chunks[0]] }))
    .toEqual({ ok: false, code: 'invalid_snapshot' });
  await stateModel.updateOne(scope, { $unset: { 'tickets.0.responseId': 1 } });
  expect(await inputMethods.admitSteelQuotationOcrInput(request)).toEqual({ ok: false, code: 'concurrent_change' });
  await stateModel.updateOne(scope, { $set: { 'tickets.0.responseId': ticket.responseId,
    'currentCustomer.selectionProvenance.selectedCustomerId': 'different-customer' } });
  expect(await inputMethods.admitSteelQuotationOcrInput(request)).toEqual({ ok: false, code: 'concurrent_change' });
  expect(await createSteelQuotationArtifactModel(mongoose).countDocuments({ ...scope, kind: 'snapshot' })).toBe(0);
  await stateModel.updateOne(scope, { $unset: { 'currentCustomer.selectionProvenance.selectedCustomerId': 1 } });
  const admitted = await inputMethods.admitSteelQuotationOcrInput(request);
  if (!admitted.ok) throw new Error(`Admission failed: ${admitted.code}`);
  expect(admitted.run.snapshotRef.artifactId).toContain('quotation-ticket:snapshot:');
  expect(await createSteelQuotationArtifactModel(mongoose).countDocuments({ ...scope, kind: 'snapshot' })).toBe(1);

  const replay = await inputMethods.admitSteelQuotationOcrInput(request);
  expect(replay).toEqual({ ok: true, run: admitted.run });
  const archived = { ...admitted.run, status: 'completed' as const };
  const archivePayload = JSON.stringify({ run: archived });
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  await Artifact.create({ ...scope, runId: archived.runId, operationId: 'archive', kind: 'archive',
    payload: archivePayload, sha256: sha(archivePayload) });
  await stateModel.updateOne(scope, { $unset: { activeRun: 1 } });
  expect(await inputMethods.admitSteelQuotationOcrInput(request)).toEqual({ ok: true, run: JSON.parse(archivePayload).run });
  await Artifact.updateOne({ ...scope, kind: 'archive' }, { $set: { payload: `${archivePayload} ` } });
  expect(await inputMethods.admitSteelQuotationOcrInput(request)).toEqual({ ok: false, code: 'invalid_snapshot' });
  const wrongRun = JSON.stringify({ run: { ...archived, runId: 'different-run' } });
  await Artifact.updateOne({ ...scope, kind: 'archive' }, { $set: { payload: wrongRun, sha256: sha(wrongRun) } });
  expect(await inputMethods.admitSteelQuotationOcrInput(request)).toEqual({ ok: false, code: 'invalid_snapshot' });
});

it('keeps a legacy state without OCR references untouched when the expected order is absent', async () => {
  const stateModel = createSteelQuotationStateModel(mongoose);
  const legacy = await stateModel.create({
    ...scope,
    nextSignalIndex: 0,
    tickets: [],
    pendingMessages: [],
  });
  const result = await createSteelQuotationInputMethods(mongoose).prepareSteelQuotationOcrInput({
    scope,
    expectedOrderHash: null,
  });
  expect(result).toEqual({ ok: true, state: expect.objectContaining({ _id: legacy._id }) });
  expect(await stateModel.findOne(scope).lean()).toMatchObject({
    _id: legacy._id,
    tickets: [],
  });
});

it('compares immutable AI and human timestamps, retains historical human lineage, and returns no input when both are absent', async () => {
  await publishBaseAi();
  const State = createSteelQuotationStateModel(mongoose);
  const inputMethods = createSteelQuotationInputMethods(mongoose);
  const aiState = await State.findOne(scope).lean();
  const aiSavedAt = aiState?.markdownPublication?.current?.ocr_result?.ai.savedAt;
  if (!(aiSavedAt instanceof Date)) throw new Error('Missing AI timestamp');

  await saveHumanReference(new Date(aiSavedAt.getTime() + 1));
  const humanNewer = await inputMethods.readSteelQuotationOcrInput(scope);
  if (!humanNewer.ok || !humanNewer.input) throw new Error('Missing newer human input');
  expect(humanNewer.input.selection.selected.source).toBe('human');
  expect(humanNewer.input.selection.version).toBe(2);

  await mongoose.models.File.create(['a', 'b'].map((name) => ({
    user: scope.userId, conversationId: scope.conversationId, file_id: `file-${name}`,
    filename: `${name}.pdf`, filepath: `/test/${name}.pdf`, type: 'application/pdf', bytes: 1,
    object: 'file', source: 'local', context: 'message_attachment',
  })));
  const recoverableRow = {
    rowId: 'recoverable', values: { 來源: { baseline: 'F1', effective: 'F1' } },
    source: { fileId: 'file-a', filename: 'a.pdf' },
  };
  const Output = createSteelReviewOutputModel(mongoose);
  await Output.updateOne(scope, { $set: { 'receipts.0.snapshot.rows': [recoverableRow],
    'receipts.0.snapshot.sourceMappings': [], rows: [recoverableRow] } });
  const beforeRecovery = await Output.findOne(scope).lean();
  const recovered = await inputMethods.readSteelQuotationOcrInput(scope);
  if (!recovered.ok || !recovered.input) throw new Error('Missing recovered input');
  expect(recovered.input.sourceSnapshot.mappings).toEqual([
    { fileId: 'file-a', sourceCode: 'F1', sourceFilename: 'a.pdf' },
  ]);
  expect(await Output.findOne(scope).lean()).toEqual(beforeRecovery);
  const conflictingRows = [
    {
      rowId: 'conflict-a',
      values: { 來源: { baseline: 'F1', effective: 'F1' } },
      source: { fileId: 'file-a', filename: 'a.pdf' },
    },
    {
      rowId: 'conflict-b',
      values: { 來源: { baseline: 'F1', effective: 'F1' } },
      source: { fileId: 'file-b', filename: 'b.pdf' },
    },
    {
      rowId: 'conflict-c',
      values: { 來源: { baseline: 'F2', effective: 'F2' } },
      source: { fileId: 'file-a', filename: 'a.pdf' },
    },
  ];
  await createSteelReviewOutputModel(mongoose).updateOne(scope, {
    $set: {
      'receipts.0.snapshot.rows': conflictingRows,
      rows: conflictingRows,
    },
  });
  const conflict = await inputMethods.readSteelQuotationOcrInput(scope);
  if (!conflict.ok || !conflict.input) throw new Error('Missing conflict-safe human input');
  expect(conflict.input.selection.selected.source).toBe('human');
  expect(conflict.input.sourceSnapshot.mappings).toEqual([]);
  const fileConflicts = [conflictingRows[0],
    { ...conflictingRows[2], rowId: 'file-conflict-b' },
    { ...conflictingRows[1], rowId: 'file-conflict-c', values: { 來源: { baseline: 'F2', effective: 'F2' } } }];
  await Output.updateOne(scope, { $set: { 'receipts.0.snapshot.rows': fileConflicts, rows: fileConflicts } });
  const fileConflict = await inputMethods.readSteelQuotationOcrInput(scope);
  if (!fileConflict.ok || !fileConflict.input) throw new Error('Missing conflict-safe input');
  expect(fileConflict.input.sourceSnapshot.mappings).toEqual([]);

  await publishBaseAi('ocr-generation-new');
  const retained = await inputMethods.readSteelQuotationOcrInput(scope);
  if (!retained.ok || !retained.input) throw new Error('Missing retained historical input');
  expect(retained.input.selection.candidates.human?.source).toBe('human');
  const latestState = await State.findOne(scope).lean();
  const latestAiSavedAt = latestState?.markdownPublication?.current?.ocr_result?.ai.savedAt;
  if (!(latestAiSavedAt instanceof Date)) throw new Error('Missing latest AI timestamp');

  await createSteelReviewOutputModel(mongoose).deleteMany(scope);
  await State.updateOne(scope, {
    $set: { 'markdownPublication.current.ocr_result.ai.savedAt': latestAiSavedAt },
    $unset: { 'markdownPublication.lastHumanOcr': 1 },
  });
  await saveHumanReference(latestAiSavedAt);
  const tie = await inputMethods.readSteelQuotationOcrInput(scope);
  if (!tie.ok || !tie.input) throw new Error('Missing tie input');
  expect(tie.input.selection.selected.source).toBe('ai');

  await State.updateOne(scope, { $unset: { 'markdownPublication.current.ocr_result': 1 } });
  const historicalHuman = await inputMethods.readSteelQuotationOcrInput(scope);
  if (!historicalHuman.ok || !historicalHuman.input) throw new Error('Missing historical human input');
  expect(historicalHuman.input.selection.selected.source).toBe('human');
  expect(historicalHuman.input.markdown).toContain('human');

  await State.updateOne(scope, { $unset: { 'markdownPublication.lastHumanOcr': 1 } });
  const none = await inputMethods.readSteelQuotationOcrInput(scope);
  expect(none).toEqual({ ok: true });
});

it('does not select a historical human snapshot without its authorized live owner', async () => {
  await publishBaseAi();
  const State = createSteelQuotationStateModel(mongoose);
  const ai = (await State.findOne(scope).lean())?.markdownPublication?.current?.ocr_result?.ai;
  if (!ai) throw new Error('Missing AI reference');
  await saveHumanReference(new Date(ai.savedAt.getTime() + 1));
  await State.updateOne(scope, { $unset: { 'markdownPublication.current.ocr_result': 1 } });
  const methods = createSteelQuotationInputMethods(mongoose);
  expect((await methods.readSteelQuotationOcrInput(scope)).ok).toBe(true);
  expect(await methods.readSteelQuotationOcrInput({ ...scope, tenantId: 'other-tenant' })).toEqual({ ok: true });
  expect(await methods.readSteelQuotationOcrInput({ ...scope, userId: 'other-user' })).toEqual({ ok: true });
  await mongoose.models.Message.deleteOne({ conversationId: scope.conversationId, messageId: ai.messageId });
  expect(await methods.readSteelQuotationOcrInput(scope)).toEqual({ ok: false, code: 'invalid_snapshot' });
});
