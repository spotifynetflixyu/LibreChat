# Phase 0: v8.3 Decision Baseline

Goal: lock the decisions that would otherwise cause rework in schema, import, source upload policy, workbook, export, quote resolution, and Steel AI provider orchestration.

This phase is documentation-first. Do not build production endpoints beyond scaffolding until these decisions are reflected in the implementation plan and `tasks/todo.md`.

## D0.1 Guest Mode

Decision: Guest mode is controlled by `STEEL_GUEST_MODE=true|false`.

Default: `false`. Guest quote access is enabled only by the explicit value `STEEL_GUEST_MODE=true`; absent or invalid configuration fails closed.

Access contract:

- `STEEL_GUEST_MODE=true`: Steel quote conversation/workbook/export access requires no login and no role permission. Guest access still uses a conversation-scoped token for returning to the same workbook/export.
- `STEEL_GUEST_MODE=false`: Steel quote conversation/workbook/export access requires a logged-in LibreChat user plus an admin-approved Steel permission.
- Steel Admin pages, source management, import, memory review, and instructions remain admin-only in both modes.

Exit criteria:

- Tests cover both enabled and disabled modes.
- Admin routes remain unavailable to guest users regardless of mode.
- Guest token is stored only as a hash.

## D0.2 Steel AI Provider And State Contract

Decision: Steel AI execution goes through a `SteelAIProvider` interface. The default driver is `openai_oauth_responses`; the capability-gated secondary driver is `openai_api` backed by `OPENAI_API_KEY`.

Confirmed baseline:

- openai-oauth /v1/responses is a provider runtime, not a replacement for LibreChat auth, roles, conversations, files, Admin shell, Steel tools, repositories, calculators, workbook validation, or audit.
- Research on `EvanZhouDev/openai-oauth` confirms two surfaces: `openai-oauth-provider` direct Vercel AI SDK provider and the `openai-oauth` local HTTP `/v1` proxy. v8.3 implementation uses direct `openai-oauth-provider` as the only coded runtime path after AI SDK package versions are unified through overrides/resolutions and LibreChat packaging is verified; the local HTTP proxy remains a manual local-dev smoke probe only.
- LibreChat UI / preset / agent model parameters remain effective requested runtime settings. Steel must translate them into provider-neutral runtime options and must not silently ignore enabled settings.
- `openai_oauth_responses` is stateless full-history. Any provider IDs are runtime trace only; they are not official OpenAI Conversations API state and are not the business source of truth.
- `openai_oauth_responses` must not send `previous_response_id` or `item_reference`; unsupported or proxy-dropped runtime settings are recorded in provider metadata.
- The `openai_api` driver is Responses-first. Official OpenAI Responses / Conversations state is used only by the `openai_api` driver, and Responses-only settings must not downgrade to Chat Completions.
- When the `openai_api` driver uses official Responses API conversation state, it passes `conversation` and does not pass `previous_response_id` in the same request. Previous response IDs are audit/fallback metadata only.
- Do not use `STEEL_FALLBACK_REQUIRE_CAPABILITY_PASSED` or `STEEL_FALLBACK_ON_*` flags in active v8.3 docs or code. If the workflow uses the API driver, that is an explicit `openai_api` driver decision.
- Provider unsupported / fallback messages appear inside the chat transcript as small warning text, not as toast UI.
- Chain recovery never relies on fetching historical conversation text from a provider. Prompt bundle reconstruction uses LibreChat messages, `steel_conversation_meta`, current workbook state, context refs, active sources, instructions, and memory.
- Every provider run stores bounded metadata in `steel_ai_runs`: requested provider, effective provider, requested/effective settings, unsupported settings, provider session/conversation/response IDs when available, selected model, token usage when available, context refs, tool call IDs, attached file refs, fallback reason, typed error category, and error summary.
- Reconfirm current OpenAI SDK/API types immediately before implementing the `openai_api` driver because Responses API event and file/vision shapes can change.

Exit criteria:

- The implementation plan assigns live provider smoke tests to Phase 3, not Phase 0.
- Phase 3 records at least one openai-oauth responses live smoke and at least one official OpenAI API fallback live smoke.
- The Phase 3 run plan records provider IDs, requested provider, effective provider, selected model, token usage when available, context refs, tool call IDs, fallback or unsupported reason, and typed provider error categories.

