import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

type SqlValue = string | number | null;

interface CuttingWorkbookRow {
  cutting_category: string;
  record_type: string;
  item_name: string;
  cut_type: string;
  spec_text: string;
  normalized_spec_text: string;
  inch_min: string | number;
  inch_max: string | number;
  mm_min: string | number;
  mm_max: string | number;
  unit: string;
  unit_price_a: string | number;
  unit_price_b: string | number;
  unit_price_c: string | number;
  unit_price_f: string | number;
  conditions_json: string;
  calculation_rule: string;
  notes: string;
  source_sheet: string;
  source_row: string | number;
}

interface ParsedCuttingRow {
  cuttingCategory: string;
  recordType: 'price' | 'supplement';
  sourceSheet: string;
  sourceRow: number;
}

interface QueryResult {
  rows?: ReadonlyArray<Record<string, string | number>>;
}

interface TestClient {
  query: (sql: string, values?: readonly SqlValue[]) => Promise<QueryResult>;
}

interface TestPool {
  connect: () => Promise<TestClient & { release: () => void }>;
  end: () => Promise<void>;
}

interface ImporterModule {
  DEFAULT_WORKBOOK_PATH: string;
  EXPECTED_HEADERS: readonly string[];
  loadWorkbookRows: (workbookPath: string) => ParsedCuttingRow[];
  buildDryRunSummary: (
    rows: readonly ParsedCuttingRow[],
    workbookPath: string,
  ) => Record<string, string | number | Record<string, number>>;
  replaceSteelCuttingPrices: (
    client: TestClient,
    rows: readonly ParsedCuttingRow[],
  ) => Promise<void>;
  importWorkbook: (options: {
    apply: boolean;
    workbookPath: string;
    createPool?: () => TestPool;
    write?: (value: string) => void;
  }) => Promise<Record<string, string | number | Record<string, number>>>;
}

const importer = jest.requireActual<ImporterModule>('./import-steel-cutting-prices.cjs');

const headers = [
  'cutting_category',
  'record_type',
  'item_name',
  'cut_type',
  'spec_text',
  'normalized_spec_text',
  'inch_min',
  'inch_max',
  'mm_min',
  'mm_max',
  'unit',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_f',
  'conditions_json',
  'calculation_rule',
  'notes',
  'source_sheet',
  'source_row',
] as const;

const tempDirectories: string[] = [];

function makeRow(overrides: Partial<CuttingWorkbookRow> = {}): CuttingWorkbookRow {
  return {
    cutting_category: '鐵管',
    record_type: 'price',
    item_name: '1/2"',
    cut_type: '加工/切工',
    spec_text: '1/2"',
    normalized_spec_text: '1/2"',
    inch_min: 0.5,
    inch_max: 0.5,
    mm_min: 12.7,
    mm_max: 12.7,
    unit: '刀',
    unit_price_a: 10,
    unit_price_b: '',
    unit_price_c: 10,
    unit_price_f: 10,
    conditions_json: '{}',
    calculation_rule: '',
    notes: '',
    source_sheet: '全部整理資料',
    source_row: 62,
    ...overrides,
  };
}

function writeWorkbook(
  options: {
    prices?: readonly CuttingWorkbookRow[];
    supplements?: readonly CuttingWorkbookRow[];
    priceHeaders?: readonly string[];
    includeSupplements?: boolean;
  } = {},
): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steel-cutting-prices-'));
  const workbookPath = path.join(directory, 'cutting.xlsx');
  const workbook = XLSX.utils.book_new();
  const prices = options.prices ?? [makeRow()];
  const supplements = options.supplements ?? [
    makeRow({
      cutting_category: '鐵管',
      record_type: 'supplement',
      item_name: '方管厚度',
      cut_type: '補充',
      spec_text: '方管厚度',
      normalized_spec_text: '方管厚度',
      inch_min: '',
      inch_max: '',
      mm_min: '',
      mm_max: '',
      unit: '',
      unit_price_a: '',
      unit_price_c: '',
      unit_price_f: '',
      notes: '方管厚度 1.2 以下不切',
      source_row: 112,
    }),
  ];

  const toSheet = (sheetHeaders: readonly string[], rows: readonly CuttingWorkbookRow[]) =>
    XLSX.utils.aoa_to_sheet([
      [...sheetHeaders],
      ...rows.map((row) => sheetHeaders.map((header) => row[header as keyof CuttingWorkbookRow])),
    ]);

  XLSX.utils.book_append_sheet(
    workbook,
    toSheet(options.priceHeaders ?? headers, prices),
    'cutting_prices',
  );
  if (options.includeSupplements !== false) {
    XLSX.utils.book_append_sheet(workbook, toSheet(headers, supplements), 'cutting_supplements');
  }
  XLSX.writeFile(workbook, workbookPath);
  tempDirectories.push(directory);
  return workbookPath;
}

afterEach(() => {
  tempDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { force: true, recursive: true });
  });
});

describe('Steel cutting price importer', () => {
  it('defaults to the clean reference workbook and exact two-sheet headers', () => {
    expect(importer.DEFAULT_WORKBOOK_PATH).toBe(
      path.resolve(__dirname, '../../../docs/reference/切工價錢-clean.xlsx'),
    );
    expect(importer.EXPECTED_HEADERS).toEqual(headers);

    const missingSheet = writeWorkbook({ includeSupplements: false });
    expect(() => importer.loadWorkbookRows(missingSheet)).toThrow(
      'missing cutting_supplements sheet',
    );

    const reordered = [...headers];
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    expect(() => importer.loadWorkbookRows(writeWorkbook({ priceHeaders: reordered }))).toThrow(
      'cutting_prices headers do not match the exact cutting catalog contract',
    );
  });

  it('parses exact decimals, nullable B, and reconciles record types/categories', () => {
    const workbookPath = writeWorkbook();
    const rows = importer.loadWorkbookRows(workbookPath);

    expect(rows).toHaveLength(2);
    expect(importer.buildDryRunSummary(rows, workbookPath)).toMatchObject({
      importRows: 2,
      priceRows: 1,
      supplementRows: 1,
      byCategory: { 鐵管: 2 },
    });
  });

  it('validates the entire workbook before creating a database pool', async () => {
    const workbookPath = writeWorkbook({
      supplements: [makeRow({ record_type: 'unknown', source_row: 112 })],
    });
    const createPool = jest.fn<TestPool, []>();

    await expect(
      importer.importWorkbook({ apply: true, workbookPath, createPool, write: jest.fn() }),
    ).rejects.toThrow('Unknown cutting record_type: unknown');
    expect(createPool).not.toHaveBeenCalled();
  });

  it.each(['insert', 'readback'] as const)('rolls back when %s fails', async (phase) => {
    const rows = importer.loadWorkbookRows(writeWorkbook());
    const statements: string[] = [];
    const client: TestClient = {
      query: jest.fn(async (sql) => {
        statements.push(sql.trim());
        if (phase === 'insert' && sql.startsWith('INSERT INTO steel.cutting_prices')) {
          throw new Error('insert failed');
        }
        if (sql.includes('COUNT(*)::int AS total')) {
          return {
            rows: [
              {
                total: phase === 'readback' ? 0 : 2,
                price: 1,
                supplement: 1,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    await expect(importer.replaceSteelCuttingPrices(client, rows)).rejects.toThrow(
      phase === 'insert' ? 'insert failed' : 'Steel cutting price readback mismatch',
    );
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });
});
