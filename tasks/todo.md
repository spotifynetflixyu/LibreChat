# Steel Core Quote Runtime Implementation Queue

Scope boundary: Admin review UI is paused. The pause applies to visible Admin
screens only. Continue sequencing backend/data/tool work for quote runtime,
calculation, rule proposal review APIs, approval/publish flows, and reviewed
quote defaults retrieval when each slice is ready. Do not build Admin screens
until the user explicitly reopens UI scope.

## Active: Steel v8.3 Phase 6C File/PDF/OCR/Drawing Evidence Flow Plan

Goal: write an implementation and test plan for quote-conversation evidence
attachments: PDF, images, scanned drawings, and spreadsheet evidence. The first
OCR correctness fixture is `docs/reference/example/c.png`, with expected plate
schedule rows captured as JSON for comparison. Evidence first becomes
one conversation-scoped `file_analysis_data` workspace; rows are marked with
source file/page/region so the user can verify or correct extracted tables
against each PDF/image, then confirmed analysis can create rows in the single
quote workbook plus `manual_review` and `interpretation_notes`. It must not
create Admin import source versions or formal database writes.

- [x] Inspect existing Phase 6C plan, file-analysis config boundary, Steel chat
      attachment path, provider file serialization tests, and semantic workbook
      projection.
- [x] Save the detailed implementation plan under `docs/plans/`.
- [x] Incorporate the OCR rules DB flow: `docs/reference/OCR規則.txt` syncs into
      reviewed active `steel.agent_rules` and visual OCR turns load that rule
      before provider generation.
- [x] Incorporate the user-confirmed `file_analysis_data` flow: AI can create
      a verifiable extracted table first, later turns can re-read original
      files, and confirmed analysis can create/update quote workbook rows.
- [x] Incorporate the fixed provider boundary: uploaded evidence is stored
      through LibreChat file storage and Mongo `File` records, then resent as
      bytes/file parts to `openai_oauth_responses`; no official OpenAI Files API
      or provider-state retention is used for Phase 6C.
- [x] Implement Phase 6C Task 0 first slice: sync `docs/reference/OCR規則.txt`
      into `steel.agent_rules`, load reviewed OCR rules for visual
      `openai_oauth_responses` turns, and fail before provider generation when
      visual OCR lacks reviewed rules.
- [x] Implement Phase 6C Task 1 first slice: add `c.png` expected JSON fixture,
      drawing evidence Zod schema, normalized row comparison, field accuracy,
      and mismatch reporting.
- [x] Implement Phase 6C Task 2 first slice: add quote evidence attachment
      classifier for image/PDF/spreadsheet/unsupported files and distinguish
      durable Mongo `File` records from inline smoke/backcompat file payloads.
- [x] Continue Phase 6C Task 2: add injected resolver for
      `fileId -> Mongo File record -> storage bytes -> openai_oauth_responses`
      file part, with owner/conversation access checks before storage reads.
- [x] Wire durable `files[].fileId` through `/steel/oauth-chat`: handler accepts
      persisted file refs, resolves them through the injected resolver, and the
      `/api` route thin wrapper reads bytes through LibreChat `getFiles` plus
      configured storage `getDownloadStream`.
- [x] Apply user correction: remove Steel helper npm scripts from
      `packages/api/package.json`; run one-off Steel scripts directly with
      `node packages/api/scripts/<script>.cjs`.
- [x] Verify touched-file hygiene with tracked `git diff --check` plus new-plan
      trailing-whitespace/newline checks.
- [x] Apply user correction: `buildDrawingEvidencePrompt` now treats Supabase
      OCR rules as the source of truth and only composes DB-loaded rules plus
      the current user request.
- [x] Implement Phase 6C Task 4 provider extraction service: call AI with
      original provider file parts and DB-loaded OCR rules, return an analysis
      candidate only, and leave `file_analysis_data` persistence plus workbook
      projection to later tasks.
- [x] Apply user correction: one conversation/order has one
      `file_analysis_data` workspace, and multiple uploaded file rows are
      distinguished by source file/page/region metadata.

Review:

- `npm --workspace packages/api run steel:sync-ocr-rules -- --dry-run` passed
  and computed sha256
  `43215f55617de2f71aa8c1f87555d50823ead5c2cb27cdc6378c525246e6be74`.
- `npm --workspace packages/api run steel:sync-ocr-rules -- --apply` passed and
  read back active reviewed `steel.agent_rules` row
  `steel-drawing-ocr-policy` version `1`.
- `cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/vision/compare.spec.ts src/steel/vision/attachments.spec.ts --runInBand`
  passed: 4 suites, 67 tests.
- `cd packages/api && npx jest src/steel/vision/resolver.spec.ts --runInBand`
  passed: 1 suite, 4 tests.
- `node packages/api/scripts/sync-steel-ocr-rules.cjs --apply` passed and read
  back the active reviewed OCR rule row; no npm script was used.
- `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/vision/resolver.spec.ts src/steel/vision/attachments.spec.ts src/steel/vision/compare.spec.ts src/steel/ai/provider.spec.ts --runInBand`
  passed after rebuilding data-provider: 5 suites, 72 tests.
- `npm run build:data-provider` passed.
- `npm run build:api` exited `0`; remaining Rollup TypeScript warnings are
  existing non-Steel endpoint/cache/config warnings.
- `node -c api/server/routes/steel/index.js` passed.
- `rg 'steel:(export-oauth-fixtures|import-reference-data|sync-ocr-rules|prove-office-conversion)' packages/api/package.json package.json`
  returned no matches.
- `npm run build:api` exited `0`; Rollup still prints existing non-Steel
  TypeScript warnings, but the new `src/steel/ai/provider.ts` warning was
  removed before checkpoint.
- `git diff --check` passed.
- `cd packages/api && npx jest src/steel/vision/prompt.spec.ts --runInBand`
  passed after simplifying `buildDrawingEvidencePrompt` to DB OCR rules plus
  user request only: 5 tests.
- `cd packages/api && npx jest src/steel/vision/service.spec.ts --runInBand`
  passed for Task 4 provider extraction service: 5 tests.
- `cd packages/api && npx jest src/steel/vision/prompt.spec.ts src/steel/vision/service.spec.ts --runInBand`
  passed: 2 suites, 10 tests.
- `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/vision/attachments.spec.ts src/steel/vision/resolver.spec.ts src/steel/vision/compare.spec.ts src/steel/vision/prompt.spec.ts src/steel/vision/service.spec.ts src/steel/ai/provider.spec.ts --runInBand`
  passed after Task 4: 7 suites, 82 tests.
- `npm run build:api` exited `0` after Task 4; Rollup still prints existing
  non-Steel TypeScript warnings in agents/app/cache/endpoints/middleware files.
- `git diff --check` passed after Task 4.

## Skipped: Steel v8.3 Phase 5 Admin ERP XLSX Source Management Grill

Goal: pressure-test Phase 5 before implementation. Scope is Admin ERP XLSX
source management only: source metadata, ERP XLSX upload guard, parser preview,
old-data matching, validation, merge review, commit, audit, and the first Admin
table-maintenance path. Customer Export remains out of scope.

- [x] Read Phase 5 plan, source-schema mapping, `CONTEXT.md`, existing Admin
      route shell, current Steel schema, and import/mapping code.
- [x] User explicitly skipped this section before decisions were locked.

## Active: Steel C-Type Price Unit Rule Sync

Goal: prevent C 型鋼口語「一支多少」 from overriding reviewed database price
row units. `search_price_candidates` remains authoritative for productName,
pricing unit, unit price, and unit weight; one piece is only the requested
quantity when the adopted row is kg-priced.

- [x] Add the lesson that user delivery units must not override database price
      row pricing units.
- [x] Update `docs/reference/agent規則.txt` so the mandatory Agent Prompt states
      that `search_price_candidates` database price rows are authoritative.
- [x] Update `docs/reference/鋼材規則.txt` with the C100x50x20x2.3t 6M kg-priced
      C 型鋼 example and forbidden 支-price interpretation.
- [x] Sync the reviewed active `steel.agent_rules` and `steel.quote_rules` rows
      to cloud Supabase.
- [x] Verify DB prompt contents and diff hygiene.

Review evidence:

- Supabase reviewed active `steel.agent_rules.slug =
  steel-default-agent-instruction` now matches `docs/reference/agent規則.txt`
  sha256 `470146b0488410890e3d6cc3ff85e30324c24ffe101486421537f4e55cc59e61`.
- Supabase reviewed active `steel.quote_rules.id = 9` now matches
  `docs/reference/鋼材規則.txt` sha256
  `170be3c583a001edc06cfd04f695b06a4ddf86c1b6ff244aaded9e63ef0bd0f5`.
- Supabase reviewed active C 型鋼 pricing rule `steel.quote_rules.id = 3`
  now includes the kg-priced C100x50x20x2.3t 6M example, with
  `單位 Kg`, `單價 26.8`, `小計 643.2`, and the forbidden `單位=支`
  interpretation.
- DB read-back confirmed agent prompt contains `search_price_candidates`,
  `database price row`, and `不可把小計`; quote rules id 3/id 9 contain the
  C 型鋼 kg example and forbidden 支-price case.
- Follow-up fix: repaired hash-only `source_refs` created during prompt sync by
  restoring canonical `channel` / `factType` provenance on
  `steel-default-agent-instruction`, `quote_reference_steel_rules`, and
  `quote_c_type_material_lookup_strategy`. A cloud DB read-back across active
  reviewed `agent_rules`, `quote_rules`, `catalog_family_rules`, and
  `customer_rules` returned `missingRequiredSourceRefFields = 0`.
- Workbook prompt follow-up: `docs/reference/workbook規則.txt` now has a compact
  `Workbook 單位判斷邏輯` section. All workbook material units in
  `quote_details`, `system_order`, `price_sources`, and `customer_quote` must
  match the adopted `search_price_candidates` price row unit; user delivery
  words such as `一支` cannot override it. Supabase
  `steel.agent_rules.slug = steel-workbook-output-policy` was updated to local
  sha256 `36a674b7579276cf2794a5b2a3cf217962689b903024d4cebe774f4e80128616`,
  and source-ref validation still returns `missingRequiredSourceRefFields = 0`.
- Internal-server-error follow-up: source-level live OAuth/Codex natural
  workbook calculation smoke passed after the DB rule updates, but the running
  `/steel/oauth-chat` backend was still using the built `@librechat/api` dist
  loaded at process start. Rebuilt `packages/api` and restarted
  `npm run backend:dev`; 3080 is listening again with the refreshed dist.
- Customer quote privacy follow-up: `docs/reference/workbook規則.txt` now states
  that `customer_quote` must not reveal internal pricing logic, including
  customer tier, price A/B/C, customer price, tier price, cost, margin, or
  wording implying different customers have different prices. The bottom
  `customer_quote` row is now `報價總額`, with quantity/unit/unit price blank and
  the customer-facing total in subtotal. Supabase
  `steel.agent_rules.slug = steel-workbook-output-policy` was updated to local
  sha256 `64e5af6b1ff0b758bf756d8f0bc5705baec85914631578d27985f783092583b6`,
  and source-ref validation still returns `missingRequiredSourceRefFields = 0`.
- Customer quote total-row follow-up: added top-level semantic
  `customerQuoteTotal` so AI can explicitly output the bottom `報價總額` row
  without backend auto-filling it. Projection maps that semantic target to
  `customer_quote.customer_total`, including blank quantity/unit/unit price
  cells. Provider prompts now instruct AI to send `customerQuoteTotal` for the
  customer-facing total row. Focused semantic/provider tests passed. Supabase
  `steel.agent_rules.slug = steel-workbook-output-policy` was updated to local
  sha256 `e7eab4a929bfe658df25450e2287b2b175ad6ff50961da1345cd7c9ec1170c8f`,
  DB read-back confirmed the `customerQuoteTotal` guidance and
  `missingRequiredSourceRefFields = 0`, `packages/api` build passed with
  existing non-Steel TypeScript warnings, and backend dev server restarted on
  3080 with refreshed dist.

## Active: Steel Summary Total Contract Cleanup

Goal: remove the conflicting summary confirmed/provisional amount contract.
Workbook subtotal validation now only checks `summary.totalAmount` against the
sum of numeric `quoteLines[].subtotal`; confidence/provisional status stays on
quote lines, manual review, interpretation notes, or customer quote notes.

- [x] Add RED tests showing old summary amount fields must not drive subtotal
      validation or semantic summary projection.
- [x] Remove summary confirmed/provisional amount fields from semantic schema,
      projection, validator, provider feedback, and provider fixtures.
- [x] Update `docs/reference/agent規則.txt` and
      `docs/reference/workbook規則.txt` to the totalAmount-only contract.
- [x] Sync reviewed active Supabase `steel.agent_rules` prompts and source hashes.
- [x] Verify focused tests, API build, DB prompt contents, diff hygiene, and
      restart the backend dev server.

Review evidence:

- RED tests failed because semantic projection still emitted separate summary
  amount rows and subtotal validation still inspected more than totalAmount.
- Green implementation now rejects only mismatched numeric `summary.totalAmount`;
  semantic workbook projection no longer emits separate summary amount rows.
- Provider subtotal-loop feedback now asks the model to correct only
  `summary.totalAmount`, so it no longer conflicts with provisional/low
  confidence guidance.
- Supabase reviewed active `steel.agent_rules` rows
  `steel-default-agent-instruction` and `steel-workbook-output-policy` were
  updated from `docs/reference`, with refreshed SHA-256 source refs.
- Verification: focused workbook/provider tests passed, API build passed with
  existing non-Steel Rollup TypeScript warnings, DB prompt check returned no old
  summary amount key/label strings, and backend dev server restarted on 3080.

## Active: Steel Phase 4 Staff Workbook Export Implementation

Goal: implement Phase 4 staff workbook export end to end so `/steel/oauth-chat`
can download a persisted Steel workbook as XLSX. This phase streams generated
ExcelJS bytes from memory, allows arbitrary selected workbook sheets, and does
not apply customer masking, dedicated system-order export logic, Supabase
Storage, or durable `steel_excel_exports` records.

- [x] Add RED tests for Excel workbook rendering from persisted workbook JSON.
- [x] Add RED tests for the workbook export API route/handler.
- [x] Add RED tests for `/steel/oauth-chat` export UI wiring.
- [x] Implement ExcelJS renderer/service in `packages/api/src/steel/exports`.
- [x] Implement `POST /api/steel/workbooks/:workbookId/export`.
- [x] Add data-provider/client export helper and `/steel/oauth-chat` download UI.
- [x] Verify focused backend/client tests, API build, client build or targeted
      typecheck, and diff hygiene.

Review evidence:

- Added `steelWorkbookExportRequestSchema`, data-provider endpoint/helper, and
  arraybuffer POST support so `/steel/oauth-chat` can request XLSX bytes through
  the normal authenticated client path.
- Added ExcelJS renderer under `packages/api/src/steel/exports`; it streams
  in-memory XLSX bytes from persisted workbook JSON, supports arbitrary selected
  sheets, and renders missing currency values as `未確認` instead of `0`.
- Added `POST /api/steel/workbooks/:workbookId/export`; it validates workbook
  version before streaming and does not call AI, patch workbook data, refresh
  prices, write Supabase Storage, or create durable export records.
- `/steel/oauth-chat` workbook preview now has per-sheet export checkboxes and a
  `Download XLSX` action using the current workbook version.
- Verification: RED tests failed on missing schema/renderer/handler/UI; GREEN
  focused tests passed for data-provider workbooks, API export/handlers, and
  `SteelOAuthChat`; `npm run build --workspace packages/data-provider` passed;
  `npm run build --workspace packages/api` passed with existing non-Steel
  Rollup TypeScript warnings.

## Active: Steel v8.3 Phase 3 Checkpoint Sync And Phase 4 Grill

Goal: close the completed v8.3 Phase 3 checkpoint evidence without overstating
unfinished UI/API/export work, then pressure-test Phase 4 Excel Export before
implementation starts.

- [x] Sync `tasks/v8.3/checkpoints.md` for completed Phase 2/3 rule,
      workbook, provider, and live-smoke evidence.
- [x] Keep unchecked any Phase 3 UI/API/fallback/file/export items that are not
      backed by current implementation evidence.
- [x] Grill `tasks/v8.3/phase-4-excel-export.md` and batch every unresolved
      export decision with recommended answers.
- [x] Run document hygiene checks after the checkpoint sync.

Review evidence:

- Synced `tasks/v8.3/checkpoints.md` with 2026-06-08 status notes for
  Checkpoint 1, Checkpoint 2, and the fixed OAuth/Codex `/steel/oauth-chat`
  portion of Checkpoint 3.
- Left unchecked the unsupported strict Phase 3 items: missing
  `packages/api/src/steel/workbook/schema.ts`, formal Steel Workspace/mobile
  selected-cell UI, explicit OpenAI API fallback smoke, prompt context-ref
  persistence, and ambiguous multi-field clarification coverage.
- Updated `.env.example` and
  `tasks/v8.3/openai-oauth-provider-real-auth-implementation.md` so active
  runtime examples use `gpt-5.5` instead of stale `gpt-5.4`.
- Focused Jest passed: `cd packages/api && npx jest
  src/steel/ai/config.spec.ts src/steel/models.spec.ts
  src/steel/access.spec.ts src/steel/conversations/service.spec.ts
  src/steel/tools/registry.spec.ts src/steel/workbook/subtotals.spec.ts
  --runInBand` passed 25 tests.
- Hygiene passed: `git diff --check`.
- Phase 4 grill follow-up decisions synced after user correction:
  `tasks/v8.3/phase-4-excel-export.md`, `tasks/v8.3/README.md`,
  `tasks/v8.3/checkpoints.md`,
  `tasks/v8.3/phase-0-decisions.md`,
  `docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md`,
  `CONTEXT.md`, and `tasks/lessons.md` now describe Phase 4 as staff workbook
  export from `/steel/oauth-chat`.
- Current Phase 4 export boundary: generate XLSX in memory and stream from the
  API, allow arbitrary selected workbook sheets, do not store generated files in
  Supabase Storage, do not write durable `steel_excel_exports`, do not implement
  customer masking, and do not add a dedicated system-order export action.

## Active: Steel Reference Prompt and Formula Tool Cleanup

Goal: sync the reviewed reference prompts with the approved runtime boundary.
Formula numbering guidance belongs in workbook instructions. Steel category,
pricing, material, processing, allocation, and true-zero guidance belongs in
`lookup_quote_rules` rule prompts. `lookup_formula` should no longer be an
AI-callable runtime tool, and Agent rules should not route formula code lookup
through `lookup_quote_rules`.

- [x] Update `docs/reference/agent規則.txt` and
      `docs/reference/workbook規則.txt` to reflect the current DB-backed
      prompt/tool boundary.
- [x] Remove `lookup_formula` from Steel runtime tool definitions, schemas,
      executor dispatch, and provider loop gating.
- [x] Update seed prompt/tool policy metadata so future DB prompt updates do
      not reintroduce `lookup_formula`.
- [x] Upsert current `docs/reference/agent規則.txt`,
      `docs/reference/workbook規則.txt`, and `docs/reference/鋼材規則.txt`
      prompts to cloud Supabase.
- [ ] Add the missing `docs/reference/鋼材規則.txt` `lookup_quote_rules`
      business rules after the user supplies the omitted rule text.
- [x] Verify focused Steel tool/provider tests, API build, and diff hygiene.

Review evidence:

- Cloud Supabase upsert completed against `.env` `STEEL_POSTGRES_URL`.
- `steel.agent_rules.slug = steel-default-agent-instruction` now matches
  `docs/reference/agent規則.txt`; prompt length `5706`, sha256
  `39a9f56bee90be34767e577fcf5ccb0a0dc3a6a042d9fc89197c086021f6bd6f`.
- `steel.agent_rules.slug = steel-workbook-output-policy` now matches the
  user-updated `docs/reference/workbook規則.txt`; prompt length `9566`,
  sha256 `2d94f4ceba301fb4afe721e01a3811dfd5a46bc82372636ad1b1db1bb98435d4`.
- `steel.quote_rules` company-level row with canonical key
  `quote_reference_steel_rules` now matches `docs/reference/鋼材規則.txt`;
  prompt length `2482`, sha256
  `1c94f145908b3910c52ae77d715aa98b44da5eef1ef886cacbbf08e8ff1a7dc0`.
- DB read-back hash check matched all three local files exactly and confirmed
  none of the three DB prompts contains `lookup_formula`.
- Focused tests passed: `cd packages/api && npx jest
  src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts
  src/steel/ai/provider.spec.ts --runInBand` passed 61 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files,
  but exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Runtime Rule Injection

Goal: every Steel AI round can load the applicable reviewed DB rules through
tools, while mandatory Agent and workbook-output instructions are injected from
`steel.agent_rules`. No code prompt fallback is allowed when required DB rules
cannot be read.

- [x] Confirm today's reviewed Agent/workbook/quote prompt rows are updated in
      cloud Supabase and match local reference file hashes.
- [x] Load mandatory Agent Prompt from `steel.agent_rules` for every Steel
      runtime request.
- [x] Load workbook-output rules from `steel.agent_rules` whenever
      `patch_quote_workbook` is enabled; fail before provider generation if DB
      rules are missing.
- [x] Keep `lookup_catalog_families`, `search_customers`,
      `lookup_quote_rules`, and `search_price_candidates` callable in every
      Steel tool round so AI can fetch catalog, customer, quote, and price
      rules as needed.
- [x] Verify focused provider/tool tests, API build, Supabase read-back, and
      diff hygiene.

Review evidence:

- Added provider RED/GREEN coverage for DB-backed workbook output rules and
  fail-fast behavior when reviewed workbook rules cannot be loaded.
- Provider now loads Agent Prompt rows by reviewed `rule_sections` and
  workbook-output rows by reviewed `rule_type = workbook_output_rule`; no
  static workbook prompt fallback remains in provider code.
- Every Steel tool round now exposes the full business tool set:
  `lookup_quote_rules`, `lookup_catalog_families`, `search_customers`, and
  `search_price_candidates`; `toolChoice` and the quote-rule-before-price
  execution guard still enforce required lookup progress.
- Cloud Supabase read-back matched local reference prompts exactly:
  `agent_rules:steel-default-agent-instruction` length `5706`, sha256
  `39a9f56bee90be34767e577fcf5ccb0a0dc3a6a042d9fc89197c086021f6bd6f`;
  `agent_rules:steel-workbook-output-policy` length `9566`, sha256
  `2d94f4ceba301fb4afe721e01a3811dfd5a46bc82372636ad1b1db1bb98435d4`;
  `quote_rules:quote_reference_steel_rules` length `2482`, sha256
  `1c94f145908b3910c52ae77d715aa98b44da5eef1ef886cacbbf08e8ff1a7dc0`.
  All three DB prompts have `containsLookupFormula=false`.
- Reconfirmed `docs/reference/鋼材規則.txt` maps to exactly one reviewed
  `steel.quote_rules` row: `id=9`, `rule_type=material_rule`,
  `scope_type=company`, `source_refs[0].canonicalKey=quote_reference_steel_rules`.
  Its `prompt` hash and `source_refs[0].sha256` now both equal
  `1c94f145908b3910c52ae77d715aa98b44da5eef1ef886cacbbf08e8ff1a7dc0`.
- Focused tests passed: `cd packages/api && npx jest
  src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts
  src/steel/ai/provider.spec.ts --runInBand` passed 61 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files,
  but exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Workbook Subtotal Validator Extraction

Goal: extract the existing provider subtotal/summary consistency check into a
shared workbook helper for v8.3 Phase 2.6. AI still owns arithmetic; backend
only validates confirmed workbook totals against line subtotals and unknown
amount state.

- [x] Add focused workbook subtotal validator tests.
- [x] Create `packages/api/src/steel/workbook/subtotals.ts`.
- [x] Reuse the shared helper from the Steel provider workbook patch loop.
- [x] Verify provider subtotal mismatch behavior still loops before accepting a
      confirmed workbook total.
- [x] Run backend/app-level verification directly without browser UI smoke.

Review evidence:

- Added `packages/api/src/steel/workbook/subtotals.ts` and
  `subtotals.spec.ts` for numeric amount parsing, summary/line subtotal
  mismatch detection, first-mismatch lookup, and rejection of numeric
  `summary.totalAmount` when any line subtotal is `未確認`.
- Reused the shared subtotal helper from the provider workbook patch loop. The
  provider now returns a tool result asking AI to resend `patch_quote_workbook`
  with `未確認` totals when a line subtotal is unknown.
- Added provider coverage for the unknown-subtotal totalAmount loop.
- Updated `tasks/v8.3/phase-2-data-tools.md` so Phase 2 no longer lists
  `lookup_formula` as an AI-callable runtime tool.
- Direct backend/app verification passed without browser UI smoke:
  `cd packages/api && npx jest
  src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts
  src/steel/workbook/subtotals.spec.ts src/steel/workbook/semantic.spec.ts
  src/steel/workbook/service.spec.ts src/steel/ai/provider.spec.ts
  src/steel/handlers.spec.ts --runInBand` passed 102 tests, and
  `cd api && npx jest server/routes/__tests__/steel.spec.js --runInBand`
  passed 10 route-shell tests for `/api/steel`.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files,
  but no warning remains in the new subtotal helper.
- Hygiene passed: `git diff --check`.

## Active: Steel OAuth/Codex Live Smoke

Goal: run a real `/steel/oauth-chat` provider smoke through the fixed
OAuth/Codex path without browser UI, proving reviewed DB rule injection,
database-backed quote lookup tools, workbook patching, and backend subtotal
loop feedback all work with the live model.

- [x] Add a focused manual smoke that uses the real OAuth provider and real
      Supabase-backed Steel tools.
- [x] Verify `steel.agent_rules` is loaded from DB before provider generation.
- [x] Verify `lookup_quote_rules` and `search_price_candidates` execute against
      cloud Supabase in the live run.
- [x] Verify a workbook patch with numeric summary total and unknown line
      subtotal is rejected by backend tool feedback, then corrected by the live
      model.
- [x] Run the live smoke and record evidence without exposing auth material.

Review evidence:

- Added manual smoke
  `STEEL_OPENAI_OAUTH_WORKBOOK_DB_SUBTOTAL_LOOP_TEST=true` in
  `packages/api/src/steel/ai/provider.catalog-oral.manual.spec.ts`.
- Preflight confirmed `.env` provides Steel Postgres and OpenAI OAuth settings,
  `$HOME/.codex/auth.json` exists, cloud Supabase is reachable, reviewed
  `steel.agent_rules=4`, reviewed `steel.quote_rules=9`, active
  `steel.price_items=27024`, and `c_type` quote rules are present.
- The live smoke captures the first provider prompt and asserts it contains the
  DB-loaded Agent Prompt text `你是「鋼鐵公司小助手」`, DB-loaded workbook rule text
  `你是「鋼鐵報價 Workbook 填寫代理」`, workbook structure context, and
  `lookup_quote_rules`.
- The live smoke executes DB-backed `lookup_quote_rules` before
  `search_price_candidates`, verifies the quote-rule result includes unified
  `rules`, and verifies the returned rule context matches `C 型鋼` / `c_type`.
- The live model generated an initial `patch_quote_workbook` with line subtotal
  `未確認` and summary total `999`; backend returned subtotal loop feedback, then
  the live model sent a corrected patch accepted by backend.
- Final accepted workbook patch asserted `quote_details.line_1.subtotal` and
  `summary_total_amount` match within the 643-644 expected range for
  `26.8 * 24 = 643.2`.
- Live command passed:
  `cd packages/api && DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_OPENAI_OAUTH_WORKBOOK_DB_SUBTOTAL_LOOP_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/ai/provider.catalog-oral.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`
  passed 1 live test in `98.943 s` with 6 other manual cases skipped.
- Regression passed: `cd packages/api && npx jest
  src/steel/workbook/subtotals.spec.ts src/steel/ai/provider.spec.ts
  --runInBand` passed 37 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files, but
  exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Natural Calculation and Customer Rules Live Smoke

Goal: extend the OAuth/Codex live smoke coverage to prove the live model can
naturally calculate workbook subtotals without a forced bad patch, then prove
`search_customers` injects `customer_rules` into the model loop for
customer-specific quoting behavior.

- [x] Add a natural workbook calculation live smoke that does not force an
      incorrect first patch.
- [x] Verify the first `patch_quote_workbook` call naturally sets line subtotal
      and summary total from DB price evidence.
- [x] Add a customer-rules live smoke for `search_customers`.
- [x] Verify `search_customers` returns the `龍頂蓋廠房` customer rule and the
      next provider prompt contains that rule.
- [x] Verify the customer-specific H 型鋼 cutting rule affects the live answer.

Review evidence:

- Added `STEEL_OPENAI_OAUTH_WORKBOOK_NATURAL_CALC_TEST=true` in
  `packages/api/src/steel/ai/provider.catalog-oral.manual.spec.ts`.
  The smoke does not force a bad patch; it derives the expected subtotal from
  the actual `search_price_candidates` result, then asserts the first generated
  `patch_quote_workbook` call has matching `quoteLines[0].subtotal` and
  `summary.totalAmount`.
- Natural calculation live command passed:
  `cd packages/api && DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_OPENAI_OAUTH_WORKBOOK_NATURAL_CALC_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/ai/provider.catalog-oral.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`
  passed 1 live test in `98.974 s` with 8 other manual cases skipped.
- The first natural calculation run showed the live model's first workbook patch
  already had `subtotal=643.2` and `summary.totalAmount=643.2`; the original
  assertion was narrowed because other non-price fields correctly contained
  `未確認` for missing customer details.
- Added `STEEL_OPENAI_OAUTH_CUSTOMER_RULES_TEST=true` in
  `packages/api/src/steel/ai/provider.catalog-oral.manual.spec.ts`. The smoke
  asserts `search_customers` returns unified `rules`, includes
  `customer_2269_h_beam_cutting_no_charge`, injects that prompt into the next
  provider round, and uses `customerTierId=1` for subsequent price lookup.
- Customer-rules live command passed:
  `cd packages/api && DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_OPENAI_OAUTH_CUSTOMER_RULES_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/ai/provider.catalog-oral.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`
  passed 1 live test in `55.252 s` with 8 other manual cases skipped.
- Updated `tasks/v8.3/phase-3-quote-workbook-mvp.md` with OAUTH-06 natural
  workbook calculation, OAUTH-07 customer-specific rules injection, and the
  manual command pattern for these OAuth smoke flags.
- Manual spec default gate passed without live flags:
  `cd packages/api && node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/ai/provider.catalog-oral.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`
  skipped all 9 manual cases.
- Regression passed: `cd packages/api && npx jest
  src/steel/workbook/subtotals.spec.ts src/steel/ai/provider.spec.ts
  src/steel/tools/execute.spec.ts --runInBand` passed 65 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files, but
  exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Rule Prompt Seed Data

Goal: seed reviewed Traditional Chinese rule prompts into the cloud Supabase
Steel rule tables so tools can return database-backed guidance for agent flow,
catalog/product-name inference, quote/calculation rules, and customer-specific
specs. This is data-only; no Steel schema shape changes are expected.

- [x] Confirm cloud lookup associations for catalog families, formulas,
      customer tiers, and the customer-specific rule target.
- [x] Create a repeatable migration for Traditional Chinese rule prompt seeds.
- [x] Apply the seed to cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- [x] Verify current rule rows and record categorized report evidence.
- [x] Replace the runtime Agent Prompt with the reviewed
      `steel.agent_rules` row and fail fast when the database rule cannot be
      loaded. Do not use a hard-coded Agent Prompt fallback.
- [ ] Apply the full reviewed Agent Prompt seed to cloud Supabase once
      `STEEL_POSTGRES_URL` pooler connectivity is available.

Review evidence:

- `npx supabase migration new steel_rule_prompt_seeds` failed on this
  darwin-arm64 host because the npm package could not find a matching CLI
  binary; fallback `supabase migration new steel_rule_prompt_seeds` succeeded
  with installed CLI `2.103.0`.
- Added data migration
  `supabase/migration/20260608103730_steel_rule_prompt_seeds.sql` with
  idempotent Traditional Chinese seed rules for `steel.agent_rules`,
  `steel.catalog_family_rules`, `steel.quote_rules`, and
  `steel.customer_rules`.
- Applied the seed to cloud Supabase through `.env` `STEEL_POSTGRES_URL`;
  active/reviewed counts are `agent_rules=4`, `catalog_family_rules=4`,
  `quote_rules=8`, and `customer_rules=1`.
- Re-ran the same migration against cloud Supabase; counts stayed unchanged,
  proving the seed is idempotent and does not duplicate rows.
- Association smoke queries matched the intended lookup filters:
  `agent_sections=3`, `lookup_catalog_families:c_type=1`,
  `lookup_quote_rules:c_type/material/C=3`, and
  `search_customers:2269/h_beam/cutting=1`.
- Started Agent Prompt DB-runtime conversion: `steelRuntimePolicy` now must load
  reviewed `steel.agent_rules` before calling the provider; no DB rows or DB
  errors should fail the request instead of falling back to code prompt text.
- Confirmed `docs/reference/instruction.txt` already carries the reviewed Agent
  Prompt version, and updated
  `supabase/migration/20260608103730_steel_rule_prompt_seeds.sql` so
  `steel-default-agent-instruction@1` seeds that full prompt with
  `tool_policy.availableTools` / `preferredOrder`, not `requiredTools`.
- Focused RED/GREEN evidence: `cd packages/api && npx jest
  src/steel/ai/provider.spec.ts --runInBand -t "agent_rules|AI-led Steel
  runtime policy"` first failed because provider did not query
  `steel.agent_rules`, then passed after DB-backed loading and fail-fast
  behavior were implemented.
- Full provider spec passed: `cd packages/api && npx jest
  src/steel/ai/provider.spec.ts --runInBand` passed 28 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files, but
  exits `0`.
- Hygiene passed: `git diff --check`.
- Cloud DB apply is currently blocked: repeated TCP checks to
  `aws-1-us-east-1.pooler.supabase.com:6543` timed out, and this repo has no
  alternate Steel/Supabase DB URL key besides `STEEL_POSTGRES_URL`.

## Active: Steel Tool Rule Response Unification

Goal: implement the approved Tool output slice so all rule-bearing Steel lookup
tools return a unified `rules: []` array. The array may contain multiple rule
objects scoped to customer, catalog family, product/name, or company-level
context. AI still owns selection and calculation; backend only returns bounded
reviewed rule prompts/options.

- [x] Add RED tests requiring `lookup_catalog_families`, `lookup_quote_rules`,
      and `search_customers` to return `rules` arrays.
- [x] Add Supabase schema/migration support for storing future Admin-managed
      similar product-name inference rules, catalog/category rules, and
      customer-specific rules; implement read/association logic only, not Admin
      UI.
- [x] Define a provider-safe rule object shape with `ruleType`, `scope`,
      `prompt`, priority/confidence, matched facets, and source refs.
