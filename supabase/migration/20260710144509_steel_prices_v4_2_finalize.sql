DELETE FROM steel.prices
WHERE source_dataset <> 'product_price_v4_2';

ALTER TABLE steel.prices
  DROP CONSTRAINT IF EXISTS prices_source_row_unique,
  DROP CONSTRAINT IF EXISTS prices_kind_check,
  DROP CONSTRAINT IF EXISTS prices_category_check,
  DROP CONSTRAINT IF EXISTS prices_material_check,
  DROP CONSTRAINT IF EXISTS prices_value_state_check,
  DROP CONSTRAINT IF EXISTS prices_review_state_check,
  DROP CONSTRAINT IF EXISTS prices_unit_prices_nonnegative_check,
  DROP CONSTRAINT IF EXISTS prices_confirmed_has_price_check,
  DROP CONSTRAINT IF EXISTS prices_unknown_has_no_price_check,
  DROP CONSTRAINT IF EXISTS prices_metadata_check,
  DROP CONSTRAINT IF EXISTS prices_source_refs_check,
  DROP CONSTRAINT IF EXISTS prices_erp_item_code_unique,
  DROP CONSTRAINT IF EXISTS prices_source_dataset_check,
  DROP CONSTRAINT IF EXISTS prices_currency_check,
  DROP CONSTRAINT IF EXISTS prices_cost_basis_check,
  DROP CONSTRAINT IF EXISTS prices_numeric_values_nonnegative_check,
  DROP CONSTRAINT IF EXISTS prices_value_state_invariants_check,
  DROP CONSTRAINT IF EXISTS prices_subcategory_not_blank_check;

ALTER TABLE steel.prices
  DROP COLUMN IF EXISTS source_category_label,
  DROP COLUMN IF EXISTS source_subcategory_label,
  DROP COLUMN IF EXISTS source_material_label,
  DROP COLUMN IF EXISTS source_spec,
  DROP COLUMN IF EXISTS product_price_unit_weight,
  DROP COLUMN IF EXISTS product_price_unit_weight_unit,
  DROP COLUMN IF EXISTS metadata,
  ALTER COLUMN erp_item_code SET NOT NULL,
  ALTER COLUMN cost_basis SET NOT NULL;

