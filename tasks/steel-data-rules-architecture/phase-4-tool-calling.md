# Phase 4: Tool-Calling Contract

Goal: define how AI retrieves normalized facts and rules without reading raw source files or inventing calculations.

## AI And Backend Responsibility Split

AI owns interpretation and orchestration:

- infer likely material/spec/formula intent from natural language, files, and workbook context
- decide which backend tools to call next
- compare returned candidates and ask the user when specs, prices, or processing evidence are ambiguous
- present nearest reviewed price/spec candidates when the exact material price is unknown or zero, then wait for user confirmation or a supplied unit price before confirmed totals
- choose a reviewed formula/rule path, such as C-type finished-length behavior, when tool results support it
- disclose when an Admin-reviewed customer-scoped quote default is applied, so the user knows the quote used a saved customer rule
- provide optional AI Python / Code Interpreter calculation evidence when the provider supports it, including code, numeric steps, and low-confidence assumptions
- explain any difference between AI Python results and backend-confirmed results in the assistant response and concise workbook notes
- propose workbook patches from accepted tool results

Backend tools own validation and deterministic execution:

- validate tool arguments with canonical English keys
- query reviewed database facts instead of raw source files
- validate selected formula/rule origin, review state, active state, selector scope, and source refs
- calculate weights, cutting counts, processing fees, line totals, and confidence using deterministic calculators
- recompute and compare AI Python / Code Interpreter calculation evidence when present
- treat backend-confirmed calculation results as the highest-confidence numeric source when backend calculation succeeds
- allow workbook preview patching with backend-confirmed numbers even when AI Python differs
- store full AI Python code/output and verbose comparison data in backend-readable calculation audit tables, not visible workbook cells
- write only concise human-readable difference summaries to workbook text sheets such as `價格來源` or `判讀備註`
- reject silent zero charges when no selected rule, reviewed true-zero fact, or quote-specific override supports them
- persist only accepted workbook patches through workbook services

Backend calculators must not hard-code business behavior such as `if C-type then cutting/hole fee = 0`. They accept an already selected and validated calculation rule or quote-specific override, then calculate from structured inputs.

C-type cutting/hole no-charge behavior is a configured quote default or reviewed rule retrieved and selected by AI. It is not inferred by backend code from product family alone.

## Calculation Audit Lane

The quote flow can use OpenAI Code Interpreter / AI-written Python as a calculation audit lane when the active provider/model capability supports it. This lane is useful for proving the AI generated code and numeric steps instead of only narrating a result.

The audit lane is not the trusted quote calculator. It produces one current order/workbook-level calculation state and one current item/line audit per steel material candidate or workbook row. Each item audit can include:

- selected formula code and calculation rule refs
- normalized variables, units, quantities, and parameter overrides
- selected price, weight, cutting, hole, slotting, and surcharge source refs
- Python code or equivalent numeric trace
- AI-computed intermediate values and final result
- low-confidence assumptions

Backend validation then:

- validates the `calculationPlan` against reviewed database facts, selected formula/rule scope, quote-specific overrides, and workbook context
- runs the backend canonical calculator from the same normalized inputs
- compares backend output with AI Python output using configured tolerances
- marks `matched`, `backend_differs`, `ai_missing`, or `backend_failed`

If backend calculation succeeds, the backend result is the highest-confidence number used in the workbook patch. A mismatch with AI Python must not block workbook preview patching by itself. Instead, the patch should include backend-confirmed values plus concise visible notes that show where AI Python differed, while full code/output and verbose comparison data stay in DB audit rows.

If backend calculation fails or required source/rule validation fails, the patch may only record interpretation/manual-review state and must not write a confirmed customer-facing total.

Storage policy:

- `steel.quote_calculation_state` stores the current quote calculation context, such as conversation, workbook display version, provider, model, and status.
- `steel.quote_calculation_item_audits` stores current line-level calculation plans, Python code/output, AI result, backend result, comparison status, and structured difference summary.
- Multi-item orders create multiple current item audit rows under the same calculation state.
- Accepted recalculations overwrite the current calculation state and current item audit rows. Removed workbook lines delete their item audits.
- `workbook_version` is an update counter / freshness marker only; it is not a retained historical workbook version.
- Workbook visible sheets do not store Python code, raw stdout, container logs, or verbose JSON.
- `價格來源` and `判讀備註` may store concise human-readable difference summaries such as "AI rounded unit price before multiplying; backend used exact 194.3 x 100 = 19,430."

