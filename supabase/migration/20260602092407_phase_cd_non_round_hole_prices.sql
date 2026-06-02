ALTER TABLE steel.hole_prices
  ADD COLUMN IF NOT EXISTS length_mm NUMERIC(10, 3),
  ADD COLUMN IF NOT EXISTS width_mm NUMERIC(10, 3),
  ADD COLUMN IF NOT EXISTS dimension_label TEXT;

ALTER TABLE steel.hole_prices
  DROP CONSTRAINT IF EXISTS hole_prices_length_mm_check,
  DROP CONSTRAINT IF EXISTS hole_prices_width_mm_check;

ALTER TABLE steel.hole_prices
  ADD CONSTRAINT hole_prices_length_mm_check
    CHECK (length_mm IS NULL OR length_mm > 0),
  ADD CONSTRAINT hole_prices_width_mm_check
    CHECK (width_mm IS NULL OR width_mm > 0);

CREATE INDEX IF NOT EXISTS hole_prices_non_round_lookup_idx
ON steel.hole_prices (hole_type, length_mm, width_mm, active);
