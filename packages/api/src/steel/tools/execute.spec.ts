import { createSteelToolRunState, executeSteelTool } from './execute';
import { steelToolArgsSchemas } from './schemas';

import type { SteelRepositoryClient, SteelSqlParameter } from '../repositories/types';
import type { SteelOutputSheetMemorySnapshot } from '../runtime/context';

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

function createPriceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '10',
    erp_item_code: 'OTL006',
    spec_key: '6.0m/mOT板雷射切割',
    product_name: 'OT板雷射切割 6.0m/m',
    price_kind: 'product',
    category: '鐵板/鋼板',
    subcategory: null,
    material: 'OT 黑鐵',
    source_subcategory_label: null,
    source_thickness: '6.0',
    source_spec: '雷射切割',
    unit: 'piece',
    unit_price_a: '40.0000',
    unit_price_b: '42.0000',
    unit_price_c: '45.0000',
    unit_price_f: '50.0000',
    ratio_a: null,
    ratio_b: null,
    ratio_c: null,
    ratio_f: null,
    product_price_unit_weight: null,
    product_price_unit_weight_unit: null,
    currency: 'TWD',
    value_state: 'confirmed',
    review_state: 'draft',
    active: false,
    source_refs: [],
    ...overrides,
  };
}

function createOutputSheetMemorySnapshot(): SteelOutputSheetMemorySnapshot {
  return {
    previousOutputSheets: {
      system_order: {
        sheetId: 'system_order',
        rows: [
          {
            rowId: 'system_order:1',
            cells: {
              項次: '1',
              型號: 'CCG075',
              品名規格: '錏輕型鋼 75x45',
              數量: 2,
              內部備註: '完整 row data 必須回傳',
            },
          },
          {
            rowId: 'system_order:2',
            cells: {
              項次: '2',
              型號: 'DNB70060',
              品名規格: '6.0m/mOT板雷射切割',
              數量: 60,
            },
          },
        ],
      },
      customer_data: {
        sheetId: 'customer_data',
        rows: [
          {
            rowId: 'customer_data:1',
            cells: {
              客戶名稱: '龍頂鋼鐵',
              客戶等級: '價格B',
            },
          },
        ],
      },
      manual_review: {
        sheetId: 'manual_review',
        rows: [],
      },
      customer_quote: {
        sheetId: 'customer_quote',
        rows: [
          {
            rowId: 'customer_quote:1',
            cells: {
              項次: '1',
              型號: 'CCG075',
              小計: 536,
            },
          },
        ],
      },
    },
    derivedIndex: {
      lineItems: [],
      customers: [],
      adoptedPrices: [],
      calculations: [],
      ocrExtracts: [],
      unresolvedItems: [],
    },
  };
}

