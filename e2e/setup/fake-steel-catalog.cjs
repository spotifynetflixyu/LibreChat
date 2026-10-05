const path = require('node:path');
const { Pool } = require(path.join(process.cwd(), 'node_modules/pg'));

const candidate = {
  id: '9007199254740993',
  erp_item_code: 'SC-UNIQUE',
  product_name: 'Selector steel plate',
  spec_key: 'catalog-special 400mm',
  category: '鐵板',
  subcategory: null,
  material: 'SS400',
  unit: 'kg',
  formula_code: null,
  value_state: 'confirmed',
  unit_price_base: '999',
  unit_price_a: '12.34567890123456789',
  unit_price_b: null,
  unit_price: null,
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
  nominal_inch: null,
  web_mm: null,
  flange_mm: null,
  lip_mm: null,
  sheet_width_mm: null,
  sheet_length_mm: null,
  spec_sort_key: null,
  processing_method: null,
  processing_shape: null,
  cost_basis: 'kg',
  updated_at: '2026-10-05T00:00:00.000Z',
};

const query = Pool.prototype.query;
Pool.prototype.query = function (sql, values, callback) {
  if (typeof sql === 'string' && /FROM\s+steel\.prices\b/i.test(sql)) {
    const other = { ...candidate, id: '9007199254740994', erp_item_code: 'SC-OTHER', product_name: 'Other steel plate' };
    const rows = [other, candidate];
    if (/WHERE p\.id::text = \$2/u.test(sql)) {
      return Promise.resolve({ rows: rows.filter((row) => row.id === values?.[1]) });
    }
    const keyword = String(values?.[1] ?? '').toLowerCase();
    const model = /lower\(p\.erp_item_code\).*LIKE/u.test(sql);
    return Promise.resolve({ rows: rows.filter((row) => !keyword || (model
      ? row.erp_item_code.toLowerCase().startsWith(keyword)
      : `${row.product_name} ${row.spec_key}`.toLowerCase().includes(keyword))) });
  }
  return query.call(this, sql, values, callback);
};
