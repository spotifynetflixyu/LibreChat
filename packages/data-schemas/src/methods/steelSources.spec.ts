import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSteelReviewSourceMethods } from './steelSources';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';
import { createFileModel } from '~/models/file';

describe('Steel review source methods', () => {
  let mongo: MongoMemoryServer;
  let Conversation: ReturnType<typeof createConversationModel>;
  let Message: ReturnType<typeof createMessageModel>;
  let File: ReturnType<typeof createFileModel>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Conversation = createConversationModel(mongoose);
    Message = createMessageModel(mongoose);
    File = createFileModel(mongoose);
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('lists only active same-owner sources and fails closed on duplicate file ids', async () => {
    const methods = createSteelReviewSourceMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();
    const conversationId = 'steel-source-conversation';
    await Conversation.create({
      conversationId,
      user: userId.toString(),
      tenantId: 'tenant-a',
      title: 'Source review',
      endpoint: 'openAI',
    });
    await Message.create({
      messageId: 'steel-source-message',
      conversationId,
      user: userId.toString(),
      tenantId: 'tenant-a',
      isCreatedByUser: true,
      text: 'uploaded source',
      files: [{ file_id: 'attached-source' }],
    });
    await Message.create({
      messageId: 'other-message',
      conversationId,
      user: userId.toString(),
      tenantId: 'tenant-a',
      isCreatedByUser: false,
      text: 'another response',
      files: [{ file_id: 'other-message-source' }],
    });
    await File.create([
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId,
        file_id: 'explicit-source',
        bytes: 12,
        filename: 'drawing.pdf',
        filepath: '/uploads/drawing.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        messageId: 'steel-source-message',
        file_id: 'legacy-source',
        bytes: 7,
        filename: 'legacy.png',
        filepath: '/uploads/legacy.png',
        object: 'file',
        type: 'image/png',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        file_id: 'attached-source',
        bytes: 4,
        filename: 'attached.jpg',
        filepath: '/uploads/attached.jpg',
        object: 'file',
        type: 'image/jpeg',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId: 'other-conversation',
        file_id: 'other-conversation-source',
        bytes: 4,
        filename: 'other.pdf',
        filepath: '/uploads/other.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        messageId: 'other-message',
        file_id: 'other-message-source',
        bytes: 4,
        filename: 'other-message.pdf',
        filepath: '/uploads/other-message.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-b',
        conversationId,
        file_id: 'other-tenant-source',
        bytes: 4,
        filename: 'other-tenant.pdf',
        filepath: '/uploads/other-tenant.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId,
        file_id: 'expired-source',
        bytes: 4,
        filename: 'expired.pdf',
        filepath: '/uploads/expired.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
        expiredAt: new Date(Date.now() - 60_000),
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId,
        file_id: 'duplicate-source',
        bytes: 4,
        filename: 'duplicate-a.pdf',
        filepath: '/uploads/duplicate-a.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId,
        file_id: 'duplicate-mime-source',
        bytes: 4,
        filename: 'duplicate-mime.pdf',
        filepath: '/uploads/duplicate-mime.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId,
        file_id: 'duplicate-mime-source',
        bytes: 4,
        filename: 'duplicate-mime.txt',
        filepath: '/uploads/duplicate-mime.txt',
        object: 'file',
        type: 'text/plain',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId,
        file_id: 'duplicate-source',
        bytes: 4,
        filename: 'duplicate-b.pdf',
        filepath: '/uploads/duplicate-b.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId,
        file_id: 'text-source',
        bytes: 4,
        filename: 'notes.txt',
        filepath: '/uploads/notes.txt',
        object: 'file',
        type: 'text/plain',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId,
        file_id: 'canonical-pdf-source',
        bytes: 4,
        filename: 'spoofed.pdf',
        filepath: '/uploads/spoofed.pdf',
        object: 'file',
        type: 'text/html',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        conversationId,
        file_id: 'svg-source',
        bytes: 4,
        filename: 'active.svg',
        filepath: '/uploads/active.svg',
        object: 'file',
        type: 'image/svg+xml',
        source: 'local',
        usage: 0,
      },
    ]);

    const input = {
      userId: userId.toString(),
      tenantId: 'tenant-a',
      conversationId,
      messageId: 'steel-source-message',
      kind: 'ocr_result' as const,
    };
    const sources = await methods.listSteelReviewSources(input);
    expect(sources.map((source) => source.fileId)).toEqual([
      'attached-source',
      'explicit-source',
      'legacy-source',
      'other-message-source',
      'canonical-pdf-source',
    ]);
    expect(sources.find((source) => source.fileId === 'explicit-source')).toMatchObject({
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
      filepath: '/uploads/drawing.pdf',
      storageSource: 'local',
    });
    expect(sources.find((source) => source.fileId === 'canonical-pdf-source')).toMatchObject({
      mediaType: 'application/pdf',
    });
    expect(await methods.listSteelReviewSources({ ...input, userId: new mongoose.Types.ObjectId().toString() })).toEqual([]);
    expect(await methods.readSteelReviewSource({ ...input, fileId: 'duplicate-source' })).toBeNull();
    expect(await methods.readSteelReviewSource({ ...input, fileId: 'duplicate-mime-source' })).toBeNull();
    expect(await methods.readSteelReviewSource({ ...input, fileId: 'explicit-source' })).toMatchObject({
      fileId: 'explicit-source',
      filepath: '/uploads/drawing.pdf',
    });
    expect(await methods.listSteelReviewSources({ ...input, messageId: 'missing-message' })).toEqual([]);
  });

  it('requires a unique active legacy provenance anchor for list and read', async () => {
    const methods = createSteelReviewSourceMethods(mongoose);
    const userId = new mongoose.Types.ObjectId();
    const conversationId = 'steel-source-provenance-conversation';
    await Conversation.create({
      conversationId,
      user: userId.toString(),
      tenantId: 'tenant-a',
      title: 'Source provenance review',
      endpoint: 'openAI',
    });
    await Message.create([
      {
        messageId: 'provenance-clicked',
        conversationId,
        user: userId.toString(),
        tenantId: 'tenant-a',
        isCreatedByUser: true,
        text: 'uploaded source',
        files: [{ file_id: 'anchored-legacy-source' }],
      },
      {
        messageId: 'ambiguous-message',
        conversationId,
        user: userId.toString(),
        tenantId: 'tenant-a',
        isCreatedByUser: true,
        text: 'duplicate message anchor',
      },
      {
        messageId: 'ambiguous-message',
        conversationId: 'other-conversation',
        user: userId.toString(),
        tenantId: 'tenant-a',
        isCreatedByUser: true,
        text: 'competing message anchor',
      },
      {
        messageId: 'expired-upload',
        conversationId,
        user: userId.toString(),
        tenantId: 'tenant-a',
        isCreatedByUser: true,
        text: 'expired attachment',
        files: [{ file_id: 'expired-legacy-source' }],
        expiredAt: new Date(Date.now() - 60_000),
      },
    ]);
    await File.create([
      {
        user: userId,
        tenantId: 'tenant-a',
        file_id: 'anchored-legacy-source',
        bytes: 4,
        filename: 'anchored.pdf',
        filepath: '/uploads/anchored.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        file_id: 'unanchored-legacy-source',
        bytes: 4,
        filename: 'unanchored.pdf',
        filepath: '/uploads/unanchored.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        messageId: 'ambiguous-message',
        file_id: 'duplicate-message-source',
        bytes: 4,
        filename: 'duplicate-message.pdf',
        filepath: '/uploads/duplicate-message.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        file_id: 'expired-legacy-source',
        bytes: 4,
        filename: 'expired-legacy.pdf',
        filepath: '/uploads/expired-legacy.pdf',
        object: 'file',
        type: 'application/pdf',
        source: 'local',
        usage: 0,
      },
    ]);

    const input = {
      userId: userId.toString(),
      tenantId: 'tenant-a',
      conversationId,
      messageId: 'provenance-clicked',
      kind: 'ocr_result' as const,
    };
    expect((await methods.listSteelReviewSources(input)).map((source) => source.fileId)).toEqual([
      'anchored-legacy-source',
    ]);
    expect(await methods.readSteelReviewSource({ ...input, fileId: 'anchored-legacy-source' })).toMatchObject({
      fileId: 'anchored-legacy-source',
      filename: 'anchored.pdf',
    });
    await expect(methods.readSteelReviewSource({ ...input, fileId: 'unanchored-legacy-source' })).resolves.toBeNull();
    await expect(methods.readSteelReviewSource({ ...input, fileId: 'duplicate-message-source' })).resolves.toBeNull();
    await expect(methods.readSteelReviewSource({ ...input, fileId: 'expired-legacy-source' })).resolves.toBeNull();
  });
});
