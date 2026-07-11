# Active: Steel Default Pricing And Hole Thickness Query - 2026-07-11

Goal: update the reviewed category pricing defaults for missing thickness/material,
plate price fallback, weight basis, and ceiling behavior; define and implement a
range-aware `加工/孔` thickness lookup against the actual v4.2 price data.

- [x] Inspect current category rules, sync path, unified price schema/query, and relevant prior decisions.
- [x] Inspect live dev `加工/孔` rows and enumerate real `source_thickness` formats.
- [x] Confirm the exact missing-thickness, ceiling, plate fallback, preferred-unit, and lower-inclusive/upper-exclusive range semantics with the user.
- [x] Add RED regressions for the approved hole-range parsing, query, validation, and import contracts.
- [x] Implement the minimal reviewed-rule, query/import, and schema changes required by the approved design.
- [x] If schema changes are required, create a migration with `npx supabase migration new` and update `supabase/schema.sql` in the same change.
- [x] Dry-run/apply/read back reviewed rules and the migration on dev only.
- [x] Run focused tests, package build, live query smokes, and `git diff --check`; record review evidence here.

Approved contract:

- C型鋼、H型鋼、方鐵、鐵板 prefer Kg; only explicit `不切清` permits M/支/other units.
- 槽鐵、角鐵、鐵軌、圓管、圓鐵、平鐵、扁方管、方管、網 default to `不切清` and prefer 支/只/片.
- 板/浪板 pricing is length-led; each final material-line subtotal is ceiled to an integer TWD.

Review:

- Added normalized `thickness_min_mm` / `thickness_max_mm` to the unified `steel.prices` model, importer, public candidate output, schema snapshot, and CLI-created migration `20260711072639`.
- Thickness input now accepts positive decimal strings only. Range rows use lower-inclusive/upper-exclusive matching; scalar rows use exact matching. Explicit `厚度` ranges are parsed without treating hole-diameter text such as `沖孔φ(1.0~2.0)` as material thickness; source ranges such as `20~25m/m` are also supported.
- Dev migration history contains `20260711072639`; `steel.prices` has 6,761 rows, 2,023 normalized thickness rows, six non-scalar hole ranges, and the paired-positive ordered-range constraint.
- Live grouped-query smoke proved every range lower bound and interior matches while upper bounds `4.5`, `12`, `19`, `25`, `32`, and `50` do not; a scalar `min=max` row still matched exactly.
- Updated and synced six reviewed category-rule rows on dev. The lookup guide now carries minimum-thickness selection, category unit priorities, default `不切清`, length-led 浪板 pricing, OT laser-to-four-side fallback, and final-material-line TWD ceiling behavior.
- Focused Jest passed 7 suites / 76 tests. The v4.2 dry-run reconciled 6,761 rows, the API package build passed, and `git diff --check` passed.
- Supabase advisors reported only the existing mutable-search-path and public-extension warnings; this change adds no exposed Data API objects, functions, or RLS surface. Production was not accessed or changed.

# Active: system_order capture and regenerate timer reset - 2026-07-11

Goal: adopt the 16-column `system_order` contract, persist any assistant
`system_order` Markdown table containing `型號`, and restart the visible
processing timer from zero when a response is regenerated.

- [x] Inspect conversation `c9088530-4da5-4578-9798-374c475ddb97` and prove the parse-skip root cause.
- [x] Add RED regressions for the 16-column workbook contract and `型號`-only capture eligibility.
- [x] Add RED regressions for a regenerate-specific response start timestamp and timer reset.
- [x] Implement the minimal parser, workbook-header, and timer lifecycle fixes.
- [x] Run focused backend/frontend tests, package checks, local runtime health, and diff hygiene.
- [x] Record final review evidence here.

Review:

- Local log message `615f7d38-7706-4c3e-af10-14455293a3dd` reached capture but returned `parseStatus: skipped`; its 51-row table had the new 16 headers and no `項次`. Mongo had zero active `working_order_row` records before the fix.
- Parser RED reproduced `parseStatus: skipped`; GREEN now accepts `system_order` tables based on `型號` and persists rows without requiring `rowNo` / `項次`.
- The original conversation was backfilled from its persisted assistant response: `parseStatus: saved`, 51 active `working_order_row` records, one `system_order_table`.
- Timer RED showed `1m 40s` on a completed-to-regenerate lifecycle; GREEN resets both the same timer instance and a remounted regenerate response with an old parent timestamp to exact `0s`.
- Dev `steel-workbook-output-policy` was synced and read back at SHA `6b3b740f4cb2b8cf9d332d1bfefaa530c1f5241d95695aac6c8cd5e758bd617c`.
- Focused Jest passed 3 API suites / 80 tests and 2 client suites / 11 tests. API build, client typecheck, changed-file ESLint (apart from existing unrelated diagnostics), fake-model syntax, backend/frontend health, and staged diff checks passed.

# Active: Fixed OpenAI Title Model - 2026-07-11

Goal: make shared Agents title generation use `gpt-5.6-luna` with reasoning
effort `none` for OpenAI API and OpenAI OAuth without changing main chat runs.

- [x] Confirm the current OpenAI API and OAuth title paths.
- [x] Approve and commit the focused design spec.
- [x] Write the TDD implementation plan.
- [x] Add failing regressions for OAuth, OpenAI API, and non-OpenAI preservation.
- [x] Implement the fixed title-only model and reasoning policy.
- [x] Run focused tests, adjacent controller tests, API package build, and diff checks.
- [x] Complete independent code review and record results.

Design:
`docs/superpowers/specs/2026-07-11-fixed-openai-title-model-design.md`

Implementation:
`docs/superpowers/plans/2026-07-11-fixed-openai-title-model.md`

Review:

- OAuth title generation ignores the selected chat model and returns
  `gpt-5.6-luna`; the provider call carries reasoning effort `none`.
- OpenAI API title generation immutably overrides only `model` and
  `reasoning_effort`, preserving unrelated options and the caller's object.
- Both `Providers.OPENAI` and `EModelEndpoint.openAI` direct identifiers are
  covered. Endpoint-aware detection prevents custom OpenAI-compatible and Azure
  serverless routes from being mistaken for the standard OpenAI API endpoint.
- TDD RED failed first on the old selected-model behavior and again on the
  custom/Azure collision. GREEN passed 7 focused title tests; adjacent
  AgentClient tests passed 93 tests.
- `npm run build:api` and `git diff --check` passed. Independent review returned
  PASS for both spec compliance and code quality with no remaining findings.
- The implementation remains uncommitted because the target files contain
  overlapping user-owned OAuth transport changes.

# Active: GPT-5.6 Luna OAuth Transport Compatibility - 2026-07-11

Goal: make OCR preprocessing and the main OpenAI OAuth run use the explicitly
selected `gpt-5.6-luna` model through the current Codex protocol.

- [x] Reproduce the organizer failure with the same OAuth account and model.
- [x] Confirm the failure is an outdated transport contract rather than an
      invalid model name or different account.
- [x] Add a failing adapter regression for Codex model-catalog resolution and
      Responses Lite request metadata.
- [x] Replace `openai-oauth-provider` with the `openai-oauth@2.0.0-beta.2`
      in-process adapter packages.
- [x] Verify focused tests/builds and a live luna request through the adapter.
- [x] Restart localhost and verify the OCR organizer path plus backend health.

Review:

- Root cause was transport compatibility, not the selected model or OAuth
  account. `gpt-5.6-luna` is returned by the current account-aware model
  catalog with Responses Lite enabled, but the beta transport omitted the
  current Codex `originator` and versioned `user-agent` response headers; the
  upstream request therefore returned `Model not found`.
- Replaced `openai-oauth-provider@1.0.3` with exact
  `@openai-oauth/ai-sdk`, `@openai-oauth/core`, and `@openai-oauth/local`
  `2.0.0-beta.2` dependencies. OAuth model, direct provider, title, token, and
  usage paths now use the split packages with shared stateless transport
  construction.
- The transport compatibility wrapper reads the core package's
  `client_version` model-catalog query, then supplies the matching current
  Codex identity on `/responses`; credentials refresh remains untouched.
- TDD evidence: the new identity-header assertion failed before the wrapper
  (`originator` was null), then the five related API suites passed: 5 suites / 50
  tests. ToolService OCR organizer regression passed: 1 suite / 79 tests.
- `packages/api` build passed. A real authenticated
  `sendSteelOAuthChat` smoke using `gpt-5.6-luna` passed and returned the exact
  expected value instead of `Model not found`.
- Dependency verification passed: `npm ls` resolves all three split packages
  to `2.0.0-beta.2` with `@openai-oauth/core` deduped; no
  `openai-oauth-provider` reference remains; lockfile JSON and npm 11.13.0
  `npm ci --dry-run` passed.
- Local backend was restarted in detached screen `librechat-backend`; health
  returned `OK` on port 3080. The previously stopped frontend was started in
  detached screen `librechat-frontend`, and `localhost:3090` returned HTTP 200.
  `git diff --check` and the staged equivalent both passed. Changes remain
  uncommitted and unstaged by this task.

# Active: Steel Price And Cutting Catalog - 2026-07-11

Goal: update grouped Steel price lookup, build and import the clean cutting
catalog, revise category pricing rules, and correct `system_order.肚` on dev.

- [x] Record and review the approved design and implementation plan.
- [x] Generate and visually verify `docs/reference/切工價錢-clean.xlsx`.
- [x] Add `steel.cutting_prices`, remove `steel.prices.review_state`, and add an
      atomic clean-workbook importer.
- [x] Update grouped price lookup filters and append one consolidated cutting
      catalog after normal price queries finish.
- [x] Update category rules for 鐵板, C型鋼/CCG02, ratio use, cutting lookup,
      and normal limit behavior.
- [x] Rename the fixed output field from `度` to `肚` and gate it only by
      formula code DA/DB/DC.
- [x] Apply and verify schema/data/rules on dev; do not access prod.
- [x] Run focused tests, build, live smokes, and requirement-by-requirement
      completion audit.

Design:
`docs/superpowers/specs/2026-07-11-steel-price-cutting-catalog-design.md`

Implementation:
`docs/superpowers/plans/2026-07-11-steel-price-cutting-catalog.md`

Review:

- Dev `steel.prices` was atomically replaced from `products_db_v4.2.xlsx`:
  6,761 rows and 6,761 distinct ERP codes (`confirmed=4,880`,
  `ratio_only=230`, `no_price=1,651`). `review_state` is absent from the live
  `steel.prices` columns.
- Dev `steel.cutting_prices` contains 119 clean-workbook rows: 100 price rows
  and 19 supplements across `H型鋼`, `工字鐵/H型鋼`, `鐵管`, `角鐵`, `槽鐵`,
  and `鐵板/平鐵`. Exact 25.4 conversion readback includes `1/2" = 12.7mm`
  and `5/8" = 15.875mm`.
- A live 11-query smoke used two SQL calls total: all grouped normal queries
  completed first, then one unlimited cutting lookup returned all 119 rows.
  Query provenance, `limit=101 -> 100`, numeric thickness equality, 鋅
  contains matching, and hidden candidate `sourceRefs` were verified.
- Dev has nine active reviewed rules. `system_order` uses `肚`, formulas
  DA/DB/DC read back as `(長度/4) * 肚`, `(長度/3) * 肚`, and
  `長度 * 寬度 * 肚`; the old 捲門 category gate is absent. Existing workbook
  rows stored as `度` or `degree` remain readable and render under the canonical
  `肚` header; new E2E fixtures emit only `肚`.
- Focused Jest: 15 suites / 153 tests passed. Package build passed. Focused
  ESLint completed with 0 errors (three existing unused-schema warnings).
  Final workbook inspection found zero formula errors, and both sheets were
  rendered and visually checked.
- Prod Supabase was not accessed or changed; rollout remains gated on explicit
  user approval after dev verification.

# Active: OpenAI OAuth frontend setting parameter audit - 2026-07-09

Goal: verify whether LibreChat chat settings for Image Detail and Reasoning
Effort are applied to the OpenAI OAuth provider request path.

Checklist:

- [x] Trace frontend storage/request payload for `imageDetail` and
      `reasoningEffort`.
- [x] Trace backend conversation/client option parsing into the OpenAI OAuth
      provider.
- [x] Compare current defaults against the expected contracts:
      Image Detail UI `Auto` should resolve to provider `high`; Reasoning
      Effort UI `Auto` should resolve from `OPENAI_REASONING_EFFORT`.
- [x] Record evidence, gaps, and recommended fix scope.

Review:

- Frontend `openai_oauth_responses` uses the OpenAI settings schema, so
  `imageDetail` and `reasoning_effort` reach the backend payload.
- Root cause: the native OpenAI OAuth graph override only read camel
  `reasoningEffort`, while the normal settings path resolves explicit frontend
  values into `modelKwargs.reasoning_effort` or `modelKwargs.reasoning.effort`.
- Root cause: native OAuth image conversion hardcoded every image as
  `imageDetail: "high"`, so `Auto` effectively matched the desired high default
  but explicit `Low` was ignored.
- Fixed native OAuth normalization so explicit frontend reasoning effort wins
  over `OPENAI_REASONING_EFFORT`, while `Auto`/empty still falls back to env
  config. Image detail now maps `low -> low` and `auto`/unset/`high -> high`.
- Verification:
  - Red checks failed before implementation for explicit frontend
    `reasoning_effort=low` and image `detail=low`.
  - `cd packages/api && npx jest src/steel/native/oauth.spec.ts --runInBand --watch=false --coverage=false` passed, 12 tests.
  - `cd packages/api && npx jest src/agents/__tests__/run-summarization.test.ts --runInBand --watch=false --coverage=false` passed, 107 tests.
  - `cd packages/api && npm run build` passed.
  - `git diff --check` passed.

# Active: production Docker PaddleOCR layer verification - 2026-07-09

Goal: build the production `api-build` Docker target and verify the resulting
image contains the preinstalled `paddleocr_mcp` executable.

Checklist:

- [x] Confirm the production Docker target and local verification command.
- [x] Run `docker build --target api-build` for `Dockerfile.multi`.
- [x] Run a container command that resolves `paddleocr_mcp`.
- [x] Record result or blocker.

Review:

- Production workflow target confirmed as `Dockerfile.multi` target
  `api-build` with `linux/amd64`.
- Built local production image successfully:
  `docker build --platform linux/amd64 --file Dockerfile.multi --target api-build --tag librechat-prod-api:paddleocr-layer-check .`.
- Build log verified the PaddleOCR layer installed `paddleocr-mcp==0.8.5` and
  resolved `/usr/local/bin/paddleocr_mcp` during image build.
- Container verification passed:
  `docker run --rm --platform linux/amd64 --entrypoint sh librechat-prod-api:paddleocr-layer-check -lc 'set -eu; path="$(command -v paddleocr_mcp)"; echo "paddleocr_mcp=$path"; test -x "$path"; uv tool list'`.
- Runtime check output:
  `paddleocr_mcp=/usr/local/bin/paddleocr_mcp`,
  `paddleocr-mcp v0.8.5`, `- paddleocr_mcp`.
- Image metadata: `linux/amd64`, image id
  `sha256:18a24fcd9d7934b42749e970450e52d11063fdbd89c8cf7cd2a03aa5fcabfc72`,
  size `1407013306` bytes.

# Active: simplify current PaddleOCR startup/timeout diff - 2026-07-09

Goal: simplify the current working-tree diff without changing public runtime
contracts or broadening the PaddleOCR retry behavior.

Checklist:

- [x] Review the changed PaddleOCR startup, retry, timeout, docs, and tests.
- [x] Apply small local simplifications only where they reduce duplication or
      stale-risk.
- [x] Run focused Jest/static checks and `git diff --check`.
- [x] Record results.

Review:

- Reused the new single-file PaddleOCR preflight test helpers for the older
  sequential connection-reset retry test, removing duplicated mock request,
  missing-file, tool-load, and chunk-pipeline setup.
- Added a small `mockPaddleOcrToolLoads` helper so PaddleOCR retry tests no
  longer repeat the MCP tool wrapper shape.
- Removed the extra `uv tool list` build output from `Dockerfile.multi`; the
  build still verifies the cached tool with `command -v paddleocr_mcp`.
- Intentionally did not narrow the existing provider reset retry patterns in
  this simplify pass, because that would change the current retry contract
  covered by the sequential connection-reset regression.
- Verification:
  - `cd api && npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false` passed, 79 tests.
  - `cd api && npx jest server/services/initializeMCPs.spec.js --runInBand --watch=false --coverage=false` passed, 16 tests.
  - `node --check api/server/services/ToolService.js`, `node --check api/server/services/initializeMCPs.js`, `sh -n deploy/host/paddleocr-smoke.sh`, YAML parse/assertion, and `git diff --check` passed.

# Active: PaddleOCR retry pattern and timeout tuning - 2026-07-09

Goal: keep PaddleOCR connection-start retries narrow while reducing OCR timeout
budgets from 20 minutes to 10 minutes and shortening non-OCR timeouts to
reasonable startup/request values.

Checklist:

- [x] Add regression coverage for connection-establishment retry and real OCR
      job timeout non-retry.
- [x] Limit PaddleOCR retry matching to connection startup failure patterns.
- [x] Change PaddleOCR config/docs from 20-minute OCR timeout to 10 minutes.
- [x] Shorten non-OCR init/request timeout values.
- [x] Run focused verification and `git diff --check`.
- [x] Record results.

Review:

- Added red-green coverage proving `Connection timeout after 30000ms` triggers
  the PaddleOCR connection rebuild/retry path, while a real OCR job timeout
  (`PaddleOCR MCP OCR timed out after 600000 ms.`) does not retry.
- PaddleOCR retry patterns now add only connection-start phrases:
  `connection timeout after` and `failed to establish connection`.
- Runtime config now uses `timeout: 600000`, `initTimeout: 60000`,
  `PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT: "60"`,
  `PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT: "600"`, and
  `PADDLEOCR_MCP_HTTP_TIMEOUT: "60"`.
- Verification:
  - Red test failed before implementation:
    `cd api && npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "connection establishment timeout|real OCR job timeout"`.
  - `cd api && npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false` passed, 79 tests.
  - `cd api && npx jest server/services/initializeMCPs.spec.js --runInBand --watch=false --coverage=false` passed, 16 tests.
  - `node --check api/server/services/ToolService.js`, `node --check api/server/services/initializeMCPs.js`, YAML parse/assertion, current-runtime `rg`, and `git diff --check` passed.

# Active: PaddleOCR eager startup and build-time cache - 2026-07-09

Goal: remove PaddleOCR request-time cold start by preserving `startup:true`,
removing the forced lazy-load override, and installing/cacheing `paddleocr-mcp`
during the production image build.

Checklist:

- [x] Add focused regression coverage for preserving PaddleOCR eager startup.
- [x] Remove the `initializeMCPs` PaddleOCR lazy-load override.
- [x] Change production PaddleOCR config to `startup:true`, `initTimeout`, and
      direct `paddleocr_mcp` command.
- [x] Install/cache `paddleocr-mcp` before deploy/start in `Dockerfile.multi`.
- [x] Update current deployment docs that describe the PaddleOCR runtime.
- [x] Run focused verification and `git diff --check`.
- [x] Record results.

Review:

- Red regression check failed before implementation because `initializeMCPs`
  still forced PaddleOCR to `startup:false`.
- Focused regression passed after removing the override:
  `cd api && npx jest server/services/initializeMCPs.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR eager"`.
- Full focused suite passed:
  `cd api && npx jest server/services/initializeMCPs.spec.js --runInBand --watch=false --coverage=false`.
- Static checks passed: `node --check api/server/services/initializeMCPs.js`,
  YAML parse/assertion for PaddleOCR config, current-runtime `rg` audit, and
  `git diff --check`.
- Full Docker image build/deploy was not run in this implementation pass.

# Active: simplify current Codex OAuth diff - 2026-07-08

Goal: simplify the current working tree changes for the admin Codex OAuth token
and login flow without changing public API contracts.

Checklist:

- [x] Collect current diff scope and high-risk changed modules.
- [x] Review code reuse, code quality, and efficiency findings in parallel.
- [x] Apply only local, low-risk simplifications.
- [x] Run focused backend/client verification plus `rtk git diff --check`.
- [x] Record simplify review results.

Review:

- Reused `openAIOAuthTokenLoginStatusSchema` for frontend login-error body
  validation instead of duplicating the enum/type guard locally.
- Reused the Codex login status renderer between the dialog and OAuth token
  `Status` row, while keeping refresh status precedence unchanged.
- Kept token display sourced from the token-status query cache after login
  success instead of mixing in `loginStatus.token` as a second source of truth.
- Restored persisted Codex login sessions only for admin users, clears stale
  sessions for non-admin users, and converts polling failures into a visible
  `login_not_found` status.
- Centralized Codex home expansion for CLI detection and login, so
  `CODEX_HOME=~/...` resolves the same way in both paths.
- Verification passed:
  - `cd client && rtk npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/steel/native/token.spec.ts --runInBand --watch=false --coverage=false`
  - `cd client && rtk npm run typecheck`
  - `cd packages/api && rtk npm run build`
- `rtk git diff --check`

## Active: Simplify Steel pricing/cutting range - 2026-07-11

Goal: review and simplify every changed file and relevant nearby module in
`9d31b51e296e6bdb337660b85..HEAD` without changing public contracts.

- [x] Confirm the requested commit is an ancestor of `HEAD` and inventory the
      full named range separately from the working tree.
- [x] Review code reuse, code quality, and efficiency in parallel across the
      named range and relevant call sites/tests.
- [x] Apply only clearly beneficial, local simplifications while preserving
      APIs, schema contracts, rule behavior, and importer semantics.
- [x] Run focused tests/build checks for touched modules plus
      `rtk git diff --check`.
- [x] Record accepted fixes, intentional skips, and verification evidence.

Review:

- Centralized the v4.2 workbook headers and source-dataset constant so the
  parser type and importer use one contract.
- Aligned v4.2 parser validation with the database's nonnegative numeric and
  cost-basis constraints.
- Follow-up correction: grouped price IDs now always come from `queries` order
  (`q1`, `q2`, ...); supplied IDs are ignored, collisions are not rejected, and
  AI-visible rules/examples use positional result mapping.
- Applied the updated rules to the dev Supabase in one transaction: all 9 rows
  are active/reviewed, the agent and category guide contain the query-order
  contract, and no active prompt retains a custom `"queryId"` JSON example.
- Ran independent product-price and cutting-price repository queries in
  parallel, removed the identity material lookup map, and reused the canonical
  A/B/C/F tier constant in schema mappings.
- Made rule publication transactional on one connection with an advisory lock,
  rollback coverage, and fail-fast CLI argument validation; also removed dead
  rule-sync branches.
- Limited aggregate memory-total reads to the fields actually needed for
  counting, and reused one system-order fixture header in the E2E fake model.
- Intentionally kept the explicit category tuple types after the declaration
  build proved inference is incompatible with `--isolatedDeclarations`.
- Intentionally skipped purpose-specific memory-reader redesign, v3 importer
  retirement, and rule ownership changes because they require separate contract
  decisions.
- Verification passed:
  - 10 focused Jest suites / 152 tests.
  - Positional query-ID follow-up: 5 focused Jest suites / 58 tests.
  - `cd packages/api && rtk npm run build`.
  - v4 importer dry-run: 6,761 rows, 0 duplicate ERP codes, expected state totals.
  - rule sync dry-run: 9 reviewed rule payloads.
  - `rtk node --check e2e/setup/fake-model.js`.
  - `rtk git diff --cached --check`.

## Active: Steel Pricing v4.2 Full Replacement - 2026-07-10

Goal: make `docs/products_db_v4.2.xlsx` authoritative for `steel.prices`,
redesign `search_price_candidates` as grouped multi-query lookup, restore safe
ratio pricing, rename category rules, and add the `system_order.度` field.

- [x] Add the complete v4.2 category/subcategory registry and pure parser.
- [x] Add paired Supabase schema migrations, schema snapshot, and atomic importer.
- [x] Return grouped price results carrying each normalized query ID.
- [x] Clamp positive query limits above 100 instead of rejecting them.
- [x] Expose Kg/M ratio options and mark other ratio units skipped for future rules.
- [x] Rename `鋼材規則` to `類別規則` and document every category query shape.
- [x] Add `度` after `長度` for DA/DB/DC rolling-door system-order rows.
- [x] Replace dev `steel.prices`, sync reviewed rules, and run focused/live verification.
- [ ] Copy the verified dev pricing/rules rollout to prod only after user confirmation.

Design: `docs/plans/2026-07-10-steel-pricing-v4-2-design.md`  
Implementation: `docs/plans/2026-07-10-steel-pricing-v4-2-implementation.md`

Review (dev rollout, 2026-07-11):

- Dev `.env` Supabase now has the authoritative 6,761 v4.2 rows, 6,761 distinct
  ERP codes, and state totals 4,880 confirmed / 230 ratio-only / 1,651 no-price.
- Final `steel.prices` has the exact 51-column shape, validated v4.2 constraints,
  required lookup/trigram indexes, no zero price/ratio placeholders, and
  `KA02I = 加工/其他 -> 扁鐵`.
- All 9 current rules are active/reviewed; 6 category rules use only
  `docs/rules/類別規則/...`, and the output rule contains the
  `system_order.度` DA/DB/DC rolling-door contract.
- One grouped live tool call verified explicit query IDs, limit 101 -> 100,
  direct-price priority, Kg ratio pricing, non-Kg/M skipped ratio behavior,
  thickness `2`, and no raw ratio leakage.
- Verification passed: 12 focused suites / 148 tests, 1 Mongo-backed degree
  smoke, package build, focused ESLint/syntax checks, and `git diff --check`.
- Production was not accessed or modified; the production copy remains gated on
  explicit user approval.

# Active: Codex login modal UX - 2026-07-08

Goal: replace the fragile popup-based Codex login flow with a LibreChat-style
modal that shows login status, verification code, login URL, copy feedback, and
a Close action.

Checklist:

- [x] Inspect existing LibreChat dialog components and current OAuth token UI.
- [x] Implement modal-only Codex login flow without exposing secrets.
- [x] Update focused UI tests for modal URL/code/status behavior.
- [x] Run focused verification, frontend build, and `rtk git diff --check`.
- [x] Record results and lesson.

Review:

- Replaced popup/about:blank Codex login behavior with a LibreChat-style modal
  rendered from the model selector provider, outside the model-list menu layer.
- The modal shows login status, verification code above the login URL, manual
  copy feedback, and a Close action.
- Loading slots in the Codex login dialog now use skeleton placeholders instead
  of `Loading...` text.
- Status values now use compact labels with colored dots: pending/loading states
  yellow, success states green, and failed/unavailable/expired states red.
- `Open link` stays disabled until the verification code is copied.
- Pending login sessions now keep polling in the provider and the modal remains
  mounted when the model-list menu closes.
- Kept verification URL/code in the admin-only modal and left the compact OAuth
  section focused on `Status`, `Expires`, `Codex CLI`, and actions.
- Local auth-file guidance now recommends an app-specific
  `$HOME/.librechat-openai-oauth/auth.json` path instead of sharing
  `~/.codex/auth.json`.
- Verification passed:
  - `cd client && rtk npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --runInBand --watch=false --coverage=false`
  - `cd client && rtk npm run typecheck`
  - `node -e "JSON.parse(require('fs').readFileSync('client/src/locales/en/translation.json','utf8')); console.log('json-ok')"`
  - `rtk npm run frontend`
  - `rtk git diff --check`

# Active: Codex login failed tab diagnosis - 2026-07-08

Goal: make the admin Codex login tab show the real sanitized failure reason and
avoid stale login-session state overwriting a new login attempt.

Checklist:

- [x] Check server logs, local env, and direct Codex login service behavior.
- [x] Add frontend coverage for failed/unavailable login start handling.
- [x] Implement scoped tab/status error handling without exposing secrets.
- [x] Fix Codex CLI device-code parsing so `Open this` is not treated as
      `OPEN-THIS`.
- [x] Run focused verification plus `rtk git diff --check`.
- [x] Record result and lesson.

Review:

- Root cause: the Codex CLI parser had a global device-code fallback, so streamed
  prose like `Open this link` matched the `4-4/4-5` code shape and surfaced as
  `OPEN-THIS`.
- Fixed parser to only accept line-scoped explicit prompts such as `Enter ...
  code` or `Use ... code`; generic text like `device code` is not treated as a
  prompt.
- Added backend regression proving the first streamed chunk with only `Open this
  link` and the generic `device code` page title exposes only the verification
  URL, then fills the code only after the real prompt arrives.
- Added a frontend guard so stale cached `OPEN-THIS` values are not rendered as
  verification codes.
- Added frontend handling for `POST /login` HTTP errors so sanitized enum reasons
  appear in Status/about:blank instead of a generic failed tab.
- Rebuilt frontend and `packages/api`, then restarted local backend on
  `http://localhost:3080`.
- Verification passed:
  - `cd packages/api && rtk npx jest src/steel/native/token.spec.ts --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npm run build`
  - `cd client && rtk npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --runInBand --watch=false --coverage=false`
  - `rtk npm run frontend`
  - compiled dist smoke for the `OPEN-THIS` parser case
  - `cd client && rtk npm run typecheck`
  - `rtk git diff --check`

# Active: admin OAuth refresh status row - 2026-07-08

Goal: move OAuth token refresh feedback into the `Status` row instead of a
separate message below the buttons.

Checklist:

- [x] Make the status row show `Refreshing...`, `Checked`, or `Refresh failed`
      from the refresh mutation state.
- [x] Remove the separate refresh feedback line.
- [x] Update focused UI coverage.
- [x] Run focused client verification plus `rtk git diff --check`.
- [x] Record result.

Review:

- Moved refresh feedback into the existing `Status` row:
  - idle token status: `Valid` / `Expired` / `Unavailable`
  - pending refresh: `Refreshing...`
  - successful refresh check: `Checked`
  - failed refresh: `Refresh failed`
- Removed the separate `Token checked` message below the action buttons.
- Added the `Checked` locale key and removed the now-unused `Token checked` key.
- Verification passed:
  - `cd client && rtk npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --runInBand --watch=false --coverage=false`
  - `cd client && rtk npm run typecheck`
  - `rtk npm run frontend`

# Active: admin OAuth token row layout - 2026-07-08

Goal: align the admin OAuth token section into fixed label/value rows so token
state lives on a `Status` row instead of mixed inline status text.

Checklist:

- [x] Convert OAuth token status display to `Status`, `Expires`, and
      `Codex CLI` rows.
- [x] Update focused UI coverage for the row labels.
- [x] Run focused client verification plus `rtk git diff --check`.
- [x] Record result.

Review:

- Changed the OAuth token details to fixed label/value rows:
  - `Status` / `Valid`
  - `Expires` / formatted expiry time
  - `Codex CLI` / `Unavailable`
- Superseded by the next pass: refresh feedback now lives in the `Status` row
  instead of below the buttons.
- Added locale keys for `Status`, `Codex CLI`, and `Available`.
- Verification passed:
  - `cd client && rtk npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --runInBand --watch=false --coverage=false`
  - `cd client && rtk npm run typecheck`
  - `rtk npm run frontend`

# Active: admin OAuth refresh button feedback - 2026-07-08

Goal: make the admin-only OpenAI OAuth token refresh control visibly respond on
localhost even when the refreshed token status or expiry timestamp does not
change.

Checklist:

- [x] Reproduce the UI gap from the token section code path and existing tests.
- [x] Add focused coverage for refresh pending, success, and failure feedback.
- [x] Implement minimal visible feedback without exposing token secrets or auth
      file paths.
- [x] Run focused client verification plus `rtk git diff --check`.
- [x] Record the result and any remaining server/deploy caveat.

Review:

- The bug was visible-state, not a missing click handler: the mutation already
  fired, but the panel only changed when the token status/expiry changed.
- Added inline refresh feedback with `aria-live`: `Refreshing...` while the
  request is pending, `Token checked` on a usable refreshed status, and
  `Refresh failed` when the backend returns unavailable or the request errors.
- Kept the browser response sanitized: no token values, account identifiers, or
  auth-file paths are added to the UI.
- Rebuilt the frontend bundle so a compiled `http://localhost/` server can pick
  up the changed client assets after restart/reload.
- Verification passed:
  - `cd client && rtk npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --runInBand --watch=false --coverage=false`
  - `cd client && rtk npm run typecheck`
  - `rtk npm run frontend`
  - `rtk git diff --check`

# Active: SSE resume replay batching - 2026-07-08

Goal: reduce reconnect/resume UI churn by batching message-state writes during
SSE sync replay while preserving live streaming updates.

Checklist:

- [x] Inspect `useResumableSSE` sync/replay paths and `useStepHandler` message
      update behavior.
- [x] Add a focused regression showing resume replay commits message state once
      after multiple replay updates.
- [x] Implement a replay-only message batching proxy in `useResumableSSE`.
- [x] Run focused SSE frontend tests, client typecheck, and `rtk git diff --check`.
- [x] Record result and skipped broader replay/storage work.

Review:

- Added a resume-sync-only message batch in `useResumableSSE` so replay handlers
  read and write the same in-memory message array, then commit to React state
  once after sync replay completes.
- Preserved live stream behavior by routing normal `setMessages` calls directly
  to the existing chat helper outside the sync branch.
- Added a regression covering one resume sync packet with snapshot hydration plus
  replayed and pending approval events; the final committed response contains
  both approval parts with one `setMessages` commit.
- Skipped broader backend replay storage batching; this pass only reduces
  frontend resume replay message churn.
- Verified:
  - `rtk npx jest src/hooks/SSE/__tests__/useResumableSSE.spec.ts --runInBand --watch=false --coverage=false`
  - `rtk npx jest src/hooks/SSE/__tests__/useStepHandler.spec.ts src/hooks/SSE/__tests__/useResumableSSE.spec.ts src/hooks/SSE/__tests__/useResumeOnLoad.spec.tsx --runInBand --watch=false --coverage=false`
  - `rtk npm run typecheck` in `client`
  - `rtk git diff --check`

# Active: backend stream-prefix consolidation - 2026-07-08

Goal: centralize backend OAuth MCP stream-prefix detection so stream replay and
abort persistence share one helper instead of duplicate local prefix constants.

Checklist:

- [x] Inspect current OAuth MCP helper exports and stream call sites.
- [x] Add or reuse one backend helper without changing stream event contracts.
- [x] Replace local duplicate prefix checks in stream modules.
- [x] Run focused stream/package verification plus `rtk git diff --check`.
- [x] Record result and any skipped broader stream refactors.

Review:

- Added one backend OAuth MCP tool-call prefix constant and
  `isOAuthToolCallName` helper in `packages/api/src/mcp/utils.ts`, next to the
  existing `buildOAuthToolCallName` builder.
- Replaced duplicate local OAuth prefix checks in
  `packages/api/src/stream/GenerationJobManager.ts` and
  `packages/api/src/stream/abortContent.ts`.
- Added utility coverage for the shared prefix and detector.
- Kept the broader SSE replay batching work out of scope.
- Verified:
  - `rtk npx jest --runTestsByPath src/mcp/__tests__/utils.test.ts src/stream/__tests__/GenerationJobManager.resumeReplay.spec.ts src/stream/__tests__/collectedUsage.spec.ts --runInBand --coverage=false`
  - `rtk npm run build` in `packages/api`
  - `rtk git diff --check`

# Active: simplify 717854df234808f6f4907..HEAD - 2026-07-08

Goal: review the current branch changes from `717854df234808f6f4907` to `HEAD`
for local simplifications without changing public APIs or broadening scope.

Checklist:

- [x] Collect diff scope and identify the highest-risk changed areas.
- [x] Run code reuse, quality, and efficiency review tracks in parallel.
- [x] Apply only clear, local simplifications that reduce risk or duplication.
- [x] Run focused verification for touched modules plus `rtk git diff --check`.
- [x] Record review results and any intentionally skipped findings.

Review:

- Extracted shared SSE resume timestamp helpers and OAuth tool-call-name
  detection so resume hydration and step handling do not carry parallel local
  copies.
- Synced pending-action SSE updates through `syncStepMessage` before applying
  subsequent stream events.
- Reused the MCP server selection predicate in the MCP item dialog so select-all
  replaces legacy/current server tokens instead of leaving stale selections.
- Centralized Langfuse central base URL resolution and simplified Steel title
  structured-output chain construction.
- Consolidated Steel user-group member-key resolution, preserved
  `idOnTheSource` in principal search results, removed external users from both
  source-key and raw-id memberships, and moved user group cleanup before user
  row deletion so the source key can still resolve.
- Fixed two small client typecheck blockers found by verification:
  `Constants.NEW_CONVO` enum typing in the chat state spec and missing
  `com_ui_unavailable` in the English locale baseline.
- Skipped broader opportunities that would exceed this simplify pass:
  GenerationJobManager/Redis replay storage reshaping, SSE replay render
  batching, backend stream-prefix consolidation, and ToolCard/ToolRow UI
  display refactors.
- Verified:
  - `rtk npx jest src/hooks/SSE/__tests__/useStepHandler.spec.ts src/hooks/SSE/__tests__/useResumableSSE.spec.ts src/hooks/SSE/__tests__/useResumeOnLoad.spec.tsx src/components/SidePanel/Agents/Tools/ItemDialog/__tests__/McpSection.spec.tsx --runInBand --watch=false --coverage=false`
  - `rtk npx jest src/components/Chat/__tests__/state.spec.ts src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --runInBand --watch=false --coverage=false`
  - `rtk npx jest --runTestsByPath src/methods/userGroup.spec.ts --runInBand --coverage=false`
  - `rtk npx jest --runTestsByPath src/steel/native/title.spec.ts src/langfuse/feedback.spec.ts --runInBand --coverage=false`
  - `rtk npx jest server/controllers/__tests__/deleteUser.spec.js --runInBand`
  - `rtk npm run build` in `packages/data-schemas`
  - `rtk npm run build` in `packages/api`
  - `rtk npm run typecheck` in `client`
  - `rtk git diff --check`

# Active: first text delta timing instrumentation - 2026-07-07

Goal: prove whether OCR main-agent responses stream visible text before final
completion by logging `Invoking LLM -> first text delta -> LLM call complete`.

Checklist:

- [x] Add a focused callback test for first visible text-delta timing logs.
- [x] Implement timing tracking in the native AgentClient event handlers without
      changing stream behavior.
- [x] Run focused callback tests and `rtk git diff --check`.
- [x] Record how to read the next OCR run logs.
- [x] Extend the timing log to summarize received vs emitted visible text
      deltas, so the next OCR run can distinguish provider chunking from
      SSE/client rendering.
- [x] Inspect the next OCR run's delta summary and add client-side SSE text
      delta diagnostics for the remaining frontend/render path.
- [x] Switch the client `SSETextDelta` diagnostic from logger-gated output to
      raw `console.debug` plus `window.__sseTextDeltaStats`.
- [x] Rerun the BH.pdf OCR case and verify console telemetry.

Review:

- `ON_AGENT_LOG` now tracks `Invoking LLM` / `LLM call complete`.
- `ON_MESSAGE_DELTA` now logs the first visible text delta received by the UI
  path, without changing aggregation or SSE emission.
- The completion timing log also reports total received/emitted text-delta
  events and characters, plus first/last emitted timings.
- For `1ee0bd74-e70e-4fa4-bee7-dfdc4679f9ae`, backend received and emitted
  10,409 visible text deltas / 16,758 chars. First emitted delta was 8.86s
  after `Invoking LLM`; last emitted delta was 204.84s, about 1s before LLM
  complete. The remaining issue is therefore client receive/apply/render, not
  backend SSE emission.
- `useStepHandler` now logs `SSETextDelta` first/every-1000 received/applied/
  buffered/dropped text deltas in the browser console to distinguish missing
  run-step buffering from render saturation.
- `SSETextDelta` now uses raw `console.debug` with single-line JSON payloads,
  updates `window.__sseTextDeltaStats`, and emits `SSETextDeltaSummary` during
  stream cleanup before clearing the client counters.
- Live BH.pdf run `8613bbe2-92c4-430c-ac9c-f625771dc45e` streamed visibly in
  the UI. Backend emitted 12,667 text-delta events / 20,405 chars; first delta
  was 9.94s after `Invoking LLM`, last delta 248.76s, and complete 250.40s.
  Browser console telemetry after HMR showed JSON `SSETextDelta` counters at
  1,000 / 2,000 / 3,000 / 4,000 / 5,000 / 6,000 received+applied events with
  `bufferedEvents=0` and `droppedEvents=0`.
- A clean rerun after adding `SSETextDeltaSummary` reached main LLM run
  `75b9316d-380b-457a-94f8-e57a073d7165` but failed upstream with
  `token_expired` from OpenAI OAuth before any visible text delta; this verifies
  the remaining blocker was auth, not SSE/client streaming.
- Look for `[agents:graph] First visible text delta` and
  `[agents:graph] LLM timing complete` in `api/logs/debug-2026-07-07.log`.
- Verified:
  - Browser console logs for `SSETextDelta` on the BH.pdf OCR run.
  - `rtk npx jest src/hooks/SSE/__tests__/useStepHandler.spec.ts --runInBand --watch=false --coverage=false`
  - `rtk npx jest --runTestsByPath server/controllers/agents/__tests__/callbacks.spec.js --runInBand`
  - `rtk git diff --check`

# Active: SSE text delta content-index mismatch after OCR tool calls - 2026-07-07

Goal: fix repeated frontend `Content type mismatch` warnings where OCR main
agent text deltas try to write into a synced `tool_call` content slot.

Checklist:

- [x] Confirm the reported conversation has backend text deltas but frontend
      indexes them against an existing `tool_call` part.
- [x] Add a focused client regression for synced tool-call content followed by
      text deltas at server index 0.
- [x] Fix the client content-index calculation without changing backend SSE
      semantics.
- [x] Run focused frontend tests and `rtk git diff --check`.
- [x] Remove temporary streaming telemetry and the earlier no-run-step fallback
      that was part of the wrong diagnosis.

Findings:

- `/c/bb347780-eb96-417d-af96-44a5e8e980c2` reached main LLM and logged first
  visible text delta at `2026-07-07T13:43:40.106Z`, 14.41s after
  `Invoking LLM`; the warning is therefore not a missing backend delta.
- The warning shape `existingType: "tool_call", contentType: "text", index: 0`
  means the frontend selected content slot 0 for a text delta while the synced
  response message already had a tool-call part at slot 0.
- The fix only skips over non-OAuth `tool_call` slots for incoming text/think
  content. OAuth prompt tool calls still get replaced by the real response
  content, and non-tool content mismatches still warn instead of appending.

Review:

- Added a regression where a synced PaddleOCR tool-call content part occupies
  slot 0 and the server later sends text at index 0. The text is now appended as
  a new text part instead of being dropped by `Content type mismatch`.
- Focused verification passed:
  - `rtk npx jest src/hooks/SSE/__tests__/useStepHandler.spec.ts --runInBand --watch=false --coverage=false`
  - `rtk git diff --check`
- Cleanup kept the content-index fix and regression test, and removed the
  temporary backend/client text-delta timing logs plus the no-run-step delta
  application fallback.

# Active: OCR preprocessing reasoning effort routing - 2026-07-07

Goal: reduce first-token latency when the main agent is only processing OCR
markdown produced by preprocessing, while preserving env-configured reasoning
for normal Steel tasks such as quoting.

Checklist:

- [x] Add failing tests for OCR organizer `reasoningEffort: none` and main
      OAuth agent `reasoningEffort: none` only when current OCR preprocessing
      markdown is present.
- [x] Implement the smallest routing change in the native OAuth/Steel OCR path.
- [x] Run focused backend/package tests and `rtk git diff --check`.
- [x] Record result and residual risk.

Design:

- PaddleOCR raw-data-to-markdown organizer keeps its existing
  `reasoningEffort: none`.
- Main OpenAI OAuth graph model keeps env/client `reasoningEffort` for normal
  tasks.
- Main OpenAI OAuth graph model overrides to `reasoningEffort: none` only when
  the current request has same-turn OCR preprocessing markdown evidence, because
  the markdown has already been organized by the preprocessing subagent.

Review:

- Implemented a caller-supplied OpenAI OAuth reasoning-effort override in
  `createRun`.
- AgentClient and Open Responses pass `none` only when PaddleOCR preflight
  produced same-turn `currentOcrMarkdownResults`.
- PaddleOCR OCR organizer remains `reasoningEffort: none`.
- Verified:
  - `rtk npx jest --runTestsByPath server/services/__tests__/ToolService.spec.js --runInBand`
  - `rtk npx jest --runTestsByPath server/controllers/agents/__tests__/responses.unit.spec.js --runInBand`
  - `rtk npx jest --runTestsByPath src/agents/__tests__/run-summarization.test.ts --runInBand --coverage=false`
  - `rtk npm run build` in `packages/api`
  - `rtk git diff --check`

# Active: OAuth Responses final-only stream after OCR preflight - 2026-07-07

Goal: explain why `/c/5184cbe8-de40-4fcb-ade4-e3f5fdff73d9`
still waited about 9 minutes and then rendered the full OCR answer at once
instead of streaming text during the main-agent response.

Checklist:

- [x] Confirm persisted conversation/message timing for the reported run.
- [x] Compare OCR/preflight timing with the actual main LLM run window.
- [x] Trace whether the OpenAI OAuth Responses stream emitted text delta
      chunks or only a final completed chunk for this path.
- [x] Add/run a focused regression or harness at the native stream seam.
- [x] Decide whether a backend/client stream contract fix is needed.
- [x] Record conclusion, verification, and residual risk.

Findings so far:

- The reported conversation has one user message and one assistant response
  row; the latest duplicate-root-message fix is not the failing symptom for
  this run.
- OCR/preflight finished before the main answer. The main OpenAI OAuth LLM run
  started at `2026-07-07T10:54:52.779Z` and completed at
  `2026-07-07T10:58:04.695Z`, producing one persisted assistant text part of
  length 14138.
- Current graph code should stream if the provider yields
  `response.output_text.delta`; the remaining question is whether this specific
  Responses/OAuth model stream emitted deltas or only `response.completed`.
- A live direct `openai-oauth-provider` `doStream()` smoke with `gpt-5.5` and
  `reasoningEffort:"medium"` streamed 159 small `text-delta` parts over about
  2.7s-5.5s, so the OAuth provider and native adapter are not globally stuck
  on `doGenerate`.
- The remaining evidence points to first-visible-token latency/provider
  buffering for the large OCR prompt: this run had about 103k input tokens,
  50k instruction tokens, and the main LLM call took 191.92s before finalizing.
  There is no persisted partial assistant row and the in-memory SSE job was
  deleted on completion, so the exact raw delta count for this completed run is
  no longer recoverable.

Review notes:

- No new backend/client stream-contract fix is justified from this run. The
  current backend path is `doStream -> text-delta -> AIMessageChunk ->
  ChatModelStreamHandler -> on_run_step/on_message_delta`, and focused coverage
  already asserts that native OAuth graph text deltas emit a message run step
  before deltas.
- This is not the duplicate-root-user-message failure anymore. The new run's
  user/assistant parentage is stable and `created.responseMessageId` matched
  the saved assistant row.
- The user-visible all-at-once response is most likely the upstream not
  producing displayable text until the end of a very large OCR prompt. Artificial
  server-side chunk splitting would make the UI look streamed after the upstream
  blob arrives, but would not reduce first-token latency and would misrepresent
  provider streaming behavior.
- Verification:
  - Live direct provider smoke:
    `rtk node --input-type=module -e '...'` streamed 159 `text-delta` parts for
    `gpt-5.5` with `reasoningEffort:"medium"`.
  - `rtk git diff --check` passed.
- Residual risk: the completed in-memory SSE job was deleted, so this exact
  run's raw delta timestamps cannot be recovered. To prove the next OCR run
  conclusively, add temporary/permanent first-text-delta timing instrumentation
  around the OAuth adapter or GenerationJobManager before rerunning the same
  OCR prompt.

# Active: OCR preflight duplicate root user messages - 2026-07-07

Goal: decide and lock down whether OCR/preflight should still create duplicate
root user messages after the resumable streaming identity fix.

Checklist:

- [x] Inspect the reported conversation's Mongo message shape.
- [x] Add/strengthen a regression that proves the preliminary user id is reused.
- [x] Run focused backend verification.
- [x] Record whether old duplicate rows need cleanup versus code-only fix.

Findings so far:

- `/c/d9a4bbfc-abcc-444b-83c7-bcc662bff63a` currently has two root user
  messages with the same text/file and no assistant child row under either
  message. Its `conversations.messages` array points at an id not present in
  the messages query, so this is stale/broken historical data rather than a
  clean branch state.
- The new-code invariant should be: the preliminary user message saved before
  OCR/preflight and the later `BaseClient.sendMessage()` user message must use
  the same `messageId`.

Review notes:

- New OCR/preflight turns should be fixed by the resumable identity change:
  `request.js` passes the preliminary `messageId` down as `userMessageId`, and
  `BaseClient` uses that explicit id for the user message instead of generating
  a second UUID.
- Added a BaseClient regression proving a fresh turn with `userMessageId` saves
  exactly one user message and parents the assistant response to that same id.
- Verification:
  - `cd api && rtk npx jest app/clients/specs/BaseClient.test.js server/controllers/agents/__tests__/request.resumeMetadata.spec.js --runInBand --watch=false --coverage=false`
    passed 87 tests.
  - `rtk git diff --check` passed.
- Old duplicate rows should not be broad-deleted automatically. The reported
  conversation also has an orphan `conversations.messages` pointer, so cleanup
  should be a targeted repair script or manual one-off after deciding which
  row, if any, should remain visible.

# Active: OpenAI OAuth user message edit missing - 2026-07-07

Goal: diagnose why `/c/d9a4bbfc-abcc-444b-83c7-bcc662bff63a`
does not show the user-message edit button / Save and Submit flow.

Checklist:

- [x] Confirm the conversation/message DB state for the reported URL.
- [x] Trace the frontend hover action gating for edit visibility.
- [x] Add a focused regression for OpenAI OAuth edit capability.
- [x] Apply the minimal fix and run focused verification.
- [x] Record root cause and residual risk.

Hypotheses:

- H1: `openai_oauth_responses` is omitted from the frontend editable endpoint
      allowlist, so the edit icon is never rendered.
- H2: file-attached user messages suppress edit controls even when the endpoint
      is editable.
- H3: the message is not treated as the latest editable generation because the
      conversation has duplicate root user messages from OCR preflight history.

Review notes:

- H1 confirmed. The reported conversation endpoint is
  `openai_oauth_responses`, and the hover action path uses
  `conversation.endpointType ?? conversation.endpoint`; this conversation has
  no `endpointType`, so it reaches the edit capability gate as
  `openai_oauth_responses`.
- `useGenerationsByLatest` did not include `EModelEndpoint.openAIOAuth` in the
  editable/branching endpoint allowlists. That made
  `isEditableEndpoint=false`, so `HoverButtons` never rendered the edit button;
  the Save and Submit flow was unreachable.
- File attachments were not the suppressing condition. The user edit path is
  already handled by `EditTextPart` once the edit state is reachable.
- The minimal fix adds `EModelEndpoint.openAIOAuth` to the editable and
  branching endpoint capability lists.
- Verification:
  - `cd client && rtk npx jest src/hooks/__tests__/useGenerationsByLatest.spec.ts --runInBand --watch=false --coverage=false`
    passed.
  - `cd client && rtk npx jest src/components/Chat/Messages/__tests__/HoverActions.streaming.spec.tsx --runInBand --watch=false --coverage=false`
    passed.
  - `rtk git diff --check` passed.
- Residual risk: the reported conversation has duplicate root user messages
  from the OCR/preflight history, but that was not the cause of the missing
  edit button.

# Active: Repeat OCR main-agent response not streaming - 2026-07-07

Goal: diagnose why `/c/0b271982-97f7-4148-85f2-a40fd79b4b5f`
ran for about 9m26s, spent roughly 7m in OCR preflight, then showed the
main-agent response all at once instead of streaming into the chat UI.

Checklist:

- [x] Inspect Mongo conversation/message rows, timestamps, saved partial/final
      message state, and OCR activity state for this conversation.
- [x] Inspect local backend/frontend logs for the transition from
      `Processing pdf with OCR markdowns` into the main OpenAI OAuth model run.
- [x] Determine whether backend emits `on_message_delta` during the main-agent
      run or only emits/commits content at finalization.
- [x] Build a focused regression test at the actual failing seam before any
      production-code change.
- [x] Apply the minimal fix, then run focused verification and
      `rtk git diff --check`.
- [x] Record root cause, timing evidence, and residual risk.

Hypotheses:

- H1: Preflight duration is related because the assistant placeholder or
      frontend `submission` state expires/gets replaced during the long
      OCR-only phase, so later text deltas cannot attach to the visible message.
- H2: Backend main-agent streaming still uses a final-value path in this OCR
      handoff, so no text deltas are emitted until the model finishes.
- H3: Backend emits deltas, but the client discards them because the delta id
      does not match the placeholder/run-step state after resumable sync.
- H4: Activity/tool panels update correctly because `steel_event`/tool events
      use a separate path, while assistant text rendering is blocked by
      message-list/submission reconciliation.

Review notes:

- Mongo timing for `0b271982-97f7-4148-85f2-a40fd79b4b5f` shows OCR
  preflight from roughly 09:56:38Z to 10:02:47Z, then the main LLM run from
  10:02:47Z to 10:05:56Z. The final assistant row is parented to a second user
  message id, while the preliminary request user message was already saved
  under a different id.
- The earlier aborted runs prove the model/provider had generated partial text
  before Stop: abort persistence saved partial assistant content. Direct
  `openai-oauth-provider` and the LibreChat OAuth graph wrapper both streamed
  small prompts, so this was not a provider-wide `doGenerate` path.
- The concrete fix is to keep the long-preflight resumable turn's identity
  stable: `BaseClient` now accepts an explicit `userMessageId`, the resumable
  controller passes the preliminary user message id into the real
  `client.sendMessage()` call, and the `created` SSE event now includes the
  actual server response id.
- The frontend now uses `created.responseMessageId` for the assistant
  placeholder when present. That means main-agent text can attach to the
  correct response id immediately after OCR preflight, instead of depending on
  a later `on_run_step` to replace an underscore placeholder after several
  minutes of OCR-only events.
- Verification:
  - `cd api && rtk npx jest app/clients/specs/BaseClient.test.js server/controllers/agents/__tests__/request.resumeMetadata.spec.js --runInBand --watch=false --coverage=false`
    passed 86 tests.
  - `cd client && rtk npx jest src/hooks/SSE/__tests__/useEventHandlers.spec.ts src/hooks/SSE/__tests__/useResumableSSE.spec.ts src/hooks/SSE/__tests__/useStepHandler.spec.ts --runInBand --watch=false --coverage=false`
    passed 108 tests.
  - `rtk node --check api/app/clients/BaseClient.js` and
    `rtk node --check api/server/controllers/agents/request.js` passed.
  - `rtk git diff --check` passed.
- Residual risk: `cd client && rtk npx tsc --noEmit --pretty false --skipLibCheck`
  is still blocked by unrelated existing errors in
  `client/src/components/Chat/__tests__/state.spec.ts` and
  `client/src/components/Chat/Menus/Endpoints/components/OpenAIOAuthUsageRemaining.tsx`;
  no remaining type errors are reported in the files touched for this fix.

# Active: Backend run-step gap for OCR preprocessing answer - 2026-07-07

Goal: explain why the OCR preprocessing main-agent response path emitted
visible `on_message_delta` chunks without a matching `on_run_step`, and decide
whether the backend should synthesize/fix that event contract instead of only
handling the frontend fallback.

Checklist:

- [x] Trace the current native OpenAI OAuth agent path from provider event
      handlers to SSE/job chunks.
- [x] Identify which backend component owns `on_run_step` creation versus
      `on_message_delta` forwarding.
- [x] Compare normal graph/tool-step deltas with the OCR preprocessing
      main-agent answer path.
- [x] Add or run a focused backend/agent test if there is a code-owned backend
      contract bug.
- [x] Record the conclusion, verification, and residual frontend/backend
      contract risk.

Hypotheses:

- H1: OpenAI OAuth main-answer deltas are direct provider text deltas, not graph
      node content, so `@librechat/agents` forwards them as `on_message_delta`
      without synthesizing a message-creation run step.
- H2: OCR preprocessing bypasses the normal graph `dispatchRunStep` path after
      the activity event and therefore loses the message-creation step only for
      this PDF-preprocessed handoff.
- H3: resumable stream/job replay drops `on_run_step` while retaining
      `on_message_delta`, so the live backend originally sent the step but the
      client did not receive/replay it.
- H4: custom Steel activity events share the stream but are unrelated; the
      missing run step is a pre-existing Responses/OAuth provider adapter
      contract mismatch.

Review notes:

- The visible `Processing pdf with OCR markdowns (...)` event is not a graph
  run step. It is built by
  `buildSteelOcrPreprocessingEventEnvelopes()` as a `steel_event` with source
  `ocr_preprocessing`, and `ToolService.emitSteelNativeEvents()` sends it
  directly through `GenerationJobManager.emitChunk()`.
- Normal native OpenAI OAuth main-answer text does not bypass graph run-step
  creation. The provider `text-delta` becomes a LangChain `AIMessageChunk`, and
  `ChatModelStreamHandler` calls `graph.dispatchRunStep()` with
  `MESSAGE_CREATION` before `graph.dispatchMessageDelta()` for that same step
  id. `callbacks.js` uses the same visibility gate for `ON_RUN_STEP` and
  `ON_MESSAGE_DELTA`, and the ephemeral `openai_oauth_responses__gpt-5.5`
  agent does not set `hide_sequential_outputs`.
- H1, H2, and H4 are ruled out for the normal main-answer path. The remaining
  backend-side risk is H3/replay timing: in local in-memory stream mode,
  run-step resume state is read from a live graph `WeakRef`, while abort cleanup
  clears content state and deletes the job by default. The exact live SSE event
  sequence for the aborted 09:15:57 turn is therefore no longer recoverable
  after the user pressed stop.
- I added backend contract coverage in
  `packages/api/src/steel/native/oauth.spec.ts`: native OAuth graph streaming
  now asserts `ON_RUN_STEP(MESSAGE_CREATION)` is observed before the matching
  `ON_MESSAGE_DELTA` chunks for the same step id.
- Conclusion: do not synthesize fake backend `on_run_step` events for OCR
  preprocessing. The correct backend invariant already exists on the graph
  text path; the UI still needs a defensive fallback for cases where the
  client-side step map is missing after resume/timing gaps.
- Verification:
  - `cd packages/api && rtk npx jest src/steel/native/oauth.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "message run step"` passed.
  - `cd packages/api && rtk npx jest src/steel/native/oauth.spec.ts --runInBand --watch=false --coverage=false` passed 12 tests.

# Active: OCR preprocessing AI response streaming gap - 2026-07-07

Goal: diagnose why `/c/08993fe1-5a84-44d9-b42f-fd7a1df79b86`
shows `Processing pdf with OCR markdowns` but does not stream the main agent
assistant response into the chat UI until the user presses stop, where a
truncated response suddenly appears.

Checklist:

- [x] Inspect local conversation/message/OCR memory state and recent runtime
      logs for conversation `08993fe1-5a84-44d9-b42f-fd7a1df79b86`.
- [x] Trace frontend SSE/resumable rendering and stop/abort behavior for
      in-progress assistant messages.
- [x] Trace backend OpenAI OAuth Responses streaming, Steel callbacks, and OCR
      preprocessing handoff to identify where deltas are buffered or withheld.
- [x] Build the smallest reproducible feedback loop or focused test at the
      correct seam.
- [x] Apply the minimal root-cause fix if code-owned, then run focused
      verification and `rtk git diff --check`.
- [x] Record review notes, residual risk, and any lesson from user correction.

Hypotheses:

- H1: backend receives provider deltas but OCR/Steel callback aggregation does
      not forward them to the client until abort/finalization.
- H2: backend forwards deltas, but frontend resumable SSE state suppresses
      assistant rendering while the latest event is an OCR activity/status.
- H3: the provider path is still using a non-streaming generate/aggregator path
      during the main-agent OCR Markdown answer, so only abort persistence makes
      partial text visible.
- H4: abort handling flushes `AgentClient`/message state that normal streaming
      fails to reconcile with the pending UI message id.

Review notes:

- Local Mongo for `08993fe1-5a84-44d9-b42f-fd7a1df79b86` has the conversation
  title `BH.pdf OCR內容核對`, two user turns, and one assistant response saved as
  `unfinished: true` with 647 chars. That matches the user report: pressing
  stop caused abort/final handling to surface a partial response that had not
  been visible during normal streaming.
- Frontend root cause: if the client-side step map lacks a visible run step,
  `useStepHandler` treated every matching text delta as out-of-order and
  buffered it forever. Backend follow-up verified the normal native OAuth graph
  text path does create `MESSAGE_CREATION` before text deltas, so the missing
  step map is most likely a stream/replay/timing gap rather than an OCR
  preprocessing main-answer bypass.
- Fix: `useStepHandler` now falls back only when the current message list
  already contains both this turn's user message and assistant placeholder. It
  streams the visible delta into that placeholder; otherwise it preserves the
  original buffering behavior for genuine out-of-order run-step streams.
- Verification:
  - Red test observed:
    `cd client && rtk npx jest src/hooks/SSE/__tests__/useStepHandler.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "streams visible message deltas"`
    failed because no UI update occurred.
  - Green/focused:
    `cd client && rtk npx jest src/hooks/SSE/__tests__/useStepHandler.spec.ts --runInBand --watch=false --coverage=false`
    passed 63 tests.
  - `rtk git diff --check` passed.
- Residual risk: `cd client && rtk npx tsc --noEmit --pretty false --skipLibCheck`
  is currently blocked by unrelated existing type errors in
  `client/src/components/Chat/__tests__/state.spec.ts`,
  `client/src/components/Chat/Menus/Endpoints/components/OpenAIOAuthUsageRemaining.tsx`,
  and `client/src/hooks/SSE/useEventHandlers.ts`; it did not report errors in
  the edited hook/test files.

# Active: Persist user message before OCR preflight - 2026-07-07

Goal: fix generated/resumable conversations where OCR preflight can fail after
the conversation shell is created but before the user's submitted message is
persisted to the `messages` collection.

Checklist:

- [x] Add focused controller regression coverage for preflight/client
      initialization failure after the early conversation shell is saved.
- [x] Persist the preliminary user message before client initialization can run
      OCR preflight.
- [x] Ensure the preliminary message keeps displayable file metadata but does
      not persist raw OCR/file text.
- [x] Verify focused backend tests, existing frontend loading regression, syntax
      checks, and diff hygiene.
- [x] Record review notes and the user-corrected persistence rule.

Review notes:

- Root cause confirmed: resumable agent requests saved the generated
  conversation shell and job metadata before returning the stream id, but the
  actual `messages` row for the user's submitted message was still saved later,
  after client initialization / `sendMessage()`. An OCR preflight or organizer
  failure before that point left a durable conversation with zero messages.
- Fix: `request.js` now saves a preliminary user message before
  `initializeClient()` can run OCR preflight. The saved row uses the submitted
  `messageId`, `conversationId`, `parentMessageId`, user text, `sender: "User"`,
  `isCreatedByUser: true`, and sanitized file chip metadata.
- The early save keeps raw file/OCR text out of the message row and preserves
  the existing `overrideUserMessageId` skip-save branch behavior. Later
  user-message saves are idempotent because `saveMessage()` upserts by
  `(messageId, user)`.
- Verification passed:
  - `cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js --runInBand --watch=false --coverage=false`
  - `rtk node --check api/server/controllers/agents/request.js`

# Active: Frontend loading on empty conversation shell - 2026-07-07

Goal: fix `/c/607328a4-544c-44fe-b1ed-41abbf0d85a2` staying on the frontend
loading spinner when the conversation row exists but no message rows were saved.

Checklist:

- [x] Confirm local frontend/backend are reachable and the route serves the
      Vite app.
- [x] Confirm Mongo state for the reported conversation: conversation shell
      exists, message count is zero, OCR preprocessing memory has partial
      progress.
- [x] Trace frontend loading condition for empty message query results.
- [x] Add focused frontend regression coverage for an existing empty
      conversation after messages query completes.
- [x] Apply the minimal `ChatView` condition fix.
- [x] Run focused frontend tests and `rtk git diff --check`.
- [x] Record review notes.

Review notes:

- Root cause: `ChatView` treated every existing route with no messages as
  "navigating" forever. Once the message query finished with an empty array,
  `messagesTree` became `null`, so `/c/<id>` stayed on the spinner even though
  the query was complete.
- Fix: `getChatViewContentState()` now distinguishes "empty but already
  fetched" from "still navigating/loading". Existing empty conversations render
  `MessagesView`, which already shows the empty-state copy, instead of the
  loading spinner.
- Verification passed:
  - `cd client && rtk npx jest src/components/Chat/__tests__/state.spec.ts --runInBand --watch=false --coverage=false`
  - `cd client && rtk npm run build`
  - `rtk git diff --check`

# Active: Inspect OCR preprocessing terminated error - 2026-07-07

Goal: diagnose and fix the local `/c/607328a4-544c-44fe-b1ed-41abbf0d85a2`
error `OCR preprocessing failed for BH.pdf: terminated`.

Diagnosis checklist:

- [x] Inspect the conversation, message rows, preflight memory rows, and local
      runtime logs for `BH.pdf`.
- [x] Reproduce or isolate the failing OCR preprocessing path with the smallest
      agent-runnable loop available.
- [x] Rank and test termination hypotheses: explicit abort, subprocess timeout,
      PaddleOCR/MCP timeout, or preprocessing chunk-state bug.
- [x] Apply the minimal root-cause fix if the failure is code/config-owned.
- [x] Run focused verification, syntax checks, and `rtk git diff --check`.
- [x] Document review notes and residual risk.

Hypotheses:

- H1: PaddleOCR/MCP chunk OCR failed or timed out. Ruled out by Mongo: all 3
      `paddleocr_preflight` raw chunks for BH.pdf are active.
- H2: PDF splitting or S3 chunk artifact creation failed. Ruled out by Mongo:
      chunk artifacts already existed for pages `1-50`, `51-100`, and
      `101-106`.
- H3: user/request abort terminated preprocessing. Less likely because the
      persisted error was a bare provider `terminated` during organizer work,
      not an abort-class error.
- H4: OpenAI OAuth organizer transiently terminated after chunk 1/3. Confirmed
      by persisted state: only chunk 1 has active `ocr_extract` organizer
      Markdown; chunks 2/3 have raw OCR only.

Review notes:

- Local Mongo for `607328a4-544c-44fe-b1ed-41abbf0d85a2` has a conversation
  shell titled `BH.pdf OCR內容核對`, zero saved messages, and only title
  transactions.
- Steel memory for the same conversation has 3 active `paddleocr_preflight`
  raw chunk rows for `BH.pdf` and 1 active `ocr_extract` organized chunk row.
  The failed run therefore reached organizer chunk processing after PaddleOCR
  completed.
- Fix: `createSteelOcrOrganizer()` now retries transient OpenAI OAuth organizer
  failures up to 3 attempts (`terminated`, timeout/reset/network/429/503-style
  messages), while still rethrowing true aborts immediately.
- Regression: `ToolService.spec.js` now exercises `runSteelPaddleOcrPreflight()`
  with an organizer model that throws `terminated` once and succeeds on retry.
- Verification passed:
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing organizer"`
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|PaddleOCR preflight failures"`
  - `rtk node --check api/server/services/ToolService.js`
  - `rtk git diff --check`
- Residual risk: the currently running local backend process was started before
  this code edit, so the fix requires a backend restart before browser retry.

# Active: Merge main into feat/v8.4 safely - 2026-07-07

Goal: bring the latest `main` changes into `feat/v8.4` while preserving the
custom Steel/LibreChat logic already carried on the feature branch.

Merge checklist:

- [x] Confirm repo instructions, branch state, remotes, and a clean working
      tree before merge.
- [x] Fetch current refs and identify the exact `main` ref to merge.
- [x] Compare `main` vs `feat/v8.4` to locate high-risk overlap in custom
      Steel/OCR/runtime/UI/process files.
- [x] Merge `main` into `feat/v8.4` without discarding feature-branch changes.
- [x] Resolve conflicts by keeping upstream framework updates plus existing
      custom Steel behavior unless the incoming change directly fixes the same
      code path.
- [x] Run focused verification for touched areas plus `git diff --check`.
- [x] Document merge review notes, verification evidence, and any remaining
      risk.

Review notes:

- Merged `origin/main` at `8fcb77fe6` into `feat/v8.4` with `--no-commit`
  after fetching all refs.
- Conflict resolution used an additive union strategy:
  - kept Steel native context, PaddleOCR preflight, OpenAI OAuth behavior,
    Steel events, resume timestamps, Markdown table actions, and Steel activity
    rendering;
  - kept upstream HITL pending-action/checkpoint behavior, keyed memory context,
    tool favorites, upload routing, start-generation handling, and LangGraph
    checkpoint dependencies.
- Extra UI check: `ControlCombobox` keeps `popoverClassName` z-index overrides
  when callers pass class-based stacking rules, while default callers still use
  upstream dialog-aware z-index.
- Verification passed:
  - `npm run build:data-provider`
  - `npm run build:data-schemas`
  - `npm run build:api`
  - `npm run build:client-package`
  - `cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js server/controllers/agents/client.test.js server/routes/agents/__tests__/abort.spec.js server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/agents/__tests__/run-summarization.test.ts src/tools/definitions.spec.ts --runInBand --watch=false --coverage=false`
  - `cd client && rtk npx jest src/hooks/SSE/__tests__/useResumableSSE.spec.ts src/hooks/SSE/__tests__/useResumeOnLoad.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx --runInBand --watch=false --coverage=false`
  - `cd packages/client && rtk npx jest src/components/ControlCombobox.spec.tsx --runInBand --watch=false --coverage=false`
  - `rtk node --check api/server/controllers/agents/client.js && rtk node --check api/server/controllers/agents/request.js && rtk node --check api/server/routes/agents/index.js && rtk node --check api/server/services/ToolService.js`
  - `rtk git diff --check`

# Active: Title Falls Back To New Chat After Preflight - 2026-07-06

Goal: diagnose why OpenAI OAuth conversations still end up titled `New Chat`
even when title generation runs after the conversation row exists.

Diagnosis checklist:

- [x] Confirm local Mongo title/message/transaction state for recent
      `openai_oauth_responses` conversations.
- [x] Inspect title-generation logs around recent requests.
- [x] Reproduce the title race at the controller seam with a failing test.
- [x] Fix the minimal title persistence / final-event ordering bug.
- [x] Verify focused title/request tests, syntax, and diff hygiene.

Hypotheses to test:

- H1: immediate title generation writes the DB title after the final event has
      already sent a stale `New Chat` conversation payload to the frontend.
- H2: a later normal conversation save still writes `title: "New Chat"` and
      overwrites the generated title.
- H3: OpenAI OAuth title generation spends tokens but returns no title because
      endpoint config lookup is missing.

Review notes:

- Local Mongo recent rows `0a12...` and `e222...` still have
  `title: "New Chat"` while both have `context: "title"` transactions. This
  means the title model ran, but the generated title did not become the durable
  conversation title.
- Logs show `No endpoint config for "openai_oauth_responses"` in
  `AgentClient.titleConvo()`, but title transactions exist, so this warning is
  not by itself proof that title generation skipped.
- Root cause: after title generation finished, later preflight/send-message
  failure aborted `titleDiscardController`, so `addTitle()` treated the
  generated title as stale and skipped the `saveConvo({ title })` write.
  Discard must be reserved for superseded/replaced streams only.
- Fix: generic preflight/send-message failures still abort in-flight title
  model calls, but no longer abort the discard signal. A title that already
  generated can update the conversation shell even if the main turn fails.
- Verification passed:
  - `cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js server/services/Endpoints/agents/title.test.js --runInBand --watch=false --coverage=false`
  - `rtk node --check api/server/controllers/agents/request.js && rtk node --check api/server/services/Endpoints/agents/title.js`
  - `rtk git diff --check`

# Active: Conversation disappears after Steel preflight - 2026-07-06

Goal: diagnose why duplicating a tab while a newly created OpenAI OAuth
Responses conversation is running preflight leaves the duplicate tab at
`/c/e2220c2a-c717-441b-9cbd-a554782fdf07` with `conversation not found`, after
which the original tab's optimistic sidebar row disappears.

Diagnosis checklist:

- [x] Confirm the reported conversation state in local Mongo and message rows.
- [x] Trace frontend `conversation not found` path for `/c/:conversationId`.
- [x] Trace backend conversation creation/save/fetch/delete and any cleanup
      paths connected to stop, preflight, aborted streams, or title jobs.
- [x] Build a focused repro or regression seam before changing production code.
- [x] Fix the root cause with minimal scope if reproducible.
- [x] Verify with focused tests, original symptom check where possible, and
      `git diff --check`.

Hypotheses to test:

- H1: preflight stop/cleanup treats the generated conversation id as disposable
      and removes the row/navigation state after the backend created event.
- H2: a final/error response path saves messages but fails to persist or later
      overwrites the conversation row for `openai_oauth_responses`.
- H3: title-generation or conversation-cache invalidation makes the frontend
      query a conversation id before/after save and then removes it from local
      state as missing.
- H4: duplicate id/endpoint mismatch causes fetch to use a valid id with the
      wrong endpoint/model filter, surfacing as not found.

Review notes:

- Local Mongo for `e2220c2a-c717-441b-9cbd-a554782fdf07` had no conversation
  row and no messages, but did have title transactions. The duplicate tab's
  404 was therefore backend truth, not a frontend-only false negative.
- Root cause: the resumable agents controller returned the generated UUID and
  stamped `/c/:id` before any conversation row existed. The row was only created
  later through message/response persistence, after preflight/main response.
- Fix: new conversations now save a preliminary conversation shell and resume
  metadata before returning the generated stream id. Immediate title generation
  can update that shell as soon as the title is generated instead of waiting for
  the main response to finish.
- Contract: send message generates the durable conversation id first; the
  conversations collection must contain that row before automatic preflight
  persists any conversation-bound OCR rows, and later title/message writes reuse
  the same row.
- Verification passed:
  - `cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js server/services/Endpoints/agents/title.test.js --runInBand --watch=false --coverage=false`
  - `rtk node --check api/server/controllers/agents/request.js`
  - `rtk git diff --check`

# Active: Standalone user-message title generation - 2026-07-06

Goal: make every provider generate conversation titles from the user message
and conversation id without waiting for Steel OCR preflight, agent run
initialization, tools, or the main assistant response.

Design checklist:

- [x] Confirmed product contract: title generation uses user message +
      conversation id for all providers; final-mode should not wait for or use
      assistant response content.
- [x] Keep OCR/file title guidance model-driven: include attachment filename(s)
      and the OCR/file-review title rule in the prompt, without hard
      `preferredTitle` overrides.
- [x] Add RED tests showing normal provider title generation works when
      `client.run` is null and always sends empty `contentParts`.
- [x] Add RED tests showing OpenAI OAuth no longer uses a separate
      `generateOpenAIOAuthTitle` path but still receives OCR filename guidance.
- [x] Implement a shared standalone title helper used by `AgentClient.titleConvo()`.
- [x] Remove the OpenAI OAuth-specific title helper and update exports/tests.
- [x] Verify focused Jest, package build if needed, syntax checks, and
      `git diff --check`.

Review notes:

- The title job may run before the conversation row exists; existing
  `convoReady` remains responsible for delaying persistent `saveConvo`.
- Keep existing endpoint config behavior: `titleEndpoint`, `titleModel`,
  `titleMethod`, `titlePrompt`, and `titlePromptTemplate` should still apply.
- This change is scoped to title generation; long OCR/preflight remains valid
  and should not block title creation.
- Verification passed:
  - `cd packages/api && npx jest src/steel/native/title.spec.ts --runInBand --watch=false --coverage=false`
  - `cd api && npx jest server/controllers/agents/client.test.js --runInBand --watch=false --coverage=false --testNamePattern "titleConvo"`
  - `cd packages/api && npm run build`
  - `git diff --check`

# Active: Retry title generation while conversation title is New Chat - 2026-07-03

Goal: after every user message, if the conversation still has the default
`New Chat` / no-real-title state, try title generation again so a previously
untitled conversation can be overwritten by the generated title.

Design checklist:

- [x] Read `CLAUDE.md`, `/Users/neven/.codex/RTK.md`, relevant title memory,
      and current `tasks/lessons.md`.
- [x] Locate current title generation flow: backend `addTitle()`, agent request
      controllers, `/api/convos/gen_title/:conversationId`, and frontend title
      queue.
- [x] Confirm design before production-code edits.
- [x] Add RED tests for existing conversations whose title remains `New Chat`
      after a follow-up user message.
- [x] Implement minimal backend title eligibility so follow-up turns can call
      existing `addTitle()` when the saved conversation has no real title.
- [x] Implement minimal frontend final-event queue logic so those generated
      titles are fetched through the existing `/gen_title` cache endpoint.
- [x] Verify with focused Jest, JS syntax checks, and `rtk git diff --check`.

Review notes:

- Existing behavior only queues/generates titles for initial new conversations.
- `Conversation.title` defaults to `New Chat` in Mongo, while final events may
  normalize missing titles to `null`; treat both as the same no-real-title
  state for this feature.
- Superseded 2026-07-06: OpenAI OAuth now enters through shared
  `generateTitle()` from `AgentClient.titleConvo()` like every provider; keep
  the model-driven OCR filename guidance, but do not restore a dedicated
  `generateOpenAIOAuthTitle()` path.

Implementation review - 2026-07-03:

- [x] Added backend title retry eligibility after successful turns when the
      saved conversation title is still not real (`New Chat`, empty, or null).
- [x] Kept initial new-conversation immediate title generation single-shot; if
      that already started, the same turn does not launch a duplicate title job.
- [x] Added frontend final-event title queue helper and forced retry queueing
      when a later turn still reports no real title.
- [x] Added queue retry support so conversations previously marked processed can
      be re-armed by a later `New Chat` final event.

Verification run:

- [x] RED observed:
      `cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js --runInBand --watch=false --coverage=false --testNamePattern "New Chat title"`
- [x] RED observed:
      `cd client && rtk npx jest src/hooks/SSE/__tests__/useEventHandlers.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "title generation"`
- [x] RED observed:
      `cd client && rtk npx jest src/data-provider/SSE/__tests__/useTitleGeneration.test.ts --runInBand --watch=false --coverage=false --testNamePattern "requeue"`
- [x] GREEN:
      `cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js server/services/Endpoints/agents/title.test.js --runInBand --watch=false --coverage=false`
- [x] GREEN:
      `cd client && rtk npx jest src/hooks/SSE/__tests__/useEventHandlers.spec.ts src/data-provider/SSE/__tests__/useTitleGeneration.test.ts --runInBand --watch=false --coverage=false`
- [x] GREEN: `rtk node --check api/server/controllers/agents/request.js`
- [x] GREEN: `rtk git diff --check`

Follow-up diagnosis - 2026-07-03:

- [x] User clarified the visible `New Chat` backlog existed before this branch's
      title-retry patch, so the investigation shifted from current-regression
      rollback to existing data/path diagnosis.
- [x] Prod Mongo (`librechat_prod`) has 27 conversations, 10 no-real-title
      conversations, all under `openai_oauth_responses` / `gpt-5.5`. Local dev
      Mongo (`test`) has 18 conversations, 4 no-real-title conversations, also
      all `openai_oauth_responses`.
- [x] Prod build currently reports commit `fd4416b` on `master`, build date
      `2026-07-01T23:29:34Z`; most prod no-real-title rows were created on
      `2026-07-02`, so the backlog predates today's local patch but occurred on
      a build that already had the OpenAI OAuth title helper.
- [x] Prod no-real-title split: 9/10 conversations have no `context: "title"`
      transaction, while 17/17 named OAuth conversations do have title
      transactions. This indicates most missing titles are title-job failures,
      skips, aborts, or no-result paths, not successful title writes.
- [x] One no-real-title prod conversation had title transactions but still ended
      as `New Chat`. Root cause reproduced locally: `BaseClient.saveMessageToDatabase()`
      accepted stale client `endpointOptions.title` and wrote `title: "New Chat"`
      through `saveConvo`, allowing later message saves to overwrite a generated
      title.
- [x] Fixed `BaseClient.saveMessageToDatabase()` to drop client-supplied
      `endpointOptions.title`; title changes should come from title generation
      or explicit conversation update routes, not normal message persistence.

Follow-up verification:

- [x] RED observed:
      `cd api && rtk npx jest app/clients/specs/BaseClient.test.js --runInBand --watch=false --coverage=false --testNamePattern "stale endpoint options"`
- [x] GREEN:
      `cd api && rtk npx jest app/clients/specs/BaseClient.test.js server/controllers/agents/__tests__/request.resumeMetadata.spec.js server/services/Endpoints/agents/title.test.js --runInBand --watch=false --coverage=false`
- [x] GREEN:
      `cd client && rtk npx jest src/hooks/SSE/__tests__/useEventHandlers.spec.ts src/data-provider/SSE/__tests__/useTitleGeneration.test.ts --runInBand --watch=false --coverage=false`
- [x] GREEN:
      `rtk node --check api/app/clients/BaseClient.js && rtk node --check api/server/controllers/agents/request.js`
- [x] GREEN: `rtk git diff --check`

# Active: OCR preprocessing pipeline page-chunk design - 2026-07-03

Goal: replace same-turn raw PaddleOCR injection with a preprocessing pipeline
that produces merged OCR Markdown before the main Steel agent runs.

Execution checklist:

- [x] Read `CLAUDE.md`, `/Users/neven/.codex/RTK.md`, relevant OCR memory, and
      this implementation plan.
- [x] Critical review: no blocking plan gaps found. Hard constraints are global
      `sourcePdfKey` chunk artifacts, resumable DB state, no raw OCR injection,
      and 50-page PDF chunks.
- [x] Batch 1: add global PDF chunk artifact schema/model with red-green
      `packages/data-schemas` test.
- [x] Batch 2: add OCR preprocessing memory state reader and idempotent chunk /
      Markdown capture helpers with red-green `packages/api` tests.
- [x] Batch 3: add PDF chunk helpers, organizer interface, preprocessing
      orchestrator, merge behavior, and native preprocessing events.
- [x] Batch 4: wire `api` AgentClient / Open Responses integration and
      production organizer seam.
- [x] Batch 5: run focused verification, `rtk git diff --check`, and document
      review results here.

First-slice scope:

- [x] Follow implementation plan:
      `docs/plans/2026-07-03-ocr-preprocessing-pipeline.md`.
- [x] Keep automatic PaddleOCR preflight, but process PDFs as page-range PDF
      chunks, not rasterized page images.
- [x] Use 50 PDF pages per chunk by default, e.g. `1-50`, `51-100`.
- [x] Use the original PDF S3 file key/storage key as the main index for PDF
      chunk artifacts, not `conversationId`.
- [x] Store split PDF chunk artifacts in a global DB registry so another
      conversation using the same original PDF file key reuses existing chunk
      PDFs instead of splitting/uploading again.
- [x] Before creating chunk PDFs, read global chunk artifact rows and check the
      deterministic S3 object key; repair DB rows from S3 when possible.
- [x] Persist raw chunk evidence as `paddleocr_preflight` with file key, page
      range, source PDF key, chunk index, and total chunk count metadata.
- [x] Make preprocessing resumable by deriving chunk state from persisted
      `paddleocr_preflight` and `ocr_extract` rows for the same file key.
- [x] Emit user-visible progress events:
      `paddleocr_preflight`, `paddleocr_preflight data saved as N chunks`,
      `subagent process ocr X/N`, and `ocr markdown saved`.
- [x] Add an internal OCR organizer pass per chunk. The organizer receives only
      OCR rules, file/chunk metadata, and that chunk's raw OCR result.
- [x] Parse and save each organized chunk Markdown immediately after its
      organizer pass succeeds, instead of waiting for all chunks to finish.
- [x] On resubmit, skip chunks whose raw preflight and organized OCR Markdown
      are already saved for the same file key/chunk identity.
- [x] Treat `ocrRuleVersion` changes as invalidating organized chunk Markdown
      and runtime merged Markdown, while reusing saved raw `paddleocr_preflight`
      chunks for the same file key/chunk identity.
- [x] Merge organized chunk Markdown deterministically by page/chunk order.
- [x] When same-file-key chunk Markdown tables have different headers, merge
      with a union header set and leave missing cells blank.
- [x] Do not save full merged OCR Markdown as another DB row. Store raw
      `paddleocr_preflight` chunks and organized `ocr_extract` chunk Markdown
      separately, then runtime merge them for agent context/readback.
- [x] If all chunks for a file key already have saved organized OCR Markdown,
      skip PaddleOCR, skip organizer subagents, rebuild/load the merged OCR
      Markdown, and pass it to the main Steel agent.
- [x] Give the main Steel agent exactly one merged OCR Markdown string per
      file key instead of raw `paddleocr_preflight` results or per-chunk
      Markdown arrays.
- [x] Add focused tests for event order, chunk metadata, merged OCR persistence,
      and main-agent context using organized OCR instead of raw OCR.
- [x] Run a local large-PDF pressure test after the pipeline works.

Explicitly out of scope for this first slice:

- Token-budget truncation or inline/manifest switching.
- `read_markdown(scope: "ocr", pageRange/contentPartIndex)` support.
- Solving every possible 300-page context case before measuring the new
  pipeline behavior.

Review notes:

- Page-based chunking should happen before or during PaddleOCR processing so
  each OCR chunk has reliable page provenance and can be retried independently.
- PDF chunking must preserve PDF content by copying page ranges into PDF chunks.
  Do not render PDF pages to PNG/JPEG for OCR preprocessing.
- PDF chunk artifact identity is the original stored PDF object key. It must be
  reusable across conversations that reference the same source PDF, while still
  relying on the current request's normal file permission checks before access.
- Conversation-scoped `paddleocr_preflight` and `ocr_extract` rows should
  reference the source PDF key, but should not be the primary cache for split
  PDF chunk artifacts.
- The default chunk range is 50 PDF pages; keep it internal for this first
  slice instead of adding a user-facing option.
- The main agent must not receive raw OCR chunks in `additional_instructions`.
- Chunk state must be durable after every successful organizer pass so an
  interrupted request can resume without duplicating OCR, subagent work, or
  parse/save side effects.
- Chunk Markdown rows are intermediate durable state. `additional_instructions`
  must receive the deterministic same-file-key merge, not individual chunks.
- Chunk Markdown table headers may differ. The merge must preserve rows, use
  union headers, and leave missing values blank instead of guessing.
- OCR rules are part of organizer output identity. When the OCR rule version
  changes, rerun subagent processing for every chunk and rebuild the final
  merged Markdown from current-rule chunk outputs.
- The pressure test result will decide whether a later retrieval/page-range
  contract is necessary.

Execution review - 2026-07-03:

- [x] Added global `steel_ocr_pdf_chunk_artifacts` schema/model and exports.
- [x] Added OCR preprocessing DB state reader plus idempotent raw chunk and
      organized chunk Markdown capture helpers.
- [x] Added PDF page chunk math, PDF page count, and PDF-preserving page-range
      chunk copy helpers.
- [x] Added deterministic OCR PDF chunk artifact key/reuse helper with
      Mongoose repository adapter.
- [x] Added organizer prompt interface and fake-driven preprocessing
      orchestrator with union-header table merge.
- [x] Added native OCR preprocessing progress event builder.
- [x] Added `attachments.currentOcrMarkdownResults` through runtime/native
      context, AgentClient, and Open Responses.
- [x] Changed same-turn Steel context to consume OCR Markdown results instead
      of raw `currentPaddleOcrResults`.
- [x] Wired production `runSteelPaddleOcrPreflight()` so permission-checked PDF
      file records run through page-counting, 50-page chunk planning, global
      PDF chunk artifacts, PaddleOCR chunk runner, organizer runner, and final
      merged Markdown context injection.
- [x] Added direct deterministic S3/CloudFront storage-key helpers for OCR PDF
      chunk artifacts, including HeadObject/PutObject checks and signed URL
      regeneration by artifact key.
- [x] Preserved the old whole-file PaddleOCR path for non-PDF images and PDFs
      whose current request file record cannot be resolved, while PDF records
      with a source storage key use final merged OCR Markdown as the preflight
      completion contract.
- [x] BH.pdf fixture smoke: verify `docs/reference/example/BH.pdf` page count,
      50-page chunk planning, PDF-preserving chunk creation, and local
      preprocessing orchestration.
- [x] Remaining external verification: run a live large-PDF smoke with real S3
      storage, real PaddleOCR MCP, and OpenAI OAuth organizer credentials.

Verification run:

- [x] `cd packages/data-schemas && rtk npx jest src/schema/steel.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR PDF chunk artifact|Steel Mongo schemas"`
- [x] `cd packages/data-schemas && rtk npm run build`
- [x] `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts src/steel/ocr/artifacts.spec.ts src/steel/ocr/chunks.spec.ts src/steel/ocr/organizer.spec.ts src/steel/ocr/preprocess.spec.ts src/steel/native/events.spec.ts src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|PaddleOCR chunk|organized chunk markdown|merged OCR markdown|OCR PDF chunk artifacts|OCR organizer|current OCR merged Markdown|organized OCR Markdown"`
- [x] `cd packages/api && rtk npm run build`
- [x] `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js server/controllers/agents/client.test.js server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|PaddleOCR|Steel context|input_file references|OCR-capable request attachments"`
- [x] `cd packages/api && rtk npx jest src/storage/s3/__tests__/crud.test.ts src/storage/cloudfront/__tests__/crud.test.ts --runInBand --watch=false --coverage=false --testNamePattern "direct storage-key|deterministic storage key|exact deterministic storage key"`
- [x] `cd packages/api && rtk npx jest src/steel/ocr/preprocess.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|synthetic 251-page"`
- [x] `rtk node --check api/server/services/ToolService.js`
- [x] `rtk node --check api/server/controllers/agents/client.js`
- [x] `rtk node --check api/server/controllers/agents/responses.js`
- [x] `rtk git diff --check`
- [x] `docs/reference/example/BH.pdf` local PDF smoke: 106 pages, 3 chunks
      (`1-50`, `51-100`, `101-106`), each split artifact remained a valid PDF
      with matching page count.
- [x] `docs/reference/example/BH.pdf` dev live smoke using `.env`: real Mongo
      artifact registry, real S3 chunk PDFs, real PaddleOCR MCP, and default
      OpenAI OAuth organizer completed; final merged Markdown saved with 51,048
      chars.
- [x] Dev readback confirmed final merged OCR Markdown exists, all 3 chunks are
      raw/organized saved, and artifact registry reuse does not split or upload
      the same chunk PDFs again.
- [x] Focused context test: verify a 3-chunk merged OCR Markdown payload is
      delivered to Steel agent context as one `currentOcrMarkdownResults` item,
      not as per-chunk arrays or raw PaddleOCR context.
- [x] Dev BH context smoke confirmed the 51,048-char runtime-merged Markdown is
      passed to Steel agent context as exactly one OCR Markdown payload, with
      zero raw PaddleOCR payloads and all three page ranges present.
- [x] Focused Jest context check:
      `cd packages/api && rtk npx jest src/steel/native/context.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "3-chunk merged OCR Markdown|same-turn organized OCR Markdown"`
- [x] Dev BH context smoke read the saved final merged Markdown from Mongo and
      verified Steel agent context receives one `currentOcrMarkdownResults`
      entry, `currentPaddleOcrResults` stays empty, and context content equals
      the saved merged Markdown.
- [x] OCR preprocessing organizer/subagent failures and PaddleOCR provider
      failures now emit UI-visible redacted error activity and throw redacted
      request errors so the chat message shows the concrete failure instead of
      silently continuing as partial preflight state.
- [x] Local dev server started for manual testing: backend health OK on
      `http://localhost:3080/health`, frontend/Vite proxy OK on
      `http://localhost:3090/health` and `http://localhost:3090/api/config`.

Follow-up hardening - 2026-07-03:

- [x] Updated OCR preprocessing events to show per-step PaddleOCR chunk,
      preflight-save, organizer/subagent, merged-read, and
      processing-with-merged-markdown activity.
- [x] Changed preprocessing orchestration so PaddleOCR chunks complete first;
      organizer/subagent chunks then re-read persisted `paddleocr_preflight`
      state from DB; final merge re-reads persisted `ocr_extract` chunk
      Markdown from DB.
- [x] Removed full merged Markdown persistence from OCR preprocessing memory
      state and runtime capture paths.
- [x] Hardened Steel runtime context and `read_markdown(scope: "ocr")` so they
      merge all OCR chunk Markdown at read time, label each file as
      `<file_key>`, and exclude raw PaddleOCR/preflight rows.
- [x] Wrapped direct AI `paddleocr_vl` MCP execution so raw PaddleOCR output is
      stored as preflight data, organized into chunk Markdown, and only
      `<file_key>` merged OCR Markdown is returned to the agent context.
- [x] Direct `paddleocr_vl` wrapper skips duplicate raw persistence when the
      same file already has organized OCR Markdown and returns the existing
      runtime merge instead.
- [x] PDFs under the 50-page chunk size skip PDF splitting/chunk upload only;
      they still run the same `1/1` PaddleOCR -> organizer/subagent Markdown
      -> returned merged Markdown flow.
- [x] PaddleOCR and organizer/subagent failures emit UI-visible OCR activity
      errors and throw redacted request errors for chat display.
- [x] Dev BH readback: found 3 `file:BH.pdf` chunk Markdown rows
      (`1-50`, `51-100`, `101-106`) and verified runtime merge yields
      51,048 chars without raw PaddleOCR markers while ignoring the legacy full
      merged row.
- [x] Frontend Steel activity now accepts `ocr_preprocessing` SSE events,
      preserves distinct progress messages instead of deduping them away, and
      renders the OCR step text/error details verbatim.
- [x] Direct AI `paddleocr_vl` MCP calls now emit the same visible OCR progress
      sequence for PaddleOCR raw capture, organizer Markdown, merged Markdown
      read, and final Markdown handoff.

Event visibility verification - 2026-07-03:

- [x] Client SSE spec covers the expected OCR preprocessing sequence:
      uploaded PDF/chunks, PaddleOCR running/ran/saved, organizer
      running/ran/saved, read merged Markdown, and processing with merged
      Markdown.
- [x] Client activity spec confirms OCR preprocessing progress text and error
      details render in chat activity.
- [x] API event builder spec confirms chunk completion emits `Ran ...` progress
      plus `... saved` memory events.
- [x] Direct MCP ToolService spec confirms direct AI PaddleOCR calls return only
      merged Markdown and emit the same visible OCR progress sequence.

Activity collapse UX - 2026-07-03:

- [x] Default Steel activity to the latest 3 events when a turn has more than 3
      visible events.
- [x] Add an accessible chevron toggle that expands to every event and collapses
      back to the latest 3 events, matching the tool-call group interaction.
- [x] Keep 1-3 event turns unchanged and avoid moving activity state into global
      Recoil.
- [x] Cover collapsed, expanded, and small-event cases with focused client
      tests.

---

# Active: Stop during conversation preflight removes conversation - 2026-07-03

Goal: if a conversation already has a real `conversationId`, stopping during
preflight/generation must not auto-remove it from the conversation list.

Plan:

- [x] Trace stop/abort cleanup from UI action through submission state and
      conversation-list cache mutation.
- [x] Identify the distinction between true temporary conversations and
      persisted conversations that have already received a real id.
- [x] Add a focused regression test for "stop after real id is assigned keeps
      the conversation list item".
- [x] Fix the cleanup guard at the source, not by re-adding the item later.
- [x] Run focused client tests, typecheck if touched, and `rtk git diff --check`.

Review notes:

- `useResumableSSE` generated a concrete stream/conversation id before
  preflight finished, hydrated the optimistic user message, then terminal
  404/error cleanup could still remove the sidebar row because no backend
  `created` event had arrived yet.
- `useEventHandlers.finalHandler` treated early aborts from a root message as a
  disposable new-chat rollback even when the submission had already been
  hydrated with a concrete conversation id.
- The abort endpoint also skipped persistence for early aborts without a
  response message. That meant a generated-id preflight stop could survive only
  in frontend cache and disappear after a conversation refetch/reload.
- The fix keeps concrete-id preflight stops under the generated conversation,
  preserves and persists the user message/conversation row, and only restores
  the prompt draft for existing non-root abort rollback.

Verification run:

- [x] `cd client && rtk npx jest src/hooks/SSE/__tests__/useEventHandlers.spec.ts --runInBand --coverage=false --silent`
- [x] `cd client && rtk npx jest src/hooks/SSE/__tests__/useResumableSSE.spec.ts --runInBand --coverage=false --silent`
- [x] `cd api && rtk npx jest server/routes/agents/__tests__/abort.spec.js --runInBand --coverage=false --silent`
- [x] `cd client && rtk npm run typecheck`
- [x] `rtk node --check api/server/routes/agents/index.js`
- [x] `rtk git diff --check`
- [x] Local server health remains OK: `http://localhost:3080/health`,
      `http://localhost:3090/health`, and `http://localhost:3090/api/config`
      all returned HTTP 200.

---

# Active: OCR PDF chunk artifact reuse event - 2026-07-03

Goal: when OCR preprocessing finds existing PDF chunk artifact rows for the
same source file key and S3 confirms the chunk PDFs still exist, reuse them
without splitting/uploading again and show a fetched-chunks progress event.

Plan:

- [x] Trace current PDF chunk artifact reuse path and OCR preprocessing event
      mapping.
- [x] Add tests for DB+S3 verified reuse, stale DB rows with missing S3 objects,
      and fetched/uploaded progress source.
- [x] Verify existing artifact rows with S3 before reuse.
- [x] Recreate/upload stale artifact rows whose S3 object is missing.
- [x] Emit `Fetched pdf chunks (...)` only when every chunk came from verified
      existing DB rows; keep `Uploaded pdf to S3 (...)` for new uploads.

Review notes:

- Existing artifact rows were reused without an S3 existence check. Now each
  row is considered reusable only after `exists(storageKey)` returns true.
- Stale rows whose S3 object is missing are regenerated and upserted instead of
  returning a broken download URL.
- The OCR preprocessing `pdf_chunks_ready` progress event now carries
  `source: "fetched" | "uploaded"`, derived from artifact provenance.

Verification run:

- [x] `cd packages/api && rtk npx jest src/steel/ocr/artifacts.spec.ts src/steel/ocr/preprocess.spec.ts src/steel/native/events.spec.ts --runInBand --watch=false --coverage=false`
- [x] `rtk node --check api/server/services/ToolService.js`

---

# Active: Preflight stop preserves user attachments - 2026-07-03

Goal: stopping during OCR/conversation preflight must persist the user message
with its uploaded file metadata so refresh still shows the PDF file chip.

Plan:

- [x] Trace the early request metadata path that seeds abort persistence before
      `initializeClient()` finishes.
- [x] Add a regression test proving early resume metadata includes the uploaded
      `files` array.
- [x] Add a regression test proving the abort endpoint saves user-message
      `files` when no assistant response exists yet.
- [x] Include filename-bearing file metadata in frontend submission payloads so
      persisted user attachments can render the same visible file UI after
      reload.
- [x] Run focused backend/frontend verification and final `rtk git diff --check`.

Review notes:

- `getPreliminaryUserMessage()` currently seeds abort metadata with text and
  quotes only. If the user stops before normal `sendMessage` completion attaches
  files from `client.options.attachments`, the abort endpoint can persist a
  text-only user message.
- The message attachment UI renders from `message.files`; visible labels come
  from `file.filename`, so preserving only `file_id` is not enough for the
  expected `BH.pdf` chip after refresh.

Verification run:

- [x] Red test observed:
      `cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js --runInBand --coverage=false --testNamePattern "stores uploaded files"`
      failed because early metadata omitted `userMessage.files`.
- [x] Red test observed:
      `cd client && rtk npx jest src/hooks/Chat/__tests__/useChatFunctions.regenerate.spec.tsx --runInBand --coverage=false --testNamePattern "includes filename-bearing file metadata"`
      failed because submitted files omitted `filename` and `bytes`.
- [x] `cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js --runInBand --coverage=false --silent`
- [x] `cd api && rtk npx jest server/routes/agents/__tests__/abort.spec.js --runInBand --coverage=false --silent`
- [x] `cd client && rtk npx jest src/hooks/Chat/__tests__/useChatFunctions.regenerate.spec.tsx --runInBand --coverage=false --silent`
- [x] `rtk node --check api/server/controllers/agents/request.js`
- [x] `rtk node --check api/server/routes/agents/index.js`
- [x] `cd client && rtk npm run typecheck`
- [x] `rtk git diff --check`
- [x] Local server health remains OK after nodemon reload:
      `http://localhost:3080/health`, `http://localhost:3090/health`, and
      `http://localhost:3090/api/config` returned HTTP 200.

---

# Active: Official OCR markdown contract - 2026-07-03

Goal: separate raw PaddleOCR data, subagent/chunk OCR Markdown, and official
PaddleOCR-derived OCR Markdown so the main agent and `read_markdown(scope:
"ocr")` only receive official OCR Markdown.

Plan:

- [x] Trace the duplicated activity events and current OCR persistence kinds.
- [x] Add regression tests for official OCR Markdown persistence and
      `read_markdown(scope: "ocr")` excluding raw/subagent rows.
- [x] Save official OCR Markdown from assistant final Markdown capture, not
      from preprocessing, with distinct PaddleOCR-derived vs AI-derived sources.
- [x] Make preprocessing/direct PaddleOCR wrappers check official OCR Markdown
      first and skip rerun unless the tool call explicitly requests `new: true`.
- [x] Distinguish official OCR Markdown source: PaddleOCR-derived rows can skip
      future PaddleOCR, AI OCR-derived rows cannot.
- [x] Preserve multiple multi-file official OCR Markdown rows under the
      `default` bucket by grouping on covered file keys instead of replacing all
      default OCR data.
- [x] Delete the generic raw preflight save action after preprocessing and
      rename official OCR Markdown activity to `OCR markdown saved`.
- [x] Route image/whole-file PaddleOCR through the same single-chunk `1/1`
      preprocessing flow instead of a legacy generic event branch.
- [x] Run focused backend/frontend tests, type/build checks, and `rtk git diff
      --check`.

Review notes:

- `PaddleOCR preflight saved` after `Processing pdf with OCR markdowns` is
  generic preflight activity derived from raw `paddleocr_preflight` totals, not
  a useful user-visible step after preprocessing already completed.
- `Steel quote state saved` for OCR output is a generic `ocr_extract` memory
  saved label. Official OCR Markdown needs a distinct label from Steel quote or
  workbook state.
- Subagent chunk Markdown remains durable process/resume state; it must not be
  returned by `read_markdown(scope: "ocr")`.

Review:

- Preprocessing now produces only raw chunk state plus subagent chunk Markdown
  state, then returns one merged OCR Markdown attachment to the main agent.
  It no longer writes official OCR Markdown directly.
- Assistant final Markdown capture saves OCR tables as official OCR Markdown.
  `ocrSource: "paddleocr_official_markdown"` can satisfy future PaddleOCR
  shortcuts; `ocrSource: "ai_official_markdown"` remains readable OCR Markdown
  but does not skip PaddleOCR.
- Multi-file official OCR rows use `ocrFileKey: "default"` plus `ocrFileKeys`
  and `ocrGroupKey`, so a later multi-file OCR result for different files does
  not replace an earlier completed group.
- `read_markdown(scope: "ocr")` filters out raw PaddleOCR rows and subagent
  chunk Markdown rows, and labels official OCR Markdown by file key/default plus
  file key lists.
- Verification passed:
  - `rtk node --check api/server/services/ToolService.js`
  - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "official|OCR read|PaddleOCR preflight raw|assistant OCR|multi-file"`
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR|OCR preprocessing|direct PaddleOCR|single"`
  - `cd packages/api && rtk npx jest src/steel/native/events.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|markdown_saved|PaddleOCR preflight"`
  - `cd packages/api && rtk npx jest src/steel/tools/execute.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "official OCR Markdown|read_markdown|OCR"`
  - `cd packages/api && rtk npx jest src/steel/ocr/preprocess.spec.ts --runInBand --watch=false --coverage=false`
  - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --coverage=false`
  - `cd client && rtk npx tsc --noEmit --pretty false --skipLibCheck`
  - `rtk git diff --check`
  - Local `http://localhost:3080/health` and `http://localhost:3090/`
    returned HTTP 200.

---

# Active: Message-level batch OCR phase ordering - 2026-07-03

Goal: when one user message has multiple OCR-capable files/images, process all
files as one batch: prepare all chunk identities first, run PaddleOCR for all
chunks, then run organizer/subagent Markdown for all chunks, then pass merged
per-file OCR Markdown attachments to the main agent together.

Plan:

- [x] Add regression coverage proving two files/chunks do not run organizer
      work until every PaddleOCR chunk in the message batch has completed.
- [x] Add a batch preprocessing API that returns one merged Markdown attachment
      per file key while preserving existing per-file resume/official shortcut
      behavior.
- [x] Wire native preflight/direct ToolService preparation to call the batch API
      once per message instead of running one full pipeline per file.
- [x] Verify official OCR Markdown save stays split by file key when the main
      agent returns multiple OCR tables, and default/multi-file rows remain
      grouped by covered file key set.
- [x] Run focused backend/frontend checks and keep local `3080`/`3090` healthy.

Notes:

- File chunk identity must include `ocrFileKey`, `sourcePdfKey`, and chunk
  index/count before PaddleOCR starts.
- The raw PaddleOCR and subagent chunk Markdown DB rows remain resume state.
  Main-agent context should still receive only merged per-file Markdown
  attachments.

Review:

- [x] Added `runOcrPreprocessingBatchPipeline()` and kept
      `runOcrPreprocessingPipeline()` as a single-file wrapper around it.
- [x] Batch pipeline now checks official PaddleOCR OCR Markdown per file,
      reuses completed chunk Markdown per file, prepares missing artifacts for
      all files, runs all PaddleOCR chunks, re-reads DB preflight state, runs
      all organizer chunks, then re-reads DB Markdown state and returns one
      merged Markdown result per file.
- [x] Native automatic preflight now builds all current message file/chunk
      inputs first and calls the batch pipeline once, so multiple PDFs/images
      are handed to the main agent together as merged per-file OCR Markdown.
- [x] Added regression coverage that split official OCR Markdown tables from
      the main agent save under their matched file keys, while unresolved
      integrated multi-file OCR remains grouped under `default` by file-key set.
- [x] Added multi-file resume coverage: file A can resume from saved
      PaddleOCR raw data while file B still runs PaddleOCR, then both files
      continue organizer/subagent Markdown from their own file-key state.
- [x] Added Mongo state isolation coverage proving OCR preprocessing progress
      reads only the requested `ocrFileKey` and `sourcePdfKey`.
- [x] Updated the organized chunk Markdown persistence test to expect
      `ocr_preprocessing_chunk_markdown` saved counts, keeping subagent chunk
      Markdown separate from official OCR Markdown.

Verification:

- [x] `cd packages/api && rtk npx jest src/steel/ocr/preprocess.spec.ts --runInBand --watch=false --coverage=false`
- [x] `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "requested file key and source PDF|reads OCR preprocessing chunk state|persists PaddleOCR chunk results|captures organized chunk markdown"`
- [x] `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "routes every current OCR-capable file|routes current PDFs|uses the original PDF artifact|OCR preprocessing|PaddleOCR"`
- [x] `rtk node --check api/server/services/ToolService.js`
- [x] `rtk git diff --check`
- [x] `http://localhost:3080/health` returned HTTP 200 and
      `http://localhost:3090/` returned HTTP 200.

---

# Active: 100-page PDF context overflow research - 2026-07-03

Goal: research why a roughly 100-page PDF can trigger
`empty_messages` / `instructionTokens exceed maxContextTokens`, and identify
the safest fix path before implementation.

Status:

- [x] Read project instructions, current lessons, RTK rule, and relevant memory.
- [x] Trace where PDF/OCR/file-analysis content enters instructions,
      additional instructions, tool definitions, or message history.
- [x] Explain why pruning removes all messages and why the oversized payload
      is counted as instruction tokens.
- [x] Compare solution options and recommend the lowest-risk design.
- [x] Record findings, verification seams, and next tasks.

Findings:

- Root cause is not PDF upload size directly. Automatic PaddleOCR preflight
  saves the full OCR result, then also passes the full same-turn result into
  `attachments.currentPaddleOcrResults`.
- `buildDefaultSteelGlobalAgentContext()` forwards that array into
  `runtimeContextText`, and `serializeSteelRuntimeContext()` stringifies the
  complete attachment payload.
- Native AgentClient and Open Responses both append `runtimeContextText` to
  shared run context / `additional_instructions`.
- In `@librechat/agents`, OpenAI/OAuth has no prompt-cache dynamic-tail split,
  so additional instructions are folded into the SystemMessage and counted as
  `systemMessageTokens`. That matches the observed breakdown:
  `system: 463901`, `dynamic: 0`, `tools: 1945`.
- `maxContextTokens: 245100` matches the repo's OpenAI OAuth 258K context
  ceiling after the 0.95 reserve ratio. Raising UI max context is not a real
  fix for this provider path.
- Summarization cannot rescue this case. When instruction tokens already exceed
  context, the summarizer explicitly skips because a summary would add more
  instruction overhead, and Graph then raises `empty_messages`.
- Local reproduction with `createPruneMessages()` and
  `getInstructionTokens() => 465846` produced `contextLength: 0`,
  `remainingContextTokens: 0`, and `effectiveInstructionTokens: 465846`.

---

# Active: OCR preprocessing activity and context hardening - 2026-07-03

Goal: make the PDF OCR preprocessing flow visibly progress through every
PaddleOCR chunk, organizer chunk, and final runtime merged-Markdown handoff,
while ensuring the main Steel agent receives only one merged organizer Markdown
payload per PDF file key.

Checklist:

- [x] Diagnose whether the current AH/PDF overflow came from raw PaddleOCR
      output, duplicated OCR Markdown, or a single oversized merged Markdown.
- [x] Add regression tests for per-chunk PaddleOCR progress, per-chunk
      organizer Markdown saves, and final merged-Markdown handoff events.
- [x] Add regression tests that PDF preprocessing does not put raw PaddleOCR
      output or per-chunk Markdown arrays into main-agent context.
- [x] Remove full merged Markdown DB persistence; DB should keep only raw
      preflight chunks and organizer chunk Markdown rows, with runtime merging
      chunk Markdown into one main-agent attachment.
- [x] Preserve resumability with two DB-backed preprocessing nodes:
      `paddleocr_preflight` raw chunk rows for PaddleOCR progress and
      `ocr_extract` chunk Markdown rows for subagent progress.
- [x] Make `read_markdown(scope: "ocr")` return all OCR Markdown automatically,
      with each file's merged all-chunk Markdown labeled by `<file_key>` and
      without requiring a file/chunk/part argument.
- [x] Keep automatic PaddleOCR tool-call activity compact so raw provider
      output is persisted as `paddleocr_preflight` evidence but not surfaced as
      chat/tool-event output.
- [x] Run focused backend/frontend tests and final hygiene checks.

Review notes:

- AH.pdf local Mongo evidence showed 4 active `paddleocr_preflight` raw rows,
  4 active `ocr_preprocessing_subagent` chunk Markdown rows, and 1 old active
  `ocr_preprocessing_merge` full Markdown row. The old full merged row made DB
  store duplicate Markdown and was removed from the write path.
- Main-agent context now normalizes OCR preprocessing evidence before
  serialization: raw PaddleOCR chunk rows and legacy merged rows stay out of
  `priorActiveFileEvidence`; organized chunk Markdown rows are merged at
  runtime into one `<file_key>` labeled Markdown payload per file.
- Same-turn PDF preprocessing still returns exactly one merged Markdown payload
  per PDF file key in `currentOcrMarkdownResults`, labeled with `<file_key>`.
- `read_markdown(scope: "ocr")` uses the same runtime normalization and returns
  all current OCR Markdown, with one `<file_key>` labeled merged Markdown block
  per file. No file key or chunk/part argument is required for OCR reads.
- Automatic PDF PaddleOCR chunk tool completion events now emit compact
  metadata (`chunkIndex`, `pageStart`, `rawTextLength`, hash, storage target)
  instead of raw OCR provider payloads.

Verification run:

- [x] `cd packages/api && rtk npx jest src/steel/ocr/preprocess.spec.ts src/steel/native/events.spec.ts src/steel/runtime/context.spec.ts src/steel/tools/execute.spec.ts src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|OCR markdown|read_markdown|PaddleOCR preflight raw|active OCR extracts|preprocessing resume|organized chunk|merged OCR|current OCR merged Markdown|current PaddleOCR|scope-only OCR"`
- [x] `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "compact PaddleOCR chunk tool output|routes current PDFs|OCR preprocessing organizer failures|PaddleOCR preflight failures"`
- [x] `cd packages/api && rtk npm run build`
- [x] `rtk node --check api/server/services/ToolService.js`

Recommendation:

- Do not put full large same-turn PaddleOCR results into Steel runtime
  instructions. Keep the full raw result persisted in `paddleocr_preflight`,
  but serialize only a bounded OCR evidence manifest into
  `runtimeContextText`.
- Preserve the existing "do not rerun OCR" policy by making the manifest
  explicit: current file key, filename, OCR source/status, page/content-part
  counts, and a directive to use `read_markdown(scope: "ocr", ocrFileKey:
  "file:<id>")` for full evidence when omitted from context.
- Extend `read_markdown` before relying on it for 100-page PDFs. The current
  keyed OCR read exposes `contentParts`, but the tool still returns full
  content/markdown for the file. Add `contentPartIndex` or `pageRange` so the
  tool output itself stays bounded.
- Keep full same-turn injection only for small OCR payloads under a measured
  budget. Large payloads should degrade to manifest + retrieval, never silent
  hard truncation.

Verification seams for implementation:

- `api/server/services/__tests__/ToolService.spec.js`: preflight still saves
  the complete PaddleOCR result.
- `packages/api/src/steel/runtime/context.spec.ts`: large
  `currentPaddleOcrResults` serializes to a bounded manifest, not full raw
  text/pages.
- `packages/api/src/steel/native/context.spec.ts`: `runtimeContextText` remains
  under a safe budget for a synthetic 100-page OCR result and keeps retrieval
  instructions.
- `packages/api/src/steel/tools/execute.spec.ts`: keyed `read_markdown` can
  return one OCR chunk/page range without including the full file content.
- `packages/api/src/agents/__tests__/run-summarization.test.ts` or a focused
  graph/pruning test: large OCR evidence no longer drives
  `instructionTokens > maxContextTokens`.

---

# Active: PaddleOCR MCP input_data URL/prefix normalization - 2026-07-02

Goal: harden `paddleocr_vl.input_data` so AI-added prefixes do not break
PaddleOCR calls, while supporting S3/http URLs, `file:<id>` / file ids,
and data URLs while rejecting direct local paths.

Status:

- [x] Add red MCP resolver regressions for prefixed current-file tokens,
      direct http(s) URLs, data URLs with prefixes, and local-path rejection.
- [x] Implement a single PaddleOCR input canonicalization path before
      `mcpManager.callTool()`.
- [x] Prefer owned current-file resolution over trusting AI-supplied URLs.
- [x] Pass supported direct URL/data inputs through instead of sending
      malformed prefixed strings to PaddleOCR.
- [x] Run focused MCP tests, build/checks, and document evidence.

Investigation:

- Current `prepareMCPToolArguments()` already runs for both model-requested
  `paddleocr_vl` calls and automatic Steel PaddleOCR preflight.
- Existing resolver strips only `file:` while matching filenames/file ids. Other
  AI-added prefixes can leave `input_data` malformed unless basename matching
  happens to recover it.
- Preflight uses controlled file ids via the same MCP tool wrapper, so the
  higher-risk path is model-generated `input_data` on manual tool calls.

Fix:

- Added candidate extraction for PaddleOCR `input_data` before MCP execution:
  `data:...`, `http(s)://...`, `file:<id>`, raw file ids, and
  label-stripped values such as `file_url:...` / `source=...`.
- Current owned attachments still win over direct AI-supplied URLs; S3 current
  files are rewritten through `getDownloadURL()` to a clean backend-generated
  URL, and non-S3 owned files continue through the data URL fallback.
- If no owned current file matches, supported direct `http(s)://`, `data:` and
  raw Base64 inputs are passed through without the AI-added prefix.
- Direct local paths such as `file://...`, `/tmp/...`, `./...`, `../...`, and
  Windows path forms are rejected unless they only serve as a local-path-shaped
  alias for an owned current file, in which case the owned file is still
  rewritten to a backend-controlled URL/data URL.
- PaddleOCR resolver logs now strip URL query strings before logging matched
  URL-shaped inputs.

Verification:

- Red first:
  `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR"` failed on the four new prefixed-input regressions before the fix.
- Red correction:
  the same focused spec failed on direct `file://...` and `/tmp/...` local path
  rejection before banning direct local paths.
- Green:
  `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR"`
- `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false`
- `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR|preflight"`
- `node --check api/server/services/MCP.js`
- `git diff --check`

---

# Active: Cross-device message elapsed timer reset - 2026-07-02

Goal: diagnose and fix the UI bug where a running assistant message elapsed
timer shows only a few seconds after switching to another browser/computer,
even though the generation had already been running for minutes.

Status:

- [x] Read project instructions, timing lesson, and current message timer code.
- [x] Trace the elapsed-time data flow through message rendering, resumable SSE,
      and generation resume state.
- [x] Add a red regression for reconnect/resume preserving original generation
      start time.
- [x] Implement the minimal fix at the server resume-state and frontend
      resumed-submission seams.
- [x] Run focused tests/checks and document evidence.

Investigation:

- `MessageElapsedTimer` computes the displayed elapsed time from the parent
  user message timestamp first, then the assistant message timestamp.
- A normal local submit has the user message `clientTimestamp`, so the timer
  starts near the original submit time.
- Cross-device resume builds a new submission from `resumeState`; that state
  currently carries message ids/content/model/icon metadata, but not the
  original generation/job start timestamp as client-facing message metadata.
- When the reconnecting browser builds the resumed placeholder without that
  timestamp, the timer falls back to the new local render time and then freezes
  at only a few seconds when the final message arrives.

Fix:

- `ResumeState` now exposes the server-side generation job `createdAt` value.
- Cross-device resume and SSE sync rebuild user/assistant placeholders with
  that original timestamp as both `createdAt` and `clientTimestamp`.
- Sync updates preserve the existing resumed timestamp instead of replacing it
  with the reconnecting browser's current time.

Verification:

- `cd client && rtk npx jest src/hooks/SSE/__tests__/useResumeOnLoad.spec.tsx src/hooks/SSE/__tests__/useResumableSSE.spec.ts --runInBand --watch=false --coverage=false`
- `cd packages/api && rtk npx jest src/stream/__tests__/GenerationJobManager.stream_integration.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "metadata consistency|createdAt|resume"`
- `cd packages/data-provider && rtk npm run build`
- `cd packages/api && rtk npm run build`
- `rtk npm run frontend:ci`
- `git diff --check`

Note:

- `cd client && rtk npm run typecheck` currently fails in this checkout with
  workspace/module resolution errors such as `Cannot find module
  'librechat-data-provider'`; the root `frontend:ci` path passed and rebuilds
  the relevant packages before the client build.

---

# Active: Production OCR preflight read_markdown regression check - 2026-07-02

Goal: diagnose and fix conversation
`72502043-ef9b-42c8-94ff-c5f8b1cbf5f0`, where `d.pdf` has PaddleOCR output
but the assistant still calls `read_markdown`.

Status:

- [x] Inspect production conversation and current deployed build without
      leaking secrets.
- [x] Compare the current local runtime policy with the message/tool evidence.
- [x] Identify whether this is an already-fixed-but-not-deployed issue, a
      missing context/prompt path, or a remaining tool-policy gap.
- [x] Add a red regression for the exact remaining gap before changing runtime
      code.
- [x] Implement the smallest fix at the owning seam.
- [x] Run focused tests/build/checks and document evidence.

Review:

- Production Mongo showed `d.pdf` had active `paddleocr_preflight` before the
  assistant response, and production `/api/config` reported deployed commit
  `038f65c`.
- The assistant called only `read_markdown(scope:"ocr", ocrFileKey:"file:15d...")`;
  the visible PaddleOCR step was automatic preflight, not a model-requested
  second OCR run.
- Root cause: `toBoundedSteelPaddleOcrValue()` hard-truncated same-turn OCR
  strings to 1200 characters and arrays to 20 items before runtime context
  injection, so the AI saw incomplete OCR evidence and used `read_markdown` to
  recover full content.
- Additional context gap: native context preserved current files only under
  `Steel Native File References`; `Steel Runtime Context.attachments.currentTurnFiles`
  was empty, weakening the same-turn OCR policy's current-file matching.
- Follow-up fix: removed remaining hard truncation from Steel tool output and
  memory capture paths, including `sanitizeSteelToolOutput()` caps and
  `toBoundedJsonValue()`.
- Red/green evidence:
  - `api/server/services/__tests__/ToolService.spec.js` failed before the fix
    because long PaddleOCR text was truncated to 1200 characters and page
    results were capped to 20 entries; after the fix the complete result is
    preserved.
  - `packages/api/src/steel/native/context.spec.ts` failed before the fix
    because runtime `attachments.currentTurnFiles` was `[]`; after the fix it
    contains the current file metadata.
  - `packages/api/src/steel/tools/sanitize.spec.ts` failed before the fix
    because `sanitizeSteelToolOutput()` truncated long strings and arrays;
    after the fix it preserves complete tool output while still redacting
    instruction-like text.
  - `packages/api/src/steel/memory/service.spec.ts` failed before the fix
    because `toBoundedJsonValue()` truncated PaddleOCR content and limited
    tool-result arrays; after the fix memory payloads keep complete JSON.
- Verification passed:
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR|preflight"`
  - `cd packages/api && rtk npx jest src/steel/tools/sanitize.spec.ts src/steel/tools/execute.spec.ts src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npm run build`
  - `rtk git diff --check`

---

# Active: Production third-turn PaddleOCR preflight reuse bug - 2026-07-02

Goal: diagnose and fix conversation
`2fea7694-7872-4846-95dd-2297dc7a1df5`, where the third file turn for
`d.pdf` saves automatic PaddleOCR preflight, then the assistant runs
`read_markdown` and calls PaddleOCR again, producing `Error calling tool
'paddleocr_vl'`.

Status:

- [x] Inspect the user screenshot and production Mongo using `.env.prod`.
- [x] Compare third-turn messages, active Steel memory, current file keys, and
      server logs.
- [x] Identify why the assistant ran `read_markdown` and then retried
      PaddleOCR despite a successful d.pdf preflight.
- [x] Add red regressions for same-turn PaddleOCR context policy,
      `read_markdown(scope:"ocr")` raw preflight visibility, and
      `file:<id>` PaddleOCR input resolution.
- [x] Implement the fix at the runtime context, read_markdown, and MCP input
      resolver seams.
- [x] Run focused tests/build and local production-data verification.
- [x] Deploy and verify production build state.

Evidence:

- Screenshot showed third turn used tools in this order:
  `paddleocr_vl`, `read_markdown`, then `paddleocr_vl`.
- Production Mongo showed d.pdf already had active
  `paddleocr_preflight` with `ocrFileKey:
  file:2e3d9903-9736-41a9-bbf1-87e5c8e0a093`, `filename: d.pdf`, and
  `ocrSource: paddleocr_mcp`.
- The same assistant message's stored tool calls showed
  `read_markdown(scope:"ocr")` returned old a.jpg / b.jpg assistant OCR
  Markdown, not d.pdf's raw PaddleOCR preflight result.
- The model-visible second PaddleOCR call used
  `input_data: "file:2e3d9903-9736-41a9-bbf1-87e5c8e0a093"`.
- Production logs at `2026-07-01T22:24:43Z` showed the second PaddleOCR call
  failed before OCR execution with `ValueError: Invalid input_data`, because
  `paddleocr-mcp` only accepts absolute paths, URLs, raw Base64, or data URLs.

Fix:

- `attachments.currentPaddleOcrResults` is now paired with an explicit runtime
  `currentPaddleOcrUsagePolicy`: if the current file already has same-turn
  PaddleOCR evidence, use it directly; do not call `read_markdown` for that
  file and do not call `paddleocr_vl` again unless the user explicitly asks to
  rerun OCR or the result is absent/failed.
- `readOutputSheetMemory()` now includes active `paddleocr_preflight` rows as
  OCR evidence. The raw PaddleOCR result is exposed through
  `derivedIndex.ocrExtracts` without adding workbook/system_order rows.
- `read_markdown(scope:"ocr")` labels these rows as
  `PaddleOCR raw/preflight item N - filename`, so the assistant can see that
  d.pdf already has PaddleOCR evidence even if it calls read_markdown.
- PaddleOCR MCP input resolution now treats `file:<id>` as a file-key wrapper
  around the owned file id before matching request file records, so model
  retries do not pass `file:<id>` directly to `paddleocr-mcp`.
- `read_markdown(scope:"ocr")` now returns an OCR evidence index plus
  structured `items[]`, one item per OCR file. This keeps later file keys and
  per-file content visible even when an earlier OCR result is long enough to
  trigger the Steel tool sanitizer's string cap.
- `read_markdown(scope:"ocr", ocrFileKey:"file:<id>")` now reads a single OCR
  file result. Aggregate OCR reads are for listing file keys / short evidence;
  keyed OCR reads return per-file `contentParts[]` chunks so long OCR Markdown
  is not lost to string truncation.
- `read_markdown(scope:"workbook")` without `fileKey` returns the combined
  current workbook. `read_markdown(scope:"workbook", fileKey:"file:<id>")`
  reads workbook rows tied to one OCR file when multiple OCR files have
  separate orders. `read_markdown(scope:"workbook", fileKey:"default")` reads
  the text/manual/default order. Workbook parse/save now stores default rows
  with `ocrFileKey: "default"` and same-key replacements only supersede that
  key's rows.

Verification:

- `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false`
- `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR|preflight"`
- `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false`
- `cd packages/api && rtk npx jest src/steel/tools/execute.spec.ts --runInBand --watch=false --coverage=false`
- `cd packages/api && rtk npx jest src/steel/tools/execute.spec.ts src/steel/tools/registry.spec.ts --runInBand --watch=false --coverage=false`
- `cd packages/api && rtk npx jest src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts --runInBand --watch=false --coverage=false`
- `cd packages/api && rtk npx jest src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "read_markdown|tool policy|aiVisibleTools|compact workbook|always exposes"`
- Simplify pass reduced duplicated file-key matching logic in
  `read_markdown`, limited legacy no-key default matching to workbook reads,
  and kept requested `fileKey` calculation single-source within the tool
  execution path.
- `cd packages/api && rtk npm run build`
- `rtk git diff --check HEAD`
- Local new-code readback against `.env.prod` Mongo for conversation
  `2fea7694-7872-4846-95dd-2297dc7a1df5` returned
  `ocrEvidenceTotal: 5`, `itemCount: 5`, and one d.pdf item with
  `ocrFileKey: file:2e3d9903-9736-41a9-bbf1-87e5c8e0a093`,
  `ocrSource: paddleocr_mcp`, and `hasRenderableText: true`.
- The same local new-code `read_markdown(scope:"ocr")` check confirmed its
  Markdown includes `d.pdf`, the d.pdf file id, and the d.pdf file key.
- Local new-code `read_markdown(scope:"ocr", ocrFileKey:
  "file:2e3d9903-9736-41a9-bbf1-87e5c8e0a093")` against `.env.prod` Mongo
  returned exactly one item for `d.pdf`, `keyedOnlyDFile: true`,
  `hasRenderableText: true`, and `contentParts: 2`.
- GitHub deploy run `28553416272` completed successfully for commit
  `2b3652996c8263bc05993a37b83f4ab066394dc6`.
- Production `/api/config.buildInfo` reports commit
  `2b3652996c8263bc05993a37b83f4ab066394dc6`, branch `master`, and build date
  `2026-07-01T23:01:39Z`; `/health` returns `OK`.

---

# Active: Production PaddleOCR second-turn OCR table persistence bug - 2026-07-02

Goal: diagnose and fix the production chat where the first image turn
PaddleOCR succeeds, the second image turn fails regardless of image order, and
the second turn's OCR fallback Markdown is not persisted as an OCR table.

Status:

- [x] Read repo instructions, existing OCR lessons, prior todo evidence, and
      the current worktree before changing code.
- [x] Inspect the production conversation using `.env.prod` Mongo and server
      logs without leaking secrets.
- [x] Confirm whether the second turn saved `paddleocr_preflight` raw results,
      emitted assistant OCR Markdown, and attempted `ocr_extract` capture.
- [x] Trace the second-turn boundary across current-turn files, PaddleOCR MCP
      execution, fallback Markdown generation, and title-gated OCR save logic.
- [x] Add a red regression at the seam that reproduces
      `Total: OCR raw results: 2, OCR tables: 1` after two image turns.
- [x] Implement the minimal root-cause fix.
- [x] Add a PaddleOCR preflight retry that rebuilds the MCP connection after a
      sequential provider/network reset.
- [x] Run focused backend tests/build/checks and update this review section
      with exact evidence.

Initial evidence from user:

- Production conversation:
  `https://chat.longdin.org/c/968973e2-2b24-4263-8371-4a4cc6d65fde`.
- Production Mongo must be read from `.env.prod`, not local `.env`.
- `b.jpg` succeeds when it is the first turn; `a.jpg` fails when it is the
  second turn.
- If image order is swapped, the second turn `b.jpg` fails instead.
- After the second-turn `a.jpg` failure, OCR fallback Markdown is also not
  stored in DB.
- Observed aggregate: `Total: OCR raw results: 2, OCR tables: 1`.
- Expected aggregate: `Total: OCR raw results: 2, OCR tables: 2`.

Hypotheses:

1. If second-turn PaddleOCR uses stale or mismatched current-turn file context,
   raw preflight may save under the new key while fallback/assistant OCR capture
   loses the file key or attachment reference, leaving only one `ocr_extract`.
2. If the second-turn assistant fallback Markdown lacks an OCR-like nearby
   title after a PaddleOCR tool error, title-gated capture will skip it even
   though user-visible OCR content exists.
3. If the native Responses/AgentClient final-save hook runs after the stream
   closes or is skipped on tool-error fallback, the UI can show raw preflight
   totals but never persist the assistant OCR table.
4. If the PaddleOCR MCP process/session or AI Studio provider fails only on the
   second call, the runtime still must preserve actionable fallback Markdown
   and persist OCR table state when the assistant returns it.

Review - 2026-07-02:

- Production `/api/config` showed the live container running build commit
  `87fa43fde5402ca4813054a464e542234a29de71`, not local `6fdef4bf`.
- Production container was healthy and freshly started, so the symptom was not
  an incomplete restart of the deployed `87fa43f` image.
- Production logs around the second turn showed a real PaddleOCR MCP provider
  failure: `ClientConnectorError` / `Connection reset by peer` connecting to
  `paddleocr.aistudio-app.com:443`.
- `.env.prod` Mongo readback for conversation
  `968973e2-2b24-4263-8371-4a4cc6d65fde` showed exactly:
  `paddleocr_preflight:active = 2` and `ocr_extract:active = 1`.
- The second assistant message contained fallback OCR Markdown for `a.jpg` with
  `## OCR 結果確認表 — a.jpg`, but it placed
  `file key: file:f44bb0d3-46cd-4c88-949e-a772dc8251f3` between the heading
  and the table.
- Root cause: `getParsedTables()` used the last non-table line before the table
  as the title. The `file key` metadata line overwrote the OCR heading, so the
  title-gated OCR capture did not see `OCR` and skipped the table.
- Fix: structured Markdown headings / bold headings now stay as the pending
  table title until the next table; ordinary metadata lines no longer overwrite
  them.
- Confirmed multi-file OCR Markdown results are already file-keyed:
  descriptors use `fileId`, then `storageKey`, then path, then filename; OCR
  payloads are grouped by `ocrFileKey`; replacement deletes only active
  assistant OCR rows for that key.
- The user's 5-second-gap clarification rules out a simple simultaneous
  same-process race. Fresh-process and same-client production smokes both
  succeeded, so the production failure is treated as a retryable provider /
  connection reset, not as a corrupt file or missing S3 URL.
- Fix: reset-class PaddleOCR preflight failures now disconnect any request-
  scoped PaddleOCR connection, disconnect the PaddleOCR app connection,
  reinitialize the MCP server with `forceNew: true`, reload the PaddleOCR tool,
  and retry that file once. Non-reset provider errors still produce the
  previous partial preflight behavior, and aborts still rethrow.
- Red-green evidence:
  - Before the parser fix, the new regression returned
    `parseStatus: skipped`.
  - After the fix, the same case saves `ocr_extract: 1` and preserves
    `ocrFileKey`, `fileId`, filename, and media type.
  - Before the retry fix, the new reset regression did not call PaddleOCR
    connection disconnect/reinitialize and returned partial.
  - After the retry fix, the same case disconnects `PaddleOCR`, calls
    `reinitMCPServer({ forceNew: true })`, reloads the tool, retries once, and
    saves the successful second result as `paddleocr_preflight`.
- Verification passed:
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "rebuilds and retries PaddleOCR"`
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR|preflight"`
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "captures OCR tables when file-key metadata"`
  - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "keeps OCR and workbook tables separated|keeps sequential OCR turns|captures OCR tables when file-key metadata"`
  - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npm run build`
  - `rtk git diff --check`

---

# Active: PaddleOCR failed preflight edit-resend retry bug - 2026-07-02

Goal: fix the Steel chat case where `b.jpg` PaddleOCR fails on the first try,
then editing and resending the message shows `PaddleOCR preflight skipped`
instead of rerunning PaddleOCR for `b.jpg`.

Status:

- [x] Read `CLAUDE.md`, RTK rules, relevant `tasks/lessons.md` OCR guidance,
      and the current dirty worktree before changing code.
- [x] Trace the two likely skip paths:
      `all_files_already_have_paddleocr` from active preflight memory, and
      `no_current_files` from edit/resend attachment propagation.
- [x] Confirm local Mongo is dev-only and cannot be used as proof of
      chat.longdin.org production conversation state.
- [x] Add a red regression proving fallback / assistant OCR state for `b.jpg`
      does not satisfy PaddleOCR preflight dedupe on edit/resend.
- [x] Implement the minimal root-cause fix so failed preflight results remain
      retryable on the next edit/resend.
- [x] Run focused ToolService/memory tests and `rtk git diff --check`.
- [x] Record review and verification evidence here.

Hypotheses:

1. If fallback / assistant OCR for `b.jpg` is treated as completed PaddleOCR,
   the next edit/resend sees the same `ocrFileKey` as completed and emits
   skipped.
2. If edit/resend drops old attachments before backend current-turn file
   collection, preflight skips with `no_current_files`; fixing memory state
   would not change that path.

Review - 2026-07-02:

- Red test reproduced the bug class: an active fallback/assistant OCR row with
  the same `ocrFileKey` could satisfy PaddleOCR preflight dedupe and return
  `completedKeys: ["file:file-b"]`, which leads to
  `all_files_already_have_paddleocr` and the UI row
  `PaddleOCR preflight skipped`.
- Root cause fix: `findMissingPaddleOcrFileKeys()` now only treats active
  `paddleocr_preflight` rows as completed when `sourceKind` is `ocr_result`
  and `payload.ocrSource` is `paddleocr_mcp`. Fallback / assistant-final rows
  no longer block PaddleOCR retry for the same file key.
- Verification passed:
  - Red regression failed before the fix, then passed after the fix:
    `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "does not treat fallback OCR rows as completed PaddleOCR preflight state"`.
  - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false`
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR|preflight"`
  - `cd packages/api && rtk npm run build`
  - `rtk git diff --check`

---

# Active: /simplify review from bf5b169bb8b3fea61d113c140 to HEAD

Goal: review all files changed from `bf5b169bb8b3fea61d113c140..HEAD` and
their directly related functional modules, then simplify clearly worthwhile
reuse, quality, or efficiency issues without changing public APIs.

Status - 2026-07-01:

- [x] Read repo instructions: `CLAUDE.md`, `tasks/lessons.md`, RTK rules, and
      the `/simplify` skill.
- [x] Confirm `bf5b169bb8b3fea61d113c140` is an ancestor of current `HEAD`.
- [x] Run three parallel `/simplify` review passes:
      code reuse, code quality, and efficiency.
- [x] Inspect the changed modules locally and consolidate only actionable,
      low-risk findings.
- [x] Apply minimal simplifications while preserving exported APIs, request /
      response shapes, event names, schema contracts, env keys, and UI props.
- [x] Run focused tests and checks for touched modules.
- [x] Add this task's review results and verification evidence below.

Scope notes:

- Review target: `bf5b169bb8b3fea61d113c140..HEAD`.
- Changed areas include agent streaming, MCP/tool initialization, Steel
  activity events and counts, Steel memory/native/runtime context, S3 storage
  URL handling, frontend Steel activity/timer UI, Steel data schemas/provider
  types, rule docs, and planning/lesson docs.
- Do not compare against or modify other branches.
- Do not run Prettier unless explicitly requested; prefer manual edits,
  focused tests, package builds where needed, and `rtk git diff --check`.

Review - 2026-07-02:

- Simplified Steel OCR preflight tool injection by reusing
  `getSteelOcrFileDescriptor()` from `@librechat/api`, so MCP injection and
  memory dedupe use the same OCR-capable file and `ocrFileKey` rules.
- Preserved PaddleOCR abort behavior: abort errors are rethrown instead of
  being reported as recoverable per-file OCR failures.
- Bounded same-turn `currentPaddleOcrResults` before putting PaddleOCR output
  into runtime context, while still saving the raw result to memory.
- Removed duplicate OCR payload grouping helper and changed grouping to append
  into existing buckets instead of repeatedly copying arrays.
- Parallelized Steel runtime context loading so output-sheet memory and rules
  load together, and reused the picked active output sheets inside the same
  context build.
- Kept S3 image preprocessing in `packages/api/src/storage/images.ts`; generic
  S3 CRUD now only preserves `ContentType` for streamed URL saves and does not
  duplicate Sharp JPEG conversion.
- Tightened frontend activity/timer behavior:
  - Steel activity dedupe keys include table/total count metadata.
  - Successful `parse_status: saved` rows such as `Steel form parsed` are
    hidden; the UI shows aggregate totals and actual save/preflight rows.
  - AI elapsed timer updates when the same message receives a corrected
    start timestamp.
- Intentionally skipped broader refactors that would expand the change surface:
  shared Steel event emitter extraction, moving event schemas into
  `packages/data-provider`, bounded concurrent PaddleOCR preflight execution,
  and DB aggregation rewrites for totals.
- Verification passed:
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts src/steel/runtime/context.spec.ts --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/storage/s3/__tests__/crud.test.ts --runInBand --watch=false --coverage=false -t "streams response bodies|multipart upload|ContentType|saveBufferToS3"`
  - `cd packages/api && rtk npm run build`
  - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/ui/__tests__/MessageElapsedTimer.test.tsx --runInBand --watch=false --coverage=false`
  - `cd client && rtk npm run typecheck`
  - `rtk git diff --check`

---

# Active: Steel second-turn OCR aggregate activity regression

Goal: explain and fix why a second image/PDF OCR turn shows
`This turn: OCR tables: 1` but no aggregate `Total: OCR tables: 2` in the
Steel activity UI.

Status - 2026-07-01:

- [x] Add a regression check for sequential `a.jpg` then `b.jpg` OCR Markdown
      saves in one conversation.
- [x] Trace which native stream path emits the screenshot activity rows and
      confirm whether total count metadata is attached.
- [x] Patch the missing event/count propagation path if the regression exposes
      one.
- [x] Run focused tests for memory totals, native events, SSE normalization,
      activity UI, and backend preflight.

Notes:

- `This turn: OCR raw results: 1` is expected per-turn wording for the current
  PaddleOCR preflight save. It is not supposed to mean aggregate total.
- A second turn should still include a `Total: ...` row when the backend event
  contains `totalSavedCounts` or `totalTableCounts`.
- Local sequential writer and AgentClient event tests already pass with
  aggregate totals; the Open Responses streaming path was missing same-turn
  final event delivery because it saved/captured after `res.end()`.

Review - 2026-07-01:

- The first-row `PaddleOCR preflight saved This turn: OCR raw results: 1` is a
  per-turn activity entry. In the second image/PDF turn it represents the new
  current-file preflight, not an aggregate count and not by itself evidence of
  a duplicate first-turn save.
- Added a sequential regression for `a.jpg` then `b.jpg`: after the second OCR
  Markdown save the writer reports `totalTableCounts.ocr_table = 2` and keeps
  active OCR rows under separate file keys.
- AgentClient already propagated aggregate metadata; its event test now asserts
  `savedTableCounts`, `totalSavedCounts`, and `totalTableCounts`.
- Fixed Open Responses streaming: final assistant response save/capture now
  happens before `finalizeStream()` / `res.end()`, and the resulting Steel
  event is emitted with source `responses_output` so the same UI turn can show
  the aggregate `Total` row.
- Added a responses unit regression that verifies the Steel event is sent
  before `res.end()`.
- Verification passed:
  - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts src/steel/native/events.spec.ts src/steel/native/markdown.spec.ts --runInBand --watch=false --coverage=false`
  - `cd api && rtk npx jest server/controllers/agents/__tests__/responses.unit.spec.js server/services/Endpoints/agents/initialize.spec.js server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false -t "Steel|preflights PaddleOCR|final Steel capture events|emits native Steel parse"`
  - `cd packages/data-provider && rtk npx jest src/steel/ai.spec.ts --runInBand --watch=false --coverage=false`
  - `cd client && rtk npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npm run build`
  - `cd packages/data-provider && rtk npm run build`
  - `cd client && rtk npm run typecheck`
  - `rtk git diff --check`

---

# Active: PaddleOCR preflight runtime params

Goal: make automatic Steel PaddleOCR preflight pass the document preprocessing
runtime options needed for engineering drawings, including orientation
classification.

Status - 2026-07-01:

- [x] Update automatic preflight `paddleocr_vl` args to include document
      orientation, unwarping, and layout-detection runtime params.
- [x] Update preflight tests so the visible Parameters include those runtime
      params.
- [x] Run focused ToolService tests and syntax/diff checks.

Notes:

- Current automatic preflight sends only `input_data`, `output_mode: "detailed"`,
  and `return_images: false`.
- Existing manual OCR smoke/spec paths already show the supported runtime param
  shape under `runtime_params`.

Review - 2026-07-01:

- Automatic Steel PaddleOCR preflight now sends:
  `runtime_params.use_doc_orientation_classify = true`,
  `runtime_params.use_doc_unwarping = true`, and
  `runtime_params.use_layout_detection = true`.
- It still keeps `return_images: false`; image return is heavy and not needed
  for the raw OCR save/status UI.
- The ToolService preflight test now asserts these runtime params appear in
  both the streamed Parameters JSON and the actual `paddleocr_vl` invocation.
- Verification passed:
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false -t "preflights PaddleOCR only"`

---

# Active: Steel activity aggregate OCR/workbook counts

Goal: make Steel chat activity labels distinguish per-turn saved counts from
conversation totals, and show OCR/workbook table counts with OCR file-key
grouping.

Status - 2026-07-01:

- [x] Add backend regression tests for file-keyed OCR markdown tables.
- [x] Add backend regression tests for file-keyed workbook/system tables.
- [x] Preserve the default merged system order for plain-text orders without an
      OCR file key.
- [x] Add stream event count metadata for per-turn and total OCR/workbook table
      counts.
- [x] Update Steel activity UI labels to show `This turn` and aggregate totals
      clearly.
- [x] Update OCR and output rules so AI keeps OCR/workbook tables grouped by
      OCR file key.
- [x] Run focused backend/frontend tests and `git diff --check`.

Design notes:

- `savedCounts` remains the low-level memory row count for the current event.
- New table count metadata should separate table counts from row counts:
  OCR tables, Workbook/system tables, and raw PaddleOCR results must not share
  one ambiguous `OCR: n` label.
- OCR Markdown rows are already keyed by `ocrFileKey`; workbook/system tables
  should also carry an OCR file key when derived from a specific OCR source.
- OCR-keyed workbook tables coexist by file key. A later system table for the
  same file key replaces only that file's previous system rows.
- System tables without OCR file keys represent plain-text/manual orders and
  merge into one default system order snapshot.

Review - 2026-07-01:

- OCR Markdown capture now reports `savedTableCounts` / `totalTableCounts`
  separately from memory row counts, so UI can distinguish OCR raw results, OCR
  tables, workbook tables, and workbook rows.
- `system_order` rows derived from OCR now carry the matched OCR file metadata
  when the source table matches exactly one current OCR-capable file.
- OCR-keyed `system_order` rows replace only the same `ocrFileKey`; rows without
  OCR file metadata replace the default plain-text/manual system order group.
- Native stream events carry per-turn and active-total count metadata through
  backend event builders, data-provider schemas, SSE normalization, and Recoil
  state.
- Steel activity UI now renders a single aggregate `Total: ...` row plus
  per-event `This turn: ...` labels.
- Rules updated:
  - `docs/rules/其他規則/OCR規則.txt` requires separate OCR Markdown tables per
    OCR file key / source file.
  - `docs/rules/輸出規則.txt` requires OCR-derived `system_order` tables to stay
    grouped by file key while pure text/manual orders merge into default
    `system_order`.
- Verification passed:
  - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts src/steel/native/events.spec.ts --runInBand --watch=false --coverage=false`
  - `cd packages/data-provider && rtk npx jest src/steel/ai.spec.ts --runInBand --watch=false --coverage=false`
  - `cd client && rtk npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --watch=false --coverage=false`
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false -t "preflights PaddleOCR only"`
  - `cd packages/api && rtk npm run build`
  - `cd packages/data-provider && rtk npm run build`
  - `cd client && rtk npm run typecheck`
  - `cd client && rtk git diff --check`

---

# Active: Production OCR raw-result merge check

Goal: verify whether production conversation
`8ae05b9e-8f0b-4bfd-95aa-e3d10bbee246` contains two PaddleOCR raw/preflight
results after two PDF OCR rounds, and determine whether the visible
`OCR: 1` activity count means per-turn save count or an incorrect overwrite.

Status - 2026-07-01:

- [x] Inspect production messages/files for both PDF upload turns.
- [x] Count active/superseded `paddleocr_preflight` and `ocr_extract` memory rows
      by `ocrFileKey`, `fileId`, `turnIndex`, and source.
- [x] Compare persisted raw PaddleOCR rows with visible Steel activity events.
- [x] Confirm no merge/overwrite fix is needed because both raw rows and both
      organized OCR rows remain active under separate file keys.

Review - 2026-07-01:

- Production conversation `8ae05b9e-8f0b-4bfd-95aa-e3d10bbee246` has two
  active raw PaddleOCR rows: `paddleocr_preflight:active = 2`.
- The same conversation has two active assistant-organized OCR rows:
  `ocr_extract:active = 2`.
- The first successful PDF OCR row is for `新增板零件製造圖.pdf`, file
  `5b0852bc-d748-4818-9700-c49981d831aa`, request
  `16489d34-6da9-4291-94c4-42c34a7f5fff`.
- The second successful PDF OCR row is for `d.pdf`, file
  `2e3d9903-9736-41a9-bbf1-87e5c8e0a093`, request
  `f648682b-5116-43d1-a2a2-2e8c38341ebb`.
- The visible `OCR: 1` activity label is a per-event saved count from the
  current assistant turn, not an aggregate count of all active OCR raw results
  in the conversation.

---

# Active: Steel OCR preflight activity indicator

Goal: surface automatic PaddleOCR preflight results in the existing Steel chat
activity UI so users can see OCR save/partial/skipped status without relying on
the AI to mention it.

Status - 2026-07-01:

- [x] Add failing backend tests for preflight event envelopes on completed,
      partial, and skipped PaddleOCR preflight results.
- [x] Emit preflight Steel activity events from both Responses and AgentClient
      paths after automatic PaddleOCR preflight finishes.
- [x] Emit MCP-style `on_run_step`, args delta, and completion events while
      automatic PaddleOCR preflight is running.
- [x] Keep PaddleOCR raw preflight data separate from
      `read_markdown(scope: "ocr")`, while passing same-turn raw results into
      Steel runtime context.
- [x] Allow the frontend Steel activity handler/store to accept
      `paddleocr_preflight` as a source.
- [x] Add frontend tests proving preflight events render `PaddleOCR: n`.
- [x] Fix duplicate preflight Parameters display by sending tool-call args only
      through the delta event.
- [x] Run targeted backend/frontend tests, package builds where needed, and
      `git diff --check`.

Review - 2026-07-01:

- Automatic PaddleOCR preflight now streams MCP-style tool-call events before
  the AI response: start, args delta, completion output, and error output are
  emitted with stable preflight tool call ids.
- Open Responses streaming initializes the SSE response before automatic
  PaddleOCR preflight, so preflight tool-call events are visible while OCR is
  running instead of being written before stream setup.
- Raw PaddleOCR preflight saves use `memoryKind: "paddleocr_preflight"` and
  `savedCounts.paddleocr_preflight`, so they do not enter
  `derivedIndex.ocrExtracts` or `read_markdown(scope: "ocr")`.
- Same-turn raw PaddleOCR results are passed through
  `attachments.currentPaddleOcrResults`; follow-up turns still recover
  organized OCR Markdown through `read_markdown(scope: "ocr")` when needed.
- Chat Steel activity accepts and renders `paddleocr_preflight` separately as
  `PaddleOCR: n`, while assistant-organized OCR Markdown remains `OCR: n`.
- The duplicated Parameters UI was not two PaddleOCR calls. The synthetic
  preflight start event and delta event both carried the same args, and the
  frontend concatenated them. The start event now carries empty args, matching
  normal streamed tool-call behavior, and the delta carries the JSON once.
- Manual UI smoke uses a text-bearing engineering drawing image
  `docs/reference/example/a.png`, not a decorative icon. The smoke conversation
  showed `Ran paddleocr_vl in PaddleOCR`, `PaddleOCR preflight saved
  PaddleOCR: 1`, and no adjacent duplicate parameter JSON.
- Verification passed:
  - `cd packages/data-schemas && rtk npx jest src/schema/steel.spec.ts --runInBand --watch=false --coverage=false --silent`
  - `cd packages/data-schemas && rtk npm run build`
  - `cd packages/api && rtk npx jest src/steel/native/events.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/runtime/context.spec.ts --runInBand --watch=false --coverage=false --silent`
  - `cd packages/api && rtk npm run build`
  - `cd client && rtk npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --watch=false --coverage=false --silent`
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --silent`
  - `cd api && rtk npx jest server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/client.test.js --runInBand --watch=false --coverage=false --silent`
  - `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false --silent`
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --silent` after the duplicate-args regression
  - Local UI smoke at `http://localhost:3090/c/3644c2df-b2ed-4058-b31b-8c54261132ee?endpoint=openai_oauth_responses&model=gpt-5.5`
    with `docs/reference/example/a.png`
  - `rtk git diff --check`

---

# Active: AI message flow timer

Goal: show whole-turn elapsed time on the AI message name row using the same
visual style and spacing as the existing message timestamp.

Status - 2026-07-01:

- [x] Add a shared AI message elapsed timer component using compact `s`/`m`
      formatting.
- [x] Render the timer on all AI message header paths, not inside individual
      tool-call rows.
- [x] Keep the timer UI-only for the current page session; do not add backend
      persistence or database schema changes.
- [x] Run focused frontend tests and `git diff --check`.

Design notes:

- The timer measures the whole visible assistant turn, including preflight OCR,
  tool calls, and final answer generation.
- The name row should read like `GPT-5.5 1m 05s`: timer text uses the same
  muted small-text style and `ml-2` spacing as the existing timestamp.
- Prefer the previous user message timestamp as the start time; fall back to the
  assistant row mount time when a parent timestamp is unavailable.

Review - 2026-07-01:

- Added shared `MessageElapsedTimer` with compact elapsed labels:
  `0s`, `12s`, `1m 05s`, `2m 30s`.
- Mounted the timer on all three AI name-row render paths:
  `MessageRender`, `ContentRender`, and `MessageParts`.
- Timer is UI-only for the current page session: it starts during the visible
  assistant turn, ticks while submitting, and freezes when the turn completes.
- The timer uses timestamp-like `ml-2 text-xs font-normal text-text-secondary`
  styling so it aligns with the existing `7 seconds ago` UI.
- Verification passed:
  - `cd client && rtk npx jest src/components/Chat/Messages/ui/__tests__/MessageElapsedTimer.test.tsx --runInBand --watch=false --coverage=false`
  - `cd client && rtk npm run typecheck`
  - `cd client && rtk npm run build`
  - `rtk git diff --check`

---

# Active: Steel OCR preflight file-key dedupe

Goal: make native Steel PDF/image turns deterministically run PaddleOCR once per
current attachment, while skipping files/images that already have active OCR
state in the same conversation.

Status - 2026-07-01:

- [x] Clarify that OCR dedupe must be per file/image, not per conversation turn.
- [x] Confirm current `ocr_extract` does not reliably persist `file_id` or
      storage identity, so filename-only lookup is not sufficient.
- [x] Design a stable `ocrFileKey` contract for multiple current attachments:
      `file_id` first, `storageKey` second, hash/filename fallback only when no
      stronger key exists.
- [x] Persist `ocrFileKey`, `fileId`, `storageKey`, `filename`, MIME/type, and
      page/image metadata with each `ocr_extract` payload or sourceRef.
- [x] Change OCR save/merge from conversation-wide replacement to per-file-key
      replacement: updating one `ocrFileKey` must supersede only that file's
      active OCR rows and must not delete or replace other active file OCR.
- [x] Add a preflight query that returns missing OCR file keys for all current
      OCR-capable attachments in one pass.
- [x] Enforce PaddleOCR for every missing current file/image before free-form AI
      answering; skip only keys already present in active `ocr_extract`.
- [x] Add tests for multi-file turns: all new files OCR, mixed already/new OCR
      only for missing keys, all already OCR no rerun, and explicit rerun
      overwrites only the rerun file key's current OCR state.

Review - 2026-07-01:

- Added `ocrFileKey` metadata for OCR-capable current files: `fileId` first,
  then `storageKey`, path, and filename fallback.
- `ocr_extract` now distinguishes `ocrSource: "paddleocr_mcp"` from
  `ocrSource: "assistant_ocr"`; assistant fallback OCR is saved for user
  review but does not satisfy PaddleOCR dedupe.
- PaddleOCR preflight runs before Steel runtime context construction in both
  Open Responses and AgentClient paths, so newly saved PaddleOCR OCR can be
  read into the same turn's runtime context.
- Multi-file preflight only runs missing file keys, skips keys with active
  PaddleOCR OCR, and captures failures without writing completed OCR state so
  the next turn retries PaddleOCR.
- OCR save/merge is key-scoped: rerunning or updating OCR for one file key does
  not delete other active file OCR.
- Updated and applied reviewed AI rules so "do not re-OCR" only applies when
  the same file key already has active PaddleOCR MCP OCR; AI OCR fallback still
  requires a PaddleOCR retry.

Design notes:

- The dedupe unit is each attachment key, not the whole message. A turn with
  `A.pdf`, `B.png`, and `C.jpg` should produce three OCR checks and only run
  PaddleOCR for the missing subset.
- The saved OCR result should be queryable by `{ conversationId, memoryKind:
  "ocr_extract", state: "active", payload.ocrFileKey: { $in: keys } }`.
- OCR merge/write must be key-scoped. If `A.pdf` and `B.png` are active and the
  user updates or reruns OCR for `A.pdf`, only rows with `payload.ocrFileKey`
  for `A.pdf` are superseded/replaced; `B.png` remains active unchanged.
- Existing OCR Markdown title-gating still applies to assistant table auto-save,
  but PaddleOCR preflight should persist file identity at the backend boundary
  because AI-generated titles/filenames are not stable enough for dedupe.

---

# Active: Production PaddleOCR tool error diagnosis

Goal: diagnose the production server error `Error calling tool 'paddleocr_vl'`
and determine whether it comes from LibreChat attachment resolution, MCP server
configuration, signed URL/file access, or the PaddleOCR AI Studio provider.

Status - 2026-07-01:

- [x] Start from the systematic debugging loop instead of guessing a fix.
- [x] Collect current production API logs around the failing PaddleOCR tool call.
- [x] Run or inspect a production PaddleOCR smoke path to distinguish provider
      health from request-specific attachment/input failures.
- [x] Trace the failing boundary and identify the root cause.
- [x] Apply the smallest fix if the root cause is local code/config, then verify.

Review - 2026-07-01:

- Production logs showed PaddleOCR MCP connected successfully, then LibreChat
  failed `getS3FileStream` with `NoSuchKey` for the percent-encoded key
  `...%E9%BE%8D...pdf`; PaddleOCR AI Studio then returned
  `文件 URL 无法识别`.
- Production HeadObject check proved the encoded key returned 404, while the
  decoded key for the same Chinese filename existed with size 283073 bytes.
- Root cause: production still had the old resolver that treated URL-encoded
  S3 keys and sandbox-style PaddleOCR paths incorrectly.
- Deployed `09069b6c6 fix: resolve PaddleOCR S3 attachment keys` to `master`.
- Deploy Production run `28513468643` completed successfully; public and
  container `/health` returned `OK`.
- New production image contains `decodeS3UrlKey` and `isInlinePaddleInput`.
- Post-deploy log scan found no new `paddleocr_vl`, `NoSuchKey`, or
  `文件 URL` errors after the deploy timestamp.
- User retried after deploy and still saw `Error calling tool 'paddleocr_vl'`.
- Direct production smoke against the same PDF proved PaddleOCR AI Studio accepts
  a private AWS S3 presigned URL for this file, including the tool's detailed
  output mode and runtime flags. The remaining boundary to debug is whether the
  native LibreChat tool execution path passes current-turn file metadata into
  `resolvePaddleOcrInputData()` so a model-provided filename is converted to the
  presigned S3 URL before MCP invocation.
- A focused resolver regression proved stripped event-run `requestBody` still
  works when `req.steelNativeContext.currentTurnFiles` is present.
- A second production smoke using the exact LibreChat `getS3DownloadURL()` URL
  shape failed with `文件 URL 无法识别`; the same file with a clean signed S3 URL
  generated by the same storage strategy succeeded. Root cause for the current
  retry is the PaddleOCR handoff URL carrying response header overrides
  (`customFilename`/`contentType`), not the S3 object, token, MCP server, or
  attachment filename matching.
- Deployed `b25bfe66d fix: use clean S3 URLs for PaddleOCR` to `master` via
  Deploy Production run `28515010246`; public and container health returned
  `OK`.
- Confirmed the running production container contains the new clean-url resolver
  log string.
- Post-deploy PaddleOCR smoke on the same PDF succeeded with the clean URL:
  detailed mode, runtime flags enabled, `textChars: 548`, elapsed 85717 ms.
- Post-deploy API log scan found no new `paddleocr_vl`, `文件 URL`,
  `NoSuchKey`, or MCP tool-call errors in the checked window.
- Verification passed:
  - Production clean URL smoke for
    `2fead7cd-d947-4092-917b-f474f5c6fbc2__115-06-30龍頂報價單回傳_台泥_.pdf`
  - `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/storage/s3/__tests__/crud.test.ts --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npm run build`
  - `rtk git diff --check -- api/server/services/MCP.js api/server/services/MCP.spec.js packages/api/src/storage/s3/crud.ts packages/api/src/storage/s3/__tests__/crud.test.ts`

---

# Active: Steel quote saved source counts

Goal: update the native Chat UI Steel saved-state marker so saved Steel state
shows whether it came from OCR or workbook-style quote data.

Status - 2026-07-01:

- [x] Inspect current Steel activity event payload and chat UI rendering.
- [x] Confirm display format with user: `OCR: 1` / `Workbook: 2`.
- [x] Implement source-count formatting from existing `savedCounts`.
- [x] Add focused component coverage for OCR, workbook, and mixed counts.
- [x] Run focused verification and record evidence.

Review - 2026-07-01:

- Chat Steel activity now groups saved count keys into user-visible source
  labels: `ocr_extract` renders as `OCR`, while workbook/quote-state keys render
  as `Workbook`.
- Mixed saved counts render in one compact suffix, e.g.
  `OCR: 1, Workbook: 2`.
- Verification passed:
  - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --watch=false --coverage=false`
  - `rtk git diff --check`
- Production update:
  - Committed `4b0bd323d feat: show Steel saved source counts` to `master`.
  - Pushed `master` to `origin`; Deploy Production run `28512642891` completed
    successfully.
  - `https://chat.longdin.org/health` returned `OK` after deploy.
- Correction:
  - User clarified the backend save contract was wrong: OCR review turns may
    include extra confirmation tables, but those tables are not workbook state.
  - Added a red regression test where `OCR 結果確認表` plus confirmation helper
    tables previously returned `ocr_extract: 1`, `calculation_fact: 3`, and
    `working_order_row: 0`.
  - Updated auto-save classification so unclassified confirmation tables are
    skipped, `項目` alone no longer makes a table a calculation/workbook table,
    and `savedCounts` only returns positive saved kinds.
  - User refined the contract again: assistant Markdown auto-save must be
    title-gated. Only OCR-like tables with nearby title containing `OCR`/`ocr`
    save as `ocr_extract`; only system-order-like tables with nearby title
    containing `system` save as workbook state. Customer/calculation Markdown
    tables without those titles are skipped.
  - Focused verification passed:
    - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false`
    - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --watch=false --coverage=false`
    - `cd packages/api && rtk npx jest src/steel/native/events.spec.ts src/steel/native/markdown.spec.ts --runInBand --watch=false --coverage=false`
    - `cd packages/api && rtk npm run build`

---

# Active: PaddleOCR MCP tool failure fallback

Goal: diagnose the current LibreChat server response where `paddleocr_vl`
returns `Error calling tool 'paddleocr_vl'` for `新增板零件製造圖.pdf`, then make
the runtime handle true PaddleOCR provider/tool failures without regressing the
existing filename/file_id attachment resolver.

Status - 2026-07-01:

- [x] Review existing OCR lessons, current MCP resolver code, and prior
      `paddleocr_vl` corrections.
- [x] Distinguish backend attachment-resolution failures from real
      PaddleOCR/AI Studio execution failures.
- [x] Add a focused regression test for the failure path that currently
      leaves the assistant with only a generic tool error.
- [x] Implement the smallest backend or rule change that makes the failure
      path actionable while preserving direct PaddleOCR MCP as the primary OCR
      path.
- [x] Run focused verification and record evidence.

Review - 2026-07-01:

- Production health was OK, and server logs confirmed the failing turn did call
  `paddleocr_vl`.
- The uploaded `新增板零件製造圖.pdf` file record was S3-backed:
  `source: "s3"`, valid `storageKey`, and server-side S3 `HeadObject` returned
  the expected object size.
- Root cause was not that the edited-message PDF failed to become S3 storage.
  The model retried PaddleOCR with provider sandbox-style
  `input_data: "/mnt/data/新增板零件製造圖.pdf"`, and the backend resolver treated
  any absolute path as already MCP-readable instead of matching it back to the
  current LibreChat attachment.
- Added a regression test proving `/mnt/data/drawing.pdf` resolves through the
  current request's owned S3 file record and signs a storage download URL before
  calling PaddleOCR.
- Updated PaddleOCR `input_data` normalization so only data URLs and raw base64
  skip attachment matching. Filename, file id, absolute path, and URL-shaped
  inputs now get a chance to match current request attachments first.
- User clarified the AWS Console object URL showed a percent-encoded Chinese
  key. Server `HeadObject` proved the actual object key uses the decoded
  filename; the console URL encoding is normal. A separate `NoSuchKey` risk was
  that `extractKeyFromS3Url()` did not decode URL-derived paths before
  `GetObject`.
- Updated S3 URL key extraction to decode URL paths once while leaving
  already-stored `storageKey` values unchanged.
- Verification passed:
  - Red test first failed because `getDownloadURL()` was never called for
    `/mnt/data/drawing.pdf`.
  - `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false --testNamePattern "sandbox-style absolute paths"` passed.
  - `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false` passed, 62 tests.
  - Red S3 extraction tests first failed because `%20` and `%E6...` stayed
    encoded.
  - `cd packages/api && rtk npx jest src/storage/s3/__tests__/crud.test.ts --runInBand --watch=false --coverage=false --testNamePattern "encoded characters|unicode object keys"` passed.
  - `cd packages/api && rtk npx jest src/storage/s3/__tests__/crud.test.ts --runInBand --watch=false --coverage=false` passed, 108 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
- This fix is local only until committed/deployed; production still has the old
  resolver until the next deploy.

Local auto-tool investigation - 2026-07-01:

- Local `steel.rules` has both relevant reviewed rules loaded:
  `steel-default-agent-instruction` mentions `paddleocr_vl`, and
  `steel-drawing-ocr-policy` is active/reviewed with
  `rule_sections: file_ocr,drawing_ocr,vision_evidence` plus
  `tool_policy.requiredMcpTool: "paddleocr_vl"`.
- Code path confirms OCR rules are included in `Steel Other Rules` through
  `listReviewedSteelOtherRules()` and `buildSteelNativeInstructionPrefix()`.
- Latest local run for conversation
  `302ea078-4c90-4048-a7e1-b6483b69c8e7` successfully connected the
  `PaddleOCR` MCP server, ran `tools/list`, and cached 1 MCP tool before the
  LLM call.
- The same run stored 4 tool definitions for
  `openai_oauth_responses__gpt-5.5`, but OpenAI OAuth tool binding sends
  provider tools with `toolChoice: { type: "auto" }`; there is no hard runtime
  gate that forces the first call to PaddleOCR when a current-turn PDF/image
  exists.
- Mongo message inspection showed the latest assistant message
  `91fbbe97-be43-455a-8935-1ee89322f387` has only a text content part and no
  `tool_call`; the older attempt in the same conversation had a tool call, but
  it was `read_markdown`, not PaddleOCR.
- Therefore the missing PaddleOCR UI indicator is expected for that final
  response: the frontend only has a tool-call indicator to render when the
  saved assistant content contains a tool call. Availability of the MCP server
  alone does not create a visible indicator.

---

# Active: Baidu BOS PaddleOCR storage research

Goal: research whether moving LibreChat uploads/OCR handoff from AWS S3 to
Baidu BOS can reduce PaddleOCR AI Studio `fileUrl` network instability, and
produce an implementation/verification recommendation without changing runtime.

Status - 2026-07-01:

- [x] Review current S3-backed PaddleOCR handoff and prior failure evidence.
- [x] Check Baidu BOS API/S3-compatibility, signed URL, endpoint, and network
      behavior relevant to PaddleOCR AI Studio.
- [x] Compare migration options: full storage switch, OCR-only mirror, or
      fallback/proxy path.
- [x] Record risks, required code/config changes, and a concrete verification
      plan.

Review - 2026-07-01:

- Added
  `docs/plans/2026-07-01-baidu-bos-paddleocr-storage-research.md`.
- Baidu BOS is technically plausible because its official docs describe AWS S3
  compatibility, Signature V4, AWS SDK for JavaScript v3 examples, and
  presigned download URLs.
- Do not switch production `fileStrategy` directly yet. Existing Mongo file
  records only identify `source: s3` plus `storageKey`; repointing the global S3
  env to BOS before copying existing AWS objects with identical keys can break
  old file access.
- Recommended next step is a no-runtime-change live A/B smoke: upload the same
  smoke files to a private BOS bucket from the production API container, verify
  signed GET/range GET, then run PaddleOCR smoke with the BOS signed URL and
  compare against AWS S3 Hong Kong.
- If BOS proves better, implement OCR-only BOS mirror for PaddleOCR first,
  keeping canonical LibreChat uploads on current S3 and adding lifecycle cleanup
  for temporary BOS OCR objects.

---

# Active: PaddleOCR uvx production deploy

Goal: commit the PaddleOCR uvx/runtime cleanup on `master`, push to trigger the
production workflow, update production `/data/librechat.yaml`, then run a fresh
S3 PaddleOCR live smoke.

Status - 2026-07-01:

- [x] Confirm current branch is `master`.
- [x] Confirm production workflow deploys on `master` push and uploads host
      scripts, while `/data/librechat.yaml` must be updated separately.
- [x] Stage the final task-log delta and commit current master changes.
- [ ] Push `master` to `origin` and watch the production workflow.
- [ ] Update production `/data/librechat.yaml` with the committed uvx config.
- [ ] Verify production public/container health after deploy.
- [ ] Generate a fresh S3 smoke PDF URL from the production API container.
- [ ] Run production PaddleOCR smoke using the fresh S3 URL and record result.

---

# Active: PaddleOCR uvx API-runtime design

Goal: simplify PaddleOCR MCP runtime so local `npm run backend` and production
API use the same LibreChat MCP config, fixed to AI Studio, without a persistent
PaddleOCR venv or `PADDLEOCR_UV_PYTHON_INSTALL_DIR` surface.

Status - 2026-07-01:

- [x] Verify current production uses `PADDLEOCR_MCP_PPOCR_SOURCE=aistudio` and
      that the successful smoke did not require local `paddlepaddle`.
- [x] Verify API image already includes `uv`/`uvx` and Python is obtained
      through `uv`.
- [x] Identify current persistent-venv surfaces:
      `deploy/host/start.sh`, `librechat.yaml`, env examples, runbooks, and the
      old persistent-venv plan.
- [x] Confirm design direction with the user before implementation.
- [x] If approved, update tests first for local/production `uvx` MCP config and
      removal of `PADDLEOCR_UV_PYTHON_INSTALL_DIR`.
- [x] Implement the minimal runtime/config/doc cleanup.
- [x] Verify local `npm run backend` can expose PaddleOCR MCP when token/env are
      configured.

Review - 2026-07-01:

- Switched `librechat.yaml` PaddleOCR MCP from the production-only
  host-prepared command to `uvx --python 3.12 --from paddleocr-mcp
  paddleocr_mcp`.
- Kept `PADDLEOCR_MCP_PPOCR_SOURCE: aistudio` hardcoded in MCP env maps and
  left the AI Studio access token as the only PaddleOCR secret placeholder in
  `.env.example` / `.env.prod.example`.
- Removed PaddleOCR install/prewarm/reinstall logic from `deploy/host/start.sh`;
  API startup now just prepares LibreChat data paths and starts
  `node server/index.js`.
- Updated `deploy/host/paddleocr-smoke.sh` to continue reading command, args,
  env, token interpolation, and timeout from `CONFIG_PATH` /
  `/data/librechat.yaml`, so smoke matches the same MCP server config LibreChat
  uses.
- Updated deployment runbooks, PaddleOCR runtime plan, and lessons to describe
  the `uvx` API-runtime contract instead of a host-prepared PaddleOCR Python
  environment.
- Verification passed: static PaddleOCR uvx contract, `sh -n` for start/smoke
  scripts, `.mcp.json` parse, `librechat.yaml` parse, smoke no-arg skip,
  smoke local-path rejection, `git diff --check`, focused
  `initializeMCPs.spec.js`, `uvx --version`, direct MCP list-tools via
  `uvx` returning `paddleocr_vl`, and controlled `npm run backend` startup
  showing PaddleOCR registered with readiness checks passing.

---

# Active: Server PaddleOCR MCP smoke verification

Goal: verify whether the production server's PaddleOCR MCP path can run from
the API container using a fresh S3 smoke PDF URL.

Status - 2026-07-01:

- [x] Confirm SSH access, production container state, and `/health`.
- [x] Generate a fresh S3 smoke PDF signed URL from inside the API container.
- [x] Confirm the deployed `deploy/host/paddleocr-smoke.sh` is stale and still
      rejects S3 URLs as missing local files.
- [x] Run a one-off direct PaddleOCR MCP URL smoke inside the API container.
- [x] Diagnose why `paddleocr_vl` initially failed during direct smoke: the
      test transport did not hardcode `PADDLEOCR_MCP_PPOCR_SOURCE=aistudio`,
      so `paddleocr-mcp` defaulted to local inference.
- [x] Correct local MCP/smoke config to hardcode
      `PADDLEOCR_MCP_PPOCR_SOURCE: "aistudio"` in env maps, not CLI args.
- [x] Sync the updated smoke script to the server and run official S3 URL
      PaddleOCR smoke.
- [x] Record the result, failure point, and next action.

Review - 2026-07-01:

- Server SSH, public `/health`, and container-local `/health` returned OK.
- The first official smoke attempt proved S3 upload and signed GET worked, but
  failed before MCP because the deployed smoke script was stale and still
  treated the fresh S3 URL as a local file path.
- Direct MCP smoke initially reproduced the real provider failure: without
  hardcoded `PADDLEOCR_MCP_PPOCR_SOURCE=aistudio`, `paddleocr-mcp 0.8.5`
  defaulted to local inference, and local PaddleOCRVL pipeline creation failed
  because the production venv does not install local `paddlepaddle`.
- Direct MCP smoke with the hardcoded AI Studio env succeeded from the API
  container using the fresh S3 URL.
- Corrected local MCP/smoke config so the provider is hardcoded in MCP env
  maps as `PADDLEOCR_MCP_PPOCR_SOURCE: "aistudio"`, not as CLI args and not as
  user-facing `.env` config.
- Installed the updated smoke script on the server after backing up the old
  one to
  `/srv/librechat/app/deploy/host/paddleocr-smoke.sh.bak.20260701072750`.
- Official server smoke passed: fresh S3 smoke PDF upload succeeded, signed GET
  returned `206`, `paddleocr_vl` ran through
  `/data/paddleocr/venv/bin/paddleocr_mcp`, provider was `aistudio`, elapsed
  time was `15523` ms, and OCR returned 44 text chars with the expected smoke
  marker preview.
- Follow-up correction: smoke must read PaddleOCR MCP command/args/env/token
  settings from `CONFIG_PATH` / `/data/librechat.yaml`, not duplicate those
  settings in `deploy/host/paddleocr-smoke.sh`.

---

# Active: SSH and tmux operations doc

Goal: document how SSH keepalive and tmux should be used for production
Droplet maintenance.

Status - 2026-06-30:

- [x] Check for existing SSH/tmux deployment docs.
- [x] Create `docs/deployment/ssh-tmux-operations.zh-TW.md`.
- [x] Document the difference between SSH keepalive, tmux sessions, and Docker
      Compose detached services.
- [x] Add copyable commands for `~/.ssh/config`, tmux install/check, session
      attach/detach, logs, API restart, and health checks.
- [x] Link the SSH/tmux guide from the Traditional Chinese DigitalOcean runbook.
- [x] Run documentation/static checks.
- [x] Record review results here.

Review - 2026-06-30:

- Added `docs/deployment/ssh-tmux-operations.zh-TW.md`.
- Documented SSH keepalive as connection maintenance, tmux as remote session
  preservation, and Docker Compose detached mode as the service owner.
- Included copyable commands for Mac SSH config, checking/installing tmux on
  the Droplet, creating/attaching/detaching sessions, reading logs, restarting
  API, and health checks.
- Linked the guide from the Traditional Chinese DigitalOcean production
  runbook.
- Verification passed:
  - `rtk git diff --check`
  - code fence parity check for the SSH/tmux guide and Traditional Chinese
    DigitalOcean runbook
  - key-section scan for keepalive, tmux, detached Docker Compose, and
    PaddleOCR smoke references
  - `rtk sh -n deploy/host/start.sh && rtk sh -n deploy/host/paddleocr-smoke.sh`

---

# Active: Traditional Chinese DigitalOcean runbook

Goal: add a Traditional Chinese version of the DigitalOcean production runbook
without replacing the English source document.

Status - 2026-06-30:

- [x] Read the current English DigitalOcean Droplet production runbook,
      including post-deploy verification and PaddleOCR reinstall/reset sections.
- [x] Create `docs/deployment/digitalocean-droplet-prod-runbook.zh-TW.md`.
- [x] Preserve copyable terminal commands, config snippets, and the S3 smoke PDF
      PaddleOCR live smoke flow in the Traditional Chinese version.
- [x] Add a cross-reference from the English runbook to the Traditional Chinese
      version.
- [x] Run documentation/static checks.
- [x] Record review results here.

Review - 2026-06-30:

- Added `docs/deployment/digitalocean-droplet-prod-runbook.zh-TW.md` as an
  independent Traditional Chinese production runbook.
- Preserved the operational command blocks for host setup, S3 config,
  PaddleOCR reinstall/reset, post-deploy health checks, S3 smoke PDF generation,
  and PaddleOCR live smoke.
- Added a cross-reference from the English runbook to the Traditional Chinese
  version.
- Verification passed:
  - `rtk git diff --check`
  - code fence parity check for both English and Traditional Chinese runbooks
  - key-section scan for reset, post-deploy verification, auto deploy, backups,
    and PaddleOCR smoke commands
  - Node syntax check for the Traditional Chinese runbook's S3 smoke PDF
    generation snippet
  - `rtk sh -n deploy/host/start.sh && rtk sh -n deploy/host/paddleocr-smoke.sh`

---

# Active: Document PaddleOCR reinstall reset

Goal: document how to trigger PaddleOCR MCP reinstall/reset on the production
server and which settings must be restored afterwards.

Status - 2026-06-30:

- [x] Confirm `PADDLEOCR_FORCE_REINSTALL=true` is read by `deploy/host/start.sh`
      during API container startup.
- [x] Add a production runbook section with copyable terminal commands for
      enabling reinstall, restarting API, checking logs, restoring
      `PADDLEOCR_FORCE_REINSTALL=false`, and verifying health/OCR.
- [x] Run documentation/static checks.
- [x] Record review results here.

Review - 2026-06-30:

- Added `PaddleOCR MCP Reinstall Reset` to the production runbook.
- Documented `PADDLEOCR_FORCE_REINSTALL=true` as a one-time maintenance switch
  that only runs during API container startup.
- Added copyable commands to back up `/etc/librechat/.env.prod`, turn force
  reinstall on, restart API, inspect PaddleOCR install logs, confirm health,
  restore `PADDLEOCR_FORCE_REINSTALL=false`, and restart API again.
- Documented the required follow-up: run normal post-deploy verification with
  a fresh S3 smoke PDF URL.
- Verification passed:
  - shell parser check for the documented SSH commands
  - `rtk git diff --check`
  - `rtk sh -n deploy/host/start.sh && rtk sh -n deploy/host/paddleocr-smoke.sh`

---

# Active: Admin Steel Rules UI design doc

Goal: document an Admin-managed Steel rules UI that lets admins edit reviewed
Steel rule content and ordering without changing code or hand-editing
`docs/rules`.

Status - 2026-06-30:

- [x] Read project instructions, current Steel lessons, and the native Steel
      master framework.
- [x] Verify the current `steel.rules` schema, rule repository ordering, native
      context loading, and existing Admin Steel route boundary.
- [x] Write the design doc under `docs/plans`.
- [x] Run markdown/static checks.
- [x] Record review results here.

Review - 2026-06-30:

- Created `docs/plans/2026-06-30-admin-steel-rules-ui-design.md` as a
  design-only plan for an Admin-managed Steel Rules UI.
- Proposed `steel.rules` as the operational source of truth, with `docs/rules`
  kept for bootstrap/export/audit rather than runtime reads.
- Covered backend Admin API, UI layout, draft/review/publish workflow, runtime
  prefix preview, permissions, import/export, implementation slices, and
  verification.
- No implementation or Supabase schema changes were made.
- Verification passed:
  - `test -f docs/plans/2026-06-30-admin-steel-rules-ui-design.md && wc -l docs/plans/2026-06-30-admin-steel-rules-ui-design.md`
  - boundary keyword scan for unresolved markers and Steel rule-source terms
  - `git diff --check -- docs/plans/2026-06-30-admin-steel-rules-ui-design.md tasks/todo.md`

---

# Active: Document post-deploy manual verification

Goal: document the manual post-deploy verification flow with copyable terminal
commands for GitHub Actions, `/health`, S3 smoke PDF URL generation, and
PaddleOCR live smoke.

Status - 2026-06-30:

- [x] Confirm production deploy is triggered by `master` push through
      `.github/workflows/deploy-prod.yml`.
- [x] Update the production runbook with copyable terminal commands for Actions
      and health checks.
- [x] Add a copyable remote command that creates a tiny PDF in the API
      container, uploads it to production S3, validates the signed URL, and
      passes that URL to PaddleOCR smoke.
- [x] Run documentation/static checks.
- [x] Record review results here.

Review - 2026-06-30:

- Added `Post-Deploy Manual Verification` to the DigitalOcean production
  runbook.
- Documented copyable terminal commands for:
  - watching the latest `Deploy Production` GitHub Actions run
  - checking public and container-local `/health`
  - creating a tiny smoke PDF inside the production API container
  - uploading that PDF with the container's production S3 config
  - validating the presigned S3 URL with signed GET
  - passing the fresh S3 smoke PDF URL to `paddleocr-smoke.sh`
- Kept PaddleOCR live smoke manual and separate from the deploy gate.
- Verification passed:
  - `rtk git diff --check`
  - `rtk sh -n deploy/host/start.sh && rtk sh -n deploy/host/paddleocr-smoke.sh`
  - Node syntax check for the runbook's S3 smoke PDF generation snippet

---

# Active: Remove PaddleOCR startup gate

Goal: delete the strict PaddleOCR prewarm env surface and remove the PaddleOCR
startup check as an API boot gate, without committing.

Status - 2026-06-30:

- [x] Read project instructions, current OCR lessons, and relevant memory.
- [x] Locate the strict prewarm env in local env files, env examples, docs, and
      `deploy/host/start.sh`.
- [x] Verify the current startup gate fails before `node` when PaddleOCR prep
      cannot run.
- [x] Remove the strict env surface and startup smoke gate.
- [x] Update deployment docs/task review text so they no longer recommend the
      removed env.
- [x] Run syntax/static checks and the focused startup behavior check.
- [x] Record review results here.

Review - 2026-06-30:

- Removed the strict PaddleOCR prewarm env from ignored local env files, env
  examples, deployment docs, and current task/lesson guidance.
- Removed the `deploy/host/start.sh` startup MCP smoke check and strict
  fail/warn gate.
- Kept startup preparation enabled, but changed PaddleOCR prep failures such as
  missing `uv`, directory setup failure, install failure, import failure, or
  missing MCP binary into warnings that return successfully before API boot.
- Verification passed:
  - `rtk sh -n deploy/host/start.sh`
  - strict prewarm env and startup smoke gate symbol search returned no matches
  - ignored `.env*` strict prewarm env search returned no matches
  - `rtk git diff --check`
  - temp-copy startup check with no `uv` printed the PaddleOCR warning and
    reached the fake `node`
  - temp-copy startup check with failing fake `uv` warned on venv creation and
    reached the fake `node`
- Deployment follow-up rule: use `/health` only to confirm the site starts,
  then pass the freshly obtained S3 smoke PDF URL to PaddleOCR smoke so it
  verifies both S3 URL readability and PaddleOCR `fileUrl` OCR.

---

# Active: S3 URL only PaddleOCR smoke

Goal: make the manual live PaddleOCR smoke run only when the caller passes a
fresh S3 smoke PDF URL, and keep the live PDF smoke small.

Status - 2026-06-30:

- [x] Confirm current smoke script still requires a local input path.
- [x] Update `deploy/host/paddleocr-smoke.sh` to skip live OCR when no S3 smoke
      PDF URL argument is passed.
- [x] Make the smoke call URL-only so local paths are not used as the
      production live smoke input.
- [x] Update deployment docs and lessons for S3 URL only live smoke.
- [x] Run shell syntax, targeted smoke skip/fail behavior checks, and
      `git diff --check`.
- [x] Record review results here.

Review - 2026-06-30:

- `deploy/host/paddleocr-smoke.sh` no longer reads a persistent S3 URL env.
  It accepts the freshly obtained S3 smoke PDF URL as the first argument.
- When no URL argument is passed, the script skips live OCR and exits
  successfully.
- Local paths are rejected before MCP/token checks, so production live smoke
  cannot accidentally use `/data/smoke/...` as input.
- The live smoke defaults are lightweight for concise PDF content:
  `output_mode=markdown`, `max_new_tokens=2048`, minimum text length 10, and
  orientation/unwarping/layout extras disabled unless explicitly enabled.
- The S3 PDF URL smoke verifies both sides of the production path: S3 URL
  readability and PaddleOCR `fileUrl` OCR.
- Verification passed:
  - `rtk sh -n deploy/host/paddleocr-smoke.sh`
  - no-argument smoke skips with exit 0
  - local path argument fails before MCP/token checks
  - URL argument reaches the AI Studio token prerequisite instead of local file
    lookup
  - rejected S3 URL env/fallback wording search returned no matches

---

# Active: Merge and deploy S3 upload changes

Goal: commit the completed S3 image compression and S3 namespace work, merge it
to `master`, push production, and verify the server update.

Status - 2026-06-30:

- [x] Confirm current branch is `feat/v8.4` and `master` is an ancestor.
- [x] Confirm production deploy is triggered by pushes to `master` through
      `.github/workflows/deploy-prod.yml`.
- [x] Run fresh focused verification before committing.
- [x] Commit tracked changes without adding ignored `.env` or `librechat.yaml`.
- [x] Merge the feature branch into `master` and push `master`.
- [x] Verify GitHub Actions production deploy completes.
- [x] Confirm private server runtime config uses `/etc/librechat/.env.prod`
      with `S3_KEY_PREFIX=prod` and `/data/librechat.yaml` with S3 storage.

Review - 2026-06-30:

- Committed S3 image compression and S3 key namespace changes as
  `d697272b0 feat: preprocess S3 uploads and namespace keys`.
- Fast-forward merged `feat/v8.4` into `master` and pushed `master`.
- Production deploy run `28422127369` initially failed health because
  `/etc/librechat/.env.prod` lacked `S3_KEY_PREFIX=prod` and strict PaddleOCR
  startup smoke blocked API boot on an AI Studio dependency failure.
- Installed the ignored local `.env.prod` to the private server env path,
  confirmed `S3_KEY_PREFIX=prod`, then removed the PaddleOCR startup gate so
  PaddleOCR preparation issues warn without blocking LibreChat API rollout.
- Reran production deploy run `28422127369`; the rerun passed image build,
  Droplet deploy, container health, and public `https://chat.longdin.org/health`
  smoke.
- Server readback confirmed `BUILD_COMMIT=d697272b0...`, `BUILD_BRANCH=master`,
  `fileStrategy: "s3"`, `S3_KEY_PREFIX=prod`, and public health `200 OK`.

---

# Active: S3 environment namespace and dev storage design

Goal: allow dev/test and production uploads to share S3 safely without mixing
objects, while keeping existing S3 key validation and object ownership checks.

Status - 2026-06-30:

- [x] Confirm current S3 key generation uses `getS3Key()` in
      `packages/api/src/storage/s3/crud.ts`.
- [x] Confirm `basePath` is intentionally validated as a single path segment by
      `assertPathSegment()`, so values like `uploads/dev` are currently rejected.
- [x] Confirm existing keys are organized by semantic base path first, such as
      `uploads/<user>/<file>`, `images/<user>/<file>`, and optional
      `r/<region>/t/<tenant>/...` prefixes.
- [x] Confirm desired environment namespace shape before implementation.
- [x] After approval, write tests for new namespaced S3 keys, parse/delete/read
      compatibility, and dev/prod env examples.
- [x] Implement namespace support without weakening slash/path traversal
      validation.
- [x] Document local/dev S3 setup and verification commands.

Recommended design:

- Add a new env/config field such as `S3_KEY_PREFIX=dev` or
  `S3_KEY_PREFIX=prod`.
- Apply it as a validated namespace before existing storage paths, producing
  `dev/uploads/<user>/<file>` and `prod/uploads/<user>/<file>`.
- Keep `basePath` as `uploads`, `images`, or `avatars`; do not allow
  `uploads/dev` directly.
- Configure dev/test with the same S3 bucket and credentials if desired, but
  use `S3_KEY_PREFIX=dev` so test objects never collide with production
  objects.
- Production should use `S3_KEY_PREFIX=prod` if dev shares the same bucket, or
  omit the prefix only if the bucket is production-only.

Decision:

- Use `dev/uploads/...` / `prod/uploads/...`.
- Configure root `librechat.yaml` with `fileStrategy: "s3"` for local/dev S3
  storage.

Review - 2026-06-30:

- Added `S3_KEY_PREFIX` as a validated single-segment namespace before existing
  S3 keys, so `S3_KEY_PREFIX=dev` produces `dev/uploads/...`,
  `dev/images/...`, and `dev/avatars/...`.
- Kept `basePath` validation strict; slash-based values such as `uploads/dev`
  still fail instead of becoming path traversal surfaces.
- Updated S3 key parsing, upload metadata, delete owner checks, direct download
  signing, and refresh logic for environment-prefixed keys.
- Kept refresh signing on the original stored key after validation, so legacy
  unprefixed S3 objects are not accidentally re-signed as `dev/...` after a
  prefix is configured.
- Updated local/dev and production docs/env examples for `S3_KEY_PREFIX=dev`
  and `S3_KEY_PREFIX=prod`; the ignored local `librechat.yaml` now uses
  `fileStrategy: "s3"`, and the private server must use `.env.prod` installed
  as `/etc/librechat/.env.prod`.
- Verification passed:
  - `cd packages/api && rtk npx jest src/storage/s3/__tests__/crud.test.ts --runInBand --coverage=false`
  - `cd packages/api && rtk npx jest src/storage/__tests__/images.test.ts src/storage/s3/__tests__/crud.test.ts --runInBand --coverage=false`
  - `cd api && rtk npx jest server/services/Files/process.spec.js --runInBand`
  - `rtk npm run build:api`
  - `rtk git diff --check`

---

# Active: S3 image JPEG 4K preprocessing

Goal: before S3-backed image uploads are persisted, convert images to JPG and
downscale only when either dimension exceeds the agreed 4K cap; keep PDFs and
other documents byte-for-byte on the existing file upload path.

Status - 2026-06-30:

- [x] Read `CLAUDE.md`, `tasks/lessons.md`, and relevant memory before
      changing behavior.
- [x] Locate the current upload split:
      `api/server/services/Files/process.js` routes images through
      `processImageFile()` / `handleImageUpload()`, while PDFs and regular
      files use `processFileUpload()` / `handleFileUpload()`.
- [x] Locate the S3 image implementation:
      `api/server/services/Files/strategies.js` maps S3 images to
      `ImageService.uploadImage()` in `packages/api/src/storage/images.ts`.
- [x] Confirm `sharp` is already available in `api` and `packages/api`; no new
      image processing dependency is needed.
- [x] Confirm the exact 4K cap semantics before implementation.
- [x] After approval, write tests for JPG conversion, no-upscale behavior,
      aspect-ratio preservation, and PDF pass-through.
- [x] Implement the smallest backend change in the S3-backed image upload path.
- [x] Run focused image/storage tests, `git diff --check`, and any affected
      build/type checks.

Recommended design:

- Keep PDF handling in the existing `handleFileUpload()` path so PDF bytes,
  filename, MIME type, and storage metadata remain unchanged.
- Process only uploaded images before the storage `saveBuffer()` call.
- Use `sharp(input).rotate().resize({ width: 4096, height: 4096, fit: "inside",
  withoutEnlargement: true }).jpeg({ quality: 82-85 })` style behavior.
- Preserve aspect ratio through `fit: "inside"`.
- Preserve resolution for images already under the cap through
  `withoutEnlargement: true`.
- Store the resulting object with `.jpg` extension and `image/jpeg` metadata in
  the LibreChat file record.

Design caveat:

- `ImageService.uploadImage()` currently follows `appConfig.imageOutputType`
  and the existing `high` resolution path can downscale images far below 4K.
  The implementation should avoid accidentally reusing that old `high`
  behavior for this S3 compression policy.

Review - 2026-06-30:

- Implemented S3/CloudFront image uploads through `sharp` JPEG output with
  max dimensions `4096x4096`, `fit: "inside"`, and `withoutEnlargement: true`.
- Added a JPEG quality loop from 85 down to 35 in 5-point steps; the processed
  image must be no larger than 5 MB or upload fails instead of storing an
  oversized object.
- Persisted processed image metadata as `.jpg` / `image/jpeg`, and passed
  `ContentType: image/jpeg` to S3 `PutObjectCommand` for typed buffer uploads.
- Preserved PDF uploads on the normal file path; PDF filename and
  `application/pdf` MIME type are not altered by the image pipeline.
- Verification passed:
  - `cd packages/api && rtk npx jest src/storage/__tests__/images.test.ts src/storage/s3/__tests__/crud.test.ts --runInBand --coverage=false`
  - `cd api && rtk npx jest server/services/Files/process.spec.js --runInBand`
  - `rtk git diff --check`
  - `rtk npm run build:api`

---

# Active: Simplify PaddleOCR S3/OCR range from 53adb6f084566471c0a72969

Goal: simplify the committed changes from
`53adb6f084566471c0a72969..HEAD` without changing public contracts and without
auto-committing.

Plan - 2026-06-30:

- [x] Confirm the exact changed-file target from
      `git diff --name-only 53adb6f084566471c0a72969..HEAD`.
- [x] Review code reuse opportunities across the changed runtime, tests,
      scripts, docs, lessons, and task notes.
- [x] Review code quality issues such as stale branches, duplicated constants,
      misleading naming, unsafe shell behavior, and unnecessary comments.
- [x] Review efficiency issues such as repeated work, avoidable startup/smoke
      cost, or unnecessary file/network operations.
- [x] Apply only local simplifications that preserve the env keys, MCP tool
      behavior, deployment contracts, and test intent.
- [x] Run focused verification for touched code and shell scripts.
- [x] Record the final review result and skipped items here.

Changed-file target:

- `.env.example`
- `.env.prod.example`
- `api/server/services/MCP.js`
- `api/server/services/MCP.spec.js`
- `deploy/host/paddleocr-smoke.sh`
- `deploy/host/start.sh`
- `docs/deployment/digitalocean-droplet-prod-runbook.md`
- `docs/plans/2026-06-29-paddleocr-persistent-venv-prewarm.md`
- `packages/api/src/steel/vision/ocr.spec.ts`
- `packages/api/src/steel/vision/ocr.ts`
- `tasks/lessons.md`
- `tasks/todo.md`

Review - 2026-06-30:

- Removed stale fixture-specific PaddleOCR code, manual spec, expected marker
  fixture, and the obsolete OCR launcher module that still carried its own MCP
  process path.
- Removed the legacy PPOCR source selector from MCP config, env examples, host
  startup, smoke script, and manual PaddleOCR specs. PaddleOCR now documents the
  single AI Studio API path instead of multiple providers.
- Made production smoke format-neutral: the smoke script now requires an
  explicit input path, infers PDF versus image, supports PDF/PNG/JPG/BMP/CIF
  style inputs, and only validates markers when the caller provides marker env.
- Simplified PaddleOCR S3 resolution to use presigned URLs only for S3 records;
  CloudFront and local records stay on the stream/data URL fallback unless a
  signed URL path is explicitly verified later.
- Removed the explicit path-style S3 setting from production examples and
  runbook checks; AWS S3 Hong Kong does not require path-style URLs.
- Added PaddleOCR API usage guidance: daily parsing limit returns `429`, no
  single-file size limit is documented, keep PDFs within 100 pages to avoid
  timeout, and pages beyond the limit are ignored.
- Verification passed:
  - `rtk sh -n deploy/host/start.sh && rtk sh -n deploy/host/paddleocr-smoke.sh`
  - `cd api && rtk npx jest server/services/MCP.spec.js server/services/__tests__/ToolService.spec.js server/controllers/agents/client.test.js --runInBand`
  - `cd packages/api && rtk npx jest src/steel/vision/attachments.spec.ts src/steel/vision/resolver.spec.ts src/steel/vision/service.spec.ts src/steel/vision/compare.spec.ts src/steel/memory/service.spec.ts --runInBand --coverage=false`
  - `rtk npm run build:api`
  - `rtk git diff --check`

---

# Active: Production OCR S3 presigned URL smoke

Goal: make PaddleOCR OCR use private S3 presigned URLs for S3-backed
LibreChat attachments, then deploy and verify production OCR through the S3 URL
path.

Plan - 2026-06-30:

- [x] Add failing MCP resolver tests proving S3 PaddleOCR attachments use a
      signed download URL instead of base64 `data:` payloads.
- [x] Preserve the existing owned-file safety check: request-supplied paths or
      filenames must only resolve when they match an owned DB file record.
- [x] Implement S3/CloudFront download URL preference in the PaddleOCR MCP
      `input_data` resolver, with local files still using the existing
      download-stream-to-data-URL path.
- [x] Verify focused MCP tests, existing Steel OCR tests, and `git diff --check`.
- [x] Push/deploy production, upload or reuse an S3-backed small OCR file, and
      run production PaddleOCR S3 smoke without logging presigned URL secrets.

Progress - 2026-06-30:

- [x] Added a failing `MCP.spec.js` test for S3-backed PaddleOCR attachments.
      The red test proved current code did not call `getDownloadURL`.
- [x] Implemented `s3` / `cloudfront` PaddleOCR `input_data` resolution through
      storage `getDownloadURL`; local attachments still resolve to data URLs.
- [x] Added a log-safety assertion that the presigned URL signature is not
      written through `logger.debug`.
- [x] Verified:
      - `api`: `rtk npx jest server/services/MCP.spec.js --runInBand`
      - `packages/api`: `rtk npx jest src/steel/vision/ocr.spec.ts --runInBand --coverage=false`
      - root: `rtk git diff --check`
- [x] Pushed `master` commit
      `e3d0dfae7 feat: route PaddleOCR S3 attachments through presigned URLs`.
- [x] GitHub Actions production deploy run `28418474680` passed:
      build/push image, upload deployment files, deploy on Droplet, container
      health check, and public `https://chat.longdin.org/health` smoke.
- [x] Production container reports `BUILD_COMMIT=e3d0dfae7...` and
      `S3_URL_EXPIRY_SECONDS=43200`.
- [x] Production S3 OCR smoke passed with private bucket:
      - Uploaded `/data/smoke/b.png` to temporary S3 key under `uploads/smoke/`.
      - Generated a presigned URL with `X-Amz-Expires=43200`.
      - Called `paddleocr_vl` from the production container using that URL.
      - OCR returned `2664` chars in `17774` ms.
      - Deleted the temporary S3 object.

---

# Active: Configure S3 Hong Kong file storage

Goal: use AWS S3 Hong Kong `ap-east-1` as the production LibreChat file
repository while keeping AWS credentials server-side only and preserving the
existing host-managed deployment model.

Plan - 2026-06-30:

- [x] Confirm LibreChat already supports S3 through `fileStrategy: "s3"` and
      `AWS_REGION` / `AWS_BUCKET_NAME` / AWS credentials.
- [x] Confirm production host has not yet installed S3 env values or enabled
      `fileStrategy`, so live should not be switched until credentials are in
      `/etc/librechat/.env.prod`.
- [x] Add S3 Hong Kong env placeholders to `.env.prod.example`.
- [x] Update the DigitalOcean runbook with IAM policy, host env, YAML, restart,
      and verification steps.
- [x] Record that S3 storage alone does not yet make Steel OCR call PaddleOCR
      with `fileUrl`; that is a follow-up runtime change.
- [x] Upload the populated production S3 env values to
      `/etc/librechat/.env.prod` without printing secrets.
- [x] Enable `fileStrategy: "s3"` in host-managed `/data/librechat.yaml`.
- [x] Restart production and verify public health plus an in-container S3
      put/get/delete smoke test.
- [x] Raise S3 presigned URL expiry to at least 12 hours for PaddleOCR
      download windows.

Review - 2026-06-30:

- Production host check showed `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION`, and `AWS_BUCKET_NAME` are missing from
  `/etc/librechat/.env.prod`; `/data/librechat.yaml` also has no `fileStrategy`
  yet.
- `.env.prod.example` now includes AWS S3 Hong Kong values with
  `AWS_REGION=ap-east-1`, bucket placeholder, server-side credentials, and
  `S3_URL_EXPIRY_SECONDS=43200`.
- The DigitalOcean runbook now documents the recommended bucket
  `amzn-s3-longdin-ap-east`, a least-privilege IAM policy, the required
  `/etc/librechat/.env.prod` entries, `fileStrategy: "s3"` in
  `/data/librechat.yaml`, restart command, and smoke checks.
- Boundary: this config changes where new LibreChat uploads are stored. Steel
  OCR currently resolves stored files to bytes and sends them to PaddleOCR MCP;
  direct S3 Hong Kong `fileUrl` OCR requires a separate runtime change.
- Live activation completed after credentials were added locally:
  `/etc/librechat/.env.prod` was replaced on the Droplet with mode `600`,
  `/data/librechat.yaml` now includes `fileStrategy: "s3"`, and the API was
  restarted.
- Production verification passed:
  - `https://chat.longdin.org/health` returned `OK`.
  - Container logs show `[initializeS3] S3 initialized with provided credentials.`
  - In-container AWS SDK smoke wrote, read, compared, and deleted an object
    under `uploads/smoke/` in bucket `amzn-s3-longdin-ap-east`.
- Existing files already stored under `/data/uploads` remain local legacy files
  until migrated or no longer needed. New LibreChat uploads should use S3.
- Presigned URL expiry is now standardized at `43200` seconds, equal to 12
  hours, while the S3 bucket remains private.
- Production API was restarted after the env change. Public health returned
  `OK`, the running container reports `S3_URL_EXPIRY_SECONDS=43200`, and S3
  initialization still succeeds.

---

# Previous: Remove obsolete PaddleOCR source selector

Goal: keep PaddleOCR on the single supported AI Studio API path and remove the
obsolete PPOCR source selector from env examples, host scripts, MCP config,
tests, and docs.

Plan - 2026-06-30:

- [x] Remove the legacy source selector from `.env.example`, `.env.prod.example`,
      `.mcp.json`, host scripts, and docs.
- [x] Remove source-selector env injection from production startup, manual
      smoke, and manual OCR specs.
- [x] Keep only real PaddleOCR controls: access token, model, timeouts,
      persistent venv, and smoke input path.
- [x] Run shell checks and focused Steel OCR tests.

Review - 2026-06-30:

- Removed the legacy source selector from `.env.example`, `.env.prod.example`,
  `.mcp.json`, host startup, manual smoke, manual OCR spec, and the
  DigitalOcean production runbook's startup env controls.
- Updated PaddleOCR runtime docs to describe the single AI Studio API path
  without exposing a source selector.
- Verification passed:
  - `rtk sh -n deploy/host/start.sh && rtk sh -n deploy/host/paddleocr-smoke.sh`
  - `rtk git diff --check`
  - `cd packages/api && rtk npx jest src/steel/vision/ocr.spec.ts --runInBand --coverage=false`

---

# Previous: PaddleOCR Qianfan provider env cleanup and smoke

Goal: make production PaddleOCR provider selection work without hard-coded
`aistudio` env values, document the minimal env keys, and verify the configured
Qianfan key can run the same production smoke path.

Review - 2026-06-30:

- Reverted by the follow-up "Remove PaddleOCR Qianfan provider changes" task.

---

# Previous: PaddleOCR MCP AI Studio parameter diagnosis

Goal: determine whether `paddleocr-mcp` exposes AI Studio endpoint or runtime
parameters that make the API path behave closer to the fast
`aistudio.baidu.com` website OCR path, and identify whether `c.pdf` failure is
configurable or provider/API-path specific.

Plan - 2026-06-29:

- [x] Inspect the installed production `paddleocr-mcp` package source and
      metadata for supported AI Studio env vars, base URLs, endpoints, polling,
      output modes, and runtime params.
- [x] Cross-check package documentation/source from public sources when
      available so the diagnosis is not based only on local guesses.
- [x] Run controlled smoke variants through the same MCP stdio path:
      lightweight tracked PDF first, then `/data/smoke/c.pdf` only for
      candidate settings that could plausibly change behavior.
- [x] Record timings, error text, and whether each setting changes the
      `Error calling tool 'paddleocr_vl'` / `Broken pipe` failure mode.
- [x] Remove PaddleOCR OCR from the GitHub Actions production deploy gate;
      deploy is gated by LibreChat health only.
- [x] Update deployment docs and lessons with the supported configuration
      boundary and the recommended next step.

Review - 2026-06-29:

- Production `paddleocr-mcp` is version `0.8.5`.
- The package supports `PADDLEOCR_MCP_AISTUDIO_BASE_URL`,
  `PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT`,
  `PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT`, and runtime params such as
  `max_pixels`, `max_new_tokens`, `use_layout_detection`,
  `use_chart_recognition`, and `use_seal_recognition`.
- The default AI Studio API endpoint is
  `https://paddleocr.aistudio-app.com/api/v2/ocr/jobs`.
- Droplet TLS checks to `paddleocr.aistudio-app.com` are intermittent: some
  handshakes time out, while successful handshakes can still take several
  seconds.
- A no-token `POST /api/v2/ocr/jobs` returns `401`, proving the endpoint is
  reachable in principle.
- A `curl -F file=@/data/smoke/workflow-smoke.pdf` submit succeeds and returns
  a job id.
- The async `paddleocr-mcp` / `AsyncPaddleOCRClient` path can timeout before
  receiving a job id even on the tiny workflow PDF.
- The synchronous PaddleOCR SDK path can submit and finish the tiny workflow
  PDF quickly, proving the token, model, endpoint, and simple payload are valid.
- For the real `docs/reference/example/c.pdf` file, `curl -F
  file=@/data/smoke/c.pdf` timed out after 180 seconds with `0 bytes received`,
  and the sync SDK failed with `TimeoutError('The write operation timed out')`.
  This means the current failure is the Droplet multipart upload path to AI
  Studio, not PaddleOCR downloading a URL.
- NYC3 temporary Droplet `64.225.5.250` probe:
  - SSH and local upload of the same `c.pdf` succeeded; SHA256 matched
    `85797cab1061081acbd03ad3ea94bef7c7fce2cc7b155b8f5229ed829dd234a2`.
  - Basic AI Studio GET probes were stable at about `0.86` to `1.93` seconds,
    and an authenticated empty POST returned a model-parameter error in about
    `1.79` seconds.
  - The full `curl -F file=@/root/paddleocr-probe/c.pdf` submit still timed
    out after 180 seconds with no response body. It uploaded about `2031616`
    bytes before timeout, which is better than SGP1's previous zero-byte
    response but still not enough to return a job id.
  - Conclusion: NYC improves basic connectivity but does not solve the 7.6 MB
    `c.pdf` multipart upload path to AI Studio.
- Singapore `fileUrl` probe:
  - Temporarily served `/data/smoke/c.pdf` from
    `http://139.59.110.150:8000/c.pdf` and verified the URL was externally
    readable with `Content-Length: 7936604`.
  - AI Studio did connect back from `180.76.112.10` and requested `GET /c.pdf`.
  - The submit request using JSON `fileUrl` returned `HTTP 408 Request Timeout`
    after about `69301` ms and did not return a job id.
  - The temporary file server logged `BrokenPipeError: [Errno 32] Broken pipe`
    while serving AI Studio's download, meaning AI Studio disconnected during
    the 7.6 MB file download.
  - The temporary server and `8000/tcp` firewall allow rule were removed after
    the test.
- S3 presigned `fileUrl` probe:
  - The first S3 presigned URL returned `InvalidToken`, so it was not a valid
    download URL.
  - The second full S3 presigned URL was valid: `GET` with `Range: bytes=0-0`
    returned `206 Partial Content`, `Content-Range: bytes 0-0/7936604`, and
    `Content-Type: application/pdf`.
  - Submitting that S3 URL as AI Studio `fileUrl` still did not return a job id.
    The request timed out after about `194194` ms with
    `HTTPSConnectionPool(host='paddleocr.aistudio-app.com', port=443): Read
    timed out`.
  - Conclusion: S3 in `ap-southeast-2` avoids Droplet file serving but does not
    make AI Studio reliably accept this 7.6 MB `c.pdf` through `fileUrl`.
- `docs/reference/example/b.png` probe:
  - Local and Droplet `/data/smoke/b.png` copies matched SHA256
    `6aa735b128037f58cf6542936a1868cd4fba48c7c8b20bb769aa16ecbccec306`.
    The file is a 296,377 byte PNG, 1132 x 788, 8-bit RGBA.
  - Direct multipart submit from the Singapore Droplet through the synchronous
    PaddleOCR SDK still failed before a job id after about `122020` ms with
    `NetworkError: Connection failed: ('Connection aborted.',
    TimeoutError('The write operation timed out'))`.
  - The user-provided S3 presigned URL was valid from our side: signed `GET`
    with `Range: bytes=0-0` returned `206 Partial Content`, `Content-Range:
    bytes 0-0/296377`, and `Content-Type: image/png`.
  - AI Studio `fileUrl` submit for that S3 PNG returned `HTTP 400` after about
    `24170` ms with code `10000` and message `文件 URL 访问超时`.
  - Retesting the same `b.png` from AWS S3 Hong Kong `ap-east-1` changed the
    result: the production container could signed-GET the file in about
    `195` ms, AI Studio `fileUrl` submit returned `HTTP 200` with `jobId` in
    about `15462` ms, polling reached `done`, and the JSON result downloaded
    successfully with one `layoutParsingResults` entry containing a table block.
  - Conclusion: the current failure is not S3 presigned URLs in general. AWS S3
    Sydney `ap-southeast-2` failed for AI Studio `fileUrl`, but AWS S3 Hong
    Kong `ap-east-1` works for the small PNG and should be tested next with the
    full `c.pdf`.
- `docs/reference/example/c.pdf` AWS S3 Hong Kong `ap-east-1` probe:
  - The user-provided Hong Kong S3 presigned URL was valid from the production
    container: signed `GET` with `Range: bytes=0-0` returned `206 Partial
    Content`, `Content-Range: bytes 0-0/7936604`, and `Content-Type:
    application/pdf` in about `249` ms.
  - AI Studio `fileUrl` submit returned `HTTP 408` after about `70225` ms with
    code `408`, message `Request Timeout`, and no job id.
  - Conclusion: AWS S3 Hong Kong `ap-east-1` solves the small PNG path but does
    not make the 7.6 MB `c.pdf` acceptable as a single AI Studio `fileUrl`.
    Next probes should reduce the file unit first: compress the PDF, rasterize
    the page to a smaller image, or split PDF pages/images before submit.
- `d.pdf` AWS S3 Hong Kong `ap-east-1` probe:
  - The user-provided Hong Kong S3 presigned URL was valid from the production
    container: signed `GET` with `Range: bytes=0-0` returned `206 Partial
    Content`, `Content-Range: bytes 0-0/454807`, and `Content-Type:
    application/pdf` in about `236` ms.
  - AI Studio `fileUrl` submit returned `HTTP 200` with code `0`, message
    `Success`, and a job id in about `19380` ms.
  - Polling reached `done`; the JSON result downloaded in about `756` ms, was
    `73031` bytes, and contained `layoutParsingResults: 2`. The first result
    had `23` parsed blocks including `table`, `text`, and `paragraph_title`;
    the first table block contained customer/order text.
  - Conclusion: compressed/smaller PDFs can work through AWS S3 Hong Kong
    `fileUrl`. The production OCR path should prefer reducing large drawing
    PDFs before calling AI Studio instead of sending the original 7.6 MB PDF.
- GitHub Actions deploy no longer uploads `workflow-smoke.pdf` or runs the
  PaddleOCR smoke gate. `deploy/host/paddleocr-smoke.sh` remains available for
  manual diagnosis.

---

# Previous: Production PaddleOCR persistent venv and c.pdf smoke

Goal: move production PaddleOCR MCP from image-build `uvx` prewarm to a
persistent `/data/paddleocr/venv` on the Droplet, prove the MCP server starts
without crashing, and run a live `c.pdf` smoke check.

Plan - 2026-06-29:

- [x] Remove the Docker build-time `uvx` PaddleOCR prewarm layer while keeping
      Debian/glibc, `uv`, Python 3.12 defaults, and OpenCV runtime libraries.
- [x] Add production startup preparation for `/data/paddleocr/venv`, including
      install-on-missing, import prewarm, and a short MCP server start check.
- [x] Add a host-run `c.pdf` smoke script that connects to the persistent MCP
      server command through stdio and calls `paddleocr_vl`.
- [x] Update the deploy workflow to upload the smoke script and allow the
      longer first startup caused by venv creation.
- [x] Update local/host-managed MCP config and deployment docs for the
      persistent venv boundary.
- [x] Verify locally, push `master`, update the Droplet config, wait for
      production deploy, then run short-start and `c.pdf` smoke checks on the
      Droplet.

Local review - 2026-06-29:

- Removed the build-time `uvx --python 3.12 --from paddleocr-mcp` prewarm from
  `Dockerfile.multi`; the image still includes Debian/glibc runtime libraries
  and `uv`.
- Added `/data/paddleocr/venv` startup preparation to `deploy/host/start.sh`,
  including install-on-missing, import prewarm, and a short MCP server startup
  smoke.
- Added `deploy/host/paddleocr-smoke.sh` for manual live `c.pdf` MCP smoke on
  the Droplet.
- Updated the production workflow to upload the smoke script and `c.pdf`, and
  extended the health loop for first-time venv creation.
- First GitHub Actions deploy run `28376451869` built and pushed the image, but
  failed in the upload step because `docs/reference/example/c.pdf` is ignored
  by git and unavailable in a clean checkout.
- Updated after user correction: workflow no longer runs a PaddleOCR OCR smoke
  gate after deploy. The full `c.pdf` drawing smoke uses the local ignored
  `docs/reference/example/c.pdf` uploaded manually to `/data/smoke/c.pdf`.
- Updated `deploy-compose.prod.yml` health start period, `.env.prod.example`,
  `.mcp.json`, ignored local `librechat.yaml`, deployment docs, plan docs, and
  lessons for the persistent venv production boundary.
- Local verification passed:
  - `rtk sh -n deploy/host/start.sh && rtk sh -n deploy/host/paddleocr-smoke.sh`
  - `.mcp.json` JSON parse
  - `librechat.yaml` and workflow YAML parse
  - `docker compose -f deploy-compose.prod.yml config --quiet`
  - `rtk actionlint .github/workflows/deploy-prod.yml`
  - `rtk git diff --check`
- Droplet verification:
  - Uploaded host-managed `/data/librechat.yaml` with
    `command: /data/paddleocr/venv/bin/paddleocr_mcp` and required `args: []`.
  - Added a host bind mount for `deploy/host` so startup and smoke scripts can
    be hotfixed without waiting for a full image rebuild.
  - Fixed startup prewarm env so direct MCP startup uses AI Studio instead of
    defaulting to local PaddleOCR inference.
  - Persisted uv's Python install dir under `/data/paddleocr/python`; verified
    `/data/paddleocr/venv/bin/python` resolves there and `import paddleocr_mcp`
    succeeds.
  - Verified startup creates/reuses `/data/paddleocr/venv` and the short MCP
    server smoke survives until timeout status `124`.
  - Verified container and public health return `OK`.
  - Verified lightweight real PaddleOCR OCR smoke on
    `/data/smoke/workflow-smoke.pdf` passes in `213519` ms and matches
    `Workflow` / `Upload`.
  - Uploaded local ignored `docs/reference/example/c.pdf` to
    `/data/smoke/c.pdf` and verified SHA256
    `85797cab1061081acbd03ad3ea94bef7c7fce2cc7b155b8f5229ed829dd234a2`.
  - Full `c.pdf` smoke does not pass through `paddleocr-mcp` AI Studio API:
    lighter markdown mode returned `Error calling tool 'paddleocr_vl'` after
    about `190450` ms, and detailed error capture showed aiohttp
    `ClientOSError: [Errno 32] Broken pipe`.

---

# Previous: Fix production PaddleOCR MCP runtime

Goal: make the DigitalOcean production API image able to start PaddleOCR MCP
reliably for Steel PDF/image OCR instead of falling back to native PDF text
parsing only.

Plan - 2026-06-29:

- [x] Confirm the production failure mode from host/container state and logs.
- [x] Move the production API runtime image off Alpine/musl so
      `opencv-contrib-python` can use prebuilt wheels.
- [x] Pin PaddleOCR MCP to Python 3.12 and prewarm the `uvx` environment during
      image build to avoid first-request connection timeout.
- [x] Upload the updated `librechat.yaml` to the Droplet because `/data` config
      is intentionally host-managed.
- [x] Build/deploy through GitHub Actions and verify PaddleOCR MCP can start.
- [x] Smoke-check `https://chat.longdin.org/health` after deploy.
- [x] Raise PaddleOCR AI Studio request/poll/http timeouts after `c.pdf`
      exceeded the package default request timeout.

Review - 2026-06-29:

- Production logs showed the original startup failure was Alpine/musl forcing
  `opencv-contrib-python` source builds inside `paddleocr-mcp`.
- Switched the production API runtime stage in `Dockerfile.multi` to Debian
  bookworm slim and prewarmed `uvx --python 3.12 --from paddleocr-mcp`.
- Uploaded host-managed `/data/librechat.yaml` with `--python 3.12`.
- GitHub Actions production deploy `28371678489` completed successfully for
  commit `ee1a63974`.
- Verified `https://chat.longdin.org/health` returned `OK`.
- Verified the production container imports `paddleocr_mcp` and can start the
  MCP stdio command without OpenCV/distutils errors.
- Follow-up `paddleocr_vl` call reached AI Studio but timed out around the
  package default `PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT=120` seconds on
  `c.pdf`.
- Raised host-managed PaddleOCR timeout config to request `600` seconds,
  poll `1200` seconds, and HTTP `1200` seconds, then recreated the API
  container and verified health returned `OK`.

---

# Previous: GitHub Actions production deploy workflow

Goal: add a `master` push workflow that builds the customized LibreChat
production image, pushes it to GHCR, SSHes to the DigitalOcean Droplet, and
redeploys the Compose stack.

Plan - 2026-06-29:

- [x] Add `.github/workflows/deploy-prod.yml`.
- [x] Build `Dockerfile.multi` target `api-build` for `linux/amd64`.
- [x] Push GHCR tags `master` and `${{ github.sha }}`.
- [x] Use the existing Droplet SSH secrets to upload Compose/Caddy/start files.
- [x] Use the job-scoped `GITHUB_TOKEN` for remote GHCR login instead of adding
      a long-lived `GHCR_READ_TOKEN`.
- [x] Redeploy the Droplet with `docker compose up -d --remove-orphans`.
- [x] Verify local Droplet health and run a best-effort public URL smoke check.
- [x] Validate workflow syntax and action semantics before commit.

Review - 2026-06-29:

- Added `.github/workflows/deploy-prod.yml` with `push` on `master` and manual
  `workflow_dispatch`.
- Workflow permissions are limited to `contents: read` and `packages: write`.
- Workflow builds/pushes `ghcr.io/spotifynetflixyu/librechat-prod-api:master`
  and `ghcr.io/spotifynetflixyu/librechat-prod-api:${{ github.sha }}`.
- Workflow uploads `deploy-compose.prod.yml`, `deploy/host/start.sh`, and
  `deploy/digitalocean/Caddyfile` to `/srv/librechat/app` on the Droplet.
- Workflow logs the Droplet into GHCR with the job-scoped `GITHUB_TOKEN` for
  the immediate pull, avoiding a long-lived `GHCR_READ_TOKEN`.
- Workflow checks `http://127.0.0.1:3080/health` on the Droplet as the required
  deploy gate from inside the API container and runs
  `https://chat.longdin.org/health` as a best-effort public smoke check.
- Updated `docs/deployment/digitalocean-droplet-prod-runbook.md` to reference
  the workflow and its GHCR token behavior.
- Verification:
  - `rtk ruby -e "require 'yaml'; YAML.load_file('.github/workflows/deploy-prod.yml'); puts 'yaml-ok'"`
    returned `yaml-ok`.
  - `rtk actionlint .github/workflows/deploy-prod.yml` passed.
  - `rtk env LIBRECHAT_ENV_FILE=.env.prod.example LIBRECHAT_IMAGE=ghcr.io/spotifynetflixyu/librechat-prod-api:test PORT=3080 docker compose -f deploy-compose.prod.yml config --quiet`
    passed.
  - `rtk sh -n deploy/host/start.sh && rtk bash -n deploy/host/start.sh`
    passed.
  - First workflow run proved build/push/upload/deploy worked, but exposed that
    host port `3080` is intentionally not published. The workflow health gate
    was corrected to run `docker compose exec -T api curl ...` inside the API
    container.
  - `https://chat.longdin.org/health` returned `OK` after the first deploy.

---

# Previous: GitHub Actions production deploy secrets

Goal: configure GitHub Actions repository secrets so the future production
workflow can SSH to the DigitalOcean Droplet as `deploy`.

Plan - 2026-06-29:

- [x] Install GitHub CLI.
- [x] Log out of the wrong GitHub account and log in as `spotifynetflixyu`.
- [x] Confirm `spotifynetflixyu` has admin permission on
      `spotifynetflixyu/LibreChat`.
- [x] Generate a GitHub Actions-only SSH deploy key.
- [x] Install the deploy key public key on the Droplet `deploy` user.
- [x] Create required GitHub Actions secrets.
- [x] Verify the deploy key can SSH and run remote Compose config.

Review - 2026-06-29:

- Installed GitHub CLI `gh` with Homebrew.
- Logged out `nevenhsu` and logged in as `spotifynetflixyu`.
- Confirmed `spotifynetflixyu/LibreChat` permission is `ADMIN`.
- Generated local private key
  `~/.ssh/librechat_do_prod_deploy_ed25519` and installed the matching public
  key on the Droplet `deploy` user's `authorized_keys`.
- Created GitHub Actions secrets in `spotifynetflixyu/LibreChat`:
  `DO_PROD_HOST`, `DO_PROD_USER`, and `DO_PROD_SSH_KEY`.
- Did not create `GHCR_READ_TOKEN` yet; decide after the production workflow
  confirms whether the package pull needs a private GHCR token.
- Verification:
  - `gh secret list --repo spotifynetflixyu/LibreChat --app actions` shows the
    three required secrets.
  - SSH with `~/.ssh/librechat_do_prod_deploy_ed25519` to
    `deploy@139.59.110.150` succeeded.
  - Remote `docker compose -f deploy-compose.prod.yml config --quiet` passed.

---

# Previous: DigitalOcean Droplet host bootstrap

Goal: prepare the DigitalOcean Droplet at `139.59.110.150` to run the
customized LibreChat production app under `chat.longdin.org`.

Plan - 2026-06-29:

- [x] Verify root SSH access to the Droplet.
- [x] Create the `deploy` user, copy SSH access, and grant sudo/docker access.
- [x] Install Docker Engine, Docker Compose plugin, and UFW.
- [x] Create `/srv/librechat/app`, `/etc/librechat`, and `/data` runtime
      directories with production-safe ownership.
- [x] Enable firewall rules for SSH, HTTP, and HTTPS only.
- [x] Add a 2 GB swap file for the 2 GB RAM Droplet.
- [x] Upload local `.env.prod`, `librechat.yaml`, and OpenAI OAuth `auth.json`
      to the host without printing secret contents.
- [x] Add and upload production Compose, Caddy, and provider-neutral startup
      files.
- [x] Verify Docker, deploy-user SSH, firewall status, host resources,
      `auth.json` JSON validity, and remote Compose config.

Review - 2026-06-29:

- Root SSH to `139.59.110.150` succeeded; host reports `librechat-prod`.
- Created `deploy` user, copied authorized SSH keys, and added it to `sudo` and
  `docker` groups.
- Installed Docker `29.6.1` and Docker Compose plugin `v5.2.0`.
- Enabled UFW with only `OpenSSH`, `80/tcp`, and `443/tcp` allowed.
- Created a persistent 2 GB `/swapfile` and added it to `/etc/fstab`.
- Created `/srv/librechat/app`, `/etc/librechat`, `/data/uploads`,
  `/data/images`, `/data/logs`, `/data/skill`, and `/data/openai-oauth`.
- Uploaded `/etc/librechat/.env.prod`, `/data/librechat.yaml`, and
  `/data/openai-oauth/auth.json`; verified `auth.json` parses as JSON without
  printing secret contents.
- Added `deploy-compose.prod.yml`, `deploy/host/start.sh`, and
  `deploy/digitalocean/Caddyfile`; copied them to `/srv/librechat/app`.
- Updated `Dockerfile.multi` so the production image includes
  `deploy/host/start.sh`.
- Updated `.env.prod.example` and the host `.env.prod` with
  `NODE_OPTIONS=--max-old-space-size=1536` and Droplet `PORT=3080`.
- Verification:
  - `deploy@139.59.110.150` can SSH and run Docker commands.
  - `systemctl is-active docker` returned `active`.
  - `docker compose -f deploy-compose.prod.yml config --quiet` passed on the
    Droplet.
  - Public DNS is still propagating: DigitalOcean authoritative DNS has
    `chat.longdin.org -> 139.59.110.150`, while public resolvers still showed
    Namecheap nameservers at check time.

---

# Previous: DigitalOcean Droplet production deployment

Goal: move the approved production host from Render to a DigitalOcean Droplet
with a user-owned domain, while keeping MongoDB Atlas and Supabase as managed
production databases.

Plan - 2026-06-29:

- [x] Document the DigitalOcean Droplet production shape, including Droplet
      size, domain/DNS, Caddy HTTPS, Docker Compose, persistent data paths,
      external databases, and manual secret files.
- [x] Add an implementation plan for the future compose/workflow/host setup
      work without enabling a broken GitHub Actions production deploy before
      the Droplet exists.
- [x] Mark the Render runbook as a rollback/historical option so it is not
      mistaken for the current production target.
- [x] Update the local account-bootstrap and env-template wording away from
      Render-specific assumptions.
- [x] Capture the provider correction in lessons and verify docs for secret
      leaks and whitespace.

Review - 2026-06-29:

- Added `docs/deployment/digitalocean-droplet-prod-runbook.md` as the current
  production deployment runbook for a DigitalOcean Droplet with a user-owned
  domain, Caddy HTTPS, Docker Compose, `/data` persistence, host-side
  `.env.prod`, uploaded `librechat.yaml`, uploaded OpenAI OAuth `auth.json`,
  MongoDB Atlas IP allowlist, and GitHub Actions deploy shape.
- Added `docs/plans/2026-06-29-digitalocean-droplet-production-deployment.md`
  with the follow-up implementation plan for compose, Caddy, host setup,
  GitHub Actions, smoke checks, and Render decommission timing.
- Marked `docs/deployment/render-prod-runbook.md` as rollback/historical
  documentation because the selected production target is now DigitalOcean
  Droplet.
- Updated `docs/deployment/local-terminal-user-bootstrap.md` so local account
  creation applies to Render, DigitalOcean Droplet, or another production host.
- Updated `.env.prod.example` away from Render generated-domain placeholders
  and toward `chat.<your-domain>` with `PORT=3080` for the Droplet app.
- Updated `tasks/lessons.md` with the Render-to-Droplet correction and the rule
  to delay enabling SSH auto-deploy until Droplet/GitHub secrets exist.
- Verification:
  - Secret-pattern scan over deployment docs, the new implementation plan,
    `.env.prod.example`, and task files returned only placeholders and the
    documented scan command itself, not real secrets.
  - Trailing-whitespace scan over the updated files returned no output.
  - `rtk git diff --check -- docs/deployment/digitalocean-droplet-prod-runbook.md docs/plans/2026-06-29-digitalocean-droplet-production-deployment.md docs/deployment/render-prod-runbook.md docs/deployment/local-terminal-user-bootstrap.md .env.prod.example tasks/todo.md tasks/lessons.md`
    passed.

---

# Previous: Render manual state sync documentation

Goal: document every production value/file that must be manually configured in
Render or external services, including `librechat.yaml` and OpenAI OAuth
`auth.json`.

Plan - 2026-06-29:

- [x] Add a Render manual sync checklist that separates dashboard env vars,
      persistent-disk files, SSH setup, and external-service allowlists.
- [x] Document that Render auto-creates only a minimal `/data/librechat.yaml`;
      the real local `librechat.yaml` must be uploaded to Render manually after
      local changes.
- [x] Document that OpenAI OAuth `auth.json` must be uploaded to the writable
      Render disk and refreshed manually when local OAuth auth changes.
- [x] List what should not be pasted to Render, and what is managed outside
      Render such as Steel rules sync and Mongo/Supabase data.
- [x] Update lessons and verify the docs for secret leaks and whitespace.

Review - 2026-06-29:

- Added `Manual Render Sync Checklist` to
  `docs/deployment/render-prod-runbook.md`, separating Render Dashboard env
  vars, `/data` persistent-disk files, SSH setup, MongoDB Atlas allowlist, and
  Supabase-managed data/schema/rules.
- Documented that Render's startup script only creates a minimal
  `/data/librechat.yaml`; the real local `librechat.yaml` must be uploaded to
  Render manually with SSH pipe and followed by a service restart.
- Documented that local `~/.codex/auth.json` must be uploaded to
  `/data/openai-oauth/auth.json`, verified as JSON, and followed by a service
  restart whenever local OAuth auth changes.
- Added a "do not paste into Render Environment" list for `auth.json`,
  full `librechat.yaml`, password command arguments, and local-only paths.
- Clarified that Steel rules/data sync and MongoDB/Supabase state are managed
  outside Render rather than pasted into the Render dashboard.
- Updated `tasks/lessons.md` with the manual Render state-sync boundary.
- Verification:
  - Secret-pattern scan over the updated deployment docs and task files
    returned no matches.
  - Trailing-whitespace scan over the updated deployment docs and task files
    returned no matches.
  - `rtk git diff --check -- docs/deployment/render-prod-runbook.md tasks/todo.md tasks/lessons.md`
    passed.
  - `rtk rg` confirmed the runbook contains the manual sync checklist,
    `/data/librechat.yaml`, `/data/openai-oauth/auth.json`, Render Environment,
    MongoDB Atlas, and Supabase-managed state entries.

---

# Previous: Local terminal account bootstrap documentation

Goal: document how to create production LibreChat accounts from the local
terminal using `.env.prod`, instead of relying on Render SSH on the low-cost
Starter instance.

Plan - 2026-06-29:

- [x] Add a standalone local-terminal user bootstrap runbook with prerequisites,
      first-admin creation, internal-user creation, verification, and
      troubleshooting.
- [x] Update the Render production runbook to point admin/internal user
      creation at the local-terminal workflow.
- [x] Capture the Render Starter SSH failure lesson and the safer local
      `create-user` command shape.
- [x] Verify the updated docs for secret leaks, command accuracy, and diff
      hygiene.

Review - 2026-06-29:

- Added `docs/deployment/local-terminal-user-bootstrap.md` with the local Mac
  terminal procedure for creating production accounts through `.env.prod` and
  `config/create-user.js`.
- Updated `docs/deployment/render-prod-runbook.md` so admin/internal user
  creation points to the local-terminal workflow instead of Render SSH.
- Documented the safer command shape:
  `DOTENV_CONFIG_PATH=.env.prod CONFIG_PATH=librechat.yaml node -r dotenv/config config/create-user.js ...`.
- Documented that passwords should be entered at the prompt, not passed as
  command arguments.
- Updated `tasks/lessons.md` with the Render Starter/SSH account-bootstrap
  correction.
- Verification:
  - Secret-pattern scan over the new/updated docs and task files returned no
    matches.
  - `rtk git diff --check -- docs/deployment/render-prod-runbook.md tasks/todo.md tasks/lessons.md`
    passed for tracked files, and trailing-whitespace scan over the new/updated
    docs and task files returned no matches.
  - `rtk rg` confirmed the local bootstrap command, password warning, runbook
    link, and Render SSH troubleshooting text are present.

---

# Previous: Render service creation documentation update

Goal: update the production deployment documentation with the actual Render
service creation and troubleshooting steps used during setup.

Plan - 2026-06-29:

- [x] Add exact Render UI field values for service creation, Docker settings,
      health checks, auto deploy, and build filters.
- [x] Document the low-budget 1 GB disk option while keeping `/data` as the
      required mount path and explaining upgrade limits.
- [x] Add MongoDB Atlas Network Access guidance for Render outbound access.
- [x] Clarify OpenAI OAuth `auth.json` installation: prefer Render Shell after
      the service is live, and use Secret File only as a temporary bootstrap
      copy into `/data`.
- [x] Update lessons for the Render setup corrections and verify docs for
      secret leaks and whitespace issues.

Review - 2026-06-29:

- Updated `docs/deployment/render-prod-runbook.md` with the actual Render Web
  Service creation fields used during setup: `Docker`, `master`, blank Root
  Directory, `/health`, Docker context `.`, `Dockerfile.multi`, Docker Command
  `sh /app/deploy/render/start.sh`, blank Pre-Deploy Command, Auto-Deploy
  `On Commit`, and blank Build Filters.
- Documented that Starter plus a 1 GB `/data` disk is acceptable for a
  budget-first smoke deployment, while 10 GB remains the safer sustained
  production starting point.
- Added MongoDB Atlas Network Access recovery for Render outbound IP blocking,
  including temporary `0.0.0.0/0` unblock and later tightening to Render
  outbound IPs/CIDRs.
- Clarified OpenAI OAuth `auth.json`: use Render Shell after the service is
  live when possible; use Render Secret File only as a temporary copy source
  into `/data/openai-oauth/auth.json`, then restore the normal Docker Command.
- Updated `tasks/lessons.md` with the Render UI/setup corrections.
- Verification:
  - Secret-pattern scan over the updated runbook, todo, and lessons returned no
    matches.
  - `rtk git diff --check -- docs/deployment/render-prod-runbook.md tasks/todo.md tasks/lessons.md`
    passed.
  - `rtk rg` confirmed the updated runbook contains the required Render field
    values and Mongo/OAuth troubleshooting entries.

---

# Previous: Render production deployment transition

Goal: switch the approved production deployment path from AWS Lightsail host
automation to Render Web Service deployment while keeping the already-created
production MongoDB, Supabase, and `.env.prod` decisions.

Plan - 2026-06-29:

- [x] Disable the Lightsail SSH GitHub Actions production redeploy path so
      `master` pushes do not target a missing VPS.
- [x] Add a Render runtime startup script that maps uploads, generated images,
      logs, skills, and OpenAI OAuth `auth.json` to Render Persistent Disk.
- [x] Add a Render production runbook covering Web Service setup, default
      `onrender.com` domain, environment variables, persistent disk, OpenAI
      OAuth auth-file installation, admin bootstrap, auto deploy, and smoke
      verification.
- [x] Update `.env.prod.example` so placeholders match Render and keep real
      production values in ignored `.env.prod` / Render dashboard secrets.
- [x] Record the deployment-provider correction in `tasks/lessons.md`.
- [x] Verify script syntax, committed-secret patterns, diff hygiene, commit the
      transition, and move local `master` to the verified commit.

Review - 2026-06-29:

- Removed `.github/workflows/deploy-prod.yml`; production `master` pushes no
  longer run the Lightsail/GHCR/SSH redeploy workflow.
- Added `deploy/render/start.sh` and copied `deploy/render` into the final
  `Dockerfile.multi` image so Render can use
  `sh /app/deploy/render/start.sh` as the Docker Command.
- Render startup now defaults `HOST=0.0.0.0`,
  `CONFIG_PATH=/data/librechat.yaml`, and
  `OPENAI_OAUTH_AUTH_FILE=/data/openai-oauth/auth.json`; it creates a minimal
  `librechat.yaml`, seeds `/data/skill` once from image `/app/skill`, and maps
  uploads/images/logs/skills/OAuth state to the `/data` Persistent Disk.
- Added `docs/deployment/render-prod-runbook.md` with Render Web Service
  setup, generated `onrender.com` domain usage, env vars, disk mount,
  OpenAI OAuth auth-file installation, admin bootstrap, auto deploy, smoke
  verification, troubleshooting, and backup notes.
- Added `docs/plans/2026-06-29-render-production-deployment.md` to capture the
  implementation plan.
- Updated `.env.prod.example` for Render placeholders and kept real production
  values out of git.
- Updated `tasks/lessons.md` with the Render/VPS deployment-provider
  correction.
- Verification:
  - `rtk sh -n deploy/render/start.sh` passed.
  - `rtk bash -n deploy/render/start.sh` passed.
  - `rtk rg -n "LIGHTSAIL_|Redeploy on Lightsail|deploy-compose.prod.yml|deploy/lightsail" .github/workflows`
    returned no matches.
  - Secret-pattern scan over `.env.prod.example`, Render deploy docs/scripts,
    and task files returned no matches.
  - `rtk git diff --check` passed.

---

# Previous: AWS Lightsail production deployment implementation

Goal: implement the approved AWS Lightsail low-cost production deployment path,
verify it locally, then create `master` for production use.

Plan - 2026-06-29:

- [x] Re-read the production design, route shells, current compose, Dockerfile,
      existing workflow patterns, project instructions, and lessons.
- [x] Add backend production gating for standalone `/steel/oauth-chat` backing
      APIs while keeping OpenAI OAuth usage endpoints available.
- [x] Add frontend production route registration gating for `/steel/oauth-chat`.
- [x] Add minimal production compose and Caddy config for Lightsail.
- [x] Add production env template, Lightsail runbook, OpenAI OAuth auth-file
      instructions, and separate-prod-DB guidance.
- [x] Add GitHub Actions workflow for `master` production image build and host
      redeploy.
- [x] Add production smoke script for `/api/config`, `/steel/oauth-chat`, and
      `/api/steel/ai/chat`.
- [x] Run final focused tests, builds, compose validation, Docker image sanity
      check, secret scan, and diff hygiene.
- [x] Commit the implementation and create `master` after verification.

Review - 2026-06-29:

- Added backend production gating so standalone `/steel/oauth-chat` backing APIs
  return 404 when `NODE_ENV=production`; authenticated OAuth usage stays
  available.
- Added frontend route registration gating so production does not register the
  `/steel/oauth-chat` route.
- Added `deploy-compose.prod.yml` with only `api` and `caddy`, external
  production DB env values, host-persisted uploads/images/logs/skills, and a
  writable OpenAI OAuth auth-file mount.
- Added Caddy config that returns 404 for `/steel/oauth-chat*` before proxying
  normal LibreChat traffic.
- Added `.env.prod.example` and
  `docs/deployment/aws-lightsail-prod-runbook.md`, including the recommendation
  to use separate production MongoDB Atlas and Supabase resources.
- Kept the real production env as ignored `/etc/librechat/.env.prod`, tracked
  only the placeholder `.env.prod.example`, and removed the unnecessary
  `OPENAI_PROVIDER` value because the frontend distinguishes OAuth/API-key
  providers.
- Documented first-admin bootstrap with `npm run create-user` from the running
  API container while keeping `ALLOW_REGISTRATION=false`.
- Added `.github/workflows/deploy-prod.yml` so pushes to `master` build the
  production GHCR image and redeploy the Lightsail compose stack over SSH.
- Added `scripts/prod-smoke.sh` for `/api/config`, `/steel/oauth-chat`, and
  `/api/steel/ai/chat` production checks.
- Verification:
  - `cd api && rtk npx jest server/routes/__tests__/steel.spec.js --runInBand --watch=false --coverage=false`
    passed, 15 tests.
  - `cd client && rtk npx jest src/routes/__tests__/skillsRoutes.spec.tsx --runInBand --watch=false --coverage=false`
    passed, 3 tests.
  - `rtk npm run build:api` passed.
  - `rtk npm run build:client` passed with existing bundle-size,
    `vm-browserify` eval, and PWA glob warnings.
  - Workflow YAML parsed with Ruby YAML.
  - Production compose rendered services `api` and `caddy` only.
  - `rtk bash -n scripts/prod-smoke.sh` passed.
  - Secret-pattern scan found no committed production secrets.
  - `rtk git diff --check` passed.
  - Local Docker image build was attempted but could not run because the Docker
    daemon was not available at `/Users/neven/.docker/run/docker.sock`; GitHub
    Actions remains the authoritative image build path.

---

# Previous: AWS Lightsail low-cost production deployment design

Goal: document the selected low-cost production deployment shape for internal
LibreChat/Steel use: AWS Lightsail host, external prod databases, host-persisted
uploads, OpenAI OAuth setup, `master` production branch, and automatic redeploy
on `master` pushes.

Plan - 2026-06-29:

- [x] Capture the selected AWS Lightsail low-cost host design.
- [x] Record prod DB boundaries: cloud MongoDB through `MONGO_URI` and Supabase
      cloud Postgres through `STEEL_POSTGRES_URL`.
- [x] Document host-persisted uploads so files are not stored in Docker images
      or container writable layers.
- [x] Document OpenAI OAuth host-secret setup and keep `/steel/oauth-chat`
      development-only.
- [x] List next implementation tasks for prod compose, GitHub Actions redeploy,
      host setup, and verification.

Review - 2026-06-29:

- Added `docs/plans/2026-06-29-aws-lightsail-low-cost-prod-design.md`.
- The design starts with AWS Lightsail Small, 2 vCPU / 2 GB RAM / 60 GB SSD,
  plus swap, and defines 4 GB upgrade triggers.
- Production app runtime is intentionally minimal: custom image, reverse proxy,
  persistent host directories, external MongoDB, external Supabase, and no local
  Meili/RAG/vector DB in the low-cost starting shape.
- Uploads are bound to `/srv/librechat/uploads`, not stored in the image.
- OpenAI OAuth uses `/var/secrets/openai-oauth/auth.json` via
  `OPENAI_OAUTH_AUTH_FILE`; product traffic uses native LibreChat chat rather
  than `/steel/oauth-chat`.
- OAuth access tokens expire; `openai-oauth-provider` refreshes with the
  refresh token and writes updated token data back to `auth.json`, so the
  production mount must allow app-container writes and the file must be replaced
  when refresh auth fails.
- `master` is the production branch; `main` remains upstream-only.

---

# Previous: search_price_candidates tier output cleanup

Goal: keep `search_price_candidates` AI-visible candidate pricing data on
`tierPrices` only, remove duplicated `tierRatios` from tool output, and fix the
output boundary that let internal tier-ratio fields leak into responses.

Follow-up goal - 2026-06-27:

Remove `tierRatios` / `ratio_a` / `ratio_b` / `ratio_c` / `ratio_f` from the
internal import/repository model and from the Steel Supabase `steel.prices`
table. `unit_price_a` / `unit_price_b` / `unit_price_c` / `unit_price_f`
remain the only persisted tier price fields.

Plan - 2026-06-27:

- [x] Read project instructions, `CLAUDE.md`, current lessons, and relevant
      Steel price-lookup memory.
- [x] Add a regression test that fails while `search_price_candidates` returns
      `tierRatios` beside `tierPrices`.
- [x] Fix the tool output boundary so repository internals do not expose
      `tierRatios` in `search_price_candidates` results.
- [x] Run focused Steel tool/repository tests and `git diff --check`.
- [x] Record the review result and root cause here.

Review - 2026-06-27:

- Root cause: `search_price_candidates` returned deduped `SteelPriceItem`
  repository rows directly, and that internal row model includes both
  `tierPrices` and DB ratio fields mapped as `tierRatios`.
- Fix: added an explicit public price-candidate projection in
  `packages/api/src/steel/tools/execute.ts`; AI-visible results now keep
  `tierPrices` and no longer expose `tierRatios`.
- Follow-up correction below removes repository/import/DB `tierRatios` entirely;
  this first pass was tool-output-only and is superseded for internal storage.
- Verification:
  - Red test failed before the fix:
    `cd packages/api && rtk npx jest src/steel/tools/execute.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "does not expose internal tier ratios"`.
  - `cd packages/api && rtk npx jest src/steel/tools/execute.spec.ts --runInBand --watch=false --coverage=false`
    passed, 15 tests.
  - `cd packages/api && rtk npx jest src/steel/repositories/prices.spec.ts --runInBand --watch=false --coverage=false`
    passed, 27 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`; detached npm PID `34257`,
    server PID `34353`, and `curl` returned `200`.

Follow-up plan - 2026-06-27:

- [x] Add failing tests proving repository/import/schema no longer accept or
      expose `tierRatios` / `ratio_*`.
- [x] Remove `tierRatios` from `SteelPriceItem`, repository SQL selection,
      import parser output, and import script insert columns.
- [x] Add an explicit code/schema note that `比率A-F` source columns are
      intentionally ignored and tier prices are stored only as `unit_price_*`.
- [x] Create a Supabase migration with `npx supabase migration new`, update
      `supabase/schema.sql`, and apply the migration to cloud `STEEL_POSTGRES_URL`.
- [x] Verify tests, build, schema readback, and `git diff --check`.

Follow-up review - 2026-06-27:

- Removed import parser fields `ratioA-F`; source `比率A-F` remains present in
  fixtures only to prove it is ignored.
- Removed `ratio_a-f` from the price import script insert/update column list.
- Removed repository `tierRatios`, `ratio_a-f` row fields, and SQL selection.
- Removed `比率A-F` from schema mapping and added an ignored-source-column note.
- Created `supabase/migration/20260627120916_drop_steel_price_ratio_columns.sql`
  with `DROP COLUMN IF EXISTS ratio_a-f` and a `steel.prices` table comment.
- Updated `supabase/schema.sql` so current schema contains only
  `unit_price_a/b/c/f` for tier prices.
- Applied migration to cloud `STEEL_POSTGRES_URL`; readback columns are
  `unit_price_a,unit_price_b,unit_price_c,unit_price_f`, and migration history
  contains version `20260627120916`.
- Verification:
  - Red tests failed before implementation for import `ratioA` and repository
    SQL `ratio_a` selection.
  - `cd packages/api && rtk npx jest src/steel/pricing/import.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/schema/mapping.spec.ts --runInBand --watch=false --coverage=false`
    passed, 50 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - `rtk node packages/api/scripts/import-steel-price-v3.cjs --help` passed.
  - Restarted backend on `http://localhost:3080/`; detached npm PID `75981`,
    server PID `76067`, and `curl` returned `200`.

Current simplify pass - 2026-06-27:

- [x] Re-scanned the current working tree diff through code reuse, quality, and
      efficiency angles.
- [x] Removed the now-redundant public price-candidate projection in
      `packages/api/src/steel/tools/execute.ts`; internal `tierRatios` no
      longer exists in the import/repository/DB model, so the extra projection
      was only duplicating `SteelPriceItem`.
- [x] Updated PaddleOCR MCP initialization after user correction: conditionally
      inject it only when the current request has OCR-capable files.
- [x] Run targeted Steel/OCR/MCP tests, build, and diff checks after this
      simplification.

Current simplify review - 2026-06-27:

- Removed the redundant `search_price_candidates` output projection that had
  been added only to hide `tierRatios`; after the import/repository/DB cleanup,
  direct deduped `SteelPriceItem` output no longer contains that field.
- Applied the latest user correction for OCR MCP loading: no OCR-capable file
  means no `PaddleOCR` MCP injection; current-turn PDF/image files and request
  PDF/image attachments still inject it.
- Updated `tasks/lessons.md` so future OCR MCP changes use conditional loading
  instead of the earlier every-turn assumption.
- Verification:
  - Red test failed before the conditional-loading fix:
    `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "does not inject PaddleOCR MCP during initialization without OCR-capable files"`.
  - Same focused test passed after the fix.
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed, 63 tests.
  - `cd packages/api && rtk npx jest src/steel/pricing/import.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/schema/mapping.spec.ts src/mcp/__tests__/utils.test.ts src/mcp/tools.spec.ts src/tools/definitions.spec.ts --runInBand --watch=false --coverage=false`
    passed, 177 tests.
  - `cd api && rtk npx jest server/services/MCP.spec.js app/clients/tools/util/handleTools.test.js --runInBand --watch=false --coverage=false`
    passed, 73 tests.
  - `cd client && rtk npx jest src/utils/__tests__/validateFiles.spec.ts src/components/Chat/Input/Files/__tests__/AttachFileMenu.spec.tsx --runInBand --watch=false --coverage=false`
    passed, 49 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `cd client && rtk npm run typecheck` passed.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`; detached npm PID `31376`,
    server PID `31412`, and `curl` returned `200`.
  - Backend log still shows configured MCP registry startup for `PaddleOCR`;
    the conditional change is scoped to per-turn Agent tool injection.

PaddleOCR MCP process lazy-load plan - 2026-06-27:

- Superseded on 2026-07-09 by the eager-start/no request-time cold-start plan.
  The active contract is `startup:true`, no `initializeMCPs` lazy override, and
  a preinstalled `paddleocr_mcp` command in the production image.

PaddleOCR MCP process lazy-load review - 2026-06-27:

- Historical note only. Do not reintroduce the previous PaddleOCR lazy-load
  override; it was removed by the 2026-07-09 eager-start work.

# Active: Steel Direct MCP OCR

Goal: remove `run_file_ocr` as an AI-visible/executable Steel tool and remove
the rules that instruct the AI to call it, while keeping direct PaddleOCR MCP
OCR and assistant OCR Markdown auto-save to database.

Implementation plan:
`docs/plans/2026-06-27-steel-direct-mcp-ocr.md`.

Simplify pass - 2026-06-27:

- [x] Review the current working tree diff under `/simplify`.
- [x] Run parallel reuse, quality, and efficiency checks over changed code.
- [x] Apply only local simplifications that preserve public APIs and keep OCR
      rules unchanged.
- [x] Run targeted verification and record results.

Simplify review - 2026-06-27:

- Consolidated duplicated PaddleOCR request-file resolver tests in
  `api/server/services/MCP.spec.js` with a local helper for filename and
  `file_id` cases.
- Tightened PaddleOCR resolver safety: request-supplied file refs are now used
  only to collect current-turn file ids; downloadable records must come from
  owner/tenant-checked `db.getFiles()` results.
- Kept uploaded PDF media type precise when records are stored as
  `application/octet-stream`; file extension fallback now produces
  `data:application/pdf` for `.pdf`.
- Added shared `splitMCPToolKey()` and reused it in legacy MCP tool loading /
  execution so tool names containing `_mcp_` are parsed by the final delimiter.
- Reused the existing MCP server-name fallback hash helper in both MCP server
  name normalizers.
- Updated after user correction: PaddleOCR MCP is injected only when the
  current request has OCR-capable Steel files. The no-file case stays clean,
  while PDF/image current-turn files and request attachments still trigger MCP
  loading.
- Verification:
  - `cd packages/api && rtk npx jest src/mcp/__tests__/utils.test.ts --runInBand --watch=false --coverage=false`
    passed, 79 tests.
  - `cd packages/api && rtk npx jest src/mcp/tools.spec.ts src/tools/definitions.spec.ts --runInBand --watch=false --coverage=false`
    passed, 48 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false`
    passed, 57 tests.
  - `cd api && rtk npx jest app/clients/tools/util/handleTools.test.js --runInBand --watch=false --coverage=false`
    passed, 16 tests.
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed, 63 tests.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`, new PID `29803`, and
    `curl` returned `200`; frontend dev server on `http://localhost:3090/`
    also returned `200`.
  - Backend log after restart shows `[MCP][PaddleOCR] Tools: paddleocr_vl` and
    `[MCP] Initialized with 1 configured server and 1 tool.`

Frontend PaddleOCR upload UI limits - 2026-06-27:

- [x] Add chat file-input accept hints for PaddleOCR-supported UI formats.
- [x] Add client-side preflight validation for PaddleOCR UI limits without
      backend/YAML changes or PDF page-count checks.
- [x] Run focused frontend validation tests and `git diff --check`.

Frontend PaddleOCR upload UI limits review - 2026-06-27:

- Scoped the change to frontend UI only. No backend validator,
  `librechat.yaml`, or PDF page-count check was added.
- OCR/Text upload selection now sets the file chooser accept hint to PDF, PNG,
  JPG/JPEG, BMP, and CIF.
- `validateFiles()` now applies PaddleOCR UI limits only when
  `toolResource === context`: max 20 selected/attached files, max 200MB per
  file, max 10MB for image files, and the same PDF/image format allowlist.
- Normal provider upload, file search, and code environment upload still use
  the existing endpoint file config path.
- Verification:
  - Initial repo-root Jest command failed because root Jest did not use the
    client TypeScript transform; reran the same spec from `client/`.
  - `cd client && rtk npx jest src/utils/__tests__/validateFiles.spec.ts --runInBand --watch=false --coverage=false`
    passed, 23 tests.
  - `cd client && rtk npx jest src/components/Chat/Input/Files/__tests__/AttachFileMenu.spec.tsx --runInBand --watch=false --coverage=false`
    passed, 26 tests.
  - `rtk git diff --check` passed.
  - `curl http://localhost:3090/` returned `200`.

Current correction - 2026-06-27 - PaddleOCR filename input and server key:

- [x] Reproduce the reported `paddleocr_vl` failure pattern with a red test:
      `input_data: "c.pdf"` was passed through unchanged, so MCP had no
      downloadable file bytes.
- [x] Rename the configured LibreChat MCP server key from `PaddleOCR-VL-1.6`
      to `PaddleOCR` while keeping `PADDLEOCR_MCP_MODEL=PaddleOCR-VL-1.6`.
- [x] Resolve filename-only PaddleOCR `input_data` from current request
      LibreChat attachments before calling MCP, using owner/tenant-checked file
      records and existing storage download strategies.
- [x] Keep the generic provider-safe dotted-server-name tests, because they
      still protect other MCP server names even though current PaddleOCR uses
      the simpler `PaddleOCR` key.
- [x] Run full focused verification, direct `c.pdf` PaddleOCR manual check,
      `git diff --check`, restart backend, and record evidence.

Correction review - 2026-06-27 - PaddleOCR filename input and server key:

- Root cause: the latest `paddleocr_vl` failure was a real MCP tool failure,
  not an AI result-parsing failure. The model passed `input_data: "c.pdf"`;
  PaddleOCR MCP supports absolute paths, URLs, raw Base64, or data URLs, and
  does not know LibreChat attachment display names.
- Runtime fix: `createMCPTool()` now captures the Express request. Before
  `paddleocr_vl` calls MCP, filename-only `input_data` is matched against the
  current request's LibreChat file refs, owner/tenant-checked through
  `db.getFiles()`, downloaded through the existing file storage strategy, and
  converted to a `data:<media-type>;base64,...` input.
- Naming fix: `librechat.yaml` now uses MCP server key `PaddleOCR`; the actual
  model setting remains `PADDLEOCR_MCP_MODEL=PaddleOCR-VL-1.6`.
- Verification:
  - Red/green filename-only regression:
    `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false --testNamePattern "filename-only"`.
  - Full focused suites passed:
    `MCP.spec.js` 53 tests, `handleTools.test.js` 16 tests,
    `ToolService.spec.js` 63 tests.
  - Direct `docs/reference/example/c.pdf` PaddleOCR MCP manual spec passed, 1
    test in 16.2s.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`, new PID `47359`, and
    `curl` returned `200`; frontend dev server on `http://localhost:3090/`
    also returned `200`.
  - Backend log after restart shows `PaddleOCR.timeout: 1200000`,
    `[MCP][PaddleOCR] Tools: paddleocr_vl`, and `[MCP] Initialized with 1
    configured server and 1 tool.`

Current correction - 2026-06-27 - PaddleOCR file_id input:

- [x] Reproduce the reported `paddleocr_vl` failure shape with a red test:
      `input_data` was a LibreChat file id UUID, so the previous filename-only
      resolver passed it through unchanged.
- [x] Extend backend PaddleOCR argument resolution to match current-turn
      attachments by `file_id` / `fileId` / `id` before falling back to filename
      and filepath matching.
- [x] Revert the attempted OCR rule wording change per user correction; this
      issue is handled in backend tool argument normalization, not by changing
      rules.
- [x] Run focused verification, restart backend, and record evidence.

Correction review - 2026-06-27 - PaddleOCR file_id input:

- Root cause: the AI passed LibreChat file id
  `48322107-fb71-4d2c-970a-669e15d14821` as `input_data`. PaddleOCR MCP does
  not natively understand LibreChat UUIDs, and the previous backend resolver
  only matched filenames / filepaths.
- Runtime fix: PaddleOCR `input_data` normalization now matches current-turn
  attachments by `file_id`, `fileId`, or `id`, then resolves the authorized
  file record and converts it to a data URL before the MCP call.
- Rule boundary: the attempted OCR rule wording change was reverted after the
  user said not to change rules.
- Verification:
  - Red/green file-id regression:
    `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false --testNamePattern "file_id input_data"`.
  - Full `MCP.spec.js` passed, 54 tests.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`, new PID `66358`, and
    `curl` returned `200`; frontend dev server on `http://localhost:3090/`
    also returned `200`.
  - Backend log after restart shows `[MCP][PaddleOCR] Tools: paddleocr_vl` and
    `[MCP] Initialized with 1 configured server and 1 tool.`

Current correction - 2026-06-27:

- [x] Prove the screenshot "PaddleOCR 回傳 No text could be parsed" was not a
      real `paddleocr_vl` result: the UI turn did not call PaddleOCR MCP.
- [x] Add failing coverage for tool loading before `AgentClient` has populated
      `req.steelNativeContext.currentTurnFiles`.
- [x] Pass resolved request attachments from `initializeAgent()` into
      `loadAgentTools()` for logging/context, and inject PaddleOCR MCP during
      tool initialization on every turn so AI can use `paddleocr_vl` anytime.
- [x] Update OCR rules from PaddleOCR-only stop behavior to
      PaddleOCR-first with explicit AI OCR/vision fallback only after
      PaddleOCR fails or returns no usable result.
- [x] Run targeted ToolService / initializeAgent / AgentClient tests, sync
      Steel rules, run direct `c.pdf` PaddleOCR manual verification, restart
      backend, and record evidence.

Correction review - 2026-06-27:

- Root cause: the screenshot text `PaddleOCR 回傳 No text could be parsed` was
  not a real PaddleOCR result. That UI turn never called `paddleocr_vl`; the
  model attributed provider PDF/native parsing failure to PaddleOCR.
- Runtime fix: `ToolService` now injects the PaddleOCR MCP server token during
  initialization tool loading on every turn, even when there is no PDF/image
  attachment. Resolved request attachments are still passed from
  `initializeAgent()` to `loadAgentTools()` for logging/context.
- Rule fix: OCR rules now say PaddleOCR MCP is always loaded, AI must call
  `paddleocr_vl` first for OCR/PDF/image/file-content parsing, and AI
  OCR/vision fallback is allowed only after PaddleOCR fails or returns no
  usable text. Approximate values such as `約 600 × 300` remain forbidden.
- Verification:
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed, 63 tests.
  - `cd packages/api && rtk npx jest src/agents/__tests__/initialize.test.ts --runInBand --watch=false --coverage=false --testNamePattern "attachment scoping|allowed-tools|does not invoke loadTools twice when the agent has no tools"`
    passed, 11 focused tests.
  - `cd api && rtk npx jest server/controllers/agents/client.test.js --runInBand --watch=false --coverage=false --testNamePattern "keeps OCR-capable request attachments|buildMessages with request and agent-scoped context attachments|titleConvo"`
    passed, 84 tests.
  - `rtk node packages/api/scripts/sync-steel-rules.cjs --apply` passed and
    read back `steel-drawing-ocr-policy` SHA
    `03f49e9eb428a3f3ac4112824ff876a978c8f89674387ab80ea27554d2137ab6`.
  - Direct `docs/reference/example/c.pdf` PaddleOCR MCP manual OCR spec passed,
    1 test in 16.2s.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`, new PID `78767`, and
    `curl` returned `200`; frontend dev server on `http://localhost:3090/`
    also returned `200`.
  - Backend log after restart shows `PaddleOCR-VL-1.6.timeout: 1200000`,
    `Tools: paddleocr_vl`, and `[MCP] Initialized with 1 configured server and
    1 tool.`

Plan:

- [x] Read project instructions, `CLAUDE.md`, memory, lessons, and current OCR
      tool/rule paths.
- [x] Dispatch focused explorer agents for tool exposure, OCR Markdown
      autosave, and rule/document references.
- [x] Write failing tests proving `run_file_ocr` is no longer exposed.
- [x] Remove `run_file_ocr` from Steel tool schemas, registry, execution, and
      runtime/native policy.
- [x] Update AI-facing OCR rules and canonical docs to direct PaddleOCR MCP
      semantics.
- [x] Preserve assistant OCR Markdown auto-save and `read_markdown(scope:
      "ocr")` recovery.
- [x] Run targeted Jest tests, rules sync dry-run/apply where credentials
      allow, `docs/reference/example/c.pdf` MCP verification where credentials
      allow, and `git diff --check`.
- [x] Add review evidence here before wrap-up.

Check-in - 2026-06-27:

- User decision locked: use PaddleOCR MCP directly, delete the
  `run_file_ocr` tool path, delete `run_file_ocr` related AI-facing rules, and
  keep AI-produced OCR Markdown auto-saving to the database.
- Boundary: keep low-level PaddleOCR MCP helper code for direct/manual OCR
  execution, but remove `run_file_ocr` from AI-visible provider tools and
  executable `executeSteelTool` dispatch.

Review - 2026-06-27:

- Removed `run_file_ocr` from Steel provider schemas, registry, executable
  dispatch, native/runtime tool policy, OAuth provider special handling, and
  ToolService file-to-tool plumbing.
- Updated OCR rules and canonical docs to explicitly require PaddleOCR MCP OCR
  (`PaddleOCR-VL-1.6` / `paddleocr_vl`) for PDF/image text and table parsing.
- Preserved assistant OCR Markdown persistence by saving detected OCR Markdown
  tables as current `ocr_extract` rows with `kind:
  "assistant_ocr_markdown"`; legacy `run_file_ocr` results no longer overwrite
  active OCR Markdown.
- Synced reviewed DB rules with
  `rtk node packages/api/scripts/sync-steel-rules.cjs --apply`; updated
  `steel-drawing-ocr-policy` source hash:
  `3ed2158f480c9c1a36e7d5b5d4dda9ba04797e9cc252955bd840f8e4e5743a1a`.
- Verification passed:
  `rtk npm run build` in `packages/api`;
  targeted Steel Jest suite, 12 suites / 112 tests;
  `rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand`,
  60 tests;
  `docs/reference/example/c.pdf` direct PaddleOCR MCP manual spec, 1 test;
  `rtk git diff --check`.

# Active: Markdown Table Cell Comments

Goal: add cell-level comments to expanded Markdown table modals so users can
mark table corrections, keep those comments visible as pending composer
context, and append the structured comments to the next chat turn without
changing normal chat layout, Markdown parsing output, Steel storage, or export
payloads.

Independent implementation plan:
`docs/plans/2026-06-27-markdown-table-cell-comments.md`.

Planning status:

- [x] Read project instructions, `CLAUDE.md`, RTK rule, current lessons, and
      the existing Markdown table modal implementation.
- [x] Locate the current table wrapper/modal surface:
      `client/src/components/Chat/Messages/Content/MarkdownTableActions.tsx`
      and `client/src/style.css`.
- [x] Locate the composer submit path:
      `client/src/components/Chat/Input/ChatForm.tsx`,
      `client/src/components/Chat/Input/SendButton.tsx`,
      `client/src/hooks/Messages/useSubmitMessage.ts`, and
      `client/src/hooks/Chat/useChatFunctions.ts`.
- [x] Confirm the open product questions below before implementation.
- [x] Write focused tests for formatter grouping, cell comment input behavior,
      inline comment display behavior, composer helper text, send-button
      enablement, and submit payload formatting.
- [x] Add the minimal shared pending-comment type/state.
- [x] Add modal-only cell comment controls and input popover.
- [x] Add composer helper text and make pending comments count as sendable
      content.
- [x] Add hover/focus preview on the composer helper showing the exact Markdown
      comments block that will be appended to the next user message.
- [x] Drain pending comments on fresh submit and append them after typed chat
      input text in stable Markdown format.
- [x] Make the modal cell comment input viewport-aware so it cannot overflow
      the visible browser window near modal/table edges.
- [x] Run targeted Jest tests, client typecheck, and `rtk git diff --check`.
- [x] Add review evidence here before wrap-up.

Proposed architecture:

- Keep this as a client-side pending-submit feature, similar to
  `pendingQuotesByConvoId` and `pendingManualSkillsByConvoId`.
- Add a typed Recoil atom family such as `pendingMarkdownTableCommentsByConvoId`
  keyed by conversation id. Each item should carry:
  - markdown identity: conversation id, assistant message id, assistant message
    timestamp label, content part index / markdown index within that message,
    table source fingerprint, and a user-visible markdown label. A rendered
    Markdown table is treated as one Markdown unit containing one table. The
    role is always AI for this feature and should not be included in the label.
  - cell identity: row index, column index, column header/field name, row label
    when available, and old cell value.
  - comment text: the user-entered correction or note.
- Treat `(markdown identity, row index, column index)` as a
  unique key. One cell can have only one pending comment; saving that cell again
  updates/replaces the existing comment instead of appending a second entry.
- Keep comment UI inside the expanded Markdown table modal only. Normal inline
  chat tables keep existing copy/download/expand behavior unchanged.
- Render a small top-right `MessageCircle` icon button inside each modal
  cell. Empty cells show the button only on cell hover/focus. Commented cells
  keep the button visible, show the comment text directly in the cell, and
  fade the original cell value.
- On click, open a compact text input/popover styled with existing LibreChat
  surface, border, text, and focus classes. Saving blank text removes that
  pending comment.
- Add a composer helper row below the textarea area, showing grouped counts such
  as `Markdown table comments: 2026-06-27 14:32 / Markdown 2: 2`.
  The helper must be localized through `useLocalize()`.
- Treat pending comments as submit content without mutating the visible textarea:
  update form validation/send-button logic to consider `pendingComments.length`
  so the user can send with no typed text.
- On fresh submit only, drain pending comments atomically in `useChatFunctions`
  or immediately before `ask()`, append formatted Markdown after the typed user
  text, then clear the pending queue. The composer helper text/count under chat
  input must disappear immediately after successful submit because the next turn
  has zero pending comments. Regenerate/edit/continue should not drain unrelated
  composer comments.

Proposed submit format:

```markdown
<typed user message, if any>

---

Markdown table comments:

### <message timestamp> / Markdown <m>

1. Cell: row <n>, column "<header>"
   Old value: <old cell value>
   Comment: <comment text>

2. Cell: row <n>, column "<header>"
   Old value: <old cell value>
   Comment: <comment text>

### <message timestamp> / Markdown <m>

1. Cell: row <n>, column "<header>"
   Old value: <old cell value>
   Comment: <comment text>

請依照以上 comments，分別輸出每個 Markdown 的完整新表格；不要只輸出修改過的 cell 或 row。
```

This format keeps comments model-visible as normal user text, ordered after the
typed message as requested, visible on the submitted user message, and avoids a
backend schema change in the first slice. Comments from the same
message/Markdown must be grouped under one heading before listing the cell-level
comments. The final instruction tells the AI to output each affected Markdown as
a separate complete updated table, not partial changed cells/rows.

Verification plan:

- Unit/UI tests in
  `client/src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx`:
  open modal, hover/focus a cell, add a comment, verify icon visibility and
  inline comment display, edit the same cell and verify it replaces the old
  comment rather than creating a duplicate, edit to blank, and verify removal.
- Composer tests in `client/src/components/Chat/Input/__tests__/...`: pending
  comments render helper text, enable send with empty textarea, and the helper
  text/count clears to zero immediately after submit.
- Submit-path tests in `client/src/hooks/Chat/__tests__/...` or
  `client/src/hooks/Messages/__tests__/useSubmitMessage.spec.ts`: typed text
  plus comments are appended in order; empty typed text still sends only the
  comment block; the submitted user message shows the appended comment list;
  comments from the same message/Markdown are grouped under one heading;
  multiple Markdown tables in the same message can be distinguished by their
  `Markdown <m>` labels; the final instruction asks for separate complete new
  tables for each affected Markdown; regenerate/edit/continue do not drain
  pending comments.
- Localization check: add only English keys in
  `client/src/locales/en/translation.json`.
- Run:
  - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx --runInBand --watch=false --coverage=false`
  - targeted composer/submit Jest tests added by the implementation
  - `cd client && rtk npm run typecheck`
  - `rtk git diff --check`

Locked decisions:

- User-visible labels use message timestamp plus Markdown index, e.g.
  `2026-06-27 14:32 / Markdown 2`; internal state still carries message id,
  part index or markdown index, and source fingerprint. The role is always AI
  and is not shown.
- The comment button appears only inside the expanded modal.
- Comment input is single-line. Enter and blur save; Escape cancels.
- Pending comments survive closing/reopening the modal and conversation
  navigation during the same app session, but successful chat submit clears the
  pending queue and the chat-input helper/count.
- Scope is all rendered Markdown tables, not only Steel/OCR/workbook-looking
  tables.
- The stored old cell value is the value at the moment the comment is created.
  If the AI replies with a complete updated Markdown table later, that reply is
  treated as the latest table.
- First version sends comments as appended normal user text, not separate
  message metadata. Therefore the submitted user message should visibly include
  the appended comments list.
- Submitted comments list must group comments by message/Markdown. Multiple
  comments from the same Markdown table appear under one
  `<message timestamp> / Markdown <m>` heading instead of repeating the label
  per cell.
- The appended comments list must end with an explicit instruction asking the AI
  to output complete updated tables separately for each affected Markdown.
- A single cell can have only one comment. Editing a commented cell replaces
  that cell's existing pending comment; clearing the input removes it.

Check-in - 2026-06-27:

- This is a planning-only pass. No implementation files were changed.
- The simple/elegant path is to reuse the existing pending-submit pattern and
  avoid backend schema work until there is a clear need to persist comment
  metadata beyond the next send.
- Implementation should stay additive to the current modal and composer paths,
  preserving existing table copy/download/XLSX behavior and normal LibreChat
  chat layout.
- User decisions locked on 2026-06-27: modal-only comment button, single-line
  Enter/blur-save input, Escape cancel, all Markdown tables in scope, old value
  captured at comment creation, pending comments retained only until successful
  submit, appended comments visible in the submitted user message, and comments
  grouped by message timestamp/Markdown in the appended list. Same-cell comments
  are one-to-one and use replace/remove semantics, not duplicate entries. The
  appended list ends by asking the AI to output each affected Markdown as a
  separate complete updated table. Role is not shown because comments only
  target AI Markdown tables.

Review - 2026-06-27:

- Added client-only `MarkdownTableComment` formatting helpers and Recoil
  pending state keyed by conversation.
- Added a Markdown table index provider so multiple tables in the same AI
  message label as separate `Markdown <n>` units while keeping the user-visible
  label as message timestamp plus Markdown index.
- Added modal-only cell comment controls inside expanded Markdown tables. The
  `MessageCircle` button stays hidden until hover/focus for empty cells, stays
  visible for commented cells, opens a single-line input, saves on Enter/blur,
  cancels on Escape, replaces same-cell comments, and removes the comment when
  saved blank.
- The comment controls use LibreChat shared UI components: `Button` for the
  icon action and `Input` for the compact single-line editor. Saved comments
  are rendered directly in the cell, while the original cell value is faded.
- Kept comment controls AI-only. User-authored Markdown tables can still use
  normal table actions, but they do not render cell comment buttons.
- Content-part messages now carry a Markdown table base index so multiple text
  parts in the same AI message keep distinct `Markdown <n>` labels.
- Added composer helper text grouped by message timestamp/Markdown label, and
  made pending comments count as sendable content without mutating the visible
  textarea.
- Pending Markdown table comments now persist to `localStorage` by conversation
  id, so refresh/back-forward mistakes do not drop the queue before submit.
- Fresh submits now drain pending Markdown table comments, append the grouped
  comments list after typed user text, and clear the helper/count plus
  `localStorage` entry for the next turn. Regenerate/edit/continue leave
  pending composer comments untouched.
- LibreChat now mounts a router-level browser unload warning independent of
  pending comments. It uses `beforeunload` only, so same-site route navigation
  stays uninterrupted.
- The submitted list ends with the locked instruction asking the AI to output
  each affected Markdown as a separate complete updated table.
- Verification:
  - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx src/components/Chat/Input/__tests__/SendButton.spec.tsx src/components/Chat/Messages/Content/table/comments.test.tsx src/common/markdown.test.ts src/hooks/Messages/__tests__/useSubmitMessage.spec.ts src/hooks/Chat/__tests__/useChatFunctions.regenerate.spec.tsx --runInBand --watch=false --coverage=false` passed: 7 suites, 36 tests.
  - `cd client && rtk npm run typecheck` passed.
  - `cd client && rtk npm run build:ci` passed, with existing Vite/PWA warnings
    about direct eval in `vm-browserify`, large chunks, and missing icon globs.
  - `rtk git diff --check -- <markdown-comment-related files>` passed.
  - `git diff --no-index --check /dev/null <new markdown-comment files>` passed
    for untracked/new files.
  - Follow-up UI correction removed saved-comment hover popups in favor of inline
    cell comment text with faded original values. `cd client && rtk npx jest
    src/components/Chat/Messages/Content/table/comments.test.tsx
    src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx
    --runInBand --watch=false --coverage=false` passed: 2 suites, 19 tests.
    `cd client && rtk npm run typecheck` passed.
  - Follow-up data-loss protection added `localStorage` persistence for pending
    comments and a global browser-unload-only LibreChat leave warning.
    `cd client && rtk npx jest
    src/components/System/__tests__/LeaveSiteWarning.test.tsx
    src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx
    src/common/markdown.test.ts src/routes/__tests__/skillsRoutes.spec.tsx
    --runInBand --watch=false --coverage=false` passed: 4 suites, 13 tests.
    `cd client && rtk npm run typecheck` passed.
  - Follow-up route-navigation correction keeps the global leave warning on
    browser unload only, so same-site route changes such as `/c` to `/c/:id` do
    not prompt. `cd client && rtk npx jest
    src/components/System/__tests__/LeaveSiteWarning.test.tsx
    src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx
    src/common/markdown.test.ts src/routes/__tests__/skillsRoutes.spec.tsx
    --runInBand --watch=false --coverage=false` passed: 4 suites, 13 tests.
    `cd client && rtk npm run typecheck` passed. `rtk git diff --check` passed
    for the leave-warning correction files.
  - Follow-up viewport correction moved the cell comment editor from
    cell-relative absolute positioning into a Radix Popover portal with
    collision padding. This reuses the existing LibreChat/Radix positioning
    pattern so the input can shift/flip inside the viewport near modal/table
    edges. `cd client && rtk npx jest
    src/components/Chat/Messages/Content/table/comments.test.tsx
    src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx
    --runInBand --watch=false --coverage=false` passed: 2 suites, 20 tests.
    `cd client && rtk npm run typecheck` passed. `rtk git diff --check` passed
    for the viewport correction files.
  - Follow-up blur-save correction handles Radix Popover outside-dismiss as a
    save path, so clicking away from the comment editor preserves the draft just
    like input blur. Enter, blur, and outside-dismiss are guarded against
    duplicate commits, while Escape still cancels. `cd client && rtk npx jest
    src/components/Chat/Messages/Content/table/comments.test.tsx
    src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx
    --runInBand --watch=false --coverage=false` passed: 2 suites, 21 tests.
  - Follow-up composer helper correction keeps the helper line as grouped
    counts but shows the exact appended Markdown comments block on hover/focus,
    using the same formatter as submit. `cd client && rtk npx jest
    src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx
    --runInBand --watch=false --coverage=false` passed: 1 suite, 4 tests.
    `cd client && rtk npx jest
    src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx
    src/common/markdown.test.ts
    src/hooks/Messages/__tests__/useSubmitMessage.spec.ts --runInBand
    --watch=false --coverage=false` passed: 3 suites, 16 tests. `cd client &&
    rtk npm run typecheck` passed. `rtk git diff --check` passed for the helper
    preview correction files.

# Active: Markdown Table Modal UX

Goal: improve Markdown table review in the expanded modal by making large
tables easier to scan without changing Markdown parsing, Steel storage, export
payloads, or normal chat layout.

Plan:

- [x] Add focused frontend tests for zebra rows, sticky header cells, and the
      selected sticky-left modal column.
- [x] Read table headers from the rendered modal table and add a selector UI
      that can pin one header column to the left.
- [x] Style expanded Markdown tables with alternating row backgrounds, sticky
      header row, and sticky selected column with readable overlap layering.
- [x] Run targeted Jest tests, frontend typecheck, and `git diff --check`.
- [x] Add review evidence here before wrap-up.

Check-in - 2026-06-27:

- Scope is limited to the existing Markdown table action/modal component and
  stylesheet.
- No backend, parser, export, database, or Steel business-rule contracts should
  change.
- Selector applies only in the expanded modal so normal chat table rendering
  remains lightweight.

Review - 2026-06-27:

- Expanded Markdown table modals now render zebra data rows and apply sticky
  header styling for the header row.
- Modal cell colors now use a localized light/dark palette for odd/even rows,
  header cells, and pinned columns so large tables scan more clearly.
- Sticky selected columns no longer change cell color; the selected column now
  keeps the row background and uses only a subtle divider/shadow. Zebra row
  contrast was reduced.
- Added a modal-only column selector populated from rendered table header text.
  Selecting a header pins that column to the left; selecting the empty option
  clears pinned-column state.
- Replaced the modal selector's native `<select>` with LibreChat's shared
  `ControlCombobox`, matching the Agent Builder category selector style and
  keeping searchable column selection.
- Fixed the selector popup not appearing inside the Markdown modal. Root cause:
  `ControlCombobox` portals its popover to `body` with the default `z-40`, which
  rendered behind the `z-index: 1000` modal. `ControlCombobox` now accepts a
  scoped `popoverClassName`, and the Markdown modal selector uses
  `markdown-table-selector-popover` at `z-index: 1001`.
- Simplify pass:
  - Reused one normalized cell-text helper for copy, selector headers, and wide
    column detection.
  - Removed duplicate JS row striping/header-sticky class ownership and left
    those static table styles to CSS selectors.
  - Split static modal table decoration from sticky-column updates so changing
    the pinned column no longer recomputes long-column widths.
  - Avoided building modal-only sticky selector labels/items in collapsed table
    toolbars.
  - Tightened the Markdown table combobox mock so selector options only appear
    after the trigger is clicked.
- Kept copy Markdown and XLSX download behavior on the rendered table matrix,
  so export output remains unchanged.
- Verification:
  - `cd packages/client && rtk npx jest src/components/ControlCombobox.spec.tsx --runInBand --watch=false --coverage=false` passed: 1 suite, 8 tests.
  - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx --runInBand --watch=false --coverage=false` passed: 1 suite, 9 tests.
  - `cd client && rtk npm run typecheck` passed.
  - `rtk git diff --check` passed.

Previous active work:

# Active: Simplify Steel Native And OAuth Latest Changes

Goal: review and simplify every module/file changed by
`cfc463093b2178e8a921de91d26^..HEAD`, covering commits `cfc463093`,
`c38550e2`, `f3b64adf`, and `3bf4f51d`, without changing public APIs,
runtime contracts, database schema contracts, route payloads, event names, or
Steel business rules.

Target:

- Git range: `cfc463093b2178e8a921de91d26^..HEAD`.
- Scope size: 198 changed files, including docs/task cleanup, Steel native
  backend modules, OpenAI OAuth provider modules, frontend Steel/OAuth UI, SSE
  activity handling, data-provider contracts, E2E/mock fixtures, and focused
  tests.
- Constraints: no branch checkout/rebase/reset, no Prettier, preserve public
  APIs and externally visible behavior, prefer deletion/local simplification
  over new layers.

Plan:

- [x] Read repo instructions, `CLAUDE.md`, RTK rules, current lessons, and the
      `/simplify` skill.
- [x] Identify the exact changed-file target from the requested commits.
- [x] Run three focused review passes for code reuse, code quality, and
      efficiency across the target.
- [x] Consolidate findings and inspect the directly affected code before each
      edit.
- [x] Apply local simplifications, deletions, and cleanup where benefit clearly
      exceeds risk.
- [x] Run targeted tests/build checks plus `git diff --check`; fix regressions
      caused by this work.
- [x] Add a review/results section here with what changed, what was skipped,
      and verification evidence.

Check-in - 2026-06-26:

- This is a non-trivial simplify pass over the current `steel/v8.3` HEAD.
- I will use the commit range itself as the explicit review target, not the
  current working-tree diff.
- I will not resurrect deleted planning docs or task packages unless a live
  code/doc reference proves a deletion broke the current entrypoint contract.
- I will treat existing Steel lessons as active constraints: native work starts
  from the master framework, compact workbook/read_markdown contracts stay
  intact, OpenAI OAuth names avoid new Steel prefixes, and no Prettier runs.

Review - 2026-06-26 simplify pass:

- Reviewed the full requested range `cfc463093^..HEAD` and applied local
  simplifications in the changed Steel native/OAuth/backend/client/E2E test
  surface without changing public event names, route payloads, workbook
  contracts, database schema, or Steel business rules.
- Removed duplicated Steel native text extraction in OpenAI Chat Completions and
  Responses controllers by using the shared `extractSteelNativeMarkdownText`
  helper, with tests for nested text payloads.
- Removed attachment prompt pollution from `ChatForm`: file uploads no longer
  prefill the visible OCR default prompt, while the submit fallback still
  supports file-only OCR submission.
- Preserved graph system context after OpenAI OAuth tools are bound, ignored
  invalid image URLs instead of throwing during prompt conversion, and added
  best-effort stream cancellation for early-exit provider/native OAuth readers.
- Reworked OpenAI OAuth usage caching so cache entries are keyed by auth file,
  unavailable auth responses are short-cached, and concurrent usage lookups are
  coalesced.
- Cached native Steel tool JSON schema conversion by tool name instead of
  converting schemas on every request.
- Tightened Steel saved-count event validation to finite positive numbers and
  raised the client activity retention cap from 12 to 100 events.
- Simplified Markdown table action state by clearing timers on unmount and only
  attaching the theme observer while the expanded table modal is open.
- Consolidated repeated Playwright mock upload helpers into
  `e2e/specs/mock/helpers.ts` and replaced the fixed upload sleep with a
  deterministic wait for the uploaded file chip.
- Removed the dead `contextMode: 'compact_workbook'` argument from
  `ToolService`.
- Items intentionally not folded into this simplify pass because they need a
  separate contract or data-model migration guardrail: moving the shared Steel
  SSE event contract into data-provider, adding global-rule TTL/invalidation
  caching, making delete/insert rule writes transactional/versioned, and
  redesigning the client Steel activity atom-family registry.

Verification:

- `packages/api`: `rtk npx jest src/steel/native/oauth.spec.ts
  src/steel/native/usage.spec.ts src/steel/native/events.spec.ts
  src/steel/native/tools.spec.ts src/steel/ai/provider.spec.ts
  --coverage=false --runInBand ...` passed: 5 suites, 42 tests.
- `api`: `rtk npx jest
  server/controllers/agents/__tests__/openai.spec.js
  server/controllers/agents/__tests__/responses.unit.spec.js
  server/services/__tests__/ToolService.spec.js --coverage=false --runInBand
  ...` passed: 3 suites, 97 tests.
- `client`: `rtk npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx
  src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx
  src/hooks/Messages/__tests__/useSubmitMessage.spec.ts
  src/components/Chat/Input/__tests__/SendButton.spec.tsx --runInBand
  --watch=false --coverage=false` passed: 4 suites, 19 tests.
- `rtk npm run build:api` passed.
- `client`: `rtk npm run typecheck` passed.
- `rtk npx tsc --noEmit --pretty false --skipLibCheck --esModuleInterop
  --moduleResolution node --target es2022 --module commonjs
  e2e/specs/mock/helpers.ts e2e/specs/mock/chat.spec.ts
  e2e/specs/mock/steel-native.spec.ts` passed.
- `client`: `rtk npm run build` passed; existing direct-eval, large-chunk, and
  PWA glob warnings remain build warnings.
- `git diff --check` passed.

Previous completed work:

# Active: Compact Steel Runtime And Markdown Table Actions

Goal: make compact workbook the only Steel runtime mode so `read_markdown` is
always available, prove compact context is not the full workbook payload, and
add Markdown table actions for copy, XLSX download, and full-viewport review
without changing LibreChat's broader layout.

Plan:

- [x] Remove runtime mode switching from Steel context/tool exposure and keep
      compact workbook behavior as the only path.
- [x] Verify serialized compact context contains sheet row counts/anchors, not
      complete workbook rows, and capture an example for user review.
- [x] Add assistant Markdown table controls above rendered tables: copy
      Markdown, download XLSX, and expand.
- [x] Add a full-viewport table modal with the same copy/download actions and a
      close control.
- [x] Add focused runtime/frontend regression tests and run builds/checks.
- [x] Record review evidence and lessons.

Review - 2026-06-26 compact runtime and Markdown table actions:

- Steel runtime context is now compact-only. `PrepareSteelRuntimeContextInput`
  no longer accepts `mode`; handler/native context no longer pass
  `runtimeContextMode`; registry/native/provider tool surfaces no longer accept
  `contextMode` switches.
- `read_markdown` is always in the AI-visible Steel tool surface:
  `search_customers`, `search_price_candidates`, `run_file_ocr`,
  `read_markdown`.
- Serialized compact context example shape:

```json
{
  "outputSheets": {
    "contextMode": "compact_workbook",
    "previousOutputSheets": {
      "system_order": { "sheetId": "system_order", "rowCount": 1 },
      "customer_quote": { "sheetId": "customer_quote", "rowCount": 1 }
    },
    "compactWorkbook": {
      "sheets": {
        "system_order": {
          "sheetId": "system_order",
          "rowCount": 1,
          "rows": [
            {
              "rowId": "system_order:1",
              "rowIndex": 1,
              "anchors": {
                "項次": "1",
                "型號": "CCG075",
                "品名規格": "錏輕型鋼 75x45"
              }
            }
          ]
        }
      },
      "unresolvedCount": 1
    }
  }
}
```

- This is not the workbook Markdown and not the full workbook rows. Runtime
  tests prove serialized context omits full `cells`, `derivedIndex`, and the
  fixture-only value `full-row-only-note`.
- Markdown tables now render with action buttons above the table: copy Markdown,
  download XLSX, and expand. Expanded table opens a full-viewport modal with
  copy/download/close controls and explicitly syncs the root theme class and
  `data-theme`.
- Updated `docs/rules/agent規則.txt` and
  `docs/steel-native-librechat-master-framework.md` to describe compact-only
  runtime behavior.
- Verification:
  - `cd packages/api && rtk npx jest src/steel/runtime/context.spec.ts src/steel/tools/registry.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts --coverage=false --runInBand` passed: 69 tests.
  - `cd client && npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx --runInBand --watch=false --coverage=false` passed: 7 tests.
  - `rtk npm run build:api` passed.
  - `cd client && rtk npm run typecheck` passed.
  - `cd client && rtk npm run build` passed; Vite reported existing eval,
    large chunk, and PWA glob warnings.
  - `git diff --check` passed.
  - Backend dev server restarted and `http://localhost:3080/health` returned
    `OK`.

Previous completed work:

# Active: OpenAI OAuth Native Chat Follow-Up

Goal: align the native `/c` OpenAI (OAuth) Steel quote flow with the user
corrections from the UI smoke: OAuth context accounting must use the 258K
provider limit, chat Markdown tables must be readable for OCR/system_order
workbooks, and database rules must match `docs/rules`.

Plan:

- [x] Root-cause the 947.6K context-window display and patch the shared token
      lookup path so OpenAI (OAuth) uses a 258K context source.
- [x] Add focused token-config/runtime tests proving OAuth context accounting
      no longer inherits the normal OpenAI gpt-5.5 1M window.
- [x] Widen native chat Markdown table cells and preserve horizontal scrolling
      without changing LibreChat's page layout.
- [x] Compare `steel.rules` readback with `docs/rules`, apply the existing
      sync script only where mismatched, and read back evidence.
- [x] Simplify native Steel rule prefix sections so each prompt rule section
      maps to a `docs/rules/*.txt` source in `steel.rules`.
- [x] Remove empty/legacy native prompt sections that are not DB-backed rules:
      `reviewed_agent_rules`, `instruction_packets`, and prompt-level
      `tool_policy`.
- [x] Rename `quote_defaults_and_rules` to the shorter `quote_rules`.
- [x] Rename `createSteelNativeRuntimeContextDependencies` to the shorter
      `createSteelContextDependencies`.
- [x] Rebuild/restart only what changed and run focused verification.

Review - 2026-06-26 rules and native context:

- Cloud `steel.rules` now matches all 8 repo rule files under `docs/rules`:
  `agent規則.txt`, `輸出規則.txt`, `其他規則/OCR規則.txt`, and the five
  `鋼材規則/*.txt` files.
- Native prompt prefix now has only DB-backed rule sections:
  `agent` = 1, `quote_rules` = 5, `output` = 1, `other` = 1.
- Removed native prompt sections that were misleading or empty:
  `reviewed_agent_rules` was a duplicate of the agent rule, `instruction_packets`
  points at a legacy cloud table that does not exist, and prompt-level
  `tool_policy` was runtime executable configuration rather than a rule txt.
- `quote_defaults_and_rules` is now `quote_rules`.
- `createSteelNativeRuntimeContextDependencies()` is now
  `createSteelContextDependencies()`. Built exports include the new function and
  no longer export the old long name.
- Runtime `toolPolicy` is still used as backend executable configuration and is
  serialized in runtime JSON, not as a prompt rule section. Current values:
  - visible tools: `search_customers`, `search_price_candidates`,
    `run_file_ocr`, `read_markdown`.
  - removed tools: none.
  - OCR correction policy: user OCR/table corrections update complete Markdown
    directly; do not call `run_file_ocr` again unless the user explicitly asks
    to rerun OCR or provides new/changed file evidence.
  - `read_markdown` usage policy: use only when history lacks complete
    OCR/workbook Markdown; forbid when history already has needed Markdown;
    allowed scopes are `workbook` and `ocr`; always active-conversation scoped.
- DB row `tool_policy` metadata readback:
  - `steel-default-agent-instruction`: available tools
    `search_customers`, `search_price_candidates`, `run_file_ocr`,
    `read_markdown`.
  - `steel-workbook-output-policy`: same available tools.
  - `steel-drawing-ocr-policy`: `run_file_ocr`, required before
    drawing evidence extraction, must mark low confidence.
  - five steel quote rules: empty `tool_policy`.
- No new txt file is needed for runtime `toolPolicy`: the AI-facing behavior is
  already present in `docs/rules/agent規則.txt`, `docs/rules/輸出規則.txt`, and
  `docs/rules/其他規則/OCR規則.txt`; the remaining runtime field controls actual
  backend tool exposure and should stay code-owned.
- Verification:
  - `cd packages/api && rtk npx jest src/steel/native/context.spec.ts src/steel/native/metadata.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts --coverage=false --runInBand` passed with 24 tests.
  - `rtk npm run build:api` passed.
  - Built-dist smoke confirmed 8 rule markers are present in prompt, sections
    are `agent`, `quote_rules`, `output`, `other`, prompt `Steel Tool Policy`
    is absent, and `instructionPackets` is absent from runtime prompt text.
  - `git diff --check` passed.
  - `curl http://localhost:3080/health` returned `OK`.
  - A direct `tsc --noEmit` remains blocked by existing repo-wide type issues
    in unrelated Redis/manual-spec/OAuth test files; package build still passes.

Previous completed work:

# OpenAI OAuth Native Chat Runtime Bugfix

Goal: fix the native `/c` OpenAI (OAuth) path so a user can attach
`docs/reference/example/PL.pdf`, run OCR, see the OCR table, confirm it, and
let the AI continue into quotation without the LangChain graph rejecting the
OAuth model adapter.

Plan:

- [x] Reproduce the reported `Expected a Runnable, function or object` error
      with a focused native OAuth graph pipeline test.
- [x] Make the OpenAI OAuth model and graph model conform to LangChain
      `Runnable` so native system context piping works.
- [x] Run focused OAuth/runtime regression tests.
- [x] Check API build and whitespace/diff sanity.
- [x] Record review evidence and any lessons learned.

Review - 2026-06-26 OpenAI OAuth native chat runtime:

- Root cause: `createOpenAIOAuthModel()` / `createOpenAIOAuthGraphModel()`
  returned plain class instances with `invoke()` and `stream()`, but LibreChat
  agents calls `AgentContext.systemRunnable.pipe(model)`. LangChain only accepts
  real `Runnable` instances, functions, or runnable maps, so the native `/c`
  OAuth path failed with `Expected a Runnable, function or object`.
- Fix: `OpenAIOAuthModel` and `OpenAIOAuthGraphModel` now extend LangChain
  `Runnable`, keep `bindTools()` behavior, and implement streaming through
  `_streamIterator()`.
- Follow-up fix: `OpenAIOAuthGraphModel` can apply the native agent
  `systemRunnable` itself when LibreChat invokes `overrideModel` directly,
  preserving native Steel context/rules without changing the LibreChat UI/UX
  layout.
- Regression coverage:
  - `cd packages/api && npx jest src/steel/native/oauth.spec.ts --coverage=false --runInBand --testNamePattern "system context runnable"` first reproduced the reported unsupported-type error, then passed after the fix.
  - `cd packages/api && npx jest src/steel/native/oauth.spec.ts src/steel/native/title.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand` passed with 73 tests.
  - `cd api && npx jest server/controllers/agents/client.test.js --coverage=false --runInBand` passed with 87 tests.
  - `npm run build:api` passed after adding explicit `lc_namespace: string[]`
    declarations.
  - `git diff --check` passed.

Follow-up - 2026-06-26 live retry:

- User retried `/c` and still saw `Expected a Runnable, function or object`.
  Root cause of the retry: the backend on port 3080 was still the old
  `api/server/index.js` child process started at 16:31, before the fixed
  `@librechat/api` dist was built.
- Restarted the actual 3080 backend process. New startup reached readiness at
  `2026-06-26T08:58:22Z`, and `curl http://localhost:3080/health` returned
  `OK`.
- Runtime package smoke verified the built `createOpenAIOAuthGraphModel()` is
  `lc_runnable: true` and can be piped by
  `@librechat/agents/langchain/runnables`.
- Real DB native context smoke against `.env` `STEEL_POSTGRES_URL` succeeded:
  the current schema uses `steel.rules` / `steel.prices`, not legacy
  `steel.agent_rules` / `steel.quote_defaults`; native context fail-opened the
  missing legacy tables and loaded 5 quote/steel rules, 1 output rule, and 1
  OCR/other rule.
- Full live smoke passed:
  `cd packages/api && NODE_OPTIONS=--experimental-vm-modules STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_TIMEOUT_MS=900000 npx jest --coverage=false --runInBand --runTestsByPath src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --testPathIgnorePatterns 'a^'`
  passed in 192.38s.
- Live evidence file:
  `tmp/steel-native-openai-oauth-pl-pdf-quote-live-evidence.json`
  shows first turn called `run_file_ocr` on `PL.pdf` and returned an OCR
  confirmation table; confirmed quote turn did not rerun OCR, called
  `search_price_candidates`, and returned `system_order`, `customer_quote`, and
  `manual_review` Markdown tables.
- After the restart, scanning `api/logs/error-2026-06-26.log` from
  `2026-06-26T08:58:14Z` found zero new matches for
  `Expected a Runnable`, `generateOpenAIOAuthTitle is not a function`, or
  `Missing credentials`.

Previous completed work:

# Phase 14 OpenAI OAuth UI Provider And Usage Remaining

Goal: add a first/default `OpenAI (OAuth)` provider option to the normal
LibreChat model selector and show ChatGPT OAuth usage remaining under the OAuth
model list without changing the existing LibreChat UI layout or duplicating
Steel tool/OCR/quote flows.

Follow-up goal: allow a file-only chat submit by auto-filling the native
composer with the Steel OCR review prompt when attachments are present and the
message text is empty.

Plan:

- [x] Research how the local `openai-oauth-provider` can retrieve usage
      remaining.
- [x] Add focused backend tests for OAuth usage parsing, sanitization, caching,
      and unavailable-state behavior.
- [x] Add shared data-provider types/endpoints for sanitized OAuth usage
      remaining.
- [x] Add a thin authenticated backend route that calls ChatGPT WHAM OAuth
      usage with the bearer token and returns only UI-safe remaining/reset data.
- [x] Add `OpenAI (OAuth)` as the first/default model-provider UI option while
      reusing the shared Steel native context/tools/OCR/quote modules.
- [x] Add Usage remaining rows under the OAuth model list only, with loading and
      unavailable states.
- [x] Run focused Jest tests, data-provider build, frontend build or smoke
      checks, backend restart if needed, and `git diff --check`.
- [x] Record review evidence.
- [x] Auto-fill the composer with `OCR檔案內容，逐一列表給我核對。` when a file
      is attached and the text area is empty.
- [x] Let the send button submit when attachments exist even if text is still
      empty.
- [x] Add a submit-time fallback so keyboard/programmatic submits send the same
      default prompt with file-only messages.
- [x] Add focused regression tests and run client checks.
- [x] Fix `OpenAI (OAuth)` native chat runtime so SDK graph creation does not
      fall back to the API-key OpenAI client without the OpenAI OAuth override.
- [x] Disable unsupported OAuth title generation until the title path has its
      own OAuth-backed model.
- [x] Add focused regression tests for the OAuth graph override and title skip.
- [x] Rebuild/verify backend packages and restart the local backend for testing.
- [x] Implement OAuth-backed title generation for `OpenAI (OAuth)` without
      using the normal API-key OpenAI title path.
- [x] Add focused regression tests for OAuth title generation, usage recording,
      and prompt isolation from Steel runtime context.
- [x] Rename generic OpenAI OAuth transport/model/title symbols so they no
      longer use `Steel` as a prefix.
- [x] Keep `Steel` naming only for quote/OCR/rules/context/tooling modules and
      behavior, while preserving external provider ids/routes/UI labels.
- [x] Run focused OAuth/title/runtime tests, API build, and health checks after
      the rename.

Research lock:

- The local `openai-oauth-provider` package exposes `loadAuthTokens()` and
  wraps ChatGPT Codex Responses calls, but it does not expose a public usage
  helper.
- The live-verified usage endpoint is
  `GET https://chatgpt.com/backend-api/wham/usage` with the Codex OAuth bearer
  access token. The previously assumed `/backend-api/codex/usage` returns 403.
- The response contains `rate_limit.primary_window` and
  `rate_limit.secondary_window` with `used_percent`, `limit_window_seconds`,
  `reset_after_seconds`, and `reset_at`. UI remaining percent is
  `100 - used_percent`.
- A 5-hour primary window maps to the screenshot's `5h` row, and the 604800
  second secondary window maps to the weekly row.
- Backend responses must not expose OAuth access tokens, refresh tokens,
  account IDs, emails, auth file paths, or raw ChatGPT usage JSON. The frontend
  receives only sanitized window labels, remaining/used percentages, reset
  timestamps, and availability metadata.
- Usage fetch is best-effort and should be cached briefly in backend memory so
  opening the model selector does not hammer the OAuth endpoint.
- This is provider/model UI work only. Steel tools, OCR, quote parsing, runtime
  context, and Markdown recovery remain the shared native Steel modules.

Review - 2026-06-26:

- Added normal LibreChat endpoint support for `openai_oauth_responses` as
  `OpenAI (OAuth)`, first in the default endpoint list and backed by the
  existing native OpenAI OAuth provider path.
- Added a sanitized authenticated route at `/api/steel/ai/oauth-usage`. It uses
  `openai-oauth-provider` only to load/refresh the local Codex OAuth token,
  calls live-verified `https://chatgpt.com/backend-api/wham/usage`, caches the
  result briefly, and returns only `remainingPercent`, `usedPercent`, window
  seconds, reset timestamps, and availability metadata.
- Added shared data-provider usage schemas, endpoint keys, data-service method,
  and React Query hook.
- Added a small `Usage remaining` footer under the OAuth model list only. It
  keeps the existing selector layout and shows the 5h/weekly windows with
  loading/unavailable states.
- Live sanitized probe from the built API returned `chatgpt_wham_usage` with
  available primary and secondary windows; no token/account/email/auth path was
  printed.
- Verification:
  - `npm run build:data-provider` passed.
  - `cd packages/api && npx jest src/steel/native/usage.spec.ts src/endpoints/openai/oauth.spec.ts src/steel/native/provider.spec.ts --coverage=false --runInBand` passed with 10 tests.
  - `cd packages/data-provider && npx jest src/config.spec.ts src/steel/ai.spec.ts --coverage=false --runInBand` passed with 130 tests.
  - `cd api && npx jest server/routes/__tests__/steel.spec.js --coverage=false --runInBand` passed with 13 tests.
  - `cd client && npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx src/utils/__tests__/getDefaultEndpoint.test.ts --coverage=false --runInBand` passed with 5 tests.
  - `npm run build:api` passed.
  - `cd client && npm run typecheck` passed.
  - `npm run build:client` passed with existing Vite/PWA warnings about
    `vm-browserify` eval, large chunks, and unmatched icon glob patterns.
  - `git diff --check` passed.

Correction - 2026-06-26:

- The original `OpenAI` API-key endpoint must remain visible separately from
  `OpenAI (OAuth)`. When `OPENAI_API_KEY` is not set server-side, it should
  fall back to LibreChat's existing user-provided key mode so the selector can
  open the API-key settings dialog.
- `Usage remaining` should not hide all failure modes behind a plain
  `Unavailable` label. The UI now surfaces the sanitized backend reason and
  retries unavailable usage checks while the OAuth model list is open.
- Added focused regression coverage for the OpenAI API-key fallback and the
  OAuth usage unavailable reason label.
- Follow-up: the OpenAI API-key fallback also had to be wired into the runtime
  `initializeOpenAI()` path. Without `OPENAI_API_KEY=user_provided`, the UI
  could save a user key but the runtime would not read it. `initializeOpenAI()`
  now treats a missing `OPENAI_API_KEY` for the original `OpenAI` endpoint as
  user-provided, matching the selector config fallback.
- File-only submit follow-up: when the user attaches a file and the composer is
  empty, native LibreChat now auto-fills `OCR檔案內容，逐一列表給我核對。`. The send
  button also treats attached files as submit-ready, and `useSubmitMessage()`
  applies the same default prompt as a submit-time fallback for keyboard or
  programmatic submits.
- Verification:
  - `cd api && npx jest server/services/Config/__tests__/EndpointService.spec.js server/services/Config/loadDefaultEConfig.spec.js server/routes/__tests__/steel.spec.js --coverage=false --runInBand` passed with 23 tests.
  - `cd client && npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx src/utils/__tests__/getDefaultEndpoint.test.ts --coverage=false --runInBand` passed with 5 tests.
  - `cd packages/api && npx jest src/endpoints/openai/initialize.spec.ts src/endpoints/openai/oauth.spec.ts --coverage=false --runInBand` passed with 11 tests.
  - `cd api && npx jest server/services/Config/__tests__/EndpointService.spec.js server/services/Config/loadDefaultEConfig.spec.js --coverage=false --runInBand` passed with 10 tests.
  - `cd client && npx jest src/hooks/Messages/__tests__/useSubmitMessage.spec.ts src/components/Chat/Input/__tests__/SendButton.spec.tsx src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx src/utils/__tests__/getDefaultEndpoint.test.ts --coverage=false --runInBand` passed with 11 tests.
  - `npm run build:api` passed.
  - `cd client && npm run typecheck` passed after the file-only submit changes.
  - `npm run build:client` passed with the same Vite/PWA warnings already
    noted above.
  - Built API live usage probe returned `status: available`,
    `source: chatgpt_wham_usage`, primary remaining 56%, and weekly remaining
    51%.

Correction - 2026-06-26 runtime:

- Root cause of the `Missing credentials` error: native chat correctly mapped
  `openai_oauth_responses` to SDK provider `openAI`, but the Steel OAuth
  override was checking the mapped graph `provider` instead of the original
  initialized agent endpoint/provider. The SDK then initialized the normal
  OpenAI client without an API key.
- `createRun()` now decides whether to attach the OpenAI OAuth graph override
  from the original initialized agent (`endpoint` or `provider` equals
  `openai_oauth_responses`) while leaving the SDK graph provider as `openAI`.
- Auto title generation initially had to avoid `run.generateTitle()` because it
  constructs a normal title LLM from provider/options and does not use the Steel
  OAuth override model.
- Verification:
  - `cd packages/api && npx jest src/agents/__tests__/run-summarization.test.ts src/endpoints/openai/oauth.spec.ts --coverage=false --runInBand` passed with 66 tests.
  - `cd api && npx jest server/controllers/agents/client.test.js --coverage=false --runInBand` passed with 87 tests.
  - `npm run build:api` passed.
  - `curl -sS http://localhost:3080/health` returned `OK`.
  - Built `packages/api/dist/index.cjs` contains the new `sourceAgent` OAuth
    override path, and nodemon restarted the backend at `16:08:19`.
  - `git diff --check` passed.

Correction - 2026-06-26 OAuth title:

- Added `generateOpenAIOAuthTitle()` in `packages/api/src/steel/native`.
  It uses the existing `openai-oauth-provider` transport through
  `createOpenAIOAuthModel()` and returns only title text plus usage
  metadata.
- `AgentClient.titleConvo()` now routes `OpenAI (OAuth)` title generation to
  that helper instead of `run.generateTitle()`. The normal API-key OpenAI title
  path is still used for the original `OpenAI` endpoint and other providers.
- The OAuth title prompt uses only the current user text, assistant text parts,
  and title prompt/template settings. It does not inject Steel runtime context,
  workbook/OCR state, or tools.
- Verification:
  - Red tests failed before implementation:
    `cd packages/api && npx jest src/steel/native/title.spec.ts --coverage=false --runInBand`
    failed because `./title` did not exist; `cd api && npx jest server/controllers/agents/client.test.js --coverage=false --runInBand --testNamePattern "OpenAI OAuth title"`
    failed because the OAuth branch returned `undefined`.
  - `cd packages/api && npx jest src/steel/native/title.spec.ts src/steel/native/oauth.spec.ts --coverage=false --runInBand` passed with 6 tests.
  - `cd api && npx jest server/controllers/agents/client.test.js --coverage=false --runInBand` passed with 87 tests.
  - `npm run build:api` passed.
  - Built `packages/api/dist/index.cjs` and `packages/api/dist/index.d.cts`
    export `generateOpenAIOAuthTitle`.
  - Nodemon restarted the backend and readiness checks passed at `16:19:00`.

Correction - 2026-06-26 OpenAI OAuth naming:

- Renamed generic OAuth transport/model/title symbols away from `Steel`:
  `createOpenAIOAuthModel()`, `OpenAIOAuthModel`,
  `createOpenAIOAuthGraphModel()`, `OpenAIOAuthGraphModel`,
  `generateOpenAIOAuthTitle()`, and the OpenAI OAuth graph override helpers.
- Renamed OpenAI OAuth config and usage helper symbols away from `Steel`:
  `parseOpenAIConfig()`, `resolveOpenAIOAuthAuthFilePath()`,
  `OpenAIOAuthUsageRemaining`, `getOpenAIOAuthUsage()`, and
  `useGetOpenAIOAuthUsageQuery()`.
- Preserved external contracts: provider id remains `openai_oauth_responses`,
  UI label remains `OpenAI (OAuth)`, usage URL remains
  `/api/steel/ai/oauth-usage`, and legacy `STEEL_OPENAI_*` env names remain as
  fallback aliases. `.env.example` now documents the preferred `OPENAI_*`
  names.
- Restored `steelProviderMetadata` after the broad rename pass; that metadata
  still belongs to Steel structured response state, not generic OAuth provider
  transport.
- Verification:
  - `cd packages/api && npx jest src/steel/ai/config.spec.ts src/steel/native/oauth.spec.ts src/steel/native/title.spec.ts src/steel/native/usage.spec.ts src/agents/__tests__/run-summarization.test.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand` passed with 6 suites / 98 tests.
  - `cd api && npx jest server/controllers/agents/client.test.js server/routes/__tests__/steel.spec.js --coverage=false --runInBand` passed with 2 suites / 100 tests.
  - `cd client && npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --coverage=false --runInBand` passed with 3 tests.
  - `npm run build:api` passed.
  - `cd packages/data-provider && npm run build` passed and rebuilt the shared
    dist/type exports.
  - `cd client && npm run typecheck` passed.
  - `git diff --check` passed.
  - `curl -sS http://localhost:3080/health` returned `OK`.
  - `curl -I -sS http://localhost:3090` returned `HTTP/1.1 200 OK`.
  - Targeted grep over source/client/server files found no remaining old
    Steel-prefixed OpenAI OAuth model/title/usage/config helper names, and no
    accidental provider metadata rename.

# Active: search_price_candidates Material Keyword Lookup

Goal: make `search_price_candidates` treat lookup `material` as a material
keyword, with query-facing material choices simplified to oral lookup terms.

Plan:

- [x] Write failing schema/repository tests for simplified material keywords while keeping
      import storage variants unchanged.
- [x] Change AI-facing material input handling so storage variants collapse to
      simple query keywords for tool calls only.
- [x] Change price lookup SQL so `material` filters use keyword matching instead
      of exact equality.
- [x] Update rule/schema docs that expose Steel material choices.
- [x] Run focused Jest tests and `git diff --check`.
- [x] Record review evidence.
- [x] Add regression coverage for broad `鐵板/鋼板` + `鋅` lookup.
- [x] Relax `鐵板/鋼板` + `鋅` query filters so sparse zinc plate data is not
      over-constrained by thickness or keyword terms.
- [x] Re-run focused repository/tool/provider tests and record verification.
- [x] Correct related cutting whitelist: only rail/H/I/angle/channel/flat/round
      bar/square bar/pipe/tube categories attach `切工/切割` rows.
- [x] Remove the wrong Steel plate cutting-price assumption from task lessons
      and rule-facing docs.
- [x] Re-run focused tests after the whitelist correction.

Design lock:

- AI-facing `material` should expose simple query keywords: `黑鐵`, `白鐵`,
  `錏`, `鋁`, and `鋅`.
- Import/storage material values remain canonical source values; do not collapse
  `OT 黑鐵`, `No1 白鐵3t以上含`, `BA 白鐵亮面`, `錏/鍍鋅`, `鋁鋅`, or other source
  labels into query keywords in the import path.
- Price search should find existing rows whose `material`, product name, spec
  key, ERP code, or source spec carries the requested material marker.
- `鐵板/鋼板` lookup queries should not be related to separate `切工/切割`
  rows, and Steel plate has no separate cutting price lookup.
- Only `鐵軌`/鋼軌, `H型鋼`, `工字鐵/I字鐵`, `角鐵/角鋼`, `槽鐵`,
  `平鐵/扁鐵`, `圓鐵/圓鋼`, `方鋼/方鐵`, `圓管/鋼管`, `方管`, and
  `扁方管` attach related `切工/切割` rows.
- `鐵板/鋼板` with lookup material `鋅` should stay broad because there are only
  a few zinc-family plate rows; category plus material is enough and should not
  be narrowed by thickness or extra keyword terms.
- This is a behavior change only; no Steel PostgreSQL table migration is needed.

Review - 2026-06-25:

- Added query-only material enum values `黑鐵`, `白鐵`, `錏`, `鋁`, and `鋅`.
  Import/storage `materialKinds` and Steel PostgreSQL material checks remain
  unchanged.
- `searchSteelPriceItems` now applies lookup `material` as an `ILIKE` keyword
  against `material`, `product_name`, `spec_key`, `erp_item_code`, and
  `source_spec` instead of `material = $n`.
- Category discovery keyword matching now includes `material`, so split terms
  such as `白鐵 方管` can match across material and product/spec fields.
- Plate lookups stay within `鐵板/鋼板` category data; they do not OR in
  separate `切工/切割` related rows.
- Corrected the plate cutting assumption: `鐵板/鋼板` has no separate cutting
  price lookup. Related `切工/切割` rows are attached only for the explicit
  rail/H/I/angle/channel/flat/round bar/square bar/pipe/tube category whitelist.
- `鐵板/鋼板` + `鋅` lookup now stays broad and ignores thickness/keyword
  narrowing, so sparse zinc-family plate rows are searched by category plus
  material keyword only.
- Updated the AI-visible tool schema, tool description, agent rule doc, and
  provider/tool/repository tests to use the simplified query enum.
- Verification:
  - `cd packages/api && npx jest src/steel/pricing/import.spec.ts src/steel/tools/registry.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand` passed with 68 tests after the related-cutting whitelist correction.
  - `git diff --check` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still fails
    on existing unrelated TypeScript errors in cache/openai/langchain/manual
    Steel specs/rules/vision files; no current touched file remains in the
    error list.

# Active: Phase 1 Native Steel Context Adapter Interface

Goal: create the first native Steel context adapter contract at
`packages/api/src/steel/native/context.ts` using the master framework as the
only architecture entrypoint.

Plan:

- [x] Read project instructions, current lessons, master framework, and active
      implementation plan.
- [x] Inspect existing Steel runtime context and native AgentClient context
      seams.
- [x] Add the Phase 1 native context adapter interface and minimal render
      helpers.
- [x] Add focused tests for fixed prefix ordering, compact mode defaults, global
      OCR/file rule inclusion, and metadata-only attachment references.
- [x] Export the native adapter through `@librechat/api`.
- [x] Run focused verification and record review evidence.

Design lock:

- Steel native context is global. Do not add modelSpec opt-in, ordinary-chat
  classifier, YAML Steel enablement switches, or Phase 1 runtime disable paths.
- `instructionPrefix` uses the fixed user-confirmed order: agent rules, quote
  defaults/rules, output rules, tool policy, other rules including OCR/file
  rules, reviewed agent rules, instruction packets.
- Runtime context defaults to `compact_workbook`.
- Attachments enter Phase 1 Steel context as LibreChat file metadata/references
  only. File bytes/base64 stay in LibreChat provider/file pipelines; OCR bytes
  are fetched later by the AI-visible `run_file_ocr` tool executor.
- `fileAnalysis.instructions` is not a duplicate Steel OCR policy source for
  native context. Reviewed Steel OCR/file rules are authoritative.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/context.ts` with the Phase 1 native
  adapter contract:
  - `buildSteelGlobalAgentContext(input)` returns `instructionPrefix`,
    `runtimeContextText`, raw `runtimeContext`, diagnostic metadata, context
    slot labels, attachment references, and prefix section metadata.
  - `SteelNativeFileReference` carries LibreChat file metadata/references only;
    it has no byte/base64 field.
  - Native context metadata records `nativeContextVersion: 1`,
    `globalApplied: true`, `contextMode`, `renderProfile`, byte policy, OCR
    execution policy, and fixed prefix order.
- Added `packages/api/src/steel/native/index.ts` and exported the native adapter
  through `packages/api/src/steel/index.ts` and `packages/api/src/index.ts`.
- Native adapter loads other global rules directly; OCR rules are a fixed
  `otherGlobalRules` subset and do not use an `includeOcrRules` runtime gate.
- Verification:
  - `cd packages/api && npx jest src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed.
  - `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed.
  - `git diff --check` for the touched files passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still fails on
    existing project errors in cache/openai endpoint/manual Steel specs/rules
    tooling, but the native context files are no longer in the TypeScript error
    list after fixing the readonly attachment evidence mismatch.

Review - 2026-06-27 OCR rule loading correction:

- Confirmed `steel-drawing-ocr-policy` is an active reviewed `other` rule in
  `steel.rules`, with `file_ocr`, `drawing_ocr`, and `vision_evidence`
  sections.
- Removed the `includeOcrRules` runtime gate from Steel runtime context,
  handlers, and native context injection. `listOtherGlobalRules()` is now a
  no-argument dependency. OCR rules are not loaded through a separate path; they
  are classified from the loaded `otherGlobalRules` rows into the fixed
  `otherGlobalRules.ocrRules` subset.
- Confirmed the existing OCR persistence path stores `run_file_ocr` output as
  current conversation `ocr_extract` memory rows, replaces prior active OCR
  extracts for the conversation, and reads them back through
  `derivedIndex.ocrExtracts`.
- Verification:
  - `cd packages/api && rtk npx jest src/steel/runtime/context.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed.
  - `cd packages/api && rtk npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/memory/service.spec.ts src/steel/tools/execute.spec.ts --coverage=false --runInBand`
    passed.
  - `rtk npm run build:api` passed.
  - `git diff --check` passed.

# Active: OpenAI OAuth API Native Chat Plan Documentation

Goal: update the Steel native LibreChat master framework and implementation
plan so normal LibreChat chat explicitly supports OpenAI OAuth API through a
native provider adapter.

Plan:

- [x] Inspect existing provider-state and OAuth policy wording.
- [x] Update the master framework with native OpenAI OAuth chat support as a
      product target.
- [x] Update the implementation plan Phase 5 and verification checklist.
- [x] Run documentation diff checks and record review evidence.

Design lock:

- OpenAI OAuth API support belongs in the normal LibreChat chat path through
  `packages/api/src/steel/native/provider.ts`, not through `/steel/oauth-chat`.
- OAuth mode remains stateless/reconstructed: `responsesState: false`, no
  provider `previous_response_id` dependency, LibreChat Mongo history remains
  canonical.
- Native OAuth support must preserve LibreChat stream, abort, files/vision,
  tools, permissions, and Steel context/tool policy.

Review - 2026-06-25:

- Updated `docs/steel-native-librechat-master-framework.md` so normal
  LibreChat chat explicitly supports OpenAI OAuth API through
  `packages/api/src/steel/native/provider.ts`.
- Updated the provider policy to require `openai_oauth_stateless`,
  `responsesState: false`, reconstructed LibreChat context, and no provider
  `previous_response_id` dependency.
- Updated `docs/plans/2026-06-24-steel-global-native-librechat-integration.md`
  Phase 5 from only provider-state resolution to native provider adapter plus
  provider-state resolver.
- Added plan/test coverage for native OpenAI OAuth API preserving stream,
  abort/resume, files/vision, tool execution, message persistence, permissions,
  and text/PDF/image Steel fixture smoke.
- Replaced old "Steel disabled" verification wording with ordinary non-quote
  chat behavior under the global Steel framework.
- Verification: `git diff --check` passed for the touched docs/task files, and
  `rg` confirms both master framework and implementation plan now name native
  OpenAI OAuth API support and keep `/steel/oauth-chat` dev-only.

# Active: Phase 2 Native Steel Top Prefix Seam

Goal: add the native Agent context seam that lets Steel put stable global rules
before base agent instructions without moving existing LibreChat dynamic
context.

Plan:

- [x] Inspect current `packages/api/src/agents/context.ts` behavior and tests.
- [x] Add tests for `globalInstructionPrefix` ordering.
- [x] Implement optional `globalInstructionPrefix` in `buildAgentInstructions`
      and `applyContextToAgent`.
- [x] Run focused Jest and diff checks.

Design lock:

- `globalInstructionPrefix` is for stable top-of-context Steel rules only.
- Existing agent instructions and MCP instructions remain after the prefix.
- Existing `additional_instructions`, shared run context, Memory, RAG, file
  context, and agent-scoped context remain in the dynamic additional-instruction
  path.

Review - 2026-06-25:

- Added optional `globalInstructionPrefix` to
  `packages/api/src/agents/context.ts`:
  - `buildAgentInstructions()` now orders stable instructions as Steel/global
    prefix, base agent instructions, then MCP instructions.
  - `applyContextToAgent()` forwards the prefix in both normal and fallback
    paths.
  - Existing `additional_instructions` and `sharedRunContext` remain in
    `buildAgentAdditionalInstructions()`.
- Added regression coverage in `packages/api/src/agents/context.spec.ts` for
  prefix-only, prefix-before-base/MCP, and preservation of existing dynamic
  additional instructions.
- Verification:
  - `cd packages/api && npx jest src/agents/context.spec.ts --coverage=false --runInBand`
    passed with 35 tests.
  - `cd packages/api && npx jest src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts --coverage=false --runInBand`
    passed with 13 tests.
  - `git diff --check` passed for touched implementation/task files.
  - Full `tsc` still has existing project errors, but filtering the full output
    for touched `agents/context` and `steel/*/context` files returned no
    errors.

# Active: Phase 2 Native AgentClient Steel Context Hook

Goal: wire the Phase 1 native Steel context adapter into normal LibreChat
`AgentClient.buildMessages()` so every native agent run receives Steel global
instructions and compact runtime context without moving LibreChat file bytes.

Plan:

- [x] Add a regression test for native Steel prefix/runtime-tail injection in
      `api/server/controllers/agents/client.test.js`.
- [x] Add a default native Steel dependency builder for JS callers in
      `packages/api/src/steel/native/context.ts`.
- [x] Convert LibreChat message/file records into metadata-only Steel native
      references inside `AgentClient.buildMessages()`.
- [x] Pass Steel stable rules through `globalInstructionPrefix` and append
      Steel runtime context to the dynamic shared context tail.
- [x] Run focused package tests, JS syntax check, TypeScript filtered check,
      and diff checks.

Design lock:

- The JS controller remains a thin bridge: it maps LibreChat conversation
  history and file records to native Steel metadata references, then calls the
  TypeScript native context builder.
- Current-turn file bodies stay in LibreChat's existing request/file context
  path. Steel native context only receives file identifiers and metadata.
- Steel stable prefix is injected at the top of agent instructions through
  `globalInstructionPrefix`.
- Steel compact runtime context is appended to the existing dynamic
  `additional_instructions` tail with other run-level context.

Review - 2026-06-25:

- Added `buildDefaultSteelGlobalAgentContext()` and
  `createSteelNativeRuntimeContextDependencies()` in
  `packages/api/src/steel/native/context.ts`.
- The default dependency builder reads reviewed Steel agent rules, quote
  defaults/rules, output rules, other file/OCR rules, instruction packets, and
  output-sheet workbook state from the existing Steel repositories/services.
- Updated `AgentClient.buildMessages()` to:
  - capture current-turn LibreChat attachment metadata after normal attachment
    processing;
  - pass active conversation history, current user turn, and current file
    references into the native Steel context adapter;
  - append `runtimeContextText` to the shared dynamic context;
  - pass `instructionPrefix` to `applyContextToAgent()` as the global prefix.
- Added a controller regression test asserting Steel prefix/tail injection while
  keeping current request file body content in the user prompt path.
- Verification:
  - `cd packages/api && npx jest src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts src/agents/context.spec.ts --coverage=false --runInBand`
    passed with 49 tests.
  - `node -c api/server/controllers/agents/client.js` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, but filtering full output for touched context files
    returned no errors.
  - `git diff --check -- api/server/controllers/agents/client.js api/server/controllers/agents/client.test.js packages/api/src/steel/native/context.ts packages/api/src/steel/native/context.spec.ts tasks/todo.md`
    passed.
  - `cd api && npx jest server/controllers/agents/client.test.js --runInBand --coverage=false --testNamePattern "injects native Steel prefix"`
    is currently blocked before test execution by the existing root dependency
    state: `Cannot find module '@langchain/core/errors'` from
    `@langchain/openai`.

# Active: Phase 3 Additive Steel Native Tools

Goal: merge Steel business tools into native LibreChat agent tool loading and
execution without removing user tools, MCP tools, actions, web search, file
search, or code execution.

Plan:

- [x] Add native Steel tool adapter tests for additive merge, compact workbook
      gating, deterministic name collisions, and executable wrapper behavior.
- [x] Create `packages/api/src/steel/native/tools.ts` and export it through
      the native Steel barrel.
- [x] Convert Steel provider tool definitions into native `LCTool`
      definitions with JSON schemas.
- [x] Merge Steel tools into `ToolService` definitions-only loading while
      preserving existing user-selected tools.
- [x] Intercept Steel tool calls in `loadToolsForExecution()` and execute them
      through `executeSteelTool()` instead of the generic LibreChat tool
      loader.
- [x] Run focused package tests, TypeScript filtered check, JS syntax checks,
      and diff checks.

Design lock:

- Steel tools are additive native tools. They do not replace user tools, MCP,
  actions, web/file search, code execution, or deferred/programmatic tool
  behavior.
- Tool visibility follows the Steel runtime tool policy and defaults to
  `compact_workbook`; Markdown-derived state recovery uses `read_markdown`
  only, scoped to the active conversation.
- If a native tool name already exists, the Steel adapter deterministically
  exposes the Steel version as `steel_<toolName>` and maps execution back to the
  canonical Steel tool name.
- `ToolService.js` remains a thin bridge. Steel tool schema conversion and
  name mapping live in TypeScript under `packages/api/src/steel/native/tools.ts`.
- Native execution uses existing Steel repositories and Mongo-backed structured
  state readers keyed by LibreChat `conversationId`. Successful native Steel
  tool results are captured through the Phase 8 Markdown/state adapter.

Review - 2026-06-25:

- Added `mergeSteelToolDefinitions()` to convert `getSteelToolDefinitions()`
  into native `LCTool` definitions.
- Added `createSteelNativeTool()` and `resolveSteelProviderToolName()` so
  native tool calls can execute canonical Steel tools even when the visible name
  is namespaced after a collision.
- Exported native Steel tools through `packages/api/src/steel/native/index.ts`.
- Updated `api/server/services/ToolService.js` so definitions-only loading:
  - no longer returns early before Steel global tools are considered;
  - filters legacy pseudo-tools and Steel tool names out of the generic loader;
  - merges Steel tool definitions into the returned `toolDefinitions` and
    `toolRegistry`.
- Updated `loadToolsForExecution()` so Steel tool calls are handled by native
  executable wrappers backed by `executeSteelTool()`, `createSteelPostgresPool()`,
  and Mongo Steel structured-state readers.
- Verification:
  - `cd packages/api && npx jest src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts src/agents/context.spec.ts --coverage=false --runInBand`
    passed with 54 tests.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, but filtering full output for touched Steel native,
    Steel tools, Steel runtime, and agent context files returned no errors.
  - `node -c api/server/services/ToolService.js` passed.
  - `node -c api/server/controllers/agents/client.js` passed.
  - `git diff --check` passed for touched implementation, docs, and task files.
  - `cd api && npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "loadAgentTools"`
    is currently blocked before test execution by the existing root dependency
    state: `Cannot find module '@langchain/core/errors'` from
    `@langchain/openai`.

# Active: Phase 8 Native Markdown And Tool State Capture

Goal: connect native LibreChat assistant persistence and native Steel tool
execution to the existing Steel structured quote/workbook state writer without
moving Steel parsing logic into generic LibreChat persistence code.

Plan:

- [x] Add native Markdown/state adapter tests for text extraction, final
      assistant Markdown capture, skip reasons, successful tool-result capture,
      and failed tool-result skips.
- [x] Add `packages/api/src/steel/native/markdown.ts` and export it from the
      native Steel barrel.
- [x] Add a thin optional post-save hook around `BaseClient` assistant
      `databasePromise`.
- [x] Wire `AgentClient` initialization to capture final assistant Markdown
      after the LibreChat assistant message saves successfully.
- [x] Share native assistant turn metadata from `AgentClient.buildMessages()`
      to the request-scoped ToolService execution path.
- [x] Capture successful native Steel tool results immediately after
      `executeSteelTool()` succeeds.
- [x] Run focused native tests, JS syntax checks, TypeScript filtered check,
      and diff checks.

Design lock:

- `BaseClient.js` only exposes a generic `onResponseMessageSaved` lifecycle
  seam and preserves the original `databasePromise` contract.
- Steel parsing and writer calls live in `packages/api/src/steel/native/markdown.ts`.
- Native UI final Markdown capture runs after the assistant message save
  resolves; it skips user, temporary, unfinished, error, missing metadata, and
  blank-content messages.
- Native Steel tool result capture uses the same Mongo-backed Steel writer and
  request-scoped turn metadata so tool evidence and assistant Markdown state
  share a turn/checkpoint boundary.
- Open Responses post-save capture is tracked in the next Phase 8 slice; native
  event mapping remains pending Phase 8 work.

Review - 2026-06-25:

- Added `captureSteelNativeAssistantMarkdown()`,
  `captureSteelNativeToolResult()`, and `extractSteelNativeMarkdownText()` in
  `packages/api/src/steel/native/markdown.ts`.
- Updated `api/app/clients/BaseClient.js` with
  `withResponseMessageSavedHook()` so endpoint-specific clients can attach
  post-save side effects without duplicating controller finalization logic.
- Updated `api/server/services/Endpoints/agents/initialize.js` to wire the
  native Steel Markdown capture hook with
  `createMongooseSteelWorkingOrderMemoryWriter(mongoose)`.
- Updated `api/server/controllers/agents/client.js` to publish
  request-scoped `steelNativeContext` metadata with `conversationId`,
  `requestId`, `assistantTurnIndex`, and `memoryCheckpointTurnIndex`.
- Updated `api/server/services/ToolService.js` so native Steel tool execution
  captures successful tool results through `captureSteelNativeToolResult()`
  using the same writer contract.
- Updated the master framework and implementation plan to reflect that native
  UI Markdown/tool-result state capture is implemented; Open Responses capture
  was tracked as the next Phase 8 slice, and event mapping remains pending.
- Verification:
  - `cd packages/api && npx jest src/steel/native/markdown.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 14 tests.
  - `node -c api/app/clients/BaseClient.js` passed.
  - `node -c api/server/services/Endpoints/agents/initialize.js` passed.
  - `node -c api/server/services/ToolService.js` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, including
    `src/steel/memory/service.spec.ts(725,27): error TS2589`, but filtering full
    output for touched native/agent/runtime/tool files returned no errors.
  - `git diff --check` passed for touched native UI persistence, Steel native
    Markdown/tool adapter, docs, and task files.

# Active: Phase 8 Open Responses Steel Markdown Capture

Goal: wire `api/server/controllers/agents/responses.js` to the same native
Steel Markdown/state adapter so stored Open Responses API calls capture final
assistant Markdown after `db.saveMessage()` succeeds.

Plan:

- [x] Add a failing native adapter test for Open Responses output extraction
      and capture metadata.
- [x] Implement an Open Responses output capture helper in
      `packages/api/src/steel/native/markdown.ts`.
- [x] Wire `saveResponseOutput()` to call the helper after assistant message
      persistence succeeds.
- [x] Run focused package tests, JS syntax check, TypeScript filtered check,
      and diff check.

Design lock:

- `responses.js` remains a thin JS bridge. Steel parsing/writer conversion
  stays in `packages/api/src/steel/native/markdown.ts`.
- Capture must happen after `db.saveMessage()` succeeds, not before and not at
  stream finalization.
- Both streaming and non-streaming stored branches already call
  `saveResponseOutput()`, so the hook belongs there.
- `store:false` Open Responses calls do not create Steel structured state.

Review - 2026-06-25:

- Added failing tests in `packages/api/src/steel/native/markdown.spec.ts` for:
  - extracting Markdown from Open Responses `output_text` parts;
  - capturing a stored Open Responses assistant response with
    `conversationId`, `responseId`, `turnIndex`, and checkpoint metadata.
- The red test run failed as expected because
  `extractSteelNativeResponseOutputText()` and
  `captureSteelNativeResponseOutput()` did not exist.
- Implemented both helpers in `packages/api/src/steel/native/markdown.ts`.
- Updated `api/server/controllers/agents/responses.js` so:
  - request-scoped `steelNativeContext` is created from
    `previousMessages + inputMessages`;
  - `saveResponseOutput()` calls `captureSteelNativeResponseOutput()` after
    `db.saveMessage()` succeeds;
  - streaming and non-streaming stored branches share the same hook because
    both already call `saveResponseOutput()`.
- Updated the master framework and implementation plan to mark Open Responses
  persistence hook as implemented while keeping event mapping pending.
- Verification:
  - Red test:
    `cd packages/api && npx jest src/steel/native/markdown.spec.ts --coverage=false --runInBand`
    failed because the two new exports were missing.
  - Green test:
    `cd packages/api && npx jest src/steel/native/markdown.spec.ts --coverage=false --runInBand`
    passed with 7 tests.
  - Focused native suite:
    `cd packages/api && npx jest src/steel/native/markdown.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 16 tests.
  - `node -c api/server/controllers/agents/responses.js` passed.
  - `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false`
    passed with 14 tests.
  - `git diff --check` passed for touched Open Responses persistence,
    Steel native Markdown adapter, docs, and task files.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, but filtering full output for touched
    native/responses/agent/runtime/tool files returned no errors.

# Active: Phase 6 Agents API Chat Completions Steel Context Hook

Goal: make the remote OpenAI-compatible
`/api/agents/v1/chat/completions` route receive the same global Steel context
as the normal native UI path.

Plan:

- [x] Add a focused regression test for the OpenAI-compatible controller
      applying Steel global instructions and runtime context before `createRun`.
- [x] Keep `api/server/controllers/agents/openai.js` as a thin bridge and put
      reusable Steel context application logic in `packages/api`.
- [x] Apply the Steel prefix/runtime tail to the primary agent and discovered
      handoff agents.
- [x] Preserve existing remote-agent permissions, skill primes, MCP/tool
      execution, streaming/non-streaming response behavior, and usage billing.
- [x] Update the master framework/implementation plan and run focused
      verification.

Design lock:

- This is the OpenAI-compatible Agents API ingress, not the normal UI
  `AgentClient` path and not `/steel/oauth-chat`.
- The route already performs its own initialize/discover/createRun flow, so it
  must explicitly apply Steel context after agent initialization and before
  `formatAgentMessages()` / `createRun()`.
- Stable Steel rules belong in `agent.instructions`; dynamic Steel runtime
  context belongs in `agent.additional_instructions`.
- Request-scoped Steel metadata should be available to native Steel tool
  execution and Markdown/state capture where this route later persists output.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/agents.ts` with reusable helpers that
  prepend Steel global instructions and append Steel runtime context to
  initialized native agent configs.
- Exported the helper through the native Steel barrel.
- Updated `api/server/controllers/agents/openai.js` so
  `/api/agents/v1/chat/completions`:
  - converts OpenAI-compatible system/user/assistant messages into Steel
    runtime conversation input while leaving tool messages in the original
    LibreChat model flow;
  - builds `agents_chat_completions` Steel global context after primary and
    handoff agent initialization;
  - applies the Steel prefix/runtime tail to every run agent before
    `formatAgentMessages()` and `createRun()`;
  - sets request-scoped Steel context metadata for native Steel tool/state
    boundaries.
- Updated the master framework and implementation plan with Phase 6A for the
  OpenAI-compatible Chat Completions ingress.
- Verification:
  - Red test:
    `cd api && npx jest server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false --testNamePattern "Steel native context"`
    failed because `buildDefaultSteelGlobalAgentContext` was not called.
  - Green controller suite:
    `cd api && npx jest server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false`
    passed with 13 tests.
  - Native package suite:
    `cd packages/api && npx jest src/steel/native/agents.spec.ts src/steel/native/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/markdown.spec.ts src/steel/native/provider.spec.ts src/steel/native/oauth.spec.ts --coverage=false --runInBand`
    passed with 27 tests.
  - `node -c api/server/controllers/agents/openai.js` passed.
  - `git diff --check` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
    still fails on existing project errors in Redis typing, OpenAI config
    specs, missing `@langchain/core/messages`, manual Steel specs, rules
    repository typing, and PaddleOCR manual specs; no current touched file is
    in the TypeScript error list after fixing the new helper spec typing.

# Active: Phase 5 Native OpenAI OAuth Transport Adapter

Goal: make standard native LibreChat agent chat able to execute
`openai_oauth_responses` through `openai-oauth-provider` without routing product
traffic through `/steel/oauth-chat`.

Plan:

- [x] Inspect the `@librechat/agents` model factory and provider registry seam.
- [x] Add failing native OAuth adapter tests for stateless provider creation,
      message/file conversion, tool-call mapping, and streaming chunks.
- [x] Add failing `createRun()` contract coverage for standard native OAuth
      chat injecting an OpenAI OAuth override model.
- [x] Implement `packages/api/src/steel/native/oauth.ts` and export it through
      the native Steel barrel.
- [x] Wire `packages/api/src/agents/run.ts` so standard single-agent
      `openai_oauth_responses` runs use the native OAuth adapter.
- [x] Run focused native/provider/run tests and TypeScript/diff checks.

Design lock:

- Product traffic still stays in normal LibreChat native chat; `/steel/oauth-chat`
  remains dev-only.
- OAuth transport is stateless: `responsesState:false`, no
  `previous_response_id`, and full prompt reconstruction from LibreChat history
  plus Steel global context.
- The OAuth adapter wraps `openai-oauth-provider` as a LangChain-compatible
  native chat model. It converts LangChain messages to AI SDK v3 prompt
  messages, preserves native image/PDF file parts, forwards native tool schemas,
  maps OAuth provider tool calls back to `AIMessageChunk.tool_calls`, streams
  text deltas, and records response/usage metadata.
- `createRun()` injects the adapter through the existing Graph `overrideModel`
  seam only for standard single-agent native chat. The injected model resolves
  tools from the live Graph agent context on every invoke/stream, so tool schema
  discovery is not frozen at run creation.
- Multi-agent/per-agent OAuth model support remains a later seam. Do not claim
  it complete until `@librechat/agents` exposes a per-agent model adapter or an
  equivalent tested hook.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/oauth.spec.ts`.
- Red adapter test:
  - `cd packages/api && npx jest src/steel/native/oauth.spec.ts --coverage=false --runInBand`
    failed because `./oauth` did not exist.
- Implemented `OpenAIOAuthModel` and
  `OpenAIOAuthGraphModel` in
  `packages/api/src/steel/native/oauth.ts`.
- The adapter:
  - lazy-loads `openai-oauth-provider` unless a test injects
    `createOpenAIOAuth`;
  - creates the provider with `responsesState:false`;
  - converts system/user/assistant/tool LangChain messages to AI SDK v3 prompt
    messages;
  - converts `image_url`, `input_file`, and OpenAI-style `file` parts into AI
    SDK file parts;
  - forwards native tool schemas as AI SDK function tools;
  - maps generated tool calls back into LangChain `AIMessageChunk.tool_calls`;
  - streams text/tool/finish parts as `AIMessageChunk` values with usage and
    response metadata.
- Updated `packages/api/src/agents/run.ts` so standard single-agent
  `openai_oauth_responses` runs receive the OAuth graph override model after
  `Run.create()`.
- Updated `packages/api/src/agents/__tests__/run-summarization.test.ts` with
  a focused native run contract test and a minimal `@librechat/agents` mock so
  the suite no longer loads the unavailable `@langchain/core/errors` path.
- Updated the master framework and Phase 5 implementation plan to mark the
  standard native OAuth transport adapter as implemented while keeping
  multi-agent/provider-factory and live fixture smoke as later proof work.
- Verification:
  - `cd packages/api && npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/markdown.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 25 tests.
  - `cd packages/api && npx jest src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand`
    passed with 65 tests.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
    still fails on existing project errors in Redis, OpenAI config specs,
    missing `@langchain/core/messages`, manual Steel specs, rules repository,
    and PaddleOCR manual specs; no touched Phase 5 OAuth/native/run files remain
    in the TypeScript error list.
  - `cd api && npx jest server/routes/agents/__tests__/responses.spec.js --runInBand --coverage=false`
    is blocked before route assertions by the existing root dependency state:
    `Cannot find module '@langchain/core/errors'` from `@langchain/openai`.

Dependency unblock addendum - 2026-06-25:

- Added root `@langchain/core@^1.2.1` to satisfy the hoisted LangChain provider
  peer imports used by `@librechat/agents`, `@langchain/openai`, and nested
  OAuth/provider dependencies during native API tests.
- Kept the npm-generated `package-lock.json` sync because the narrower manual
  lock edit failed `npm ci --dry-run`; the generated lock also reconciles
  existing package/lock drift around peer/dev dependency placement.
- Rebuilt ignored `packages/api/dist` locally with `cd packages/api && npm run
  build` so API Jest consumed the current `packages/api/src/agents/context.ts`
  global-prefix implementation.
- Verification:
  - `npm ls @langchain/core --depth=0` reports `@langchain/core@1.2.1`.
  - `npm ci --dry-run --ignore-scripts --cache /private/tmp/librechat-npm-cache`
    passed, with existing Node engine warnings under local Node `v22.17.1`.
  - `cd api && npx jest server/controllers/agents/client.test.js --runInBand --coverage=false --testNamePattern "injects native Steel prefix"` passed.
  - `cd api && npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "request-scoped Steel OCR files"` passed.

# Active: Phase 5 Native Provider Policy Resolver

Goal: add the native Steel provider policy resolver and wire provider-policy
metadata into native AgentClient runs without pretending the OAuth transport
adapter is complete.

Plan:

- [x] Add failing provider policy tests for OpenAI OAuth stateless mode,
      API-key Responses reconstructed mode, explicit `useResponsesApi:false`,
      and guarded `previous_response_id` usage.
- [x] Implement `packages/api/src/steel/native/provider.ts` and export it from
      the native Steel barrel.
- [x] Apply the policy in native agent initialization for OpenAI/OAuth provider
      branches only.
- [x] Persist provider policy metadata on native assistant messages.
- [x] Run focused tests, JS syntax checks, TypeScript filtered check, and diff
      check.

Design lock:

- `openai_oauth_responses` resolves to `openai_oauth_stateless`,
  `responsesState:false`, and strips unsupported `previous_response_id`.
- Official OpenAI API-key specs default to `useResponsesApi:true` and
  `openai_responses_reconstructed`.
- Explicit `useResponsesApi:false` is preserved unless
  `enforceResponsesApi:true` is passed by an admin-enforced Steel spec.
- `openai_responses_previous_response_id` is only selected when a persisted
  provider response id is supplied and previous-response-id mode is explicitly
  allowed.
- Non-OpenAI providers are not touched by the Steel provider policy resolver.
- This slice does not yet make `openai_oauth_responses` executable through the
  native LangGraph/model factory; that transport adapter remains the next Phase
  5 gap.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/provider.spec.ts`.
- Added `packages/api/src/steel/native/provider.ts` with:
  - `resolveSteelNativeProviderPolicy()`;
  - `toSteelNativeProviderMetadata()`;
  - `isSteelNativeProviderPolicyTarget()`.
- Exported the provider module from `packages/api/src/steel/native/index.ts`.
- Updated `api/server/services/Endpoints/agents/initialize.js` to:
  - apply provider policy only for OpenAI API/OAuth branches;
  - update `primaryConfig.model_parameters` with the policy-cleaned model
    parameters;
  - pass provider policy metadata into `AgentClient`.
- Updated `api/server/controllers/agents/client.js` to persist provider policy
  metadata under `metadata.steel.provider`.
- Updated the master framework and Phase 5 plan to mark provider policy
  resolver/metadata as implemented while keeping the native OAuth transport
  adapter pending.
- Verification:
  - Red test:
    `cd packages/api && npx jest src/steel/native/provider.spec.ts --coverage=false --runInBand`
    failed because `./provider` did not exist.
  - Green test:
    `cd packages/api && npx jest src/steel/native/provider.spec.ts --coverage=false --runInBand`
    passed with 5 tests.
  - Focused native suite:
    `cd packages/api && npx jest src/steel/native/provider.spec.ts src/steel/native/markdown.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 21 tests.
  - `node -c api/server/services/Endpoints/agents/initialize.js` passed.
  - `node -c api/server/controllers/agents/client.js` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, but filtering full output for touched
    native/responses/agent/runtime/tool files returned no errors.

# Active: Phase 6B Open Responses Steel Context Hook

Goal: make the remote Open Responses-compatible
`/api/agents/v1/responses` route receive the same global Steel context as the
normal native UI and Chat Completions ingress paths.

Plan:

- [x] Add a focused regression test for the Responses controller building
      Steel global context from reconstructed previous + current input messages.
- [x] Apply Steel stable prefix through `applyContextToAgent()` before
      `createRun`.
- [x] Append Steel runtime context after existing per-agent attachment context.
- [x] Preserve existing Open Responses continuation loading, streaming and
      non-streaming branches, tool execution, usage billing, and post-save
      Markdown/state capture.
- [x] Resolve generated `resp_*` response ids back to the durable LibreChat
      conversation for continuation and retrieval.
- [x] Normalize Steel-enabled Open Responses storage so incoming `store:false`
      requests still use durable LibreChat history/state.
- [x] Update master framework/implementation plan and run focused verification.

Design lock:

- This is the Open Responses-compatible Agents API ingress, not the normal UI
  `AgentClient` path and not `/steel/oauth-chat`.
- The route reconstructs history from LibreChat messages and current input; the
  Steel context builder must see that same merged message set.
- Stable Steel rules belong in `globalInstructionPrefix`; dynamic Steel runtime
  context belongs at the end of the route's shared run context.
- Incoming `store:false` is normalized to durable `store:true`; there is no
  supported non-stored Steel structured-state path.

Review - 2026-06-25:

- Updated `api/server/controllers/agents/responses.js` so the Open
  Responses-compatible route:
  - converts the merged `previousMessages + inputMessages` reconstruction into
    Steel native conversation messages;
  - builds `open_responses` Steel global context before
    `formatAgentMessages()` and `createRun()`;
  - passes Steel stable rules through `applyContextToAgent()` as
    `globalInstructionPrefix`;
  - appends Steel runtime context after existing per-agent attachment context in
    `sharedRunContext`;
  - keeps request-scoped Steel turn metadata for post-save Markdown/state
    capture.
- Updated `api/server/controllers/agents/__tests__/responses.unit.spec.js` with
  regression coverage for reconstructed-history Steel context, generated
  `resp_*` continuation/retrieval, and streaming native tool execution callback
  parity.
- Added a shared Open Responses resolver that:
  - keeps direct conversation-id continuation compatible;
  - resolves generated `resp_*` ids through the saved assistant
    `Message.messageId` to the durable `conversationId`;
  - supports `GET /responses/:id` with the returned response id.
- Normalized Steel-enabled Open Responses storage in
  `api/server/controllers/agents/responses.js` so both streaming and
  non-streaming `store:false` requests still call `saveConvo()`,
  `saveInputMessages()`, and `saveResponseOutput()`. Non-streaming responses
  return `store: true`.
- Added `packages/api/src/steel/native/metadata.ts` and wired
  `saveResponseOutput()` to persist auditable Open Responses metadata under
  `metadata.steel.native`, including ingress, native context version, context
  mode, render profile, provider-state mode, conversation/response ids, turn
  indexes, and normalized durable storage state.
- Updated the master framework and implementation plan to mark the Open
  Responses context hook, generated `resp_*` resolver, `store:true`
  normalization, and saved Steel metadata as implemented.
- Verification:
  - Red metadata helper test:
    `cd packages/api && npx jest src/steel/native/metadata.spec.ts --coverage=false --runInBand`
    failed because `./metadata` did not exist.
  - Red response metadata test:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false --testNamePattern "auditable Steel metadata"`
    failed because the Open Responses assistant message did not call the Steel
    metadata builder.
  - Red storage test:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false --testNamePattern "normalizes .*store false"`
    failed because `store:false` did not call `saveConvo()`/`saveMessage()`.
  - Red test:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false --testNamePattern "Steel global context"`
    failed because `buildDefaultSteelGlobalAgentContext` was not called.
  - Green route suite:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false`
    passed with 21 tests.
  - Combined route controller suites:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false`
    passed with 34 tests.
  - Route integration attempt:
    `cd api && npx jest server/routes/agents/__tests__/responses.spec.js --runInBand --coverage=false --testNamePattern "Response Storage"`
    is still blocked before route assertions by the existing dependency state:
    `Cannot find module '@langchain/core/errors'` from `@langchain/openai`.
  - Native package suite:
    `cd packages/api && npx jest src/steel/native/agents.spec.ts src/steel/native/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/markdown.spec.ts src/steel/native/metadata.spec.ts src/steel/native/provider.spec.ts src/steel/native/oauth.spec.ts --coverage=false --runInBand`
    passed with 28 tests.
  - `node -c api/server/controllers/agents/responses.js` passed.
  - `git diff --check` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
    still fails on existing project errors in Redis typing, OpenAI config
    specs, missing `@langchain/core/messages`, manual Steel specs, rules
    repository typing, and PaddleOCR manual specs; no current touched file is
    in the TypeScript error list.

Open Responses bridge addendum - 2026-06-25:

- [x] Add failing package coverage proving Open Responses `input_file` blocks
      stay as file inputs instead of becoming text placeholders.
- [x] Preserve `input_file` blocks in
      `packages/api/src/agents/responses/service.ts` with `file_id`,
      `file_data`, and `filename` fields.
- [x] Add failing controller coverage proving Open Responses current-turn
      `input_file.file_id` references enter `req.steelNativeContext.currentTurnFiles`.
- [x] Collect Open Responses current-turn file references in
      `api/server/controllers/agents/responses.js`, attach them to native Steel
      context, and reuse the existing ToolService `run_file_ocr` file-resolution
      path. Inline `file_data` remains provider-visible and is not copied into
      Steel context bytes.
- [x] Update the master framework and implementation plan Phase 7 status.

Open Responses bridge verification:

- Red package test:
  `cd packages/api && npx jest src/agents/responses/__tests__/service.test.ts --coverage=false --runInBand --testNamePattern "input_file"`
  failed before implementation because `input_file` became a text placeholder.
- Green package tests:
  `cd packages/api && npx jest src/agents/responses/__tests__/service.test.ts --coverage=false --runInBand`
  passed with 24 tests.
- Red controller test:
  `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false --testNamePattern "passes Open Responses input_file"`
  failed before implementation because `req.steelNativeContext.currentTurnFiles`
  was `undefined`.
- Green controller tests:
  `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false`
  passed with 22 tests.
- Combined route controller suites:
  `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false`
  passed with 35 tests.
- Focused native package suite:
  `cd packages/api && npx jest src/agents/responses/__tests__/service.test.ts src/steel/tools/execute.spec.ts src/steel/native/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/metadata.spec.ts src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/agents.spec.ts src/steel/native/markdown.spec.ts --coverage=false --runInBand`
  passed with 67 tests.
- `node -c api/server/controllers/agents/responses.js` passed.
- `git diff --check` passed.
- `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
  still fails on existing project errors in Redis typing, OpenAI config specs,
  missing `@langchain/core/messages`, manual Steel specs, rules repository
  typing, and PaddleOCR manual specs; no Open Responses/Steel native file
  touched in this slice is in the TypeScript error list.

# Active: Phase 7 Native AgentClient OCR File Bridge

Goal: let the normal native LibreChat AgentClient path pass permitted current
PDF/image attachment bytes into Steel `run_file_ocr` only when the AI agent
explicitly calls that tool.

Plan:

- [x] Add package-level regression coverage for `executeSteelTool()` dispatching
      `run_file_ocr` to an injected OCR runner with uploaded file bytes.
- [x] Add request-scoped current-turn Steel file references in AgentClient after
      LibreChat native attachment processing.
- [x] Resolve those file refs inside ToolService through LibreChat Mongo file
      records and configured storage download streams.
- [x] Pass resolved OCR files into `executeSteelTool({ ocrFiles })` only for
      `run_file_ocr` calls.
- [x] Update implementation plan status and run focused verification.

Design lock:

- File upload/loading alone does not auto-run OCR or inject OCR text.
- Native provider file/vision inputs remain in the existing LibreChat
  attachment pipeline; the Steel context only carries metadata references.
- `run_file_ocr` uses LibreChat-owned file records and storage streams, then
  reaches the PaddleOCR-backed runner through `executeSteelTool()`.
- This slice covers normal native AgentClient current-turn attachments. Open
  Responses `input_file` bridging is covered by the addendum above. Runtime
  context prior OCR evidence reuse is covered by the addendum below; live
  no-re-OCR follow-up behavior remains a Phase 7 smoke/evidence gap.

Review - 2026-06-25:

- Added `run_file_ocr` dispatch support to
  `packages/api/src/steel/tools/execute.ts` with injectable `runFileOcr` and
  `ocrFiles` dependencies for deterministic tests.
- Updated `api/server/controllers/agents/client.js` so the request-scoped
  `steelNativeContext` includes `currentTurnFiles` after LibreChat attachment
  processing.
- Updated `api/server/services/ToolService.js` so native Steel OCR execution:
  - reads `req.steelNativeContext.currentTurnFiles`;
  - resolves each file through `resolveEvidenceFileForProvider()`;
  - uses LibreChat `getFiles()` and `getStrategyFunctions(...).getDownloadStream`
    to read permitted file bytes;
  - passes the resulting files into `executeSteelTool()` only when the native
    Steel tool call is `run_file_ocr`.
- Verification:
  - Red package test:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts --coverage=false --runInBand --testNamePattern "runs OCR only"`
    failed because the OCR runner was not called.
  - Green package test:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts --coverage=false --runInBand --testNamePattern "runs OCR only"`
    passed.
  - Green tools suite:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts --coverage=false --runInBand`
    passed with 15 tests.
  - Focused native/tool suite:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 24 tests.
  - Focused native package suite:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts src/steel/native/agents.spec.ts src/steel/native/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/markdown.spec.ts src/steel/native/metadata.spec.ts src/steel/native/provider.spec.ts src/steel/native/oauth.spec.ts --coverage=false --runInBand`
    passed with 43 tests.
  - Combined route controller suites:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false`
    passed with 34 tests.
  - `node -c api/server/services/ToolService.js` passed.
  - `node -c api/server/controllers/agents/client.js` passed.
  - ToolService red/integration test attempt:
    `cd api && npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "request-scoped Steel OCR files"`
    originally failed before assertions with `Cannot find module
    '@langchain/core/errors'` from `@langchain/openai`; after the root
    `@langchain/core@^1.2.1` dependency fix and API package rebuild, this
    focused test now passes.
  - AgentClient focused test attempt:
    `cd api && npx jest server/controllers/agents/client.test.js --runInBand --coverage=false --testNamePattern "native Steel prefix"`
    originally hit the same missing `@langchain/core/errors` dependency; after
    rebuilding ignored `packages/api/dist`, the focused native Steel prefix test
    passes with the current source implementation.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
    still fails on existing project errors in Redis typing, OpenAI config
    specs, missing `@langchain/core/messages`, manual Steel specs, rules
    repository typing, and PaddleOCR manual specs; no current touched file is
    in the TypeScript error list.

Prior OCR evidence reuse addendum - 2026-06-25:

- [x] Add a failing runtime context test proving active OCR extracts from Steel
      structured state are reused on follow-up turns.
- [x] Update `prepareSteelRuntimeContext()` so it reads `Output Sheet Memory`
      before deriving `attachments.priorActiveFileEvidence` from active
      `derivedIndex.ocrExtracts`, and still keeps explicit prior evidence.
- [x] Keep current-turn file bytes out of runtime context; this change only
      replays persisted structured OCR evidence.
- [x] Update the master framework and implementation plan Phase 7 status.

Prior OCR evidence reuse verification:

- Red runtime test:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts --coverage=false --runInBand --testNamePattern "reuses active OCR extracts"`
  failed because `context.attachments.priorActiveFileEvidence` was empty.
- Green runtime test:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts --coverage=false --runInBand --testNamePattern "reuses active OCR extracts"`
  passed.
- Full runtime context suite:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts --coverage=false --runInBand`
  passed with 11 tests.
- Focused native/tool suite:
  `cd packages/api && npx jest src/steel/native/context.spec.ts src/steel/tools/execute.spec.ts src/steel/native/tools.spec.ts --coverage=false --runInBand`
  passed with 24 tests.
- Focused native/runtime package suite:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/native/context.spec.ts src/steel/tools/execute.spec.ts src/steel/native/tools.spec.ts src/steel/native/metadata.spec.ts src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/agents.spec.ts src/steel/native/markdown.spec.ts src/agents/responses/__tests__/service.test.ts --coverage=false --runInBand`
  passed with 78 tests.
- `git diff --check` passed.
- `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
  still fails on existing project errors in Redis typing, OpenAI config specs,
  missing `@langchain/core/messages`, manual Steel specs, rules repository
  typing, and PaddleOCR manual specs; no runtime context file touched in this
  slice is in the TypeScript error list.

# Active: Phase 8 Native Steel Event Mapping

Goal: expose persisted Steel parse/save/tool capture status through native
LibreChat stream surfaces without persisting internal activity as assistant
message text.

Plan:

- [x] Add package-level regression coverage for mapping Steel native capture
      results into stream event envelopes.
- [x] Emit native `steel_event` envelopes after native UI assistant Markdown
      capture succeeds.
- [x] Emit native `steel_event` envelopes after native Steel tool-result capture
      succeeds.
- [x] Keep Open Responses Markdown capture durable and protocol-compatible; do
      not inject custom SSE into the Open Responses-compatible stream yet.
- [x] Re-run focused verification under Node 24 after the local shell PATH was
      corrected.

Design lock:

- `packages/api/src/steel/native/events.ts` owns event mapping.
- Native UI assistant Markdown capture emits `parse_status` and `memory_saved`
  envelopes when capture results have parse status or persisted state counts.
- Native Steel tool-result capture emits `memory_saved` envelopes after
  persisted tool evidence has saved counts.
- Skipped captures and zero saved-count captures emit no Steel events.
- Open Responses route capture stays in `saveResponseOutput()` after
  `db.saveMessage`; custom Steel events for that protocol require a future
  LibreChat-owned side channel.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/events.ts` and
  `packages/api/src/steel/native/events.spec.ts`.
- Updated `packages/api/src/steel/native/index.ts` to export the event mapper.
- Updated `api/server/services/Endpoints/agents/initialize.js` to emit native
  Steel events after `captureSteelNativeAssistantMarkdown()`.
- Updated `api/server/services/ToolService.js` to emit native Steel events after
  `captureSteelNativeToolResult()`.
- Updated focused Jest coverage in:
  - `api/server/services/Endpoints/agents/initialize.spec.js`
  - `api/server/services/__tests__/ToolService.spec.js`
- Added root `unrun@0.3.1` devDependency because `packages/api` `tsdown`
  build requires that optional peer in this checkout.
- Node 24 verification used:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH`.

Verification:

- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm ci --dry-run --ignore-scripts --cache /private/tmp/librechat-npm-cache`
  passed.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm ls unrun --depth=0`
  passed and reported `unrun@0.3.1`.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/events.spec.ts src/steel/native/markdown.spec.ts --coverage=false --runInBand`
  passed with 10 tests.
- `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/Endpoints/agents/initialize.spec.js --runInBand --coverage=false --testNamePattern "emits native Steel parse"`
  passed.
- `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "request-scoped Steel OCR files"`
  passed.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH node -c api/server/services/ToolService.js`
  passed.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH node -c api/server/services/Endpoints/agents/initialize.js`
  passed.

Frontend live activity addendum - 2026-06-25:

- [x] Add failing frontend coverage for native `steel_event` activity storage.
- [x] Add failing frontend coverage for assistant-message Steel activity
      rendering.
- [x] Add focused resumable SSE coverage so `steel_event` routes to Steel
      activity handling instead of the generic run-step handler.
- [x] Implement client live activity state and rendering without mutating
      assistant message text/content.
- [x] Route both legacy SSE and resumable SSE `steel_event` envelopes to the
      Steel activity handler.

Frontend design lock:

- `client/src/store/steel.ts` owns live native Steel activity state keyed by
  assistant `messageId`.
- `client/src/hooks/SSE/useSteelEventHandler.ts` validates native event
  envelopes, falls back tool-result events without `messageId` to the current
  assistant response, deduplicates replayed envelopes, and bounds the activity
  list.
- `client/src/components/Chat/Messages/Content/SteelActivity.tsx` renders
  localized parse/save status under assistant messages only.
- Activity is live UI state, not persisted assistant text and not an injected
  content part.
- `packages/client` was rebuilt under Node 24 because its prior local `dist`
  lacked `index.cjs`, which made client Jest fail to resolve
  `@librechat/client`.

Frontend verification:

- Red frontend tests:
  - `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx --runInBand --coverage=false`
    first failed because `~/store/steel` did not exist.
  - `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --coverage=false`
    first failed because `~/store/steel` did not exist.
- `cd packages/client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed and restored `@librechat/client` CJS/ESM outputs for client Jest.
- `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx src/components/Chat/Messages/Content/__tests__/ContentParts.test.tsx --runInBand --coverage=false`
  passed with 13 tests.
- `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useResumableSSE.spec.ts --runInBand --coverage=false --testNamePattern "routes native Steel"`
  passed.
- `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx tsc --noEmit --project tsconfig.json --pretty false`
  passed.
- `git diff --check` passed.

Phase 9 decision correction - 2026-06-25:

- [x] Locked user correction: all Steel-related native modules are globally
      open by default.
- [x] Do not add Steel-specific role, capability, or permission gates for Steel
      rules, context, quote/OCR behavior, or read-only AI tools.
- [x] Preserve only existing LibreChat-owned permission paths for files, MCP
      auth, provider/model config, and admin settings.
- [x] Re-verified Steel model/default provider contracts under Node 24.

Phase 9 verification:

- `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "request-scoped Steel OCR files"`
  passed after the access-gate direction was removed.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/provider.spec.ts src/steel/models.spec.ts --coverage=false --runInBand`
  passed with 7 tests.
- `cd packages/data-provider && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/ai.spec.ts --coverage=false --runInBand`
  passed with 9 tests.
- `git diff --check` passed.

# Active: Phase 10 Native Steel UI Smoke And Rule Sync Check

Goal: verify the normal LibreChat chat path has global Steel context/tools,
captures Steel quote state from assistant Markdown, renders native Steel
activity, and follows the ERP `system_order` item numbering rule.

Plan:

- [x] Check whether the `10、20、30` item-number rule exists in local/global
      Steel rule content.
- [x] Query the cloud Steel `rules` table through `.env` `STEEL_POSTGRES_URL`
      without exposing secrets.
- [x] Update the mock Steel native fixture so successful output requires the
      `10、20、30` rule marker and emits `項次=10`.
- [x] Add E2E coverage that asserts the rendered system-order row uses
      `項次=10`, not sequential `1`.
- [x] Fix native Markdown extraction for persisted content-part text shaped as
      `{ text: { value } }`.
- [x] Rebuild the production frontend bundle before judging Playwright UI
      activity assertions.
- [x] Run focused frontend/backend tests and the native Steel mock E2E.

Findings:

- Cloud `steel.rules` contains the reviewed active
  `steel-workbook-output-policy` rule with `項次 採主項 / 次項：材料主項為
  10、20、30；附屬加工為 11、12、21、22。`
- The missing activity assertion was not a cloud rule sync issue. The backend
  SSE trace already emitted `steel_event` envelopes with the same final
  assistant `messageId`; the failing run served an old `client/dist` bundle
  from before the native Steel activity UI was built.

Review - 2026-06-26:

- Updated `e2e/setup/fake-model.js` so the Steel native smoke fixture requires
  the `10、20、30` context marker and returns a `system_order` table row with
  `項次=10`.
- Updated `e2e/specs/mock/steel-native.spec.ts` to assert the first rendered
  table row has `項次=10`.
- Updated `packages/api/src/steel/native/markdown.ts` and spec coverage so
  Markdown capture reads both string text parts and persisted
  `{ text: { value } }` content parts.
- Rebuilt production frontend assets with `npm run frontend`; mock Playwright
  uses those assets via the backend, so direct Playwright runs must not skip
  this step after client changes.

Verification:

- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run frontend`
  passed.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium`
  passed with 1 test.
- `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx src/components/Chat/Messages/Content/__tests__/ContentParts.test.tsx src/hooks/SSE/__tests__/useResumableSSE.spec.ts --runInBand --coverage=false --testNamePattern "Steel|steel"`
  passed with 7 matching tests; the unrelated non-Steel tests in that command
  were skipped by the test-name filter.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/markdown.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
  passed with 12 tests.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH node --check e2e/setup/fake-model.js`
  passed.

# Active: Phase 10 Native Steel Attachment Smoke Closeout

Goal: extend the normal LibreChat mock smoke so a Steel native quote turn with a
PDF provider attachment proves the file stays in LibreChat's provider-visible
file path while Steel context/tools/activity remain globally available.

Plan:

- [x] Add a failing Playwright mock assertion for Steel native context plus a
      PDF provider attachment.
- [x] Update the fake model harness so the assertion fails unless the Steel
      global context/tools are model-visible and the requested filename is
      still present in the latest provider file content.
- [x] Rebuild the production frontend bundle before judging Playwright UI
      behavior.
- [x] Re-run the focused mock E2E, frontend Steel activity tests, native
      package tests, JS syntax check, and `git diff --check`.
- [x] Record review evidence.

Design lock:

- This is a credential-free mock smoke for the normal LibreChat chat path.
- Do not call the real PaddleOCR/OCR runner from this smoke; package-level
  coverage already proves `run_file_ocr` receives permitted file bytes through
  injected dependencies.
- Do not change LibreChat layout. Steel activity stays under the assistant
  message through the existing content rendering slot.
- Native OpenAI OAuth API live smoke remains credential-dependent; contract
  coverage for the adapter/run seam remains the default non-secret proof unless
  a valid local OAuth auth file is available for a live run.

Review - 2026-06-26:

- Added a normal LibreChat mock E2E that uploads a provider PDF and requires
  Steel global context/tools plus the latest provider-visible filename before
  returning a `system_order` quote table.
- The first red run failed before final text because the mock endpoint context
  budget was too small for the native Steel prefix plus provider PDF message;
  `e2e/config/librechat.e2e.yaml` now gives `mock-model-a` a static 200000
  context window for this smoke fixture only.
- The second red run failed because the fake model harness did not yet know the
  Steel native PDF assertion marker.
- Green evidence is covered by the full `steel-native.spec.ts` Playwright run
  below, which now includes both the existing native smoke and provider-PDF
  smoke.

# Active: Phase 10 PL.pdf Two-Round OCR Quote Gate

Goal: prove the normal LibreChat chat path can handle the required Steel OCR
quote flow for `docs/reference/example/PL.pdf`: first assistant turn returns
OCR confirmation only, and the second turn after user confirmation returns a
quote from the confirmed OCR table without changing the existing LibreChat
layout.

Plan:

- [x] Add a failing normal-chat Playwright mock flow using `PL.pdf`:
      first turn uploads the PDF and asks for OCR confirmation, then asserts no
      `system_order` quote table is rendered.
- [x] Extend the fake model harness so first-turn PL OCR assertions require
      Steel global context/tools plus the requested provider filename.
- [x] Add a second-turn mock assertion that fails unless the previous assistant
      OCR confirmation table is visible in reconstructed conversation history.
- [x] Make the second turn return a `system_order` quote table only after user
      confirmation, keeping item numbering at `10` and activity under the
      assistant message.
- [x] Rebuild the production frontend bundle before Playwright judgment.
- [x] Re-run focused mock E2E, frontend Steel activity tests, native package
      tests, OAuth adapter/run tests, JS syntax check, and `git diff --check`.
- [x] Record review evidence and remaining live-OAuth/PaddleOCR manual smoke
      gaps.

Design lock:

- The product behavior is normal LibreChat chat with global Steel context, not
  `/steel/oauth-chat`.
- Credential-free mock E2E must not call the real PaddleOCR runner. Real
  OpenAI OAuth + PaddleOCR validation remains a manual/live smoke gated by
  local secrets and long timeouts.
- OCR first turn must not output `system_order` or `customer_quote` and must
  not imply final pricing.
- The confirmation turn must reuse the prior OCR confirmation from history and
  must not require a second file upload or a second OCR pass.
- Do not change LibreChat UI/UX layout; only assert existing message content,
  attachment chips, and Steel activity placement.

Review - 2026-06-26:

- Added `PL.pdf` as the real fixture upload source in
  `e2e/specs/mock/steel-native.spec.ts`.
- Added the two-turn normal-chat mock flow:
  - first turn uploads `PL.pdf`, requires Steel global context/tools and the
    provider-visible filename, renders only an OCR confirmation table, and
    asserts no `system_order` / `customer_quote` output;
  - second turn sends explicit user confirmation, requires the prior assistant
    OCR confirmation table in reconstructed history, and only then renders a
    `system_order` table with item number `10`.
- Extended `e2e/setup/fake-model.js` with PL OCR and PL quote markers so the
  test fails if normal chat history reconstruction loses the first OCR table.
- Synced reviewed cloud Steel rules from repo `docs/rules/*.txt` through
  `node packages/api/scripts/sync-steel-rules.cjs --apply`, then read back the
  active reviewed `steel-default-agent-instruction` and
  `steel-workbook-output-policy` rules. The readback confirms the required
  OCR gate fragments are present, including first-turn OCR confirmation,
  no price lookup before confirmation, no second `run_file_ocr` after
  confirmation, required `孔數 / 件` and `總孔數`, and `10/11/20/21` item
  numbering.
- OpenAI OAuth + real PaddleOCR live smoke was not run in this environment:
  `.env` has `STEEL_POSTGRES_URL`, but no `OPENAI_OAUTH_AUTH_FILE` and no
  PaddleOCR endpoint/API-key variables were configured.

Verification:

- Red test:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"`
  failed because `E2E Steel native PL OCR confirmation passed` was not rendered.
- Green focused PL flow:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"`
  passed with 1 test.
- Full Steel native mock E2E:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium`
  passed with 3 tests.
- Frontend Steel activity tests:
  `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx src/components/Chat/Messages/Content/__tests__/ContentParts.test.tsx src/hooks/SSE/__tests__/useResumableSSE.spec.ts --runInBand --coverage=false --testNamePattern "Steel|steel"`
  passed with 7 matching tests.
- Native package/OAuth/runtime tests:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/markdown.spec.ts src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts src/steel/tools/execute.spec.ts --coverage=false --runInBand`
  passed with 47 tests.
- Native OAuth run seam:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth"`
  passed with 1 matching test.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH node --check e2e/setup/fake-model.js`
  passed.
- `git diff --check` passed.

# Active: Phase 10 Prompt-Only OCR Strategy Research

Goal: realign the Steel OCR quote flow so `/steel/oauth-chat` and normal
LibreChat Steel chat are guided by prompt/rule context only. Do not add runtime
workflow gates such as `ocrWorkflow`, `policy_blocked`, or hidden tool blockers.

Correction lock:

- User correction: `/steel/oauth-chat` has no runtime gate; the first-turn OCR
  and second-turn quote behavior must come from agent prompt/rule guidance.
- Superseded direction: explicit OCR workflow phase signals, provider-side tool
  blocking, and activity UI for blocked calls.
- UI/UX lock: no LibreChat layout changes.

Plan:

- [x] Record the correction in `tasks/lessons.md`.
- [x] Remove the code-level `ocrWorkflow` and `policy_blocked` residues from
      runtime/native/provider/tool result paths.
- [x] Trace `/steel/oauth-chat` routing, history reconstruction, runtime
      context serialization, OpenAI OAuth prompt construction, and tool loop.
- [x] Reframe the strategy around prompt/rule/history/evidence rather than
      backend phase gates.
- [x] Run focused Jest/build/diff checks proving no runtime gate residues remain.
- [x] Record verification results and remaining live OpenAI OAuth / PaddleOCR
      smoke gap.

Research - 2026-06-26:

- `/steel/oauth-chat` routes `POST /ai/chat` and `POST /ai/chat/stream` through
  `createSteelHandlers`; file bytes are resolved as provider evidence files,
  not as a separate OCR workflow state machine.
- `prepareChatContext` reconstructs the active conversation history and appends
  the current user turn. The second user confirmation therefore reaches the
  provider together with the first assistant OCR confirmation table.
- `buildSteelRuntimeContext` passes `activeHistory`, `currentUserTurn`,
  `currentTurnFiles`, and Output Sheet Memory into `prepareSteelRuntimeContext`.
  It does not need to decide an OCR phase.
- `prepareSteelRuntimeContext` includes OCR-related reviewed rules whenever the
  current turn, prior history, or prior active file evidence indicates PDF/image
  OCR context. It also serializes prior OCR extracts from Output Sheet Memory.
- `sendSteelOAuthChat` creates the OpenAI OAuth Responses provider with
  `responsesState: false`, prepends `Steel Runtime Context` as a system
  instruction, passes file parts to the model, exposes Steel business tools, and
  uses `toolChoice: auto`.
- The provider loop executes whatever Steel tool calls the model selects, then
  appends assistant tool-call messages and tool-result messages back into the
  prompt for the next round. This is an agent loop, not a gate.
- Successful tool results are captured into Working Order Memory / Output Sheet
  Memory. That gives the next user turn prompt-visible OCR evidence without
  requiring another file upload or another `run_file_ocr` call.

Prompt-only strategy:

- First turn with a PDF: reviewed Steel rules plus current file evidence should
  guide the model to call `run_file_ocr`, then answer with an OCR confirmation
  table only.
- Before user confirmation: reviewed output rules should tell the model not to
  produce `system_order` or `customer_quote` quote tables.
- Second turn after user confirmation: reconstructed history plus prior OCR
  evidence should guide the model to reuse the confirmed OCR table, call
  pricing/search tools as needed, and produce ERP-facing quote tables.
- Verification should assert visible behavior, tool-call sequence, persisted
  OCR evidence, and rule availability. It should not add backend blockers that
  prevent `search_price_candidates` or `run_file_ocr` from executing.

Verification:

- Runtime gate residue scan:
  `rg -n "ocrWorkflow|policy_blocked|SteelRuntimeOcrWorkflow|resolveSteelRuntimeOcrWorkflow|mustNotSearchPricesBeforeConfirmation|mustNotRunFileOcrAgain" packages/api/src api/server client/src`
  returned no matches.
- Focused backend Jest:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/runtime/context.spec.ts src/steel/native/context.spec.ts src/steel/ai/provider.spec.ts src/steel/tools/execute.spec.ts --coverage=false --runInBand`
  passed with 48 tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `git diff --check` passed.
- Real OpenAI OAuth + PaddleOCR live smoke was not run in this correction pass;
  this pass proves the prompt-only code path compiles and the removed runtime
  gate names are absent from code.

# Active: Phase 10 OAuth Chat Prompt-Only Two-Round Regression

Goal: add a handler-level regression for the `/steel/oauth-chat` dev probe that
proves the second confirmation turn is reconstructed from conversation history
and prompt-visible prior OCR evidence, without adding `ocrWorkflow`,
`policy_blocked`, or any runtime tool gate.

Plan:

- [x] Add a failing `packages/api/src/steel/handlers.spec.ts` test for a
      two-turn `PL.pdf` conversation where the second user message confirms the
      first OCR table.
- [x] Verify the red attempt. It exposed a test setup import error rather than
      a production behavior gap.
- [x] Implement the smallest needed change: fix the test import/helper and keep
      production runtime unchanged.
- [x] Run focused handler/runtime/provider tests and `git diff --check`.
- [x] Record review evidence and whether real OpenAI OAuth + PaddleOCR live
      smoke remains pending.

Design lock:

- `/steel/oauth-chat` remains a dev/smoke surface; product behavior still lives
  in normal LibreChat global native hooks.
- The regression must prove prompt-only behavior: second-turn provider input
  has the prior assistant OCR table in `messages`, prior OCR evidence in
  runtime context, AI-visible Steel tools, and no runtime OCR phase/gate field.
- Do not assert exact human-authored rule wording. Assert stable metadata,
  message reconstruction, tool visibility, and absence of gate fields.

Review - 2026-06-26:

- Added a two-call handler regression in `packages/api/src/steel/handlers.spec.ts`:
  - first call uploads `PL.pdf`, receives a mocked `run_file_ocr` tool-status
    result, returns an OCR confirmation table, and persists OCR evidence through
    the real Mongo-backed Working Order Memory writer;
  - second call sends a user confirmation in the same conversation and verifies
    provider input contains the prior assistant OCR table, prior OCR evidence in
    runtime context, AI-visible Steel tools, and no `ocrWorkflow` /
    `policy_blocked` runtime gate fields.
- The first red run failed because the new test missed the
  `createMongooseSteelOutputSheetMemoryReader` import. That was a test setup
  issue, not a product behavior gap.
- After fixing the test import/helper, no production code change was required:
  the existing prompt-only history + memory reconstruction path satisfies the
  contract.
- Environment check found `.env` contains database connection keys, but no
  `OPENAI_OAUTH_AUTH_FILE` and no PaddleOCR endpoint/API-key/MCP command
  variables, so real OpenAI OAuth + PaddleOCR `PL.pdf` live smoke remains
  pending.

Verification:

- Red/setup run:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/handlers.spec.ts --coverage=false --runInBand --testNamePattern "reconstructs confirmed PL.pdf OCR follow-up"`
  failed with `ReferenceError: createMongooseSteelOutputSheetMemoryReader is not defined`.
- Green focused regression:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/handlers.spec.ts --coverage=false --runInBand --testNamePattern "reconstructs confirmed PL.pdf OCR follow-up"`
  passed with 1 matching test.
- Focused backend suites:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/handlers.spec.ts src/steel/runtime/context.spec.ts src/steel/ai/provider.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts --coverage=false --runInBand`
  passed with 65 tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `git diff --check` passed.
- Runtime gate residue scan:
  `rg -n "ocrWorkflow|policy_blocked|SteelRuntimeOcrWorkflow|resolveSteelRuntimeOcrWorkflow|mustNotSearchPricesBeforeConfirmation|mustNotRunFileOcrAgain" packages/api/src api/server client/src`
  now returns only the new negative assertions in
  `packages/api/src/steel/handlers.spec.ts`.
- Normal LibreChat PL.pdf mock E2E:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"`
  passed with 1 test.

# Active: Phase 10 Native OAuth Follow-Up Prompt Regression

Goal: protect the normal LibreChat OpenAI OAuth adapter path so reconstructed
native chat history can carry the first OCR confirmation table into the second
user confirmation turn while preserving `PL.pdf` provider file parts and
AI-visible Steel tools.

Plan:

- [x] Add a `packages/api/src/steel/native/oauth.spec.ts` regression
      covering system Steel context, prior assistant OCR table, current
      confirmation text, current `PL.pdf` file part, and Steel tool schema in
      one native OpenAI OAuth invoke.
- [x] Verify the run. The regression passed immediately, so the adapter already
      satisfied this prompt reconstruction contract.
- [x] Implement the smallest native OAuth adapter change if the red run exposes
      a real gap. No production change was needed.
- [x] Run focused native OAuth/provider/run tests, API build, and
      `git diff --check`.
- [x] Record review evidence and the remaining real OpenAI OAuth + PaddleOCR
      `PL.pdf` live smoke gap.

Design lock:

- This is normal LibreChat native chat coverage, not `/steel/oauth-chat`.
- OpenAI OAuth stays stateless with `responsesState: false`.
- The test should assert stable provider call structure: roles, OCR table
  history text, confirmation text, `PL.pdf` file part, `toolChoice:auto`, and
  tool names. Do not assert reviewed rule wording.

Review - 2026-06-26:

- Added native OpenAI OAuth adapter regression coverage in
  `packages/api/src/steel/native/oauth.spec.ts`.
- The regression invokes the adapter with:
  - system Steel Runtime Context text;
  - a prior assistant OCR confirmation markdown table;
  - the current user confirmation turn;
  - a current `PL.pdf` `input_file` part;
  - `run_file_ocr` and `search_price_candidates` tool schemas.
- The assertion verifies the OpenAI OAuth provider call receives the full
  reconstructed prompt, keeps the assistant OCR table as assistant history,
  converts the current `PL.pdf` into an AI SDK file part, and uses
  `toolChoice: auto` with both Steel tools.
- The new regression passed on the first valid run, so the existing adapter
  already satisfied this contract; no production code change was required.
- Checked the new native OAuth spec for banned wording-fragment matchers:
  no `stringContaining`, `toContain`, or `toMatch` remain in that spec.
- `.env` currently exposes `MONGO_URI` and `STEEL_POSTGRES_URL`, but not
  `OPENAI_OAUTH_AUTH_FILE` or PaddleOCR endpoint/API-key/MCP command
  variables, so real OpenAI OAuth + PaddleOCR `PL.pdf` live smoke remains
  pending.

Verification:

- Focused native OAuth/provider/run pattern:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth|OAuth|reconstructed PL.pdf|Steel native"`
  passed with 11 matching tests.
- Full relevant native OAuth/provider/run suites:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand`
  passed with 75 tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `git diff --check` passed.
- `rg -n "stringContaining|toContain|toMatch" packages/api/src/steel/native/oauth.spec.ts`
  returned no matches.

# Active: Phase 10 PL.pdf Live Smoke Harness

Goal: add a direct manual live smoke target for the final fixture
`docs/reference/example/PL.pdf`, using OpenAI OAuth `gpt-5.5` and the
prompt-only two-round OCR confirmation flow.

Plan:

- [x] Add a gated manual Jest spec for `PL.pdf` live smoke, separate from the
      existing PB-specific manual spec.
- [x] Keep user prompts simple and free of embedded rule/tool instructions.
- [x] Assert first turn runs OCR and does not call price lookup before user
      confirmation.
- [x] Assert second turn uses the confirmed OCR table, does not rerun OCR, calls
      price lookup, and returns a quote table.
- [x] Run the spec in default skipped mode, focused backend checks, API build,
      and `git diff --check`.
- [x] Record the exact env gap if the real live run still cannot execute.

Design lock:

- Manual live smoke is gated by `STEEL_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true`
  so normal local test runs stay deterministic.
- Do not copy PB.pdf's full fixture-specific ERP assertions; keep this target
  focused on the final requested `PL.pdf` two-round quote behavior.
- Do not add OCR runtime gates. The model is guided by reviewed runtime rules,
  prompt history, confirmed OCR evidence, and tool availability.

Review - 2026-06-26:

- Added `packages/api/src/steel/ai/provider.pl-pdf-quote.manual.spec.ts`, a
  gated manual live smoke for `docs/reference/example/PL.pdf`.
- The live spec uses two plain user turns:
  - first: `請處理附檔 PL.pdf。`
  - second: `確認上一輪 OCR 表格正確，請依 OCR 表單給出報價。`
- The spec verifies the strategy through provider/tool behavior rather than a
  backend workflow gate:
  - OpenAI OAuth model must be `gpt-5.5`;
  - first turn must complete `run_file_ocr`;
  - first turn must not call `search_price_candidates`;
  - first assistant response must include an OCR confirmation table;
  - second turn includes the previous assistant OCR table and OCR tool evidence;
  - second turn must not rerun OCR;
  - second turn must call `search_price_candidates`;
  - second assistant response must include a quote table.
- No `ocrWorkflow` or `policy_blocked` runtime gate was added. The AI agent is
  guided by serialized Steel runtime context, reviewed OCR/output rules,
  reconstructed conversation history, confirmed OCR evidence, and visible tools.
- The manual spec avoids exact human-wording match assertions; the local grep
  check found no `stringContaining`, `toContain`, or `toMatch` in the new file.
- Live run env gap remains:
  - `.env` has `MONGO_URI` and `STEEL_POSTGRES_URL`;
  - `.env` does not expose `OPENAI_OAUTH_AUTH_FILE`;
  - `.env` does not expose PaddleOCR endpoint/API key or MCP command variables.

Verification:

- Manual spec readiness with live env disabled:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/ai/provider.pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
  passed with 1 skipped test. This override is required because repo Jest
  config intentionally ignores `*.manual.spec.ts`.
- Focused backend behavior:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/ai/provider.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts --coverage=false --runInBand`
  passed with 43 tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `git diff --check` passed.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx tsc --noEmit --project tsconfig.spec.json --pretty false`
  still fails on existing unrelated errors in Redis cache typing,
  `provider.pb-pdf-quote.manual.spec.ts`, `provider.pricing-live.manual.spec.ts`,
  Steel memory service spec, rule repository typing, and PaddleOCR manual specs;
  the new `provider.pl-pdf-quote.manual.spec.ts` is not in the error list.

# Active: Phase 10 Native OpenAI OAuth PL.pdf Live Smoke Harness

Goal: add a gated live smoke target for the normal LibreChat native OpenAI OAuth
adapter path, using `docs/reference/example/PL.pdf`, `gpt-5.5`, visible Steel
tools, and the prompt-only two-round OCR confirmation quote flow.

Plan:

- [x] Add a native OpenAI OAuth manual spec that uses the native LangChain
      message/file/tool adapter shape, not `/steel/oauth-chat`.
- [x] Keep first and second user prompts simple and free of embedded tool/rule
      instructions.
- [x] In the first turn, assert the model calls `run_file_ocr`, does not call
      `search_price_candidates`, and returns an OCR confirmation table.
- [x] In the second turn, assert the prompt carries the prior assistant OCR
      table and prior OCR evidence, does not re-upload or re-OCR by default,
      calls `search_price_candidates`, and returns a quote table.
- [x] Run the new manual spec in default skipped mode, focused native/OAuth
      suites, API build, matcher grep, runtime-gate grep, and `git diff --check`.
- [x] Record the remaining real live run env gap if credentials/PaddleOCR are
      still absent.

Design lock:

- This harness is native adapter evidence for normal LibreChat chat parity; it
  must not make `/steel/oauth-chat` a product dependency.
- Do not add `ocrWorkflow`, `policy_blocked`, or hidden runtime blockers. The
  strategy remains model-guided by serialized Steel runtime context, reviewed
  rules, prompt history, prior OCR evidence, and auto-selected tools.
- Do not change LibreChat UI/UX layout.

Review - 2026-06-26:

- Added `packages/api/src/steel/native/oauth-pl-pdf-quote.manual.spec.ts`, a
  gated live smoke for the native OpenAI OAuth adapter path.
- The spec uses `buildSteelGlobalAgentContext()` and
  `createOpenAIOAuthModel()`, then runs native-style LangChain
  messages through a small manual tool loop:
  - first turn sends `PL.pdf` as a provider `input_file`, binds native Steel
    tool definitions, executes returned Steel tool calls through
    `executeSteelTool()`, and writes JSON tool results back as `ToolMessage`;
  - second turn sends no provider file part, includes the prior assistant OCR
    table in reconstructed history, includes prior OCR evidence in native
    runtime context, and runs the same native OAuth/tool loop.
- Real live smoke passed using `gpt-5.5`, `/Users/neven/.codex/auth.json`, and
  the repo `.env` PaddleOCR MCP token:
  - first turn took 2 model/tool rounds and called only `run_file_ocr`;
  - second turn took 2 model/tool rounds and called only
    `search_price_candidates`;
  - reusable OCR evidence count was 1;
  - first assistant response returned an OCR confirmation table;
  - second assistant response returned a quote table with ERP-style `項次`,
    `型號`, and `品名規格` headers.
- Evidence was written to
  `tmp/steel-native-openai-oauth-pl-pdf-quote-live-evidence.json`; a local scan
  found no `access_token`, `authorization`, `Bearer`, or `authFile` marker.
- No `ocrWorkflow`, `policy_blocked`, runtime blocker, or UI/UX layout change
  was added. The live pass is still adapter/harness-level native evidence; a
  full browser UI live run remains a separate Phase 10 parity check.

Verification:

- First live attempt without ESM VM support:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true OPENAI_OAUTH_AUTH_FILE=/Users/neven/.codex/auth.json npx jest src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
  failed before provider execution with Jest dynamic import error:
  `A dynamic import callback was invoked without --experimental-vm-modules`.
- Live native OpenAI OAuth + PaddleOCR PL.pdf smoke:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH NODE_OPTIONS=--experimental-vm-modules STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true OPENAI_OAUTH_AUTH_FILE=/Users/neven/.codex/auth.json npx jest src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
  passed with 1 test in 201103 ms.
- Manual spec readiness with live env disabled:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
  passed with 1 skipped test.
- Focused native OAuth/tool/run suites:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/tools.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth|OAuth|reconstructed PL.pdf|Steel native|tool adapter"`
  passed with 16 tests and 64 skipped tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `rg -n "stringContaining|toContain|toMatch" packages/api/src/steel/native/oauth-pl-pdf-quote.manual.spec.ts`
  returned no matches.
- `rg -n "ocrWorkflow|policy_blocked" packages/api/src/steel/native/oauth-pl-pdf-quote.manual.spec.ts packages/api/src/steel/native packages/api/src/steel/ai/provider.ts packages/api/src/steel/handlers.ts`
  returned no matches.
- `git diff --check` passed.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx tsc --noEmit --project tsconfig.spec.json --pretty false`
  still fails on existing unrelated Redis/manual-spec/rule-repository errors;
  the new native PL OAuth manual spec is not in the error list.

# Active: Phase 10 OAuth Chat Agent Strategy Re-Review

Goal: re-study `/steel/oauth-chat` as a development probe and lock how it guides
the AI agent without runtime OCR workflow gates, so the same strategy can be
carried into normal LibreChat native chat.

Plan:

- [x] Re-read `/steel/oauth-chat` route, handler, runtime context, provider loop,
      native context, and native tool merge call sites.
- [x] Separate prompt/rule guidance from runtime blockers.
- [x] Compare the standalone OAuth chat path against native LibreChat agent,
      Responses, OpenAI-compatible, ToolService, and provider-policy seams.
- [x] Record the strategy lock and remaining browser UI parity gap.

Research - 2026-06-26:

- `/steel/oauth-chat` is still a dev-only route. It enters through
  `api/server/routes/steel/index.js`, then `createSteelHandlers()` in
  `packages/api/src/steel/handlers.ts`.
- The route reconstructs conversation history in `prepareChatContext()`, then
  calls `prepareSteelRuntimeContext()` through `buildSteelRuntimeContext()`.
  The second confirmation turn therefore includes the prior assistant OCR
  table as normal chat history.
- `prepareSteelRuntimeContext()` decides whether OCR/file rules are present
  from current files, active history, current turn, and persisted OCR evidence.
  This is context selection, not a runtime workflow phase.
- `sendSteelOAuthChat()` prepends `Steel Runtime Context` as a system
  instruction, uses `openai-oauth-provider` with `responsesState: false`,
  exposes Steel tools with `toolChoice: auto`, and appends assistant tool calls
  plus JSON tool-result messages back into the next provider round.
- The apparent "OCR confirmation gate" lives in reviewed rule text such as
  `docs/rules/agent規則.txt`; it is a prompt contract. It must not become
  `ocrWorkflow`, `policy_blocked`, or provider-side tool blocking.
- Normal LibreChat already follows the same shape through native seams:
  `AgentClient`, Responses, and OpenAI-compatible controllers build
  `buildDefaultSteelGlobalAgentContext()`, place stable rules in agent
  instructions, place runtime workbook/context text in `additional_instructions`,
  and let `ToolService` merge executable Steel tools into normal LibreChat tool
  loading.
- OpenAI OAuth API support in normal LibreChat is owned by the native provider
  policy / graph override path, not by routing product traffic through
  `/steel/oauth-chat`.

Strategy lock:

- Keep `/steel/oauth-chat` only as a comparator for prompt construction, live
  OAuth/PaddleOCR behavior, and activity-log inspection.
- Preserve the prompt-only two-turn flow:
  first turn with PDF/image -> model calls `run_file_ocr` and returns OCR
  confirmation table only; user confirms or corrects; second turn -> model
  reuses confirmed OCR/history/evidence, calls pricing tools, and returns quote
  tables.
- Do not add hidden runtime blockers for wrong tool choice. Improve behavior by
  tightening reviewed rules, context ordering, tool descriptions, persisted OCR
  evidence, and verification fixtures.
- Native parity proof should verify prompt-visible prior OCR table/evidence,
  tool-call sequence, quote output, and no UI/UX layout change. The remaining
  work is a full browser UI live smoke for normal LibreChat with OpenAI OAuth
  API and `PL.pdf`.

# Active: Phase 10 LibreChat Native Context De-Duplication

Goal: split LibreChat native Steel context preparation from `/steel/oauth-chat`
context preparation so normal LibreChat chat history remains the only source of
prompt-visible user/assistant text, while Steel runtime context carries only
non-chat-content state and metadata before browser UI live smoke work continues.

Plan:

- [x] Compare `/steel/oauth-chat` `prepareChatContext()` with normal LibreChat
      native agent history construction.
- [x] Identify whether prior assistant OCR Markdown is already sent through
      normal provider messages.
- [x] Add focused coverage proving LibreChat native runtime context does not
      carry chat message text or prior assistant OCR Markdown.
- [x] Add LibreChat-native `prepareChatContext` and `prepareRuntimeContext`
      seams instead of reusing `/steel/oauth-chat` `prepareChatContext()` or the
      generic `prepareSteelRuntimeContext()` directly.
- [x] Replace serialized native history content with metadata/reference fields
      while preserving rule selection, tool policy, workbook state, and file
      metadata.
- [x] Run focused Steel context/provider/handler checks and grep for forbidden
      runtime OCR gates.

Research - 2026-06-26:

- `/steel/oauth-chat` still needs `prepareChatContext()`. It owns the dev-only
  endpoint's DB-backed history window, edit handling, queued steer source,
  assistant turn index, and workbook/state checkpoint indices.
- Standard LibreChat native chat already builds provider history from
  `orderedMessages` in `AgentClient`; OpenAI OAuth native adapter converts
  those BaseMessages into provider user/assistant/tool messages.
- The duplicate is not `prepareChatContext()` by itself. The duplicate is
  `serializeSteelRuntimeContext()`, which currently serializes
  `conversation.activeHistory[].content` and `currentUserTurn.content` into the
  runtime context that is also prepended as system/additional instructions.
- For the PL.pdf two-turn flow, the prior assistant OCR table should appear via
  normal chat history only. Runtime context may keep role/message/file
  references for diagnostics and rule selection, but should not include the
  assistant OCR Markdown body again.
- LibreChat native also needs a dedicated runtime preparer. It should not pass
  raw LibreChat chat text through the generic Steel runtime context path. Its
  context contract is non-chat-content state: reviewed rules, tool policy,
  Markdown-derived workbook/quote summary and indexes, OCR/file evidence
  references, attachment metadata, request IDs, and diagnostic metadata.
- Workbook/quote state originates from assistant response Markdown that is auto
  parsed and saved. Native context should not inline full saved Markdown tables.
  Full information should be the assistant Markdown in chat history, with a
  read-Markdown style tool available to recover parsed/saved quote or workbook
  content from the database when token compression loses it.
- One LibreChat conversation maps to one current Steel workbook and one current
  OCR dataset. `read_markdown` must read by backend conversation id and
  explicit `scope: "workbook"` or `scope: "ocr"` only; it should not require
  semantic row queries, expose standalone quote/all scopes, or expose multiple
  datasets per chat.
- Assistant updates to workbook/quote tables must output complete tables.
  Auto parse/save should whole-table overwrite the current conversation data
  from the complete Markdown table. It should not infer row deletions, row
  updates, or retained rows by applying partial patches.
- Backend auto parse merges at workbook/quote sheet level: latest assistant
  Markdown tables replace the corresponding current sheet in the singleton
  workbook/quote; omitted sheets carry forward from the database. This is parse
  and sheet merge only, not backend business reasoning.
- In OCR confirmation/correction turns, AI should not call `run_file_ocr`
  again unless the user explicitly requests rerun OCR or supplies new/changed
  file evidence. It should update the OCR/quote Markdown from chat history and
  user corrections, return the complete latest table, and let backend auto
  parse/save update the current conversation state.

Review - 2026-06-26:

- Added LibreChat-native chat/context preparation:
  `prepareLibreChatSteelChatContext()` and
  `prepareLibreChatSteelRuntimeContext()` keep provider chat history as the
  only prompt-visible source of user/assistant text, and serialize native
  runtime messages as metadata references with `contentSource:
  provider_messages`.
- Native AgentClient, Open Responses, and OpenAI-compatible controller paths now
  call the LibreChat-specific chat context preparer before building Steel global
  context.
- Replaced workbook row keyword recovery with `read_markdown` only. The legacy
  active-workbook reader was removed from schema, registry, executor, tests,
  rule sync script, and reviewed rule docs. `rg` over the repo for the old tool
  identifier now returns no matches.
- `read_markdown` is strict scope-only (`workbook` or `ocr`) and reads the
  active conversation's current Markdown-derived singleton dataset from the
  output-sheet memory reader. It converts DB JSON rows/evidence into Markdown
  text for the AI, and rejects row queries, quote/all scopes, and conversation
  ids before reading DB state.
- Auto parse/save now treats backend parsing as sheet-level merge only: latest
  complete assistant Markdown tables replace the matching current sheet by
  deleting overwritten rows and inserting the latest current rows, while omitted
  sheets carry forward. Partial row-change Markdown is saved as
  calculation/manual-review evidence and does not patch active rows. OCR tool
  capture similarly replaces the current OCR dataset for the conversation.
- Tool and rule policy now says OCR confirmation/correction turns should update
  and return complete latest OCR/quote Markdown directly; `run_file_ocr` is for
  explicit rerun requests or new/changed file evidence.
- Verification:
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 73 tests.
  - `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/controllers/agents/client.test.js server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 121 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build` passed.
  - Repo-wide grep for legacy active-workbook tool identifiers returned no
    matches.
  - `rg -n "ocrWorkflow|policy_blocked|SteelRuntimeOcrWorkflow|resolveSteelRuntimeOcrWorkflow|mustNotSearchPricesBeforeConfirmation|mustNotRunFileOcrAgain" packages/api/src api/server client/src` returned only negative assertions in `packages/api/src/steel/handlers.spec.ts`.
  - `git diff --check` passed.

## Phase 11 Native read_markdown History-First Usage Limit

Goal:

- Add an AI-visible `read_markdown` usage limit for native LibreChat Steel:
  the agent must inspect provider chat history first, and must not call
  `read_markdown` when the needed OCR/workbook Markdown is already present and
  complete enough in chat history.
- Keep this as prompt/tool-policy guidance only. Do not add a runtime gate,
  `ocrWorkflow`, or hidden backend blocker.
- Preserve the existing `read_markdown` scope contract: only `workbook` and
  `ocr`; no standalone quote/all scopes, row queries, or conversation ids.

Plan:

- [x] Add failing tests for structured `read_markdown` usage policy metadata in
  the Steel tool registry and serialized runtime context.
- [x] Implement the structured policy and mirror it into the AI-visible tool
  description / runtime context.
- [x] Update reviewed agent rules and lessons so future changes keep the same
  history-first behavior.
- [x] Run focused registry/runtime tests plus `git diff --check` and targeted
  greps.

Review - 2026-06-26:

- Added structured `read_markdown` usage policy metadata:
  `requiresMissingMarkdownInHistory`, `forbiddenWhenHistoryHasNeededMarkdown`,
  `allowedScopes`, and `currentConversationScoped`.
- Serialized the same policy into Steel runtime `toolPolicy` so native
  LibreChat context tells the agent to inspect provider chat history first and
  avoid `read_markdown` when the needed OCR/workbook Markdown is already present
  and complete enough.
- Updated reviewed agent rules and lessons with the same history-first
  restriction. This remains prompt/tool-policy guidance only; no runtime gate or
  OCR workflow blocker was added.
- Verification:
  - RED: `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/runtime/context.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` failed because `usagePolicy` and `readMarkdownUsagePolicy` were undefined.
  - GREEN: the same command passed with 2 suites / 17 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 7 suites / 75 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build` passed.
  - `git diff --check` passed.
  - Targeted grep found the new history-first policy in registry/runtime/rules
    and only negative assertions for `ocrWorkflow` / `policy_blocked`.

## Phase 12 Delete Duplicate Steel Read/Rule Tools

Goal:

- Delete `lookup_quote_rules` and `read_working_order_items` from the Steel
  tool surface entirely.
- `lookup_quote_rules` is redundant because reviewed quote rules are injected
  into runtime context.
- `read_working_order_items` is redundant with `read_markdown`, which recovers
  current workbook/OCR Markdown for the active conversation.
- Keep internal auto parse/save storage intact; this phase deletes the AI/tool
  execution surface, not workbook/OCR persistence.

Plan:

- [x] Add failing tests proving both tool names are no longer schema keys,
  executable tools, or runtime `removedTools`.
- [x] Remove schema entries, registry definitions, executor dispatch cases, and
  read event handling for the deleted tools.
- [x] Update docs/lessons to point to context injection and `read_markdown`
  instead.
- [x] Run focused Steel tests, build, targeted grep, and `git diff --check`.

Review - 2026-06-26:

- Deleted `lookup_quote_rules` and `read_working_order_items` from
  `steelToolArgsSchemas`, executable registry definitions, executor dispatch,
  runtime `removedTools`, and stream memory-read event handling.
- Removed `lookup_quote_rules` tool-result memory capture and stale
  `read_working_order_items` executor wiring. Internal Working Order Memory
  persistence/reader code remains for auto parse/save verification and DB-backed
  current workbook state; it is no longer exposed as a Steel tool.
- Updated legacy instruction sanitization to reference runtime-context reviewed
  quote rules instead of `lookup_quote_rules`.
- Verification:
  - RED: `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/runtime/context.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` failed because schema keys and runtime `removedTools` still contained the deleted names.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 7 suites / 73 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build` passed.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/handlers.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 1 suite / 22 tests.
  - `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --coverage=false --runInBand --testNamePattern "Steel|OCR|native" --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 1 focused test.
  - `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 1 suite / 60 tests after updating generic MCP assertions to compare non-Steel tool definitions separately from globally injected Steel native tools.
  - Targeted grep over non-test source/docs found no
    `lookup_quote_rules`, `read_working_order_items`,
    `ReadWorkingOrderItemsInput`, `createWorkingOrderMemoryReader`, or
    `memoryReader:` matches.
  - `git diff --check` passed.

Review update - 2026-06-26:

- Tightened `read_markdown` to the final AI-facing contract:
  - only `scope: "workbook"` or `scope: "ocr"` is accepted;
  - standalone quote/all scopes are rejected because quote data belongs inside
    workbook;
  - DB JSON rows/evidence are converted into Markdown text before returning to
    the AI;
  - workbook Markdown includes strict workbook/quote sheets, while OCR Markdown
    preserves free-form OCR/drawing text and metadata for the AI to organize.
- Changed structured storage overwrite behavior to current-only for workbook
  and OCR:
  - emitted complete workbook/quote sheets delete overwritten rows and insert
    the latest current rows;
  - OCR capture deletes the previous current OCR extract dataset for the
    conversation before inserting the latest OCR result;
  - partial row-change Markdown remains calculation/manual-review evidence and
    does not patch workbook rows.
- Updated reviewed agent rule docs, sync script tool policy, master framework,
  and implementation plan to match the `read_markdown` Markdown-output and
  current-only workbook/OCR contract.
- Verification:
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 75 tests.
  - `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/controllers/agents/client.test.js server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 121 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth|OAuth|reconstructed PL.pdf|Steel native" --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 11 focused tests.
  - `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run frontend` passed.
  - `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"` passed.
  - Native OpenAI OAuth + PaddleOCR live smoke was first blocked by provider
    quota, then re-run successfully after quota became available:
    `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH NODE_OPTIONS=--experimental-vm-modules STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_TIMEOUT_MS=1200000 npx jest src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testNamePattern "returns OCR confirmation first, then quotes from confirmed OCR evidence" --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 1 live test in 188.53s.
  - Live evidence was written to
    `tmp/steel-native-openai-oauth-pl-pdf-quote-live-evidence.json`: first turn
    called only `run_file_ocr` and returned OCR confirmation Markdown; second
    turn included prior assistant OCR Markdown in normal chat history, called
    `search_price_candidates`, did not call `run_file_ocr`, did not call
    `read_markdown`, and returned `system_order`, `customer_quote`, and
    `manual_review`.
  - Repo-wide grep for legacy active-workbook tool identifiers returned no
    matches.
  - `rg -n "ocrWorkflow|policy_blocked|SteelRuntimeOcrWorkflow|resolveSteelRuntimeOcrWorkflow|mustNotSearchPricesBeforeConfirmation|mustNotRunFileOcrAgain" packages/api/src api/server client/src` returned only negative assertions in `packages/api/src/steel/handlers.spec.ts`.
  - `git diff --check` passed.

Completion review - 2026-06-26:

- `lookup_quote_rules` and `read_working_order_items` are deleted from the
  provider-visible Steel tool surface. Quote rules are injected through context,
  and current workbook/OCR recovery is handled by `read_markdown`.
- `read_markdown` remains the only AI-visible DB recovery read tool for
  workbook/OCR Markdown, with the history-first usage limit preserved in tool
  metadata, runtime context, and reviewed rules.
- Normal LibreChat native chat now has global Steel context/tools, OpenAI OAuth
  provider support, and the two-turn PL.pdf OCR confirmation then quote flow
  without adding `ocrWorkflow`, `policy_blocked`, or hidden OCR runtime gates.
- LibreChat UI/UX layout was not restructured. Client changes add SSE handling,
  Recoil state, and a small Steel activity line inside existing assistant
  message content; sidebar, composer, navigation, and message container layout
  are unchanged.
- Final verification:
  - Steel focused suite:
    `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 7 suites / 73 tests.
  - API focused suite:
    `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/controllers/agents/client.test.js server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js server/services/__tests__/ToolService.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 4 suites / 181 tests.
  - Full ToolService spec:
    `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 1 suite / 60 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
    passed.
  - `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run frontend`
    passed.
  - OAuth focused suite:
    `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth|OAuth|reconstructed PL.pdf|Steel native" --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 11 focused tests.
  - Native OpenAI OAuth + PaddleOCR live PL.pdf smoke passed with model
    `gpt-5.5`, using `docs/reference/example/PL.pdf`.
  - Mock UI E2E:
    `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"`
    passed.
  - Targeted grep over non-test source/docs found no
    `lookup_quote_rules`, `read_working_order_items`,
    `ReadWorkingOrderItemsInput`, `createWorkingOrderMemoryReader`, or
    `memoryReader:` matches.
  - `git diff --check` passed.

## OpenAI OAuth File OCR Title Generation - 2026-06-27

- [x] Reproduced the title-input issue at the backend title-generation seam:
  file-only OCR turns submit the generic OCR review prompt, so immediate title
  generation can lose the uploaded filename.
- [x] Updated `AgentClient#titleConvo` OpenAI OAuth path to pass the current
  OCR attachment filename plus a title-generation rule to the AI, without
  changing the actual chat message text.
- [x] Kept `generateOpenAIOAuthTitle` model-driven: it now returns the model
  title directly and does not apply a `preferredTitle` override.
- [x] Added regression tests for:
  - passing `PL.pdf` and the file-review title rule into OpenAI OAuth title
    generation;
  - preserving model-driven title output while verifying the filename guidance
    is present in the prompt.
- Verification:
  - `cd packages/api && rtk npx jest src/steel/native/title.spec.ts --runInBand --watch=false --coverage=false` passed with 2 tests.
  - `cd api && rtk npx jest server/controllers/agents/client.test.js --runInBand --watch=false --coverage=false` passed with 88 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.

## PaddleOCR MCP Live Server Check - 2026-06-27

- [x] Raised PaddleOCR MCP timeout to 20 minutes (`1200000` ms) for both
  LibreChat MCP config and Steel direct OCR helper defaults.
- [x] Restarted the backend for local testing on port `3080`.
- [x] Verified the running backend is serving `http://localhost:3080/`.
- [x] Verified backend logs initialize `PaddleOCR-VL-1.6` and expose the
  `paddleocr_vl` MCP tool.
- [x] Started the Vite frontend dev server for browser testing on port `3090`.
- Verification:
  - `rtk lsof -nP -iTCP:3080 -sTCP:LISTEN` showed PID `18428` listening on
    `[::1]:3080`.
  - `rtk curl -sS -o /tmp/librechat-root.html -w "%{http_code}\n" http://localhost:3080/`
    returned `200`.
  - Backend log showed `PaddleOCR-VL-1.6.timeout: 1200000`, `Tools:
    paddleocr_vl`, and `[MCP] Initialized with 1 configured server and 1 tool.`
  - `rtk lsof -nP -iTCP:3090 -sTCP:LISTEN` showed PID `24348` listening on
    `[::1]:3090`.
  - `rtk curl -sS -o /tmp/librechat-vite.html -w "%{http_code}\n" http://localhost:3090/`
    returned `200`.
  - `rtk git diff --check` passed.

## PaddleOCR MCP Env and Exact OCR Rules - 2026-06-27

- [x] Trace whether the running backend and MCP subprocess receive
  `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN` without printing the secret.
- [x] Verify whether LibreChat expands `${PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN}`
  in `librechat.yaml` before spawning the PaddleOCR MCP server.
- [x] Fix PaddleOCR MCP tool exposure so it is loaded during initialization
  every turn, not only after current-turn file propagation detects PDFs/images.
- [x] Update OCR rules so dimensions/quantities/thicknesses must be exact from
  OCR evidence and may not be written as approximate values such as `約 600 x
  300`.
- [x] Sync the updated OCR rule into cloud `steel.rules`.
- [x] Rebuild/restart the local stack and verify both MCP availability and OCR
  rule sync.
- Evidence:
  - `.env` readback showed `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN=SET` with a
    non-placeholder value; parsing `librechat.yaml` without dotenv leaves the
    placeholder literal, so the token must be present before config parsing.
  - `api/db/connect.js` loads dotenv during backend module import, so the
    remaining live failure path was missing current-turn OCR file references,
    not a missing repo `.env` value.
  - Added AgentClient fallback from processed files to original request
    attachments, covering uploaded PDFs reported as `application/octet-stream`
    but named `*.pdf`.
  - Added ToolService debug log when PaddleOCR MCP is injected during tool
    initialization; OCR-capable file references are logged when present.
  - `rtk node packages/api/scripts/sync-steel-rules.cjs --dry-run` passed.
  - `rtk node packages/api/scripts/sync-steel-rules.cjs --apply` passed and
    read back `steel-drawing-ocr-policy` SHA
    `555f69058d36413996372006bdec58ec37c51f8734e9ccb86a6edfb0268fccec`.
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed with 63 tests.
  - `cd api && rtk npx jest server/controllers/agents/client.test.js --runInBand --watch=false --coverage=false --testNamePattern "buildMessages with request and agent-scoped context attachments"`
    passed with 9 focused tests.
  - Restarted backend on port `3080`; `rtk lsof -nP -iTCP:3080 -sTCP:LISTEN`
    showed PID `54802`, and `curl http://localhost:3080/` returned `200`.
  - Frontend dev server on port `3090` remained live and returned `200`.
  - Backend log showed `PaddleOCR-VL-1.6` initialized with `Tools:
    paddleocr_vl` and `[MCP] Initialized with 1 configured server and 1 tool.`
  - Direct `docs/reference/example/c.pdf` PaddleOCR MCP manual OCR spec passed:
    `cd packages/api && rtk env DOTENV_CONFIG_PATH=../../.env STEEL_PADDLEOCR_MCP_C_PDF_OCR_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/vision/paddleocr.c-pdf-ocr.manual.spec.ts --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/dist/ --testPathIgnorePatterns='\\.dev\\.ts$' --testPathIgnorePatterns='\\.helper\\.ts$' --testPathIgnorePatterns='\\.helper\\.d\\.ts$' --testPathIgnorePatterns=/__tests__/helpers/ --runInBand`
    passed with 1 manual OCR test in 15.3s.

## PaddleOCR MCP Provider Tool Name Fix - 2026-06-27

- [x] Reproduce the provider rejection where the initialized PaddleOCR tool is
  sent as `paddleocr_vl_mcp_PaddleOCR-VL-1.6`, which violates OpenAI tool-name
  validation because of the `.` in the raw server name.
- [x] Add provider-safe MCP tool-key tests so definitions use only
  `^[a-zA-Z0-9_-]+$` names while keeping the raw MCP server name for config
  lookup.
- [x] Add execution-path coverage proving a safe provider suffix maps back to
  the raw MCP server name before calling MCP config/connection code.
- [x] Implement the smallest shared helper needed for provider-facing MCP tool
  names and apply it to cached definitions plus runtime tool instances.
- [x] Rebuild/restart the backend and verify the local UI still runs on
  `http://localhost:3090/`.
- Evidence:
  - Red tests failed before the fix for `src/mcp/tools.spec.ts` and
    `app/clients/tools/util/handleTools.test.js`; after the fix, the focused
    provider-safe tests passed.
  - `cd packages/api && rtk npx jest src/mcp/tools.spec.ts --runInBand --watch=false --coverage=false`
    passed with 21 tests.
  - `cd packages/api && rtk npx jest src/tools/definitions.spec.ts --runInBand --watch=false --coverage=false`
    passed with 27 tests.
  - `cd api && rtk npx jest app/clients/tools/util/handleTools.test.js --runInBand --watch=false --coverage=false`
    passed with 16 tests.
  - `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false`
    passed with 52 tests.
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed with 63 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - Runtime helper check returned `paddleocr_vl_mcp_PaddleOCR-VL-1_6` and
    regex `true` for `^[a-zA-Z0-9_-]+$`.
  - Backend restarted on `http://localhost:3080/` and returned `200`;
    frontend dev UI remained on `http://localhost:3090/` and returned `200`.
  - Live backend log after restart showed PaddleOCR MCP initialized, the LLM
    call accepted tool definitions, `ON_TOOL_EXECUTE` loaded 1 MCP tool, and
    `PaddleOCR-VL-1.6` received `tools/call`. No new `Invalid 'tools[0].name'`
    error appeared after the fix; the remaining invalid-name log entry is from
    the pre-fix 09:27 UTC request.

## Production User Bootstrap - 2026-07-02

- [x] Confirm the repo-supported production user creation path and avoid
      placing the password in shell arguments.
- [x] Create the LibreChat production user for username `longding`.
- [x] Verify the user exists in production Mongo with email verification set.
- [x] Record review evidence without exposing the password.

Review:

- Used the documented local-terminal bootstrap path with
  `DOTENV_CONFIG_PATH=.env.prod` and `CONFIG_PATH=librechat.yaml`, so the script
  connected to production Mongo without reading the server-only
  `/data/librechat.yaml`.
- Created local-provider LibreChat user `longding` with email
  `longding@gmail.com`; the script returned `User created successfully!` and
  `Email verified: true`.
- Verified production Mongo readback: `emailVerified: true`, `role: USER`,
  `provider: local`, and `createdAt: 2026-07-02T01:58:08.241Z`.
- Verified the supplied password by bcrypt comparison against the stored hash;
  output was only `passwordMatches: true`, with no password or hash printed.

## OCR Preprocessing Simplify Pass - 2026-07-03

- [x] Move the 50-page OCR preprocessing chunk size behind
      `STEEL_OCR_PREPROCESSING_CHUNK_SIZE_PAGES`, with fallback `50`.
- [x] Centralize OCR preprocessing config and PaddleOCR result text extraction
      in `packages/api/src/steel/ocr/`.
- [x] Remove the ToolService test compatibility adapter for the old single-file
      preprocessing pipeline mock; tests now use the batch input/output shape.
- [x] Reuse current chunk metadata for direct PaddleOCR organizer state instead
      of hardcoding chunk size or page identity.
- [x] Reuse merged organized chunk Markdown helpers across preprocessing and
      direct PaddleOCR paths.
- [x] Keep OCR official Markdown lookup source/rule/pipeline-aware so a stale
      official row cannot skip the current PaddleOCR preprocessing source.
- [x] Preserve OCR PDF chunk artifact storage source (`s3` or `cloudfront`)
      when repairing/recreating artifact rows.
- [x] Avoid downloading/counting PDF pages when official OCR Markdown or a
      complete organized chunk state already exists.
- [x] Reuse a loaded PDF document while creating multiple page-range chunks.
- [x] Skip aggregate memory-total reads for internal per-chunk preprocessing
      saves while preserving totals for direct writer callers by default.
- [x] Add working-order memory indexes for OCR preprocessing state and official
      OCR Markdown lookups.
- [x] Extract duplicate JS `streamToBuffer` logic into
      `api/server/utils/stream.js`.

Verification:

- [x] `cd packages/data-schemas && rtk npm run build`
- [x] `cd packages/api && rtk npm run build`
- [x] `cd packages/api && rtk npx jest src/steel/ocr/chunks.spec.ts src/steel/ocr/artifacts.spec.ts src/steel/ocr/preprocess.spec.ts --runInBand --watch=false --coverage=false`
- [x] `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "persists PaddleOCR chunk results|captures organized chunk markdown|skips aggregate totals|official OCR Markdown|requested file key and source PDF|reads OCR preprocessing chunk state"`
- [x] `cd packages/data-schemas && rtk npx jest src/schema/steel.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "Steel Mongo schemas|OCR PDF chunk artifact|working-order memory"`
- [x] `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js server/services/MCP.spec.js --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR|OCR preprocessing|same-turn runtime attachments|current PDFs|PDFs under 50 pages|complete organized OCR preprocessing state|file"`
- [x] `rtk node --check api/server/services/ToolService.js`
- [x] `rtk node --check api/server/services/MCP.js`
- [x] `rtk node --check api/server/utils/stream.js`
- [x] `rtk git diff --check`

## Active: OCR Preflight Flow Analysis - 2026-07-06

Goal: diagnose the BH.pdf preflight flow for conversation
`33393cbb-37bf-41a9-8027-146b1f01f0ee`, fix the visible progress and final
OCR Markdown capture gaps, and verify the flow with focused tests.

- [x] Inspect the actual local Mongo conversation, assistant message, and
      `steel_working_order_memory` rows for BH.pdf.
- [x] Confirm whether raw PaddleOCR chunks and organized OCR Markdown chunks
      are persisted separately and resumable.
- [x] Trace how merged OCR Markdown is passed to the main agent.
- [x] Replace matching `Running ...` OCR preprocessing activity rows with the
      corresponding `Ran ...` row in the frontend activity state.
- [x] Make Open Responses final assistant text extraction accept normalized
      `{ type: "text" }` content as well as `output_text`.
- [x] Remove header-gated OCR Markdown detection; treat final OCR Markdown as
      official OCR Markdown, with explicit title file keys or `default`.
- [x] Update AI-facing OCR/output rules so final OCR table titles carry
      explicit `file:...` keys.
- [x] Add focused regression tests.
- [x] Run focused verification and record the review result.

Review:

- Local Mongo for conversation `33393cbb-37bf-41a9-8027-146b1f01f0ee`
  showed 3 active `paddleocr_preflight` raw chunk rows and 3 active
  `ocr_extract` organized chunk Markdown rows for BH.pdf. No official
  `ocr_official_markdown` row existed for the final assistant response.
- The assistant message had empty `text` but a populated normalized
  `content: [{ type: "text", text: ... }]`, so Open Responses final capture
  could miss the visible Markdown when only `output_text` was read.
- The final OCR Markdown capture no longer uses table headers as OCR signals.
  OCR-titled final Markdown is official OCR Markdown; PaddleOCR final responses
  save every non-workbook table in that OCR response. A `file:...` key in the
  table title binds that official Markdown to the file, and missing title keys
  bind to `default`.
- `docs/rules/其他規則/OCR規則.txt` and `docs/rules/輸出規則.txt` now require
  explicit `file:...` in every OCR confirmation table title; row data or
  standalone metadata lines are not enough for file binding.
- Verification passed:
  - `cd packages/api && rtk npx jest src/steel/native/markdown.spec.ts src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npm run build`
  - `cd client && rtk npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx --runInBand --watch=false --coverage=false`
  - `cd api && rtk npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --watch=false --coverage=false`
  - `rtk node --check api/server/controllers/agents/responses.js`
  - `rtk node packages/api/scripts/sync-steel-rules.cjs --dry-run`
  - `rtk git diff --check`
- Full `packages/api` `service.spec.ts` now passes after updating stale
  `ocr_extract` expectations to the current official `ocr_markdown` contract.

## Active: OCR Preflight Streaming And Same-File Final Markdown - 2026-07-06

Goal: keep OCR preprocessing as same-file-key merged source Markdown for the
main agent, and make the main agent produce exactly one final OCR Markdown table
per file key without backend/UI fake streaming.

- [x] Rename the saved preflight activity from `PaddleOCR preflight saved` to
      `Saved PaddleOCR preflight`.
- [x] Revert the fake large-delta splitter; frontend/backend SSE preserves the
      provider's text-delta granularity exactly.
- [x] Keep the main-agent OCR preprocessing attachment as merged same-file-key
      Markdown with the file-key marker, not a canonical final OCR title.
- [x] Update OCR/output rules so the final main-agent OCR response outputs one
      canonical OCR table per file key and never same-file chunk/page splits.
- [x] Verify provider native streaming still uses `doStream`/`stream: true` and
      add focused coverage for preserving provider delta granularity.
- [x] Run focused backend/frontend verification plus rule sync and diff hygiene.

Review:

- User correction: if the provider returns a very large single text delta, send
  that one delta to the frontend once. Do not split or pace it in LibreChat to
  simulate streaming; diagnose/fix provider streaming at the source.
- User correction: the canonical title
  `OCR 結果確認表：<filename>（file:<id>）` belongs to the main agent's final OCR
  Markdown output, not the preprocessing Markdown passed to the main agent.
- The preprocessing handoff remains a per-file-key merged Markdown payload, and
  rules now require the final answer to output exactly one OCR confirmation
  table for each file key.
- Verification passed:
  - `rtk node --check api/server/controllers/agents/callbacks.js`
  - `rtk node --check api/server/services/ToolService.js`
  - `cd api && rtk npx jest server/controllers/agents/__tests__/callbacks.spec.js --runInBand --watch=false --coverage=false`
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/steel/native/oauth.spec.ts --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/steel/native/events.spec.ts src/steel/ocr/preprocess.spec.ts --runInBand --watch=false --coverage=false`
  - `cd client && rtk npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npm run build`
  - local `openai-oauth-provider` fake-fetch probe confirmed request body has
    `stream: true`, `store: false`, and model `gpt-5.5`.
  - `rtk node packages/api/scripts/sync-steel-rules.cjs --dry-run`
  - `rtk node packages/api/scripts/sync-steel-rules.cjs --apply`
  - `rtk env DOTENV_CONFIG_PATH=.env.prod node -r dotenv/config packages/api/scripts/sync-steel-rules.cjs --dry-run`
  - `rtk env DOTENV_CONFIG_PATH=.env.prod node -r dotenv/config packages/api/scripts/sync-steel-rules.cjs --apply`
  - `rtk git diff --check`
  - `rtk git diff --cached --check`

## Active: Final OCR Markdown Save And Timer Stability - 2026-07-06

Goal: fix the post-completion message timer reset and ensure Steel only saves
final official OCR Markdown, with explicit `file:...` title binding when
present.

- [x] Inspect the timer state path from streaming assistant placeholder to
      completed assistant message and identify why elapsed time reanchors.
- [x] Add a focused timer regression test that preserves the original turn
      start/elapsed duration after the main agent finishes.
- [x] Inspect final OCR Markdown capture and activity generation for the
      reported conversation and current parser behavior.
- [x] Add focused OCR regressions for skipping manual-review Markdown, binding
      title `file:...` keys, and emitting `Save final OCR markdown`.
- [x] Implement the minimal backend/frontend fixes.
- [x] Run focused verification and record the review result.

Review:

- Timer root cause: while a message is still submitting, the elapsed timer
  accepted a later server `createdAt` correction for the same assistant message.
  When the final server message arrived with a near-completion timestamp, the
  timer reanchored from the original turn start to that late timestamp.
- Timer fix: once a non-user assistant timer has started, keep the earliest
  resolved start timestamp for the same `timerKey`; completion freezes against
  that original start instead of the final persisted message timestamp.
- OCR root cause: final OCR capture promoted every non-workbook table after any
  OCR-titled table in a PaddleOCR-derived response. That saved helper/manual
  review sections such as `需你優先核對的項目` as `ocr_markdown`.
- OCR fix: official OCR capture is now table-title-local: a table's own title
  must contain `OCR`. Later non-OCR helper tables in the same response are not
  saved as official OCR Markdown. Explicit `file:...` in the OCR title still
  binds the row to that file key.
- Existing stale active rows with `kind: ocr_official_markdown` but a non-OCR
  title are ignored by OCR read/output summary paths, and the next official OCR
  capture deletes those stale active rows for the conversation.
- Local Mongo cleanup for the reported conversation
  `e2220c2a-c717-441b-9cbd-a554782fdf07` superseded 1 stale non-OCR-title
  official row; active official OCR Markdown now only has the BH.pdf
  `file:3ff04e38-bd5e-4fb7-82ce-866ad49ce5b9` row.
- Activity wording for official OCR saves is now `Save final OCR markdown`;
  preprocessing chunk saves remain separate progress state.
- Verification passed:
  - `cd packages/api && rtk npx jest src/steel/memory/service.spec.ts src/steel/native/events.spec.ts --runInBand --watch=false --coverage=false`
  - `cd client && rtk npx jest src/components/Chat/Messages/ui/__tests__/MessageElapsedTimer.test.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npm run build`
  - `rtk node --check api/server/controllers/agents/request.js && rtk node --check api/server/services/Endpoints/agents/title.js`
  - `rtk git diff --check`

## Active: Production OpenAI OAuth Token Sync - 2026-07-07

Goal: update the production server's OpenAI OAuth auth file from this
machine's current Codex auth file without exposing token contents.

- [x] Confirm the canonical local source and production target paths.
- [x] Validate local auth JSON and capture non-secret metadata.
- [x] Upload the auth file to the production host with restrictive
      permissions.
- [x] Validate the remote auth JSON and production env path without printing
      secrets.
- [x] Restart the production API container if required and verify health.
- [x] Record the review result.

Review:

- Canonical source is local `~/.codex/auth.json`; production target is
  `/data/openai-oauth/auth.json`.
- Local auth JSON parsed successfully before upload, with mode `600`.
- Remote auth JSON was older and did not match the local file. Uploaded through
  a temporary `/tmp/openai-auth-*.json` path, then installed to
  `/data/openai-oauth/auth.json` with mode `600`, owner/group `deploy`.
- Container readback confirmed `OPENAI_OAUTH_AUTH_FILE` points to
  `/data/openai-oauth/auth.json`; JSON parse succeeded and the remote file
  metadata/fingerprint matched the local source.
- Restarted the production API container with
  `docker compose -f deploy-compose.prod.yml restart api`.
- The first short health loop ended while the API was still booting; follow-up
  public `https://chat.longdin.org/health` and container-local
  `http://127.0.0.1:3080/health` both returned `OK`, and compose reported the
  API service healthy.
- No token contents were printed or recorded.

## Active: Admin Codex Login Button For Server OAuth Token - 2026-07-07

Goal: design an admin-only way to recover an expired production OpenAI OAuth
auth file from the existing `Usage remaining` UI without exposing token
contents to normal users or browser responses.

- [x] Inspect the existing `Usage remaining` UI/API path.
- [x] Confirm current `openai-oauth-provider` login/refresh capabilities.
- [x] Confirm the approved re-auth approach before implementation.
- [x] Add backend admin-only token refresh/re-auth endpoints.
- [x] Add the `Login Codex` affordance to the OAuth usage panel only when the
      signed-in user is admin and auth is unavailable.
- [x] Add focused backend/frontend tests for admin gating, sanitized responses,
      and usage-query invalidation.
- [x] Run focused verification and record review results.

Design notes:

- Existing `Usage remaining` reads `/api/steel/ai/oauth-usage`, which is
  sanitized and already hides access tokens, refresh tokens, account IDs,
  emails, and auth file paths.
- `openai-oauth-provider` can load and refresh an existing auth file, but its
  README explicitly says it has no built-in login flow. A simple button cannot
  call the provider directly to create new auth from scratch.
- Safe implementation should be admin-only on both frontend and backend. The
  backend must verify `req.user.role === "ADMIN"` before any token mutation.
- Browser responses must stay sanitized: status, expiry/health, and next action
  only; never token values, account identifiers, raw `auth.json`, or the
  absolute auth file path.

Review:

- Added sanitized token status/refresh types to `librechat-data-provider`.
  Responses include provider/status, access-token expiry/status, refresh
  availability, and login capability only. They do not include token values,
  account IDs, emails, raw auth JSON, or auth-file paths.
- Added `packages/api/src/steel/native/token.ts` with TDD coverage for valid,
  expired, unavailable, and refresh paths.
- Added admin-only routes under `/api/admin/steel`:
  - `GET /ai/oauth-token`
  - `POST /ai/oauth-token/refresh`
- The admin route stays protected by the existing `requireJwtAuth` +
  `ACCESS_ADMIN` middleware. The general `/api/steel/ai/oauth-usage` route
  remains read-only usage status.
- Extended `Usage remaining` with an admin-only `OAuth token` section. It shows
  access-token status and expiry, has a working `Refresh token` button, and
  shows a disabled `Login Codex` button with `Codex CLI unavailable` because the
  production image is not expected to include Codex CLI.
- `Refresh token` invalidates both token status and usage remaining queries.
- Verification passed:
  - `cd packages/api && rtk npx jest src/steel/native/token.spec.ts src/steel/native/usage.spec.ts --runInBand --watch=false --coverage=false`
  - `cd api && rtk npx jest server/routes/__tests__/steel.spec.js --runInBand --watch=false --coverage=false`
  - `cd client && rtk npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --runInBand --watch=false --coverage=false`
  - The OAuth token UI spec now covers restoring a pending Codex login session
    after overlay remount and copying the displayed verification code.
  - `cd packages/api && rtk npm run build`
  - `rtk npm run build:data-provider`
  - `rtk npm run frontend`
  - `rtk node -e "JSON.parse(require('fs').readFileSync('client/src/locales/en/translation.json','utf8')); console.log('translation-json-ok')"`
  - `rtk git diff --check`

## Active: Add GPT-5.6 Models To Local OpenAI List - 2026-07-11

Goal: expose every documented GPT-5.6 API alias/variant in the local
`OPENAI_MODELS` allowlist without changing production or example env files.

- [x] Verify current GPT-5.6 model IDs against OpenAI's official model docs.
- [x] Preserve `gpt-5.5` and add the GPT-5.6 alias plus Sol, Terra, and Luna to
      `.env` `OPENAI_MODELS`.
- [x] Verify comma-delimited parsing, the final diff, and whitespace hygiene.

Review:

- `.env` now exposes `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra`, and
  `gpt-5.6-luna` while preserving `gpt-5.5`.
- OpenAI's official model pages confirm the three named GPT-5.6 variants and
  that `gpt-5.6` aliases GPT-5.6 Sol.
- A dotenv parse probe returned the expected five ordered IDs.
- `.env.prod`, `.env.prod.example`, `.env.example`, and
  `OPENAI_DEFAULT_MODEL` were intentionally unchanged.
- `rtk git diff --check` passed.

## Active: Admin Codex Device Login On Server - 2026-07-08

Goal: make the admin OAuth token panel detect a working server-side Codex CLI,
start a real Codex device-login flow, and write refreshed credentials to the
configured server auth path.

- [x] Add server-side Codex CLI detection that proves the binary works instead
      of only checking whether `codex` exists on `PATH`.
- [x] Add an admin-only Codex device-login service that uses the configured
      `OPENAI_OAUTH_AUTH_FILE` directory as `CODEX_HOME`, forces file credential
      storage, sanitizes browser responses, and times out abandoned sessions.
- [x] Wire admin API routes, shared data-provider types/endpoints, React Query
      hooks, and `Usage remaining` UI polling for login status.
- [x] Document production install/verification steps for Codex CLI inside the
      server runtime and the required auth-file path.
- [x] Run focused backend/frontend verification and record review results.

Review:

- `getOpenAIOAuthTokenStatus` now performs a server-side `codex --version`
  probe through the API runtime. A broken or host-only CLI install reports
  `Codex CLI: Unavailable`; a working binary reports `Available`.
- Localhost detection also probes common absolute install paths such as
  `/opt/homebrew/bin/codex` when the backend process PATH cannot resolve
  `codex`; this covers macOS/Homebrew installs launched from a narrower server
  environment.
- Added admin-only device-login endpoints under `/api/admin/steel`:
  - `POST /ai/oauth-token/login`
  - `GET /ai/oauth-token/login/:sessionId`
- The login service sets `CODEX_HOME` to the directory containing the resolved
  `OPENAI_OAUTH_AUTH_FILE` when the configured path is an `auth.json` file.
  It writes `cli_auth_credentials_store = "file"` into that Codex home so
  Codex writes refreshable credentials to the configured server auth path.
- Browser responses remain sanitized: status, expiry, device URL/code, and
  coarse failure reasons only. They do not include token values, account IDs,
  raw `auth.json`, CLI stderr/stdout, or absolute auth-file paths.
- `Usage remaining` admin UI now enables `Login Codex` when the server CLI is
  available, polls the login session, shows device URL/code rows, and reuses
  the `Status` row for Login starting/Login pending/Checked/Login failed.
- Follow-up UI correction: `Login Codex` now pre-opens a new tab from the user
  click and navigates it to the Codex device-auth URL when the server returns
  it. The UI no longer displays a `Login URL` row; it only shows the
  verification code needed by the OpenAI device page.
- Follow-up parser correction: Codex CLI prints the device code on the line
  after the prompt and can use a `4-5` code shape, so the parser scans the full
  captured output near the code prompt and reparses pending-session output
  during status polling.
- Follow-up overlay correction: the current Codex login session id is persisted
  in browser `sessionStorage`, so closing and reopening the model-list overlay
  keeps polling the same device-login session and restores the displayed device
  code without opening another device-auth tab.
- Follow-up code UX correction: the verification code is shown directly with a
  copy icon button, so the user does not need to select text manually.
- Follow-up stale-session correction: starting a new login clears the restored
  stored session first, and pre-opened-tab cleanup is scoped to the new session
  id so an old failed session cannot close the new `about:blank` tab.
- `Dockerfile.multi` installs the runtime CLI with
  `npm install -g @openai/codex`, and the DigitalOcean runbooks document
  container-level `codex --version` plus `/data/openai-oauth` writability
  checks.
- Verification passed:
  - `cd packages/api && rtk npx jest src/steel/native/token.spec.ts src/steel/native/usage.spec.ts --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npx jest src/steel/native/token.spec.ts --runInBand --watch=false --coverage=false`
  - `cd api && rtk npx jest server/routes/__tests__/steel.spec.js --runInBand --watch=false --coverage=false`
  - `cd client && rtk npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --runInBand --watch=false --coverage=false`
  - `cd packages/api && rtk npm run build`
  - local direct backend probe confirmed Codex CLI detection returns
    `{"available":true}` without setting `CODEX_CLI_PATH`.
  - `rtk npm run build:data-provider`
  - `cd client && rtk npm run typecheck`
  - `rtk npm run frontend`
  - local backend restarted in detached `screen` session `librechat-backend`
    with `CODEX_CLI_PATH=/opt/homebrew/bin/codex`; `http://localhost:3080/health`
    returned `OK`.
  - `rtk node -e "JSON.parse(require('fs').readFileSync('client/src/locales/en/translation.json','utf8')); console.log('translation-json-ok')"`
  - `rtk git diff --check`
## Active: Fix Local PaddleOCR MCP Startup - 2026-07-11

Goal: make `npm run backend` start the configured eager PaddleOCR MCP server
on localhost without `spawn paddleocr_mcp ENOENT`.

- [x] Confirm the runtime `librechat.yaml` command and reproduce the missing
      executable through the local PATH/tool state.
- [x] Install `paddleocr-mcp` through the same Python 3.12 `uv tool` contract
      used by the production image.
- [x] Verify the executable, direct MCP `listTools`, and backend startup.
- [x] Record the root cause and fresh verification evidence.

Review:

- Root cause: ignored local `librechat.yaml` eagerly launches
  `paddleocr_mcp`, but localhost had no `uv` tool installation even though
  `/Users/neven/.local/bin` was already on `PATH`. `.mcp.json` using `uvx`
  does not control the LibreChat backend runtime.
- Installed `paddleocr-mcp==0.8.5` with Python 3.12 through
  `uv tool install --python 3.12 --compile-bytecode paddleocr-mcp`.
- `command -v paddleocr_mcp` resolves to
  `/Users/neven/.local/bin/paddleocr_mcp`.
- A direct MCP client connected and returned one tool: `paddleocr_vl`.
- A fresh `npm run backend` start logged PaddleOCR initialization in 1991 ms,
  `Initialized with 1 configured server and 1 tool`, and the backend health
  endpoint returned HTTP 200 with `OK`.

## Active: GPT-5.6 Max Effort And Env Default Model - 2026-07-11

Goal: allow GPT-5.6 `max` reasoning effort through the active OpenAI OAuth
runtime and make new LibreChat conversations honor the configured
`OPENAI_DEFAULT_MODEL`, while preserving the UI-selected model as the OAuth
provider's request model.

- [x] Trace the env, models endpoint, frontend default-conversation, and OAuth
      request paths to identify the exact contract gaps.
- [x] Add failing tests for `OPENAI_REASONING_EFFORT=max` and
      `OPENAI_DEFAULT_MODEL=gpt-5.6-luna` model ordering/default selection.
- [x] Implement the smallest shared-schema/runtime/model-list changes.
- [x] Run focused tests, builds, runtime/frontend-path verification, and diff
      hygiene.

Review:

- Root cause: the frontend derives a new conversation's default from the first
  model returned by `/api/models`, while `OPENAI_DEFAULT_MODEL` previously only
  reached the Steel/OpenAI OAuth runtime config and did not affect model-list
  ordering.
- `OPENAI_DEFAULT_MODEL` now moves an existing member to the front of both the
  OpenAI and explicit/fallback OpenAI OAuth allowlists without adding a model
  outside either list. A saved UI model remains higher priority.
- `OPENAI_REASONING_EFFORT=max` is accepted and passed through to GPT-5.6 OAuth
  runs; the env default does not replace a UI-selected OAuth model.
- Verification: API model-list tests 3/3, frontend default-conversation tests
  9/9, package config/OAuth/run tests 119/119, `@librechat/api` build passed,
  runtime probes returned `gpt-5.6-luna` first and `max` unchanged, backend
  health returned HTTP 200, and staged/unstaged diff checks passed.

## Active: Unify OpenAI OAuth Model Defaults - 2026-07-11

Goal: keep the OAuth provider identity for routing, but use the OpenAI model
settings everywhere and make every plain New Chat use the env-prioritized
`OPENAI_DEFAULT_MODEL`.

- [x] Make `/api/models` return the same `OPENAI_MODELS`-derived list for
      `openAI` and `openai_oauth_responses`.
- [x] Make plain New Chat ignore last-selected browser models while preserving
      explicit URL, preset, model-spec, and current UI model selections.
- [x] Store both OpenAI transports under `lastSelectedModel.openAI` and remove
      the legacy `lastSelectedModel.openai_oauth_responses` property.
- [x] Run focused tests, builds, runtime probes, and diff hygiene without
      committing.

Review:

- `openai_oauth_responses` remains only as the internal OAuth transport and
  provider identity. Both frontend model-list keys now receive the same
  `OPENAI_MODELS` array with `OPENAI_DEFAULT_MODEL` prioritized first.
- Plain New Chat no longer restores `lastSelectedModel`; explicit URL, preset,
  model-spec, existing-conversation, and active UI model values still win.
- Browser storage now writes OAuth selections to `lastSelectedModel.openAI`.
  Legacy OAuth-only values migrate to `openAI`, an existing `openAI` value wins
  when both exist, and the legacy property is removed.
- TDD RED failures were observed for divergent OAuth lists, stored-model New
  Chat precedence, and all legacy storage cases. Final focused verification:
  API 3/3, client 71/71, package OAuth/config/run 119/119, data-provider
  121/121; client typecheck, client build, package API build, runtime probes,
  backend health, and staged/unstaged diff checks passed. Independent review
  reported no remaining Critical or Important issues.
# Active: OCR organizer unexpected price lookup diagnosis - 2026-07-11

Goal: determine why the PaddleOCR organizer subagent can call
`search_price_candidates`, why the provider rejects that function schema, and
whether the OCR or price-lookup reviewed rules are incorrect.

- [x] Trace the organizer prompt, rule context, and exposed tool set.
- [x] Audit OCR rules for strict output-only and no-price-lookup boundaries.
- [x] Audit `search_price_candidates` schema, validator, and lookup rules.
- [x] Reproduce or statically prove the schema rejection and identify its source.
- [x] Record root causes, affected boundaries, and recommended fix scope.

Review:

- The OCR organizer uses a bare OpenAI OAuth model invocation with no bound
  tools. The observed request failed later, when the main native agent attached
  all Steel tool definitions; no `search_price_candidates` tool call occurred.
- `priceQueryLimitSchema.positive()` is converted with the native adapter's
  OpenAPI 3 target into `exclusiveMinimum: true`. OpenAI validates function
  parameters as JSON Schema, where `exclusiveMinimum` must be numeric, and
  rejects the request before model generation.
- The reviewed OCR rule now explicitly limits the organizer to the supplied
  single raw PaddleOCR result and forbids every tool, lookup, and quote output.
  The unified rule sync applied and read back the active reviewed dev row.
- Native Steel tools now emit Draft-7-compatible JSON Schema with numeric
  exclusive bounds. The regression failed on `exclusiveMinimum: true`, passed
  after the adapter change, and a live OAuth smoke with all three Steel tools
  returned `SCHEMA_OK` without a tool call.
- The final compatibility-safe implementation preserves the existing OpenAPI 3
  schema shape and only normalizes boolean exclusive bounds to numeric values;
  all three emitted schemas pass Ajv, contain no `const`, and independent review
  reported no Critical or Important findings.
- Focused verification passed 4 suites / 33 tests, focused ESLint, the
  `packages/api` build, `git diff --check`, backend restart/health, and a live
  authenticated `gpt-5.6-luna` schema smoke.
- Remaining implementation work is separate: hard-limit the main agent tool
  surface during OCR-only confirmation turns.
