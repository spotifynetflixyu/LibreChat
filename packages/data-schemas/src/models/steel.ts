import type * as t from '~/types';
import {
  steelAICapabilitySchema,
  steelAIRunSchema,
  steelConversationMetaSchema,
} from '~/schema/steel';

export function createSteelConversationMetaModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.SteelConversationMeta ||
    mongoose.model<t.ISteelConversationMeta>(
      'SteelConversationMeta',
      steelConversationMetaSchema,
      'steel_conversation_meta',
    )
  );
}

export function createSteelAIRunModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.SteelAIRun ||
    mongoose.model<t.ISteelAIRun>('SteelAIRun', steelAIRunSchema, 'steel_ai_runs')
  );
}

export function createSteelAICapabilityModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.SteelAICapability ||
    mongoose.model<t.ISteelAICapability>(
      'SteelAICapability',
      steelAICapabilitySchema,
      'steel_ai_capabilities',
    )
  );
}
