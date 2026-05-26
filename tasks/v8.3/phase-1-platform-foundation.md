# Phase 1: Platform Foundation

Goal: create the Steel module skeleton, shared contracts, Mongo state models, route boundary, permissions, audit primitives, provider-state metadata, model option contracts aligned with LibreChat's existing model/default-setting framework, an early OpenAI OAuth provider seam, and the Supabase repository seam without building full workbook AI behavior yet.

## Scope

- Shared Steel request/response types in `packages/data-provider/src/steel`.
- MongoDB Steel schemas in `packages/data-schemas/src/schema`.
- TypeScript service modules under `packages/api/src/steel`.
- Thin Express route wrappers under `api/server/routes/steel` for quote/user-facing Steel routes.
- Thin Express route wrappers under `api/server/routes/admin/steel` for Steel admin-only routes.
- Environment-gated guest/auth access.
- Audit primitive: a reusable audit event schema/service that records actor, action, target, result, error category, and correlation IDs before Phase 2/3/4 add real business writes.
- Steel AI provider enum, capability result contract, model option contract, provider run metadata, and typed provider error categories.
- LibreChat model/default-setting alignment for Steel model options: inspect `/api/models`, `/api/endpoints`, `modelSpecs`, default preset, and runtime setting behavior before adding Steel-only selection logic.
- Early OpenAI OAuth provider seam that can be tested before full workbook orchestration. Use direct `openai-oauth-provider` as the coded provider path after package-manager overrides/resolutions unify AI SDK versions and build packaging is verified. Keep the local HTTP `/v1` proxy only as a manual diagnostic smoke probe. The completed spike is recorded in `tasks/v8.3/openai-oauth-provider-spike.md`.
- Supabase repository wrapper around `packages/api/src/steel/postgres.ts`.
- Source artifact/source version metadata for ERP XLSX Admin workflows and rejection audit for unsupported uploads. Phase 1 does not create DOCX parser/import metadata; handbook DOCX remains a planning/schema-design reference only.
- Setup runbooks for local admin/user account creation and openai-oauth binding prerequisites before any live provider smoke or chat UI test.

## Current Baseline

An earlier Phase 1 slice already created minimal Steel DTOs, basic Mongo schema scaffolding, route shells for model listing and admin capability smoke, access helpers, model option adaptation, and an injectable OAuth proxy client seam. That slice is useful groundwork, but it does not satisfy the full Phase 1 gate.

The remaining Phase 1 implementation must complete the full foundation contract below before Phase 2 starts.

## Milestone 1.1: Shared Contracts

Files:

- Create `packages/data-provider/src/steel/conversations.ts`
- Create `packages/data-provider/src/steel/workbooks.ts`
- Create `packages/data-provider/src/steel/quote.ts`
- Create `packages/data-provider/src/steel/sources.ts`
- Create `packages/data-provider/src/steel/imports.ts`
- Create `packages/data-provider/src/steel/memory.ts`
- Create `packages/data-provider/src/steel/exports.ts`
- Create `packages/data-provider/src/steel/evals.ts`
- Create `packages/data-provider/src/steel/ai.ts`
- Create `packages/data-provider/src/steel/index.ts`
- Modify `packages/data-provider/src/api-endpoints.ts`
- Modify `packages/data-provider/src/data-service.ts`
- Modify `packages/data-provider/src/keys.ts`
- Modify `packages/data-provider/src/index.ts`

Tasks:

- Define specific TypeScript types for:
  - `SteelConversationMeta`
  - `SteelWorkbook`
  - `WorkbookLine`
  - `QuoteTrace`
  - `PriceCandidate`
  - `SourceManifest`
  - `AdminSourcePreviewRow`
  - `SystemOrderRow`
  - `CustomerQuoteRow`
  - `AdminMergeRow`
  - `MemoryCandidate`
  - `SteelAIDriver`
  - `SteelAIDriverCapability`
  - `SteelModelOption`
  - `SteelProviderSmokeTestResult`
  - `SteelAIProviderErrorCategory`
