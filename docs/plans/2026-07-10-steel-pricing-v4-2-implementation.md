# Steel Pricing v4.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `steel.prices` from v4.2, return query-addressable grouped price candidates, restore safe Kg/M ratio pricing, rename category rules, and add the `system_order.度` output column.

**Architecture:** A shared category registry validates workbook rows and tool inputs. A pure TypeScript v4.2 parser feeds an atomic full-replacement importer. Price lookup preserves query provenance in SQL and projects direct/ratio pricing options without exposing unsupported ratio values as quoteable prices.

**Tech Stack:** TypeScript, Jest, Zod, Node.js, SheetJS, PostgreSQL/Supabase, SQL migrations, reviewed text rules.

## Global Constraints

- `docs/products_db_v4.2.xlsx` and `products_db_ready` are the only price-data source.
- `erp_item_code` is the unique row identity; `spec_key` is keyword text only.
- Rows absent from v4.2 must be deleted from `steel.prices`.
- Missing price/ratio values must be SQL `NULL`, never zero.
- Query limit defaults to 30 and positive values above 100 clamp to 100 without rejection.
- Search output must be grouped and carry the corresponding `queryId`.
- Non-Kg/M ratios remain stored but are marked skipped with `category_rule_pending`.
- Category rule folder/name is `docs/rules/類別規則` / category rules.
- `system_order.度` is populated only for `捲門/伸縮門` formula DA/DB/DC; all other rows leave it empty.
- Update both `supabase/schema.sql` and new files created by `npx supabase migration new`.
- Do not run Prettier.
- Preserve unrelated user deletions and the untracked v4.2 workbook.

---

### Task 1: Category registry and v4.2 parser

**Files:**
- Create: `packages/api/src/steel/pricing/categories.ts`
- Create: `packages/api/src/steel/pricing/categories.spec.ts`
- Create: `packages/api/src/steel/pricing/v4.ts`
- Create: `packages/api/src/steel/pricing/v4.spec.ts`
- Modify: `packages/api/src/steel/pricing/enums.ts`

**Interfaces:**
- Produces `priceCategories`, `priceSubcategoriesByCategory`, `isPriceSubcategory`, and `buildSteelPriceV4Rows`.
- The parser returns all 39 workbook fields plus `specKey`, `priceKind`, `sourceDataset`, `sourceRowKey`, `currency`, `active`, and `reviewState`.

- [ ] Write registry tests asserting all 26 categories, the complete subcategory union, T型鋼, and valid empty subcategory.
- [ ] Run `cd packages/api && npx jest src/steel/pricing/categories.spec.ts --runInBand --watch=false --coverage=false`; verify RED because the registry does not exist.
- [ ] Implement the immutable category registry and reuse it from `enums.ts`.
- [ ] Write parser tests for leading-zero ERP codes, `<ERP> <normalized spec>` spec keys, zero-to-null price/ratio normalization, confirmed/ratio_only/no_price invariants, nullable product/spec/unit fields, and invalid category/subcategory failures.
- [ ] Run the parser spec and verify RED because `buildSteelPriceV4Rows` does not exist.
- [ ] Implement the single-pass parser with explicit input/output types and no `any`.
- [ ] Run both pricing specs and verify GREEN.

### Task 2: Supabase v4.2 schema and atomic importer

**Files:**
- Create via CLI: `supabase/migration/*_steel_prices_v4_2_expand.sql`
- Create via CLI: `supabase/migration/*_steel_prices_v4_2_finalize.sql`
- Modify: `supabase/schema.sql`
- Create: `packages/api/scripts/import-steel-price-v4.cjs`
- Create: `packages/api/scripts/import-steel-price-v4.spec.ts`

**Interfaces:**
- Consumes `buildSteelPriceV4Rows` and the exact 39-column header list.
- Produces `--dry-run` JSON reconciliation and `--apply` atomic replacement.

- [ ] Write importer tests for the exact sheet/header contract, default workbook path, dry-run summary, all-row validation before connection mutation, and transaction rollback on insert/readback failure.
- [ ] Run `cd packages/api && npx jest scripts/import-steel-price-v4.spec.ts --runInBand --watch=false --coverage=false`; verify RED.
- [ ] Run `npx supabase migration new steel_prices_v4_2_expand` and `npx supabase migration new steel_prices_v4_2_finalize`.
- [ ] Implement expand/finalize SQL, including base/D/E/ratio/dimension fields, v4.2 checks, ERP uniqueness, spec/category indexes, and removal of replaced legacy fields.
- [ ] Update `supabase/schema.sql` to the complete final schema.
- [ ] Implement the importer using `products_db_ready`, an advisory/table lock, `TRUNCATE ... RESTART IDENTITY`, batched inserts, readback counts, and transaction rollback.
- [ ] Run importer and parser specs; verify GREEN.
- [ ] Run importer `--dry-run` against `docs/products_db_v4.2.xlsx`; expect 6,761 rows, 0 duplicate ERP, and state totals 4,880/230/1,651.

