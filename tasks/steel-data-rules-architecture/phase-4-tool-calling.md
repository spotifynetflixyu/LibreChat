# Phase 4: Tool-Calling Contract

Goal: define how AI retrieves normalized facts and rules without reading raw source files or inventing calculations.

## AI And Backend Responsibility Split

AI owns interpretation and orchestration:

- infer likely material/spec/formula intent from natural language, files, and workbook context
- decide which backend tools to call next
- compare returned candidates and ask the user when specs, prices, or processing evidence are ambiguous
- present nearest reviewed price/spec candidates when the exact material price is unknown or zero, then wait for user confirmation or a supplied unit price before confirmed totals
- choose a reviewed formula/rule path, such as C-type finished-length behavior, when tool results support it
- disclose when an Admin-reviewed customer-scoped lesson/memory default is applied, so the user knows the quote used a saved customer rule
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

C-type cutting/hole no-charge behavior is a configured default rule/lesson/memory retrieved and selected by AI. It is not inferred by backend code from product family alone.

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

### Customer Tools

- `lookup_customer`
- `search_customers`

Outputs:

- matched customer
- tier
- candidates
- confidence
- source refs

### Quote Item Tools

- `normalize_quote_item`
- `generate_price_search_terms`

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
- AI-inferred specs are candidates until backend validation accepts one high-confidence complete candidate.
- If AI confidence is not high, the tool result must ask the user to confirm before pricing.
- If multiple plausible candidates exist, the tool result must present bounded options and wait for user confirmation.
- Missing canonical fields produce a targeted clarification question rather than a guessed price lookup.
- Missing or low-confidence cutting/head-tail, hole-count, or slotting-path evidence produces a targeted clarification question before confirmed fee calculation.

### Price And Rule Tools

- `search_price_candidates`
- `rank_price_candidates`
- `lookup_weight_spec`
- `lookup_material_rules`
- `lookup_formula_version`
- `retrieve_lesson_memory`
- `retrieve_user_memory`
- `select_calculation_rule`
- `lookup_cutting_price`
- `lookup_processing_price`

Rules:

- Return product-price unit weight when present.
- Return handbook weight specs separately.
- Include adopted/rejected reasons.
- Do not confirm zero price, zero processing price, or zero cutting price as valid unless reviewed business rules mark a true-zero exception.
- `產品價格.xlsx` `0` values are missing price by default, not free price.
- When exact material price is unknown or zero, tools may return nearest reviewed nonzero candidates with source refs and differences. AI must ask the user to confirm one candidate or provide a quote-specific unit price before producing a confirmed customer-facing total.
- True-zero charge exceptions come from a selected calculation rule or reviewed business rule, not from product-family hardcoding.
- For the current C-type cutting/hole lesson, AI selects the rule only when the order context supports it; backend tools validate `effect`, matching charge type, and high confidence before accepting true zero.
- True-zero decisions skip remainder calculation only when the selected calculation rule says to do so.
- Formula lookup returns reviewed formula candidates such as formula code `C` for C-type steel. AI can choose one, but backend validation must reject stale, inactive, unreviewed, or selector-incompatible formula/rule origins.
- Lessons and memories provide default behavior and default parameters. User-provided conversation numbers, counts, rates, or money amounts become `parameterOverrides` only when explicit and high confidence.
- Formula selection is fixed by `formulaCode`; numbers remain adjustable through `defaultParameters` and `parameterOverrides`.
- AI retrieves lessons/memory through backend tools using normalized customer/item/charge context. Tools return bounded reviewed candidates with origin refs; they do not dump all memory into the prompt.
- Steel Admin-reviewed lesson/memory and LibreChat user memory are separate retrieval layers. Admin-reviewed lesson/memory is the site-managed default layer generated from reviewed Steel facts; LibreChat user memory is the current user's custom memory layer.
- LibreChat user memory can override the priority of matching Admin-reviewed defaults for the current user/account, but it must not mutate reviewed Steel facts or published Admin-reviewed lesson/memory.
- Tool output must keep `lessonMemoryCandidates` and `userMemoryCandidates` separately labeled through ranking and validation.
- Quote-time priority is explicit current quote override first, then applicable LibreChat user memory, then Admin-reviewed customer/tier/company defaults.
- AI-selected lesson/memory must be validated again by backend before it becomes `selectedCalculationRule`.
- When a selected lesson/memory comes from an Admin-reviewed customer-scoped default, the assistant response should explicitly mention the applied customer rule.
- AI-selected user memory must be validated again by backend for current user/account ownership, task scope, reviewed formula compatibility, and allowed parameter overrides before it becomes `selectedCalculationRule`.
- "Save as this customer's default" is not a direct memory write. Tool orchestration may create only a structured rule proposal with `needs_review` status; Admin review must approve it before it becomes reviewed rule/default data and later published lesson/memory.
- Do not treat zero unit weight as true zero in Phase 2.
- Include task-scoped material rules only.
- `lookup_processing_price` can be scoped by processing charge type such as `hole`, `slotting`, `bending`, or `processing`; it must not return unrelated processing prices as a silent fallback.

### Calculation Tools

- `allocate_stock_lengths`
- `generate_calculation_plan`
- `calculate_plate_weight`
- `calculate_bar_weight`
- `calculate_cut_count`
- `calculate_cutting_fee`
- `calculate_hole_fee`
- `calculate_slotting_fee`
- `calculate_bending_fee`
- `calculate_line_total`

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
- matching material rules only
- matching Steel Admin-reviewed lesson/memory retrieval packet only
- matching LibreChat user memory retrieval packet for the current user/account only

The AI must not receive:

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
