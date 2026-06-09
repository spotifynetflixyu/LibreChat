import { sendSteelOAuthChat } from './provider';

import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import type { OpenAIOAuthProviderSettings } from 'openai-oauth-provider';
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';
import type { SteelRepositoryClient, SteelSqlParameter } from '../repositories';

interface QueryCall {
  sql: string;
  values?: readonly SteelSqlParameter[];
}

interface AgentRuleRowFixture {
  id: string;
  slug: string;
  version: string;
  rule_type: string;
  title: string;
  locale: string;
  rule_sections: string[];
  sheet_id: string | null;
  selectors: object;
  prompt: string;
  tool_policy: object;
  output_policy: object;
  priority: string;
  confidence: string;
  active: boolean;
  review_state: string;
  source_refs: object[];
}

function isStringArray(value: SteelSqlParameter | undefined): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function createAgentRulesClient(
  rows: AgentRuleRowFixture[],
): SteelRepositoryClient & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];

  return {
    calls,
    query: async <Row extends object>(
      sql: string,
      values?: readonly SteelSqlParameter[],
    ): Promise<{ rows: Row[] }> => {
      calls.push({ sql, values });

      let filteredRows = rows;
      const reviewState = typeof values?.[0] === 'string' ? values[0] : undefined;
      if (reviewState) {
        filteredRows = filteredRows.filter((row) => row.review_state === reviewState);
      }

      if (sql.includes('active = true')) {
        filteredRows = filteredRows.filter((row) => row.active);
      }

      if (sql.includes('rule_type = ANY')) {
        const ruleTypes = values?.find(isStringArray) ?? [];
        filteredRows = filteredRows.filter((row) => ruleTypes.includes(row.rule_type));
      }

      if (sql.includes('rule_sections &&')) {
        const stringArrayValues = values?.filter(isStringArray) ?? [];
        const ruleSections = sql.includes('rule_type = ANY')
          ? (stringArrayValues[1] ?? [])
          : (stringArrayValues[0] ?? []);
        filteredRows = filteredRows.filter((row) =>
          row.rule_sections.some((section) => ruleSections.includes(section)),
        );
      }

      const limitValue = values?.[values.length - 1];
      const limit = typeof limitValue === 'number' ? limitValue : filteredRows.length;

      return { rows: filteredRows.slice(0, limit) as Row[] };
    },
  };
}

function createAgentRuleRow(prompt: string): AgentRuleRowFixture {
  return {
    id: '1',
    slug: 'steel-default-agent-instruction',
    version: '1',
    rule_type: 'agent_instruction_rule',
    title: 'Steel 預設 Agent Instruction',
    locale: 'zh-TW',
    rule_sections: ['agent_instruction', 'tool_flow', 'inference_order', 'confirmation_policy'],
    sheet_id: null,
    selectors: { appliesTo: ['steel_quote_runtime'], locale: 'zh-TW' },
    prompt,
    tool_policy: { availableTools: ['lookup_catalog_families', 'lookup_quote_rules'] },
    output_policy: { answerLanguage: 'zh-TW' },
    priority: '10',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'admin_table_ui',
        factType: 'agent_rule',
        locator: 'steel.agent_rules:1',
        canonicalKey: 'agent_default_instruction_zh_tw',
      },
    ],
  };
}

function createWorkbookRuleRow(prompt: string): AgentRuleRowFixture {
  return {
    id: '2',
    slug: 'steel-workbook-output-policy',
    version: '1',
    rule_type: 'workbook_output_rule',
    title: 'Steel Workbook Output Policy',
    locale: 'zh-TW',
    rule_sections: ['workbook_output', 'workbook_patch', 'system_order'],
    sheet_id: null,
    selectors: { appliesTo: ['steel_quote_workbook'], locale: 'zh-TW' },
    prompt,
    tool_policy: { availableTools: ['patch_quote_workbook'] },
    output_policy: { answerLanguage: 'zh-TW' },
    priority: '20',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'admin_table_ui',
        factType: 'agent_rule',
        locator: 'steel.agent_rules:2',
        canonicalKey: 'workbook_output_policy_zh_tw',
      },
    ],
  };
}

function createOcrRuleRow(prompt: string): AgentRuleRowFixture {
  return {
    id: '3',
    slug: 'steel-drawing-ocr-policy',
    version: '1',
    rule_type: 'inference_order_rule',
    title: '圖面表格局部判讀流程',
    locale: 'zh-TW',
    rule_sections: ['file_ocr', 'drawing_ocr', 'vision_evidence'],
    sheet_id: null,
    selectors: {
      sourceKinds: ['image', 'pdf', 'scanned_pdf'],
      requiresDrawingOcr: true,
    },
    prompt,
    tool_policy: {
      requiredBefore: ['drawing_evidence_extraction'],
      mustMarkLowConfidence: true,
    },
    output_policy: {
      targetSheets: ['manual_review', 'interpretation_notes'],
      forbidFormalAdminImport: true,
    },
    priority: '35',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'agent_rule',
        sourceFile: 'docs/reference/OCR規則.txt',
        locator: '圖面表格局部判讀流程',
        canonicalKey: 'drawing_ocr_local_table_reading',
        sha256: 'ocr-rule-sha256-sentinel',
      },
    ],
  };
}

const defaultAgentRulePrompt = [
  '你是「鋼鐵公司小助手」，負責判讀鋼鐵材料、板材圖面、PDF、圖片、文字描述、口語品名與報價資料。',
  '回答一律使用繁體中文。',
  '不得把資料、單價、重量、客戶分級、公式或品類規則寫死在推論中。',
  '需要 reviewed 事實時必須使用 Steel tools。',
  'lookup_catalog_families 用於品名、口語品名、錯字、俗稱、相似品名或品類不確定。',
  'search_customers 用於使用者提供客戶名稱、客戶代碼、案場名稱、歷史客戶別名或可能客戶。',
  'lookup_quote_rules 用於取得品類、加工、true zero、配料與系統訂單格式規則。',
  'search_price_candidates 用於產品價格、材料價格、加工價格、切工價格、孔加工價格、開槽價格、折工價格或其他報價單價。',
  'patch_quote_workbook 只送 semantic quote data；backend 會投影成 workbook cell operations。',
  '價格先於重量。',
  '單價不明、金額不明、price row 空白、price row 為 0、客戶分級價格缺漏時，不可填 0；應填「未確認」。',
  '送出 workbook patch 或最終回答前，summary.totalAmount 必須等於 quote_details 所有數字型 line subtotal 加總。',
  'C 型鋼預設不列一般切工，除非 C 型鋼專用規則的另計條件成立。',
  '4-Ø22 通常表示每件 4 個 Ø22 孔。',
  '圖面與表格不一致。',
].join('\n');

const defaultWorkbookRulePrompt = [
  'DB_WORKBOOK_RULE_SENTINEL You can update the visible Steel workbook only by calling patch_quote_workbook.',
  'Use patch_quote_workbook for all workbook changes and write provisional workbook preview rows when reviewed positive candidate prices exist.',
  'When changing one quote value, use patch_quote_workbook with the same lineId.',
  'Fill blank workbook cells when the value can be derived from user text, workbook context, reviewed tool results, or quote calculation results.',
  'Leave a blank cell unchanged when material, customer, source, or calculation context is unavailable.',
  'record the missing context in manual_review or interpretation_notes.',
  'In quote_details, update the `小計` column using internal key `subtotal`.',
  'Do not write confirmed totals before user confirmation.',
  'Use calculation_results before resolved_quote_items when both are available; line subtotal values and summary totals must be internally consistent.',
  'After patch_quote_workbook succeeds, answer with interpreted order information, key workbook changes, Do not list a per-field diff, and Do not answer only with a field count.',
  '價格先於重量；未確認單價或金額不可填 0。',
  '系統訂單分頁材料列與加工列分開；use systemOrder.modelCode for 系統訂單.`型號`.',
  '報價明細 小計 and summary.totalAmount must follow subtotal validation.',
  '給客戶用 不得出現客戶分級、價格來源、搜尋關鍵字、候選品項、AI判斷或 internal source refs.',
  'customer_quote 報價總額列必須用 top-level customerQuoteTotal 輸出。',
  'Keep patch_quote_workbook compact and Do not hand-write workbook cell operations.',
  'Do not ask the user for internal workbook ids or keys.',
].join('\n');

