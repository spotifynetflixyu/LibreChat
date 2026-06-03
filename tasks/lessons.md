# Lessons

- Treat `npm run frontend:dev` startup separately from LibreChat app readiness. Vite can start on port 3090 while `/api/*` still fails if the backend is not running on port 3080.
- For LibreChat local dev, verify the backend path too: backend startup requires `client/dist/index.html`, so `npm run build:client` may be needed even when using the Vite dev frontend.
- When diagnosing Vite proxy errors, hit both `http://localhost:3080/api/config` and `http://localhost:3090/api/config` to distinguish backend startup failures from proxy configuration issues.
- When the user asks to write docs, create or update a real project docs file under `docs/` instead of only adding operational notes to agent-facing files.
- For the steel setup, do not assume Docker services are part of local development; the user uses cloud MongoDB and Supabase Postgres through `.env`.
- Do not add root `npm run supabase:*` scripts or `supabase/config.toml` for Steel unless the user explicitly asks for a local Docker-backed Supabase stack; Steel database development uses Supabase cloud through `.env` `STEEL_POSTGRES_URL`.
- For Supabase pgvector, check the actual `pg_extension.extnamespace`; this project currently has `vector` installed in `public`, not `extensions`.
- Do not process or import files under `docs/reference` as real data unless explicitly asked. Steel handbook DOCX currently informs schema/data-model design first; real data SQL/import comes later.
- Do not hard-code default steel product choices as static DB fields such as `is_default`; admin-taught defaults should be modeled as flexible preference rules/memory and applied during disambiguation.
- When a customer asks price for an incomplete steel spec with multiple matches, show candidate prices while asking for the missing detail; only lead with a specific candidate when backed by a preference rule or deterministic ranking.
- For local `pg` connections to Supabase, prefer the Supavisor session pooler URL when the direct `db.<project>.supabase.co` host does not resolve or the environment lacks IPv6 support.
- Keep Steel changes isolated from upstream LibreChat hot files where possible; avoid premature root exports or core entrypoint edits until a route actually needs them.
- Every wrap-up response should include explicit next tasks so the user knows what to do next.
- With the current Node `pg` stack, `sslmode=require` alone may behave like `verify-full`; use `uselibpqcompat=true&sslmode=require` for libpq-compatible dev behavior, and plan CA-backed `verify-full` for production.
- Steel guest mode is not a later-only product phase; it should be controlled by an environment flag. When enabled, quote conversation/workbook/export guest access requires no login or role permission. When disabled, Steel quote access requires login plus an admin-approved permission.
- Steel workbook pricing must persist the accepted line calculation: formula, database default unit price, quoted unit price, line total, and explicit unit-price/total-price adjustments belong in the workbook, not only in chat text.
- Never touch existing workbook prices, quantities, or totals just because a newer database price exists; only update them when the user explicitly requests a change or recalculation for that line.
- Customer-facing Excel must hide `customer_tier` and internal/debug fields; export `quoted_unit_price` and `line_total` under customer-friendly price labels instead of exposing raw internal workbook field names.
- `docs/reference` files are generally AI/dev logic references. Steel handbook DOCX is a schema/data-model reference before chat UX work; ongoing formal data updates flow through ERP XLSX import or Admin table UI review, then API commit to the target database table.
- For Steel MVP, prioritize the minimal chat UX and workbook preview with API mock data; real OpenAI smoke validates the vertical slice before moving on, but UX development does not wait for real data import.
- Build Steel Chat UX as an independent Steel workspace first; avoid making core LibreChat chat-store/global-message-flow changes a Phase 3 dependency.
- Keep desktop and mobile Steel UI on one shared UX framework and data contract; responsive layout differences should not create a separate mobile-only workflow.
- For selected workbook-cell chat edits, show a composer marker for UX but send structured selected refs; never make backend patch targeting depend on AI parsing marker text alone.
- Limit Phase 3 workbook cell selection to one cell per submit, but allow multi-round workbook edits and text-described multi-field edits when each generated patch op is explicit and backend-validated.
- Do not add a per-AI-patch confirmation gate to Phase 3 workbook editing; keep chat flow fast and mark latest accepted changed fields with background color instead.
- Latest-update workbook highlights should persist until the next accepted workbook patch and then be replaced, not auto-timeout or accumulate.
- Failed or rejected workbook patches must not highlight fields or clear the previous accepted-patch highlight; explain the non-update in chat.
- Do not add an explicit Undo button to Phase 3 workbook editing; users ask AI in chat to revert/change data, and the result must go through the validated patch service.
- Successful AI workbook patches should reply with a concise changed-field summary in chat; avoid full diff tables in the Phase 3 chat flow.
- Keep Steel workbook contract ownership split: public DTOs in `packages/data-provider/src/steel/workbooks.ts`, canonical Zod/runtime validation in `packages/api/src/steel/workbook/schema.ts`, and no frontend-owned workbook validation schema.
- Keep Steel API mock data in one shared folder, `packages/data-provider/src/steel/mock/`, so frontend fixtures and backend mock endpoints do not drift.
- Keep Steel mock fixtures behind explicit mock imports; do not re-export them from the production Steel data-provider `index.ts` barrel.
- Use ExcelJS deliberately for customer-facing Steel export rendering; keep parser/read-back concerns separate from the customer XLSX renderer unless implementation evidence supports consolidation.
- When a Steel plan is version-bumped, update and rename the phase plan folder too; do not leave implementation tasks under the old version path after creating the new top-level spec.
- Steel Admin data import must only accept ERP XLSX uploads for ongoing file import. Do not plan or implement an Admin DOCX/PDF parser or PDF transformation flow; PDF/image evidence can belong to quote conversations only, not formal Admin source import.
- Keep Phase 0 as a decision-baseline/documentation gate. Live provider smoke tests and persisted runtime evidence belong to the implementation phase that owns the vertical slice.
- For Steel Admin data updates, treat ERP-exported XLSX as the confirmed formal source path: upload, parse, compare with old data, admin confirm, then commit to the database.
- Treat steel handbook DOCX as a real schema/data-model design reference first, not an ongoing Admin web upload path, reusable parser, or immediate data import. Prioritize chat UX; real handbook data SQL/import is a later task.
- Because `docs/reference` source data is Chinese, create an agreed source schema mapping before code uses it: Chinese labels/headers/terms map to English canonical schema keys, and programmatic DTO/API/tool/repository/DB query contracts stay English while Chinese remains as display/source/alias values.
- Workbook-facing field labels in UI, mock fixtures, and Excel output must be Traditional Chinese, preferably derived from `docs/reference/*.xlsx` headers where available; internal DTO keys, patch paths, schema keys, and database/query contracts stay English.
- Do not understate `docs/reference` as mock-only. It can guide the real Steel schema/data model; real importable data/SQL is deferred to a later code-agent data task that starts from correct data.
- For Steel source-schema mapping, do not add typo approval workflow fields such as `review_status` or `corrected_text` unless a later import task explicitly needs them. User expects later code-agent data discussions to start from correct data.
- Teach the AI API the source-schema mapping through prompt/tool context so it can resolve Chinese wording to existing English canonical keys; backend validators must still reject unknown or invented keys.
- Put Steel admin-only APIs under `/api/admin/steel/...`; keep `/api/steel/...` for quote/user-facing routes.
- Before any live `openai_oauth_responses` provider smoke or chat UI test, document and complete the openai-oauth binding flow and token-storage expectations.
- Do not create DOCX parser/import metadata for Steel source handling; Phase 1 source/import scaffolding supports XLSX only, with handbook DOCX remaining schema-design reference.
- Phase 1 should teach and verify local LibreChat admin/user account setup before Steel route testing; current LibreChat behavior makes the first registered user ADMIN and later registrations USER.
- Steel agent layer must preserve LibreChat UI/preset/agent model parameters as requested runtime settings; `openai_oauth_responses` is the priority v8.3 provider, not a shortcut that bypasses settings such as Responses API options or reasoning summaries.
- Do not design Steel provider capability failures as silent fallback or toast notifications. OAuth is the default driver; fallback means explicitly using the API driver, not a separate model fallback or per-capability fallback env matrix.
- V8.3 source-schema mapping should focus on database-bound spec, price, formula, and processing-price fields; workbook sheet names remain Chinese ERP-facing output labels, not translated database keys.
- Mobile Workbook Preview selected targets must support multiple marked targets when the user has typed instructions; composer markers should show sheet and field/cell position clearly, while backend targeting still uses structured selected refs.
- Treat `docs/reference/公式編號 - Sheet1.csv` as a development reference for formula names and structure only; calculator runtime data should come from reviewed app-ready data such as JSON or database rows.
- Steel model allowlist and default settings should adapt to LibreChat's existing model/default preset framework first; do not invent a parallel model selector without checking whether LibreChat already supports the needed default model and runtime settings.
- Steel Admin route access should first use existing LibreChat account role behavior for ADMIN vs USER before adding custom permission machinery; Steel-specific capabilities can layer on top after the role seam is understood.
- Treat v8.3 ERP XLSX column names as stable and append-only: future files may add columns, but existing columns should not be renamed. Parser and mapping contracts should tolerate extra columns without weakening required-key checks.
- Prioritize development and testing of `openai_oauth_responses` as the proxy path early enough to inform downstream Phase 1/3 design; do not defer all OAuth proxy reality checks until after workbook UX work is otherwise complete.
- For Steel v8.3, Vercel AI SDK 6 is Apache-2.0 and approved for production use; do not leave AI SDK 6 as a dependency blocker. If `openai-oauth-provider` is used, unify AI SDK package versions with package-manager overrides/resolutions and keep `openai-oauth` as the primary provider path.
- Keep `.env.example` Steel AI routing minimal: include only operator-facing switches and URLs, while detailed defaults such as capability gates, endpoint paths, state mode, production policy, and fallback internals stay in plans/runbooks unless the implementation truly requires user configuration.
- Do not reintroduce `STEEL_OPENAI_OAUTH_AUTO_FALLBACK`, `STEEL_OPENAI_API_ENABLED`, or per-capability `STEEL_FALLBACK_*` switches unless a later decision explicitly adds automatic fallback policy; v8.3 fallback means selecting the API driver instead of the default OAuth driver.
- Direct `openai-oauth-provider` mode does not need a `/v1` base URL or transport selector in `.env.example`; local proxy is a manual diagnostic smoke probe only, not an env-controlled runtime route.
- For Steel OpenAI routing, use the product-level env keys `STEEL_OPENAI_PROVIDER`, `STEEL_OPENAI_DEFAULT_MODEL`, and `STEEL_OPENAI_REASONING_EFFORT`; do not keep older OAuth-specific model/provider switches as the active runtime contract.
- Keep `STEEL_OPENAI_OAUTH_AUTH_FILE` as an optional hosted/server deployment path for mounted `auth.json` files; do not make it an active local default, and prefer absolute paths on GCP/server environments.
- Manual OpenAI OAuth smoke specs must use the same auth-file path resolver as the backend route; otherwise `STEEL_OPENAI_OAUTH_AUTH_FILE="~/.codex/auth.json"` works in the app but fails in direct manual tests.
- When a user corrects an HTTP status typo, normalize the diagnosis to the real status code before choosing a route/proxy fix; `404` means normal not-found semantics, not a non-standard status.
- Once the `openai_oauth_responses` text path has been manually proven, do not keep repeating text-only browser smoke as the main risk reducer; move the next smoke scope to file, vision, and spreadsheet capability probes with generated non-secret fixtures.
- File/vision parsing hints such as rotated-image Chinese recognition must be config-driven and shared by Steel and normal LibreChat file paths; do not bury them in one UI surface or hard-code them in a provider adapter.
- Do not put OpenAI-native file/image analysis instructions under LibreChat `ocr` config; `ocr` is the Mistral/custom OCR upload pipeline, so shared model guidance belongs under a neutral contract such as `fileAnalysis.instructions`.
- Treat rotated-image Chinese extraction as a parse-quality smoke, not a binary file-support smoke: if sentinel/English/number pass but Chinese glyphs are wrong, classify as parse-wrong and test model, image quality, prompt, and pre-rotation separately instead of assuming `reasoningEffort` alone will fix it.
- For OpenAI-native file/image analysis of Traditional Chinese fixtures, explicitly say the Chinese text is Traditional Chinese and must be preserved exactly; this can fix glyph/locale confusion before changing model or reasoning effort.
- Treat Steel admin capability smoke as code-owned provider/model capability evidence, not a customer feature or Admin UI; for Phase 1, hard-code `openai_oauth_responses` + `gpt-5.5` Responses API support and reuse proven `/steel/oauth-chat` file-support evidence.
- For legacy Office files, AI/provider handling of `.xls` and `.doc` is allowed, but server-side conversion to `.xlsx`/`.docx` must be proven by a development script before becoming production behavior.
- Keep Steel legacy Office conversion proof outputs in the repo-level ignored directory `tmp/steel-office-conversion/` so artifacts are inspectable, share one temp convention, and avoid package-local `.tmp` directories.
- Steel v8.3 supports `gpt-5.5` for the OAuth Responses path; do not keep `gpt-5.4` or lower models in the active allowlist.
- Steel v8.3 supports one company only; preserve per-account privacy with owner/user and guest-token access checks, not tenant or organization scoping.
- When reviewed product price data carries unit weight, treat product-price unit weight as the main quote weight for that matched priced item; keep handbook weight as separate general spec/weight evidence, not a replacement source.
- Material-specific rules must be task-scoped for AI: only provide the C-type steel rule when the order has a C-type item or strong candidate, instead of dumping all company rules into every prompt.
- H-type non-standard-length surcharge automatically applies to normalized H-type lengths outside 6M, 9M, 10M, and 12M; it changes material unit price only, while cutting remains priced from cutting-price data.
- Treat `docs/reference/切工價錢.xlsx` as a formal cutting-price source, with later Admin/backend maintenance, not as prompt-only guidance.
- Treat customer inquiry files such as RTF, handwriting, PDF, image, photo, and chat text as quote request evidence/parser fixtures, not formal Admin import sources.
- Treat customer instructions such as no-charge items, special prices, added surcharges, or one-line rule overrides as quote-specific adjustments saved on workbook lines; do not mutate formal source tables or material rules from chat alone.
- For customer order parsing, AI is expected to infer likely specs because every customer's order shape can differ; backend code should constrain that inference into canonical candidate fields, confidence, source refs, and manual-review/clarification paths instead of treating the AI guess as a confirmed fact.
- When AI is uncertain about a Steel spec or repository lookup returns multiple plausible options, the quote flow must ask the user to confirm before pricing; present bounded candidate options instead of silently selecting one.
- In `產品價格.xlsx`, a `0` price means no price. A zero cutting/hole/processing charge becomes true zero only when a separate selected calculation rule or reviewed business rule confirms the free charge.
- Do not hard-code C-type steel calculation behavior directly in pricing/calculator code. The AI should select the applicable quote default, reviewed rule, or formula, and backend code should validate that selected rule before allowing true-zero charges or skipping remainder calculation.
- Steel quote defaults define default behavior and formula selection, not rigid numeric logic. User-provided numbers or prices in the conversation can override adjustable parameters; keep the formula identity fixed while making numeric parameters explicit, sourced, and validated.
- Do not let Steel chat save customer defaults directly into quote defaults. Conversation adjustments become quote-specific overrides first; reusable customer defaults require a structured rule proposal, Admin approval, reviewed database facts, and only then generated task-scoped quote defaults.
- Steel AI should obtain quote defaults through `lookup_defaults` using interpreted customer/item/charge/formula context and typed filters. Do not dump all defaults into prompts; return bounded reviewed candidates with origin refs and revalidate the selected origin before pricing.
- Keep LibreChat user memory separate from Steel Admin-reviewed quote defaults. User memory is a user/account-scoped custom memory layer that may override quote-time priority for that user, but it must not mutate reviewed Steel facts or be merged into site-managed Admin-reviewed defaults.
- When the user says Admin review UI is paused, treat the pause narrowly: do not build visible Admin review screens, but continue sequencing non-UI backend/data work such as approval/reject/publish APIs, reviewed defaults, `lookup_defaults`, and quote-runtime validation when those slices are in the approved roadmap.
- Treat global/site-managed Steel quote defaults as a future extension module. Core quote flow may use AI tool calling to create `needs_review` proposals through backend APIs, but it must not publish global defaults directly.
- After closing a proposal/memory architecture slice, return implementation focus to the core Steel order quoting path unless the user explicitly reopens Admin review or global quote defaults extension scope.
- When running a grill/planning pass and the user asks `一次問我所有問題`, batch all unresolved questions with recommendations instead of asking one at a time.
- Do not treat the current absence of reviewed DB rows or `0` source prices as a reason to omit feature support. Steel runtime/schema/tool/calculator development must support future Admin-reviewed prices for non-round holes such as oval, long, rectangular, and custom slot-like holes even when current source data is missing or unpriced.
- Steel workbook initialization in UI must always surface API failures with an explicit error and retry path; do not leave `workbook === null` as an indefinite loading state after `createSteelWorkbook` rejects.
- Steel workbook persistence must have a real Mongoose repository regression test, not only a memory-repository service test; Mongoose subdocuments can lose getter-backed fields when spread directly.
- Steel workbook visible headers are a canonical business contract. When the user corrects sheet headers, update the initial workbook definitions plus API/data-provider/client fixtures so stale internal keys such as old price-column names do not keep misleading later agents.
- Steel workbook visible sheet order is also canonical. Keep `系統訂單` first, followed by `總結`, `人工複核`, `報價明細`, `價格來源`, `判讀備註`, and `給客戶`; preserve stable English sheet ids for API patches.
- Keep `/steel/oauth-chat` as the full Steel quote/workbook flow validation surface until the user explicitly confirms it. Do not extract the workbook preview or quote workflow into the formal Steel Workspace or official chat route before that approval.
- Do not implement workbook web testing by expanding natural-language user input into hidden dev commands. `/steel/oauth-chat` workbook updates should come from AI/tool-calling judgement that emits typed workbook patch operations, then backend validation applies them.
- OpenAI workbook patch function-tool schemas must include explicit JSON Schema `type` keys even when using `const` or `enum`; real OAuth smoke should cover provider schema acceptance, not only mocked tool-call extraction.
- Do not ask users for Steel workbook internal `sheetId`, `rowId`, or `columnKey`. The backend should provide bounded workbook structure context so AI can resolve visible Chinese sheet/field wording such as `總結` and `總額` into stable internal ids before tool calling.
- Steel quote AI should analyze natural-language specs, choose formula/rule/tool paths, and call backend tools; backend code should validate selected formula/rule/source and run deterministic calculators, not hard-code C-type free cutting/hole behavior by product family.
- When material price is unknown or `0`, Steel AI should present nearest reviewed price/spec candidates and ask for confirmation or a user-supplied unit price; workbook may record candidate/manual-review state, but no confirmed total should be patched before confirmation.
- If an exact Steel material price is missing but there is exactly one nearest reviewed positive candidate, the AI may use that candidate for a preview estimate; it must disclose the assumption and ask the user to confirm or provide the exact price.
- For incomplete Steel specs with multiple plausible reviewed candidates, such as `全華興 / 亞L30x30`, list all bounded candidate options with product name, spec, tier price, unit, and source context; do not show only the highest approximate match or make the user open source files to decide.
- When an Admin-reviewed customer-scoped rule/default is applied through `lookup_defaults`, Steel AI should explicitly tell the user the customer rule was applied, for example that this customer's H-type cutting/hole charges are not counted.
- C-type cutting/hole no-charge behavior must exist as a configured quote default or reviewed rule and be selected by AI; neither backend calculators nor pricing code may infer it only from `material_family = C-type`.
- For any material that can carry a cutting price and needs cutting, Steel AI must ask about head/tail trimming when not already explicit; if remainder logic omits tail trim, assistant text and workbook notes must say tail trim is not counted, and no-cut lines must still record zero cutting in the workbook.
- Treat OpenAI Code Interpreter / AI-written Python as optional calculation evidence, not the trusted Steel quote calculator. Backend-owned deterministic calculation must still recompute and validate formula/rule/source inputs before any workbook patch is accepted.
- When AI Python and backend recalculation differ but backend calculation succeeds, Steel workbook patching should use the backend-confirmed number as highest confidence and include the AI/backend difference in audit notes instead of blocking the preview patch.
- When a user explicitly asks for an approximate Steel quote, e.g. `一支多少` with `大約` quantity, AI may produce a medium-confidence estimate from the closest reviewed product-price candidate if it clearly states the assumed spec, low-confidence reason, and that missing dimensions can change the price.
- Store AI Python code/output and verbose execution artifacts in backend-readable database audit fields, not visible workbook text sheets. `價格來源` and `判讀備註` may still contain concise human-readable AI/backend difference summaries.
- When a Steel request has typos or incomplete specs but the user asks for a quick approximate preview, AI should return the highest-confidence source-backed candidate with assumptions and confidence, then let the user refine through later messages.
- Steel workbook `version` is only a visible update counter / optimistic freshness marker. Database storage should keep only the latest workbook/calculation state and overwrite old data unless the user explicitly asks for historical snapshots.
- In wrap-up `Next Tasks`, describe both the implementation item and the logic behind it; do not list short labels without explaining what will be built or why.
- Do not imply visually different Chinese typo/alias matches such as `亞` to `錏` are automatic fuzzy text matches. Candidate generation must come from a reviewed alias/normalization rule or an explicitly low-confidence AI-proposed search expansion that is revalidated against reviewed source rows before being shown for confirmation.
- For typo/incomplete material text such as `亞L30x30`, AI should first propose possible steel material/spec candidates, then query reviewed tables with those normalized candidates. Do not query source tables with nonexistent raw user text as if it were a canonical product/spec key.
- When correcting typo/incomplete Steel price lookup, fix the process order, not only the alias list: raw customer text is evidence for AI/normalization, while `search_price_candidates` should receive derived product/spec query candidates such as material family, surface wording, and size terms.
- Steel AI, not hardcoded backend routing, should decide which business lookup tool to use after normalization. Backend tools provide validated table-specific capabilities and guardrails; they should reject unsafe raw typo lookups but should not silently choose the domain tool path for the AI.
- For examples like `亞L30x30 一支多少`, model the full runtime chain: AI identifies typo/incomplete spec, proposes approximate material/spec candidates, chooses and calls the relevant reviewed-data tools, continues lookup/ranking, writes a provisional workbook update with source/confidence notes, and asks the user to confirm from bounded options.
- Treat AI-led tool orchestration as the core Steel quote runtime framework in docs and implementation plans. Future designs should start from AI choosing the business tool path from normalized context, with backend providing validated tools, guardrails, source-backed results, deterministic calculation, and audit.
- Do not expose AI reasoning helpers such as `normalize_quote_item`, `generate_price_search_terms`, or `rank_price_candidates` as Steel runtime tools. AI should generate material/spec candidates and price `candidateQueries` in reasoning; backend tools should focus on reviewed-row lookup, `lookup_defaults`, deterministic validation/calculation, and workbook output.
- Use the shorter quote-default naming for reusable reviewed Steel defaults: runtime tool `lookup_defaults`, Supabase table `steel.quote_defaults`, and selected rule source `quote_default`. Avoid reintroducing `lesson_memory` names except when explicitly discussing LibreChat user memory as a separate future adapter.
- Do not let the Allowed MVP tool list grow from backend repository/module names.
  For the AI-led Steel quote MVP, expose only `search_customers`,
  `search_price_candidates`, `lookup_defaults`, and `lookup_formula` as
  reviewed lookup tools, plus `lookup_instructions` for task-scoped reviewed
  instruction packets. Exact customer/spec lookup, formula-version naming,
  weight/cutting/processing/material-rule lookup, arbitrary source-chunk search,
  ranking, calculator primitives, and workbook-read helpers are backend
  internal capabilities or future extensions unless a later slice proves they
  need to be AI-callable.
