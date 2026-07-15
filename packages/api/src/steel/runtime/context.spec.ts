import { prepareSteelRuntimeContext } from './context';

import type {
  PrepareSteelRuntimeContextInput,
  SteelRuntimeContextDependencies,
} from './context';
import type { SteelAgentRule } from '../repositories/rules';

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
    slug: 'steel-runtime-rule',
    version: 1,
    ruleType: 'agent',
    title: 'Steel runtime rule',
    locale: 'zh-TW',
    ruleSections: ['agent_instruction'],
    selectors: null,
    prompt: 'Fixture runtime rule',
    toolPolicy: null,
    outputPolicy: null,
    priority: 1,
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
    listOutputRules: jest.fn(async () => []),
    listOtherGlobalRules: jest.fn(async () => ({
      ocrSubagentRules: [],
      ocrMainAgentRules: [createAgentRule({ ruleSections: ['file_ocr'] })],
      fileRules: [],
      sourcePriorityRules: [],
      markdownOutputRules: [],
    })),
  };
}

function createInput(
  dependencies: SteelRuntimeContextDependencies,
  currentOcrMarkdownResults: Record<string, string>[] = [],
): PrepareSteelRuntimeContextInput {
  return {
    conversation: { requestId: 'request_1' },
    attachments: { currentOcrMarkdownResults },
    dependencies,
  };
}

describe('Steel runtime context', () => {
  it('loads only reviewed rule source data and same-turn organized Markdown', async () => {
    const dependencies = createDependencies();
    const context = await prepareSteelRuntimeContext(createInput(dependencies));

    expect(context.rules.agentRules).toHaveLength(1);
    expect(context.rules.otherGlobalRules.ocrMainAgentRules).toHaveLength(1);
    expect(context.attachments.currentOcrMarkdownResults).toEqual([]);
    expect(context).not.toHaveProperty('conversation');
    expect(context).not.toHaveProperty('outputSheets');
    expect(context).not.toHaveProperty('toolPolicy');
    expect(dependencies.listAgentRules).toHaveBeenCalledWith();
  });

  it('keeps the dynamic runtime payload to organized OCR Markdown only', async () => {
    const context = await prepareSteelRuntimeContext(
      createInput(createDependencies(), [
        {
          ocrFileKey: 'file:quote.pdf',
          filename: 'quote.pdf',
          content: '| 品名 | 數量 |\n|---|---:|\n| 鐵板 | 2 |',
        },
      ]),
    );
    expect(context.attachments).toEqual({
      currentOcrMarkdownResults: [expect.objectContaining({ ocrFileKey: 'file:quote.pdf' })],
      currentOcrFailures: [],
    });
    expect(JSON.stringify(context)).not.toContain('currentPaddleOcrResults');
    expect(JSON.stringify(context)).not.toContain('outputSheets');
    expect(JSON.stringify(context)).not.toContain('conversation');
  });
});
