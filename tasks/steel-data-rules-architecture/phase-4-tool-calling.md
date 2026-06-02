# Phase 4: Tool-Calling Contract

Goal: define how AI retrieves normalized facts and rules without reading raw source files or inventing calculations.

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
- candidate aliases
- low-confidence reasons
- user confirmation state: `use_candidate`, `ask_user`, or `confirm_candidates`

Rules:

- AI may infer likely specs from customer-specific order formats, uploaded evidence, and chat text.
- AI-inferred specs are candidates until backend validation accepts one high-confidence complete candidate.
- If AI confidence is not high, the tool result must ask the user to confirm before pricing.
- If multiple plausible candidates exist, the tool result must present bounded options and wait for user confirmation.
- Missing canonical fields produce a targeted clarification question rather than a guessed price lookup.

### Price And Rule Tools

- `search_price_candidates`
- `rank_price_candidates`
- `lookup_weight_spec`
- `lookup_material_rules`
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
- True-zero charge exceptions come from a selected calculation rule or reviewed business rule, not from product-family hardcoding.
- For the current C-type cutting/hole lesson, AI selects the rule only when the order context supports it; backend tools validate `effect`, matching charge type, and high confidence before accepting true zero.
- True-zero decisions skip remainder calculation only when the selected calculation rule says to do so.
- Lessons and memories provide default behavior and default parameters. User-provided conversation numbers, counts, rates, or money amounts become `parameterOverrides` only when explicit and high confidence.
- Formula selection is fixed by `formulaCode`; numbers remain adjustable through `defaultParameters` and `parameterOverrides`.
- AI retrieves lessons/memory through backend tools using normalized customer/item/charge context. Tools return bounded reviewed candidates with origin refs; they do not dump all memory into the prompt.
- Steel Admin-reviewed lesson/memory and LibreChat user memory are separate retrieval layers. Admin-reviewed lesson/memory is the site-managed default layer generated from reviewed Steel facts; LibreChat user memory is the current user's custom memory layer.
- LibreChat user memory can override the priority of matching Admin-reviewed defaults for the current user/account, but it must not mutate reviewed Steel facts or published Admin-reviewed lesson/memory.
- Tool output must keep `lessonMemoryCandidates` and `userMemoryCandidates` separately labeled through ranking and validation.
- Quote-time priority is explicit current quote override first, then applicable LibreChat user memory, then Admin-reviewed customer/tier/company defaults.
- AI-selected lesson/memory must be validated again by backend before it becomes `selectedCalculationRule`.
- AI-selected user memory must be validated again by backend for current user/account ownership, task scope, reviewed formula compatibility, and allowed parameter overrides before it becomes `selectedCalculationRule`.
- "Save as this customer's default" is not a direct memory write. Tool orchestration may create only a structured rule proposal with `needs_review` status; Admin review must approve it before it becomes reviewed rule/default data and later published lesson/memory.
- Do not treat zero unit weight as true zero in Phase 2.
- Include task-scoped material rules only.

### Calculation Tools

- `allocate_stock_lengths`
- `calculate_plate_weight`
- `calculate_bar_weight`
- `calculate_cutting_fee`
- `calculate_hole_fee`
- `calculate_slotting_fee`
- `calculate_bending_fee`
- `calculate_line_total`

Rules:

- Calculators receive only normalized facts, validated rule outputs, and explicit quote-specific adjustments.
- Calculators never search raw source files.
- Confirmed totals and low-confidence estimates remain separate.
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