## D0.3 Workbook Line Pricing Traceability

Decision: Workbook quotes persist accepted line-level pricing calculations as permanent workbook data.

Each priced workbook line saves:

- Related formula code/version.
- Calculation basis.
- Database default unit price used as the starting value.
- Quoted unit price.
- Line total.
- Adjustment source and reason.
- Price source refs and weight source refs.

Rules:

- Database unit price is the default only for new pricing or explicit recalculation.
- Existing workbook prices, quantities, and totals are never changed unless the user requests a change for that specific line.
- If user changes unit price, line total is recalculated by formula.
- If user changes line total, quoted unit price is recalculated by formula.
- Export uses persisted workbook line values, not fresh price lookup.

## D0.4 ERP Codes And Admin Import Keys

Decision: v8.3 Admin data updates are based on admin-uploaded ERP export XLSX files. Parser output is matched against old data, reviewed, confirmed, and then committed to the database.

Target schema direction:

- Customer imports use `ERP Customer Code` as the stable lookup key when the ERP export provides it.
- Price item imports use `ERP Item Code` plus customer tier when the ERP export provides those keys.
- Rows without confirmed ERP keys become `needs_review`, not guessed updates.
- Existing old field names in the initial schema should be treated as migration cleanup candidates when they conflict with ERP import language.

Exit criteria:

- Mapping profile schema records target table, lookup key fields, delete marker policy, source file type, sheet/header metadata, and required fields.
- Admin import can be built first for one confirmed ERP-export target table.
- No plan text requires a direct external connector.

## D0.5 Retrieval Strategy

Decision: Build Steel retrieval in `packages/api/src/steel/retrieval` on Supabase PostgreSQL + pgvector.

Required filters:

- project id
- source status
- source version status
- chunk status
- source type/category
- guest/public access

MVP note: Phase 3 can proceed with reviewed database lookup tools even if full retrieval is deferred to Phase 6.

## D0.6 Customer Quote Sheet Mask

Decision: Customer-facing Excel uses an explicit backend-owned allowlist and hides customer tier/internal fields.

Allowed customer row fields:

- item name
- spec
- quantity
- unit
- unit price
- subtotal
- customer-readable note
- pending confirmation prompt

Blocked fields:

- customer tier / customer grade
- internal cost
- margin
- source refs
- search terms
- candidate items
- rejected candidate reasons
- admin notes
- AI interpretation notes
- internal low-confidence reasons
- formula/debug fields

Exit criteria:

- Export engine owns allowlist in code.
- AI cannot choose export fields.
- Tests prove blocked fields are absent from customer export.

## D0.7 Admin Upload And Handbook DOCX Policy

Decision: ongoing Admin formal data import accepts ERP-exported XLSX uploads. Steel handbook DOCX handling is a development-stage reference for designing the real Steel schema/data model: a code agent should inspect/organize the DOCX contents to define the first-pass schema/data model, while real handbook data SQL/import implementation is deferred until a later code-agent data task uses corrected source concepts. It is not an Admin web upload path, reusable parser, product runtime module, or immediate production-data import. There is no Admin PDF parser and no in-product transformation from PDF/image files into importable files.

ERP XLSX import workflow:

```text
Admin chooses source type / target table
  -> Admin uploads ERP export XLSX
  -> backend parses preview rows
  -> backend compares parsed rows with old data
  -> Admin previews/edits/confirms
  -> merge table
  -> validated Supabase transaction
```

Steel handbook DOCX schema-design workflow:

```text
Code agent inspects/organizes handbook DOCX contents
  -> identify needed spec/rule/weight/source fields
  -> use corrected source concepts when discussing importable data/SQL later
  -> update first-pass schema/data model and migrations if needed
  -> defer real data SQL/import implementation
```

Rules:

- Admin web import does not need a DOCX upload path for ongoing updates.
- DOCX is reserved for Steel handbook schema design unless a later decision explicitly promotes a new DOCX source type or real data import task.
- PDF, scanned PDF, image PDF, screenshots, image files, `.txt`, and DOCX are rejected at the ongoing Admin ERP import upload boundary.
- Rejected Admin files do not create source versions, parsed rows, merge rows, or formal database writes.
- If the business has PDF or text source material, it must be prepared outside this system as an approved XLSX import or handled as a separate development data-model/import decision.
- PDF/image files may still appear as low-confidence quote conversation evidence, but that evidence is not a formal Admin data source.
- ERP XLSX parsed data is the formal ongoing Admin Import input.

