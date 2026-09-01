import {
  buildDefaultSteelGlobalAgentContext,
  buildSteelGlobalAgentContext,
  createSteelContextDependencies,
  prepareLibreChatSteelChatContext,
} from './context';

import type { SteelRuntimeContextDependencies } from '../runtime/context';
import type { SteelQuoteDefault } from '../repositories/defaults';
import type { SteelAgentRule, SteelQuoteRule } from '../repositories/rules';
import type { SteelRepositoryClient } from '../repositories/types';

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
        slug: 'steel-quote-calculation-output-rule',
        ruleType: 'output',
        title: 'Steel quote calculation output rule',
        prompt: 'Calculation output rule fixture',
        priority: 10,
      }),
      createAgentRule({
        id: 3,
        slug: 'steel-output-rule',
        ruleType: 'output',
        title: 'Steel output rule',
        prompt: 'Workbook output rule fixture',
        priority: 20,
      }),
    ]),
    listOtherGlobalRules: jest.fn(async () => ({
      ocrSharedRules: [
        createAgentRule({
          id: 4,
          slug: 'steel-ocr-shared-rule',
          ruleType: 'ocr',
          title: 'Steel OCR shared rule',
          prompt: 'OCR shared rule fixture',
          ruleSections: ['ocr_shared'],
          priority: 20,
        }),
      ],
      ocrVisionRules: [
        createAgentRule({
          id: 5,
          slug: 'steel-vision-rule',
          ruleType: 'vision',
          title: 'Steel Vision rule',
          prompt: 'Vision rule fixture',
          ruleSections: ['vision_processing'],
          priority: 36,
        }),
      ],
      ocrMainRules: [
        createAgentRule({
          id: 6,
          slug: 'steel-ocr-main-organizer-rule',
          ruleType: 'other',
          title: 'Steel OCR main organizer rule',
          prompt: [
            '[ocr_main_merge]',
            'OCR main organizer rule fixture',
            '[/ocr_main_merge]',
            '[final_ocr_markdown]',
            'Final OCR Markdown rule fixture',
            '[/final_ocr_markdown]',
          ].join('\n'),
          ruleSections: ['ocr_main_flow', 'ocr_vision', 'ocr_main_merge', 'final_ocr_markdown'],
          priority: 38,
        }),
      ],
      ocrOrganizerRules: [
        createAgentRule({
          id: 7,
          slug: 'steel-ocr-organizer-rule',
          ruleType: 'other',
          title: 'Steel OCR organizer rule',
          prompt: 'OCR organizer rule fixture',
          ruleSections: ['ocr_organizer'],
          priority: 37,
        }),
      ],
      fileRules: [createAgentRule({ id: 8, slug: 'steel-file-rule', ruleSections: ['file_policy'] })],
      sourcePriorityRules: [],
      markdownOutputRules: [],
    })),
  };
}