- Treat `docs/reference/instruction.txt` as a seed source for reviewed,
  task-scoped Steel Instruction Packets, not as a monolithic prompt pasted into
  every run. AI may use `lookup_instructions` before candidate generation for
  price-before-weight policy, oral material aliases, C-type rules, long-material
  cutting, hole/slot/bending interpretation, and workbook output rules.
- Steel Agent Instruction is the Admin-managed default instruction injected into
  every Steel quote turn. Do not treat it as a code-fixed provider prompt.
  Runtime should record its version/source, while detailed task-specific rules
  remain retrievable through `lookup_instructions` Instruction Packets. Use
  planned database surfaces `steel.agent_instructions` and
  `steel.instruction_packets` rather than provider constants.
- Steel Agent Instruction should include global order-inference sections for
  file/OCR rules, reviewed tool routing, order-line inference, workbook output
  policy, confirmation behavior, and source validation. Workbook updates are
  currently produced through the provider-facing `patch_workbook` output tool
  and then validated/applied by backend workbook services; do not classify
  `patch_workbook` as a reviewed lookup tool.
- When the user asks to confirm Agent Instruction content before framework or
  schema design, first record database-ready seed text with the actual quote
  behavior rules. Only then design `instruction_packets`, storage, or Admin
  lifecycle details, so future work does not drift back into backend-first
  tool/schema design.
