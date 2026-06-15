WITH alias_seed (
  source_product_name,
  target_product_name,
  catalog_family,
  priority,
  review_state,
  metadata,
  source_refs
) AS (
  VALUES
    (
      '白鐵',
      'ST',
      NULL::text,
      55,
      'reviewed',
      jsonb_build_object(
        'matchKind', 'surface_marker',
        'surfaceMarker', 'ST',
        'sourceKind', 'oral_zh_material_surface'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'channel', 'repo_docs',
          'factType', 'product_name_alias',
          'sourceFile', 'docs/rules/鋼材規則.txt',
          'locator', 'surface_product_name_marker_aliases',
          'canonicalKey', 'surface_product_name_marker_aliases'
        )
      )
    ),
    (
      '黑鐵',
      'OT',
      NULL::text,
      55,
      'reviewed',
      jsonb_build_object(
        'matchKind', 'surface_marker',
        'surfaceMarker', 'OT',
        'sourceKind', 'oral_zh_material_surface'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'channel', 'repo_docs',
          'factType', 'product_name_alias',
          'sourceFile', 'docs/rules/鋼材規則.txt',
          'locator', 'surface_product_name_marker_aliases',
          'canonicalKey', 'surface_product_name_marker_aliases'
        )
      )
    ),
    (
      '白鐵沙面',
      'HL',
      NULL::text,
      35,
      'reviewed',
      jsonb_build_object(
        'matchKind', 'surface_marker',
        'surfaceMarker', 'HL',
        'sourceKind', 'oral_zh_material_surface'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'channel', 'repo_docs',
          'factType', 'product_name_alias',
          'sourceFile', 'docs/rules/鋼材規則.txt',
          'locator', 'surface_product_name_marker_aliases',
          'canonicalKey', 'surface_product_name_marker_aliases'
        )
      )
    ),
    (
      '白鐵霧面',
      '2B',
      NULL::text,
      35,
      'reviewed',
      jsonb_build_object(
        'matchKind', 'surface_marker',
        'surfaceMarker', '2B',
        'sourceKind', 'oral_zh_material_surface'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'channel', 'repo_docs',
          'factType', 'product_name_alias',
          'sourceFile', 'docs/rules/鋼材規則.txt',
          'locator', 'surface_product_name_marker_aliases',
          'canonicalKey', 'surface_product_name_marker_aliases'
        )
      )
    ),
    (
      '白鐵亮面',
      'BA',
      NULL::text,
      35,
      'reviewed',
      jsonb_build_object(
        'matchKind', 'surface_marker',
        'surfaceMarker', 'BA',
        'sourceKind', 'oral_zh_material_surface'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'channel', 'repo_docs',
          'factType', 'product_name_alias',
          'sourceFile', 'docs/rules/鋼材規則.txt',
          'locator', 'surface_product_name_marker_aliases',
          'canonicalKey', 'surface_product_name_marker_aliases'
        )
      )
    ),
    (
      '白鐵',
      'NO1',
      NULL::text,
      80,
      'reviewed',
      jsonb_build_object(
        'matchKind', 'surface_marker',
        'surfaceMarker', 'NO1',
        'sourceKind', 'oral_zh_material_surface',
        'minThicknessMm', 3,
        'thicknessEvidenceFormats', jsonb_build_array(
          '3t',
          '3.0m/m',
          '3.0mm',
          'STNO1 3.0*4''*8''(73.5)'
        ),
        'productNameExamples', jsonb_build_array(
          '3.0m/mSTNO1雷射切割',
          '4.5m/mSTNO1雷射切割',
          '8.0m/mSTNO1切清',
          '9.0m/mSTNO1切清',
          'STNO1 3.0*4''*8''(73.5)',
          'STNO1 3.0*4''*10''(91.8)',
          'STNO1 3.0*5''*10''(113)'
        )
      ),
      jsonb_build_array(
        jsonb_build_object(
          'channel', 'repo_docs',
          'factType', 'product_name_alias',
          'sourceFile', 'docs/rules/鋼材規則.txt',
          'locator', 'surface_product_name_marker_aliases',
          'canonicalKey', 'surface_product_name_marker_aliases'
        )
      )
    )
),
updated AS (
  UPDATE steel.product_name_aliases AS alias
  SET
    priority = seed.priority,
    active = true,
    review_state = seed.review_state,
    metadata = seed.metadata,
    source_refs = seed.source_refs,
    updated_at = NOW()
  FROM alias_seed AS seed
  WHERE lower(alias.source_product_name) = lower(seed.source_product_name)
    AND lower(alias.target_product_name) = lower(seed.target_product_name)
    AND COALESCE(alias.catalog_family, '') = COALESCE(seed.catalog_family, '')
  RETURNING alias.id
)
INSERT INTO steel.product_name_aliases (
  source_product_name,
  target_product_name,
  catalog_family,
  priority,
  review_state,
  metadata,
  source_refs
)
SELECT
  seed.source_product_name,
  seed.target_product_name,
  seed.catalog_family,
  seed.priority,
  seed.review_state,
  seed.metadata,
  seed.source_refs
FROM alias_seed AS seed
WHERE NOT EXISTS (
  SELECT 1
  FROM steel.product_name_aliases AS alias
  WHERE lower(alias.source_product_name) = lower(seed.source_product_name)
    AND lower(alias.target_product_name) = lower(seed.target_product_name)
    AND COALESCE(alias.catalog_family, '') = COALESCE(seed.catalog_family, '')
);