- [x] Map catalog-family inference guidance, instruction packets, quote
      defaults, and customer-specific defaults into the unified `rules` array
      while preserving existing legacy fields for compatibility.
- [ ] Verify focused Steel tool tests and diff hygiene. Do not run Prettier
      during this slice.

Review evidence:

- Cloud Supabase schema updated through `.env` `STEEL_POSTGRES_URL` with
  `supabase/migration/20260608173719_steel_tool_rule_response_support.sql`.
- Verified cloud `steel` schema now has `agent_rules`,
  `catalog_family_rules`, `quote_rules`, and `customer_rules`; no
  `workbook_rules` table exists.
- Verified old rejected draft surfaces are absent in cloud:
  `steel.catalog_families.inference_rules = false` and
  `steel.quote_defaults.product_name = false`.
- Verified cloud table comments encode the intended ownership:
  `agent_rules` for process/default Agent Instruction/workbook output flow,
  `catalog_family_rules` for product-name inference,
  `quote_rules` for category/order-format/calculation/price rules, and
  `customer_rules` for customer-specific specs.
- Fresh cloud read probe confirmed only these rule tables exist from this slice:
  `agent_rules`, `catalog_family_rules`, `customer_rules`, and `quote_rules`;
  `workbook_rules` is absent and rejected legacy columns remain absent.
- Cloud `supabase_migrations` schema does not exist on this project, so no
  Supabase CLI repair record was written; schema was applied directly through
  the cloud Postgres URL.
- Implemented DB-backed rule repositories and unified tool outputs:
  `lookup_catalog_families` returns `catalog_family_rules` plus fallback
  catalog-family inference prompts, `lookup_quote_rules` returns stored
  `quote_rules` plus instruction/default rule objects, and `search_customers`
  returns `customer_rules`.
- Updated `CONTEXT.md` with rule purposes, database formats, AI tool retrieval
  paths, and Codex pre-Admin-UI update association logic.
- Focused tests passed:
  `cd packages/api && npx jest src/steel/repositories/families.spec.ts
  src/steel/repositories/defaults.spec.ts src/steel/repositories/rules.spec.ts
  src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts --runInBand`.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in app/endpoint/cache/share files, but
  exits `0`, and no warning remains in the new Steel rule repository code.
- Hygiene passed: `git diff --check`.

## Active: Steel Subtotal Validation Docs Cleanup

Goal: finish the architecture-doc rebaseline after removing the hidden
code-evidence gate. AI on the fixed OAuth/Codex path owns quote arithmetic and
may use provider-side code capability internally, but backend acceptance should
validate source/rule scope, workbook patch shape, and subtotal/summary
consistency instead of requiring disclosed Code Interpreter evidence.

- [x] Remove remaining runtime acceptance wording that requires code/Python or
      Code Interpreter evidence before confirmed workbook totals.
- [x] Replace backend calculator / calculation-state wording with AI calculation
      prompt/context plus backend subtotal validation.
- [x] Sync `tasks/v8.3/phase-2-data-tools.md` so v8.3 can resume from the same
      subtotal-consistency boundary.
- [x] Run stale grep and diff hygiene checks.

Review evidence:

- Updated `tasks/steel-data-rules-architecture` README, schema/model, tool
  calling, checkpoints, material-rule, source-inventory, and scenario docs so AI
  owns calculation on OAuth/Codex and backend validates source/rule scope,
  workbook patches, and subtotal/summary consistency.
- Updated `tasks/v8.3/phase-2-data-tools.md` to replace stock/calculator engine
  implementation milestones with AI calculation context and workbook subtotal
  validator tasks.
- Removed merged legacy tool names from the runtime `steelToolArgsSchemas` key
  set while preserving internal merged-rule/default schemas for
  `lookup_quote_rules`.
- Updated focused tool/provider specs and manual smoke expectations so
  `lookup_defaults` is not an optional runtime call.
- Stale gate grep passed: no old code-evidence/calculator runtime terms remain
  in the active data-rules/v8.3 docs and focused Steel tool/provider code.
- Focused tests passed:
  `cd packages/api && npx jest src/steel/tools/registry.spec.ts
  src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts --runInBand`.
- Manual smoke spec parse/skip check passed:
  `cd packages/api && npx jest --runTestsByPath
  src/steel/ai/provider.catalog-oral.manual.spec.ts
  --testPathIgnorePatterns='/node_modules/' --runInBand` skipped 6 env-gated
  live smokes.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/custom endpoint/redis/share
  files, but exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Data-Rules Merged Rule Tool Docs Cleanup

Goal: finish the data-rules architecture package cleanup so runtime docs no
longer expose `lookup_instructions` or `lookup_defaults` as AI-callable MVP
tools. The current runtime surface is the merged `lookup_quote_rules`
contract, where `lookup_quote_rules = lookup_instructions + lookup_defaults`.

- [x] Remove `lookup_instructions` / `lookup_defaults` from
      `tasks/steel-data-rules-architecture` runtime tool lists, scenarios,
      checkpoints, and Agent/Instruction Packet text.
- [x] Update the corresponding `tasks/v8.3/phase-2-data-tools.md` references so
      v8.3 can point back to the same merged lookup contract.
- [x] Run stale grep proving the old names only remain as historical/internal
      composition terms, not runtime tools.

Review evidence:

- Updated `agent-instructions.md`, `instruction-packets.md`,
  `phase-3-material-rules.md`, `phase-4-tool-calling.md`,
  `phase-4a-quote-defaults-architecture.md`,
  `phase-4b-rule-proposal-backend.md`, `phase-6-verification.md`,
  `ai-rule-selection-scenarios.md`, and `README.md` so AI-callable runtime docs
  expose merged `lookup_quote_rules` instead of separate `lookup_instructions`
  / `lookup_defaults`.
- Updated `tasks/v8.3/phase-2-data-tools.md` to the same Allowed MVP runtime
  tools: `lookup_quote_rules`, `search_customers`, `search_price_candidates`,
  and `lookup_formula`.
- Stale grep passed: no `Call lookup_instructions`, `Call lookup_defaults`,
  `remains callable`, `compatibility tool`, or Allowed-list legacy-tool matches
  remain in `tasks/steel-data-rules-architecture` or
  `tasks/v8.3/phase-2-data-tools.md`.
- Remaining `lookup_instructions` / `lookup_defaults` mentions are only the
  explicit composition contract `lookup_quote_rules = lookup_instructions +
  lookup_defaults` or internal facet wording.
- Hygiene passed: `git diff --check`.

## Active: Steel AI Subtotal Validation Boundary Rebaseline

Goal: supersede the older backend-canonical calculation and code-evidence gate
design. Steel quote numbers should be calculated by AI on the fixed
OAuth/Codex path, while backend provides reviewed rules/source rows, prompt
context, workbook projection validation, and subtotal/summary consistency checks
instead of trying to prove hosted Code Interpreter execution.

- [x] Update `tasks/steel-data-rules-architecture` docs so they no longer plan
      backend deterministic quote calculators, `quote_calculation_state`, or
      `quote_calculation_item_audits` as required Steel runtime surfaces.
- [x] Update provider/workbook prompt contract so AI calculates quote numbers on
      the OAuth/Codex path and backend validates workbook totals by subtotal
      consistency, not hidden provider-tool disclosure.
- [x] Remove `openai.code_interpreter` enablement, evidence parser, fallback,
      response `calculationEvidence`, and code-evidence loop guard.
- [x] Add provider loop guard: when summary total / confirmed amount disagrees
      with the sum of line `subtotal` values, reject that patch for the round
      and require AI to emit corrected workbook totals.
- [x] Run a live `/steel/oauth-chat` provider-path smoke with real `gpt-5.5`
      and record whether subtotal consistency is maintained on the fixed
      OAuth/Codex path. This smoke used the same OAuth adapter as the route,
      with HTTP/JWT route auth bypassed.
- [x] Remove or quarantine backend pricing decision modules such as
      `packages/api/src/steel/pricing/decision.ts` if no current runtime path
      still needs them for non-calculation validation.
- [x] Verify with grep-focused stale-contract checks and focused provider/tool
      tests before deleting any existing tests or schema plans.

Review evidence:

- Focused provider RED evidence: `cd packages/api && npx jest
  src/steel/ai/provider.spec.ts --runInBand` initially failed because
  `openai.code_interpreter` was still registered and confirmed workbook totals
  still required code evidence.
- Focused provider GREEN evidence: `cd packages/api && npx jest
  src/steel/ai/provider.spec.ts --runInBand` passed 26 tests, including no
  registered provider tools, subtotal-consistent totals accepted, and
  subtotal-mismatched summary totals looped for correction.
- Shared contract GREEN evidence: `cd packages/data-provider && npx jest
  src/steel/ai.spec.ts --runInBand` passed 11 tests with no
  `calculationEvidence` response field.
- Focused Steel suite GREEN evidence: `cd packages/api && npx jest
  src/steel/ai/provider.spec.ts src/steel/models.spec.ts
  src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts --runInBand`
  passed 4 suites / 58 tests.
- Build evidence: `npm run build:data-provider` passed, and
  `npm --workspace packages/api run build` created `dist`; Rollup still reports
  existing unrelated TS warnings in agents/custom endpoint/redis/share files.
- Live OAuth/Codex smoke evidence: real `gpt-5.5` returned
  `openai_oauth_responses`, response id
  `resp_0240dd66d2517f58016a267b8bbc04819187281217e02e7816`,
  workbook subtotal `624`, summary total `624`, confirmed amount `624`, warning
  count `0`, and no `calculationEvidence` field.
- Hygiene evidence: `git diff --check` passed. Stale-contract grep found no
  runtime evidence parser/gate symbols and no `code_interpreter: not_applicable`
  in Steel capability maps.

## Active: Steel Merged Rule Tool Definition Cleanup

Goal: remove the already-merged AI-callable Steel tool definitions for
`lookup_instructions` and `lookup_defaults`. The runtime should expose
`lookup_quote_rules` as the single merged rule/default lookup surface, with
`lookup_quote_rules = lookup_instructions + lookup_defaults`.

- [x] Add RED coverage that `getSteelToolDefinitions()` no longer exposes
      `lookup_instructions` or `lookup_defaults`, and that those names are
      rejected as unknown executable AI tools.
- [x] Update provider prompt/reminder copy so AI is told to call
      `lookup_quote_rules` before category-dependent lookups, without legacy
      `lookup_instructions` / `lookup_defaults` fallbacks.
- [x] Remove the merged tool definitions from the Steel tool registry while
      preserving `lookup_quote_rules`, `lookup_catalog_families`,
      `search_customers`, `search_price_candidates`, and `lookup_formula`.
- [x] Update focused provider/tool tests and stale docs references that still
      describe the old merged tools as AI-callable runtime options.
- [x] Run focused Steel tool/provider tests, `packages/api` build, formatting or
      diff hygiene checks, and record review evidence here.

Review evidence:

- RED evidence: `cd packages/api && npx jest src/steel/tools/registry.spec.ts
src/steel/tools/execute.spec.ts --runInBand` initially failed because the
  registry still exposed `lookup_instructions` / `lookup_defaults` and executor
  still accepted `lookup_instructions`.
- GREEN focused evidence: `cd packages/api && npx jest
src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts
src/steel/ai/provider.spec.ts --runInBand` passed 3 suites / 53 tests.
- Build evidence: `npm --workspace packages/api run build` completed and
  created `dist`; Rollup still reports existing unrelated TypeScript warnings in
  agents/custom endpoint/redis/share files.
- Hygiene evidence: `npx prettier --check ...` passed on touched files and
  `git diff --check` passed.

## Active: Steel Workbook First-Load And System Model Fix

Goal: Fix the `/steel/oauth-chat` workbook regressions reported by the user:
`系統訂單`.`型號` should carry the adopted product-price model, the initial workbook
load should not show latest-update cell highlights, and a newly loaded workbook
should display `v1` instead of `v2`.

- [x] Add RED regression coverage for `patch_quote_workbook` carrying the
      product-price model into `系統訂單`.`型號`.
- [x] Update the workbook prompt/tool instructions so AI knows
      `systemOrder.modelCode` / `系統訂單`.`型號` must come from the adopted product
      price row model.
- [x] Add RED API/route coverage that the first workbook data load shows version
      `v1` and does not mark cells as the latest update.
- [x] Implement the narrow semantic schema/projection and first-load state fix.
- [x] Update lessons for the workbook correction pattern.
- [x] Run focused API/client tests, build changed packages, restart dev server,
      and record review evidence here.

Review evidence:

- RED regressions first failed because semantic workbook projection did not emit
  `system_order.model_code`, and the workbook service incremented the first data
  patch to `v2` with highlight paths.
- Semantic workbook projection now accepts `systemOrder.modelCode` and projects
  it to `系統訂單`.`型號` / `model_code`; provider prompt explicitly tells AI to
  source that value from the adopted product-price row `型號`.
- Workbook service now treats the first accepted data patch into an empty
  workbook as initial data load: the workbook remains `v1`, `changedPaths` is
  empty, and `changedFieldSummary` is preserved for concise chat summaries.
- Focused API verification passed:
  `packages/api` `semantic.spec.ts`, `service.spec.ts`, `provider.spec.ts`, and
  `handlers.spec.ts` passed 57 tests.
- Focused UI verification passed:
  `client/src/routes/SteelOAuthChat.spec.tsx` passed 12 tests.
- `npm --workspace packages/api run build` completed successfully with existing
  non-Steel Rollup TypeScript warnings.
- Prettier check and `git diff --check` passed. Backend was restarted; both
  `http://localhost:3080/api/config` and
  `http://localhost:3090/steel/oauth-chat` returned `HTTP/1.1 200 OK`.

## Steel OAuth Stream Provider Error Diagnosis

Goal: Fix the `/steel/oauth-chat` failure state where the Thinking tab only
shows generic `OpenAI OAuth provider request failed.` after successful Steel
lookups. The stream should preserve a sanitized provider error detail so we can
distinguish context-length, schema, auth, rate-limit, and transient provider
failures.

- [x] Gather evidence from the user-visible stream sequence: provider failed
      after `lookup_formula completed`, so Supabase lookup tools had succeeded.
- [x] Reproduce a clean direct provider flow with workbook tools and C 型鋼
      lookup; it succeeded with a workbook patch, so the failure is tied to the
      actual UI payload/session state or a transient provider response, not a
      stable schema or database failure.
- [x] Add RED handler coverage for sanitized unknown provider errors.
- [x] Implement provider-error summary sanitization for chat and stream routes.
- [x] Verify focused handler/provider tests, API build, direct C 型鋼 provider
      smoke, and backend readiness.

Review evidence:

- RED handler regression first failed because stream errors still returned only
  `OpenAI OAuth provider request failed.` for an unknown provider exception.
- Handler error summary now preserves sanitized unknown provider details while
  keeping existing auth, timeout, and Steel tool error categories.
- Clean direct provider smoke with workbook tools returned `ok`, proving
  `patch_quote_workbook` schema is accepted when exposed.
- Full direct C 型鋼 provider flow with real OAuth and cloud Steel tools
  succeeded twice after the failure report, including workbook patch operations
  and a `643` subtotal. This points the user-visible failure toward the
  specific UI session payload/length or transient provider response rather than
  a stable schema/database failure.
- Verification passed:
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/workbook/semantic.spec.ts --runInBand`,
  `npm --workspace packages/api run build` with existing non-Steel Rollup
  TypeScript warnings, and direct C 型鋼 OAuth smoke with workbook patch.
- Backend was restarted after the build; `http://localhost:3080/api/config` and
  `http://localhost:3090/steel/oauth-chat` both return `HTTP/1.1 200 OK`.

## Steel Semantic Workbook Patch

Goal: Replace large AI-authored cell-by-cell quote workbook patches with a
compact semantic quote patch tool. AI still decides customer/material/price/rule
facts from reviewed tool results, while backend projection keeps all workbook
sheets synchronized and supports cascade updates when one quote value changes.

- [x] Write the implementation plan under
      `docs/plans/2026-06-05-steel-semantic-workbook-patch.md`.
- [x] Add RED projection tests that one semantic quote line fills the required
      workbook sheets and that a repriced line re-emits all affected cells.
- [x] Add RED provider tests that `patch_quote_workbook` is AI-callable,
      projected into existing `set_cell` workbook patch operations, and avoids
      incomplete multi-call workbook patch loops.
- [x] Implement the semantic workbook projection helper and provider tool
      parsing/tool-result flow.
- [x] Verify focused workbook/provider tests, API build, diff hygiene, and
      restart backend/frontend readiness for manual `/steel/oauth-chat` testing.

Review evidence:

- RED `semantic.spec.ts` first failed because `./semantic` did not exist; GREEN
  helper tests now prove one semantic C 型鋼 quote line fills required workbook
  sheets and a repriced same-`lineId` quote re-emits affected cells across
  `報價明細`, `系統訂單`, `總結`, `價格來源`, and `給客戶用`.
- RED provider test first failed because `patch_quote_workbook` was not parsed
  as a workbook output tool; GREEN provider tests now expose only
  `patch_quote_workbook` to AI, project semantic quote data into existing
  `set_cell` operations internally, and return a complete workbook output tool
  result before the final assistant text.
- Documentation now records that all AI workbook updates should use semantic
  `patch_quote_workbook`; direct workbook operations are backend projection
  internals, not an AI-callable tool.
- Verification passed:
  `cd packages/api && npx jest src/steel/workbook/semantic.spec.ts src/steel/ai/provider.spec.ts --runInBand`,
  `npm --workspace packages/api run build` with existing non-Steel Rollup
  TypeScript warnings, touched-file Prettier check, and `git diff --check`.
- Backend watcher was restarted after the build. Readiness evidence:
  `http://localhost:3080/api/config` returned `HTTP/1.1 200 OK` and
  `http://localhost:3090/steel/oauth-chat` returned `HTTP/1.1 200 OK`.

## Steel Catalog Price Tool Prompt And Semantic Workbook Output

Goal: Make the runtime prompt teach the model exactly how to call
`search_price_candidates` after selecting catalog family keys, with
`productNames` as the only AI-callable reviewed product-name candidate field.
Also prevent workbook completion from pushing the model into hand-written
cell-operation patches by making `patch_quote_workbook` the only AI-callable
workbook output tool.

- [x] Add RED prompt/schema coverage that the first system prompt, retry
      reminder, and tool schema teach generic catalog lookup semantics:
      selected keys go in `catalogFamilies`, oral family/category labels do not
      go in `productNames`, and inferred reviewed product-name candidates use
      `productNames` or `candidateQueries.productNames`. The public tool input
      rejects old `productName`; repository result/source rows may still return
      `productName`.
- [x] Add RED workbook prompt/reminder coverage that AI-visible workbook output
      uses only `patch_quote_workbook`, including follow-up and incomplete
      semantic patch reminders.
- [x] Update provider runtime/workbook instructions, stream status, and
      incomplete-patch tool result text.
- [x] Remove arbitrary workbook size caps from semantic quote lines and
      internally projected workbook operations.
- [x] Update docs/lessons for the prompt and workbook-output corrections.
- [x] Verify focused provider/handler/client tests, API build, formatting, diff checks, and
      restart backend for manual testing.

Review evidence for `productNames` cleanup:

- RED focused registry/normalization tests failed while fixtures still sent old
  `productName`; GREEN focused tests passed after the public
  `search_price_candidates` schema accepted only `productNames` and
  `candidateQueries.productNames`.
- Focused verification passed after formatter: `provider.spec.ts`,
  `execute.spec.ts`, `registry.spec.ts`, and `search.spec.ts` all passed
  57 tests.
- `npm --workspace packages/api run build` completed successfully with the
  existing non-Steel Rollup TypeScript warnings.
- Built `dist` smoke accepted `productNames` and rejected old `productName`;
  direct cloud Supabase `executeSteelTool(search_price_candidates)` returned
  C 型鋼 same-spec 錏/白鐵 candidates from `productNames`.
- Cloud `steel.instruction_packets` C 型鋼 row was updated so runtime
  `lookup_quote_rules` no longer returns the old `productName filter` or
  mutual-exclusion wording.
- `git diff --check` passed.
- User correction applied: `patch_workbook` is no longer AI-callable. Provider
  exposes only `patch_quote_workbook`; semantic tool calls are projected
  internally to workbook `set_cell` operations.
- User correction applied: workbook output must not have arbitrary size caps.
  Removed `quoteLines` max limits and the internal 100-operation cap for
  provider/workbook patch schemas.
- Focused no-size-limit verification passed: `packages/api` semantic/provider/
  handler tests pass 49 tests, including a `patch_quote_workbook` projection
  that produces more than 100 workbook `set_cell` operations.
- Shared contract verification passed: `packages/data-provider` AI/workbook
  schema tests pass 17 tests, including 120-operation provider proposals and
  workbook patch requests.
- Focused verification passed after the semantic-only workbook change:
  `provider.spec.ts`, `handlers.spec.ts`, `semantic.spec.ts`,
  `packages/data-provider/src/steel/ai.spec.ts`, and
  `client/src/routes/SteelOAuthChat.spec.tsx`.
- `npm --workspace packages/api run build` completed successfully with existing
  non-Steel Rollup TypeScript warnings. Backend was restarted; both
  `http://localhost:3080/api/config` and
  `http://localhost:3090/steel/oauth-chat` returned `HTTP/1.1 200 OK`.

- [x] Active runtime slice: stabilize `/steel/oauth-chat` cloud Supabase
      Postgres tool lookup. Steel runtime must connect through `.env`
      `STEEL_POSTGRES_URL` to cloud Supabase, reuse the runtime pool for
      streaming tool execution, and surface fatal DB/tool errors once instead
      of retrying the same failed lookup through the model loop.

Review evidence:

- Direct cloud `pg` ping against `.env` `STEEL_POSTGRES_URL` succeeded through
  Supavisor 5432 and 6543 with `steel_schema_exists=true`.
- Earlier `/steel/oauth-chat` live smoke reached true `openai_oauth_responses`
  and called `lookup_quote_rules`, but `executeSteelTool` returned
  `repository_error: Connection terminated due to connection timeout`; this
  showed the model/tool routing was correct and the runtime blocker was the
  cloud Postgres connection path.
- Updated Steel Postgres runtime pool defaults to use a longer cloud-friendly
  connection timeout and TCP keepalive, and changed the streaming tool executor
  to reuse the runtime cloud Postgres pool instead of creating a new pool per
  request.
- Focused verification passed: `postgres.spec.ts`, `provider.spec.ts`, and
  `handlers.spec.ts` all passed; `npm run build:api` rebuilt `packages/api/dist`
  with existing unrelated Rollup TypeScript warnings.
- Direct runtime tool lookup through cloud Supabase succeeded:
  `lookup_quote_rules` returned reviewed instruction/default data and
  `search_price_candidates` returned 4 C 型鋼 price candidates for
  `錏輕型鋼 100x2.3`.
- `/steel/oauth-chat` live smoke succeeded through the stream endpoint:
  status order was `Request validated` -> `Waiting for provider` ->
  `lookup_quote_rules started/completed` ->
  `search_price_candidates started/completed`, and the AI returned
  C 型鋼 6M 小計 `643.2 元/支`. Semantic workbook patch enforcement remained a
  separate AI behavior follow-up at that point.

## Steel Supabase SSL Runtime Fix

Goal: Fix `/steel/oauth-chat` Steel tool failures where Supavisor Postgres
lookup returns `self-signed certificate in certificate chain` when
`STEEL_POSTGRES_URL` omits libpq-compatible SSL query parameters.

- [x] Reproduce the error with a direct `pg` probe using the current `.env`
      `STEEL_POSTGRES_URL`.
- [x] Add RED coverage for automatic Steel Postgres URL SSL normalization.
- [x] Normalize Steel Postgres URLs so absent SSL params use
      `sslmode=require&uselibpqcompat=true` without printing or changing
      secrets.
- [x] Update lessons/docs for the runtime SSL behavior.
- [x] Verify focused Postgres tests, API build, direct cloud query, formatting,
      diff checks, and restart backend for manual testing.

Review:

- Direct sanitized `pg` probe reproduced the user-facing tool failure:
  current `.env` pointed at Supavisor `6543` without SSL query parameters, and
  `pg` returned `self-signed certificate in certificate chain`.
- Steel Postgres helper now normalizes missing SSL parameters to
  `sslmode=require&uselibpqcompat=true`. Explicit URLs, including
  CA-backed `sslmode=verify-full`, are preserved.
- Verification passed: RED `postgres.spec.ts` failed before the helper update;
  GREEN `postgres.spec.ts` passed 6 tests; `packages/api` build passed with
  existing non-Steel Rollup warnings; built helper direct cloud query returned
  `steelSchemaExists=true`; direct `lookup_catalog_families` tool returned
  `c_type`; Prettier and `git diff --check` passed.
- Backend was rebuilt and nodemon restarted. `http://localhost:3080/api/config`
  and `http://localhost:3090/steel/oauth-chat` both return 200.

## Steel Workbook Fill Instruction From 訂單參考

Goal: Teach the OpenAI Responses workbook patch agent how to organize tool
results from customer lookup, product price lookup, formula lookup, and
calculation results into the seven `訂單參考_轉檔.xlsx` workbook sheets without
inventing missing price/customer/weight/formula facts.

- [x] Write the implementation plan under `docs/plans/`.
- [x] Add RED provider prompt coverage for the workbook fill contract:
      price-before-weight, no zero for unknown, system/customer sheet separation,
      calculation-result precedence, summary split totals, and customer-visible
      field restrictions.
- [x] Update provider workbook patch instructions with the compact workbook fill
      contract.
- [x] Update docs and lessons so future agents keep the same workbook-fill
      behavior.
- [x] Run focused provider tests, API build, formatting, and diff checks.

Review:

- RED verification first failed because the workbook patch system prompt did not
  include the `價格先於重量`, no-zero unknown, sheet separation, summary split,
  customer-visible restriction, or `calculation_results` precedence contract.
- Provider workbook instructions now include the compact
  `docs/reference/訂單參考_轉檔.xlsx` fill contract, while backend behavior stays
  validation/reminder-only and does not synthesize companion workbook rows.
- Documentation and lessons now record that AI maps reviewed tool results into
  workbook sheets, writes unknowns as `未確認` instead of `0`, and keeps
  `給客戶用` free of internal source/tier/candidate/audit data.
- Verification passed:
  `provider.spec.ts` targeted RED/GREEN test, full `provider.spec.ts` 21 tests,
  `npm --workspace packages/api run build` with existing non-Steel Rollup
  warnings, touched-file Prettier check, and `git diff --check`.

## Steel Workbook Per-Turn Completion

Goal: Every `/steel/oauth-chat` turn that updates workbook data should check
whether the new information has been propagated to all relevant workbook sheets
and cells. The backend must not hard-fill ERP/customer/summary rows; it should
return missing sheet/cell guidance through the `patch_quote_workbook` tool
result so the AI can decide which values are derivable and which gaps belong in
`人工複核` / `判讀備註`.

- [x] Reproduce the bug with a provider regression where AI updates only
      `報價明細` on a customer/tier repricing follow-up and leaves
      `系統訂單`, `總結`, `人工複核`, and `給客戶用` blank.
- [x] Generalize workbook completion from "required sheets touched" to
      per-turn "required sheet and cell coverage" for workbook patches.
- [x] Keep completion AI-led: tool results identify missing cells and
      instructions, but backend does not synthesize workbook cell values.
- [x] Update docs and lessons with the per-turn workbook completion rule.
- [x] Verify focused provider/handler tests, API build, and diff hygiene.

Review:

- Root cause: workbook completion only checked required sheet ids. A model could
  satisfy the gate by touching every sheet with sparse shell cells while leaving
  user-visible workbook content blank.
- Provider completion now returns both `missingSheetIds` and `missingCells` for
  every Steel runtime workbook patch turn. Incomplete semantic patches feed a
  `patch_quote_workbook` tool result back to the model and require another
  explicit AI patch before the final answer.
- The backend still does not synthesize companion workbook rows. It only reports
  missing sheet/cell targets and tells AI to patch derivable values or record
  unavailable evidence in `manual_review` / `interpretation_notes`.
- Documentation and lessons now record the per-turn minimum-cell coverage rule.
- Verification: RED provider regression first failed because sparse all-sheet
  patches were accepted without `missingCells`; GREEN verification passed
  `provider.spec.ts` 21 tests, `handlers.spec.ts` 22 tests,
  `npm --workspace packages/api run build` with existing non-Steel Rollup
  warnings, touched-file Prettier check, and `git diff --check`.

- [x] Active quote-runtime slice: make catalog-family selection AI-owned. Expose
      reviewed `steel.catalog_families` vocabulary/context to the AI so it can
      judge oral product wording and choose a stable `catalogFamilies` key;
      backend price tools should only validate/query explicit keys and must not
      contain a separate oral-alias matcher.

Review evidence:

- Updated plan
  `docs/plans/2026-06-04-steel-catalog-family-normalization.md` after the user
  corrected the boundary: AI decides oral wording -> key; code does not.
- Removed the started backend alias-matching repository/tests and restored
  `search_price_candidates` to query only explicit AI-provided
  `catalogFamilies`.
- Verification after correction: focused `packages/api` executor Jest passed
  15/15, touched-file Prettier check passed, code grep found no matcher
  implementation residue, and targeted `git diff --check` passed.
- Implementation direction for this slice: add a data-only
  `lookup_catalog_families` tool that returns reviewed vocabulary candidates and
  source refs for AI judgment; do not return a backend-selected or
  backend-resolved key.
- Implemented `lookup_catalog_families` as an AI-visible, data-only tool backed
  by `steel.catalog_families`; provider instructions now tell AI to call it for
  reviewed vocabulary candidates when catalog wording is unclear, then pass
  explicit `catalogFamilies` to price/default/formula tools.
- Verification after implementation: RED tests failed for missing repository,
  registry/executor tool exposure, and provider prompt/tool-list updates; GREEN
  focused tests passed; full `packages/api` Steel Jest passed 29 suites / 128
  tests; `npm run build:api` exited 0 with existing Rollup TypeScript warnings;
  live Supabase sample verified `a_pipe` and `h_beam` aliases; touched-file
  Prettier check, production-code residue grep, and targeted `git diff --check`
  passed.
- C 型鋼 live smoke: `lookup_catalog_families(searchText='C型鋼')` returned
  `c_type` with aliases `C型鋼`, `C鋼`, `C 型鋼`, `C型`, `輕型鋼`, and `型鋼`;
  `search_price_candidates` with AI-selected `catalogFamilies: ['c_type']` and
  derived `specKeyContains: '100x2.3'` returned 8 confirmed price candidates,
  including `白鐵輕型鋼 100*2.3(定尺-3元)` and `錏輕型鋼 100*2.3`; `lookup_formula`
  returned formula `C`.
- User correction captured: do not add a mocked AI response test to prove AI
  will generate `c_type + 100x2.3`; mocked provider tests only prove backend
  prompt/tool plumbing. AI behavior must be verified by live AI API smoke or
  reported as unverified.
- C 型鋼 prompt-rule update: added task-scoped instruction text telling AI not
  to use `productName: C型鋼` as a narrow price filter after selecting `c_type`;
  it should query by size/thickness fragments such as `100x2.3` and present
  白鐵/錏/黑鐵輕型鋼 options when material/surface is ambiguous. Also added
  `c_type.metadata.searchHints` in `steel.catalog_families`.
- Live AI API smoke after the task-scoped prompt rule still failed the desired
  behavior: real `gpt-5.5` selected `catalogFamilies: ['c_type']` but also
  sent `productName: C型鋼` / `productName: C型鋼 100x50x20 2.3t` and
  `specKeyContains: 100x50x20`, so reviewed lookup returned zero candidates.
  This confirmed the user correction: mocked AI response tests would not prove
  the C 型鋼 oral-input behavior.
- Follow-up guardrail: `search_price_candidates` now rejects
  `catalogFamilies: ['c_type']` searches that still use `C型鋼`/`C鋼` as a
  `productName` filter, provider runtime policy includes the C 型鋼
  `c_type + 100x2.3` strategy up front, and invalid-argument price lookup
  results no longer count as completed reviewed price lookup.
- Live AI API smoke after the guardrail passed the target behavior. Real
  `gpt-5.5` first sent the bad `productName: C型鋼` / full-section query and
  received `invalid_arguments`; the forced second tool call used
  `catalogFamilies: ['c_type']`, `productName: 錏輕型鋼`, and
  `specKeyContains: 100x2.3`. Real Supabase returned 4 reviewed
  `錏輕型鋼 100*2.3` price candidates for customer tiers 1-4
  (`26`, `26.8`, `25.5`, `25` TWD / 支).
- User correction captured: oral order flow is AI judges category/catalog key
  first, then `lookup_instructions`, then category-dependent tools such as
  `search_price_candidates`, `lookup_defaults`, or `lookup_formula`. Provider
  runtime now gates direct category-dependent lookups until
  `lookup_instructions` succeeds for the interpreted context.
- User correction captured: C 型鋼材質不明時，AI 可以先塞
  `productName: 錏輕型鋼` as the usual high-confidence provisional material,
  while still keeping the quote provisional and surfacing bounded alternatives
  such as 白鐵輕型鋼 / 黑鐵輕型鋼 when relevant.
- Added gated live AI behavior smoke
  `packages/api/src/steel/ai/provider.catalog-oral.manual.spec.ts`, enabled by
  catalog-specific env flags such as `STEEL_OPENAI_OAUTH_C_TYPE_ORAL_TEST=true`.
  Mocked provider unit tests remain
  limited to adapter/tool-loop contracts and should not be cited as evidence of
  AI judgment.
- Live OAuth C 型鋼 smoke passed with real `openai_oauth_responses` and real
  Supabase tools. Evidence: actual executed tool sequence included
  `lookup_instructions` before `search_price_candidates`; the price call
  derived `catalogFamilies: ['c_type']`, `productName: 錏輕型鋼`, and
  `100x2.3`, then returned a positive reviewed candidate.
- Follow-up deterministic fix from live smoke: when AI sends both
  `specKey: 100x2.3` and malformed `specKeyContains: 100 2.3`, normalization
  now prefers `100x2.3`; when AI sends a full-section `specKey` together with
  `specKeyContains`, price lookup uses the partial fragment instead of
  over-constraining SQL with an exact full-section spec.
- [x] Follow-up live-smoke slice: extend the same `lookup_instructions` first
      runtime proof beyond C 型鋼 to H 型鋼 and angle/角鐵 oral requests.
      Deterministic coverage must prove H 型鋼 expands `h-type-quote-core`
      instruction packets; gated OAuth smoke must prove real
      `openai_oauth_responses` calls `lookup_instructions` before positive
      `search_price_candidates` lookups for H 型鋼 and angle/角鐵.
