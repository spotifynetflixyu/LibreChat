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
      ocrExtracts: [
        {
          filename: 'PL.pdf',
          page: 1,
          markdown: '| 件號 | 規格 | 數量 | 孔數 / 件 |\n| --- | --- | ---: | ---: |\n| D3 | PL15*500 | 10 | 6 |',
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
            material: '黑鐵',
            thicknessMm: ['6'],
            keyword: 'OT板',
            limit: 5,
          },
        ],
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
      '%黑鐵%',
      '6.0',
      '%OT板%',
      5,
    ]);
    expect(client.calls[0]?.sql).toContain('FROM steel.prices');
    expect(client.calls[0]?.sql).toContain('review_state = $1');
    expect(client.calls[0]?.sql).toContain('active = true');
    expect(client.calls[0]?.sql).toContain('category = $2');
    expect(client.calls[0]?.sql).toContain('material ILIKE $3');
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

  it('does not expose internal tier ratios in price candidate output', async () => {
    const client = createClient([
      [
        createPriceRow({ id: '12' }),
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ category: '鐵板/鋼板', material: '黑鐵', keyword: 'OT板', limit: 5 }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(result.data.priceCandidates).toEqual([
      expect.objectContaining({
        tierPrices: { A: 40, B: 42, C: 45, F: 50 },
      }),
    ]);
    expect(JSON.stringify(result.data.priceCandidates)).not.toContain('tierRatios');
  });

  it('rejects customer tier props in price lookup arguments', async () => {
    const result = await executeSteelTool({
      client: createClient([]),
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ category: '鐵板/鋼板', material: '黑鐵', keyword: 'OT板', limit: 5 }],
        customerTier: 'A',
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
        queries: [{ category: '鐵板/鋼板', material: '黑鐵', keyword: 'OT板', limit: 5 }],
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
      '%黑鐵%',
      '%OT板%',
      5,
    ]);
    expect(client.calls[0]?.sql).not.toContain('customer_tier_id');
    expect(result.data.priceCandidates).toEqual([
      expect.objectContaining({
        tierPrices: { A: 40, B: 42, C: 45, F: 50 },
      }),
    ]);
  });

  it('canonicalizes hole lookup arguments instead of failing on irrelevant fields', async () => {
    const client = createClient([
      [
        createPriceRow({
          id: '13',
          erp_item_code: 'DZA1319',
          price_kind: 'hole',
          spec_key: '鐵板孔加工',
          product_name: '鐵板孔加工',
          category: '孔',
          material: '無',
          unit: '孔',
          unit_price_b: '7.0000',
        }),
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [
          {
            category: '孔',
            material: 'OT 黑鐵',
            thicknessMm: ['15'],
            keyword: '鑽孔',
            limit: 5,
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual(['reviewed', '孔', '%鐵板%', 30]);
    expect(result.data.searchQueries).toEqual([{ category: '孔', keyword: '鐵板' }]);
    expect(result.data.priceCandidates).toEqual([
      expect.objectContaining({
        priceKind: 'hole',
        category: '孔',
        productName: '鐵板孔加工',
        tierPrices: expect.objectContaining({ B: 7 }),
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
        queries: [{ category: 'H型鋼', keyword: '200*100', limit: 20 }],
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
        queries: [{ mode: 'category_discovery', keyword: '白鐵方管 75x45', limit: 5 }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorSummary);
    }

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual([
      'reviewed',
      '%白鐵方管%',
      '%75x45%',
      5,
    ]);
    expect(result.data).toEqual(
      expect.objectContaining({
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
    expect(tables[0]?.headers.slice(0, 5)).toEqual([
      '公司編號',
      '項次',
      '倉庫編號',
      '型號',
      '品名規格',
    ]);
    expect(tables[0]?.rows[0]?.slice(0, 5)).toEqual([
      '',
      '1',
      '',
      'CCG075',
      '錏輕型鋼 75x45',
    ]);
    expect(tables[2]?.headers).toEqual(['項目', '說明', '小計']);
    expect(tables[2]?.rows[0]).toEqual(['', '', '536']);
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
    expect(tables[0]?.rows[0]?.slice(0, 5)).toEqual(['', '1', '', 'B001', 'B order item']);
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
