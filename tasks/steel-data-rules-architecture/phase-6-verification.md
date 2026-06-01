# Phase 6: Verification Scenarios

Goal: prove the data/rule architecture matches the company's manual quoting workflow before broad Phase 3/4 use.

## Required Scenarios

### C-Type Inquiry

Input: `docs/reference/客戶詢價.rtf`.

Expected:

- Parse `C150*3.0` and line lengths/quantities as C-type quote items.
- Retrieve C-type rule only for these items.
- Use product price first.
- Use finished-length quantity.
- Do not run long-material allocation.
- Do not add general cutting/hole fees by default.

### Product Price Unit Weight Conflict

Input: a reviewed product-price row whose unit weight differs from handbook weight.

Expected:

- Product-price unit weight is used for the product-price-derived quote line.
- Handbook value remains available as separate source evidence.
- Workbook records the source-priority decision.

### H-Type Non-Standard Length

Input: H-type item with a non-standard length.

Expected:

- Material unit price receives +0.3/kg.
- Cutting fee still comes from cutting-price lookup.
- Source refs include `H型鋼.txt` rule and cutting-price source when used.

### Cutting Price Lookup

Input: H-type cutting and black-iron cutting examples.

Expected:

- `切工價錢.xlsx` data is used as formal cutting source.
- Product price explicit cutting item still wins when present.
- Unconfirmed handwritten notes become manual-review reasons, not confirmed charges.

### Missing Or Zero Price

Input: product/cutting rows with missing or zero price.

Expected:

- No confirmed amount is calculated from zero.
- Result shows `未確認` or a separate low-confidence estimate from a nonzero candidate.
- Manual review item includes source refs and impact.

## Exit Criteria

- Focused automated tests cover the rule and source-priority branches.
- Manual scenario notes are recorded in `tasks/todo.md`.
- Phase 3 workbook work can consume this architecture without re-deciding source precedence.
