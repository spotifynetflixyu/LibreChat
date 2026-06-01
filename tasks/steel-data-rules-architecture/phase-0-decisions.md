# Phase 0: Decision Lock

Goal: freeze the business decisions that change the Phase 2 data architecture before schema or tool implementation begins.

## Decisions

### D0.1 Product Price Source Priority

Product price data is the first authority for quote price and product-specific unit weight. When reviewed product price data and the handbook disagree on unit weight for the same product-price-derived row, the product price number wins for that quote fact.

The handbook remains the authority for general spec/weight lookup when product price data does not provide a reviewed unit weight.

### D0.2 Task-Scoped Material Rules

Material-specific rules are not global prompt text. The backend should retrieve and provide them only when the normalized quote item matches the rule conditions.

The C-type steel rule is provided only when the order contains a C-type steel item or strong candidate. This keeps the prompt smaller and prevents unrelated materials from accidentally inheriting C-type behavior.

### D0.3 H-Type Surcharge Boundary

H-type non-standard length surcharge changes the material unit price only. It does not replace cutting-price lookup and does not alter cutting fees.

### D0.4 Cutting Price Source

`docs/reference/切工價錢.xlsx` is a formal cutting-price source. Phase 2 may design/import reviewed seed data from it. Later maintenance belongs in Admin backend workflows.

When `產品價格.xlsx` and cutting-price data conflict on a material/processing price, product price data wins for product/material/processing values unless an Admin-reviewed source explicitly supersedes it. Cutting remains the owner for cutting-specific prices when product price has no explicit cutting item.

### D0.5 Quote Request Evidence

Customer inquiry examples such as `docs/reference/客戶詢價.rtf` are evidence/parser fixtures for quote intake. They do not define a formal import source because real inquiries may be handwritten, PDF, image, photo, chat text, or mixed attachments.

## Exit Criteria

- These decisions are reflected in `CONTEXT.md`.
- v8.3 Phase 2 links this package as the detailed data/rule work package.
- Future implementation tasks start from this package rather than re-deriving the manual workflow.