- Keep Steel `agent_instructions` and `instruction_packets` in separate docs and
  future database surfaces. `agent_instructions` owns the every-turn default AI
  instruction prompt; `instruction_packets` owns task-scoped retrieved packet
  design and packet bodies. Future prompt-injected body text for both layers
  should be Traditional Chinese, while canonical API/schema/tool keys may remain
  English.
- `lookup_instructions` should use one batched full-facet request per
  interpreted Steel order context. Include all detected material families, task
  types, processing types, formula candidates, customer/tier/project context,
  and low-confidence facets together; do not query instruction packets
  separately for each small detail such as hole count, cut count, slotting path,
  bending, formula, or individual line fragments.
- For Steel drawing/order evidence, do not treat visible hole positions as
  automatically higher authority than a clear drawing/order table count. A table
  notation such as `4-Ø22` is high-confidence per-piece/per-stock hole evidence
  when the row maps clearly to the material line; drawing hole positions are a
  cross-check. If table count and drawing positions differ, record both and mark
  manual review instead of silently overriding the table.
- For Steel hole pricing, explicit reviewed punching/hole-processing product
  price rows win over generic hole-fee lookup. C-type holes follow the selected
  C-type special pricing rule/default and should not be charged again through
  the generic hole-fee path.
- Organize Steel Instruction Packets by stable material/task packet groups, not
  as isolated fine-grained fragments. A batched `lookup_instructions` call
  should return the related price, formula, cutting, hole, workbook, and
  confirmation packets for the detected steel context together; do not force AI
  to query each detail rule separately.
