# V8.2 Spec Upgrade

- [x] Read current v8.1 plan package, Supabase schema, and project glossary before writing v8.2.
- [x] Create `steel_librechat_plan_v8.2.md` in Traditional Chinese as an executable development spec.
- [x] Remove external database/enterprise connector planning and replace old import wording with DOCX / XLSX / Admin Import wording.
- [x] Add Admin DOCX/XLSX-only upload policy, seven fixed Workbook sheets, Quote Resolution Engine, eval harness, interfaces, API routes, schemas, and production checklist.
- [x] Verify required v8.2 terms are present and removed v8.1 planning terms are absent.
- [x] Rename `tasks/v8.1` to `tasks/v8.2` and update the phase plans to match `steel_librechat_plan_v8.2.md`.
- [x] Verify `tasks/v8.2` no longer contains stale v8.1-only import, workbook, PDF, or connector assumptions.
- [x] Apply user correction: remove Admin PDF parser/transformation planning and restrict Admin data uploads to DOCX/XLSX only.

## Review

- User supplied the v8.2 handoff as the approved design baseline. The task is to consolidate it into one implementation-ready spec file, not to implement runtime code yet.
- Created `steel_librechat_plan_v8.2.md` with 30 core sections plus API route, Mongo schema, Supabase schema, Admin preview, UX, and production checklist drafts.
- Verification checked required v8.2 anchors, TypeScript interface draft names, fixed seven-sheet names, Admin DOCX/XLSX-only upload policy, ExcelJS, Supabase PostgreSQL, and removed old connector/import planning terms.
- Renamed the phase-plan package from `tasks/v8.1` to `tasks/v8.2` and rewrote README, checkpoints, and phases 0-5 around v8.2.
- Phase plans now include Admin DOCX/XLSX upload policy, DOCX/XLSX Admin Import, fixed seven-sheet Workbook, Quote Resolution Engine, normalization, price search/ranking, stock allocation, deterministic calculators, ExcelJS export, Admin preview, and eval harness gates.

# V8.2 Dev Planning Package

- [x] Read `CLAUDE.md`, `CONTEXT.md`, `tasks/lessons.md`, and `docs/plan_v8.1.md`.
- [x] Inventory current Steel implementation state before planning new work.
- [x] Create phase-based dev plans under `tasks/v8.2/`.
- [x] Add checkpoints, acceptance criteria, verification commands, and PM decision gates.
- [x] Verify the plan package covers all major v8.2 modules and current repo constraints.
- [x] Record planning review results.

## Review

- `docs/plan_v8.1.md` is an architecture and feature planning doc, not an implementation-ready task breakdown.
- Current implemented Steel code is still narrow: `packages/api/src/steel/postgres.ts`, its unit test, the initial Supabase schema/migration, and local-dev docs.
- Existing domain glossary already defines `Canonical Product`, `Product Alias`, `Spec Candidate`, `Preference Rule`, and `Clarification`; the dev plan must preserve those terms.
- This pass should not import or process `docs/reference/doc` source files; source-data files are AI/dev logic references only.
- The requested output location is now `tasks/v8.2/`, so this planning package intentionally uses that path instead of the generic `docs/plans/` convention.
- Created the v8.2 plan package: `README.md`, phase 0-5 plan files, and `checkpoints.md`.
- User corrected guest mode: quote conversation/workbook/export access must be controlled by an environment flag. Enabled means no login or permission required; disabled means login plus admin-approved Steel permission required.
- Grill-with-docs resolved the guest mode default: `STEEL_GUEST_MODE` defaults to `false` and fails closed unless explicitly set to `true`.
- Phase 0 high-risk decisions are now recorded through the export library decision.
- Grill-with-docs resolved the OpenAI state contract: Responses API calls use `conversation` only; `previous_response_id` is mutually exclusive with `conversation` and is stored only for audit/fallback.
- User corrected quote traceability: workbook lines must persist the related formula, database default unit price, quoted unit price, line total, and explicit unit-price/total-price adjustments as permanent workbook data.
- Grill-with-docs resolved workbook price stability: latest database unit price is only the default for new pricing or explicit recalculation; existing workbook prices, quantities, and totals must not change unless the user asks to change that line.
- v8.2 replaces old import-key wording with neutral Admin source-data keys; rows missing confirmed lookup keys go to `needs_review`.
- Grill-with-docs resolved retrieval strategy: Steel uses its own PostgreSQL + pgvector retrieval module so required project/source/version/chunk/category/guest filters are enforced server-side.
- Grill-with-docs resolved customer Excel mask: allow only customer quote fields using `quoted_unit_price` and `line_total` for visible prices, and hide `customer_tier` plus internal/debug fields.
- Grill-with-docs resolved async boundary: first prove a real OpenAI chat can create a customer-visible workbook; keep MVP small flows synchronous with payload/timeout limits and defer BullMQ to Phase 5 unless measured scale forces it earlier.
- Grill-with-docs resolved source data readiness: `docs/reference/doc` is AI/dev reference only; real data updates flow through Admin source type selection, XLSX upload, merge/update/delete review, then backend API commit to the related table.
- Current dependency check found `openai@5.8.2` only in the legacy `api` package, and `xlsx@0.20.3` but no `exceljs`; Phase 4 must add ExcelJS deliberately to the backend package that owns customer-facing export rendering.
- Grill-with-docs resolved export rendering: use ExcelJS for customer-facing XLSX output, while keeping `xlsx` for admin import parsing and generated workbook read-back tests unless implementation proves consolidation is better.
- The plan covers all final v8.2 modules through phase ownership: conversation meta, projects, sources, instructions, Admin DOCX/XLSX source parsing, Admin import, AI merge table, tool registry, OpenAI orchestrator, prompt builder, Quote Resolution Engine, normalization, pricing, stock allocation, calculators, workbook, Excel export, memory, retrieval, evals, audit, repositories, permissions, and async jobs.

