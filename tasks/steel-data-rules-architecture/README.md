# Steel Data Rules Architecture Work Package

This package expands Phase 2 into the work needed to turn the company's manual quoting workflow into database-backed facts, material-specific rules, and AI tool-calling contracts.

It complements `tasks/v8.3/phase-2-data-tools.md`. The v8.3 Phase 2 plan remains the implementation roadmap; this package owns the deeper data/rule architecture that is too large to keep inside one phase file.

## Accepted Decisions

- Product-price rows are the first authority for quote price and product-specific unit weight. If reviewed `產品價格.xlsx` data carries unit weight, use that product-price unit weight as the main quote weight for the matching priced item. The handbook remains separate evidence and the authority for general weight/spec lookup when the price source does not provide a reviewed unit weight.
- Material-specific rules are task-scoped. The C-type steel rule is given to the AI only when the current order contains a C-type steel item or a strong C-type candidate.
- H-type steel regular lengths are 6M, 9M, 10M, and 12M. Other normalized H-type lengths automatically receive the +0.3/kg non-standard material surcharge. Cutting remains priced through cutting-price data.
- `切工價錢.xlsx` is a formal cutting-price source. Later Admin updates should maintain it through backend/Admin workflows rather than prompt-only instructions.
- If source prices conflict, product price data wins for product/material/processing price values unless an Admin-reviewed source explicitly supersedes it. Product-price processing/cutting rows override cutting lookup only when they are explicit reviewed chargeable items for the requested work; generic labels, blanks, and `0.00` rows do not override the cutting source.
- Customer inquiry files such as `docs/reference/客戶詢價.rtf` are quote request evidence and parser fixtures. They are not formal Admin import sources because real inquiries may arrive as handwriting, PDF, image, photo, chat text, or mixed attachments.
- Customer chat instructions can create quote-specific adjustments such as no-charge items, special prices, added surcharges, or one-line rule overrides. These adjustments apply to the current workbook line and do not mutate formal source data or material rules.
- Blank or `0.00` price/charge source values are unknown unless Admin review explicitly marks them as true zero price facts. Zero unit weight remains invalid or unknown unless a later source-specific data task proves a legitimate zero-weight business concept.
- Formula and rule selection starts from AI-normalized quote context, such as material family, product family, spec, dimensions, quantity, and processing intent. The AI chooses the reviewed formula/rule/tool path; backend tools validate the selected formula/rule/source and run deterministic calculation.
- C-type free cutting/hole behavior is not a backend product-family hard-code. It is an AI-selected calculation rule, reviewed lesson/memory default, or explicit quote-specific override that backend validation can accept or reject before calculation.
- OpenAI Code Interpreter / AI-written Python can be used as calculation audit evidence, but backend canonical calculation remains the highest-confidence numeric source when backend calculation succeeds. Store full Python code/output in backend-readable audit tables; show only concise AI/backend difference summaries in workbook text sheets.
- Quote calculation audit storage must support multi-item orders: one current order/workbook-level calculation state can have many current item/line audit rows, one per steel material candidate or workbook line.
- Workbook `version` is only a visible update counter/freshness marker. Database storage keeps only the latest workbook and calculation state; old workbook/calculation data is overwritten unless a future history module is explicitly requested.
- Explicit approximate quote requests can use the highest-confidence reviewed product-price candidate to produce a preview estimate even when the user has typos or incomplete specs, as long as assumptions, source refs, and confidence are shown.
- Phase 2 source refs use one canonical `source_refs` JSONB array on quoteable fact rows. Each ref distinguishes source channel, fact category, locator, confidence, canonical key, and optional source version ID. Do not use a lone filename string as provenance.
- High-query and rule-critical fields are typed, not hidden in `metadata`: product-price unit weight, value/review state, material-rule priority/selectors, and formula source/review fields.

## Manual Workflow To System Mapping

