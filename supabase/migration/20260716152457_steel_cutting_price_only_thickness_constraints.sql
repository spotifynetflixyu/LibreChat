BEGIN;

DELETE FROM steel.cutting_prices
WHERE record_type IS DISTINCT FROM 'price'
  OR spec_selector IS NULL;

ALTER TABLE steel.cutting_prices
  DROP CONSTRAINT IF EXISTS cutting_prices_record_type_check,
  DROP CONSTRAINT IF EXISTS cutting_prices_spec_selector_check,
  DROP CONSTRAINT IF EXISTS cutting_prices_values_check,
  DROP CONSTRAINT IF EXISTS cutting_prices_supplement_check,
  DROP CONSTRAINT IF EXISTS cutting_prices_unit_check;

ALTER TABLE steel.cutting_prices
  ADD COLUMN IF NOT EXISTS thickness_axis TEXT,
  ADD COLUMN IF NOT EXISTS thickness_mm_values NUMERIC(18, 9)[],
  ADD COLUMN IF NOT EXISTS thickness_mm_min NUMERIC(18, 9),
  ADD COLUMN IF NOT EXISTS thickness_mm_max NUMERIC(18, 9);

UPDATE steel.cutting_prices
SET
  mm_min = CASE
    WHEN spec_selector->'selectors'->0->'axes' ? 'height_mm'
      THEN (spec_selector#>>'{selectors,0,axes,height_mm,value}')::NUMERIC
    WHEN spec_selector->'selectors'->0->'axes' ? 'nominal_size_mm'
      THEN (spec_selector#>>'{selectors,0,axes,nominal_size_mm,value}')::NUMERIC
    WHEN spec_selector->'selectors'->0->'axes' ? 'outer_size_mm'
      THEN (spec_selector#>>'{selectors,0,axes,outer_size_mm,value}')::NUMERIC
    WHEN spec_selector->'selectors'->0->'axes' ? 'long_leg_mm'
      THEN (spec_selector#>>'{selectors,0,axes,long_leg_mm,value}')::NUMERIC
    WHEN spec_selector->'selectors'->0->'axes' ? 'width_mm'
      THEN COALESCE(
        (spec_selector#>>'{selectors,0,axes,width_mm,value}')::NUMERIC,
        (spec_selector#>>'{selectors,0,axes,width_mm,min}')::NUMERIC
      )
    ELSE NULL
  END,
  mm_max = CASE
    WHEN spec_selector->'selectors'->0->'axes' ? 'height_mm'
      THEN (spec_selector#>>'{selectors,0,axes,height_mm,value}')::NUMERIC
    WHEN spec_selector->'selectors'->0->'axes' ? 'nominal_size_mm'
      THEN (spec_selector#>>'{selectors,0,axes,nominal_size_mm,value}')::NUMERIC
    WHEN spec_selector->'selectors'->0->'axes' ? 'outer_size_mm'
      THEN (spec_selector#>>'{selectors,0,axes,outer_size_mm,value}')::NUMERIC
    WHEN spec_selector->'selectors'->0->'axes' ? 'long_leg_mm'
      THEN (spec_selector#>>'{selectors,0,axes,long_leg_mm,value}')::NUMERIC
    WHEN spec_selector->'selectors'->0->'axes' ? 'width_mm'
      THEN COALESCE(
        (spec_selector#>>'{selectors,0,axes,width_mm,value}')::NUMERIC,
        (spec_selector#>>'{selectors,0,axes,width_mm,max}')::NUMERIC
      )
    ELSE NULL
  END,
  thickness_axis = CASE
    WHEN spec_selector->'selectors'->0->'axes' ? 'flange_thickness_mm' THEN 'flange'
    WHEN spec_selector->'selectors'->0->'axes' ? 'thickness_mm' THEN 'material'
    ELSE NULL
  END,
  thickness_mm_values = CASE
    WHEN spec_selector#>>'{selectors,0,axes,thickness_mm,kind}' = 'exact'
      THEN ARRAY[(spec_selector#>>'{selectors,0,axes,thickness_mm,value}')::NUMERIC]
    WHEN spec_selector#>>'{selectors,0,axes,thickness_mm,kind}' = 'one_of'
      THEN ARRAY(
        SELECT value::NUMERIC
        FROM jsonb_array_elements_text(
          spec_selector#>'{selectors,0,axes,thickness_mm,values}'
        ) AS value
        ORDER BY value::NUMERIC
      )
    ELSE NULL
  END,
  thickness_mm_min = CASE
    WHEN spec_selector#>>'{selectors,0,axes,flange_thickness_mm,kind}' = 'minimum'
      THEN (spec_selector#>>'{selectors,0,axes,flange_thickness_mm,value}')::NUMERIC
    WHEN spec_selector#>>'{selectors,0,axes,thickness_mm,kind}' = 'range'
      THEN (spec_selector#>>'{selectors,0,axes,thickness_mm,min}')::NUMERIC
    ELSE NULL
  END,
  thickness_mm_max = CASE
    WHEN spec_selector#>>'{selectors,0,axes,thickness_mm,kind}' = 'range'
      THEN (spec_selector#>>'{selectors,0,axes,thickness_mm,max}')::NUMERIC
    ELSE NULL
  END;

ALTER TABLE steel.cutting_prices
  ALTER COLUMN record_type SET NOT NULL,
  ALTER COLUMN spec_selector SET NOT NULL,
  ADD CONSTRAINT cutting_prices_record_type_check CHECK (record_type = 'price'),
  ADD CONSTRAINT cutting_prices_spec_selector_check CHECK (
    jsonb_typeof(spec_selector) = 'object'
    AND spec_selector->>'version' = '1'
    AND spec_selector->>'match' = 'any'
    AND jsonb_typeof(spec_selector->'selectors') = 'array'
    AND jsonb_array_length(spec_selector->'selectors') > 0
  ),
  ADD CONSTRAINT cutting_prices_values_check CHECK (
    (unit_price_a IS NULL OR unit_price_a >= 0)
    AND (unit_price_b IS NULL OR unit_price_b >= 0)
    AND (unit_price_c IS NULL OR unit_price_c >= 0)
    AND (unit_price_f IS NULL OR unit_price_f >= 0)
    AND (
      (
        inch_min IS NULL AND inch_max IS NULL
        AND mm_min IS NULL AND mm_max IS NULL
        AND cutting_category = 'H型鋼'
        AND cut_type IN ('加工/孔', '加工/倒角', '加工/開槽')
      )
      OR (
        inch_min IS NULL AND inch_max IS NULL
        AND mm_min IS NOT NULL AND mm_max IS NOT NULL
        AND mm_min > 0 AND mm_max > 0 AND mm_min <= mm_max
      )
      OR (
        inch_min IS NOT NULL AND inch_max IS NOT NULL
        AND mm_min IS NOT NULL AND mm_max IS NOT NULL
        AND inch_min > 0 AND inch_max > 0 AND inch_min <= inch_max
        AND mm_min > 0 AND mm_max > 0 AND mm_min <= mm_max
        AND mm_min = ROUND(inch_min * 25.4, 9)
        AND mm_max = ROUND(inch_max * 25.4, 9)
      )
    )
    AND (
      thickness_axis IS NULL
      AND thickness_mm_values IS NULL
      AND thickness_mm_min IS NULL
      AND thickness_mm_max IS NULL
      OR thickness_axis IN ('material', 'flange')
      AND (
        (
          thickness_mm_values IS NOT NULL
          AND cardinality(thickness_mm_values) > 0
          AND 0 < ALL(thickness_mm_values)
          AND thickness_mm_min IS NULL
          AND thickness_mm_max IS NULL
        )
        OR (thickness_mm_values IS NULL AND (thickness_mm_min IS NOT NULL OR thickness_mm_max IS NOT NULL) AND (thickness_mm_min IS NULL OR thickness_mm_min > 0) AND (thickness_mm_max IS NULL OR thickness_mm_max > 0) AND (thickness_mm_min IS NULL OR thickness_mm_max IS NULL OR thickness_mm_min <= thickness_mm_max))
      )
    )
  ),
  ADD CONSTRAINT cutting_prices_unit_check CHECK (unit = '刀');

COMMENT ON TABLE steel.cutting_prices IS
  'Price-only cutting catalog atomically imported from docs/reference/切工價錢-raw.xlsm; non-price supplement rows are excluded.';

COMMIT;
