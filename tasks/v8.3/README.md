# Steel v8.3 OpenAI OAuth Responses Primary Development Plan

This folder converts [`docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md`](../../docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md) into an implementation roadmap with phase gates, checkpoints, and verification commands.

The plan assumes the current repository state:

- `supabase/schema.sql` and `supabase/migration/202605230001_initial_steel_schema.sql` define the initial private `steel` schema.
- `packages/api/src/steel/postgres.ts` provides the Steel Supabase connection helper and readiness query.
- The repo currently declares `xlsx@0.20.3`; v8.3 export must add ExcelJS deliberately for customer-facing XLSX rendering.
- No Steel Mongo schemas, Steel HTTP routes, Steel data-provider types, client Steel UI, Steel AI provider adapter, orchestrator, workbook engine, Excel export, Admin import, memory, source management, eval harness, environment-gated guest access, or Steel retrieval implementation exists yet.
- `CONTEXT.md` defines the business language for Steel quoting. Provider/driver details are implementation concepts, not domain glossary terms.

## Operating Rules

- Keep new backend logic in `packages/api/src/steel`.
- Keep `api/` changes thin: route registration and wrappers only.
- Keep MongoDB Steel collections prefixed with `steel_`.
- Keep Steel SQL tables in the private Supabase PostgreSQL `steel` schema.
- Any Supabase PostgreSQL schema change must update both `supabase/schema.sql` and a one-change file under `supabase/migration/`.
- Workbook public DTOs live in `packages/data-provider/src/steel/workbooks.ts`; backend canonical workbook validation lives in `packages/api/src/steel/workbook/schema.ts`.
- Frontend and mock data consume shared DTOs and must not define independent workbook validation schemas.
- Steel AI execution goes through `SteelAIProvider`; the orchestrator must not directly bind to openai-oauth or the official OpenAI client.
- `openai_oauth_responses` is the default local/dev driver. `openai_api` / `OPENAI_API_KEY` remains the capability-gated secondary driver.
- Steel must preserve LibreChat UI / preset / agent model parameters as requested runtime settings; provider adapters cannot silently ignore enabled settings.
- The `openai_api` driver is Responses-first. Responses-only settings such as reasoning summaries must not downgrade to Chat Completions.
- Driver capability smoke tests decide whether a model can handle text, streaming, tool calling, structured output, image/PDF/XLSX input, File Search, Code Interpreter, and conversation state.
- openai-oauth session/conversation IDs are provider runtime trace only. Official OpenAI Responses/Conversations state is used only by the `openai_api` driver.
- Fallback flags default to false. Fallback to `openai_api` is allowed only when the relevant `STEEL_FALLBACK_ON_*` key is true and the matching secondary capability has a passed smoke result.
- Model selection is served by backend allowlist/capability status, not by directly exposing LibreChat's global provider list.
- The steel handbook DOCX under `docs/reference` is allowed as a real schema/data-model design reference; real handbook data SQL/import work is deferred to a later code-agent data task.
- Chinese source labels/headers/terms from `docs/reference` must be mapped to English canonical schema keys before they shape DTOs, repository filters, SQL columns, tool arguments, workbook paths, prompt context, or mock API keys.
- Ongoing formal Admin Import accepts ERP-exported XLSX parsed data only. DOCX/PDF/image/text uploads are rejected before parser, merge-table, or database write paths.
- Use the glossary in `CONTEXT.md`; ambiguous wording such as `常用的` resolves through admin-taught rules/memory, not hard-coded product defaults.

## MVP Boundary

The v8.3 MVP is production-shaped and access is environment-gated:

- Environment-controlled Steel quote access via `STEEL_GUEST_MODE`.
- Conversation-first quote flow through backend model allowlist and `SteelAIProvider`.
- Default `openai_oauth_responses` runtime for text/tool/structured workflows that pass smoke tests.
- `openai_api` capability-gated fallback for official Responses API, production-safe operation, file/vision/XLSX evidence, hosted tools, rate-limit/cost observability, and env-enabled openai-oauth unsupported capabilities.
- Node/backend owns file upload metadata, provider file refs, tool execution, validation, audit, workbook truth, capability preflight, and explicit provider fallback. AI owns primary interpretation and tool decisioning.
- Deterministic customer tier, normalization, price search, price ranking, stock allocation, and calculator modules.
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
- Chat Workspace and seven-tab Workbook Preview are part of the Phase 3 vertical slice, implemented as an independent Steel workspace under `client/src/features/steel`.
- Desktop and mobile web UI share one Steel UX framework: same components, hooks, API contracts, and mock data, with responsive layout changes only.
- Mobile Workbook Preview opens as a full-view modal with a top-right close control; Phase 3 supports multiple marked workbook targets per submit as structured message refs for AI-assisted workbook patching. Composer markers must show the sheet and field/cell position.
- Users can keep modifying workbook data through multi-round chat, or describe multiple explicit changes in text so AI can propose multiple backend-validated patch operations.
- Phase 3 does not add a required patch preview/confirmation gate, explicit Undo button, or version-control UI.
- API mock data lives in one shared folder, `packages/data-provider/src/steel/mock/`; it can be shaped from `docs/reference` for UX development, but reference values are not imported into the database yet.
- Handbook-informed real schema/data model for weight specs, standard dimensions, material rules, and source chunks; real handbook data SQL/import comes later.
- Admin ERP XLSX import, Admin table maintenance, and Source management follow after the chat/workbook/export path.
- Steel Eval Harness proves price-first behavior, seven-sheet export, customer mask, provider fallback gates, Admin upload policy, and no zero-filled unknown prices before broad beta.

Deferred until after the MVP:

- Production-scale source indexing, retrieval hardening, and async job infrastructure.
- Full Memory Review UI beyond core candidate creation/review paths.
- OCR-heavy drawing automation beyond low-confidence evidence capture.
- Signed public export links and retention automation.

## Phase Map

| Phase | Plan | Exit Gate |
|---|---|---|
| 0 | [Decision Baseline](phase-0-decisions.md) | openai-oauth-responses-primary v8.3 decisions are locked and stale OpenAI-only assumptions removed |
| 1 | [Platform Foundation](phase-1-platform-foundation.md) | Contracts, schemas, routes, permissions, audit, provider-state metadata, and Supabase seams build |
| 2 | [Quote Data And Tools](phase-2-data-tools.md) | Repositories and business tools support price-first deterministic lookup |
| 3 | [Quote Workbook MVP](phase-3-quote-workbook-mvp.md) | Chat UX sends messages and previews a seven-sheet workbook; openai-oauth binding is complete before live smoke; `openai_oauth_responses` and capability-gated `openai_api` fallback each have a live smoke case |
| 4 | [Excel Export](phase-4-excel-export.md) | ExcelJS export works with seven fixed sheets, customer mask, and system order sheet |
| 5 | [Admin Source Management](phase-5-admin-source-management.md) | ERP XLSX Admin Import, Admin table maintenance, and source management safely commit reviewed data |
| 6 | [Production Hardening](phase-6-production-hardening.md) | Memory, retrieval, eval harness, async jobs, signed exports, and production hardening are beta-ready |

Use [checkpoints.md](checkpoints.md) as the follow-up tracker during implementation.

## Module Coverage

| v8.3 Module | Primary Phase |
|---|---|
| Conversation Meta / Guest Mode | Phase 1, Phase 3 |
| SteelAIProvider / Driver Capabilities | Phase 1, Phase 3 |
| openai-oauth /v1/responses Driver | Phase 3 |
| OpenAI API Secondary Driver | Phase 3 |
| Backend Model Allowlist / Capability Smoke | Phase 1, Phase 3 |
| Provider File / Vision / XLSX Evidence Routing | Phase 3, Phase 6 |
| Chat Workspace / Shared API Mock Data | Phase 3 |
| Unified Desktop/Mobile Steel UX Framework | Phase 3, Phase 6 |
| Workbook Preview UI | Phase 3 |
| Prompt Bundle / Steel Agent Orchestrator | Phase 3 |
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
| Steel Handbook Schema Design Boundary | Phase 2 |
| Admin ERP XLSX Source Parsing | Phase 5 |
| Admin ERP XLSX Import / AI Merge Table | Phase 5 |
| Admin Table Maintenance UI | Phase 5 |
| Steel Projects / Sources / Instructions | Phase 5, Phase 6 |
| Chinese Source Schema Mapping | Phase 2, Phase 3 |
| AI API Source-Key Mapping Context | Phase 2, Phase 3 |
| Steel Tool Registry | Phase 2 |
| Steel Retrieval / pgvector | Phase 6 |
| Memory Candidate / Error Feedback | Phase 6 |
| Steel Eval Harness | Phase 6 |
| Audit / Trace | Phase 1 primitive, then every write/provider path |
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
