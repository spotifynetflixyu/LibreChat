# Phase 6: Verification Scenarios

Goal: prove the data/rule architecture matches the company's manual quoting workflow before broad Phase 3/4 use.

## Required Scenarios

### C-Type Inquiry

Input: `docs/reference/客戶詢價.rtf`.

Expected:

- Parse `C150*3.0` and line lengths/quantities as C-type quote items.
- Retrieve C-type rule only for these items through canonical alias/family matching or a strong normalized C-type candidate.
- C-type cutting/hole no-charge behavior comes from a configured default rule/lesson/memory selected by AI and validated by backend tools, not from backend product-family hardcoding.
- Use product price first.
- Use finished-length quantity.
- Do not run long-material allocation.
- Do not add general cutting/hole fees by default.
- Workbook records zero cutting/hole fields with the selected C-type default as the reason.

### Product Price Unit Weight Conflict

Input: a reviewed product-price row whose unit weight differs from handbook weight.

Expected:

- Product-price unit weight is used as the main quote weight for the matched quote line.
- Handbook value remains available as separate source evidence.
- Workbook records the source-priority decision.

### H-Type Non-Standard Length

Input: H-type item with a non-standard length.

Expected:

- After unit normalization, any H-type length outside 6M, 9M, 10M, and 12M receives +0.3/kg.
- Cutting fee still comes from cutting-price lookup.
- If the user only says the item should be cut, the quote flow asks whether to cut head, cut tail, use no-head/no-tail, or split-only before confirming cut count.
- Source refs include `H型鋼.txt` rule and cutting-price source when used.

### General Cuttable Material With Remainder

Input: a material that can carry cutting price, needs cutting, and produces a remainder after allocation.

Expected:

- If head/tail trimming is not explicit, the assistant asks before confirmed cut-count calculation.
- When selected rules omit tail trim because there is a remainder, assistant text says `有餘料，切尾不計入`.
- The separation cut between the last finished piece and the remainder remains counted unless an explicit reviewed rule says otherwise.
- Workbook notes preserve the remainder/tail-trim reason.

### Explicit No Cutting

Input: any material where the user says no cutting is needed.

Expected:

- Cutting price lookup and cut-count calculation are skipped.
- Workbook cutting count and cutting fee are patched as `0`.
- Workbook records the no-cut reason, such as `不用切` or `無需切料`.

### Cutting Price Lookup

Input: H-type cutting and black-iron cutting examples.

Expected:

- `切工價錢.xlsx` data is used as formal cutting source.
- Product price explicit reviewed chargeable cutting item still wins when present.
- Generic product-price labels, blank prices, and `0.00` rows do not override cutting lookup.
- Unconfirmed handwritten notes become manual-review reasons, not confirmed charges.

### Missing Or Zero Price

Input: product/cutting rows with missing or zero price.

Expected:

- No confirmed amount is calculated from zero.
- Result shows `未確認` plus nearest reviewed nonzero candidate prices/specs when available.
- The assistant asks the user to confirm one candidate or provide a quote-specific unit price before a confirmed customer-facing total is patched.
- Manual review item includes source refs and impact.

Zero unit weight is not accepted as true zero in these scenarios; it is invalid or unknown unless a later source-specific test names and proves a legitimate zero-weight concept.

### Quote-Specific Adjustment

Input: customer asks that one line not count cutting, use a special price, or add an extra surcharge.

Expected:

- The requested adjustment applies only to the current workbook line.
- The workbook records the customer instruction, reason, adjusted value, and evidence/source refs.
- Formal product price, cutting-price, handbook, formula, and material-rule rows are not changed.

### Applied Customer Default Disclosure

Input: a future Admin-reviewed customer-scoped default says this customer's H-type cutting and hole charges are not counted.

Expected:

- The default is retrieved through scoped lesson/memory or reviewed default lookup only for the matching customer and H-type item.
- The assistant explicitly tells the user the customer default was applied.
- Workbook trace records the selected rule/default origin.

## Exit Criteria

- Focused automated tests cover the rule and source-priority branches.
- Manual scenario notes are recorded in `tasks/todo.md`.
- Phase 3 workbook work can consume this architecture without re-deciding source precedence.
