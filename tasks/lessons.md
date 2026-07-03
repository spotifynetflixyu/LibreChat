# Lessons

- When enabling S3 storage, update both the code/env path and the ignored
  runtime `librechat.yaml` source. Local/dev should use `fileStrategy: "s3"`
  plus `.env` `S3_KEY_PREFIX=dev`; the private production server uses
  `.env.prod` installed as `/etc/librechat/.env.prod`, and should use
  `fileStrategy: "s3"` plus `S3_KEY_PREFIX=prod` when sharing the bucket with
  dev/test.
- Production PaddleOCR preparation must not block LibreChat rollout. Do not keep
  a strict prewarm env or startup MCP smoke gate; AI Studio dependency failures
  should remain warnings while `/health` can recover.
- After deployment, use `/health` only to confirm the LibreChat site started.
  Run PaddleOCR smoke separately by passing the freshly obtained S3 smoke PDF
  URL as the smoke command argument. This checks both S3 URL readability and the
  PaddleOCR `fileUrl` OCR path.
- When switching LibreChat production file storage to S3, verify the running
  container with a server-side put/get/delete smoke test and log
  `[initializeS3]` before claiming uploads are backed by S3. Never print AWS
  secret values during this check.
- For PaddleOCR `fileUrl` downloads from private S3, use long enough
  presigned URLs for async OCR and retry windows. Current production standard is
  `S3_URL_EXPIRY_SECONDS=43200` for 12 hours, without making the bucket public.
- PaddleOCR MCP attachment resolution must prefer storage `getDownloadURL` for
  S3 current-request files and must not log the generated presigned URL.
  CloudFront should stay on the stream fallback unless signed URL mode is
  explicitly verified. Keep the existing owned-file DB lookup before
  resolution; never trust a request-supplied filepath directly.
- When PaddleOCR fails on the second image turn after the first turn completed,
  do not assume concurrent access. Check production logs for provider/network
  reset errors and verify with both same-client and fresh-process smokes before
  adding locks. Sequential reset handling should rebuild the PaddleOCR MCP
  connection and retry only the affected file once.
- Same-turn automatic PaddleOCR preflight output must be AI-visible as
  authoritative OCR evidence for the current file. If
  `attachments.currentPaddleOcrResults` contains the current file key, the
  runtime policy should tell AI not to call `read_markdown` or rerun
  `paddleocr_vl` for that file unless the user explicitly asks to rerun OCR or
  the result is absent/failed.
- Same-turn `attachments.currentPaddleOcrResults` must preserve the full
  PaddleOCR result. Do not token-limit or hard-truncate
  `toBoundedSteelPaddleOcrValue`; otherwise the AI sees incomplete OCR evidence
  and incorrectly calls `read_markdown` for the current file.
- Native Steel context must pass current file metadata into both
  `Steel Native File References` and
  `Steel Runtime Context.attachments.currentTurnFiles`; leaving runtime
  `currentTurnFiles` empty weakens the current-file OCR policy.
- Steel AI-visible tool output and tool-result memory must not hard-truncate
  strings, arrays, object keys, or nested JSON. Remove helpers such as
  `toBoundedJsonValue` and sanitizer caps; keep only safety redaction and
  circular-reference guards.
- OCR dedupe must be source-aware per file key. `ocr_extract` rows from
  assistant Markdown / AI OCR fallback are useful review state, but only
  active rows with `ocrSource: "paddleocr_mcp"` may skip future PaddleOCR
  preflight for the same `ocrFileKey`; PaddleOCR failures must not write
  completed OCR state so the next turn retries.
- `read_markdown(scope: "ocr")` must include active PaddleOCR preflight raw
  evidence as OCR evidence, labeled separately from assistant OCR Markdown, so
  compact-context recovery does not hide successful PaddleOCR output and cause
  duplicate OCR calls.
- PaddleOCR MCP input resolution must treat Steel/LibreChat `file:<fileId>`
  values as owned file-key aliases before calling MCP. Never pass `file:<id>`
  directly to `paddleocr-mcp`; it only accepts MCP-visible paths, URLs, Base64,
  or data URLs.
- PaddleOCR MCP `input_data` normalization should extract canonical supported
  tokens from model text instead of chasing individual AI-added prefixes.
  Recognize `data:`, `http(s)://`, `file:<id>`, raw file ids, and
  label-stripped forms such as `file_url:` or `source=`; resolve owned current
  files first, then pass supported direct URL/data inputs through. Direct local
  paths such as `file://...`, `/tmp/...`, `./...`, or `../...` must not be
  passed to PaddleOCR unless they only match an owned current file that the
  backend rewrites to a controlled URL/data URL.
- `read_markdown` should support per-file reads for both OCR and workbook
  state. Use aggregate OCR only to list available file keys / short evidence;
  fetch full OCR Markdown one file at a time with `ocrFileKey` to avoid
  truncation. For workbook, no `fileKey` means the combined current workbook;
  `fileKey` means multiple OCR files / text orders have separate workbook
  orders and only that file's rows should be returned. Text/manual/default
  workbook rows use the fixed `fileKey`/`ocrFileKey` value `default`.
- OCR Markdown table parsing must keep a structured OCR heading as the pending
  table title when metadata lines such as `file key: file:<id>` appear between
  the heading and table. Do not let metadata replace the OCR title or
  title-gated `ocr_extract` capture will skip valid fallback Markdown.
- If a user says a file's OCR state is fallback / assistant OCR, treat that as
  not PaddleOCR-complete even when it has the same filename or `ocrFileKey`.
  Edit-message resend must rerun PaddleOCR preflight unless there is active
  successful `paddleocr_mcp` preflight evidence for that exact file key.
- For chat.longdin.org bug reports, local `MONGO_URI` points at dev Mongo and
  cannot prove production conversation state. Treat production Mongo as a
  separate source; do not use a zero-row local query to rule out prod data.
- PaddleOCR preflight raw result is not `read_markdown(scope: "ocr")` data.
  Store and label raw automatic PaddleOCR output as `paddleocr_preflight`; only
  assistant-organized OCR Markdown confirmation tables are `ocr_extract`.
  Same-turn raw preflight may enter `attachments.currentPaddleOcrResults`, but
  follow-up turns should use `read_markdown(scope: "ocr")` only when organized
  OCR Markdown is missing from normal chat history.
- OCR preprocessing PDF chunk artifacts must be indexed by the original stored
  PDF's S3 file key/storage key, not by `conversationId`. Store split PDF chunk
  artifact metadata in a global registry so another conversation using the same
  original PDF can reuse existing chunk PDFs; conversation-scoped
  `paddleocr_preflight` / `ocr_extract` rows should only reference that source
  key as OCR evidence state.
