# Lessons

- For Steel plate pricing, when the customer does not specify a plate material,
  search and quote as black iron OT. PL oral specs use the number after `PL` as
  thickness and the number after `*` as width, e.g. `PL6*80` should derive
  `6.0m/mOT板雷射切割`; price plates only by square theoretical weight kg
  (`volume * density`, density 7.850 for OT/black iron), and use laser-cut
  product-price rows such as `黑鐵板 雷射切割` / `OT板雷射切割`, not `四方切`
  or per-piece pricing.
- Steel workbook UI now includes the internal `客戶資料` / `customer_data` tab
  alongside `系統訂單`, `人工複核`, and `報價單`. When users provide a customer or
  vendor name, `search_customers` candidates should be written to
  `customer_data`; if multiple candidate tiers include B, use B first for
  provisional quote calculation while keeping candidates pending confirmation.
- In Steel workbook `customer_quote` / `報價單`, the `customer_total` /
  `報價總額` row must always be normalized after line updates: keep it as the
  final row and recompute its subtotal from current customer quote line
  subtotals when lines are added or changed.
- After Steel PDF/image data is already OCR'd into `file_analysis_data`, a
  later user correction/confirmation turn should patch existing extracted data
  and workbook rows directly. Do not call `run_file_ocr` again just because the
  conversation still has a PDF attachment or OCR history; only re-OCR when the
  user explicitly asks to OCR/re-read/re-analyze the file.
- Steel OAuth Chat runs through the unofficial `openai-oauth-provider` /
  ChatGPT OAuth provider path, not the official OpenAI API adapter. Do not
  assume official Responses API parameters or stream events such as
  `context_management.compact_threshold` are available unless the OAuth provider
  exposes them in code; design status/telemetry from the provider events we
  actually observe.
- Steel chat progress UI should use short `Activity` wording and show the
  public work log, not frame it as hidden chain-of-thought. Include streamed
  progress, reasoning summaries, lookup/tool events, errors, provider timings,
  and workbook-completion status so users see that a long provider call is not
  stuck and developers can audit the expected AI workflow.
- Steel `patch_quote_workbook` completion stays focused on `系統訂單`,
  `人工複核`, and `報價單` (`customer_quote`), with `客戶資料` (`customer_data`)
  projected when customer search candidates exist. Do not push the model
  through all persisted workbook sheets for `報價明細`, `總結`, `價格來源`, or
  `判讀備註`; keep those out of semantic patch completion/projection unless the
  user explicitly re-expands the contract.
- Steel workbook UI should stay limited to the four visible tabs: `系統訂單`,
  `客戶資料`, `人工複核`, and `報價單`. Persisted workbook storage/export
  compatibility may still carry additional sheets, but the right-panel preview
  and UI-default export selection must filter out `報價明細`, `總結`,
  `價格來源`, and `判讀備註`.
- Steel provider latency debugging should surface structured `timings` in the
  Activity panel, not rely on ad hoc assumptions. Keep total, generation, tool,
  workbook-completion, per-round, and missing workbook target counts visible when
  `SteelProviderChatResponse.timings` is present.
- Steel workbook completion loops must be stream-visible before the next AI
  round finishes. When `patch_quote_workbook` is incomplete, emit a
  `patch_quote_workbook` status event with missing sheet/cell targets so the
  Activity timeline shows that AI is filling `系統訂單`, `人工複核`, or `報價單`
  instead of appearing stuck after one workbook patch.
- When Steel AI emits multiple same-round `search_price_candidates` calls for
  related product/spec keywords, do not rely on prompt wording alone. Coalesce
  compatible sibling calls into one backend execution with batched
  `candidateQueries`, preserving original tool-call ids in the next prompt.
- Steel workbook row deletion must be explicit data, not inferred from omitted
  semantic rows or assistant text. Use `patch_quote_workbook.deleteRows` to
  project `delete_row` operations, persist them through the shared workbook
  contract, and apply them in the workbook service before saying rows were
  removed.
- Do not add delete-only or `system_order` exceptions that skip the full Steel
  quote-workbook completion loop based on perceived provider latency. Keep
  workbook completion semantics uniform; make the next AI round receive
  workbook/tool feedback promptly instead.
- Steel oral-name price lookup must not stop at the customer's original wording
  when product-price names differ. For inputs such as `3*3鍍鋅方管` or
  `3分圓鐵`, search by bounded reviewed product-price names/specs such as
  錏方管 + 75*2.0 and 圓鐵 + 9m/m(3/8)(3.3). Treat model codes such as GDH3020
  and EQB0090 as adopted-row outputs for workbook/system-order fields, not as
  primary search terms. Preserve those model codes and 6M stock/cutting
  calculations in workbook-visible evidence after adoption.
- Steel price search must support **Price Code Prefix** discovery: after an AI
  product-name search finds a family-like code such as BNG, BNH, BKZA, CCS, or
  DNB70, the next candidate search may use that prefix to retrieve related
  formal `erp_item_code` rows. Use broad OR-style discovery so AI sees enough
  rows to judge the requested spec; avoid overly strict AND filters that return
  no data and cause premature "not found" answers.
- The intended Steel price lookup reasoning flow is AI-led and two-stage:
  search Chinese product-name data to discover related product families or
  price code prefixes, then search those prefixes for formal specification rows,
  then let AI judge which returned row best matches the customer's requested
  product/spec before quoting.
- Price code prefix expansion is optional discovery, not a required pre-quote
  gate. If Chinese product-name/spec search already returns a reviewed row that
  matches the customer's request, AI can quote directly without forcing a prefix
  lookup.
- `search_price_candidates` should be broad enough for AI-led discovery:
  `productNames` searches product-name text and may contain product names or
  partial spec text; `erpItemCodes` searches model/code text and may contain
  exact item codes or prefixes. These fields should OR together to return
  related reviewed rows. The AI then decides whether more prefix data is needed
  and which row best matches the customer request.
- Do not expose `catalogFamilies` on `search_price_candidates` for the new Steel
  price-discovery path. Catalog-family keys belong to catalog/rule lookup; price
  discovery should stay broad through `productNames` and `erpItemCodes` so it
  does not AND filters into premature no-match results.
- Remove `specKeyContains` from Steel price-discovery code when revising the
  AI-facing search path. Formal price row product names often include the spec,
  so AI should generate multiple product-name text forms such as `75*2.3`,
  `1.2*4'*8'(28.5)`, `4.5*5尺*10尺 (46*101.6)`, or
  `150*75*5/7*6M(84)` in `productNames`.
- When the customer says C 型鋼 / C 鋼 / 輕型鋼 without material, default the
  price candidate family to `錏輕型鋼`, not 黑鐵輕型鋼. Still mark low confidence
  or ask when the customer's wording makes the material/surface genuinely
  ambiguous.
- Steel price search must not fail the whole `search_price_candidates` call just
  because one `productNames` value is a family/oral label such as `C型鋼`. Treat
  admin-maintained product-name aliases as extra reviewed search terms, keep OR
  facets usable, and let no-result evidence flow into workbook/manual-review
  output.
- Steel product-name alias storage must be many-to-one: multiple source names
  such as `C`, `C型鋼`, `C鋼`, and `輕型鋼` can all point at the same reviewed
  target product name such as `錏輕型鋼`, and admins should be able to add or
  update those source-target rows without code changes.
- Steel oral material/surface aliases can target product-name markers such as
  `ST`, `OT`, `HL`, `2B`, `BA`, and `NO1`. For `白鐵 -> NO1`, require explicit
  thickness evidence of at least 3mm; do not only parse `t`, because real NO1
  product names include forms such as `3.0m/mSTNO1雷射切割` and
  `STNO1 3.0*4'*8'(73.5)`.
