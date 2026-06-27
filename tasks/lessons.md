# Lessons

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
  route permitted file bytes/metadata through `run_file_ocr` backed by
  PaddleOCR MCP (`PaddleOCR-VL-1.6` / `paddleocr_vl`), then reuse persisted
  OCR/file-analysis state on follow-up turns by default.
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
  and OCR/tool byte access uses the permission-checked file path.
- `run_file_ocr` is an AI-visible Steel tool. Do not design LibreChat file
  loading/upload as automatic OCR plus prompt injection by default; the agent
  calls the tool when structured OCR/table extraction or durable drawing
  evidence is needed.
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
  call `run_file_ocr` again unless the user explicitly asks to rerun OCR or
  attaches new/changed file evidence. The AI should update the OCR/quote
  Markdown directly from chat history plus user corrections, return the complete
  latest OCR/quote table, and let backend auto parse/save update the
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
- For file-only Steel OCR title generation, pass the uploaded filename and a
  simple title rule into the OpenAI OAuth title prompt. Do not add hard
  `preferredTitle` override logic; let the AI generate the final title from the
  filename and rule.
