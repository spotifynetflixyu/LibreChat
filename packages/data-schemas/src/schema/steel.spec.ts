import mongoose from 'mongoose';

import {
  createSteelAICapabilityModel,
  createSteelAIRunModel,
  createSteelAuditLogModel,
  createSteelConversationMetaModel,
  createSteelMemoryCandidateModel,
  createSteelSourceVersionModel,
} from '../models/steel';

describe('Steel Mongo schemas', () => {
  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('uses steel_ collection names for Phase 1 state', () => {
    const SteelConversationMeta = createSteelConversationMetaModel(mongoose);
    const SteelAIRun = createSteelAIRunModel(mongoose);
    const SteelAICapability = createSteelAICapabilityModel(mongoose);
    const SteelAuditLog = createSteelAuditLogModel(mongoose);
    const SteelSourceVersion = createSteelSourceVersionModel(mongoose);

    expect(SteelConversationMeta.collection.name).toBe('steel_conversation_meta');
    expect(SteelAIRun.collection.name).toBe('steel_ai_runs');
    expect(SteelAICapability.collection.name).toBe('steel_ai_capabilities');
    expect(SteelAuditLog.collection.name).toBe('steel_audit_logs');
    expect(SteelSourceVersion.collection.name).toBe('steel_source_versions');
  });

  it('indexes account privacy, guest token, and provider capability lookup fields', () => {
    const SteelConversationMeta = createSteelConversationMetaModel(mongoose);
    const SteelAICapability = createSteelAICapabilityModel(mongoose);

    expect(SteelConversationMeta.schema.indexes()).toContainEqual([
      { guestTokenHash: 1 },
      expect.objectContaining({ sparse: true }),
    ]);
    expect(SteelConversationMeta.schema.indexes()).toContainEqual([
      { userId: 1, status: 1, updatedAt: -1 },
      expect.any(Object),
    ]);
    expect(SteelAICapability.schema.indexes()).toContainEqual([
      { provider: 1, model: 1, capability: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('uses unverified capability status and does not keep stale not_run or tenant fields', () => {
    const SteelAICapability = createSteelAICapabilityModel(mongoose);
    const SteelConversationMeta = createSteelConversationMetaModel(mongoose);

    const statusEnum = SteelAICapability.schema.path('status').options.enum;

    expect(statusEnum).toContain('unverified');
    expect(statusEnum).not.toContain('not_run');
    expect(SteelConversationMeta.schema.path('tenantId')).toBeUndefined();
  });

  it('records source version legacy format and conversion metadata', () => {
    const SteelSourceVersion = createSteelSourceVersionModel(mongoose);

    expect(SteelSourceVersion.schema.path('originalFormat').options.enum).toEqual([
      'xlsx',
      'xls',
      'docx',
      'doc',
    ]);
    expect(SteelSourceVersion.schema.path('normalizedFormat').options.enum).toEqual([
      'xlsx',
      'docx',
    ]);
    expect(SteelSourceVersion.schema.path('conversionStatus').options.enum).toEqual([
      'not_required',
      'pending',
      'succeeded',
      'failed',
      'skipped',
    ]);
  });

  it('stores Steel memory candidates as structured rule proposals', () => {
    const SteelMemoryCandidate = createSteelMemoryCandidateModel(mongoose);

    expect(SteelMemoryCandidate.collection.name).toBe('steel_memory_candidates');
    expect(SteelMemoryCandidate.schema.path('proposalType').options.enum).toEqual([
      'customer_default',
      'material_rule',
      'price_override',
      'formula_default',
    ]);
    expect(SteelMemoryCandidate.schema.path('status').options.enum).toEqual([
      'needs_review',
      'reviewed',
      'rejected',
    ]);
    expect(SteelMemoryCandidate.schema.path('chargeType').options.enum).toEqual([
      'material',
      'cutting',
      'hole',
      'slotting',
      'bending',
      'processing',
    ]);
    expect(SteelMemoryCandidate.schema.path('name')).toBeUndefined();
    expect(SteelMemoryCandidate.schema.indexes()).toContainEqual([
      { status: 1, createdAt: -1 },
      expect.any(Object),
    ]);
    expect(SteelMemoryCandidate.schema.indexes()).toContainEqual([
      { createdByUserId: 1, status: 1, updatedAt: -1 },
      expect.any(Object),
    ]);
  });

  it('does not expose legacy workbook or file-analysis Mongo persistence models', async () => {
    const models = await import('../models/steel');

    expect('createSteelWorkbookModel' in models).toBe(false);
    expect('createSteelWorkbookPatchModel' in models).toBe(false);
    expect('createSteelFileAnalysisDataModel' in models).toBe(false);
  });
});
