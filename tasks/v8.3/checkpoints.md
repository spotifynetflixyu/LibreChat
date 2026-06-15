# Steel v8.3 Checkpoints

Use this file as the implementation follow-up tracker. Copy a checkpoint into `tasks/todo.md` when it becomes active, then record evidence in that task's Review section.

## Checkpoint 0: v8.3 Baseline Review

Status: passed for the openai-oauth-responses-primary Phase 0 lock.

Required:

- [x] `STEEL_GUEST_MODE=false` is the documented default.
- [x] `docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md` is the active spec reference.
- [x] Steel AI execution uses a `SteelAIProvider` abstraction.
- [x] `openai_oauth_responses` is the default local/dev driver and `openai_api` is the capability-gated secondary driver.
- [x] openai-oauth session/conversation IDs are runtime trace only, not official OpenAI Conversation state.
- [x] Official OpenAI Responses calls use `conversation`; prior response IDs are audit/fallback metadata only and only apply to the `openai_api` driver.
- [x] Backend model selector uses driver capability status and hides disabled/failed runtime options.
- [x] Capability smoke/fallback policy covers text, stream, tools, structured output, image/PDF/XLSX input, File Search, and Code Interpreter.
- [x] Ongoing formal Admin Import accepts ERP XLSX parsed data only.
- [x] Admin ERP Import rejects DOCX/PDF/image/.txt uploads before parsing.
- [x] Steel handbook DOCX is scoped to real schema/data-model design first; real handbook data SQL/import is deferred to a later code-agent data task, and it is not Admin web upload or reusable product parser.
- [x] Chinese reference labels under `docs/reference` are mapped to English canonical schema keys before they shape schema, API mock data, tools, or database queries.
- [x] `tasks/v8.3/source-schema-mapping.md` exists and is linked from the phase plan.
- [x] Workbook JSON requires seven fixed sheets.
- [x] Customer quote sheet hides customer tier and internal fields.
- [x] Price-before-weight rule is explicit.
- [x] ExcelJS is the staff workbook XLSX renderer.
- [x] Old direct-connector, PDF-direct-import, and Admin PDF parser assumptions are absent.

Verification:

```bash
rtk proxy rg -n "報價明細|總結|人工複核清單|價格來源|判讀備註|系統訂單|報價單" tasks/v8.3 docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md
rtk proxy rg -n "SteelAIProvider|openai_oauth_responses|openai_api|capability smoke|fallback|SteelAIEvent" tasks/v8.3 docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md
rtk proxy rg -n "ERP XLSX|handbook DOCX|rejects PDF|拒絕 PDF|ExcelJS|Quote Resolution|Eval Harness" tasks/v8.3 docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md
rtk proxy rg -n "source schema mapping|canonical schema|中文來源|英文 canonical" CONTEXT.md tasks/v8.3 docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md
```

## Checkpoint 1: Foundation Gate

Status: synced on 2026-06-08 for the implemented Steel foundation, direct
`openai-oauth-provider` path, gpt-5.5-only allowlist, and split Steel Mongo
schemas.

Required:

- [x] Steel shared data-provider contracts build.
- [x] Steel Mongo schemas are created with `steel_` collection names.
- [x] Environment-gated Steel conversation routes are registered under `/api/steel`.
- [x] Steel route wrappers in `api/` are thin.
- [x] Access checks exist in service layer.
- [x] Route tests cover both `STEEL_GUEST_MODE=true` and `STEEL_GUEST_MODE=false`.
- [x] Audit primitive exists.
- [x] Steel AI driver enum, capability result shape, provider run metadata, typed provider error categories, and model option shape exist.
- [x] Model allowlist endpoint is backend-owned, does not expose raw provider secrets, and aligns with LibreChat `/api/models`, `/api/endpoints`, `modelSpecs`, default preset, and default setting behavior instead of inventing a parallel model system.
- [x] Admin route protection reuses existing LibreChat `ADMIN`/`USER` role and capability semantics before adding Steel-specific permission layering.
- [x] An early OpenAI OAuth provider test seam exists before full workbook orchestration, without requiring Phase 1 to complete the Phase 3 live workbook smoke.
- [x] `/steel/oauth-chat` file-support evidence is reused to justify the Phase 1 `openai_oauth_responses` capability baseline instead of duplicating a broad file smoke runner.
- [x] The active OAuth Responses allowlist is `gpt-5.5` only; `gpt-5.4` and lower models are not exposed as supported Steel models.
- [x] The first coded openai-oauth implementation path is direct `openai-oauth-provider`; the local HTTP `/v1` proxy remains manual diagnostics only.
- [x] Direct `openai-oauth-provider` package usage is allowed only after AI SDK versions are unified through package-manager overrides/resolutions, packaging verification passes, model discovery remains backend-owned, and auth material remains server-only.
- [x] `openai_oauth_responses` request serialization is stateless full-history and rejects `previous_response_id` / `item_reference`.
- [x] Adapter-dropped or unsupported LibreChat runtime settings are recorded in provider metadata instead of silently treated as applied.
- [x] `steel_ai_runs` can represent both openai-oauth responses trace metadata and OpenAI API fallback metadata.
- [x] Capability status vocabulary uses `unverified`, `passed`, `failed`, `disabled`, and `not_applicable`; stale `not_run` status is not used in new contracts.
- [x] Steel Mongo schemas are split by owner file rather than accumulated in one broad `steel.ts` file.
- [x] Durable audit writes go to `steel_audit_logs`.
- [x] Supabase schema/migration rule is preserved.
- [x] `steel_source_versions` metadata supports `.xlsx`, `.xls`, `.docx`, and `.doc` source artifacts with original/normalized format and conversion status. Server-side `.xls` / `.doc` conversion is only enabled after a development script proves it works; AI/provider handling of legacy files remains allowed.

