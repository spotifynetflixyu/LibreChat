import { createSteelToolRunState, executeSteelTool } from './execute';

import type { SteelRepositoryClient, SteelSqlParameter } from '../repositories/types';
import type { SteelToolLogEntry } from './results';

interface QueryCall {
  sql: string;
  values?: readonly SteelSqlParameter[];
}

interface CapturingClient extends SteelRepositoryClient {
  calls: QueryCall[];
}

function createClient(rowBatches: object[][]): CapturingClient {
  const calls: QueryCall[] = [];

  return {
    calls,
    query: async <Row extends object>(
      sql: string,
      values?: readonly SteelSqlParameter[],
    ): Promise<{ rows: Row[] }> => {
      calls.push({ sql, values });
      return { rows: (rowBatches.shift() ?? []) as Row[] };
    },
  };
}

const instructionPacketFixtures: { [slug: string]: object } = {
  'angle-surface-oral-zh-v1': {
    id: '31',
    slug: 'angle-surface-oral-zh-v1',
    version: '1',
    title: '角鐵口語與表面處理候選',
    locale: 'zh-TW',
    packet_groups: ['angle-zinc-quote-core'],
    selectors: { catalogFamilies: ['angle'] },
    instruction:
      'L30x30 可作為等邊角鐵候選；亞只能作低信心表面處理線索。成型角鐵若出現 30*2.5*6M 這類價格表規格，也必須查 30x2.5x6M、30x2.5 等價格表 spec fragments。',
    blocking_rules: [
      '不要把 亞L30x30 當作價格表 canonical key。',
      '不要只列最高相似候選，省略其他 bounded options。',
    ],
    required_lookups: ['search_price_candidates'],
    user_visible_notes: ['亞L30x30 是低信心口語線索。'],
    confirmation_questions: ['請確認 亞 是指錏材、鍍鋅，還是其他表面處理。'],
    priority: '90',
    confidence: 'medium',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'angle-surface-oral-zh-v1',
      },
    ],
  },
  'c-type-basic-quote-zh-v1': {
    id: '21',
    slug: 'c-type-basic-quote-zh-v1',
    version: '1',
    title: 'C 型鋼專用計價規則',
    locale: 'zh-TW',
    packet_groups: ['c-type-quote-core'],
    selectors: { catalogFamilies: ['c_type'], formulaCodes: ['C'] },
    instruction:
      'C 型鋼仍必須先查 reviewed product-price rows。材質不明時，AI 使用 productNames: [錏輕型鋼] 作為通常情況的高信心候選；第一輪回覆必須列出同規格不同材質的 reviewed bounded options（例如白鐵輕型鋼、黑鐵輕型鋼）供確認，第二輪若用戶未指定其他材質/表面，視為確認預設錏輕型鋼。未指定客戶或找不到客戶價格等級時，查價自動使用 B 價分級 customerTierId 2；回覆提醒目前用價格B，若提供客戶名稱可再查該客戶報價，不要加最高/最貴說明。價格 bullet 用價格，不要寫 reviewed 價格。快速報價已有總重時，不要再另外列單位重。C 型鋼切工與孔費預設免費，可列為 true-zero/no-charge。',
    blocking_rules: [
      '不要把 C型鋼 當作 productNames 候選卡死價格查詢。',
      '不要在 customer/tier 未知時把 customerTierId 設為 A/tier 1；查價必須使用 B 價分級 customerTierId 2。',
      '不要在材質不明的第一輪只顯示錏輕型鋼，省略同規格其他材質候選。',
      '不要把 C 型鋼切工/孔費免費規則套用到材料單價、特殊加工或非 C 型鋼品項。',
    ],
    required_lookups: ['search_price_candidates', 'lookup_formula'],
    user_visible_notes: [
      '材質不明時，錏輕型鋼可作高信心暫估候選；第一輪需列出同規格其他材質選項。',
      '未指定客戶或找不到客戶價格等級時，查價使用 B 價 customerTierId 2；回覆提醒目前用價格B，提供客戶名稱後可再查該客戶報價，不要加最高/最貴說明；價格 bullet 用價格，不要寫 reviewed 價格。',
    ],
    confirmation_questions: [
      '請確認材質是否為錏輕型鋼；若下一輪未指定其他材質，視為確認預設錏輕型鋼。',
    ],
    priority: '90',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'c-type-basic-quote-zh-v1',
      },
    ],
  },
  'price-source-priority-zh-v1': {
    id: '22',
    slug: 'price-source-priority-zh-v1',
    version: '1',
    title: '價格來源優先順序',
    locale: 'zh-TW',
    packet_groups: ['global-quote-core', 'c-type-quote-core'],
    selectors: { catalogFamilies: ['*'] },
    instruction:
      '除非使用者明確提供單價，材料與加工報價必須先查 reviewed product-price rows。單價空白或 0 預設是 missing price，不可填 0。',
    blocking_rules: [
      '不要只用手冊重量推價。',
      '不要把 blank / 0 product price 當作免費或 true-zero。',
    ],
    required_lookups: ['search_price_candidates'],
    user_visible_notes: ['材料與加工價格以 reviewed price rows 優先。'],
    confirmation_questions: [],
    priority: '80',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'price-source-priority-zh-v1',
      },
    ],
  },
  'product-price-unit-weight-calculation-zh-v1': {
    id: '25',
    slug: 'product-price-unit-weight-calculation-zh-v1',
    version: '1',
    title: '產品價格單位重與售價計算',
    locale: 'zh-TW',
    packet_groups: [
      'global-quote-core',
      'angle-zinc-quote-core',
      'c-type-quote-core',
      'h-type-quote-core',
      'black-long-material-cutting-core',
      'plate-processing-core',
    ],
    selectors: {
      catalogFamilies: [
        'h_beam',
        'c_type',
        'angle',
        'channel',
        'flat_bar',
        'rail',
        'b_pipe',
        'a_pipe',
        'p_pipe',
        'steel_pipe',
        'piping',
        'i_beam',
        'round_bar',
        'square_bar',
        'rectangular_pipe',
        'round_pipe',
        'square_pipe',
        'plate',
        'galvanized_plate',
        'ot_plate',
        'black_plate',
        'grating',
        'wire_mesh',
        'expanded_metal',
        'floor_deck',
        'corrugated_panel',
      ],
      taskTypes: ['material_price_lookup'],
      priceFields: [
        'unit',
        'unitPrice',
        'productPriceUnitWeight',
        'productPriceUnitWeightUnit',
        'metadata.sourceRatio',
        'metadata.sourcePriceUnitBasis',
        'metadata.sourceUnitWeightColumn',
        'metadata.sourceUnitWeightOrigin',
        'metadata.sourceParentheticalUnitWeight',
        'metadata.productPriceWeightRuleScope',
      ],
    },
    instruction:
      '產品價格.xlsx 的 unitPrice 必須搭配 unit、productPriceUnitWeight 與 productPriceUnitWeightUnit 解讀。unit = kg 時 unitPrice 是每 kg 售價，材料金額 = weightKg * unitPrice；unit = piece 時 unitPrice 已是整支/整件金額。此規則只套用鋼材/材料 stock catalog families；h_beam 包含輕量H，BNH 屬鋼材板材，彈簧/螺絲/門鎖等非材料產品不套用。C型鋼 C100x50x20x2.3t 6M 若 unit = kg、unitPrice = 25-26.8 且 productPriceUnitWeight = 4kg/m，一支 6M 是 24kg，暫估材料價約 NT$600-643.2，不可回答 NT$25-26.8/支。白鐵平鐵 50 *8.0( 19.7) 若單位重欄為 0，但售價 2107.90 = 括號重量 19.7 * 比率 107，括號重量是重量/支補漏來源，unit = piece 時 2107.90 已是整支金額。若單位重欄位已有正值，欄位值優先於品名括號；6K鐵軌 6M(38) 的單位重=36 且 9K鐵軌 6M(54) 可佐證比例，所以採 36。固定長度材料 row 若有正值比率欄且售價欄為整支價，例如 6K鐵軌 A 價 2090，即使售價看起來由錯誤括號重量算出，也不可把 2090 當每 kg 單價。缺漏或矛盾時可查相同系列/同規格相關材料推論，但必須標示 inferred/low confidence 或待確認。',
    blocking_rules: [
      '不要把 productPriceUnitWeightUnit = kg_per_m 的 unitPrice 當成 per-piece price。',
      '不要只看 productPriceUnitWeightUnit 就決定售價單位；必須同時看 reviewed row 的 unit。',
      '不要把非鋼材或非材料產品/accessory row 套用鋼材 kg/m、kg/支計算規則。',
      '不要用品名括號覆蓋正值單位重欄位；括號只在欄位為 0/缺失且可驗證時補漏。',
      '不要把固定長度材料 row 的整支售價誤當每 kg 單價。',
      '不要把相近材料比例推論當成 reviewed 欄位值。',
      '不要用 0 或空白單位重計算材料金額。',
    ],
    required_lookups: ['search_price_candidates', 'lookup_formula'],
    user_visible_notes: ['產品價格列若是 kg_per_m，售價是每 kg，必須先依長度換算重量再乘售價。'],
    confirmation_questions: ['請確認本次長度、數量，以及是否整支含餘料計價。'],
    priority: '45',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'product-price-unit-weight-calculation-zh-v1',
      },
    ],
  },
  'h-type-length-surcharge-zh-v1': {
    id: '41',
    slug: 'h-type-length-surcharge-zh-v1',
    version: '1',
    title: 'H 型鋼米數與非常規加價',
    locale: 'zh-TW',
    packet_groups: ['h-type-quote-core'],
    selectors: { catalogFamilies: ['h_beam'], formulaCodes: ['H'] },
    instruction:
      'H 型鋼常規米數為 6M、9M、10M、12M。H 型鋼非常規米數為 7M、8M、11M、13M、14M、15M；非常規米數理論上比一般米數材料 kg 單價 +0.3 元/kg，但產品價格表的 exact reviewed 非常規米數列已含非常規 +0.3 元/kg，查到 exact reviewed price row 時不可再加一次。',
    blocking_rules: ['不要把非常規 +0.3/kg 套到非 H 型鋼。'],
    required_lookups: ['search_price_candidates', 'lookup_formula'],
    user_visible_notes: ['H 型鋼 exact reviewed 非常規米數列已含 +0.3/kg。'],
    confirmation_questions: ['請確認 H 型鋼長度是否為常規或非常規米數。'],
    priority: '85',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'h-type-length-surcharge-zh-v1',
      },
    ],
  },
  'h-and-i-beam-cutting-price-zh-v1': {
    id: '42',
    slug: 'h-and-i-beam-cutting-price-zh-v1',
    version: '1',
    title: 'H 型鋼與工字鐵切工價錢判讀',
    locale: 'zh-TW',
    packet_groups: ['h-type-quote-core'],
    selectors: { catalogFamilies: ['h_beam'], processingTypes: ['cutting', 'hole', 'slotting'] },
    instruction:
      'H 型鋼切工優先查 reviewed cutting rows。整理列提供 processing price candidates：開槽 KZZB10 140/150、沖孔 KZZB11 16/17、倒角 KZZB12 140/150。斜切、修頭尾、特別加工需另外判斷切工次數或加價。',
    blocking_rules: [
      '不要把未確認切工價填 0。',
      '不要忽略斜切、修頭尾、特別加工造成的切工次數或加價。',
    ],
    required_lookups: ['search_price_candidates'],
    user_visible_notes: ['H 型鋼切工、開槽、沖孔、倒角要查 reviewed rows。'],
    confirmation_questions: ['請確認 H 型鋼加工數量、孔數、開槽路徑或斜切。'],
    priority: '75',
    confidence: 'medium',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'h-and-i-beam-cutting-price-zh-v1',
      },
    ],
  },
  'formula-code-selection-zh-v1': {
    id: '23',
    slug: 'formula-code-selection-zh-v1',
    version: '1',
    title: '公式編號候選選擇',
    locale: 'zh-TW',
    packet_groups: ['global-quote-core', 'c-type-quote-core'],
    selectors: { catalogFamilies: ['c_type'], formulaCodes: ['C'] },
    instruction: 'C 型鋼候選公式為 C；必須透過 lookup_formula 查 reviewed active formula rows。',
    blocking_rules: ['不要跳過 lookup_formula 或 reviewed formula validation。'],
    required_lookups: ['lookup_formula'],
    user_visible_notes: ['公式必須查 reviewed formula rows。'],
    confirmation_questions: [],
    priority: '80',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'formula-code-selection-zh-v1',
      },
    ],
  },
  'drawing-processing-detection-zh-v1': {
    id: '24',
    slug: 'drawing-processing-detection-zh-v1',
    version: '1',
    title: '圖面孔洞與加工判讀',
    locale: 'zh-TW',
    packet_groups: ['plate-processing-core', 'c-type-quote-core'],
    selectors: { catalogFamilies: ['c_type'], processingTypes: ['hole'] },
    instruction:
      '【孔洞】孔數依表格孔數優先、圖面孔位交叉確認。4-Ø22 = 每片 4 孔。C 型鋼孔費預設免費。',
    blocking_rules: ['不要只依 OCR 算孔洞、開槽、折工。'],
    required_lookups: ['search_price_candidates'],
    user_visible_notes: ['孔洞、開槽、折工要依表格和圖面交叉確認。'],
    confirmation_questions: ['請確認孔洞數、開槽路徑、折工刀數。'],
    priority: '70',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'drawing-processing-detection-zh-v1',
      },
    ],
  },
  'oral-material-candidate-generation-zh-v1': {
    id: '32',
    slug: 'oral-material-candidate-generation-zh-v1',
    version: '1',
    title: '口語品名候選推導',
    locale: 'zh-TW',
    packet_groups: ['global-quote-core', 'angle-zinc-quote-core'],
    selectors: { catalogFamilies: ['*'] },
    instruction: '客戶口語品名要先拆成材料類別、材質/表面、尺寸、厚度、長度、數量與加工註記。',
    blocking_rules: ['不要把口語轉換當作 confirmed source fact。'],
    required_lookups: ['search_price_candidates'],
    user_visible_notes: ['口語品名只能作為候選。'],
    confirmation_questions: ['請確認口語品名對應的材質、表面處理、尺寸、厚度、長度與單位。'],
    priority: '70',
    confidence: 'medium',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'oral-material-candidate-generation-zh-v1',
      },
    ],
  },
  'black-steel-cutting-price-zh-v1': {
    id: '33',
    slug: 'black-steel-cutting-price-zh-v1',
    version: '1',
    title: '黑鐵類切工候選',
    locale: 'zh-TW',
    packet_groups: ['black-long-material-cutting-core', 'angle-zinc-quote-core'],
    selectors: { processingTypes: ['cutting'] },
    instruction:
      '黑角鐵、黑槽鐵、黑平鐵、黑鐵管等長條材料需要切工時，應依 reviewed cutting/default data 判斷。',
    blocking_rules: ['不要將黑鐵類切工價自動套到白鐵、錏材或厚料而不加價/不另計。'],
    required_lookups: ['search_price_candidates'],
    user_visible_notes: ['黑鐵類切工需要依 reviewed cutting/default data。'],
    confirmation_questions: ['請確認切工是否為黑鐵長條材料。'],
    priority: '60',
    confidence: 'medium',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'black-steel-cutting-price-zh-v1',
      },
    ],
  },
  'cut-count-and-trim-detection-zh-v1': {
    id: '43',
    slug: 'cut-count-and-trim-detection-zh-v1',
    version: '1',
    title: '切刀數與修頭尾判讀',
    locale: 'zh-TW',
    packet_groups: [
      'h-type-quote-core',
      'black-long-material-cutting-core',
      'angle-zinc-quote-core',
    ],
    selectors: { processingTypes: ['cutting', 'head_tail_trim'] },
    instruction: '一個切口預設為 1 刀；修頭尾時需把頭修、中間切、尾修分開判斷。',
    blocking_rules: ['不要把「修頭尾」算成 1 刀。'],
    required_lookups: [],
    user_visible_notes: ['一個切口預設 1 刀；修頭尾要分開算。'],
    confirmation_questions: ['請確認是否有修頭尾、斜切、翼板切斜或特殊角度。'],
    priority: '60',
    confidence: 'medium',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'repo_docs',
        factType: 'instruction_packet',
        sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        locator: 'cut-count-and-trim-detection-zh-v1',
      },
    ],
  },
};