- H 型鋼 deterministic coverage now asserts the returned `lookup_instructions`
  packet content includes常規米數 `6M/9M/10M/12M`, 非常規米數
  `7M/8M/11M/13M/14M/15M`, and 非常規米數 `+0.3 元/kg`, not just the packet
  slug. Follow-up user correction recorded that exact reviewed 非常規米數
  product-price rows in `產品價格.xlsx` already include the `+0.3/kg`
  adjustment, so AI must not add `+0.3/kg` again after finding those rows; the
  surcharge rule is only a provisional/default derivation when no exact reviewed
  non-standard length row exists.
- [x] Follow-up live-smoke slice: add real OAuth behavior checks for
      `亞L30x30` bounded-option quoting and H 型鋼 processing interpretation.
      The `亞L30x30` smoke must prove no exact canonical row is required for AI
      to provide a highest-confidence provisional reviewed candidate, list
      bounded alternatives, and accept a later user selection in a multi-turn
      follow-up. The H 型鋼 smoke must prove AI calls `lookup_instructions` before
      processing-dependent lookups for cutting, slotting, and holes, then uses
      reviewed defaults/rules instead of inventing processing prices.
- Live OAuth `亞L30x30` bounded-options smoke passed with real
  `openai_oauth_responses` and real Supabase tools. It ran a two-turn
  conversation: first response found the highest-confidence reviewed
  `錏成型角鐵30*2.5*6M` candidate at `194.3` TWD / 支 while keeping the quote
  provisional and asking for confirmation; follow-up user selection
  `錏成型角鐵30*2.5*6M，第1級價格` resolved to the selected reviewed candidate.
  The live follow-up exposed malformed AI `specKeyContains: 30 2.5 6M`;
  normalization now prefers structured `specKey: 30x2.5x6M` and searches the
  imported `30x2.5x6M` price-table fragment instead of `302.56m`.
- Live OAuth H 型鋼 processing smoke passed with real `openai_oauth_responses`
  and real Supabase tools. It verified `lookup_instructions` before processing
  lookups, reviewed H 型鋼 processing instruction/default rules, material
  `h_beam` price lookup, and reviewed processing price candidates including
  `開槽加工` / `KZZB10` and `沖孔加工` / `KZZB11`; the response kept cutting,
  slotting, and hole fees as provisional/confirmation-needed processing items.
  Runtime policy now tells AI that when instruction packets name processing
  price candidates or ERP item codes, it must call `search_price_candidates` for
  reviewed processing rows instead of quoting processing prices only from
  instruction packet text.
- Live OAuth H 型鋼 smoke passed with real `openai_oauth_responses` and real
  Supabase tools. The first executed tool was `lookup_instructions`; the
  returned instruction content included the H 型鋼米數/加價規則; the subsequent
  price lookup returned a positive reviewed `h_beam` candidate. A deterministic
  normalization regression now converts AI's `100x50x5/7` fragment to the
  imported price-table fragment `100x50x5_7`.
- Live OAuth angle smoke passed with real `openai_oauth_responses` and real
  Supabase tools after the angle instruction packet was updated to tell AI that
  reviewed rows such as `錏成型角鐵30*2.5*6M` require `30x2.5x6M` /
  `30x2.5` spec candidates in addition to equal-angle `30x30` candidates.
  `亞L30x30` remains an oral candidate/confirmation rule rather than a guaranteed
  positive exact price-row smoke fixture.

- [x] Active data/schema slice: replace the steel-only family vocabulary
      vocabulary surface with a generic `catalog_family` lookup key for
      `docs/reference/產品價格.xlsx`; import every product catalog family into
      Supabase, link every imported price row to a catalog family/category,
      remove old `materialFamilies` runtime input logic instead of keeping a
      compatibility alias, and update docs/tests so AI can query product catalog
      terms such as 鋼管, 配管, 壁板, 樹脂, 鋁窗, 擋水板, 鐵門, 棚架,
      方管連料, 伸縮大門, B管, A管, 尺, 紗網, 門花, P型管, 螺絲, 角輪,
      門鎖, I字鐵, 圓鐵, 圓條, 方鐵, 錏板, OT板, 黑板, and 鐵格板.

Review evidence:

- Created plan `docs/plans/2026-06-04-steel-catalog-family-import.md` and
  source-of-truth doc `docs/steel-catalog-family-data-contract.md`.
- Replaced runtime/search/default/rule-proposal paths with
  `catalogFamilies` / `catalogFamily` / `catalog_family`. Old
  `materialFamilies` and `materialFamily` request shapes are rejected by tests.
- Added migration `supabase/migration/20260604071700_steel_catalog_families.sql`
  and synchronized `supabase/schema.sql`. Cloud DB now has
  `steel.catalog_families`; no `steel.material_families` table and no
  `steel.*.material_family` columns remain.
- Updated the reference importer so every `產品價格.xlsx` row receives a
  `categoryCode` and non-empty `catalogFamily`; uncurated rows fall back to
  ERP-prefix keys such as `erp_ax`.
- Reapplied the importer to Supabase. Verification counts: 210 catalog
  families, 277 price categories, 2256 customers, 27024 price rows, 238 cutting
  rows, 31 formulas, and 29 quote defaults.
- Direct SQL verified `price_items` imported from `產品價格.xlsx` have zero null
  `catalog_family` rows and zero null `category_id` rows.
- Direct SQL sample checks passed: `GOB0004` -> `a_pipe`, `GOS0215` ->
  `piping`, `HSA12215` -> `aluminum_window`, `HSS0001` -> `iron_door`,
  `FTB0311` -> `screw`, `FFP00020` -> `corner_wheel`, `FFL0001` ->
  `door_lock`, `EZB070709` -> `i_beam`, `EQA0030` -> `round_bar`,
  `EDA0063` -> `square_bar`, `BNG008408` -> `galvanized_plate`,
  `BNB012408` -> `ot_plate`, `DNB160408` -> `black_plate`, and `ANB3410` ->
  `grating`.
- Corrected `telescopic_gate` mapping so the whole `AX` ERP prefix is not
  classified as 伸縮大門. Current DB counts: `telescopic_gate`=59,
  `screen_mesh`=31, `measuring_tool`=18, and fallback `erp_ax`=24.
- Documented that `龍頂鋼鐵手冊__文字版.docx` remains a secondary
  weight/spec/alias reference and must not override reviewed
  `產品價格.xlsx` product-price facts.
- Verification commands passed: focused API Jest for importer/repositories/
  tools/provider/rules/handlers, data-provider rule contract Jest,
  data-schemas Steel schema Jest, `packages/data-provider` build,
  `packages/data-schemas` build, `npm run build:api`, importer dry-run,
  importer apply, direct cloud SQL checks, Prettier for touched TS/JS/MD files,
  and `git diff --check`.
- [x] Active data slice: implement an executable Steel reference-data importer
      that reads `客戶資料.xlsx`, `產品價格.xlsx`, `切工價錢.xlsx`,
      `公式編號.xlsx`, and `H型鋼.txt`; writes reviewed/updateable facts and
      defaults into Supabase through `STEEL_POSTGRES_URL`; excludes
      `訂單參考.xlsx`, `系統訂單.xlsx`, and quote/order fixtures from formal DB
      fact imports; and proves the applied row counts with SQL verification.

Review evidence:

- Added importer plan `docs/plans/2026-06-04-steel-reference-data-importer.md`,
  parser module `packages/api/src/steel/importer/reference.ts`, executable CLI
  `packages/api/scripts/import-steel-reference-data.cjs`, and npm script
  `steel:import-reference-data`.
- Dry-run summary: 6 customer tiers, 2256 customers, 27024 tiered price rows,
  238 cutting-price rows, 31 formula rows, and 29 quote-default rows.
- Supabase apply initially rolled back because cloud schema was missing
  `steel.quote_defaults`; applied existing migration
  `supabase/migration/20260602035007_phase4a_quote_defaults.sql`, verified the
  table exists, then reran the import successfully.
- Applied Supabase verification counts matched dry-run: 2256 customers, 27024
  price rows, 238 cutting rows, 31 formulas, and 29 quote defaults.
- Direct SQL edge checks passed: `產品價格.xlsx` zero rows stay
  `value_state='unknown'` with `unit_price IS NULL`; formula `C` exists; H 型鋼
  default exists; `訂單參考.xlsx` and `系統訂單.xlsx` have zero imported
  `price_items` source refs.
- Verification commands run: focused importer Jest, dry-run CLI, apply CLI,
  direct SQL check, `npm run build:api`, Prettier, and targeted
  `git diff --check`.
- [x] Record the corrected scope boundary: Admin review UI paused only; other
      implementation work remains sequenced.
- [x] Active slice: reviewed fact price decisions return bounded user-choice
      options when exact reviewed facts are missing, zero-as-missing, or
      ambiguous; preview estimates may be marked provisional, but no final
      confirmed workbook total is produced before confirmation.
- [x] Correct the typo/incomplete-spec price lookup order: AI reasoning
      proposes material/spec `candidateQueries` first, then backend searches
      reviewed price rows with those candidates instead of querying raw text
      such as `亞L30x30`.
- [x] Lock AI-led tool orchestration as the core Steel quote runtime framework
      in related docs: AI chooses business tool paths from normalized context;
      backend provides validated tools, guardrails, source-backed results,
      deterministic calculation, and audit.
- [x] Wire the AI-led orchestration policy into `/steel/oauth-chat` provider
      prompts so runtime calls start from candidate normalization/tool choice,
      not backend-fixed lookup routing.
- [x] Demote AI reasoning helpers from runtime tools: remove
      `normalize_quote_item`, `generate_price_search_terms`, and
      `rank_price_candidates` from the executable tool registry, keep
      `search_price_candidates` as the price reviewed-row lookup tool, and use
      `lookup_defaults` / `steel.quote_defaults` for reviewed reusable defaults.
- [x] Active docs slice: reduce Allowed MVP runtime tools to the AI-led quote
      flow. AI judges steel category, surface, size, and candidate price
      queries; backend exposed lookup tools are `lookup_instructions`,
      `search_price_candidates`, `lookup_defaults`, `search_customers`, and
      `lookup_formula`. Weight, cutting, processing, material-rule, ranking,
      exact-customer, arbitrary source-chunk search, and calculator primitives
      become backend internal capabilities or later extensions, not MVP tools.
- [x] Active docs slice: design AI inference rules as task-scoped
      instructions. Add `lookup_instructions` to the Allowed MVP runtime tools
      so AI can retrieve reviewed instruction packets seeded by
      `docs/reference/instruction.txt` before deriving material/spec/query
      candidates. Keep `search_source_chunks`, alias lookup, and source-text
      search out of MVP unless a later slice proves they need to be AI-callable.
- [x] Active docs slice: rename pre-tool policy to Agent Instruction and mark it
      Admin-managed. Agent Instruction is the default instruction injected into
      every Steel quote turn and can be updated/versioned through backend/Admin
      flows; task-scoped Instruction Packets are still retrieved with
      `lookup_instructions`. Planned storage is `steel.agent_instructions` and
      `steel.instruction_packets`.
- [x] Active docs slice: design `steel.agent_instructions` content sections for
      OCR/file rules, reviewed tool routing, order-line inference, workbook
      output policy, response/confirmation policy, and source validation. Clarify
      that workbook updates currently use the provider-facing `patch_workbook`
      output tool plus backend workbook service validation, not a reviewed lookup
      tool.
- [x] Active docs slice: record the first `steel.agent_instructions` seed text
      as a database-ready default instruction. The text should cover OCR/file
      evidence, AI-led tool choice, raw-typo guardrails, candidate generation,
      reviewed lookup usage, workbook provisional/confirmed writes, and user
      confirmation behavior.
- [x] Active docs slice: design `steel.instruction_packets` as task-scoped,
      reviewed instruction records. Define packet purpose, selectors, payload
      shape, `lookup_instructions` request/response behavior, admin lifecycle,
      and sample packets for `亞L30x30` angle lookup and C-type quote behavior.
- [x] Verify the Agent Instruction / Instruction Packet docs slice with
      Prettier, required-term greps, stale-term greps, and `git diff --check`.
- [x] Active docs correction: split the combined Agent Instruction / Instruction
      Packet baseline into separate documents. `agent_instructions` should own
      only the default AI instruction prompt text; `instruction_packets` should
      own only task-scoped packet design and seed packet text.
- [x] Active docs correction: make future AI instruction prompt injection
      uniformly Traditional Chinese. Database content bodies for
      `steel.agent_instructions` and `steel.instruction_packets` should be
      Traditional Chinese; API/schema field keys can remain canonical English.
- [x] Verify the split-doc correction with Prettier, stale combined-doc greps,
      required separate-doc greps, and `git diff --check`.
- [x] Active docs slice: inspect `docs/reference/instruction.txt`,
      `docs/reference/H型鋼.txt`, `docs/reference/切工價錢.xlsx`, and
      `docs/reference/公式編號.xlsx`, then classify fine-grained quote
      interpretation rules into Traditional Chinese `steel.instruction_packets`
      seed packets.
- [x] Verify the reference-derived instruction packet docs slice with Prettier,
      required packet/source greps, and `git diff --check`.
- [x] Active docs correction: update `lookup_instructions` to use one batched
      full-facet request per interpreted order context. AI should send all
      detected material families, task types, processing types, formula
      candidates, and customer/tier context together, not issue separate packet
      lookups for each small detail such as hole count, cut count, or slotting.
- [x] Verify the batched full-facet instruction lookup correction with
      Prettier, required grep, stale per-detail wording grep, and
      `git diff --check`.
- [x] Active docs correction: update hole-count interpretation so clear
      drawing/order table numbers are high-confidence primary evidence, while
      drawing hole positions are used to cross-check. If table count and drawing
      positions differ, mark manual review instead of silently trusting drawing
      over the table.
- [x] Verify the hole-count table-priority correction with Prettier, required
      grep, stale old-priority grep, and `git diff --check`.
- [x] Active docs correction: organize related steel Instruction Packets into
      packet groups/bundles so one batched `lookup_instructions` call can return
      all relevant detailed rules for the detected material/task/process
      context, instead of independent packet fragments.
- [x] Verify the Instruction Packet group/bundle correction with Prettier,
      required group/bundle grep, stale fragmented-query grep, and
      `git diff --check`.
- [x] Runtime test slice: add a C 型鋼 batched `lookup_instructions` test case
      that returns the `c-type-quote-core` packet group in one tool call,
      including C-type pricing, formula, drawing/hole, and source-priority
      instruction packets.
- [x] Verify the C 型鋼 runtime test slice with RED/GREEN focused Jest,
      registry/executor Jest, Prettier, build/typecheck, and `git diff --check`.
- [x] Active runtime correction: remove Codex/backend implementation wording from
      runtime Instruction Packet bodies. Runtime instructions should describe
      quote behavior, confirmation, and reviewed-data requirements, not tell
      backend implementation modules how to be built.
- [x] Active runtime test slice: add a multi-material batched
      `lookup_instructions` case for one order containing `亞L30x30` and
      C 型鋼, proving one tool call returns both angle/zinc and C-type rule
      groups.
- [x] Active runtime contract slice: make `lookup_defaults` and `lookup_formula`
      accept batch material contexts so one call can retrieve defaults/formulas
      for multiple steel materials.
- [x] Verify the multi-material instruction/default/formula slice with RED/GREEN
      focused Jest, registry/executor Jest, Prettier, build/typecheck, and
      `git diff --check`.
- [x] Active runtime slice: move `lookup_defaults` from seed-backed runtime
      fallback to repository-backed `steel.quote_defaults` retrieval. Keep the
      existing Supabase table schema intact unless a real missing column or
      index is proven; add only the reviewed C 型鋼 default seed data needed for
      runtime retrieval.
- [x] Active runtime correction: model C 型鋼 cutting/hole as a free/no-charge
      business default. Do not require repeated user confirmation for the
      default free charge; keep product/material price zero-as-missing unchanged.
- [x] Add RED tests for DB-backed quote defaults lookup, including a multi-
      material request where only the matching C 型鋼 default is returned from
      reviewed active rows.
- [x] Implement the `quote_defaults` repository mapper/query and wire
      `lookup_defaults` through the Steel tool executor.
- [x] Verify the DB-backed `lookup_defaults` slice with focused RED/GREEN Jest,
      repository/tool specs, Prettier, schema/migration hygiene checks,
      build/typecheck, and `git diff --check`.
- [x] Active runtime cleanup: delete old AI-executable low-level Steel tools
      from registry/schema/executor where the MVP docs already demoted them to
      backend-internal capabilities. Keep repository/internal helpers available
      for backend validation and calculators.
- [x] Add RED tests proving the executable tool registry only exposes
      `lookup_instructions`, `search_customers`, `search_price_candidates`,
      `lookup_defaults`, and `lookup_formula`, and that legacy tool names return
      `unknown_tool` without SQL.
- [x] Remove legacy tool schemas and executor branches for direct spec/weight/
      cutting/hole/processing/material-rule/formula-version/order/source-chunk
      lookup and exact-customer alias lookup.
- [x] Verify the tool-surface cleanup with focused RED/GREEN Jest, full Steel
      Jest, Prettier, stale-tool greps, build/typecheck, and `git diff --check`.
- [x] Active web-test slice: connect the five AI-callable Steel business tools
      to `/steel/oauth-chat` provider execution so the UI can test AI-led
      material/spec inference, reviewed lookup, bounded options, and workbook
      preview output.
- [x] Add RED provider/handler tests proving `/steel/oauth-chat` can execute a
      Steel business tool call and continue to the final assistant response
      while keeping `patch_workbook` as the validated workbook output tool.
- [x] Implement the provider tool-call loop and tool schema conversion using
      the existing Steel tool registry/executor.
- [x] Verify the web-test slice with focused Jest, full Steel Jest, build/type
      checks, and a browser smoke run at `/steel/oauth-chat`.
- [x] Active runtime correction: quick material-price prompts such as
      `亞L30x30 一支多少` must not stop at clarification when bounded
      AI-derived candidate price queries can be formed. AI should search
      reviewed price rows first, lead with the highest-confidence positive
      source-backed approximate candidate as a provisional quote, list other
      plausible options, and keep the customer-facing total unconfirmed until
      user confirmation.
- [x] Update Agent Instruction, Phase 4 tool contract, and provider prompt
      regression so missing length/thickness/customer/tier does not block
      reviewed lookup when bounded candidate queries exist.
- [x] Verify the quick-price correction with RED/GREEN provider Jest, full Steel
      Jest, build/type checks, and `/steel/oauth-chat` smoke.
- [x] Create implementation plan
      `docs/plans/2026-06-03-steel-next-tasks.md` for the four approved next
      tasks.
- [x] Active runtime slice: make quick-price provisional estimates write a
      workbook preview row through `patch_workbook`, including provisional
      source/confidence notes while leaving confirmed totals blank.
- [x] Active verification slice: run Phase 2/4B baseline checks across
      repository/tool/rule-proposal tests, schema/migration grep, builds, and
      diff hygiene; record pass/fail gaps.
- [x] Active C 型鋼 vertical slice: prove one order context retrieves C 型鋼
      instruction packets, quote defaults, and formula candidates, and applies
      free/no-charge cutting and hole defaults without confirming material price
      from missing/zero rows.
- [x] Active source-schema slice: implement tested Chinese reference label to
      backend canonical-key mapping under `packages/api/src/steel/schema`.
- [x] Run baseline verification for the already-landed Phase 2/4B slices:
      repository/tool/rule-proposal tests, schema grep, builds, and diff hygiene.
- [x] Produce a checkpoint gap matrix for
      `tasks/steel-data-rules-architecture/checkpoints.md` A-E so the next
      implementation starts from proven gaps, not assumptions.
- [x] Implement source-schema mapping as code in
      `packages/api/src/steel/schema/mapping.ts` with prompt-serializer tests.
- [x] Connect the provider-neutral Steel business tool executor to
      `/steel/oauth-chat` and `openai_oauth_responses`, keeping `patch_workbook`
      as a validated workbook-output tool.
- [x] C-type quote vertical slice is already completed and manually smoke-tested:
      AI retrieves reviewed customer/price/rule/formula facts, preserves
      ambiguity, and avoids confirmed totals for missing or zero material
      prices.
- [ ] Active Phase 2 remaining slice: expose AI-facing rule prompts through the
      existing business tools. `lookup_catalog_families` returns admin-supplied
      product/category inference rules, `lookup_quote_rules` returns merged
      instruction/default packets, and `search_customers` returns
      customer-specific rules with customer/tier candidates.
- [ ] Active subtotal validation slice: do not implement backend deterministic
      quote calculation primitives. Backend should provide reviewed rule/source
      context and verify workbook summary totals against line `subtotal` sums.
- [ ] Persist accepted quote results into the workbook with source refs,
      confidence, manual-review reasons, latest-only workbook/calculation state,
      and concise audit notes.
- [ ] Superseded by `Steel AI Subtotal Validation Boundary Rebaseline`: do not add
      `quote_calculation_state` or `quote_calculation_item_audits` as backend
      canonical-calculation tables. If audit storage is needed, keep it focused
      on current workbook state, reviewed source context, and prompt
      traceability.
- [ ] Superseded as a runtime tool: do not expose `lookup_defaults` separately.
      Its behavior is merged into `lookup_quote_rules`, which returns typed,
      bounded quote-default candidates with origin refs and explicit user
      disclosure for applied customer defaults. Keep LibreChat user-memory
      adapter as a later separate layer.
- [ ] Implement non-UI Admin rule review backend: list queues, approve, reject,
      keep-one-time, request-info, publish reviewed defaults, and exclude pending
      proposals from quote lookup until approved.
- [ ] Implement non-UI Admin data maintenance backend/import services for ERP
      XLSX-backed product price, cutting price, formulas, and rules. Keep
      handbook DOCX real-data import deferred unless a later task opens it.
- [ ] Record Phase 2 manual/eval evidence for the still-relevant scenarios:
      H-type surcharge/head-tail, product-price unit weight conflict,
      missing/zero material price, no-cut, non-round holes, slotting,
      approximate quote, multi-material audit, and workbook latest-version
      behavior. C-type and `/steel/oauth-chat` manual smokes are already done.
- [ ] After the queue is approved, move the active slice into a detailed
      `docs/plans/YYYY-MM-DD-...md` implementation plan before code changes.

## Review - Steel v8.3 AI-Led Phase 2 Rebaseline 2026-06-08

- Rebased Phase 2 docs away from backend normalization/resolver/ranking/stock
  allocation/calculation-context slices. The active implementation boundary is
  now AI-led judgement/calculation with reviewed rule/tool outputs and workbook
  subtotal validation.
- Runtime lookup surface is `lookup_catalog_families`, `lookup_quote_rules`,
  `search_customers`, `search_price_candidates`, and `lookup_formula`.
  `lookup_instructions` / `lookup_defaults` remain only as internal composition
  names under `lookup_quote_rules`.
- Updated v8.3 checkpoints, README, phase 0/2/3/5/6 docs, source-schema mapping,
  main v8.3 plan, `CONTEXT.md`, and `tasks/lessons.md` so the next slice starts
  from catalog-family rules, customer-specific rules, AI candidate selection,
  rule prompts, `patch_quote_workbook`, and subtotal consistency.
- Verification: `rg` over `CONTEXT.md`, `tasks/v8.3`, and the main v8.3 spec
  shows old runtime tool names only in explicit internal-composition text; old
  backend calculator section names are gone from active quote docs. `git diff
  --check` passed. Prettier was not run per user preference.

## Review - Steel Next Tasks 2026-06-03

- Provisional workbook patch: `sendSteelOAuthChat` now requires positive quick
  price lookups with workbook context to patch provisional `quote_details`,
  `price_sources`, and `interpretation_notes`, then continue one more model turn
  for a Traditional Chinese user-facing quote/options/confirmation answer.
- C 型鋼 vertical lookup: added one runtime spec covering
  `lookup_instructions` -> `search_price_candidates` -> `lookup_defaults` ->
  `lookup_formula` in one order context. The test preserves unknown material
  price as `null` while accepting only cutting/hole as `true_zero_rule`.
- Source-schema mapping: added `packages/api/src/steel/schema/mapping.ts` and
  prompt-context tests for `產品價格.xlsx`, `系統訂單.xlsx`, `公式編號.xlsx`,
  `切工價錢.xlsx`, and `客戶資料.xlsx` Chinese headers to backend canonical keys.
- Phase 2/4B baseline evidence: focused repository/tool/rule-proposal suites
  passed, full `packages/api` Steel Jest passed, schema/migration greps found
  `source_refs`, `product_price_unit_weight`, `value_state`, `review_state`,
  `formula_versions`, `calculation_rule_defaults`, and `quote_defaults`; stale
  tool greps only found docs/test banned-name references, not executable tool
  exposure.
- Checkpoint gap matrix: A/B/D have documented/schema/runtime evidence for the
  current MVP surface; D2 has needs-review proposal/backend tests but Admin
  approve/reject/publish remains deferred; C/E still need deterministic
  calculation primitives, calculation audit persistence, full C/H/cutting/hole/
  slotting manual scenario coverage, and multi-material audit aggregation.
- Verification: `npx jest src/steel --runInBand` passed 27 suites / 112 tests;
  `npm run build:api` passed with only the existing Redis/Keyv warning;
  `git diff --check` passed; `/steel/oauth-chat` smoke for
  `亞L30x30 一支多少` returned `NT$194.3 / 支` provisional quote, alternatives,
  confirmation prompts, and workbook cells including
  `quote_details.material_unit_price=194.3`.

## Review - Steel Quick Price Correction

- Root cause: real model calls included size-only `specKey` values such as
  `30x30`, which the repository treated as exact `spec_key = '30x30'` and
  filtered out reviewed rows such as `angle_L30x30x2.5x6M`.
- Added provider guardrails so material price prompts require Steel tool calls
  until `search_price_candidates` has executed; premature clarification text is
  retried with an internal reminder and then rejected if lookup never occurs.
- Added normalization/tool guards so AI-derived size-only `specKey` values are
  downgraded to partial spec lookup, and derived candidate searches keep
  bounded tier options instead of over-filtering arbitrary tier IDs.
- Seeded reviewed angle candidates from `docs/reference/產品價格.xlsx` so
  `亞L30x30 一支多少` can return source-backed approximate options.
- Verification: focused RED/GREEN specs, full `packages/api/src/steel` Jest,
  `npm run build:api`, direct real provider wrapper, and `/steel/oauth-chat`
  smoke all pass. UI smoke returned `錏成型角鐵 L30x30x2.5t x 6M` with
  `售價A 194.3`, `售價B 201`, `售價C 190.95`, `售價F 180.9`, plus
  熱浸鍍鋅/黑角鐵 alternatives for user confirmation.

## Review

- User correction captured: the paused item is Admin review UI only. Backend
  review APIs, approval/publish data flows, quote defaults retrieval, quote
  runtime, calculation, audit, and workbook persistence remain in the
  implementation queue.
- Current implementation starts with reviewed fact price decisions: when lookup
  finds missing or ambiguous price facts, the tool result must include bounded
  options the user can choose from or use to provide a quote-specific price.
- User correction: when the exact reviewed price is missing but there is one
  nearest reviewed positive candidate, the AI may use that candidate for a
  preview, but the response must explain the assumption and ask the user to
  confirm or provide the exact price.
- Implemented the reviewed-facts price decision slice in
  `packages/api/src/steel/pricing/decision.ts`: missing or zero-as-missing
  facts now return unavailable options with `unitPrice: null`, while a single
  nearest reviewed estimate is selected for preview with
  `confirmationRequired: true`.
- Superseding correction: `packages/api/src/steel/pricing/decision.ts` is no
  longer part of the current runtime architecture because numeric quote
  decisions/calculation belong to the AI-owned OAuth/Codex calculation lane.
- Added the 全華興 / 亞L30x30 multi-candidate guard: incomplete angle quote
  requests now preserve all bounded approximate options with source refs, so AI
  can list product/spec/tier price/source choices for the user instead of
  showing only the highest approximate match.
- User correction: the issue is not just a missing `亞` to `錏` alias. The
  lookup order must be AI-proposed material/spec candidates first, reviewed
  table lookup second; raw typo strings are not canonical price keys.
- Added derived `candidateQueries` support for `search_price_candidates`.
  Raw-only terms such as `亞L30x30` are filtered or rejected; derived terms such
  as `錏成型角鐵` + `30x30` can search reviewed rows and return multiple
  thickness/price options. Superseding correction: query generation is AI
  reasoning, not a runtime tool.
- User correction: AI should decide which reviewed-data lookup tool to use
  after normalization. The backend owns table-specific schemas, validation, raw
  typo guards, source refs, and deterministic ranking; it should not silently
  choose the domain lookup path for the AI.
- User correction: the `亞L30x30 一支多少` sample is a full runtime chain, not
  only a lookup contract. AI detects typo/incomplete spec, proposes approximate
  material/spec candidates, calls reviewed-data tools, continues lookup/ranking,
  writes a provisional workbook update, and explains assumptions/options for
  user confirmation.
- Documentation update: promoted AI-led tool orchestration to the core framework
  in `CONTEXT.md`, `tasks/steel-data-rules-architecture/README.md`,
  `checkpoints.md`, Phase 4 tool-calling, Phase 6 verification, and v8.3 Phase
  2 data tools. Future implementation should not start from backend-fixed
  product/weight/cutting/rule routing.
- Implemented the first runtime enforcement slice: `/steel/oauth-chat` now
  passes `steelRuntimePolicy: true`, and the OpenAI OAuth provider adds a system
  instruction that AI owns Steel tool orchestration, must derive candidate
  material/spec queries before searching reviewed price rows, must not treat raw
  typo text such as `亞L30x30` as a confirmed price key, and must present
  bounded options/confirmation for missing, zero, ambiguous, or approximate
  reviewed facts.
- User correction: not every reasoning step needs a tool. Runtime should expose
  reviewed-row lookup tools and workbook/calculation validation tools, not AI
  helper tools. Removed `normalize_quote_item`, `generate_price_search_terms`,
  and `rank_price_candidates` from the executable tool registry; renamed the
  reviewed default concept to `lookup_defaults` / `steel.quote_defaults` /
  `quote_default`.
- User correction: the Allowed MVP tool list is still too broad. For the MVP
  quote flow, AI should derive material category, surface, dimensions, and
  price query candidates itself, then call only reviewed lookup tools:
  `lookup_instructions`, `search_price_candidates`, `lookup_defaults`,
  `search_customers`, and `lookup_formula`. Exact lookup aliases,
  formula-version naming, weight/cutting/processing/material-rule lookups,
  ranking helpers, arbitrary source-chunk search, calculation primitives, and
  workbook read tools should not appear as exposed MVP tools unless a later
  implementation slice proves they are needed.
- User correction: the AI inference process itself needs instruction design.
  `docs/reference/instruction.txt` should seed reviewed, task-scoped
  Instruction Packets for candidate generation and quote interpretation.
  Added `lookup_instructions` to the Allowed MVP runtime tools because AI needs
  a bounded query path for those rules before generating material/spec/price
  candidates. Did not add `search_source_chunks` or a separate alias lookup to
  MVP: instruction retrieval covers interpretation policy, while
  `search_price_candidates` validates derived candidates against reviewed price
  rows.
- User correction: call the pre-tool default rules `Agent Instruction`, not the
  old longer name. Agent Instruction is also Admin-managed and
  injected into every Steel quote turn. It is not a code-fixed provider prompt;
  runtime should use the reviewed active Agent Instruction and record its
  version/source. Planned database surfaces are `steel.agent_instructions` for
  the default injected instruction and `steel.instruction_packets` for
  task-scoped retrieved packets.
- User expectation: Agent Instruction should cover OCR/file interpretation,
  tool routing, workbook behavior, and order inference. Updated the docs to
  model `steel.agent_instructions` with structured sections: `fileOcrRules`,
  `toolRules`, `orderInferenceRules`, `workbookRules`, and `responseRules`.
- Workbook clarification: current `/steel/oauth-chat` can update workbooks via
  the provider-facing `patch_workbook` output tool when workbook context is
  present. AI proposes typed workbook operations; backend workbook schemas and
  services validate/apply them. This remains separate from the MVP reviewed
  lookup tools.
- Updated the related docs to the reduced Allowed MVP runtime tool contract:
  `CONTEXT.md`, v8.3 primary spec, v8.3 Phase 2 data tools, Steel data-rules
  README, checkpoints, Phase 0 decisions, Phase 3 material rules, Phase 4
  tool-calling, Phase 4A quote defaults, and AI rule-selection scenarios.
- Verification passed for this docs cleanup slice: touched-doc Prettier check,
  `git diff --check`, and stale white-list grep confirmed no old broad
  allowed-tool heading or old one-tool-per-line bullets such as
  `lookup_customer`, `lookup_spec_price`, `lookup_weight_spec`,
  `lookup_formula_version`, `lookup_material_rules`, `select_calculation_rule`,
  `lookup_cutting_price`, `lookup_processing_price`, or `get_workbook` remain
  as active allowed-tool entries.
- Verification passed for the instruction-query addition: touched-doc Prettier
  check, stale white-list grep, `lookup_instructions` required-term grep across
  core docs, and `git diff --check` passed. `lookup_instructions` is now the
  only added query tool for AI inference; `search_source_chunks` remains
  explicitly excluded from the MVP inference path.
- Verification passed for Agent Instruction rename/management correction:
  touched-doc Prettier check, stale old-name grep, Agent Instruction/DB-surface
  required-term grep, and `git diff --check` passed.
- Verification passed for Agent Instruction content/workbook clarification:
  touched-doc Prettier check, required-term grep for `fileOcrRules`,
  `toolRules`, `orderInferenceRules`, `workbookRules`, `responseRules`,
  `patch_workbook`, `Workbook Output Tool`, `steel.agent_instructions`, and
  `steel.instruction_packets`, stale old-name grep, and `git diff --check`
  passed.
- Split the earlier combined Agent Instruction / Instruction Packet baseline
  into two documents:
  `tasks/steel-data-rules-architecture/agent-instructions.md` owns only the
  first `steel.agent_instructions` prompt seed, while
  `tasks/steel-data-rules-architecture/instruction-packets.md` owns only
  `steel.instruction_packets` selectors, storage shape, `lookup_instructions`
  request/response behavior, Admin lifecycle, conflict policy, and seed packet
  text.
- The prompt-injected body text for future DB-backed
  `steel.agent_instructions` and `steel.instruction_packets` is now documented
  as Traditional Chinese. Canonical API/schema/tool keys such as
  `fileOcrRules`, `toolRules`, `taskTypes`, and `requiredLookups` can remain
  English.
- The Instruction Packet seed examples now live in `instruction-packets.md` with
  Traditional Chinese bodies and blocking rules:
  `angle-surface-oral-zh-v1`, `c-type-basic-quote-zh-v1`, and
  `workbook-provisional-confirmed-zh-v1`.
- Removed the earlier combined baseline and updated references in `CONTEXT.md`,
  v8.3 primary spec, v8.3 Phase 2, v8.3 Phase 5, Steel data-rules README, and
  Phase 4 tool-calling to point at the separate `agent-instructions.md` and
  `instruction-packets.md` docs.