## Tool Groups

### Agent Instruction

Before the first `lookup_instructions` call, AI has the Admin-managed Agent
Instruction. It is injected into every Steel quote turn as the built-in default
instruction.

The Agent Instruction may tell AI to:

- apply Steel file/OCR interpretation policy before trusting extracted text,
  including image/PDF direction checks, Traditional Chinese preservation,
  drawing/table evidence separation, and low-confidence OCR handling
- treat raw customer text as quote evidence, not reviewed fact
- identify rough task facets
- call `lookup_instructions` when detailed steel inference rules are needed
- avoid raw typo/incomplete table lookups before candidate generation
- use reviewed lookup tools only after it has enough interpreted context
- generate workbook output only as typed patch operations or validated
  structured workbook content, never as direct database mutation

The Agent Instruction is Admin-updateable, but it should stay global: tool
policy, quote workflow policy, safety rules, and default behavior that applies
to every quote turn. It may include global OCR/file rules, allowed tool routing,
order-line inference workflow, workbook patch policy, confirmation rules, and
source-validation rules. Detailed material/task rules, such as `亞`/`錏`
surface treatment clues, C-type no-general-cutting behavior,
price-before-weight policy, hole/slot/bending interpretation, and material
family workbook notes can live in database-backed Instruction Packets when they
need task-scoped retrieval, versioning, or selective application.

Planned storage: `steel.agent_instructions`, with one reviewed active default
per scope. Runtime prompt context should record the selected agent instruction
ID/version in context refs.

Suggested `steel.agent_instructions` sections:

- `fileOcrRules`: image/PDF orientation, OCR confidence, Traditional Chinese,
  drawing-vs-table precedence, and evidence refs.
- `toolRules`: allowed reviewed lookup tools, when to call
  `lookup_instructions`, raw-typo guardrails, and when not to call tools.
- `orderInferenceRules`: how to split orders into lines, detect customer/tier,
  material family, surface treatment, dimensions, quantities, processing
  intents, missing fields, and confirmation needs.
- `workbookRules`: when to produce provisional vs confirmed workbook patches,
  required explanation/source/confidence notes, and how to use
  `patch_quote_workbook` when workbook context is present.
- `responseRules`: bounded options, confirmation language, low-confidence
  disclosure, and no confirmed total for unresolved ambiguity.

The first database-ready Agent Instruction seed text lives in
[`agent-instructions.md`](agent-instructions.md). The detailed Instruction
Packet design lives in [`instruction-packets.md`](instruction-packets.md).
Future prompt-injected body text for both layers should be Traditional Chinese;
canonical API/schema keys can remain English.

### Instruction Tools

- `lookup_quote_rules`
- `lookup_instructions`

Outputs:

- task-scoped instruction packets
- applies-to selectors, such as material family, processing intent, price lookup, drawing interpretation, workbook output, or confirmation policy
- priority and confidence
- source refs and instruction version refs
- blocked or superseded instruction reasons when applicable

Rules:

- `docs/reference/instruction.txt` is the current seed source for quoting
  interpretation rules, but runtime should retrieve bounded reviewed packets
  instead of injecting the entire file into every prompt.
- Instruction Packets are stored in the database and can be updated through
  Admin backend workflows. The MVP can seed them from `docs/reference/instruction.txt`,
  but runtime reads reviewed active database packets.
  Planned storage: `steel.instruction_packets`.
- Use instruction packets for AI candidate generation and interpretation policy:
  price-before-weight, oral material aliases, surface treatment clues, C-type
  behavior, long-material cutting, hole/slot/bending interpretation, missing
  price handling, and workbook output requirements.
- `lookup_quote_rules` should be one batched full-facet lookup per interpreted
  order context. AI sends all detected material families, task types, processing
  types, formula candidates, customer/tier/project context, and low-confidence
  facets together instead of querying packets one-by-one for hole count, cut
  count, slotting path, formula, or each small line detail.
