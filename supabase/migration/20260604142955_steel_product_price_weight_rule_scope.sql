BEGIN;

INSERT INTO steel.catalog_families (
  key,
  display_name_zh,
  aliases,
  metadata,
  active,
  review_state,
  source_refs
)
VALUES (
  'rail',
  '鐵軌',
  '["鐵軌","軌道鋼","鋼軌"]'::jsonb,
  '{"searchHints":["6K鐵軌","9K鐵軌","10M","6M"],"source":"docs/reference/產品價格.xlsx"}'::jsonb,
  true,
  'reviewed',
  '[{"channel":"admin_erp_xlsx","factType":"catalog_family","sourceFile":"docs/reference/產品價格.xlsx","locator":"product names containing 鐵軌","canonicalKey":"rail"}]'::jsonb
)
ON CONFLICT (key) DO UPDATE SET
  display_name_zh = EXCLUDED.display_name_zh,
  aliases = EXCLUDED.aliases,
  metadata = steel.catalog_families.metadata || EXCLUDED.metadata,
  active = EXCLUDED.active,
  review_state = EXCLUDED.review_state,
  source_refs = EXCLUDED.source_refs,
  updated_at = NOW();

UPDATE steel.catalog_families
SET
  aliases = (
    SELECT jsonb_agg(DISTINCT alias)
    FROM (
      SELECT jsonb_array_elements_text(aliases) AS alias
      UNION ALL
      SELECT unnest(ARRAY['輕量H', '輕量H型鋼']::text[]) AS alias
    ) AS alias_values
  ),
  metadata = metadata || '{"searchHints":["輕量H150","輕量H175","輕量H200"]}'::jsonb,
  updated_at = NOW()
WHERE key = 'h_beam';

WITH family_map AS (
  SELECT *
  FROM (
    VALUES
      ('EHC', 'h_beam'),
      ('ERB', 'rail'),
      ('BNA', 'plate'),
      ('BNS', 'plate'),
      ('BNH', 'plate'),
      ('BNT', 'plate'),
      ('BXS', 'plate'),
      ('BXB', 'ot_plate'),
      ('BXH', 'galvanized_plate')
  ) AS mapped(prefix, catalog_family)
),
price_item_family_updates AS (
  SELECT
    price_item.id,
    family_map.catalog_family
  FROM steel.price_items AS price_item
  JOIN family_map
    ON price_item.erp_item_code LIKE family_map.prefix || '%'
  WHERE price_item.last_import_log_id = 'docs-reference-product-prices-v1'
    AND price_item.catalog_family IS DISTINCT FROM family_map.catalog_family
)
UPDATE steel.price_items AS price_item
SET
  catalog_family = price_item_family_updates.catalog_family,
  metadata = COALESCE(price_item.metadata, '{}'::jsonb) || jsonb_build_object(
    'catalogFamilyMatch',
    jsonb_build_object(
      'key',
      price_item_family_updates.catalog_family,
      'matchedBy',
      'migration:steel_product_price_weight_rule_scope'
    )
  ),
  updated_at = NOW()
FROM price_item_family_updates
WHERE price_item.id = price_item_family_updates.id;

WITH family_map AS (
  SELECT *
  FROM (
    VALUES
      ('erp_ehc', 'h_beam'),
      ('erp_erb', 'rail'),
      ('erp_bna', 'plate'),
      ('erp_bns', 'plate'),
      ('erp_bnh', 'plate'),
      ('erp_bnt', 'plate'),
      ('erp_bxs', 'plate'),
      ('erp_bxb', 'ot_plate'),
      ('erp_bxh', 'galvanized_plate')
  ) AS mapped(category_code, catalog_family)
)
UPDATE steel.price_categories AS category
SET
  catalog_family = family_map.catalog_family,
  metadata = COALESCE(category.metadata, '{}'::jsonb) || jsonb_build_object(
    'catalogFamilyMatch',
    'migration:steel_product_price_weight_rule_scope'
  ),
  updated_at = NOW()
FROM family_map
WHERE category.code = family_map.category_code
  AND category.catalog_family IS DISTINCT FROM family_map.catalog_family;

