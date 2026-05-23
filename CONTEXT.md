# Steel Quoting Context

This context defines the business language for the Steel quoting extension. It keeps customer-facing steel terms, admin-taught preferences, and formal database facts separate.

## Language

**Canonical Product**:
The formal product category used by the company for lookup and quoting.
_Avoid_: Raw customer wording, casual product name

**Product Alias**:
A customer or internal nickname that maps to a **Canonical Product**.
_Avoid_: Treating aliases as separate products

**Spec Candidate**:
A formal product/specification row that matches the customer's partially specified request.
_Avoid_: Final answer, guessed spec

**Preference Rule**:
An admin-approved rule that chooses or ranks **Spec Candidates** when customer wording is ambiguous.
_Avoid_: Hard-coded default, product-table `is_default`

**Clarification**:
A targeted follow-up question asking the customer for the missing spec detail needed to choose between **Spec Candidates**.
_Avoid_: Guess, open-ended follow-up

## Relationships

- A **Product Alias** maps to exactly one intended **Canonical Product** in a given company context.
- A **Canonical Product** plus partial dimensions can produce one or more **Spec Candidates**.
- A **Preference Rule** can rank **Spec Candidates**, but it does not change formal product/spec data.
- A **Clarification** is required when **Preference Rules** cannot choose a candidate with enough confidence.

## Example dialogue

> **Dev:** "If the customer asks for I 型鋼 200x200 and the database has H 型鋼 200x200 t8 and t12, should we mark one row as default?"
> **Domain expert:** "No. I 型鋼 is a product alias for H 型鋼 here. If the customer says 常用的, Admin can teach a preference rule, but the product rows should stay objective."
>
> **Customer:** "H 型鋼 200x200 多少錢?"
> **AI:** "H 型鋼 200x200 是 t8 嗎？目前查到 t8 是 1000 元、t12 是 1200 元，幣別是 NTD。"
> **Domain expert:** "The AI may show candidate prices while clarifying the missing thickness, but any leading candidate must come from a preference rule or deterministic ranking."

## Flagged ambiguities

- "常用的" does not mean a fixed product-table default. It means an admin-taught **Preference Rule** that can vary by product, customer, project, region, or other business context.
- "多少錢" with an incomplete spec is not a single-price question when multiple **Spec Candidates** match. The AI should clarify the missing detail while showing known candidate prices when available.