describe('Steel minimal tool execution', () => {
  it('removes catalog-family lookup from executable tools', async () => {
    const result = await executeSteelTool({
      client: createClient([]),
      toolName: 'lookup_catalog_families',
      arguments: { keywords: ['H鋼'] },
    });

    expect(result).toMatchObject({
      ok: false,
      errorCategory: 'unknown_tool',
    });
  });

  it('returns all tier prices from unified rows without customer tier input', async () => {
    const client = createClient([
      [
        createPriceRow({ id: '10', unit: 'piece' }),
        createPriceRow({ id: '11', unit: 'kg', spec_key: '6.0m/mOT板雷射切割_kg' }),
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [
          {
            category: '鐵板/鋼板',
            material: 'OT 黑鐵',
            thicknesses: ['6'],
            specs: ['雷射切割'],
            keyword: 'OT板',
          },
        ],
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual([
      'reviewed',
      '鐵板/鋼板',
      'OT 黑鐵',
      '6.0',
      '%雷射切割%',
      '%OT板%',
      5,
    ]);
    expect(client.calls[0]?.sql).toContain('FROM steel.prices');
    expect(client.calls[0]?.sql).toContain('review_state = $1');
    expect(client.calls[0]?.sql).toContain('active = true');
    expect(client.calls[0]?.sql).toContain('category = $2');
    expect(client.calls[0]?.sql).toContain('material = $3');
    expect(client.calls[0]?.sql).not.toContain('customer_tier_id');
    expect(client.calls[0]?.sql).not.toContain("unit = 'kg'");
    expect(result.data).not.toHaveProperty('customerTier');
    expect(result.data.priceCandidates).toHaveLength(2);
    expect(result.data.priceCandidates).toEqual([
      expect.objectContaining({
        unit: 'piece',
        tierPrices: { A: 40, B: 42, C: 45, F: 50 },
      }),
      expect.objectContaining({
        unit: 'kg',
        tierPrices: { A: 40, B: 42, C: 45, F: 50 },
      }),
    ]);
  });

  it('rejects customer tier props in price lookup arguments', async () => {
    const result = await executeSteelTool({
      client: createClient([]),
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ category: '鐵板/鋼板', material: 'OT 黑鐵', keyword: 'OT板' }],
        customerTier: 'A',
        limit: 5,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      errorCategory: 'invalid_arguments',
    });
  });

  it('does not narrow SQL by customer tier and returns every price tier', async () => {
    const client = createClient([[createPriceRow({ id: '12' })]]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ category: '鐵板/鋼板', material: 'OT 黑鐵', keyword: 'OT板' }],
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual(['reviewed', '鐵板/鋼板', 'OT 黑鐵', '%OT板%', 5]);
    expect(client.calls[0]?.sql).not.toContain('customer_tier_id');
    expect(result.data.priceCandidates).toEqual([
      expect.objectContaining({
        tierPrices: { A: 40, B: 42, C: 45, F: 50 },
      }),
    ]);
  });

  it('returns related cutting rows in the same price candidate call', async () => {
    const client = createClient([
      [
        createPriceRow({
          id: '20',
          erp_item_code: null,
          price_kind: 'cutting',
          spec_key: 'H型鋼200x100切工',
          product_name: 'H型鋼 200*100 切工',
          category: '切工/切割',
          subcategory: 'H型鋼',
          material: '無',
          source_subcategory_label: 'H型鋼',
          source_spec: '200x100',
          unit: '刀',
          unit_price_a: '120.0000',
          unit_price_b: '125.0000',
          unit_price_c: '120.0000',
          unit_price_f: '120.0000',
        }),
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ category: 'H型鋼', specs: ['200*100'] }],
        includeRelatedCutting: true,
        limit: 20,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toContain("price_kind = 'cutting'");
    expect(client.calls[0]?.values).toEqual([
      'reviewed',
      'H型鋼',
      '%200x100%',
      '切工/切割',
      ['H型鋼', '工字鐵/H型鋼'],
      '%200x100%',
      20,
    ]);
    expect(result.data.priceCandidates).toEqual([
      expect.objectContaining({
        priceKind: 'cutting',
        category: '切工/切割',
        subcategory: 'H型鋼',
        sourceSubcategoryLabel: 'H型鋼',
        unit: '刀',
        tierPrices: { A: 120, B: 125, C: 120, F: 120 },
      }),
    ]);
  });

  it('supports category discovery when category is unknown', async () => {
    const client = createClient([
      [
        {
          category: '扁方管',
          material: 'OT 黑鐵',
          candidate_count: '12',
          example_erp_item_code: 'GDH075',
          example_product_name: '黑方管 75x45',
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        mode: 'category_discovery',
        keyword: '黑方管 75',
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual([
      'reviewed',
      '%黑方管 75%',
      '%黑方管75%',
      5,
    ]);
    expect(result.data).toEqual(
      expect.objectContaining({
        mode: 'category_discovery',
        categoryCandidates: [
          {
            category: '扁方管',
            material: 'OT 黑鐵',
            candidateCount: 12,
            exampleErpItemCode: 'GDH075',
            exampleProductName: '黑方管 75x45',
          },
        ],
      }),
    );
  });

  it('searches customers by AI-provided keyword arrays', async () => {
    const client = createClient([
      [
        {
          id: '21',
          erp_customer_code: 'A001',
          display_name: '大成鋼',
          legal_name: '大成鋼鐵股份有限公司',
          tax_id: '12345678',
          customer_tier: 'A',
          status: 'inactive',
          source_refs: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_customers',
      arguments: {
        keywords: ['大成', 'A001'],
        limit: 10,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls[0]?.values).toEqual(['大成', '%大成%', 'A001', '%A001%', 10]);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).not.toContain('customer_aliases');
    expect(client.calls[0]?.sql).not.toContain('customer_tiers');
    expect(client.calls[0]?.sql).not.toContain("c.status = 'active'");
    expect(result.data.customers).toEqual([
      expect.objectContaining({
        erpCustomerCode: 'A001',
        displayName: '大成鋼',
        customerTier: 'A',
        status: 'inactive',
      }),
    ]);
    expect(result.data).not.toHaveProperty('rules');
  });

  it('passes registry-parsed args into dispatch without parsing the same schema twice', async () => {
    const client = createClient([
      [
        {
          id: '21',
          erp_customer_code: 'A001',
          display_name: '大成鋼',
          legal_name: '大成鋼鐵股份有限公司',
          tax_id: '12345678',
          customer_tier: null,
          status: 'active',
          source_refs: [],
        },
      ],
    ]);
    const parseSpy = jest.spyOn(steelToolArgsSchemas.search_customers, 'parse');

    try {
      const result = await executeSteelTool({
        client,
        toolName: 'search_customers',
        arguments: {
          keywords: ['大成'],
          limit: 10,
        },
      });

      expect(result.ok).toBe(true);
      expect(parseSpy).not.toHaveBeenCalled();
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('searches unified rules by AI-provided keywords', async () => {
    const client = createClient([[]]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_quote_rules',
      arguments: {
        keywords: ['PL6', '雷射切割'],
        limit: 20,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual(
      expect.arrayContaining([
        'reviewed',
        '%PL6%',
        '%雷射切割%',
        '%plate%',
        '%ot_plate%',
        '%black_plate%',
        '%板材%',
        '%鐵板%',
        20,
      ]),
    );
    expect(client.calls[0]?.sql).toContain('FROM steel.rules');
    expect(client.calls[0]?.sql).toContain('review_state = $1');
    expect(client.calls[0]?.sql).toContain('active = true');
    expect(result.data).toEqual(
      expect.objectContaining({
        keywords: expect.arrayContaining(['PL6', '雷射切割', 'plate', 'ot_plate']),
        rules: [],
      }),
    );
  });

  it('expands plate-like quote rule keywords so reviewed plate rules are retrievable', async () => {
    const client = createClient([[]]);

    const result = await executeSteelTool({
      client,
      toolName: 'lookup_quote_rules',
      arguments: {
        keywords: ['PL6×80', '6.0m/mOT板'],
        limit: 20,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual(
      expect.arrayContaining([
        '%PL6×80%',
        '%6.0m/mOT板%',
        '%plate%',
        '%ot_plate%',
        '%black_plate%',
        '%板材%',
        '%鐵板%',
      ]),
    );
    expect(result.data.keywords).toEqual(
      expect.arrayContaining(['plate', 'ot_plate', 'black_plate', '板材', '鐵板']),
    );
  });

  it('reads working-order memory through the read-only memory reader', async () => {
    const memoryReader = {
      readWorkingOrderItems: jest.fn(async () => ({
        mode: 'rowNo',
        resultCount: 1,
        workingOrderRows: [
          {
            rowNo: 12,
            erpItemCode: 'CCG075',
            productName: '錏輕型鋼 75x45',
            quantity: 2,
          },
        ],
      })),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      memoryReader,
      toolName: 'read_working_order_items',
      arguments: {
        mode: 'rowNo',
        rowNo: 12,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(memoryReader.readWorkingOrderItems).toHaveBeenCalledWith({
      mode: 'rowNo',
      rowNo: 12,
    });
    expect(result.data).toEqual(
      expect.objectContaining({
        resultCount: 1,
        workingOrderRows: [
          expect.objectContaining({
            erpItemCode: 'CCG075',
            rowNo: 12,
          }),
        ],
      }),
    );
  });

  it('reads active workbook rows by keyword and returns complete matching row data', async () => {
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => createOutputSheetMemorySnapshot()),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_active_workbook',
      arguments: {
        query: 'CCG075',
        sheetIds: ['system_order'],
        limit: 5,
        reason: 'Need exact compact-context row',
      },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(outputSheetMemoryReader.readOutputSheetMemory).toHaveBeenCalledWith();
    expect(result.data).toEqual(
      expect.objectContaining({
        query: 'CCG075',
        resultCount: 1,
        matches: [
          expect.objectContaining({
            sheetId: 'system_order',
            rowId: 'system_order:1',
            rowIndex: 1,
            matchedFields: expect.arrayContaining(['型號']),
            rowData: {
              項次: '1',
              型號: 'CCG075',
              品名規格: '錏輕型鋼 75x45',
              數量: 2,
              內部備註: '完整 row data 必須回傳',
            },
          }),
        ],
      }),
    );
  });

  it('enforces per-run tool call limits', async () => {
    const client = createClient([[], []]);
    const runState = createSteelToolRunState(1);

    const firstResult = await executeSteelTool({
      client,
      runState,
      toolName: 'search_customers',
      arguments: { keywords: ['龍頂'] },
    });
    const secondResult = await executeSteelTool({
      client,
      runState,
      toolName: 'search_customers',
      arguments: { keywords: ['龍頂'] },
    });

    expect(firstResult.ok).toBe(true);
    expect(secondResult).toMatchObject({
      ok: false,
      errorCategory: 'rate_limited',
    });
    expect(client.calls).toHaveLength(1);
  });
});
