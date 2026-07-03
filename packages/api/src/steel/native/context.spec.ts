import {
  buildDefaultSteelGlobalAgentContext,
  buildSteelGlobalAgentContext,
  createSteelContextDependencies,
  prepareLibreChatSteelChatContext,
  steelNativeDefaultRuntimeContextMode,
  steelNativeInstructionPrefixSections,
  type SteelNativeFileReference,
} from './context';
import {
  createEmptySteelOutputSheetMemorySnapshot,
  serializeSteelRuntimeContext,
} from '../runtime/context';

import type { SteelQuoteDefault } from '../repositories/defaults';
import type { SteelInstructionPacket } from '../repositories/instructions';
import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';
import type {
  SteelRuntimeContextDependencies,
  SteelRuntimeJsonObject,
  SteelOutputSheetMemorySnapshot,
} from '../runtime/context';
import type { SteelRepositoryClient } from '../repositories/types';

const sourceRefs = [
  {
    channel: 'repo_docs',
    factType: 'native_context_fixture',
    canonicalKey: 'phase_1_native_context',
  },
];

function createAgentRule(overrides: Partial<SteelAgentRule> = {}): SteelAgentRule {
  return {
    id: 1,
    slug: 'steel-reviewed-agent-rule',
    version: 1,
    ruleType: 'agent',
    title: 'Steel reviewed agent rule',
    locale: 'zh-TW',
    ruleSections: ['agent_instruction'],
    selectors: null,
    prompt: 'Fixture reviewed agent rule.',
    toolPolicy: null,
    outputPolicy: null,
    priority: 10,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
    ...overrides,
  };
}

function createQuoteDefault(): SteelQuoteDefault {
  return {
    id: 2,
    defaultType: 'customer_tier_default',
    originTable: 'steel.quote_defaults',
    originId: 'default-tier-b',
    originRevision: '1',
    scopeType: 'company',
    customerId: null,
    customerTierId: null,
    selector: null,
    effect: 'default_customer_tier',
    defaultParameters: { tierCode: 'B' },
    priority: 20,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
  };
}

function createQuoteRule(): SteelQuoteRule {
  return {
    id: 3,
    ruleType: 'formula_rule',
    scopeType: 'catalog_family',
    catalogFamily: 'plate',
    productFamily: 'laser_cut',
    chargeType: 'cutting',
    formulaCode: 'PL',
    selectors: { catalogFamily: 'plate' },
    parameters: { density: 7.85 },
    prompt: 'Fixture quote rule.',
    priority: 30,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
  };
}

function createInstructionPacket(): SteelInstructionPacket {
  return {
    id: 4,
    slug: 'steel-instruction-packet',
    version: 1,
    title: 'Steel instruction packet',
    locale: 'zh-TW',
    packetGroups: ['quote'],
    selectors: null,
    instruction: 'Fixture instruction packet.',
    blockingRules: [],
    requiredLookups: [],
    userVisibleNotes: [],
    confirmationQuestions: [],
    priority: 40,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
  };
}

function createRuntimeDependencies(): SteelRuntimeContextDependencies {
  return {
    listAgentRules: jest.fn(async () => [createAgentRule()]),
    listReviewedInstructionPackets: jest.fn(async () => [createInstructionPacket()]),
    listReviewedQuoteDefaults: jest.fn(async () => [createQuoteDefault()]),
    listReviewedQuoteRules: jest.fn(async () => [createQuoteRule()]),
    listOutputRules: jest.fn(async () => [
      createAgentRule({
        id: 5,
        slug: 'steel-output-rule',
        ruleType: 'output',
        ruleSections: ['workbook_output'],
      }),
    ]),
    listOtherGlobalRules: jest.fn(async () => ({
      ocrRules: [
        createAgentRule({
          id: 6,
          slug: 'steel-drawing-ocr-policy',
          ruleType: 'other',
          ruleSections: ['file_ocr', 'drawing_ocr'],
        }),
      ],
      fileRules: [
        createAgentRule({
          id: 7,
          slug: 'steel-file-policy',
          ruleType: 'other',
          ruleSections: ['file_policy'],
        }),
      ],
      sourcePriorityRules: [
        createAgentRule({
          id: 8,
          slug: 'steel-source-priority-policy',
          ruleType: 'other',
          ruleSections: ['source_priority'],
        }),
      ],
      markdownOutputRules: [
        createAgentRule({
          id: 9,
          slug: 'steel-markdown-output-policy',
          ruleType: 'other',
          ruleSections: ['markdown_output'],
        }),
      ],
    })),
    readOutputSheetMemory: jest.fn(
      async (): Promise<SteelOutputSheetMemorySnapshot> =>
        createEmptySteelOutputSheetMemorySnapshot(),
    ),
  };
}

