# Phase 0: v8.2 Decision Baseline

Goal: lock the decisions that would otherwise cause rework in schema, import, source upload policy, workbook, export, quote resolution, and OpenAI orchestration.

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

## D0.2 OpenAI State Contract

Decision: The Steel orchestrator passes `conversation` to Responses API and does not pass `previous_response_id` in the same request.

Confirmed baseline:

- Use `conversation` as the provider-side durable state handle.
- Store response IDs, including prior response ID, only for audit, traceability, and fallback recovery.
- Chain recovery never relies on fetching historical conversation text from OpenAI.
- Reconfirm current OpenAI SDK/API types immediately before implementation because Responses API event and file/vision shapes can change.

Exit criteria:

- The implementation plan assigns the focused live Responses smoke test to Phase 3, not Phase 0.
- The Phase 3 OpenAI run plan records provider IDs, token usage, selected model, context refs, and tool call IDs.

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

Decision: v8.2 Admin data updates are based on admin-uploaded ERP export XLSX files. Parser output is matched against old data, reviewed, confirmed, and then committed to the database.

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

MVP note: Phase 3 can proceed with deterministic database tools even if full retrieval is deferred to Phase 5.

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
- Prove real OpenAI chat can create a customer-visible seven-sheet workbook before moving to Phase 4.
- BullMQ infrastructure comes later.
- Small workbook generation, small import fixtures, and the first quote vertical slice stay synchronous with payload limits and timeout expectations.
- Source reindex, large XLSX parse, and large workbook export can move to Phase 5 jobs.

## D0.9 Excel Rendering Library

Decision: Use ExcelJS deliberately for customer-facing export rendering.

Rules:

- Add ExcelJS intentionally to the backend package that owns export rendering.
- Use ExcelJS for workbook sheets, formatting, filters, frozen headers, customer mask, system order sheet, and future streaming export.
- Keep `xlsx` for Admin import parsing and generated workbook read-back tests unless implementation proves consolidation is better.

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
- Customer quote sheet mask tests assert internal fields are absent.

## D0.11 Price Before Weight

Decision: Quote resolution searches product/processing prices before using weight/spec sources for pricing.

Rules:

- Unless the user explicitly provides a unit price, every material or processing item must search formal price data first.
- Handbook-informed schema and Admin-imported XLSX data can support weight, standard dimensions, and source refs; real handbook data SQL/import is deferred.
- Handbook weight cannot be used to invent material sale price.
- Missing price is `未確認`, never `0`.

Exit criteria:

- Eval harness includes price-first cases.
- Calculator tests separate confirmed and low-confidence estimated totals.

## D0.12 Steel Eval Harness

Decision: v8.2 requires an eval harness before broad beta.

Minimum evals:

- Text order parsing.
- Customer tier resolver.
- Multi-key price search.
- Price candidate ranking.
- Price-before-weight.
- Stock allocation.
- Deterministic calculators.
- Admin upload policy rejecting files that are not ERP XLSX.
- Admin preview validation.
- Seven-sheet export.
- Customer quote mask.
- System order sheet.

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

Decision: Reference materials under `docs/reference/doc` are Chinese source inputs. Before they inform schema, API mock data, tools, AI API prompt context, or database queries, they must pass through `tasks/v8.2/source-schema-mapping.md`, an agreed mapping from Chinese source labels/headers/terms to English canonical schema keys.

Rules:

- Programmatic contracts use English canonical identifiers: DTO fields, workbook paths, tool argument names, repository filters, SQL column names, and API response keys.
- Chinese source labels are preserved as data values where useful: display labels, source labels, aliases, original text, search terms, and audit/source references.
- The mapping artifact records at least Chinese source label/header, English canonical key, target table/DTO/tool field, type/unit, normalizer, and source reference.
- Mock data shaped from `docs/reference/doc` must use English DTO/API keys even when the visible workbook label or source text is Chinese.
- The mapping may be used to design the real Supabase schema/data model; it is not limited to mock data.
- No separate `review_status`, `corrected_text`, or typo approval workflow is required in the mapping artifact; by the time importable data/SQL is generated, code-agent discussion should already use corrected business concepts.
- The implementation plan must include a code-owned source-schema mapping module, initially designed as `packages/api/src/steel/schema/mapping.ts`, plus focused tests.
- AI API prompt/tool orchestration must receive a compact mapping context so it can map Chinese source/customer wording to existing canonical keys.
- AI may propose mapped keys in structured output, selected workbook refs, workbook patches, and tool arguments, but backend validation remains authoritative and rejects unknown keys.
- Do not translate or infer schema fields ad hoc inside query code; repositories and tools query by English canonical keys/columns.
- This does not require translating every product/customer-facing value to English. Product names, aliases, sheet labels, and source excerpts may remain Chinese data.

Exit criteria:

- Phase 2 produces or updates `tasks/v8.2/source-schema-mapping.md` before schema/mock-data assumptions are treated as stable.
- Phase 2 designs the code version of the mapping and its AI API serialization contract.
- Repository/tool/prompt tests use English field names for filters and assertions while covering Chinese aliases/source values as data.
- The plan contains no requirement for Chinese database column names, DTO keys, or tool argument keys just because the source docs are Chinese.

## Phase 0 Lock Review

Status: locked after final Phase 0 question pass.

Approved decisions:

- Phase 0 is allowed to close with D0.1-D0.14 as the decision baseline. Remaining work belongs to Phase 1/2 implementation planning, not more Phase 0 discovery.
- Phase 1 Guest Mode implementation stays narrow: `STEEL_GUEST_MODE` gate, conversation-scoped guest token hash, and Admin routes always unavailable to guests. Public share links, retention automation, and advanced guest hardening remain later work.
- When `STEEL_GUEST_MODE=false`, Steel quote access should use Steel-specific permissions/capabilities, such as `steel.quote.access` and `steel.admin.access`, through existing LibreChat auth/role seams. Do not collapse Steel access into a generic Admin boolean.
- Phase 2 source-schema mapping first covers handbook schema concepts, workbook DTO/API keys, ERP customer/price keys, and tool arguments. Full future RAG/source mapping is not required for the first pass.
- `tasks/v8.2/source-schema-mapping.md` is the Phase 2 discussion source of truth. During implementation, design `packages/api/src/steel/schema/mapping.ts`; after that module exists, code becomes the runtime source while the markdown keeps decision context.
- AI API mapping context must be task-scoped. Workbook patch prompts receive workbook keys; price search receives price/search keys. Do not place the entire schema mapping into every prompt.
- Phase 3 mock data does not wait for complete mapping. It must use locked canonical keys and remain replaceable by future real schema/API data.
- Do not change Supabase schema in Phase 0. Phase 2 handbook/mapping work decides the minimal schema delta, and every schema change updates both `supabase/schema.sql` and one new migration.
- Admin ERP Import MVP should start with either `price_items` or customers depending on ERP key reliability. Prefer `price_items` if ERP item code plus customer tier is stable enough, because it validates quote value fastest; otherwise start with customers/customer aliases/customer tiers.
- Internal DB/DTO/tool keys remain English. Customer-facing Excel sheet labels and headers use Chinese business wording.
- Phase 3 live OpenAI smoke stays minimal: one authenticated LINE-style order creates or patches a seven-sheet workbook through deterministic tools while recording model, provider IDs, tool call IDs, and context refs.
- After Phase 0, plan Phase 1 and Phase 2 together, but implement Phase 1 contracts/routes/auth/audit first while a separate data/schema pass can extend Phase 2 mapping and schema design in parallel.