Verification:

```bash
rtk npm run build:data-provider
rtk npm run build:data-schemas
rtk npm run build:api
rtk npm run test:packages:data-provider
rtk npm run test:packages:data-schemas
rtk npm run test:packages:api
```

## Checkpoint 2: Quote Data And Tools Gate

Status: synced on 2026-06-08 for the AI-led data/tool boundary: reviewed DB
rules are exposed through `lookup_catalog_families`, `lookup_quote_rules`,
`search_customers`, and `search_price_candidates`; backend validates tool
schemas, source scope, sanitized output, and workbook subtotal consistency.

Required:

- [x] Handbook content has been reviewed for real schema/data-model implications.
- [x] Source schema mapping records DB-bound Chinese source label/header, English canonical key, target database surface, type/unit, normalizer, and source reference for spec, price, formula, and processing-price fields.
- [x] Source schema mapping does not require `review_status`, `corrected_text`, or a typo approval workflow.
- [x] Code-owned mapping design exists for `packages/api/src/steel/schema/mapping.ts`.
- [x] AI API prompt/tool context can use the mapping to resolve Chinese wording to existing canonical keys.
- [x] Repository filters, SQL columns, DTO keys, and tool arguments use English canonical keys.
- [x] Chinese labels, product names, aliases, ERP workbook sheet names, and source excerpts are stored only as values/display/source/search data, not code-owned query field names.
- [x] Supabase repositories use parameterized SQL.
- [x] Lookup tools validate with Zod.
- [x] No raw SQL/Mongo query tools exist.
- [x] `lookup_catalog_families` returns admin-supplied product/category
      inference rules and reviewed vocabulary candidates when AI inference is
      insufficient.
- [x] AI-led material/spec interpretation produces bounded candidates or asks
      for confirmation; backend does not implement a Phase 2 normalization
      boundary or hidden resolver.
- [x] `search_customers` returns matched/ambiguous customer candidates, tier
      context, and reviewed customer-specific rules/defaults when available.
- [x] Price candidate search returns exact/major/alias/closest/no-price matches.
- [x] AI ranks/selects price candidates and asks for confirmation when options
      remain ambiguous; backend does not harden final quote ranking.
- [x] Missing prices are never represented as `0`.
- [x] Cutting, stock-length, no-cut, head/tail, hole, slotting, and bending
      rules are available as quote-rule prompts for AI calculation.
- [x] AI owns weight, processing, cutting/allocation, and line-total arithmetic;
      backend validates source/rule scope and workbook subtotal consistency.
- [x] Confirmed workbook summary totals cannot pass when they differ from line
      subtotal sums.
