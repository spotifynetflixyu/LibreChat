BEGIN;

DROP TRIGGER IF EXISTS set_prices_updated_at ON steel.prices;
DROP INDEX IF EXISTS steel.prices_source_thickness_trgm_idx;

ALTER TABLE steel.prices
  DROP CONSTRAINT IF EXISTS prices_kind_check,
  DROP CONSTRAINT IF EXISTS prices_source_dataset_check,
  DROP CONSTRAINT IF EXISTS prices_currency_check,
  DROP CONSTRAINT IF EXISTS prices_source_refs_check,
  DROP COLUMN IF EXISTS price_kind,
  DROP COLUMN IF EXISTS source_dataset,
  DROP COLUMN IF EXISTS source_row_key,
  DROP COLUMN IF EXISTS normalized_spec_text,
  DROP COLUMN IF EXISTS dimension_signature,
  DROP COLUMN IF EXISTS source_thickness,
  DROP COLUMN IF EXISTS currency,
  DROP COLUMN IF EXISTS active,
  DROP COLUMN IF EXISTS source_refs,
  DROP COLUMN IF EXISTS imported_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS updated_at;

COMMENT ON TABLE steel.prices IS
'Steel normalized product price v4.4 rows upserted atomically from products_db_ready; erp_item_code is row identity and spec_key is canonical keyword text.';

COMMIT;
