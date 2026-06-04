BEGIN;

WITH price_item_sources AS (
  SELECT
    id,
    product_name,
    unit_price,
    product_price_unit_weight,
    metadata,
    source_refs,
    NULLIF(metadata->>'sourceRatio', '')::numeric AS source_ratio,
    NULLIF((regexp_match(product_name, '\([[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*\)[[:space:]]*$'))[1], '')::numeric AS parenthetical_weight
  FROM steel.price_items
),
effective_price_items AS (
  SELECT
    id,
    product_name,
    unit_price,
    product_price_unit_weight,
    metadata,
    source_refs,
    source_ratio,
    parenthetical_weight,
    CASE
      WHEN product_price_unit_weight IS NOT NULL AND product_price_unit_weight > 0
      THEN product_price_unit_weight
      WHEN parenthetical_weight IS NOT NULL
        AND parenthetical_weight > 0
        AND source_ratio IS NOT NULL
        AND source_ratio > 0
        AND unit_price IS NOT NULL
        AND ABS(unit_price - (parenthetical_weight * source_ratio)) <= 0.05
      THEN parenthetical_weight
      ELSE NULL
    END AS effective_weight,
    CASE
      WHEN product_price_unit_weight IS NOT NULL AND product_price_unit_weight > 0
      THEN 'unit_weight_column'
      WHEN parenthetical_weight IS NOT NULL
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
      WHEN effective_weight IS NOT NULL
        AND effective_weight > 0
        AND source_ratio IS NOT NULL
        AND source_ratio > 0
        AND unit_price IS NOT NULL
        AND ABS(unit_price - (effective_weight * source_ratio)) <= 0.05
      THEN 'per_piece_total'
      WHEN effective_weight IS NOT NULL AND effective_weight > 0
      THEN 'per_kg'
      ELSE 'per_piece_or_unit'
    END AS price_unit_basis,
    CASE
      WHEN effective_weight IS NULL OR effective_weight <= 0
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
    WHEN classified_price_items.weight_unit IS NULL THEN price_item.unit
    WHEN classified_price_items.price_unit_basis = 'per_piece_total' THEN 'piece'
    ELSE 'kg'
  END,
  metadata = COALESCE(price_item.metadata, '{}'::jsonb) || jsonb_build_object(
    'sourcePriceUnitBasis',
    classified_price_items.price_unit_basis,
    'sourceUnitWeightOrigin',
    classified_price_items.unit_weight_origin,
    'sourceUnitWeightColumn',
    CASE
      WHEN classified_price_items.unit_weight_origin = 'product_name_parentheses' THEN 0
      ELSE classified_price_items.product_price_unit_weight
    END,
    'sourceParentheticalUnitWeight',
    CASE
      WHEN classified_price_items.effective_weight IS NOT NULL
        AND classified_price_items.effective_weight > 0
      THEN classified_price_items.parenthetical_weight
      ELSE NULL
    END
  ),
  source_refs = CASE
    WHEN classified_price_items.unit_weight_origin = 'product_name_parentheses'
      AND NOT COALESCE(price_item.source_refs, '[]'::jsonb) @> '[{"canonicalKey":"product_price_unit_weight","extractedLabel":"品名括號單位重"}]'::jsonb
    THEN COALESCE(price_item.source_refs, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'channel', 'admin_erp_xlsx',
        'factType', 'product_price_unit_weight',
        'sourceFile', 'docs/reference/產品價格.xlsx',
        'locator', COALESCE(price_item.source_refs->0->>'locator', 'sheet=Sheet1'),
        'confidence', 'medium',
        'extractedLabel', '品名括號單位重',
        'canonicalKey', 'product_price_unit_weight'
      )
    )
    ELSE price_item.source_refs
  END,
  updated_at = NOW()
FROM classified_price_items
WHERE price_item.id = classified_price_items.id
  AND (
    price_item.product_price_unit_weight IS DISTINCT FROM classified_price_items.effective_weight
    OR price_item.product_price_unit_weight_unit IS DISTINCT FROM classified_price_items.weight_unit
    OR price_item.unit IS DISTINCT FROM CASE
      WHEN classified_price_items.weight_unit IS NULL THEN price_item.unit
      WHEN classified_price_items.price_unit_basis = 'per_piece_total' THEN 'piece'
      ELSE 'kg'
    END
    OR COALESCE(price_item.metadata->>'sourcePriceUnitBasis', '') IS DISTINCT FROM classified_price_items.price_unit_basis
    OR COALESCE(price_item.metadata->>'sourceUnitWeightOrigin', '') IS DISTINCT FROM COALESCE(classified_price_items.unit_weight_origin, '')
  );

