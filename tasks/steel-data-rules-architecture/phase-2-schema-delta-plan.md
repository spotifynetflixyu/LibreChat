# Phase 2: Supabase Schema Delta Plan

Goal: define the exact Steel Supabase schema changes needed before Phase 2 repositories and tools are implemented.

This is a plan, not a migration. Do not apply this to Supabase until the plan is reviewed. When approved, the implementation must update both:

- `supabase/schema.sql`
- a new one-change migration under `supabase/migration/`

Proposed migration filename:

```text
supabase/migration/202606010001_phase2_canonical_quote_facts.sql
```

## Accepted Direction

- Keep Steel tables in the private `steel` schema.
- Use `TEXT` plus check constraints, matching the current schema style; do not introduce PostgreSQL enum types in this migration.
- Use a canonical `source_refs JSONB NOT NULL DEFAULT '[]'::jsonb` array on source-backed fact rows.
- Defer a normalized `steel.source_refs` table until source-reference querying becomes a real product need.
- Use nullable numeric fields plus `value_state`; do not store unknown values as `0`.
- Limit true-zero semantics to Admin-reviewed price or charge facts. Zero unit weight remains invalid or unknown unless a later source-specific task proves a legitimate zero-weight business concept.
- Keep non-query source notes and import details in `metadata`; fields used for lookup, ranking, calculation, or audit become typed columns.

## Shared State Columns

Use these states across price/charge/spec/rule/formula tables:

```sql
value_state TEXT NOT NULL DEFAULT 'confirmed'
CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate'))
```

Use `value_state` for the table's primary quote value, usually `unit_price`. For optional secondary amounts like `min_price` or `surcharge_per_kg`, keep nullable values in this migration and add field-specific state later only when implementation evidence needs it.

```sql
review_state TEXT NOT NULL DEFAULT 'reviewed'
CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected'))
```

Use `review_state` for whether the row can participate in deterministic lookup.

```sql
source_refs JSONB NOT NULL DEFAULT '[]'::jsonb
CHECK (jsonb_typeof(source_refs) = 'array')
```

`source_refs` entries should follow the canonical shape:

```json
{
  "channel": "admin_erp_xlsx",
  "factType": "product_price",
  "sourceFile": "docs/reference/產品價格.xlsx",
  "sourceVersionId": "optional-admin-source-version-id",
  "locator": "sheet=Sheet1;row=6",
  "confidence": "high",
  "extractedLabel": "售價A",
  "canonicalKey": "unit_price"
}
```

## Table Deltas

### Customer And Category Source Trace

Tables:

- `steel.customer_tiers`
- `steel.customers`
- `steel.customer_aliases`
- `steel.price_categories`

Add:

```sql
source_refs JSONB NOT NULL DEFAULT '[]'::jsonb
```

Rationale: customer tier and aliases participate in quote price selection and need traceability back to ERP/Admin review sources.

### `steel.price_items`

Current gap:

- `unit_price` is `NOT NULL`, so unknown source price cannot be represented without a fake `0`.
- Product-price unit weight only has a loose mapping target.
- Source refs are only possible through `metadata`.

Change:

```sql
ALTER TABLE steel.price_items
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN product_price_unit_weight NUMERIC(14, 5),
  ADD COLUMN product_price_unit_weight_unit TEXT,
  ADD COLUMN value_state TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
```

Add checks:

```sql
CHECK (unit_price IS NULL OR unit_price >= 0)
CHECK (product_price_unit_weight IS NULL OR product_price_unit_weight > 0)
CHECK (
  product_price_unit_weight IS NULL
  OR product_price_unit_weight_unit IS NOT NULL
)
CHECK (
  product_price_unit_weight_unit IS NULL
  OR product_price_unit_weight_unit IN ('kg_per_m', 'kg_per_piece', 'kg_per_unit')
)
CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate'))
CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected'))
CHECK (jsonb_typeof(source_refs) = 'array')
CHECK (
  (value_state = 'unknown' AND unit_price IS NULL)
  OR (value_state <> 'unknown')
)
CHECK (
  (value_state = 'true_zero' AND unit_price = 0)
  OR (value_state <> 'true_zero')
)
```

