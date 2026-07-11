import { createSteelToolRunState, executeSteelTool } from './execute';
import { steelToolArgsSchemas } from './schemas';
import { parseMarkdownTables } from '../markdown/table';

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
    price_kind: 'product',
    formula_code: null,
    spec_key: 'OTL006 6.0mm OT板',
    product_name: 'OT板 6.0mm',
    normalized_spec_text: '6.0mm 4x8',
    category: '鐵板',
    subcategory: null,
    material: '黑鐵 / OT',
    dimension_signature: 'T6-W1219-L2438',
    unit: 'Kg',
    value_state: 'confirmed',
    unit_price_base: null,
    unit_price_a: '40.0000',
    unit_price_b: '42.0000',
    unit_price_c: null,
    unit_price_d: '46.0000',
    unit_price_e: null,
    unit_price_f: '50.0000',
    price_ratio_a: '1.4000',
    price_ratio_b: '1.3000',
    price_ratio_c: null,
    price_ratio_d: '1.2000',
    price_ratio_e: null,
    price_ratio_f: '1.1000',
    unit_weight_value: null,
    unit_weight_basis: null,
    density: '7.850000',
    source_thickness: '6.0',
    thickness_min_mm: '6.000000',
    thickness_max_mm: '6.000000',
    width_mm: null,
    height_mm: null,
    length_mm: null,
    outer_diameter_mm: null,
    nominal_inch: null,
    web_mm: null,
    flange_mm: null,
    lip_mm: null,
    sheet_width_mm: '1219.000000',
    sheet_length_mm: '2438.000000',
    spec_sort_key: '006.000',
    cost_basis: 'Kg',
    currency: 'TWD',
    active: true,
    source_refs: [{ channel: 'price', factType: 'price', locator: 'row:10' }],
    ...overrides,
  };
}

function createCuttingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    lookup_term: '鐵管',
    id: '101',
    cutting_category: '鐵管',
    record_type: 'price',
    item_name: '1/2"',
    cut_type: '加工/切工',
    spec_text: '1/2"',
    normalized_spec_text: '1/2"',
    inch_min: '0.500000000',
    inch_max: '0.500000000',
    mm_min: '12.700000000',
    mm_max: '12.700000000',
    unit: '刀',
    unit_price_a: '10.0000',
    unit_price_b: null,
    unit_price_c: '10.0000',
    unit_price_f: '10.0000',
    conditions: {},
    calculation_rule: null,
    notes: null,
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
              belly: 3,
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
      ocrExtracts: [
        {
          filename: 'PL.pdf',
          page: 1,
          markdown:
            '| 件號 | 規格 | 數量 | 孔數 / 件 |\n| --- | --- | ---: | ---: |\n| D3 | PL15*500 | 10 | 6 |',
          confidence: 'high',
        },
      ],
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

  it('returns ordered grouped query results with direct-first safe pricing options', async () => {
    const client = createClient([
      [
        {
          query_index: 0,
          query_id: 'line-1',
          price_candidates: [createPriceRow()],
          category_candidates: [],
        },
        {
          query_index: 1,
          query_id: 'q2',
          price_candidates: [
            createPriceRow({
              id: '11',
              erp_item_code: 'PIPE-M',
              unit: 'M',
              value_state: 'ratio_only',
              unit_price_a: null,
              unit_price_b: null,
              unit_price_d: null,
              unit_price_f: null,
            }),
          ],
          category_candidates: [],
        },
        {
          query_index: 2,
          query_id: 'q3',
          price_candidates: [],
          category_candidates: [
            {
              category: '圓管',
              material: '黑鐵 / OT',
              candidate_count: '8',
              example_erp_item_code: 'PIPE-M',
              example_product_name: '黑鐵圓管',
            },
          ],
        },
      ],
      [
        createCuttingRow(),
        createCuttingRow({
          lookup_term: '鐵板',
          id: '102',
          cutting_category: '鐵板/平鐵',
          item_name: '65~100',
          spec_text: '65~100',
          normalized_spec_text: '65~100',
          inch_min: null,
          inch_max: null,
          mm_min: null,
          mm_max: null,
          unit_price_a: '20.0000',
          unit_price_c: '20.0000',
          unit_price_f: '20.0000',
        }),
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [
          {
            queryId: 'line-1',
            category: '鐵板',
            material: '黑鐵',
            thicknessMm: ['6'],
            keyword: 'OT板',
            limit: 101,
          },
          { category: '圓管', erpItemCode: 'PIPE-M' },
          { mode: 'category_discovery', keyword: '黑鐵圓管' },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(2);
    expect(result.data).not.toHaveProperty('priceCandidates');
    expect(result.data.queryResults).toEqual([
      expect.objectContaining({
        queryId: 'q1',
        query: expect.objectContaining({
          queryId: 'q1',
          category: '鐵板',
          limit: 100,
        }),
        status: 'ok',
        categoryCandidates: [],
        issues: [],
        candidates: [
          expect.objectContaining({
            erpItemCode: 'OTL006',
            thicknessMinMm: 6,
            thicknessMaxMm: 6,
            quoteEligible: true,
            pricingOptions: [
              {
                source: 'tier_price',
                quoteEligible: true,
                quoteUnit: 'Kg',
                tierPrices: { A: 40, B: 42, C: null, D: 46, E: null, F: 50 },
              },
              {
                source: 'price_ratio',
                quoteEligible: true,
                quoteUnit: 'Kg',
                tierPrices: { A: 1.4, B: 1.3, C: null, D: 1.2, E: null, F: 1.1 },
              },
            ],
            skippedPricingOptions: [],
          }),
        ],
      }),
      expect.objectContaining({
        queryId: 'q2',
        query: expect.objectContaining({ queryId: 'q2', erpItemCode: 'PIPE-M' }),
        status: 'ok',
        candidates: [
          expect.objectContaining({
            erpItemCode: 'PIPE-M',
            quoteEligible: true,
            pricingOptions: [
              {
                source: 'price_ratio',
                quoteEligible: true,
                quoteUnit: 'M',
                tierPrices: { A: 1.4, B: 1.3, C: null, D: 1.2, E: null, F: 1.1 },
              },
            ],
          }),
        ],
      }),
      {
        queryId: 'q3',
        query: { queryId: 'q3', mode: 'category_discovery', keyword: '黑鐵圓管' },
        status: 'ok',
        candidates: [],
        categoryCandidates: [
          {
            category: '圓管',
            material: '黑鐵 / OT',
            candidateCount: 8,
            exampleErpItemCode: 'PIPE-M',
            exampleProductName: '黑鐵圓管',
          },
        ],
        issues: [],
      },
    ]);
    expect(result.data.summary).toEqual({
      queryCount: 3,
      groupCount: 3,
      matchedQueryCount: 3,
      noMatchQueryCount: 0,
      candidateCount: 2,
      categoryCandidateCount: 1,
    });
    expect(result.data.cuttingPrices).toEqual([
      expect.objectContaining({
        cuttingCategory: '鐵板/平鐵',
        sourceCategories: ['鐵板'],
        queryIds: ['q1'],
      }),
      expect.objectContaining({
        cuttingCategory: '鐵管',
        sourceCategories: ['圓管'],
        queryIds: ['q2'],
        prices: [
          expect.objectContaining({
            tierPrices: { A: 10, B: 10, C: 10, F: 10 },
            tierBSource: 'A/C/F',
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(result.data)).not.toContain('tierRatios');
    expect(JSON.stringify(result.data)).not.toContain('price_ratio_');
    expect(JSON.stringify(result.data)).not.toContain('sourceRefs');
  });

  it('marks non-Kg/M ratio pricing as skipped and non-quote-eligible', async () => {
    const client = createClient([
      [
        {
          query_index: 0,
          query_id: 'hardware',
          price_candidates: [
            createPriceRow({
              id: '12',
              erp_item_code: 'BOLT-1',
              category: '五金/配件',
              unit: '支',
              value_state: 'ratio_only',
              unit_price_a: null,
              unit_price_b: null,
              unit_price_d: null,
              unit_price_f: null,
            }),
          ],
          category_candidates: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ queryId: 'hardware', category: '五金/配件', material: '黑鐵' }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(result.data.queryResults).toEqual([
      expect.objectContaining({
        queryId: 'q1',
        status: 'ok',
        candidates: [
          expect.objectContaining({
            quoteEligible: false,
            pricingOptions: [],
            skippedPricingOptions: [
              {
                source: 'price_ratio',
                status: 'skipped',
                reason: 'category_rule_pending',
                quoteEligible: false,
                quoteUnit: '支',
              },
            ],
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(result.data)).not.toContain('tierRatios');
    expect(JSON.stringify(result.data)).not.toContain('"A":1.4');
  });

  it('returns a no-match group and summary instead of flattening empty results', async () => {
    const client = createClient([
      [
        {
          query_index: 0,
          query_id: 'missing',
          price_candidates: [],
          category_candidates: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ queryId: 'missing', category: 'T型鋼', keyword: 'not-found' }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(result.data.queryResults).toEqual([
      {
        queryId: 'q1',
        query: { queryId: 'q1', category: 'T型鋼', keyword: 'not-found' },
        status: 'no_match',
        candidates: [],
        categoryCandidates: [],
        issues: [],
      },
    ]);
    expect(result.data.summary).toEqual({
      queryCount: 1,
      groupCount: 1,
      matchedQueryCount: 0,
      noMatchQueryCount: 1,
      candidateCount: 0,
      categoryCandidateCount: 0,
    });
  });

  it('rejects customer tier props in grouped price lookup arguments', async () => {
    const result = await executeSteelTool({
      client: createClient([]),
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ category: '鐵板', material: '黑鐵' }],
        customerTier: 'A',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      errorCategory: 'invalid_arguments',
    });
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

  it('reads current workbook data as Markdown text without row queries', async () => {
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => createOutputSheetMemorySnapshot()),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: {
        scope: 'workbook',
        reason: 'Need current parsed workbook after compact context',
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
        source: 'assistant_markdown_auto_parse',
        scope: 'workbook',
        format: 'markdown',
        markdown: expect.any(String),
      }),
    );
    expect(result.data).not.toHaveProperty('workbook');
    expect(result.data).not.toHaveProperty('quote');
    expect(result.data).not.toHaveProperty('ocr');
    const markdown = String(result.data.markdown);
    const sectionHeadings = markdown
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3));
    const tables = parseMarkdownTables(markdown);

    expect(sectionHeadings).toEqual([
      'system_order',
      'customer_data',
      'customer_quote',
      'manual_review',
    ]);
    expect(tables[0]?.headers).toEqual([
      '型號',
      '品名規格',
      '材質編號',
      '單位',
      '數量',
      '單重',
      '總數',
      '單價',
      '計價基準',
      '公式編號',
      '厚度',
      '寬度',
      '長度',
      '肚',
      '類別',
      '備註',
    ]);
    expect(tables[0]?.rows[0]?.slice(0, 5)).toEqual(['CCG075', '錏輕型鋼 75x45', '', '', '2']);
    expect(tables[0]?.rows[0]?.[13]).toBe('3');
    expect(tables[2]?.headers).toEqual(['項目', '說明', '小計']);
    expect(tables[2]?.rows[0]).toEqual(['', '', '536']);
  });

  it('renders legacy degree cells under the canonical 肚 header', async () => {
    const snapshot = createOutputSheetMemorySnapshot();
    snapshot.previousOutputSheets.system_order.rows = [
      {
        rowId: 'system_order:legacy-chinese',
        cells: { 項次: '1', 度: 3 },
      },
      {
        rowId: 'system_order:legacy-english',
        cells: { 項次: '2', degree: 4 },
      },
    ];
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => snapshot),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: { scope: 'workbook' },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }
    const systemOrder = parseMarkdownTables(String(result.data.markdown))[0];
    expect(systemOrder?.headers[13]).toBe('肚');
    expect(systemOrder?.rows.map((row) => row[13])).toEqual(['3', '4']);
  });

  it('reads file-keyed workbook rows when multiple OCR files have separate orders', async () => {
    const snapshot = createOutputSheetMemorySnapshot();
    snapshot.previousOutputSheets.system_order.rows = [
      {
        rowId: 'system_order:default:1',
        cells: {
          ocrFileKey: 'default',
          rowNo: 1,
          erpItemCode: 'TEXT001',
          productName: 'Text order item',
          quantity: 3,
        },
      },
      {
        rowId: 'system_order:file-a:1',
        cells: {
          ocrFileKey: 'file:file-a',
          fileId: 'file-a',
          filename: 'a.pdf',
          rowNo: 1,
          erpItemCode: 'A001',
          productName: 'A order item',
          quantity: 1,
        },
      },
      {
        rowId: 'system_order:file-b:1',
        cells: {
          ocrFileKey: 'file:file-b',
          fileId: 'file-b',
          filename: 'b.pdf',
          rowNo: 1,
          erpItemCode: 'B001',
          productName: 'B order item',
          quantity: 2,
        },
      },
    ];
    snapshot.previousOutputSheets.customer_quote.rows = [];
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => snapshot),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: {
        scope: 'workbook',
        fileKey: 'file:file-b',
        reason: 'Need the workbook generated for b.pdf only',
      },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(result.data.fileKey).toBe('file:file-b');
    const markdown = String(result.data.markdown);
    const tables = parseMarkdownTables(markdown);

    expect(markdown).not.toContain('A001');
    expect(markdown).not.toContain('TEXT001');
    expect(markdown).toContain('B001');
    expect(tables[0]?.rows).toHaveLength(1);
    expect(tables[0]?.rows[0]?.slice(0, 5)).toEqual(['B001', 'B order item', '', '', '2']);
  });

  it('reads the default workbook order separately from OCR file-keyed orders', async () => {
    const snapshot = createOutputSheetMemorySnapshot();
    snapshot.previousOutputSheets.system_order.rows = [
      {
        rowId: 'system_order:legacy-default:1',
        cells: {
          rowNo: 1,
          erpItemCode: 'LEGACY_TEXT',
          productName: 'Legacy text order item',
          quantity: 1,
        },
      },
      {
        rowId: 'system_order:default:1',
        cells: {
          ocrFileKey: 'default',
          rowNo: 2,
          erpItemCode: 'TEXT001',
          productName: 'Text order item',
          quantity: 3,
        },
      },
      {
        rowId: 'system_order:file-b:1',
        cells: {
          ocrFileKey: 'file:file-b',
          fileId: 'file-b',
          filename: 'b.pdf',
          rowNo: 1,
          erpItemCode: 'B001',
          productName: 'B order item',
          quantity: 2,
        },
      },
    ];
    snapshot.previousOutputSheets.customer_quote.rows = [];
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => snapshot),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: {
        scope: 'workbook',
        fileKey: 'default',
        reason: 'Need the text-order workbook only',
      },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(result.data.fileKey).toBe('default');
    const markdown = String(result.data.markdown);
    const tables = parseMarkdownTables(markdown);

    expect(markdown).toContain('LEGACY_TEXT');
    expect(markdown).toContain('TEXT001');
    expect(markdown).not.toContain('B001');
    expect(tables[0]?.rows).toHaveLength(2);
  });

  it('reads current OCR data as Markdown text without fixed workbook columns', async () => {
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => createOutputSheetMemorySnapshot()),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: {
        scope: 'ocr',
        reason: 'Need current OCR evidence after compact context',
      },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(result.data).toEqual(
      expect.objectContaining({
        source: 'assistant_markdown_auto_parse',
        scope: 'ocr',
        format: 'markdown',
        markdown: expect.any(String),
      }),
    );
    expect(result.data).not.toHaveProperty('workbook');
    expect(result.data).not.toHaveProperty('ocr');
    const markdown = String(result.data.markdown);
    const tables = parseMarkdownTables(markdown);

    expect(tables).toHaveLength(2);
    expect(tables[0]?.headers).toEqual(['件號', '規格', '數量', '孔數 / 件']);
    expect(tables[0]?.rows[0]).toEqual(['D3', 'PL15*500', '10', '6']);
    expect(tables[1]?.headers).toEqual(['欄位', '內容']);
    expect(tables[1]?.rows).toEqual(
      expect.arrayContaining([
        ['filename', 'PL.pdf'],
        ['page', '1'],
        ['confidence', 'high'],
      ]),
    );
  });

  it('renders PaddleOCR preflight raw results in OCR Markdown reads', async () => {
    const snapshot = createOutputSheetMemorySnapshot();
    snapshot.derivedIndex.ocrExtracts = [
      {
        kind: 'paddleocr_mcp_result',
        ocrSource: 'paddleocr_mcp',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:file-d',
        fileId: 'file-d',
        filename: 'd.pdf',
        mediaType: 'application/pdf',
        content: 'PaddleOCR raw d.pdf content page 1 and page 2',
      },
    ];
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => snapshot),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: {
        scope: 'ocr',
        reason: 'Need current OCR evidence after compact context',
      },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    const markdown = String(result.data.markdown);

    expect(markdown).toContain('### PaddleOCR raw/preflight item 1 - d.pdf');
    expect(markdown).toContain('PaddleOCR raw d.pdf content page 1 and page 2');
    expect(markdown).toContain('| ocrFileKey |file:file-d |');
    expect(markdown).toContain('| filename |d.pdf |');
  });

  it('reads official OCR Markdown and excludes raw or subagent chunk rows', async () => {
    const snapshot = createOutputSheetMemorySnapshot();
    snapshot.derivedIndex.ocrExtracts = [
      {
        kind: 'paddleocr_mcp_chunk_result',
        ocrSource: 'paddleocr_mcp',
        ocrFileKey: 'file:file-a',
        filename: 'a.pdf',
        content: 'raw a chunk must stay out',
        ocrPreprocessing: {
          sourcePdfKey: 'uploads/a.pdf',
          chunkIndex: 1,
          chunkCount: 2,
        },
      },
      {
        kind: 'ocr_preprocessing_chunk_markdown',
        ocrSource: 'ocr_preprocessing_subagent',
        ocrFileKey: 'file:file-a',
        filename: 'a.pdf',
        content: '| 品名 | 數量 |\n|---|---|\n| A | 1 |',
        ocrPreprocessing: {
          sourcePdfKey: 'uploads/a.pdf',
          chunkIndex: 1,
          chunkCount: 2,
          ocrRuleVersion: 'rules-v2',
        },
      },
      {
        kind: 'ocr_preprocessing_chunk_markdown',
        ocrSource: 'ocr_preprocessing_subagent',
        ocrFileKey: 'file:file-a',
        filename: 'a.pdf',
        content: '| 品名 | 材質 |\n|---|---|\n| B | SS400 |',
        ocrPreprocessing: {
          sourcePdfKey: 'uploads/a.pdf',
          chunkIndex: 2,
          chunkCount: 2,
          ocrRuleVersion: 'rules-v2',
        },
      },
      {
        kind: 'ocr_preprocessing_chunk_markdown',
        ocrSource: 'ocr_preprocessing_subagent',
        ocrFileKey: 'file:file-b',
        filename: 'b.pdf',
        content: '| 件號 | 長度 |\n|---|---|\n| C | 300 |',
        ocrPreprocessing: {
          sourcePdfKey: 'uploads/b.pdf',
          chunkIndex: 1,
          chunkCount: 1,
          ocrRuleVersion: 'rules-v2',
        },
      },
      {
        kind: 'ocr_official_markdown',
        ocrSource: 'paddleocr_official_markdown',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:file-a',
        filename: 'a.pdf',
        content: '<file:file-a>\n\n| 品名 | 數量 |\n|---|---|\n| OFFICIAL | 8 |',
        ocrPreprocessing: {
          sourcePdfKey: 'uploads/a.pdf',
          chunkCount: 2,
          ocrRuleVersion: 'rules-v2',
          official: true,
        },
      },
    ];
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => snapshot),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: {
        scope: 'ocr',
        reason: 'Need all OCR markdown',
      },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    const markdown = String(result.data.markdown);

    expect(result.data.ocrFileKey).toBeUndefined();
    expect(result.data.items).toEqual([
      expect.objectContaining({
        kind: 'ocr_official_markdown',
        ocrSource: 'paddleocr_official_markdown',
        ocrFileKey: 'file:file-a',
        content: expect.stringContaining('OFFICIAL'),
      }),
    ]);
    expect(markdown).toContain('<file:file-a>');
    expect(markdown).toContain('| OFFICIAL | 8 |');
    expect(markdown).not.toContain('| A | 1 |');
    expect(markdown).not.toContain('| B | SS400 |');
    expect(markdown).not.toContain('<file:file-b>');
    expect(markdown).not.toContain('| 件號 | 長度 |');
    expect(markdown).not.toContain('raw a chunk must stay out');
  });

  it('keeps later OCR file keys visible when earlier OCR text is long', async () => {
    const snapshot = createOutputSheetMemorySnapshot();
    snapshot.derivedIndex.ocrExtracts = [
      {
        kind: 'paddleocr_mcp_result',
        ocrSource: 'paddleocr_mcp',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:file-a',
        fileId: 'file-a',
        filename: 'a.jpg',
        content: `long a.jpg OCR ${'A'.repeat(5000)}`,
      },
      {
        kind: 'paddleocr_mcp_result',
        ocrSource: 'paddleocr_mcp',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:file-d',
        fileId: 'file-d',
        filename: 'd.pdf',
        content: 'target d.pdf OCR content',
      },
    ];
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => snapshot),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: {
        scope: 'ocr',
        reason: 'Need all current OCR evidence after compact context',
      },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    const markdown = String(result.data.markdown);

    expect(markdown).toContain('ocrFileKey=file:file-a');
    expect(markdown).toContain('ocrFileKey=file:file-d');
    expect(result.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: 'd.pdf',
          ocrFileKey: 'file:file-d',
          content: 'target d.pdf OCR content',
        }),
      ]),
    );
  });

  it('reads one OCR result by ocrFileKey with chunked content parts', async () => {
    const snapshot = createOutputSheetMemorySnapshot();
    const dContent = `target d.pdf OCR ${'D'.repeat(2500)}`;
    snapshot.derivedIndex.ocrExtracts = [
      {
        kind: 'paddleocr_mcp_result',
        ocrSource: 'paddleocr_mcp',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:file-a',
        fileId: 'file-a',
        filename: 'a.jpg',
        content: 'a.jpg OCR content',
      },
      {
        kind: 'paddleocr_mcp_result',
        ocrSource: 'paddleocr_mcp',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:file-d',
        fileId: 'file-d',
        filename: 'd.pdf',
        content: dContent,
      },
    ];
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => snapshot),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: {
        scope: 'ocr',
        ocrFileKey: 'file:file-d',
        reason: 'Need this file OCR evidence after compact context',
      },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    const markdown = String(result.data.markdown);
    const items = result.data.items as Array<{ contentParts?: string[]; filename?: string }>;

    expect(result.data.ocrFileKey).toBe('file:file-d');
    expect(markdown).toContain('### PaddleOCR raw/preflight item 1 - d.pdf');
    expect(markdown).toContain('ocrFileKey=file:file-d');
    expect(markdown).not.toContain('file:file-a');
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({ filename: 'd.pdf' }));
    expect(items[0]?.contentParts).toHaveLength(3);
    expect(items[0]?.contentParts?.join('')).toBe(dContent);
    expect(items[0]?.contentParts?.join('')).not.toContain('[truncated]');
  });

  it('rejects row query arguments for current Markdown-derived reads', async () => {
    const outputSheetMemoryReader = {
      readOutputSheetMemory: jest.fn(async () => createOutputSheetMemorySnapshot()),
    };

    const result = await executeSteelTool({
      client: createClient([]),
      outputSheetMemoryReader,
      toolName: 'read_markdown',
      arguments: {
        query: 'CCG075',
      },
    } as Parameters<typeof executeSteelTool>[0] & {
      outputSheetMemoryReader: typeof outputSheetMemoryReader;
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCategory: 'invalid_arguments',
      }),
    );
    if (result.ok) {
      throw new Error('read_markdown should reject row queries');
    }
    expect(outputSheetMemoryReader.readOutputSheetMemory).not.toHaveBeenCalled();
  });

  it('rejects the removed run_file_ocr executable tool path', async () => {
    const result = await executeSteelTool({
      client: createClient([]),
      providerToolCallId: 'call_ocr',
      toolName: 'run_file_ocr',
      arguments: {
        filename: 'drawing.pdf',
        output_mode: 'markdown',
      },
    });

    expect(result).toEqual({
      ok: false,
      toolName: 'run_file_ocr',
      errorCategory: 'unknown_tool',
      errorSummary: 'Unknown Steel tool: run_file_ocr',
      durationMs: expect.any(Number),
      redactionVersion: 1,
    });
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