INSERT INTO steel.instruction_packets (
  slug,
  version,
  title,
  locale,
  packet_groups,
  selectors,
  instruction,
  blocking_rules,
  required_lookups,
  user_visible_notes,
  confirmation_questions,
  priority,
  confidence,
  source_refs,
  active,
  review_state,
  created_by,
  reviewed_by,
  reviewed_at
)
VALUES (
  'product-price-unit-weight-calculation-zh-v1',
  1,
  '產品價格單位重與售價計算',
  'zh-TW',
  ARRAY[
    'global-quote-core',
    'angle-zinc-quote-core',
    'c-type-quote-core',
    'h-type-quote-core',
    'black-long-material-cutting-core',
    'plate-processing-core'
  ]::text[],
  '{"taskTypes":["material_price_lookup","formula_selection","confirmation_policy"],"catalogFamilies":["c_type","h_beam","angle","channel","flat_bar","round_bar","square_bar","round_pipe","square_pipe","plate","stainless","galvanized","misc"],"priceFields":["unit","unitPrice","productPriceUnitWeight","productPriceUnitWeightUnit","metadata.sourceRatio","metadata.sourceUnitWeightOrigin"]}'::jsonb,
  '產品價格.xlsx 的 unitPrice 必須搭配 unit、productPriceUnitWeight 與 productPriceUnitWeightUnit 解讀，不可只因使用者問一支多少就把 unitPrice 當作每支總價。unit 表示售價欄單位；productPriceUnitWeightUnit 表示重量欄語意。productPriceUnitWeightUnit = kg_per_m 且 unit = kg 時，productPriceUnitWeight 是 kg/m，unitPrice 是每 kg 售價，材料金額 = kgPerM * lengthM * quantity * unitPrice。例：C型鋼 C100x50x20x2.3t 6M 一支多少，若 reviewed row 是 錏輕型鋼 100x2.3、unit = kg、unitPrice = 25-26.8、productPriceUnitWeight = 4kg/m，則一支 6M 是 24kg，暫估材料價約 NT$600-643.2，不可回答 NT$25-26.8/支。品名或規格有固定長度 M 且 productPriceUnitWeightUnit = kg_per_piece 時，productPriceUnitWeight 是重量/支；若 unit = kg，整支金額是 pieceWeightKg * quantityPieces * unitPrice；若 unit = piece，unitPrice 已是整支金額。切料後餘料預設也計價。若單位重欄位是 0，但品名最後括號內有數字且 reviewed row 可用 售價 = 括號重量 * 比率 驗證，括號數字就是重量/支補漏來源。例：白鐵平鐵 50 *8.0( 19.7) 的 A 價 2107.90、比率 107.00，所以 19.7 * 107 = 2107.9；此 row 應以 19.7kg/支、unit = piece 判讀。只有使用者明確說餘料不計價時，才可把重量/支除以來源長度得到 kg/m，再乘以實際切料長度與 per-kg price 計算。找不到可驗證重量時，標示 missing/low confidence 並請使用者確認。',
  ARRAY[
    '不要把 productPriceUnitWeightUnit = kg_per_m 的 unitPrice 當成 per-piece price。',
    '不要只看 productPriceUnitWeightUnit 就決定售價單位；必須同時看 reviewed row 的 unit。',
    '不要因 source row 的 unit 顯示支/件，就忽略 productPriceUnitWeightUnit 所代表的 kg/m 或 kg/支計算語意。',
    '不要用 0 或空白單位重計算材料金額。'
  ]::text[],
  ARRAY['search_price_candidates','lookup_formula']::text[],
  ARRAY[
    '產品價格列若是 kg_per_m，售價是每 kg，必須先依長度換算重量再乘售價。',
    '固定長度 M 的產品列通常是整支計價；餘料不計價必須由使用者明確指定。',
    '單位重欄位為 0 時，品名括號重量若可由售價與比率驗證，可作重量/支補漏來源。'
  ]::text[],
  ARRAY[
    '請確認本次長度、數量，以及是否整支含餘料計價。'
  ]::text[],
  45,
  'high',
  '[{"channel":"repo_docs","factType":"instruction_packet","sourceFile":"tasks/steel-data-rules-architecture/instruction-packets.md","locator":"product-price-unit-weight-calculation-zh-v1","canonicalKey":"product_price_unit_weight_calculation"}]'::jsonb,
  true,
  'reviewed',
  'migration:steel_product_price_unit_weight_rules',
  'migration:steel_product_price_unit_weight_rules',
  NOW()
)
ON CONFLICT (slug, version) DO UPDATE SET
  title = EXCLUDED.title,
  locale = EXCLUDED.locale,
  packet_groups = EXCLUDED.packet_groups,
  selectors = EXCLUDED.selectors,
  instruction = EXCLUDED.instruction,
  blocking_rules = EXCLUDED.blocking_rules,
  required_lookups = EXCLUDED.required_lookups,
  user_visible_notes = EXCLUDED.user_visible_notes,
  confirmation_questions = EXCLUDED.confirmation_questions,
  priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence,
  source_refs = EXCLUDED.source_refs,
  active = EXCLUDED.active,
  review_state = EXCLUDED.review_state,
  reviewed_by = EXCLUDED.reviewed_by,
  reviewed_at = EXCLUDED.reviewed_at,
  updated_at = NOW();

COMMIT;
