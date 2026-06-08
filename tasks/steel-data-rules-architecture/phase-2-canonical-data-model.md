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

### AI Calculation Context And Subtotal Validation

- Quote arithmetic is performed by AI on the fixed OAuth/Codex path from
  reviewed rule/source prompt context. Backend should not model a parallel
  canonical calculation state.
- Database storage keeps only the latest workbook state. New accepted workbook
  patches overwrite previous current workbook values instead of creating retained
  historical versions.
- `workbook_version` is only a visible update counter and optimistic freshness marker. It is not a historical snapshot key and must not imply old workbook data is retained.
- Backend acceptance validates selected source/rule scope, workbook patch shape,
  and that `summary.totalAmount` / `summary.confirmedAmount` match the sum of
  numeric line `subtotal` values. It does not require hidden hosted-tool or Code
  Interpreter disclosure as proof.
- If additional audit detail needs to be retained, keep it as bounded
  backend-readable response/tool-call summaries or log data linked to the current
  workbook/message/line context. Do not introduce `quote_calculation_state` or
  `quote_calculation_item_audits` as required canonical-calculation tables.
- Python code, raw stdout, container output, hidden-tool metadata, and long JSON
  artifacts must not be written into visible workbook sheets.
- `價格來源` and `判讀備註` may still contain concise human-readable calculation
  summaries, source choices, and assumptions for the user.
- Workbook rows may carry compact calculation/source status; backend reads
  workbook semantic patches when needed to verify subtotal/summary consistency.

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
- Formula versions: source expression/prompt-safe formula text, allowed
  variables, review state, and `source_refs`; AI executes arithmetic from
  reviewed formula/rule context.
- Calculation context and validation summary: provider/model refs,
  message/tool-call refs, workbook/line refs, calculation prompt/source refs,
  selected assumptions, result summary, and subtotal-validation status when this
  is not already covered by existing response/tool-call records.

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
