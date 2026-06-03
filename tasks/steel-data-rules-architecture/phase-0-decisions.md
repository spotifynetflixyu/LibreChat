# Phase 0: Decision Lock

Goal: freeze the business decisions that change the Phase 2 data architecture before schema or tool implementation begins.

## Decisions

### D0.1 Product Price Source Priority

Product price data is the first authority for quote price and product-specific unit weight. When reviewed product price data carries unit weight, that product-price unit weight is the main quote weight for the matching priced item.

The handbook remains separate evidence and the authority for general spec/weight lookup when product price data does not provide a reviewed unit weight. Product price and handbook weight facts must be able to coexist with separate source refs.

### D0.2 Task-Scoped Material Rules

Material-specific rules are not global prompt text. The backend should retrieve and provide them only when the normalized quote item matches the rule conditions.

The C-type steel rule is provided only when the order contains a C-type steel item or strong candidate. This keeps the prompt smaller and prevents unrelated materials from accidentally inheriting C-type behavior.

### D0.3 H-Type Surcharge Boundary

H-type regular lengths are 6M, 9M, 10M, and 12M. After length normalization, other H-type lengths automatically receive the non-standard length surcharge.

The H-type non-standard length surcharge changes the material unit price only. Current source evidence defines it as +0.3/kg. It does not replace cutting-price lookup and does not alter cutting fees.

### D0.4 Cutting Price Source

`docs/reference/切工價錢.xlsx` is a formal cutting-price source. Phase 2 may design/import reviewed seed data from it. Later maintenance belongs in Admin backend workflows.

When `產品價格.xlsx` and cutting-price data conflict on a material/processing price, product price data wins for product/material/processing values unless an Admin-reviewed source explicitly supersedes it.

Product-price rows override cutting-price lookup only when they are reviewed, explicit chargeable processing/cutting items for the requested work. Generic labels, blank prices, and `0.00` rows do not override `切工價錢.xlsx`; they produce `未確認`, a nonzero low-confidence candidate, or manual review.

Cutting remains the owner for cutting-specific prices when product price has no explicit reviewed cutting item.

### D0.5 Quote Request Evidence

Customer inquiry examples such as `docs/reference/客戶詢價.rtf` are evidence/parser fixtures for quote intake. They do not define a formal import source because real inquiries may be handwritten, PDF, image, photo, chat text, or mixed attachments.

### D0.6 Quote-Specific Adjustments

The database and material rules provide default quote behavior, not an unchangeable result. During the chat, the customer may explicitly request quote-specific adjustments such as excluding certain charges, using a special price, applying an additional surcharge, or overriding a default material rule for one line.

Quote-specific adjustments must be stored on the affected workbook line with the customer instruction, reason, and source/evidence refs. They do not mutate formal product price, handbook weight, cutting-price, formula, customer, or material-rule data.

### D0.7 Unknown Or True Zero

Blank or `0.00` price, cutting, or processing charge values are unknown by default. They become true zero prices or charges only when Admin review explicitly marks them as real zero-price business facts.

Zero unit weight is not part of the true-zero shortcut. A blank, missing, or `0.00` unit weight remains invalid or unknown unless a later source-specific data task proves and names a legitimate zero-weight business concept.

### D0.8 AI-Led Tool Orchestration

AI owns quote interpretation and business tool orchestration. It reads quote request evidence, proposes material/spec candidates, chooses the relevant backend business tools, compares reviewed results, proposes workbook updates, and asks for confirmation when confidence is not high enough.

Backend tools own validation, source-backed lookup execution, deterministic
ranking/calculation, audit, and guardrails. Backend code must not silently
choose product-price, customer, quote-default, formula, or workbook output paths
from raw customer text. Weight, cutting, processing, material-rule, ranking,
and calculator details are backend internal capabilities unless a later slice
explicitly exposes them.

## Exit Criteria

- These decisions are reflected in `CONTEXT.md`.
- v8.3 Phase 2 links this package as the detailed data/rule work package.
- Future implementation tasks start from this package rather than re-deriving the manual workflow.