- Verification passed for the split-doc correction: touched-doc Prettier check,
  stale combined-doc grep, required separate-doc / Traditional Chinese
  injection-term grep, and `git diff --check`.
- Inspected `docs/reference/instruction.txt`, `docs/reference/H型鋼.txt`,
  `docs/reference/切工價錢.xlsx`, and `docs/reference/公式編號.xlsx`. For xlsx
  sources, extracted workbook sheet/table contents using the bundled Python
  runtime after the artifact-tool native dependency was blocked by macOS code
  signing.
- Expanded `tasks/steel-data-rules-architecture/instruction-packets.md` with
  reference-derived Traditional Chinese seed packets:
  `price-source-priority-zh-v1`,
  `oral-material-candidate-generation-zh-v1`,
  `formula-code-selection-zh-v1`, `h-type-length-surcharge-zh-v1`,
  `h-and-i-beam-cutting-price-zh-v1`, `black-steel-cutting-price-zh-v1`,
  `cut-count-and-trim-detection-zh-v1`,
  `drawing-processing-detection-zh-v1`, and
  `workbook-output-columns-zh-v1`.
- The new packets classify detailed rules by runtime task/material/process:
  price-source priority and missing-price handling, oral material candidate
  generation, formula code selection from `公式編號.xlsx`, H-type regular/
  non-standard length surcharge from `H型鋼.txt`, H/i-beam cutting details,
  black steel pipe/angle/channel/flat cutting details, cut-count/head-tail
  trim behavior, drawing/OCR processing detection, and workbook output notes.
- Verification passed for the reference-derived instruction packet docs slice:
  Prettier check for `instruction-packets.md` and `tasks/todo.md`, required
  packet-name grep, required source/detail grep for the four reference sources
  and selected H/cutting/formula markers, and `git diff --check`.
- User correction captured: `lookup_instructions` is a batched full-facet lookup
  per interpreted order context, not a per-detail query loop. The request should
  include all detected steel/material families, task types, processing types,
  formula candidates, customer/tier/project context, and low-confidence facets
  together, then returned packets are applied across the relevant lines.
- Updated Agent Instruction seed text, `instruction-packets.md`, Phase 4
  tool-calling, v8.3 Phase 2 data tools, Steel data-rules README, and lessons
  so hole count, cut count, slotting path, bending, formula, and individual line
  fragments do not become separate `lookup_instructions` tool calls.
- Verification passed for the batched full-facet `lookup_instructions`
  correction: touched-doc Prettier check, required-term grep for batched/
  full-facet/catalogContexts wording, stale request-shape grep confirming no
  `matchedSelectors` or old `limit: 5` example remains, and `git diff --check`.
- User correction captured: hole count follows table count first, with drawing
  hole positions used for cross-check. If table count and drawing positions
  differ, record both and mark manual review instead of silently overriding the
  table.
- Updated `drawing-processing-detection-zh-v1` with the Traditional Chinese
  【孔洞】 rule: round holes, long holes, bolt holes, punched holes, `4-Ø22` and
  `6-Ø26` count as holes; `4-Ø22` means four holes per piece; total holes equal
  per-piece/per-stock count times quantity; non-hole drawing marks must not be
  counted; explicit `產品價格.xlsx` punching/hole-processing items win; C-type
  holes follow the C-type special pricing rule.
- Synced Agent Instruction, Phase 3 material rules, and lessons so table counts
  are high-confidence primary evidence, drawing/vision is cross-check evidence,
  and conflicts become manual review.
- Verification passed for the hole-count table-priority correction: touched-doc
  Prettier check, required-term grep for table-priority/C-type/product-price
  hole wording, stale old-priority grep, and `git diff --check`.
- User correction captured: related steel Instruction Packets must be organized
  into material/task packet groups so one batched `lookup_instructions` call can
  return all relevant detailed rules for the detected context.
- Updated `instruction-packets.md` with `packetGroup`, `groupRole`,
  `relatedPacketSlugs`, selector `packetGroups`, `packetGroupHints`, response
  `packetGroups`, and a seed group map covering `global-quote-core`,
  `angle-zinc-quote-core`, `c-type-quote-core`, `h-type-quote-core`,
  `black-long-material-cutting-core`, `plate-processing-core`, and
  `workbook-output-core`.
- Added packet group membership to each seed packet so price, formula, cutting,
  hole/drawing, workbook, and confirmation rules can be retrieved together
  instead of forcing separate instruction lookups.
- Synced Agent Instruction, Phase 4 tool-calling, v8.3 Phase 2 data tools,
  Steel data-rules README, and lessons to require group expansion for related
  steel rules.
- Verification passed for the Instruction Packet group/bundle correction:
  touched-doc Prettier check, required grep for packet groups, `packetGroupHints`
  and seeded group keys, fragmented-query guard grep, and `git diff --check`.
- Runtime implementation slice started from a C 型鋼 RED test:
  `lookup_instructions` initially returned `ok: false` because the executable
  runtime tool did not exist.
- Added seed-backed runtime support for `lookup_instructions` in the Steel tool
  registry/executor. The first implemented group is `c-type-quote-core`, which
  returns `c-type-basic-quote-zh-v1`, `price-source-priority-zh-v1`,
  `formula-code-selection-zh-v1`, and `drawing-processing-detection-zh-v1` in
  one batched call without SQL.
- The C 型鋼 runtime test verifies one request with `packetGroupHints:
["c-type-quote-core"]` returns the related price/formula/hole instruction
  packet group, includes C 型鋼專用孔費 wording, includes table-priority hole
  wording, and does not return unrelated H 型鋼 or angle packets.
- Verification passed for the C 型鋼 runtime test slice: the focused RED run
  failed because `lookup_instructions` was not yet executable; the GREEN run
  passed after adding the runtime catalog; `execute.spec.ts` and
  `registry.spec.ts` passed with 12 tests; touched-file Prettier check passed;
  `npm run build:api` exited 0 with only the existing non-Steel Redis type
  warning in `src/cache/cacheFactory.ts`; `git diff --check` passed.
- User correction captured: runtime Instruction Packet bodies must not contain
  Codex/backend implementation instructions. C 型鋼切工與孔費免費是業務預設，
  可透過 quote default 列為 true-zero/no-charge；此預設不代表材料單價、
  特殊加工或非 C 型鋼加工免費。
- Added one-call multi-material `lookup_instructions` runtime coverage for an
  order containing `亞L30x30` and C 型鋼. The test proves one tool call returns
  both `angle-zinc-quote-core` and `c-type-quote-core`, including angle oral/
  surface rules and C 型鋼 price/formula/hole rules, without returning unrelated
  H 型鋼 packets.
- Added batch-capable `lookup_formula` and `lookup_defaults` executable tool
  contracts. `lookup_formula` accepts multiple material contexts and retrieves
  formula rows for all supplied formula candidates in one tool call;
  `lookup_defaults` accepts multiple material contexts and returns the matching
  C 型鋼 quote default without SQL while DB-backed defaults remain a later slice.
- Verification passed for the multi-material instruction/default/formula slice:
  RED focused tests failed for implementation wording, missing angle group, and
  missing `lookup_formula` / `lookup_defaults`; GREEN focused tests passed;
  `execute.spec.ts` and `registry.spec.ts` passed with 15 tests; touched-file
  Prettier check passed; runtime-facing stale wording grep returned no matches;
  `npm run build:api` exited 0 with only the existing non-Steel Redis type
  warning in `src/cache/cacheFactory.ts`; `git diff --check` passed.
- User correction captured: C 型鋼的預設邏輯是切工/孔費免費，不是每次都要求使用者
  重新確認 true-zero。Runtime packet、Instruction Packet docs、lessons and
  checkpoints now model this as a quote-default true-zero/no-charge behavior
  while preserving product/material price zero-as-missing.
- Added repository-backed `lookup_defaults`: `searchSteelQuoteDefaults` reads
  reviewed active rows from `steel.quote_defaults` using one batched material/
  charge/formula query, and tool output maps returned defaults back to matching
  order line refs.
- Added idempotent data migration
  `supabase/migration/20260603091515_seed_c_type_quote_defaults.sql` to seed the
  reviewed C 型鋼 cutting/hole no-charge quote default. No table schema change was
  needed because `steel.quote_defaults` already existed.
- Verification passed for the DB-backed `lookup_defaults` slice: RED tests
  failed first because the repository did not exist and the executor did not run
  SQL; GREEN focused tests passed; `npx jest src/steel --runInBand` passed with
  101 tests; touched-file Prettier check passed; stale runtime wording grep
  returned no non-test matches; migration file content checks passed;
  `git diff --check` passed; `npm run build:api` exited 0 with only the existing
  non-Steel Redis type warning in `src/cache/cacheFactory.ts`.
- `npx supabase migration list --local` could not run because this checkout has
  no local Supabase Postgres listening on `127.0.0.1:54322`; this matches the
  project cloud-only Supabase setup, so local migration-list verification was
  replaced by file/content checks.
- User correction captured: C 型鋼 runtime packet body should state the rule
  directly and not say `依【C 型鋼專用計價規則】處理`, because the packet content
  itself is the C 型鋼專用規則. Runtime and docs now say C 型鋼切工/孔費預設免費
  directly.
- Deleted old AI-executable low-level Steel tools from schema, registry, and
  executor branches. The executable runtime surface is now only
  `lookup_instructions`, `search_customers`, `search_price_candidates`,
  `lookup_defaults`, and `lookup_formula`; direct customer/spec/weight/cutting/
  hole/processing/material-rule/formula-version/order/source-chunk lookups are
  backend-internal capabilities.
- Provider runtime policy now lists the same five AI-callable Steel tools plus
  workbook patch output, and tells AI to rely on backend internal validation for
  unit-weight, cutting, processing, material-rule, and formula-version details.
- Verification passed for the tool-surface cleanup: RED registry/executor tests
  failed while legacy tools were still callable; GREEN focused tests passed;
  `npx jest src/steel --runInBand` passed with 99 tests; Prettier write/check
  passed; stale executable-tool grep returned no non-test source matches; C 型鋼
  self-reference grep has no runtime/docs matches except the lesson's banned
  example.
- Connected `/steel/oauth-chat` provider execution to the AI-callable Steel
  business tool surface. The provider now exposes the five registry tools as AI
  SDK function tools, executes Steel business tool calls through the existing
  tool executor, feeds results back as `role: tool` messages, aggregates
  multi-round usage/warnings, and keeps `patch_workbook` as a validated workbook
  output proposal.
- Added RED/GREEN provider coverage for the runtime loop: the RED test first
  proved only one provider generation happened; the GREEN test proves
  `lookup_instructions` is executed, its JSON result is returned to the model,
  and the final assistant answer/usage comes from the follow-up generation. A
  second regression test proves backend tool execution failures are returned to
  the model as `repository_error` tool results instead of being mislabeled as
  JSON argument errors.
- Browser smoke passed on `http://localhost:3090/steel/oauth-chat` with backend
  `http://localhost:3080`: login succeeded, workbook v1 initialized, and the
  prompt `亞L30x30 一支多少` returned AI-derived candidates (`錏角鐵 30x30`,
  `錏成型角鐵 30x30`, `鍍鋅角鐵 30x30`, `角鐵 30x30`, `L30x30`) before reporting
  no reviewed price match and asking the user to confirm surface, thickness, and
  length. No confirmed workbook total was written.
- Verification passed for the web-test slice: focused provider Jest passed;
- User correction captured: for `亞L30x30 一支多少`, AI should not stop before
  lookup just because length, thickness, customer, or tier is missing. If
  reviewed lookup finds positive source-backed approximate candidates, the
  response should lead with the highest-confidence provisional quote and then
  list other plausible specs/options for confirmation.
- Live smoke gap found: `steel.price_items` had no reviewed product-price rows,
  so `/steel/oauth-chat` could not produce a source-backed provisional quote.
  Added a minimal reviewed seed from `docs/reference/產品價格.xlsx` for
  `錏成型角鐵30*2.5*6M`, `熱浸鍍鋅角鐵30*3.0`, and comparable black angle 30
  candidates.
- Tool lookup correction: AI may pass oral candidates such as `錏角鐵`; backend
  price search now uses bounded token matching for those AI-derived candidates
  while still rejecting raw typo strings such as `亞L30x30`.
  `npx jest src/steel/ai/provider.spec.ts --runInBand` passed with 7 tests;
  `npx jest src/steel --runInBand` passed with 101 tests; `npm run build:api`
  exited `0` with the existing Redis type warning plus non-blocking
  `zod-to-json-schema` circular dependency warnings; touched-file Prettier
  passed after formatting; `git diff --check` passed.
- Updated core docs to point at the new baseline:
  `CONTEXT.md`, v8.3 primary spec, v8.3 Phase 2 data tools, v8.3 Phase 5 Admin
  source management, Steel data-rules README, and Phase 4 tool-calling. The new
  doc is explicitly docs/design only; implementation that adds Steel PostgreSQL
  schema must still update both `supabase/schema.sql` and a new migration.
- Verification passed for this Agent Instruction / Instruction Packet docs
  slice: touched-doc Prettier check, stale bootstrap-name grep, required-term
  grep for Agent Instruction/Instruction Packet/workbook output terms and seed
  packet names, and `git diff --check`.
- Verification passed for this tool-boundary/schema-rename slice: focused Steel
  Jest suite covering normalization search, price repositories, executable tool
  registry/executor, pricing decisions, provider policy, and chat handler
  behavior passed with 51 tests; old-name schema/tool grep returned no active
  `lesson_memory_entries`, `retrieve_lesson_memory`, `retrieve_user_memory`,
  `ai_selected_lesson`, `entry_type`, or `supersedes_entry_id` matches;
  Prettier, `git diff --check`, and `npm run build:api` also passed. The API
  build still emits the existing non-Steel Redis type warning in
  `src/cache/cacheFactory.ts`, but exits `0`.
- Verification passed: focused normalization/pricing/repository/tool Jest with
  38 tests, Prettier, `git diff --check`, and `npm run build:api`. The API
  build still emits the existing non-Steel Redis type warning in
  `src/cache/cacheFactory.ts`, but exits `0`.

# Steel Historical Audit Storage And High-Confidence Preview Correction

- [x] Historical: moved raw calculation-tool output out of visible workbook notes.
      Superseded: hidden provider code/tool disclosure is not a required backend
      acceptance contract.
- [x] Historical: modeled dedicated calculation audit storage for multi-item
      orders. Superseded: do not add required backend canonical-calculation
      tables.
- [x] Correct workbook/calculation storage policy so database keeps only latest state; `version` is an update counter, not historical retention.
- [x] Clarify workbook preview may show concise source/calculation summaries in
      `價格來源` or `判讀備註`, while raw hidden-tool output stays out of visible
      workbook cells.
- [x] Reframe 全華興 / 亞L30x30 as a high-confidence best-effort preview from typo/incomplete specs, not a blocker scenario.
- [x] Sync lessons and checkpoints for future implementation agents.
- [x] Verify Markdown formatting and diff hygiene.

## Review

- Historical correction: raw calculation-tool output and verbose execution
  artifacts do not belong in visible workbook cells, while `價格來源` and
  `判讀備註` may still show concise human-readable source/calculation summaries.
- Historical schema planning for dedicated current calculation audit storage was
  superseded by the later no-required-calculation-table decision.
- Superseding correction: do not add `quote_calculation_state` or
  `quote_calculation_item_audits`; keep any future storage focused on current
  workbook state, reviewed source context, and prompt traceability.
- Corrected workbook persistence policy: `version` is only a visible update counter/freshness marker, and accepted updates overwrite old workbook/calculation data instead of retaining historical database versions.
- Updated the 全華興 / 亞L30x30 scenario so typo/incomplete specs can still produce a highest-confidence source-backed preview; overall confidence may remain `中` until the user supplies thickness or material variant.
- Added a multi-item scenario proving one order can contain separate C-type and angle lines, each with its own current calculation plan, audit row, confidence, and workbook patch target.
- Verification passed: Markdown Prettier, required-term grep, and `git diff --check`.

# Steel AI Python Audit And Estimate Scenario Docs Sync

- [x] Historical: clarified that AI/backend numeric mismatch did not block
      workbook preview patching when backend calculation succeeded. Superseded:
      AI on the OAuth/Codex path is now the calculation lane and backend must not keep a
      parallel canonical calculator.
- [x] Historical: documented backend-confirmed numbers as highest confidence.
      Superseded: confirmed totals now require workbook summary/subtotal
      consistency instead of backend canonical calculation.
- [x] Add the 全華興 / 亞L30x30 approximate quote scenario with customer tier lookup, nearest product-price candidate, medium confidence, and low-confidence reasons.
- [x] Sync lessons so future agents do not reject preview patches solely because AI Python differs from backend calculation.
- [x] Verify Markdown formatting and diff hygiene.

## Review

- Historical note: this section is superseded by the current subtotal validation
  boundary. Backend-confirmed calculator values are no longer the numeric source;
  confirmed totals are accepted only with workbook summary/subtotal consistency.
- Added a concrete 全華興 / 亞L30x30 approximate quote scenario: customer tier `A級`, highest-confidence reviewed product-price candidate `錏成型角鐵 30x30x2.5x6M`, A-tier price `194.3 元/支`, quantity about 100, medium overall confidence, and low-confidence reason for missing thickness.
- Updated project lessons so future agents keep approximate estimates and backend-wins mismatch behavior.
- Verification passed: Markdown Prettier, required-term grep, and `git diff --check`.

# Steel AI Rule And Formula Orchestration Docs Sync

- [x] Clarify that formula/rule selection starts from AI-normalized material/spec context and reviewed formula/rule data.
- [x] Clarify that AI decides which backend tools to call, while backend validates selected formula/rule/source and calculates deterministically.
- [x] Document that C-type cutting/hole true zero comes from selected rule or quote-specific override, not backend product-family hardcoding.
- [x] Add concrete simulated AI logic scenarios for C-type, ambiguity, missing price, custom override, and H-type surcharge.
- [x] Sync user-corrected behavior for nearest material-price candidates, H-type head/tail clarification, and applied customer-default disclosure.
- [x] Sync user-corrected behavior that C-type free cutting/hole must be preconfigured as a default rule/lesson and that all cuttable materials ask head/tail when cutting is needed.
- [x] Verify Markdown formatting, required-term grep, and diff hygiene.

## Review

- Updated the Steel data-rules architecture package and v8.3 Phase 2 roadmap to make the AI/backend boundary explicit.
- Added `tasks/steel-data-rules-architecture/ai-rule-selection-scenarios.md` as a durable scenario reference for the next C-type quote vertical slice.
- Updated scenarios from user correction: C-type default true-zero comes from global/site-managed quote defaults retrieval, zero material price asks with nearest candidates, H-type cutting asks head/tail before cut-count, and approved customer H-type defaults must be disclosed when applied.
- Updated cutting behavior: no-cut still records `0` cutting in workbook; cuttable materials with cutting needed ask head/tail; remainder-tail omission is explained in chat and workbook notes.
- No Supabase migration was needed because this is a documentation/architecture sync only.

# Steel OAuth Chat Workbook Context Retrieval

- [x] Keep this scoped to `/steel/oauth-chat`; do not move workbook patching into formal Steel Workspace or official chat.
- [x] Read the current workbook before provider calls when workbook id/version context is present.
- [x] Send bounded workbook structure context to the OpenAI OAuth provider so AI resolves visible labels to internal ids/keys.
- [x] Add regression coverage for `總結` / `總額` mapping to `summary.summary_total_amount.value`.
- [x] Verify focused provider/API/client tests, direct API build, live OAuth smoke, service restart, and diff hygiene.

## Review

- User correction: the user should not provide workbook internal ids or keys. AI must obtain the workbook structure/context and decide the typed `patch_workbook` operation itself.
- Root cause hypothesis: the previous tool-calling slice enabled typed patch operations, but the provider prompt did not include the current workbook's visible labels, rows, columns, and id/key mapping.
- Added backend workbook context retrieval before provider calls when `workbookId` and `workbookVersion` are present.
- Added bounded workbook context serialization with sheet labels, column labels/keys, row ids, and cell values so phrases such as `總結的總額` can resolve to `summary.summary_total_amount.value`.
- Added provider prompt guidance telling AI not to ask users for internal workbook ids or keys when the target can be resolved from context.
- Regression tests now prove the provider receives workbook context and the handler applies the `總結` / `總額` patch target through the workbook service.
- Real OAuth provider smoke passed: `總結的總額更新為100` returned `summary` / `summary_total_amount` / `value` / `100` as a typed `patch_workbook` operation.
- Verification passed: focused provider/handler Jest, client SteelOAuthChat Jest, direct `packages/api` build, real OAuth smoke, `git diff --check`, and restarted local dev services with `3080/api/config` plus `3090/steel/oauth-chat` returning `200`.
- Direct `packages/api` build still reports the existing non-Steel Redis type warning in `src/cache/cacheFactory.ts`, but exits `0`.

# Steel OAuth Chat AI Workbook Patch Tooling

- [x] Keep the slice scoped to `/steel/oauth-chat`; do not move behavior into formal Steel Workspace or official chat.
- [x] Remove the manual-command direction; natural-language workbook updates must be decided by AI/tool calling.
- [x] Provide a typed `patch_workbook` tool to the OpenAI OAuth provider when workbook context is present.
- [x] Extract AI tool calls into workbook patch operations and apply them through the existing workbook service.
- [x] Verify focused provider/API/client behavior, builds/formatting, and diff hygiene.
- [x] Provide corrected manual browser test steps for natural-language workbook updates.

## Review

- User correction: this should not be implemented as hidden dev command parsing. `/steel/oauth-chat` should let AI decide whether to execute a workbook patch through tool calling, then backend validation applies the typed operations.
- Removed the manual-command path from the handler; natural-language messages now still go through the OpenAI OAuth provider.
- Added a `patch_workbook` function tool to the provider adapter when workbook context is present.
- Added provider extraction of `tool-call` content into typed `workbookPatch.operations`.
- Handler passes `workbookPatchTool: true` only when the request includes `workbookId` and `workbookVersion`, then applies AI-emitted operations through `workbookService.patch`.
- The corrected manual browser test input is natural language: `set quote_details line_1 material_unit_price 115`.
- Verification passed: packages/api provider/handler Jest, client SteelOAuthChat Jest, direct `packages/api` build, Prettier, and `git diff --check`.
- Direct `packages/api` build still reports the existing non-Steel Redis type warning in `src/cache/cacheFactory.ts`, but no new Steel warning remains.
- Manual-command grep passed with no code/task hits for `manualWorkbook`, `Manual workbook`, `/workbook set`, or `workbook test command`.
- Local manual-test services are reachable after backend restart: backend `http://localhost:3080/api/config` returned `200`, and frontend `http://localhost:3090/steel/oauth-chat` returned `200`.
- User-reported provider failure was reproduced in Node runtime: plain OAuth text passed, but `workbookPatchTool=true` failed with `Invalid schema for function 'patch_workbook'` because `op` used `const` without a `type`.
- Fixed `patch_workbook` schema by adding explicit `type` keys and making strict-tool fields required; added a regression assertion for the `op` schema.
- Real OAuth tool smoke passed after the fix: `set quote_details line_1 material_unit_price 115` returned a typed `workbookPatch.operations` payload instead of provider failure.
- Added a handler fallback summary so a pure tool-call response still returns visible assistant text after the workbook patch is applied.
- Restarted backend dev after the fix; backend `http://localhost:3080/api/config` returned `200`, and frontend `http://localhost:3090/steel/oauth-chat` returned `200`.

# Steel OAuth Chat Workbook Patch Backend

- [x] Keep the slice scoped to `/steel/oauth-chat`; do not move workbook behavior into formal Steel Workspace or official chat.
- [x] Extend the Steel chat schema so AI/provider output can propose operations-only workbook patches.
- [x] Add a failing handler test proving `/steel/oauth-chat` applies provider patch operations through the workbook service.
- [x] Implement backend patch application so the response returns the persisted workbook patch result, not raw provider operations.
- [x] Verify focused data-provider/API tests, builds/formatting, and diff hygiene.

## Review

- Added `steelProviderWorkbookPatchProposalSchema` for provider/tool output that proposes operations-only workbook patches.
- Added the red/green handler test proving `/steel/oauth-chat` merges request workbook context with provider patch operations, calls `workbookService.patch`, and returns the persisted workbook patch result.
- Updated the Steel chat handler so raw provider operations are never returned directly to the browser; successful patches return the workbook service result, known workbook conflicts/validation errors return `rejectedReason`, and malformed provider patch output returns `structured_output_invalid`.
- Kept this scoped to `/steel/oauth-chat`; no formal Steel Workspace or official chat integration was added.
- No Supabase migration was needed because this slice only changes chat/workbook API contracts and Mongo workbook patch application.
- Verification passed: data-provider Steel AI Jest, `build:data-provider`, packages/api Steel handler Jest, direct `packages/api` build, Prettier, and `git diff --check`.
- Direct `packages/api` build still reports the existing non-Steel Redis type warning in `src/cache/cacheFactory.ts`, but exits `0`.

# Steel Workbook Canonical Headers

- [x] Record the requested seven-sheet header contract.
- [x] Add failing service tests for exact sheet header order and required seed rows.
- [x] Update initial workbook definitions without changing public sheet ids.
- [x] Verify focused service/repository tests, build, formatting, and diff checks.

## Review

- Updated the initial Steel workbook contract so new workbooks keep the seven public sheet ids but render the requested visible sheet labels and exact header order.
- Verified `docs/reference/系統訂單.xlsx` first-row headers match the requested 20-column ERP system-order header.
- `報價明細` now contains the full pricing, weight, source, confidence, fee, and review columns. Its patch-oriented material price key is `material_unit_price` with label `材料單價`.
- `總結` now seeds `總重量` and `總額`; `給客戶` now seeds a final `訂單總額` row.
- Synchronized stale workbook test fixtures from `quoted_unit_price` / `單價` to `material_unit_price` / `材料單價`.
- Build-output cloud Mongo smoke passed: `createWorkbook` returned `201`, visible sheet labels were `報價明細`, `總結`, `人工複核`, `價格來源`, `判讀備註`, `系統訂單`, `給客戶`; `報價明細` had 40 headers, `系統訂單` had 20 headers, and `給客戶` included the `訂單總額` row. The temporary workbook was deleted.
- User-corrected visible sheet order is now canonical: `系統訂單`, `總結`, `人工複核`, `報價明細`, `價格來源`, `判讀備註`, `給客戶`. The public sheet ids remain stable.
- Rebuilt data-provider before API tests so `packages/api` consumed the updated `requiredSteelWorkbookSheetIds` order.
- Build-output cloud Mongo order smoke passed: `createWorkbook` returned `201` with sheet labels exactly `系統訂單`, `總結`, `人工複核`, `報價明細`, `價格來源`, `判讀備註`, `給客戶`; the temporary workbook was deleted.
- No Supabase migration was needed because this changes Mongo workbook JSON initialization and tests only.

# Steel Workbook Live Endpoint Still 500

- [x] Confirm which backend process is serving `:3080` and whether it uses this worktree/build.
- [x] Verify built `packages/api/dist` contains the workbook repository fix and diagnostic response.
- [x] Reproduce workbook creation against the live backend or live Mongo seam.
- [x] Fix any remaining backend issue with focused regression coverage.
- [x] Verify focused tests/build/diff checks and document the final live-smoke result.

## Review

- Root cause of the repeated `{"message":"Steel workbook request failed"}` on `steel/v8.3`: the running/build target branch did not yet include the workbook repository plain-object fix or the diagnostic workbook handler response that were present in the detached Codex worktree.
- Confirmed the Codex worktree had `steel_workbook_unknown` diagnostics and the Mongoose `toPlain()` fix, while `/Users/neven/Documents/projects/LibreChat` on branch `steel/v8.3` did not.
- Applied the same verified repository and handler changes directly to the `steel/v8.3` branch worktree so rebuilding that branch uses the fixed code.
- No local `:3080` or `:3090` listener was visible from the tool environment during diagnosis, so the live browser request could not be replayed against the user's currently running process.
- Verified the built branch handler directly against `.env` `MONGO_URI`: after an explicit `mongoose.connect`, `createWorkbook` returned `201`, created seven sheets, and the first sheet label was `報價明細`; the smoke script then deleted the temporary workbook data.
- Verified the diagnostic path too: calling the handler without an active Mongo connection now returns `errorCategory: steel_workbook_unknown` and an `errorSummary`, so any remaining generic-only response is from an older running backend.

# Steel Workbook API 500 Bug Fix

- [x] Reproduce `POST /api/steel/workbooks` failure at the real repository/schema seam.
- [x] Identify whether the failure is Mongoose workbook schema, stale package build, or runtime database configuration.
- [x] Add a regression test for the real failure mode before changing production code.
- [x] Implement the minimal backend fix and preserve the retryable frontend error state.
- [x] Verify focused workbook API tests, build, formatting, and diff hygiene.

## Review

- Root cause: the Mongoose workbook repository returned Mongoose documents/subdocuments directly into `toRecord()`. Spreading those subdocuments dropped getter-backed fields, so Zod saw `sheets[].id`, `label`, `columns[].key`, and `rows[].id` as `undefined`.
- Added `packages/api/src/steel/workbook/repository.spec.ts` with a real `mongodb-memory-server` create/read path through `createMongooseSteelWorkbookRepository`.
- Fixed `packages/api/src/steel/workbook/repository.ts` by converting workbook documents, sheet subdocuments, column subdocuments, and row subdocuments to plain objects before shaping the public workbook DTO.
- Added workbook handler diagnostics for unexpected 500s: production still hides internals, development returns `errorCategory: steel_workbook_unknown` plus `errorSummary`, and the server logger records the underlying error.
- Verification passed: focused `handlers.spec.ts` + `workbook/repository.spec.ts`, Prettier, `npm run build:api`, and `git diff --check`. `build:api` still reports existing non-Steel TypeScript warnings in app/config/cache/middleware files; no new Steel warnings remain.

# Steel OAuth Chat Workbook Layout

- [x] Document the approved UI layout plan.
- [x] Add failing tests for gpt-5.5-only model behavior, workbook panel toggle, and draggable divider resizing.
- [x] Remove the gpt-5.4 model option and model selector from `/steel/oauth-chat`.
- [x] Add right-header workbook panel open/close icon behavior.
- [x] Add desktop workbook divider dragging with min 100px, max chat view width minus 200px, and default 1:1 sizing.
- [x] Verify focused client tests, formatting, filtered typecheck, diff hygiene, and browser smoke where possible.

## Review

- Added `docs/plans/2026-06-02-steel-oauth-chat-workbook-layout.md` with the approved UI implementation plan.
- Removed the model selector from `/steel/oauth-chat`; chat requests now always send `model: 'gpt-5.5'`.
- Added a right-header icon-only workbook toggle using `Hide workbook` / `Show workbook` aria labels.
- Added a desktop workbook divider with mouse drag resizing. The panel defaults to `50%`, clamps to a `100px` minimum, and clamps maximum width to layout width minus `200px` chat space.
- Workbook hide/show keeps workbook state intact; it only removes the panel from the layout.
- Verification passed: focused `SteelOAuthChat` Jest red/green suite, Prettier, filtered client typecheck for Steel UI files, and `git diff --check`.
- In-app browser smoke could not reach the route because the browser session blocked localhost navigation with `net::ERR_BLOCKED_BY_CLIENT`; no UI data-changing browser actions were attempted.

# Steel Workbook Loading Bug Fix

- [x] Add a regression test for failed workbook initialization showing an error instead of infinite loading.
- [x] Confirm the regression test fails against the current UI behavior.
- [x] Add explicit workbook initialization state, error display, and retry behavior.
- [x] Verify focused client tests, formatting, typecheck filter, and diff hygiene.

## Review

- Root cause: `SteelOAuthChat` did not catch `createSteelWorkbook` failures, so `workbook` stayed `null` and `SteelWorkbookPreview` rendered `Workbook loading` forever.
- Added a regression test that rejects `createSteelWorkbook`, verifies the error is visible, verifies loading disappears, and verifies `Retry workbook` reloads the workbook.
- Added explicit workbook loading/error state in `SteelOAuthChat` and passed it into the workbook preview.
- Added a retryable error state in `client/src/features/steel/workbook/Preview.tsx`.
- Verification passed: focused SteelOAuthChat Jest, Prettier, filtered client typecheck for Steel UI files, and `git diff --check`.

# Steel Workbook UI Patch Slice

- [ ] Extend workbook DTOs so seven-sheet quote workbooks have renderable sheet/column/row metadata.
- [ ] Extend Mongo workbook and patch schemas so workbook JSON is durable app state, not a one-time attachment.
- [ ] Add backend workbook service/repository for create, read, and optimistic-version patch.
- [ ] Register workbook API routes under `/api/steel/workbooks`.
- [ ] Add a reusable LibreChat workbook preview that renders tabs, rows, and recent patch highlights.
- [ ] Wire the current Steel route to create/read a workbook and apply multi-turn patch responses.
- [ ] Verify focused data-provider, data-schemas, API, route, and client tests plus builds/diff checks.

## Review

- Extended `packages/data-provider/src/steel/workbooks.ts` so every workbook sheet carries UI-renderable column metadata, rows, selected refs, changed paths, changed summaries, and explicit `set_cell` patch operations.
- Extended `packages/data-provider/src/steel/ai.ts` so Steel chat requests can carry current workbook context and chat responses can carry an accepted `workbookPatch` for UI refresh.
- Extended Mongo Steel workbook schemas so `steel_workbooks` stores full workbook JSON and `steel_workbook_patches` stores operations, selected refs, changed paths, changed summaries, accepted/rejected status, and rejection reason.
- Added `packages/api/src/steel/workbook/` service and Mongoose repository for create/read/optimistic-version patch.
- Registered `POST /api/steel/workbooks`, `GET /api/steel/workbooks/:workbookId`, and `PATCH /api/steel/workbooks/:workbookId` under JWT auth.
- Added data-provider wrappers: `createSteelWorkbook`, `getSteelWorkbook`, and `patchSteelWorkbook`.
- Added reusable LibreChat workbook preview at `client/src/features/steel/workbook/Preview.tsx` and mounted it on `client/src/routes/SteelOAuthChat.tsx`.
- The Steel route now creates a workbook, sends current `workbookId`/`workbookVersion` with chat requests, and refreshes/highlights the preview when a later chat response includes `workbookPatch`.
- Verification passed: data-provider Steel AI/workbook Jest, data-schemas Steel schema Jest, packages/api workbook/handler Jest, api route shell Jest, client SteelOAuthChat Jest, `build:data-provider`, `build:data-schemas`, direct `packages/api` build, filtered client typecheck for new Steel UI files, and `git diff --check`.
- Full `client` typecheck still fails on existing unrelated repository errors; the filtered output no longer contains `SteelOAuthChat` or `client/src/features/steel/workbook/Preview.tsx`.
- Scope correction: `/steel/oauth-chat` remains the full-flow validation harness. Do not move this into formal Steel Workspace or official chat until the user confirms the complete flow.