- [x] Tool calls are logged and sanitized before model use.
- [x] Tool definitions are provider-neutral; openai-oauth and OpenAI adapters only serialize them.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(repositories|tools|ai|workbook)/.*\\.spec\\.ts$"
rtk npm run build:api
```

Manual scenario:

```text
Input: 黑圓管48.1 6米 20支
Expected: AI proposes reviewed vocabulary/product candidates such as 黑圓管, 黑管, 黑AB圓管, 1 1/2, 1英半, 48.3 through lookup_catalog_families or price candidate queries; no raw hard-coded exact match if thickness/unit is ambiguous.
```

## Checkpoint 3: Quote Workbook Vertical Slice

Status: synced on 2026-06-08 for the current fixed OAuth/Codex
`/steel/oauth-chat` workbook path. Backend/provider/workbook/live-smoke
requirements below are checked where implementation evidence exists. Formal
Steel Workspace UI expansion, selected-cell composer UX, and explicit
`openai_api` fallback smoke remain unchecked and are not treated as blockers for
starting Phase 4 after the fixed OAuth/Codex decision.

Required:

- [x] Authenticated user can create Steel conversation meta.
- [x] User can send a Steel message with selected model.
- [x] Workbook JSON, patch request/response, selected refs, changed paths, and changed-field summary DTOs live in `packages/data-provider/src/steel/workbooks.ts`.
- [x] Conversation message request types reuse workbook DTOs instead of redefining selected-cell or patch metadata shapes.
- [ ] Backend Zod validation in `packages/api/src/steel/workbook/schema.ts` is the canonical runtime validation authority.
- [ ] Frontend code and tests consume shared workbook DTOs/API responses and do not define an independent workbook validation schema.
- [ ] Workbook Preview, selected-target markers, changed-field summaries, and customer-facing workbook output render Traditional Chinese field labels derived from `docs/reference/*.xlsx` headers where available, while internal DTO keys and patch paths remain English.
- [ ] Chat Workspace is an independent Steel workspace and does not require MVP changes to the core LibreChat chat store/message flow.
- [ ] Desktop and mobile Steel views share the same UX framework, API contracts, and mock data.
- [ ] Mobile Workbook Preview opens as a full-view modal with a visible top-right close button.
- [ ] Selecting workbook cells applies selected styling and adds field markers with clear sheet and field/cell positions to the bottom message input.
- [x] Message submit can send multiple structured `selected_workbook_refs` items; backend validation does not rely on marker text alone.
- [ ] When no user text has been entered, the next cell selection replaces the existing marker; after user text exists, the next cell selection inserts a new marker on a new line.
- [x] Multi-round conversations can keep modifying workbook data through subsequent patch requests.
- [x] Text-only requests can update multiple workbook fields only when each target is explicit and backend validation accepts every patch path.
- [x] AI workbook patches do not require a per-update preview/confirmation gate in Phase 3.
- [x] Latest accepted workbook patch fields are highlighted with a background color distinct from selected-cell styling until the next accepted workbook patch.
- [x] Failed or rejected patch attempts do not highlight workbook fields and do not replace the previous accepted-patch highlight set.
- [x] Phase 3 does not expose an explicit Undo button or version-control UI.
- [ ] User-requested revert/change flows go through chat and produce validated workbook patches.
- [x] Successful AI workbook patches produce a concise chat summary of changed fields.
- [x] Chat does not render a full diff table for successful workbook patches.
- [ ] Chat Workspace can use API mock data from `packages/data-provider/src/steel/mock/`, shaped from `docs/reference` without importing real data.
- [ ] Mock workbook fixtures derived from Chinese reference examples use English DTO/API keys and preserve Chinese only as display/source/alias data.
- [ ] Mock workbook fixtures include Traditional Chinese display labels for visible workbook fields.
- [ ] Mocked AI/prompt tests include source-schema mapping context and reject unknown keys through clarification/manual-review behavior.
- [ ] Frontend and backend tests do not define separate mock workbook datasets.
- [ ] Mock workbook fixtures are imported through the explicit mock path and are not re-exported by the production Steel data-provider barrel.
- [ ] Mock workbook fixtures are typed against shared workbook DTOs and pass backend workbook validation where required.
- [x] Workbook Preview renders all seven tabs from mock or real workbook API data.
- [ ] `SteelAIProvider` interface exists with openai-oauth and OpenAI API fallback adapters.
- [x] openai-oauth adapter uses direct `openai-oauth-provider`, with fake auth and mocked `fetch` tests before live smoke.
- [x] openai-oauth adapter uses server-side/local encrypted token storage and never frontend localStorage.
- [ ] OpenAI API adapter is Responses-first, uses official Responses `conversation` state, and does not mix `previousResponseId` into the same call.
- [x] openai-oauth provider state is recorded only as trace metadata.
- [x] openai-oauth adapter sends full reconstructed context on every run and never sends `previous_response_id` or `item_reference`.
- [x] openai-oauth adapter records unsupported or proxy-dropped settings such as stateful replay and output-token controls.
- [x] Direct `openai-oauth-provider` in-process usage is covered by tests with mocked fetch/fake auth and packaging verification; AI SDK 6 is not treated as a blocker, but package versions must be unified with overrides/resolutions.
- [x] LibreChat UI / preset / agent model parameters and default settings are converted to provider-neutral runtime options and are not silently ignored.
- [x] No per-capability `STEEL_FALLBACK_*` env matrix is active in v8.3.
- [x] Fallback means selecting or routing to the `openai_api` driver instead of the default OAuth driver; it is not model fallback.
- [x] `openai_api` is only used after its relevant capability is explicitly supported by backend policy/evidence.
- [x] Code-owned capability support records exist for text, streaming, tool calling, structured output, workbook patch, image, PDF, XLSX, File Search, Code Interpreter, and conversation/state behavior.
- [x] Backend model selector returns provider, smoke status, support flags, and enabled/disabled status.
- [x] Backend model selector preserves LibreChat UI / preset / default model settings as requested runtime options and reports unsupported Steel provider capabilities inline.
- [x] openai-oauth binding runbook has been completed before any live openai-oauth provider smoke or chat UI live test.
- [ ] Failed or unverified file/vision/XLSX/hosted-tool capabilities fallback to `openai_api` only when env-enabled, otherwise return typed low-confidence/manual-review errors.
- [ ] Provider unsupported/fallback notices render inside the chat transcript as small warning text, not toast UI.
- [x] Typed provider errors include auth, subscription/rate, tool unsupported, file input unsupported, vision input unsupported, XLSX input unsupported, hosted tool unsupported, and invalid structured output.
- [ ] Prompt bundle records context refs.
- [x] Image/PDF prompt guidance comes from `fileAnalysis.instructions`, is editable through Admin config override, and is not hard-coded in Steel provider adapters.
- [x] Tool-calling loop executes whitelisted tools only.
- [x] Structured output creates or patches Workbook JSON.
- [x] Workbook JSON contains all seven required sheet IDs.
- [x] Workbook JSON/display metadata exposes Traditional Chinese labels for visible fields without using those labels as patch keys.
- [x] Workbook line persists formula, default unit price, quoted unit price, line total, adjustment source, quote trace, and source refs.
- [x] Workbook patch writes `steel_workbook_patches`.
- [x] Selected-cell edit requests return workbook patches or refreshed workbook data that synchronizes the UI.
- [x] Patch responses include changed paths or equivalent metadata for latest-updated-field highlighting.
- [x] A new accepted patch replaces the previous latest-highlight set instead of accumulating old highlighted fields.
- [x] Failed/rejected patch responses include a user-facing reason and no changed paths.
- [x] No frontend-only undo path can mutate workbook JSON outside the patch service.
- [x] Patch responses include changed-field summary items for chat acknowledgement.
- [ ] Ambiguous multi-field edit requests ask for clarification or produce manual-review output instead of guessing patch targets.
- [x] Manual live openai-oauth responses smoke run creates or patches a customer-visible workbook before Phase 4.
- [x] Manual live openai-oauth smoke includes `/health`, `/v1/models`, a pure `/v1/responses` probe, and a stateless second-turn case.
- [ ] Manual live OpenAI API fallback smoke run creates or patches a customer-visible workbook before Phase 4.
- [x] Manual provider smoke evidence records requested provider, effective provider, model, provider IDs when available, fallback or unsupported reason, tool call IDs, workbook ID/version, context refs, and typed error category when relevant.
- [x] Stale patch version returns `409`.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(ai|prompt|workbook|tools|quote)/.*\\.spec\\.ts$"
rtk npm run test:client -- --runTestsByPath client/src/features/steel
rtk npm run build:client-package
rtk npm run build:api
```

Manual scenario:

```text
Authenticated user pastes a LINE order.
Expected: DB lookup facts are used, the selected SteelAIProvider creates or patches the persisted seven-sheet public workbook, AI-facing patch completion remains limited to `系統訂單`, `人工複核`, and `報價單`, provider/fallback metadata is persisted, and context_refs/tool_call_ids are persisted.
```

## Checkpoint 4: Export Gate

Required:

- [ ] ExcelJS dependency is added intentionally to the rendering owner package.
- [ ] Full workbook export works.
- [ ] Selected sheet export works.
- [ ] Export includes all seven required sheets.
- [ ] Selected sheet export allows any workbook sheet combination without customer masking.
- [ ] Export is generated in memory from the persisted workbook and streamed by the API.
- [ ] Unconfirmed prices do not render as `0`.
- [ ] Export is access checked and audited.

Verification:

```bash
rtk npm ls exceljs xlsx
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(excel|exports)/.*\\.spec\\.ts$"
rtk npm run build:api
```

Manual scenario:

```text
Download a selected sheet set from `/steel/oauth-chat`.
Expected: generated XLSX contains exactly the selected workbook sheets, preserves
staff-visible columns and values, renders missing prices as `未確認`, and does
not refresh prices or call AI providers.
```

## Checkpoint 5: Admin Source Management Gate

Required:

- [ ] Admin upload guard accepts only ERP XLSX.
- [ ] Admin upload guard rejects DOCX/PDF/image/.txt before parsing.
- [ ] Rejected Admin uploads create no source versions, parsed rows, merge rows, or formal database writes.
- [ ] Preview rows include source file, sheet/table/section, confidence, review flags, and source refs.
- [ ] Admin Import session target table is explicitly chosen before parsing.
- [ ] ERP XLSX parser uses approved or synthetic fixtures.
- [ ] Admin table UI fetches existing rows for preview/edit without DOCX upload.
- [ ] Mapping profile records lookup keys and required fields.
- [ ] Old data matching is deterministic.
- [ ] Code owns `valid`, `invalid`, and `needs_review`.
- [ ] Commit writes only valid rows.
- [ ] Any valid-row failure rolls back all valid-row changes.
- [ ] Price changes write `steel.price_history`.
- [ ] Quote lookup reflects committed updates.
- [ ] Steel Projects/Sources/Instructions metadata can be recorded in prompt context refs.
- [ ] Steel Projects/Sources/Instructions and Admin Import endpoints are admin-only under `/api/admin/steel/...`.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(projects|sources|instructions)/.*\\.spec\\.ts$"
rtk npm run test:packages:api -- --testPathPatterns="src/steel/admin/imports/.*\\.spec\\.ts$"
rtk npm run build:api
```

Manual scenario:

```text
Admin uploads a price-update XLSX.
Expected: merge table shows create/update/delete rows, commit succeeds, price_history has old/new values, later quote uses the new price.
```

## Checkpoint 6: Eval Harness Gate

Required:

- [ ] Eval directory exists under `packages/api/src/steel/evals`.
- [ ] Eval run endpoints are admin-only under `/api/admin/steel/evals/...`.
- [ ] Text order parsing eval exists.
- [ ] Price-first eval exists.
- [ ] No-zero-unknown-price eval exists.
- [ ] Multi-key price search eval exists.
- [ ] Stock allocation eval exists.
- [ ] Admin upload policy rejection eval exists.
- [ ] Provider capability/fallback classification eval exists.
- [ ] Handbook-derived lookup fixture exists only if a later task imports handbook data in this phase.
- [ ] Seven-sheet Excel export eval exists.
- [ ] Customer quote mask eval exists.
- [ ] System order sheet eval exists.
- [ ] Eval report lists case id, assertion, expected, and actual.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/evals/.*\\.spec\\.ts$"
rtk npm run build:api
```

## Checkpoint 7: Beta Expansion Gate

Required before any beta capability is exposed:

- [ ] Guest token security tests pass if guest mode is enabled.
- [ ] Retrieval filters exclude inactive/deleted source versions.
- [ ] openai-oauth responses production risk is explicitly accepted or disabled outside local/dev.
- [ ] OpenAI API fallback cost/rate/budget handling is verified.
- [ ] Capability smoke status is current for enabled file/vision/XLSX workflows.
- [ ] System Memory tests prove memory cannot override prices.
- [ ] OCR outputs are low-confidence evidence unless Admin-approved.
- [ ] Async jobs are idempotent and access checked.
- [ ] Signed export tokens expire and are scoped.
- [ ] Admin can review memory candidates and promote to instruction/memory.

Verification:

```bash
rtk npm run test:packages:api
rtk npm run test:packages:data-provider
rtk npm run test:packages:data-schemas
rtk npm run build:packages
rtk npm run test:client
rtk npm run build:client-package
```

## Staff Review Prompts

Ask these before closing each phase:

- What can corrupt formal price/spec data?
- What can leak another user or guest conversation?
- What can cause AI output to bypass backend validation?
- What can make an old quote look more auditable than it really is?
- What happens when official OpenAI API state expires or API fallback becomes too expensive?
- What happens when the default openai-oauth driver loses auth, hits subscription limits, or lacks file/vision/XLSX support?
- Can this phase be reverted independently?