- Related steel rules should be organized and retrieved as packet groups, such
  as `h-type-quote-core`, `c-type-quote-core`, `angle-zinc-quote-core`,
  `plate-processing-core`, and `workbook-output-core`. A matching group should
  return its related price/formula/cutting/hole/workbook packets together so AI
  can apply every relevant detailed rule after one lookup.
- Classify packets by multiple selectors, not only steel type:
  - `packetGroup`: grouped rule bundle for the interpreted material/task context
  - `taskType`: material_price_lookup, formula_selection, default_selection,
    drawing_interpretation, processing_detection, workbook_output,
    confirmation_policy
  - `materialFamily` / `productFamily`: C-type, H-type, angle, pipe, plate,
    flat bar, channel, stainless, galvanized, etc.
  - `surfaceTreatment`: black, white/stainless, galvanized, 錏/亞, painted,
    aluminum-zinc, hot-dip galvanized
  - `processingType`: cutting, holes, slotting, bending, none
  - `formulaCode`, `customerId`, `customerTierId`, and project/source scope when
    applicable
  - `priority`, `reviewState`, `active`, `effectiveAt`, `supersedesId`, and
    `sourceRefs`
- `lookup_instructions` remains as an instruction-only compatibility wrapper
  over the same DB-backed packet storage. New runtime prompt policy should
  prefer `lookup_quote_rules` when defaults may also apply.
- Instruction packets are not source facts. They can guide AI interpretation,
  but reviewed price/default/formula/customer lookup results and backend
  validation still decide confirmed values.
- Do not expose generic `search_source_chunks` as an MVP inference tool. If raw
  source-chunk retrieval is needed later, keep it a separate extension with
  stricter task scope and sanitizer rules.

### Customer Tools

- `search_customers`

Outputs:

- exact matched customer when there is one
- tier
- candidates
- confidence
- source refs

### Quote Item Reasoning Contract

Do not expose quote-item normalization or price-search-term generation as
required runtime tools. AI should reason from the customer evidence and produce
structured material/spec candidates and product-price `candidateQueries` before
calling a reviewed lookup tool.

Outputs:

- normalized category/material/spec candidates
- dimensions and quantity
- processing notes
- cutting intent candidates, including head/tail trim, split/multi-piece intent, and remainder-related notes
- hole evidence groups with count/type/diameter or non-round dimension candidates
- slotting path candidates with segment lengths and path quantities
- candidate aliases
- low-confidence reasons
- user confirmation state: `use_candidate`, `ask_user`, or `confirm_candidates`

Rules:

- AI may infer likely specs from customer-specific order formats, uploaded evidence, and chat text.
- AI-inferred specs are candidates until reviewed lookup results, deterministic validation, or user confirmation supports them.
- AI owns tool orchestration after candidate reasoning. In the MVP it chooses
  among the small reviewed lookup surface: merged quote-rule lookup, customer
  search, product-price candidate search, quote-default compatibility lookup,
  and formula lookup.
  Weight, cutting, processing, material-rule, ranking, and calculation details
  remain backend internal validation/calculation capabilities unless a later
  slice explicitly exposes them.
