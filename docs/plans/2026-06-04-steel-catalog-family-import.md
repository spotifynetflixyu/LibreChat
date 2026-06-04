# Steel Catalog Family Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the steel-only `material_family` lookup surface with a generic
`catalog_family` key for all `docs/reference/產品價格.xlsx` product catalog rows.

**Architecture:** Keep `steel.price_categories` as the exhaustive source-backed
category table and migrate the reviewed canonical AI lookup vocabulary from
`material_family` to `catalog_family`. Do not keep `materialFamilies` as a
runtime compatibility input; related importer, repository, tool, defaults, and
provider logic should speak `catalogFamilies` only after this slice.

**Tech Stack:** TypeScript importer in `packages/api`, Jest focused tests,
Supabase cloud Postgres through `STEEL_POSTGRES_URL`, and existing XLSX parsing
with `xlsx`.

---

### Task 1: RED Tests For Catalog Family Import

**Files:**

- Modify: `packages/api/src/steel/importer/reference.spec.ts`
- Modify: `packages/api/src/steel/importer/reference.ts`

**Steps:**

1. Add a failing importer test that expects `buildSteelReferenceImportPlan` to
   expose `catalogFamilies` and `priceCategories`, not `materialFamilies`.
2. Assert that all imported `priceItems` have a `catalogFamily` and
   `categoryCode`.
3. Assert user-requested workbook terms are represented, including `steel_pipe`,
   `piping`, `wall_panel`, `resin_panel`, `aluminum_window`, `water_stop_plate`,
   `iron_door`, `canopy_frame`, `square_pipe_connector`, `telescopic_gate`,
   `b_pipe`, `a_pipe`, `measuring_tool`, `screen_mesh`, `door_decoration`,
   `p_pipe`, `screw`, `corner_wheel`, `door_lock`, `i_beam`, `round_bar`,
   `square_bar`, `galvanized_plate`, `ot_plate`, `black_plate`, and
   `grating`.
4. Run:

   ```bash
   cd packages/api
   npx jest src/steel/importer/reference.spec.ts --runInBand --coverage=false
   ```

5. Expected result: FAIL because `catalogFamilies`, `priceCategories`,
   `catalogFamily`, and `categoryCode` do not exist yet.

### Task 2: RED Tests For Catalog Family Price Search

**Files:**

- Modify: `packages/api/src/steel/repositories/prices.spec.ts`
- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/tools/schemas.ts`

**Steps:**

1. Add repository test for `catalogFamilies: ['screw']`, expecting SQL filter
   `catalog_family IN (...)` and returned DTO field `catalogFamily`.
2. Add tool executor test for `search_price_candidates` with
   `{ catalogFamilies: ['door_lock'] }`.
3. Assert the old `materialFamilies` input is no longer accepted by the tool
   schema.
4. Run focused tests and confirm RED.

### Task 3: Schema Migration

**Files:**

- Modify: `supabase/schema.sql`
- Create: `supabase/migration/<timestamp>_steel_catalog_families.sql`

**Steps:**

1. Generate the migration with:

   ```bash
   npx supabase migration new steel_catalog_families
   ```

2. Rename or recreate `steel.material_families` as `steel.catalog_families`
   with key/display/aliases/metadata/source_refs.
3. Rename `steel.price_items.material_family` to `catalog_family`.
4. Rename `steel.quote_defaults.material_family` to `catalog_family` and update
   scope checks/indexes from `material_family` to `catalog_family`.
5. Add index `price_items_catalog_family_lookup_idx`.
6. Synchronize `supabase/schema.sql` so no active price/default lookup path
   relies on `material_family`.

### Task 4: Importer Implementation

**Files:**

- Modify: `packages/api/src/steel/importer/reference.ts`
- Modify: `packages/api/scripts/import-steel-reference-data.cjs`

**Steps:**

1. Add catalog-family seed rules for reviewed product catalog names and ERP code
   groups.
2. Add ERP-prefix fallback catalog families so every product price row is
   attached to a category even if it is not yet curated.
3. Build `priceCategories` from all source product rows.
4. Populate `priceItems.categoryCode` and `priceItems.catalogFamily`.
5. Upsert `catalog_families`, upsert `price_categories`, load category IDs, and
   insert `price_items.category_id` plus `catalog_family`.
6. Ensure the dry-run summary reports `catalogFamilies` and `priceCategories`.

### Task 5: Runtime Search Migration

**Files:**

- Modify: `packages/api/src/steel/repositories/prices.ts`
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/ai/provider.ts`

**Steps:**

1. Replace `materialFamilies` with `catalogFamilies` in repository and tool
   input types.
2. Return `catalogFamily` in price candidates.
3. Update `lookup_defaults` material context naming to catalog context naming.
4. Update provider instruction text to use `catalog_family` / `catalogFamilies`.

### Task 6: Apply And Verify

**Commands:**

```bash
cd packages/api
npx jest src/steel/importer/reference.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts --runInBand --coverage=false
npm run steel:import-reference-data
npm run steel:import-reference-data -- --apply
```

Then run direct SQL verification for:

- `catalog_families` count and curated key coverage;
- `price_categories` count;
- `price_items.catalog_family IS NOT NULL` for all product-price import rows;
- sample keys from user-requested terms.

### Task 7: Docs And Final Verification

**Files:**

- Modify: `docs/steel-catalog-family-data-contract.md`
- Modify: `tasks/todo.md`
- Modify: `tasks/lessons.md`

**Commands:**

```bash
npx prettier --write packages/api/src/steel/importer/reference.ts packages/api/src/steel/importer/reference.spec.ts packages/api/src/steel/repositories/prices.ts packages/api/src/steel/repositories/prices.spec.ts packages/api/src/steel/tools/schemas.ts packages/api/src/steel/tools/execute.ts packages/api/src/steel/tools/execute.spec.ts packages/api/src/steel/ai/provider.ts docs/steel-catalog-family-data-contract.md tasks/todo.md tasks/lessons.md docs/plans/2026-06-04-steel-catalog-family-import.md
npm run build:api
git diff --check
```

Expected result: focused tests pass, importer apply succeeds, build exits 0,
and docs describe `catalog_family` as the generic canonical key.
