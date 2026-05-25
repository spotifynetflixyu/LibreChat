# Phase 1: Platform Foundation

Goal: create the Steel module skeleton, shared contracts, Mongo state models, route boundary, permissions, audit primitives, and Supabase repository seam without building AI behavior yet.

## Scope

- Shared Steel request/response types in `packages/data-provider/src/steel`.
- MongoDB Steel schemas in `packages/data-schemas/src/schema`.
- TypeScript service modules under `packages/api/src/steel`.
- Thin Express route wrappers under `api/server/routes/steel`.
- Environment-gated guest/auth access.
- Audit primitive.
- Supabase repository wrapper around `packages/api/src/steel/postgres.ts`.
- Source artifact/source version metadata for DOCX/XLSX Admin workflows and rejection audit for non-DOCX/XLSX uploads.

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
- Add Steel endpoint helpers under `/api/steel`.
- Add React Query keys that do not collide with existing LibreChat keys.
- Keep arbitrary JSON wrapped in named types; avoid broad `Record<string, unknown>` as a shortcut.

Acceptance:

- Types are stable enough for backend, frontend, and tests.
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
- Create `packages/data-schemas/src/schema/steelOpenAIRun.ts`
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

Tasks:

- Use `steel_` collection names.
- Add owner/access indexes: `user_id`, `guest_token_hash`, `librechat_conversation_id`, `steel_conversation_meta_id`, `status`, `created_from`, `updated_at`.
- Add source/import indexes: `project_source_id`, `source_id`, `parse_status`, `admin_review_status`.
- Keep raw provider payload storage bounded; store IDs, token counts, selected model, context refs, and error summaries.
- Model workbook JSON with seven fixed sheet IDs.
- Model source versions with original DOCX/XLSX file ID, source file type, parse version, parse status, extraction summary, and admin review status.

Acceptance:

- Authenticated conversation meta can be created and found by user.
- Guest conversation meta can be found by token hash.
- Workbook version sequence starts at `1`.
- Patch records preserve before/after version sequence.
- Source version preserves uploaded DOCX/XLSX metadata and parser status.
- Audit logs can be written without coupling to AI code.

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
- Create `packages/api/src/steel/repositories/postgres.ts`
- Create `api/server/routes/steel/index.js`
- Modify `api/server/routes/index.js`
- Modify `api/server/index.js`

Initial endpoints:

```text
POST /api/steel/conversations/authenticated
POST /api/steel/conversations/guest
GET  /api/steel/conversations/:conversationMetaId
```

Tasks:

- Keep Express wrappers in `api/` thin.
- Route handlers call TypeScript services from `@librechat/api` after `npm run build:api`.
- Implement `STEEL_GUEST_MODE=true|false` in one service-level guard.
- Add service-level access checks rather than trusting route middleware alone.
- Create audit event helper that every later write path can reuse.

Acceptance:

- With `STEEL_GUEST_MODE=true`, unauthenticated user can create a guest Steel conversation and access its own workbook/export with the conversation token.
- With `STEEL_GUEST_MODE=false`, unauthenticated Steel quote requests are rejected.
- With `STEEL_GUEST_MODE=false`, logged-in user without Steel permission is rejected.
- User or guest token cannot read another conversation meta.
- Admin-only route scaffolds require LibreChat admin capability middleware.

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

- Resolve production CA-backed `verify-full` policy for deployed backend environments.
- Keep local Supavisor pooler behavior documented separately from production TLS.
- Plan neutral source-code field cleanup for future schema migrations where old field names do not match v8.2 product language.
- Preserve private `steel` schema permissions.

Acceptance:

- Production database connection policy is no longer open.
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
- Source artifact/source version metadata can represent DOCX/XLSX uploads and parser status; Admin PDF/image/.txt rejection is specified.
- Supabase readiness helper still passes unit tests.
- `tasks/todo.md` review section records implemented route list and schema files.