- No-data search results are still quote evidence. If a requested item has no
  returned price data, keep it in workbook/manual-review output with confidence
  and missing-data notes instead of omitting the item.
- Keep Steel agent rules/tool rules generic. `docs/rules/agent規則.txt` may say
  product-name/spec text belongs in `productNames`, ERP code prefixes belong in
  `erpItemCodes`, and invalid tool arguments should be corrected and retried;
  product/category-specific productNames bans, default product-name candidates,
  and examples such as C 型鋼 defaulting to `錏輕型鋼` belong in
  `docs/rules/鋼材規則.txt` under the relevant family rule.
- When diagnosing Steel price search truncation, distinguish three limits:
  tool schema `limit` accepts up to 100, repositories default/max to 100/100,
  internal rule/default selection defaults to 100, and
  `sanitizeSteelToolOutput` caps arrays/source refs at 100 items before the
  model sees the result.
- Do not implement Steel oral-name candidate expansion or 6M long-material
  stock/cutting calculations as deterministic backend logic unless the user
  explicitly asks. The user wants ChatGPT-like AI reasoning here: runtime prompt
  should make AI generate product-name/spec candidates and calculations, while
  backend only enforces tool schemas, reviewed price row adoption, and workbook
  validation.
- Steel rules are human-authored contracts; do not add or keep tests whose
  primary subject is rule text, rule DTO/schema contracts, rule repositories,
  rule services, or rule-loading prompts. Verify rule work by syncing the
  intended source into Supabase reviewed rows, direct readback, and downstream
  runtime behavior only when behavior code changes.
- Steel Supabase lookup/search tool latency is dominated by cloud round trips,
  not local SQL execution, once the query plan is healthy. Batch shared-filter
  product candidates into one SQL query instead of looping one query per
  product key, keep `%...%` search fields covered by trigram indexes, and live
  measure before parallelizing because a cold pool can make parallel queries
  slower by opening extra Supabase connections.
- Steel multi-page PDF/image OCR must auto-continue in the same chat turn:
  after each page/image `run_file_ocr`, immediately `patch_file_analysis_data`,
  report progress, then continue the next page/image in order. Treat `go` /
  `繼續` only as resume after user stop, interruption, OCR failure, or an
  explicit manual-review pause.
- Steel drawing-derived plate parts such as 柱底板、連接板、加勁板、補強板、
  端板、底板 and 蓋板 are plate products, not separate steel material
  families. When dimensions and thickness are available but material is not
  specified, quote with the reviewed 黑板 primary candidate, keep 黑鐵板 as a
  valid reviewed secondary candidate, and mark the material assumption as
  provisional instead of blocking the price as 未確認.
- Steel plate price lookup must use reviewed product names only. Current valid
  plate product names are 鐵板、槽型鐵板、ST 鐵板、2B 鐵板、ST 2B、ST HL、
  黑鐵板、黑板、錏鐵板、錏板、白鐵板、白鐵. SS400 is only a material/spec note,
  and 黑皮板 is not a product name.
- Steel black iron plate theoretical rectangular weight must come from reviewed
  rules, not model common knowledge: use density coefficient 7.850 and
  calculate kg = length mm × width mm × thickness mm × 7.850 ÷ 1,000,000.
- Steel density/theoretical-weight rules should stay concise. Keep the prompt
  focused on the density table, four-sided theoretical weight formula, kg/m
  conversion, and when kg price may be used; keep long extraction statistics
  out of the rule text and in verification/source refs instead.
- Do not rely only on agent instructions for Steel multi-page PDF OCR
  continuation. The provider must track patched PDF page progress and reject a
  premature final assistant answer while `pageCount` still has unprocessed
  pages; progress summaries belong in stream/tool status, not final text.
- Steel PDF `pageCount` is attachment metadata, not OCR output. OCR is one page
  per task, so provider page progress must initialize from the uploaded PDF
  before OCR starts, or from already-known attachment metadata, then merge
  later `patch_file_analysis_data` rows by source file/page.
- Steel PDF page-count metadata must be prompt-visible, not only internal
  provider state. After backend resolves a PDF `pageCount`, merge it back into
  the OCR inventory text so the model cannot claim it does not know how many
  pages to process.
- Steel multi-page OCR in one chat turn must accumulate every
  `patch_file_analysis_data` proposal before handler persistence. Do not keep
  only the last page patch, and stream post-OCR waiting/received status so the
  user is not left at `run_file_ocr completed` with no visible progress.
- Steel stream status is not a substitute for persisted OCR data. When
  `patch_file_analysis_data` is received during a multi-page OCR turn, persist
  that page patch immediately, emit a data-bearing `file_analysis_data` stream
  event before starting the next OCR page, and skip reapplying the same
  cumulative patch at final `done`.
- Steel `run_visual_inspection` sends the prepared page/image into a nested
  OpenAI OAuth vision call. Keep that nested file data as a raw base64 string,
  not a binary typed-array payload, so provider internals do not hit unsupported
  object transfer errors.
- Steel PDF OCR must not pass the original uploaded `Uint8Array` directly into
  pdfjs. pdfjs may transfer/detach its input data, so every page-count or page
  render operation must receive a fresh byte copy; otherwise page 1 can succeed
  and page 2 can fail with `Cannot transfer object of unsupported type`.
- Steel provider must not have a default tool-loop cap for OCR/PDF processing;
  large PDFs can have hundreds of pages. Only apply `steelToolMaxCalls` when an
  explicit caller/test passes it.
- Steel `run_visual_inspection` is a gap-filling geometry tool, not a fixed
  post-OCR step. Call it only when OCR/table/user data is missing a necessary
  geometry or processing value, such as slot continuous edge length required for
  pricing.
- When Steel chat returns `fileAnalysisData`, automatically open/select the
  File Analysis right-panel tab. A completed `patch_file_analysis_data` stream
  event is not enough for users to see rows if the UI remains on Workbook.
- Steel chat workspace ids are backend-owned. The frontend may retain and
  resend the returned `conversationId`, but it must not create empty workbooks
  or `file_analysis_data` workspaces, and must not send `workbookId` /
  `workbookVersion` as authoritative chat context. Handlers must resolve or
  lazily create the conversation-bound workbook/file analysis only when a real
  patch needs persistence.
- Steel conversation workspace reload must treat workbook and
  `file_analysis_data` as paired persisted state. Reopened Steel chats should
  recover both by backend `conversationId`, while later AI turns send only that
  conversation id so backend context loading can read the same workbook and
  file analysis rows from DB.
- Steel `file_analysis_data` must not persist `workbookId`. The canonical link
  is `conversationId`: resolve the active workbook from the same conversation
  when needed, keep file-analysis manual patches free of workbook ids, and make
  Mongo indexes match that query path with unique `conversationId` and
  `fileAnalysisDataId` indexes.
- Steel save/update routes for workbook and `file_analysis_data` must be
  conversation-scoped. Do not let frontend update payloads or URLs choose a
  workspace by `workbookId` or `fileAnalysisDataId`; keep old id-based PATCH
  routes disabled and resolve the unique backend-owned workspace from
  `conversationId`.
- For Steel OCR/file-analysis work, do not spend effort hand-fixing incidental
  code snippet line-number output formatting or running Prettier; the user will
  run `npm run format` manually. Use targeted edits, behavior tests, builds,
  and `git diff --check`.
- Steel OCR `patch_file_analysis_data` rules should store only
  quote-relevant material facts: material/spec/size/quantity/process/price
  context and concise notes or review items. Do not store project names,
  engineering names, dates, places, people, owners, addresses, or other
  non-quote metadata in cells.