- Keep workbook-related public DTOs in `packages/data-provider/src/steel/workbooks.ts`, including workbook patch request/response, selected workbook refs, changed paths, and changed-field summary items.
- Allow conversation message request types in `packages/data-provider/src/steel/conversations.ts`, but make them reuse workbook DTOs rather than duplicating selected-cell or patch metadata shapes.
- Define model-selector response types around backend allowlist/capability status while preserving the effective LibreChat model/default setting concepts that Steel must translate into provider-neutral runtime options.
- Include `openai_oauth_responses` and `openai_api` as the only v8.3 driver IDs unless a later plan explicitly adds another provider.
- Include capability flags for text, streaming, tool calling, structured output, image, PDF, XLSX, File Search, Code Interpreter, spreadsheet augmentation, and conversation state.
- Include runtime-setting support metadata so the openai-oauth adapter can report adapter-normalized, adapter-dropped, or unsupported settings such as official Responses state options or output-token controls.
- Add Steel endpoint helpers under `/api/steel`.
- Add React Query keys that do not collide with existing LibreChat keys.
- Keep arbitrary JSON wrapped in named types; avoid broad `Record<string, unknown>` as a shortcut.

Acceptance:

- Types are stable enough for backend, frontend, and tests.
- Workbook mock fixtures are typed against `packages/data-provider/src/steel/workbooks.ts`.
- Dynamic path params use `encodeURIComponent`.
- `packages/data-provider` exports only stable public types.

Verification:

```bash
rtk npm run build:data-provider
rtk npm run test:packages:data-provider
```

## Milestone 1.2: Mongo State Schemas

Files:

- Create `packages/data-schemas/src/schema/steelConversationMeta.ts`
- Create `packages/data-schemas/src/schema/steelWorkbook.ts`
- Create `packages/data-schemas/src/schema/steelWorkbookPatch.ts`
- Create `packages/data-schemas/src/schema/steelAIRun.ts`
- Create `packages/data-schemas/src/schema/steelAICapability.ts`
- Create `packages/data-schemas/src/schema/steelToolCall.ts`
- Create `packages/data-schemas/src/schema/steelExcelExport.ts`
- Create `packages/data-schemas/src/schema/steelProject.ts`
- Create `packages/data-schemas/src/schema/steelProjectSource.ts`
- Create `packages/data-schemas/src/schema/steelSourceVersion.ts`
- Create `packages/data-schemas/src/schema/steelAdminImportSession.ts`
- Create `packages/data-schemas/src/schema/steelAdminMergeTable.ts`
- Create `packages/data-schemas/src/schema/steelAdminMappingProfile.ts`
- Create `packages/data-schemas/src/schema/steelMemoryCandidate.ts`
- Create `packages/data-schemas/src/schema/steelMemory.ts`
- Create `packages/data-schemas/src/schema/steelAuditLog.ts`
- Create matching method modules only where behavior is non-trivial.
- Do not keep all Steel schema definitions in one growing `steel.ts`; use split schema owner files plus barrel exports.

Tasks:

- Use `steel_` collection names.
- Add owner/access indexes: `user_id`, `guest_token_hash`, `librechat_conversation_id`, `steel_conversation_meta_id`, `status`, `created_from`, `updated_at`.
- Add source/import indexes: `project_source_id`, `source_id`, `parse_status`, `admin_review_status`.
- Keep raw provider payload storage bounded; store provider ID, requested provider, effective provider, requested settings, effective settings, unsupported settings, provider session/conversation/response IDs when available, token counts when available, selected model, context refs, tool call IDs, attached file refs, fallback reason, typed provider error category, and error summary.
- Model `steel_conversation_meta.aiProviderMeta` as provider runtime trace, not the source of workbook truth.
- Store `openai_oauth_responses` provider IDs only as trace metadata; the driver itself remains stateless full-history.
- Store official OpenAI `conversation` / response IDs only for the `openai_api` driver, which is Responses-first.
- Store driver capability smoke results per provider/model so the model selector, typed unsupported errors, and env-gated API fallback policy have an auditable source.
- Model workbook JSON with seven fixed sheet IDs.
- Model source versions with original ERP XLSX file ID, source file type, parse version, parse status, extraction summary, and review status.
- Model provider run records without requiring `remaining quota` for openai-oauth responses.
- Model `steel_audit_logs` as the durable Phase 1 audit collection.

Acceptance:

- Authenticated conversation meta can be created and found by user.
- Guest conversation meta can be found by token hash.
- Workbook version sequence starts at `1`.
- Patch records preserve before/after version sequence.
- Source version preserves ERP XLSX import metadata and parser status.
- Audit logs can be written without coupling to specific provider clients.
- Audit logs persist actor, action, target, result, error category, correlation IDs, and bounded metadata in `steel_audit_logs`.
- Provider run metadata can represent openai-oauth responses traces and OpenAI API fallback traces without one driver pretending to expose the other driver's state model.
- Capability results can mark file/vision/XLSX/hosted-tool support as `unverified`, `passed`, or `failed`.
- Capability metadata can explain when fallback flags are disabled or when a secondary capability lacks a passed smoke result.