# Steel Non-Round Hole Calculator Slice

- [x] Create a Supabase migration for non-round hole dimensions on `steel.hole_prices`.
- [x] Update `supabase/schema.sql` with the same `hole_prices` shape.
- [x] Apply and verify the migration on cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- [x] Add repository/tool tests for non-round hole lookup.
- [x] Implement repository/tool support for `oval`, `long`, `rectangular`, and `custom` hole price lookup.
- [x] Add failing calculator tests for round and non-round hole fees.
- [x] Implement `calculate_hole_fee`.
- [x] Run focused tests, build, formatting, and diff checks.

## Review

- Generated `supabase/migration/20260602092407_phase_cd_non_round_hole_prices.sql` with `npx supabase migration new phase_cd_non_round_hole_prices`.
- Added `length_mm`, `width_mm`, and `dimension_label` to `steel.hole_prices`, plus positive-length/width checks and `hole_prices_non_round_lookup_idx`.
- Updated `supabase/schema.sql` with the same current schema snapshot.
- Applied the migration SQL to cloud Supabase through `.env` `STEEL_POSTGRES_URL`; `supabase db push --dry-run` showed remote migration history is not aligned with previously applied migrations, so this task used direct SQL apply and live verification rather than replaying all old migrations.
- Live cloud verification passed for new columns, check constraints, index, and rollback insert smoke for an `oval` 30x15 reviewed hole price row.
- Added non-round hole repository lookup fields and `lookup_hole_price` tool support.
- Added `calculateHoleFee` as a pure backend calculator for round and non-round hole groups.
- Verification passed: repository/tool/calculator red-green Jest suites, combined focused Jest run, `npm run build:api`, `git diff --check`, and required-term grep.
- `npm run build:api` still reports existing non-Steel TypeScript warnings in config/cache/middleware files; no new Steel build failure was introduced.

# Steel Cutting/Hole/Slotting Rule Docs

- [x] Read `docs/reference/instruction.txt` for hole and slotting rules.
- [x] Document confirmed cut-count semantics, including head/tail trim, remainder behavior, and billable vs operation cut counts.
- [x] Document hole-count and slotting-length calculator contracts.
- [x] Sync the active architecture package and v8.3 implementation roadmap.
- [x] Verify Markdown formatting and diff hygiene.

## Review

- Updated `tasks/steel-data-rules-architecture/phase-3-material-rules.md` with confirmed cut-count semantics, hole processing rules, and slotting path rules.
- Expanded hole processing docs so future Admin-reviewed oval, long, rectangular, and custom non-round hole prices are supported by runtime lookup/calculators even when current source rows are missing or `0`.
- Updated `tasks/steel-data-rules-architecture/phase-4-tool-calling.md` so AI
  produces structured cutting/hole/slotting calculation context. Superseded
  correction: backend does not own deterministic quote computation.
- Updated `tasks/steel-data-rules-architecture/checkpoints.md` with rule/tool/manual scenario gates for cut count, holes, and slotting.
- Synced `tasks/v8.3/phase-2-data-tools.md` and `docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md` so the implementation roadmap includes `calculate_cut_count`, hole groups, and slotting paths.
- Verification passed: Markdown Prettier, `git diff --check`, and required-term grep for `calculate_cut_count`, `operationCutCount`, `billableCutCount`, hole groups, and slotting paths.

# Steel Phase 4B Rule Proposal Backend

- [x] Add Phase 4B plan and checkpoint for backend-only proposal creation.
- [x] Add public rule proposal create/read schemas.
- [x] Replace the generic proposal placeholder schema with structured proposal fields.
- [x] Add backend proposal service/repository and authenticated create handler.
- [x] Register `/api/steel/rule-proposals` under JWT auth.
- [x] Verify focused schemas, handler, route, builds, and diff hygiene.

## Review

- Added `tasks/steel-data-rules-architecture/phase-4b-rule-proposal-backend.md` and linked it from the phase map/checkpoints.
- Kept Admin review UI, Admin approval/rejection API, promotion into `steel.calculation_rule_defaults`, and publication into `steel.quote_defaults` deferred for that Phase 4B closeout. Superseded by the current queue above: only Admin review UI remains paused; non-UI backend approval/publish work should be sequenced.
- Added `packages/data-provider/src/steel/rules.ts` with strict public create/response schemas for structured rule proposals.
- Replaced the generic Mongo proposal name/status placeholder with proposal fields, source refs, selectors, adjustable parameters, creator/reviewer metadata, and review queue indexes. Current docs use `steel_rule_proposals` for the proposal surface.
- Added `packages/api/src/steel/rules/` service/repository and `createRuleProposal` handler.
- Registered `POST /api/steel/rule-proposals` under existing JWT auth.
- No Supabase migration was needed in Phase 4B because the proposal surface uses Mongo; the earlier Phase 4A Supabase migration remains the Postgres quote-default schema change.
- Clarified that AI uses tool calling to request proposal creation; backend validation owns persistence, and global/site-managed quote defaults are a future extension module.
- Added the confirmed conversation scenarios for quote-only adjustments, explicit future defaults, unclear scope, multiple candidates, product-price zero handling, and global memory requests.
- Closed Phase 4B scope so remaining Admin review/backend/UI and global quote defaults extension work stays deferred while implementation returns to the core order quoting path.
- Verification passed: focused data-provider/data-schemas/API/route Jest suites and `npm run build:data-provider`, `npm run build:data-schemas`, `npm run build:api`.
- `npm run build:api` still reports existing non-Steel TypeScript warnings in config/cache/middleware files; no new Steel build failure was introduced.

# Steel Phase 4A Quote Default Schema

- [x] Generate a Supabase migration for reviewed calculation defaults and published quote defaults.
- [x] Update `supabase/schema.sql` with the same Phase 4A schema.
- [x] Apply the migration to cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- [x] Verify table columns, constraints, indexes, triggers, and private Steel access posture.
- [x] Update architecture checkpoints/review evidence.

## Review

- Generated the Phase 4A Supabase migration. Current filename and schema naming have been updated to `supabase/migration/20260602035007_phase4a_quote_defaults.sql`.
- Added `steel.calculation_rule_defaults` for Admin-reviewed durable customer/tier/material/product/company calculation defaults.
- Added `steel.quote_defaults` for published task-scoped retrieval entries generated from reviewed facts.
- Kept LibreChat user memory outside Steel Admin-reviewed tables; user memory remains an adapter/retrieval layer, not a persisted site-wide default.
- Updated `supabase/schema.sql` with the same tables, constraints, indexes, and `set_updated_at` triggers.
- Applied the migration to cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- Live cloud verification passed: both tables exist, expected column/constraint/index/trigger counts are present, `anon`/`authenticated` have no grants, and rollback insert smoke passed.
- Verification passed: Markdown Prettier, schema grep, `npm run build:api`, and `git diff --check`.

# Steel Quote Default Layer Boundary Update

- [x] Distinguish LibreChat user memory from Steel Admin-reviewed quote defaults.
- [x] Define priority rules where user custom memory can override reviewed defaults without mutating them.
- [x] Update provider-neutral tool contract so both layers stay scoped, bounded, and backend-validated.
- [x] Update lessons with the new boundary.
- [x] Verify Markdown formatting, required terms, and diff hygiene.

## Review

- Updated `CONTEXT.md` with `LibreChat User Memory` and clarified that it stays separate from reviewed Steel facts.
- Updated Phase 4A so Steel Admin-reviewed quote defaults are the site-managed default retrieval layer, while LibreChat user memory is a user/account-scoped custom memory layer.
- Locked quote-time priority: current quote override first, then applicable LibreChat user memory, then Admin-reviewed customer/tier/company defaults.
- Earlier docs considered `lookup_user_memory` and separate `userMemoryCandidates` handling. Superseding correction: the MVP exposed default lookup tool is `lookup_defaults`; LibreChat user memory remains a later separate adapter.
- Clarified that user memory can override retrieval priority but cannot mutate reviewed Steel facts, invent formula codes, or bypass backend validation.
- Verification passed: Markdown Prettier, required-term grep, and `git diff --check`.

# Steel Quote Default Promotion Architecture

- [x] Separate quote-specific overrides from reusable customer defaults.
- [x] Define rule proposals as the only path from conversation adjustments to Admin-reviewed defaults.
- [x] Define quote defaults as generated task-scoped retrieval over reviewed database facts, not source of truth.
- [x] Define how AI retrieves matching quote defaults through backend tools and scoped filters.
- [x] Update Phase 2/Phase 4/Phase 5 docs and checkpoints with the Admin approval boundary.
- [x] Verify docs formatting, required terms, and diff hygiene.

## Review

- Added `tasks/steel-data-rules-architecture/phase-4a-quote-defaults-architecture.md`.
- Added `Rule Proposal` and `Quote Default` to `CONTEXT.md`.
- Planned lifecycle: quote override -> rule proposal with `needs_review` -> Admin review -> reviewed database rule/default/formula/price row -> generated task-scoped quote defaults.
- Locked that "save as customer default" must not write quote defaults directly; it only creates a structured proposal after required customer/material/charge/formula/parameter fields are known.
- Planned future storage surfaces: proposal surface (`steel_rule_proposals`) and reviewed default surface (`steel.calculation_rule_defaults`) referencing `steel.formula_versions.code` instead of duplicating formulas.
- Planned retrieval surface `steel.quote_defaults`, quote-facing tool `lookup_defaults`, internal/default validation policy, and `select_calculation_rule`.
- Locked retrieval behavior: typed filters first, bounded reviewed candidates only, origin refs required, and backend revalidation before selected quote defaults becomes `selectedCalculationRule`.
- Verification passed: Markdown Prettier, retrieval-contract grep, memory-dump guard grep, and `git diff --check`.

# Steel Phase 2 Adjustable Calculation Rule Overrides

- [x] Extend selected calculation rules so quote defaults/admin defaults can carry adjustable numeric parameters.
- [x] Accept explicit user-provided conversation overrides for numbers or prices without hardcoding those values in code.
- [x] Keep fixed formula identity separate from adjustable parameters.
- [x] Preserve `產品價格.xlsx` zero-as-missing behavior unless a user override supplies the value or a confirmed true-zero rule applies through non-product-price evidence.
- [x] Verify with focused pricing/tool tests, lint, build, smoke, and diff checks.

## Review

- Extended `selectedCalculationRule` with optional `formulaCode`, `defaultParameters`, and `parameterOverrides`.
- `formulaCode` identifies the fixed formula path; `defaultParameters` represent quote defaults/admin defaults; `parameterOverrides` represent explicit user, quote-evidence, or admin adjustments.
- Price decision policy accepts a high-confidence `unitPrice` / `unit_price` override from the selected rule and applies it before rejecting missing prices. Superseding correction: this remains internal policy, not an exposed runtime tool.
- Medium/low-confidence overrides return `parameter_override_not_confirmed`, so the chat flow asks for confirmation instead of silently pricing.
- The selected rule and its override details are returned in `priceDecision.calculationRule` so later calculators can audit which defaults and custom numbers were used.
- Verification passed: focused Steel Jest suites, focused ESLint, `npm run build:api`, built-package user-override smoke, and diff hygiene checks.

# Steel Phase 2 Price Decision Rules

- [x] Add backend price decision contract for ranked candidates.
- [x] Treat `產品價格.xlsx` zero values as missing price, not confirmed free price.
- [x] Require a `quote_default` or Admin-reviewed selected calculation rule before any zero charge becomes confirmed true zero.
- [x] Let the selected calculation rule decide whether the price path skips remainder calculation.
- [x] Require user confirmation when multiple usable price candidates remain.
- [x] Add price-ranking decision policy. Superseding correction: do not expose it as a runtime tool.

## Review

- Added `packages/api/src/steel/pricing/decision.ts` and focused tests for price ranking/decision behavior.
- Added price-ranking decision policy. Superseding correction: `rank_price_candidates` was removed from the executable Steel tool registry; ranking/confirmation stays backend internal policy plus AI explanation.
- Product/material price `0` from `產品價格.xlsx` is rejected with `product_price_zero_is_missing`.
- A zero charge is usable only when the caller supplies a selected calculation rule with `effect = true_zero_charge`, matching `appliesToChargeTypes`, and `confidence = high`.
- The current C-type cutting/hole free-charge behavior is represented as a `quote_default` or Admin-reviewed selected calculation rule, not as product-family hardcoding in pricing code.
- True-zero decisions normalize `valueState` to `true_zero` and use the selected rule's `skipRemainderCalculation` flag.
- Zero cutting/hole values without a selected calculation rule are rejected by default, even for C-type steel.
- Multiple positive usable candidates return `confirm_candidates` so the user chooses before pricing.
- Verification passed at the time for focused Steel Jest suites, focused ESLint, `npm run build:api`, built-package price-decision smoke, and diff hygiene checks. Superseded runtime-tool exposure was later removed.

# Steel Phase 2 AI Spec Clarification

- [x] Add backend contract for AI-proposed quote item candidates.
- [x] Require user confirmation when AI confidence is not high.
- [x] Require user confirmation when multiple plausible spec candidates exist.
- [x] Preserve one high-confidence complete candidate as usable but still traceable to AI inference.
- [x] Add focused tests and export the normalization layer.

## Review

- Earlier slice added `packages/api/src/steel/normalization/clarify.ts` and `resolveSteelQuoteItemCandidates()` as a backend contract for AI-proposed quote item candidates.
- Superseding correction: AI candidate generation stays in reasoning, not a runtime helper. `clarify.ts` / `clarify.spec.ts` were removed, and `normalize_quote_item` must not be exposed as an executable runtime tool.
- AI should ask for confirmation when candidate confidence is not high, when multiple plausible candidates exist, or when required fields are missing.
- Medium/low confidence candidates return `ask_user` with bounded options for user confirmation.
- Multiple plausible candidates return `confirm_candidates` so the chat flow can show choices before pricing.
- Missing required fields return a targeted question naming the missing canonical fields.
- Focused red/green tests passed for the clarification rules. Superseded executor integration was later removed from the runtime tool registry.

# Steel Phase 2 Tool Executor MVP

- [x] Add provider-neutral Steel tool schemas and registry for repository-backed tools.
- [x] Add executor envelopes, bounded logging, per-run call limit handling, and typed errors.
- [x] Sanitize tool results before returning them to any Steel AI provider.
- [x] Wire existing read repositories into tool handlers without raw SQL or raw file access.
- [x] Verify the tool executor with focused red/green tests, API build, and diff hygiene.
- [x] Record deferred scope: real Admin ERP XLSX import and real handbook data SQL/import remain later work.

## Review

- Added `packages/api/src/steel/tools/` with provider-neutral Zod schemas, registry definitions, result envelopes, sanitizer, executor, and tests.
- Implemented repository-backed tools: `lookup_customer`, `search_customers`, `search_price_candidates`, `lookup_spec_price`, `lookup_weight_spec`, `lookup_cutting_price`, `lookup_processing_price`, `lookup_material_rules`, `lookup_formula_version`, `find_order_items`, and `search_source_chunks`.
- The registry deliberately excludes raw SQL, raw Mongo, file-read, and directory-listing tools.
- Tool execution validates arguments before SQL dispatch, enforces optional per-run call limits, returns typed success/error envelopes, and emits bounded log entries with source refs and redaction version.
- Tool output sanitization redacts prompt-injection-like source text and drops undefined fields before returning data to provider adapters.
- Unknown prices remain `null` with `valueState = unknown`; tool code does not convert missing prices to `0`.
- Exported `postgres`, `repositories`, and `tools` through the package root so thin `/api` wrappers can consume the new Steel layers from `@librechat/api`.
- Verification passed: initial red tests failed for missing modules, then focused tool tests passed, repository plus tool tests passed, and `npm run build:api` passed with only existing non-Steel TypeScript warnings.
- Live Supabase cloud smoke through `.env` `STEEL_POSTGRES_URL` passed against the built package: `search_price_candidates` returned a success envelope with zero candidates for a synthetic no-match spec.
- Deferred scope remains unchanged: real Admin ERP XLSX import, import commit/upsert workflows, and real handbook data SQL/import belong to later Phase 5 or explicitly approved data-import work.

# Steel Phase 2 Repository Layer

- [x] Add canonical repository helpers for `source_refs`, `value_state`, and `review_state`.
- [x] Add read repositories for Phase 2 quote facts and source chunks.
- [x] Add validation that rejects malformed `source_refs` before insert serialization.
- [x] Verify the repositories against focused Jest coverage.
- [x] Verify the exported Steel API build boundary and live Supabase cloud schema.

## Review

- Added `packages/api/src/steel/repositories/` with typed query helpers for price items, customers, weight specs, processing/cutting/hole/slotting/bending prices, material rules, formula versions, order items, and source chunks.
- Default quote-facing repository reads filter to `review_state = reviewed` and active rows where the table has `active`; callers can opt into a different review state or inactive records where that is useful for Admin workflows.
- Added `parseSteelSourceRefs()` and `serializeSteelSourceRefsForInsert()` so code validates canonical `source_refs` arrays before writing JSONB values.
- Exported the repository layer through `packages/api/src/steel/index.ts`.
- Focused repository verification passed: 8 Jest suites, 14 tests.
- Steel Postgres plus repository verification passed: 9 Jest suites, 18 tests.
- `npm run build:api` passed. It still emits existing non-Steel TypeScript warnings in config/cache/middleware files, but no new Steel repository warnings.
- Live Supabase cloud read probe through `.env` `STEEL_POSTGRES_URL` passed with `source_refs_array_violations = 0`.
- Hosted Supabase MCP config is present in `.mcp.json`; the endpoint is reachable and returns `401` until the client/user completes OAuth authentication.

# Steel Supabase Cloud Migration Setup And Phase 2 Schema

- [x] Remove Docker-oriented Supabase local-stack setup and root npm scripts.
- [x] Add project MCP config for the hosted Supabase MCP server.
- [x] Update agent docs so Steel uses cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- [x] Generate the Phase 2 schema migration with Supabase CLI.
- [x] Update `supabase/schema.sql` with the same Phase 2 schema changes.
- [x] Apply the migration to the cloud Supabase development database.
- [x] Verify the cloud schema, formatting, and diff hygiene.

## Review

- Removed the root `npm run supabase:*` scripts and the generated local-stack `supabase/config.toml` / `supabase/.gitignore` files.
- Kept Steel runtime database connection on `.env` `STEEL_POSTGRES_URL`; `.env.example` and local-dev docs show the direct Supabase `db.<project-ref>.supabase.co` URL shape first, with the Session pooler documented as a fallback.
- Added project `.mcp.json` for the hosted Supabase MCP server scoped to project ref `iumtsqkuppgopxskuwns`.
- Preserved the canonical singular `supabase/migration/` directory by adding `supabase/migrations` as a symlink for Supabase CLI migration generation only.
- Generated `supabase/migration/20260601101055_phase2_canonical_quote_facts.sql` with `npx supabase migration new phase2_canonical_quote_facts`.
- Updated `supabase/schema.sql` with the same Phase 2 columns, constraints, and indexes.
- Applied the migration to the cloud Supabase development database through `.env` `STEEL_POSTGRES_URL`.
- Live verification passed: required Phase 2 columns, constraints, and indexes are present; `weight_specs.source_ref` and `material_rules.source_ref` are removed; Steel still has 21 tables; `anon` and `authenticated` have no Steel schema/table access.

# Steel Phase 2 Supabase Schema Delta Plan

- [x] Inspect current Supabase schema snapshot and accepted Phase 2 canonical contracts.
- [x] Create a schema delta plan under `tasks/steel-data-rules-architecture/`.
- [x] Link the schema delta plan from the active Phase 2 architecture package.
- [x] Run focused docs verification, Markdown formatting, and `git diff --check`.

## Review

- Created `tasks/steel-data-rules-architecture/phase-2-schema-delta-plan.md` as a review-only plan, not a migration.
- Proposed migration filename `supabase/migration/202606010001_phase2_canonical_quote_facts.sql` for the later implementation step.
- Planned table deltas for source-backed customer/category data, `price_items`, `weight_specs`, `material_rules`, processing/cutting/hole/slotting/bending price tables, cutting adjustments, and formula versions.
- Preserved project schema discipline: later implementation must update both `supabase/schema.sql` and one migration, with Steel tables still in the private `steel` schema.
- Linked the plan from `tasks/steel-data-rules-architecture/README.md`, `phase-2-canonical-data-model.md`, and checkpoints.
- Verification passed: required-contract grep found the plan anchors, plan-safety grep confirmed the plan is not an applied migration, Markdown Prettier completed successfully, and `git diff --check` passed.

# Steel Phase 2 Canonical Contracts

- [x] Record accepted Phase 2 canonical answers from the grill.
- [x] Update source-ref, schema-value, true-zero, material-rule, formula, and tool-boundary contracts across active Phase 2 docs.
- [x] Expand ADR 0002 into a full rationale document.
- [x] Reconcile stale active-looking wording in `tasks/todo.md`, source mapping, and v8.3 planning docs.
- [x] Run focused docs verification, Markdown formatting, and `git diff --check`.

## Review

- Accepted all Phase 2 canonical grill recommendations and updated the active docs package before any schema/code implementation.
- Locked source refs as a canonical `source_refs` JSONB array with `channel`, `factType`, locator, confidence, `sourceVersionId`, `extractedLabel`, and `canonicalKey`; normalized source-ref tables are deferred.
- Locked schema direction for typed product-price unit weight, value/review state, material-rule priority/selectors, formula source/review shape, and nullable unknown price/charge values instead of zero placeholders.
- Narrowed true-zero to Admin-reviewed price/charge facts; zero unit weight remains invalid or unknown unless a later source-specific task proves a real zero-weight concept.
- Clarified Phase 2 tool boundaries: provider-neutral executor only, `normalize_quote_adjustment` is non-mutating, no Phase 2 `apply_workbook_patch` stub, and Phase 3 selected workbook refs use camelCase DTOs without trusted client `currentValue`.
- Expanded `docs/adr/0002-steel-source-priority-policy.md` into a full ADR with status, context, decision, consequences, and rejected alternatives.
- Verification passed: stale-contract grep returned no matches for old Phase 2 terms, required-contract grep found the new anchors, Markdown Prettier completed successfully, and `git diff --check` passed.

# Steel Data Rules Phase 1 Source Inventory

- [x] Read `CLAUDE.md`, Steel lessons, Phase 1 source inventory plan, and data-rule checkpoints.
- [x] Inspect every `docs/reference` source for sheets/headers/row counts/sample evidence.
- [x] Expand `tasks/steel-data-rules-architecture/phase-1-source-inventory.md` with source authority, source-ref strategy, review confidence, and AI/tool usage boundaries.
- [x] Reconcile related checkpoints or source-schema mapping docs if the inventory exposes drift.
- [x] Run focused documentation verification, Markdown formatting, and `git diff --check`.

## Review

- Started Phase 1 as a docs/source-inventory slice. No Supabase schema, migration, parser, runtime import, or tool implementation is in scope for this step.
- Inspected reference source structure: customer workbook rows/header/tiers, product price rows/tier prices/unit weights/processing-like rows, formula workbook rows and CSV encoding caveat, handbook page/section anchors, H-type text rule, cutting workbook sheets/confidence notes, system-order output headers, quote evidence RTF, and legacy XLS shape.
- Expanded `tasks/steel-data-rules-architecture/phase-1-source-inventory.md` with inventory evidence, source-ref locator strategy, source-specific authority semantics, review confidence rules, and AI/tool use boundaries.
- Reconciled formula-source wording in `tasks/v8.3/source-schema-mapping.md` and `tasks/v8.3/phase-2-data-tools.md` to prefer `公式編號.xlsx`; the CSV remains development reference only because current parsing showed an encoding/readability caveat.
- Verification passed: Markdown Prettier, Phase 1/source-ref grep, stale v8.3 formula-CSV runtime grep with no matches, and `git diff --check`.

# Steel Data Rules Phase 0 Grill

- [x] Read `CLAUDE.md`, existing Steel lessons, target Phase 0 decisions, `CONTEXT.md`, downstream data-rule phase docs, and source references.
- [x] Batch all unresolved Phase 0 grill questions with recommended answers.
- [x] Update `CONTEXT.md` immediately when a domain term or relationship changes.
- [x] Update `tasks/steel-data-rules-architecture/phase-0-decisions.md` and related active docs when decision wording changes.
- [x] Run focused docs verification after resolved edits.

## Review

- Started grill pass from `tasks/steel-data-rules-architecture/phase-0-decisions.md`.
- Current evidence: the Phase 0 decisions are already reflected in `CONTEXT.md`; downstream risk is mainly whether source-priority wording is precise enough for Phase 2 schema/tool behavior.
- Resolved grill corrections: product-price unit weight is the main quote weight when reviewed product price data carries one; H-type lengths outside 6M, 9M, 10M, and 12M automatically receive +0.3/kg on material unit price only; customer chat can create quote-specific line adjustments such as no-charge, special price, added surcharge, or one-line rule override.
- Updated `CONTEXT.md`, the Steel data-rules package, `tasks/v8.3/phase-2-data-tools.md`, `tasks/v8.3/source-schema-mapping.md`, `tasks/lessons.md`, and new ADR `docs/adr/0002-steel-source-priority-policy.md`.
- Verification passed: focused term grep for glossary/package/v8.3 links, source-schema grep for `product_price_unit_weight`, `cutting_unit_price`, material rules, quote-specific adjustment, and true zero, stale-wording grep with no matches, Markdown Prettier, and `git diff --check`.

# Steel Data Rules Architecture Work Package

- [x] Record accepted Phase 2 data/rule decisions from the company manual quoting workflow.
- [x] Create a dedicated multi-phase work package under `tasks/steel-data-rules-architecture/`.
- [x] Link the package from the active v8.3 Phase 2 plan so it does not drift from implementation work.
- [x] Update `CONTEXT.md` with the resolved business vocabulary for quote request evidence, material rules, product-price unit weight, and cutting price source.
- [x] Update `tasks/lessons.md` with the new correction patterns.
- [x] Run focused documentation verification.

## Review

- Created `tasks/steel-data-rules-architecture/` as the dedicated package for mapping the real manual quoting workflow into database facts, rule facts, and AI tool-calling contracts.
- Captured the accepted decisions: product-price unit weight is the main quote weight when reviewed product-price data carries it; C-type rules are disclosed to AI only for C-type quote items; H non-standard-length surcharge adjusts material unit price only; product price owns material/product/processing price, while cutting source owns cutting except for explicit reviewed product-price chargeable cutting/processing rows for the requested work; `切工價錢.xlsx` is a formal cutting-price source; customer inquiry files are quote evidence, not formal import sources.
- Added phase files and checkpoints covering source inventory, canonical data/schema, material-rule architecture, tool-calling, Admin update flow, and verification scenarios.
- Updated the active v8.3 Phase 2 plan with a pointer to the new package.
- Updated glossary and lessons so future agents preserve these boundaries.

# V8.3 Phase 1 Foundation Completion Slice

- [x] Record accepted grill decisions and the Traditional Chinese workbook label correction.
- [x] Record that `/steel/oauth-chat` already proves OAuth file support, and confirm the active route is the OAuth Responses API path.
- [x] Split Steel Mongo schemas into `packages/data-schemas/src/schema/steel/` owner files and replace stale `not_run` capability status with `unverified`.
- [x] Restrict Steel OAuth Responses model support to `gpt-5.5`; remove `gpt-5.4` and lower models from the active allowlist.
- [x] Add durable `steel_audit_logs` schema/model and reusable audit service.
- [x] Add Steel conversation services and routes for authenticated, guest, and owner-token read paths.
- [x] Add service-level access checks for `STEEL_GUEST_MODE=true|false`, owner denial, and guest-token denial.
- [x] Keep `/api` wrappers thin and update route tests for guest/auth/admin boundaries.
- [x] Reconcile v8.3 env naming drift: fallback means choosing the API driver instead of OAuth, with no `STEEL_FALLBACK_*` matrix and no fallback model key.
- [x] Add legacy Office source metadata and a server-conversion proof script task: `.xls` / `.doc` may be handled by AI/provider now, while server-side conversion ships only after the script succeeds.
- [x] Run focused data-provider, data-schemas, API, route, build, and diff checks.

## Review

- Added Phase 1 Steel conversation contracts for authenticated and guest creation plus owner/guest-token read responses. These extend the existing Steel data-provider boundary without introducing tenant/org scoping.
- Split Steel Mongo schema/model ownership into `packages/data-schemas/src/schema/steel/`, `packages/data-schemas/src/models/steel/`, and `packages/data-schemas/src/types/steel/`. New collections include `steel_audit_logs` and `steel_source_versions`; capability status now uses `unverified` instead of stale `not_run`.
- Added `steel_audit_logs` model support and `createMongooseSteelAuditRecorder()` as the reusable Phase 1 audit primitive.
- Added Steel conversation repository/service coverage for authenticated create, guest create, guest-mode disabled denial, non-admin user denial, owner-only read, and guest-token hash denial.
- Added thin route wrappers for `POST /api/steel/conversations/authenticated`, `POST /api/steel/conversations/guest`, and `GET /api/steel/conversations/:conversationMetaId`.
- Tightened active Steel OAuth model support to `gpt-5.5` only and removed the stale local proxy runtime helper. The local `openai-oauth` proxy remains manual diagnostics only; the coded runtime path is direct `openai-oauth-provider`.
- Reconciled active v8.3 docs so fallback means explicitly choosing the `openai_api` driver. No `STEEL_FALLBACK_*`, `STEEL_OPENAI_OAUTH_AUTO_FALLBACK`, or fallback-model contract remains in active runtime docs/code.
- Added `npm run steel:prove-office-conversion` in `packages/api` as the development proof gate for `.xls` / `.doc` server-side conversion. Runtime conversion is still not enabled until a real converter proof succeeds; this machine currently has no `soffice`/`libreoffice` binary on `PATH`, so the script fails clearly with status `2` against `docs/reference/legacy/客戶資料.xls`.
- Verification passed: focused data-provider Steel Jest, data-schemas Steel Jest, API Steel config/provider/models/conversation/handler Jest, API Steel Postgres Jest, API route Jest, `build:data-provider`, `build:data-schemas`, `build:api`, touched-file ESLint, conversion-proof CLI help, stale-contract grep, Markdown subset Prettier check, and `git diff --check`.
- Caveat: `build:api` still emits existing repo-wide TypeScript warnings in non-Steel files such as `agents/resources.ts`, `app/config.ts`, `endpoints/config/*`, `cache/cacheFactory.ts`, `middleware/remoteAgentAuth.ts`, and `middleware/share.ts`. The Steel-specific missing export warnings were fixed by exporting Steel model creators from `@librechat/data-schemas`.

# V8.3 Phase 1 Follow-Up: LibreOffice Proof And Diff Review

- [x] Install or locate LibreOffice/soffice locally.
- [x] Rerun `steel:prove-office-conversion` against legacy `.xls` references.
- [x] Review the current Phase 1 diff for defects before any Phase 2 work.
- [x] Record proof and review result.

## Review

- Installed LibreOffice through Homebrew cask; `soffice` is now linked at `/opt/homebrew/bin/soffice`.
- `npm run steel:prove-office-conversion -- ../../docs/reference/legacy/客戶資料.xls ../../docs/reference/legacy/產品價格.xls` passed and produced `.xlsx` outputs under `/var/folders/.../T/steel-office-conversion-*`.
- No `.doc` legacy fixtures currently exist under `docs/reference`; only `docs/reference/legacy/客戶資料.xls` and `docs/reference/legacy/產品價格.xls` were available for proof.
- Review finding P1: `GET /api/steel/conversations/:conversationMetaId` does not run auth middleware, so normal logged-in owner reads will not populate `req.user`; authenticated conversation records then return 401 unless some unrelated upstream middleware has already set `req.user`.
- Review finding P2: conversation access errors return the Error class name as `errorCategory`, losing the service's typed category such as `steel_guest_mode_disabled` or `steel_quote_access_denied`.
- Resolved P1 before closing Phase 1: conversation reads now run JWT auth unless `x-steel-guest-token` is present, preserving owner reads while still allowing guest-token reads.
- Resolved P2 before closing Phase 1: Steel conversation access errors now return typed `errorCategory` values.
- Phase 1 is closed after rerunning focused data-provider, data-schemas, API, route, build, lint, conversion proof, formatting, and diff checks. Do not start Phase 2 until explicitly requested.

# V8.3 Phase 1 Conversion Proof Output Directory

- [x] Change `steel:prove-office-conversion` output from OS temp folders to `tmp/steel-office-conversion/`.
- [x] Reuse the repo-level `tmp/` ignore rule for conversion proof artifacts.
- [x] Rerun the conversion proof and diff checks.

## Review

- `steel:prove-office-conversion` now writes converted `.xlsx` / `.docx` files to `tmp/steel-office-conversion/`.
- Root `tmp/` is already ignored by git so conversion proof artifacts remain local-only.
- Removed stale OS temp `steel-office-conversion-*` folders created by earlier proof runs.

# V8.3 Phase 1 Temp Directory Unification

- [x] Move `steel:prove-office-conversion` output to root `tmp/steel-office-conversion/`.
- [x] Remove the redundant `packages/api/.tmp/` ignore rule and local artifacts.
- [x] Rerun conversion proof, ignore checks, formatting/lint, and diff checks.

## Review

- The package-local `packages/api/.tmp/` path is removed from `.gitignore` and from local disk.
- `npm run steel:prove-office-conversion -- ../../docs/reference/legacy/客戶資料.xls ../../docs/reference/legacy/產品價格.xls` now writes both files under root `tmp/steel-office-conversion/`.
- `git check-ignore` confirms the generated `.xlsx` outputs are covered by the existing root `tmp/` rule.

# V8.3 File Analysis Instructions Management

- [x] Record plan for confirming the instruction management contract.
- [x] Add focused regression coverage for Admin config updates to `fileAnalysis.instructions`.
- [x] Add focused regression coverage for runtime config override merge of `fileAnalysis.instructions`.
- [x] Update Steel OAuth docs with the management path and Admin Panel UI follow-up.
- [x] Run focused tests, docs grep, and diff checks.

## Review