# Steel Dev Preflight Setup

- [x] Read `docs/plan_v8.1.md` database boundary and local dev notes.
- [x] Check local Postgres configuration without printing secrets.
- [x] Resolve Step 1: choose the canonical PostgreSQL target for schema import.
- [x] Resolve Step 2: verify Supabase SQL access and pgvector extension readiness.
- [x] Create `supabase/schema.sql` as the complete Steel Supabase schema snapshot.
- [x] Create an initial one-change SQL file under `supabase/migration/`.
- [x] Update project agent docs with the schema snapshot plus migration rule.
- [x] Apply `supabase/migration/202605230001_initial_steel_schema.sql` in Supabase SQL Editor.
- [x] Verify Steel Supabase schema objects after initial migration.
- [x] Inventory `docs/reference/doc` source files before planning data import.
- [x] Verify Steel Supabase trigger/function wiring.
- [x] Smoke-test `updated_at` and `price_history` behavior inside a rollback transaction.
- [x] Resolve the first non-data engineering preflight target.
- [x] Add `pg` as the Steel backend Postgres client dependency.
- [x] Add a test-first Steel Postgres connection helper in `packages/api`.
- [x] Verify the helper can perform a read-only Supabase smoke query through `STEEL_POSTGRES_URL`.
- [x] Decide Supabase pooler TLS behavior for local backend development.
- [ ] Decide Supabase CA-backed `verify-full` policy for deployed backend environments.

## Review

- `docs/plan_v8.1.md` requires MongoDB for LibreChat/application state and PostgreSQL `steel` schema for structured steel business data.
- `.env` already has a non-empty `STEEL_POSTGRES_URL`.
- The development database target is Supabase Postgres via `STEEL_POSTGRES_URL`; Docker is intentionally out of scope for this setup.
- The MongoDB target is the configured cloud MongoDB via `MONGO_URI`; Docker MongoDB is intentionally out of scope.
- `psql` CLI is not currently available on PATH.
- Supabase SQL access is verified by the user; `vector` extension exists at version `0.8.0` in the `public` schema.
- Supabase CLI is not currently available on PATH, so the initial migration filename is created directly rather than via `supabase migration new`.
- Added `supabase/schema.sql` and `supabase/migration/202605230001_initial_steel_schema.sql`; both currently contain the same initial Steel schema.
- Updated `AGENTS.md` and `CLAUDE.md` so code agents must update the full schema snapshot and add a one-change migration together.
- Supabase SQL Editor reported the initial migration succeeded with no returned rows.
- `source_embeddings.embedding` was verified as PostgreSQL `vector`.
- `docs/reference/doc` contains company reference inputs for AI/dev logic reference only: `公式編號.xlsx`, `客戶資料.xlsx`, `產品價格.xlsx`, `系統訂單.xlsx`, and `龍頂鋼鐵手冊__文字版.docx`.
- Runtime AI should query normalized database/tool results, not directly inspect XLSX/DOCX reference files for prices or specs.
- The `steel` schema table list contains all 21 expected base tables.
- Trigger wiring is present: `price_items` has `record_price_history`, and every table with an `updated_at` column has `set_updated_at`.
- Rollback smoke test proved `price_items.unit_price` updates write `steel.price_history` with `old_unit_price`, `new_unit_price`, and `last_import_log_id`.
- Do not process or import `docs/reference/doc` files; real data updates must go through Admin source type selection, XLSX upload, merge/update/delete review, and backend API commit.
- Current dependency check: `packages/api` has `zod` and `ioredis`; no Postgres client dependency is present yet. `openai` is currently only declared in the legacy `api` package.
- Ambiguous customer terms such as `常用的` should resolve through admin-taught preference rules/memory, not hard-coded product-table defaults such as `is_default`.
- For incomplete price questions with multiple matching specs, AI should ask for the missing spec detail and may show all candidate prices, e.g. t8 and t12, in NTD.
- User approved `pg` for the Steel backend Postgres access layer.
- Added `pg` runtime dependency for `api`, `pg` peer dependency for `packages/api`, and `@types/pg` for `packages/api`.
- Added `packages/api/src/steel/postgres.ts` with `STEEL_POSTGRES_URL` config, conservative pool defaults, and a read-only readiness query.
- The focused Steel Postgres unit test passes, and `npm run build:api` completes without TypeScript warnings.
- Read-only live smoke is blocked because the current `STEEL_POSTGRES_URL` uses a direct Supabase host that does not resolve from this environment; use Supavisor session pooler for IPv4-compatible local development.
- To reduce future upstream merge conflicts, Steel code should stay in additive project-specific paths; premature root exports/core entrypoint edits should be avoided until runtime integration needs them.
- After switching `STEEL_POSTGRES_URL` to the Supavisor session pooler, DNS resolves to IPv4 and the read-only helper smoke query returns `steelSchemaExists=true`, `steelTableCount=21`, and `vectorExtensionVersion=0.8.0`.
- Additional SSL introspection returned `ssl=false`; treat Supabase pooler TLS/CA verification as a separate explicit preflight decision before production deployment.
- Testing `?sslmode=require` alone with the current Node `pg` stack fails with `self-signed certificate in certificate chain` because current `pg-connection-string` treats `require` like `verify-full`.
- Testing `?sslmode=require&uselibpqcompat=true` succeeds for the read-only Supabase smoke query, but production should still prefer explicit CA-backed `verify-full` once the Supabase CA certificate is configured.
- `.env` now uses the Supavisor session pooler with `sslmode=require&uselibpqcompat=true`, and the Steel Postgres helper smoke query passes.
- `docs/local-dev.md` documents the local Steel `STEEL_POSTGRES_URL` pooler format.