- When Steel chat returns both `workbookPatch.workbook` and `fileAnalysisData`,
  prioritize the Workbook right-panel tab. File Analysis should auto-select
  only for file-analysis-only OCR/review responses, not completed quote
  workbook responses.
- When Steel chat returns only `workbookPatch.workbook`, also open/select the
  Workbook right-panel tab even if the user was previously viewing File
  Analysis. Any accepted workbook patch is workbook-visible output.
- Do not reintroduce Steel rules tests. If a rule change needs verification,
  use Supabase sync/readback metadata or a live/runtime smoke, not committed
  tests around rule wording, rule repository rows, rule proposal schemas, or
  prompt assembly. Runtime tests may mention `lookup_quote_rules` only when the
  subject is an end-to-end chat/tool flow rather than the rule contract itself.
- Keep AI-facing Steel tool names stable and generic. Do not expose vendor/model
  implementation names such as `paddleocr_vl` as the provider tool name; use a
  generic wrapper such as `run_file_ocr` while the backend can still call the
  configured PaddleOCR MCP implementation internally.
- `run_file_ocr` is a Steel tool and belongs on the Steel AI tool surface, but
  it is executed by the provider-local OCR executor. Do not route it through
  the Supabase query executor used by `lookup_*` and `search_*`.
- All Steel rule runtime tests should load or mock rules through Supabase-backed
  repositories such as `steel.agent_rules` or `steel.quote_rules`; do not read
  `docs/rules/*.txt` inside tests as the source of truth.
- Steel rules are Traditional Chinese only. Do not add locale suffixes such as
  `_zh_tw` to rule canonical keys; use the DB `locale` field only where the
  schema requires it.
- When syncing `docs/reference/鋼材規則.txt` into `steel.quote_rules`, update
  both the reviewed row `prompt` and its `source_refs` metadata such as
  `sha256`, `sourceFile`, `locator`, and `canonicalKey`; prompt hash equality
  alone is not a complete DB source-sync check.
- Steel `source_refs` objects must always keep canonical provenance fields:
  `channel` and `factType` are required by runtime parsers. When refreshing
  `sha256` or `sourceFile`, merge into the existing source ref or rebuild the
  full canonical object; never replace it with hash-only metadata.
- Steel workbook formula-code mapping is workbook-rule owned. Do not describe
  formula code lookup as coming from `lookup_quote_rules` or Agent tool flow;
  `lookup_quote_rules` may return pricing/category/material/processing rules,
  while `docs/reference/workbook規則.txt` owns system-order formula code filling.
- `/steel/oauth-chat` runtime workbook initialization must be empty of quote/order/customer
  data. Keep sheet and column structure from the code-owned `訂單參考.xlsm` contract, but
  do not seed reference workbook rows; the first AI/user patch may create rows such as
  `line_1`, `source_1`, and `note_1`.
- `lookup_quote_rules` is the merged AI-callable Steel quote-rule lookup: it must
  return both instruction packets and quote defaults, support multiple catalog/material
  keys in one `catalogContexts` call, and replace the old AI-callable
  `lookup_instructions` / `lookup_defaults` surfaces in provider prompts and
  `steelToolDefinitions`.
- Steel quote calculation belongs to the AI lane on the fixed OAuth/Codex path,
  not backend pricing/calculator modules. Backend should provide reviewed
  calculation-rule prompts/source rows/workbook validation and validate that
  workbook summary totals match the sum of line subtotals instead of trying to
  prove hidden Code Interpreter execution.
- Steel workbook summary total validation only checks `summary.totalAmount`
  against the sum of `quoteLines[].subtotal`. Confidence and provisional status
  belong in line/manual-review/notes fields, not separate summary amount rows.
- Steel pricing unit data comes from `search_price_candidates` database price
  rows. User words such as `一支` describe requested quantity or delivery unit;
  they must not override the database price row pricing unit, and subtotal must
  not be copied into unit price.
- Steel workbook prompt must state that `quote_details`, `system_order`,
  `price_sources`, and `customer_quote` share the adopted
  `search_price_candidates` pricing unit. If the price row is kg-priced, visible
  quote/customer sheets must use `Kg`; user delivery words like `一支` belong in
  notes or length/quantity context, not the workbook pricing unit.
- Steel `customer_quote` is customer-visible and must not leak internal pricing
  segmentation. Notes may show the customer or project name, but not customer
  tier, price A/B/C, customer price, tier price, cost, margin, or any wording
  implying different customers have different prices.
- Steel `customer_quote` total rows are AI-authored semantic data, not backend
  auto-fill. Use top-level `customerQuoteTotal` for the bottom `報價總額` row;
  backend projection only maps that explicit semantic target to
  `customer_quote.customer_total`.
- In `/steel/oauth-chat`, textarea Enter handling must respect IME/composition input
  such as 注音. Pressing Enter to choose composition text must not submit the chat; submit
  only after composition ends.
- Before `/steel/oauth-chat` live tool-status smoke, verify the runtime cloud Supabase Postgres path with `.env` `STEEL_POSTGRES_URL`; the Steel backend must use the cloud Postgres pool, not local/Docker, and streaming tool execution should reuse the runtime pool instead of cold-connecting on every tool call.
- If Steel tool lookup fails with `self-signed certificate in certificate chain`,
  reproduce with a direct sanitized `pg` probe and verify the runtime
  `STEEL_POSTGRES_URL` path is normalized to libpq-compatible SSL. The helper
  should add `sslmode=require&uselibpqcompat=true` when no SSL mode is provided,
  while preserving explicit CA-backed `sslmode=verify-full` settings. Rebuild
  `packages/api` and restart the backend after changing this helper.
