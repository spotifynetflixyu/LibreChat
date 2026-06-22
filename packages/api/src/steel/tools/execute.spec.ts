import { createSteelToolRunState, executeSteelTool } from './execute';
import { steelToolArgsSchemas } from './schemas';

import type { SteelRepositoryClient, SteelSqlParameter } from '../repositories/types';

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
    category_id: null,
    customer_tier_id: null,
    customer_tier_code: null,
    customer_tier_name: null,
    spec_key: '6.0m/mOT板雷射切割',
    product_name: 'OT板雷射切割 6.0m/m',
    catalog_family: 'wrong_family',
    material_grade: null,
    unit: 'piece',
    unit_price: '42.0000',
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

  it('defaults price lookup to B tier without unit, category, review, active filters, or unit post-filtering', async () => {
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
        candidateQueries: ['OT板雷射切割', '6.0m/m'],
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual(['%OT板雷射切割%', '%6.0m_m%', 2, 5]);
    expect(client.calls[0]?.sql).not.toContain('review_state =');
    expect(client.calls[0]?.sql).not.toContain('active = true');
    expect(client.calls[0]?.sql).toContain('(customer_tier_id = $3 OR customer_tier_id IS NULL)');
    expect(client.calls[0]?.sql).toContain('CASE WHEN customer_tier_id IS NULL');
    expect(client.calls[0]?.sql).not.toContain('catalog_family = ANY');
    expect(client.calls[0]?.sql).not.toContain("unit = 'kg'");
    expect(result.data.priceCandidates).toHaveLength(2);
    expect(result.data.priceCandidates).toEqual([
      expect.objectContaining({ unit: 'piece' }),
      expect.objectContaining({ unit: 'kg' }),
    ]);
  });

  it('uses an AI-provided customer tier for price lookup instead of the B-tier default', async () => {
    const client = createClient([[createPriceRow({ id: '12' })]]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        candidateQueries: ['CCG075'],
        customerTierId: 5,
        limit: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual(['%CCG075%', 5, 5]);
    expect(client.calls[0]?.sql).toContain('(customer_tier_id = $2 OR customer_tier_id IS NULL)');
    expect(client.calls[0]?.sql).not.toContain('review_state =');
    expect(client.calls[0]?.sql).not.toContain('active = true');
    expect(client.calls[0]?.sql).not.toContain('catalog_family = ANY');
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
          customer_tier_id: null,
          customer_tier_code: null,
          customer_tier_name: null,
          matched_alias: '大成',
          status: 'inactive',
          source_refs: [],
        },
      ],
      [],
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
    expect(client.calls[0]?.sql).not.toContain("c.status = 'active'");
    expect(result.data.customers).toEqual([
      expect.objectContaining({
        erpCustomerCode: 'A001',
        displayName: '大成鋼',
        status: 'inactive',
      }),
    ]);
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
          customer_tier_id: null,
          customer_tier_code: null,
          customer_tier_name: null,
          matched_alias: '大成',
          status: 'active',
          source_refs: [],
        },
      ],
      [],
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

  it('searches quote rules, instruction packets, and defaults by AI-provided keywords', async () => {
    const client = createClient([[], [], []]);

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

    expect(client.calls).toHaveLength(3);
    for (const call of client.calls) {
      expect(call.values).toEqual(
        expect.arrayContaining([
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
      expect(call.sql).not.toContain('review_state =');
      expect(call.sql).not.toContain('active = true');
    }
    expect(result.data).toEqual(
      expect.objectContaining({
        keywords: expect.arrayContaining(['PL6', '雷射切割', 'plate', 'ot_plate']),
        instructionPackets: [],
        quoteDefaults: [],
        quoteRules: [],
        rules: [],
      }),
    );
  });

  it('expands plate-like quote rule keywords so reviewed plate rules are retrievable', async () => {
    const client = createClient([[], [], []]);

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

    for (const call of client.calls) {
      expect(call.values).toEqual(
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
    }
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
