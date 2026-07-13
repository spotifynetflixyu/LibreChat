import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

import { buildSteelPriceV4Rows } from '../src/steel/pricing/v4';

import type { SteelPriceV4Row, SteelPriceV4WorkbookRow } from '../src/steel/pricing/v4';

type SqlValue = string | number | boolean | null;

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
  buildDryRunSummary: (
    rows: readonly SteelPriceV4Row[],
    workbookPath: string,
  ) => Record<string, string | number | Record<string, number>>;
  importWorkbook: (options: {
    apply: boolean;
    workbookPath: string;
    createPool?: () => TestPool;
    write?: (value: string) => void;
  }) => Promise<Record<string, string | number | Record<string, number>>>;
  loadWorkbookRows: (workbookPath: string) => SteelPriceV4WorkbookRow[];
  parseArgs: (argv: readonly string[]) => {
    apply: boolean;
    dryRun: boolean;
    help: boolean;
    workbookPath: string;
  };
  replaceSteelPrices: (client: TestClient, rows: readonly SteelPriceV4Row[]) => Promise<void>;
}

const importer = jest.requireActual<ImporterModule>('./import-steel-price-v4.cjs');

const expectedHeaders = [
  'erp_item_code',
  'formula_code',
  'product_name',
  'normalized_spec_text',
  'category',
  'subcategory',
  'material',
  'dimension_signature',
  'unit',
  'value_state',
  'unit_price_base',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_d',
  'unit_price_e',
  'unit_price_f',
  'price_ratio_a',
  'price_ratio_b',
  'price_ratio_c',
  'price_ratio_d',
  'price_ratio_e',
  'price_ratio_f',
  'unit_weight_value',
  'unit_weight_basis',
  'density',
  'source_thickness',
  'width_mm',
  'height_mm',
  'length_mm',
  'outer_diameter_mm',
  'nominal_inch',
  'web_mm',
  'flange_mm',
  'lip_mm',
  'sheet_width_mm',
  'sheet_length_mm',
  'spec_sort_key',
  'cost_basis',
] as const;

const tempDirectories: string[] = [];

function makeWorkbookRow(
  overrides: Partial<Record<(typeof expectedHeaders)[number], string | number>> = {},
): SteelPriceV4WorkbookRow {
  const row = Object.fromEntries(expectedHeaders.map((header) => [header, ''])) as Record<
    (typeof expectedHeaders)[number],
    string | number
  >;

  Object.assign(row, {
    erp_item_code: 'ERP001',
    product_name: 'H型鋼',
    normalized_spec_text: 'H100x100',
    category: 'H型鋼',
    subcategory: '',
    material: 'OT 黑鐵',
    unit: '支',
    value_state: 'confirmed',
    unit_price_a: '100',
    cost_basis: '2.數量',
    ...overrides,
  });

  return row;
}

function writeWorkbook(
  sheetName: string,
  headers: readonly string[] = expectedHeaders,
  rows: readonly SteelPriceV4WorkbookRow[] = [makeWorkbookRow()],
): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steel-price-v4-'));
  const workbookPath = path.join(directory, 'prices.xlsx');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...headers],
    ...rows.map((row) => headers.map((header) => row[header as keyof SteelPriceV4WorkbookRow])),
  ]);

  tempDirectories.push(directory);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, workbookPath);

  return workbookPath;
}

function makeParsedRow(overrides: Parameters<typeof makeWorkbookRow>[0] = {}): SteelPriceV4Row {
  const [row] = buildSteelPriceV4Rows([makeWorkbookRow(overrides)]);
  if (!row) {
    throw new Error('Expected one parsed Steel price row');
  }

  return row;
}

afterEach(() => {
  tempDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { force: true, recursive: true });
  });
});

