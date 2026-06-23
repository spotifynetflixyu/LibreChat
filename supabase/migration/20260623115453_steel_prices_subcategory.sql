ALTER TABLE steel.prices
  ADD COLUMN IF NOT EXISTS subcategory TEXT,
  ADD COLUMN IF NOT EXISTS source_subcategory_label TEXT;

CREATE INDEX IF NOT EXISTS prices_kind_category_subcategory_idx
ON steel.prices (price_kind, category, subcategory);

CREATE INDEX IF NOT EXISTS prices_subcategory_trgm_idx
ON steel.prices USING GIN (subcategory gin_trgm_ops)
WHERE subcategory IS NOT NULL;

CREATE INDEX IF NOT EXISTS prices_source_subcategory_trgm_idx
ON steel.prices USING GIN (source_subcategory_label gin_trgm_ops)
WHERE source_subcategory_label IS NOT NULL;

COMMENT ON COLUMN steel.prices.subcategory IS
'Normalized price subcategory, primarily for cutting tables such as H型鋼, 工字鐵/H型鋼, 管, 角鐵, 槽鐵, 平鐵/扁鐵.';

COMMENT ON COLUMN steel.prices.source_subcategory_label IS
'Source worksheet 次類別 label after reviewed cleanup.';