Index changes:

- Keep `price_items_lookup_idx`.
- Add `price_items_review_state_idx` on `(review_state, active)`.
- Do not add a GIN index on `source_refs` yet.

### `steel.weight_specs`

Current gap:

- Has `source_ref TEXT`, but Phase 2 canonical source refs require structured arrays.
- No review state.

Change:

```sql
ALTER TABLE steel.weight_specs
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
```

Backfill then drop:

```sql
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

ALTER TABLE steel.weight_specs DROP COLUMN source_ref;
```

Add checks:

```sql
CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected'))
CHECK (jsonb_typeof(source_refs) = 'array')
```

### `steel.material_rules`

Current gap:

- Rule lookup selectors are hidden in `rule_body`.
- Missing `priority`.
- Has `source_ref TEXT`.

Change:

```sql
ALTER TABLE steel.material_rules
  ADD COLUMN priority INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN material_family TEXT,
  ADD COLUMN condition_type TEXT,
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
```

Backfill then drop `source_ref` the same way as `weight_specs`, using `factType = 'material_rule'`.

Add checks:

```sql
CHECK (priority >= 0)
CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected'))
CHECK (jsonb_typeof(source_refs) = 'array')
```

Indexes:

```sql
CREATE INDEX material_rules_lookup_idx
ON steel.material_rules (material_family, rule_type, active, priority);
```

### Price And Processing Tables

Tables:

- `steel.processing_prices`
- `steel.cutting_prices`
- `steel.hole_prices`
- `steel.slotting_prices`
- `steel.bending_prices`

Current gap:

- `unit_price` is `NOT NULL`, so unknown source values cannot be represented.
- No review/value state.
- No canonical source refs.

Change each table:

```sql
ALTER TABLE <table>
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN value_state TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
```

Add checks to each table:

```sql
CHECK (unit_price IS NULL OR unit_price >= 0)
CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate'))
CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected'))
CHECK (jsonb_typeof(source_refs) = 'array')
CHECK (
  (value_state = 'unknown' AND unit_price IS NULL)
  OR (value_state <> 'unknown')
)
CHECK (
  (value_state = 'true_zero' AND unit_price = 0)
  OR (value_state <> 'true_zero')
)
```

Index changes:

- Keep existing lookup indexes.
- Add review indexes only where the repository needs manual-review scans:
  - `processing_prices_review_state_idx`
  - `cutting_prices_review_state_idx`

### `steel.cutting_price_adjustments`

Current gap:

- Adjustment rows can carry charge semantics but have no review state or source refs.

Change:

```sql
ALTER TABLE steel.cutting_price_adjustments
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
```

Keep `adjustment_value NOT NULL` for now because the adjustment row should not exist unless a charge adjustment has a value. If later source review needs unknown adjustment rows, add an adjustment-specific `value_state`.

Add checks:

```sql
CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected'))
CHECK (jsonb_typeof(source_refs) = 'array')
```

### `steel.formula_versions`

Current gap:

- `formula_body` exists but does not enforce the accepted source-expression plus compiled-safe-form split.
- No source refs or review state.

Change:

```sql
ALTER TABLE steel.formula_versions
  ADD COLUMN display_name TEXT,
  ADD COLUMN source_expression TEXT,
  ADD COLUMN compiled_formula JSONB,
  ADD COLUMN allowed_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
```

Keep `formula_body JSONB NOT NULL` during this migration for backward compatibility and to avoid changing downstream code before formula repositories exist. Phase 2 formula implementation should write `source_expression`, `compiled_formula`, and `allowed_variables`; calculators must execute only `compiled_formula`.

Add checks:

```sql
CHECK (compiled_formula IS NULL OR jsonb_typeof(compiled_formula) = 'object')
CHECK (jsonb_typeof(allowed_variables) = 'array')
CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected'))
CHECK (jsonb_typeof(source_refs) = 'array')
```

