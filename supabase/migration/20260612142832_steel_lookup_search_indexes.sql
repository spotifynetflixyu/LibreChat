CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS price_items_product_name_trgm_idx
ON steel.price_items USING GIN (product_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS price_items_spec_key_trgm_idx
ON steel.price_items USING GIN (spec_key gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customers_display_name_trgm_idx
ON steel.customers USING GIN (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customers_legal_name_trgm_idx
ON steel.customers USING GIN (legal_name gin_trgm_ops)
WHERE legal_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_aliases_alias_trgm_idx
ON steel.customer_aliases USING GIN (alias gin_trgm_ops);