- OCR preprocessing must not persist a second full merged OCR Markdown row.
  Store organizer output per chunk only; at runtime, read the chunk Markdown
  rows and merge them into exactly one main-agent OCR Markdown attachment for
  that PDF file key. Raw PaddleOCR chunk results and per-chunk Markdown arrays
  are intermediate evidence/resume state, not main-agent context.
- OCR preprocessing resume state has two DB-backed nodes:
  `paddleocr_preflight` raw chunk rows for PaddleOCR progress and
  `ocr_extract` chunk Markdown rows for subagent progress. On retry, continue
  from the first missing raw chunk if raw is incomplete, otherwise from the
  first missing organized Markdown chunk.
- `read_markdown(scope: "ocr")` must return all OCR Markdown automatically for
  preprocessing PDFs, with each file's merged all-chunk Markdown labeled by
  `<file_key>`. Do not require the agent to ask for individual file/chunk parts,
  and do not return raw PaddleOCR chunks as the default OCR read when organized
  chunk Markdown exists.
- When checking a user's Steel OCR count report, distinguish per-event activity
  `savedCounts` from aggregate persisted state. Verify production
  `steel_working_order_memory` by `memoryKind`, `ocrFileKey`, `fileId`, and
  `state` before concluding raw OCR results were merged or overwritten.
- OCR file-key behavior must update both runtime capture/UI and AI-facing rules.
  When changing multi-OCR grouping, update `docs/rules/其他規則/OCR規則.txt` and
  `docs/rules/輸出規則.txt` together so first-turn OCR Markdown and later
  `system_order` output follow the same file-key boundaries.
- Steel activity aggregate fixes must cover both AgentClient and Open Responses
  streaming. Final assistant Markdown capture events need to be emitted before
  `res.end()`; otherwise preflight activity can appear while final aggregate
  totals are saved but invisible in the same UI turn.
- Steel automatic PaddleOCR preflight must pass document preprocessing runtime
  params explicitly. `output_mode: "detailed"` alone does not guarantee
  orientation classification, unwarping, or layout detection are enabled.
- Manual PaddleOCR UI smoke must use a text-bearing image or PDF. Decorative
  icons such as favicons are only suitable for checking that a preflight tool
  indicator appears; they do not verify OCR content or useful PaddleOCR output.
- When adding chat timing UI, distinguish whole-turn elapsed time from
  individual tool-call duration. If the user asks for AI message timing, place
  it on the assistant name row with timestamp-like styling, `ml-2` spacing, and
  compact `s`/`m` labels unless they explicitly ask for per-tool timing.
- Future Steel native LibreChat work must start from
  `docs/steel-native-librechat-master-framework.md`, then use
  `docs/plans/2026-06-24-steel-global-native-librechat-integration.md` for phase
  execution. Do not infer architecture from older v8.3/OAuth/OCR planning docs.
- Steel native LibreChat research conclusions belong in the master framework
  `Research Conclusions Lock` and the implementation plan checklist, not only in
  conversation history or task logs.
- Native LibreChat reconstructs context from LibreChat Mongo message history
  plus LibreChat Memory, instructions, MCP, skills, files/RAG, tools, and
  pruning/summarization. Steel must extend that path, not replace it with
  provider-only state.
- Current native `useResponsesApi: true` is reconstructed Responses transport,
  not automatic provider-state continuation. `openai_responses_previous_response_id`
  requires explicit OpenAI `response.id` persistence, lookup, call-option
  injection, and fallback tests.
- Steel-enabled Open Responses is durable and LibreChat-managed, equivalent to
  `store:true`. Do not design a Steel `store:false` branch.
- LibreChat user Memory is distinct from Steel structured quote/workbook state,
  even when existing Steel service names contain `Memory`.
- Steel Markdown capture must run after assistant message persistence succeeds:
  use a native UI post-save hook around assistant `databasePromise`, and hook
  Open Responses `saveResponseOutput()` after `db.saveMessage`.
- LibreChat file records and permissions remain canonical. When Steel needs
  provider vision for drawings/images/PDFs, keep the native file/vision path
  intact. When Steel needs OCR/table extraction or durable drawing evidence,
  use PaddleOCR MCP OCR (`PaddleOCR-VL-1.6` / `paddleocr_vl`) directly, then
  reuse persisted assistant OCR Markdown/file-analysis state on follow-up
  turns by default.
- `/steel/oauth-chat` is dev-only for smoke tests and activity-log inspection.
  Product behavior must live in native LibreChat hooks.
- Normal LibreChat chat must support OpenAI OAuth API through the native Steel
  provider adapter, not through `/steel/oauth-chat`. Keep OAuth mode stateless
  and reconstructed with `responsesState: false`; preserve native stream,
  abort/resume, files/vision, tools, permissions, and message persistence.
- When the user says `一次問我所有問題`, batch all unresolved design questions
  with recommended answers instead of continuing a one-question-at-a-time grill.
- Steel native framework is global. Do not add modelSpec opt-in, ordinary-chat
  classifier, or Phase 1 runtime disable-switch logic; AI decides whether the
  Steel quoting workflow is relevant from the request.
- All Steel-related native modules must be globally open by default. Do not add
  Steel-specific role, capability, or permission gates for Steel rules, context,
  quote/OCR behavior, or read-only AI tools; keep only existing LibreChat-owned
  file, MCP, provider/model, and admin-setting checks.
- Do not add `librechat.yaml` Steel enablement/inclusion switches for the
  native framework. Reuse existing LibreChat YAML surfaces such as modelSpecs,
  endpoints, and permissions only when they already own the concern. Do not use
  `fileAnalysis.instructions` as a duplicate Steel OCR-policy source; reviewed
  Steel OCR/file rules are authoritative.
- For native Steel context ordering, every prompt prefix section must map back
  to `docs/rules/*.txt` synced through `steel.rules`. Use the compact order
  `agent`, `quote_rules`, `output`, `other`. Do not add prompt sections for
  runtime-only tool configuration, duplicate reviewed-agent aliases, or empty
  legacy instruction packets.
- Steel runtime tool exposure is executable backend configuration, not a prompt
  rule section. Keep AI-facing tool behavior in `docs/rules/*.txt` and
  `steel.rules`, but do not let txt/DB rows directly decide which executable
  tools are exposed; code-owned filtering must remain the final guard.
