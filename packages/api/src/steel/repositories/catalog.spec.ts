import type { SteelRepositoryClient } from './types';
import {
  resolveSteelReviewCatalogCandidate,
  searchSteelReviewCatalog,
} from './catalog';

const rawCatalogRow = {
  id: '9007199254740993',
  erp_item_code: 'SC-UNIQUE',
  product_name: 'Selector steel plate',
  spec_key: 'catalog-special 400mm',
  category: '鐵板',
  subcategory: null,
  formula_code: 'plate-v1',
  material: 'SS400',
  unit: 'kg',
  cost_basis: 'kg',
  value_state: 'confirmed',
  unit_price_a: '12.34567890123456789',
  unit_price_b: null,
  unit_price_c: '10',
  unit_price_d: null,
  unit_price_e: null,
  unit_price_f: null,
  unit_weight_value: null,
  unit_weight_basis: null,
  density: '7.85',
  thickness_min_mm: '2',
  thickness_max_mm: '6',
  width_mm: '400',
  height_mm: null,
  length_mm: null,
  outer_diameter_mm: null,
  web_mm: null,
  flange_mm: null,
  lip_mm: null,
  sheet_width_mm: null,
  sheet_length_mm: null,
  unit_price: '12.34567890123456789',
};

describe('Steel catalog repository', () => {
  it('uses the dedicated steel.prices query with escaped model prefix matching and preserves raw prices', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [rawCatalogRow, { ...rawCatalogRow, id: '9007199254740994' }] });
    const client: SteelRepositoryClient = { query };

    const result = await searchSteelReviewCatalog(client, {
      field: 'model', keyword: 'SC_%', limit: 1, tier: 'A',
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toMatch(/FROM steel\.prices AS p/i);
    expect(sql).toMatch(/lower\(p\.erp_item_code\).*LIKE.*ESCAPE/i);
    expect(values).toContain('sc\\_\\%');
    expect(result.hasMore).toBe(true);
    expect(result.candidates[0]).toMatchObject({
      id: rawCatalogRow.id,
      erpItemCode: rawCatalogRow.erp_item_code,
      unitPrice: rawCatalogRow.unit_price_a,
      label: 'SC-UNIQUE Selector steel plate catalog-special 400mm',
    });
  });

  it('selects the requested tier without a fallback when that price is absent', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ...rawCatalogRow, unit_price: null }] });
    const client: SteelRepositoryClient = { query };

    const result = await resolveSteelReviewCatalogCandidate(client, { id: rawCatalogRow.id, tier: 'B' });

    expect(query.mock.calls[0]?.[1]).toEqual(['B', rawCatalogRow.id]);
    expect(result?.unitPrice).toBeNull();
    expect(result?.revision).toMatch(/^[a-f0-9]{64}$/);
  });
});