Verification:

```bash
rtk npm run build:data-schemas
rtk npm run test:packages:data-schemas
```

## Milestone 1.3: API Module And Routes

Files:

- Create `packages/api/src/steel/conversations/service.ts`
- Create `packages/api/src/steel/conversations/handlers.ts`
- Create `packages/api/src/steel/permissions/service.ts`
- Create `packages/api/src/steel/audit/service.ts`
- Create `packages/api/src/steel/ai/types.ts`
- Create `packages/api/src/steel/ai/models.ts`
- Create `packages/api/src/steel/ai/capabilities.ts`
- Create `packages/api/src/steel/repositories/postgres.ts`
- Create `api/server/routes/steel/index.js`
- Create `api/server/routes/admin/steel/index.js`
- Modify `api/server/routes/index.js`
- Modify `api/server/index.js`
- Create `docs/steel-account-setup.md`
- Create `docs/steel-openai-oauth-responses-setup.md`

Initial endpoints:

```text
POST /api/steel/conversations/authenticated
POST /api/steel/conversations/guest
GET  /api/steel/conversations/:conversationMetaId
GET  /api/steel/ai/models
POST /api/admin/steel/ai/capability-smoke
```

Tasks:

- Keep Express wrappers in `api/` thin.
- Keep Steel admin APIs under `/api/admin/steel/...`; do not expose admin-only actions under `/api/steel/...`.
- Route handlers call TypeScript services from `@librechat/api` after `npm run build:api`.
- Implement `STEEL_GUEST_MODE=true|false` in one service-level guard.
- Add service-level access checks rather than trusting route middleware alone.
- Create a durable audit event helper backed by `steel_audit_logs` that every later write path can reuse.
- Define Phase 1 audit event names: `conversation_created`, `guest_token_issued`, `access_denied`, `model_list_viewed`, `capability_smoke_requested`, and `source_upload_rejected`.
- Implement the three Phase 1 conversation endpoints, including guest token issuance, hashed token persistence, owner lookup, and cross-conversation denial.
- Add backend-owned model option endpoint that returns only enabled model/provider pairs and smoke status, using LibreChat `/api/models`, `/api/endpoints`, `modelSpecs`, default preset, and default setting behavior as the input framework instead of creating a parallel model selector.
- Add an `openai_oauth_responses` provider module using direct `openai-oauth-provider` and AI SDK 6 as the only coded runtime path.
- Keep local HTTP proxy probes in runbook/manual diagnostics only; do not add an env-controlled local proxy provider mode.
- Use injectable clients/fetch so unit tests do not require real OAuth.
- Add package-manager overrides/resolutions for `ai`, `@ai-sdk/openai`, `@ai-sdk/provider`, and `@ai-sdk/provider-utils` before adding the direct provider dependency, so the backend does not carry duplicate AI SDK runtime versions.
- Define env contracts for `STEEL_FALLBACK_REQUIRE_CAPABILITY_PASSED`, `STEEL_FALLBACK_ON_FILE_INPUT_UNSUPPORTED`, `STEEL_FALLBACK_ON_VISION_INPUT_UNSUPPORTED`, `STEEL_FALLBACK_ON_XLSX_INPUT_UNSUPPORTED`, and `STEEL_FALLBACK_ON_HOSTED_TOOL_UNSUPPORTED`.
- Keep capability-smoke under `/api/admin/steel/...` and make it admin-only or local-dev-only until security review says otherwise.
- Add an early OpenAI OAuth provider seam that can be unit-tested and smoke-tested without full workbook orchestration. The Phase 1 implementation should use the direct provider adapter when dependency overrides and packaging verification are included in the same implementation slice. Full live quote-workbook provider smoke remains a Phase 3 gate after openai-oauth binding is complete.
- Preserve the `openai-oauth-provider` spike decision in code/docs: the package can install, import, typecheck, run with mocked fetch, and make a live local-auth text call. AI SDK 6 is Apache-2.0 and production-approved; the remaining dependency requirement is unified package versions via overrides/resolutions.
- Ensure the adapter never sends or stores `previous_response_id` / `item_reference` for `openai_oauth_responses`; the driver is stateless full-history and expects reconstructed context every run.
- Ensure the adapter does not claim official Responses settings were applied when the direct provider or diagnostic proxy normalizes, drops, or rewrites them. Unsupported settings should be recorded in provider run metadata and surfaced through admin/debug or inline warning metadata as appropriate.
- Do not expose openai-oauth responses tokens, OpenAI API keys, or raw provider payloads through model/capability endpoints.
- Document how the user should create a local LibreChat admin account and normal user account before Steel route testing. Verify against current LibreChat behavior where the first registered user becomes `ADMIN` and later registrations default to `USER`; admin route shells should reuse existing role/capability semantics first.
- Document the openai-oauth binding prerequisites and local token-storage expectations before any live openai-oauth smoke or chat UI testing.

