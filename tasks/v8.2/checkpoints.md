# Steel v8.2 Checkpoints

Use this file as the implementation follow-up tracker. Copy a checkpoint into `tasks/todo.md` when it becomes active, then record evidence in that task's Review section.

## Checkpoint 0: v8.2 Baseline Review

Required:

- [ ] `STEEL_GUEST_MODE=false` is the documented default.
- [ ] OpenAI Responses calls use `conversation`; prior response IDs are audit/fallback only.
- [ ] Ongoing formal Admin Import accepts ERP XLSX parsed data only.
- [ ] Admin ERP Import rejects DOCX/PDF/image/.txt uploads before parsing.
- [ ] Steel handbook DOCX is scoped to real schema/data-model design first; real handbook data SQL/import is deferred to a later code-agent data task, and it is not Admin web upload or reusable product parser.
- [ ] Chinese reference labels under `docs/reference/doc` are mapped to English canonical schema keys before they shape schema, API mock data, tools, or database queries.
- [ ] `tasks/v8.2/source-schema-mapping.md` exists and is linked from the phase plan.
- [ ] Workbook JSON requires seven fixed sheets.
- [ ] Customer quote sheet hides customer tier and internal fields.
- [ ] Price-before-weight rule is explicit.
- [ ] ExcelJS is the customer-facing XLSX renderer.
- [ ] Old direct-connector, PDF-direct-import, and Admin PDF parser assumptions are absent.

Verification:

```bash
rtk proxy rg -n "報價明細|總結|人工複核清單|價格來源|判讀備註|系統訂單|給客戶用" tasks/v8.2 docs/steel_librechat_plan_v8.2.md
rtk proxy rg -n "ERP XLSX|handbook DOCX|rejects PDF|拒絕 PDF|ExcelJS|Quote Resolution|Eval Harness" tasks/v8.2 docs/steel_librechat_plan_v8.2.md
rtk proxy rg -n "source schema mapping|canonical schema|中文來源|英文 canonical" CONTEXT.md tasks/v8.2 docs/steel_librechat_plan_v8.2.md
```

## Checkpoint 1: Foundation Gate

Required:

- [ ] Steel shared data-provider contracts build.
- [ ] Steel Mongo schemas are created with `steel_` collection names.
- [ ] Environment-gated Steel conversation routes are registered under `/api/steel`.
- [ ] Steel route wrappers in `api/` are thin.
- [ ] Access checks exist in service layer.
- [ ] Route tests cover both `STEEL_GUEST_MODE=true` and `STEEL_GUEST_MODE=false`.
- [ ] Audit primitive exists.
- [ ] Supabase schema/migration rule is preserved.
- [ ] `steel_source_versions` metadata supports ERP XLSX imports; handbook DOCX only informs schema/data model unless a later data-import task is approved.

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

Required:

- [ ] Handbook content has been reviewed for real schema/data-model implications.
- [ ] Source schema mapping records Chinese source label/header, English canonical key, target table/DTO/tool field, type/unit, normalizer, and source reference.
- [ ] Source schema mapping does not require `review_status`, `corrected_text`, or a typo approval workflow.
- [ ] Code-owned mapping design exists for `packages/api/src/steel/schema/mapping.ts`.
- [ ] AI API prompt/tool context can use the mapping to resolve Chinese wording to existing canonical keys.
- [ ] Repository filters, SQL columns, DTO keys, workbook paths, and tool arguments use English canonical keys.
- [ ] Chinese labels, product names, aliases, and source excerpts are stored only as values/display/source/search data, not code-owned query field names.
- [ ] Supabase repositories use parameterized SQL.
- [ ] Lookup tools validate with Zod.
- [ ] No raw SQL/Mongo query tools exist.
- [ ] Customer tier resolver returns candidates when ambiguous.
- [ ] Normalization expands aliases and dimensions into multiple search terms.
- [ ] Price candidate search returns exact/major/alias/closest/no-price matches.
- [ ] Price ranking never converts between incompatible pricing units.
- [ ] Missing prices are never represented as `0`.
- [ ] Stock allocation prices long materials by sellable stock length, not net finished length.
- [ ] Deterministic calculators own weight and processing calculations.
- [ ] Tool calls are logged and sanitized before model use.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(repositories|tools|quote|normalization|pricing|allocation|calculators)/.*\\.spec\\.ts$"
rtk npm run build:api
```

Manual scenario:

```text
Input: 黑圓管48.1 6米 20支
Expected: search terms include 黑圓管, 黑管, 黑AB圓管, 1 1/2, 1英半, 48.3; no hard-coded exact match if thickness/unit is ambiguous.
```

## Checkpoint 3: Quote Workbook Vertical Slice

Required:

- [ ] Authenticated user can create Steel conversation meta.
- [ ] User can send a Steel message with selected model.
- [ ] Workbook JSON, patch request/response, selected refs, changed paths, and changed-field summary DTOs live in `packages/data-provider/src/steel/workbooks.ts`.
- [ ] Conversation message request types reuse workbook DTOs instead of redefining selected-cell or patch metadata shapes.
- [ ] Backend Zod validation in `packages/api/src/steel/workbook/schema.ts` is the canonical runtime validation authority.
- [ ] Frontend code and tests consume shared workbook DTOs/API responses and do not define an independent workbook validation schema.
- [ ] Chat Workspace is an independent Steel workspace and does not require MVP changes to the core LibreChat chat store/message flow.
- [ ] Desktop and mobile Steel views share the same UX framework, API contracts, and mock data.
- [ ] Mobile Workbook Preview opens as a full-view modal with a visible top-right close button.
- [ ] Selecting one workbook cell applies selected styling and adds a field marker to the bottom message input.
- [ ] Message submit sends at most one structured `selected_workbook_refs` item; backend validation does not rely on marker text alone.
- [ ] Multi-round conversations can keep modifying workbook data through subsequent patch requests.
- [ ] Text-only requests can update multiple workbook fields only when each target is explicit and backend validation accepts every patch path.
- [ ] AI workbook patches do not require a per-update preview/confirmation gate in Phase 3.
- [ ] Latest accepted workbook patch fields are highlighted with a background color distinct from selected-cell styling until the next accepted workbook patch.
- [ ] Failed or rejected patch attempts do not highlight workbook fields and do not replace the previous accepted-patch highlight set.
- [ ] Phase 3 does not expose an explicit Undo button or version-control UI.
- [ ] User-requested revert/change flows go through chat and produce validated workbook patches.
- [ ] Successful AI workbook patches produce a concise chat summary of changed fields.
- [ ] Chat does not render a full diff table for successful workbook patches.
- [ ] Chat Workspace can use API mock data from `packages/data-provider/src/steel/mock/`, shaped from `docs/reference/doc` without importing real data.
- [ ] Mock workbook fixtures derived from Chinese reference examples use English DTO/API keys and preserve Chinese only as display/source/alias data.
- [ ] Mocked AI/prompt tests include source-schema mapping context and reject unknown keys through clarification/manual-review behavior.
- [ ] Frontend and backend tests do not define separate mock workbook datasets.
- [ ] Mock workbook fixtures are imported through the explicit mock path and are not re-exported by the production Steel data-provider barrel.
- [ ] Mock workbook fixtures are typed against shared workbook DTOs and pass backend workbook validation where required.
- [ ] Workbook Preview renders all seven tabs from mock or real workbook API data.
- [ ] OpenAI adapter records conversation/response IDs according to Phase 0 decision.
- [ ] Prompt bundle records context refs.
- [ ] Tool-calling loop executes whitelisted tools only.
- [ ] Structured output creates or patches Workbook JSON.
- [ ] Workbook JSON contains all seven required sheet IDs.
- [ ] Workbook line persists formula, default unit price, quoted unit price, line total, adjustment source, quote trace, and source refs.
- [ ] Workbook patch writes `steel_workbook_patches`.
- [ ] Selected-cell edit requests return workbook patches or refreshed workbook data that synchronizes the UI.
- [ ] Patch responses include changed paths or equivalent metadata for latest-updated-field highlighting.
- [ ] A new accepted patch replaces the previous latest-highlight set instead of accumulating old highlighted fields.
- [ ] Failed/rejected patch responses include a user-facing reason and no changed paths.
- [ ] No frontend-only undo path can mutate workbook JSON outside the patch service.
- [ ] Patch responses include changed-field summary items for chat acknowledgement.
- [ ] Ambiguous multi-field edit requests ask for clarification or produce manual-review output instead of guessing patch targets.
- [ ] Manual live OpenAI API smoke run creates or patches a customer-visible workbook before Phase 4.
- [ ] Stale patch version returns `409`.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(openai|prompt|workbook|tools|quote)/.*\\.spec\\.ts$"
rtk npm run test:client -- --runTestsByPath client/src/features/steel
rtk npm run build:client-package
rtk npm run build:api
```

Manual scenario:

```text
Authenticated user pastes a LINE order.
Expected: DB lookup facts are used, OpenAI creates or patches a seven-sheet workbook, context_refs and tool_call_ids are persisted.
```

## Checkpoint 4: Export Gate

Required:

- [ ] ExcelJS dependency is added intentionally to the rendering owner package.
- [ ] Full workbook export works.
- [ ] Selected sheet export works.
- [ ] Export includes all seven required sheets.
- [ ] System order sheet uses fixed columns.
- [ ] Customer quote sheet uses backend allowlist.
- [ ] Customer quote sheet excludes customer tier, internal cost, source refs, admin notes, AI notes, margin, formula/debug fields, and internal low-confidence reasons.
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
Download customer quote sheet.
Expected: customer-facing fields only; internal traceability appears only in internal workbook sheets.
```

## Checkpoint 5: Admin ERP XLSX Import And Table Maintenance Gate

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

Verification:

```bash
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
- [ ] Text order parsing eval exists.
- [ ] Price-first eval exists.
- [ ] No-zero-unknown-price eval exists.
- [ ] Multi-key price search eval exists.
- [ ] Stock allocation eval exists.
- [ ] Admin upload policy rejection eval exists.
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
- What happens when OpenAI state expires or becomes too expensive?
- Can this phase be reverted independently?