- Phase 1 native Steel context should carry LibreChat attachment
  metadata/references, not duplicate uploaded file bytes or base64 bodies in
  prompt text. This does not mean hiding files from the AI; attachments still
  pass through LibreChat's native provider file/vision pipeline when supported,
  and PaddleOCR MCP OCR must use the permission-checked file path when
  structured OCR/table extraction is required.
- `run_file_ocr` is obsolete and must not be AI-visible. Do not design
  LibreChat file loading/upload as automatic OCR plus prompt injection by
  default; the agent uses PaddleOCR MCP OCR directly when structured OCR/table
  extraction or durable drawing evidence is needed.
- Do not add runtime OCR workflow gates such as `ocrWorkflow` or
  `policy_blocked` for `/steel/oauth-chat` or native Steel provider flows. OCR
  PDF quote flow is prompt/rule-guided: first turn AI returns OCR form results,
  user confirms, second turn AI quotes from the confirmed OCR form. Runtime
  should not block tool calls for that reasoning flow unless the user explicitly
  changes this architecture.
- Standard LibreChat native chat already sends reconstructed chat history to
  the provider. Do not duplicate prior assistant OCR/quote Markdown in Steel
  runtime context or `additional_instructions`; runtime context may use history
  for rule selection and metadata, but prompt-visible assistant tables should
  travel through normal chat history only.
- LibreChat native Steel needs its own chat/runtime context preparation. Do not
  directly reuse `/steel/oauth-chat` `prepareChatContext()` or the generic
  `prepareSteelRuntimeContext()` as native prompt context. Native LibreChat
  context should contain information outside chat content: reviewed rules,
  tool policy, workbook/quote state, file/evidence references, request IDs, and
  metadata. Chat text and assistant OCR tables belong to LibreChat provider
  history.
- Steel workbook/quote state originates from assistant response Markdown that is
  auto parsed and saved. Native runtime context should carry Markdown-derived
  summary/index metadata, not the complete assistant Markdown tables. The full
  table contract remains the assistant Markdown in chat history; if token
  compression loses it, the agent should call a read-Markdown style tool to
  retrieve the parsed/saved quote or workbook content from the database.
- Keep `read_markdown` as the only AI-visible/read-only Steel tool for
  Markdown-derived workbook/OCR state recovery. Do not keep a separate
  active-workbook row keyword reader as provider-visible, executable, or
  back-compatible Steel tooling; lookup must be active-conversation scoped with
  optional `scope` only, not row keyword search.
- `read_markdown` must return Markdown text for the AI, not raw DB JSON. Its
  scope is only `workbook` or `ocr`: workbook includes strict workbook/quote
  sheets, while OCR is free-form drawing/text extraction evidence that the AI
  organizes into updated OCR tables. Do not expose `all` or standalone `quote`
  scopes.
- Steel structured storage for a LibreChat conversation is current-only for one
  workbook dataset and one OCR dataset. Overwrite operations should replace the
  current workbook/OCR data instead of retaining older overwritten versions as
  queryable history.
- A LibreChat conversation maps to one current Steel workbook and one current
  quote/OCR dataset. Do not design multiple workbook/quote datasets per chat or
  AI-selected dataset lookup. Table retrieval should be conversation-scoped by
  backend context; tool args may select scope, but not conversation id, row
  patch strategy, or semantic query. Assistant table updates must output the
  complete table. Auto parse/save should whole-table overwrite the current
  conversation dataset from that complete Markdown, not decide row-by-row
  delete/update/retain or merge partial row patches.
- Backend Steel auto parse is a table-page merge, not business reasoning. When
  the latest assistant Markdown includes complete tables, parse each recognized
  table and replace that corresponding workbook/quote sheet in the current
  conversation singleton; sheets not present in the latest response carry
  forward from the database. Do not infer row deletes/updates/retains inside a
  sheet.
- When the user confirms or corrects prior OCR/table content, the AI should not
  rerun PaddleOCR MCP OCR unless the user explicitly asks to rerun OCR or
  attaches new/changed file evidence. The AI should update the OCR/quote
  Markdown directly from chat history plus user corrections, return the
  complete latest OCR/quote table, and let backend auto parse/save update the
  conversation singleton.
- `read_markdown` is a recovery tool, not a per-turn default. The AI must first
  use LibreChat provider chat history when the needed OCR/workbook Markdown is
  present and complete enough; only call `read_markdown` when history was
  token-compressed, truncated, or lacks the complete Markdown needed for the
  update/quote.
- Delete duplicate Steel tools instead of hiding them when their function is
  replaced by native context or `read_markdown`. `lookup_quote_rules` should not
  exist because reviewed quote rules are injected into runtime context, and
  `read_working_order_items` should not exist because current workbook/OCR
  recovery is handled by `read_markdown`.
- `OpenAI (OAuth)` should be a first/default normal LibreChat provider-model UI
  choice for the native `openai_oauth_responses` path. Selecting it changes only
  provider/model transport; Steel tools, OCR, quote auto-parse, Markdown
  recovery, and runtime context must stay shared native Steel modules.
- OAuth usage remaining comes from the ChatGPT WHAM usage endpoint
  (`/backend-api/wham/usage`), not `/backend-api/codex/usage`. Fetch it
  server-side with the Codex OAuth bearer token, cache briefly, and sanitize
  before reaching the browser. Never expose OAuth tokens, account IDs, emails,
  auth file paths, or raw usage JSON in LibreChat UI/API responses.
- `OpenAI (OAuth)` must not replace or hide the original `OpenAI` API-key
  endpoint. Keep the OAuth provider first/default, but when `OPENAI_API_KEY` is
  absent the original OpenAI endpoint should stay visible through LibreChat's
  existing user-provided API key flow.
- When enabling the original `OpenAI` endpoint without a server
  `OPENAI_API_KEY`, update both the selector config and the runtime
  `initializeOpenAI()` key resolution. A visible user-provided OpenAI setting is
  incomplete unless runtime reads the saved Mongo `Key` record.
- For native LibreChat file-only Steel OCR turns, fix both UI affordance and
  submit pipeline. Enabling the send button is not enough because
  `useChatFunctions.ask()` rejects empty trimmed text; `useSubmitMessage()` must
  provide the default OCR review prompt before calling `ask()`.
- For native `OpenAI (OAuth)` chat, keep the SDK graph provider mapped to
  `openAI`, but attach the OpenAI OAuth override based on the original
  initialized agent endpoint/provider (`openai_oauth_responses`). If the
  override decision only checks the mapped SDK provider, the request falls back
  to the normal OpenAI client and fails without `OPENAI_API_KEY`.
