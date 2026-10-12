import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  createSteelQuotationArtifactModel,
  createSteelReviewOutputModel,
} from '~/models/steel';
import { createSteelHistoryMethods } from './steelHistory';

let mongoServer: MongoMemoryReplSet;
const scope = {
  userId: 'user-1',
  conversationId: 'conversation-1',
};
const baseline = '## ocr_result\n\n| 來源 | 數量 |\n| --- | --- |\n| P1 | 2 |';
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const reference = {
  kind: 'ocr_result' as const,
  source: 'ai' as const,
  snapshotId: 'markdown:generation:ai:ocr_result',
  generationId: 'generation',
  outputId: 'ocr_result:generation',
  messageId: 'assistant-1',
  title: 'ocr_result',
  revision: 'generation',
  sha256: sha(baseline),
  lineageId: 'lineage',
  savedAt: new Date('2026-01-01T00:00:00.000Z'),
};

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    createSteelQuotationArtifactModel(mongoose).init(),
    createSteelReviewOutputModel(mongoose).init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.models.SteelQuotationArtifact.deleteMany({}),
    mongoose.models.SteelReviewOutput.deleteMany({}),
  ]);
});

async function seedAiPublication(): Promise<void> {
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const Output = createSteelReviewOutputModel(mongoose);
  const payload = JSON.stringify({ rawMarkdown: baseline, baselineMarkdown: baseline });
  await Artifact.create({
    ...scope,
    runId: 'markdown:generation',
    operationId: 'ai:ocr_result',
    kind: 'main',
    sha256: sha(payload),
    payload,
    markdownPublication: {
      reference,
      rawMarkdown: baseline,
      baselineMarkdown: baseline,
    },
  });
  await Output.create({
    ...scope,
    kind: 'ocr_result',
    messageId: reference.messageId,
    tableId: 'table-1',
    title: reference.title,
    outputId: reference.outputId,
    revision: reference.revision,
    state: 'current',
    headers: ['來源', '數量'],
    rows: [],
    aiRawMarkdown: baseline,
    aiBaselineMarkdown: baseline,
    effectiveMarkdown: baseline,
    displayMarkdown: baseline,
    receipts: [],
  });
}

const loadedMessage = {
  messageId: reference.messageId,
  metadata: {
    steelMarkdownOwners: {
      ocr_result: reference,
    },
  },
};

describe('Steel Markdown history reader', () => {
  it('resolves a bound AI baseline in one scope-batched read', async () => {
    await seedAiPublication();
    const methods = createSteelHistoryMethods(mongoose);

    await expect(methods.readSteelMarkdownHistory({ ...scope, messages: [loadedMessage] })).resolves.toEqual([
      {
        messageId: reference.messageId,
        kind: reference.kind,
        reference,
        effectiveMarkdown: baseline,
      },
    ]);
  });

  it('resolves the newest successful clean receipt without exposing display markup', async () => {
    await seedAiPublication();
    const Output = createSteelReviewOutputModel(mongoose);
    const effectiveMarkdown = 'intro\n\n## ocr_result\n\n| 來源 | 數量 |\n| --- | --- |\n| P1 | 3 |\n\n## notes\n\nkeep';
    const savedAt = new Date('2026-01-02T00:00:00.000Z');
    await Output.updateOne(
      { ...scope, outputId: reference.outputId },
      {
        $set: {
          revision: 'human-revision',
          effectiveMarkdown,
          displayMarkdown: 'intro\n\n## ocr_result\n\n| 來源 | 數量 |\n| --- | --- |\n| P1 | ~~3~~ |\n\n## notes\n\nkeep',
        },
        $push: {
          receipts: {
            operationId: 'operation-3',
            digest: 'digest-3',
            title: reference.title,
            revision: 'human-revision',
            changedRows: 1,
            changedRowIds: ['row-1'],
            savedAt,
            snapshot: {
              operationId: 'operation-3',
              digest: 'digest-3',
              title: reference.title,
              outputId: reference.outputId,
              revision: 'human-revision',
              headers: ['來源', '數量'],
              rows: [],
              changedRows: 1,
              changedRowIds: ['row-1'],
              savedAt,
              messageSha256: sha(effectiveMarkdown),
              conversationId: scope.conversationId,
              messageId: reference.messageId,
              messageText: effectiveMarkdown,
              effectiveMarkdown,
              displayMarkdown: 'intro\n\n## ocr_result\n\n| 來源 | 數量 |\n| --- | --- |\n| P1 | ~~3~~ |\n\n## notes\n\nkeep',
              aiBaselineMarkdown: baseline,
            },
          },
        },
      },
    );
    const [result] = await createSteelHistoryMethods(mongoose).readSteelMarkdownHistory({
      ...scope,
      messages: [loadedMessage],
    });

    expect(result).toMatchObject({
      messageId: reference.messageId,
      kind: reference.kind,
      effectiveMarkdown,
      reference: {
        source: 'human',
        snapshotId: 'ocr_result:generation:operation-3',
        operationId: 'operation-3',
        revision: 'human-revision',
        sha256: sha(effectiveMarkdown),
        savedAt,
      },
    });
  });

  it('drops an owner when its immutable artifact hash no longer proves the baseline', async () => {
    await seedAiPublication();
    await createSteelQuotationArtifactModel(mongoose).updateOne(
      { ...scope, operationId: 'ai:ocr_result' },
      { $set: { 'markdownPublication.baselineMarkdown': `${baseline}\nchanged` } },
    );

    await expect(createSteelHistoryMethods(mongoose).readSteelMarkdownHistory({
      ...scope,
      messages: [loadedMessage],
    })).resolves.toEqual([]);
  });
});