Indexes:

```sql
CREATE INDEX formula_versions_active_review_idx
ON steel.formula_versions (code, active, review_state);
```

### Calculation Audit Tables

Current gap:

- AI Python / Code Interpreter code and raw execution output need to be retained for backend verification and explanation of the latest quote state.
- Visible workbook sheets should not store long Python code, raw stdout, or verbose JSON artifacts.
- One customer order can contain multiple steel materials, so a single order-level audit blob is not enough.
- Workbook `version` is only a visible update counter; the database should keep current state only and overwrite old workbook/calculation data.

Add an order/workbook-level current-state table:

```sql
CREATE TABLE IF NOT EXISTS steel.quote_calculation_state (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  conversation_id TEXT,
  request_message_id TEXT,
  response_message_id TEXT,
  workbook_id TEXT,
  workbook_version INTEGER,
  order_id BIGINT REFERENCES steel.orders(id),
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'current',
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_calculation_state_status_check CHECK (
    status IN ('current', 'partial', 'failed')
  ),
  CONSTRAINT quote_calculation_state_source_refs_check CHECK (
    jsonb_typeof(source_refs) = 'array'
  )
);
```

Add one current item/line audit row per steel material candidate or workbook line:

```sql
CREATE TABLE IF NOT EXISTS steel.quote_calculation_item_audits (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  calculation_state_id BIGINT NOT NULL REFERENCES steel.quote_calculation_state(id) ON DELETE CASCADE,
  order_id BIGINT REFERENCES steel.orders(id),
  order_item_id BIGINT REFERENCES steel.order_items(id),
  workbook_id TEXT,
  workbook_version INTEGER,
  sheet_id TEXT,
  row_id TEXT,
  item_index INTEGER NOT NULL,
  material_family TEXT,
  product_name TEXT,
  spec_key TEXT,
  calculation_plan JSONB NOT NULL,
  ai_python_code TEXT,
  ai_python_output JSONB,
  ai_result JSONB,
  backend_result JSONB,
  comparison_status TEXT NOT NULL DEFAULT 'backend_confirmed',
  difference_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  backend_confidence TEXT NOT NULL DEFAULT 'high',
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_calculation_item_audits_item_index_check CHECK (item_index >= 0),
  CONSTRAINT quote_calculation_item_audits_calculation_plan_check CHECK (
    jsonb_typeof(calculation_plan) = 'object'
  ),
  CONSTRAINT quote_calculation_item_audits_ai_python_output_check CHECK (
    ai_python_output IS NULL OR jsonb_typeof(ai_python_output) IN ('object', 'array')
  ),
  CONSTRAINT quote_calculation_item_audits_ai_result_check CHECK (
    ai_result IS NULL OR jsonb_typeof(ai_result) = 'object'
  ),
  CONSTRAINT quote_calculation_item_audits_backend_result_check CHECK (
    backend_result IS NULL OR jsonb_typeof(backend_result) = 'object'
  ),
  CONSTRAINT quote_calculation_item_audits_comparison_status_check CHECK (
    comparison_status IN (
      'matched',
      'backend_confirmed',
      'backend_differs',
      'ai_missing',
      'backend_failed',
      'needs_review'
    )
  ),
  CONSTRAINT quote_calculation_item_audits_difference_summary_check CHECK (
    jsonb_typeof(difference_summary) = 'array'
  ),
  CONSTRAINT quote_calculation_item_audits_backend_confidence_check CHECK (
    backend_confidence IN ('low', 'medium', 'high')
  ),
  CONSTRAINT quote_calculation_item_audits_source_refs_check CHECK (
    jsonb_typeof(source_refs) = 'array'
  )
);
```

Indexes:

