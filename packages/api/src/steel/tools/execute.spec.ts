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

describe('executeSteelTool', () => {
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
            productName: '錏成型角鐵',
            specKey: '30x30',
            specKeyContains: '30x30',
            confidence: 'medium',
            reason: 'AI interpreted L30x30 as angle steel and 亞 as possible 錏',
          },
          {
            queryId: 'raw-user-text',
            productName: '亞L30x30',
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

  it('returns C-type instruction packet group from one batched lookup', async () => {
    const client = createClient([]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_instructions',
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
        materialContexts: [
          {
            lineRefs: ['line-1'],
            packetGroupHints: ['c-type-quote-core'],
            materialCandidates: ['c_type'],
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
    expect(client.calls).toHaveLength(0);
    expect(result.data.packetGroups).toEqual([
      {
        group: 'c-type-quote-core',
        lineRefs: ['line-1'],
        returnedPacketSlugs: [
          'c-type-basic-quote-zh-v1',
          'price-source-priority-zh-v1',
          'formula-code-selection-zh-v1',
          'drawing-processing-detection-zh-v1',
        ],
      },
    ]);
    expect(result.data.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'c-type-basic-quote-zh-v1',
          packetGroups: ['c-type-quote-core'],
          requiredLookups: ['search_price_candidates', 'lookup_formula', 'lookup_defaults'],
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-1'],
            materialFamilies: ['c_type'],
            formulaCodes: ['C'],
          }),
          instruction: expect.stringContaining('C 型鋼切工與孔費預設免費'),
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
    expect(result.data.packets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'h-type-length-surcharge-zh-v1' }),
        expect.objectContaining({ slug: 'angle-surface-oral-zh-v1' }),
      ]),
    );
    expect(JSON.stringify(result.data)).not.toMatch(/backend|codex|hard-code/i);
    expect(JSON.stringify(result.data)).not.toMatch(/不要只因品名.*confirmed true-zero/);
  });

  it('returns angle and C-type instruction packet groups from one batched lookup', async () => {
    const client = createClient([]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_instructions',
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
        materialContexts: [
          {
            lineRefs: ['line-angle'],
            packetGroupHints: ['angle-zinc-quote-core'],
            materialCandidates: ['angle'],
            surfaceCandidates: ['zinc_plated', 'galvanized', 'unknown'],
            processingTypes: ['none'],
            lowConfidenceReasons: ['亞 is typo/surface clue', 'thickness unknown'],
          },
          {
            lineRefs: ['line-c-type'],
            packetGroupHints: ['c-type-quote-core'],
            materialCandidates: ['c_type'],
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
    expect(client.calls).toHaveLength(0);
    expect(result.data.packetGroups).toEqual(
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
    expect(result.data.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'angle-surface-oral-zh-v1',
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-angle'],
            materialFamilies: ['angle'],
          }),
          instruction: expect.stringContaining('亞'),
        }),
        expect.objectContaining({
          slug: 'c-type-basic-quote-zh-v1',
          matchedFacets: expect.objectContaining({
            lineRefs: ['line-c-type'],
            materialFamilies: ['c_type'],
          }),
          instruction: expect.stringContaining('C 型鋼切工與孔費預設免費'),
        }),
      ]),
    );
    expect(result.data.packets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: 'h-type-length-surcharge-zh-v1' })]),
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
        materialContexts: [
          {
            lineRefs: ['line-angle'],
            materialCandidates: ['angle'],
          },
          {
            lineRefs: ['line-c-type'],
            materialCandidates: ['c_type'],
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

  it('returns defaults for multiple material contexts in one tool call', async () => {
    const client = createClient([
      [
        {
          id: '55',
          default_type: 'true_zero_rule',
          origin_table: 'tasks/steel-data-rules-architecture/instruction-packets.md',
          origin_id: 'c-type-free-cutting-hole-v1',
          origin_revision: '1',
          scope_type: 'material_family',
          customer_id: null,
          customer_tier_id: null,
          material_family: 'c_type',
          product_family: null,
          charge_type: null,
          formula_code: 'C',
          selector: { materialFamily: 'c_type', chargeTypes: ['cutting', 'hole'] },
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
      toolName: 'lookup_defaults',
      arguments: {
        materialContexts: [
          {
            lineRefs: ['line-angle'],
            materialCandidates: ['angle'],
            processingTypes: ['none'],
          },
          {
            lineRefs: ['line-c-type'],
            materialCandidates: ['c_type'],
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
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toEqual(expect.stringContaining('FROM steel.quote_defaults'));
    expect(client.calls[0]?.values).toEqual([
      'reviewed',
      'angle',
      'c_type',
      'hole',
      'cutting',
      'C',
      10,
    ]);
    expect(result.data.defaultCandidates).toEqual([
      expect.objectContaining({
        defaultId: 'quote_default:55',
        defaultType: 'true_zero_rule',
        lineRefs: ['line-c-type'],
        materialFamilies: ['c_type'],
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

  it('rejects direct raw typo price search before SQL when original text is present', async () => {
    const client = createClient([]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        originalText: '亞L30x30',
        productName: '亞L30x30',
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