- OpenAI OAuth native graph overrides must be real LangChain `Runnable`
  instances. Plain objects with `invoke()`/`stream()` fail when LibreChat pipes
  `AgentContext.systemRunnable`, and the override model must preserve that
  system context because LibreChat may invoke `overrideModel` directly after
  building the piped local model.
- After changing `packages/api` code used by the legacy `/api` backend, rebuild
  `@librechat/api` and restart the actual 3080 backend process before telling
  the user to retest `/c`. A green package test/build is not enough when the
  running `api/server/index.js` process still has the old module loaded in
  memory.
- OpenAI OAuth API calls have a 258K-token provider-side context ceiling before
  ChatGPT/OpenAI OAuth compression behavior can kick in. Native LibreChat token
  config and runtime context budgeting for `openai_oauth_responses` must not
  inherit the normal OpenAI `gpt-5.5` 1M+ model window.
- For Steel OCR and quote Markdown in native LibreChat, keep the existing chat
  layout but make table cells wide enough for ERP/OCR columns and rely on the
  message-level horizontal table scroller instead of squeezing text into narrow
  cells.
- When the user says database rules must align with `docs/rules`, compare
  canonical source refs/hashes against `steel.rules`, then use the existing
  `packages/api/scripts/sync-steel-rules.cjs` readback flow. Do not hand-edit
  individual rule rows.
- Do not let `OpenAI (OAuth)` title generation use the normal
  `run.generateTitle()` path. That path builds a fresh LLM from
  provider/clientOptions and does not use the OpenAI OAuth graph override. Route
  OAuth titles through the dedicated `generateOpenAIOAuthTitle()` helper so
  title calls use `openai-oauth-provider` and do not require `OPENAI_API_KEY`.
- Keep OpenAI OAuth transport/config/title/usage helper names free of the
  `Steel` prefix. Reserve `Steel` naming for quote/OCR/rules/runtime context,
  Markdown capture, auto-parse/save, and other steel-business modules. Existing
  `STEEL_OPENAI_*` env names may stay only as backwards-compatible fallbacks.
- Do not add `OPENAI_PROVIDER` to production env templates for OpenAI OAuth.
  LibreChat's frontend/provider selection owns the OAuth vs API-key distinction;
  production env should carry actual runtime values such as model defaults and
  `OPENAI_OAUTH_AUTH_FILE`.
- Production deployment env should use a real `.env.prod` file that remains
  ignored by git, with only root `.env.prod.example` tracked as the placeholder
  template.
- `ALLOW_REGISTRATION=false` should not be treated as blocking production admin
  bootstrap. Use LibreChat's trusted `create-user` script; in a clean MongoDB,
  the first registered user becomes `ADMIN`.
- When production deployment moves from a VPS/Lightsail host to Render, disable
  the host SSH redeploy workflow before pushing `master`. Render should own
  auto deploy from GitHub, use the generated `onrender.com` domain until a
  custom domain is added, and store uploads plus OpenAI OAuth `auth.json` on a
  writable Persistent Disk such as `/data`, not in the image or a read-only
  secret file.
- Render production setup docs must mirror the actual Render UI fields: leave
  Root Directory blank, set Docker Build Context Directory to `.`, Dockerfile
  Path to `Dockerfile.multi`, Docker Command to
  `sh /app/deploy/render/start.sh`, Health Check Path to `/health`, Pre-Deploy
  Command blank, and Auto-Deploy to On Commit. A 1 GB disk is acceptable for a
  low-cost smoke deployment, but the mount path must still be `/data`. Use
  Secret Files only as a temporary bootstrap copy source for `auth.json`; the
  final OAuth file must live on the writable disk.
- For low-cost Render Starter production, create LibreChat users from the local
  terminal with `.env.prod` loaded instead of running `create-user` through
  Render SSH. Use
  `DOTENV_CONFIG_PATH=.env.prod CONFIG_PATH=librechat.yaml node -r dotenv/config config/create-user.js ...`
  so the script connects to production MongoDB without pointing local config at
  `/data/librechat.yaml`, and never pass passwords as command arguments.
- Render auto-deploy only updates tracked code from `master`. Production
  runtime state must be documented as manual sync boundaries: paste `.env.prod`
  values into Render Environment, upload local `librechat.yaml` to
  `/data/librechat.yaml`, upload local `~/.codex/auth.json` to
  `/data/openai-oauth/auth.json`, configure SSH public keys in Render, and
  maintain MongoDB Atlas/Supabase state outside Render. Restart Render after
  replacing config or OAuth auth files.
- When Render Standard cost is rejected for production, switch the primary
  runbook to DigitalOcean Droplet instead of continuing Render-specific setup.
  Keep MongoDB Atlas and Supabase managed externally, use a user-owned domain
  such as `chat.<domain>`, run only the app plus Caddy on the Droplet, store
  production files under `/data` and `/etc/librechat`, and delay enabling a
  GitHub Actions SSH redeploy workflow until the Droplet, SSH key, and GitHub
  secrets exist.
- In the DigitalOcean Droplet compose stack, do not give the Caddy container
  the full app `.env.prod` file. Caddy only needs `LIBRECHAT_DOMAIN` and
  `PORT`; DB URLs, JWT secrets, OAuth paths, and app credentials should stay in
  the API container environment only.
- For the DigitalOcean production deploy workflow, prefer the job-scoped
  GitHub `GITHUB_TOKEN` for GHCR push and immediate remote pull before adding a
  long-lived `GHCR_READ_TOKEN`. Only introduce a PAT if package visibility or
  cross-repo ownership actually requires it.
- For Steel price lookup material simplification, only unify the query/tool
  input enum into simple material keywords such as `黑鐵`, `白鐵`, `錏`, `鋁`, and
  `鋅`. Keep import/storage canonical material values such as `No1 白鐵`,
  `BA 白鐵亮面`, `OT 黑鐵`, `錏/鍍鋅`, `鋁鋅`, and source cleanup behavior unchanged.
- Steel plate lookup must not relate `鐵板/鋼板` to `切工/切割` rows. Steel
  plate has no separate cutting price lookup; keep related `切工/切割` rows only
  for `鐵軌`/鋼軌, `H型鋼`, `工字鐵/I字鐵`, `角鐵/角鋼`, `槽鐵`, `平鐵/扁鐵`,
  `圓鐵/圓鋼`, `方鋼/方鐵`, `圓管/鋼管`, `方管`, and `扁方管`.
