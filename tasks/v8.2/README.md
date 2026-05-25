# Steel v8.2 Development Plan

This folder converts [`steel_librechat_plan_v8.2.md`](../../steel_librechat_plan_v8.2.md) into an implementation roadmap with phase gates, checkpoints, and verification commands.

The plan assumes the current repository state:

- `supabase/schema.sql` and `supabase/migration/202605230001_initial_steel_schema.sql` define the initial private `steel` schema.
- `packages/api/src/steel/postgres.ts` provides the Steel Supabase connection helper and readiness query.
- The repo currently declares `xlsx@0.20.3`; v8.2 export must add ExcelJS deliberately for customer-facing XLSX rendering.
- No Steel Mongo schemas, Steel HTTP routes, Steel data-provider types, client Steel UI, orchestrator, workbook engine, Excel export, Admin import, memory, source parsing, eval harness, environment-gated guest access, or Steel retrieval implementation exists yet.
- `CONTEXT.md` defines the domain terms `Canonical Product`, `Product Alias`, `Spec Candidate`, `Preference Rule`, `Clarification`, `Guest Mode`, `Workbook Line`, and `Customer Export`.

## Operating Rules

- Keep new backend logic in `packages/api/src/steel`.
- Keep `api/` changes thin: route registration and wrappers only.
- Keep MongoDB Steel collections prefixed with `steel_`.
- Keep Steel SQL tables in the private Supabase PostgreSQL `steel` schema.
- Any Supabase PostgreSQL schema change must update both `supabase/schema.sql` and a one-change file under `supabase/migration/`.
- Do not process or import `docs/reference/doc` source files; they are AI/dev logic references only.
- Formal Admin Import accepts DOCX / XLSX parsed data only.
- Admin Import rejects PDF, image PDF, screenshots, image files, and `.txt`; those files do not create merge rows or formal database writes.
- Use the glossary in `CONTEXT.md`; ambiguous wording such as `常用的` resolves through admin-taught rules/memory, not hard-coded product defaults.

## MVP Boundary

The v8.2 MVP is production-shaped and access is environment-gated:

- Environment-controlled Steel quote access via `STEEL_GUEST_MODE`.
- Conversation-first quote flow with selected OpenAI model.
- Deterministic customer tier, normalization, price search, price ranking, stock allocation, and calculator modules.
- OpenAI Responses orchestration with local audit records and `context_refs`.
- Workbook JSON creation and JSON Patch updates with seven fixed sheets:
  - 報價明細
  - 總結
  - 人工複核清單
  - 價格來源
  - 判讀備註
  - 系統訂單
  - 給客戶用
- ExcelJS export for full workbook, system order, and customer quote sheets.
- Customer quote sheet uses backend-owned allowlist and hides customer tier/internal fields.
- Minimal Admin DOCX / XLSX import for high-value datasets with code-owned validation and Supabase transaction safety.
- Admin upload policy rejects non-DOCX/XLSX files before parsing or merge-table creation.
- Steel Eval Harness proves price-first behavior, seven-sheet export, customer mask, Admin upload policy, and no zero-filled unknown prices.

Deferred until after the MVP:

- Full multi-round Admin merge table UX beyond the minimal commit path.
- Production-scale source indexing, retrieval hardening, and async job infrastructure.
- Full Memory Review UI beyond core candidate creation/review paths.
- OCR-heavy drawing automation beyond low-confidence evidence capture.
- Signed public export links and retention automation.

## Phase Map

| Phase | Plan | Exit Gate |
|---|---|---|
| 0 | [Decision Baseline](phase-0-decisions.md) | v8.2 decisions are locked and stale v8.1 assumptions removed |
| 1 | [Platform Foundation](phase-1-platform-foundation.md) | Contracts, schemas, routes, permissions, audit, and Supabase seams build |
| 2 | [Quote Data And Tools](phase-2-data-tools.md) | Repositories and business tools support price-first deterministic lookup |
| 3 | [Quote Workbook MVP](phase-3-quote-workbook-mvp.md) | Real OpenAI chat creates a seven-sheet customer-visible workbook |
| 4 | [Export And Admin DOCX / XLSX Import](phase-4-export-admin-import.md) | ExcelJS export works; DOCX/XLSX Admin Import safely commits data |
| 5 | [Production Expansion](phase-5-production-expansion.md) | Guest hardening, RAG, memory, OCR, async, evals, and retention are beta-ready |

Use [checkpoints.md](checkpoints.md) as the follow-up tracker during implementation.

## Module Coverage

| v8.2 Module | Primary Phase |
|---|---|
| Conversation Meta / Guest Mode | Phase 1, Phase 3 |
| OpenAI Orchestrator / Prompt Bundle | Phase 3 |
| Quote Resolution Engine | Phase 2, Phase 3 |
| Material Normalization Dictionary | Phase 2 |
| Product Price Candidate Search / Ranking | Phase 2 |
| Customer Tier Resolver | Phase 2 |
| Stock Allocation Engine | Phase 2 |
| Deterministic Calculation Engine | Phase 2 |
| Workbook JSON Engine | Phase 3 |
| Fixed Seven-Sheet Workbook | Phase 3, Phase 4 |
| ExcelJS Export Engine | Phase 4 |
| Customer Quote Sheet Mask | Phase 4 |
| System Order Export | Phase 4 |
| Admin DOCX / XLSX Source Parsing | Phase 4, Phase 5 |
| Admin DOCX / XLSX Import / AI Merge Table | Phase 4 |
| Steel Tool Registry | Phase 2 |
| Steel Projects / Sources / Instructions | Phase 5 |
| Steel Retrieval / pgvector | Phase 5 |
| Memory Candidate / Error Feedback | Phase 5 |
| Steel Eval Harness | Phase 4 baseline, Phase 5 expansion |
| Audit / Trace | Phase 1 primitive, then every write path |
| Permissions / Security | Phase 1 and every route |

## Verification Baseline

Run targeted checks after each phase, and broader checks before merge:

```bash
rtk npm run build:data-provider
rtk npm run build:data-schemas
rtk npm run build:api
rtk npm run test:packages:api
rtk npm run test:packages:data-provider
rtk npm run test:packages:data-schemas
```

For frontend/admin UI phases add:

```bash
rtk npm run build:client-package
rtk npm run test:client
```
