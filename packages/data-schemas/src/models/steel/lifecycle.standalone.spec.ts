import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSteelQuotationStateModel } from './index';

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
  } finally {
    await mongoose.disconnect();
    await server.stop();
  }
}, 60000);