- For `search_price_candidates` with `category: "鐵板/鋼板"` and
  `material: "鋅"`, keep lookup broad because zinc-family plate data is sparse.
  Search by category plus material keyword only; do not also restrict by
  thickness or extra keyword terms.
- If Codex shell reports `node`/`npm` missing after the user upgrades Node,
  inspect `/Users/neven/.nvm/versions/node` and run verification with the
  current nvm bin path explicitly in `PATH`; do not assume the inherited shell
  PATH has already dropped the old Node version.
- Steel quote/native smoke fixtures must enforce the ERP `system_order` item
  numbering rule: material main items use 10, 20, 30, and attached processing
  rows use subitems such as 11, 12, 21, 22. Do not accept mock output with
  sequential 1, 2, 3 when verifying native context/rule sync.
- Mock E2E UI checks run against the production `client/dist` bundle served by
  the backend. After changing client code, run `npm run frontend` or
  `npm run e2e:prepare` before judging Playwright UI failures; a stale bundle
  can make frontend changes look broken even when backend SSE events are
  correct.
- When the user explicitly says Steel OCR should directly use PaddleOCR MCP and
  delete `run_file_ocr`, remove that name from AI-visible tools, executable
  Steel tool dispatch, runtime tool policy, and AI-facing rules. Keep
  assistant OCR Markdown auto-save and `read_markdown(scope: "ocr")` recovery
  as the durable database path.
- When rewriting Steel OCR rules after removing `run_file_ocr`, explicitly name
  PaddleOCR MCP OCR as the required parser for PDF/image text and table
  content. Do not replace it with vague provider vision or built-in OCR
  wording.
- Steel OCR rules that name PaddleOCR MCP are insufficient by themselves. Also
  register the PaddleOCR MCP server in `librechat.yaml` and ensure native Steel
  PDF/image turns inject the MCP server token before `loadToolDefinitions()`;
  otherwise the model falls back to provider file parsing and may report "No
  text could be parsed" without ever calling `paddleocr_vl`.
- PaddleOCR MCP can take longer on real drawing PDFs. Keep the LibreChat MCP
  server timeout and the direct Steel PaddleOCR helper default at 20 minutes
  (`1200000` ms) unless the user explicitly asks for a shorter timeout.
- Portal-based Markdown table modals must explicitly sync the active root theme
  class and `data-theme`; do not assume a body-level portal inherits the chat
  message theme scope.
- Markdown table modal cell colors need intentional review styling: use subtle
  row/header/pinned-column color variables with light/dark variants instead of
  plain inherited surface colors.
- In Markdown table modals, selected sticky columns should not change cell
  color; preserve row zebra color and use only a subtle divider/shadow for the
  pinned state. Zebra row contrast should stay low.
- Markdown table modal controls must reuse LibreChat's existing selector
  components such as `ControlCombobox`; do not ship native `<select>` controls
  that visually diverge from Agent Builder and prompt category selectors.
- Markdown table modal comment controls should use LibreChat shared UI
  components first: `Button` for icon actions and `Input` for compact text
  entry. Saved comments should render as inline text in the cell instead of a
  hover popup; fade the original cell value when an inline comment is present.
- Markdown table modal comment icon buttons belong in the cell's top-right
  corner. Reserve right-side cell padding so the icon does not cover text, and
  align the single-line comment input from that same right edge.
- Markdown table modal comment inputs must be viewport-aware. Do not anchor the
  editor with plain cell-relative absolute positioning; use LibreChat's existing
  Radix/Ariakit popover positioning patterns with collision handling.
- After moving a Markdown table comment input into a Radix Popover, blur-save
  must also handle popover dismiss paths such as outside click/onOpenChange.
  Test the outside-click path directly, not only a synthetic input blur.
- Markdown table modal column selector belongs on the left side of the toolbar;
  keep copy/download/close actions grouped on the right.
- Markdown table modals should widen columns with long body text, such as
  `備註`, instead of forcing all columns into similar widths that make review
  text wrap too aggressively.
- Markdown table modals should support Escape to close, with the keydown
  listener attached only while the modal is open and removed on close.
- When compact workbook is the only supported Steel runtime mode, remove mode
  inputs and tool-registry branches instead of keeping no-op `contextMode`
  parameters that imply a hidden full-mode path.
- Steel OCR rules are a fixed `otherGlobalRules` subset from `steel.rules`.
  Do not add `includeOcrRules`, attachment/evidence runtime gates, or a separate
  OCR rule loading path; load `otherGlobalRules` once and classify OCR rules by
  `rule_sections`. Attachments should stay metadata/evidence only.
- For file-only Steel OCR title generation, pass the uploaded filename and a
  simple title rule into the OpenAI OAuth title prompt. Do not add hard
  `preferredTitle` override logic; let the AI generate the final title from the
  filename and rule.
- Markdown table modal comments are pending next-turn user text. After a
  successful fresh chat submit, drain and clear the pending comment queue so the
  chat-input helper/count disappears, the `localStorage` backup is removed, and
  the next turn starts with zero pending comments; the submitted user message
  itself should visibly include the appended comment list. In that appended
  list, group comments by message/Markdown, because one message can contain
  multiple Markdown tables and each rendered Markdown table is one Markdown
  unit. A single table cell has at most one pending comment; editing the same
  cell replaces that comment, and blanking the input removes it. End the
  appended list with an instruction for the AI to output a separate complete
  updated table for each affected Markdown. Use the AI message timestamp plus
  Markdown index as the visible group label; do not show role.
- Pending Markdown table comments helper text can stay a concise grouped count,
  but hover/focus must show the exact Markdown block that will be appended to
  the next user message. Reuse the shared append formatter for that preview.
- Pending Markdown table comments must be backed by conversation-scoped
  `localStorage` until successful fresh submit. Do not tie restore behavior to
  the mounted chat input only; refresh/back-forward should restore the queue.
- LibreChat leave warnings are global and always on for browser unload, close,
  refresh, and external site navigation, but same-site route navigation such as
  `/c` to `/c/:conversationId` must not prompt. Do not condition browser unload
  warnings on pending Markdown table comments.
- When the user asks to open LibreChat for browser testing, provide the
  frontend dev UI at `http://localhost:3090/`. Backend
  `http://localhost:3080/` may serve static production output, but it is not
  the expected Vite dev URL for local UI testing.
