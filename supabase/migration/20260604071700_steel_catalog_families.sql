DO $$
BEGIN
  IF to_regclass('steel.catalog_families') IS NULL
     AND to_regclass('steel.material_families') IS NOT NULL THEN
    ALTER TABLE steel.material_families RENAME TO catalog_families;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS steel.catalog_families (
  key TEXT PRIMARY KEY,
  display_name_zh TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  review_state TEXT NOT NULL DEFAULT 'reviewed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE steel.catalog_families
  DROP CONSTRAINT IF EXISTS material_families_key_not_blank_check,
  DROP CONSTRAINT IF EXISTS material_families_display_name_not_blank_check,
  DROP CONSTRAINT IF EXISTS material_families_aliases_check,
  DROP CONSTRAINT IF EXISTS material_families_metadata_check,
  DROP CONSTRAINT IF EXISTS material_families_source_refs_check,
  DROP CONSTRAINT IF EXISTS material_families_review_state_check,
  DROP CONSTRAINT IF EXISTS catalog_families_key_not_blank_check,
  DROP CONSTRAINT IF EXISTS catalog_families_display_name_not_blank_check,
  DROP CONSTRAINT IF EXISTS catalog_families_aliases_check,
  DROP CONSTRAINT IF EXISTS catalog_families_metadata_check,
  DROP CONSTRAINT IF EXISTS catalog_families_source_refs_check,
  DROP CONSTRAINT IF EXISTS catalog_families_review_state_check;

ALTER TABLE steel.catalog_families
  ADD CONSTRAINT catalog_families_key_not_blank_check CHECK (btrim(key) <> ''),
  ADD CONSTRAINT catalog_families_display_name_not_blank_check CHECK (btrim(display_name_zh) <> ''),
  ADD CONSTRAINT catalog_families_aliases_check CHECK (jsonb_typeof(aliases) = 'array'),
  ADD CONSTRAINT catalog_families_metadata_check CHECK (jsonb_typeof(metadata) = 'object'),
  ADD CONSTRAINT catalog_families_source_refs_check CHECK (jsonb_typeof(source_refs) = 'array'),
  ADD CONSTRAINT catalog_families_review_state_check CHECK (
    review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')
  );

DO $$
BEGIN
  IF to_regclass('steel.material_families') IS NOT NULL THEN
    INSERT INTO steel.catalog_families (
      key,
      display_name_zh,
      aliases,
      metadata,
      source_refs,
      active,
      review_state,
      created_at,
      updated_at
    )
    SELECT
      key,
      display_name_zh,
      aliases,
      metadata,
      source_refs,
      active,
      review_state,
      created_at,
      updated_at
    FROM steel.material_families
    ON CONFLICT (key) DO UPDATE
    SET
      display_name_zh = EXCLUDED.display_name_zh,
      aliases = EXCLUDED.aliases,
      metadata = EXCLUDED.metadata,
      source_refs = EXCLUDED.source_refs,
      active = EXCLUDED.active,
      review_state = EXCLUDED.review_state,
      updated_at = EXCLUDED.updated_at;

    DROP TABLE steel.material_families;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'price_categories'
      AND column_name = 'material_family'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'price_categories'
      AND column_name = 'catalog_family'
  ) THEN
    ALTER TABLE steel.price_categories RENAME COLUMN material_family TO catalog_family;
  END IF;
END $$;

ALTER TABLE steel.price_categories
  ADD COLUMN IF NOT EXISTS catalog_family TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'price_categories'
      AND column_name = 'material_family'
  ) THEN
    UPDATE steel.price_categories
    SET catalog_family = COALESCE(catalog_family, material_family);

    ALTER TABLE steel.price_categories DROP COLUMN material_family;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'price_items'
      AND column_name = 'material_family'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'price_items'
      AND column_name = 'catalog_family'
  ) THEN
    ALTER TABLE steel.price_items RENAME COLUMN material_family TO catalog_family;
  END IF;
END $$;

ALTER TABLE steel.price_items
  ADD COLUMN IF NOT EXISTS catalog_family TEXT;

DROP INDEX IF EXISTS steel.price_items_material_family_lookup_idx;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'price_items'
      AND column_name = 'material_family'
  ) THEN
    UPDATE steel.price_items
    SET catalog_family = COALESCE(catalog_family, material_family);

    ALTER TABLE steel.price_items DROP COLUMN material_family;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS price_items_catalog_family_lookup_idx
ON steel.price_items (catalog_family, active, customer_tier_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'material_rules'
      AND column_name = 'material_family'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'material_rules'
      AND column_name = 'catalog_family'
  ) THEN
    ALTER TABLE steel.material_rules RENAME COLUMN material_family TO catalog_family;
  END IF;
END $$;

ALTER TABLE steel.material_rules
  ADD COLUMN IF NOT EXISTS catalog_family TEXT;

DROP INDEX IF EXISTS steel.material_rules_material_lookup_idx;
DROP INDEX IF EXISTS steel.material_rules_lookup_idx;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'material_rules'
      AND column_name = 'material_family'
  ) THEN
    UPDATE steel.material_rules
    SET catalog_family = COALESCE(catalog_family, material_family);

    ALTER TABLE steel.material_rules DROP COLUMN material_family;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS material_rules_catalog_lookup_idx
ON steel.material_rules (catalog_family, rule_type, active, priority);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'bending_prices'
      AND column_name = 'material_family'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'bending_prices'
      AND column_name = 'catalog_family'
  ) THEN
    ALTER TABLE steel.bending_prices RENAME COLUMN material_family TO catalog_family;
  END IF;
END $$;

ALTER TABLE steel.bending_prices
  ADD COLUMN IF NOT EXISTS catalog_family TEXT;