describe('Steel price v4.4 importer', () => {
  it('defaults to the repository v4.4 workbook in dry-run mode', () => {
    const args = importer.parseArgs([]);

    expect(args).toEqual({
      apply: false,
      dryRun: true,
      help: false,
      workbookPath: path.resolve(__dirname, '../../../docs/reference/products_db_v4.4.xlsx'),
    });
    expect(importer.DEFAULT_WORKBOOK_PATH).toBe(args.workbookPath);
  });

  it('requires the products_db_ready worksheet', () => {
    const workbookPath = writeWorkbook('wrong_sheet');

    expect(() => importer.loadWorkbookRows(workbookPath)).toThrow(
      'missing products_db_ready sheet',
    );
  });

  it('requires the exact legacy or normalized workbook headers', () => {
    const reorderedHeaders = [...expectedHeaders];
    [reorderedHeaders[0], reorderedHeaders[1]] = [reorderedHeaders[1], reorderedHeaders[0]];
    const workbookPath = writeWorkbook('products_db_ready', reorderedHeaders);

    expect(importer.EXPECTED_HEADERS).toEqual(expectedHeaders);
    expect(() => importer.loadWorkbookRows(workbookPath)).toThrow(
      'products_db_ready headers do not match the exact legacy or normalized v4.4 contract',
    );
  });

  it('builds a JSON-ready reconciliation with ERP duplicates and value-state totals', () => {
    const rows = [
      makeParsedRow(),
      makeParsedRow({
        erp_item_code: 'ERP001',
        value_state: 'ratio_only',
        unit_price_a: 0,
        price_ratio_a: 1.2,
      }),
      makeParsedRow({ erp_item_code: 'ERP003', value_state: 'no_price', unit_price_a: 0 }),
    ];

    expect(importer.buildDryRunSummary(rows, '/tmp/prices.xlsx')).toEqual({
      mode: 'dry-run',
      workbookPath: '/tmp/prices.xlsx',
      sheet: 'products_db_ready',
      sourceDataset: 'product_price_v4_4',
      importRows: 3,
      duplicateErpItemCodes: 1,
      activeRows: 3,
      byValueState: {
        confirmed: 1,
        ratio_only: 1,
        no_price: 1,
      },
    });
  });

  it('validates every workbook row before creating a database pool', async () => {
    const workbookPath = writeWorkbook('products_db_ready', expectedHeaders, [
      makeWorkbookRow(),
      makeWorkbookRow({ erp_item_code: 'ERP002', category: '未知' }),
    ]);
    const createPool = jest.fn<TestPool, []>();

    await expect(
      importer.importWorkbook({ apply: true, workbookPath, createPool, write: jest.fn() }),
    ).rejects.toThrow('Unknown Steel price category: 未知');
    expect(createPool).not.toHaveBeenCalled();
  });

  it.each(['insert', 'readback'] as const)(
    'rolls back when the %s phase fails',
    async (failurePhase) => {
      const statements: string[] = [];
      const client: TestClient = {
        query: jest.fn(async (sql) => {
          const statement = sql.trim();
          statements.push(statement);

          if (failurePhase === 'insert' && statement.startsWith('INSERT INTO steel.prices')) {
            throw new Error('insert failed');
          }
          if (statement.includes('COUNT(*)::int AS total')) {
            return {
              rows: [
                {
                  total: failurePhase === 'readback' ? 0 : 1,
                  target_dataset: 1,
                  other_dataset: 0,
                  active: 1,
                  confirmed: 1,
                  ratio_only: 0,
                  no_price: 0,
                },
              ],
            };
          }

          return { rows: [] };
        }),
      };

      await expect(importer.replaceSteelPrices(client, [makeParsedRow()])).rejects.toThrow(
        failurePhase === 'insert' ? 'insert failed' : 'Steel price v4.4 readback mismatch',
      );
      expect(statements.at(-1)).toBe('ROLLBACK');
      expect(statements).not.toContain('COMMIT');
    },
  );

  it('replaces prices without a review_state insert or readback dependency', async () => {
    const statements: string[] = [];
    const client: TestClient = {
      query: jest.fn(async (sql) => {
        statements.push(sql);
        if (sql.includes('COUNT(*)::int AS total')) {
          return {
            rows: [
              {
                total: 1,
                target_dataset: 1,
                other_dataset: 0,
                active: 1,
                confirmed: 1,
                ratio_only: 0,
                no_price: 0,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    await importer.replaceSteelPrices(client, [makeParsedRow()]);

    expect(statements.find((sql) => sql.startsWith('INSERT INTO steel.prices'))).not.toContain(
      'review_state',
    );
    expect(statements).not.toContain('TRUNCATE TABLE steel.prices RESTART IDENTITY');
    expect(statements.find((sql) => sql.startsWith('INSERT INTO steel.prices'))).toContain(
      'ON CONFLICT (erp_item_code) DO UPDATE',
    );
    expect(statements.find((sql) => sql.startsWith('INSERT INTO steel.prices'))).toContain(
      'imported_at = NOW()',
    );
    expect(statements).toContain("SELECT pg_advisory_xact_lock(hashtext('steel.prices:replace'))");
    expect(statements).toContain(
      'DELETE FROM steel.prices WHERE NOT (erp_item_code = ANY($1::text[]))',
    );
    expect(statements.find((sql) => sql.includes('COUNT(*)::int AS total'))).not.toContain(
      'review_state',
    );
  });

  it('persists normalized inclusive thickness bounds during replacement', async () => {
    const calls: Array<{ sql: string; values?: readonly SqlValue[] }> = [];
    const client: TestClient = {
      query: jest.fn(async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('COUNT(*)::int AS total')) {
          return {
            rows: [
              {
                total: 1,
                target_dataset: 1,
                other_dataset: 0,
                active: 1,
                confirmed: 1,
                ratio_only: 0,
                no_price: 0,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    const row = makeParsedRow({
      erp_item_code: 'DZA0612',
      category: '加工/孔',
      subcategory: '鐵板',
      product_name: '厚度6.0-12.0m/m鐵板鑽孔φ',
      normalized_spec_text: '厚度6.0-12.0mm鐵板鑽孔φ',
      source_thickness: '6',
    });

    await importer.replaceSteelPrices(client, [row]);

    const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO steel.prices'));
    expect(insert?.sql).toContain('thickness_min_mm, thickness_max_mm');
    expect(insert?.values).toEqual(
      expect.arrayContaining([row.thicknessMinMm, row.thicknessMaxMm]),
    );
  });
});
