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

const processing = (id, code, name, fields = {}) => ({
  ...candidate, id, erp_item_code: code, product_name: name, spec_key: '6mm',
  category: '加工/切工', subcategory: '鐵板', unit: '刀', cost_basis: '刀', density: null,
  thickness_min_mm: '6', thickness_max_mm: '8', width_mm: null,
  unit_price_a: '111', unit_price_b: '2.123456789123456789', ...fields,
});
const catalogRows = [
  { ...candidate, id: '9007199254740994', erp_item_code: 'SC-OTHER', product_name: 'Other steel plate' },
  candidate,
  processing('9007199254740995', 'PC-MULTI-A', 'Plate cutting A'),
  processing('9007199254740996', 'PC-MULTI-B', 'Plate cutting B', { unit_price_b: '3.123456789123456789' }),
  processing('9007199254740997', 'PC-NOPRICE', 'Profile drilling', { category: '加工/孔', subcategory: 'C型鋼',
    thickness_min_mm: null, thickness_max_mm: null, value_state: 'no_price', unit_price_b: null }),
  processing('9007199254740998', 'PC-WRONG', 'Other material drilling', { category: '加工/孔', subcategory: 'C型鋼' }),
  processing('9007199254740999', 'PC-BAND', 'Excluded thickness band', { thickness_min_mm: '0', thickness_max_mm: '6' }),
];
const query = Pool.prototype.query;
Pool.prototype.query = function (sql, values, callback) {
  if (typeof sql === 'string' && /FROM\s+steel\.prices\b/i.test(sql)) {
    const processingQuery = sql.includes("p.category LIKE '加工/%'");
    let rows = catalogRows.filter((row) => row.category.startsWith('加工/') === processingQuery);
    if (/WHERE p\.id::text = \$2/u.test(sql)) {
      rows = rows.filter((row) => row.id === values?.[1]);
    } else {
      const keyword = String(values?.[1] ?? '').toLowerCase();
      const model = /lower\(p\.erp_item_code\).*LIKE/u.test(sql);
      rows = rows.filter((row) => !keyword || (model ? row.erp_item_code.toLowerCase().startsWith(keyword)
        : (row.product_name ?? '').toLowerCase().includes(keyword)));
      rows.sort((left, right) => {
        const a = left.erp_item_code.toLowerCase(), b = right.erp_item_code.toLowerCase();
        if (a !== b) return a < b ? -1 : 1;
        if (left.id === right.id) return 0;
        return left.id < right.id ? -1 : 1;
      });
      if (values.length > 3) {
        const code = String(values[2]).toLowerCase(), id = String(values[3]);
        rows = rows.filter((row) => row.erp_item_code.toLowerCase() > code ||
          (row.erp_item_code.toLowerCase() === code && row.id > id));
      }
      rows = rows.slice(0, Number(values.at(-1)));
    }
    const tier = String(values?.[0] ?? '').toLowerCase();
    return Promise.resolve({ rows: rows.map((row) => ({ ...row, unit_price: row[`unit_price_${tier}`] ?? null })) });
  }
  return query.call(this, sql, values, callback);
};
