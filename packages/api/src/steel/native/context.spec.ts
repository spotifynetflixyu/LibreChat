import {
  buildDefaultSteelGlobalAgentContext,
  buildSteelGlobalAgentContext,
  prepareLibreChatSteelChatContext,
} from './context';

import type { SteelRuntimeContextDependencies } from '../runtime/context';
import type { SteelAgentRule } from '../repositories/rules';

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

function createDependencies(): SteelRuntimeContextDependencies {
  return {
    listAgentRules: jest.fn(async () => [createAgentRule()]),
    listReviewedInstructionPackets: jest.fn(async () => []),
    listReviewedQuoteDefaults: jest.fn(async () => []),
    listReviewedQuoteRules: jest.fn(async () => []),
    listOutputRules: jest.fn(async () => [
      createAgentRule({ id: 2, slug: 'steel-output-rule', ruleType: 'output' }),
    ]),
    listOtherGlobalRules: jest.fn(async () => ({
      ocrMainAgentRules: [
        createAgentRule({
          id: 3,
          slug: 'steel-ocr-rule',
          ruleType: 'ocr',
          ruleSections: ['file_ocr'],
          priority: 20,
        }),
        createAgentRule({
          id: 4,
          slug: 'steel-vision-rule',
          ruleType: 'vision',
          ruleSections: ['vision_evidence'],
          priority: 36,
        }),
        createAgentRule({
          id: 5,
          slug: 'steel-ocr-main-organizer-rule',
          ruleType: 'other',
          ruleSections: ['ocr_main_merge', 'final_ocr_markdown'],
          priority: 38,
        }),
      ],
      ocrSubagentRules: [
        createAgentRule({
          id: 6,
          slug: 'steel-ocr-organizer-rule',
          ruleType: 'other',
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
    expect(context.instructionPrefix).toContain('steel-agent-rule');
    expect(context.instructionPrefix).toContain('steel-output-rule');
    expect(context.instructionPrefix).not.toContain('steel-ocr-rule');
    expect(context.instructionPrefix).not.toContain('steel-ocr-organizer-rule');
    expect(context.runtimeContextText).toBe('');
    expect(context.runtimeContext).not.toHaveProperty('conversation');
    expect(context.runtimeContext).not.toHaveProperty('outputSheets');
    expect(context.runtimeContext).not.toHaveProperty('toolPolicy');
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
    expect(context.instructionPrefix).not.toContain('steel-agent-rule');
    expect(context.instructionPrefix).not.toContain('steel-output-rule');
    expect(context.instructionPrefix).not.toContain('steel-file-rule');
    expect(context.instructionPrefix.indexOf('steel-ocr-rule')).toBeLessThan(
      context.instructionPrefix.indexOf('steel-vision-rule'),
    );
    expect(context.instructionPrefix).toContain('steel-ocr-main-organizer-rule');
    expect(context.instructionPrefix).not.toContain('steel-ocr-organizer-rule');
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
