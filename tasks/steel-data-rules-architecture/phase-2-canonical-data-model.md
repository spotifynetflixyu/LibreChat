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
- Product-price unit weight override when reviewed source price data carries a unit weight.
- Source refs and reviewed confidence.

### Handbook Weight Specs

- Product family, shape, dimensions, and general handbook unit weights.
- Additional typed fields only when needed by Phase 2 tools, such as outer diameter, inner diameter, wall thickness, and flange/web thickness.
- Source refs to handbook tables/pages.

### Formulas

- Formula code/version.
- Display name.
- Reviewed safe expression or AST/DSL.
- Allowed variables and variable mapping.
- Source ref and review status/confidence.

### Cutting And Processing Prices

- Cutting prices from `切工價錢.xlsx`.
- Product-price-owned explicit processing items from `產品價格.xlsx`.
- Hole/slotting/bending tables for specialized lookup.
- Tier-specific values where the source has tier columns.
- Adjustment rules and notes as structured rules where confirmed; unclear handwritten notes remain manual-review data.

## Source Priority Rules

1. User-provided explicit price/rule for the current quote can override as a quote-specific adjustment.
2. Product price data owns product/material/processing prices.
3. Cutting-price data owns cutting prices when product price has no explicit cutting item.
4. Product-price unit weight wins over handbook unit weight for product-price-derived quote facts.
5. Handbook owns general dimensions, specs, and weight lookup when product price does not provide reviewed unit weight.

## Exit Criteria

- Schema design can represent source-priority decisions without prompt-only rules.
- Every quoteable price/weight/rule fact has source refs.
- Product price and handbook facts can disagree without deleting either source's meaning.