- Treat `npm run frontend:dev` startup separately from LibreChat app readiness. Vite can start on port 3090 while `/api/*` still fails if the backend is not running on port 3080.
- For LibreChat local dev, verify the backend path too: backend startup requires `client/dist/index.html`, so `npm run build:client` may be needed even when using the Vite dev frontend.
- When diagnosing Vite proxy errors, hit both `http://localhost:3080/api/config` and `http://localhost:3090/api/config` to distinguish backend startup failures from proxy configuration issues.
- After rebuilding `packages/api`, restart the running backend dev process before asking the user to retest `/steel/oauth-chat`; `api/server/index.js` imports the built `@librechat/api` dist at process startup, so an already-running 3080 process can keep old handler behavior in memory.
- When the user asks to write docs, create or update a real project docs file under `docs/` instead of only adding operational notes to agent-facing files.
- For the steel setup, do not assume Docker services are part of local development; the user uses cloud MongoDB and Supabase Postgres through `.env`.
- Do not add root `npm run supabase:*` scripts or `supabase/config.toml` for Steel unless the user explicitly asks for a local Docker-backed Supabase stack; Steel database development uses Supabase cloud through `.env` `STEEL_POSTGRES_URL`.
- For Supabase pgvector, check the actual `pg_extension.extnamespace`; this project currently has `vector` installed in `public`, not `extensions`.
- Do not process or import files under `docs/reference` as real data unless explicitly asked. Steel handbook DOCX currently informs schema/data-model design first; real data SQL/import comes later.
- Do not hard-code default steel product choices as static DB fields such as `is_default`; admin-taught defaults should be modeled as flexible preference rules/memory and applied during disambiguation.
- When a customer asks price for an incomplete steel spec with multiple matches, first run reviewed lookup from bounded AI-derived candidates when possible. For quick `一支多少` requests, lead with the highest-confidence source-backed approximate candidate as a provisional quote, then list the other plausible specs/options for confirmation.
- For Steel price lookup, backend may apply bounded token matching to AI-derived oral product candidates such as `錏角鐵` -> product rows containing `錏` and `角鐵`. This is different from accepting raw typo strings like `亞L30x30` as product-price keys, which remains forbidden.
- For Steel quick-price lookup, do not default missing customer/tier to A or tier 1. If the user did not provide a customer, or `search_customers` cannot find a usable customer price tier, use the global default B tier in price lookup: `customerTierId: 2`. Keep the response concise: say `目前用 價格B：<unit price>` and separately remind that providing a customer name allows lookup of that customer's quote price. Do not add highest/most-expensive wording unless the user asks. If `search_customers` finds a usable customer tier, use that tier instead of B.
- For Steel quick-price response formatting, if total piece weight is already shown, do not list unit weight as a separate bullet. Prefer one line such as `6M 一支重量：4 × 6 = 24 kg`, then unit price and subtotal.
- For local `pg` connections to Supabase, prefer the Supavisor session pooler URL when the direct `db.<project>.supabase.co` host does not resolve or the environment lacks IPv6 support.
- Keep Steel changes isolated from upstream LibreChat hot files where possible; avoid premature root exports or core entrypoint edits until a route actually needs them.
- Every wrap-up response should include explicit next tasks so the user knows what to do next.
- With the current Node `pg` stack, `sslmode=require` alone may behave like `verify-full`; use `uselibpqcompat=true&sslmode=require` for libpq-compatible dev behavior, and plan CA-backed `verify-full` for production.
- Steel guest mode is not a later-only product phase; it should be controlled by an environment flag. When enabled, quote conversation/workbook/export guest access requires no login or role permission. When disabled, Steel quote access requires login plus an admin-approved permission.
- Steel workbook pricing must persist the accepted line calculation: formula, database default unit price, quoted unit price, line total, and explicit unit-price/total-price adjustments belong in the workbook, not only in chat text.
- Never touch existing workbook prices, quantities, or totals just because a newer database price exists; only update them when the user explicitly requests a change or recalculation for that line.
- Customer-facing Excel must hide `customer_tier` and internal/debug fields; export `quoted_unit_price` and `line_total` under customer-friendly price labels instead of exposing raw internal workbook field names.
- Steel v8.3 Phase 4 is staff workbook export from `/steel/oauth-chat`, not the
  future customer-specific export format. Do not add customer-visible masking,
  customer/internal access splitting, or dedicated system-order export actions in
  this phase; allow staff to download any selected workbook sheets. Generate the
  XLSX in memory and stream it from the API unless a later durable-share/export
  requirement explicitly selects Supabase Storage or another file store.
- Even after `給客戶用` shows a bottom `報價總額` row and `/steel/oauth-chat`
  can download XLSX, do not start `Customer Export` unless the user explicitly
  opens that scope. Treat the immediate next step as Phase 4 checkpoint
  close-out and verification, then move to the next approved v8.3 phase.
- If the user skips Phase 5 and asks to plan Phase 6C file/PDF/OCR/drawing
  evidence, do not keep Admin ERP XLSX import as a prerequisite. Quote
  attachments are evidence for workbook `manual_review` and
  `interpretation_notes`; they must not create Admin source versions, merge
  rows, or formal database writes.
- `docs/rules/OCR規則.txt` is a Steel Agent process / inference-order policy.
  Sync it through `steel.agent_rules` with drawing/file OCR rule sections, not
  `steel.instruction_packets` or `lookup_quote_rules`; `lookup_quote_rules`
  remains for material, processing, price, formula, and quote-default rules.
- Steel drawing/PDF/image OCR should first create `file_analysis_data`, a
  user-verifiable extracted table grouped by source file/page/region. The user
  can compare it with the PDF/image, correct it over multiple chat turns, and
  only then ask to create or update quote workbook rows.
- Phase 6C drawing prompt builder must use OCR rules already loaded from
  `steel.agent_rules`; it must not read `docs/rules/OCR規則.txt` directly at
  runtime. The AI should autonomously decide which fields exist in the
  PDF/image, while the system fixes only the three review output pages:
  `file_analysis_data`, `manual_review`, and `interpretation_notes`.
- Do not force visual OCR into fixed structured JSON or fixed columns at this
  stage. Prompt the AI to improve image/text accuracy, preserve source/page/
  region evidence, and propose useful fields based on the uploaded file.
- Phase 6C file/PDF/image evidence is fixed to `openai_oauth_responses`, not
  official OpenAI API. Store user-uploaded evidence through LibreChat file
  storage and Mongo `File` records, then resolve the internal `file_id` and
  send bytes/file parts to OAuth on every AI read or re-read. Treat
  `messages[].files[].dataBase64` as smoke/backcompat only, not durable storage.
- If the user asks AI to re-read or re-interpret a PDF/image, resolve the
  internal LibreChat/Steel file ref and send the original bytes again. Do not
  rely on previous `file_analysis_data` alone, and do not depend on
  `openai_oauth_responses` provider state as durable file retention.
- For Phase 6C PDF/image/spreadsheet evidence, send supported files directly to
  AI. Local OCR, PDF rasterization, or spreadsheet parsing is not the default
  interpretation path; unsupported provider capability should produce typed
  errors or manual-review output.
- Do not add Steel helper commands to `packages/api/package.json` npm scripts.
  Run one-off Steel scripts directly with `node packages/api/scripts/<script>.cjs`
  so package scripts stay focused on stable project commands.
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
- Successful AI workbook patches should reply with only a concise order-information and key-change summary in chat; avoid per-field diffs, long search keywords, long candidate item lists, and field-count-only text like `已更新 workbook：16 個欄位`.
- In Steel `報價明細`, the user-facing quote amount column should be `小計`; do not add a duplicate `報價` column. Keep `材料費` as a material-cost component when needed, and when a customer/tier or unit price follow-up changes the amount, update and summarize the new `小計`, not only the workbook field changes.
- When Steel tools return customer data, product-price candidates, formula rows,
  quote rules/defaults, or AI-code calculation results, the OpenAI workbook
  patch prompt must tell AI how to map those results into the
  `docs/reference/訂單參考_轉檔.xlsx` sheet contract. AI owns the workbook
  companion rows; backend should validate/remind, not synthesize them. Missing
  unit prices, amounts, formulas, weights, customer matches, or material matches
  are `未確認` plus `人工複核`/`判讀備註`, never `0`; `給客戶用` must hide internal
  customer tier, source refs, search keywords, candidates, AI/internal notes,
  cost, and margin.
- Steel quote workbook updates should support cascade projection: changing one
  semantic quote value such as customer tier, material unit price, quantity,
  weight, or subtotal usually requires synchronized cells across `報價明細`,
  `系統訂單`, `總結`, `價格來源`, `人工複核`, `判讀備註`, and `給客戶用`. Prefer an
  AI-authored semantic quote patch that backend projects into validated cell
  operations over making the model manually enumerate every affected cell.
- `/steel/oauth-chat` stream errors must preserve sanitized provider detail for
  unknown OpenAI OAuth failures. If Steel lookup tools completed and the next
  provider round fails, a generic `OpenAI OAuth provider request failed.` hides
  the actionable cause such as context length, schema rejection, invalid
  request, rate limit, or transient provider failure.
