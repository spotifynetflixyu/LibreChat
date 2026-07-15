import mongoose from 'mongoose';

import {
  createSteelAICapabilityModel,
  createSteelAIRunModel,
  createSteelMemoryCandidateModel,
  createSteelOcrPdfChunkArtifactModel,
  createSteelWorkingOrderMemoryModel,
  createSteelSourceVersionModel,
} from '../models/steel';

describe('Steel Mongo schemas', () => {
  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('uses steel_ collection names for Phase 1 state', () => {
    const SteelAIRun = createSteelAIRunModel(mongoose);
    const SteelAICapability = createSteelAICapabilityModel(mongoose);
    const SteelSourceVersion = createSteelSourceVersionModel(mongoose);
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);

    expect(SteelWorkingOrderMemory.collection.name).toBe('steel_working_order_memory');
    expect(SteelAIRun.collection.name).toBe('steel_ai_runs');
    expect(SteelAICapability.collection.name).toBe('steel_ai_capabilities');
    expect(SteelSourceVersion.collection.name).toBe('steel_source_versions');
  });

  it('stores OCR PDF chunk artifacts with source-PDF chunk identity', () => {
    const SteelOcrPdfChunkArtifact = createSteelOcrPdfChunkArtifactModel(mongoose);

    expect(SteelOcrPdfChunkArtifact.collection.name).toBe('steel_ocr_pdf_chunk_artifacts');
    expect(SteelOcrPdfChunkArtifact.schema.path('sourcePdfKey')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('sourceStorageKey')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('sourceFileId')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('pipelineVersion')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('chunkIndex')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('chunkCount')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('pageStart')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('pageEnd')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('chunkSizePages')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('artifact.storageKey')).toBeDefined();
    expect(SteelOcrPdfChunkArtifact.schema.path('conversationId')).toBeUndefined();
    expect(SteelOcrPdfChunkArtifact.schema.indexes()).toContainEqual([
      {
        sourcePdfKey: 1,
        pipelineVersion: 1,
        chunkSizePages: 1,
        chunkIndex: 1,
        pageStart: 1,
        pageEnd: 1,
      },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('indexes account privacy, guest token, and provider capability lookup fields', () => {
    const SteelAICapability = createSteelAICapabilityModel(mongoose);

    expect(SteelAICapability.schema.indexes()).toContainEqual([
      { provider: 1, model: 1, capability: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('stores Steel working-order memory with checkpoint and active state indexes', () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);

    expect(SteelWorkingOrderMemory.schema.path('memoryKind').options.enum).toEqual([
      'working_order_row',
      'customer_fact',
      'price_evidence',
      'rule_evidence',
      'ocr_extract',
      'paddleocr_preflight',
      'calculation_fact',
    ]);
    expect(SteelWorkingOrderMemory.schema.path('sourceKind').options.enum).toEqual([
      'assistant_final_markdown',
      'tool_result',
      'ocr_result',
      'user_input',
    ]);
    expect(SteelWorkingOrderMemory.schema.path('state').options.enum).toEqual([
      'active',
      'superseded',
    ]);
    expect(SteelWorkingOrderMemory.schema.indexes()).toContainEqual([
      { conversationId: 1, state: 1, memoryKind: 1, turnIndex: 1 },
      expect.any(Object),
    ]);
    expect(SteelWorkingOrderMemory.schema.indexes()).toContainEqual([
      { conversationId: 1, checkpointTurnIndex: 1, state: 1 },
      expect.any(Object),
    ]);
    expect(SteelWorkingOrderMemory.schema.indexes()).toContainEqual([
      {
        conversationId: 1,
        state: 1,
        memoryKind: 1,
        'payload.ocrFileKey': 1,
        'payload.ocrPreprocessing.sourcePdfKey': 1,
        'payload.ocrPreprocessing.pipelineVersion': 1,
        'payload.ocrPreprocessing.chunkIndex': 1,
      },
      expect.any(Object),
    ]);
    expect(SteelWorkingOrderMemory.schema.indexes()).toContainEqual([
      {
        conversationId: 1,
        state: 1,
        memoryKind: 1,
        'payload.kind': 1,
        'payload.ocrSource': 1,
        'payload.ocrFileKey': 1,
        'payload.ocrPreprocessing.sourcePdfKey': 1,
        'payload.ocrPreprocessing.ocrRuleVersion': 1,
        'payload.ocrPreprocessing.pipelineVersion': 1,
        turnIndex: -1,
        createdAt: -1,
      },
      expect.any(Object),
    ]);
  });

  it('uses unverified capability status and does not keep stale not_run or tenant fields', () => {
    const SteelAICapability = createSteelAICapabilityModel(mongoose);

    const statusEnum = SteelAICapability.schema.path('status').options.enum;

    expect(statusEnum).toContain('unverified');
    expect(statusEnum).not.toContain('not_run');
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
