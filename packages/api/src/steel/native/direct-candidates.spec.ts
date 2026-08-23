import { createSteelNativeTool } from './tools';

describe('native direct candidate compaction', () => {
  it('keeps flat fields and trims whole serialized response under 80k', async () => {
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
            defaultWhiteSteelSurface: '2B',
            availableWhiteSteelSurfaces: [],
            groups: [],
          }],
        },
      },
      sourceRefs: [],
      durationMs: 0,
      redactionVersion: 1 as const,
    });
    const tool = createSteelNativeTool({
      execute,
      nativeToolName: 'search_price_candidates',
      steelToolName: 'search_price_candidates',
    });
    const result = await tool.invoke({});
    expect(result.content.length).toBeLessThanOrEqual(80_000);
    const payload = JSON.parse(result.content) as { data: Record<string, unknown> };
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
      expect.objectContaining({ defaultMaterial: '黑鐵', defaultWhiteSteelSurface: '2B' }),
    );
    expect(result.content).not.toContain('pricingOptions');
    expect(result.content).not.toContain('skippedPricingOptions');
    expect(result.content).not.toContain('selectionRequired');
  });

  it('returns a bounded repository error when essential material fields remain too large', async () => {
    const execute = async () => ({
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
                erpItemCode: `ERP-${'x'.repeat(100_000)}`,
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
      sourceRefs: [],
      durationMs: 0,
      redactionVersion: 1 as const,
    });
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
                defaultWhiteSteelSurface: '2B',
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
      sourceRefs: [],
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