# Frontend Dev Build Check

- [x] Review project workflow docs and root npm scripts.
- [x] Trace `frontend:dev` dependencies through workspace package manifests.
- [x] Identify the minimal required build command sequence.
- [x] Run the selected build commands.
- [x] Smoke-test `npm run frontend:dev` startup and document results.

# `/api/config` Proxy Check

- [x] Reproduce the `/api/config` proxy failure.
- [x] Check whether backend is listening on port 3080.
- [x] Build missing `client/dist` required by backend startup.
- [x] Start or repair the backend dev server.
- [x] Verify `/api/config` through the frontend proxy.
- [x] Document the final run commands.

# Local Dev Docs Update

- [x] Create `docs/local-dev.md` for the verified local frontend/backend dev command sequence.
- [x] Replace the detailed `CLAUDE.md` sequence with a pointer to `docs/local-dev.md`.
- [x] Verify the docs mention the `client/dist/index.html` backend startup requirement.
- [x] Record the docs update result.

# LibreChat Config Startup Fix

- [x] Confirm `librechat.yaml` is required at the repo root unless `CONFIG_PATH` is set.
- [x] Create a minimal `librechat.yaml`.
- [x] Verify backend startup passes the missing YAML error.
- [x] Note the separate MeiliSearch warning cause.

# Disable Local MeiliSearch

- [x] Confirm which env vars control MeiliSearch plugin and index sync.
- [x] Disable local MeiliSearch in `.env`.
- [x] Verify backend starts without Meili fetch errors.
- [x] Update `docs/local-dev.md` with the precise disable settings.

## Review

- `.env` contains `MONGO_URI` and `STEEL_POSTGRES_URL` keys; values were not printed.
- Minimal build path for `npm run frontend:dev`: `npm run build:data-provider && npm run build:client-package`.
- `npm run build:data-provider` completed successfully.
- `npm run build:client-package` completed successfully and recreated `packages/client/dist`.
- `npm run frontend:dev` started Vite successfully on `http://localhost:3090/`; a direct HTTP probe returned `200 OK`.
- The final npm lifecycle error came from intentionally stopping the smoke-test process after startup verification.
- Later `/api/config` proxy error root cause: backend was not listening on port 3080.
- Direct backend startup showed MongoDB connected, then backend exited because `/Users/neven/Documents/projects/LibreChat/client/dist/index.html` was missing.
- `npm run build:client` completed successfully and created `client/dist/index.html`.
- After `npm run backend:dev`, `http://localhost:3080/health`, `http://localhost:3080/readyz`, and `http://localhost:3080/api/config` returned `200`.
- With `npm run frontend:dev` running too, `http://localhost:3090/api/config` returned `200` through the Vite proxy.
- Smoke-test backend/frontend processes launched by Codex were stopped after verification.
- Added `docs/local-dev.md` with the verified command sequence and `/api/config` proxy troubleshooting note.
- Updated `CLAUDE.md` to point to `docs/local-dev.md`.
- Created a minimal root `librechat.yaml` with `version: 1.3.11`.
- Verified `npm run backend:dev` starts after adding `librechat.yaml`; `http://localhost:3080/health` and `http://localhost:3080/api/config` returned `200`.
- Documented local `librechat.yaml` and MeiliSearch log handling in `docs/local-dev.md`.
- Disabled local MeiliSearch by setting `SEARCH=false`, clearing `MEILI_HOST` and `MEILI_MASTER_KEY`, and setting `MEILI_NO_SYNC=true` in `.env`.
- Verified backend startup after disabling MeiliSearch: `http://localhost:3080/api/config` returned `200`, and captured startup logs had no `mongoMeili`, `indexSync`, or `fetch failed` lines.
