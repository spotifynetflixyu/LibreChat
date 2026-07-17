import path from 'path';

interface SimulationResult {
  targetCategories: string[];
  totalAvailable: number;
  selectionRequired: boolean;
  productNames: string[];
  byProcessingCategory: Record<string, number>;
  cuttingSimulation: null | {
    category: string;
    materialCandidateCount: number;
    matchedCandidateCount: number;
    unmatchedCandidateCount: number;
    examples: Array<{
      selected: Array<{ itemName: string }>;
    }>;
  };
}

const simulator = jest.requireActual<{
  runSimulation: (options: {
    workbookPath: string;
    cuttingWorkbookPath?: string;
    categories?: string[];
    keyword?: string;
  }) => SimulationResult[];
}>('./simulate-steel-processing-prices.cjs');

describe('v4.4 processing price simulation', () => {
  it('derives processing candidates from the workbook without reading the database', () => {
    const results = simulator.runSimulation({
      workbookPath: path.resolve(__dirname, '../../../docs/reference/products_db_v4.4.xlsx'),
      categories: ['鐵板', 'C型鋼', 'H型鋼', '角鐵'],
    });
    const byCategory = new Map(results.map((result) => [result.targetCategories[0], result]));

    expect(byCategory.get('鐵板')).toEqual(
      expect.objectContaining({
        totalAvailable: 21,
        selectionRequired: false,
        byProcessingCategory: expect.objectContaining({
          '加工/切工': 7,
          '加工/孔': 7,
          '加工/折工': 4,
        }),
      }),
    );
    expect(byCategory.get('鐵板')?.productNames).toEqual([]);
    expect(byCategory.get('C型鋼')?.totalAvailable).toBe(7);
    expect(byCategory.get('H型鋼')?.totalAvailable).toBe(3);
    expect(byCategory.get('角鐵')?.totalAvailable).toBe(10);
  });

  it('replays automatic candidate-aware cutting prices for long materials and square bars', () => {
    const categories = [
      'H型鋼',
      'I型鋼/工字鐵',
      '平鐵',
      '圓管',
      '方管',
      '扁方管',
      '圓條',
      '方鐵',
      '角鐵',
      '槽鐵',
    ];
    const results = simulator.runSimulation({
      workbookPath: path.resolve(__dirname, '../../../docs/reference/products_db_v4.4.xlsx'),
      cuttingWorkbookPath: path.resolve(
        __dirname,
        '../../../docs/reference/切工價錢-v4.4-normalized.xlsx',
      ),
      categories,
    });
    const byCategory = new Map(results.map((result) => [result.targetCategories[0], result]));

    for (const category of categories.filter((value) => value !== 'I型鋼/工字鐵')) {
      expect(byCategory.get(category)?.cuttingSimulation?.materialCandidateCount).toBeGreaterThan(
        0,
      );
      expect(byCategory.get(category)?.cuttingSimulation?.matchedCandidateCount).toBeGreaterThan(0);
    }
    expect(byCategory.get('I型鋼/工字鐵')?.cuttingSimulation).toEqual(
      expect.objectContaining({
        materialCandidateCount: 0,
        matchedCandidateCount: 0,
      }),
    );
    expect(byCategory.get('圓條')?.cuttingSimulation).toEqual(
      expect.objectContaining({
        materialCandidateCount: 60,
        matchedCandidateCount: 22,
        unmatchedCandidateCount: 38,
      }),
    );
    expect(byCategory.get('方鐵')?.cuttingSimulation).toEqual(
      expect.objectContaining({ materialCandidateCount: 22, matchedCandidateCount: 10 }),
    );
    expect(byCategory.get('方鐵')?.cuttingSimulation?.examples[0]?.selected).toEqual([
      expect.objectContaining({ itemName: '1/2"' }),
    ]);
  });
});
