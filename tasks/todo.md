# Steel Data Rules Architecture Work Package

- [x] Record accepted Phase 2 data/rule decisions from the company manual quoting workflow.
- [x] Create a dedicated multi-phase work package under `tasks/steel-data-rules-architecture/`.
- [x] Link the package from the active v8.3 Phase 2 plan so it does not drift from implementation work.
- [x] Update `CONTEXT.md` with the resolved business vocabulary for quote request evidence, material rules, product-price unit weight, and cutting price source.
- [x] Update `tasks/lessons.md` with the new correction patterns.
- [x] Run focused documentation verification.

## Review

- Created `tasks/steel-data-rules-architecture/` as the dedicated package for mapping the real manual quoting workflow into database facts, rule facts, and AI tool-calling contracts.
- Captured the accepted decisions: product-price unit weight wins over handbook unit weight when source rows disagree during reviewed data organization; C-type rules are disclosed to AI only for C-type quote items; H non-standard-length surcharge adjusts material unit price only; cutting always uses the cutting price source; `切工價錢.xlsx` is a formal cutting-price source; customer inquiry files are quote evidence, not formal import sources.
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
