# Use Reviewed Source Priority For Steel Quote Facts

## Status

Accepted.

## Context

Steel quote calculation uses several source families that can describe overlapping facts:

- `產品價格.xlsx` contains material/product prices, customer-tier prices, processing-like rows, and product-price unit weight.
- `切工價錢.xlsx` contains reviewed cutting prices and cutting adjustment notes.
- The steel handbook DOCX contains general dimensions, specs, handbook unit weights, and rule evidence.
- Customer inquiry files and chat text describe the current quote request but are not formal source data.

The risky ambiguity is treating all sources as interchangeable. If product price, handbook weight, and cutting-price evidence conflict, the system needs deterministic behavior that is still traceable and reviewable.

## Decision

Steel quote tools use reviewed source priority:

1. Explicit customer instructions may create quote-specific adjustments for the current workbook line only.
2. Product price data owns material/product/processing prices.
3. Product-price explicit reviewed processing/cutting charge items override cutting-price lookup for that requested work.
4. Cutting-price data owns cutting prices when product price has no explicit reviewed cutting item.
5. Product-price unit weight is the main quote weight when reviewed product price data carries unit weight.
6. Handbook data remains separate evidence and owns general dimensions, specs, and weight lookup when product price does not provide reviewed unit weight.
7. Blank or `0.00` price/charge source values are unknown unless Admin review marks a true zero price.
8. Zero unit weight is invalid or unknown in Phase 2 unless a later source-specific data task proves a legitimate zero-weight business concept.

Phase 2 source refs use a canonical `source_refs` JSONB array on quoteable fact rows. Each ref records `channel`, `factType`, locator, confidence, `sourceVersionId` when available, `extractedLabel`, and `canonicalKey` when applicable.

High-query and rule-critical fields are typed, not hidden in `metadata`: product-price unit weight, value/review state, material-rule priority/selectors, and formula source/review fields.

## Consequences

- Missing values cannot silently become `0`.
- Product-price unit weight can be used for quote calculation without deleting handbook weight evidence.
- Cutting remains deterministic while still allowing explicit reviewed product-price processing/cutting rows to win for the requested work.
- Quote-specific adjustments stay on workbook lines and do not mutate formal source tables.
- Phase 2 schema changes must update both `supabase/schema.sql` and a one-change migration.

## Rejected Alternatives

- Treat handbook weight as globally authoritative over product-price unit weight. Rejected because reviewed product-price rows are closer to the priced item used in actual quoting.
- Treat every `0.00` source value as a confirmed zero price. Rejected because current source files contain blanks, placeholders, and uncertain rows that need review.
- Put all provenance into a single text `source_ref`. Rejected because Phase 2 tools need channel, fact type, locator, confidence, and canonical-key semantics.
- Normalize source references into a separate table immediately. Deferred because `source_refs` JSONB is enough for traceability now, while a table can be added later if source-ref querying becomes product-critical.