### Task 3: Grouped multi-query lookup and ratio options

**Files:**
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/registry.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/tools/sanitize.ts`
- Modify: `packages/api/src/steel/ai/provider.ts`
- Modify: `packages/api/src/steel/repositories/prices.ts`
- Modify tests beside each module.

**Interfaces:**
- Produces normalized query IDs, `SteelPriceQueryResult[]`, direct/ratio pricing options, and skipped ratio markers.

- [ ] Write schema tests proving omitted limit remains undefined, 101 and larger clamp to 100, 0 still fails, query IDs preserve user values, and missing IDs become `q1`, `q2`.
- [ ] Run schema/registry specs and verify RED on clamp/query-ID assertions.
- [ ] Implement schema normalization with positive-integer clamp and category-specific subcategory validation.
- [ ] Write repository tests proving one SQL call preserves query ID/index, exact ERP/category/subcategory filters, per-query limits, input order, and duplicate rows across different queries.
- [ ] Run repository specs and verify RED.
- [ ] Implement grouped repository rows and per-query dedupe.
- [ ] Write executor/provider/sanitizer tests for grouped output, summary counts, same-round coalescing, Kg/M ratio options, non-Kg/M skipped ratio, direct-tier priority, A-F fields, and no raw ratio leakage.
- [ ] Run the focused specs and verify RED.
- [ ] Implement grouped projection and provider counting/coalescing.
- [ ] Run all focused tool/repository/provider specs and verify GREEN.

### Task 4: Rename and complete category rules

**Files:**
- Rename: `docs/rules/鋼材規則/` → `docs/rules/類別規則/`
- Create: `docs/rules/類別規則/查價方式.txt`
- Modify moved rule files for v4.2 categories and grouped query examples.
- Modify: `docs/rules/agent規則.txt`
- Modify: `packages/api/scripts/sync-steel-rules.cjs`
- Add/update sync-script tests.

**Interfaces:**
- Consumes the category registry taxonomy.
- Produces reviewed DB rules whose source refs use `docs/rules/類別規則/...`.

- [ ] Write sync tests that fail while the old folder/name remains and that require every registry category in `查價方式.txt`.
- [ ] Run the sync specs and verify RED.
- [ ] Rename the folder, update metadata/source refs, and add concise query patterns for every category and subcategory group.
- [ ] Update generic Agent wording to grouped query IDs, default 30/max-clamped 100, and category-rule terminology.
- [ ] Run sync dry-run and focused specs; verify GREEN.

### Task 5: Add `system_order.度`

**Files:**
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/schema/mapping.ts`
- Modify: `packages/api/src/steel/schema/mapping.spec.ts`
- Modify: `packages/api/src/steel/memory/service.spec.ts`
- Modify: `packages/api/src/steel/handlers.spec.ts`
- Modify: `docs/rules/輸出規則.txt`
- Modify PB/live expected header fixtures.

**Interfaces:**
- Produces strict `system_order` headers containing `度` after `長度`.
- Maps output `度` to `steel.order_items.metadata.degree`, with the rule-level meaning of the reviewed DA/DB/DC `肚` formula input.

- [ ] Write failing strict-header/mapping tests with `度` after `長度`.
- [ ] Run focused execute/mapping/memory/handler specs and verify RED.
- [ ] Add the header alias/mapping and update output rules: only `捲門/伸縮門` with DA/DB/DC fills `度`; other categories leave it blank.
- [ ] Update all strict header fixtures and run the focused tests to GREEN.

### Task 6: Cloud migration, data replacement, rule sync, and verification

**Files:**
- Modify only generated migration history through the documented Supabase workflow.
- Update `tasks/todo.md` review section with actual verification evidence.

**Interfaces:**
- Consumes the tested migrations/importer/rule sync.
- Produces live cloud `steel.prices` and reviewed category-rule rows.

- [ ] Verify live Postgres version/extensions and repair migration history `20260623115453` as applied.
- [ ] Apply the expand migration through `STEEL_POSTGRES_URL`.
- [ ] Run the v4.2 importer with `--apply`; verify 6,761 rows and state totals inside the transaction.
- [ ] Apply the finalize migration and run schema/index/constraint readback queries.
- [ ] Run category-rule sync `--dry-run`, then `--apply`, then read back source refs/hashes.
- [ ] Run focused Jest suites, `cd packages/api && npm run build`, `git diff --check`, and live multi-query smokes covering grouped query IDs, limit clamp, direct price, ratio Kg, and skipped non-Kg/M ratio.
- [ ] Reconcile all plan requirements and record results without claiming completion before fresh evidence.
