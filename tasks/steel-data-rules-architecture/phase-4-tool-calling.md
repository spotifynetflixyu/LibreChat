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

### Price And Rule Tools

- `search_price_candidates`
- `rank_price_candidates`
- `lookup_weight_spec`
- `lookup_material_rules`
- `lookup_cutting_price`
- `lookup_processing_price`

Rules:

- Return product-price unit weight when present.
- Return handbook weight specs separately.
- Include adopted/rejected reasons.
- Do not confirm zero price as valid quote price unless source marks true zero by Admin review.
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

- Calculators receive only normalized facts and validated rule outputs.
- Calculators never search raw source files.
- Confirmed totals and low-confidence estimates remain separate.

## Prompt Context Policy

The AI gets enough context to decide which tool to call next:

- current quote request evidence summary
- known customer/tier facts
- normalized quote item facts
- available tool list
- matching source-schema mapping packet
- matching material rules only

The AI must not receive:

- the entire source-schema mapping for every task
- all material rules for every item
- raw SQL/table names beyond approved tool schema
- raw source-file text as a substitute for repository output

## Exit Criteria

- Tool schemas are provider-neutral.
- Tool results are sanitized and bounded.
- Tool-call logs preserve enough summary, duration, source refs, and error category for audit.
- The Phase 3 prompt bundle can consume these contracts directly.
