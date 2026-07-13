ALTER TABLE steel.prices DROP CONSTRAINT IF EXISTS prices_source_dataset_check;

ALTER TABLE steel.prices
  ADD CONSTRAINT prices_source_dataset_check
  CHECK (source_dataset IN ('product_price_v4_3', 'product_price_v4_4'));

COMMENT ON TABLE steel.prices IS
'Steel normalized product price v4.4 rows upserted atomically from products_db_ready; erp_item_code is row identity and spec_key is non-unique keyword text.';