- For typo/incomplete material-price examples such as `亞L30x30 一支多少`, AI should continue the full runtime chain: identify typo/incomplete fields, propose approximate material/spec candidates, choose lookup tools, rank reviewed facts, produce provisional workbook output, and ask for user confirmation with bounded options.
- Raw customer text is quote evidence, not a reviewed price key. For typo/incomplete text such as `亞L30x30`, AI/normalization must first produce possible material/spec/search candidates before any reviewed price lookup.
- Price query candidates are generated by AI reasoning and passed to `search_price_candidates`. The backend tool must reject raw-only search terms and search only derived candidates or confirmed normalized keys.
- Backend search may apply bounded token matching to AI-derived oral product candidates, such as matching `錏角鐵` against reviewed rows that contain both `錏` and `角鐵`. This expansion must stay tied to derived candidates; it must not turn raw typo strings such as `亞L30x30` into direct price keys.
- If AI confidence is not high, the assistant response must ask the user to confirm before confirmed pricing.
- If multiple plausible candidates exist, the assistant response or reviewed lookup result must present bounded options and wait for user confirmation.
- Missing canonical fields such as length, thickness, customer, or tier do not block reviewed price lookup when bounded derived candidate queries can still be formed. For quick price requests such as `一支多少`, AI searches first, leads with the highest-confidence positive source-backed approximate candidate as a provisional quote when one exists, then asks the user to confirm missing fields and listed alternatives before any confirmed customer-facing total.
- If the user did not provide a customer, or `search_customers` cannot find a usable customer price tier, `search_price_candidates` must use the global default B tier, `customerTierId: 2`. It must not default unknown tier to A/tier 1. The response should keep the B notice short, for example `目前用 價格B：<unit price>`, and separately say that providing a customer name allows the system to look up that customer's quote price. Do not add highest/most-expensive wording unless the user asks. If `search_customers` returns a usable customer tier, use that tier instead of the B default.
- If total piece weight is already shown, do not list unit weight as a separate bullet; prefer one line such as `6M 一支重量：4 × 6 = 24 kg`.
- For C 型鋼 / `c_type` with unspecified material or surface, first-turn responses may lead with the usual 錏輕型鋼 candidate but must show same-spec material alternatives returned by reviewed lookup. In a follow-up turn, if the user does not specify another material/surface, treat the default 錏輕型鋼 assumption as confirmed for the continuing quote context.
- Missing or low-confidence cutting/head-tail, hole-count, or slotting-path evidence produces a targeted clarification question before confirmed fee calculation.

### Allowed MVP Reviewed Lookup Tools

- `lookup_instructions`
- `lookup_quote_rules`
- `search_customers`
- `search_price_candidates`
- `lookup_defaults`
- `lookup_formula`

Rules:

- `lookup_quote_rules` returns reviewed task-scoped instruction packets and
  reviewed quote defaults before or during candidate/default generation. It must
  not return the full `docs/reference/instruction.txt` body for every task, and
  it must not return price rows or final calculations.
- `lookup_instructions` remains an instruction-only compatibility wrapper over
  DB-backed `steel.instruction_packets`.
- The request is batched by interpreted order context. For one order/workbook
  turn, AI includes all detected material families, task types, processing
  types, formula candidates, customer/tier/project context, and low-confidence
  facets in one `lookup_quote_rules` call. Do not split packet/default lookups by
  individual details such as hole count, cut count, slotting path, bending,
  formula, or one material line unless later user input materially changes the
  context.
- The tool expands `packetGroupHints` or selector matches into related packet
  bundles. For example, H 型鋼 with cutting should return H length surcharge, H
  cutting, formula, cut-count, and workbook/confirmation packets together when
  they fit the same interpreted context.
- `search_customers` returns exact and ambiguous customer/tier candidates. Do
  not expose a separate `lookup_customer` MVP tool; exact matches are a result
  shape, not a separate tool path.
- `search_price_candidates` accepts confirmed normalized keys or derived
  candidate queries. It must not query reviewed price rows with nonexistent raw
  typo strings as if they were canonical product/spec keys.
- `search_price_candidates` may also return bounded safety marks such as missing
  price, zero-as-missing, multiple candidates, or approximate estimate state. Do
  not expose a separate `rank_price_candidates` runtime tool; ranking/
  confirmation policy is backend internal validation plus AI explanation.
- `lookup_defaults`
  retrieves scoped reviewed quote-default candidates for customer, material/
  product family, charge type, formula code, and default-parameter context when
  a defaults-only compatibility call is needed.
- `lookup_formula` returns reviewed active formula candidates and version/source
  refs. Do not expose storage-oriented `lookup_formula_version` naming as the
  MVP AI contract.