- User-facing Steel price bullets should be terse: use `價格：<單價>`, not `reviewed 價格：<單價>`. Put reviewed/source status in source lines or notes instead of the bullet label.
- Keep Steel workbook contract ownership split: public DTOs in `packages/data-provider/src/steel/workbooks.ts`, canonical Zod/runtime validation in `packages/api/src/steel/workbook/schema.ts`, and no frontend-owned workbook validation schema.
- Keep Steel API mock data in one shared folder, `packages/data-provider/src/steel/mock/`, so frontend fixtures and backend mock endpoints do not drift.
- Keep Steel mock fixtures behind explicit mock imports; do not re-export them from the production Steel data-provider `index.ts` barrel.
- Use ExcelJS deliberately for Steel workbook export rendering; keep
  parser/read-back concerns separate from the XLSX renderer unless
  implementation evidence supports consolidation.
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
- When refining Steel `catalog_family` keys, inspect `產品價格.xlsx` product rows before treating handbook terms as only candidates. Product-price-confirmed rows such as `點焊網`, `樓層板`, `網板`, `扁方管`, `浪板`, and `收邊` can promote active keys, but keyword false positives like `免收邊鋁窗`, `浪板機`, and `鋼板專用小六角釘子` must stay outside the wrong curated key unless an ERP code group or reviewed rule confirms them.
- For `產品價格.xlsx`, do not keep expanding the name `material_family` as a generic product catalog key. The workbook contains steel materials, fabricated products, accessories, tools, services, and non-steel goods, so the canonical AI/DB/tool lookup surface should move directly to a generic name such as `catalog_family` / `catalogFamilies`; do not keep old `materialFamilies` compatibility logic unless the user explicitly asks for a staged migration.
- Material-specific rules must be task-scoped for AI: only provide the C-type steel rule when the order has a C-type item or strong candidate, instead of dumping all company rules into every prompt.
- For C 型鋼 oral-price flow, do not rely on a permanent runtime system prompt rule as the main mechanism. The AI should first identify the C 型鋼 / `c_type` candidate, call `lookup_instructions`, then use the returned C 型鋼 instruction packet to form bounded price queries.
- When AI has judged a Steel product/category/catalog candidate, the next reviewed lookup step should be `lookup_instructions` before category-dependent tools such as `search_price_candidates`, `lookup_defaults`, or `lookup_formula`. Do not let a direct price search become the first category-specific tool call.
- For C 型鋼 price lookup with unknown surface/material, `錏輕型鋼` may be used as the usual high-confidence provisional `productNames` candidate list. Still show bounded alternatives such as 白鐵輕型鋼 / 黑鐵輕型鋼 when relevant, and keep the quote provisional until the user confirms material/surface.
- For C 型鋼 follow-up turns after alternatives were shown, if the user does not specify a different material/surface, treat the default 錏輕型鋼 assumption as confirmed for that continuing quote context instead of asking the same material question again.
- Mocked OpenAI/provider tests must not be used to prove AI judgment or oral-normalization behavior. Keep mocks only for deterministic adapter/control-loop contracts; any claim that the model chooses a tool sequence or candidate query must be verified with real `openai_oauth_responses` smoke.
- H-type non-standard-length surcharge automatically applies to normalized H-type lengths outside 6M, 9M, 10M, and 12M; it changes material unit price only, while cutting remains priced from cutting-price data.
- Treat `docs/reference/切工價錢.xlsx` as a formal cutting-price source, with later Admin/backend maintenance, not as prompt-only guidance.
- Treat customer inquiry files such as RTF, handwriting, PDF, image, photo, and chat text as quote request evidence/parser fixtures, not formal Admin import sources.
- Treat customer instructions such as no-charge items, special prices, added surcharges, or one-line rule overrides as quote-specific adjustments saved on workbook lines; do not mutate formal source tables or material rules from chat alone.
- For customer order parsing, AI is expected to infer likely specs because every customer's order shape can differ; backend code should constrain that inference into canonical candidate fields, confidence, source refs, and manual-review/clarification paths instead of treating the AI guess as a confirmed fact.
- When AI is uncertain about a Steel spec or repository lookup returns multiple plausible options, the quote flow must ask the user to confirm before confirmed pricing. A provisional quote may still use the highest-confidence source-backed approximate candidate when the user asks for a quick price, as long as all bounded alternatives are shown.
- In `產品價格.xlsx`, a `0` material/product price means no price. For C 型鋼 specifically, the business default is that cutting and hole charges are free/no-charge; model it as reviewed quote-default behavior, not as a source-price zero.
- Do not hard-code C-type steel calculation behavior directly in pricing/calculator code. The AI/runtime should retrieve or apply the C 型鋼 quote default, and backend code should validate the selected default path instead of requiring the user to reconfirm free cutting/hole charges every time.
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
- Steel workbook visible sheet order, labels, headers, and seed rows should follow `docs/reference/訂單參考.xlsm` as a development reference only: `系統訂單`, `報價明細`, `總結`, `人工複核清單`, `價格來源`, `判讀備註`, `給客戶用`. Runtime workbook initialization must use code constants, not read the `.xlsm`; preserve stable English sheet ids for API patches.
- Keep `/steel/oauth-chat` as the full Steel quote/workbook flow validation surface until the user explicitly confirms it. Do not extract the workbook preview or quote workflow into the formal Steel Workspace or official chat route before that approval.
- Do not implement workbook web testing by expanding natural-language user input into hidden dev commands. `/steel/oauth-chat` workbook updates should come from AI/tool-calling judgement that emits typed workbook patch operations, then backend validation applies them.
- OpenAI workbook patch function-tool schemas must include explicit JSON Schema `type` keys even when using `const` or `enum`; real OAuth smoke should cover provider schema acceptance, not only mocked tool-call extraction.
- Do not ask users for Steel workbook internal `sheetId`, `rowId`, or `columnKey`. The backend should provide bounded workbook structure context so AI can resolve visible Chinese sheet/field wording such as `總結` and `總額` into stable internal ids before tool calling.
- Steel quote AI should analyze natural-language specs, choose formula/rule/tool paths,
  call backend tools for reviewed facts/rules, and calculate numeric quote amounts on
  the OAuth/Codex path. Backend code validates selected sources/workbook patches and
  subtotal/summary consistency; it should not run quote-pricing calculators or hard-code
  C-type free cutting/hole behavior by product family.
- When material price is unknown or `0`, Steel AI should present nearest reviewed price/spec candidates and ask for confirmation or a user-supplied unit price; workbook may record candidate/manual-review state, but no confirmed total should be patched before confirmation.
- If an exact Steel material price is missing but there is exactly one nearest reviewed positive candidate, the AI may use that candidate for a preview estimate; it must disclose the assumption and ask the user to confirm or provide the exact price.
- For incomplete Steel specs with multiple plausible reviewed candidates, such as `全華興 / 亞L30x30`, list all bounded candidate options with product name, spec, tier price, unit, and source context; do not show only the highest approximate match or make the user open source files to decide.
- When an Admin-reviewed customer-scoped rule/default is applied through `lookup_defaults`, Steel AI should explicitly tell the user the customer rule was applied, for example that this customer's H-type cutting/hole charges are not counted.
- C-type cutting/hole no-charge behavior must exist as a configured quote default or reviewed rule and be selected by AI; neither backend calculators nor pricing code may infer it only from `catalog_family = c_type`.
- For any material that can carry a cutting price and needs cutting, Steel AI must ask about head/tail trimming when not already explicit; if remainder logic omits tail trim, assistant text and workbook notes must say tail trim is not counted, and no-cut lines must still record zero cutting in the workbook.
- Treat AI on the fixed OAuth/Codex path as the Steel quote calculator. Backend must not
  keep a parallel canonical pricing calculator; instead it should reject or loop when
  workbook summary totals do not match the sum of line `subtotal` values.
- Do not run Prettier repeatedly during Steel implementation turns when the user says commit
  time is enough; keep formatting automation available for the final pre-commit pass.
- Never run Prettier in this repo unless the user explicitly asks for it. Use
  manual formatting, targeted edits, `git diff --check`, tests, and build/type
  checks instead.
- Fixed `/steel/oauth-chat` provider path is OAuth/Codex. Do not add
  `openai.code_interpreter` as a registered tool or gate workbook totals on hidden
  hosted-tool evidence; validate AI-calculated totals through subtotal consistency.