```sql
CREATE UNIQUE INDEX quote_calculation_state_workbook_unique_idx
ON steel.quote_calculation_state (workbook_id)
WHERE workbook_id IS NOT NULL;

CREATE UNIQUE INDEX quote_calculation_state_order_unique_idx
ON steel.quote_calculation_state (order_id)
WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX quote_calculation_item_audits_state_item_unique_idx
ON steel.quote_calculation_item_audits (calculation_state_id, item_index);

CREATE INDEX quote_calculation_item_audits_workbook_line_idx
ON steel.quote_calculation_item_audits (workbook_id, sheet_id, row_id);

CREATE INDEX quote_calculation_item_audits_order_item_idx
ON steel.quote_calculation_item_audits (order_item_id)
WHERE order_item_id IS NOT NULL;
```

Runtime rules:

- Store Python code, raw Code Interpreter logs/output, and verbose JSON only in `quote_calculation_item_audits`.
- Visible workbook sheets can show concise human-readable difference summaries in `價格來源` or `判讀備註`.
- Each material line in a multi-item order gets its own audit row; order/workbook totals can reference the current state and aggregate backend-confirmed item results.
- Upsert `quote_calculation_state` by current `workbook_id` or `order_id`; do not insert a new retained state for every workbook version.
- Upsert item audit rows by `calculation_state_id + item_index`; delete item audit rows for removed workbook lines.
- Backend reads current item audit rows by `calculation_state_id`, `workbook_id` + `row_id`, or `order_item_id` to compare or explain calculations.
- Old workbook/calculation data is overwritten. Do not design rollback, historical replay, or version comparison unless the user explicitly opens a future history module.

## Constraint Naming Convention

Use explicit names for all new constraints:

```text
<table>_<column>_check
<table>_value_state_check
<table>_review_state_check
<table>_source_refs_check
```

For existing constraints on `unit_price`, replace them where needed instead of leaving duplicate names.

## Migration Order

1. Add new columns with safe defaults.
2. Backfill `source_refs` from existing `source_ref` on `weight_specs` and `material_rules`.
3. Drop `source_ref` from `weight_specs` and `material_rules`.
4. Drop and recreate `unit_price` check constraints where `unit_price` becomes nullable.
5. Add new state/source-ref constraints.
6. Add indexes.
7. Create `quote_calculation_state` and `quote_calculation_item_audits` if the AI Python audit slice is approved in the same implementation phase.
8. Revoke grants remains unchanged; Steel schema stays backend-private.

## Snapshot Update

After writing the migration, update `supabase/schema.sql` so it represents the post-migration schema exactly:

- New columns appear directly in each `CREATE TABLE`.
- Existing `source_ref TEXT` columns are removed from `weight_specs` and `material_rules`.
- Existing `unit_price` columns that can be unknown are nullable.
- New check constraints and indexes are included.
- Calculation audit tables appear when the implementation includes AI Python/Code Interpreter audit storage.
- Existing trigger and grant sections stay intact.

## Verification Plan

Run after migration and snapshot edits:

```bash
rtk rg -n "source_ref TEXT|unit_price NUMERIC\\(14, 4\\) NOT NULL" supabase/schema.sql
rtk rg -n "source_refs|value_state|review_state|product_price_unit_weight|compiled_formula|material_rules_lookup_idx|quote_calculation_state|quote_calculation_item_audits" supabase/schema.sql supabase/migration/202606010001_phase2_canonical_quote_facts.sql
rtk git diff --check
```

If local Supabase/Postgres validation is available through `STEEL_POSTGRES_URL`, also run the migration against a disposable/dev database before implementing repositories. Do not apply to production from this plan.

## Open Implementation Notes

- `source_refs` shape should be validated in TypeScript before inserts; PostgreSQL only checks that the value is an array.
- `product_price_unit_weight_unit` starts with `kg_per_m`, `kg_per_piece`, and `kg_per_unit`. Add another unit only with a source-backed example.
- Repository code must filter `review_state = 'reviewed'` by default for deterministic quote facts.
- Repository code must treat `value_state = 'unknown'` as `未確認`, not as numeric zero.
- Tool results should expose bounded source refs and summaries, not raw source rows or files.