- Backend lookup tools validate only their own table-specific contract. They provide guardrails and source-backed results, not hidden AI replacement logic for choosing which business table to query.
- Do not confirm zero price, zero processing price, or zero cutting price as valid unless reviewed business rules mark a true-zero exception.
- `產品價格.xlsx` `0` values are missing price by default, not free price.
- When exact material price is unknown or zero, tools may return nearest reviewed nonzero candidates with source refs and differences. AI must ask the user to confirm one candidate or provide a quote-specific unit price before producing a confirmed customer-facing total.
- True-zero charge exceptions come from a selected calculation rule or reviewed business rule, not from product-family hardcoding.
- For the current C-type cutting/hole quote default, AI selects the rule only when the order context supports it; backend tools validate `effect`, matching charge type, and high confidence before accepting true zero.
- True-zero decisions skip remainder calculation only when the selected calculation rule says to do so.
- Formula lookup returns reviewed formula candidates such as formula code `C` for
  C-type steel. AI can choose one, but backend validation must reject stale,
  inactive, unreviewed, or selector-incompatible formula/rule origins.
- Quote defaults provide default behavior and default parameters. User-provided conversation numbers, counts, rates, or money amounts become `parameterOverrides` only when explicit and high confidence.
- Formula selection is fixed by `formulaCode`; numbers remain adjustable through `defaultParameters` and `parameterOverrides`.
- AI retrieves quote defaults through `lookup_quote_rules` when instruction
  packets are also needed, or `lookup_defaults` when a defaults-only
  compatibility call is enough. The tool returns bounded reviewed candidates
  with origin refs; it does not dump all defaults into the prompt.
- Steel Admin-reviewed quote defaults and LibreChat user memory are separate retrieval layers. Admin-reviewed quote defaults are the site-managed default layer generated from reviewed Steel facts; LibreChat user memory is the current user's custom memory layer.
- LibreChat user memory can override the priority of matching Admin-reviewed defaults for the current user/account, but it must not mutate reviewed Steel facts or published Admin-reviewed quote defaults.
- Future user-memory adapters must keep `defaultCandidates` and `userMemoryCandidates` separately labeled through ranking and validation.
- Quote-time priority is explicit current quote override first, then applicable LibreChat user memory, then Admin-reviewed customer/tier/company defaults.
- AI-selected quote defaults must be validated again by backend before they become `selectedCalculationRule`.
- When a selected quote default comes from an Admin-reviewed customer-scoped default, the assistant response should explicitly mention the applied customer rule.
- AI-selected user memory must be validated again by backend for current user/account ownership, task scope, reviewed formula compatibility, and allowed parameter overrides before it becomes `selectedCalculationRule`.
- "Save as this customer's default" is not a direct memory write. Tool orchestration may create only a structured rule proposal with `needs_review` status; Admin review must approve it before it becomes reviewed rule/default data and later published quote defaults.
- Do not treat zero unit weight as true zero in Phase 2.
- Include task-scoped material rules only through `lookup_defaults`,
  `lookup_formula`, prompt context, or backend validation. Do not expose a
  separate `lookup_material_rules` MVP tool.

### Workbook Output Tool

Workbook updates are not part of the reviewed lookup tool list. They are an
output path.

Current `/steel/oauth-chat` behavior:

- When workbook context is present, the provider adapter exposes
  `patch_quote_workbook` as the only AI workbook output tool.
- AI uses `patch_quote_workbook` for all workbook output. The AI sends
  compact semantic quote data such as customer, quote lines, source summaries,
  manual review, interpretation notes, and summary values; backend projection
  expands it into typed `set_cell` operations across all related workbook
  sheets.
- If one value changes, such as customer tier, quantity, unit price, total
  weight, or subtotal, the semantic patch must reuse the same `lineId` so the
  backend projection updates related cells together instead of leaving stale
  workbook sheets.
- The backend parses the provider tool call, validates/projected operations
  against workbook schemas, applies them through the workbook service, and
  returns the persisted patch result to the UI.
- After an accepted workbook output result, the assistant response must briefly
  summarize the interpreted order information, the new quote amount when `小計`
  changed, and key workbook changes. It must not list a per-field diff, long
  search keywords, or long candidate item lists, and must not answer only with
  an operation or field count such as `已更新 workbook：16 個欄位`.
- `報價明細` uses the visible field `小計` for the quote amount; do not add or
  use a duplicate visible `報價` field in that sheet.
- User-facing price bullets should use `價格`, not `reviewed 價格`; keep
  reviewed/source status in source rows or note text.