- Live Steel OCR tests for `docs/reference/example/c.pdf` must validate the full
  expected 26-row table, including Chinese names and row-level values, not only
  smoke-level recognizable rows. If OpenAI OAuth built-in OCR fails, do not keep
  tuning OAuth OCR prompts; switch the live fixture to PaddleOCR MCP and report
  missing row/value evidence from the PaddleOCR output.
- Steel table OCR is now PaddleOCR MCP owned. Use project MCP server
  `PaddleOCR-VL-1.6` and tool `paddleocr_vl` for PDF/image/table OCR live
  tests and OCR rules; do not use `openai_oauth_responses` / OpenAI OAuth API
  built-in OCR as the primary OCR source for c.pdf-style table extraction.
- Do not hard-code fixture-specific identifiers, expected counts, or row
  sequences such as BP/PL examples into reusable Steel OCR rules. Keep
  `docs/rules/OCR規則.txt` generic; test-specific expectations belong in
  fixture JSON and test assertions only.
- When a live OCR test fails, report the observed provider output and
  recommendations before changing the test again. The user may want to compare
  the extracted rows manually first.
- Do not mark Steel `code_interpreter` capability as `not_applicable` merely
  because hosted execution evidence is not disclosed. API code interpreter may
  still be usable; backend just must not depend on disclosure as proof.
- When a user explicitly asks for an approximate Steel quote, e.g. `一支多少` with `大約` quantity, AI may produce a medium-confidence estimate from the closest reviewed product-price candidate if it clearly states the assumed spec, low-confidence reason, and that missing dimensions can change the price.
- Store concise calculation/source summaries in workbook-visible `價格來源` and
  `判讀備註`; do not store or surface raw hidden-tool/code evidence for OAuth/Codex
  because it is not a reliable exposed contract on this path.
- When a Steel request has typos or incomplete specs but the user asks for a quick approximate preview, AI should return the highest-confidence source-backed candidate with assumptions and confidence, then let the user refine through later messages.
- Steel workbook `version` is only a visible update counter / optimistic freshness marker. Database storage should keep only the latest workbook/calculation state and overwrite old data unless the user explicitly asks for historical snapshots.
- In wrap-up `Next Tasks`, describe both the implementation item and the logic behind it; do not list short labels without explaining what will be built or why.
- Do not imply visually different Chinese typo/alias matches such as `亞` to `錏` are automatic fuzzy text matches. Candidate generation must come from a reviewed alias/normalization rule or an explicitly low-confidence AI-proposed search expansion that is revalidated against reviewed source rows before being shown for confirmation.
- For typo/incomplete material text such as `亞L30x30`, AI should first propose possible steel material/spec candidates, then query reviewed tables with those normalized candidates. Do not query source tables with nonexistent raw user text as if it were a canonical product/spec key.
- When correcting typo/incomplete Steel price lookup, fix the process order, not only the alias list: raw customer text is evidence for AI/normalization, while `search_price_candidates` should receive derived product/spec query candidates such as catalog family, surface wording, and size terms.
- Steel AI, not hardcoded backend routing, should decide which business lookup tool to use after normalization. Backend tools provide validated table-specific capabilities and guardrails; they should reject unsafe raw typo lookups but should not silently choose the domain tool path for the AI.
- For examples like `亞L30x30 一支多少`, model the full runtime chain: AI identifies typo/incomplete spec, proposes approximate material/spec candidates, chooses and calls the relevant reviewed-data tools, continues lookup/ranking, writes a provisional workbook update with source/confidence notes, and asks the user to confirm from bounded options.
- Treat AI-led tool orchestration as the core Steel quote runtime framework in docs and implementation plans. Future designs should start from AI choosing the business tool path from normalized context, with backend providing validated tools, guardrails, source-backed results, subtotal/summary consistency checks, and workbook validation.
- Do not expose AI reasoning helpers such as `normalize_quote_item`, `generate_price_search_terms`, or `rank_price_candidates` as Steel runtime tools. AI should generate material/spec candidates and price `candidateQueries` in reasoning; backend tools should focus on reviewed-row lookup, `lookup_quote_rules`, source validation, subtotal/summary consistency checks, and workbook output validation.
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
- When MVP docs demote a Steel tool to backend-internal, remove it from the
  executable AI tool schema, registry, and executor branch. Do not leave old
  low-level tools callable as "legacy" aliases.
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
  policy, confirmation behavior, and source validation. AI workbook updates
  should use only provider-facing `patch_quote_workbook` semantic quote data;
  backend projection then creates typed workbook operations for validation and
  application. Do not classify workbook output as a reviewed lookup tool.
- Steel Agent Instruction must explicitly say `統一用繁體中文回覆`; do not rely only
  on adjacent Traditional Chinese storage/schema notes or workbook label rules.
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
- Keep runtime Instruction Packet bodies focused on quote behavior and reviewed
  data requirements. Do not inject Codex/backend implementation rules such as
  "do not hard-code this in backend calculators" into assistant-facing runtime
  instructions; put those engineering constraints in docs, lessons, tests, or
  implementation plans instead.
- Do not make a Steel Instruction Packet body self-reference its own rule name,
  such as "依【C 型鋼專用計價規則】處理". The packet content is the runtime rule;
  state the actionable behavior directly.
- Treat order files under `docs/reference` as test fixtures unless the user
  explicitly reclassifies them. They may validate parsing, quote inference, and
  workbook output, but they must not be imported into formal customer, product,
  price, rule, or order database tables.
- Steel prices and material-specific cutting, hole, slotting, or surcharge
  rules must be data-updated from reviewed XLSX/script/Admin import paths, not
  changed through code constants. Fuzzy or conditional notes such as "小於多少另計"
  should become reviewed lookup/default rows that AI can cite and ask the user
  to confirm when needed.
- For Steel source imports, classify reference files by update behavior:
  `客戶資料.xlsx`, `產品價格.xlsx`, and `切工價錢.xlsx` have fixed columns but
  updateable values; `公式編號.xlsx` has fixed values; `訂單參考.xlsm` is the
  workbook template development reference, but runtime initialization uses code
  constants; `系統訂單.xlsx` is one workbook reference sheet for ERP input/output
  fields; `龍頂鋼鐵手冊__文字版.docx` fills missing unit weights;
  `H型鋼.txt` and note-like rules from other sources seed reviewed defaults for
  AI confirmation, not code constants. Put fuzzy notes in defaults.
- Treat `docs/reference/產品價格.xlsx` as the reviewed source for canonical Steel
  catalog-family vocabulary. AI-facing and DB lookup paths should normalize
  aliases such as `H鋼`, `H型鋼`, `H-BEAM`, `C型鋼`, and `輕型鋼` into fixed keys
  such as `h_beam` and `c_type`; do not model each steel family as a separate
  table or let reusable defaults keep drifting between Chinese free-text labels
  and canonical keys.
- For Steel orders, normalize raw customer product wording into reviewed
  `catalog_family` keys before database lookup. AI may interpret口語名稱,
  typos, surface words, and size clues, but tools should query stable keys such
  as `h_beam`, `c_type`, and `angle`; ambiguous or low-confidence mappings must
  return bounded options for user confirmation instead of silently querying raw
  order text.
- Do not implement oral product wording to `catalog_family` resolution as
  backend alias-matching code. The AI should judge口語名稱 from reviewed
  catalog-family context, aliases, defaults, and source refs, then pass an
  explicit key such as `h_beam` to backend tools; backend code should validate
  and query that key, not silently decide it.
