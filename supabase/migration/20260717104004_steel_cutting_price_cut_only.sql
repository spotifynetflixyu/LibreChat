BEGIN;

ALTER TABLE steel.cutting_prices
  DROP CONSTRAINT IF EXISTS cutting_prices_cut_type_check;

DELETE FROM steel.cutting_prices
WHERE record_type IS DISTINCT FROM 'price'
  OR cut_type IS DISTINCT FROM '加工/切工';

ALTER TABLE steel.cutting_prices
  ADD CONSTRAINT cutting_prices_cut_type_check
  CHECK (cut_type = '加工/切工');

COMMENT ON TABLE steel.cutting_prices IS
  'Price-only 加工/切工 catalog atomically imported from docs/reference/切工價錢-raw.xlsm; supplement and other processing rows are excluded.';

COMMIT;
