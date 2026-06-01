BEGIN;

SET search_path = steel, public;

ALTER TABLE steel.customer_tiers
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.customer_tiers
  ADD CONSTRAINT customer_tiers_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array');

ALTER TABLE steel.customers
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.customers
  ADD CONSTRAINT customers_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array');

ALTER TABLE steel.customer_aliases
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.customer_aliases
  ADD CONSTRAINT customer_aliases_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array');

ALTER TABLE steel.price_categories
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.price_categories
  ADD CONSTRAINT price_categories_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array');

ALTER TABLE steel.price_items
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS product_price_unit_weight NUMERIC(14, 5),
  ADD COLUMN IF NOT EXISTS product_price_unit_weight_unit TEXT,
  ADD COLUMN IF NOT EXISTS value_state TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.price_items
  DROP CONSTRAINT IF EXISTS price_items_unit_price_check;

ALTER TABLE steel.price_items
  ADD CONSTRAINT price_items_unit_price_check
  CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD CONSTRAINT price_items_product_price_unit_weight_check
  CHECK (product_price_unit_weight IS NULL OR product_price_unit_weight > 0),
  ADD CONSTRAINT price_items_product_weight_unit_required_check
  CHECK (
    product_price_unit_weight IS NULL
    OR product_price_unit_weight_unit IS NOT NULL
  ),
  ADD CONSTRAINT price_items_product_weight_unit_check
  CHECK (
    product_price_unit_weight_unit IS NULL
    OR product_price_unit_weight_unit IN ('kg_per_m', 'kg_per_piece', 'kg_per_unit')
  ),
  ADD CONSTRAINT price_items_value_state_check
  CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate')),
  ADD CONSTRAINT price_items_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT price_items_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array'),
  ADD CONSTRAINT price_items_unit_price_required_check
  CHECK (value_state = 'unknown' OR unit_price IS NOT NULL),
  ADD CONSTRAINT price_items_unknown_unit_price_check
  CHECK (value_state <> 'unknown' OR unit_price IS NULL),
  ADD CONSTRAINT price_items_true_zero_unit_price_check
  CHECK (value_state <> 'true_zero' OR unit_price IS NOT DISTINCT FROM 0);

CREATE INDEX IF NOT EXISTS price_items_review_state_idx
ON steel.price_items (review_state, active);

ALTER TABLE steel.weight_specs
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE steel.weight_specs
SET source_refs = jsonb_build_array(
  jsonb_build_object(
    'channel', 'manual',
    'factType', 'handbook_weight',
    'locator', source_ref
  )
)
WHERE source_ref IS NOT NULL
  AND source_ref <> ''
  AND source_refs = '[]'::jsonb;

ALTER TABLE steel.weight_specs
  DROP COLUMN IF EXISTS source_ref,
  DROP CONSTRAINT IF EXISTS weight_specs_weight_check;

ALTER TABLE steel.weight_specs
  ADD CONSTRAINT weight_specs_weight_check
  CHECK (
    (weight_kg_per_m IS NOT NULL AND weight_kg_per_m > 0)
    OR (weight_kg_per_piece IS NOT NULL AND weight_kg_per_piece > 0)
  ),
  ADD CONSTRAINT weight_specs_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT weight_specs_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array');

ALTER TABLE steel.material_rules
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS material_family TEXT,
  ADD COLUMN IF NOT EXISTS condition_type TEXT,
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE steel.material_rules
SET source_refs = jsonb_build_array(
  jsonb_build_object(
    'channel', 'manual',
    'factType', 'material_rule',
    'locator', source_ref
  )
)
WHERE source_ref IS NOT NULL
  AND source_ref <> ''
  AND source_refs = '[]'::jsonb;

ALTER TABLE steel.material_rules
  DROP COLUMN IF EXISTS source_ref;

ALTER TABLE steel.material_rules
  ADD CONSTRAINT material_rules_priority_check
  CHECK (priority >= 0),
  ADD CONSTRAINT material_rules_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT material_rules_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array');

CREATE INDEX IF NOT EXISTS material_rules_lookup_idx
ON steel.material_rules (material_family, rule_type, active, priority);

ALTER TABLE steel.processing_prices
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS value_state TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.processing_prices
  DROP CONSTRAINT IF EXISTS processing_prices_unit_price_check;

ALTER TABLE steel.processing_prices
  ADD CONSTRAINT processing_prices_unit_price_check
  CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD CONSTRAINT processing_prices_value_state_check
  CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate')),
  ADD CONSTRAINT processing_prices_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT processing_prices_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array'),
  ADD CONSTRAINT processing_prices_unit_price_required_check
  CHECK (value_state = 'unknown' OR unit_price IS NOT NULL),
  ADD CONSTRAINT processing_prices_unknown_unit_price_check
  CHECK (value_state <> 'unknown' OR unit_price IS NULL),
  ADD CONSTRAINT processing_prices_true_zero_unit_price_check
  CHECK (value_state <> 'true_zero' OR unit_price IS NOT DISTINCT FROM 0);

CREATE INDEX IF NOT EXISTS processing_prices_review_state_idx
ON steel.processing_prices (review_state, active);