- Do not claim AI prompt behavior is proven by a mocked model response. Mocked
  provider tests can verify backend prompt text, tool schemas, and tool-result
  plumbing, but whether AI actually follows a query strategy such as C 型鋼
  `c_type + 100x2.3` must be verified with a live AI API smoke or explicitly
  reported as unverified.
- When adding Steel `lookup_instructions` coverage, assert the returned packet
  content includes the actual business rule values users care about, not only
  the packet slug. For H 型鋼 this includes常規米數 `6M/9M/10M/12M`,
  非常規米數 `7M/8M/11M/13M/14M/15M`, and 非常規米數 `+0.3 元/kg`.
- H 型鋼非常規米數 product-price rows in `產品價格.xlsx` already include the
  `+0.3/kg` adjustment. If `search_price_candidates` returns an exact reviewed
  row for `7M/8M/11M/13M/14M/15M`, do not add `+0.3/kg` again. Use the
  surcharge rule only as a provisional/default derivation when an exact reviewed
  non-standard length price row is missing.
- Steel `lookup_instructions` content is Admin-editable business policy, not
  provider/tool implementation code. Runtime should read reviewed instruction
  packets from database-backed storage and prefer a merged rule lookup when
  instructions and defaults are both needed; static code packets are only seed
  material or compatibility fixtures.
- In `產品價格.xlsx`, `unit_price` must not be treated as per-piece just because
  the user asks `一支多少`. For common steel rows with `product_price_unit_weight`
  in `kg_per_m`, calculate piece price from requested length: weight =
  kg/m _ meters _ quantity, then amount = weight \* unit_price. For C 型鋼
  `100x2.3`, a 6M piece at 4kg/m is 24kg, so `25-26.8` is TWD/kg and the
  provisional 6M piece amount is about `600-643.2`, not `25-26.8` per piece.
- Arithmetic-check every quote example after applying the written rule. Do not
  preserve a user-facing example merely because the wording around it is right;
  if the formula says `4kg/m * 6M * 25-26.8/kg`, the amount must be
  `600-643.2 TWD`.
- In `產品價格.xlsx`, when the `單位重` column is zero but the product name ends
  with a parenthesized weight that is validated by `售價 = 括號重量 * 比率`,
  import that parenthesized value as reviewed weight-per-piece. Example:
  `白鐵平鐵 50 *8.0( 19.7)` has `單位重=0`, but `19.7 * 107 = 2107.9`, so
  `19.7` is valid unit-weight evidence and the row price is a piece total.
- Treat `輕量H` rows such as `輕量H150*75*3.2/4.5*6M(53)` as H 型鋼
  material rows, not fallback ERP-family products. They should inherit the same
  reviewed H-beam unit-weight/price calculation semantics.
- Treat `BNH` product-price rows as steel/material plate rows. They must not
  remain fallback `erp_bnh` rows when applying product-price unit-weight and
  price-unit rules.
- When `產品價格.xlsx` has a positive `單位重` column, that column wins over any
  product-name parenthetical number. Parentheses are fallback-only. Example:
  `6K鐵軌 6M(38)` has `單位重=36`, and `9K鐵軌 6M(54)` supports the proportional
  correction, so use 36 for 6K; do not override it with `(38)`.
- When product-price unit weight is missing or contradictory, AI/backend may
  look up related same-series/same-spec materials and derive a weight by length
  or proportional comparison, but it must mark the result as inferred evidence
  needing confirmation rather than silently overwriting reviewed source values.
- Steel oral material/category price flow must be catalog-first: for inputs like
  `C型鋼`, `H型鋼`, or typo/incomplete material wording, the runtime should make
  the model call `lookup_catalog_families` to retrieve reviewed vocabulary
  candidates before `lookup_quote_rules`, `search_price_candidates`,
  `lookup_defaults`, or `lookup_formula`.
- `/steel/oauth-chat` stream status may show provider-visible reasoning
  summaries when OpenAI/AI SDK returns them, plus tool/progress events. Do not
  describe this as exposing the model's complete private chain-of-thought, and
  do not invent reasoning text when no summary is returned.
- `/steel/oauth-chat` manual smoke should reuse the fixed local test account
  `steel-smoke@example.test` / `SteelSmoke123!`; create or repair it once in
  Mongo when needed instead of registering random users for each smoke.
- `/steel/oauth-chat` successful quick-price responses must end with a concise final answer as the visible conversation result; completed stream/tool status is supporting detail, not the final UI state.
- Steel quick-price workbook patches must populate every user-relevant workbook sheet when data is available: `系統訂單`, `報價明細`, `總結`, `人工複核清單`, `價格來源`, `判讀備註`, and `給客戶用`; do not accept partial patches that only fill audit/source sheets.
- `/steel/oauth-chat` should keep last-run public activity/tool status in the
  right panel `Activity` tab for development review, not as the completed main chat
  result. Include errors in that last-run status, and overwrite it on each new
  run instead of keeping a history.
- In the `/steel/oauth-chat` workbook UI, show the manual review tab as
  `人工複核` instead of the longer `人工複核清單`.
- In Steel oral quick-price flow, `lookup_catalog_families` output should drive
  selected catalog keys into `lookup_quote_rules`; price discovery itself should
  stay broad through `productNames` and `erpItemCodes`, not `catalogFamilies`.
- For Steel `search_price_candidates`, inferred product-name/spec candidates use
  `productNames`, and exact item codes or code prefixes use `erpItemCodes`. The
  AI-callable tool input must not expose `productName`; keep `productName` only
  as an internal/source row field on returned price candidates. Do not put oral
  family/category labels such as `C型鋼` in `productNames`.
- If AI has several inferred reviewed product-name candidates for the same
  Steel price lookup, use `productNames` or `candidateQueries`.
  `productNames` is for same-filter multi-name search; `candidateQueries` is for
  per-candidate confidence/reason/spec fragments.
- When a user provides a customer name in the same quote request, first-round
  tools should allow `search_customers` alongside catalog lookup. The selected
  customer id/tier/name must be passed as `customerContext` to
  `lookup_quote_rules` before price lookup, so customer-scoped defaults/rules can
  be returned.
- If reviewed instruction/rule packets require `lookup_formula`, the provider
  loop must not accept a final Steel price answer after price lookup alone;
  retrieve reviewed formula rows first.
- Steel workbook completeness for multi-material quote lists must be AI-led.
  Backend code should not hard-code derived workbook rows for price sources,
  interpretation notes, ERP preview fields, or customer-facing rows. Provider
  orchestration may reject/remind incomplete `patch_quote_workbook` calls, but
  the model must generate semantic quote fields from workbook context and
  reviewed tool results; unavailable material/customer/source facts should stay
  blank and be explained in `manual_review` or `interpretation_notes`.
- Steel workbook patch completeness must also apply to follow-up turns that
  update an existing quote, such as `客戶是龍頂` or material confirmation. Do
  not gate completeness only on the latest user message containing price words;
  if AI patches quote/calculation cells, provider must still require explicit
  companion patches for the relevant workbook sheets.
- Steel workbook patch completeness must check per-turn sheet and minimum-cell
  coverage, not only whether each sheet id was touched. A patch that creates
  empty shell rows or updates only `報價明細` is incomplete if user-visible
  tabs such as `系統訂單`, `總結`, `人工複核`, and `給客戶用` still lack derivable
  values; provider should return `missingSheetIds`/`missingCells` to AI and let
  AI either patch derivable values or record missing evidence in review/notes.
- Steel AI workbook output should not expose direct `patch_workbook` operations.
  Use `patch_quote_workbook` only, so the model sends compact semantic data and
  backend projection handles synchronized cell operations without hitting the
  100-operation input cap.
