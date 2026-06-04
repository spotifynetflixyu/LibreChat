import { lookupSteelCatalogFamilies } from './families';

import type { SteelRepositoryClient, SteelSqlParameter } from './types';

interface QueryCall {
  sql: string;
  values?: readonly SteelSqlParameter[];
}

function createClient(rows: object[]): SteelRepositoryClient & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];

  return {
    calls,
    query: async <Row extends object>(
      sql: string,
      values?: readonly SteelSqlParameter[],
    ): Promise<{ rows: Row[] }> => {
      calls.push({ sql, values });
      return { rows: rows as Row[] };
    },
  };
}

describe('lookupSteelCatalogFamilies', () => {
  it('returns reviewed catalog-family vocabulary candidates without selecting a resolved key', async () => {
    const client = createClient([
      {
        key: 'h_beam',
        display_name_zh: 'H型鋼',
        aliases: ['H型鋼', 'H鋼', 'H-BEAM'],
        metadata: { sourceKind: 'curated', sourceProductRowCount: 24 },
        review_state: 'reviewed',
        active: true,
        source_refs: [
          {
            channel: 'admin_erp_xlsx',
            factType: 'catalog_family',
            sourceFile: 'docs/reference/產品價格.xlsx',
            canonicalKey: 'catalog_family',
          },
        ],
      },
      {
        key: 'c_type',
        display_name_zh: 'C型鋼',
        aliases: ['C型鋼', 'C鋼', '輕型鋼'],
        metadata: { sourceKind: 'curated', sourceProductRowCount: 12 },
        review_state: 'reviewed',
        active: true,
        source_refs: [],
      },
    ]);

    const result = await lookupSteelCatalogFamilies(client, {
      searchText: 'H鋼',
      limit: 10,
    });

    expect(client.calls[0]?.sql).toContain('FROM steel.catalog_families');
    expect(client.calls[0]?.values).toEqual(['reviewed', '%H鋼%', 10]);
    expect(result).toEqual([
      expect.objectContaining({
        key: 'h_beam',
        displayNameZh: 'H型鋼',
        aliases: ['H型鋼', 'H鋼', 'H-BEAM'],
        active: true,
        reviewState: 'reviewed',
        metadata: { sourceKind: 'curated', sourceProductRowCount: 24 },
        sourceRefs: [
          {
            channel: 'admin_erp_xlsx',
            factType: 'catalog_family',
            sourceFile: 'docs/reference/產品價格.xlsx',
            canonicalKey: 'catalog_family',
          },
        ],
      }),
      expect.objectContaining({
        key: 'c_type',
        displayNameZh: 'C型鋼',
      }),
    ]);
  });

  it('can fetch explicit catalog-family keys for AI follow-up context', async () => {
    const client = createClient([
      {
        key: 'a_pipe',
        display_name_zh: 'A管',
        aliases: ['A管', '黑A鋼管', '白A鋼管'],
        metadata: { sourceKind: 'curated' },
        review_state: 'reviewed',
        active: true,
        source_refs: [],
      },
    ]);

    const result = await lookupSteelCatalogFamilies(client, {
      keys: ['a_pipe'],
      limit: 5,
    });

    expect(client.calls[0]?.values).toEqual(['reviewed', 'a_pipe', 5]);
    expect(result.map((family) => family.key)).toEqual(['a_pipe']);
  });
});