- `patch_quote_workbook` is allowed for provisional workbook notes and candidate
  estimates, but confirmed customer-facing totals still require reviewed facts
  or explicit user confirmation.

Future provider-neutral architecture should keep this boundary: reviewed lookup
tools retrieve source-backed facts; workbook output tools propose typed workbook
changes; backend workbook services are the authority that persists or rejects
patches.

### Backend Internal Calculation Capabilities

The MVP does not expose calculator primitives as AI-callable tools. Backend
validation/workbook output may still use internal calculators for stock length
allocation, formula execution, plate/bar weight, cut count, cutting fees, hole
fees, slotting fees, bending fees, and line totals.

Rules:

- `generate_calculation_plan` returns normalized variables, selected formula/rule refs, source refs, parameter overrides, and optional AI Python audit evidence per item/line. It does not write workbook state.
- Calculators receive only normalized facts, validated rule outputs, and explicit quote-specific adjustments.
- Calculators never search raw source files.
- Calculators do not decide which material family gets special behavior. They only execute the formula/rule path selected by AI and validated by backend tools.
- Confirmed totals and low-confidence estimates remain separate.
- Backend-confirmed calculator output is used for persisted numeric workbook fields when it succeeds. AI Python/Code Interpreter output is stored in DB audit records; concise discrepancy summaries may be written to workbook notes.
- `calculate_cut_count` returns both `operationCutCount` and `billableCutCount`, plus adopted/rejected head trim, tail trim, remainder, and special-cut reasons.
- `calculate_cutting_fee` consumes a validated cut-count result, reviewed cutting price, selected calculation rule, and quote-specific adjustments. It does not re-interpret raw text.
- If any material can carry cutting price and the user says only "要切" or the quote evidence implies cutting, AI should ask about head trim, tail trim, no-head/no-tail, or split-only assumptions before confirmed cutting fee calculation.
- If cutting is not needed or the user explicitly says no cutting, workbook patching should still record cutting count/fee as `0` with a no-cut reason.
- If allocation creates a remainder and the selected rule omits tail trim, AI should explicitly say `有餘料，切尾不計入`; workbook notes should record the same reason.
- `calculate_hole_fee` consumes structured hole groups, supports round and non-round hole types, excludes non-hole drawing marks, multiplies by item quantity, and returns total hole count plus fee confidence.
- `calculate_slotting_fee` consumes structured slot paths, sums continuous segment lengths, multiplies by item quantity, converts to meters, and returns total slotting meters plus fee confidence.
- Quote-specific adjustments can exclude charges, apply special prices, add surcharges, or override default material-rule behavior for the current workbook line only.
- Phase 2 validates and normalizes adjustment objects, but does not mutate workbook state. Phase 3 persists accepted adjustments on workbook lines.

### Tool Executor Boundary

`packages/api/src/steel/tools/execute.ts` should be provider-neutral. It validates arguments, dispatches backend-owned tool handlers, logs bounded summaries, sanitizes results, and returns typed success/error envelopes.

Provider adapters serialize tool definitions and results differently, but they must not own business validation, calculation, source priority, workbook mutation, or source-file access.

## Prompt Context Policy

The AI gets enough context to decide which tool to call next:

- current quote request evidence summary
- known customer/tier facts
- normalized quote item facts
- explicit customer-requested quote-specific adjustments
- available tool list
- matching source-schema mapping packet
- matching task-scoped instruction packets only
- matching material rules only
- matching Steel Admin-reviewed quote defaults retrieval packet only
- matching LibreChat user memory retrieval packet for the current user/account only

The AI must not receive:

- the entire `docs/reference/instruction.txt` file for every task
- the entire source-schema mapping for every task
- all material rules for every item
- all LibreChat user memories for every task
- raw SQL/table names beyond approved tool schema
- raw source-file text as a substitute for repository output

## Exit Criteria

- Tool schemas are provider-neutral.
- Tool results are sanitized and bounded.
- Tool-call logs preserve tool name, provider tool-call ID when available, status, duration, input summary, output summary, source refs, error category, and redaction version.
- The Phase 3 prompt bundle can consume these contracts directly.