- Confirmed the current management path is config-driven, not provider-adapter code: local/base config uses `librechat.yaml`, and Admin config overrides can patch `fileAnalysis.instructions`.
- Confirmed the runtime path: merged `AppConfig.fileAnalysis.instructions` reaches request config; Steel prefixes it only for image/PDF file-bearing user messages, and normal LibreChat file formatting uses the same runtime instruction text without mutating stored user text.
- Added Admin config handler coverage for `PATCH /api/admin/config/:principalType/:principalId/fields` with `fieldPath: "fileAnalysis.instructions"`.
- Added config override merge coverage proving DB/YAML overrides deep-merge `fileAnalysis.instructions` into runtime `AppConfig`.
- Updated Steel OAuth setup docs, v8.3 active spec, Phase 3 prompt-order notes, and checkpoints. The docs now distinguish `fileAnalysis.instructions` from LibreChat `ocr` config and record that a dedicated Admin Panel textarea should edit this same field.
- Verification passed: focused Admin config Jest, config resolution Jest, touched-file ESLint, Prettier write check, docs grep, and `git diff --check`.
- Caveat: this slice confirms and documents the backend/API management contract; it does not add the dedicated Admin Panel visual editor field yet.

# V8.3 Steel OAuth Image Detail High

- [x] Record plan for forcing highest OpenAI image detail.
- [x] Add failing provider test for image file `imageDetail: high`.
- [x] Set OpenAI image detail to `high` for Steel OAuth image file parts.
- [x] Run focused provider tests, lint, API build, and diff checks.

## Review

- User asked to use the highest `imageDetail` setting first, before adding image preprocessing.
- Scope is Steel OAuth provider image inputs only: `image/*` file parts get OpenAI `imageDetail: high`; PDF inputs remain `input_file` and are not affected by image detail.
- Added provider coverage proving image file parts include `providerOptions.openai.imageDetail = high`.
- Verified focused provider tests, touched-file ESLint, API build, and `git diff --check`.
- `build:api` still emits existing TypeScript warnings outside this slice but exits 0.

# V8.3 Steel OAuth Chat Reasoning Controls

- [x] Record plan for reasoning effort selector and New Chat reset.
- [x] Add failing tests for request-level reasoning effort override.
- [x] Add failing UI tests for selector payload and New Chat reset.
- [x] Implement data-provider and Steel backend support for `reasoningEffort`.
- [x] Add `/steel/oauth-chat` selector for `low`, `medium`, `high`, and `xhigh`.
- [x] Add `/steel/oauth-chat` New Chat button that clears local chat state.
- [x] Run focused tests, lint, builds, and diff checks.

## Review

- User asked for `/steel/oauth-chat` to switch reasoning effort directly from the UI and add a New Chat button.
- Scope is page-local runtime behavior: selector sends `reasoningEffort` on each chat request, while env config remains the backend default when no request override is provided.
- New Chat should reset local UI state only: messages, input, selected files, pending provider metadata, and send/encoding state.
- Added request contract support for `reasoningEffort: low | medium | high | xhigh`; backend rejects unsupported request values and otherwise falls back to env config.
- Added `/steel/oauth-chat` reasoning selector and a New Chat button that clears the local thread while preserving the selected model and reasoning effort.
- Verified red/green tests for data-provider request schema, Steel handler override/rejection, and UI payload/reset behavior.
- Verification passed: focused Jest suites, touched-file ESLint, `npm run build:data-provider`, `npm run build:api`, `npm run build:client`, and `git diff --check`.
- `build:api` still emits existing TypeScript warnings outside this slice; `build:client` emits existing large-chunk/PWA glob warnings but exits 0.
- Unauthenticated Playwright smoke reached `/login?redirect_to=%2Fsteel%2Foauth-chat`, so visual browser verification requires a logged-in browser/session.

# V8.3 Configurable File Vision Instructions

- [x] Record plan and correction lesson.
- [x] Add failing tests for configurable file instructions.
- [x] Add a shared config-driven file instruction helper.
- [x] Wire the helper into Steel OAuth file messages.
- [x] Wire the helper into normal LibreChat image/document message formatting.
- [x] Keep PDF/image file-analysis guidance configurable and note that Admin Panel UI must edit the same config field.
- [x] Run focused tests and diff checks.

## Review

- User observed rotated JPG Chinese extraction works when the instruction explicitly says images may need rotation and Chinese recognition.
- User clarified this must not be hard-coded in Steel code only: normal LibreChat must inject the same instruction, and Admin Panel UI must be able to update it.
- User also clarified PDFs may wrap images, so PDF/document inputs need the same configurable guidance.
- Added `fileAnalysis.instructions` to the LibreChat config schema and example YAML. The example notes that Admin Panel UI should update this same field instead of baking prompt text into code.
- Added a shared API helper that injects configured instructions only for image or PDF targets and keeps the instruction text out of provider adapters.
- Steel `/api/steel/ai/chat` now prefixes configured file instructions onto file-bearing user messages before calling the OAuth provider, including PDF attachments.
- Normal LibreChat attachment processing now carries the same runtime-only file instruction into prompt formatting for image/document messages without mutating the stored user text.
- Focused verification passed for API helper/Steel handler tests, data-provider config parsing, LibreChat prompt formatting, BaseClient attachment tests, data-provider/data-schemas builds, API build, touched-file ESLint, and `git diff --check`.
- User corrected the boundary: LibreChat's `ocr` config is the Mistral/custom OCR upload pipeline, while this requirement targets OpenAI-native file/image analysis.
- Renamed the config contract from `ocr.instructions` to `fileAnalysis.instructions` so the prompt guidance is not coupled to LibreChat's OCR framework.
- Caveat: this slice records and exposes the shared `fileAnalysis.instructions` config contract for Admin Panel editing, but does not add a dedicated Admin Panel visual editor field yet.

# V8.3 OpenAI OAuth UI File Upload Smoke

- [x] Add a repeatable fixture export command that writes manual smoke files under `tmp/steel-oauth-fixtures/`.
- [x] Include `.txt`, `.pdf`, `.docx`, `.xlsx`, `.png`, and a 90-degree pixel-rotated `.jpg` fixture with English, Chinese, numeric, and sentinel text.
- [x] Add provider-level rotated JPG real-auth smoke before touching browser UI.
- [x] Extend Steel chat request parsing so JSON file payloads reach `sendSteelOAuthChat()` as provider file parts.
- [x] Add `/steel/oauth-chat` file attachment UI and send selected files with the current message.
- [x] Verify focused unit tests, gated real-auth smoke, API build, and browser smoke through `/steel/oauth-chat`.

## Review

- User asked to proceed in order: first disk fixtures, then rotated JPG capability smoke, then `/steel/oauth-chat` UI upload.
- Current file capability fixtures are generated in-memory only; there is no manual fixture directory yet.
- Current `/steel/oauth-chat` UI only sends text and the backend route only parses message role/content, so browser upload requires both client and handler changes.
- Added `npm run steel:export-oauth-fixtures` in `packages/api`; it writes manual files to `/Users/neven/Documents/projects/LibreChat/tmp/steel-oauth-fixtures/`.
- Exported files: `steel-oauth-smoke.txt`, `steel-oauth-smoke.pdf`, `steel-oauth-smoke.docx`, `steel-oauth-smoke.xlsx`, `steel-oauth-smoke.png`, `steel-oauth-smoke-rotated.jpg`, and `manifest.json`.
- Added browser-safe file DTO shape `files[].dataBase64` and backend decode into provider `Uint8Array` file parts.
- Added `/steel/oauth-chat` attachment control, selected-file chips, and JSON file payload sending.
- Provider-level rotated JPG strict smoke currently classifies as parse-wrong: it extracts the sentinel, English, and number, but misses the Chinese phrase from the 90-degree rotated JPG.
- Browser smoke passed through `/steel/oauth-chat` with `steel-oauth-smoke.txt`: request included `files[].dataBase64`, filename `steel-oauth-smoke.txt`, media type `text/plain`, and the assistant response contained `TXT_SENTINEL_7F3A`, `鋼鐵檔案測試`, and `73921`.
- Manual rotated JPG UI smoke through `/steel/oauth-chat` read `JPG_ROTATED_SENTINEL_C5F9`, `Steel OAuth capability smoke`, and `73921`, but misread the Chinese phrase as `钥鏈檔案測試` instead of `鋼鐵檔案測試`; classify this as parse-wrong, not passed.
- Follow-up manual prompt test passed when the injected/user prompt explicitly said the Chinese text is Traditional Chinese; this points to prompt-language guidance as the primary fix before escalating to model or reasoning-effort changes.
- Created local browser-smoke account `steel.oauth.ui.smoke.20260527@example.com` for this verification run.

# V8.3 OpenAI OAuth File Capability Smoke

- [x] Confirm scope change: text-only `/steel/oauth-chat` smoke was manually proven.
- [x] Exclude `steel-oauth-smoke.jpg`; PNG image coverage is enough for this slice.
- [x] Add generated non-secret fixtures with English, Chinese, numeric content, and unique sentinels.
- [x] Add provider-level file-part adapter coverage before live OAuth file smoke.
- [x] Run gated `openai_oauth_responses` real-auth smoke for TXT, PDF, DOCX, XLSX, and PNG.
- [x] Classify each result as passed, unsupported, parse-wrong, or request/adapter failure.
- [x] Record commands, smoke evidence, skipped checks, and remaining risks.

## Review

- User confirmed text OAuth is already manually working.
- The remaining question is whether `openai_oauth_responses` can analyze uploaded document/image contents: `.txt`, `.pdf`, `.docx`, `.xlsx`, and `.png`.
- This is a provider-level capability probe, not a `/steel/oauth-chat` browser upload test, because the current smoke page only sends text messages.
- Added generated in-memory fixtures for `.txt`, `.pdf`, `.docx`, `.xlsx`, and `.png`. Each fixture contains English text, Chinese text, numeric text, and a unique sentinel. `.jpg` is intentionally excluded.
- Added provider adapter coverage proving message file attachments are serialized as AI SDK file parts, `passThroughUnsupportedFiles` is forwarded, and abort signals reach the provider call.
- Focused non-live verification passed for `config.spec.ts`, `fixtures.spec.ts`, `provider.spec.ts`, `provider.real-auth.manual.spec.ts`, and `provider.file-capability.manual.spec.ts`; gated manual specs are skipped unless their env flags are enabled.
- Real-auth smoke command passed with `STEEL_OPENAI_OAUTH_AUTH_FILE="~/.codex/auth.json"`, `STEEL_OPENAI_DEFAULT_MODEL=gpt-5.4`, `STEEL_OPENAI_REASONING_EFFORT=medium`, and `NODE_OPTIONS=--experimental-vm-modules`.
- Real-auth classification: TXT passed in 4.641s, PDF passed in 14.108s, DOCX passed in 5.724s, XLSX passed in 6.278s, and PNG passed in 3.606s.
- Earlier manual-spec auth failure exposed a resolver mismatch: direct tests used the raw `~/.codex/auth.json` string instead of the backend auth-file resolver. The text and file-capability manual specs now use `resolveSteelOpenAIOAuthAuthFilePath()`.
- Regression smoke for the existing text real-auth manual spec passed with the literal `~/.codex/auth.json` env value.
- `npm run build:api` passed with the existing `cacheFactory.ts` Redis/KeyvRedis type warning; `git diff --check` passed.

# V8.3 OpenAI OAuth Provider Real Auth

- [x] Write dedicated implementation plan with todo checklist.
- [x] Confirm the plan before implementation.
- [x] Add requested Steel OpenAI env keys to `.env.example`, plan, runbook, and lessons.
- [x] Add AI SDK/openai-oauth-provider dependencies and overrides.
- [x] Add Steel OpenAI runtime env parser.
- [x] Add provider DTO contracts and sanitized response types.
- [x] Implement direct `openai-oauth-provider` adapter with fake-auth tests.
- [x] Add real-auth manual smoke test gated by env.
- [x] Add authenticated `/api/steel/ai/chat` route.
- [x] Add minimal LibreChat Steel OAuth chat surface.
- [x] Run focused automated verification.
- [ ] Run local real-auth browser smoke.
- [x] Record results and remaining risks.

## Review

- Plan created at `tasks/v8.3/openai-oauth-provider-real-auth-implementation.md`.
- User approved implementation and added env contract: `STEEL_OPENAI_PROVIDER`, `STEEL_OPENAI_DEFAULT_MODEL`, and `STEEL_OPENAI_REASONING_EFFORT`.
- Dependency path adjusted after npm peer conflict: do not add top-level `ai@6` because `ai-tokenizer@1.0.6` peers on `ai@^5`; install `openai-oauth-provider` plus AI SDK provider packages and call the provider model interface directly.
- Verification: `npm ls openai-oauth-provider @ai-sdk/openai @ai-sdk/provider @ai-sdk/provider-utils` shows a single overridden provider package set; `npm ls ai` shows no top-level `ai` package.
- Implemented `packages/api/src/steel/ai/config.ts`, `packages/api/src/steel/ai/provider.ts`, `POST /api/steel/ai/chat`, and the minimal authenticated client route at `/steel/oauth-chat`.
- Added gated real-auth manual spec `packages/api/src/steel/ai/provider.real-auth.manual.spec.ts`.
- Live provider smoke passed with local `~/.codex/auth.json`: expected text `librechat-steel-oauth-live-ok`, provider `openai_oauth_responses`, model `gpt-5.4`, response ID present, usage present, and no secret-shaped fields in the returned DTO.
- Focused tests passed: `packages/data-provider/src/steel/ai.spec.ts`, `packages/api/src/steel/ai/config.spec.ts`, `packages/api/src/steel/ai/provider.spec.ts`, `packages/api/src/steel/handlers.spec.ts`, and `api/server/routes/__tests__/steel.spec.js`.
- Build verification: `npm run build:data-provider` passed; `npm run build:api` passed with the pre-existing Redis `KeyvRedis` type warning in `packages/api/src/cache/cacheFactory.ts`.
- Frontend verification: touched-file ESLint passed. `npm run build:client` remains blocked before this Steel route by missing root resolution for `framer-motion` from `packages/client/dist/index.es.js`; `client npm run typecheck` has many existing repo-wide errors and no Steel route errors in the filtered output.
- Remaining risk: full browser smoke through a running LibreChat server is not done in this slice.

# V8.3 Phase 1 Platform Foundation Grill

- [x] Read project guidance, lessons, context, memory, and the target Phase 1 plan.
- [x] Cross-check unresolved Phase 1 decisions against current code and v8.3 docs.
- [x] Ask the user one batched set of unresolved questions with recommended answers.
- [x] Record the grill review result after decisions are resolved.

## Review

- Reviewed `tasks/v8.3/phase-1-platform-foundation.md` against live Steel context, v8.3 roadmap/spec docs, setup runbooks, ADRs, current route shells, Steel DTOs, Mongo schema scaffolding, access helpers, and provider seam code.
- User agreed to all recommendations: Phase 1 now expects direct `openai-oauth-provider` as the coded path, a full foundation gate rather than the earlier partial slice, split Mongo schema files, durable `steel_audit_logs`, real conversation routes, `unverified` capability status vocabulary, and docs-only production `verify-full` policy until deployment CA details are known.
- Updated Phase 1/checkpoint/runbook/ADR docs to remove stale local-proxy-primary wording and clarify the expected Phase 1 implementation outcome.

# Pre-commit Markdown Formatting

- [x] Add `*.md` prettier formatting to `.husky/lint-staged.config.js`.
- [x] Verify lint-staged config loads and formatting checks pass.
- [x] Record review evidence.

## Review

- Added a `*.md` lint-staged entry that runs `prettier --write`.
- Verification: `node -e "console.log(require('./.husky/lint-staged.config.js'))"` loaded the config and showed the new Markdown rule.
- Verification: `npx prettier --check .husky/lint-staged.config.js tasks/todo.md` passed.
- Verification: `git diff --check -- .husky/lint-staged.config.js tasks/todo.md` passed.

# V8.3 Remove OAuth Transport Selector

- [x] Remove `STEEL_OPENAI_OAUTH_TRANSPORT` from `.env.example`.
- [x] Remove env-controlled local proxy mode from setup/spec/phase docs.
- [x] Update `tasks/lessons.md` with the direct-provider-only env rule.
- [x] Run focused grep verification and `git diff --check`.

## Review

- Removed `STEEL_OPENAI_OAUTH_TRANSPORT` from `.env.example`; Steel OAuth env now only exposes `STEEL_OPENAI_OAUTH_RESPONSES_ENABLED` and `STEEL_OPENAI_OAUTH_AUTO_FALLBACK`.
- Removed env-controlled local proxy/provider-mode language from setup/spec/phase docs. Direct `openai-oauth-provider` is now the only coded runtime path; local proxy remains manual smoke-probe material only.
- Verification: focused grep found no active `STEEL_OPENAI_OAUTH_TRANSPORT` or `STEEL_OPENAI_OAUTH_LOCAL_PROXY_BASE_URL` assignment in `.env.example`, setup/spec env blocks, or v8.3 task docs.
- Verification: `git diff --check -- .env.example docs/steel-openai-oauth-responses-setup.md docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md tasks/v8.3/README.md tasks/v8.3/phase-0-decisions.md tasks/v8.3/phase-1-platform-foundation.md tasks/v8.3/phase-3-quote-workbook-mvp.md tasks/v8.3/openai-oauth-provider-spike.md tasks/lessons.md tasks/todo.md` passed.

# V8.3 Direct Provider Base URL Cleanup

- [x] Remove active `STEEL_OPENAI_OAUTH_RESPONSES_BASE_URL` from `.env.example`.
- [x] Clarify that the localhost `/v1` URL is local-proxy-only manual diagnostic material, not runtime env.
- [x] Update setup/spec/phase docs and `tasks/lessons.md`.
- [x] Run focused grep verification and `git diff --check`.

## Review

- Removed active `STEEL_OPENAI_OAUTH_RESPONSES_BASE_URL` from `.env.example`; direct provider mode now has no active `/v1` URL.
- Superseded: a later correction removed the transport selector entirely; local proxy is now manual diagnostic material only, not runtime env.
- Updated setup runbook, active v8.3 spec, Phase 3 provider notes, and lessons so URL semantics are local-proxy-only.
- Verification: focused grep found no `STEEL_OPENAI_OAUTH_RESPONSES_BASE_URL` assignment in `.env.example`, setup runbook, active spec, or task docs.
- Verification: `git diff --check -- .env.example docs/steel-openai-oauth-responses-setup.md docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md tasks/v8.3/phase-3-quote-workbook-mvp.md tasks/lessons.md tasks/todo.md` passed.

# V8.3 .env.example Fallback Key Rename

- [x] Rename simplified `.env.example` fallback switch from `STEEL_OPENAI_API_ENABLED` to `STEEL_OPENAI_OAUTH_AUTO_FALLBACK`.
- [x] Sync v8.3 setup/spec env blocks so the key describes automatic OAuth fallback behavior.
- [x] Update `tasks/lessons.md` with the fallback-key naming rule.
- [x] Run focused grep verification and `git diff --check`.

## Review

- Renamed the simplified operator-facing fallback switch to `STEEL_OPENAI_OAUTH_AUTO_FALLBACK=false` in `.env.example`.
- Synced the setup runbook and active v8.3 spec env blocks, and added wording that the flag means automatic reroute from OAuth primary to `openai_api`, still gated by passed capability smoke results.
- Verification: grep found the new key in `.env.example`, setup runbook, active spec, todo, and lessons; old `STEEL_OPENAI_API_ENABLED` remains only as explanatory text in the lesson/todo correction, not as an env assignment.
- Verification: `git diff --check -- .env.example docs/steel-openai-oauth-responses-setup.md docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md tasks/lessons.md tasks/todo.md` passed.

# V8.3 .env.example Steel AI Routing Simplification

- [x] Simplify `.env.example` Steel AI provider routing to only operator-facing switches and URL.
- [x] Update `tasks/lessons.md` with the env-example simplification rule.
- [x] Run focused env grep and `git diff --check`.

## Review

- Reduced `.env.example` Steel AI routing to `STEEL_OPENAI_OAUTH_RESPONSES_ENABLED` and the fallback switch later renamed to `STEEL_OPENAI_OAUTH_AUTO_FALLBACK`; later corrections removed transport/proxy URL env entirely.
- Detailed provider defaults remain documented in the v8.3 plan/runbook, but are no longer exposed as sample env knobs.
- Verification: focused grep found no removed internal Steel AI routing env keys in `.env.example`.
- Verification: `git diff --check -- .env.example tasks/lessons.md tasks/todo.md` passed.

# V8.3 openai-oauth Primary Decision Correction

- [x] Record user correction: Vercel AI SDK 6 is Apache-2.0, production-approved, and should be unified through overrides/resolutions.
- [x] Update `tasks/lessons.md` with the dependency decision pattern.
- [x] Update the openai-oauth provider spike result so AI SDK 6 is no longer a blocker.
- [x] Update v8.3 README, checkpoints, Phase 1, Phase 3, setup runbook, and active spec so `openai-oauth` is primary with unified AI SDK versions.
- [x] Run focused grep verification and `git diff --check`.
- [x] Record review evidence in this file.

## Review

- Updated `tasks/lessons.md` with the correction pattern: AI SDK 6 is Apache-2.0, production-approved, not a blocker, and must be unified through package-manager overrides/resolutions when `openai-oauth-provider` is used.
- Updated the provider spike result, v8.3 README, Phase 0, Phase 1, Phase 3, checkpoints, setup runbook, active v8.3 spec, and `.env.example` so direct `openai-oauth-provider` is the preferred primary path after version unification and packaging verification.
- Local HTTP proxy wording is now diagnostic/fallback local-dev only; direct provider production use is represented by `STEEL_OPENAI_OAUTH_ALLOW_PRODUCTION=true`, while proxy production hosting remains blocked by `STEEL_OPENAI_OAUTH_LOCAL_PROXY_ALLOW_PRODUCTION=false`.
- Verification: focused stale-term grep across `tasks/v8.3`, the setup runbook, active spec, `tasks/todo.md`, and `.env.example` returned no stale direct-provider blocker/local-proxy-default hits.
- Superseded verification: later env simplification removed active proxy-production/internal keys from `.env.example`; those details remain in setup/spec docs only.
- Verification: `git diff --check` passed.

# V8.3 openai-oauth-provider Compliance And Dependency Spike

- [x] Record the direct-provider spike scope before running isolated dependency tests.
- [x] Create an isolated `/tmp` Node project and install `openai-oauth-provider` with its AI SDK peers without changing LibreChat package files.
- [x] Verify package metadata, license, peer dependency, ESM/runtime import behavior, and transitive dependency footprint.
- [x] Run a mocked direct-provider smoke that proves `createOpenAIOAuth()` can call `/responses` through injected fetch without a real OAuth token.
- [x] Run a minimal live direct-provider text smoke with local Codex auth without printing tokens or request headers.
- [x] Compare direct provider path against the local HTTP proxy path for LibreChat integration risk.
- [x] Update the v8.3 phase plan/runbook with the spike result.
- [x] Run focused verification and `git diff --check`.
- [x] Record final spike evidence and next implementation choices in this file.

## Review

- Created isolated spike project at `/tmp/lc-openai-oauth-provider-spike`; installed `openai-oauth-provider@1.0.3`, `ai@6.0.191`, `@ai-sdk/openai@3.0.65`, `typescript@6.0.3`, and `tsx@4.22.3`. No LibreChat package files were changed.
- Package metadata: `openai-oauth-provider@1.0.3` is `AGPL-3.0-only`; it depends on AI SDK 6-era packages and introduced duplicate AI SDK provider/openai package versions in the isolated install.
- Import/runtime checks: Node 22.17.1 could both `require('openai-oauth-provider')` and dynamic import it; exported keys were `createOpenAIOAuth`, `deriveAccountId`, `loadAuthTokens`, `openai`, and `parseJwtClaims`.
- TypeScript check passed with `moduleResolution=bundler`; `createOpenAIOAuth()` returned a model accepted by AI SDK `generateText()`.
- Mocked smoke passed: fake auth plus mocked `fetch` proved `generateText({ model: openai('gpt-5.4') })` calls `https://chatgpt.com/backend-api/codex/responses`, injects OAuth headers, normalizes the body to `stream: true`, `instructions: ""`, `store: false`, and returns text/usage/provider metadata from mocked SSE.
- Live smoke passed with local `~/.codex/auth.json`: `gpt-5.4` returned exactly `librechat-provider-live-ok`; output included usage and provider metadata, and no token material or request headers were printed.
- Superseded decision: the later user correction approves AI SDK 6 for production and makes direct `openai-oauth-provider` the coded provider path, with package-manager overrides/resolutions required to unify AI SDK package versions. Keep local HTTP proxy only as a manual diagnostic smoke probe.
- Added `tasks/v8.3/openai-oauth-provider-spike.md` and updated v8.3 README, Phase 1, Phase 3, checkpoints, setup runbook, and active v8.3 spec with this result.
- Verification: focused grep found the spike result and direct-provider blockers across active docs. `git diff --check` passed.

# V8.3 openai-oauth Provider Research Plan Update

- [x] Research `EvanZhouDev/openai-oauth` README, package surfaces, CLI proxy, direct AI SDK provider, live tests, and license/dependency shape.
- [x] Update the active v8.3 spec with the researched integration decision.
- [x] Update `tasks/v8.3` phase/checkpoint docs so implementation starts with the local HTTP `/v1` proxy path and treats the direct provider package as a gated compatibility/compliance spike.
- [x] Update the openai-oauth setup runbook with concrete commands, smoke probes, and stateless `/v1/responses` constraints.
- [x] Run focused documentation verification and `git diff --check`.
- [x] Record review evidence and next tasks in this file.

## Review

- Researched `EvanZhouDev/openai-oauth` at repo commit `aa526920af322568968a30fe820b2b9d55545f8a`; npm metadata reported `openai-oauth@1.0.2` and `openai-oauth-provider@1.0.3`, both `AGPL-3.0-only`.
- Key finding: `openai-oauth` CLI/local server exposes an OpenAI-compatible localhost `/v1` surface with `/v1/models`, `/v1/responses`, and `/v1/chat/completions`; `/v1/responses` is stateless and rejects provider replay state such as `previous_response_id` / `item_reference`.
- Superseded finding: the later dependency correction approves AI SDK 6 for production; direct `openai-oauth-provider` is now the preferred primary path once AI SDK package versions are unified through overrides/resolutions and packaging is verified.
- Superseded update: a later correction changed this to direct `openai-oauth-provider` primary path, with local HTTP proxy retained only for diagnostic/fallback local-dev adapter tests.
- Setup runbook now includes `npx @openai/codex login`, `npx openai-oauth@latest --host 127.0.0.1 --port 10531`, optional `--models`, `/health`, `/v1/models`, and `/v1/responses` smoke probes.
- Superseded verification: active v8.3 docs now keep the stateless replay constraints, but no longer treat AI SDK 6 or direct-provider usage as blockers.
- Verification: `git diff --check -- tasks/todo.md tasks/v8.3 docs/steel-openai-oauth-responses-setup.md docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md` passed.

# V8.3 Phase 1 Foundation And OAuth Proxy Start

- [x] Record the Phase 1/2 start decisions and user corrections before implementation.
- [x] Inspect existing LibreChat model/default setting, role/admin, route registration, and data-provider patterns before adding Steel-specific seams.
- [x] Update v8.3 phase/checkpoint docs if live code inspection shows the plan needs narrower integration wording.
- [x] Write failing tests for Steel shared DTO contracts and model option/provider capability types.
- [x] Implement the minimal `packages/data-provider/src/steel` public contracts and endpoint/key helpers needed for Phase 1.
- [x] Write failing tests for Steel Mongo schemas, including `steel_` collection names, guest token hash lookup, provider run metadata, and capability smoke result shape.
- [x] Implement minimal Steel Mongo schemas in `packages/data-schemas` without full business behavior.
- [x] Write failing tests for Steel access decisions around `STEEL_GUEST_MODE`, LibreChat ADMIN/USER role handling, and admin route denial for guests.
- [x] Implement Steel access helpers and thin route shells under `/api/steel` and `/api/admin/steel`.
- [x] Write failing tests for backend-owned Steel model options that reuse LibreChat model/default setting concepts where available.
- [x] Implement minimal model option service and provider metadata contracts, keeping `openai_oauth_responses` as the early priority path and `openai_api` as capability-gated secondary.
- [x] Add an early OpenAI OAuth proxy smoke/test seam that can be exercised before full workbook orchestration.
- [x] Keep Phase 2 source-schema mapping changes narrow; treat ERP XLSX columns as stable append-only and tolerate new columns while preserving required-key validation.
- [x] Run focused verification: data-provider build/tests, data-schemas tests/build, packages/api Steel tests/build, and `git diff --check`.
- [x] Record review evidence and remaining next tasks in this file.

## Active Decisions

- Work stays on the current branch.
- Phase 1 implementation comes first: contracts, schemas, routes, auth/role access, audit, provider metadata, and early OAuth proxy seam.
- Phase 2 mapping/schema design can proceed in parallel, but this pass should not make broad Supabase schema changes.
- Model allowlist/default model behavior must adapt to LibreChat's existing model/default setting framework before adding Steel-only behavior.
- Admin route authorization should first use existing LibreChat account role semantics for ADMIN vs USER.
- ERP XLSX fields are basically stable and append-only; future files may add columns but should not rename existing columns.
- OpenAI OAuth as proxy must be developed and tested early enough to guide later workbook and provider adjustments.

## Review

- Implemented the first Phase 1 foundation slice only: shared Steel DTO/provider contracts, endpoint/key helpers, minimal Mongo schema definitions, access helpers, LibreChat model-option adaptation, OpenAI OAuth proxy client seam, and thin `/api/steel` plus `/api/admin/steel` route shells.
- Updated v8.3 docs for the locked corrections: adapt model/default settings through LibreChat first, use existing ADMIN/USER route semantics first, treat ERP XLSX columns as stable append-only, and prioritize an early `openai_oauth_responses` proxy seam.
- Added focused red-first coverage before implementation in `packages/data-provider`, `packages/data-schemas`, `packages/api`, and `api/server/routes`.
- Verification passed for focused Steel tests: data-provider `src/steel/ai.spec.ts` and `src/steel/workbooks.spec.ts`; data-schemas `src/schema/steel.spec.ts`; packages/api `src/steel/access.spec.ts`, `models.spec.ts`, and `oauth.spec.ts`; API route smoke `server/routes/__tests__/steel.spec.js`.
- Verification passed for package builds: `npm run build:data-provider`, `npm run build:data-schemas`, and `npm run build:api`.
- Remaining Phase 1 work: full conversation route behavior, guest token issuance/hash persistence, workbook orchestration schemas beyond public DTOs, audit service wiring, real capability persistence, and real OpenAI OAuth provider smoke. No Supabase schema or migration was changed in this slice.

# V8.3 OpenAI OAuth Responses Package Sync

- [x] Record the v8.3 docs/package scope and user corrections before editing.
- [x] Create the full `tasks/v8.3/` package from the current phase-plan structure.
- [x] Update active v8.3 planning docs for `openai_oauth_responses`, capability-gated fallback keys, and primary/secondary smoke gates.
- [x] Create `tasks/v8.3/source-schema-mapping.md` focused on database-bound spec and price fields, with Chinese ERP sheet names kept for workbook/export interoperability.
- [x] Update mobile Workbook Preview selected-target behavior to support multiple selected targets with clear sheet/field markers.
- [x] Reconcile setup/env/context/ADR docs with the v8.3 decisions.
- [x] Run focused grep/diff verification.
- [x] Record review results.

## Review

- Created the full `tasks/v8.3/` package: README, checkpoints, phases 0-6, and `source-schema-mapping.md`.
- Updated active v8.3 docs around `openai_oauth_responses` as primary and `openai_api` as capability-gated secondary. Removed active v8.3 OpenHarness-era wording from the new package.
- Standardized fallback config to the five requested keys: `STEEL_FALLBACK_REQUIRE_CAPABILITY_PASSED`, `STEEL_FALLBACK_ON_FILE_INPUT_UNSUPPORTED`, `STEEL_FALLBACK_ON_VISION_INPUT_UNSUPPORTED`, `STEEL_FALLBACK_ON_XLSX_INPUT_UNSUPPORTED`, and `STEEL_FALLBACK_ON_HOSTED_TOOL_UNSUPPORTED`.
- Updated `.env.example` and added `docs/steel-openai-oauth-responses-setup.md`; left `docs/steel-chatgpt-oauth-setup.md` as a short superseded pointer.
- Reworked `tasks/v8.3/source-schema-mapping.md` to focus on DB-bound spec, price, formula, and processing-price fields. Chinese workbook sheet names are documented as ERP-facing output labels, not database keys.
- Captured the formula-reference correction: `docs/reference/公式編號 - Sheet1.csv` is a development reference for formula naming/structure; runtime calculator data should come from reviewed app-ready JSON or database rows.
- Updated mobile Workbook Preview planning so a message can carry multiple selected targets. Markers must show sheet and field/cell position; selection overwrites the marker before user text and appends a new marker after user text.
- Updated `CONTEXT.md` with `ERP Workbook Sheet Name` and `Selected Workbook Target`, and added ADR `docs/adr/0001-openai-oauth-responses-primary.md`.
- Updated `tasks/lessons.md` with the correction patterns.
- Verification: focused stale-term grep over active v8.3 docs found no OpenHarness, stale fallback env, stale v8.3 spec filename, `docs/reference/doc`, or single-selected-cell limit.
- Verification: required fallback keys are present in `.env.example`, the openai-oauth setup runbook, the v8.3 spec, task package, and lessons.
- Verification: selected-target checks found multiple-target and sheet/field marker wording in the v8.3 spec, checkpoints, and Phase 3 plan.
- Verification: `git diff --check` passed.

# V8.2 Responses Fallback And Inline Warning Sync

- [x] Record the focused sync scope before editing docs/env examples.
- [x] Update the verified v8.2 spec so `openai_api` is Responses-first and explicit API reroute is env-gated.
- [x] Update `tasks/v8.2` so OAuth unsupported capabilities return typed errors when OpenAI API reroute is disabled.
- [x] Update UI guidance from toast to inline small warning text in the chat transcript.
- [x] Add Steel AI provider/reroute keys to `.env.example`.
- [x] Run focused grep/diff verification.
- [x] Record review results.

## Review

- Answer to Q1: yes, this belongs in both `docs/steel_librechat_plan_v8.2_openharness_verified.md` and `tasks/v8.2` because it changes the provider contract, runtime gates, env behavior, and UI surface.
- Updated the verified v8.2 spec so `openai_api` is Responses-first, preserves LibreChat UI/preset/agent model parameters as requested runtime settings, and uses capability preflight before provider calls.
- Replaced silent fallback language with env-gated API reroute: `STEEL_OPENAI_API_FALLBACK_ENABLED=false` returns typed unsupported errors in local/dev; `true` allows direct reroute to `openai_api` before calling OAuth.
- Updated UI guidance from toast to inline small warning text inside the chat transcript.
- Added Steel AI provider/reroute keys to `.env.example`, including `STEEL_OPENAI_API_FALLBACK_ENABLED=false`, `STEEL_OPENAI_API_RESPONSES_REQUIRED=true`, and `STEEL_PROVIDER_UNSUPPORTED_NOTICE_STYLE=inline_chat_warning`.
- Updated `tasks/v8.2` README, checkpoints, Phase 0, Phase 1, Phase 2, Phase 3, and Phase 6 to match the new contract.
- Updated `docs/steel-chatgpt-oauth-setup.md` so unsupported OAuth capabilities either return typed errors or reroute only when env-enabled.
- Updated `tasks/lessons.md` with the pattern: OpenHarness must not bypass LibreChat settings, and unsupported provider capabilities should use typed errors plus inline chat warning text.
- Verification: required anchors for Responses-first, capability preflight, typed unsupported errors, inline small warning text, and the new env keys are present.
- Verification: stale env/key/path phrases such as `STEEL_OPENAI_API_FALLBACK=true`, `STEEL_FALLBACK_ON_...`, `openai-api-fallback`, and direct fallback policy phrases returned no matches in active spec/task/env docs.
- Verification: `git diff --check` passed.

