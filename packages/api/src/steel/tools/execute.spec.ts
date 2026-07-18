import { createSteelToolRunState, executeSteelTool } from './execute';

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

function createProcessingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '101',
    erp_item_code: 'DNB2001',
    price_kind: 'cutting',
    formula_code: null,
    spec_key: 'DNB2001 6.0-10.0mm板切φ',
    product_name: '6.0-10.0mm板切φ',
    normalized_spec_text: '6.0-10.0mm板切φ',
    category: '加工/切工',
    subcategory: '鐵板',
    processing_method: null,
    processing_shape: '外形切割',
    material: '黑鐵',
    dimension_signature: null,
    unit: 'Kg',
    value_state: 'confirmed',
    unit_price_base: null,
    unit_price_a: '37.5',
    unit_price_b: '38.5',
    unit_price_c: '36.5',
    unit_price_d: null,
    unit_price_e: null,
    unit_price_f: '36.5',
    price_ratio_a: null,
    price_ratio_b: null,
    price_ratio_c: null,
    price_ratio_d: null,
    price_ratio_e: null,
    price_ratio_f: null,
    unit_weight_value: null,
    unit_weight_basis: null,
    density: null,
    source_thickness: '6-10',
    thickness_min_mm: '6',
    thickness_max_mm: '10',
    width_mm: null,
    height_mm: null,
    length_mm: null,
    outer_diameter_mm: null,
    nominal_inch: null,
    web_mm: null,
    flange_mm: null,
    lip_mm: null,
    sheet_width_mm: null,
    sheet_length_mm: null,
    spec_sort_key: '006-010',
    cost_basis: 'Kg',
    currency: 'TWD',
    active: true,
    source_refs: [],
    ...overrides,
  };
}

function createHMaterialRow(id: number, heightMm: number, widthMm: number) {
  return createProcessingRow({
    id: String(id),
    erp_item_code: `EHS-${heightMm}-${widthMm}`,
    price_kind: 'product',
    spec_key: `H型鋼 ${heightMm}x${widthMm}`,
    product_name: `H型鋼${heightMm}*${widthMm}`,
    normalized_spec_text: `H型鋼${heightMm}x${widthMm}`,
    category: 'H型鋼',
    subcategory: null,
    processing_shape: null,
    material: '黑鐵',
    unit: 'Kg',
    thickness_min_mm: '9',
    thickness_max_mm: '9',
    width_mm: String(widthMm),
    height_mm: String(heightMm),
    length_mm: '10000',
    source_thickness: '9',
    spec_sort_key: `${heightMm}-${widthMm}`,
  });
}

function createHCuttingRow(id: number, heightMm: number, widthMm: number) {
  return {
    lookup_cutting_category: 'H型鋼',
    id: String(id),
    cutting_category: 'H型鋼',
    item_name: `${heightMm}x${widthMm}`,
    cut_type: '加工/切工',
    spec_text: `${heightMm}x${widthMm}`,
    inch_min: null,
    inch_max: null,
    mm_min: null,
    mm_max: null,
    height_mm: String(heightMm),
    width_mm: String(widthMm),
    thickness_mm_values: null,
    thickness_mm_min: null,
    thickness_mm_max: null,
    unit: '刀',
    unit_price_a: '120',
    unit_price_b: '125',
    unit_price_c: '120',
    unit_price_f: '120',
    notes: null,
  };
}