- If native Steel OCR still falls back to "No text could be parsed", do not
  only inspect PaddleOCR MCP startup. Also verify the active request populated
  `req.steelNativeContext.currentTurnFiles`; uploaded PDFs may arrive as
  `application/octet-stream`, so filename extension fallback must keep them
  OCR-capable for PaddleOCR MCP injection.
- OCR output rules must forbid approximate drawing data. Dimensions, thickness,
  quantities, holes, diameters, and weights must be exact from OCR/source
  evidence; if unclear, output `未確認` or candidate values with low confidence,
  not `約`/`大約` values.
- For native Steel OCR, condition PaddleOCR MCP exposure on the current request
  carrying OCR-capable files, not on AI pre-judgment. Check
  `req.steelNativeContext.currentTurnFiles`, request attachments, body files,
  and body attachments with filename-extension fallback for
  `application/octet-stream`; do not inject PaddleOCR MCP on turns with no
  PDF/image evidence unless the user explicitly asks for always-on loading.
- PaddleOCR MCP process lazy-load must be enforced in the tracked MCP
  initialization path, not only in ignored local `librechat.yaml`. Before
  `createMCPManager()`, force the `PaddleOCR` server config to `startup:false`
  so startup keeps the server known but does not launch the stdio process.
- MCP server names may contain config-valid characters that provider tool names
  reject. Keep raw server names for MCP registry/config lookup, but sanitize the
  provider-facing MCP tool-name suffix to `^[a-zA-Z0-9_-]+$`; names such as
  `PaddleOCR-VL-1.6` must not be sent to OpenAI as-is.
- Production LibreChat MCP runtime config comes from host-managed
  `/data/librechat.yaml` through `CONFIG_PATH`, not repo `.mcp.json`. Treat
  `.mcp.json` as local Codex/MCP client config unless a task explicitly targets
  local MCP tooling.
- PaddleOCR has nested timeouts: LibreChat MCP `timeout` controls tool
  execution from LibreChat's side, while `PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT`
  and `PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT` control AI Studio calls inside
  `paddleocr-mcp`. For real drawing PDFs, raise both inner AI Studio timeouts;
  increasing only LibreChat's MCP timeout will not prevent `paddleocr_vl`
  `TimeoutError`.
- The current PaddleOCR MCP server key should be `PaddleOCR`; keep
  `PADDLEOCR_MCP_MODEL=PaddleOCR-VL-1.6` as the model setting. Do not reuse the
  model name as the LibreChat MCP server key.
- For PaddleOCR with `PADDLEOCR_MCP_PPOCR_SOURCE: "aistudio"`, do not prepare
  a host-mounted PaddleOCR Python environment at API startup. Keep API/local
  runtime aligned by launching `PaddleOCR` from `librechat.yaml` with
  `command: uvx` and `args: ["--python", "3.12", "--from", "paddleocr-mcp",
  "paddleocr_mcp"]`. The API image needs `uv`/`uvx` and Python availability;
  it does not need a separate local PaddlePaddle inference stack for the AI
  Studio provider path.
- Do not keep PaddleOCR source/provider branching when there is only one
  supported OCR API path. Production should require
  `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN`, model, and timeout settings only; do
  not expose a PPOCR source selector through user-editable `.env`. Hardcode
  `PADDLEOCR_MCP_PPOCR_SOURCE: "aistudio"` in the MCP env map and smoke
  transport env, instead of setting provider through CLI args or making it a
  separate operator config knob.
- PaddleOCR smoke must launch MCP from the same `librechat.yaml` server config
  used by LibreChat, including `command`, `args`, `env`, timeout, and token
  interpolation. Do not duplicate PaddleOCR MCP env assembly inside the smoke
  script; read `CONFIG_PATH` / `/data/librechat.yaml` and resolve
  `${PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN}` from the container env.
- Keep PaddleOCR smoke and resolver handling format-neutral. PaddleOCR supports
  PDF and image inputs such as PNG, JPG/JPEG, BMP, and CIF, so generic OCR code
  must not assume only PDF/PNG/JPG or bake a fixture-specific marker set.
- PaddleOCR API usage limits should be reflected in docs and operator guidance:
  after a model reaches its daily parsing limit, exceeded requests return `429`;
  there is no documented single-file size limit, but keep PDF inputs within 100
  pages to avoid timeout, and expect pages beyond the limit to be ignored.
- Do not expose `PADDLEOCR_UV_PYTHON_INSTALL_DIR` or reinstall toggles for the
  current AI Studio PaddleOCR path. Those controls only made sense for the old
  host-prepared Python environment approach; the current contract is a single
  `uvx` command in LibreChat MCP config plus the AI Studio token and timeouts.
- Do not bake a specific ignored drawing fixture, path, or expected marker set
  into generic PaddleOCR smoke code. The smoke script should only run live OCR
  when the caller passes a freshly obtained S3 smoke PDF URL as the command
  argument, and it should only check fixture markers when the caller provides
  `PADDLEOCR_SMOKE_EXPECT_MARKERS`. Do not make GitHub Actions production deploy
  gate on live PaddleOCR OCR; AI Studio API/network failures should not block
  LibreChat app rollout. Keep PaddleOCR smoke as a manual diagnostic.
- Do not assume AI Studio website OCR speed matches `paddleocr-mcp` AI Studio
  API behavior. On production, a simple tracked PDF completed through
  `paddleocr_vl` in about 214 seconds, while a larger drawing PDF returned
  `Error calling tool 'paddleocr_vl'` with aiohttp `ClientOSError: [Errno 32]
  Broken pipe` after several minutes.
- When production PaddleOCR fails from a VPS, distinguish upload from provider
  download. For `file_path` inputs, `paddleocr-mcp` multipart-uploads the file
  from the host to `https://paddleocr.aistudio-app.com/api/v2/ocr/jobs`; the
  provider is not downloading a URL. On DigitalOcean SGP1, a larger drawing PDF
  upload timed out before any OCR job id was returned.
- `fileUrl` is not automatically a fix for AI Studio from DigitalOcean SGP1.
  AI Studio can connect back to a Droplet-hosted file, but larger downloads can
  still return `HTTP 408 Request Timeout` and make the temporary file server log
  `BrokenPipeError`; use this as evidence for provider-side download/path
  instability before investing in file-url integration.
- S3 presigned URLs must be validated with a signed `GET`, not only `HEAD`;
  `GET` with `Range: bytes=0-0` should return `206 Partial Content`. Even a
  valid S3 `fileUrl` in `ap-southeast-2` did not make AI Studio accept a larger
  drawing PDF; the AI Studio submit request still timed out before returning a
  job id.
