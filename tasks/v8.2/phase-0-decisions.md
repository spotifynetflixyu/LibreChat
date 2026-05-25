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

- A focused live smoke test creates a conversation and calls Responses API with `conversation` only.
- `steel_openai_runs` records provider IDs, token usage, selected model, context refs, and tool call IDs.

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

## D0.4 Source Codes And Admin Import Keys

Decision: v8.2 uses neutral source-data keys for Admin DOCX / XLSX imports.

Target schema direction:

- Customer imports use a source customer code when the uploaded source provides one.
- Price item imports use a source item code plus customer tier when the uploaded source provides those keys.
- Rows without confirmed keys become `needs_review`, not guessed updates.
- Existing old field names in the initial schema should be treated as migration cleanup candidates, not product language.

Exit criteria:

- Mapping profile schema records target table, lookup key fields, delete marker policy, source file type, sheet/header metadata, and required fields.
- Admin import can be built first for one confirmed target table.
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

## D0.7 Admin Upload Policy

Decision: Admin formal data import accepts only DOCX / XLSX uploads. There is no Admin PDF parser and no in-product transformation from PDF/image files into importable files.

Admin import workflow:

```text
Admin chooses source type / target table
  -> Admin uploads DOCX or XLSX
  -> backend parses preview rows
  -> Admin preview/edit/confirm
  -> merge table
  -> validated Supabase transaction
```

Rules:

- PDF, scanned PDF, image PDF, screenshots, image files, and `.txt` are rejected at the Admin Import upload boundary.
- Rejected Admin files do not create source versions, parsed rows, merge rows, or formal database writes.
- If the business has PDF or text source material, it must be prepared outside this system as DOCX / XLSX before Admin upload.
- PDF/image files may still appear as low-confidence quote conversation evidence, but that evidence is not a formal Admin data source.
- DOCX / XLSX parsed data is the only formal Admin Import input.

## D0.8 Async Boundary

Decision: Keep MVP operations synchronous until measured file size or request time requires a queue.

Rules:

- First prove real OpenAI chat can create a customer-visible seven-sheet workbook.
- UX polish and BullMQ infrastructure come later.
- Small workbook generation, small import fixtures, and the first quote vertical slice stay synchronous with payload limits and timeout expectations.
- Source reindex, large XLSX parse, large DOCX parse, and large workbook export can move to Phase 5 jobs.

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
- Admin-imported DOCX / XLSX specs can provide weight, standard dimensions, and source refs.
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
- Admin upload policy rejecting files that are not DOCX or XLSX.
- Admin preview validation.
- Seven-sheet export.
- Customer quote mask.
- System order sheet.

Exit criteria:

- Evals run from `packages/api/src/steel/evals`.
- Reports identify failing case, assertion, expected value, and actual value.