## D0.8 Async Boundary

Decision: Keep MVP operations synchronous until measured file size or request time requires a queue.

Rules:

- Build the minimal Chat Workspace and Workbook Preview with shared API mock data in `packages/data-provider/src/steel/mock/` before real handbook data import.
- Keep API mock fixtures behind the explicit mock path; do not re-export them from `packages/data-provider/src/steel/index.ts`.
- Prove real provider chat can create a customer-visible seven-sheet workbook before moving to Phase 4, with one openai-oauth responses smoke and one official OpenAI API fallback smoke.
- BullMQ infrastructure comes later.
- Small workbook generation, small import fixtures, and the first quote vertical slice stay synchronous with payload limits and timeout expectations.
- Source reindex, large XLSX parse, and large workbook export can move to Phase 6 jobs.

## D0.9 Excel Rendering Library

Decision: Use ExcelJS deliberately for workbook export rendering.

Rules:

- Add ExcelJS intentionally to the backend package that owns export rendering.
- Use ExcelJS for workbook sheets, formatting, filters, frozen headers, selected-sheet export, and future streaming export.
- Keep `xlsx` for Admin import parsing and generated workbook read-back tests unless implementation proves consolidation is better.
- Phase 4 is staff workbook export from `/steel/oauth-chat`: do not add customer
  masking, customer/internal download splitting, or a dedicated system-order
  export action. Customer-specific export restrictions belong to a future
  customer workbook format.

## D0.10 Fixed Workbook Sheets

Decision: Every quote workbook has seven required sheets.

Required sheet IDs:

- `quote_details` / 報價明細
- `summary` / 總結
- `manual_review` / 人工複核清單
- `price_sources` / 價格來源
- `interpretation_notes` / 判讀備註
- `system_order` / 系統訂單
- `customer_quote` / 給客戶用

Exit criteria:

- Workbook JSON schema requires these sheet IDs.
- Excel export tests assert all seven sheets exist.
- Selected-sheet export tests assert arbitrary selected sheet sets can be
  downloaded without special-case customer or system-order restrictions.

## D0.11 Price Before Weight

Decision: Quote resolution searches product/processing prices before using weight/spec sources for pricing.

Rules:

- Unless the user explicitly provides a unit price, every material or processing item must search formal price data first.
- Handbook-informed schema and Admin-imported XLSX data can support weight, standard dimensions, and source refs; real handbook data SQL/import is deferred.
- Handbook weight cannot be used to invent material sale price.
- Missing price is `未確認`, never `0`.

Exit criteria:

- Eval harness includes price-first cases.
- Subtotal validator tests separate confirmed totals from low-confidence
  estimated or unconfirmed totals.

## D0.12 Steel Eval Harness

Decision: v8.3 requires an eval harness before broad beta.

Minimum evals:

- Text order parsing.
- Provider capability/fallback classification for unsupported tool, file, vision, and XLSX paths.
- Customer search with customer-specific rules.
- Multi-key price search.
- AI price candidate selection from bounded options.
- Price-before-weight.
- Processing/cutting rule prompt application.
- Workbook subtotal validator.
- Admin upload policy rejecting files that are not ERP XLSX.
- Admin preview validation.
- Seven-sheet export.
- Arbitrary selected-sheet export.

Exit criteria:

- Evals run from `packages/api/src/steel/evals`.
- Reports identify failing case, assertion, expected value, and actual value.

## D0.13 Workbook Contract Ownership

Decision: Steel workbook public DTOs live in `packages/data-provider/src/steel/workbooks.ts`, while backend canonical runtime validation lives in `packages/api/src/steel/workbook/schema.ts`.

Rules:

- Public DTOs for Workbook JSON, workbook patch request/response, selected workbook refs, changed paths, and changed-field summary items live in `packages/data-provider/src/steel/workbooks.ts`.
- Conversation message request types may live in `packages/data-provider/src/steel/conversations.ts`, but must reuse workbook DTOs rather than redefining selected-cell or patch metadata shapes.
- API mock data under `packages/data-provider/src/steel/mock/` must be typed against the public DTOs.
- Backend Zod schemas in `packages/api/src/steel/workbook/schema.ts` are the canonical validation authority for workbook JSON, selected workbook refs, changed paths, patch responses, and patch summary items.
- Frontend code consumes shared DTOs and API responses; it does not own or duplicate workbook validation schema.
- Backend validation can be stricter than public DTO types when enforcing access, workbook version, allowed sheet/column paths, formula consistency, protected fields, and patch concurrency.

