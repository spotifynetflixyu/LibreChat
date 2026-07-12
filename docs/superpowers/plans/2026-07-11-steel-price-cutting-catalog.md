# Steel Price And Cutting Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return grouped product price candidates plus one consolidated cutting catalog, backed by a verified clean workbook and independent dev Supabase table, while updating Steel category pricing and `system_order.肚` rules.

**Architecture:** Preserve the existing grouped `steel.prices` SQL lookup, then collect unique supported categories and issue one second, unlimited contains query against `steel.cutting_prices`. A pure clean-workbook parser feeds an atomic replacement importer; AI-visible output separates concrete cutting prices from supplemental rules and preserves query/category provenance.

**Tech Stack:** TypeScript, Jest, Zod, PostgreSQL/Supabase, Node.js import scripts, `@oai/artifact-tool`, reviewed text rules.

## Global Constraints

- `docs/products_db_v4.2.xlsx` remains authoritative for `steel.prices`.
- `docs/reference/切工價錢-raw.xlsm` is the raw cutting source; `docs/reference/切工價錢-clean.xlsx` is the only cutting import source.
- All cutting category matching is contains-based; only `圓管`, `方管`, and `扁方管` map to `鐵管`.
- Cutting lookup runs once after all normal price queries, has no row limit, and uses no filter except cutting category contains terms.
- Normal candidate limit defaults to 30; the AI omits it normally and uses 100 only to expand. Positive values above 100 clamp to 100.
- `material` and `keyword` use contains matching. Material enum includes separate `錏` and `鋅`; `鋅` includes `鍍鋅`.
- Numeric thickness input `2` must match stored numeric text `2`, `2.0`, and `2.00`.
- Remove the query input `unit`, remove `steel.prices.review_state`, and do not add `review_state` to `steel.cutting_prices`.
- Preserve `steel.rules.review_state`.
- AI-visible price candidates do not contain `sourceRefs`.
- `system_order` uses `肚`, not `度`, gated only by DA/DB/DC formula code.
- Apply schema/data/rule changes to dev only; do not access or modify prod.
- Update both `supabase/schema.sql` and a migration created by `npx supabase migration new`.
- Do not run Prettier.

---

### Task 1: Generate the clean cutting workbook

**Files:**
- Create: `docs/reference/切工價錢-clean.xlsx`
- Create: `packages/api/src/steel/pricing/cutting.ts`
- Test: `packages/api/src/steel/pricing/cutting.spec.ts`

**Interfaces:**
- Produces `buildSteelCuttingRows()` returning `{ prices, supplements }` with normalized spec text, exact decimal inch/mm min/max values, nullable B price, and source coordinates.
- Produces sheets `cutting_prices` and `cutting_supplements` with stable import headers.

- [ ] Write parser tests for NFKC/spec `*`→`x`, fractional inch values/ranges, `inch * 25.4` min/max values without rounding, price/supplement classification, tier-B null preservation, and duplicate source-row rejection.
- [ ] Run `cd packages/api && rtk npx jest src/steel/pricing/cutting.spec.ts --runInBand --watch=false --coverage=false`; verify RED because the parser does not exist.
- [ ] Implement the pure row types and parser in `cutting.ts`.
- [ ] Build one temporary artifact-tool script in the conversation work directory that imports the raw XLSM, transforms the reviewed source ranges, formats both clean sheets, freezes headers, applies numeric formats, and exports the clean XLSX. The reviewed workbook, not the one-time builder, is the durable repository artifact.
- [ ] Run the builder and parser tests; verify GREEN.
- [ ] Inspect both clean sheets, scan formula errors, render both sheets, and visually verify legibility and source/target row reconciliation.

### Task 2: Add the cutting schema and atomic importer

**Files:**
- Create via CLI: `supabase/migration/*_steel_cutting_prices_and_price_review_cleanup.sql`
- Modify: `supabase/schema.sql`
- Create: `packages/api/scripts/import-steel-cutting-prices.cjs`
- Test: `packages/api/scripts/import-steel-cutting-prices.spec.ts`
- Modify: `packages/api/src/steel/pricing/v4.ts`
- Modify: `packages/api/src/steel/pricing/v4.spec.ts`
- Modify: `packages/api/scripts/import-steel-price-v4.cjs`

**Interfaces:**
- Produces `steel.cutting_prices` with price/supplement records and no ERP/review-state dependency.
- Removes `steel.prices.review_state` while keeping existing source/active data.
- Importer supports `--dry-run` and `--apply` using `.env` `STEEL_POSTGRES_URL`.

- [ ] Write failing importer tests for exact sheet/header contracts, full pre-validation, atomic replacement, rollback, and row-count readback.
- [ ] Update v4 price parser/import tests to prove no `review_state` column is written.
- [ ] Run both focused suites and verify RED.
- [ ] Inspect `npx supabase migration --help`, then create the migration with `npx supabase migration new steel_cutting_prices_and_price_review_cleanup`.
- [ ] Implement the table, checks, category/search index, and removal of the price review constraint/index/column in both migration and schema snapshot.
- [ ] Implement the clean-workbook importer with a transaction, table lock, truncate, batched insert, and count/type/category reconciliation.
- [ ] Run focused tests and a clean-workbook `--dry-run`; verify GREEN and exact source/import totals.