ALTER TABLE steel.prices
  ADD CONSTRAINT prices_erp_item_code_unique UNIQUE (erp_item_code),
  ADD CONSTRAINT prices_kind_check
    CHECK (price_kind IN ('product', 'cutting', 'hole')),
  ADD CONSTRAINT prices_source_dataset_check
    CHECK (source_dataset = 'product_price_v4_2'),
  ADD CONSTRAINT prices_currency_check
    CHECK (currency = 'TWD'),
  ADD CONSTRAINT prices_category_check
    CHECK (category IN (
      'C型鋼', 'H型鋼', 'I型鋼/工字鐵', 'T型鋼', '鐵板', '平鐵', '角鐵',
      '圓鐵', '圓管', '方鐵', '方管', '扁方管', '網', '格板/隔板', '板/浪板',
      '鐵軌', '槽鐵', '捲門/伸縮門', '門窗/門板', '五金/配件', '加工/孔',
      '加工/切工', '加工/折工', '加工/其他', '加工/開槽', '其他'
    )),
  ADD CONSTRAINT prices_value_state_check
    CHECK (value_state IN ('confirmed', 'ratio_only', 'no_price')),
  ADD CONSTRAINT prices_review_state_check
    CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT prices_cost_basis_check
    CHECK (cost_basis IN ('1.總數', '2.數量')),
  ADD CONSTRAINT prices_numeric_values_nonnegative_check
    CHECK (
      (unit_price_base IS NULL OR unit_price_base >= 0)
      AND (unit_price_a IS NULL OR unit_price_a >= 0)
      AND (unit_price_b IS NULL OR unit_price_b >= 0)
      AND (unit_price_c IS NULL OR unit_price_c >= 0)
      AND (unit_price_d IS NULL OR unit_price_d >= 0)
      AND (unit_price_e IS NULL OR unit_price_e >= 0)
      AND (unit_price_f IS NULL OR unit_price_f >= 0)
      AND (price_ratio_a IS NULL OR price_ratio_a >= 0)
      AND (price_ratio_b IS NULL OR price_ratio_b >= 0)
      AND (price_ratio_c IS NULL OR price_ratio_c >= 0)
      AND (price_ratio_d IS NULL OR price_ratio_d >= 0)
      AND (price_ratio_e IS NULL OR price_ratio_e >= 0)
      AND (price_ratio_f IS NULL OR price_ratio_f >= 0)
      AND (unit_weight_value IS NULL OR unit_weight_value >= 0)
      AND (density IS NULL OR density >= 0)
      AND (width_mm IS NULL OR width_mm >= 0)
      AND (height_mm IS NULL OR height_mm >= 0)
      AND (length_mm IS NULL OR length_mm >= 0)
      AND (outer_diameter_mm IS NULL OR outer_diameter_mm >= 0)
      AND (web_mm IS NULL OR web_mm >= 0)
      AND (flange_mm IS NULL OR flange_mm >= 0)
      AND (lip_mm IS NULL OR lip_mm >= 0)
      AND (sheet_width_mm IS NULL OR sheet_width_mm >= 0)
      AND (sheet_length_mm IS NULL OR sheet_length_mm >= 0)
    ),
  ADD CONSTRAINT prices_value_state_invariants_check
    CHECK (
      (
        value_state = 'confirmed'
        AND (
          unit_price_base IS NOT NULL
          OR unit_price_a IS NOT NULL
          OR unit_price_b IS NOT NULL
          OR unit_price_c IS NOT NULL
          OR unit_price_d IS NOT NULL
          OR unit_price_e IS NOT NULL
          OR unit_price_f IS NOT NULL
        )
      )
      OR (
        value_state = 'ratio_only'
        AND unit_price_base IS NULL
        AND unit_price_a IS NULL
        AND unit_price_b IS NULL
        AND unit_price_c IS NULL
        AND unit_price_d IS NULL
        AND unit_price_e IS NULL
        AND unit_price_f IS NULL
        AND (
          price_ratio_a IS NOT NULL
          OR price_ratio_b IS NOT NULL
          OR price_ratio_c IS NOT NULL
          OR price_ratio_d IS NOT NULL
          OR price_ratio_e IS NOT NULL
          OR price_ratio_f IS NOT NULL
        )
      )
      OR (
        value_state = 'no_price'
        AND unit_price_base IS NULL
        AND unit_price_a IS NULL
        AND unit_price_b IS NULL
        AND unit_price_c IS NULL
        AND unit_price_d IS NULL
        AND unit_price_e IS NULL
        AND unit_price_f IS NULL
        AND price_ratio_a IS NULL
        AND price_ratio_b IS NULL
        AND price_ratio_c IS NULL
        AND price_ratio_d IS NULL
        AND price_ratio_e IS NULL
        AND price_ratio_f IS NULL
      )
    ),
  ADD CONSTRAINT prices_subcategory_not_blank_check
    CHECK (subcategory IS NULL OR BTRIM(subcategory) <> ''),
  ADD CONSTRAINT prices_source_refs_check
    CHECK (jsonb_typeof(source_refs) = 'array');

DROP INDEX IF EXISTS steel.prices_kind_category_idx;
DROP INDEX IF EXISTS steel.prices_kind_category_material_idx;
DROP INDEX IF EXISTS steel.prices_kind_category_subcategory_idx;
DROP INDEX IF EXISTS steel.prices_review_active_idx;
DROP INDEX IF EXISTS steel.prices_category_lookup_idx;
DROP INDEX IF EXISTS steel.prices_spec_key_trgm_idx;
DROP INDEX IF EXISTS steel.prices_product_name_trgm_idx;
DROP INDEX IF EXISTS steel.prices_subcategory_trgm_idx;

CREATE INDEX prices_category_lookup_idx
ON steel.prices (category, subcategory, material, unit);

CREATE INDEX prices_review_active_idx
ON steel.prices (review_state, active);

CREATE INDEX prices_spec_key_trgm_idx
ON steel.prices USING GIN (spec_key gin_trgm_ops);

CREATE INDEX prices_product_name_trgm_idx
ON steel.prices USING GIN (product_name gin_trgm_ops)
WHERE product_name IS NOT NULL;

CREATE INDEX prices_subcategory_trgm_idx
ON steel.prices USING GIN (subcategory gin_trgm_ops)
WHERE subcategory IS NOT NULL;

COMMENT ON TABLE steel.prices IS
'Steel price v4.2 rows imported atomically from products_db_ready; erp_item_code is row identity and spec_key is non-unique keyword text.';
