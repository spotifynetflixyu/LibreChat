import {
  buildSteelGlobalAgentContext,
  steelNativeDefaultRuntimeContextMode,
  steelNativeInstructionPrefixSections,
  type SteelNativeFileReference,
} from './context';
import { createEmptySteelOutputSheetMemorySnapshot } from '../runtime/context';

import type { SteelQuoteDefault } from '../repositories/defaults';
import type { SteelInstructionPacket } from '../repositories/instructions';
import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';
import type {
  SteelRuntimeContextDependencies,
  SteelOutputSheetMemorySnapshot,
} from '../runtime/context';

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
    listOtherGlobalRules: jest.fn(async ({ includeOcrRules }: { includeOcrRules: boolean }) => ({
      ocrRules: includeOcrRules
        ? [
            createAgentRule({
              id: 6,
              slug: 'steel-drawing-ocr-policy',
              ruleType: 'other',
              ruleSections: ['file_ocr', 'drawing_ocr'],
            }),
          ]
        : undefined,
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
}: {
  fileReference?: SteelNativeFileReference;
} = {}) {
  const dependencies = createRuntimeDependencies();
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
        content: '請依附件報價',
        messageId: 'message_2',
        files: fileReference ? [fileReference] : undefined,
      },
    },
    attachments: fileReference ? { currentTurnFiles: [fileReference] } : undefined,
    dependencies,
    agentRuleFragments: [
      {
        slug: 'steel-base-agent-rule',
        content: 'Fixture base agent rule.',
        source: 'docs/rules/agent規則.txt',
      },
    ],
  });

  return { context, dependencies };
}

describe('Steel native context adapter', () => {
  it('builds instruction prefix slots in the fixed native Steel order', async () => {
    const { context } = await buildFixtureContext();
    const sections = context.instructionPrefixSections;

    expect(sections.map((section) => section.section)).toEqual([
      ...steelNativeInstructionPrefixSections,
    ]);
    expect(sections.find((section) => section.section === 'agent_rules')?.itemCount).toBe(1);
    expect(
      sections.find((section) => section.section === 'quote_defaults_and_rules')?.itemCount,
    ).toBe(2);
    expect(sections.find((section) => section.section === 'output_rules')?.itemCount).toBe(1);
    expect(sections.find((section) => section.section === 'tool_policy')?.itemCount).toBe(1);
    expect(sections.find((section) => section.section === 'other_rules')?.itemCount).toBe(4);
    expect(
      sections.find((section) => section.section === 'reviewed_agent_rules')?.itemCount,
    ).toBe(1);
    expect(
      sections.find((section) => section.section === 'instruction_packets')?.itemCount,
    ).toBe(1);
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
        ocrExecutionPolicy: 'agent_calls_run_file_ocr',
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

    expect(dependencies.listOtherGlobalRules).toHaveBeenCalledWith({ includeOcrRules: true });
    expect(context.runtimeContext.attachments.includeOcrRules).toBe(true);
    expect(context.runtimeContext.attachments.currentTurnFiles).toHaveLength(0);
    expect(context.attachmentReferences).toEqual([fileReference]);
    expect(Object.keys(context.attachmentReferences[0])).not.toContain('data');
    expect(context.runtimeContext.toolPolicy.aiVisibleTools).toContain('run_file_ocr');
  });
});