- For official AWS S3 production storage, do not add explicit path-style env in
  production examples or runbooks. Leave generic S3-compatible storage support
  in code, but keep AWS S3 Hong Kong config to region, bucket, credentials,
  optional endpoint, and `S3_URL_EXPIRY_SECONDS`.
- Do not reduce the AI Studio production issue to only large drawing PDFs.
  From DigitalOcean SGP1, a 296,377 byte `docs/reference/example/b.png`
  uploaded via multipart still timed out during write, and the same PNG through
  a valid S3 presigned `fileUrl` returned AI Studio `HTTP 400` code `10000`
  with `文件 URL 访问超时` when stored in AWS S3 Sydney `ap-southeast-2`.
- AWS S3 Hong Kong `ap-east-1` is the first confirmed working external
  `fileUrl` path for AI Studio from production: the same 296,377 byte
  `docs/reference/example/b.png` returned an AI Studio job id in about 15
  seconds, reached `done`, and produced a downloadable JSON result with a table
  block.
- Do not assume AWS S3 Hong Kong `ap-east-1` solves large files. The 7.6 MB
  drawing PDF tested from production was readable from the container via signed
  range GET, but AI Studio `fileUrl` submit returned `HTTP 408 Request Timeout`
  after about 70 seconds with no job id. Test smaller submit units before
  changing app architecture: compressed PDF, rasterized image, or split
  pages/images.
- Smaller PDFs can succeed through AWS S3 Hong Kong `ap-east-1` and AI Studio
  `fileUrl`: a 454,807 byte `d.pdf` returned a job id in about 19 seconds,
  reached `done`, and produced a 73 KB JSON OCR result with parsed table/text
  blocks. Treat file reduction as the first production design path before
  self-hosting OCR.
- LibreChat S3 file storage is a configuration switch, not the same as direct
  PaddleOCR `fileUrl` OCR. Setting production `fileStrategy: "s3"` plus
  `AWS_REGION=ap-east-1` stores new uploads in S3, but Steel OCR still resolves
  files to bytes unless the runtime is explicitly changed to pass S3 presigned
  URLs to PaddleOCR.
- PaddleOCR MCP tool calls must not rely on model-supplied relative filenames.
  Before calling `paddleocr_vl`, resolve filename-only
  `input_data` from the permission-checked current-turn LibreChat attachment
  records into a MCP-readable absolute/data input.
- PaddleOCR MCP tool calls must not trust provider sandbox paths such as
  `/mnt/data/<filename>` as API-container paths. Match path-shaped and
  URL-shaped `input_data` against permission-checked current-turn attachments
  first, then use the storage strategy so S3 files become backend-generated
  presigned URLs.
- AWS Console and presigned URLs percent-encode unicode object keys. This is
  normal URL encoding, not an S3 rename. When deriving an S3 key from a URL for
  `GetObject`, decode the URL path once; do not decode already-stored
  `storageKey` values.
- If the user confirms an S3 object exists but production logs show
  `NoSuchKey`, compare the exact logged key against the object key before
  blaming storage. A logged `%E...` key next to a Chinese filename usually
  means the server is using a URL-encoded path as the object key.
- When diagnosing PaddleOCR S3 `fileUrl` failures, smoke the exact URL shape
  generated by LibreChat's storage strategy, not only a hand-written clean
  presigned URL. AI Studio accepted the same private S3 object with a clean
  presigned URL but rejected a URL carrying response header overrides for the
  Chinese filename with `文件 URL 无法识别`; PaddleOCR handoff should use a clean
  signed S3 URL without `customFilename`/`contentType` overrides.
- When PaddleOCR MCP receives an invalid `input_data` shape such as a LibreChat
  `file_id`, fix the backend argument resolver instead of changing OCR rules,
  unless the user explicitly asks to revise rules.
- When the user scopes PaddleOCR upload constraints to frontend UI only, do not
  add backend validators, LibreChat YAML limits, or PDF page-count checks. Keep
  the change to file input affordances and client-side preflight validation.
- For Steel price lookup/import, `tierPrices` / `unit_price_a-b-c-f` are the
  only tier price fields. Do not add `tierRatios`, `ratio_a-b-c-f`, parser
  fields `ratioA-F`, or `比率A-F` schema mappings; source `比率A-F` columns are
  intentionally ignored rather than stored or exposed.
- `OCR 結果確認表` is OCR persistence, not workbook/quote state. Verify it via
  `steel_working_order_memory.memoryKind = ocr_extract`; only expect
  `working_order_row`, `steel_workbooks`, or workbook patches after the flow
  intentionally creates quote/workbook rows.
- OCR review turns may include extra tables for user confirmation, but those
  helper tables are not workbook state. Only save `ocr_extract` for OCR tables
  and only save workbook keys for intentionally emitted quote/workbook tables
  such as `system_order`; skip unclassified confirmation tables instead of
  storing them as `calculation_fact`.
- Assistant Markdown table auto-save is title-gated: save only OCR result
  tables whose nearby title contains `OCR`/`ocr`, and only workbook rows whose
  nearby title contains `system`. Keep using table structure as a second check,
  but do not save assistant Markdown tables from headers alone.
- S3 image uploads already have a dedicated Sharp preprocessing seam in
  `packages/api/src/storage/images.ts`: uploaded images are resized/compressed
  and saved as JPEG with `contentType: image/jpeg`. Keep generic S3 CRUD
  changes format-neutral, and do not duplicate image conversion logic in
  `packages/api/src/storage/s3/crud.ts`.
- Steel activity UI should not show successful `parse_status: saved` rows such
  as `Steel form parsed`; those are internal parse status, not user-facing work
  results. Show the `Total` aggregate and actual save/preflight rows instead;
  keep partial/skipped parse status visible because they need user attention.
- Resumable assistant-message elapsed timers must be anchored to the
  server-side generation job `createdAt` value. Do not let a reconnecting
  browser rebuild resumed user/assistant placeholders with `new Date()` or
  `Date.now()`, or the visible running time will restart from zero after
  cross-device resume.
- When the user says not to commit after a bug fix, keep the working tree
  uncommitted and report the dirty files/status in the wrap-up. Do not stage,
  commit, or push unless they explicitly ask afterward.
- OCR preprocessing chunk work must be durable and idempotent per file key and
  chunk identity. Save organized chunk Markdown immediately after each
  subagent pass, and on resubmit resume from persisted `paddleocr_preflight` and
  `ocr_extract` state instead of rerunning OCR, organizer subagents, or
  parse/save for completed chunks.