WITH material_families AS (
  SELECT ARRAY[
    'b_pipe',
    'a_pipe',
    'p_pipe',
    'steel_pipe',
    'piping',
    'i_beam',
    'round_bar',
    'square_bar',
    'galvanized_plate',
    'ot_plate',
    'black_plate',
    'grating',
    'floor_deck',
    'h_beam',
    'c_type',
    'wire_mesh',
    'expanded_metal',
    'angle',
    'channel',
    'flat_bar',
    'rail',
    'rectangular_pipe',
    'round_pipe',
    'square_pipe',
    'corrugated_panel',
    'plate'
  ]::text[] AS families
),
price_item_sources AS (
  SELECT
    price_item.id,
    price_item.product_name,
    price_item.catalog_family,
    price_item.unit_price,
    price_item.product_price_unit_weight,
    price_item.product_price_unit_weight_unit,
    price_item.metadata,
    price_item.source_refs,
    price_item.unit,
    NULLIF(price_item.metadata->>'sourceRatio', '')::numeric AS source_ratio,
    NULLIF(price_item.metadata->>'sourceUnitWeightColumn', '')::numeric AS source_unit_weight_column,
    COALESCE(
      NULLIF((regexp_match(price_item.product_name, '[0-9]+[.]?[0-9]*[[:space:]]*[mMＭ][[:space:]]*\([[:space:]]*([0-9]+[.]?[0-9]*)[[:space:]]*\)'))[1], '')::numeric,
      NULLIF((regexp_match(price_item.product_name, '\([[:space:]]*([0-9]+[.]?[0-9]*)[[:space:]]*\)[[:space:]]*$'))[1], '')::numeric
    ) AS parenthetical_weight,
    price_item.catalog_family = ANY((SELECT families FROM material_families)::text[]) AS applies_weight_rule
  FROM steel.price_items AS price_item
  WHERE price_item.last_import_log_id = 'docs-reference-product-prices-v1'
),
effective_price_items AS (
  SELECT
    *,
    CASE
      WHEN applies_weight_rule
        AND source_unit_weight_column IS NOT NULL
        AND source_unit_weight_column > 0
      THEN source_unit_weight_column
      WHEN applies_weight_rule
        AND product_price_unit_weight IS NOT NULL
        AND product_price_unit_weight > 0
        AND COALESCE(metadata->>'sourceUnitWeightOrigin', '') = 'unit_weight_column'
      THEN product_price_unit_weight
      WHEN applies_weight_rule
        AND parenthetical_weight IS NOT NULL
        AND parenthetical_weight > 0
        AND source_ratio IS NOT NULL
        AND source_ratio > 0
        AND unit_price IS NOT NULL
        AND ABS(unit_price - (parenthetical_weight * source_ratio)) <= 0.05
      THEN parenthetical_weight
      ELSE NULL
    END AS effective_weight,
    CASE
      WHEN applies_weight_rule
        AND source_unit_weight_column IS NOT NULL
        AND source_unit_weight_column > 0
      THEN 'unit_weight_column'
      WHEN applies_weight_rule
        AND product_price_unit_weight IS NOT NULL
        AND product_price_unit_weight > 0
        AND COALESCE(metadata->>'sourceUnitWeightOrigin', '') = 'unit_weight_column'
      THEN 'unit_weight_column'
      WHEN applies_weight_rule
        AND parenthetical_weight IS NOT NULL
        AND parenthetical_weight > 0
        AND source_ratio IS NOT NULL
        AND source_ratio > 0
        AND unit_price IS NOT NULL
        AND ABS(unit_price - (parenthetical_weight * source_ratio)) <= 0.05
      THEN 'product_name_parentheses'
      ELSE NULL
    END AS unit_weight_origin,
    CASE
      WHEN product_name ~* '[0-9]+(\.[0-9]+)?[[:space:]]*m([^/[:alpha:]]|$)'
        OR product_name ~ '[0-9]+(\.[0-9]+)?[[:space:]]*Ｍ([^/[:alpha:]]|$)'
      THEN true
      ELSE false
    END AS has_fixed_length_m
  FROM price_item_sources
),
classified_price_items AS (
  SELECT
    *,
    CASE
      WHEN NOT applies_weight_rule THEN 'per_piece_or_unit'
      WHEN effective_weight IS NOT NULL
        AND effective_weight > 0
        AND source_ratio IS NOT NULL
        AND source_ratio > 0
        AND unit_price IS NOT NULL
        AND ABS(unit_price - (effective_weight * source_ratio)) <= 0.05
      THEN 'per_piece_total'
      WHEN effective_weight IS NOT NULL
        AND effective_weight > 0
        AND source_ratio IS NOT NULL
        AND source_ratio > 0
        AND unit_price IS NOT NULL
        AND unit_price > 0
        AND has_fixed_length_m
      THEN 'per_piece_total'
      WHEN effective_weight IS NOT NULL AND effective_weight > 0
      THEN 'per_kg'
      ELSE 'per_piece_or_unit'
    END AS price_unit_basis,
    CASE
      WHEN NOT applies_weight_rule OR effective_weight IS NULL OR effective_weight <= 0
      THEN NULL
      WHEN (
        source_ratio IS NOT NULL
        AND source_ratio > 0
        AND unit_price IS NOT NULL
        AND ABS(unit_price - (effective_weight * source_ratio)) <= 0.05
      )
        OR has_fixed_length_m
      THEN 'kg_per_piece'
      ELSE 'kg_per_m'
    END AS weight_unit
  FROM effective_price_items
)
UPDATE steel.price_items AS price_item
SET
  product_price_unit_weight = classified_price_items.effective_weight,
  product_price_unit_weight_unit = classified_price_items.weight_unit,
  unit = CASE
    WHEN NOT classified_price_items.applies_weight_rule THEN 'piece'
    WHEN classified_price_items.weight_unit IS NULL THEN 'piece'
    WHEN classified_price_items.price_unit_basis = 'per_piece_total' THEN 'piece'
    ELSE 'kg'
  END,
  metadata = COALESCE(price_item.metadata, '{}'::jsonb) || jsonb_build_object(
    'sourcePriceUnitBasis',
    classified_price_items.price_unit_basis,
    'sourceUnitWeightOrigin',
    classified_price_items.unit_weight_origin,
    'sourceUnitWeightColumn',
    classified_price_items.source_unit_weight_column,
    'sourceParentheticalUnitWeight',
    CASE
      WHEN classified_price_items.applies_weight_rule
        AND classified_price_items.effective_weight IS NOT NULL
        AND classified_price_items.effective_weight > 0
      THEN classified_price_items.parenthetical_weight
      ELSE NULL
    END,
    'productPriceWeightRuleScope',
    CASE
      WHEN classified_price_items.applies_weight_rule THEN 'steel_material'
      ELSE 'not_steel_material'
    END
  ),
  updated_at = NOW()
