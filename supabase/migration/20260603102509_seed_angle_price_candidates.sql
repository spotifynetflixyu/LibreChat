BEGIN;

SET search_path = steel, public;

WITH tier_seed (code, name, priority) AS (
  VALUES
    ('A', 'A級', 10),
    ('B', 'B級', 20),
    ('C', 'C級', 30),
    ('F', 'F級', 40)
)
INSERT INTO steel.customer_tiers (
  code,
  name,
  priority,
  source_refs
)
SELECT
  code,
  name,
  priority,
  '[
    {
      "channel": "admin_erp_xlsx",
      "factType": "customer_tier",
      "sourceFile": "docs/reference/產品價格.xlsx",
      "locator": "Sheet1!E5:H5",
      "canonicalKey": "selling_price_tier"
    }
  ]'::jsonb
FROM tier_seed
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  priority = EXCLUDED.priority,
  updated_at = NOW();

WITH price_seed (
  erp_item_code,
  source_product_name,
  product_name,
  spec_key,
  tier_code,
  unit_price,
  product_price_unit_weight,
  source_row,
  source_price_column
) AS (
  VALUES
    ('ELD12025', '錏成型角鐵30*2.5*6M(6.7)', '錏成型角鐵', 'angle_L30x30x2.5x6M', 'A', 194.3000, 6.70000, 2720, '售價A'),
    ('ELD12025', '錏成型角鐵30*2.5*6M(6.7)', '錏成型角鐵', 'angle_L30x30x2.5x6M', 'B', 201.0000, 6.70000, 2720, '售價B'),
    ('ELD12025', '錏成型角鐵30*2.5*6M(6.7)', '錏成型角鐵', 'angle_L30x30x2.5x6M', 'C', 190.9500, 6.70000, 2720, '售價C'),
    ('ELD12025', '錏成型角鐵30*2.5*6M(6.7)', '錏成型角鐵', 'angle_L30x30x2.5x6M', 'F', 180.9000, 6.70000, 2720, '售價F'),
    ('ELG12030', '熱浸鍍鋅角鐵30*3.0(8.8)', '熱浸鍍鋅角鐵', 'angle_L30x30x3.0x6M', 'A', 422.4000, 8.80000, 2729, '售價A'),
    ('ELG12030', '熱浸鍍鋅角鐵30*3.0(8.8)', '熱浸鍍鋅角鐵', 'angle_L30x30x3.0x6M', 'B', 438.2400, 8.80000, 2729, '售價B'),
    ('ELG12030', '熱浸鍍鋅角鐵30*3.0(8.8)', '熱浸鍍鋅角鐵', 'angle_L30x30x3.0x6M', 'C', 418.0000, 8.80000, 2729, '售價C'),
    ('ELG12030', '熱浸鍍鋅角鐵30*3.0(8.8)', '熱浸鍍鋅角鐵', 'angle_L30x30x3.0x6M', 'F', 418.0000, 8.80000, 2729, '售價F'),
    ('ELB12025', '黑角鐵30*2.5(6.84)', '黑角鐵', 'angle_L30x30x2.5x6M', 'A', 196.3100, 6.90000, 2604, '售價A'),
    ('ELB12025', '黑角鐵30*2.5(6.84)', '黑角鐵', 'angle_L30x30x2.5x6M', 'B', 201.1000, 6.90000, 2604, '售價B'),
    ('ELB12025', '黑角鐵30*2.5(6.84)', '黑角鐵', 'angle_L30x30x2.5x6M', 'C', 190.8400, 6.90000, 2604, '售價C'),
    ('ELB12030', '黑角鐵30*3.0(8.16)', '黑角鐵', 'angle_L30x30x3.0x6M', 'A', 234.1900, 8.20000, 2607, '售價A'),
    ('ELB12030', '黑角鐵30*3.0(8.16)', '黑角鐵', 'angle_L30x30x3.0x6M', 'B', 239.9000, 8.20000, 2607, '售價B'),
    ('ELB12030', '黑角鐵30*3.0(8.16)', '黑角鐵', 'angle_L30x30x3.0x6M', 'C', 227.6600, 8.20000, 2607, '售價C')
),
tiered_price_seed AS (
  SELECT
    price_seed.*,
    customer_tiers.id AS customer_tier_id
  FROM price_seed
  JOIN steel.customer_tiers ON customer_tiers.code = price_seed.tier_code
)
INSERT INTO steel.price_items (
  erp_item_code,
  customer_tier_id,
  spec_key,
  product_name,
  unit,
  unit_price,
  product_price_unit_weight,
  product_price_unit_weight_unit,
  currency,
  effective_from,
  active,
  value_state,
  review_state,
  metadata,
  source_refs
)
SELECT
  erp_item_code,
  customer_tier_id,
  spec_key,
  product_name,
  'piece',
  unit_price,
  product_price_unit_weight,
  'kg_per_piece',
  'TWD',
  DATE '2026-05-18',
  true,
  'confirmed',
  'reviewed',
  jsonb_build_object(
    'sourceProductName', source_product_name,
    'sourceTierCode', tier_code,
    'derivedSpecKeyReason', '30 in source product name normalized to equal angle 30x30 for L30x30 candidate lookup'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'channel', 'admin_erp_xlsx',
      'factType', 'product_price',
      'sourceFile', 'docs/reference/產品價格.xlsx',
      'locator', format('Sheet1!A%s:H%s', source_row, source_row),
      'canonicalKey', source_price_column
    )
  )
FROM tiered_price_seed
ON CONFLICT DO NOTHING;

COMMIT;
