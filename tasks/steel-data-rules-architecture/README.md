# Steel Data Rules Architecture Work Package

This package expands Phase 2 into the work needed to turn the company's manual quoting workflow into database-backed facts, material-specific rules, and AI tool-calling contracts.

It complements `tasks/v8.3/phase-2-data-tools.md`. The v8.3 Phase 2 plan remains the implementation roadmap; this package owns the deeper data/rule architecture that is too large to keep inside one phase file.

## Accepted Decisions

- Product-price rows are the first authority for quote price and product-specific unit weight. If a reviewed `產品價格.xlsx` row and `龍頂鋼鐵手冊__文字版.docx` disagree on unit weight while organizing source data into the database, use the product-price row's number for that product-price-derived quote fact. The handbook remains the authority for general weight/spec lookup when the price source does not provide a reviewed unit weight.
- Material-specific rules are task-scoped. The C-type steel rule is given to the AI only when the current order contains a C-type steel item or a strong C-type candidate.
- H-type steel non-standard length surcharge adjusts the material unit price only. Cutting remains priced through cutting-price data.
- `切工價錢.xlsx` is a formal cutting-price source. Later Admin updates should maintain it through backend/Admin workflows rather than prompt-only instructions.
- If source prices conflict, product price data wins for product/material/processing price values unless an Admin-reviewed source explicitly supersedes it.
- Customer inquiry files such as `docs/reference/客戶詢價.rtf` are quote request evidence and parser fixtures. They are not formal Admin import sources because real inquiries may arrive as handwriting, PDF, image, photo, chat text, or mixed attachments.

## Manual Workflow To System Mapping

| Manual step                                                          | System owner                                                                                                   | AI access                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Receive customer inquiry with partial specs or oral material wording | Conversation files/messages and quote request evidence metadata                                                | Parse through file/text understanding, then call normalized tools                                         |
| Select customer and tier in ERP                                      | `steel.customers`, `steel.customer_aliases`, `steel.customer_tiers`                                            | `lookup_customer`, `search_customers`                                                                     |
| Search material/product in ERP                                       | `steel.price_items`, `steel.price_categories`, source aliases/search terms                                     | `normalize_quote_item`, `generate_price_search_terms`, `search_price_candidates`, `rank_price_candidates` |
| Enter quantity and calculate by formula/weight                       | `steel.formula_versions`, `steel.weight_specs`, material rules                                                 | `lookup_weight_spec`, `lookup_material_rules`, calculators                                                |
| Calculate cutting, holes, slotting, bending                          | `steel.cutting_prices`, `steel.hole_prices`, `steel.slotting_prices`, `steel.bending_prices`, processing rules | `lookup_cutting_price`, `lookup_processing_price`, processing calculators                                 |
| Output quote/order workbook                                          | Mongo Steel workbook state and Excel renderer                                                                  | Phase 3 workbook tools, Phase 4 export                                                                    |

## Architecture Layers

1. Source inventory layer
   - Tracks where each fact came from: workbook, sheet, row, page, source version, confidence, and review status.
   - Includes structured references to `客戶資料.xlsx`, `產品價格.xlsx`, `公式編號.xlsx`, `切工價錢.xlsx`, `H型鋼.txt`, and handbook-derived reviewed data.

2. Canonical business data layer
   - PostgreSQL tables hold normalized customer, price, weight, formula, processing-price, and source-ref facts.
   - Programmatic keys stay English; Chinese labels remain values, aliases, display labels, and source excerpts.

3. Material rule layer
   - Stores company-specific rules that change the normal quoting path for specific material families or conditions.
   - Rules are retrieved only when the normalized quote item matches the material family or condition.

4. Tool execution layer
   - AI receives compact task-scoped prompt context and calls backend tools.
   - Tool schemas, repository filters, and calculator inputs use canonical English keys.
   - The backend remains authoritative for validation, rule lookup, price choice, calculation, and confidence marking.

5. Workbook/output layer
   - Workbook lines persist the chosen price source, weight source, material rule, formula, calculation basis, and low-confidence reasons.
   - Customer-facing outputs hide internal tier/debug/source details according to the export allowlist.

## Phase Map

| Phase | File                              | Exit gate                                                                                                        |
| ----- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0     | `phase-0-decisions.md`            | Manual workflow decisions are locked and reflected in active docs                                                |
| 1     | `phase-1-source-inventory.md`     | Source files are inventoried with stable source-ref strategy and no raw inquiry import confusion                 |
| 2     | `phase-2-canonical-data-model.md` | Schema and mapping plan can represent customers, prices, weights, formulas, cutting, processing, and source refs |
| 3     | `phase-3-material-rules.md`       | C-type, H-type, long-material, cutting, hole, slotting, and bending rules have database-owned contracts          |
| 4     | `phase-4-tool-calling.md`         | AI tools can retrieve only normalized facts/rules and cannot rely on raw source files                            |
| 5     | `phase-5-admin-maintenance.md`    | Future Admin update flow is scoped for product price, cutting price, formulas, and rules                         |
| 6     | `phase-6-verification.md`         | Manual scenarios prove source precedence, rule selection, and no-zero-price behavior                             |

Use `checkpoints.md` as the implementation tracker when this package becomes active.
