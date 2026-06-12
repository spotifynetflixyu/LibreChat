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

function fixtureText(key: string) {
  return `fixture:${key}`;
}

function fixtureList(...keys: string[]) {
  return keys.map(fixtureText);
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
    instruction: fixtureText('angle-surface-oral-instruction'),
    blocking_rules: fixtureList('angle-surface-oral-blocking-1', 'angle-surface-oral-blocking-2'),
    required_lookups: ['search_price_candidates'],
    user_visible_notes: fixtureList('angle-surface-oral-note'),
    confirmation_questions: fixtureList('angle-surface-oral-question'),
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
    instruction: fixtureText('c-type-basic-quote-instruction'),
    blocking_rules: fixtureList(
      'c-type-basic-quote-blocking-1',
      'c-type-basic-quote-blocking-2',
      'c-type-basic-quote-blocking-3',
      'c-type-basic-quote-blocking-4',
    ),
    required_lookups: ['search_price_candidates', 'lookup_formula'],
    user_visible_notes: fixtureList('c-type-basic-quote-note-1', 'c-type-basic-quote-note-2'),
    confirmation_questions: fixtureList('c-type-basic-quote-question'),
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
    instruction: fixtureText('price-source-priority-instruction'),
    blocking_rules: fixtureList(
      'price-source-priority-blocking-1',
      'price-source-priority-blocking-2',
    ),
    required_lookups: ['search_price_candidates'],
    user_visible_notes: fixtureList('price-source-priority-note'),
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
    instruction: fixtureText('product-price-unit-weight-calculation-instruction'),
    blocking_rules: fixtureList(
      'product-price-unit-weight-calculation-blocking-1',
      'product-price-unit-weight-calculation-blocking-2',
      'product-price-unit-weight-calculation-blocking-3',
      'product-price-unit-weight-calculation-blocking-4',
      'product-price-unit-weight-calculation-blocking-5',
      'product-price-unit-weight-calculation-blocking-6',
      'product-price-unit-weight-calculation-blocking-7',
    ),
    required_lookups: ['search_price_candidates', 'lookup_formula'],
    user_visible_notes: fixtureList('product-price-unit-weight-calculation-note'),
    confirmation_questions: fixtureList('product-price-unit-weight-calculation-question'),
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
    instruction: fixtureText('h-type-length-surcharge-instruction'),
    blocking_rules: fixtureList('h-type-length-surcharge-blocking'),
    required_lookups: ['search_price_candidates', 'lookup_formula'],
    user_visible_notes: fixtureList('h-type-length-surcharge-note'),
    confirmation_questions: fixtureList('h-type-length-surcharge-question'),
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
    instruction: fixtureText('h-and-i-beam-cutting-price-instruction'),
    blocking_rules: fixtureList(
      'h-and-i-beam-cutting-price-blocking-1',
      'h-and-i-beam-cutting-price-blocking-2',
    ),
    required_lookups: ['search_price_candidates'],
    user_visible_notes: fixtureList('h-and-i-beam-cutting-price-note'),
    confirmation_questions: fixtureList('h-and-i-beam-cutting-price-question'),
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
    instruction: fixtureText('formula-code-selection-instruction'),
    blocking_rules: fixtureList('formula-code-selection-blocking'),
    required_lookups: ['lookup_formula'],
    user_visible_notes: fixtureList('formula-code-selection-note'),
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
    instruction: fixtureText('drawing-processing-detection-instruction'),
    blocking_rules: fixtureList('drawing-processing-detection-blocking'),
    required_lookups: ['search_price_candidates'],
    user_visible_notes: fixtureList('drawing-processing-detection-note'),
    confirmation_questions: fixtureList('drawing-processing-detection-question'),
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
    instruction: fixtureText('oral-material-candidate-generation-instruction'),
    blocking_rules: fixtureList('oral-material-candidate-generation-blocking'),
    required_lookups: ['search_price_candidates'],
    user_visible_notes: fixtureList('oral-material-candidate-generation-note'),
    confirmation_questions: fixtureList('oral-material-candidate-generation-question'),
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
    instruction: fixtureText('black-steel-cutting-price-instruction'),
    blocking_rules: fixtureList('black-steel-cutting-price-blocking'),
    required_lookups: ['search_price_candidates'],
    user_visible_notes: fixtureList('black-steel-cutting-price-note'),
    confirmation_questions: fixtureList('black-steel-cutting-price-question'),
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
    instruction: fixtureText('cut-count-and-trim-detection-instruction'),
    blocking_rules: fixtureList('cut-count-and-trim-detection-blocking'),
    required_lookups: [],
    user_visible_notes: fixtureList('cut-count-and-trim-detection-note'),
    confirmation_questions: fixtureList('cut-count-and-trim-detection-question'),
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
      [
        {
          id: '81',
          rule_type: 'customer_spec_rule',
          customer_id: '10',
          customer_tier_id: '2',
          catalog_family: 'h_beam',
          product_family: null,
          charge_type: 'cutting',
          formula_code: null,
          selectors: null,
          parameters: null,
          prompt: fixtureText('customer-h-beam-cutting-rule'),
          priority: '5',
          confidence: 'high',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'admin_table_ui',
              factType: 'customer_rule',
              locator: 'steel.customer_rules:81',
              canonicalKey: 'customer_h_beam_cutting_no_charge',
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
      rules: [
        {
          id: 'customer_rule:81',
          ruleType: 'customer_spec_rule',
          scope: {
            type: 'customer',
            customerId: 10,
            customerTierId: 2,
            catalogFamilies: ['h_beam'],
            productNames: [],
            chargeTypes: ['cutting'],
            formulaCodes: [],
          },
          prompt: fixtureText('customer-h-beam-cutting-rule'),
          priority: 5,
          confidence: 'high',
          sourceRefs: [
            {
              channel: 'admin_table_ui',
              factType: 'customer_rule',
              locator: 'steel.customer_rules:81',
              canonicalKey: 'customer_h_beam_cutting_no_charge',
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
        {
          channel: 'admin_table_ui',
          factType: 'customer_rule',
          locator: 'steel.customer_rules:81',
          canonicalKey: 'customer_h_beam_cutting_no_charge',
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
      'lookup_formula',
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
      [
        {
          id: '17',
          rule_type: 'similar_product_name_rule',
          catalog_family: 'h_beam',
          product_name: 'H型鋼',
          product_names: ['H型鋼', 'H鋼', 'H-BEAM'],
          aliases: ['H鋼', 'H-BEAM'],
          selectors: null,
          prompt: fixtureText('h-beam-similar-name-rule'),
          priority: '20',
          confidence: 'high',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'admin_table_ui',
              factType: 'catalog_family_rule',
              locator: 'steel.catalog_family_rules:17',
              canonicalKey: 'h_beam_similar_name_rule',
            },
          ],
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
    expect(client.calls[1]?.sql).toContain('FROM steel.catalog_family_rules');
    expect(result.data).toEqual(
      expect.objectContaining({
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
      }),
    );
    expect(result.data.rules).toEqual(
      expect.arrayContaining([
        {
          id: 'catalog_family_rule:17',
          ruleType: 'similar_product_name_rule',
          scope: {
            type: 'product_name',
            catalogFamilies: ['h_beam'],
            productNames: ['H型鋼', 'H鋼', 'H-BEAM'],
            customerId: null,
            customerTierId: null,
            chargeTypes: [],
            formulaCodes: [],
          },
          prompt: fixtureText('h-beam-similar-name-rule'),
          priority: 20,
          confidence: 'high',
          sourceRefs: [
            {
              channel: 'admin_table_ui',
              factType: 'catalog_family_rule',
              locator: 'steel.catalog_family_rules:17',
              canonicalKey: 'h_beam_similar_name_rule',
            },
          ],
          aliases: ['H鋼', 'H-BEAM'],
        },
        {
          id: 'catalog_family:c_type',
          ruleType: 'catalog_family_inference',
          scope: {
            type: 'catalog_family',
            catalogFamilies: ['c_type'],
            productNames: ['C型鋼', 'C鋼', '輕型鋼'],
            customerId: null,
            customerTierId: null,
            chargeTypes: [],
            formulaCodes: [],
          },
          prompt: expect.any(String),
          priority: 100,
          confidence: 'high',
          sourceRefs: [],
        },
      ]),
    );
    expect(result.data.rules).toHaveLength(3);
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
    expect(client.calls).toHaveLength(3);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[2]?.sql).toEqual(expect.stringContaining('FROM steel.quote_rules'));
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
          requiredLookups: ['search_price_candidates'],
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-1'],
            catalogFamilies: ['c_type'],
            formulaCodes: ['C'],
          }),
          instruction: expect.any(String),
        }),
        expect.objectContaining({
          slug: 'product-price-unit-weight-calculation-zh-v1',
          packetGroups: expect.arrayContaining(['c-type-quote-core']),
          instruction: expect.any(String),
          blockingRules: expect.any(Array),
        }),
        expect.objectContaining({
          slug: 'formula-code-selection-zh-v1',
          packetGroups: expect.arrayContaining(['c-type-quote-core']),
          requiredLookups: [],
        }),
        expect.objectContaining({
          slug: 'drawing-processing-detection-zh-v1',
          packetGroups: expect.arrayContaining(['c-type-quote-core']),
          instruction: expect.any(String),
        }),
      ]),
    );
    expect(result.data.instructionPackets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'h-type-length-surcharge-zh-v1' }),
        expect.objectContaining({ slug: 'angle-surface-oral-zh-v1' }),
      ]),
    );
    expect(result.data.requiredLookups).toEqual(['search_price_candidates']);
    expect(JSON.stringify(result.data)).not.toContain('lookup_formula');
    expect(result.data.requiredLookups).not.toContain('lookup_defaults');
    expect(JSON.stringify(result.data)).not.toMatch(/backend|codex|hard-code/i);
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
    expect(client.calls).toHaveLength(3);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[2]?.sql).toEqual(expect.stringContaining('FROM steel.quote_rules'));
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
          instruction: expect.any(String),
        }),
        expect.objectContaining({
          slug: 'c-type-basic-quote-zh-v1',
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-c-type'],
            catalogFamilies: ['c_type'],
          }),
          instruction: expect.any(String),
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
    expect(client.calls).toHaveLength(3);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[2]?.sql).toEqual(expect.stringContaining('FROM steel.quote_rules'));
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
          requiredLookups: ['search_price_candidates'],
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-h-beam'],
            catalogFamilies: ['h_beam'],
            formulaCodes: ['H'],
          }),
          instruction: expect.any(String),
        }),
        expect.objectContaining({
          slug: 'h-and-i-beam-cutting-price-zh-v1',
          packetGroups: ['h-type-quote-core'],
          requiredLookups: ['search_price_candidates'],
          instruction: expect.any(String),
        }),
        expect.objectContaining({
          slug: 'cut-count-and-trim-detection-zh-v1',
          packetGroups: expect.arrayContaining(['h-type-quote-core']),
          instruction: expect.any(String),
        }),
      ]),
    );
    expect(result.data.instructionPackets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'c-type-basic-quote-zh-v1' }),
        expect.objectContaining({ slug: 'angle-surface-oral-zh-v1' }),
      ]),
    );
  });

  it('rejects formula lookup as an old executable runtime tool', async () => {
    const client = createClient([]);

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

    expect(result).toMatchObject({
      ok: false,
      toolName: 'lookup_formula',
      errorCategory: 'unknown_tool',
    });
    expect(client.calls).toHaveLength(0);
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
              value: fixtureText('c-type-default-instruction'),
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
    expect(client.calls).toHaveLength(3);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[2]?.sql).toEqual(expect.stringContaining('FROM steel.quote_rules'));
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
        instruction: expect.any(String),
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
    expect(result.data.rules).toEqual([
      {
        id: 'quote_default:55',
        ruleType: 'quote_default',
        scope: {
          type: 'catalog_family',
          customerId: null,
          customerTierId: null,
          catalogFamilies: ['c_type'],
          productNames: [],
          chargeTypes: ['cutting', 'hole'],
          formulaCodes: ['C'],
        },
        prompt: expect.any(String),
        priority: 10,
        confidence: 'high',
        matchedFacets: {
          lineRefs: ['line-c-type'],
          catalogFamilies: ['c_type'],
          formulaCodes: ['C'],
          chargeTypes: ['cutting', 'hole'],
        },
        sourceRefs: [
          {
            channel: 'repo_docs',
            factType: 'quote_default',
            sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
            locator: 'c-type-basic-quote-zh-v1',
            canonicalKey: 'c_type_free_cutting_hole',
          },
        ],
      },
    ]);
  });

  it('returns product-name inference rules through catalog-family lookup', async () => {
    const client = createClient([
      [
        {
          key: 'grating',
          display_name_zh: '鍍鋅格柵板',
          aliases: ['格柵板', '鍍鋅柵板'],
          metadata: { sourceKind: 'curated' },
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
      [
        {
          id: '91',
          rule_type: 'similar_product_name_rule',
          catalog_family: 'grating',
          product_name: '鍍鋅格柵板',
          product_names: ['鍍鋅格柵板', '格柵板', '鍍鋅柵板'],
          aliases: ['格柵板', '鍍鋅柵板'],
          selectors: null,
          prompt: fixtureText('grating-similar-product-rule'),
          priority: '15',
          confidence: 'medium',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'admin_table_ui',
              factType: 'catalog_family_rule',
              locator: 'steel.catalog_family_rules:91',
              canonicalKey: 'product_name_grating_alias_rule',
            },
          ],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_catalog_families',
      arguments: { searchText: '格柵板', keys: ['grating'], limit: 10 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    expect(client.calls.at(-1)?.values).toEqual([
      'reviewed',
      ['grating'],
      ['鍍鋅格柵板', '格柵板', '鍍鋅柵板'],
      '%格柵板%',
      10,
    ]);
    expect(client.calls[1]?.sql).toEqual(
      expect.stringContaining('FROM steel.catalog_family_rules'),
    );
    expect(result.data.rules).toEqual(
      expect.arrayContaining([
        {
          id: 'catalog_family_rule:91',
          ruleType: 'similar_product_name_rule',
          scope: {
            type: 'product_name',
            customerId: null,
            customerTierId: null,
            catalogFamilies: ['grating'],
            productNames: ['鍍鋅格柵板', '格柵板', '鍍鋅柵板'],
            chargeTypes: [],
            formulaCodes: [],
          },
          prompt: fixtureText('grating-similar-product-rule'),
          priority: 15,
          confidence: 'medium',
          sourceRefs: [
            {
              channel: 'admin_table_ui',
              factType: 'catalog_family_rule',
              locator: 'steel.catalog_family_rules:91',
              canonicalKey: 'product_name_grating_alias_rule',
            },
          ],
          aliases: ['格柵板', '鍍鋅柵板'],
        },
      ]),
    );
    expect(result.data.rules).toHaveLength(2);
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
              value: fixtureText('c-type-default-instruction'),
            },
            {
              parameterKey: 'userVisibleNote',
              value: fixtureText('c-type-default-note'),
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
    expect(client.calls).toHaveLength(3);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.instruction_packets'));
    expect(client.calls[1]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[2]?.sql).toEqual(expect.stringContaining('FROM steel.quote_rules'));
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
          userVisibleNotes: expect.any(Array),
          confirmationQuestions: expect.any(Array),
        }),
        expect.objectContaining({
          slug: 'product-price-unit-weight-calculation-zh-v1',
          instruction: expect.any(String),
        }),
      ]),
    );
    expect(result.data.quoteDefaults).toEqual([
      expect.objectContaining({
        defaultId: 'quote_default:55',
        catalogFamilies: ['c_type'],
        chargeTypes: ['cutting', 'hole'],
        instruction: expect.any(String),
      }),
    ]);
    expect(result.data.requiredLookups).toEqual(['search_price_candidates']);
    expect(result.data.userVisibleNotes).toHaveLength(4);
    expect(result.data.confirmationQuestions).toHaveLength(2);
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
              value: fixtureText('c-type-default-instruction'),
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
              value: fixtureText('h-beam-default-instruction'),
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
    expect(client.calls).toHaveLength(3);
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
    expect(client.calls[2]?.sql).toEqual(expect.stringContaining('FROM steel.quote_rules'));
    expect(result.data.quoteDefaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          defaultId: 'quote_default:55',
          catalogFamilies: ['c_type'],
          formulaCodes: ['C'],
          instruction: expect.any(String),
        }),
        expect.objectContaining({
          defaultId: 'quote_default:56',
          catalogFamilies: ['h_beam'],
          formulaCodes: ['H'],
          instruction: expect.any(String),
        }),
      ]),
    );
  });

  it('runs a C-type order context through rules, price candidates, and defaults', async () => {
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
              value: fixtureText('c-type-default-instruction'),
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
      [],
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
    expect(quoteRulesResult.ok).toBe(true);
    expect(priceResult.ok).toBe(true);
    if (!quoteRulesResult.ok || !priceResult.ok) {
      throw new Error('C 型鋼 vertical lookup failed');
    }

    expect(client.calls).toHaveLength(4);
    expect(runState.callsUsed).toBe(2);
    expect(quoteRulesResult.data.instructionPackets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'c-type-basic-quote-zh-v1',
          requiredLookups: ['search_price_candidates'],
          instruction: expect.any(String),
          blockingRules: expect.any(Array),
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
        instruction: expect.any(String),
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