| Manual step                                                          | System owner                                                                                                   | AI access                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Receive customer inquiry with partial specs or oral material wording | Conversation files/messages and quote request evidence metadata                                                | Parse through file/text understanding, then call normalized tools                                               |
| Select customer and tier in ERP                                      | `steel.customers`, `steel.customer_aliases`, `steel.customer_tiers`                                            | `lookup_customer`, `search_customers`                                                                           |
| Search material/product in ERP                                       | `steel.price_items`, `steel.price_categories`, source aliases/search terms                                     | `normalize_quote_item`, `generate_price_search_terms`, `search_price_candidates`, `rank_price_candidates`       |
| Enter quantity and calculate by formula/weight                       | `steel.formula_versions`, `steel.weight_specs`, material rules                                                 | `lookup_weight_spec`, `lookup_formula_version`, `lookup_material_rules`, `select_calculation_rule`, calculators |
| Calculate cutting, holes, slotting, bending                          | `steel.cutting_prices`, `steel.hole_prices`, `steel.slotting_prices`, `steel.bending_prices`, processing rules | `lookup_cutting_price`, `lookup_processing_price`, processing calculators                                       |
| Output quote/order workbook                                          | Mongo Steel workbook state and Excel renderer                                                                  | Phase 3 workbook tools, Phase 4 export                                                                          |

## Architecture Layers

1. Source inventory layer
   - Tracks where each fact came from: source channel, fact category, workbook, sheet, row, page, source version, confidence, and review status.
   - Includes structured references to `客戶資料.xlsx`, `產品價格.xlsx`, `公式編號.xlsx`, `切工價錢.xlsx`, `H型鋼.txt`, and handbook-derived reviewed data.

2. Canonical business data layer
   - PostgreSQL tables hold normalized customer, price, weight, formula, processing-price, and source-ref facts.
   - Programmatic keys stay English; Chinese labels remain values, aliases, display labels, and source excerpts.
   - Unknown values stay nullable with explicit value/review state instead of using `0` as a placeholder.

3. Material rule layer
   - Stores company-specific rules that change the normal quoting path for specific material families or conditions.
   - Rules are retrieved only when the normalized quote item matches the material family or condition.

4. Lesson/memory promotion layer
   - Treats lesson and memory entries as generated retrieval surfaces over reviewed database facts, not as the formal source of truth.
   - Lets conversation-specific quote overrides become rule proposals only after explicit user intent, then requires Admin review before they can become customer defaults.
   - Publishes task-scoped lessons/memory from reviewed rows so AI can select formulas and defaults without hard-coded numeric logic.
   - Retrieves lessons/memory through backend typed filters before semantic ranking, returning only bounded reviewed candidates with origin refs.

5. Tool execution layer
   - AI receives compact task-scoped prompt context and calls backend tools.
   - Tool schemas, repository filters, and calculator inputs use canonical English keys.
   - The backend remains authoritative for validation, rule lookup, price choice, calculation, and confidence marking.

6. Workbook/output layer
   - Workbook lines persist the chosen price source, weight source, material rule, quote-specific adjustments, formula, calculation basis, and low-confidence reasons.
   - Customer-facing outputs hide internal tier/debug/source details according to the export allowlist.

## Phase Map

| Phase | File                                     | Exit gate                                                                                                        |
| ----- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0     | `phase-0-decisions.md`                   | Manual workflow decisions are locked and reflected in active docs                                                |
| 1     | `phase-1-source-inventory.md`            | Source files are inventoried with stable source-ref strategy and no raw inquiry import confusion                 |
| 2     | `phase-2-canonical-data-model.md`        | Schema and mapping plan can represent customers, prices, weights, formulas, cutting, processing, and source refs |
| 2A    | `phase-2-schema-delta-plan.md`           | Supabase migration and snapshot changes are reviewed before repository implementation starts                     |
| 3     | `phase-3-material-rules.md`              | C-type, H-type, long-material, cutting, hole, slotting, and bending rules have database-owned contracts          |
| 4     | `phase-4-tool-calling.md`                | AI tools can retrieve only normalized facts/rules and cannot rely on raw source files                            |
| 4A    | `phase-4a-lesson-memory-architecture.md` | Quote overrides can become Admin-reviewed rule proposals before publication as task-scoped lessons/memory        |
| 4B    | `phase-4b-rule-proposal-backend.md`      | Quote conversations can create structured `needs_review` proposals while Admin review UI remains deferred        |
| 4C    | `ai-rule-selection-scenarios.md`         | Concrete AI orchestration scenarios are clear enough to become test fixtures for the C-type quote slice          |
| 5     | `phase-5-admin-maintenance.md`           | Future Admin update flow is scoped for product price, cutting price, formulas, and rules                         |
| 6     | `phase-6-verification.md`                | Manual scenarios prove source precedence, rule selection, and no-zero-price behavior                             |

Use `checkpoints.md` as the implementation tracker when this package becomes active.
