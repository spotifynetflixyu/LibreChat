import mongoose from 'mongoose';

import {
  createSteelAICapabilityModel,
  createSteelAIRunModel,
  createSteelConversationMetaModel,
} from '../models/steel';

describe('Steel Mongo schemas', () => {
  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('uses steel_ collection names for Phase 1 state', () => {
    const SteelConversationMeta = createSteelConversationMetaModel(mongoose);
    const SteelAIRun = createSteelAIRunModel(mongoose);
    const SteelAICapability = createSteelAICapabilityModel(mongoose);

    expect(SteelConversationMeta.collection.name).toBe('steel_conversation_meta');
    expect(SteelAIRun.collection.name).toBe('steel_ai_runs');
    expect(SteelAICapability.collection.name).toBe('steel_ai_capabilities');
  });

  it('indexes guest token hash and provider capability lookup fields', () => {
    const SteelConversationMeta = createSteelConversationMetaModel(mongoose);
    const SteelAICapability = createSteelAICapabilityModel(mongoose);

    expect(SteelConversationMeta.schema.indexes()).toContainEqual([
      { guestTokenHash: 1, tenantId: 1 },
      expect.objectContaining({ sparse: true }),
    ]);
    expect(SteelAICapability.schema.indexes()).toContainEqual([
      { provider: 1, model: 1, capability: 1, tenantId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