# V8.2 Admin Route And Setup Runbook Sync

- [x] Record the focused sync scope before editing docs.
- [x] Update the verified v8.2 spec so admin-only Steel routes use `/api/admin/steel/...`.
- [x] Update `tasks/v8.2` phase/checkpoint docs to match the admin route split.
- [x] Add local admin/user account setup runbook.
- [x] Add ChatGPT OAuth binding prerequisite runbook.
- [x] Run focused grep/diff verification.
- [x] Record review results.

## Review

- Updated the verified v8.2 spec API route draft so quote/user routes stay under `/api/steel/...`, while admin diagnostics, source/project management, import/table/memory controls, and eval runs use `/api/admin/steel/...`.
- Updated Phase 3, Phase 5, checkpoints, and README gates so ChatGPT OAuth binding is a prerequisite before real OpenHarness smoke or chat UI live testing, and admin-only source/eval routes are under `/api/admin/steel/...`.
- Added `docs/steel-account-setup.md` with the local admin/user creation flow and the current LibreChat first-registered-user role rule.
- Added `docs/steel-chatgpt-oauth-setup.md` with token-storage rules, binding flow, smoke order, fallback expectations, and evidence requirements.
- Verification: stale route grep for `/api/steel/admin`, `/api/steel/projects`, `/api/steel/sources`, `/api/steel/source-versions`, and `/api/steel/evals` returned no matches across the verified spec and `tasks/v8.2`.
- Verification: required anchors for `/api/admin/steel`, setup docs, ChatGPT OAuth binding, and first-user role behavior are present.
- Verification: `git diff --check` passed.

# V8.2 Phase 0 OpenHarness Lock Pass

- [x] Read `tasks/v8.2/phase-0-decisions.md` after the OpenHarness-verified replan.
- [x] Lock D0.1-D0.15 as the active Phase 0 decision baseline.
- [x] Mark `tasks/v8.2/checkpoints.md` Checkpoint 0 as passed.
- [x] Run focused Phase 0 consistency verification.
- [x] Record review results.

## Review

- Phase 0 is now locked after the OpenHarness-verified v8.2 replan.
- `tasks/v8.2/phase-0-decisions.md` no longer says Phase 0 is superseded.
- `tasks/v8.2/checkpoints.md` Checkpoint 0 is marked passed and its baseline items are checked.
- Focused verification confirmed required anchors for fixed seven-sheet workbook, SteelAIProvider/OpenHarness/OpenAI fallback capability policy, ERP XLSX/Admin upload boundaries, source schema mapping, and the absence of stale old-spec/OpenAI-only planning terms.
- No implementation code was changed; this was the documentation/decision gate required before Phase 1 implementation planning.

# V8.2 OpenHarness Verified Replan

- [x] Read `CLAUDE.md`, `CONTEXT.md`, `tasks/lessons.md`, `docs/steel_librechat_plan_v8.2_openharness_verified.md`, and the current `tasks/v8.2` package.
- [x] Update `tasks/v8.2` to use the OpenHarness-verified Steel AI Provider framework instead of the old OpenAI-first framing.
- [x] Remove stale references to `docs/steel_librechat_plan_v8.2.md` and point the task package at the verified spec file.
- [x] Add provider driver, capability smoke, fallback, model allowlist, file/vision/XLSX evidence, state-trace, and production-risk gates to the phase plans and checkpoints.
- [x] Run focused document consistency checks across `tasks/v8.2`.
- [x] Record review results.

## Review

- Updated `tasks/v8.2/README.md` to point at `docs/steel_librechat_plan_v8.2_openharness_verified.md` and define the OpenHarness-verified phase map.
- Updated Phase 0 with `SteelAIProvider`, `openharness_chatgpt_oauth` default, `openai_api` fallback, provider state boundaries, capability smoke, model selector, and fallback decisions.
- Updated Phase 1 to include AI driver/model/capability/run metadata contracts without implementing full provider behavior yet.
- Updated Phase 2 to keep tools provider-neutral so OpenHarness and OpenAI adapters only serialize tool definitions.
- Rewrote Phase 3 around `SteelAIProvider`, OpenHarness OAuth adapter, OpenAI API fallback adapter, unified `SteelAIEvent`, capability gates, fallback routing, backend model allowlist, and both live provider smoke cases.
- Split the old Phase 4/5 shape into `phase-4-excel-export.md`, `phase-5-admin-source-management.md`, and `phase-6-production-hardening.md`, matching the new spec's phase structure.
- Updated `tasks/v8.2/checkpoints.md` so checkpoints require provider capability smoke, typed provider errors, fallback evidence, and both OpenHarness OAuth plus OpenAI API fallback smoke before Phase 4.
- Focused consistency checks passed: no stale references to `docs/steel_librechat_plan_v8.2.md`, old phase file names, or OpenAI-only Phase 3 adapter/state gates remain in `tasks/v8.2`.

# V8.2 Spec Upgrade

- [x] Read current v8.1 plan package, Supabase schema, and project glossary before writing v8.2.
- [x] Create `steel_librechat_plan_v8.2.md` in Traditional Chinese as an executable development spec.
- [x] Remove external database/enterprise connector planning and replace old import wording with ERP XLSX / Admin Import wording.
- [x] Add Admin ERP XLSX upload policy, seven fixed Workbook sheets, Quote Resolution Engine, eval harness, interfaces, API routes, schemas, and production checklist.
- [x] Verify required v8.2 terms are present and removed v8.1 planning terms are absent.
- [x] Rename `tasks/v8.1` to `tasks/v8.2` and update the phase plans to match `steel_librechat_plan_v8.2.md`.
- [x] Verify `tasks/v8.2` no longer contains stale v8.1-only import, workbook, PDF, or connector assumptions.
- [x] Apply user correction: remove Admin PDF parser/transformation planning and restrict ongoing Admin data uploads to ERP XLSX only.

## Review

- User supplied the v8.2 handoff as the approved design baseline. The task is to consolidate it into one implementation-ready spec file, not to implement runtime code yet.
- Created `steel_librechat_plan_v8.2.md` with 30 core sections plus API route, Mongo schema, Supabase schema, Admin preview, UX, and production checklist drafts.
- Verification checked required v8.2 anchors, TypeScript interface draft names, fixed seven-sheet names, Admin ERP XLSX upload policy, ExcelJS, Supabase PostgreSQL, and removed old connector/import planning terms.
- Renamed the phase-plan package from `tasks/v8.1` to `tasks/v8.2` and rewrote README, checkpoints, and phases 0-5 around v8.2.
- Phase plans now include Admin ERP XLSX upload policy, ERP XLSX Admin Import, fixed seven-sheet Workbook, Quote Resolution Engine, normalization, price search/ranking, stock allocation, deterministic calculators, ExcelJS export, Admin preview, table UI maintenance, handbook-informed schema boundary, and eval harness gates.

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
- This pass should not import or process `docs/reference/doc` source files during planning; later correction scoped the steel handbook DOCX as a schema/data-model reference.
- The requested output location is now `tasks/v8.2/`, so this planning package intentionally uses that path instead of the generic `docs/plans/` convention.
- Created the v8.2 plan package: `README.md`, phase 0-5 plan files, and `checkpoints.md`.
- User corrected guest mode: quote conversation/workbook/export access must be controlled by an environment flag. Enabled means no login or permission required; disabled means login plus admin-approved Steel permission required.
- Grill-with-docs resolved the guest mode default: `STEEL_GUEST_MODE` defaults to `false` and fails closed unless explicitly set to `true`.
- Phase 0 high-risk decisions are now recorded through the export library decision.
- Grill-with-docs resolved the OpenAI state contract: Responses API calls use `conversation` only; `previous_response_id` is mutually exclusive with `conversation` and is stored only for audit/fallback.
- User corrected quote traceability: workbook lines must persist the related formula, database default unit price, quoted unit price, line total, and explicit unit-price/total-price adjustments as permanent workbook data.
- Grill-with-docs resolved workbook price stability: latest database unit price is only the default for new pricing or explicit recalculation; existing workbook prices, quantities, and totals must not change unless the user asks to change that line.
- v8.2 Admin data updates use admin-uploaded ERP export XLSX files; rows missing confirmed ERP lookup keys go to `needs_review`.
- Grill-with-docs resolved retrieval strategy: Steel uses its own PostgreSQL + pgvector retrieval module so required project/source/version/chunk/category/guest filters are enforced server-side.
- Grill-with-docs resolved customer Excel mask: allow only customer quote fields using `quoted_unit_price` and `line_total` for visible prices, and hide `customer_tier` plus internal/debug fields.
- Grill-with-docs resolved async boundary: first prove a real OpenAI chat can create a customer-visible workbook; keep MVP small flows synchronous with payload/timeout limits and defer BullMQ to Phase 5 unless measured scale forces it earlier.
- Grill-with-docs resolved source data readiness: ongoing real data updates flow through ERP XLSX upload or Admin table UI review, then backend API commit; steel handbook DOCX first informs schema/data-model design.
- Current dependency check found `openai@5.8.2` only in the legacy `api` package, and `xlsx@0.20.3` but no `exceljs`; Phase 4 must add ExcelJS deliberately to the backend package that owns customer-facing export rendering.
- Grill-with-docs resolved export rendering: use ExcelJS for customer-facing XLSX output, while keeping `xlsx` for admin import parsing and generated workbook read-back tests unless implementation proves consolidation is better.
- The plan covers all final v8.2 modules through phase ownership: conversation meta, projects, sources, instructions, handbook-informed schema boundary, Admin ERP XLSX source parsing, Admin table maintenance, Admin import, AI merge table, tool registry, OpenAI orchestrator, prompt builder, Quote Resolution Engine, normalization, pricing, stock allocation, calculators, workbook, Excel export, memory, retrieval, evals, audit, repositories, permissions, and async jobs.
- User clarified Phase 0 should not require a live OpenAI smoke test; live provider verification belongs to Phase 3's quote workbook vertical slice.
- User clarified Admin data import flow: export XLSX from ERP, upload through parser, compare with old data, admin confirm, then update the database.
- User clarified DOCX scope again: code agent should first use the steel handbook DOCX to design schema/data model; chat UX development is priority; real handbook data SQL/import implementation comes later.
- User clarified current reference data state: files in `docs/reference/doc` are not database-ready; AI/code agents may reference them for schema and API mock data while prioritizing chat UX, with real data handling deferred.
- User clarified API mock data placement: keep mock data in one shared folder, not separate frontend/backend folders.
- User accepted the API mock export boundary: import mock fixtures through `packages/data-provider/src/steel/mock/`, not the production Steel data-provider barrel.
- User accepted the Phase 3 UI boundary: build an independent Steel workspace first, and use one shared desktop/mobile Steel UX framework rather than separate mobile workflow.
- User clarified mobile workbook UX: open workbook as a full-view modal with top-right close, allow one selected workbook cell to populate a composer marker, submit one structured ref plus user text to AI, and sync returned workbook patches back to the UI.
- User clarified workbook edit targeting: Phase 3 supports one selected cell at a time; workbook data can still be modified across multi-round chat, or by natural-language requests that describe multiple explicit changes for AI to translate into validated patch ops.
- User rejected per-patch preview/confirmation because it slows chat UX; latest accepted workbook updates should be marked by background color on the changed fields.
- User chose latest-update highlight lifetime: keep highlighted changed fields until the next accepted workbook patch replaces them.
- User clarified failed/rejected AI patches should not highlight workbook fields; show the reason in chat and leave workbook/highlight state unchanged.
- User rejected explicit Undo UI; revert/change requests should go through chat and create normal validated workbook patches.
- User accepted short chat summaries for successful AI workbook patches; list changed fields briefly, but do not show a full diff table in chat.
- User accepted contract ownership: public workbook DTOs live in `packages/data-provider/src/steel/workbooks.ts`, backend canonical Zod validation lives in `packages/api/src/steel/workbook/schema.ts`, and frontend/mock data consume shared DTOs without owning workbook validation schema.
- User clarified Chinese source data handling: `docs/reference/doc` is Chinese, so Phase 2 needs a schema mapping from Chinese source labels/headers/terms to English canonical schema keys; programmatic DTO/API/tool/repository/DB query contracts should use English keys while Chinese remains as display/source/alias data.
- User corrected reference-data framing: `docs/reference/doc` can be used to design the real Steel schema/data model, not only mock fixtures; real data SQL/import is deferred to a later code-agent data task that starts from correct data.
- User resolved source-schema mapping decisions: create `tasks/v8.2/source-schema-mapping.md`; do not add typo approval/review-status fields because later code-agent data work should already use correct data; teach AI API the mapping so it can resolve correct schema keys; keep mock data schema-realistic; and design a code-owned source-schema mapping module alongside real schema design.

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
- `docs/reference/doc` contains company reference inputs: `龍頂鋼鐵手冊__文字版.docx` is now scoped as a schema/data-model reference; `公式編號.xlsx`, `客戶資料.xlsx`, `產品價格.xlsx`, and `系統訂單.xlsx` remain reference/import fixtures unless promoted through ERP XLSX import.
- Runtime AI should query normalized database/tool results, not directly inspect XLSX/DOCX reference files for prices or specs.
- The `steel` schema table list contains all 21 expected base tables.
- Trigger wiring is present: `price_items` has `record_price_history`, and every table with an `updated_at` column has `set_updated_at`.
- Rollback smoke test proved `price_items.unit_price` updates write `steel.price_history` with `old_unit_price`, `new_unit_price`, and `last_import_log_id`.
- Do not process or import `docs/reference/doc` files as real data in the chat UX priority path; steel handbook DOCX may inform schema/data-model design, while real data SQL/import comes later.
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

# V8.2 Phase 0 Lock Pass

- [x] Collect all remaining Phase 0 questions in one pass.
- [x] Record user approval for the Phase 0 lock answers.
- [x] Update `tasks/v8.2/phase-0-decisions.md` with the final lock review.
- [x] Run Checkpoint 0 focused verification.

## Review

- User approved all final Phase 0 lock answers.
- Phase 0 is locked with D0.1-D0.14 as the decision baseline.
- Phase 1 implementation should stay narrow around contracts, auth/permission gates, route shells, audit, and foundational schema seams.
- Phase 2 should extend `tasks/v8.2/source-schema-mapping.md`, design `packages/api/src/steel/schema/mapping.ts`, and derive the minimal Supabase schema delta from handbook/mapping work.
- Phase 3 mock data may proceed with locked canonical keys without waiting for full mapping coverage.
- Checkpoint 0 verification passed for fixed workbook sheets, ERP XLSX/DOCX boundary, ExcelJS/Quote Resolution/Eval Harness anchors, and source-schema mapping anchors.
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

# Backend Dev Logger Dependency Fix

- [x] Reproduce the dependency resolution failure from the reported require stack.
- [x] Confirm `packages/data-schemas/dist/config/winston.cjs` directly requires `winston-daily-rotate-file`.
- [x] Move `winston-daily-rotate-file` into `packages/data-schemas` runtime dependencies.
- [x] Keep `winston` as a compatible peer of the existing backend `winston@3.11.0`.
- [x] Verify logger import, dependency tree, package build, and backend HTTP readiness.

## Review

- Root cause: `@librechat/data-schemas` directly imports `winston-daily-rotate-file`, but the package was only declared as a peer and only installed under sibling `api/node_modules`, which Node cannot resolve from `packages/data-schemas/dist`.
- Added root lockfile entries for `winston-daily-rotate-file` and its missing transitive `object-hash` package so workspace resolution works from `data-schemas`.
- `npm ls winston winston-daily-rotate-file --depth=0` passes.
- `npm run build:data-schemas` passes.
- `npm run build:api` passes with the pre-existing Redis `KeyvRedis` TypeScript warning in `packages/api/src/cache/cacheFactory.ts`.
- Existing backend process on `http://localhost:3080` returns `200` for `/api/config`.

# Frontend Dev Workspace Peer Dependency Fix

- [x] Reproduce Vite dependency scan failure for `framer-motion` and `@react-spring/web`.
- [x] Confirm the imports originate from `packages/client/dist/index.es.js`.
- [x] Add Vite aliases for workspace peer dependencies provided by the frontend app.
- [x] Add missing `react-window` dependency required by `react-vtree`.
- [x] Rebuild `packages/client`.
- [x] Smoke-test `npm run frontend:dev` on an alternate port.

## Review

- Root cause: Vite resolves `@librechat/client` through the workspace package realpath, so peer imports from `packages/client/dist` do not automatically see packages installed under sibling `client/node_modules`.
- Added `WORKSPACE_PEER_ALIASES` in `client/vite.config.ts` for `@react-spring/web`, `framer-motion`, and `react-window`.
- Added `react-window@^1.8.11` to `client/package.json` because `react-vtree@3.0.0` imports `react-window` as a peer and its v3 code expects the v1 list exports.
- `npm run build:client-package` passes.
- `PORT=3091 npm run frontend:dev` starts without dependency scan errors; `http://localhost:3091/steel/oauth-chat` and `http://localhost:3091/api/config` both returned `200`.

# Steel OAuth Chat Auth Path Fix

- [x] Reproduce the `/api/steel/ai/chat` 401 behavior.
- [x] Distinguish LibreChat JWT 401 from OpenAI OAuth provider auth failure.
- [x] Confirm local `~/.codex/auth.json` can be loaded without exposing token material.
- [x] Identify `.env` literal `$HOME/.codex/auth.json` as the provider auth failure root cause.
- [x] Add backend expansion for `~`, `$HOME`, `${HOME}`, `$CODEX_HOME`, and `${CODEX_HOME}` in `STEEL_OPENAI_OAUTH_AUTH_FILE`.
- [x] Remove the active local default `STEEL_OPENAI_OAUTH_AUTH_FILE` from `.env`.
- [x] Keep a commented hosted/server example in `.env.example` for GCP-style mounted secret files.
- [x] Prevent failed assistant turns from being sent back to the provider on the next Steel test-page submit.

## Review

- `openai-oauth-provider` real-auth manual spec passes with local `~/.codex/auth.json`.
- Direct built-handler smoke with `STEEL_OPENAI_OAUTH_AUTH_FILE=$HOME/.codex/auth.json` expands to `/Users/neven/.codex/auth.json` and returns `steel-expanded-auth-ok`.
- Focused package API tests pass: `config.spec.ts`, `handlers.spec.ts`, and `provider.spec.ts`.
- Focused data-provider Steel AI contract tests pass.
- API Steel route shell tests pass.
- `npm run build:api` passes with only the pre-existing Redis `KeyvRedis` TypeScript warning in `packages/api/src/cache/cacheFactory.ts`.
- `docs/steel-openai-oauth-responses-setup.md` now documents GCP/server deployment via an absolute path to a mounted `auth.json`.

# Steel OAuth Chat Waiting State Fix

- [x] Reproduce the exact prompt through the built provider adapter.
- [x] Confirm direct OAuth provider returns `steel-librechat-oauth-ok` instead of hanging.
- [x] Confirm unauthenticated `/api/steel/ai/chat` still returns LibreChat JWT `401 No auth token` quickly.
- [x] Identify provider-auth HTTP `401` as a bad boundary for the frontend because Axios treats every 401 as a LibreChat session refresh trigger.
- [x] Change Steel provider failures to HTTP `502` while preserving `errorCategory: auth` for provider-auth failures.
- [x] Add regression coverage for provider auth failures not using browser session refresh semantics.
- [x] Rebuild `packages/api/dist`.

## Review

- Built provider smoke for `Reply exactly: steel-librechat-oauth-ok` returned the exact text with usage and response ID.
- Provider auth failure smoke now returns HTTP `502` with `errorCategory: auth`, avoiding the global frontend JWT refresh interceptor.
- `packages/api` focused Steel tests pass.
- `npm run build:api` passes with only the pre-existing Redis `KeyvRedis` TypeScript warning in `packages/api/src/cache/cacheFactory.ts`.
- Backend must be manually restarted after this fix because root nodemon ignores `packages/` changes.

# Frontend Dev Health Proxy Fix

- [x] Confirm authenticated frontend health checks call `/health`.
- [x] Confirm backend owns `/health` and `/readyz` on port 3080.
- [x] Add Vite dev proxy entries for `/health` and `/readyz`.
- [x] Update local dev docs with frontend proxy health probes.
- [x] Smoke-test `/health`, `/readyz`, and `/api/config` through a Vite dev server.

## Review

- Root cause: Vite dev server proxied `/api` and `/oauth`, but not backend health endpoints, so `/health` could fall through to the frontend router/cache layer.
- `PORT=3091 npm run frontend:dev` returned backend `200 OK` for `http://localhost:3091/health` and `http://localhost:3091/readyz`.
- `http://localhost:3091/api/config` still returns `200 OK` through the existing `/api` proxy.

# Balance Route Missing Record Fix

- [x] Reproduce unauthenticated `/api/balance` route behavior to distinguish route absence from missing user balance data.
- [x] Confirm logged-in `404` comes from `Balance not found`, not Vite proxy routing.
- [x] Reuse existing balance initialization middleware on `/api/balance`.
- [x] Add focused regression coverage for `/api/balance` initialization.
- [x] Run focused tests and diff checks.

## Review

- Root cause: `/api/balance` existed, but it only read the user's balance record. Existing users could get `404 Balance not found` after balance was enabled because initialization only ran during auth flows.
- Added the existing `createSetBalanceConfig` middleware to `/api/balance` before the balance controller, so a missing record can be initialized on first balance read when balance is enabled and `startBalance` is configured.
- `cd api && npx jest server/routes/__tests__/balance.spec.js --runInBand` passes.

# Steel OAuth Chat UI Live Smoke

- [x] Confirm local backend and frontend dev ports are available.
- [x] Start `npm run backend:dev` and verify `http://localhost:3080/api/config`.
- [x] Start `npm run frontend:dev` and verify `http://localhost:3090/api/config`.
- [ ] Open `http://localhost:3090/steel/oauth-chat` in a browser session.
- [ ] Submit `亞L30x30 一支多少？` and check for bounded options plus a highest-confidence provisional quote.
- [ ] Submit the follow-up `先用錏成型角鐵30*2.5*6M，第1級價格。` and check that the same conversation updates the selected candidate.
- [ ] Submit the H 型鋼 cutting/slotting/hole prompt and check the processing quote explanation.

## Review

- User interrupted the automated browser smoke before Playwright execution.
- Backend `npm run backend:dev` and frontend `npm run frontend:dev` were stopped with SIGINT.
- Shutdown verification passed: `lsof` found no listeners on ports `3080` or `3090`, and the residual process check found no `nodemon`, `vite`, Playwright, or headless Chrome process.

# Steel DB-Backed Quote Rules and Merged Lookup Tool

- [x] Update docs before implementation: design `steel.instruction_packets`, `lookup_quote_rules`, and Admin-updatable rule boundaries.
- [x] Add a lesson that editable Steel quoting rules must not stay hard-coded in provider/tool code.
- [x] Write RED repository/tool tests for DB-backed instruction packets and merged instructions/defaults lookup.
- [x] Generate a Supabase migration with `npx supabase migration new`.
- [x] Update `supabase/schema.sql` and the new migration together.
- [x] Seed current reviewed instruction packets from the existing static runtime packets into SQL.
- [x] Implement `steel.instruction_packets` repository retrieval.
- [x] Implement `lookup_quote_rules` and route legacy `lookup_instructions` through the DB-backed repository.
- [x] Update provider instructions to prefer `lookup_quote_rules` before category-dependent lookup.
- [x] Verify focused Jest, `packages/api` build, Prettier check, and `git diff --check`.

## Review

- RED evidence: focused Jest initially failed because `./instructions` repository was missing and `lookup_quote_rules` was not implemented.
- GREEN evidence so far: focused repository/tool Jest passed 25/25; provider policy/tool-loop Jest passed 12/12.
- Implemented `steel.instruction_packets` as Admin-editable DB rows, with idempotent SQL seed for 10 reviewed active packets. Applied the migration SQL to the configured Steel Postgres from `.env`; live DB verification returned 10 reviewed active packet slugs.
- Live DB group-order verification: `c-type-quote-core` returns `c-type-basic-quote-zh-v1`, `price-source-priority-zh-v1`, `formula-code-selection-zh-v1`, `drawing-processing-detection-zh-v1`; `h-type-quote-core` returns `h-type-length-surcharge-zh-v1`, `h-and-i-beam-cutting-price-zh-v1`, `cut-count-and-trim-detection-zh-v1`.
- Final verification: focused repository/tool/provider Jest passed 37/37; full `packages/api/src/steel` Jest passed 30 suites / 142 tests; `npm run build:api` exited 0 with only existing non-Steel Rollup TypeScript warnings; touched-file Prettier check passed; `git diff --check` passed.
- Follow-up live smoke: updated `provider.catalog-oral.manual.spec.ts` so the C/H/angle oral quote smoke cases require `lookup_quote_rules` instead of legacy `lookup_instructions`. Real OAuth C 型鋼 smoke passed with `STEEL_OPENAI_OAUTH_C_TYPE_ORAL_TEST=true`: true `gpt-5.5` called `lookup_quote_rules` before `search_price_candidates`, lookup arguments included `c_type`, and the successful positive price lookup arguments included `c_type`, `100x2.3`, and `錏輕型鋼`.

# Steel Product Price Unit Weight Calculation Rule

- [x] Capture user corrections in `tasks/lessons.md`, including C 型鋼
      `kg_per_m` pricing and product-name parenthetical weight fallback.
- [x] Update agent/runtime instructions so AI treats product-price unit price,
      price `unit`, and unit weight correctly.
- [x] Update instruction packet docs with product-price unit weight calculation
      rules.
- [x] Add a follow-up Supabase migration to update reviewed
      `steel.instruction_packets` and existing `steel.price_items` unit
      semantics.
- [x] Apply the migration to the configured Steel Postgres and verify returned
      C 型鋼/H 型鋼/白鐵平鐵 rows include the corrected rule semantics.
- [x] Add deterministic tests so `lookup_quote_rules` returns the new rule for
      C 型鋼 and provider policy mentions the calculation boundary.
- [x] Run focused Jest, full Steel Jest, importer dry-run, API build, Prettier,
      and `git diff --check`.

## Review

- Added migration `20260604140123_steel_product_price_unit_weight_rules.sql`.
  It fixes existing `steel.price_items` by separating `unit` from
  `product_price_unit_weight_unit`, imports validated product-name parentheses
  as weight-per-piece evidence, and upserts
  `product-price-unit-weight-calculation-zh-v1`.
- Updated the reference importer so future `產品價格.xlsx` updates recalculate
  the same semantics. Verified fixtures:
  `CCG10023` -> `unit=kg`, `kg_per_m`, `4kg/m`; `EHS121206` ->
  `unit=kg`, `kg_per_piece`, `142kg/支`; `EIS20080` -> `unit=piece`,
  `kg_per_piece`, `19.7kg/支`, source origin `product_name_parentheses`.
- Live DB verification matched those three rows and confirmed the instruction
  packet contains both the C 型鋼 `NT$600-643.2` example and the
  `白鐵平鐵 50 *8.0( 19.7)` bracket-weight example.
- Live C 型鋼 OAuth smoke initially caught a real search-normalization
  regression: AI supplied `specKeyContains=100x2.3`, but backend normalization
  replaced it with full-section `100x50x20x2.3`. Added a regression so compact
  C 型鋼 fragments win over full-section `specKey`; the live smoke then passed
  with real `openai_oauth_responses` and real Steel DB.
- Verification passed: focused Jest 4 suites / 50 tests, full Steel Jest 30
  suites / 143 tests, opt-in C 型鋼 OAuth smoke 1 passed / 4 skipped,
  `npm run steel:import-reference-data -- --dry-run`, `npm run build:api` exit
  0 with existing non-Steel Rollup TypeScript warnings, Prettier write, and
  `git diff --check`.

## Follow-up Audit

- [x] Compare `docs/reference/產品價格.xlsx` expected steel row semantics against
      live `steel.price_items`.
- [x] Confirm non-steel rows are not treated as steel price-calculation rows.
- [x] Confirm agent/runtime instructions contain the unified price calculation
      logic.
- [x] Confirm live `steel.instruction_packets` has the latest reviewed rule.
- [x] Confirm docs contain the same rule and source examples.

### Review

- Reapplied the current reference importer to Supabase from
  `docs/reference/產品價格.xlsx`. Apply verification returned 27,024
  `price_items`, 6,756 product codes, 2,256 customers, 238 cutting prices, 31
  formula versions, and 29 quote defaults.
- Reapplied migration
  `20260604142955_steel_product_price_weight_rule_scope.sql` after importer
  apply so live `steel.instruction_packets` and existing price rows use the
  final scope/weight rules.
- Live DB audit after importer + migration: 0 null `catalog_family` rows, 0
  null `category_id` rows, 198 catalog families used by product-price rows,
  2,912 steel/material product codes, 1,339 steel/material product codes with
  usable weight evidence, 0 non-material product codes with steel weight
  semantics, and 0 material/non-material scope misses.
- Sample rows verified: `CCG10023` C 型鋼 is `c_type`, `unit=kg`,
  `4kg/m`; `EHC150706` 輕量H is `h_beam`, `53kg/支`; `BNH0054020` is
  `plate`, `9.79kg/支`; `ERB06060` 6K鐵軌 is `rail`, `unit=piece`,
  `36kg/支`, with parenthetical `38` preserved only as contradiction metadata;
  `AVA0414` 彈簧 and `HNU0846` 消光 remain non-material scope with no steel
  unit-weight semantics.
- Live instruction packet `product-price-unit-weight-calculation-zh-v1` now
  includes non-material scope, 輕量H, BNH, 6K鐵軌/2090 piece-total guard,
  related-material proportional inference, and selectors for
  `metadata.sourceParentheticalUnitWeight`.
- Verification passed after formatting: full `packages/api/src/steel` Jest 30
  suites / 143 tests; `npm run steel:import-reference-data -- --dry-run`;
  `npm run steel:import-reference-data -- --apply`; `npm run build:api` exit 0
  with existing non-Steel Rollup TypeScript warnings.

# Steel C 型鋼 6M Live Price Smoke

- [x] Query live `steel.price_items` for `C型鋼 C100x50x20x2.3t 6M`.
- [x] Run a real `gpt-5.5` OAuth provider/tool-loop smoke for the same prompt.
- [x] Fix c_type compact-spec guard when AI labels include both `100x2.3` and
      the full section text.
- [x] Correct the C 型鋼 example arithmetic from `NT$150-160.8` to
      `NT$600-643.2`.
- [x] Reapply the DB instruction correction migration.
- [x] Re-run the real OAuth provider/tool-loop smoke.
- [x] Run full Steel Jest, API build, and diff checks.

## Review

- Initial DB query returned the correct reviewed rows: `CCG10023 錏輕型鋼
100*2.3`, `unit=kg`, `unitPrice=25-26.8`, `productPriceUnitWeight=4kg/m`.
  Therefore `4kg/m * 6M = 24kg`, and the 6M piece amount is
  `NT$600-643.2`.
- Initial real OAuth smoke failed: `gpt-5.5` called `lookup_quote_rules`, but
  `search_price_candidates` validation rejected the useful `100x2.3` candidate
  after extracting a false expected fragment `100x50` from a mixed label.
- Fix: `getExpectedCTypeCompactSpec` now extracts numbers only from the matched
  full-section substring, so a mixed label like `錏輕型鋼 100x2.3 /
C100x50x20x2.3` no longer creates a false `100x50` requirement.
- Reapplied migration `20260604145800_steel_c_type_price_math_correction.sql`.
  Live DB verification: instruction packet has `NT$600-643.2` and no
  `NT$150-160.8`.
- Re-run real OAuth smoke passed: first tool was `lookup_quote_rules`; a
  subsequent positive `search_price_candidates` call returned reviewed
  `CCG10023 錏輕型鋼 100*2.3`, `unit=kg`, `unitPrice=25-26.8`, `4kg/m`; final
  response said `4 * 6 = 24kg`, A/B/C/F amounts `624 / 643.2 / 612 / 600`
  TWD/支, and did not mention the old `150-160.8` amount.
- Verification after the fix: focused `execute.spec.ts` / live-smoke fixture
  Jest passed 24/24, full `packages/api/src/steel` Jest passed 30 suites / 143
  tests, `npm run build:api` exited 0 with existing non-Steel Rollup TypeScript
  warnings, and `git diff --check` passed.

# Steel C 型鋼 Default Tier And Material Follow-Up

- [x] Capture correction at that time: missing customer/tier must not filter by
      A/tier 1. This has since been superseded by the next section's global
      B-tier lookup rule.
- [x] Capture correction: first C 型鋼 material-unknown reply must show
      same-spec material options, and a later follow-up with no alternate
      material should confirm the default 錏輕型鋼 assumption.
- [x] Update runtime policy, instruction-packet fixture, docs, and lessons.
- [x] Add Supabase data migration for the reviewed C 型鋼 instruction packet.
- [x] Apply the migration to Steel Postgres and verify live
      `lookup_quote_rules`.
- [x] Re-run focused Jest, full Steel Jest/build checks, and live OAuth smoke.

## Review

- Live DB verification after
  `20260604152413_steel_c_type_b_tier_material_followup.sql` confirmed
  `c-type-basic-quote-zh-v1` contained the then-current B-price/default-material
  wording. The unknown-tier lookup behavior from this review is superseded by
  the next section's global B-tier lookup rule.
- Runtime policy now says price-type oral orders must follow
  `category key -> lookup_quote_rules -> search_price_candidates -> answer`.
  It also tells AI not to invent `customerId` / `customerTierId` when
  `tierKnown=false`.
- Provider runtime at that time restricted the post-rule price round to
  `search_price_candidates` only and prevented repeated A/tier-1 bias loops.
  The customer-tier handling is superseded by the next section.
- Real OAuth smoke passed for `C100x50x20x2.3t 6M 一支多少？` using live
  `gpt-5.5` and live Steel DB. The smoke verified `lookup_quote_rules` happens
  before positive `search_price_candidates`, the positive lookup includes
  `c_type`, `100x2.3`, and `錏輕型鋼`, and the final response contains 24kg
  math, B/default pricing, and material alternatives.
