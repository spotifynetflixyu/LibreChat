import {
  resolveNextSteelOutputSheets,
  prepareSteelRuntimeContext,
  serializeSteelRuntimeContext,
  steelRuntimeActiveOutputSheetIds,
} from './context';

import type { SteelOAuthChatFile } from '../ai/provider';
import type { SteelQuoteDefault } from '../repositories/defaults';
import type { SteelInstructionPacket } from '../repositories/instructions';
import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';
import type {
  FullActiveSteelOutputSheets,
  GeneratedSteelOutputSheet,
  PrepareSteelRuntimeContextInput,
  SteelRuntimeContextDependencies,
  SteelOutputSheetMemorySnapshot,
} from './context';

const activeSheetIds = [
  'system_order',
  'customer_data',
  'manual_review',
  'customer_quote',
] as const;

const sourceRefs = [
  {
    channel: 'repo_docs',
    factType: 'agent_rule',
    canonicalKey: 'runtime_context_fixture',
  },
];

function createAgentRule(overrides: Partial<SteelAgentRule> = {}): SteelAgentRule {
  return {
    id: 1,
    slug: 'steel-default-agent-instruction',
    version: 1,
    ruleType: 'agent_instruction_rule',
    title: 'Steel default agent instruction',
    locale: 'zh-TW',
    ruleSections: ['agent_instruction'],
    selectors: { appliesTo: ['steel_quote_runtime'] },
    prompt: 'Fixture agent instruction',
    toolPolicy: { availableTools: ['search_customers'] },
    outputPolicy: null,
    priority: 10,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
    ...overrides,
  };
}

function createInstructionPacket(): SteelInstructionPacket {
  return {
    id: 11,
    slug: 'plate-runtime-packet',
    version: 1,
    title: 'Plate runtime packet',
    locale: 'zh-TW',
    packetGroups: ['quote_rules', 'plate'],
    selectors: { catalogFamily: 'plate' },
    instruction: 'Fixture instruction packet',
    blockingRules: [],
    requiredLookups: [],
    userVisibleNotes: [],
    confirmationQuestions: [],
    priority: 20,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
  };
}

function createQuoteDefault(): SteelQuoteDefault {
  return {
    id: 21,
    defaultType: 'customer_tier_default',
    originTable: 'docs/rules/輸出規則.txt',
    originId: 'default-tier-b',
    originRevision: '1',
    scopeType: 'company',
    customerId: null,
    customerTierId: null,
    catalogFamily: undefined,
    productFamily: undefined,
    chargeType: undefined,
    formulaCode: undefined,
    selector: { appliesTo: ['steel_quote_runtime'] },
    effect: 'default_customer_tier',
    defaultParameters: { tierCode: 'B' },
    priority: 30,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
  };
}

function createQuoteRule(): SteelQuoteRule {
  return {
    id: 31,
    ruleType: 'formula_rule',
    scopeType: 'catalog_family',
    catalogFamily: 'plate',
    productFamily: 'laser_cut',
    chargeType: 'cutting',
    formulaCode: 'PL',
    selectors: { catalogFamily: 'plate' },
    parameters: { density: 7.85 },
    prompt: 'Fixture quote rule',
    priority: 40,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
  };
}

function createWorkbookOutputRule(): SteelAgentRule {
  return createAgentRule({
    id: 41,
    slug: 'steel-workbook-output-policy',
    ruleType: 'workbook_output_rule',
    ruleSections: ['workbook_output'],
    outputPolicy: {
      activeSheets: [...activeSheetIds],
      missingSheetBehavior: 'carry_forward_previous_active_sheet',
      emittedSheetBehavior: 'replace_previous_active_sheet',
      omittedRowsInEmittedSheet: 'clear_or_delete',
      defaultCustomerTierWhenUncertain: 'B',
      synchronizedSheetsOnCustomerTierChange: ['system_order', 'customer_quote'],
    },
  });
}

function createOcrRule(): SteelAgentRule {
  return createAgentRule({
    id: 51,
    slug: 'steel-drawing-ocr-policy',
    ruleType: 'inference_order_rule',
    ruleSections: ['file_ocr', 'drawing_ocr', 'vision_evidence'],
    selectors: { sourceKinds: ['image', 'pdf', 'scanned_pdf'] },
  });
}