Acceptance:

- With `STEEL_GUEST_MODE=true`, unauthenticated user can create a guest Steel conversation and access its own workbook/export with the conversation token.
- With `STEEL_GUEST_MODE=false`, unauthenticated Steel quote requests are rejected.
- With `STEEL_GUEST_MODE=false`, logged-in user without Steel permission is rejected.
- User or guest token cannot read another conversation meta.
- Admin-only route scaffolds require LibreChat admin capability middleware.
- Model selector hides disabled or failed provider/model options unless an admin/debug view explicitly requests diagnostics.
- Capability smoke results are persisted or auditable enough for later typed unsupported and fallback decisions.
- Admin-only Steel diagnostics are reachable only through `/api/admin/steel/...`.
- The direct `openai-oauth-provider` adapter can execute a Responses call through fake auth and mocked `fetch` in tests; manual local-proxy probes remain runbook-only diagnostics.
- The adapter serializes every `openai_oauth_responses` run as `stateless_full_history`, rejects provider-state inputs, and records unsupported/dropped runtime settings.
- No `openai-oauth-provider` package dependency is added in Phase 1 until dependency overrides/resolutions and packaging verification are in the same implementation slice. Tests must still be able to run with injectable clients and without real OAuth.
- The setup docs teach admin/user account creation and openai-oauth binding prerequisites without requiring a live provider call in Phase 1.

Verification:

```bash
rtk npm run build:api
rtk npm run test:packages:api -- --runTestsByPath packages/api/src/steel/postgres.spec.ts
rtk npm run test:api -- --runTestsByPath api/server/routes/steel/index.spec.js
```

## Milestone 1.4: Supabase Schema Discipline

Files:

- Modify `supabase/schema.sql` only if schema changes are needed.
- Add a new one-change file under `supabase/migration/` for each schema change.
- Update `docs/local-dev.md` only if local setup changes.

Tasks:

- Document the production CA-backed `verify-full` policy for deployed backend environments without changing runtime TLS behavior until deployment CA details are known.
- Keep local Supavisor pooler behavior documented separately from production TLS.
- Plan neutral source-code field cleanup for future schema migrations where old field names do not match v8.3 product language.
- Preserve private `steel` schema permissions.

Acceptance:

- Production database connection policy is documented as CA-backed `verify-full`, while local Supavisor behavior remains separate.
- Schema snapshot and migrations are synchronized.
- No migration exposes private Steel tables to Supabase anon/authenticated roles.

Verification:

```bash
rtk npm run build:api
rtk npm run test:packages:api
```

## Phase Gate

Do not move to Phase 2 until:

- Shared Steel contracts build.
- Mongo Steel state schemas build and have focused tests.
- Environment-gated Steel conversation routes have route tests for enabled and disabled guest modes.
- Provider/model contracts and capability records exist before Phase 3 orchestrator work, and they preserve LibreChat model/default setting inputs as provider-neutral runtime options.
- An OpenAI OAuth provider seam exists early enough to test provider authorization flow before workbook orchestration.
- Direct `openai-oauth-provider` implementation is allowed as the primary path only when AI SDK versions are unified through overrides/resolutions, packaging verification passes, model discovery stays backend-owned, and auth material remains server-only.
- Source artifact/source version metadata can represent ERP XLSX imports and parser status under stable append-only column assumptions; Admin DOCX/PDF/image/.txt rejection for ongoing web import is specified. Handbook DOCX real-data provenance is deferred with the later SQL/import task.
- Steel admin APIs use `/api/admin/steel/...`; quote/user-facing APIs use `/api/steel/...`.
- Local account setup and openai-oauth setup runbooks exist before Phase 3 chat UI/provider testing.
- Supabase readiness helper still passes unit tests.
- `tasks/todo.md` review section records implemented route list and schema files.
