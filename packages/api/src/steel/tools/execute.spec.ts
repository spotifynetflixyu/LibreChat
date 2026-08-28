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
  it('emits tool logs without source references', async () => {
    const logEntries: object[] = [];
    const nowValues = [1000, 1007];

    await expect(
      executeSteelTool({
        client: createClient([[]]),
        toolName: 'search_customers',
        providerToolCallId: 'call-log',
        arguments: { keywords: ['龍頂'] },
        now: () => nowValues.shift() ?? 1007,
        log: (entry) => {
          logEntries.push(entry);
        },
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(logEntries).toStrictEqual([
      {
        toolName: 'search_customers',
        providerToolCallId: 'call-log',
        status: 'success',
        durationMs: 7,
        inputSummary: 'args=keywords',
        outputSummary: 'customers=0',
        errorCategory: undefined,
        redactionVersion: 1,
      },
    ]);
    expect(logEntries[0]).not.toHaveProperty('sourceRefs');
  });

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
          { categories: ['H型鋼'], stockLengthMm: ['6000'] },
          { categories: ['H型鋼'], stockLengthMm: ['9000'] },
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
            candidates: expect.arrayContaining([
              expect.objectContaining({ id: 1000 }),
              expect.objectContaining({ id: 1010 }),
            ]),
            totalAvailable: 11,
            returnedCount: 11,
          },
          {
            queryId: 'q2',
            status: 'ok',
            candidates: expect.arrayContaining([
              expect.objectContaining({ id: 1100 }),
              expect.objectContaining({ id: 1101 }),
            ]),
            totalAvailable: 10,
            returnedCount: 10,
          },
        ],
      },
    });
    if (!result.ok) {
      throw new Error('Expected material candidate search to succeed');
    }
    const data = JSON.parse(JSON.stringify(result.data)) as {
      cuttingPrices: Array<{ candidateMatches: Array<{ queryId: string }> }>;
    };
    const q1Matches = data.cuttingPrices.flatMap((group) =>
      group.candidateMatches.filter((match) => match.queryId === 'q1'),
    );
    expect(q1Matches).toHaveLength(11);
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
      arguments: { queries: [{ categories: ['鐵板'] }] },
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
        queries: [
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
          { categories: ['鐵板'], thicknessMm: ['6'] },
          { categories: ['鐵板'], thicknessMm: ['15'] },
          { categories: ['網'], thicknessMm: ['15'] },
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
                  items: expect.arrayContaining([
                    expect.objectContaining({ erpItemCode: 'DNB2001' }),
                    expect.objectContaining({ erpItemCode: 'DNB2002' }),
                    expect.objectContaining({
                      erpItemCode: 'BKZZ-EMPTY',
                    }),
                    expect.objectContaining({
                      erpItemCode: 'BKZZ-NULL',
                    }),
                    expect.objectContaining({
                      erpItemCode: 'BKZZB',
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
      arguments: { queries: [{ categories: ['鐵板'], thicknessMm: ['6'] }] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        processingPrice: {
          queryResults: [
            {
              returnedCount: 11,
              groups: [
                {
                  processingCategory: '加工/切工',
                  items: expect.arrayContaining([
                    expect.objectContaining({
                      erpItemCode: 'GENERIC-0',
                    }),
                    expect.objectContaining({
                      erpItemCode: 'GENERIC-10',
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
      arguments: { queries: [{ categories: ['H型鋼'] }] },
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
          { categories: ['H型鋼'], stockLengthMm: ['6000'] },
          { categories: ['H型鋼'], stockLengthMm: ['9000'] },
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

  it('uses the 250-candidate cap after filtering unusable names', async () => {
    const run = async (rows: object[]) => {
      const result = await executeSteelTool({
        client: createClient([
          [{ query_index: '0', query_id: 'q1', price_candidates: rows, category_candidates: [] }],
          [],
          [],
        ]),
        toolName: 'search_price_candidates',
        arguments: { queries: [{ categories: ['H型鋼'] }] },
      });
      if (!result.ok) throw new Error(result.errorSummary);
      const data = JSON.parse(JSON.stringify(result.data)) as {
        queryResults?: Array<Record<string, unknown>>;
      };
      return data.queryResults?.[0] ?? {};
    };

    const twenty = await run(
      Array.from({ length: 20 }, (_, index) => createHMaterialRow(3000 + index, 200 + index, 100)),
    );
    const twentyOne = await run(
      Array.from({ length: 21 }, (_, index) => createHMaterialRow(4000 + index, 200 + index, 100)),
    );
    const duplicateNameRows = Array.from({ length: 21 }, (_, index) =>
      createHMaterialRow(5000 + index, 300 + index, 100),
    );
    duplicateNameRows[1]!.product_name = duplicateNameRows[0]!.product_name;
    const duplicateNames = await run(duplicateNameRows);

    expect(twenty).toMatchObject({
      totalAvailable: 20,
      returnedCount: 20,
      truncated: false,
    });
    expect(twentyOne).toMatchObject({
      totalAvailable: 21,
      returnedCount: 21,
      truncated: false,
      candidates: expect.any(Array),
    });
    expect(duplicateNames).toMatchObject({ totalAvailable: 21, returnedCount: 21, truncated: false });
  });

  it('filters missing product names before threshold and preserves ordered OR dedupe', async () => {
    const missingName = createHMaterialRow(5000, 500, 100);
    missingName.product_name = '   ';
    const cCandidate = createHMaterialRow(5002, 502, 100);
    cCandidate.category = 'C型鋼';
    const rows = [
      createHMaterialRow(5001, 501, 100),
      missingName,
      cCandidate,
    ];
    const result = await executeSteelTool({
      client: createClient([
        [
          {
            query_index: 0,
            query_id: 'q1:c1',
            price_candidates: [rows[0], rows[1]],
            category_candidates: [],
          },
          {
            query_index: 1,
            query_id: 'q1:c2',
            price_candidates: [rows[2], rows[0]],
            category_candidates: [],
          },
        ],
        [],
        [],
      ]),
      toolName: 'search_price_candidates',
      arguments: { queries: [{ categories: ['H型鋼', 'C型鋼'], materials: ['黑鐵'] }] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        queryResults: [
          {
            queryId: 'q1',
            totalAvailable: 2,
            returnedCount: 2,
            truncated: false,
            candidates: [
              expect.objectContaining({ erpItemCode: 'EHS-501-100' }),
              expect.objectContaining({ erpItemCode: 'EHS-502-100' }),
            ],
          },
        ],
      },
    });
  });

  it('executes mixed material and processing items independently in input order', async () => {
    const material = createHMaterialRow(6100, 610, 100);
    const processing = createProcessingRow({
      id: '6101',
      erp_item_code: 'CUT-6101',
      category: '加工/孔',
      subcategory: '鐵板',
      product_name: '鐵板圓孔',
      normalized_spec_text: '鐵板圓孔',
      spec_key: 'CUT-6101 鐵板圓孔',
    });
    const unnamedProcessing = createProcessingRow({
      id: '6103',
      erp_item_code: 'CUT-6103',
      category: '加工/孔',
      subcategory: '鐵板',
      product_name: ' ',
      normalized_spec_text: '鐵板圓孔',
      spec_key: 'CUT-6103 鐵板圓孔',
    });
    const result = await executeSteelTool({
      client: createClient([
        [{ query_index: 0, query_id: 'q1:c1', price_candidates: [material], category_candidates: [] }],
        [],
        [processing, unnamedProcessing],
      ]),
      toolName: 'search_price_candidates',
      arguments: {
        queries: [
          { categories: ['H型鋼'] },
          { categories: ['鐵板'], processingCategories: ['加工/孔'], keyword: '圓孔' },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        queryResults: [expect.objectContaining({ queryId: 'q1' })],
        processingPrice: {
          queryResults: [expect.objectContaining({ queryId: 'q2', totalAvailable: 1 })],
        },
        summary: expect.objectContaining({
          queryCount: 2,
          matchedQueryCount: 2,
          noMatchQueryCount: 0,
        }),
      },
    });
  });

  it('deduplicates merged candidates by price row id while retaining ERP surface rows', async () => {
    const black = createHMaterialRow(7001, 500, 100);
    black.erp_item_code = 'ERP-SAME';
    black.category = '鐵板';
    black.material = '黑鐵 / OT';
    const white = createHMaterialRow(7002, 500, 100);
    white.erp_item_code = 'ERP-SAME';
    white.category = '鐵板';
    white.material = '2B 白鐵霧面';
    const result = await executeSteelTool({
      client: createClient([
        [
          {
            query_index: 0,
            query_id: 'q1:c1',
            price_candidates: [black, black, white],
            category_candidates: [],
          },
        ],
        [],
        [],
      ]),
      toolName: 'search_price_candidates',
      arguments: { queries: [{ categories: ['鐵板'], materials: ['黑鐵', '2B'] }] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        queryResults: [
          {
            candidates: [
              expect.objectContaining({ erpItemCode: 'ERP-SAME', material: '黑鐵 / OT' }),
              expect.objectContaining({ erpItemCode: 'ERP-SAME', material: '2B 白鐵霧面' }),
            ],
            totalAvailable: 2,
            returnedCount: 2,
          },
        ],
      },
    });
  });
});
