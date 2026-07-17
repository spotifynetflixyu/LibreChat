BEGIN;

LOCK TABLE steel.cutting_prices IN ACCESS EXCLUSIVE MODE;

ALTER TABLE steel.cutting_prices
  ADD COLUMN height_mm NUMERIC(18, 9),
  ADD COLUMN width_mm NUMERIC(18, 9),
  DROP CONSTRAINT IF EXISTS cutting_prices_values_check,
  DROP CONSTRAINT IF EXISTS cutting_prices_required_text_check,
  DROP CONSTRAINT IF EXISTS cutting_prices_record_type_check,
  DROP CONSTRAINT IF EXISTS cutting_prices_conditions_check,
  DROP CONSTRAINT IF EXISTS cutting_prices_source_row_check,
  DROP CONSTRAINT IF EXISTS cutting_prices_source_row_unique,
  DROP CONSTRAINT IF EXISTS cutting_prices_spec_selector_check;

DROP INDEX IF EXISTS steel.cutting_prices_record_type_idx;
DROP INDEX IF EXISTS steel.cutting_prices_category_trgm_idx;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM steel.cutting_prices
    WHERE cutting_category IN ('H型鋼', '工字鐵/H型鋼')
      AND (
        spec_text IS NULL
        OR regexp_replace(
          translate(spec_text, 'X×＊*', 'xxxx'),
          '\s+',
          '',
          'g'
        ) !~ '^\d+(\.\d+)?x\d+(\.\d+)?$'
      )
  ) THEN
    RAISE EXCEPTION 'H-family cutting rows require an AxB spec_text before dimension migration';
  END IF;
END
$$;

WITH normalized_h_specs AS (
  SELECT
    id,
    regexp_replace(translate(spec_text, 'X×＊*', 'xxxx'), '\s+', '', 'g') AS dimensions
  FROM steel.cutting_prices
  WHERE cutting_category IN ('H型鋼', '工字鐵/H型鋼')
)
UPDATE steel.cutting_prices AS cutting
SET
  height_mm = split_part(spec.dimensions, 'x', 1)::NUMERIC,
  width_mm = split_part(spec.dimensions, 'x', 2)::NUMERIC,
  mm_min = NULL,
  mm_max = NULL
FROM normalized_h_specs AS spec
WHERE cutting.id = spec.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM steel.cutting_prices
    WHERE cutting_category IN ('H型鋼', '工字鐵/H型鋼')
      AND (
        height_mm IS NULL OR height_mm <= 0
        OR width_mm IS NULL OR width_mm <= 0
        OR inch_min IS NOT NULL OR inch_max IS NOT NULL
        OR mm_min IS NOT NULL OR mm_max IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'H-family cutting dimension backfill failed';
  END IF;
END
$$;

ALTER TABLE steel.cutting_prices
  DROP COLUMN record_type,
  DROP COLUMN conditions,
  DROP COLUMN calculation_rule,
  DROP COLUMN source_sheet,
  DROP COLUMN source_row,
  DROP COLUMN spec_selector,
  DROP COLUMN thickness_axis,
  DROP COLUMN normalized_spec_text,
  ADD CONSTRAINT cutting_prices_required_text_check
  CHECK (
    BTRIM(cutting_category) <> ''
    AND BTRIM(item_name) <> ''
    AND BTRIM(cut_type) <> ''
  ),
  ADD CONSTRAINT cutting_prices_profile_dimensions_check
  CHECK (
    (
      cutting_category IN ('H型鋼', '工字鐵/H型鋼')
      AND height_mm > 0
      AND width_mm > 0
    )
    OR (
      cutting_category NOT IN ('H型鋼', '工字鐵/H型鋼')
      AND height_mm IS NULL
      AND width_mm IS NULL
    )
  ),
  ADD CONSTRAINT cutting_prices_values_check
  CHECK (
    (unit_price_a IS NULL OR unit_price_a >= 0)
    AND (unit_price_b IS NULL OR unit_price_b >= 0)
    AND (unit_price_c IS NULL OR unit_price_c >= 0)
    AND (unit_price_f IS NULL OR unit_price_f >= 0)
    AND (
      (
        cutting_category IN ('H型鋼', '工字鐵/H型鋼')
        AND inch_min IS NULL AND inch_max IS NULL
        AND mm_min IS NULL AND mm_max IS NULL
      )
      OR (
        cutting_category NOT IN ('H型鋼', '工字鐵/H型鋼')
        AND (
          (
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
      )
    )
    AND (
      (
        thickness_mm_values IS NULL
        AND thickness_mm_min IS NULL
        AND thickness_mm_max IS NULL
      )
      OR (
        thickness_mm_values IS NOT NULL
        AND cardinality(thickness_mm_values) > 0
        AND 0 < ALL(thickness_mm_values)
        AND thickness_mm_min IS NULL
        AND thickness_mm_max IS NULL
      )
      OR (
        thickness_mm_values IS NULL
        AND (thickness_mm_min IS NOT NULL OR thickness_mm_max IS NOT NULL)
        AND (thickness_mm_min IS NULL OR thickness_mm_min > 0)
        AND (thickness_mm_max IS NULL OR thickness_mm_max > 0)
        AND (
          thickness_mm_min IS NULL
          OR thickness_mm_max IS NULL
          OR thickness_mm_min <= thickness_mm_max
        )
      )
    )
  );

CREATE INDEX cutting_prices_category_idx
ON steel.cutting_prices (cutting_category);

COMMENT ON COLUMN steel.cutting_prices.height_mm IS
  'H型鋼 or 工字鐵/H型鋼 profile height in millimeters.';

COMMENT ON COLUMN steel.cutting_prices.width_mm IS
  'H型鋼 or 工字鐵/H型鋼 profile width in millimeters.';

COMMENT ON TABLE steel.cutting_prices IS
  'Price-only 加工/切工 catalog atomically imported from docs/reference/切工價錢-raw.xlsx.';

COMMIT;