- Verification passed: focused provider Jest 14/14, full Steel Jest 30 suites /
  145 tests, opt-in C 型鋼 OAuth smoke 1 passed / 4 skipped,
  `npm run build:api` exit 0 with existing non-Steel Rollup TypeScript warnings,
  and `git diff --check` passed.

# Steel Global Default B Customer Tier

- [x] Confirm live Steel tier ids: B price is `customerTierId = 2`.
- [x] Capture correction: unknown/default customer tier must directly use
      B price lookup, not omit `customerTierId` and let the model choose.
- [x] Update runtime policy, provider guardrail tests, docs, and lessons.
- [x] Add and apply a follow-up Supabase data migration for reviewed
      instruction packet text.
- [x] Re-run focused Jest, full Steel Jest/build checks, and live OAuth smoke.

## Review

- Live DB confirmed customer tier `B` is `steel.customer_tiers.id = 2`
  (`code = B`, `name = B級`).
- Runtime policy now treats missing customer/tier as unknown customer context
  plus default B price lookup. It still forbids inventing `customerId`, but
  forces `search_price_candidates` to use `customerTierId: 2` until a user
  message or selected customer/tier explicitly overrides it.
- Follow-up migration
  `20260605020554_steel_default_b_customer_tier_instruction.sql` was applied to
  live Steel Postgres. Verification query confirmed
  `c-type-basic-quote-zh-v1` contains `customerTierId 2` and no longer contains
  old omit-tier wording.
- Live DB currently has `steel.instruction_packets` but not
  `steel.agent_instructions`; the every-turn default rule is therefore active
  in provider runtime policy/docs now, and should be moved into
  `steel.agent_instructions` when that Admin-managed table is implemented.
- Updated agent/runtime docs, instruction packet docs, catalog-family data
  contract, tests, and lessons so the rule applies to all products, not just
  C 型鋼.
- Live C 型鋼 OAuth smoke now asserts the positive `search_price_candidates`
  call includes `"customerTierId":2` in addition to `c_type`, `100x2.3`, and
  `錏輕型鋼`.
- Verification passed: focused provider/executor Jest 38/38, full Steel Jest
  30 suites / 145 tests, `npm run build:api` exit 0 with existing non-Steel
  Rollup TypeScript warnings, opt-in C 型鋼 OAuth smoke 1 passed / 4 skipped,
  and `git diff --check` passed.

# Steel Default B Customer Notice

- [x] Capture correction: if the user did not provide a customer, or no usable
      customer price tier can be found, quote with B by default.
- [x] Capture correction: response must remind the user that 價格B is the
      current default quote price and that a customer name can be used to look
      up that customer's quote price. Superseded by the later concise-response
      correction: current replies should not add highest/most-expensive wording.
- [x] Capture correction: when `search_customers` finds a usable customer tier,
      use that tier instead of overriding it with B.
- [x] Update runtime policy, provider guardrail tests, docs, and lessons.
- [x] Add and apply a follow-up Supabase data migration for reviewed
      instruction packet text.
- [x] Re-run focused Jest, full Steel Jest/build checks, and live OAuth smoke.

## Review

- Runtime policy now distinguishes fallback B from found customer tiers. If the
  user provides no customer or `search_customers` cannot find a usable tier,
  price lookup uses `customerTierId: 2`; if `search_customers` finds one usable
  customer tier, that tier is carried into price lookup instead of being
  overwritten by B.
- Provider guardrail tests cover both branches: unknown customer/tier defaults
  to B, and a found customer A-tier lookup stays A instead of becoming B.
- Follow-up migration
  `20260605021828_steel_default_b_customer_notice.sql` was applied to live
  Steel Postgres. Verification query confirmed live
  `c-type-basic-quote-zh-v1` had the B default and customer-name follow-up
  notice. The later concise-response migration supersedes the highest/most
  wording and makes current replies name `價格B` only.
- Verification passed: focused provider/executor Jest 39/39, full Steel Jest
  30 suites / 146 tests, `npm run build:api` exit 0 with existing non-Steel
  Rollup TypeScript warnings, opt-in C 型鋼 OAuth smoke 1 passed / 4 skipped,
  and the live smoke checked `價格B`, customer reminder, and `customerTierId: 2`.

# Steel Concise Quote And Workbook Summary

- [x] Capture correction: first quick-price response should be shorter. For B
      default, say `目前用 價格B：26.8 元/kg`; do not add highest/most-expensive
      wording.
- [x] Capture correction: do not list `單位重` as a separate bullet when the
      response already shows total piece weight, e.g.
      `6M 一支重量：4 × 6 = 24 kg`.
- [x] Capture correction: after a later workbook update such as
      `客戶是龍頂`, the assistant must explain the new information and changed
      workbook fields, not only say `已更新 workbook：N 個欄位`.
- [x] Update runtime policy, workbook patch instruction, docs, tests, and
      lessons.
- [x] Add and apply a follow-up Supabase data migration for reviewed
      instruction packet text.
- [x] Re-run focused Jest, full Steel Jest/build checks, and live OAuth smoke.

## Review

- Runtime policy now tells the model to write the fallback B notice as
  `目前用 價格B：26.8 元/kg`, mention customer-name lookup separately, and avoid
  highest/most-expensive wording unless the user explicitly asks for ranking.
- Quick-price formatting now avoids a separate `單位重` bullet when the same
  response already shows total piece weight. The preferred shape is
  `6M 一支重量：4 × 6 = 24 kg`, followed by B unit price and line subtotal.
- Workbook patch guidance now requires a short Traditional Chinese summary of
  newly interpreted information and workbook fields changed after
  `patch_workbook` succeeds; field-count-only replies such as
  `已更新 workbook：16 個欄位` are explicitly blocked.
- Follow-up migration
  `20260605025616_steel_concise_quote_workbook_summary.sql` was applied to live
  Steel Postgres. Verification query confirmed live `c-type-basic-quote-zh-v1`
  contains the short B notice, the no-highest/most rule, the no-separate-unit-
  weight rule, and the workbook-summary rule.
- Live C 型鋼 OAuth smoke with real `openai_oauth_responses` and real Supabase
  passed after updating the assertion to accept `價格B`: the model responded
  with `目前用 價格B：26.8 元/kg`, `6M 一支重量：4 × 6 = 24 kg`, no `最高` /
  `最貴`, and no separate `單位重` bullet.
- Verification passed: focused provider/executor Jest 39/39, full Steel Jest
  30 suites / 146 tests, `npm run build:api` exit 0 with existing non-Steel
  Rollup TypeScript warnings, and opt-in C 型鋼 OAuth smoke 1 passed /
  4 skipped.

# Steel Response Wording And Provider Progress Research

- [x] Capture correction: change response wording from
      `reviewed 價格：26.8 元/kg` to `價格：26.8 元/kg`.
- [x] Reproduce and fix the workbook follow-up bug where `客戶是龍頂` only
      returns `已更新 workbook：N 個欄位`.
- [x] Research official OpenAI Responses API streaming/progress surfaces to
      determine whether the UI can show model reasoning/progress beyond
      `Waiting for provider`.
- [x] Update runtime/docs/tests/lessons and reviewed instruction packet data
      where needed.
- [x] Run focused tests, Steel tests, live smoke or endpoint repro, and diff
      hygiene before reporting results.

## Review

- Reproduced the workbook bug with a failing handler regression: when provider
  text is only `已更新 workbook：19 個欄位`, the handler previously returned that
  field-count-only text even though `changedFieldSummary` contained customer,
  tier, and price changes.
- Fixed the handler fallback so field-count-only workbook replies are replaced
  with a concise summary containing `本輪新增資訊` and `主要改動`, sourced from
  backend-applied `changedFieldSummary`.
- Runtime policy and live smoke now reject `reviewed 價格` as a user-facing
  price bullet label. Current rule is to show `價格：<單價>` and move
  reviewed/source status into source or note text.
- Added migration
  `20260605031930_steel_price_label_and_workbook_summary.sql` and applied it
  to live Steel Postgres. Verification query confirmed the reviewed
  `c-type-basic-quote-zh-v1` packet has the price-label rule, the
  `reviewed 價格` blocking rule, and the workbook-summary rule.
- OpenAI Responses API research: official docs say raw reasoning tokens are not
  exposed, but reasoning summaries can be opted in. Streaming Responses API
  events can expose progress such as response lifecycle, output text deltas,
  function-call argument deltas, code interpreter/file search progress, and
  reasoning summary deltas when summaries are enabled.
- Current `/steel/oauth-chat` uses a plain Axios POST to `/api/steel/ai/chat`;
  the backend provider adapter calls `doGenerate`, which aggregates the internal
  stream before returning. Progress UI therefore needs a new streaming endpoint
  and client path; the current UI can only show `Waiting for provider`.
- Verification passed: RED handler regression failed on the exact
  field-count-only response; GREEN handler regression passed; focused
  handler/provider/executor Jest passed 58/58; full Steel Jest passed
  30 suites / 147 tests; `npm run build:api` exited 0 with existing non-Steel
  Rollup TypeScript warnings; opt-in C 型鋼 OAuth smoke passed 1 enabled case /
  4 skipped and rejects `最高|最貴`, `單位重`, and `reviewed 價格`.
- Follow-up screenshot diagnosis: the source and `packages/api/dist/index.js`
  already contained the workbook-summary fallback, but the running backend on
  port 3080 had started before the rebuild and still held the old handler in
  memory. Restarted backend dev server so `/steel/oauth-chat` now loads the
  updated dist.

# Steel Workbook Patch Concise Summary

- [x] Capture correction: workbook patch fallback should not show a detailed
      diff list. It should only report interpreted order information and a key
      change summary.
- [x] Update handler fallback and regression tests so long fields such as search
      keywords and candidate item lists do not appear in chat.
- [x] Update lessons and rerun focused/backend verification before restarting
      the backend for manual retest.

## Review

- Handler fallback now emits a concise workbook reply with interpreted order
  information and a key-change summary, without per-field diffs, long search
  keywords, or long candidate item lists.
- Provider prompts, tool-result guidance, docs, and the reviewed C 型鋼
  instruction packet now all state that successful `patch_workbook` replies
  should summarize only order information and key workbook changes.
- Applied migration
  `supabase/migration/20260605034146_steel_workbook_patch_concise_summary.sql`
  to the live Steel Supabase database; SQL verification confirmed the
  instruction packet includes the concise summary rule and blocks per-field
  diff / long candidate text.
- Verification before backend restart: focused handler/provider Jest passed
  34/34; full `packages/api/src/steel` Jest passed 30 suites / 147 tests;
  `npm run build:api` exited 0 with existing non-Steel Rollup TypeScript
  warnings.
- Final local verification: Prettier completed for touched files;
  `git diff --check` and untracked migration whitespace checks passed; restarted
  the backend dev server so port 3080 loads the rebuilt `@librechat/api` dist;
  `GET /api/config` on 3080 and `/steel/oauth-chat` on 3090 both returned 200.

# Steel Quote Field And Requote Summary

- [ ] Capture correction: `報價明細` should use `小計` as the unified quote
      amount field. Do not add a separate duplicate `報價` column; keep
      `材料費` as a material-cost component when needed.
- [ ] Ensure customer/tier follow-up workbook updates also update and report
      the new quote amount, not only customer/tier/unit-price fields.
- [ ] Update provider/tool guidance, docs, lessons, and tests; then rerun
      focused/full verification and restart the backend dev server.

## Review

- Pending verification.

# Steel Workbook Xlsm Reference Template

- [x] Inspect `docs/reference/訂單參考.xlsm` sheet order, labels, headers, and
      populated reference rows.
- [x] Add failing tests proving workbook initialization cannot use the old blank
      seven-sheet template.
- [x] Capture correction: `訂單參考.xlsm` is a development reference only; runtime
      workbook initialization must use code constants and must not read the file.
- [x] Update workbook initialization constants to mirror `訂單參考.xlsm` sheet
      order, visible labels, headers, and seed rows while preserving stable
      English sheet ids.
- [x] Run focused/full verification, rebuild shared packages, and do not restart
      the dev server in this pass.

## Review

- Implemented workbook initialization as a code-owned template in
  `packages/api/src/steel/workbook/template.ts`; `docs/reference/訂單參考.xlsm`
  remains a development reference only and is not read by runtime
  initialization.
- Verification: `packages/api npx jest src/steel/workbook/service.spec.ts
--runInBand --coverage=false` passed 6 tests; `packages/api npx jest
src/steel --runInBand --coverage=false` passed 30 suites / 149 tests;
  `packages/data-provider npx jest src/steel/workbooks.spec.ts --runInBand
--coverage=false` passed 5 tests; `client npx jest
src/routes/SteelOAuthChat.spec.tsx --runInBand --coverage=false` passed 8
  tests; `npm run build:data-provider` passed; `npm run build:api` exited 0
  with existing non-Steel Rollup/TypeScript warnings; `git diff --check`
  passed.
- No dev server was restarted in this pass.

# Steel Ai Subtotal Workbook Patch Verification

- [x] Verify AI/chat response behavior includes concise `小計` quote information
      after workbook patch application.
- [x] Verify workbook patch data lands in the expected visible sheets/columns,
      including `報價明細.小計`, pricing source fields, and interpretation notes.
- [x] Add or update regression coverage if existing tests only check field-count
      summaries or incomplete workbook fields.
- [x] Run focused verification without restarting the dev server.

## Review

- Added a handler regression using a real in-memory workbook service and a
  simulated model `patch_workbook` tool call. The response fallback now has
  test coverage for `小計：624`, and the returned workbook is asserted to contain
  matching cells in `報價明細.line_1`, `價格來源.source_1`, and
  `判讀備註.note_1`.
- Verification: `packages/api npx jest src/steel/handlers.spec.ts --runInBand
--coverage=false` passed 20 tests; `packages/api npx jest src/steel
--runInBand --coverage=false` passed 30 suites / 150 tests; `npm run
build:api` exited 0 with existing non-Steel Rollup/TypeScript warnings; `git
diff --check` passed.
- Live AI supplement: gated real OAuth C 型鋼 oral smoke passed with
  `STEEL_OPENAI_OAUTH_C_TYPE_ORAL_TEST=true`, real `gpt-5.5`, and real Steel DB
  tools. It verified `lookup_quote_rules` before c_type price lookup and the
  `100x2.3` candidate path. This live smoke validates AI judgment/tool sequence;
  workbook field application is covered by the handler regression above.
- No dev server was restarted in this pass.

# Steel Live Workbook Patch Manual Smoke

- [x] Add a gated real OAuth manual smoke for `patch_workbook`.
- [x] Verify the true model emits workbook patch operations for `報價明細`,
      `價格來源`, and `判讀備註`.
- [x] Verify the patch includes `報價明細.小計` for the provisional quote amount.
- [x] Update the OAuth Responses runbook with the exact opt-in command and
      expected evidence.
- [x] Run focused manual smoke verification without restarting the dev server.

## Review

- RED evidence: running `provider.catalog-oral.manual.spec.ts` with
  `STEEL_OPENAI_OAUTH_WORKBOOK_PATCH_TEST=true` initially failed because the
  old oral helper returned no `response.workbookPatch.operations`.
- Added a gated live workbook-patch smoke that uses real OAuth `gpt-5.5` and
  the real provider loop, while supplying deterministic reviewed
  `lookup_quote_rules` / `search_price_candidates` results inside the test.
- The smoke verifies the sequence `lookup_quote_rules`, then
  `search_price_candidates`, then `patch_workbook`, and asserts workbook
  operations for `報價明細.line_1`, `價格來源.source_1`, `判讀備註.note_1`,
  including `報價明細.小計` around `643.2`.
- GREEN evidence: `STEEL_OPENAI_OAUTH_WORKBOOK_PATCH_TEST=true` live smoke
  passed: 1 passed / 5 skipped in `provider.catalog-oral.manual.spec.ts`.
- Focused default verification: running the same manual spec without opt-in
  flags skipped all 6 tests, so routine runs do not call the live API.
- No dev server was restarted in this pass.

# Steel Streaming Chat Prototype

- [x] Add a focused design for `POST /api/steel/ai/chat/stream` as an NDJSON
      prototype scoped to `/steel/oauth-chat`.
- [x] Add RED tests for stream event schemas, backend stream route behavior, and
      UI progress rendering.
- [x] Implement the backend stream handler and route shell without changing the
      existing non-streaming chat route.
- [x] Add data-provider endpoint/types/client helper for parsing stream events.
- [x] Update `SteelOAuthChat` to show lookup/tool/progress states while the
      provider is running.
- [x] Run focused backend/data-provider/client verification and record the
      results.

## Design Check-In

- Scope: prototype only for the Steel smoke route. Keep `/api/steel/ai/chat`
  unchanged, and add `/api/steel/ai/chat/stream` for streaming diagnostics.
- Wire format: `application/x-ndjson`; each line is one JSON event so `POST`
  payloads work with `fetch` streaming.
- Event contract: `progress` for coarse phases, `lookup` for lookup tools,
  `tool` for non-lookup tool calls and workbook patch application, `text` for
  assistant text, `done` for the final normalized chat response, and `error`
  for provider/workbook failures after headers are open.
- Backend behavior: parse and validate the same chat payload as the normal
  route, write initial progress events, pass a wrapped `executeSteelToolCall`
  into the provider so lookup/tool start and completion events reflect real
  tool calls, apply workbook patches through the same backend validation, then
  emit `text` and `done`.
- UI behavior: keep the current chat layout, but replace the generic
  `Waiting for provider` line with a compact status timeline showing the latest
  progress, lookup, tool, and workbook-patch events. Fall back to the existing
  non-stream request only if streaming is unavailable.

## Review

- Added `POST /api/steel/ai/chat/stream` as an authenticated NDJSON stream route
  while keeping the existing `/api/steel/ai/chat` response route unchanged.
- Added shared `SteelProviderChatStreamEvent` contract and
  `dataService.streamSteelChat`, which reads one JSON event per line and returns
  the final `done.response`.
- Backend stream events now include request/provider progress, real
  `executeSteelToolCall` lookup/tool start/completion events, backend
  `patch_workbook` application status, text, done, and post-header error events.
- `/steel/oauth-chat` now sends through `streamSteelChat` and keeps a compact
  status timeline visible after completion until the next send/new chat.
- RED evidence: focused tests first failed for missing
  `steelProviderChatStreamEventSchema`, missing `handlers.streamChat`, router
  404, and UI not calling/rendering stream statuses.
- Verification passed: `packages/data-provider npx jest src/steel/ai.spec.ts
--runInBand --coverage=false` passed 10 tests; `packages/api npx jest
src/steel/handlers.spec.ts --runInBand --coverage=false` passed 21 tests;
  `client npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand
--coverage=false` passed 9 tests; `api npx jest
server/routes/__tests__/steel.spec.js --runInBand --coverage=false` passed 10
  tests; `npm run build:data-provider` passed; `npm run build:api` exited 0
  with existing non-Steel TypeScript warnings; `git diff --check` passed.
- `client npm run typecheck` still fails on existing broad repo errors such as
  `src/a11y/LiveMessage.tsx`, Agents tests, ArtifactRouting tests, MCPBuilder,
  Web citations, and other unrelated files. The output did not report a
  `SteelOAuthChat.tsx` error.
- No dev server was restarted in this pass.

# Steel OAuth Chat Empty Workbook, Quote Rules Defaults, And IME Enter

- [x] Verify why `/steel/oauth-chat` new workbook initializes with populated
      quote data instead of an empty user-editable workbook.
- [x] Add failing regression coverage that new runtime workbooks keep sheet
      structure/headers but no quote/customer/material data rows.
- [x] Extend `lookup_quote_rules` so one call can return instruction/default
      data for one or more catalog/material keys, making `lookup_defaults`
      unnecessary for this flow when rules are requested together.
- [x] Add failing regression coverage for batched `lookup_quote_rules` returning
      defaults for multiple material/catalog keys.
- [x] Fix `/steel/oauth-chat` textarea Enter behavior so 注音/IME composition
      confirmation does not submit the chat.
- [x] Run focused backend/data-provider/client verification, rebuild affected
      shared packages, and record evidence.

## Review

- Root cause: runtime workbook initialization reused code-owned reference rows
  copied from `docs/reference/訂單參考.xlsm`; patch validation also required rows
  to already exist, so a truly empty workbook needed row creation on accepted
  patch. `lookup_quote_rules` already merged defaults structurally, but
  `lookupSteelDefaults()` filtered out contexts without workbook `lineRefs`.
  The textarea submitted because Enter handling ignored IME composition state.
- Implementation: new workbooks now keep the seven sheet/column structure but
  start with zero rows; validated workbook patches may create missing target
  rows such as `line_1`; `lookup_quote_rules` returns quote defaults for
  matched material/catalog contexts even when `lineRefs` are absent; runtime
  prompt/tool descriptions prefer `lookup_quote_rules` for merged
  instruction/default lookups; `/steel/oauth-chat` blocks Enter submit during
  composition.
- Verification: RED tests failed for populated initial rows, missing-row patch
  rejection, no-rowRef quote defaults, and IME Enter submit. GREEN verification
  passed: `packages/api jest` for `workbook/service.spec.ts`,
  `tools/execute.spec.ts`, `ai/provider.spec.ts`, and `handlers.spec.ts`
  passed 70 tests; `client jest src/routes/SteelOAuthChat.spec.tsx` passed 10
  tests; `git diff --check` passed; `npm run build:api` exited 0 with existing
  non-Steel TypeScript warnings.
- Runtime smoke: backend `/api/steel/workbooks` returned version 1 with 0 rows
  in all seven sheets. Live cloud Supabase `executeSteelTool(lookup_quote_rules)`
  for `c_type` + `h_beam` returned instruction packets plus four quote defaults.
  Headless `/steel/oauth-chat` smoke showed 0 rows on every tab and composition
  Enter left textarea value unchanged with 0 stream requests.

# Steel Catalog-Key Lookup Enforcement And Stream Reasoning UI

- [x] Confirm whether current provider/tool guard allows oral material text to
      skip `lookup_catalog_families` and jump directly to `lookup_quote_rules`.
- [x] Add RED provider coverage that oral material/category price requests must
      call `lookup_catalog_families` before `lookup_quote_rules`, then use the
      selected catalog keys for rule/price/formula lookups.
- [x] Add RED stream/UI coverage for reasoning summary events and a Codex-like
      Steel stream status panel.
- [x] Implement backend stream event contract for provider-visible reasoning
      summaries when the model/provider returns them; do not expose or invent raw
      chain-of-thought.
- [x] Implement a compact Codex-like stream status UI that shows reasoning
      summaries, tool lookups, progress, and errors in a readable timeline.
- [x] Run focused API/data-provider/client verification, build affected shared
      outputs, and record runtime smoke evidence if possible.

## Review

- Confirmed gap: the previous runtime could show
  `lookup_quote_rules started/completed` before `lookup_catalog_families`; the
  provider guard only enforced quote rules before category-dependent price
  tools, not catalog vocabulary lookup before rules.
- Implemented catalog-first runtime policy for reviewed quick-price requests:
  the first required tool set is now restricted to `lookup_catalog_families`,
  then the AI can select catalog keys and call `lookup_quote_rules`, followed by
  `search_price_candidates`.
- Added provider-visible reasoning summary streaming. The UI displays summaries
  only when the model/provider returns them; it does not expose or invent raw
  chain-of-thought.
- Verification: data-provider stream contract Jest passed 10 tests;
  API provider/handler Jest passed 40 tests; client `/steel/oauth-chat` Jest
  passed 10 tests; `npm run build:data-provider` passed; `npm run build:api`
  passed with existing non-Steel Rollup TypeScript warnings; `git diff
--check` passed.
- `npm --workspace client run typecheck` still fails on existing broad client
  errors outside this slice. A filtered rerun found no `SteelOAuthChat`,
  `steel/ai`, `SteelProviderChatStreamEvent`, or `streamSteelChat` matches in
  the typecheck errors.
- Live `/steel/oauth-chat` smoke was not rerun in this pass; the backend was not
  restarted.

# Steel OAuth Chat Live C-Type Smoke After Dev Restart

- [x] Stop existing backend/frontend dev servers and verify ports 3080/3090 are clear.
- [x] Restart backend and frontend dev servers from the current checkout.
- [x] Open `/steel/oauth-chat`, send a C 型鋼 quick-price prompt, and verify the
      live stream status includes `lookup_catalog_families` before
      `lookup_quote_rules` and `search_price_candidates`.
- [x] Record the AI reply and whether the quoted C 型鋼 subtotal is still
      calculated from kg/m _ meters _ B/customer price.

## Review

- Created and verified reusable smoke login `steel-smoke@example.test` for
  `/steel/oauth-chat`; use this account instead of registering random users for
  manual smoke runs.
- First smoke reproduced a real runtime blocker: the tool order correctly began
  with `lookup_catalog_families`, but cloud Postgres failed with
  `Connection terminated due to connection timeout`.
- Root cause evidence: direct TCP to the configured Supabase pooler `5432`
  timed out; `6543` was reachable, and read-only Postgres queries succeeded
  when the runtime used the `6543` URL plus explicit `ssl: true`.
- Updated the Steel Postgres pool config to pass explicit `ssl: true`; rebuilt
  `packages/api/dist`; restarted backend with a `6543` Steel Postgres runtime
  override. Read-only `steel.catalog_families` query returned 211 rows.
- Live `/steel/oauth-chat` smoke using the fixed account completed. Status order
  included `lookup_catalog_families completed` before `lookup_quote_rules`,
  then `search_price_candidates`, `lookup_formula`, and `patch_workbook`.
- AI response quoted the C 型鋼 subtotal correctly: 錏輕型鋼 `100*2.3`,
  `4 kg/m * 6m = 24 kg`, `價格B 26.8 元/kg`, 小計 `NT$643.2/支`, with 白鐵
  alternative `NT$2,400/支`.
- Workbook v2 `報價明細` row was written with `材料類別 c_type / C型鋼`,
  `材料單價 26.8`, `材料計價單位 kg`, `計價數量 24`, and `小計 643.2`.

# Steel OAuth Chat Final Answer And Full Workbook Patch Fix

- [x] Reproduce and trace why `/steel/oauth-chat` can show completed tool status without replacing the visible progress area with the final answer.
- [x] Add failing UI coverage that final text is visible and completed stream status is not the primary visible result after a successful stream.
- [x] Trace workbook patch behavior for quick-price C 型鋼 and identify why `系統訂單`, `總結`, `人工複核清單`, and `給客戶用` stay empty.
- [x] Add failing workbook/handler coverage that a successful quick-price patch fills all required workbook sheets, not only `報價明細`, `價格來源`, and `判讀備註`.
- [x] Implement the smallest code changes that satisfy those contracts.
- [x] Run focused client/API/data-provider tests, rebuild shared packages if needed, and record verification evidence.

## Review

- Root cause: `/steel/oauth-chat` rendered the stream status panel whenever
  `streamEvents.length > 0`, so a completed stream could leave tool status as
  the visible final UI even after the assistant answer arrived.
- Root cause: the provider workbook instructions still told the model to patch
  only `報價明細`, `價格來源`, and `判讀備註` for provisional quick prices, so
  empty workbooks could leave `系統訂單`, `總結`, `人工複核清單`, and
  `給客戶用` blank.
- Implemented UI completion behavior: stream status is visible only while a
  request is sending; after `done`, the final assistant message replaces it.
- Implemented handler-level workbook patch completion: when a quick quote patch
  includes a calculable `報價明細/小計`, the handler derives missing preview rows
  for `系統訂單`, `總結`, `人工複核清單`, and `給客戶用` without overwriting
  model-provided cells.
- Updated provider instructions/reminder so live AI should patch all seven
  user-relevant workbook sheets for provisional price previews, while labeling
  summary/customer quote totals as `暫估/待確認`.
- Verification: client `SteelOAuthChat.spec.tsx` passed 10 tests; API
  `handlers.spec.ts` passed 22 tests; `npm --workspace packages/api run build`
  passed with existing non-Steel Rollup TypeScript warnings; `git diff --check`
  passed.
- `npm --workspace client run typecheck` still fails on existing broad client
  type errors outside this Steel slice, including `LiveMessage.tsx`, Agents
  tests, artifact attachment types, missing `react-zoom-pan-pinch`, and related
  non-Steel files.

# Steel OAuth Chat Right Panel Thinking Tab

- [x] Add RED client coverage for right panel `Workbook / Thinking` tabs.
- [x] Add RED client coverage that `Thinking` shows only the last run status,
      including provider-visible reasoning summaries, tool events, and errors.
- [x] Rename the workbook `manual_review` visible tab from `人工複核清單` to
      `人工複核` in the workbook UI contract.
- [x] Implement the right panel tab UI without reintroducing completed status
      into the main chat result.
- [x] Run focused client tests and diff checks, then record verification.

## Review

- Implemented right panel tabs named exactly `Workbook` and `Thinking`.
- `Thinking` shows a `Last run` status panel for the latest run only; each new
  submit resets the status list and replaces prior run entries.
- The Thinking panel includes provider-visible reasoning summaries,
  lookup/tool/progress events, and error events. If a request throws without a
  streamed error event, the UI adds a synthetic `unknown` error event using the
  visible error text.
- The main chat still only shows stream status while a request is sending; once
  the request completes, the conversation area shows the assistant answer/error
  and the completed status remains available only in the right panel.
- Renamed the workbook `manual_review` label to `人工複核` in the API workbook
  template, and the frontend preview also maps any older persisted
  `manual_review` sheet to the shorter label.
- Verification: client `SteelOAuthChat.spec.tsx` passed 12 tests; API workbook
  `service.spec.ts` and `repository.spec.ts` passed 8 tests; `npm --workspace
packages/api run build` passed with existing non-Steel Rollup TypeScript
  warnings; `git diff --check` passed.

# Steel OAuth Catalog-Key Tool Flow And Formula Lookup

- [x] Add RED provider coverage that oral catalog lookup results are used to
      force `lookup_quote_rules` before `search_price_candidates`.
- [x] Add RED provider coverage that instruction packets requiring
      `lookup_formula` keep the tool loop open until formula rows are retrieved.
- [x] Add RED provider coverage that a customer name in the first quote request
      allows first-round `search_customers`, then feeds customer context into
      `lookup_quote_rules` and price lookup.
- [x] Update runtime agent instructions/tool gating so selected catalog keys
      feed `lookup_quote_rules`, `search_price_candidates`, and
      `lookup_formula`.
- [x] Run focused provider/tool tests and record verification evidence.

## Review

- Root cause: provider tool gating allowed all Steel tools after
  `lookup_catalog_families`, so a real model could jump directly to
  `search_price_candidates` and reuse `C型鋼` as `productName` instead of first
  using the selected `c_type` key in `lookup_quote_rules`.
- Root cause: the provider only required `search_price_candidates` before a
  quick-price answer. When reviewed rules required `lookup_formula`, a model
  could answer after price lookup without retrieving reviewed formula rows.
- Implemented first-round lookup tools as `lookup_catalog_families` plus
  `search_customers`, so AI can search a provided customer name without code
  deciding which raw words are customer names.
- After catalog lookup, the next required tool set is narrowed to
  `lookup_quote_rules`; after rules, price lookup is required; if returned
  `requiredLookups` includes `lookup_formula`, the loop requires
  `lookup_formula` before accepting the final answer.
- Runtime instructions now tell AI to pass selected customer
  `customerId/customerTierId/customerName` as `customerContext` to
  `lookup_quote_rules`, so customer-scoped defaults/rules can be returned before
  price lookup.
- Updated `docs/steel-catalog-family-data-contract.md` to document the current
  catalog/customer -> quote rules/defaults -> price/formula flow.
- Verification: RED provider tests failed on the old open tool set and missing
  formula completion gate; GREEN `npm --workspace packages/api test --
--runInBand --watch=false src/steel/ai/provider.spec.ts` passed 19 tests.

# Steel AI-Led Workbook Patch Completion

- [x] Add RED provider coverage that workbook patch instructions tell AI to fill derivable blank workbook fields across all user-relevant sheets.
- [x] Add RED provider coverage that a quote_details-only quick quote patch is treated as incomplete and the model must call patch_workbook again with explicit rows for the other user-relevant sheets.
- [x] Implement prompt/runtime guidance so AI fills blank cells only when usable material/customer/source/calculation data exists, otherwise leaves cells blank and records the missing evidence in review/notes.
- [x] Remove or narrow backend hard-fill behavior that conflicts with AI-owned multi-material workbook patching.
- [x] Run focused provider/handler tests, build check, and diff check.

## Review

- Replanned after user correction: multi-material workbook lists need AI to
  generate explicit patch rows from workbook context and tool results. Backend
  should validate/apply/remind, not hard-code derived companion rows.
- Provider prompt now tells AI to fill derivable blank workbook cells across all
  user-relevant sheets, and to leave unavailable facts blank while recording
  missing material/customer/source/calculation evidence in manual review or
  interpretation notes.
- Provider tool loop now marks provisional quick-price workbook patches as
  incomplete when sheets are missing, returns `missingSheetIds`, and requires
  another AI `patch_workbook` call before the final answer.
- Handler no longer derives companion rows from `報價明細`; it validates and
  applies explicit AI patch operations only.
- Documentation updated in `docs/steel-catalog-family-data-contract.md` to make
  workbook patch ownership AI-led and backend hard-fill out of bounds.
- Verification: `provider.spec.ts` passed 19 tests; `handlers.spec.ts` passed
  22 tests; `npm --workspace packages/api run build` passed with existing
  non-Steel Rollup TypeScript warnings; `git diff --check` passed.

# Steel Follow-Up Workbook Patch Completion

- [x] Add RED provider coverage for a follow-up customer/material update that patches quote cells but initially omits companion workbook sheets.
- [x] Extend workbook patch completeness detection so quote/calculation patch operations trigger the missing-sheet loop even when the latest user message is not a price question.
- [x] Keep backend handler as validation/apply only; do not reintroduce hard-coded companion row generation.
- [x] Run focused provider/handler tests, API build, and diff check.

## Review

- Root cause: workbook patch completeness was only required when the latest user
  message looked like a price request. Follow-up updates such as `客戶是龍頂`
  could patch `quote_details` price/customer fields and still end without
  companion rows for `系統訂單`, `總結`, `人工複核`, `價格來源`, `判讀備註`,
  or `給客戶用`.
- Added provider coverage for this exact follow-up path. The RED test failed
  because the model loop stopped after one partial `patch_workbook`; it now
  continues with `missingSheetIds` and requires a second explicit AI patch.
- Implemented a narrow quote-field trigger: in Steel runtime, if AI patches
  quote/calculation fields in `quote_details`, provider applies the same
  workbook completeness loop even when the latest user text is not a price
  question.
- Backend handler remains apply-only for AI operations; no hard-coded companion
  row generation was reintroduced.
- Verification: `provider.spec.ts` passed 20 tests; `handlers.spec.ts` passed
  22 tests; `npm --workspace packages/api run build` passed with existing
  non-Steel Rollup TypeScript warnings; `git diff --check` passed.
