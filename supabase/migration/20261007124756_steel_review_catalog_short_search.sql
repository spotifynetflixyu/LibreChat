CREATE FUNCTION steel.catalog_description_short_tokens(input_text text)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  WITH source AS (SELECT lower(COALESCE(input_text, '')) AS value)
  SELECT COALESCE(array_agg(DISTINCT substring(value FROM position FOR width)), ARRAY[]::text[])
  FROM source
  CROSS JOIN LATERAL generate_series(1, char_length(value)) AS positions(position)
  CROSS JOIN (VALUES (1), (2)) AS widths(width)
  WHERE position + width - 1 <= char_length(value);
$$;

CREATE INDEX prices_catalog_description_short_idx
ON steel.prices USING GIN (steel.catalog_description_short_tokens(product_name));