DROP INDEX IF EXISTS steel.bending_prices_bend_material_idx;
DROP INDEX IF EXISTS steel.bending_prices_lookup_idx;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'bending_prices'
      AND column_name = 'material_family'
  ) THEN
    UPDATE steel.bending_prices
    SET catalog_family = COALESCE(catalog_family, material_family);

    ALTER TABLE steel.bending_prices DROP COLUMN material_family;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bending_prices_bend_catalog_idx
ON steel.bending_prices (bend_type, catalog_family, active);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'calculation_rule_defaults'
      AND column_name = 'material_family'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'calculation_rule_defaults'
      AND column_name = 'catalog_family'
  ) THEN
    ALTER TABLE steel.calculation_rule_defaults RENAME COLUMN material_family TO catalog_family;
  END IF;
END $$;

ALTER TABLE steel.calculation_rule_defaults
  ADD COLUMN IF NOT EXISTS catalog_family TEXT,
  DROP CONSTRAINT IF EXISTS calculation_rule_defaults_scope_type_check,
  DROP CONSTRAINT IF EXISTS calculation_rule_defaults_scope_required_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'calculation_rule_defaults'
      AND column_name = 'material_family'
  ) THEN
    UPDATE steel.calculation_rule_defaults
    SET catalog_family = COALESCE(catalog_family, material_family);

    ALTER TABLE steel.calculation_rule_defaults DROP COLUMN material_family;
  END IF;
END $$;

UPDATE steel.calculation_rule_defaults
SET scope_type = 'catalog_family'
WHERE scope_type = 'material_family';

ALTER TABLE steel.calculation_rule_defaults
  ADD CONSTRAINT calculation_rule_defaults_scope_type_check CHECK (
    scope_type IN ('customer', 'customer_tier', 'catalog_family', 'product_family', 'company')
  ),
  ADD CONSTRAINT calculation_rule_defaults_scope_required_check CHECK (
    (scope_type = 'customer' AND customer_id IS NOT NULL)
    OR (scope_type = 'customer_tier' AND customer_tier_id IS NOT NULL)
    OR (scope_type = 'catalog_family' AND catalog_family IS NOT NULL)
    OR (scope_type = 'product_family' AND product_family IS NOT NULL)
    OR scope_type = 'company'
  );

DROP INDEX IF EXISTS steel.calculation_rule_defaults_material_lookup_idx;
CREATE INDEX IF NOT EXISTS calculation_rule_defaults_catalog_lookup_idx
ON steel.calculation_rule_defaults (
  catalog_family,
  product_family,
  charge_type,
  formula_code,
  active,
  priority
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'quote_defaults'
      AND column_name = 'material_family'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'quote_defaults'
      AND column_name = 'catalog_family'
  ) THEN
    ALTER TABLE steel.quote_defaults RENAME COLUMN material_family TO catalog_family;
  END IF;
END $$;

ALTER TABLE steel.quote_defaults
  ADD COLUMN IF NOT EXISTS catalog_family TEXT,
  DROP CONSTRAINT IF EXISTS quote_defaults_scope_type_check,
  DROP CONSTRAINT IF EXISTS quote_defaults_scope_required_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'quote_defaults'
      AND column_name = 'material_family'
  ) THEN
    UPDATE steel.quote_defaults
    SET catalog_family = COALESCE(catalog_family, material_family);

    ALTER TABLE steel.quote_defaults DROP COLUMN material_family;
  END IF;
END $$;

UPDATE steel.quote_defaults
SET scope_type = 'catalog_family'
WHERE scope_type = 'material_family';

ALTER TABLE steel.quote_defaults
  ADD CONSTRAINT quote_defaults_scope_type_check CHECK (
    scope_type IN ('customer', 'customer_tier', 'catalog_family', 'product_family', 'company')
  ),
  ADD CONSTRAINT quote_defaults_scope_required_check CHECK (
    (scope_type = 'customer' AND customer_id IS NOT NULL)
    OR (scope_type = 'customer_tier' AND customer_tier_id IS NOT NULL)
    OR (scope_type = 'catalog_family' AND catalog_family IS NOT NULL)
    OR (scope_type = 'product_family' AND product_family IS NOT NULL)
    OR scope_type = 'company'
  );

DROP INDEX IF EXISTS steel.quote_defaults_material_lookup_idx;
CREATE INDEX IF NOT EXISTS quote_defaults_catalog_lookup_idx
ON steel.quote_defaults (
  catalog_family,
  product_family,
  charge_type,
  formula_code,
  active,
  priority
);

DROP TRIGGER IF EXISTS set_updated_at ON steel.catalog_families;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON steel.catalog_families
FOR EACH ROW EXECUTE FUNCTION steel.set_updated_at();

DO $$
BEGIN
  IF to_regclass('steel.lesson_memory_entries') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'steel'
         AND table_name = 'lesson_memory_entries'
         AND column_name = 'material_family'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'steel'
         AND table_name = 'lesson_memory_entries'
         AND column_name = 'catalog_family'
     ) THEN
    ALTER TABLE steel.lesson_memory_entries RENAME COLUMN material_family TO catalog_family;
  END IF;

  IF to_regclass('steel.lesson_memory_entries') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'steel'
         AND table_name = 'lesson_memory_entries'
         AND column_name = 'material_family'
     ) THEN
    UPDATE steel.lesson_memory_entries
    SET catalog_family = COALESCE(catalog_family, material_family);

    ALTER TABLE steel.lesson_memory_entries DROP COLUMN material_family;
  END IF;
END $$;

REVOKE ALL ON TABLE steel.catalog_families FROM anon, authenticated;