function createSheet(
  sheetId: keyof FullActiveSteelOutputSheets,
  rowIds: readonly string[],
): FullActiveSteelOutputSheets[keyof FullActiveSteelOutputSheets] {
  return {
    sheetId,
    rows: rowIds.map((rowId) => ({
      rowId,
      cells: {
        rowId,
        sheetId,
      },
    })),
  };
}

function createPreviousOutputSheets(): FullActiveSteelOutputSheets {
  return {
    system_order: createSheet('system_order', ['system_order:previous:1']),
    customer_data: createSheet('customer_data', ['customer_data:previous:1']),
    manual_review: createSheet('manual_review', ['manual_review:previous:1']),
    customer_quote: createSheet('customer_quote', [
      'customer_quote:previous:1',
      'customer_quote:previous:2',
    ]),
  };
}

function createRuntimeMemorySnapshot(): SteelOutputSheetMemorySnapshot {
  return {
    previousOutputSheets: {
      system_order: {
        sheetId: 'system_order',
        rows: [
          {
            rowId: 'system_order:1',
            cells: {
              項次: '1',
              型號: 'CCG075',
              品名規格: '錏輕型鋼 75x45',
              內部備註: 'full-row-only-note',
            },
          },
        ],
      },
      customer_data: {
        sheetId: 'customer_data',
        rows: [
          {
            rowId: 'customer_data:1',
            cells: {
              客戶名稱: '龍頂',
              計價基準: 'B',
            },
          },
        ],
      },
      manual_review: {
        sheetId: 'manual_review',
        rows: [
          {
            rowId: 'manual_review:1',
            cells: {
              項目: '尺寸待確認',
            },
          },
        ],
      },
      customer_quote: {
        sheetId: 'customer_quote',
        rows: [
          {
            rowId: 'customer_quote:1',
            cells: {
              項次: '1',
              小計: '536',
            },
          },
        ],
      },
    },
    derivedIndex: {
      lineItems: [
        {
          rowNo: 1,
          erpItemCode: 'CCG075',
          productName: '錏輕型鋼 75x45',
          quantity: 2,
        },
      ],
      customers: [
        {
          displayName: '龍頂',
          customerTierId: 2,
        },
      ],
      adoptedPrices: [
        {
          erpItemCode: 'CCG075',
          unitPrice: 268,
          customerTierId: 2,
        },
      ],
      calculations: [
        {
          rowNo: 1,
          subtotal: 536,
        },
      ],
      ocrExtracts: [],
      unresolvedItems: [
        {
          rowNo: 1,
          reason: '尺寸待確認',
        },
      ],
    },
  };
}

function createRuntimeDependencies(
  memorySnapshot: SteelOutputSheetMemorySnapshot = createRuntimeMemorySnapshot(),
): SteelRuntimeContextDependencies {
  return {
    listAgentRules: jest.fn(async () => [createAgentRule()]),
    listReviewedInstructionPackets: jest.fn(async () => [createInstructionPacket()]),
    listReviewedQuoteDefaults: jest.fn(async () => [createQuoteDefault()]),
    listReviewedQuoteRules: jest.fn(async () => [createQuoteRule()]),
    listOutputRules: jest.fn(async () => [createWorkbookOutputRule()]),
    listOtherGlobalRules: jest.fn(async () => ({
      ocrRules: [createOcrRule()],
      fileRules: [createAgentRule({ id: 61, slug: 'steel-file-policy' })],
      sourcePriorityRules: [createAgentRule({ id: 62, slug: 'steel-source-priority' })],
      markdownOutputRules: [createAgentRule({ id: 63, slug: 'steel-markdown-output-policy' })],
    })),
    readOutputSheetMemory: jest.fn(async (): Promise<SteelOutputSheetMemorySnapshot> => memorySnapshot),
  };
}

