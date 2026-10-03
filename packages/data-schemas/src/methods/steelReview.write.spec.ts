import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { SteelReviewRow } from 'librechat-data-provider';
import {
  createSteelConversationOcrStateModel,
  createSteelReviewOutputModel,
} from '~/models/steel';
import { createModels } from '~/models';
import {
  createSteelReviewWriteMethods,
  type SteelReviewCommitInput,
} from './steelReview';

let mongoServer: MongoMemoryReplSet;

const markdownFor = (value: string) => [
  '## ocr_result',
  '',
  '| 來源 | 零件編號 |',
  '| --- | --- |',
  `| A | ${value} |`,
].join('\n');

const digestFor = (input: Omit<SteelReviewCommitInput, 'digest'>): string => {
  const canonical = JSON.stringify({
    userId: input.userId,
    tenantId: input.tenantId ?? null,
    conversationId: input.conversationId,
    kind: input.kind,
    messageId: input.messageId,
    tableId: input.tableId,
    partIndex: input.partIndex ?? null,
    outputId: input.outputId,
    revision: input.revision,
    rows: input.rows,
    headers: input.headers,
    messageSha256: input.messageSha256,
    target: input.target,
    targetText: input.targetText,
    replacementText: input.replacementText,
    cleanReplacementText: input.cleanReplacementText,
    effectiveMarkdown: input.effectiveMarkdown,
    displayMarkdown: input.displayMarkdown,
    aiBaselineMarkdown: input.aiBaselineMarkdown ?? null,
    aiRawMarkdown: input.aiRawMarkdown ?? null,
    caption: input.caption,
  });
  return createHash('sha256').update(canonical).digest('hex');
};

const makeInput = ({
  operationId,
  revision,
  previousValue,
  nextValue,
}: {
  operationId: string;
  revision: string;
  previousValue: string;
  nextValue: string;
}): SteelReviewCommitInput => {
  const currentMarkdown = markdownFor(previousValue);
  const targetText = currentMarkdown.slice(currentMarkdown.indexOf('| 來源 |'));
  const replacementText = [
    '| 來源 | 零件編號 |',
    '| --- | --- |',
    `| A | ${nextValue} |`,
  ].join('\n');
  const rows: SteelReviewRow[] = [{
    rowId: 'row-1',
    values: {
      來源: { baseline: 'A', effective: 'A' },
      零件編號: { baseline: 'P-1', effective: nextValue },
    },
    source: null,
  }];
  const base: Omit<SteelReviewCommitInput, 'digest'> = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    conversationId: 'conversation-1',
    kind: 'ocr_result',
    messageId: 'assistant-1',
    tableId: 'ocr_result:1',
    outputId: 'ocr_result:generation-1',
    revision,
    operationId,
    rows,
    headers: ['來源', '零件編號'],
    messageSha256: createHash('sha256').update(currentMarkdown).digest('hex'),
    target: {
      start: currentMarkdown.indexOf('| 來源 |'),
      end: currentMarkdown.length,
      sha256: createHash('sha256').update(targetText).digest('hex'),
    },
    targetText,
    replacementText,
    cleanReplacementText: replacementText,
    effectiveMarkdown: currentMarkdown.replace(targetText, replacementText),
    displayMarkdown: currentMarkdown.replace(targetText, replacementText),
    aiBaselineMarkdown: markdownFor('P-1'),
    aiRawMarkdown: markdownFor('P-1'),
    caption: { kind: 'ocr_result', changedRows: 1, changedRowIds: ['row-1'] },
  };
  return { ...base, digest: digestFor(base) };
};

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Steel review write methods', () => {
  it('returns the immutable first receipt after a later save', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    await models.Conversation.create({
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'assistant-1',
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: markdownFor('P-1'),
    });
    await State.create({
      conversationId: 'conversation-1',
      currentOcrResultMarkdown: markdownFor('P-1'),
      currentOcrResultMessageId: 'assistant-1',
      currentOcrResultGenerationId: 'generation-1',
    });

    const writer = createSteelReviewWriteMethods(mongoose);
    const first = makeInput({
      operationId: 'operation-1',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-7',
    });
    const firstResult = await writer.commitSteelReview(first);
    const second = makeInput({
      operationId: 'operation-2',
      revision: firstResult.revision,
      previousValue: 'P-7',
      nextValue: 'P-8',
    });
    const secondResult = await writer.commitSteelReview(second);
    const replay = await writer.commitSteelReview(first);
    const changedPayload = makeInput({
      operationId: 'operation-1',
      revision: 'generation-1',
      previousValue: 'P-1',
      nextValue: 'P-9',
    });

    expect(replay).toEqual(firstResult);
    expect(replay.revision).not.toBe(secondResult.revision);
    expect(replay.effectiveMarkdown).toContain('P-7');
    expect(replay.effectiveMarkdown).not.toContain('P-8');
    const saved = await ReviewOutput.findOne({
      userId: 'user-1',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      tableId: 'ocr_result:1',
    }).lean();
    expect(saved?.receipts).toHaveLength(2);
    expect(saved?.receipts[0]?.snapshot?.revision).toBe(firstResult.revision);
    expect(saved?.receipts[0]?.snapshot?.effectiveMarkdown).toContain('P-7');
    await expect(writer.commitSteelReview(changedPayload)).rejects.toMatchObject({
      code: 'REVIEW_CONFLICT',
    });
    const unchanged = await ReviewOutput.findOne({
      userId: 'user-1',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      tableId: 'ocr_result:1',
    }).lean();
    expect(unchanged?.receipts).toHaveLength(2);
  });
});