### Task 3: Update price filters and append consolidated cutting data

**Files:**
- Modify: `packages/api/src/steel/pricing/enums.ts`
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/registry.ts`
- Modify: `packages/api/src/steel/repositories/prices.ts`
- Modify: `packages/api/src/steel/repositories/prices.spec.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/tools/schemas.spec.ts`
- Modify: `packages/api/src/steel/tools/registry.spec.ts`

**Interfaces:**
- Produces `searchSteelCuttingPriceGroups(client, queries)` and a top-level `cuttingPrices` array.
- Normal price query results remain in `queryResults` and retain input order/query IDs.

- [ ] Write failing schema/registry tests that add `鋅`, separate `錏`, reject removed `unit`, retain default/100 clamp behavior, and describe normal limit omission.
- [ ] Write failing repository tests for numeric thickness equality, no review-state predicate, material/keyword contains matching, category mapping, one contains-only unlimited cutting SQL call, query/category provenance, and no cutting SQL when unsupported.
- [ ] Write failing executor tests for top-level cutting groups, prices/supplements separation, tier-B fallback, deduplication, and no AI-visible candidate `sourceRefs`.
- [ ] Run focused schemas/registry/repository/executor suites and verify RED on the new assertions.
- [ ] Implement the minimal schema, query serialization, safe numeric thickness comparison, material terms, cutting mapping/query, and output projection.
- [ ] Run all focused suites and verify GREEN.

### Task 4: Update category and output rules

**Files:**
- Modify: `docs/rules/類別規則/查價方式.txt`
- Modify: `docs/rules/類別規則/鐵板.txt`
- Modify: `docs/rules/類別規則/C型鋼.txt`
- Modify: `docs/rules/類別規則/H型鋼.txt`
- Modify: `docs/rules/類別規則/長條料-切工.txt`
- Modify: `docs/rules/agent規則.txt`
- Modify: `docs/rules/輸出規則.txt`
- Modify: `packages/api/scripts/sync-steel-rules.spec.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify strict header/mapping fixtures in `packages/api/src/steel/**/*.spec.ts`.

**Interfaces:**
- Rules teach one grouped price call, automatic final cutting enrichment, 白鐵/黑鐵 plate preference, CCG02 2C processing, ratio limits, and `肚` output.

- [ ] Write failing sync/header/mapping tests for no query `unit`, automatic cutting catalog use, 白鐵 `<3t 2B`/`>=3t NO1`, 黑鐵雷射切割 preference, `CCG02`, and `肚` after `長度`.
- [ ] Run focused rule/header suites and verify RED.
- [ ] Update category and agent rules to use the new contract and remove separate `加工/切工` query instructions for supported cutting categories.
- [ ] Replace fixed `度` headers/aliases/mapping with `肚`; gate by formula DA/DB/DC only and document blank/manual-review behavior when unknown.
- [ ] Run sync dry-run and focused suites; verify GREEN.

### Task 5: Apply and verify dev Supabase/data/rules

**Files:**
- Modify: `tasks/todo.md` with actual evidence.

**Interfaces:**
- Consumes tested migration/importers/rule sync.
- Produces a verified dev-only schema, cutting catalog, updated prices, and reviewed rules.

- [ ] Verify the CLI version/help, dev Postgres identity/version, current price count, and current rule hashes without printing credentials.
- [ ] Apply the migration to dev using `.env` `STEEL_POSTGRES_URL`.
- [ ] Re-run the v4.2 price importer so rows match the review-state-free schema.
- [ ] Apply the clean cutting importer and reconcile total, record-type, and category counts.
- [ ] Sync Steel rules to dev, then read back source paths/hashes and confirm `steel.rules.review_state` remains.
- [ ] Execute representative live grouped queries for H型鋼, 鐵板/平鐵, all three pipe mappings, 角鐵, 槽鐵, unsupported categories, numeric thickness, material `鋅`, and limit 101 clamp.

### Task 6: Completion verification and review

**Files:**
- Modify: `tasks/todo.md` checklist/review.

**Interfaces:**
- Produces requirement-by-requirement completion evidence while leaving prod untouched.

- [ ] Run all focused Jest suites changed by Tasks 1-4.
- [ ] Run `cd packages/api && rtk npm run build`.
- [ ] Run focused ESLint/static checks and `rtk git diff --check`.
- [ ] Inspect final clean workbook ranges and render both sheets again.
- [ ] Read back dev schema, row counts, category counts, no-price-review column, and cutting query results.
- [ ] Audit every design requirement against workbook, code, tests, dev database, and rule evidence; record the results in `tasks/todo.md`.
- [ ] Stop before production and report the explicit remaining prod approval gate.