- OCR preprocessing must merge same-file-key chunk Markdown into one final
  Markdown string before adding OCR content to main-agent
  `additional_instructions`; per-chunk Markdown rows are durable intermediate
  state, not main-agent context.
- OCR rule version is part of OCR organizer output validity. If the OCR rule
  version/hash changes, reuse raw `paddleocr_preflight` chunks but rerun every
  subagent organizer chunk and rebuild the final merged OCR Markdown before
  starting the main Steel agent.
- OCR preprocessing must not rasterize PDFs into PNG/JPEG chunks. Split PDFs by
  page range into PDF chunks, such as pages 1-50 and 51-100, so PaddleOCR can
  still see embedded PDF text/vector content.
- OCR preprocessing merged Markdown must tolerate different headers across
  chunks. Union headers in first-seen order, keep all rows, and leave missing
  cells blank instead of inferring values.
- OpenAI OAuth organizer smokes should not assume OAuth is unavailable just
  because dev `.env` does not set `OPENAI_OAUTH_AUTH_FILE`. On this machine,
  the default npm/OpenAI OAuth token path may be valid; use the default resolver
  unless the user explicitly asks to override it.
- OCR preprocessing organizer/subagent failures and PaddleOCR provider failures
  must surface as chat request errors, not only as partial activity state. Emit a
  UI-visible redacted activity error, then throw a redacted error so the chat
  message shows the concrete failure.
- Direct AI calls to the PaddleOCR MCP tool must follow the same raw-to-Markdown
  contract as automatic preflight. Store raw output as `paddleocr_preflight`,
  organize it into `ocr_extract` chunk Markdown, and return only merged
  `<file_key>` OCR Markdown to the agent context.
- OCR preprocessing has two durable resume nodes: PaddleOCR/preflight raw data
  and organizer/subagent Markdown. After all PaddleOCR chunks finish, re-read
  preflight state from DB for organizer input; after organizer chunks save,
  re-read Markdown state from DB for runtime merge.
- For PDFs under the 50-page chunk size, skip only the PDF splitting/uploading
  step. Still create a single `1/1` chunk identity and run the same
  PaddleOCR -> organizer/subagent Markdown -> returned merged Markdown flow.
- OCR preprocessing progress is only useful if the frontend keeps every event.
  Add new Steel activity sources to the SSE allow-list, include `message` in
  the dedupe key, preserve `errorMessage`/`failedKeys`, and render
  `ocr_preprocessing` labels verbatim instead of mapping them to generic
  PaddleOCR text.
- Stop/preflight cleanup must treat a generated UUID/stream id as a real
  conversation id even before the backend `created` event arrives. Once the
  optimistic user message is hydrated under that id, abort/404/error cleanup
  must not remove the sidebar row or navigate back to `/c/new`; preserve the
  user message, persist it from the abort endpoint when needed, and only clean
  true `new`/`pending` placeholders.
- Preflight abort persistence must seed a complete displayable user message in
  `GenerationJobManager` metadata before client initialization finishes. Include
  uploaded file metadata such as `file_id`, `filename`, `filepath`, `type`, and
  `bytes`, while excluding raw file text/OCR content, so refresh after Stop
  still renders the original PDF chip.
- OCR PDF chunk artifact reuse requires both a DB row and a successful S3
  existence check for that row's storage key. Only then show `Fetched pdf
  chunks`; if the S3 object is missing, regenerate and upload the chunk PDF and
  keep the progress event on the uploaded path.
- OCR preprocessing must use one unified PaddleOCR flow for PDF chunks,
  under-50-page PDFs, images, and whole-file inputs. Treat image/whole-file
  inputs as a single `1/1` chunk and run raw PaddleOCR -> organizer/subagent
  Markdown -> official OCR Markdown; do not keep a separate generic
  PaddleOCR event or generic raw-save path.
- Official OCR Markdown is the only `read_markdown(scope: "ocr")` data.
  Subagent chunk Markdown and PaddleOCR raw rows are resume/progress state only,
  and AI-agent OCR Markdown must not be promoted to official PaddleOCR OCR
  Markdown unless it came through the PaddleOCR preprocessing pipeline.
- Official OCR Markdown needs an OCR source distinction. PaddleOCR-derived
  official rows may skip future PaddleOCR preflight for the same file key, but
  AI OCR-derived official rows must remain readable OCR Markdown only and must
  not satisfy the PaddleOCR preflight skip check.
- Multi-file official OCR Markdown should not be a single replace-all
  `default` bucket. Store each multi-file OCR result as its own active row with
  `ocrFileKey: "default"`, `ocrFileKeys`, and a stable `ocrGroupKey` derived
  from the covered file key set, so later OCR for a different file set does not
  overwrite completed OCR Markdown.
- Multi-file OCR turns must be batched by message phase, not run as independent
  full per-file pipelines. First build every file/chunk identity, then run
  PaddleOCR for all missing chunks, then organizer/subagent Markdown for all
  missing chunks, then pass merged per-file OCR Markdown attachments to the
  main agent together.
- When the main agent returns multiple PaddleOCR-derived official OCR Markdown
  tables that each match a file key or filename, save each official Markdown
  under that matched file key. Use the `default` multi-file grouping only for
  genuinely integrated OCR Markdown that cannot be attributed to one file.
- OCR preprocessing resume tests must prove file-key isolation, not just
  generic retry. Cover multi-file partial progress where one file resumes from
  saved PaddleOCR raw data while another file still runs PaddleOCR, and verify
  DB reads are scoped by both `ocrFileKey` and `sourcePdfKey`.
- Organized subagent chunk Markdown is progress/resume state. Its save counters
  should stay `ocr_preprocessing_chunk_markdown`; do not count it as official
  `ocr_markdown`/OCR table output until the main agent returns official OCR
  Markdown.
- OCR preprocessing chunk size must have one config source. Use
  `STEEL_OCR_PREPROCESSING_CHUNK_SIZE_PAGES` with fallback `50` through the
  shared OCR config helper, and pass the resolved value into ToolService chunk
  planning instead of scattering literal `50` values in runtime code.
- When simplifying OCR preprocessing tests, remove old single-file pipeline
  compatibility adapters. ToolService tests should mock the current batch
  contract (`files: [...]` -> `{ files: [...] }`) so test fixtures do not hide
  production shape drift.
- For large-PDF OCR preprocessing, check existing official OCR Markdown and
  complete organized chunk state before downloading/counting the PDF. Resume
  state can skip expensive file IO when the batch pipeline only needs to emit
  merged Markdown events.
