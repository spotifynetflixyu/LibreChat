import { createSteelNativeTool } from './tools';

describe('native direct candidate compaction', () => {
  it('keeps flat fields and trims whole serialized response under 200k', async () => {
    const candidate = (index: number) => ({
      erpItemCode: `ERP-${index}`,
      productName: 'long product '.repeat(20),
      category: '鐵板',
      material: '黑鐵',
      unit: 'Kg',
      formulaCode: 'F1',
      unitWeightValue: 1,
      unitWeightBasis: 'Kg/M',
      density: 7.85,
      quoteEligible: true,
      priceSource: 'tier_price',
      quoteUnit: 'Kg',
      tierPrices: { A: 10, B: 10, C: null, D: null, E: null, F: null },
      pricingOptions: [{ source: 'legacy' }],
      skippedPricingOptions: [{ source: 'legacy' }],
    });
    const execute = async () => ({
      ok: true as const,
      toolName: 'search_price_candidates' as const,
      data: {
        queryResults: [
          { queryId: 'q1', status: 'ok', totalAvailable: 250, returnedCount: 250, candidates: Array.from({ length: 250 }, (_, index) => candidate(index)), categoryCandidates: Array.from({ length: 200 }, (_, index) => ({ category: '鐵板', material: '黑鐵', candidateCount: index, exampleProductName: 'category '.repeat(40) })) },
          { queryId: 'q2', status: 'ok', totalAvailable: 250, returnedCount: 250, candidates: Array.from({ length: 250 }, (_, index) => candidate(index + 250)), categoryCandidates: [] },
        ],
        cuttingPrices: [],
        processingPrice: {
          queryResults: [{
            queryId: 'p1',
            totalAvailable: 0,
            returnedCount: 0,
            truncated: false,
            defaultMaterial: '黑鐵',
            availableMaterials: ['黑鐵'],
            availableWhiteSteelSurfaces: [],
            groups: [],
          }],
        },
      },
      durationMs: 0,
      redactionVersion: 1 as const,
    });
    const tool = createSteelNativeTool({
      execute,
      nativeToolName: 'search_price_candidates',
      steelToolName: 'search_price_candidates',
    });
    const result = await tool.invoke({});
    expect(result.content.length).toBeLessThanOrEqual(200_000);
    const payload = JSON.parse(result.content) as { data: Record<string, unknown> };
    expect(JSON.stringify(payload.data).length).toBeLessThanOrEqual(199_500);
    expect(payload.data.responseTruncated).toBe(true);
    const queryResults = payload.data.queryResults as Array<{
      queryId: string;
      candidates: Array<{ erpItemCode: string }>;
    }>;
    expect(queryResults.map((query) => query.queryId)).toEqual(['q1', 'q2']);
    expect(queryResults.every((query) => query.candidates.length > 0)).toBe(true);
    expect(queryResults[0].candidates[0].erpItemCode).toBe('ERP-0');
    expect(queryResults[1].candidates[0].erpItemCode).toBe('ERP-250');
    expect((payload.data.processingPrice as { queryResults: Array<Record<string, unknown>> }).queryResults[0]).toEqual(
      expect.objectContaining({ defaultMaterial: '黑鐵' }),
    );
    expect(result.content).not.toContain('pricingOptions');
    expect(result.content).not.toContain('skippedPricingOptions');
    expect(result.content).not.toContain('selectionRequired');
  });

  it('keeps 211 H and 115 tube candidates with cutting and processing fields under 200k', async () => {
    const candidate = (index: number, category: 'H型鋼' | '方管') => {
      const widthMm = category === 'H型鋼' ? 250 + (index % 20) : 100 + (index % 12);
      const heightMm = category === 'H型鋼' ? 250 + (index % 20) : 50 + (index % 8);
      const thicknessMm = category === 'H型鋼' ? 9 : 4;
      return {
        erpItemCode: `${category === 'H型鋼' ? 'EHS' : 'TUBE'}-${index}`,
        productName: category === 'H型鋼'
          ? `${category}${heightMm}*${widthMm}*9/14*10M`
          : `${category}${heightMm}*${widthMm}*4T*6M`,
        category,
        subcategory: category === 'H型鋼' ? null : '方管',
        processingMethod: null,
        processingShape: null,
        material: '黑鐵',
        unit: 'Kg',
        formulaCode: category === 'H型鋼' ? 'H-WEIGHT' : 'TUBE-WEIGHT',
        unitWeightValue: category === 'H型鋼' ? 29.2 : 8.4,
        unitWeightBasis: 'Kg/M',
        density: 7.85,
        thicknessMinMm: thicknessMm,
        thicknessMaxMm: category === 'H型鋼' ? 14 : thicknessMm,
        widthMm,
        heightMm,
        lengthMm: category === 'H型鋼' ? 10000 : 6000,
        outerDiameterMm: null,
        nominalInch: null,
        webMm: category === 'H型鋼' ? 9 : null,
        flangeMm: category === 'H型鋼' ? 14 : null,
        lipMm: null,
        sheetWidthMm: null,
        sheetLengthMm: null,
        quoteEligible: true,
        priceSource: 'tier_price',
        quoteUnit: 'Kg',
        tierPrices: { A: 32, B: 33, C: 31, D: 30, E: 29, F: 30 },
        pricingOptions: [{ source: 'legacy', row: index }],
      };
    };
    const materialCandidates = Array.from({ length: 211 }, (_, index) =>
      candidate(index, 'H型鋼'),
    );
    const tubeCandidates = Array.from({ length: 115 }, (_, index) =>
      candidate(index, '方管'),
    );
    const cuttingPrices = Array.from({ length: 4 }, (_, index) => ({
      cuttingCategory: index < 2 ? 'H型鋼' : '方管',
      itemName: `${index < 2 ? 'H型鋼' : '方管'} ${200 + index * 10}x${100 + index * 5}`,
      cutType: '加工/切工',
      specText: `外形切割 ${200 + index * 10}x${100 + index * 5}`,
      inchMin: null,
      inchMax: null,
      mmMin: null,
      mmMax: null,
      heightMm: 200 + index * 10,
      widthMm: 100 + index * 5,
      thicknessMmValues: [9, 12, 14],
      thicknessMmMin: 9,
      thicknessMmMax: 14,
      unit: '刀',
      tierPrices: { A: 120, B: 125, C: 120, D: 115, E: 110, F: 120 },
      notes: '人工確認',
    }));
    const processingCandidates = Array.from({ length: 3 }, (_, index) => ({
      ...candidate(index, '方管'),
      erpItemCode: `PROCESS-${index}`,
      productName: `方管圓孔 ${index}`,
      category: '加工/孔',
      processingMethod: '鑽孔',
      processingShape: '圓孔',
      unit: '孔',
    }));
    const rawResult = {
      ok: true as const,
      toolName: 'search_price_candidates' as const,
      data: {
        queryResults: [
          {
            queryId: 'h-material',
            status: 'ok',
            totalAvailable: 211,
            returnedCount: 211,
            truncated: false,
            candidates: materialCandidates,
            categoryCandidates: [],
          },
          {
            queryId: 'tube-material',
            status: 'ok',
            totalAvailable: 115,
            returnedCount: 115,
            truncated: false,
            candidates: tubeCandidates,
            categoryCandidates: [],
          },
        ],
        cuttingPrices: [{
          cuttingCategory: 'H型鋼',
          sourceCategories: ['H型鋼', '方管'],
          prices: cuttingPrices,
        }],
        processingPrice: {
          queryResults: [{
            queryId: 'p1',
            totalAvailable: 3,
            returnedCount: 3,
            truncated: false,
            defaultMaterial: '黑鐵',
            availableMaterials: ['黑鐵'],
            availableWhiteSteelSurfaces: [],
            groups: [{
              processingCategory: '加工/孔',
              totalAvailable: 3,
              returnedCount: 3,
              truncated: false,
              items: processingCandidates,
            }],
          }],
        },
      },
      durationMs: 0,
      redactionVersion: 1 as const,
    };
    const execute = async () => rawResult;
    const tool = createSteelNativeTool({
      execute,
      nativeToolName: 'search_price_candidates',
      steelToolName: 'search_price_candidates',
    });

    const result = await tool.invoke({});
    expect(result.content.length).toBeGreaterThan(80_000);
    expect(result.content.length).toBeLessThanOrEqual(200_000);
    const payload = JSON.parse(result.content) as {
      data: {
        queryResults: Array<{
          queryId: string;
          totalAvailable: number;
          returnedCount: number;
          truncated: boolean;
          candidates: Array<Record<string, unknown>>;
        }>;
        cuttingPrices: Array<{ prices: Array<Record<string, unknown>> }>;
        processingPrice: {
          queryResults: Array<{
            returnedCount: number;
            truncated: boolean;
            groups: Array<{ items: Array<Record<string, unknown>> }>;
          }>;
        };
        responseTruncated?: boolean;
      };
    };
    expect(payload.data.responseTruncated).toBeUndefined();
    expect(JSON.stringify(payload.data).length).toBeLessThanOrEqual(199_500);
    const queryResults = payload.data.queryResults;
    expect(queryResults.map((query) => [query.queryId, query.candidates.length])).toEqual([
      ['h-material', 211],
      ['tube-material', 115],
    ]);
    expect(queryResults.every((query) =>
      query.totalAvailable === query.returnedCount && query.truncated === false,
    )).toBe(true);
    expect(queryResults[0]?.candidates[0]).toEqual(expect.objectContaining({
      erpItemCode: 'EHS-0',
      productName: expect.stringContaining('H型鋼'),
      category: 'H型鋼',
      material: '黑鐵',
      unit: 'Kg',
      formulaCode: 'H-WEIGHT',
      unitWeightValue: 29.2,
      unitWeightBasis: 'Kg/M',
      density: 7.85,
      widthMm: 250,
      heightMm: 250,
      lengthMm: 10000,
      webMm: 9,
      flangeMm: 14,
      quoteEligible: true,
      priceSource: 'tier_price',
      quoteUnit: 'Kg',
      tierPrices: { A: 32, B: 33, C: 31, D: 30, E: 29, F: 30 },
    }));
    expect(queryResults[1]?.candidates[114]).toEqual(expect.objectContaining({
      erpItemCode: 'TUBE-114',
      category: '方管',
      material: '黑鐵',
      widthMm: 106,
      heightMm: 52,
      lengthMm: 6000,
      thicknessMinMm: 4,
      thicknessMaxMm: 4,
      quoteEligible: true,
      tierPrices: { A: 32, B: 33, C: 31, D: 30, E: 29, F: 30 },
    }));
    expect(payload.data.cuttingPrices[0]?.prices).toHaveLength(4);
    expect(payload.data.cuttingPrices[0]?.prices[0]).toEqual(expect.objectContaining({
      cuttingCategory: 'H型鋼',
      itemName: 'H型鋼 200x100',
      cutType: '加工/切工',
      specText: '外形切割 200x100',
      heightMm: 200,
      widthMm: 100,
      thicknessMmValues: [9, 12, 14],
      unit: '刀',
      tierPrices: { A: 120, B: 125, C: 120, D: 115, E: 110, F: 120 },
    }));
    const processingQuery = payload.data.processingPrice.queryResults[0];
    expect(processingQuery).toMatchObject({ returnedCount: 3, truncated: false });
    expect(processingQuery?.groups[0]?.items).toHaveLength(3);
    expect(processingQuery?.groups[0]?.items[0]).toEqual(expect.objectContaining({
      erpItemCode: 'PROCESS-0',
      category: '加工/孔',
      processingMethod: '鑽孔',
      processingShape: '圓孔',
      unit: '孔',
      quoteEligible: true,
      tierPrices: { A: 32, B: 33, C: 31, D: 30, E: 29, F: 30 },
    }));
    expect(result.artifact?.result).toBe(rawResult);
  });

  it('returns a bounded repository error when essential material fields remain too large', async () => {
    const oversizedErpItemCode = `ERP-${'x'.repeat(250_000)}`;
    const rawResult = {
      ok: true as const,
      toolName: 'search_price_candidates' as const,
      data: {
        queryResults: [
          {
            queryId: 'oversized',
            totalAvailable: 1,
            returnedCount: 1,
            candidates: [
              {
                erpItemCode: oversizedErpItemCode,
                productName: 'oversized product',
                category: '鐵板',
                material: '黑鐵',
                tierPrices: { A: 10 },
              },
            ],
          },
        ],
        cuttingPrices: [],
      },
      durationMs: 0,
      redactionVersion: 1 as const,
    };
    const execute = async () => rawResult;
    const tool = createSteelNativeTool({
      execute,
      nativeToolName: 'search_price_candidates',
      steelToolName: 'search_price_candidates',
    });

    const result = await tool.invoke({});
    const payload = JSON.parse(result.content) as {
      ok: false;
      errorCategory: string;
      errorSummary: string;
    };
    expect(payload).toEqual({
      ok: false,
      toolName: 'search_price_candidates',
      errorCategory: 'repository_error',
      errorSummary: 'price_candidate_response_too_large',
      durationMs: 0,
      redactionVersion: 1,
    });
    expect(result.content.length).toBeLessThan(500);
    expect(result.artifact?.result).toBe(rawResult);
    expect(rawResult.data.queryResults[0]?.candidates[0]?.erpItemCode).toBe(oversizedErpItemCode);
    expect(rawResult.data.queryResults[0]?.candidates[0]?.erpItemCode).toHaveLength(250_004);
  });

  it('preserves structured split and unsupported-category guidance', async () => {
    const execute = async () => ({
      ok: true as const,
      toolName: 'search_price_candidates' as const,
      data: {
        queryResults: [
          {
            queryId: 'mixed-defaults',
            status: 'split_required_mixed_defaults',
            defaultMaterial: '錏',
            defaultMaterialGroups: [
              { defaultMaterial: '錏', categories: ['C型鋼'] },
              { defaultMaterial: '黑鐵', categories: ['H型鋼'] },
            ],
            candidates: [],
          },
          {
            queryId: 'surface',
            status: 'unsupported_material_surface',
            availableWhiteSteelSurfaces: ['ST', 'BA'],
            categoryMaterialOptions: [
              {
                category: '方管',
                defaultMaterial: '黑鐵',
                availableMaterials: ['黑鐵', '白鐵', '錶'],
                defaultWhiteSteelSurface: 'ST',
                availableWhiteSteelSurfaces: ['ST', 'BA'],
              },
              {
                category: '鐵板',
                defaultMaterial: '黑鐵',
                availableMaterials: ['黑鐵', '白鐵', '錶'],
                defaultWhiteSteelSurface: '2B',
                availableWhiteSteelSurfaces: ['ST', '2B', 'NO1', 'HL', 'BA'],
              },
            ],
            unsupportedMaterials: [
              {
                category: '方管',
                material: 'NO1',
                availableMaterials: ['黑鐵', '白鐵', '錏'],
                availableWhiteSteelSurfaces: ['ST', 'BA'],
              },
            ],
            candidates: [],
          },
        ],
        cuttingPrices: [],
      },
      durationMs: 0,
      redactionVersion: 1 as const,
    });
    const tool = createSteelNativeTool({
      execute,
      nativeToolName: 'search_price_candidates',
      steelToolName: 'search_price_candidates',
    });

    const payload = JSON.parse((await tool.invoke({})).content) as {
      data: { queryResults: Array<Record<string, unknown>> };
    };
    expect(payload.data.queryResults[0]).toEqual(
      expect.objectContaining({
        defaultMaterialGroups: [
          { defaultMaterial: '錏', categories: ['C型鋼'] },
          { defaultMaterial: '黑鐵', categories: ['H型鋼'] },
        ],
      }),
    );
    expect(payload.data.queryResults[1]).toEqual(
      expect.objectContaining({
        availableWhiteSteelSurfaces: ['ST', 'BA'],
        categoryMaterialOptions: [
          expect.objectContaining({ category: '方管' }),
          expect.objectContaining({ category: '鐵板' }),
        ],
        unsupportedMaterials: [
          expect.objectContaining({ category: '方管' }),
        ],
      }),
    );
  });
});
