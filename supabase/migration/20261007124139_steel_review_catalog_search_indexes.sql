CREATE INDEX prices_catalog_model_idx
ON steel.prices ((lower(erp_item_code) COLLATE "C"), (id::text COLLATE "C"));

CREATE INDEX prices_catalog_description_trgm_idx
ON steel.prices USING GIN (lower(COALESCE(product_name, '')) gin_trgm_ops);