Exit criteria:

- Data-provider tests cover DTO shape and mock fixture compatibility.
- Backend workbook tests prove invalid DTO-shaped payloads still fail Zod/service validation when they violate runtime rules.
- Client tests import DTOs/API hooks and do not define an independent workbook schema.

## D0.14 Chinese Source Schema Mapping

Decision: Reference materials under `docs/reference` are Chinese source inputs. Before they inform spec tables, price tables, formula tables, processing-price tables, tools, AI API prompt context, or database queries, DB-bound fields must pass through `tasks/v8.3/source-schema-mapping.md`, an agreed mapping from Chinese source labels/headers/terms to English canonical schema keys.

Rules:

- Programmatic DB/query contracts use English canonical identifiers: SQL column names, repository filters, tool argument names, DTO fields, and API response keys.
- Chinese source labels are preserved as data values where useful: display labels, source labels, aliases, original text, search terms, and audit/source references.
- The mapping artifact records at least Chinese source label/header, English canonical key, target database surface, type/unit, normalizer, and source reference.
- Mock data shaped from `docs/reference` must use English DTO/API keys even when the visible workbook label or source text is Chinese.
- The mapping may be used to design the real Supabase schema/data model; it is not limited to mock data.
- No separate `review_status`, `corrected_text`, or typo approval workflow is required in the mapping artifact; by the time importable data/SQL is generated, code-agent discussion should already use corrected business concepts.
- The implementation plan must include a code-owned source-schema mapping module, initially designed as `packages/api/src/steel/schema/mapping.ts`, plus focused tests.
- AI API prompt/tool orchestration must receive a compact mapping context so it can map Chinese source/customer wording to existing canonical keys.
- AI may propose mapped keys in structured output, selected workbook refs, workbook patches, and tool arguments, but backend validation remains authoritative and rejects unknown keys.
- Do not translate or infer schema fields ad hoc inside query code; repositories and tools query by English canonical keys/columns.
- This does not require translating every product/customer-facing value to English. Product names, aliases, ERP workbook sheet labels, and source excerpts may remain Chinese data.
- ERP workbook sheet names stay Chinese and are not translated into database schema keys.
- `docs/reference/公式編號 - Sheet1.csv` is a formula naming/structure reference; runtime calculator data should come from reviewed app-ready JSON or database rows.

Exit criteria:

- Phase 2 produces or updates `tasks/v8.3/source-schema-mapping.md` before schema/mock-data assumptions are treated as stable.
- Phase 2 designs the code version of the mapping and its AI API serialization contract.
- Repository/tool/prompt tests use English field names for filters and assertions while covering Chinese aliases/source values as data.
- The plan contains no requirement for Chinese database column names, DTO keys, or tool argument keys just because the source docs are Chinese.

## D0.15 Driver Capability, Model Selector, And Fallback Gates

Decision: model availability and runtime routing are backend-owned. The Steel Workspace model selector reads a backend allowlist with driver capability status; it does not expose LibreChat's global provider list directly.

Rules:

- Default driver is `openai_oauth_responses`.
- Secondary API driver is `openai_api`.
- Fallback means selecting/routing to `openai_api` instead of the default OAuth driver; it is not model fallback.
- Do not use a per-capability `STEEL_FALLBACK_*` env matrix in active v8.3 docs or code.
- Active OAuth Responses model support is `gpt-5.5` only; `gpt-5.4` and lower models are unsupported.
- openai-oauth responses token material is stored server-side or in a local encrypted development file. It is never stored in frontend localStorage.
- Capability support is code-owned for Phase 1. Do not build a new Admin UI for capability smoke; record `openai_oauth_responses` + `gpt-5.5` support and reuse `/steel/oauth-chat` file-support evidence.
- Pure text and already-smoked backend tool workflows may prefer openai-oauth.
- File, vision, spreadsheet, and hosted-tool workflows use the backend support matrix and typed errors. If a workflow must use the API driver, that is an explicit `openai_api` driver decision, not a per-capability fallback env.
- `check quota remaining` is not an openai-oauth driver requirement. OAuth usage display is limited to subscription driver status, recent errors, and fallback status.
- API fallback is usage-based, not unlimited. It must handle rate limits, usage limits, budget, billing, API-key, and project-policy errors.
- Failed driver capabilities return typed errors such as `provider_tool_call_unsupported`, `provider_file_input_unsupported`, `provider_vision_input_unsupported`, `provider_xlsx_input_unsupported`, and `provider_hosted_tool_unsupported`.
- Do not add separate DOCX, PDF, XLS, model, or per-capability fallback keys.

