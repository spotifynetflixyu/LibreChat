import {
  buildDefaultSteelGlobalAgentContext,
  buildSteelGlobalAgentContext,
  prepareLibreChatSteelChatContext,
} from './context';

import type { SteelRuntimeContextDependencies } from '../runtime/context';
import type { SteelQuoteDefault } from '../repositories/defaults';
import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';

const sourceRefs = [
  {
    channel: 'repo_docs',
    factType: 'native_context_fixture',
    canonicalKey: 'native_context',
  },
];

function createAgentRule(overrides: Partial<SteelAgentRule> = {}): SteelAgentRule {
  return {
    id: 1,
    slug: 'steel-agent-rule',
    version: 1,
    ruleType: 'agent',
    title: 'Steel agent rule',
    locale: 'zh-TW',
    ruleSections: ['agent_instruction'],
    selectors: null,
    prompt: 'Agent rule fixture',
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

function createQuoteRule(overrides: Partial<SteelQuoteRule> = {}): SteelQuoteRule {
  return {
    id: 10,
    ruleType: 'category_rule',
    scopeType: 'catalog_family',
    catalogFamily: 'plate',
    selectors: {
      appliesTo: ['steel_quote_runtime', 'steel_global_rules_context'],
    },
    parameters: {
      internalRouting: 'category_rule',
    },
    prompt: 'Quote rule fixture',
    priority: 30,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
    ...overrides,
  };
}

function createQuoteDefault(overrides: Partial<SteelQuoteDefault> = {}): SteelQuoteDefault {
  return {
    id: 20,
    defaultType: 'customer_tier',
    originTable: 'steel.rules',
    originId: 'fixture',
    scopeType: 'company',
    customerId: null,
    customerTierId: null,
    selector: {
      whenCustomerTierUnknown: true,
    },
    effect: 'Use tier B when the customer tier is unknown.',
    defaultParameters: {
      customerTier: 'B',
    },
    priority: 20,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
    sourceRefs,
    ...overrides,
  };
}

function createDependencies(): SteelRuntimeContextDependencies {
  return {
    listAgentRules: jest.fn(async () => [createAgentRule()]),
    listReviewedInstructionPackets: jest.fn(async () => []),
    listReviewedQuoteDefaults: jest.fn(async () => [createQuoteDefault()]),
    listReviewedQuoteRules: jest.fn(async () => [createQuoteRule()]),
    listOutputRules: jest.fn(async () => [
      createAgentRule({
        id: 2,
        slug: 'steel-output-rule',
        ruleType: 'output',
        title: 'Steel output rule',
        prompt: 'Output rule fixture',
      }),
    ]),
    listOtherGlobalRules: jest.fn(async () => ({
      ocrMainAgentRules: [
        createAgentRule({
          id: 3,
          slug: 'steel-ocr-rule',
          ruleType: 'ocr',
          title: 'Steel OCR rule',
          prompt: 'OCR rule fixture',
          ruleSections: ['file_ocr'],
          priority: 20,
        }),
        createAgentRule({
          id: 4,
          slug: 'steel-vision-rule',
          ruleType: 'vision',
          title: 'Steel Vision rule',
          prompt: 'Vision rule fixture',
          ruleSections: ['vision_evidence'],
          priority: 36,
        }),
        createAgentRule({
          id: 5,
          slug: 'steel-ocr-main-organizer-rule',
          ruleType: 'other',
          title: 'Steel OCR main organizer rule',
          prompt: 'OCR main organizer rule fixture',
          ruleSections: ['ocr_main_merge', 'final_ocr_markdown'],
          priority: 38,
        }),
      ],
      ocrSubagentRules: [
        createAgentRule({
          id: 6,
          slug: 'steel-ocr-organizer-rule',
          ruleType: 'other',
          title: 'Steel OCR organizer rule',
          prompt: 'OCR organizer rule fixture',
          ruleSections: ['ocr_organizer'],
          priority: 37,
        }),
      ],
      fileRules: [createAgentRule({ id: 7, slug: 'steel-file-rule', ruleSections: ['file_policy'] })],
      sourcePriorityRules: [],
      markdownOutputRules: [],
    })),
  };
}

describe('Steel native context adapter', () => {
  it('prepares LibreChat history without duplicating the current user turn', () => {
    const file = {
      fileId: 'file_1',
      source: 'librechat_file_record' as const,
      mediaType: 'application/pdf',
      filename: 'quote.pdf',
    };
    const prepared = prepareLibreChatSteelChatContext({
      requestId: 'request_1',
      conversationId: 'conversation_1',
      activeHistory: [
        { role: 'assistant', content: 'prior', messageId: 'message_1' },
        { role: 'user', content: 'current', messageId: 'message_2', files: [file] },
      ],
      currentUserTurn: { role: 'user', content: 'current', messageId: 'message_2', files: [file] },
    });

    expect(prepared.activeHistory).toHaveLength(1);
    expect(prepared.currentUserTurn?.messageId).toBe('message_2');
  });

  it('keeps the standard prefix deterministic and leaves the dynamic tail empty', async () => {
    const context = await buildDefaultSteelGlobalAgentContext({
      conversation: { requestId: 'request_1', activeHistory: [] },
      dependencies: createDependencies(),
    });

    expect(context.mode).toBe('standard');
    expect(context.instructionPrefix).toContain('Agent rule fixture');
    expect(context.instructionPrefix).toContain('Use tier B when the customer tier is unknown.');
    expect(context.instructionPrefix).toContain('Quote rule fixture');
    expect(context.instructionPrefix).toContain('Output rule fixture');
    expect(context.instructionPrefix).not.toContain('OCR rule fixture');
    expect(context.instructionPrefix).not.toContain('OCR organizer rule fixture');
    expect(context.runtimeContextText).toBe('');
    expect(context.runtimeContext).not.toHaveProperty('conversation');
    expect(context.runtimeContext).not.toHaveProperty('outputSheets');
    expect(context.runtimeContext).not.toHaveProperty('toolPolicy');
  });

  it('keeps backend rule metadata out of the rendered instruction prefix', async () => {
    const dependencies = createDependencies();
    dependencies.listAgentRules = jest.fn(async () => [
      createAgentRule({
        prompt: 'AI-actionable agent instruction',
        toolPolicy: { availableTools: ['delegate_ocr'] },
        outputPolicy: {
          missingSheetBehavior: 'carry_forward_previous_active_sheet',
          emittedSheetBehavior: 'replace_previous_active_sheet',
        },
      }),
    ]);

    const context = await buildDefaultSteelGlobalAgentContext({
      conversation: { requestId: 'request_metadata', activeHistory: [] },
      dependencies,
    });

    expect(context.instructionPrefix).toContain('AI-actionable agent instruction');
    expect(context.instructionPrefix).toContain('whenCustomerTierUnknown');
    expect(context.instructionPrefix).toContain('"customerTier":"B"');
    expect(context.instructionPrefix).not.toMatch(
      /steel-agent-rule|quote_rule:|quote_default:20|ruleType:|ruleSections:|scopeType: catalog_family|catalogFamily:|selectors:|parameters:|toolPolicy:|outputPolicy:|availableTools|carry_forward_previous_active_sheet|replace_previous_active_sheet|steel_global_rules_context|internalRouting/u,
    );
  });

  it('uses only OCR then Vision rules in OCR mode and serializes organized Markdown only', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentOcrMarkdownResults: [
          {
            ocrFileKey: 'file:quote.pdf',
            filename: 'quote.pdf',
            content: '<file:quote.pdf>\n| 品名 | 數量 |\n|---|---:|\n| 鐵板 | 2 |',
          },
        ],
        currentOcrFailures: [
          {
            ocrFileKey: 'file:missing.pdf',
            filename: 'missing.pdf',
            stage: 'paddleocr',
            pageStart: 1,
            pageEnd: 2,
            errorMessage: 'PaddleOCR timeout 1',
          },
          {
            ocrFileKey: 'file:missing.pdf',
            filename: 'missing.pdf',
            stage: 'paddleocr',
            pageStart: 4,
            pageEnd: 5,
            errorMessage: 'PaddleOCR timeout 2',
          },
          {
            ocrFileKey: 'file:other.pdf',
            filename: 'other.pdf',
            stage: 'organizer',
            pageStart: 3,
            pageEnd: 3,
            errorMessage: 'Organizer failed',
          },
        ],
      },
    });

    expect(context.mode).toBe('ocr');
    expect(context.instructionPrefix).not.toContain('Agent rule fixture');
    expect(context.instructionPrefix).not.toContain('Use tier B when the customer tier is unknown.');
    expect(context.instructionPrefix).not.toContain('Quote rule fixture');
    expect(context.instructionPrefix).not.toContain('Output rule fixture');
    expect(context.instructionPrefix).not.toContain('steel-file-rule');
    expect(context.instructionPrefix.indexOf('OCR rule fixture')).toBeLessThan(
      context.instructionPrefix.indexOf('Vision rule fixture'),
    );
    expect(context.instructionPrefix).toContain('OCR main organizer rule fixture');
    expect(context.instructionPrefix).not.toContain('OCR organizer rule fixture');
    expect(context.runtimeContextText).toContain('| 鐵板 | 2 |');
    expect(context.runtimeContextText).toContain(
      'file: file:missing.pdf\nstage: paddleocr\nerror: PaddleOCR timeout 1; PaddleOCR timeout 2\nmissing_pages: 1, 2, 4, 5',
    );
    expect(context.runtimeContextText).toContain(
      'file: file:other.pdf\nstage: organizer\nerror: Organizer failed\nmissing_pages: 3',
    );
    expect(context.runtimeContextText).not.toContain('missing: pages 1-2');
    expect(context.runtimeContextText).toContain('AI OCR regenerate');
    expect(context.runtimeContextText).not.toContain('Steel Native Context Metadata');
    expect(context.runtimeContextText).not.toContain('currentOcrMarkdownResults');
  });
});
