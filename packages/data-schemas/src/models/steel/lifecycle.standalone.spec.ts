import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { fenceSteelConversationWrites } from './lifecycle';
import { createSteelQuotationStateModel } from './index';
import { createConversationModel } from '../convo';

it('fails closed without transactions instead of weakening the deletion fence', async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    const State = createSteelQuotationStateModel(mongoose);
    await State.init();
    await expect(State.create({ userId: 'user', conversationId: 'conversation', nextSignalIndex: 0, tickets: [], pendingMessages: [] }))
      .rejects.toMatchObject({ code: 20 });
    expect(await State.countDocuments({})).toBe(0);
    expect(await mongoose.models.SteelConversationLifecycle.countDocuments({})).toBe(0);
    createConversationModel(mongoose);
    await expect(fenceSteelConversationWrites(mongoose, { userId: 'user', conversationId: 'conversation' }))
      .resolves.toBe(false);
  } finally {
    await mongoose.disconnect();
    await server.stop();
  }
}, 60000);