ALTER TABLE steel.cutting_prices
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS value_state TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.cutting_prices
  DROP CONSTRAINT IF EXISTS cutting_prices_unit_price_check;

ALTER TABLE steel.cutting_prices
  ADD CONSTRAINT cutting_prices_unit_price_check
  CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD CONSTRAINT cutting_prices_value_state_check
  CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate')),
  ADD CONSTRAINT cutting_prices_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT cutting_prices_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array'),
  ADD CONSTRAINT cutting_prices_unit_price_required_check
  CHECK (value_state = 'unknown' OR unit_price IS NOT NULL),
  ADD CONSTRAINT cutting_prices_unknown_unit_price_check
  CHECK (value_state <> 'unknown' OR unit_price IS NULL),
  ADD CONSTRAINT cutting_prices_true_zero_unit_price_check
  CHECK (value_state <> 'true_zero' OR unit_price IS NOT DISTINCT FROM 0);

CREATE INDEX IF NOT EXISTS cutting_prices_review_state_idx
ON steel.cutting_prices (review_state, active);

ALTER TABLE steel.cutting_price_adjustments
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.cutting_price_adjustments
  ADD CONSTRAINT cutting_price_adjustments_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT cutting_price_adjustments_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array');

ALTER TABLE steel.hole_prices
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS value_state TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.hole_prices
  DROP CONSTRAINT IF EXISTS hole_prices_unit_price_check;

ALTER TABLE steel.hole_prices
  ADD CONSTRAINT hole_prices_unit_price_check
  CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD CONSTRAINT hole_prices_value_state_check
  CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate')),
  ADD CONSTRAINT hole_prices_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT hole_prices_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array'),
  ADD CONSTRAINT hole_prices_unit_price_required_check
  CHECK (value_state = 'unknown' OR unit_price IS NOT NULL),
  ADD CONSTRAINT hole_prices_unknown_unit_price_check
  CHECK (value_state <> 'unknown' OR unit_price IS NULL),
  ADD CONSTRAINT hole_prices_true_zero_unit_price_check
  CHECK (value_state <> 'true_zero' OR unit_price IS NOT DISTINCT FROM 0);

ALTER TABLE steel.slotting_prices
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS value_state TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.slotting_prices
  DROP CONSTRAINT IF EXISTS slotting_prices_unit_price_check;

ALTER TABLE steel.slotting_prices
  ADD CONSTRAINT slotting_prices_unit_price_check
  CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD CONSTRAINT slotting_prices_value_state_check
  CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate')),
  ADD CONSTRAINT slotting_prices_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT slotting_prices_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array'),
  ADD CONSTRAINT slotting_prices_unit_price_required_check
  CHECK (value_state = 'unknown' OR unit_price IS NOT NULL),
  ADD CONSTRAINT slotting_prices_unknown_unit_price_check
  CHECK (value_state <> 'unknown' OR unit_price IS NULL),
  ADD CONSTRAINT slotting_prices_true_zero_unit_price_check
  CHECK (value_state <> 'true_zero' OR unit_price IS NOT DISTINCT FROM 0);

ALTER TABLE steel.bending_prices
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS value_state TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.bending_prices
  DROP CONSTRAINT IF EXISTS bending_prices_unit_price_check;

ALTER TABLE steel.bending_prices
  ADD CONSTRAINT bending_prices_unit_price_check
  CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD CONSTRAINT bending_prices_value_state_check
  CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate')),
  ADD CONSTRAINT bending_prices_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT bending_prices_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array'),
  ADD CONSTRAINT bending_prices_unit_price_required_check
  CHECK (value_state = 'unknown' OR unit_price IS NOT NULL),
  ADD CONSTRAINT bending_prices_unknown_unit_price_check
  CHECK (value_state <> 'unknown' OR unit_price IS NULL),
  ADD CONSTRAINT bending_prices_true_zero_unit_price_check
  CHECK (value_state <> 'true_zero' OR unit_price IS NOT DISTINCT FROM 0);

ALTER TABLE steel.formula_versions
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS source_expression TEXT,
  ADD COLUMN IF NOT EXISTS compiled_formula JSONB,
  ADD COLUMN IF NOT EXISTS allowed_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE steel.formula_versions
  ADD CONSTRAINT formula_versions_compiled_formula_check
  CHECK (compiled_formula IS NULL OR jsonb_typeof(compiled_formula) = 'object'),
  ADD CONSTRAINT formula_versions_allowed_variables_check
  CHECK (jsonb_typeof(allowed_variables) = 'array'),
  ADD CONSTRAINT formula_versions_review_state_check
  CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  ADD CONSTRAINT formula_versions_source_refs_check
  CHECK (jsonb_typeof(source_refs) = 'array');

CREATE INDEX IF NOT EXISTS formula_versions_active_review_idx
ON steel.formula_versions (code, active, review_state);

ALTER TABLE steel.price_history
  ALTER COLUMN new_unit_price DROP NOT NULL;

ALTER TABLE steel.price_history
  ADD CONSTRAINT price_history_old_unit_price_check
  CHECK (old_unit_price IS NULL OR old_unit_price >= 0),
  ADD CONSTRAINT price_history_new_unit_price_check
  CHECK (new_unit_price IS NULL OR new_unit_price >= 0);

COMMIT;