describe('Steel native context adapter', () => {
  it('classifies raw reviewed OCR rules from the database into exact runtime groups', async () => {
    const rows = [
      ['shared', ['ocr_shared'], '[ocr_shared]\nShared\n[/ocr_shared]'],
      ['vision', ['vision_processing'], '[vision_processing]\nVision\n[/vision_processing]'],
      [
        'flow',
        ['ocr_main_flow', 'ocr_vision', 'ocr_main_merge', 'final_ocr_markdown'],
        '[ocr_main_flow]\nFlow\n[/ocr_main_flow]\n[ocr_vision]\nIntegration\n[/ocr_vision]',
      ],
      ['organizer', ['ocr_organizer'], '[ocr_organizer]\nOrganizer\n[/ocr_organizer]'],
    ].map(([slug, ruleSections, prompt], index) => ({
      id: index + 1,
      slug: `steel-ocr-${slug}`,
      version: 1,
      rule_kind: 'other',
      title: `OCR ${slug}`,
      locale: 'zh-TW',
      rule_sections: ruleSections,
      selectors: {},
      prompt,
      tool_policy: {},
      output_policy: {},
      priority: 35 + index,
      active: true,
      review_state: 'reviewed',
    }));
    const query = jest.fn().mockResolvedValue({ rows });
    const dependencies = createSteelContextDependencies({
      runtimeRulesClient: { query } as unknown as SteelRepositoryClient,
    });

    const groups = await dependencies.listOtherGlobalRules();

    expect(query).toHaveBeenCalledWith(expect.any(String), ['reviewed', 'other']);
    expect(groups.ocrSharedRules.map((rule) => rule.slug)).toEqual(['steel-ocr-shared']);
    expect(groups.ocrVisionRules.map((rule) => rule.slug)).toEqual(['steel-ocr-vision']);
    expect(groups.ocrMainRules.map((rule) => rule.slug)).toEqual(['steel-ocr-flow']);
    expect(groups.ocrOrganizerRules.map((rule) => rule.slug)).toEqual([
      'steel-ocr-organizer',
    ]);
  });

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
    expect(context.instructionPrefix).toContain('Calculation output rule fixture');
    expect(context.instructionPrefix).toContain('Workbook output rule fixture');
    expect(context.instructionPrefix.indexOf('Calculation output rule fixture')).toBeLessThan(
      context.instructionPrefix.indexOf('Workbook output rule fixture'),
    );
    expect(context.instructionPrefix).not.toContain('OCR rule fixture');
    expect(context.instructionPrefix).not.toContain('OCR organizer rule fixture');
    expect(context.runtimeContextText).toBe('');
    expect(context.runtimeContext).not.toHaveProperty('conversation');
    expect(context.runtimeContext).not.toHaveProperty('outputSheets');
    expect(context.runtimeContext).not.toHaveProperty('toolPolicy');
    expect(JSON.stringify(context)).not.toContain('sourceRefs');
  });

  it('renders attachment filenames and file keys into the provider context', async () => {
    const context = await buildDefaultSteelGlobalAgentContext({
      conversation: {
        requestId: 'request_with_attachment',
        activeHistory: [],
        currentUserTurn: {
          role: 'user',
          content: '請依附件報價',
          files: [
            {
              fileId: '676b6f2c-0361-412a-92f0-92711c94ffef',
              source: 'librechat_file_record',
              mediaType: 'application/pdf',
              filename: 'PL.pdf',
            },
          ],
        },
      },
      dependencies: createDependencies(),
    });

    expect(context.runtimeContextText).toContain(
      '# Source attachment metadata\nfile_key: file:676b6f2c-0361-412a-92f0-92711c94ffef\nsource_filename: "PL.pdf"\nmedia_type: "application/pdf"',
    );
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

  it('uses main merge/final rules in OCR mode and serializes organized Markdown only', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentPaddleOcrStatuses: [
          {
            paddleocr: 'ok',
            ocrFileKey: 'file:676b6f2c-0361-412a-92f0-92711c94ffef',
            filename: 'PL.pdf',
            mediaType: 'application/pdf',
            chunkIndex: 1,
            chunkCount: 2,
            pageStart: 1,
            pageEnd: 2,
          },
          {
            paddleocr: 'ok',
            ocrFileKey: 'file:676b6f2c-0361-412a-92f0-92711c94ffef',
            filename: 'PL.pdf',
            mediaType: 'application/pdf',
            chunkIndex: 2,
            chunkCount: 2,
            pageStart: 3,
            pageEnd: 4,
          },
          {
            paddleocr: 'fail',
            ocrFileKey: 'file:missing.pdf',
            filename: 'missing.pdf',
            mediaType: 'application/pdf',
            chunkIndex: 1,
            chunkCount: 3,
            pageStart: 1,
            pageEnd: 2,
          },
          {
            paddleocr: 'fail',
            ocrFileKey: 'file:missing.pdf',
            filename: 'missing.pdf',
            mediaType: 'application/pdf',
            chunkIndex: 3,
            chunkCount: 3,
            pageStart: 4,
            pageEnd: 5,
          },
          {
            paddleocr: 'fail',
            ocrFileKey: 'file:photo.jpg',
            filename: 'photo.jpg',
            mediaType: 'image/jpeg',
            chunkIndex: 1,
            chunkCount: 1,
          },
        ],
        currentOcrMarkdownResults: [
          {
            ocrFileKey: 'file:676b6f2c-0361-412a-92f0-92711c94ffef',
            sourceCode: 'F1',
            filename: 'PL.pdf',
            sourceFilename: 'PL.pdf',
            storageKey: 'uploads/user_123/676b6f2c__PL.pdf',
            ocrPreprocessing: {
              chunkCount: 2,
              pageRanges: [
                { pageStart: 1, pageEnd: 2 },
                { pageStart: 3, pageEnd: 4 },
              ],
            },
            content:
              '<file:676b6f2c-0361-412a-92f0-92711c94ffef>\n| 品名 | 數量 |\n|---|---:|\n| 鐵板 | 2 |',
          },
        ],
        currentOcrFailures: [
          {
            ocrFileKey: 'file:missing.pdf',
            sourceCode: 'F2',
            filename: 'missing.pdf',
            sourceFilename: 'missing.pdf',
            mediaType: 'application/pdf',
            fileUrl: 'https://files.example.test/missing.pdf',
            stage: 'paddleocr',
            chunkIndex: 1,
            pageStart: 1,
            pageEnd: 2,
            errorMessage: 'PaddleOCR timeout 1',
          },
          {
            ocrFileKey: 'file:missing.pdf',
            sourceCode: 'F2',
            filename: 'missing.pdf',
            sourceFilename: 'missing.pdf',
            mediaType: 'application/pdf',
            fileUrl: 'https://files.example.test/missing.pdf',
            stage: 'paddleocr',
            chunkIndex: 3,
            pageStart: 4,
            pageEnd: 5,
            errorMessage: 'PaddleOCR timeout 2',
          },
          {
            ocrFileKey: 'file:other.pdf',
            filename: 'other.pdf',
            mediaType: 'application/pdf',
            fileUrl: 'https://files.example.test/other.pdf',
            stage: 'organizer',
            chunkIndex: 2,
            pageStart: 3,
            pageEnd: 3,
            errorMessage: 'Organizer failed',
          },
          {
            ocrFileKey: 'file:photo.jpg',
            filename: 'photo.jpg',
            mediaType: 'image/jpeg',
            fileUrl: 'https://files.example.test/photo.jpg',
            stage: 'paddleocr',
            chunkIndex: 1,
            pageStart: 1,
            pageEnd: 1,
            errorMessage: 'Image OCR failed',
          },
        ],
        currentOcrSourceFileMapping: [
          { sourceCode: 'F1', sourceFilename: 'PL.pdf' },
          { sourceCode: 'F2', sourceFilename: 'missing.pdf' },
        ],
      },
    });

    expect(context.mode).toBe('ocr');
    expect(context.instructionPrefix).not.toContain('Agent rule fixture');
    expect(context.instructionPrefix).not.toContain('Use tier B when the customer tier is unknown.');
    expect(context.instructionPrefix).not.toContain('Quote rule fixture');
    expect(context.instructionPrefix).not.toContain('Calculation output rule fixture');
    expect(context.instructionPrefix).not.toContain('Workbook output rule fixture');
    expect(context.instructionPrefix).not.toContain('steel-file-rule');
    expect(context.instructionPrefix).not.toContain('OCR shared rule fixture');
    expect(context.instructionPrefix).not.toContain('Vision rule fixture');
    expect(context.instructionPrefix).toContain('OCR main organizer rule fixture');
    expect(context.instructionPrefix).toContain('[ocr_main_merge]');
    expect(context.instructionPrefix).toContain('[final_ocr_markdown]');
    expect(context.instructionPrefix).not.toContain('OCR organizer rule fixture');
    expect(context.runtimeContextText).not.toMatch(/^# Current-turn OCR completion directive/u);
    expect(context.runtimeContextText).toContain('metadata such as customer name');
    expect(context.runtimeContextText).toContain(
      'Satisfy any other user intent only within those allowed sections',
    );
    expect(context.runtimeContextText).toContain(
      '# OCR source file mapping metadata\nsource_file_mapping:\n  - source_code: F1\n    source_filename: "PL.pdf"\n  - source_code: F2\n    source_filename: "missing.pdf"',
    );
    expect(context.runtimeContextText).toContain(
      'file_key: file:676b6f2c-0361-412a-92f0-92711c94ffef\nsource_code: F1\nsource_filename: "PL.pdf"\npage_ranges: 1-2, 3-4\nchunk_count: 2\n<file:676b6f2c-0361-412a-92f0-92711c94ffef>',
    );
    expect(context.runtimeContextText).toContain('| 鐵板 | 2 |');
    expect(context.runtimeContextText).not.toContain('uploads/user_123/676b6f2c__PL.pdf');
    expect(context.runtimeContextText).not.toContain('paddleocr_status:');
    expect(context.runtimeContextText).not.toContain('ocr_failure_stage:');
    expect(context.runtimeContextText).not.toContain('file_url:');
    expect(context.runtimeContextText).not.toContain('https://files.example.test');
    expect(context.runtimeContextText).not.toContain('PaddleOCR timeout');
    expect(context.runtimeContextText).not.toContain('Organizer failed');
    expect(context.runtimeContextText).not.toContain('Image OCR failed');
    expect(context.runtimeContextText).not.toContain('chunk_indexes');
    expect(context.runtimeContextText).not.toContain('raw OCR');
    expect(context.runtimeContextText).not.toContain('Steel Native Context Metadata');
    expect(context.runtimeContextText).not.toContain('currentOcrMarkdownResults');
    expect(context.runtimeContextText.indexOf('| 鐵板 | 2 |')).toBeLessThan(
      context.runtimeContextText.indexOf('# Current-turn OCR completion directive'),
    );
    const directiveStart = context.runtimeContextText.indexOf(
      '# Current-turn OCR completion directive',
    );
    const directive = context.runtimeContextText.slice(directiveStart);
    expect(directive).toContain('[ocr_main_merge]');
    expect(directive).toContain('[final_ocr_markdown]');
    expect(directive).toMatch(
      /final answer MUST start with exactly one `## 來源檔案對照表` mapping table with columns `來源` and `檔名` in `source_file_mapping` order, then one consolidated `## OCR 結果確認表`, followed by an optional final `## manual_review` table/u,
    );
    expect(directive).toMatch(/Do not output page headings or page details/u);
    expect(directive).toMatch(
      /Do not output page headings or page details, explanatory prose, bullet lists, calculations, or duplicate tables/u,
    );
    expect(directive).toContain('End after the final table.');
    expect(directive).toContain('Satisfy any other user intent only within those allowed sections');
    expect(directive).not.toContain('Answer any other user intent too');
  });

  it('gives delegate_ocr DB-backed OCR, Vision, and final Markdown rules only', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_delegate_ocr_rules', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'delegate_ocr',
    });

    expect(context.mode).toBe('delegate_ocr');
    expect(context.instructionPrefix).toContain('OCR shared rule fixture');
    expect(context.instructionPrefix).toContain('Vision rule fixture');
    expect(context.instructionPrefix).toContain('[final_ocr_markdown]');
    expect(context.instructionPrefix).toContain('Final OCR Markdown rule fixture');
    expect(context.instructionPrefix).not.toContain('[ocr_main_merge]');
    expect(context.instructionPrefix).not.toContain('OCR main organizer rule fixture');
    expect(context.instructionPrefix).not.toContain('OCR organizer rule fixture');
    expect(context.instructionPrefix).not.toContain('Agent rule fixture');
    expect(context.instructionPrefix).not.toContain('Quote rule fixture');
  });

  it('does not invent source filenames for OCR Markdown results', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr_without_filename', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentOcrMarkdownResults: [
          {
            ocrFileKey: 'file:file-without-name',
            filename: '   ',
            content: '<file:file-without-name>\nOCR Markdown',
          },
        ],
      },
    });

    expect(context.runtimeContextText).toContain(
      'file_key: file:file-without-name\n<file:file-without-name>\nOCR Markdown',
    );
    expect(context.runtimeContextText).not.toContain('source_filename:');
  });

  it('renders only strictly valid backend OCR source codes', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr_source_code_validation', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentOcrMarkdownResults: [
          {
            ocrFileKey: 'file:valid-source-code',
            sourceCode: 'F12',
            content: '<file:valid-source-code>\n| OCR |\n| --- |\n| valid |',
          },
          {
            ocrFileKey: 'file:invalid-source-code',
            sourceCode: ' F12 ',
            content: '<file:invalid-source-code>\n| OCR |\n| --- |\n| invalid |',
          },
        ],
      },
    });

    expect(context.runtimeContextText).toContain('source_code: F12');
    expect(context.runtimeContextText).not.toContain(
      'file_key: file:invalid-source-code\nsource_code:',
    );
  });

  it('renders explicit OCR source mapping even when every file fails', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr_mapping_only', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentOcrSourceFileMapping: [
          { sourceCode: 'F1', sourceFilename: '' },
          { sourceCode: 'F2', sourceFilename: 'second.pdf' },
        ],
        currentOcrFailures: [
          {
            ocrFileKey: 'file:first.pdf',
            sourceCode: 'F1',
            filename: 'request-first.pdf',
            stage: 'paddleocr',
          },
        ],
      },
    });

    expect(context.runtimeContextText).toContain(
      '# OCR source file mapping metadata\nsource_file_mapping:\n  - source_code: F1\n    source_filename: ""\n  - source_code: F2\n    source_filename: "second.pdf"',
    );
    expect(context.runtimeContextText).not.toContain('request-first.pdf');
    expect(context.runtimeContextText).not.toContain('# Current-turn OCR completion directive');
  });

  it('does not expose OCR chunk statuses when organized Markdown is present', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_mixed_reuse', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentPaddleOcrStatuses: [
          {
            paddleocr: 'ok',
            ocrFileKey: 'file:mixed.pdf',
            filename: 'mixed.pdf',
            mediaType: 'application/pdf',
            chunkIndex: 3,
            chunkCount: 3,
            pageStart: 101,
            pageEnd: 120,
          },
        ],
        currentOcrMarkdownResults: [
          {
            ocrFileKey: 'file:mixed.pdf',
            filename: 'mixed.pdf',
            ocrPreprocessing: {
              chunkCount: 3,
              pageRanges: [
                { pageStart: 1, pageEnd: 50 },
                { pageStart: 51, pageEnd: 100 },
                { pageStart: 101, pageEnd: 120 },
              ],
            },
            content: '<file:mixed.pdf>\n| OCR |\n| --- |\n| mixed |',
          },
        ],
      },
    });

    expect(context.runtimeContextText).toContain('| OCR |');
    expect(context.runtimeContextText).not.toContain('paddleocr_status:');
    expect(context.runtimeContextText).not.toContain('page_range:');
  });

  it('omits OCR status metadata and artifact URLs from OCR context', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr_ranges', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentOcrMarkdownResults: [
          {
            ocrFileKey: 'file:valid.pdf',
            content: '<file:valid.pdf>\n| OCR |\n| --- |\n| valid |',
            ocrPreprocessing: {
              chunkCount: 2,
              pageRanges: [
                { pageStart: 1, pageEnd: 50 },
                { pageStart: 51, pageEnd: 75 },
              ],
            },
          },
          {
            ocrFileKey: 'file:overlap.pdf',
            content: '<file:overlap.pdf>\n| OCR |\n| --- |\n| overlap |',
            ocrPreprocessing: {
              chunkCount: 2,
              pageRanges: [
                { pageStart: 1, pageEnd: 50 },
                { pageStart: 50, pageEnd: 75 },
              ],
            },
          },
          {
            ocrFileKey: 'file:legacy.pdf',
            content: '<file:legacy.pdf>\n| OCR |\n| --- |\n| legacy |',
          },
          {
            ocrFileKey: 'file:gap.pdf',
            content: '<file:gap.pdf>\n| OCR |\n| --- |\n| gap |',
            ocrPreprocessing: {
              chunkCount: 2,
              pageRanges: [
                { pageStart: 1, pageEnd: 10 },
                { pageStart: 12, pageEnd: 20 },
              ],
            },
          },
          {
            ocrFileKey: 'file:partial-gap.pdf',
            filename: 'partial-gap.pdf',
            sourceFilename: 'partial-gap.pdf',
            content: '<file:partial-gap.pdf>\n| OCR |\n| --- |\n| partial gap |',
            ocrPreprocessing: {
              chunkCount: 2,
              pageRanges: [
                { pageStart: 1, pageEnd: 10 },
                { pageStart: 21, pageEnd: 30 },
              ],
              partial: true,
            },
          },
        ],
      },
    });

    expect(context.runtimeContextText).toContain(
      'file_key: file:valid.pdf\npage_ranges: 1-50, 51-75\nchunk_count: 2\n<file:valid.pdf>',
    );
    expect(context.runtimeContextText).toContain(
      'file_key: file:overlap.pdf\n<file:overlap.pdf>',
    );
    expect(context.runtimeContextText).not.toContain('file_key: file:overlap.pdf\npage_ranges:');
    expect(context.runtimeContextText).toContain('file_key: file:legacy.pdf\n<file:legacy.pdf>');
    expect(context.runtimeContextText).toContain('file_key: file:gap.pdf\n<file:gap.pdf>');
    expect(context.runtimeContextText).not.toContain('file_key: file:gap.pdf\npage_ranges:');
    expect(context.runtimeContextText).toContain(
      'file_key: file:partial-gap.pdf\nsource_filename: "partial-gap.pdf"\npage_ranges: 1-10, 21-30\nchunk_count: 2\n<file:partial-gap.pdf>',
    );
  });

  it('keeps PaddleOCR failure URLs out of AI-visible context', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr_failure_urls', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentOcrFailures: [
          {
            ocrFileKey: 'file:safe-fallback.pdf',
            fileUrl: 'storage:private/chunk.pdf',
            ocrFileUrl: 'https://files.example.test/safe-fallback.pdf?signature=ok',
            stage: 'paddleocr',
            pageStart: 1,
            pageEnd: 2,
          },
          {
            ocrFileKey: 'file:credentialed.pdf',
            fileUrl: 'https://user:secret@files.example.test/private.pdf',
            stage: 'paddleocr',
            pageStart: 3,
            pageEnd: 4,
          },
          {
            ocrFileKey: 'file:local.pdf',
            fileUrl: '/srv/librechat/uploads/local.pdf',
            stage: 'paddleocr',
            pageStart: 5,
            pageEnd: 6,
          },
          {
            ocrFileKey: 'file:distinct.pdf',
            fileUrl: 'https://files.example.test/distinct-pages-7-8.pdf',
            stage: 'paddleocr',
            pageStart: 7,
            pageEnd: 8,
          },
          {
            ocrFileKey: 'file:distinct.pdf',
            fileUrl: 'https://files.example.test/distinct-pages-9-10.pdf',
            stage: 'paddleocr',
            pageStart: 9,
            pageEnd: 10,
          },
        ],
      },
    });

    expect(context.runtimeContextText).toBe('');
  });

  it('renders image OCR Markdown without page metadata', async () => {
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr_image', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentOcrMarkdownResults: [
          {
            ocrFileKey: 'file:photo.jpg',
            filename: 'photo.jpg',
            sourceFilename: 'photo.jpg',
            content: '<file:photo.jpg>\n| OCR |\n| --- |\n| image |',
            ocrPreprocessing: { chunkCount: 1, pageRanges: [] },
          },
        ],
      },
    });

    expect(context.runtimeContextText).toContain('file_key: file:photo.jpg\nsource_filename: "photo.jpg"');
    expect(context.runtimeContextText).not.toContain('page_ranges:');
    expect(context.runtimeContextText).not.toContain('chunk_count:');
    expect(context.runtimeContextText).toContain('| image |');
  });

  it('sanitizes legacy OCR file labels without redacting the Markdown body', async () => {
    const storageKey = 'storage:private/uploads/quote.pdf';
    const pathKey = 'path:/srv/librechat/uploads/other.pdf';
    const context = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr_legacy_keys', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentOcrMarkdownResults: [
          {
            ocrFileKey: storageKey,
            content: `<${storageKey}>\nOCR body retains ${storageKey}`,
          },
          {
            ocrFileKey: pathKey,
            content: `<${pathKey}>\nOCR body retains ${pathKey}`,
          },
        ],
      },
    });

    expect(context.runtimeContextText).toMatch(
      /file_key: file:[a-f0-9]{24}\n<file:[a-f0-9]{24}>\nOCR body retains storage:private\/uploads\/quote\.pdf/u,
    );
    expect(context.runtimeContextText).toMatch(
      /file_key: file:[a-f0-9]{24}\n<file:[a-f0-9]{24}>\nOCR body retains path:\/srv\/librechat\/uploads\/other\.pdf/u,
    );
    expect(context.runtimeContextText).not.toContain(`file_key: ${storageKey}`);
    expect(context.runtimeContextText).not.toContain(`file_key: ${pathKey}`);
    expect(context.runtimeContextText).not.toContain(`<${storageKey}>`);
    expect(context.runtimeContextText).not.toContain(`<${pathKey}>`);
  });

  it('does not add the OCR completion directive without organized Markdown or in standard mode', async () => {
    const failureOnlyContext = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_ocr_failure_only', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'ocr',
      attachments: {
        currentOcrFailures: [
          {
            ocrFileKey: 'file:missing.pdf',
            fileUrl: 'https://files.example.test/missing.pdf',
            pageStart: 1,
            pageEnd: 2,
          },
        ],
      },
    });

    const standardContext = await buildSteelGlobalAgentContext({
      conversation: { requestId: 'request_standard_with_ocr', activeHistory: [] },
      dependencies: createDependencies(),
      mode: 'standard',
      attachments: {
        currentOcrMarkdownResults: [{ ocrFileKey: 'file:organized.pdf', content: 'Organized OCR' }],
      },
    });

    expect(failureOnlyContext.runtimeContextText).not.toContain(
      '# Current-turn OCR completion directive',
    );
    expect(standardContext.runtimeContextText).not.toContain(
      '# Current-turn OCR completion directive',
    );
  });
});
