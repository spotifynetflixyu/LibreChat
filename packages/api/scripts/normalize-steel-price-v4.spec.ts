import fs from 'fs';
import os from 'os';
import path from 'path';

interface NormalizerModule {
  DEFAULT_INPUT_PATH: string;
  DEFAULT_OUTPUT_PATH: string;
  DEFAULT_ENRICHMENT_PATH: string;
  analyzeWorkbook: (
    inputPath: string,
    enrichmentPath?: string,
  ) => { rowCount: number; pendingReviewCount: number };
  loadEnrichment: (enrichmentPath: string) => ReadonlyMap<string, Record<string, string | number>>;
  normalizeWorkbook: (options: {
    inputPath: string;
    outputPath: string;
    enrichmentPath?: string;
    reviewPath?: string;
  }) => Promise<{
    rowCount: number;
    pendingReviewCount: number;
    categoryMismatchCount: number;
    unclassifiedSubcategoryCount: number;
    changedCategoryCount: number;
  }>;
  parseArgs: (argv: readonly string[]) => {
    write: boolean;
    inputPath: string;
    outputPath: string;
    enrichmentPath: string;
    reviewPath: string;
  };
}

const normalizer = jest.requireActual<NormalizerModule>('./normalize-steel-price-v4.cjs');
const goldenWorkbookPath = path.resolve(__dirname, '../../../docs/reference/products_db_v4.4.xlsx');
const tempDirectories: string[] = [];

afterAll(() => {
  for (const directory of tempDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Steel price v4 workbook normalizer script', () => {
  it('defaults to the strict 0701 raw source and read-only mode', () => {
    const options = normalizer.parseArgs([]);

    expect(options.write).toBe(false);
    expect(options.inputPath).toBe(path.resolve(__dirname, '../../../docs/reference/0701.xlsx'));
    expect(options.outputPath).toBe(goldenWorkbookPath);
    expect(options.enrichmentPath).toBe(normalizer.DEFAULT_ENRICHMENT_PATH);
    expect(normalizer.parseArgs(['--write']).write).toBe(true);
  });

  it('rejects overwriting the raw source', async () => {
    await expect(
      normalizer.normalizeWorkbook({
        inputPath: normalizer.DEFAULT_INPUT_PATH,
        outputPath: normalizer.DEFAULT_INPUT_PATH,
      }),
    ).rejects.toThrow('must differ');
  });

  it('rejects duplicate ERP codes before indexing the enrichment baseline', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steel-v4-enrichment-'));
    tempDirectories.push(directory);
    const enrichmentPath = path.join(directory, 'duplicate-enrichment.json');
    const records = JSON.parse(
      fs.readFileSync(normalizer.DEFAULT_ENRICHMENT_PATH, 'utf8'),
    ) as Array<Record<string, string | number>>;
    fs.writeFileSync(enrichmentPath, JSON.stringify([...records, records[0]]), 'utf8');

    expect(() => normalizer.loadEnrichment(enrichmentPath)).toThrow(
      'Duplicate Steel price enrichment ERP code',
    );
  });
});
