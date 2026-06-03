# Phase 2: Canonical Data Model

Goal: define the normalized database shape that AI tools can query without reading raw source files.

## Required Data Families

### Customers

- Customer code/source code.
- Display/legal names and aliases.
- Customer tier.
- Contact/project/site hints as matching evidence only.

### Product Prices

- Source item code for import/upsert identity.
- Product name and normalized `spec_key` for search/ranking.
- Customer tier-specific price rows from `售價A/B/C/F`.
- Pricing unit, currency, active/effective range.
- Product-price unit weight as a typed value and unit when reviewed source price data carries a unit weight.
- Value state and review state for prices/charges so unknown values do not become `0`.
- `source_refs` JSONB array and reviewed confidence.

### Handbook Weight Specs

- Product family, shape, dimensions, and general handbook unit weights.
- Additional typed fields only when needed by Phase 2 tools, such as outer diameter, inner diameter, wall thickness, and flange/web thickness.
- Source refs to handbook tables/pages.

### Formulas

- Formula code/version.
- Display name.
- Reviewed source expression plus compiled safe AST/DSL.
- Allowed variables and variable mapping.
- Source refs and review status/confidence.

### Cutting And Processing Prices

- Cutting prices from `切工價錢.xlsx`.
- Product-price-owned explicit reviewed processing/cutting charge items from `產品價格.xlsx`.
- Hole/slotting/bending tables for specialized lookup.
- Tier-specific values where the source has tier columns.
- Adjustment rules and notes as structured rules where confirmed; unclear handwritten notes remain manual-review data.

### Quote Calculation Audit Records

- Backend-readable calculation audit records are split into one current order/workbook-level state and item/line-level audit rows because one customer order can include multiple steel materials.
- Database storage keeps only the latest workbook/calculation state. New accepted workbook patches or recalculations overwrite the previous current state instead of creating retained historical versions.
- `workbook_version` is only a visible update counter and optimistic freshness marker. It is not a historical snapshot key and must not imply old workbook data is retained.
- Each current item audit row links back to one material line with external references such as `conversation_id`, `workbook_id`, `workbook_version`, `sheet_id`, `row_id`, and `item_index`.
- Item audit rows store `calculation_plan`, AI Python / Code Interpreter code, AI execution output, AI numeric result, backend canonical result, comparison status, and structured difference summary for that line.
- Python code, raw stdout, container output, and long JSON artifacts stay in database audit records so workbook layout remains stable.
- `價格來源` and `判讀備註` may still contain concise human-readable AI/backend difference summaries, source choices, and assumptions for the user.
- Workbook rows may carry compact audit references/status; backend reads the current audit tables for detailed comparison and explanation, not for old-version replay.

## Accepted Schema Direction

Phase 2 should produce a schema delta plan before implementation. Do not implement repositories against loose `metadata` contracts when a field is used for lookup, ranking, calculation, or audit.

### Canonical Source Reference Shape

Use `source_refs` as a JSONB array on each quoteable fact row. A normalized `steel.source_refs` table is deferred until source-ref querying becomes necessary.

```json
{
  "channel": "admin_erp_xlsx",
  "factType": "product_price",
  "sourceFile": "docs/reference/產品價格.xlsx",
  "sourceVersionId": "optional-admin-source-version-id",
  "locator": "sheet=Sheet1;row=6",
  "confidence": "high",
  "extractedLabel": "售價A",
  "canonicalKey": "unit_price"
}
```

Rules:

- `channel` describes provenance such as `admin_erp_xlsx`, `admin_table_ui`, `handbook_reviewed_data`, `chat_evidence`, `manual`, or `legacy_normalization_proof`.
- `factType` describes the fact category such as `product_price`, `product_price_unit_weight`, `handbook_weight`, `formula`, `cutting_price`, `processing_price`, `hole_price`, `slotting_price`, `bending_price`, `material_rule`, `workbook_output_format`, or `quote_request_evidence`.
- `quote_request_evidence` refs may support parser interpretation or quote-specific adjustments, but they do not become formal source facts.

### Typed Fields Over Metadata

Typed/indexed fields required before repositories:

- Product price: `product_price_unit_weight`, `product_price_unit_weight_unit`, `value_state`, `review_state`, `source_refs`.
- Cutting/processing/hole/slotting/bending prices: nullable price fields, `value_state`, `review_state`, `source_refs`.
- Material rules: `priority`, lookup selector fields such as `material_family` or condition type, `source_refs`; keep `rule_body` JSONB validated by code per `rule_type`.
- Formula versions: source expression, compiled safe AST/DSL, allowed variables, review state, `source_refs`; calculators execute only the compiled safe form.
- Calculation state: `conversation_id`, `workbook_id`, `workbook_version`, `request_message_id`, provider/model refs, status, and source refs for the current quote state.
- Calculation item audits: `calculation_state_id`, `item_index`, `workbook_id`, `row_id`, material/spec summary, `calculation_plan`, `ai_python_code`, `ai_python_output`, `ai_result`, `backend_result`, `comparison_status`, `difference_summary`, and `source_refs`.

Use `metadata` only for non-query source notes, import details, or extra display/audit context.

## Source Priority Rules

1. User-provided explicit price/rule for the current quote can override as a quote-specific adjustment.
2. Product price data owns product/material/processing prices.
3. Product-price explicit reviewed processing/cutting charge items override cutting-price lookup for that requested work.
4. Cutting-price data owns cutting prices when product price has no explicit reviewed cutting item.
5. Product-price unit weight is the main quote weight when reviewed product price data carries unit weight.
6. Blank or `0.00` price/charge source values are unknown unless Admin review marks them as true zero price facts.
7. Handbook owns general dimensions, specs, and weight lookup when product price does not provide reviewed unit weight.
8. Blank or `0.00` unit weight is invalid or unknown unless a later source-specific data task proves a legitimate zero-weight concept.

## Exit Criteria

- Schema design can represent source-priority decisions without prompt-only rules.
- Every quoteable price/weight/rule fact has a canonical `source_refs` array.
- Product price and handbook facts can disagree without deleting either source's meaning.
- A schema delta plan identifies the exact Supabase snapshot and migration changes required before Phase 2 repository implementation starts. See `phase-2-schema-delta-plan.md`.