- Do not add arbitrary size caps to Steel workbook output. `patch_quote_workbook`
  semantic input and internally projected workbook operations may need to cover
  long multi-material orders; validate shape and non-empty content, not a fixed
  maximum line/operation count.
- For Steel `系統訂單`, visible `型號` and `品名規格` must both match the adopted
  `search_price_candidates` price row: `systemOrder.modelCode` from
  `erpItemCode` / source `型號`, and `systemOrder.itemSpec` from `productName` /
  source `產品名稱`. Do not use oral material names, normalized names, catalog
  family keys, full C-section descriptions, length, or piece-count text for
  these two ERP fields.
- The first accepted data patch into an empty Steel workbook is initial data
  load, not a user-visible update: keep workbook version `v1` and return empty
  `changedPaths` so cells are not highlighted. Keep `changedFieldSummary`
  available for concise chat summaries; subsequent patches against populated
  workbooks increment the version and highlight changed cells.
- For Steel v8.3 Phase 2, do not schedule separate backend slices for material
  normalization boundary, customer resolver, candidate ranking hardening, stock
  allocation rule context, or calculation context serializer. AI owns
  judgement, candidate selection, and arithmetic; backend tools provide bounded
  reviewed rows/rule prompts and validate source scope, workbook shape, and
  subtotal consistency.
- `lookup_catalog_families` supplies admin-supplied product/category inference
  rules and reviewed vocabulary candidates when AI cannot infer enough from
  customer wording. It must guide AI toward catalog keys for later tools, not
  become a hidden backend resolver.
- `lookup_quote_rules` is the merged runtime tool for instruction packets plus
  quote defaults. Keep `lookup_instructions` and `lookup_defaults` as internal
  composition names only, not AI-callable runtime tools.
- `search_customers` should return customer candidates, tier context, and
  customer-specific reviewed rules/defaults. Backend should not hide a selected
  customer resolver decision from AI.
- For Steel tool rule responses, first implement database-backed read and
  association logic only. Similar product-name supplements, catalog/category
  rules, and customer-specific rules should be stored in DB-ready surfaces and
  returned to AI as related `rules`; Admin UI for managing those rows is a
  future planning slice.
- Steel product-name-specific inference rules belong behind
  `lookup_catalog_families`, not `lookup_quote_rules`. Database naming for
  Steel rule storage should consistently end in `rules`, and context docs must
  distinguish always-on Agent Instructions from retrieved task/customer/catalog
  rules.
- Steel Agent Instructions and workbook output policy rules share the same
  database surface, `steel.agent_rules`. Do not create a separate
  `workbook_rules` table; use `rule_type`, `rule_sections`, selectors, and
  optional sheet scope to distinguish workbook-facing instructions.
- Steel rule table semantics are: `steel.agent_rules` for process rules such as
  the initial default Agent Instruction and workbook output flow;
  `steel.catalog_family_rules` only for product-name/category inference;
  `steel.quote_rules` for catalog/category order-format techniques, specific
  calculation rules, and price calculation rules; `steel.customer_rules` for
  customer-specific specs.
- Before the Admin UI exists, Codex-driven Steel rule inserts/updates must
  resolve related database associations automatically. Choose the correct
  `*_rules` table by rule purpose, verify catalog/customer/tier/formula/sheet
  references against existing rows or code-owned workbook sheet ids, and update
  reviewed rows by inserting a superseding row plus invalidating the old row
  instead of mutating semantics in place.
- Steel drawing evidence prompt builders must not duplicate OCR interpretation
  strategy or fixed output/boundary policy that already lives in reviewed
  `steel.agent_rules` and existing provider context. Keep OCR accuracy and
  output-surface rules in Supabase-backed agent rules; the drawing prompt
  builder should only compose the DB-loaded OCR rules with the current user
  request so prompts do not drift.
- Steel quote conversations should have one `file_analysis_data` workspace per
  conversation/order, not one dataset per uploaded PDF/image. Multiple uploaded
  evidence files belong inside the same workspace, with each row carrying its
  source file/page/region metadata; the quote workbook remains a separate
  single order workbook.
- Steel OCR rules must teach AI to use `patch_file_analysis_data` for
  unconfirmed drawing/PDF/image interpretation, then summarize the patch in the
  visible response. Do not rely on provider code prompts to introduce this tool
  behavior; keep the instruction in the Supabase-backed OCR agent rule.
- Steel `file_analysis_data` UI manual editing should stay narrow: only the
  `file_analysis_data` sheet is user-editable, with cell edits, add row, and a
  small left-side delete-row icon. Keep a top status bar with version, source
  file count, draft/unsaved state such as `3 unsaved changes`, and Save/Saved
  control. Do not add row action toolbars, review-state controls, or manual
  editing for `manual_review` / `interpretation_notes`; those two sheets remain
  AI-patchable context for later turns.
- When reporting Steel OAuth verification, explicitly distinguish mocked Jest
  wiring smokes from live OAuth provider smokes. Do not call a mocked provider
  test "real OAuth"; live smokes must use a gated manual spec and call
  `openai_oauth_responses` with local OAuth auth material.
- Steel live drawing OCR smokes should keep image inputs at provider
  `imageDetail: high`, which AI SDK maps to the OpenAI Responses image
  `detail` field. Do not add separate OCR-effort env keys for this path;
  reasoning should come from the normal Steel OpenAI config.
- Steel OCR rule source files belong under `docs/rules`, not
  `docs/reference`; `docs/reference` is for examples/source data. Tests for OCR
  behavior should use the reviewed Supabase `steel.agent_rules` row whenever
  they exercise runtime OCR behavior, not read a local docs file as if it were
  runtime state.
- Steel OCR / vision business instructions must live in `docs/rules` and be
  synced to Supabase `steel.agent_rules`. Runtime code may compose DB-loaded
  rule text with current source metadata, but must not hard-code the OCR or
  visual-inspection prompt contract in TypeScript.
- Steel streaming route shells must not mount async handlers directly. Wrap
  `/api/steel/ai/chat/stream` so setup-time rejections return Steel JSON with
  `errorSummary`; otherwise Express falls through to the global
  `An unknown error occurred.` response and hides the actionable failure.
- Steel stream diagnostics must cover both the route shell and the final
  `ErrorController`. Errors from auth, body parsing, or other middleware happen
  before the Steel route wrapper and must still return Steel JSON
  `errorSummary` for `/api/steel/ai/chat/stream`.
- Local Steel `/steel/oauth-chat` currently sends attachment bytes in the chat
  JSON payload, so the Express JSON/urlencoded parser limit must be at least
  `50mb` until the UI is changed to upload files first and send only `fileId`.
- Steel OCR patch completion status must be driven by backend page progress,
  not a generic post-patch continuation message. When completed/failed/skipped
  page progress covers the PDF `pageCount`, do not emit or force another OCR
  continuation; persist the patch and let AI produce the final summary.
- Steel `file_analysis_data` source columns are backend-owned invariants:
  always persist fixed `檔案名` / `標記頁數` cells from `sourceRef` before any
  AI-defined material/spec/process columns. Do not rely only on OCR prompt text
  for these table headers.
- Steel stream errors must not expose a bare `terminated` summary. Classify
  provider/network early termination separately and return an actionable
  provider-termination explanation while preserving explicit `Steel tool ...`
  fatal errors unchanged.
- Steel OCR contract-only rule text updates do not need dedicated extra test
  logic. Update the reviewed OCR rule source and sync it to `steel.agent_rules`;
  use `git diff --check` for hygiene unless runtime code changes.
- Delete existing Steel rules contract checks when they directly inspect
  human-authored rule files or prompt wording. Keep tests for runtime behavior,
  schemas, tool calls, database readback, and public API contracts, but do not
  preserve wording-only rule contract specs.