FROM classified_price_items
WHERE price_item.id = classified_price_items.id
  AND (
    price_item.product_price_unit_weight IS DISTINCT FROM classified_price_items.effective_weight
    OR price_item.product_price_unit_weight_unit IS DISTINCT FROM classified_price_items.weight_unit
    OR price_item.unit IS DISTINCT FROM CASE
      WHEN NOT classified_price_items.applies_weight_rule THEN 'piece'
      WHEN classified_price_items.weight_unit IS NULL THEN 'piece'
      WHEN classified_price_items.price_unit_basis = 'per_piece_total' THEN 'piece'
      ELSE 'kg'
    END
    OR COALESCE(price_item.metadata->>'sourcePriceUnitBasis', '') IS DISTINCT FROM classified_price_items.price_unit_basis
    OR COALESCE(price_item.metadata->>'sourceUnitWeightOrigin', '') IS DISTINCT FROM COALESCE(classified_price_items.unit_weight_origin, '')
    OR COALESCE(price_item.metadata->>'productPriceWeightRuleScope', '') IS DISTINCT FROM CASE
      WHEN classified_price_items.applies_weight_rule THEN 'steel_material'
      ELSE 'not_steel_material'
    END
  );

UPDATE steel.instruction_packets
SET
  selectors = '{"taskTypes":["material_price_lookup","formula_selection","confirmation_policy"],"catalogFamilies":["h_beam","c_type","angle","channel","flat_bar","rail","b_pipe","a_pipe","p_pipe","steel_pipe","piping","i_beam","round_bar","square_bar","rectangular_pipe","round_pipe","square_pipe","plate","galvanized_plate","ot_plate","black_plate","grating","wire_mesh","expanded_metal","floor_deck","corrugated_panel"],"priceFields":["unit","unitPrice","productPriceUnitWeight","productPriceUnitWeightUnit","metadata.sourceRatio","metadata.sourcePriceUnitBasis","metadata.sourceUnitWeightColumn","metadata.sourceUnitWeightOrigin","metadata.sourceParentheticalUnitWeight","metadata.productPriceWeightRuleScope"]}'::jsonb,
  instruction = '產品價格.xlsx 的 unitPrice 必須搭配 unit、productPriceUnitWeight 與 productPriceUnitWeightUnit 解讀，不可只因使用者問一支多少就把 unitPrice 當作每支總價。unit 表示售價欄單位；productPriceUnitWeightUnit 表示重量欄語意。此規則只套用鋼材/材料 stock catalog families，例如 h_beam（含輕量H）、c_type、angle、channel、flat_bar、rail、pipe families、plate families、mesh、grating、floor deck。非鋼材或非材料產品/accessory rows，例如彈簧、螺絲、門鎖、角輪、鋁窗、樹脂、鐵門、伸縮門、量尺等，不套用這套 kg/m、kg/支換算規則；除非有另外 reviewed rule，否則按該 row 的 unitPrice 直接作件/組/支價或 manual review。productPriceUnitWeightUnit = kg_per_m 且 unit = kg 時，productPriceUnitWeight 是 kg/m，unitPrice 是每 kg 售價，材料金額 = kgPerM * lengthM * quantity * unitPrice。例：C型鋼 C100x50x20x2.3t 6M 一支多少，若 reviewed row 是 錏輕型鋼 100x2.3、unit = kg、unitPrice = 25-26.8、productPriceUnitWeight = 4kg/m，則一支 6M 是 24kg，暫估材料價約 NT$600-643.2，不可回答 NT$25-26.8/支。品名或規格有固定長度 M 且 productPriceUnitWeightUnit = kg_per_piece 時，productPriceUnitWeight 是重量/支；若 unit = kg，整支金額是 pieceWeightKg * quantityPieces * unitPrice；若 unit = piece，unitPrice 已是整支金額。若單位重欄位是 0，但品名最後括號內有數字且 reviewed row 可用 售價 = 括號重量 * 比率 驗證，括號數字就是重量/支補漏來源。例：白鐵平鐵 50 *8.0( 19.7) 的 A 價 2107.90、比率 107.00，所以 19.7 * 107 = 2107.9；此 row 應以 19.7kg/支、unit = piece 判讀。若單位重欄位已有正值，欄位值優先於品名括號；括號只能作補漏來源，不能覆蓋 reviewed 欄位值。例：6K鐵軌 6M(38) 的單位重=36，且 9K鐵軌 6M(54) 可佐證比例，因此 6K 鐵軌採 36kg/支，不可採括號 38。固定長度材料 row 若有正值比率欄且售價欄為整支價，即使該整支價看起來是用錯誤括號重量算出，也不可把售價當每 kg 單價。例：6K鐵軌 A 價 2090 與比率 55 對應錯誤括號 38，但重量仍採單位重=36；報價可先把 2090 視為整支價，並把重量矛盾標示為待確認/推論。若單位重缺失或來源互相矛盾，可以查相同系列、相同規格、不同長度或相近材料的 reviewed rows，用長度比例或規格比例換算作推論 evidence；這類結果必須標示 inferred/low confidence 或待確認，不可靜默覆蓋 reviewed 欄位值。輕量H 例如 輕量H150*75*3.2/4.5*6M(53) 屬於 H 型鋼材料；BNH 屬於鋼材/板材材料。這兩類不可留在 fallback ERP family 後跳過材料計價規則。',
  blocking_rules = ARRAY[
    '不要把 productPriceUnitWeightUnit = kg_per_m 的 unitPrice 當成 per-piece price。',
    '不要只看 productPriceUnitWeightUnit 就決定售價單位；必須同時看 reviewed row 的 unit。',
    '不要把非鋼材或非材料產品/accessory row 套用鋼材 kg/m、kg/支計算規則。',
    '不要用品名括號覆蓋正值單位重欄位；括號只在欄位為 0/缺失且可驗證時補漏。',
    '不要把固定長度材料 row 的整支售價誤當每 kg 單價。',
    '不要把相近材料比例推論當成 reviewed 欄位值；推論值必須標示 inferred/low confidence 或待確認。',
    '不要用 0 或空白單位重計算材料金額。'
  ]::text[],
  user_visible_notes = ARRAY[
    '產品價格列若是 kg_per_m，售價是每 kg，必須先依長度換算重量再乘售價。',
    '固定長度 M 的產品列通常是整支計價；餘料不計價必須由使用者明確指定。',
    '非鋼材或非材料產品/accessory row 不套用鋼材重量換算規則。',
    '單位重欄位為 0 時，品名括號重量若可由售價與比率驗證，可作重量/支補漏來源；欄位有正值時欄位優先。',
    '單位重若需用相關材料推論，必須標示為推論並請使用者確認。'
  ]::text[],
  updated_at = NOW()
WHERE slug = 'product-price-unit-weight-calculation-zh-v1'
  AND version = 1;

COMMIT;
