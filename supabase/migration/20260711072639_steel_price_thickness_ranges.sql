ALTER TABLE steel.prices
  ADD COLUMN IF NOT EXISTS thickness_min_mm NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS thickness_max_mm NUMERIC(18, 6);

UPDATE steel.prices
SET
  thickness_min_mm = BTRIM(source_thickness)::numeric,
  thickness_max_mm = BTRIM(source_thickness)::numeric
WHERE source_thickness ~ '^[[:space:]]*([0-9]+([.][0-9]*)?|[.][0-9]+)[[:space:]]*$'
  AND BTRIM(source_thickness)::numeric > 0;

WITH hole_ranges AS (
  SELECT
    id,
    regexp_match(
      COALESCE(normalized_spec_text, product_name, ''),
      '厚度[[:space:]]*([0-9]+[.]?[0-9]*)[[:space:]]*[-~～至][[:space:]]*([0-9]+[.]?[0-9]*)',
      'i'
    ) AS bounds
  FROM steel.prices
  WHERE category = '加工/孔'
)
UPDATE steel.prices AS prices
SET
  thickness_min_mm = hole_ranges.bounds[1]::numeric,
  thickness_max_mm = hole_ranges.bounds[2]::numeric
FROM hole_ranges
WHERE prices.id = hole_ranges.id
  AND hole_ranges.bounds IS NOT NULL;

ALTER TABLE steel.prices
  DROP CONSTRAINT IF EXISTS prices_thickness_range_check,
  ADD CONSTRAINT prices_thickness_range_check CHECK (
    (thickness_min_mm IS NULL AND thickness_max_mm IS NULL)
    OR (
      thickness_min_mm IS NOT NULL
      AND thickness_max_mm IS NOT NULL
      AND thickness_min_mm > 0
      AND thickness_max_mm > 0
      AND thickness_min_mm <= thickness_max_mm
    )
  );