async function buildFixtureContext({
  fileReference,
  currentUserContent = '請依附件報價',
  currentPaddleOcrResults,
  currentOcrMarkdownResults,
  priorActiveFileEvidence,
}: {
  fileReference?: SteelNativeFileReference;
  currentUserContent?: string;
  currentPaddleOcrResults?: readonly SteelRuntimeJsonObject[];
  currentOcrMarkdownResults?: readonly SteelRuntimeJsonObject[];
  priorActiveFileEvidence?: readonly SteelRuntimeJsonObject[];
} = {}) {
  const dependencies = createRuntimeDependencies();
  const attachments =
    fileReference !== undefined ||
    currentPaddleOcrResults !== undefined ||
    currentOcrMarkdownResults !== undefined ||
    priorActiveFileEvidence !== undefined
      ? {
          ...(fileReference ? { currentTurnFiles: [fileReference] } : {}),
          ...(currentPaddleOcrResults ? { currentPaddleOcrResults } : {}),
          ...(currentOcrMarkdownResults ? { currentOcrMarkdownResults } : {}),
          ...(priorActiveFileEvidence ? { priorActiveFileEvidence } : {}),
        }
      : undefined;
  const context = await buildSteelGlobalAgentContext({
    conversation: {
      conversationId: 'conversation_1',
      requestId: 'request_1',
      activeHistory: [
        {
          role: 'user',
          content: '前一輪訊息',
          messageId: 'message_1',
        },
      ],
      currentUserTurn: {
        role: 'user',
        content: currentUserContent,
        messageId: 'message_2',
        files: fileReference ? [fileReference] : undefined,
      },
    },
    attachments,
    dependencies,
  });

  return { context, dependencies };
}