Exit criteria:

- Phase 1 contract/schema work includes driver enum, capability result shape, model option shape, provider run metadata, and typed provider error categories.
- Phase 3 provider implementation includes injectable openai-oauth and OpenAI drivers, typed unsupported errors, explicit API driver routing where needed, and unified `SteelAIEvent` translation.
- Checkpoints require openai-oauth responses live evidence and any approved OpenAI API driver evidence before Phase 4.

## Phase 0 Lock Review

Status: locked after openai-oauth-responses-primary v8.3 replan.

Approved decisions:

- Phase 0 is closed with D0.1-D0.15 as the decision baseline. The openai-oauth provider/capability additions are reflected across phases and checkpoints. Remaining work belongs to Phase 1/2/3 implementation planning, not more Phase 0 discovery.
- Phase 1 Guest Mode implementation stays narrow: `STEEL_GUEST_MODE` gate, conversation-scoped guest token hash, and Admin routes always unavailable to guests. Public share links, retention automation, and advanced guest hardening remain later work.
- When `STEEL_GUEST_MODE=false`, Steel quote access should use Steel-specific permissions/capabilities, such as `steel.quote.access` and `steel.admin.access`, through existing LibreChat auth/role seams. Do not collapse Steel access into a generic Admin boolean.
- Phase 2 source-schema mapping first covers DB-bound spec, price, formula, and processing-price keys. Workbook sheet names remain Chinese ERP-facing labels and are not database schema keys.
- `tasks/v8.3/source-schema-mapping.md` is the Phase 2 discussion source of truth. During implementation, design `packages/api/src/steel/schema/mapping.ts`; after that module exists, code becomes the runtime source while the markdown keeps decision context.
- AI API mapping context must be task-scoped. Workbook patch prompts receive workbook keys; price search receives price/search keys. Do not place the entire schema mapping into every prompt.
- Phase 3 mock data does not wait for complete mapping. It must use locked canonical keys and remain replaceable by future real schema/API data.
- Do not change Supabase schema in Phase 0. Phase 2 handbook/mapping work decides the minimal schema delta, and every schema change updates both `supabase/schema.sql` and one new migration.
- Admin ERP Import MVP should start with either `price_items` or customers depending on ERP key reliability. Prefer `price_items` if ERP item code plus customer tier is stable enough, because it validates quote value fastest; otherwise start with customers/customer aliases/customer tiers.
- Internal DB/DTO/tool keys remain English. Customer-facing and ERP-facing Excel sheet labels and headers use Chinese business wording.
- Phase 3 live provider smoke stays minimal: one authenticated LINE-style order creates or patches a seven-sheet workbook through reviewed lookup tools using openai-oauth responses, and one equivalent API fallback smoke uses official OpenAI API. Both record requested provider, effective provider, model, provider IDs, fallback status, tool call IDs, and context refs.
- After Phase 0, plan Phase 1 and Phase 2 together, but implement Phase 1 contracts/routes/auth/audit first while a separate data/schema pass can extend Phase 2 mapping and schema design in parallel.

Post-lock implementation clarifications:

- Phase 1 model-option work must inspect and adapt LibreChat's existing `/api/models`, `/api/endpoints`, `modelSpecs`, default preset, and default setting behavior before adding Steel-only selection logic.
- Phase 1 Admin route protection should first use LibreChat account role/capability behavior for `ADMIN` and `USER`; Steel-specific permissions can layer on top after that seam is proven.
- ERP XLSX source columns are treated as stable and append-only for v8.3 planning: future exports may add columns, but existing required columns should not be renamed.
- OpenAI OAuth as proxy must have an early development/test seam before full workbook orchestration, while full live quote-workbook smoke remains a Phase 3 gate.
