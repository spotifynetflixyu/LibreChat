ALTER TABLE steel.prices
ADD COLUMN product_name_short_tokens text[]
GENERATED ALWAYS AS (steel.catalog_description_short_tokens(product_name)) STORED;

DROP INDEX steel.prices_catalog_description_short_idx;
CREATE INDEX prices_catalog_description_short_idx
ON steel.prices USING GIN (product_name_short_tokens);

ANALYZE steel.prices;