async function prepareContext(
  files: SteelOAuthChatFile[] = [],
  _mode?: 'compact_workbook',
  historyFiles: SteelOAuthChatFile[] = [],
  priorActiveFileEvidence: Record<string, string>[] = [],
  memorySnapshot: SteelOutputSheetMemorySnapshot = createRuntimeMemorySnapshot(),
  currentPaddleOcrResults: Record<string, unknown>[] = [],
) {
  const dependencies = createRuntimeDependencies(memorySnapshot);
  const input: PrepareSteelRuntimeContextInput = {
    conversation: {
      conversationId: 'steel_conversation_1',
      requestId: 'request_1',
      activeHistory: [
        {
          role: 'user',
          content: '請報價',
          ...(historyFiles.length > 0 ? { files: historyFiles } : {}),
        },
      ],
      currentUserTurn: { role: 'user', content: '請報價' },
    },
    attachments: {
      currentTurnFiles: files,
      priorActiveFileEvidence,
      currentPaddleOcrResults,
    },
    dependencies,
  };
  const context = await prepareSteelRuntimeContext(input);

  return { context, dependencies };
}

describe('Steel runtime context', () => {
  it('loads agent rules and all reviewed global Steel rules through no-keyword loaders', async () => {
    const { context, dependencies } = await prepareContext();

    expect(dependencies.listAgentRules).toHaveBeenCalledWith();
    expect(dependencies.listReviewedInstructionPackets).toHaveBeenCalledWith();
    expect(dependencies.listReviewedQuoteDefaults).toHaveBeenCalledWith();
    expect(dependencies.listReviewedQuoteRules).toHaveBeenCalledWith();
    expect(dependencies.listOutputRules).toHaveBeenCalledWith();
    expect(context.rules.agentRules.map((rule) => rule.slug)).toEqual([
      'steel-default-agent-instruction',
    ]);
    expect(context.rules.steelGlobalRules.instructionPackets.map((packet) => packet.slug)).toEqual([
      'plate-runtime-packet',
    ]);
    expect(context.rules.steelGlobalRules.quoteDefaults.map((rule) => rule.originId)).toEqual([
      'default-tier-b',
    ]);
    expect(context.rules.steelGlobalRules.quoteRules.map((rule) => rule.catalogFamily)).toEqual([
      'plate',
    ]);
    expect(context.rules.outputRules.map((rule) => rule.slug)).toEqual([
      'steel-workbook-output-policy',
    ]);
  });

  it('keeps full Runtime Output Sheet Context rows for only the four active output sheets', async () => {
    const { context } = await prepareContext();

    expect(steelRuntimeActiveOutputSheetIds).toEqual(activeSheetIds);
    expect(context.outputSheets.activeOnly).toBe(true);
    expect(context.outputSheets.memoryName).toBe('Output Sheet Memory');
    expect(context.outputSheets.contextName).toBe('Runtime Output Sheet Context');
    expect(context.outputSheets.sheetIds).toEqual(activeSheetIds);
    expect(Object.keys(context.outputSheets.previousOutputSheets)).toEqual(activeSheetIds);
    expect(context.outputSheets).not.toHaveProperty('resultCount');
    expect(context.outputSheets).not.toHaveProperty('summary');
    expect(context.outputSheets.previousOutputSheets.system_order.rows).toEqual([
      expect.objectContaining({
        cells: expect.objectContaining({
          型號: 'CCG075',
        }),
      }),
    ]);
    expect(context.outputSheets.derivedIndex.lineItems).toEqual([
      expect.objectContaining({
        rowNo: 1,
        erpItemCode: 'CCG075',
      }),
    ]);
  });

  it('loads OCR rules as part of other global rules regardless of attachment evidence', async () => {
    const noFileResult = await prepareContext();
    const pdfFile: SteelOAuthChatFile = {
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
      data: new Uint8Array([1, 2, 3]),
    };
    const fileResult = await prepareContext([pdfFile]);
    const historyFileResult = await prepareContext([], undefined, [pdfFile]);
    const evidenceResult = await prepareContext([], undefined, [], [{ filename: 'drawing.pdf' }]);

    expect(noFileResult.context.attachments).not.toHaveProperty('includeOcrRules');
    expect(noFileResult.context.rules.otherGlobalRules.ocrRules.map((rule) => rule.slug)).toEqual([
      'steel-drawing-ocr-policy',
    ]);
    expect(noFileResult.dependencies.listOtherGlobalRules).toHaveBeenCalledWith();
    expect(fileResult.context.attachments).not.toHaveProperty('includeOcrRules');
    expect(fileResult.context.rules.otherGlobalRules.ocrRules?.map((rule) => rule.slug)).toEqual([
      'steel-drawing-ocr-policy',
    ]);
    expect(fileResult.dependencies.listOtherGlobalRules).toHaveBeenCalledWith();
    expect(historyFileResult.context.attachments).not.toHaveProperty('includeOcrRules');
    expect(
      historyFileResult.context.rules.otherGlobalRules.ocrRules?.map((rule) => rule.slug),
    ).toEqual(['steel-drawing-ocr-policy']);
    expect(evidenceResult.context.attachments).not.toHaveProperty('includeOcrRules');
  });

  it('reuses active OCR extracts from structured state on follow-up turns', async () => {
    const ocrExtract = {
      filename: 'drawing.pdf',
      page: 1,
      textPreview: '孔徑 12mm, 折彎 2 道',
      ocrEngine: 'PaddleOCR MCP',
    };
    const memorySnapshot = createRuntimeMemorySnapshot();
    memorySnapshot.derivedIndex.ocrExtracts = [ocrExtract];

    const { context, dependencies } = await prepareContext(
      [],
      undefined,
      [],
      [],
      memorySnapshot,
    );

    expect(context.attachments.priorActiveFileEvidence).toEqual([
      expect.objectContaining({
        filename: 'drawing.pdf',
        page: 1,
        ocrEngine: 'PaddleOCR MCP',
      }),
    ]);
    expect(context.attachments).not.toHaveProperty('includeOcrRules');
    expect(context.rules.otherGlobalRules.ocrRules?.map((rule) => rule.slug)).toEqual([
      'steel-drawing-ocr-policy',
    ]);
    expect(dependencies.listOtherGlobalRules).toHaveBeenCalledWith();
  });

  it('includes current PaddleOCR raw preflight results without relying on follow-up memory context', async () => {
    const currentPaddleOcrResults = [
      {
        ocrFileKey: 'file:file-a',
        filename: 'drawing.pdf',
        ocrSource: 'paddleocr_mcp',
        result: { text: 'raw paddleocr text' },
      },
    ];
    const { context } = await prepareContext(
      [],
      undefined,
      [],
      [],
      createRuntimeMemorySnapshot(),
      currentPaddleOcrResults,
    );
    const serialized = JSON.parse(serializeSteelRuntimeContext(context));

    expect(context.attachments.currentPaddleOcrResults).toEqual(currentPaddleOcrResults);
    expect(context.attachments.priorActiveFileEvidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ ocrSource: 'paddleocr_mcp' })]),
    );
    expect(serialized.attachments.currentPaddleOcrResults).toEqual(currentPaddleOcrResults);
  });

  it('serializes workbook output rules as backend sheet carry-forward and emitted-sheet replacement policy', async () => {
    const { context } = await prepareContext();
    const serialized = JSON.parse(serializeSteelRuntimeContext(context));
    const outputPolicy = serialized.rules.outputRules[0].outputPolicy;

    expect(outputPolicy).toEqual({
      activeSheets: [...activeSheetIds],
      missingSheetBehavior: 'carry_forward_previous_active_sheet',
      emittedSheetBehavior: 'replace_previous_active_sheet',
      omittedRowsInEmittedSheet: 'clear_or_delete',
      defaultCustomerTierWhenUncertain: 'B',
      synchronizedSheetsOnCustomerTierChange: ['system_order', 'customer_quote'],
    });
  });

  it('serializes default context with stable rules and tool policy before volatile context', async () => {
    const { context } = await prepareContext();
    const serializedText = serializeSteelRuntimeContext(context);
    const serialized = JSON.parse(serializedText);

    expect(Object.keys(serialized)).toEqual([
      'rules',
      'toolPolicy',
      'outputSheets',
      'conversation',
      'attachments',
    ]);
    expect(Object.keys(serialized.rules)).toEqual([
      'agentRules',
      'steelGlobalRules',
      'outputRules',
      'otherGlobalRules',
    ]);
  });

  it('serializes the reduced AI-visible tool policy with read_markdown always available', async () => {
    const { context } = await prepareContext();
    const serialized = JSON.parse(serializeSteelRuntimeContext(context));

    expect(context.toolPolicy.aiVisibleTools).toEqual([
      'search_customers',
      'search_price_candidates',
      'read_markdown',
    ]);
    expect(context.toolPolicy.removedTools).toEqual([]);
    expect(serialized.toolPolicy).toEqual(context.toolPolicy);
  });

  it('serializes compact workbook mode without full active sheet rows but with compact row indexes', async () => {
    const { context } = await prepareContext();
    const serializedText = serializeSteelRuntimeContext(context);
    const serialized = JSON.parse(serializedText);

    expect(serialized.outputSheets.contextMode).toBe('compact_workbook');
    expect(serialized.outputSheets.previousOutputSheets.system_order).toEqual({
      sheetId: 'system_order',
      rowCount: 1,
    });
    expect(serialized.outputSheets).not.toHaveProperty('derivedIndex');
    expect(serializedText).not.toContain('full-row-only-note');
    expect(serialized.outputSheets.compactWorkbook.sheets.system_order.rows).toEqual([
      expect.objectContaining({
        rowId: 'system_order:1',
        rowIndex: 1,
        anchors: expect.objectContaining({
          型號: 'CCG075',
          品名規格: '錏輕型鋼 75x45',
        }),
      }),
    ]);
    expect(serialized.outputSheets.compactWorkbook.sheets.customer_quote.rowCount).toBe(1);
    expect(serialized.toolPolicy.aiVisibleTools).toEqual([
      'search_customers',
      'search_price_candidates',
      'read_markdown',
    ]);
    expect(serialized.toolPolicy.readMarkdownUsagePolicy).toEqual({
      requiresMissingMarkdownInHistory: true,
      forbiddenWhenHistoryHasNeededMarkdown: true,
      allowedScopes: ['workbook', 'ocr'],
      currentConversationScoped: true,
      fileKeyParameter: 'fileKey',
      ocrFileKeyParameter: 'ocrFileKey',
      defaultWorkbookFileKey: 'default',
      fileKeyRecommendedWhenMultipleOrders: true,
      ocrFileKeyRecommendedForFullContent: true,
    });
  });

  it('carries forward active sheets that are wholly missing from generated output', () => {
    const previousOutputSheets = createPreviousOutputSheets();
    const generatedSheets: GeneratedSteelOutputSheet[] = [
      createSheet('customer_quote', ['customer_quote:generated:1']),
    ];

    const result = resolveNextSteelOutputSheets({
      previousOutputSheets,
      generatedSheets,
    });

    expect(result.system_order).toEqual(previousOutputSheets.system_order);
    expect(result.customer_data).toEqual(previousOutputSheets.customer_data);
    expect(result.manual_review).toEqual(previousOutputSheets.manual_review);
    expect(result.customer_quote.rows).toEqual([
      expect.objectContaining({ rowId: 'customer_quote:generated:1' }),
    ]);
  });

  it('treats an emitted sheet as a full replacement instead of a row merge', () => {
    const previousOutputSheets = createPreviousOutputSheets();
    const generatedSheets: GeneratedSteelOutputSheet[] = [
      createSheet('customer_quote', ['customer_quote:generated:1']),
    ];

    const result = resolveNextSteelOutputSheets({
      previousOutputSheets,
      generatedSheets,
    });

    expect(result.customer_quote.rows).toHaveLength(1);
    expect(result.customer_quote.rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowId: 'customer_quote:previous:1' }),
        expect.objectContaining({ rowId: 'customer_quote:previous:2' }),
      ]),
    );
  });

  it('allows an emitted empty sheet to clear prior rows for that sheet only', () => {
    const previousOutputSheets = createPreviousOutputSheets();
    const generatedSheets: GeneratedSteelOutputSheet[] = [
      {
        sheetId: 'manual_review',
        rows: [],
      },
    ];

    const result = resolveNextSteelOutputSheets({
      previousOutputSheets,
      generatedSheets,
    });

    expect(result.manual_review.rows).toEqual([]);
    expect(result.system_order).toEqual(previousOutputSheets.system_order);
    expect(result.customer_data).toEqual(previousOutputSheets.customer_data);
    expect(result.customer_quote).toEqual(previousOutputSheets.customer_quote);
  });
});
