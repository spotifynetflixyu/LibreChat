ALTER TABLE steel.prices
  DROP COLUMN IF EXISTS ratio_a,
  DROP COLUMN IF EXISTS ratio_b,
  DROP COLUMN IF EXISTS ratio_c,
  DROP COLUMN IF EXISTS ratio_f;

COMMENT ON TABLE steel.prices IS
'Unified Steel price rows. Tier prices are stored only in unit_price_a, unit_price_b, unit_price_c, and unit_price_f; source 比率A-F columns are intentionally ignored and not persisted.';
