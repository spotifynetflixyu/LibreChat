# Steel Reference Data Importer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and run a repeatable importer that reads approved Steel reference files and upserts customer, price, cutting, formula, and default-rule facts into Supabase.

**Architecture:** Keep source parsing in `packages/api/src/steel/importer` with pure functions covered by Jest. Keep database writes in one CLI script under `packages/api/scripts`, using `STEEL_POSTGRES_URL` and an explicit `--apply` flag. Workbook/order reference files remain excluded from formal database fact imports.

**Tech Stack:** TypeScript, Jest, `xlsx`, `pg`, existing Steel Supabase schema, Node `ts-node/register/transpile-only` script wrapper.

---

### Task 1: Parser Contract

**Files:**

- Create: `packages/api/src/steel/importer/reference.ts`
- Create: `packages/api/src/steel/importer/reference.spec.ts`

**Steps:**

1. Write failing parser tests using current `docs/reference` files.
2. Assert these source classifications:
   - DB fact sources: `客戶資料.xlsx`, `產品價格.xlsx`, `切工價錢.xlsx`, `公式編號.xlsx`, `H型鋼.txt`.
   - Workbook-only references: `訂單參考.xlsx`, `系統訂單.xlsx`.
3. Assert counts are non-trivial: customer rows, tiered price rows, cutting rows, formula rows, and defaults.
4. Assert `0.00` prices become `valueState: "unknown"` and `reviewState: "needs_review"`, not true zero.
5. Implement the minimal parser.
6. Verify with:
   `cd packages/api && npx jest src/steel/importer/reference.spec.ts --runInBand --coverage=false`

### Task 2: Database Upsert Plan

**Files:**

- Modify: `packages/api/src/steel/importer/reference.ts`
- Test: `packages/api/src/steel/importer/reference.spec.ts`

**Steps:**

1. Write tests for SQL batch summaries and stable import log ids.
2. Implement batch DTOs for:
   - `customer_tiers`
   - `customers`
   - `price_items`
   - `cutting_prices`
   - `formula_versions`
   - `quote_defaults`
3. Keep `source_refs` on every imported fact.
4. Verify parser tests stay green.

### Task 3: Executable CLI

**Files:**

- Create: `packages/api/scripts/import-steel-reference-data.cjs`
- Modify: `packages/api/package.json`

**Steps:**

1. Add `steel:import-reference-data` script.
2. Script supports default dry-run and `--apply`.
3. Dry-run prints JSON summary and does not connect to DB.
4. Apply requires `STEEL_POSTGRES_URL`, opens one transaction, upserts/deletes only importer-owned rows, commits, and prints verification counts.
5. On error, rollback and exit non-zero.

### Task 4: Verification And Database Update

**Steps:**

1. Run focused Jest importer tests.
2. Run dry-run:
   `cd packages/api && npm run steel:import-reference-data`
3. Run apply:
   `cd packages/api && npm run steel:import-reference-data -- --apply`
4. Verify with SQL counts for imported source refs and selected known rows.
5. Run `npm run build:api` if TypeScript surface changed.
6. Update `tasks/todo.md` review notes with applied counts and test evidence.