const steelBusinessToolNames = [
  'lookup_quote_rules',
  'lookup_catalog_families',
  'search_customers',
  'search_price_candidates',
] as const;

function createDefaultAgentRulesClient() {
  return createAgentRulesClient([
    createAgentRuleRow(defaultAgentRulePrompt),
    createWorkbookRuleRow(defaultWorkbookRulePrompt),
  ]);
}

describe('Steel OpenAI OAuth provider adapter', () => {
  it('loads the Steel agent runtime prompt from reviewed agent_rules', async () => {
    const dbPrompt =
      'DB_AGENT_RULE_SENTINEL 你是「鋼鐵公司小助手」，不得把資料、單價、重量、客戶分級、公式或品類規則寫死在推論中。';
    const agentRulesClient = createAgentRulesClient([createAgentRuleRow(dbPrompt)]);
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'agent-rules-ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 5,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 3,
          text: 3,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_agent_rules_prompt' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請說明亞L30x30的推論流程' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      ...({ agentRulesClient } as { agentRulesClient: SteelRepositoryClient }),
    });

    expect(agentRulesClient.calls[0]?.sql).toContain('FROM steel.agent_rules');
    expect(agentRulesClient.calls[0]?.values).toEqual([
      'reviewed',
      ['agent_instruction', 'tool_flow', 'inference_order', 'confirmation_policy'],
      20,
    ]);
    const generateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    const systemPrompt = generateOptions.prompt[0] as { role: 'system'; content: string };
    expect(systemPrompt.content).toContain(dbPrompt);
    expect(systemPrompt.content).not.toContain('AI owns Steel tool orchestration');
  });

  it('fails before calling the provider when reviewed agent_rules cannot be loaded', async () => {
    const agentRulesClient = createAgentRulesClient([]);
    const doGenerate = jest.fn();
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth,
        ensureFresh: false,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: '請說明亞L30x30的推論流程' }],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
        agentRulesClient: createDefaultAgentRulesClient(),
        ...({ agentRulesClient } as { agentRulesClient: SteelRepositoryClient }),
      }),
    ).rejects.toThrow('steel.agent_rules did not return reviewed Agent Prompt rules');
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('loads workbook output rules from reviewed agent_rules when workbook patching is enabled', async () => {
    const dbWorkbookPrompt =
      'DB_WORKBOOK_RULE_SENTINEL 使用 patch_quote_workbook 輸出 workbook；不要使用程式碼硬寫 workbook prompt。';
    const agentRulesClient = createAgentRulesClient([
      createAgentRuleRow(defaultAgentRulePrompt),
      createWorkbookRuleRow(dbWorkbookPrompt),
    ]);
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'workbook-db-rule-ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 5,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 3,
          text: 3,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_workbook_rules_prompt' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請輸出目前 workbook' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      workbookPatchTool: true,
      workbookContextText: 'sheet id="summary" label="總結"',
      agentRulesClient,
    });

    expect(agentRulesClient.calls[1]?.sql).toContain('FROM steel.agent_rules');
    expect(agentRulesClient.calls[1]?.values).toEqual(['reviewed', ['workbook_output_rule'], 20]);
    const generateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    const systemPrompt = generateOptions.prompt[0] as { role: 'system'; content: string };
    expect(systemPrompt.content).toContain(dbWorkbookPrompt);
    expect(systemPrompt.content).toContain('Workbook structure context:\nsheet id="summary"');
    expect(systemPrompt.content).not.toContain(
      'Workbook fill contract follows docs/reference/訂單參考_轉檔.xlsx',
    );
  });

  it('fails before calling the provider when workbook output rules cannot be loaded', async () => {
    const agentRulesClient = createAgentRulesClient([createAgentRuleRow(defaultAgentRulePrompt)]);
    const doGenerate = jest.fn();
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth,
        ensureFresh: false,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: '請輸出目前 workbook' }],
        reasoningEffort: 'medium',
        workbookPatchTool: true,
        workbookContextText: 'sheet id="summary" label="總結"',
        agentRulesClient,
      }),
    ).rejects.toThrow('steel.agent_rules did not return reviewed workbook output rules');
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('loads reviewed OCR rules for image and PDF evidence before provider generation', async () => {
    const ocrPrompt = 'OCR_RULE_SENTINEL 先局部判讀表格，再標記孔洞、開槽、折彎與低信心欄位。';
    const agentRulesClient = createAgentRulesClient([
      createAgentRuleRow(defaultAgentRulePrompt),
      createOcrRuleRow(ocrPrompt),
    ]);
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'ocr-rule-ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 5,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 3,
          text: 3,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_ocr_rules_prompt' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [
        {
          role: 'user',
          content: '請判讀這張圖面的表格。',
          files: [
            {
              filename: 'c.png',
              mediaType: 'image/png',
              data: new Uint8Array(Buffer.from('PNG_SENTINEL', 'utf8')),
            },
          ],
        },
      ],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient,
    });

    expect(agentRulesClient.calls[1]?.sql).toContain('FROM steel.agent_rules');
    expect(agentRulesClient.calls[1]?.values).toEqual([
      'reviewed',
      ['inference_order_rule', 'tool_flow_rule', 'output_policy_rule'],
      ['file_ocr', 'drawing_ocr', 'vision_evidence'],
      20,
    ]);
    const generateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    const systemPrompt = generateOptions.prompt[0] as { role: 'system'; content: string };
    expect(systemPrompt.content).toContain(ocrPrompt);
    expect(systemPrompt.content).toContain('docs/reference/OCR規則.txt');
    expect(systemPrompt.content).toContain('ocr-rule-sha256-sentinel');
  });

  it('fails before provider generation when visual evidence has no reviewed OCR rules', async () => {
    const agentRulesClient = createAgentRulesClient([createAgentRuleRow(defaultAgentRulePrompt)]);
    const doGenerate = jest.fn();
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth,
        ensureFresh: false,
        model: 'gpt-5.5',
        messages: [
          {
            role: 'user',
            content: '請重新判讀這份 PDF。',
            files: [
              {
                filename: 'scan.pdf',
                mediaType: 'application/pdf',
                data: new Uint8Array(Buffer.from('PDF_SENTINEL', 'utf8')),
              },
            ],
          },
        ],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
        agentRulesClient,
      }),
    ).rejects.toThrow('steel.agent_rules did not return reviewed OCR rules');
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('does not load OCR rules for non-visual turns', async () => {
    const agentRulesClient = createAgentRulesClient([createAgentRuleRow(defaultAgentRulePrompt)]);
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'text-only-ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 5,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 3,
          text: 3,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_no_ocr_rules_prompt' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請說明目前判讀流程。' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient,
    });

    expect(agentRulesClient.calls).toHaveLength(1);
    expect(agentRulesClient.calls[0]?.values).toEqual([
      'reviewed',
      ['agent_instruction', 'tool_flow', 'inference_order', 'confirmation_policy'],
      20,
    ]);
  });

  it('passes server-side OAuth settings and returns a sanitized provider response', async () => {
    const fetchResponses = jest.fn();
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'steel-provider-mock-ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 5,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 3,
          text: 3,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_mock' },
      warnings: [],
    }));
    const settingsSeen: OpenAIOAuthProviderSettings[] = [];
    const createOpenAIOAuth = jest.fn((settings?: OpenAIOAuthProviderSettings) => {
      settingsSeen.push(settings ?? {});

      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      authFilePath: '/tmp/steel/auth.json',
      createOpenAIOAuth,
      ensureFresh: false,
      fetch: fetchResponses,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'Reply exactly: steel-provider-mock-ok' }],
      reasoningEffort: 'medium',
    });

    expect(settingsSeen).toEqual([
      {
        authFilePath: '/tmp/steel/auth.json',
        ensureFresh: false,
        fetch: fetchResponses,
        responsesState: false,
      },
    ]);
    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Reply exactly: steel-provider-mock-ok' }],
          },
        ],
        providerOptions: {
          openai: {
            reasoningEffort: 'medium',
          },
        },
      }),
    );
    expect(response).toEqual({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: 'steel-provider-mock-ok',
      responseId: 'resp_steel_mock',
      usage: {
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
      },
      unsupportedSettings: [],
      warnings: [],
    });
    expect(JSON.stringify(response)).not.toMatch(/authFile|authorization|access_token/i);
  });

  it('requests provider reasoning summaries when a stream summary callback is present', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [
        { type: 'reasoning' as const, text: '先辨識 catalog key，再查 reviewed rules。' },
        { type: 'text' as const, text: 'ok' },
      ],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: {
          total: 5,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 3,
          text: 3,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_reasoning_summary' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const onReasoningSummary = jest.fn();

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼一支多少？' }],
      onReasoningSummary,
      reasoningEffort: 'medium',
    });

    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          openai: {
            reasoningEffort: 'medium',
            reasoningSummary: 'auto',
          },
        },
      }),
    );
    expect(onReasoningSummary).toHaveBeenCalledWith('先辨識 catalog key，再查 reviewed rules。');
    expect(response.text).toBe('ok');
  });

  it('serializes user file attachments as provider file parts', async () => {
    const fileData = new TextEncoder().encode('TXT_SENTINEL_7F3A 中文 12345');
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'TXT_SENTINEL_7F3A' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 9,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 4,
          text: 4,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_file_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const abortController = new AbortController();

    await sendSteelOAuthChat({
      abortSignal: abortController.signal,
      createOpenAIOAuth,
      ensureFresh: false,
      passThroughUnsupportedFiles: true,
      model: 'gpt-5.5',
      messages: [
        {
          role: 'user',
          content: 'Read the attached file and return its sentinel.',
          files: [
            {
              filename: 'steel-oauth-smoke.txt',
              mediaType: 'text/plain',
              data: fileData,
            },
          ],
        },
      ],
      reasoningEffort: 'medium',
    });

    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read the attached file and return its sentinel.' },
              {
                type: 'file',
                filename: 'steel-oauth-smoke.txt',
                mediaType: 'text/plain',
                data: fileData,
              },
            ],
          },
        ],
        abortSignal: abortController.signal,
        providerOptions: {
          openai: {
            passThroughUnsupportedFiles: true,
            reasoningEffort: 'medium',
          },
        },
      }),
    );
  });

  it('sets OpenAI image detail to high for image file parts', async () => {
    const imageData = new Uint8Array([137, 80, 78, 71]);
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'PNG_SENTINEL_B7E4' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 12,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 4,
          text: 4,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_image_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      passThroughUnsupportedFiles: true,
      model: 'gpt-5.5',
      messages: [
        {
          role: 'user',
          content: 'Read the attached image and return its sentinel.',
          files: [
            {
              filename: 'steel-oauth-smoke.png',
              mediaType: 'image/png',
              data: imageData,
            },
          ],
        },
      ],
      reasoningEffort: 'medium',
    });

    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read the attached image and return its sentinel.' },
              {
                type: 'file',
                filename: 'steel-oauth-smoke.png',
                mediaType: 'image/png',
                data: imageData,
                providerOptions: {
                  openai: {
                    imageDetail: 'high',
                  },
                },
              },
            ],
          },
        ],
      }),
    );
  });

  it('adds the AI-led Steel runtime policy when requested', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: '我會先查 reviewed facts，再列出候選給使用者確認。' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 31,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 9,
          text: 9,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_runtime_policy_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請說明亞L30x30的推論流程' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    const generateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    const systemPrompt = generateOptions.prompt[0] as { role: 'system'; content: string };
    expect(systemPrompt).toEqual(
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('你是「鋼鐵公司小助手」'),
      }),
    );
    expect(systemPrompt.content).toContain('回答一律使用繁體中文');
    expect(systemPrompt.content).toContain('不得把資料、單價、重量、客戶分級、公式或品類規則寫死');
    expect(systemPrompt.content).toContain('需要 reviewed 事實時必須使用 Steel tools');
    expect(systemPrompt.content).toContain('lookup_catalog_families');
    expect(systemPrompt.content).toContain('search_customers');
    expect(systemPrompt.content).toContain('lookup_quote_rules');
    expect(systemPrompt.content).toContain('search_price_candidates');
    expect(systemPrompt.content).toContain('patch_quote_workbook');
    expect(systemPrompt.content).toContain('價格先於重量');
    expect(systemPrompt.content).toContain('不可填 0；應填「未確認」');
    expect(systemPrompt.content).toContain('summary.totalAmount 必須等於 quote_details');
    expect(systemPrompt.content).not.toContain('AI owns Steel tool orchestration');
    const searchPriceTool = generateOptions.tools?.find(
      (tool) => tool.name === 'search_price_candidates',
    );
    const searchPriceToolSchema = JSON.stringify(searchPriceTool?.inputSchema);
    expect(searchPriceToolSchema).toContain('Reviewed product/source name');
    expect(searchPriceToolSchema).toContain('Multiple reviewed product/source name candidates');
    expect(searchPriceToolSchema).toContain('not oral/category/family label');
    expect(searchPriceToolSchema).toContain('catalogFamilies');
    expect(generateOptions.prompt[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '請說明亞L30x30的推論流程' }],
    });
  });

  it('requires catalog-family lookup before quote rules and price lookup for oral material price requests', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_catalog_lookup',
            toolName: 'lookup_catalog_families',
            input: JSON.stringify({
              searchText: 'C型鋼',
              limit: 5,
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 20,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 5,
            text: 5,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_catalog_lookup' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_after_catalog',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_quote_rules_after_catalog' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_after_rules',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use selected c_type catalog key after reviewed rules lookup',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_after_rules' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '依 C 型鋼 catalog key 與規則查到候選。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_catalog_sequence_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async ({ toolName }) => ({
      ok: true as const,
      toolName: toolName as
        | 'lookup_catalog_families'
        | 'lookup_quote_rules'
        | 'search_price_candidates',
      data:
        toolName === 'lookup_catalog_families'
          ? {
              catalogFamilyCandidates: [
                {
                  key: 'c_type',
                  displayName: 'C 型鋼',
                  aliases: ['C型鋼', 'C鋼', '輕型鋼'],
                },
              ],
            }
          : toolName === 'search_price_candidates'
            ? {
                priceCandidates: [
                  {
                    productName: '錏輕型鋼',
                    specKey: '100x2.3',
                    unitPrice: 26.8,
                  },
                ],
              }
            : {
                instructionPackets: [
                  {
                    slug: 'c-type-basic-quote-zh-v1',
                    packetGroups: ['c-type-quote-core'],
                  },
                ],
              },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    expect(
      (doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(steelBusinessToolNames);
    expect((doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    expect(
      (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(steelBusinessToolNames);
    expect(
      (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(steelBusinessToolNames);
    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_catalog_families',
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    expect(response.text).toBe('依 C 型鋼 catalog key 與規則查到候選。');
  });

  it('executes AI-callable Steel business tools and continues with tool results', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_tool_call_1',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['quote_price'],
              evidenceSummary: 'user asked 亞L30x30 一支多少',
              catalogContexts: [
                {
                  lineRefs: ['line_1'],
                  catalogCandidates: ['angle'],
                  surfaceCandidates: ['錏', '鍍鋅'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 31,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_steel_tool_first' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '已查到角鐵/錏材推論規則。',
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 44,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_steel_tool_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async () => ({
      ok: true as const,
      toolName: 'lookup_quote_rules' as const,
      data: {
        instructionPacketGroups: [
          {
            group: 'angle-zinc-quote-core',
            lineRefs: ['line_1'],
            packetSlugs: ['angle-surface-oral-zh-v1'],
          },
        ],
      },
      sourceRefs: [],
      durationMs: 2,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請查角鐵/錏材推論規則' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    expect(doGenerate).toHaveBeenCalledTimes(2);
    const firstOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    expect(firstOptions.tools?.map((tool) => tool.name)).toEqual([
      'lookup_quote_rules',
      'lookup_catalog_families',
      'search_customers',
      'search_price_candidates',
    ]);
    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        providerToolCallId: 'steel_tool_call_1',
        toolName: 'lookup_quote_rules',
        arguments: expect.objectContaining({
          evidenceSummary: 'user asked 亞L30x30 一支多少',
        }),
      }),
    );
    const secondOptions = doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions;
    expect(secondOptions.prompt).toEqual(
      expect.arrayContaining([
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'steel_tool_call_1',
              toolName: 'lookup_quote_rules',
              input: expect.objectContaining({
                evidenceSummary: 'user asked 亞L30x30 一支多少',
              }),
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'steel_tool_call_1',
              toolName: 'lookup_quote_rules',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: true,
                  toolName: 'lookup_quote_rules',
                  data: expect.objectContaining({
                    instructionPacketGroups: expect.any(Array),
                  }),
                }),
              },
            },
          ],
        },
      ]),
    );
    expect(response).toEqual(
      expect.objectContaining({
        text: '已查到角鐵/錏材推論規則。',
        responseId: 'resp_steel_tool_final',
        usage: {
          inputTokens: 75,
          outputTokens: 21,
          totalTokens: 96,
        },
      }),
    );
  });

  it('requires Steel tool calls until a price request gets search_price_candidates results', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_lookup_1',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['material_price_lookup'],
              evidenceSummary: 'user asked 亞L30x30 一支多少',
              catalogContexts: [{ catalogCandidates: ['angle'] }],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 20,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 5,
            text: 5,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_required_lookup' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_1',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: '亞L30x30',
              candidateQueries: [
                {
                  queryId: 'formed-zinc-angle',
                  productNames: ['錏角鐵 L30x30'],
                  confidence: 'medium',
                  reason: 'AI interpreted 亞 as possible 錏 and L30x30 as angle steel',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_required_price' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '暫估採錏成型角鐵 30x30x2.5x6M。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_required_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async ({ toolName }) => ({
      ok: true as const,
      toolName: toolName as 'lookup_quote_rules' | 'search_price_candidates',
      data:
        toolName === 'search_price_candidates'
          ? {
              priceCandidates: [
                {
                  productName: '錏成型角鐵',
                  specKey: 'angle_L30x30x2.5x6M',
                  unitPrice: 194.3,
                },
              ],
            }
          : { instructionPacketGroups: [] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '亞L30x30 一支多少' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    expect(doGenerate).toHaveBeenCalledTimes(3);
    expect((doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    expect((doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    expect(
      (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(steelBusinessToolNames);
    expect((doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'auto',
    });
    expect(executeSteelToolCall).toHaveBeenCalledTimes(2);
    expect(response.text).toBe('暫估採錏成型角鐵 30x30x2.5x6M。');
  });

  it('requires lookup_quote_rules before executing category-dependent price lookup', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_too_early',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'AI inferred C 型鋼 category and compact spec',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_price_too_early' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_after_reject',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_instruction' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_after_instruction',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use C 型鋼 instruction packet before reviewed price lookup',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 45,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_price_after_instruction' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '依 C 型鋼 instruction 查到候選。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 55,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_sequence_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async ({ toolName }) => ({
      ok: true as const,
      toolName: toolName as 'lookup_quote_rules' | 'search_price_candidates',
      data:
        toolName === 'search_price_candidates'
          ? {
              priceCandidates: [
                {
                  productName: '錏輕型鋼',
                  specKey: '100x2.3',
                  unitPrice: 26,
                },
              ],
            }
          : {
              instructionPackets: [
                {
                  slug: 'c-type-basic-quote-zh-v1',
                  packetGroups: ['c-type-quote-core'],
                },
              ],
            },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: expect.arrayContaining([
            expect.objectContaining({
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: false,
                  toolName: 'search_price_candidates',
                  errorCategory: 'invalid_arguments',
                  errorSummary: expect.stringContaining('lookup_quote_rules'),
                }),
              },
            }),
          ]),
        }),
      ]),
    );
    expect(response.text).toBe('依 C 型鋼 instruction 查到候選。');
  });

  it('defaults unknown customer tier price filters to B customerTierId after quote rules mark the tier unknown', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_unknown_tier',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              customerContext: {
                customerTierId: 1,
                tierKnown: false,
              },
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_quote_rules_unknown_tier' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_bad_tier',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              customerTierId: 1,
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'AI inferred C 型鋼 category and compact spec',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 35,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_bad_tier' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '未提供客戶或找不到客戶分級時，目前用價格B：26.8 元/kg；提供客戶名稱後可再查該客戶報價。',
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 55,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_final_b_default' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_quote_rules' as const,
        data: {
          instructionPackets: [
            {
              slug: 'c-type-basic-quote-zh-v1',
              packetGroups: ['c-type-quote-core'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_price_candidates' as const,
        data: {
          priceCandidates: [
            {
              productName: '錏輕型鋼',
              specKey: '100x2.3',
              customerTierCode: 'B',
              unitPrice: 26.8,
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      });

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    expect(executeSteelToolCall.mock.calls[1]?.[0].arguments).toEqual(
      expect.objectContaining({ customerTierId: 2 }),
    );
    expect(doGenerate).toHaveBeenCalledTimes(3);
    const finalPrompt = (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).prompt;
    const serializedFinalPrompt = JSON.stringify(finalPrompt);
    expect(serializedFinalPrompt).toContain('"toolName":"search_price_candidates"');
    expect(serializedFinalPrompt).toContain('"customerTierId":2');
    expect(serializedFinalPrompt).toContain('"customerTierCode":"B"');
    expect(response.text).toBe(
      '未提供客戶或找不到客戶分級時，目前用價格B：26.8 元/kg；提供客戶名稱後可再查該客戶報價。',
    );
  });

  it('uses a first-round customer lookup tier in quote rules and price lookup', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_catalog_lookup',
            toolName: 'lookup_catalog_families',
            input: JSON.stringify({
              searchText: 'C型鋼',
              limit: 5,
            }),
          },
          {
            type: 'tool-call',
            toolCallId: 'steel_customer_lookup',
            toolName: 'search_customers',
            input: JSON.stringify({
              searchText: '龍頂',
              limit: 3,
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_catalog_customer_lookup' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_customer',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: '龍頂 C型鋼 100x50x20 2.3t 一支多少',
              customerContext: {
                customerId: 10,
                customerName: '龍頂',
                customerTierId: 1,
                tierKnown: true,
              },
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 35,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_quote_rules_customer' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_customer_tier',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: '龍頂 C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              customerTierId: 1,
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use customer tier from search_customers',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_customer_tier' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已依龍頂客戶分級報價。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 55,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_final_customer_tier' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_catalog_families' as const,
        data: {
          catalogFamilyCandidates: [
            {
              key: 'c_type',
              displayName: 'C 型鋼',
              aliases: ['C型鋼', 'C鋼', '輕型鋼'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_customers' as const,
        data: {
          customers: [
            {
              id: 10,
              displayName: '龍頂',
              customerTier: {
                id: 1,
                code: 'A',
                name: 'A級',
              },
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_quote_rules' as const,
        data: {
          instructionPackets: [
            {
              slug: 'c-type-basic-quote-zh-v1',
              packetGroups: ['c-type-quote-core'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_price_candidates' as const,
        data: {
          priceCandidates: [
            {
              productName: '錏輕型鋼',
              specKey: '100x2.3',
              customerTierCode: 'A',
              unitPrice: 26,
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      });

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '龍頂 C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_catalog_families',
      'search_customers',
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    expect(
      (doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(steelBusinessToolNames);
    expect(
      (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(steelBusinessToolNames);
    expect(executeSteelToolCall.mock.calls[2]?.[0].arguments).toEqual(
      expect.objectContaining({
        customerContext: expect.objectContaining({
          customerId: 10,
          customerTierId: 1,
          tierKnown: true,
        }),
      }),
    );
    expect(executeSteelToolCall.mock.calls[3]?.[0].arguments).toEqual(
      expect.objectContaining({ customerTierId: 1 }),
    );
    expect(response.text).toBe('已依龍頂客戶分級報價。');
  });

  it('adds a specific price lookup reminder after quote rules when reviewed price lookup is still missing', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_only',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 C100x50x20x2.3t 6M 一支多少',
              customerContext: {
                tierKnown: false,
              },
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 25,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_quote_rules_only' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_after_reminder',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 C100x50x20x2.3t 6M 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  productNames: ['錏輕型鋼'],
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use the C 型鋼 compact reviewed price fragment after quote rules',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 35,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_after_reminder' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '目前用價格B：26.8 元/kg，並列出材質選項；提供客戶名稱後可再查該客戶報價。',
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 45,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_final_after_reminder' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_quote_rules' as const,
        data: {
          instructionPackets: [
            {
              slug: 'c-type-basic-quote-zh-v1',
              packetGroups: ['c-type-quote-core'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_price_candidates' as const,
        data: {
          priceCandidates: [
            {
              productName: '錏輕型鋼',
              specKey: '100x2.3',
              customerTierCode: 'B',
              unitPrice: 26.8,
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      });

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 C100x50x20x2.3t 6M 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    const serializedSecondPrompt = JSON.stringify(secondPrompt);
    expect((doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    expect(
      (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(steelBusinessToolNames);
    expect(serializedSecondPrompt).toContain('call search_price_candidates');
    expect(serializedSecondPrompt).toContain('100x2.3');
    expect(serializedSecondPrompt).toContain('productNames [錏輕型鋼]');
    expect(serializedSecondPrompt).toContain('candidateQueries.productNames');
    expect(serializedSecondPrompt).toContain('customerTierId 2');
    expect(serializedSecondPrompt).toContain('價格B');
    expect(serializedSecondPrompt).toContain('Do not add highest/most-expensive wording');
    expect(response.text).toBe(
      '目前用價格B：26.8 元/kg，並列出材質選項；提供客戶名稱後可再查該客戶報價。',
    );
  });

  it('does not treat invalid search_price_candidates arguments as a completed price lookup', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_instruction_first',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 25,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_instruction_first' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_bad',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-bad-product-name',
                  productNames: ['C型鋼'],
                  specKeyContains: '100x50x20',
                  confidence: 'high',
                  reason: 'AI selected c_type but reused the family label',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_bad_price' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_good',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use C 型鋼 family with the reviewed spec fragment',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_good_price' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '找到 C 型鋼 100x2.3 的候選價格。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_quote_rules' as const,
        data: {
          instructionPackets: [
            {
              slug: 'c-type-basic-quote-zh-v1',
              packetGroups: ['c-type-quote-core'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: false as const,
        toolName: 'search_price_candidates' as const,
        errorCategory: 'invalid_arguments' as const,
        errorSummary: 'Do not use C型鋼 as productNames after selecting c_type',
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_price_candidates' as const,
        data: {
          priceCandidates: [
            {
              productName: '錏輕型鋼',
              specKey: '100x2.3',
              unitPrice: 123,
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      });

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    expect(doGenerate).toHaveBeenCalledTimes(4);
    expect((doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    const thirdPrompt = (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).prompt;
    const serializedThirdPrompt = JSON.stringify(thirdPrompt);
    expect(serializedThirdPrompt).toContain('use catalogFamilies with the selected catalog key');
    expect(serializedThirdPrompt).toContain(
      'do not send oral family/category labels as productNames',
    );
    expect(serializedThirdPrompt).toContain(
      'use productNames with one or more AI-derived reviewed product/source-name candidates',
    );
    expect(serializedThirdPrompt).toContain('candidateQueries.productNames');
    expect(serializedThirdPrompt).toContain('use productNames or candidateQueries');
    expect(serializedThirdPrompt).toContain('specKeyContains 100x2.3');
    expect(serializedThirdPrompt).toContain('productNames [錏輕型鋼]');
    expect(
      (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(steelBusinessToolNames);
    expect(executeSteelToolCall).toHaveBeenCalledTimes(3);
    expect(response.text).toBe('找到 C 型鋼 100x2.3 的候選價格。');
  });

  it('does not require formula lookup when legacy reviewed rules mention lookup_formula', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_catalog_lookup',
            toolName: 'lookup_catalog_families',
            input: JSON.stringify({
              searchText: 'C型鋼',
              limit: 5,
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 20,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 5,
            text: 5,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_catalog' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  formulaCandidates: ['C'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_rules' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  productNames: ['錏輕型鋼'],
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use selected c_type catalog key and reviewed C 型鋼 rules',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_price' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '依 quote rules 公式規則與價格候選回答 C 型鋼報價。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_final_without_tool' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async ({ toolName }) => ({
      ok: true as const,
      toolName: toolName as
        | 'lookup_catalog_families'
        | 'lookup_quote_rules'
        | 'search_price_candidates',
      data:
        toolName === 'lookup_catalog_families'
          ? {
              catalogFamilyCandidates: [
                {
                  key: 'c_type',
                  displayName: 'C 型鋼',
                  aliases: ['C型鋼', 'C鋼', '輕型鋼'],
                },
              ],
            }
          : toolName === 'lookup_quote_rules'
            ? {
                instructionPackets: [
                  {
                    slug: 'c-type-basic-quote-zh-v1',
                    requiredLookups: ['search_price_candidates', 'lookup_formula'],
                  },
                ],
                requiredLookups: ['search_price_candidates', 'lookup_formula'],
              }
            : {
                priceCandidates: [
                  {
                    productName: '錏輕型鋼',
                    specKey: '100x2.3',
                    unitPrice: 26.8,
                  },
                ],
              },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_catalog_families',
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    expect(doGenerate).toHaveBeenCalledTimes(4);
    expect(response.text).toBe('依 quote rules 公式規則與價格候選回答 C 型鋼報價。');
  });

  it('requires a provisional semantic workbook patch after a positive quick-price lookup when workbook context exists', async () => {
    const semanticPatch = {
      customer: {
        name: '未提供',
        tier: 'B級',
        note: '未提供客戶，暫用價格B',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerOriginalItemName: '亞L30x30 一支多少',
          normalizedItemName: '錏成型角鐵 30x30x2.5x6M',
          searchKeywords: ['錏角鐵', '30x30'],
          productPriceCandidateItems: '錏成型角鐵 30x30x2.5x6M 194.3元/支',
          adoptedProductPriceItem: '錏成型角鐵 30x30x2.5x6M',
          isExactMatch: false,
          materialCategory: '角鐵',
          material: '錏',
          spec: 'L30x30',
          quantity: 1,
          unit: '支',
          customerName: '未提供',
          customerTier: 'B級',
          materialUnitPrice: 194.3,
          materialPricingUnit: '支',
          billableQuantity: 1,
          subtotal: 194.3,
          confidence: '低',
          lowConfidenceReason: '使用者未提供厚度，暫採 reviewed 候選',
          suggestedReview: '確認厚度、長度與客戶分級',
          systemOrder: {
            itemSpec: '錏成型角鐵 30x30x2.5x6M',
            unit: '支',
            quantity: 1,
            totalQuantity: 1,
            unitPrice: 194.3,
            pricingBasis: '價格B暫估',
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '未確認',
            differenceNote: '亞L30x30 口語輸入未指定厚度',
          },
          customerQuote: {
            itemSpec: '錏成型角鐵 30x30x2.5x6M',
            quantity: 1,
            unit: '支',
            unitPrice: 194.3,
            subtotal: 194.3,
            note: '暫估，待確認厚度與客戶',
          },
          manualReview: {
            confirmationNeeded: '確認厚度、長度與客戶分級後轉正式報價',
          },
          interpretationNote: {
            item: '口語品名轉換',
            content: '亞L30x30 暫採錏成型角鐵候選；需確認厚度。',
            confidence: '低',
          },
        },
      ],
      summary: {
        totalAmount: 194.3,
        unconfirmedCount: 1,
        lowConfidenceCount: 1,
      },
      customerQuoteTotal: {
        itemSpec: '報價總額',
        quantity: null,
        unit: null,
        unitPrice: null,
        subtotal: 194.3,
        note: '含暫估，待確認',
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_1',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: '亞L30x30 一支多少',
              candidateQueries: [
                {
                  queryId: 'formed-zinc-angle',
                  productNames: ['錏角鐵'],
                  specKeyContains: '30x30',
                  confidence: 'medium',
                  reason: 'AI interpreted 亞 as possible 錏 and L30x30 as angle steel',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_first' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '錏成型角鐵 L30x30x2.5x6M 暫估 194.3 元/支。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_text_without_patch' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          { type: 'text', text: '已寫入 provisional workbook preview。' },
          {
            type: 'tool-call',
            toolCallId: 'semantic_workbook_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 55,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_patch_final' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '暫估採錏成型角鐵 30x30x2.5x6M，材料單價 194.3 元/支。另有 30x30x3.0 等候選，請確認厚度、長度與客戶分級。',
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 18,
            text: 18,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_after_patch_text' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async () => ({
      ok: true as const,
      toolName: 'search_price_candidates' as const,
      data: {
        priceCandidates: [
          {
            productName: '錏成型角鐵',
            specKey: 'angle_L30x30x2.5x6M',
            unit: 'piece',
            unitPrice: 194.3,
          },
        ],
      },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '亞L30x30 一支多少' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\ncolumn label="材料單價" key="material_unit_price"\ncolumn label="小計" key="subtotal"\nrow id="line_1" cells: line_no=1 material_unit_price=null subtotal=null',
    });

    expect(doGenerate).toHaveBeenCalledTimes(4);
    const firstOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    const firstSystemPrompt = firstOptions.prompt[0] as { role: 'system'; content: string };
    expect(firstOptions.tools?.map((tool) => tool.name)).not.toContain('patch_workbook');
    expect(firstSystemPrompt.content).toContain('write provisional workbook preview rows');
    expect(firstSystemPrompt.content).toContain('update the `小計` column');
    expect(firstSystemPrompt.content).toContain(
      'Fill blank workbook cells when the value can be derived',
    );
    expect(firstSystemPrompt.content).toContain(
      'Leave a blank cell unchanged when material, customer, source, or calculation context is unavailable',
    );
    expect(firstSystemPrompt.content).toContain(
      'record the missing context in manual_review or interpretation_notes',
    );
    expect(firstSystemPrompt.content).toContain('Do not write confirmed totals');
    expect(firstSystemPrompt.content).toContain('line subtotal values and summary totals');
    expect(firstSystemPrompt.content).toContain('interpreted order information');
    expect(firstSystemPrompt.content).toContain('Do not list a per-field diff');
    expect(firstSystemPrompt.content).toContain('Do not answer only with a field count');
    expect(firstSystemPrompt.content).toContain('價格先於重量');
    expect(firstSystemPrompt.content).toContain('未確認單價或金額不可填 0');
    expect(firstSystemPrompt.content).toContain('系統訂單分頁材料列與加工列分開');
    expect(firstSystemPrompt.content).toContain('systemOrder.modelCode');
    expect(firstSystemPrompt.content).toContain('系統訂單.`型號`');
    expect(firstSystemPrompt.content).toContain('報價明細 小計');
    expect(firstSystemPrompt.content).toContain('summary.totalAmount');
    expect(firstSystemPrompt.content).toContain('給客戶用');
    expect(firstSystemPrompt.content).toContain('customerQuoteTotal');
    expect(firstSystemPrompt.content).toContain('不得出現客戶分級');
    expect(firstSystemPrompt.content).toContain('calculation_results');
    expect(firstSystemPrompt.content).toContain('Keep patch_quote_workbook compact');
    expect(firstSystemPrompt.content).toContain('Do not hand-write workbook cell operations');
    expect(firstSystemPrompt.content).not.toContain('patch_workbook');
    const thirdPrompt = (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(
      thirdPrompt.some(
        (message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('patch_quote_workbook') &&
          !message.content.includes('patch_workbook'),
      ),
    ).toBe(true);
    const fourthPrompt = (doGenerate.mock.calls[3]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(fourthPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: true,
                  projectedOperationCount: expect.any(Number),
                  complete: true,
                  instruction: expect.stringContaining('interpreted order information'),
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toContain('材料單價 194.3 元/支');
    expect(response.text).toContain('請確認厚度');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 194.3,
        }),
        expect.objectContaining({
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'item_spec',
          value: '錏成型角鐵 30x30x2.5x6M',
        }),
        expect.objectContaining({
          sheetId: 'manual_review',
          rowId: 'review_1',
          columnKey: 'confirmation_needed',
          value: '確認厚度、長度與客戶分級後轉正式報價',
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'subtotal',
          value: 194.3,
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_total',
          columnKey: 'item_spec',
          value: '報價總額',
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_total',
          columnKey: 'unit_price',
          value: null,
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_total',
          columnKey: 'subtotal',
          value: 194.3,
        }),
      ]),
    );
  });

  it('reprojects companion workbook sheets through semantic quote patches for quote follow-up updates', async () => {
    const semanticPatch = {
      customer: {
        name: '龍頂',
        tier: 'A級',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerOriginalItemName: 'C100x50x20x2.3t 6M 一支',
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: '錏輕型鋼 100*2.3',
          quantity: 1,
          unit: '支',
          totalWeightKg: 24,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          confidence: '中',
          systemOrder: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
            pricingBasis: '龍頂A級',
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
          },
          customerQuote: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
            note: '暫估',
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質後轉正式報價',
          },
          interpretationNote: {
            item: '客戶分級',
            content: '客戶改為龍頂候選，C型鋼改用A級價格重算。',
          },
        },
      ],
      summary: {
        totalAmount: 624,
        unconfirmedCount: 1,
        totalWeightKg: 24,
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_followup_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 10,
            text: 10,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_followup_patch_1' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已依龍頂A級更新：價格 26，小計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_followup_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [
        { role: 'user', content: 'C100x50x20x2.3t 6M 一支多少？' },
        {
          role: 'assistant',
          content: '暫估錏輕型鋼 100*2.3，價格B 26.8，小計 643.2。',
        },
        { role: 'user', content: '客戶是龍頂' },
      ],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26.8 subtotal=643.2',
    });

    expect(doGenerate).toHaveBeenCalledTimes(2);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  complete: true,
                  missingSheetIds: [],
                  missingCells: [],
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toContain('小計 624');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_total_amount',
          columnKey: 'value',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'subtotal',
          value: 624,
        }),
      ]),
    );
  });

  it('requires semantic workbook coverage when a semantic patch omits required companion fields', async () => {
    const sparseSemanticPatch = {
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          subtotal: 624,
        },
      ],
    };
    const completionSemanticPatch = {
      customer: {
        name: '龍頂',
        tier: 'A級',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: '錏輕型鋼 100*2.3',
          quantity: 1,
          unit: '支',
          totalWeightKg: 24,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          systemOrder: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
          },
          customerQuote: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質',
          },
          interpretationNote: {
            item: '客戶分級',
            content: '客戶改為龍頂候選，C型鋼改用A級價格重算。',
          },
        },
      ],
      summary: {
        totalAmount: 624,
        unconfirmedCount: 1,
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_sparse_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(sparseSemanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_sparse_patch_1' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_sparse_patch_2',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(completionSemanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 10,
            text: 10,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_sparse_patch_2' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已更新龍頂A級：小計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_sparse_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [
        { role: 'user', content: 'C100x50x20x2.3t 6M 一支多少？' },
        {
          role: 'assistant',
          content: '暫估錏輕型鋼 100*2.3，價格B 26.8，小計 643.2。',
        },
        { role: 'user', content: '客戶是龍頂' },
      ],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26.8 subtotal=643.2',
    });

    expect(doGenerate).toHaveBeenCalledTimes(3);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  complete: false,
                  missingCells: expect.any(Array),
                  instruction: expect.stringContaining('Call patch_quote_workbook again'),
                }),
              },
            }),
          ],
        }),
      ]),
    );
    const thirdPrompt = (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(thirdPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  complete: true,
                  missingSheetIds: [],
                  missingCells: [],
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toContain('小計 624');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'item_spec',
          value: '錏輕型鋼 100*2.3，6M',
        }),
        expect.objectContaining({
          sheetId: 'manual_review',
          rowId: 'review_1',
          columnKey: 'confirmation_needed',
          value: '確認龍頂客戶全名與材質',
        }),
      ]),
    );
  });

  it('projects semantic workbook patches into complete cell operations', async () => {
    const semanticPatch = {
      customer: {
        name: '龍頂',
        code: 'O-15',
        tier: 'A級',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerOriginalItemName: 'C100x50x20x2.3t 6M 一支',
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          searchKeywords: ['c_type', '錏輕型鋼', '100x2.3'],
          productPriceCandidateItems: '錏輕型鋼 100*2.3 A價26元/kg；白鐵輕型鋼 100*2.3 A價97元/kg',
          adoptedProductPriceItem: 'CCG10023 錏輕型鋼 100*2.3',
          isExactMatch: false,
          materialCategory: 'C型鋼',
          material: '錏',
          spec: 'C100x50x20x2.3t，6M',
          quantity: 1,
          unit: '支',
          totalWeightKg: 24,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialUnitPriceField: '售價A',
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          confidence: '中',
          lowConfidenceReason: '龍頂客戶仍有兩筆候選，需確認全名',
          decisionEvidence: 'search_customers + 產品價格.xlsx reviewed candidate',
          suggestedReview: '確認龍頂客戶全名與材質',
          systemOrder: {
            itemSpec: '錏C型鋼 C100x50x20x2.3 L=6000',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
            pricingBasis: '龍頂A級',
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
          },
          customerQuote: {
            itemSpec: '錏C型鋼 C100x50x20x2.3 L=6000',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
            note: '暫估',
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質',
          },
          interpretationNote: {
            item: '客戶分級',
            content: '客戶改為龍頂候選，C型鋼改用A級價格重算。',
          },
        },
      ],
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'semantic_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_semantic_patch' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已依龍頂A級更新：價格 26，小計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_semantic_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請把這筆C型鋼資料整理到 workbook' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26.8 subtotal=643.2',
    });

    expect(doGenerate).toHaveBeenCalledTimes(2);
    const firstOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    expect(firstOptions.tools?.map((tool) => tool.name)).toContain('patch_quote_workbook');
    expect(firstOptions.tools?.map((tool) => tool.name)).not.toContain('patch_workbook');
    const semanticTool = firstOptions.tools?.find((tool) => tool.name === 'patch_quote_workbook');
    expect(JSON.stringify(semanticTool?.inputSchema)).toContain('quoteLines');
    const firstSystemPrompt = firstOptions.prompt[0] as { role: 'system'; content: string };
    expect(firstSystemPrompt.content).toContain('patch_quote_workbook');
    expect(firstSystemPrompt.content).toContain('changing one quote value');

    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: true,
                  complete: true,
                  projectedOperationCount: expect.any(Number),
                  missingSheetIds: [],
                  missingCells: [],
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toContain('小計 624');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_total_amount',
          columnKey: 'value',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'price_sources',
          rowId: 'source_1',
          columnKey: 'adopted_unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'unit_price',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'subtotal',
          value: 624,
        }),
      ]),
    );
  });

  it('accepts semantic workbook patches that project beyond 100 cell operations', async () => {
    const semanticPatch = {
      quoteLines: Array.from({ length: 12 }, (_, index) => {
        const lineNo = index + 1;

        return {
          lineId: `line_${lineNo}`,
          lineNo,
          normalizedItemName: `測試材料 ${lineNo}`,
          adoptedProductPriceItem: `測試品項 ${lineNo}`,
          quantity: 1,
          unit: '支',
          materialUnitPrice: 100 + lineNo,
          subtotal: 100 + lineNo,
          confidence: '中',
          systemOrder: {
            itemSpec: `測試材料 ${lineNo}`,
            unit: '支',
            quantity: 1,
            totalQuantity: 1,
            unitPrice: 100 + lineNo,
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: String(1000 + lineNo),
          },
          customerQuote: {
            itemSpec: `測試材料 ${lineNo}`,
            quantity: 1,
            unit: '支',
            unitPrice: 100 + lineNo,
            subtotal: 100 + lineNo,
          },
          manualReview: {
            confirmationNeeded: `確認第 ${lineNo} 筆材料`,
          },
          interpretationNote: {
            item: `第 ${lineNo} 筆`,
            content: `第 ${lineNo} 筆報價投影`,
          },
        };
      }),
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'semantic_large_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_semantic_large_patch' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已更新 12 筆 workbook 報價資料。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_semantic_large_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請把 12 筆材料整理到 workbook' }],
      reasoningEffort: 'medium',
      workbookPatchTool: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      workbookContextText: 'sheet id="quote_details" label="報價明細"',
    });

    expect(response.workbookPatch?.operations.length).toBeGreaterThan(100);
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_12',
          columnKey: 'subtotal',
          value: 112,
        }),
      ]),
    );
  });

  it('does not return text before a required price lookup has executed', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '我需要你先提供客戶和長度。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 20,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 5,
            text: 5,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_missing_price_1' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '還是需要先補資料。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 24,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_missing_price_2' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth,
        ensureFresh: false,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: '亞L30x30 一支多少' }],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
        agentRulesClient: createDefaultAgentRulesClient(),
        steelToolMaxCalls: 1,
      }),
    ).rejects.toThrow(
      'search_price_candidates was required before answering this Steel price request.',
    );

    expect(doGenerate).toHaveBeenCalledTimes(2);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(
      secondPrompt.some(
        (message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('lookup_quote_rules') &&
          message.content.includes('search_price_candidates'),
      ),
    ).toBe(true);
  });

  it('stops the provider loop when Steel tool execution throws a repository error', async () => {
    const doGenerate = jest.fn().mockResolvedValueOnce({
      content: [
        {
          type: 'tool-call',
          toolCallId: 'steel_tool_call_error_1',
          toolName: 'lookup_quote_rules',
          input: JSON.stringify({
            taskTypes: ['product_price'],
            packetGroupHints: ['c_type'],
            evidenceSummary: 'C100x50x20x2.3t 6M 一支多少',
            catalogContexts: [
              {
                catalogCandidates: ['c_type'],
                packetGroupHints: ['c_type'],
                lineRefs: ['user: C100x50x20x2.3t 6M 一支多少'],
              },
            ],
            customerContext: {
              customerTierId: 2,
              tierKnown: false,
            },
            reviewState: 'reviewed',
            limit: 20,
          }),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: {
        inputTokens: {
          total: 20,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 5,
          text: 5,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_tool_error_first' },
      warnings: [],
    });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async () => {
      throw new Error('STEEL_POSTGRES_URL is required for Steel Postgres access');
    });

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth,
        ensureFresh: false,
        executeSteelToolCall,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'C100x50x20x2.3t 6M 一支多少' }],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
        agentRulesClient: createDefaultAgentRulesClient(),
      }),
    ).rejects.toThrow(
      'Steel tool lookup_quote_rules failed: STEEL_POSTGRES_URL is required for Steel Postgres access',
    );
    expect(executeSteelToolCall).toHaveBeenCalledTimes(1);
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('stops the provider loop on fatal Steel tool repository errors', async () => {
    const doGenerate = jest.fn().mockResolvedValueOnce({
      content: [
        {
          type: 'tool-call',
          toolCallId: 'steel_lookup_repo_error_1',
          toolName: 'lookup_quote_rules',
          input: JSON.stringify({
            taskTypes: ['product_price'],
            packetGroupHints: ['c_type'],
            evidenceSummary: 'C100x50x20x2.3t 6M 一支多少',
            catalogContexts: [
              {
                catalogCandidates: ['c_type'],
                packetGroupHints: ['c_type'],
                lineRefs: ['user: C100x50x20x2.3t 6M 一支多少'],
              },
            ],
            customerContext: {
              customerTierId: 2,
              tierKnown: false,
            },
            reviewState: 'reviewed',
            limit: 20,
          }),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: {
        inputTokens: {
          total: 20,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 5,
          text: 5,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_lookup_repo_error' },
      warnings: [],
    });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async () => ({
      ok: false as const,
      toolName: 'lookup_quote_rules',
      errorCategory: 'repository_error' as const,
      errorSummary: 'Connection terminated due to connection timeout',
      durationMs: 5000,
      redactionVersion: 1 as const,
    }));

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth,
        ensureFresh: false,
        executeSteelToolCall,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'C100x50x20x2.3t 6M 一支多少' }],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
        agentRulesClient: createDefaultAgentRulesClient(),
      }),
    ).rejects.toThrow(
      'Steel tool lookup_quote_rules failed: Connection terminated due to connection timeout',
    );

    expect(executeSteelToolCall).toHaveBeenCalledTimes(1);
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('enables only the semantic workbook patch tool and projects model tool calls into patch operations', async () => {
    const semanticPatch = {
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          materialUnitPrice: 115,
          interpretationNote: {
            item: '手動更新',
            content: 'User asked AI to update quote_details line_1 material_unit_price to 115.',
          },
        },
      ],
    };
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [
        { type: 'text', text: '已更新報價明細。' },
        {
          type: 'tool-call',
          toolCallId: 'tool_call_1',
          toolName: 'patch_quote_workbook',
          input: JSON.stringify(semanticPatch),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: {
        inputTokens: {
          total: 21,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 8,
          text: 8,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_workbook_patch_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'set quote_details line_1 material_unit_price 115' }],
      reasoningEffort: 'medium',
      workbookPatchTool: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      workbookContextText:
        'sheet id="summary" label="總結"\ncolumn label="值" key="value"\nrow id="summary_total_amount" cells: item="總額"',
    });

    const generateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    expect(generateOptions.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('sheet id="summary" label="總結"'),
        }),
      ]),
    );
    const systemPrompt = generateOptions.prompt[0] as { role: 'system'; content: string };
    expect(systemPrompt.content).toContain('column label="值" key="value"');
    expect(systemPrompt.content).toContain('Do not ask the user for internal workbook ids or keys');
    expect(systemPrompt.content).toContain('Do not list a per-field diff');
    expect(systemPrompt.content).toContain('Do not answer only with a field count');
    expect(systemPrompt.content).toContain('Do not hand-write workbook cell operations');
    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice: { type: 'auto' },
        tools: [
          expect.objectContaining({
            type: 'function',
            name: 'patch_quote_workbook',
            inputSchema: expect.objectContaining({
              properties: expect.objectContaining({
                quoteLines: expect.any(Object),
              }),
            }),
          }),
        ],
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        text: '已更新報價明細。',
        workbookPatch: {
          operations: expect.arrayContaining([
            expect.objectContaining({
              op: 'set_cell',
              sheetId: 'quote_details',
              rowId: 'line_1',
              columnKey: 'material_unit_price',
              value: 115,
              reason: expect.any(String),
            }),
          ]),
        },
      }),
    );
  });

  it('keeps the fixed OAuth/Codex path free of registered code interpreter tools', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text' as const, text: 'oauth codex path only' }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: {
          total: 20,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 5,
          text: 5,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_oauth_codex_fixed_path' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請說明 subtotal validation 狀態' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
    });

    const firstOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    expect(firstOptions.tools).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          type: 'provider',
        }),
      ]),
    );
  });

  it('accepts workbook totalAmount when it matches line subtotals', async () => {
    const semanticPatch = {
      customer: {
        name: '龍頂',
        tier: 'A級',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: '錏輕型鋼 100*2.3',
          quantity: 1,
          unit: '支',
          totalWeightKg: 24,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          confidence: '中',
          systemOrder: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
          },
          customerQuote: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質',
          },
          interpretationNote: {
            item: 'subtotal validation',
            content: 'summary totals match line subtotal values.',
          },
        },
      ],
      summary: {
        totalAmount: 624,
        totalWeightKg: 24,
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_total_subtotal_match',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 10,
            text: 10,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_total_subtotal_match' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已依 subtotal 檢查後更新：小計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_subtotal_validated_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請把目前 C 型鋼 line_1 的小計整理成 workbook total' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26 subtotal=null',
    });

    expect(doGenerate).toHaveBeenCalledTimes(2);
    expect(response.text).toBe('已依 subtotal 檢查後更新：小計 624。');
    expect(response).not.toHaveProperty('calculationEvidence');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_total_amount',
          columnKey: 'value',
          value: 624,
        }),
      ]),
    );
  });

  it('loops when workbook summary totals do not match line subtotals', async () => {
    const wrongPatch = {
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: '錏輕型鋼 100*2.3',
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          systemOrder: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
          },
          customerQuote: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質',
          },
          interpretationNote: {
            item: 'subtotal validation',
            content: 'summary total must match line subtotal sum.',
          },
        },
      ],
      summary: {
        totalAmount: 625,
      },
    };
    const correctedPatch = {
      ...wrongPatch,
      summary: {
        totalAmount: 624,
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_total_mismatch',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(wrongPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 10,
            text: 10,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_total_mismatch' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_total_corrected',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(correctedPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_total_corrected' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已修正總結金額：小計合計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 14,
            text: 14,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_total_corrected_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請把 C 型鋼 line_1 的總結金額改成 totalAmount' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26 subtotal=null',
    });

    expect(doGenerate).toHaveBeenCalledTimes(3);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  complete: false,
                  subtotalMismatch: {
                    expectedTotal: 624,
                    mismatchedFields: ['summary.totalAmount'],
                    actualTotals: {
                      'summary.totalAmount': 625,
                    },
                  },
                  instruction: expect.stringContaining('sum of line subtotal values'),
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toBe('已修正總結金額：小計合計 624。');
    expect(response).not.toHaveProperty('calculationEvidence');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 624,
        }),
      ]),
    );
    expect(response.workbookPatch?.operations).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_total_amount',
          columnKey: 'value',
          value: 625,
        }),
      ]),
    );
  });

  it('loops when workbook totalAmount is numeric but a line subtotal is unknown', async () => {
    const unknownPatch = {
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: '未確認',
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: '未確認',
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: '未確認',
          manualReview: {
            confirmationNeeded: '缺 reviewed 單價，不能寫總額',
          },
          interpretationNote: {
            item: 'subtotal validation',
            content: 'line subtotal is unknown, so totalAmount is not allowed.',
          },
        },
      ],
      summary: {
        totalAmount: 624,
      },
    };
    const correctedPatch = {
      ...unknownPatch,
      summary: {
        totalAmount: '未確認',
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_unknown_subtotal_total',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(unknownPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 10,
            text: 10,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_unknown_subtotal_total' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_unknown_subtotal_corrected',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(correctedPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_unknown_subtotal_corrected' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已改為未確認總額，等待補單價。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 14,
            text: 14,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_unknown_subtotal_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請把 line_1 的總結金額改成 totalAmount' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createDefaultAgentRulesClient(),
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" subtotal=未確認',
    });

    expect(doGenerate).toHaveBeenCalledTimes(3);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  complete: false,
                  subtotalMismatch: {
                    mismatchedFields: ['summary.totalAmount'],
                    actualTotals: {
                      'summary.totalAmount': 624,
                    },
                    unknownSubtotalLineRefs: ['line_1'],
                  },
                  instruction: expect.stringContaining('line subtotal is unknown'),
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toBe('已改為未確認總額，等待補單價。');
    expect(response.workbookPatch?.operations).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_total_amount',
          columnKey: 'value',
          value: 624,
        }),
      ]),
    );
  });
});