describe('executeSteelTool', () => {
  it('does not execute removed read_markdown calls', async () => {
    const result = await executeSteelTool({
      client: createClient([]),
      toolName: 'read_markdown',
      arguments: { scope: 'ocr' },
    });

    expect(result).toMatchObject({
      ok: false,
      toolName: 'read_markdown',
      errorCategory: 'unknown_tool',
    });
  });

  it('searches customers with the normalized repository contract', async () => {
    const client = createClient([
      [
        {
          id: '21',
          erp_customer_code: 'A001',
          display_name: '大成鋼',
          legal_name: '大成鋼鐵股份有限公司',
          tax_id: '12345678',
          customer_tier: 'A',
          status: 'active',
          source_refs: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_customers',
      arguments: { keywords: ['大成'], limit: 10 },
    });

    expect(result).toMatchObject({ ok: true, data: { customers: [expect.any(Object)] } });
    expect(client.calls).toHaveLength(1);
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
    expect(secondResult).toMatchObject({ ok: false, errorCategory: 'rate_limited' });
    expect(client.calls).toHaveLength(1);
  });

  it('shapes material candidates independently per query and preserves full cutting matches', async () => {
    const manyCandidates = Array.from({ length: 11 }, (_, index) =>
      createHMaterialRow(1000 + index, 200 + index, 100),
    );
    const fewCandidates = Array.from({ length: 10 }, (_, index) =>
      createHMaterialRow(1100 + index, 400 + index, 100),
    );
    const cuttingRows = [
      ...manyCandidates.map((_, index) => createHCuttingRow(1200 + index, 200 + index, 100)),
      ...fewCandidates.map((_, index) => createHCuttingRow(1300 + index, 400 + index, 100)),
    ];
    const client = createClient([
      [
        {
          query_index: '0',
          query_id: 'q1',
          price_candidates: manyCandidates,
          category_candidates: [],
        },
        {
          query_index: '1',
          query_id: 'q2',
          price_candidates: fewCandidates,
          category_candidates: [],
        },
      ],
      cuttingRows,
      [],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [
          { category: 'H型鋼', keyword: '200' },
          { category: 'H型鋼', keyword: '400' },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        queryResults: [
          {
            queryId: 'q1',
            status: 'ok',
            candidates: [],
            productNames: manyCandidates.map(({ product_name }) => product_name),
            totalAvailable: 11,
            returnedCount: 0,
            selectionRequired: true,
          },
          {
            queryId: 'q2',
            status: 'ok',
            candidates: expect.arrayContaining([
              expect.objectContaining({ id: 1100 }),
              expect.objectContaining({ id: 1101 }),
            ]),
            productNames: [],
            totalAvailable: 10,
            returnedCount: 10,
            selectionRequired: false,
          },
        ],
      },
    });
    if (!result.ok) {
      throw new Error('Expected material candidate search to succeed');
    }
    const data = JSON.parse(JSON.stringify(result.data));
    const q1Matches = data.cuttingPrices.flatMap((group) =>
      group.candidateMatches.filter((match) => match.queryId === 'q1'),
    );
    expect(q1Matches).toHaveLength(11);
  });

  it('requeries a selected material productName after a names-only result', async () => {
    const candidates = Array.from({ length: 11 }, (_, index) =>
      createHMaterialRow(1400 + index, 500 + index, 200),
    );
    const selected = candidates[7];
    const client = createClient([
      [
        {
          query_index: '0',
          query_id: 'q1',
          price_candidates: candidates,
          category_candidates: [],
        },
      ],
      [],
      [],
      selected ? [selected] : [],
    ]);

    const discovery = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: { queries: [{ category: 'H型鋼' }] },
    });
    const exact = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: { productNames: selected ? [selected.product_name] : [] },
    });

    expect(discovery).toMatchObject({
      ok: true,
      data: {
        queryResults: [
          {
            candidates: [],
            productNames: candidates.map(({ product_name }) => product_name),
            selectionRequired: true,
          },
        ],
      },
    });
    expect(exact).toMatchObject({
      ok: true,
      data: {
        productNamePrices: [expect.objectContaining({ id: Number(selected?.id) })],
        summary: { requestedProductNameCount: 1, priceCount: 1 },
      },
    });
  });

  it('uses an E-only price as a runtime fallback and requires manual confirmation', async () => {
    const client = createClient([
      [
        createProcessingRow({
          erp_item_code: 'A10E12',
          product_name: '牙白100型1.2',
          spec_key: 'A10E12 牙白100型1.2',
          unit_price_base: null,
          unit_price_a: null,
          unit_price_b: null,
          unit_price_c: null,
          unit_price_d: null,
          unit_price_e: '48',
          unit_price_f: null,
        }),
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: { productNames: ['牙白100型1.2'] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        productNamePrices: [
          {
            erpItemCode: 'A10E12',
            pricingOptions: [
              {
                source: 'tier_price',
                tierPrices: { A: 48, B: 48, C: 48, D: 48, E: 48, F: 48 },
                defaultQuoteTier: 'E',
                defaultQuoteUnitPrice: 48,
                fallbackTiers: ['A', 'B', 'C', 'D', 'F'],
                manualReviewRequired: true,
                manualReviewNotes: [expect.stringMatching(/補充.*人工確認/u)],
              },
            ],
          },
        ],
      },
    });
  });

  it('uses B-A-C-F-D-E before base when resolving missing tiers', async () => {
    const client = createClient([
      [
        createProcessingRow({
          id: '201',
          erp_item_code: 'BASE-ONLY',
          product_name: 'base only',
          spec_key: 'BASE-ONLY base only',
          unit_price_base: '35',
          unit_price_a: null,
          unit_price_b: null,
          unit_price_c: null,
          unit_price_d: null,
          unit_price_e: null,
          unit_price_f: null,
        }),
        createProcessingRow({
          id: '202',
          erp_item_code: 'MIXED',
          product_name: 'mixed tiers',
          spec_key: 'MIXED mixed tiers',
          unit_price_base: null,
          unit_price_a: '41',
          unit_price_b: null,
          unit_price_c: '39',
          unit_price_d: null,
          unit_price_e: null,
          unit_price_f: null,
        }),
        createProcessingRow({
          id: '203',
          erp_item_code: 'B-FIRST',
          product_name: 'B first',
          spec_key: 'B-FIRST B first',
          unit_price_base: '35',
          unit_price_a: '41',
          unit_price_b: '42',
          unit_price_c: null,
          unit_price_d: null,
          unit_price_e: null,
          unit_price_f: null,
        }),
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: { productNames: ['base only', 'mixed tiers', 'B first'] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        productNamePrices: [
          {
            erpItemCode: 'BASE-ONLY',
            pricingOptions: [
              {
                tierPrices: { A: 35, B: 35, C: 35, D: 35, E: 35, F: 35 },
                defaultQuoteTier: 'B',
                defaultQuoteUnitPrice: 35,
              },
            ],
          },
          {
            erpItemCode: 'MIXED',
            pricingOptions: [
              {
                tierPrices: { A: 41, B: 41, C: 39, D: 41, E: 41, F: 41 },
                defaultQuoteTier: 'A',
                defaultQuoteUnitPrice: 41,
              },
            ],
          },
          {
            erpItemCode: 'B-FIRST',
            pricingOptions: [
              {
                tierPrices: { A: 41, B: 42, C: 42, D: 42, E: 42, F: 42 },
                defaultQuoteTier: 'B',
                defaultQuoteUnitPrice: 42,
              },
            ],
          },
        ],
      },
    });
  });

  it('keeps D and E ratios available without mixing them into price fallback', async () => {
    const client = createClient([
      [
        createProcessingRow({
          erp_item_code: 'RATIO-DE',
          product_name: 'ratio D E',
          spec_key: 'RATIO-DE ratio D E',
          value_state: 'ratio_only',
          unit_price_base: null,
          unit_price_a: null,
          unit_price_b: null,
          unit_price_c: null,
          unit_price_d: null,
          unit_price_e: null,
          unit_price_f: null,
          price_ratio_a: null,
          price_ratio_b: null,
          price_ratio_c: null,
          price_ratio_d: '1.2',
          price_ratio_e: '1.15',
          price_ratio_f: null,
        }),
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: { productNames: ['ratio D E'] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        productNamePrices: [
          {
            pricingOptions: [
              {
                source: 'tier_price',
                tierPrices: { A: null, B: null, C: null, D: 1.2, E: 1.15, F: null },
              },
            ],
          },
        ],
      },
    });
  });

  it('preserves plate ranking when normalized search text only exists in prefixed specKey', async () => {
    const generic = createProcessingRow({
      id: '301',
      erp_item_code: 'PLATE-GENERIC',
      product_name: '鐵板加工甲',
      spec_key: 'PLATE-GENERIC 鐵板加工甲',
      category: '鐵板',
    });
    const shaped = createProcessingRow({
      id: '302',
      erp_item_code: 'PLATE-SHAPED',
      product_name: '鐵板加工乙',
      spec_key: 'PLATE-SHAPED 版型切割',
      category: '鐵板',
    });
    const square = createProcessingRow({
      id: '303',
      erp_item_code: 'PLATE-SQUARE',
      product_name: '鐵板加工丙',
      spec_key: 'PLATE-SQUARE 四方切',
      category: '鐵板',
    });
    const laser = createProcessingRow({
      id: '304',
      erp_item_code: 'PLATE-LASER',
      product_name: '鐵板加工丁',
      spec_key: 'PLATE-LASER 雷射切割',
      category: '鐵板',
    });
    const client = createClient([
      [
        {
          query_index: '0',
          query_id: 'q1',
          price_candidates: [generic, shaped, square, laser],
          category_candidates: [],
        },
      ],
      [],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: { queries: [{ category: '鐵板' }] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        queryResults: [
          {
            candidates: [
              { erpItemCode: 'PLATE-LASER' },
              { erpItemCode: 'PLATE-SQUARE' },
              { erpItemCode: 'PLATE-SHAPED' },
              { erpItemCode: 'PLATE-GENERIC' },
            ],
          },
        ],
      },
    });
  });

  it('returns more than ten explicit processing candidates without names-only compression', async () => {
    const candidates = Array.from({ length: 11 }, (_, index) =>
      createProcessingRow({
        id: String(1500 + index),
        erp_item_code: `HOLE-${index}`,
        category: '加工/孔',
        subcategory: '鐵板',
        product_name: `鐵板圓孔 ${index}`,
        normalized_spec_text: `鐵板圓孔 ${index}`,
        spec_key: `HOLE-${index} 鐵板圓孔`,
      }),
    );
    const client = createClient([candidates]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        processingQueries: [
          { categories: ['鐵板'], processingCategories: ['加工/孔'], keyword: '圓孔' },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        processingPrice: {
          queryResults: [
            {
              totalAvailable: 11,
              returnedCount: 11,
              selectionRequired: false,
              productNames: [],
              groups: [
                {
                  processingCategory: '加工/孔',
                  items: expect.arrayContaining([
                    expect.objectContaining({ erpItemCode: 'HOLE-0' }),
                    expect.objectContaining({ erpItemCode: 'HOLE-10' }),
                  ]),
                },
              ],
            },
          ],
        },
      },
    });
  });

  it('matches prices cutting candidates to each material thickness query independently', async () => {
    const client = createClient([
      [],
      [
        createProcessingRow({
          id: '105',
          erp_item_code: 'BKZZ-EMPTY',
          spec_key: 'BKZZ-EMPTY 切工',
          product_name: '空白分類切工',
          normalized_spec_text: '空白分類切工',
          subcategory: '',
          source_thickness: null,
          thickness_min_mm: null,
          thickness_max_mm: null,
          spec_sort_key: null,
        }),
        createProcessingRow({
          id: '106',
          erp_item_code: 'BKZZ-NULL',
          spec_key: 'BKZZ-NULL 切工',
          product_name: '未分類切工',
          normalized_spec_text: '未分類切工',
          subcategory: null,
          source_thickness: null,
          thickness_min_mm: null,
          thickness_max_mm: null,
          spec_sort_key: null,
        }),
        createProcessingRow(),
        createProcessingRow({
          id: '102',
          erp_item_code: 'DNB2002',
          spec_key: 'DNB2002 12.0-30.0mm板切φ',
          product_name: '12.0-30.0mm板切φ',
          normalized_spec_text: '12.0-30.0mm板切φ',
          source_thickness: '12-30',
          thickness_min_mm: '12',
          thickness_max_mm: '30',
          spec_sort_key: '012-030',
        }),
        createProcessingRow({
          id: '104',
          erp_item_code: 'DNB2003',
          spec_key: 'DNB2003 32.0-50.0mm板切φ',
          product_name: '32.0-50.0mm板切φ',
          normalized_spec_text: '32.0-50.0mm板切φ',
          source_thickness: '32-50',
          thickness_min_mm: '32',
          thickness_max_mm: '50',
          spec_sort_key: '032-050',
        }),
        createProcessingRow({
          id: '103',
          erp_item_code: 'BKZZB',
          spec_key: 'BKZZB 切工',
          product_name: '切工',
          normalized_spec_text: '切工',
          subcategory: '通用',
          unit: '片',
          value_state: 'ratio_only',
          unit_price_a: null,
          unit_price_b: null,
          unit_price_c: null,
          unit_price_f: null,
          price_ratio_a: '100',
          price_ratio_b: '100',
          price_ratio_c: '100',
          price_ratio_f: '80',
          source_thickness: null,
          thickness_min_mm: null,
          thickness_max_mm: null,
          spec_sort_key: null,
        }),
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [
          { category: '鐵板', thicknessMm: ['6'] },
          { category: '鐵板', thicknessMm: ['15'] },
          { category: '網', thicknessMm: ['15'] },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        processingPrice: {
          queryResults: [
            {
              processingCategories: ['加工/切工'],
              targetSpecs: [
                { queryId: 'q1', category: '鐵板', thicknessMm: ['6'] },
                { queryId: 'q2', category: '鐵板', thicknessMm: ['15'] },
                { queryId: 'q3', category: '網', thicknessMm: ['15'] },
              ],
              groups: [
                {
                  processingCategory: '加工/切工',
                  items: [
                    expect.objectContaining({ erpItemCode: 'DNB2001', matchedQueryIds: ['q1'] }),
                    expect.objectContaining({ erpItemCode: 'DNB2002', matchedQueryIds: ['q2'] }),
                    expect.objectContaining({
                      erpItemCode: 'BKZZ-EMPTY',
                      matchedQueryIds: ['q1', 'q2', 'q3'],
                    }),
                    expect.objectContaining({
                      erpItemCode: 'BKZZ-NULL',
                      matchedQueryIds: ['q1', 'q2', 'q3'],
                    }),
                    expect.objectContaining({
                      erpItemCode: 'BKZZB',
                      matchedQueryIds: ['q1', 'q2', 'q3'],
                    }),
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    expect(client.calls).toHaveLength(2);
    expect(client.calls.some(({ sql }) => sql.includes('steel.cutting_prices'))).toBe(false);
    expect(client.calls[1]?.values?.[0]).toEqual(['加工/切工']);
  });

  it('keeps query correlation when more than ten automatic cutting candidates match', async () => {
    const candidates = Array.from({ length: 11 }, (_, index) =>
      createProcessingRow({
        id: String(200 + index),
        erp_item_code: `GENERIC-${index}`,
        spec_key: `GENERIC-${index} 切工`,
        product_name: `通用切工 ${index}`,
        normalized_spec_text: `通用切工 ${index}`,
        subcategory: '通用',
        source_thickness: null,
        thickness_min_mm: null,
        thickness_max_mm: null,
        spec_sort_key: null,
      }),
    );
    const client = createClient([[], candidates]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: { queries: [{ category: '鐵板', thicknessMm: ['6'] }] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        processingPrice: {
          queryResults: [
            {
              selectionRequired: false,
              returnedCount: 11,
              groups: [
                {
                  processingCategory: '加工/切工',
                  items: expect.arrayContaining([
                    expect.objectContaining({
                      erpItemCode: 'GENERIC-0',
                      matchedQueryIds: ['q1'],
                    }),
                    expect.objectContaining({
                      erpItemCode: 'GENERIC-10',
                      matchedQueryIds: ['q1'],
                    }),
                  ]),
                },
              ],
            },
          ],
        },
      },
    });
    expect(client.calls).toHaveLength(2);
    expect(client.calls.some(({ sql }) => sql.includes('steel.cutting_prices'))).toBe(false);
    expect(client.calls[1]?.values?.[0]).toEqual(['加工/切工']);
  });

  it('returns the H cutting adjustment only as an AI-visible manual-confirmation note', async () => {
    const hCandidate = createProcessingRow({
      id: '501',
      erp_item_code: 'EHS252510',
      price_kind: 'product',
      spec_key: 'EHS252510 H型鋼250x250x9/14x10M',
      product_name: 'H型鋼250*250*9/14*10M',
      normalized_spec_text: 'H型鋼250x250x9/14x10M',
      category: 'H型鋼',
      subcategory: null,
      processing_shape: null,
      material: '黑鐵',
      unit: 'Kg',
      thickness_min_mm: '9',
      thickness_max_mm: '9',
      width_mm: '250',
      height_mm: '250',
      length_mm: '10000',
      source_thickness: '9',
      spec_sort_key: '250-250-009-014',
    });
    const client = createClient([
      [
        {
          query_index: '0',
          query_id: 'q1',
          price_candidates: [hCandidate],
          category_candidates: [],
        },
      ],
      [
        {
          lookup_cutting_category: '工字鐵/H型鋼',
          id: '601',
          cutting_category: '工字鐵/H型鋼',
          item_name: '250x250',
          cut_type: '加工/切工',
          spec_text: '250x250',
          inch_min: null,
          inch_max: null,
          mm_min: null,
          mm_max: null,
          height_mm: '250',
          width_mm: '250',
          thickness_mm_values: null,
          thickness_mm_min: null,
          thickness_mm_max: null,
          unit: '刀',
          unit_price_a: '120',
          unit_price_b: '125',
          unit_price_c: '120',
          unit_price_f: '120',
          notes: 'H型鋼 另+30~50',
        },
      ],
      [],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: { queries: [{ category: 'H型鋼' }] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        cuttingPrices: [
          {
            cuttingCategory: '工字鐵/H型鋼',
            manualReviewRequired: true,
            manualReviewNotes: [expect.stringMatching(/另\+30~50.*人工確認/u)],
            prices: [
              expect.objectContaining({
                tierPrices: { A: 120, B: 125, C: 120, F: 120 },
              }),
            ],
            candidateMatches: [
              expect.objectContaining({
                queryId: 'q1',
                priceCandidateId: 501,
                cuttingPriceIds: [601],
              }),
            ],
          },
        ],
      },
    });
    if (!result.ok) {
      throw new Error('Expected cutting price search to succeed');
    }
    const data = result.data as {
      cuttingPrices?: Array<{ prices?: Array<Record<string, unknown>> }>;
    };
    const price = data.cuttingPrices?.[0]?.prices?.[0];
    expect(price).toMatchObject({
      id: 601,
      cuttingCategory: '工字鐵/H型鋼',
      itemName: '250x250',
      heightMm: 250,
      widthMm: 250,
      tierPrices: { A: 120, B: 125, C: 120, F: 120 },
      notes: 'H型鋼 另+30~50',
    });
    for (const internalKey of [
      'recordType',
      'record_type',
      'conditions',
      'calculationRule',
      'calculation_rule',
      'sourceSheet',
      'source_sheet',
      'sourceRow',
      'source_row',
      'specSelector',
      'spec_selector',
      'thicknessAxis',
      'thickness_axis',
      'normalizedSpecText',
      'normalized_spec_text',
      'tierBSource',
    ]) {
      expect(price).not.toHaveProperty(internalKey);
    }
  });

  it('keeps cutting candidates isolated for repeated queries in the same category', async () => {
    const h250 = createHMaterialRow(701, 250, 250);
    const h340 = createHMaterialRow(702, 340, 250);
    const client = createClient([
      [
        { query_index: '0', query_id: 'q1', price_candidates: [h250], category_candidates: [] },
        { query_index: '1', query_id: 'q2', price_candidates: [h340], category_candidates: [] },
      ],
      [createHCuttingRow(801, 250, 250), createHCuttingRow(802, 340, 250)],
      [],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [
          { category: 'H型鋼', keyword: '250x250' },
          { category: 'H型鋼', keyword: '340x250' },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        cuttingPrices: [
          {
            candidateMatches: [
              expect.objectContaining({
                queryId: 'q1',
                priceCandidateId: 701,
                cuttingPriceIds: [801],
              }),
              expect.objectContaining({
                queryId: 'q2',
                priceCandidateId: 702,
                cuttingPriceIds: [802],
              }),
            ],
          },
        ],
      },
    });
  });
});