describe('Steel native context adapter', () => {
  it('prepares LibreChat-native history without duplicating the current user turn', () => {
    const currentTurnFile: SteelNativeFileReference = {
      fileId: 'file_current_pdf',
      source: 'librechat_file_record',
      mediaType: 'application/pdf',
      conversationId: 'conversation_1',
      messageId: 'message_user_2',
      filename: 'PL.pdf',
    };
    const prepared = prepareLibreChatSteelChatContext({
      conversationId: 'conversation_1',
      requestId: 'request_1',
      activeHistory: [
        {
          role: 'assistant',
          content: 'OCR_TABLE_SENTINEL_9f5c',
          messageId: 'message_assistant_1',
        },
        {
          role: 'user',
          content: 'CONFIRMED_OCR_SENTINEL_7c2a',
          messageId: 'message_user_2',
          files: [currentTurnFile],
        },
      ],
      currentUserTurn: {
        role: 'user',
        content: 'CONFIRMED_OCR_SENTINEL_7c2a',
        messageId: 'message_user_2',
        files: [currentTurnFile],
      },
    });

    expect(prepared.activeHistory.map((message) => message.messageId)).toEqual([
      'message_assistant_1',
    ]);
    expect(prepared.currentUserTurn).toEqual(
      expect.objectContaining({
        role: 'user',
        messageId: 'message_user_2',
        files: [currentTurnFile],
      }),
    );
  });

  it('serializes LibreChat-native message references without repeating history content', async () => {
    const dependencies = createRuntimeDependencies();
    const context = await buildDefaultSteelGlobalAgentContext({
      conversation: {
        conversationId: 'conversation_1',
        requestId: 'request_1',
        activeHistory: [
          {
            role: 'assistant',
            content: 'OCR_TABLE_SENTINEL_9f5c',
            messageId: 'message_assistant_1',
          },
          {
            role: 'user',
            content: 'CONFIRMED_OCR_SENTINEL_7c2a',
            messageId: 'message_user_2',
          },
        ],
        currentUserTurn: {
          role: 'user',
          content: 'CONFIRMED_OCR_SENTINEL_7c2a',
          messageId: 'message_user_2',
        },
      },
      dependencies,
    });
    const serialized = JSON.parse(serializeSteelRuntimeContext(context.runtimeContext));

    expect(serialized.conversation.activeHistory).toEqual([
      expect.objectContaining({
        role: 'assistant',
        messageId: 'message_assistant_1',
        contentSource: 'provider_messages',
      }),
    ]);
    expect(serialized.conversation.activeHistory[0]).not.toHaveProperty('content');
    expect(serialized.conversation.currentUserTurn).toEqual(
      expect.objectContaining({
        role: 'user',
        messageId: 'message_user_2',
        contentSource: 'provider_messages',
      }),
    );
    expect(serialized.conversation.currentUserTurn).not.toHaveProperty('content');
  });

  it('builds instruction prefix slots in the fixed native Steel order', async () => {
    const { context } = await buildFixtureContext();
    const sections = context.instructionPrefixSections;

    expect(sections.map((section) => section.section)).toEqual([
      ...steelNativeInstructionPrefixSections,
    ]);
    expect(sections.find((section) => section.section === 'agent')?.itemCount).toBe(1);
    expect(sections.find((section) => section.section === 'quote_rules')?.itemCount).toBe(2);
    expect(sections.find((section) => section.section === 'output')?.itemCount).toBe(1);
    expect(sections.find((section) => section.section === 'other')?.itemCount).toBe(4);
    expect(sections.map((section) => section.section)).not.toEqual(
      expect.arrayContaining(['tool_policy', 'reviewed_agent_rules', 'instruction_packets']),
    );
  });

  it('defaults native runtime context to compact workbook mode with diagnostic metadata', async () => {
    const { context } = await buildFixtureContext();

    expect(context.runtimeContext.outputSheets.contextMode).toBe(
      steelNativeDefaultRuntimeContextMode,
    );
    expect(context.metadata).toEqual(
      expect.objectContaining({
        nativeContextVersion: 1,
        contextMode: 'compact_workbook',
          renderProfile: 'agent_client',
          globalApplied: true,
          attachmentBytePolicy: 'metadata_references_only',
          ocrExecutionPolicy: 'direct_paddleocr_mcp',
        }),
    );
    expect(context.contextSlots).toEqual({
      instructionPrefix: 'top_of_context',
      runtimeContext: 'dynamic_system_tail',
    });
  });

  it('includes OCR/file rules globally while keeping attachments as metadata references', async () => {
    const fileReference: SteelNativeFileReference = {
      fileId: 'file_1',
      source: 'librechat_file_record',
      mediaType: 'application/pdf',
      conversationId: 'conversation_1',
      messageId: 'message_2',
      filename: 'drawing.pdf',
      pageCount: 2,
    };
    const { context, dependencies } = await buildFixtureContext({ fileReference });

    expect(dependencies.listOtherGlobalRules).toHaveBeenCalledWith();
    expect(context.runtimeContext.attachments).not.toHaveProperty('includeOcrRules');
    expect(context.runtimeContext.attachments.currentTurnFiles).toEqual([fileReference]);
    expect(context.attachmentReferences).toEqual([fileReference]);
    expect(Object.keys(context.attachmentReferences[0])).not.toContain('data');
    expect(context.runtimeContext.toolPolicy.aiVisibleTools).not.toContain('run_file_ocr');
  });

  it('passes same-turn PaddleOCR raw preflight results through native runtime context only', async () => {
    const currentPaddleOcrResults = [
      {
        ocrFileKey: 'file:file_1',
        filename: 'drawing.pdf',
        ocrSource: 'paddleocr_mcp',
        result: { text: 'raw OCR text' },
      },
    ];
    const { context } = await buildFixtureContext({ currentPaddleOcrResults });
    const serialized = JSON.parse(serializeSteelRuntimeContext(context.runtimeContext));

    expect(context.runtimeContext.attachments.currentPaddleOcrResults).toEqual(
      currentPaddleOcrResults,
    );
    expect(context.runtimeContext.attachments.priorActiveFileEvidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ ocrSource: 'paddleocr_mcp' })]),
    );
    expect(context.runtimeContext.toolPolicy.currentPaddleOcrUsagePolicy).toContain(
      'currentPaddleOcrResults',
    );
    expect(context.runtimeContext.toolPolicy.currentPaddleOcrUsagePolicy).toContain(
      'do not call read_markdown',
    );
    expect(context.runtimeContext.toolPolicy.currentPaddleOcrUsagePolicy).toContain(
      'do not call paddleocr_vl',
    );
    expect(serialized.attachments.currentPaddleOcrResults).toEqual(currentPaddleOcrResults);
    expect(serialized.toolPolicy.currentPaddleOcrUsagePolicy).toContain(
      'currentPaddleOcrResults',
    );
  });

  it('passes same-turn organized OCR Markdown through native runtime context', async () => {
    const currentOcrMarkdownResults = [
      {
        ocrFileKey: 'file:file_1',
        filename: 'drawing.pdf',
        ocrSource: 'ocr_preprocessing_merge',
        content: '| 品名 | 數量 |\n|---|---:|\n| 鐵板 | 2 |',
      },
    ];
    const { context } = await buildFixtureContext({ currentOcrMarkdownResults });
    const serialized = JSON.parse(serializeSteelRuntimeContext(context.runtimeContext));

    expect(context.runtimeContext.attachments.currentOcrMarkdownResults).toEqual(
      currentOcrMarkdownResults,
    );
    expect(context.runtimeContext.toolPolicy.currentOcrMarkdownUsagePolicy).toContain(
      'currentOcrMarkdownResults',
    );
    expect(serialized.attachments.currentOcrMarkdownResults).toEqual(currentOcrMarkdownResults);
  });

  it('passes a 3-chunk merged OCR Markdown result to Steel agent context as one file payload', async () => {
    const mergedMarkdown = [
      '| chunk | pages | part |',
      '| --- | --- | --- |',
      '| 1 | 1-50 | BH_CHUNK_1_SENTINEL |',
      '| 2 | 51-100 | BH_CHUNK_2_SENTINEL |',
      '| 3 | 101-106 | BH_CHUNK_3_SENTINEL |',
    ].join('\n');
    const currentOcrMarkdownResults = [
      {
        ocrFileKey: 'file:BH.pdf',
        fileId: 'BH.pdf',
        filename: 'BH.pdf',
        mediaType: 'application/pdf',
        ocrSource: 'ocr_preprocessing_merge',
        chunkCount: 3,
        chunkSizePages: 50,
        content: mergedMarkdown,
      },
    ];
    const { context } = await buildFixtureContext({
      currentOcrMarkdownResults,
      currentPaddleOcrResults: [],
    });
    const serialized = JSON.parse(serializeSteelRuntimeContext(context.runtimeContext));
    const serializedOcrResults = serialized.attachments.currentOcrMarkdownResults;

    expect(context.runtimeContext.attachments.currentPaddleOcrResults).toEqual([]);
    expect(context.runtimeContext.attachments.currentOcrMarkdownResults).toHaveLength(1);
    expect(context.runtimeContext.attachments.currentOcrMarkdownResults[0]).toEqual(
      expect.objectContaining({
        ocrFileKey: 'file:BH.pdf',
        ocrSource: 'ocr_preprocessing_merge',
        chunkCount: 3,
        content: mergedMarkdown,
      }),
    );
    expect(serializedOcrResults).toHaveLength(1);
    expect(serializedOcrResults[0].content).toContain('BH_CHUNK_1_SENTINEL');
    expect(serializedOcrResults[0].content).toContain('BH_CHUNK_2_SENTINEL');
    expect(serializedOcrResults[0].content).toContain('BH_CHUNK_3_SENTINEL');
    expect(serialized.attachments.currentPaddleOcrResults).toEqual([]);
  });

  it('builds default native context with injected dependencies for JS callers', async () => {
    const dependencies = createRuntimeDependencies();
    const context = await buildDefaultSteelGlobalAgentContext({
      conversation: {
        conversationId: 'conversation_1',
        requestId: 'request_1',
        activeHistory: [
          {
            role: 'user',
            content: '請依表單報價',
            messageId: 'message_1',
          },
        ],
        currentUserTurn: {
          role: 'user',
          content: '請依表單報價',
          messageId: 'message_1',
        },
      },
      dependencies,
    });

    expect(context.instructionPrefix).toContain('Steel Agent Rules');
    expect(context.instructionPrefix).toContain('Steel Quote Rules');
    expect(context.instructionPrefix).not.toContain('Steel Tool Policy');
    expect(context.runtimeContextText).toContain('Steel Native Context Metadata');
    expect(context.metadata).toEqual(
      expect.objectContaining({
        globalApplied: true,
        contextMode: 'compact_workbook',
      }),
    );
    expect(dependencies.listOtherGlobalRules).toHaveBeenCalledWith();
  });

  it('fails open when the Steel rules database is unavailable during global context injection', async () => {
    const failingClient = {
      query: jest.fn(async () => {
        throw new Error('relation "steel.quote_defaults" does not exist');
      }),
    } as unknown as SteelRepositoryClient;
    const dependencies = createSteelContextDependencies({
      conversationId: 'conversation_1',
      runtimeRulesClient: failingClient,
      createOutputSheetMemoryReader: () => ({
        readOutputSheetMemory: jest.fn(async () => createEmptySteelOutputSheetMemorySnapshot()),
      }),
    });

    const context = await buildDefaultSteelGlobalAgentContext({
      conversation: {
        conversationId: 'conversation_1',
        requestId: 'request_1',
        activeHistory: [
          {
            role: 'user',
            content: '一般聊天',
            messageId: 'message_1',
          },
        ],
      },
      dependencies,
    });

    expect(failingClient.query).toHaveBeenCalled();
    expect(context.metadata).toEqual(
      expect.objectContaining({
        globalApplied: true,
        contextMode: 'compact_workbook',
      }),
    );
    expect(context.runtimeContext.rules.agentRules).toHaveLength(0);
    expect(context.runtimeContext.rules.outputRules).toHaveLength(0);
    expect(context.runtimeContext.rules.otherGlobalRules.ocrRules ?? []).toHaveLength(0);
    expect(context.runtimeContext.rules.steelGlobalRules.instructionPackets).toHaveLength(0);
    expect(context.runtimeContext.rules.steelGlobalRules.quoteDefaults).toHaveLength(0);
    expect(context.runtimeContext.rules.steelGlobalRules.quoteRules).toHaveLength(0);
    expect(context.runtimeContext.toolPolicy.aiVisibleTools).not.toContain('run_file_ocr');
    expect(context.instructionPrefix).not.toContain('Steel Tool Policy');
    expect(context.runtimeContextText).not.toContain('instructionPackets');
  });
});