function instructionRows(slugs: string[]): object[] {
  return slugs.map((slug) => {
    const row = instructionPacketFixtures[slug];

    if (!row) {
      throw new Error(`Missing instruction packet fixture: ${slug}`);
    }

    return row;
  });
}

describe('executeSteelTool', () => {
  it('rejects merged instruction/default compatibility tools as non-callable AI tools', async () => {
    const client = createClient([]);

    await expect(
      executeSteelTool({
        client,
        toolName: 'lookup_instructions',
        arguments: {
          taskTypes: ['material_price_lookup'],
          evidenceSummary: 'C 型鋼報價',
          catalogContexts: [{ catalogCandidates: ['c_type'] }],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        toolName: 'lookup_instructions',
        errorCategory: 'unknown_tool',
        errorSummary: 'Unknown Steel tool: lookup_instructions',
      }),
    );
    await expect(
      executeSteelTool({
        client,
        toolName: 'lookup_defaults',
        arguments: {
          catalogContexts: [{ catalogCandidates: ['c_type'] }],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        toolName: 'lookup_defaults',
        errorCategory: 'unknown_tool',
        errorSummary: 'Unknown Steel tool: lookup_defaults',
      }),
    );
    expect(client.calls).toHaveLength(0);
  });

  it('executes repository-backed customer search and logs a bounded success summary', async () => {
    const client = createClient([
      [
        {
          id: '10',
          erp_customer_code: 'C001',
          display_name: '龍頂',
          legal_name: null,
          tax_id: null,
          customer_tier_id: '2',
          customer_tier_code: 'A',
          customer_tier_name: 'A級',
          matched_alias: null,
          status: 'active',
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'customer',
              locator: 'sheet=客戶資料;row=2',
            },
          ],
        },
      ],
    ]);
    const logs: SteelToolLogEntry[] = [];

    const result = await executeSteelTool({
      client,
      toolName: 'search_customers',
      arguments: { searchText: '龍頂', limit: 3 },
      providerToolCallId: 'call_1',
      log: (entry) => logs.push(entry),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(result.data).toEqual({
      customers: [
        {
          id: 10,
          erpCustomerCode: 'C001',
          displayName: '龍頂',
          customerTier: {
            id: 2,
            code: 'A',
            name: 'A級',
          },
          status: 'active',
          sourceRefs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'customer',
              locator: 'sheet=客戶資料;row=2',
            },
          ],
        },
      ],
    });
    expect(client.calls[0]?.values).toEqual(['龍頂', '%龍頂%', 3]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      toolName: 'search_customers',
      providerToolCallId: 'call_1',
      status: 'success',
      errorCategory: undefined,
      outputSummary: 'customers=1',
      sourceRefs: [
        {
          channel: 'admin_erp_xlsx',
          factType: 'customer',
          locator: 'sheet=客戶資料;row=2',
        },
      ],
      redactionVersion: 1,
    });
  });

  it('rejects invalid arguments before running SQL', async () => {
    const client = createClient([]);
    const logs: SteelToolLogEntry[] = [];

    const result = await executeSteelTool({
      client,
      toolName: 'search_customers',
      arguments: { limit: 3 },
      log: (entry) => logs.push(entry),
    });

    expect(result).toMatchObject({
      ok: false,
      toolName: 'search_customers',
      errorCategory: 'invalid_arguments',
    });
    expect(client.calls).toHaveLength(0);
    expect(logs[0]).toMatchObject({
      toolName: 'search_customers',
      status: 'error',
      errorCategory: 'invalid_arguments',
      redactionVersion: 1,
    });
  });

  it('rejects old materialFamilies price-search arguments instead of keeping compatibility', async () => {
    const client = createClient([]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        productNames: ['H型鋼'],
        materialFamilies: ['h_beam'],
        limit: 5,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      toolName: 'search_price_candidates',
      errorCategory: 'invalid_arguments',
    });
    expect(client.calls).toHaveLength(0);
  });

  it('does not expose reasoning helpers or legacy low-level lookups as executable tools', async () => {
    const client = createClient([]);

    for (const toolName of [
      'normalize_quote_item',
      'generate_price_search_terms',
      'rank_price_candidates',
      'lookup_customer',
      'lookup_spec_price',
      'lookup_weight_spec',
      'lookup_cutting_price',
      'lookup_hole_price',
      'lookup_processing_price',
      'lookup_material_rules',
      'lookup_formula_version',
      'find_order_items',
      'search_source_chunks',
    ]) {
      const result = await executeSteelTool({
        client,
        toolName,
        arguments: {},
      });

      expect(result).toMatchObject({
        ok: false,
        toolName,
        errorCategory: 'unknown_tool',
      });
    }
    expect(client.calls).toHaveLength(0);
  });

  it('returns catalog-family vocabulary candidates for AI selection without resolving a key', async () => {
    const client = createClient([
      [
        {
          key: 'h_beam',
          display_name_zh: 'H型鋼',
          aliases: ['H型鋼', 'H鋼', 'H-BEAM'],
          metadata: { sourceKind: 'curated', sourceProductRowCount: 24 },
          review_state: 'reviewed',
          active: true,
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'catalog_family',
              sourceFile: 'docs/reference/產品價格.xlsx',
              canonicalKey: 'catalog_family',
            },
          ],
        },
        {
          key: 'c_type',
          display_name_zh: 'C型鋼',
          aliases: ['C型鋼', 'C鋼', '輕型鋼'],
          metadata: { sourceKind: 'curated', sourceProductRowCount: 12 },
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_catalog_families',
      arguments: { searchText: 'H鋼', limit: 10 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls[0]?.sql).toContain('FROM steel.catalog_families');
    expect(result.data).toEqual({
      catalogFamilyCandidates: [
        expect.objectContaining({
          key: 'h_beam',
          displayNameZh: 'H型鋼',
          aliases: ['H型鋼', 'H鋼', 'H-BEAM'],
          sourceRefs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'catalog_family',
              sourceFile: 'docs/reference/產品價格.xlsx',
              canonicalKey: 'catalog_family',
            },
          ],
        }),
        expect.objectContaining({
          key: 'c_type',
          displayNameZh: 'C型鋼',
        }),
      ],
      selectionPolicy:
        'AI must choose catalogFamilies from candidates or ask the user; backend returns vocabulary candidates only.',
    });
    expect(result.data).not.toHaveProperty('resolvedCatalogFamilies');
  });

  it('preserves unknown prices as null instead of converting them to zero', async () => {
    const client = createClient([
      [
        {
          id: '7',
          erp_item_code: 'P-C150',
          category_id: null,
          customer_tier_id: '1',
          spec_key: 'C150',
          product_name: 'C型鋼',
          catalog_family: 'c_type',
          material_grade: null,
          unit: 'kg',
          unit_price: null,
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'unknown',
          review_state: 'reviewed',
          active: true,
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'product_price',
              canonicalKey: 'unit_price',
            },
          ],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: { specKey: 'C150', customerTierId: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(result.data.priceCandidates[0]).toMatchObject({
      specKey: 'C150',
      unitPrice: null,
      valueState: 'unknown',
    });
  });

  it('searches price candidates by normalized catalog family keys', async () => {
    const client = createClient([
      [
        {
          id: '31',
          erp_item_code: 'EHS100506',
          category_id: null,
          customer_tier_id: '1',
          spec_key: 'EHS100506_H型鋼100x50x5_7x6M_56_進口',
          product_name: 'H型鋼100*50*5/7*6M(56)進口',
          catalog_family: 'h_beam',
          material_grade: null,
          unit: 'piece',
          unit_price: '1800.0000',
          product_price_unit_weight: '56.00000',
          product_price_unit_weight_unit: 'kg_per_piece',
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        catalogFamilies: ['h_beam'],
        customerTierId: 1,
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls[0]?.values).toEqual(['reviewed', 'h_beam', 1, 5]);
    expect(result.data.priceCandidates[0]).toMatchObject({
      catalogFamily: 'h_beam',
      productName: 'H型鋼100*50*5/7*6M(56)進口',
    });
  });

  it('searches price candidates by generic catalog family keys', async () => {
    const client = createClient([
      [
        {
          id: '41',
          erp_item_code: 'FFL0001',
          category_id: '11',
          customer_tier_id: '1',
          spec_key: 'FFL0001_鋁門鎖_300H勾鎖_212H',
          product_name: '鋁門鎖-300H勾鎖(212H)',
          catalog_family: 'door_lock',
          material_grade: null,
          unit: 'piece',
          unit_price: '500.0000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        catalogFamilies: ['door_lock'],
        customerTierId: 1,
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls[0]?.values).toEqual(['reviewed', 'door_lock', 1, 5]);
    expect(result.data.priceCandidates[0]).toMatchObject({
      catalogFamily: 'door_lock',
      productName: '鋁門鎖-300H勾鎖(212H)',
    });
  });

  it('searches prices from derived candidate queries and does not query raw user text', async () => {
    const client = createClient([
      [
        {
          id: '21',
          erp_item_code: 'A-L30-25',
          category_id: null,
          customer_tier_id: '1',
          spec_key: 'angle_L30x30x2.5x6M',
          product_name: '錏成型角鐵',
          catalog_family: 'angle',
          material_grade: null,
          unit: 'piece',
          unit_price: '194.3000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'product_price',
              sourceFile: 'docs/reference/產品價格.xlsx',
            },
          ],
        },
        {
          id: '22',
          erp_item_code: 'A-L30-30',
          category_id: null,
          customer_tier_id: '1',
          spec_key: 'angle_L30x30x3.0x6M',
          product_name: '錏成型角鐵',
          catalog_family: 'angle',
          material_grade: null,
          unit: 'piece',
          unit_price: '221.0000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'product_price',
              sourceFile: 'docs/reference/產品價格.xlsx',
            },
          ],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: '亞L30x30',
        candidateQueries: [
          {
            queryId: 'formed-angle-ya',
            productNames: ['錏成型角鐵'],
            specKey: '30x30',
            specKeyContains: '30x30',
            confidence: 'medium',
            reason: 'AI interpreted L30x30 as angle steel and 亞 as possible 錏',
          },
          {
            queryId: 'raw-user-text',
            productNames: ['亞L30x30'],
            confidence: 'low',
            reason: 'raw user text must be filtered out',
          },
        ],
        customerTierId: 1,
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual(['reviewed', '%30x30%', '%錏成型角鐵%', 5]);
    expect(JSON.stringify(client.calls[0])).not.toContain('亞L30x30');
    expect(result.data).toMatchObject({
      priceCandidates: [
        {
          specKey: 'angle_L30x30x2.5x6M',
          productName: '錏成型角鐵',
          unitPrice: 194.3,
        },
        {
          specKey: 'angle_L30x30x3.0x6M',
          productName: '錏成型角鐵',
          unitPrice: 221,
        },
      ],
      rejectedSearchQueries: [
        {
          queryId: 'raw-user-text',
          reason: 'raw_user_text_is_not_a_reviewed_candidate',
        },
      ],
    });
  });

  it('searches prices from multiple inferred productNames candidates', async () => {
    const client = createClient([
      [
        {
          id: '31',
          erp_item_code: 'A-L30-25',
          category_id: null,
          customer_tier_id: '1',
          spec_key: 'angle_L30x30x2.5x6M',
          product_name: '錏成型角鐵',
          catalog_family: 'angle',
          material_grade: null,
          unit: 'piece',
          unit_price: '194.3000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'product_price',
              sourceFile: 'docs/reference/產品價格.xlsx',
            },
          ],
        },
      ],
      [
        {
          id: '32',
          erp_item_code: 'G-L30-25',
          category_id: null,
          customer_tier_id: '1',
          spec_key: 'angle_L30x30x2.5x6M',
          product_name: '鍍鋅角鐵',
          catalog_family: 'angle',
          material_grade: null,
          unit: 'piece',
          unit_price: '205.0000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'product_price',
              sourceFile: 'docs/reference/產品價格.xlsx',
            },
          ],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        productNames: ['錏成型角鐵', '鍍鋅角鐵'],
        specKeyContains: '30x30',
        catalogFamilies: ['angle'],
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.values).toEqual(['reviewed', '%30x30%', '%錏成型角鐵%', 'angle', 5]);
    expect(client.calls[1]?.values).toEqual([
      'reviewed',
      '%30x30%',
      '%鍍鋅%',
      '%角鐵%',
      'angle',
      5,
    ]);
    expect(result.data.priceCandidates).toEqual([
      expect.objectContaining({
        productName: '錏成型角鐵',
        unitPrice: 194.3,
      }),
      expect.objectContaining({
        productName: '鍍鋅角鐵',
        unitPrice: 205,
      }),
    ]);
  });

  it('returns C-type instruction packet group from one batched lookup', async () => {
    const client = createClient([
      instructionRows([
        'c-type-basic-quote-zh-v1',
        'product-price-unit-weight-calculation-zh-v1',
        'price-source-priority-zh-v1',
        'formula-code-selection-zh-v1',
        'drawing-processing-detection-zh-v1',
      ]),
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_quote_rules',
      arguments: {
        taskTypes: [
          'candidate_generation',
          'material_price_lookup',
          'formula_selection',
          'processing_detection',
          'confirmation_policy',
        ],
        packetGroupHints: ['c-type-quote-core'],
        evidenceSummary: '客戶詢價 C100x50x20 2.3t 長度 8M 10 支，含孔洞但未確認孔費',
        catalogContexts: [
          {
            lineRefs: ['line-1'],
            packetGroupHints: ['c-type-quote-core'],
            catalogCandidates: ['c_type'],
            formulaCandidates: ['C'],
            processingTypes: ['holes', 'cutting', 'none'],
            lowConfidenceReasons: ['C 型鋼切工與孔費預設免費'],
          },
        ],
        limit: 10,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[0]?.values).toEqual(['reviewed', 'c-type-quote-core', 10]);
    expect(result.data.instructionPacketGroups).toEqual([
      {
        group: 'c-type-quote-core',
        lineRefs: ['line-1'],
        returnedPacketSlugs: [
          'c-type-basic-quote-zh-v1',
          'product-price-unit-weight-calculation-zh-v1',
          'price-source-priority-zh-v1',
          'formula-code-selection-zh-v1',
          'drawing-processing-detection-zh-v1',
        ],
      },
    ]);
    expect(result.data.instructionPackets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'c-type-basic-quote-zh-v1',
          packetGroups: ['c-type-quote-core'],
          requiredLookups: ['search_price_candidates', 'lookup_formula'],
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-1'],
            catalogFamilies: ['c_type'],
            formulaCodes: ['C'],
          }),
          instruction: expect.stringContaining('C 型鋼切工與孔費預設免費'),
        }),
        expect.objectContaining({
          slug: 'product-price-unit-weight-calculation-zh-v1',
          packetGroups: expect.arrayContaining(['c-type-quote-core']),
          instruction: expect.stringMatching(
            /輕量H[\s\S]*NT\$600-643\.2[\s\S]*白鐵平鐵 50 \*8\.0\( 19\.7\)[\s\S]*6K鐵軌/u,
          ),
          blockingRules: expect.arrayContaining([
            expect.stringContaining('kg_per_m'),
            expect.stringContaining('reviewed row 的 unit'),
            expect.stringContaining('非鋼材'),
            expect.stringContaining('正值單位重欄位'),
          ]),
        }),
        expect.objectContaining({
          slug: 'formula-code-selection-zh-v1',
          packetGroups: expect.arrayContaining(['c-type-quote-core']),
          requiredLookups: ['lookup_formula'],
        }),
        expect.objectContaining({
          slug: 'drawing-processing-detection-zh-v1',
          packetGroups: expect.arrayContaining(['c-type-quote-core']),
          instruction: expect.stringContaining('孔數依表格孔數優先'),
        }),
      ]),
    );
    expect(result.data.instructionPackets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'h-type-length-surcharge-zh-v1' }),
        expect.objectContaining({ slug: 'angle-surface-oral-zh-v1' }),
      ]),
    );
    expect(result.data.requiredLookups).toEqual(
      expect.arrayContaining(['search_price_candidates', 'lookup_formula']),
    );
    expect(result.data.requiredLookups).not.toContain('lookup_defaults');
    expect(JSON.stringify(result.data)).not.toMatch(/backend|codex|hard-code/i);
    expect(JSON.stringify(result.data)).not.toMatch(/不要只因品名.*confirmed true-zero/);
  });

  it('returns angle and C-type instruction packet groups from one batched lookup', async () => {
    const client = createClient([
      instructionRows([
        'angle-surface-oral-zh-v1',
        'oral-material-candidate-generation-zh-v1',
        'black-steel-cutting-price-zh-v1',
        'cut-count-and-trim-detection-zh-v1',
        'c-type-basic-quote-zh-v1',
        'price-source-priority-zh-v1',
        'formula-code-selection-zh-v1',
        'drawing-processing-detection-zh-v1',
      ]),
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_quote_rules',
      arguments: {
        taskTypes: [
          'candidate_generation',
          'material_price_lookup',
          'formula_selection',
          'processing_detection',
          'confirmation_policy',
        ],
        packetGroupHints: ['angle-zinc-quote-core', 'c-type-quote-core'],
        evidenceSummary: '同一張訂單含 亞L30x30 一支多少，以及 C100x50x20 2.3t 8M 10 支',
        catalogContexts: [
          {
            lineRefs: ['line-angle'],
            packetGroupHints: ['angle-zinc-quote-core'],
            catalogCandidates: ['angle'],
            surfaceCandidates: ['zinc_plated', 'galvanized', 'unknown'],
            processingTypes: ['none'],
            lowConfidenceReasons: ['亞 is typo/surface clue', 'thickness unknown'],
          },
          {
            lineRefs: ['line-c-type'],
            packetGroupHints: ['c-type-quote-core'],
            catalogCandidates: ['c_type'],
            formulaCandidates: ['C'],
            processingTypes: ['holes', 'cutting', 'none'],
            lowConfidenceReasons: ['C 型鋼切工與孔費預設免費'],
          },
        ],
        limit: 12,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[0]?.values).toEqual([
      'reviewed',
      'angle-zinc-quote-core',
      'c-type-quote-core',
      12,
    ]);
    expect(result.data.instructionPacketGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: 'angle-zinc-quote-core',
          lineRefs: ['line-angle'],
          returnedPacketSlugs: expect.arrayContaining([
            'angle-surface-oral-zh-v1',
            'oral-material-candidate-generation-zh-v1',
          ]),
        }),
        expect.objectContaining({
          group: 'c-type-quote-core',
          lineRefs: ['line-c-type'],
          returnedPacketSlugs: expect.arrayContaining([
            'c-type-basic-quote-zh-v1',
            'formula-code-selection-zh-v1',
            'drawing-processing-detection-zh-v1',
          ]),
        }),
      ]),
    );
    expect(result.data.instructionPackets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'angle-surface-oral-zh-v1',
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-angle'],
            catalogFamilies: ['angle'],
          }),
          instruction: expect.stringContaining('亞'),
        }),
        expect.objectContaining({
          slug: 'angle-surface-oral-zh-v1',
          instruction: expect.stringContaining('30x2.5x6M'),
        }),
        expect.objectContaining({
          slug: 'c-type-basic-quote-zh-v1',
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-c-type'],
            catalogFamilies: ['c_type'],
          }),
          instruction: expect.stringContaining('C 型鋼切工與孔費預設免費'),
        }),
      ]),
    );
    expect(result.data.instructionPackets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: 'h-type-length-surcharge-zh-v1' })]),
    );
  });

  it('returns H-type instruction packet group when h_beam is the interpreted catalog key', async () => {
    const client = createClient([
      instructionRows([
        'h-type-length-surcharge-zh-v1',
        'h-and-i-beam-cutting-price-zh-v1',
        'cut-count-and-trim-detection-zh-v1',
      ]),
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_quote_rules',
      arguments: {
        taskTypes: [
          'candidate_generation',
          'material_price_lookup',
          'formula_selection',
          'processing_detection',
          'confirmation_policy',
        ],
        evidenceSummary: '客戶詢價 H鋼 100x50x5/7 6M 一支，可能需要切工與公式 H',
        catalogContexts: [
          {
            lineRefs: ['line-h-beam'],
            catalogCandidates: ['h_beam'],
            formulaCandidates: ['H'],
            processingTypes: ['cutting', 'head_tail_trim', 'none'],
            lowConfidenceReasons: ['是否切工或修頭尾未確認'],
          },
        ],
        limit: 10,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[0]?.values).toEqual(['reviewed', 'h-type-quote-core', 10]);
    expect(result.data.instructionPacketGroups).toEqual([
      {
        group: 'h-type-quote-core',
        lineRefs: ['line-h-beam'],
        returnedPacketSlugs: [
          'h-type-length-surcharge-zh-v1',
          'h-and-i-beam-cutting-price-zh-v1',
          'cut-count-and-trim-detection-zh-v1',
        ],
      },
    ]);
    expect(result.data.instructionPackets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'h-type-length-surcharge-zh-v1',
          packetGroups: ['h-type-quote-core'],
          requiredLookups: ['search_price_candidates', 'lookup_formula'],
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-h-beam'],
            catalogFamilies: ['h_beam'],
            formulaCodes: ['H'],
          }),
          instruction: expect.stringContaining('H 型鋼常規米數'),
        }),
        expect.objectContaining({
          slug: 'h-and-i-beam-cutting-price-zh-v1',
          packetGroups: ['h-type-quote-core'],
          requiredLookups: ['search_price_candidates'],
          instruction: expect.stringContaining('H 型鋼切工優先查 reviewed cutting rows'),
        }),
        expect.objectContaining({
          slug: 'cut-count-and-trim-detection-zh-v1',
          packetGroups: expect.arrayContaining(['h-type-quote-core']),
          instruction: expect.stringContaining('修頭尾'),
        }),
      ]),
    );
    const serializedPackets = JSON.stringify(result.data.instructionPackets);
    expect(serializedPackets).toContain('6M');
    expect(serializedPackets).toContain('9M');
    expect(serializedPackets).toContain('10M');
    expect(serializedPackets).toContain('12M');
    expect(serializedPackets).toContain('7M');
    expect(serializedPackets).toContain('8M');
    expect(serializedPackets).toContain('11M');
    expect(serializedPackets).toContain('13M');
    expect(serializedPackets).toContain('14M');
    expect(serializedPackets).toContain('15M');
    expect(serializedPackets).toContain('+0.3 元/kg');
    expect(serializedPackets).toContain('已含非常規 +0.3 元/kg');
    expect(serializedPackets).toContain('不可再加一次');
    expect(serializedPackets).toContain('開槽 KZZB10');
    expect(serializedPackets).toContain('沖孔 KZZB11');
    expect(serializedPackets).toContain('倒角 KZZB12');
    expect(result.data.instructionPackets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'c-type-basic-quote-zh-v1' }),
        expect.objectContaining({ slug: 'angle-surface-oral-zh-v1' }),
      ]),
    );
  });

  it('looks up formulas for multiple material contexts in one tool call', async () => {
    const client = createClient([
      [
        {
          id: '15',
          code: 'C',
          version_seq: '1',
          display_name: 'C型鋼',
          source_expression: '四捨五入(單位重*長度,2)/100',
          formula_body: { code: 'C' },
          compiled_formula: { code: 'C' },
          allowed_variables: ['unitWeight', 'lengthM'],
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'formula',
              sourceFile: 'docs/reference/公式編號.xlsx',
            },
          ],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_formula',
      arguments: {
        catalogContexts: [
          {
            lineRefs: ['line-angle'],
            catalogCandidates: ['angle'],
          },
          {
            lineRefs: ['line-c-type'],
            catalogCandidates: ['c_type'],
            formulaCandidates: ['C'],
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual(['reviewed', 'C']);
    expect(result.data.formulaCandidates).toEqual([
      {
        lineRefs: ['line-c-type'],
        code: 'C',
        formulaVersion: expect.objectContaining({
          code: 'C',
          displayName: 'C型鋼',
          sourceRefs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'formula',
              sourceFile: 'docs/reference/公式編號.xlsx',
            },
          ],
        }),
      },
    ]);
  });

  it('returns defaults through the merged quote-rule lookup', async () => {
    const client = createClient([
      [],
      [
        {
          id: '55',
          default_type: 'true_zero_rule',
          origin_table: 'tasks/steel-data-rules-architecture/instruction-packets.md',
          origin_id: 'c-type-free-cutting-hole-v1',
          origin_revision: '1',
          scope_type: 'catalog_family',
          customer_id: null,
          customer_tier_id: null,
          catalog_family: 'c_type',
          product_family: null,
          charge_type: null,
          formula_code: 'C',
          selector: { catalogFamily: 'c_type', chargeTypes: ['cutting', 'hole'] },
          effect: 'true_zero_rule',
          default_parameters: [
            {
              parameterKey: 'instruction',
              value: 'C 型鋼切工與孔費預設免費',
            },
          ],
          priority: '10',
          confidence: 'high',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'repo_docs',
              factType: 'quote_default',
              sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
              locator: 'c-type-basic-quote-zh-v1',
              canonicalKey: 'c_type_free_cutting_hole',
            },
          ],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_quote_rules',
      arguments: {
        taskTypes: ['default_selection'],
        evidenceSummary: '同一張單有角鐵和 C 型鋼，查可套用的 reviewed defaults',
        catalogContexts: [
          {
            lineRefs: ['line-angle'],
            catalogCandidates: ['angle'],
            processingTypes: ['none'],
          },
          {
            lineRefs: ['line-c-type'],
            catalogCandidates: ['c_type'],
            formulaCandidates: ['C'],
            processingTypes: ['holes', 'cutting'],
          },
        ],
        limit: 10,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[1]?.values).toEqual([
      'reviewed',
      'angle',
      'c_type',
      'hole',
      'cutting',
      'C',
      10,
    ]);
    expect(result.data.instructionPackets).toEqual([]);
    expect(result.data.quoteDefaults).toEqual([
      expect.objectContaining({
        defaultId: 'quote_default:55',
        defaultType: 'true_zero_rule',
        lineRefs: ['line-c-type'],
        catalogFamilies: ['c_type'],
        formulaCodes: ['C'],
        chargeTypes: ['cutting', 'hole'],
        effect: 'true_zero_rule',
        instruction: expect.stringContaining('C 型鋼切工與孔費預設免費'),
        sourceRefs: [
          {
            channel: 'repo_docs',
            factType: 'quote_default',
            sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
            locator: 'c-type-basic-quote-zh-v1',
            canonicalKey: 'c_type_free_cutting_hole',
          },
        ],
      }),
    ]);
  });

  it('returns instruction packets and quote defaults from one merged quote-rule lookup', async () => {
    const client = createClient([
      instructionRows(['c-type-basic-quote-zh-v1', 'product-price-unit-weight-calculation-zh-v1']),
      [
        {
          id: '55',
          default_type: 'true_zero_rule',
          origin_table: 'tasks/steel-data-rules-architecture/instruction-packets.md',
          origin_id: 'c-type-free-cutting-hole-v1',
          origin_revision: '1',
          scope_type: 'catalog_family',
          customer_id: null,
          customer_tier_id: null,
          catalog_family: 'c_type',
          product_family: null,
          charge_type: null,
          formula_code: 'C',
          selector: { catalogFamily: 'c_type', chargeTypes: ['cutting', 'hole'] },
          effect: 'true_zero_rule',
          default_parameters: [
            {
              parameterKey: 'instruction',
              value: 'C 型鋼切工與孔費預設免費',
            },
            {
              parameterKey: 'userVisibleNote',
              value: 'C 型鋼切工與孔費目前採 reviewed true-zero 預設。',
            },
          ],
          priority: '10',
          confidence: 'high',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'repo_docs',
              factType: 'quote_default',
              sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
              locator: 'c-type-basic-quote-zh-v1',
              canonicalKey: 'c_type_free_cutting_hole',
            },
          ],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_quote_rules',
      arguments: {
        taskTypes: ['candidate_generation', 'material_price_lookup', 'default_selection'],
        packetGroupHints: ['c-type-quote-core'],
        evidenceSummary: 'C 型鋼 C100x50x20x2.3t 材質不明，可能有切工與孔洞',
        catalogContexts: [
          {
            lineRefs: ['line-c-type'],
            packetGroupHints: ['c-type-quote-core'],
            catalogCandidates: ['c_type'],
            formulaCandidates: ['C'],
            processingTypes: ['cutting', 'holes'],
          },
        ],
        limit: 10,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(result.data.instructionPackets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'c-type-basic-quote-zh-v1',
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-c-type'],
            catalogFamilies: ['c_type'],
            formulaCodes: ['C'],
            processingTypes: ['cutting', 'holes'],
          }),
          userVisibleNotes: [
            '材質不明時，錏輕型鋼可作高信心暫估候選；第一輪需列出同規格其他材質選項。',
            '未指定客戶或找不到客戶價格等級時，查價使用 B 價 customerTierId 2；回覆提醒目前用價格B，提供客戶名稱後可再查該客戶報價，不要加最高/最貴說明；價格 bullet 用價格，不要寫 reviewed 價格。',
          ],
          confirmationQuestions: [
            '請確認材質是否為錏輕型鋼；若下一輪未指定其他材質，視為確認預設錏輕型鋼。',
          ],
        }),
        expect.objectContaining({
          slug: 'product-price-unit-weight-calculation-zh-v1',
          instruction: expect.stringContaining('NT$600-643.2'),
        }),
      ]),
    );
    expect(result.data.quoteDefaults).toEqual([
      expect.objectContaining({
        defaultId: 'quote_default:55',
        catalogFamilies: ['c_type'],
        chargeTypes: ['cutting', 'hole'],
        instruction: 'C 型鋼切工與孔費預設免費',
      }),
    ]);
    expect(result.data.requiredLookups).toEqual(
      expect.arrayContaining(['search_price_candidates', 'lookup_formula']),
    );
    expect(result.data.userVisibleNotes).toEqual(
      expect.arrayContaining([
        '材質不明時，錏輕型鋼可作高信心暫估候選；第一輪需列出同規格其他材質選項。',
        '未指定客戶或找不到客戶價格等級時，查價使用 B 價 customerTierId 2；回覆提醒目前用價格B，提供客戶名稱後可再查該客戶報價，不要加最高/最貴說明；價格 bullet 用價格，不要寫 reviewed 價格。',
        '產品價格列若是 kg_per_m，售價是每 kg，必須先依長度換算重量再乘售價。',
        'C 型鋼切工與孔費目前採 reviewed true-zero 預設。',
      ]),
    );
    expect(result.data.confirmationQuestions).toEqual(
      expect.arrayContaining([
        '請確認材質是否為錏輕型鋼；若下一輪未指定其他材質，視為確認預設錏輕型鋼。',
        '請確認本次長度、數量，以及是否整支含餘料計價。',
      ]),
    );
  });

  it('returns quote defaults for multiple catalog keys even when contexts have no row refs', async () => {
    const client = createClient([
      instructionRows(['c-type-basic-quote-zh-v1', 'h-type-length-surcharge-zh-v1']),
      [
        {
          id: '55',
          default_type: 'true_zero_rule',
          origin_table: 'tasks/steel-data-rules-architecture/instruction-packets.md',
          origin_id: 'c-type-free-cutting-hole-v1',
          origin_revision: '1',
          scope_type: 'catalog_family',
          customer_id: null,
          customer_tier_id: null,
          catalog_family: 'c_type',
          product_family: null,
          charge_type: null,
          formula_code: 'C',
          selector: { catalogFamily: 'c_type', chargeTypes: ['cutting', 'hole'] },
          effect: 'true_zero_rule',
          default_parameters: [
            {
              parameterKey: 'instruction',
              value: 'C 型鋼切工與孔費預設免費',
            },
          ],
          priority: '10',
          confidence: 'high',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'repo_docs',
              factType: 'quote_default',
              sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
              locator: 'c-type-basic-quote-zh-v1',
              canonicalKey: 'c_type_free_cutting_hole',
            },
          ],
        },
        {
          id: '56',
          default_type: 'price_adjustment_rule',
          origin_table: 'tasks/steel-data-rules-architecture/instruction-packets.md',
          origin_id: 'h-type-length-surcharge-v1',
          origin_revision: '1',
          scope_type: 'catalog_family',
          customer_id: null,
          customer_tier_id: null,
          catalog_family: 'h_beam',
          product_family: null,
          charge_type: null,
          formula_code: 'H',
          selector: { catalogFamily: 'h_beam', nonStandardLengthsM: [7, 8, 11, 13, 14, 15] },
          effect: 'material_surcharge',
          default_parameters: [
            {
              parameterKey: 'instruction',
              value: 'H 型鋼非常規米數若無 exact reviewed row 才加 0.3 元/kg',
            },
          ],
          priority: '20',
          confidence: 'high',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'repo_docs',
              factType: 'quote_default',
              sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
              locator: 'h-type-length-surcharge-zh-v1',
              canonicalKey: 'h_beam_non_standard_length_surcharge',
            },
          ],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_quote_rules',
      arguments: {
        taskTypes: ['material_price_lookup', 'default_selection'],
        evidenceSummary: '同一張訂單同時有 C 型鋼與 H 型鋼',
        catalogContexts: [
          {
            packetGroupHints: ['c-type-quote-core'],
            catalogCandidates: ['c_type'],
            formulaCandidates: ['C'],
            processingTypes: ['cutting', 'holes'],
          },
          {
            packetGroupHints: ['h-type-quote-core'],
            catalogCandidates: ['h_beam'],
            formulaCandidates: ['H'],
            processingTypes: ['material'],
          },
        ],
        limit: 10,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.values).toEqual([
      'reviewed',
      'c_type',
      'h_beam',
      'cutting',
      'hole',
      'material',
      'C',
      'H',
      10,
    ]);
    expect(result.data.quoteDefaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          defaultId: 'quote_default:55',
          catalogFamilies: ['c_type'],
          formulaCodes: ['C'],
          instruction: 'C 型鋼切工與孔費預設免費',
        }),
        expect.objectContaining({
          defaultId: 'quote_default:56',
          catalogFamilies: ['h_beam'],
          formulaCodes: ['H'],
          instruction: 'H 型鋼非常規米數若無 exact reviewed row 才加 0.3 元/kg',
        }),
      ]),
    );
  });

  it('runs a C-type order context through instructions, price, defaults, and formula lookups', async () => {
    const client = createClient([
      instructionRows(['c-type-basic-quote-zh-v1']),
      [
        {
          id: '72',
          default_type: 'true_zero_rule',
          origin_table: 'tasks/steel-data-rules-architecture/instruction-packets.md',
          origin_id: 'c-type-free-cutting-hole-v1',
          origin_revision: '1',
          scope_type: 'catalog_family',
          customer_id: null,
          customer_tier_id: null,
          catalog_family: 'c_type',
          product_family: null,
          charge_type: null,
          formula_code: 'C',
          selector: { catalogFamily: 'c_type', chargeTypes: ['cutting', 'hole'] },
          effect: 'true_zero_rule',
          default_parameters: [
            {
              parameterKey: 'instruction',
              value: 'C 型鋼切工與孔費預設免費',
            },
          ],
          priority: '10',
          confidence: 'high',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'repo_docs',
              factType: 'quote_default',
              sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
              locator: 'c-type-basic-quote-zh-v1',
              canonicalKey: 'c_type_free_cutting_hole',
            },
          ],
        },
      ],
      [
        {
          id: '71',
          erp_item_code: 'P-C100',
          category_id: null,
          customer_tier_id: null,
          spec_key: 'C100x50x20x2.3',
          product_name: 'C型鋼',
          catalog_family: 'c_type',
          material_grade: null,
          unit: 'kg',
          unit_price: null,
          product_price_unit_weight: '3.56000',
          product_price_unit_weight_unit: 'kg_per_m',
          currency: 'TWD',
          value_state: 'unknown',
          review_state: 'reviewed',
          active: true,
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'product_price',
              sourceFile: 'docs/reference/產品價格.xlsx',
              canonicalKey: 'unit_price',
            },
          ],
        },
      ],
      [
        {
          id: '73',
          code: 'C',
          version_seq: '1',
          display_name: 'C型鋼',
          source_expression: '四捨五入(單位重*長度,2)/100',
          formula_body: { code: 'C' },
          compiled_formula: { code: 'C' },
          allowed_variables: ['unitWeight', 'lengthM'],
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'formula',
              sourceFile: 'docs/reference/公式編號.xlsx',
              canonicalKey: 'formula_code',
            },
          ],
        },
      ],
    ]);
    const runState = createSteelToolRunState(3);
    const catalogContexts = [
      {
        lineRefs: ['line-c-type'],
        packetGroupHints: ['c-type-quote-core'],
        catalogCandidates: ['c_type'],
        formulaCandidates: ['C'],
        processingTypes: ['cutting', 'holes'],
        lowConfidenceReasons: ['材料單價缺價，但 C 型鋼切工與孔費預設免費'],
      },
    ];

    const quoteRulesResult = await executeSteelTool({
      client,
      runState,
      toolName: 'lookup_quote_rules',
      arguments: {
        taskTypes: [
          'candidate_generation',
          'material_price_lookup',
          'formula_selection',
          'processing_detection',
          'confirmation_policy',
        ],
        evidenceSummary: 'C100x50x20x2.3 長度 8M 10 支，含切工與孔洞',
        catalogContexts,
        limit: 10,
      },
    });
    const priceResult = await executeSteelTool({
      client,
      runState,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: 'C100x50x20x2.3 長度 8M 10 支，含切工與孔洞',
        candidateQueries: [
          {
            queryId: 'c-type-c100',
            productNames: ['C型鋼'],
            specKeyContains: 'C100',
            confidence: 'high',
            reason: 'AI interpreted C100x50x20x2.3 as C 型鋼 candidate',
          },
        ],
        limit: 5,
      },
    });
    const formulaResult = await executeSteelTool({
      client,
      runState,
      toolName: 'lookup_formula',
      arguments: {
        catalogContexts,
      },
    });

    expect(quoteRulesResult.ok).toBe(true);
    expect(priceResult.ok).toBe(true);
    expect(formulaResult.ok).toBe(true);
    if (!quoteRulesResult.ok || !priceResult.ok || !formulaResult.ok) {
      throw new Error('C 型鋼 vertical lookup failed');
    }

    expect(client.calls).toHaveLength(4);
    expect(runState.callsUsed).toBe(3);
    expect(quoteRulesResult.data.instructionPackets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'c-type-basic-quote-zh-v1',
          requiredLookups: ['search_price_candidates', 'lookup_formula'],
          instruction: expect.stringContaining('材質不明時，AI 使用 productNames: [錏輕型鋼]'),
          blockingRules: expect.arrayContaining([
            expect.stringContaining('不要把 C型鋼 當作 productNames 候選'),
          ]),
        }),
      ]),
    );
    expect(priceResult.data.priceCandidates).toEqual([
      expect.objectContaining({
        productName: 'C型鋼',
        unitPrice: null,
        valueState: 'unknown',
        productPriceUnitWeight: 3.56,
      }),
    ]);
    expect(quoteRulesResult.data.quoteDefaults).toEqual([
      expect.objectContaining({
        defaultType: 'true_zero_rule',
        effect: 'true_zero_rule',
        catalogFamilies: ['c_type'],
        formulaCodes: ['C'],
        chargeTypes: ['cutting', 'hole'],
        instruction: expect.stringContaining('C 型鋼切工與孔費預設免費'),
      }),
    ]);
    expect(formulaResult.data.formulaCandidates).toEqual([
      expect.objectContaining({
        lineRefs: ['line-c-type'],
        code: 'C',
        formulaVersion: expect.objectContaining({
          code: 'C',
          sourceRefs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'formula',
              sourceFile: 'docs/reference/公式編號.xlsx',
              canonicalKey: 'formula_code',
            },
          ],
        }),
      }),
    ]);
  });

  it('rejects direct raw typo price search before SQL when original text is present', async () => {
    const client = createClient([]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: '亞L30x30',
        productNames: ['亞L30x30'],
        limit: 5,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      errorCategory: 'invalid_arguments',
      errorSummary: expect.stringContaining('Do not search reviewed prices with raw user text'),
    });
    expect(client.calls).toHaveLength(0);
  });

  it('rejects c_type price searches that still use C 型鋼 as a productNames candidate', async () => {
    const client = createClient([]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
        catalogFamilies: ['c_type'],
        candidateQueries: [
          {
            queryId: 'c-type-family-label',
            productNames: ['C型鋼'],
            specKeyContains: '100x50x20',
            confidence: 'high',
            reason: 'AI selected c_type but reused the family label as product_name',
          },
        ],
        limit: 5,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      errorCategory: 'invalid_arguments',
      errorSummary: expect.stringContaining(
        'Do not use C型鋼 as productNames after selecting c_type',
      ),
    });
    expect(client.calls).toHaveLength(0);
  });

  it('rejects c_type full-section spec searches that omit the width-thickness price fragment', async () => {
    const client = createClient([]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
        catalogFamilies: ['c_type'],
        candidateQueries: [
          {
            queryId: 'c-type-full-section',
            productNames: ['錏輕型鋼'],
            specKeyContains: '100x50x20 2.3',
            confidence: 'medium',
            reason: 'AI used the full C 型鋼 section but omitted the price-table fragment',
          },
        ],
        limit: 5,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      errorCategory: 'invalid_arguments',
      errorSummary: expect.stringContaining('100x2.3'),
    });
    expect(client.calls).toHaveLength(0);
  });

  it('accepts c_type galvanized light-steel productNames as the usual candidate when material is unknown', async () => {
    const client = createClient([
      [
        {
          id: '52',
          erp_item_code: 'C-100-23-GALV',
          category_id: null,
          customer_tier_id: null,
          spec_key: '錏輕型鋼_100x2.3',
          product_name: '錏輕型鋼',
          catalog_family: 'c_type',
          material_grade: null,
          unit: 'piece',
          unit_price: '620.0000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
        catalogFamilies: ['c_type'],
        candidateQueries: [
          {
            queryId: 'c-type-assumed-galvanized',
            label: '錏輕型鋼 100x2.3（C100x50x20x2.3t 6M）',
            productNames: ['錏輕型鋼'],
            specKeyContains: '100x2.3',
            confidence: 'high',
            reason: 'AI assumed the usual C 型鋼 material before reviewed lookup',
          },
        ],
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls[0]?.values).toEqual(['reviewed', '%100x2.3%', '%錏輕型鋼%', 'c_type', 5]);
    expect(result.data.priceCandidates[0]).toMatchObject({
      catalogFamily: 'c_type',
      productName: '錏輕型鋼',
      specKey: '錏輕型鋼_100x2.3',
    });
  });

  it('prefers c_type partial spec lookup when AI also sends a full-section specKey', async () => {
    const client = createClient([
      [
        {
          id: '53',
          erp_item_code: 'C-100-23-GALV',
          category_id: null,
          customer_tier_id: null,
          spec_key: '錏輕型鋼_100x2.3',
          product_name: '錏輕型鋼',
          catalog_family: 'c_type',
          material_grade: null,
          unit: 'piece',
          unit_price: '620.0000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
        catalogFamilies: ['c_type'],
        candidateQueries: [
          {
            queryId: 'c-type-full-and-compact',
            productNames: ['錏輕型鋼'],
            specKey: '100x50x20 2.3t',
            specKeyContains: '100x2.3',
            confidence: 'high',
            reason: 'AI sent full section and compact price-table fragment',
          },
        ],
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls[0]?.values).toEqual(['reviewed', '%100x2.3%', '%錏輕型鋼%', 'c_type', 5]);
    expect(result.data.priceCandidates[0]).toMatchObject({
      catalogFamily: 'c_type',
      productName: '錏輕型鋼',
      specKey: '錏輕型鋼_100x2.3',
    });
  });

  it('accepts c_type width-thickness price fragments without productNames when material is unknown', async () => {
    const client = createClient([
      [
        {
          id: '51',
          erp_item_code: 'C-100-23',
          category_id: null,
          customer_tier_id: null,
          spec_key: '錏輕型鋼_100x2.3',
          product_name: '錏輕型鋼',
          catalog_family: 'c_type',
          material_grade: null,
          unit: 'piece',
          unit_price: '620.0000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
        catalogFamilies: ['c_type'],
        candidateQueries: [
          {
            queryId: 'c-type-100x23',
            specKeyContains: '100x2.3',
            confidence: 'high',
            reason: 'AI derived the C 型鋼 price-table fragment from width and thickness',
          },
        ],
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls[0]?.values).toEqual(['reviewed', '%100x2.3%', 'c_type', 5]);
    expect(result.data.priceCandidates[0]).toMatchObject({
      catalogFamily: 'c_type',
      productName: '錏輕型鋼',
      specKey: '錏輕型鋼_100x2.3',
    });
  });

  it('accepts c_type productNames filters when the user specified the surface material', async () => {
    const client = createClient([[]]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: '錏C型鋼 100x50x20 2.3t 一支多少？',
        catalogFamilies: ['c_type'],
        candidateQueries: [
          {
            queryId: 'c-type-explicit-galvanized',
            productNames: ['錏輕型鋼'],
            specKeyContains: '100x2.3',
            confidence: 'high',
            reason: 'User specified 錏 material/surface',
          },
        ],
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    expect(client.calls[0]?.values).toEqual(['reviewed', '%100x2.3%', '%錏輕型鋼%', 'c_type', 5]);
  });

  it('enforces per-run tool call limits before dispatching handlers', async () => {
    const client = createClient([[], []]);
    const runState = createSteelToolRunState(1);

    const firstResult = await executeSteelTool({
      client,
      runState,
      toolName: 'search_customers',
      arguments: { searchText: '龍頂' },
    });
    const secondResult = await executeSteelTool({
      client,
      runState,
      toolName: 'search_customers',
      arguments: { searchText: '龍頂' },
    });

    expect(firstResult.ok).toBe(true);
    expect(secondResult).toMatchObject({
      ok: false,
      errorCategory: 'rate_limited',
    });
    expect(client.calls).toHaveLength(1);
  });
});
