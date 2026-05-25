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

**Guest Mode**:
A deploy-time quote access mode where an unauthenticated customer can return to their own quote conversation, workbook, and export through a conversation-scoped token.
_Avoid_: Admin access, public access to all quotes

**Price Formula**:
The approved calculation rule used to derive a workbook line's unit price and line total.
_Avoid_: AI mental math, unstored calculation

**Workbook Line**:
A persisted quoted order item in the workbook, including its quantity, unit price, line total, formula, and adjustment state.
_Avoid_: Transient tool result, chat-only calculation

**Quoted Unit Price**:
The unit price currently saved on a **Workbook Line**, defaulting from the database unless explicitly adjusted.
_Avoid_: Always-current database price

**Line Total**:
The total price currently saved on a **Workbook Line**, calculated through the **Price Formula** from the quoted line inputs.
_Avoid_: Untraceable discount, manually inconsistent total

**Customer Export**:
The customer-facing workbook output that shows only quote fields approved for the customer.
_Avoid_: Internal review sheet, admin export, source trace

**Import Source Type**:
The admin-selected dataset category that determines which database table an uploaded DOCX/XLSX can update.
_Avoid_: AI-inferred target table, arbitrary upload type

**ERP Customer Code**:
The external ERP identifier used to match an imported customer to an existing customer record.
_Avoid_: Display name, legal name, guessed customer match

**ERP Item Code**:
The external ERP identifier used with customer tier to match an imported price item to an existing price record.
_Avoid_: Product name, spec text alone, guessed item match

## Relationships

- A **Product Alias** maps to exactly one intended **Canonical Product** in a given company context.
- A **Canonical Product** plus partial dimensions can produce one or more **Spec Candidates**.
- A **Preference Rule** can rank **Spec Candidates**, but it does not change formal product/spec data.
- A **Clarification** is required when **Preference Rules** cannot choose a candidate with enough confidence.
- **Guest Mode** applies only to quote conversation, workbook, and export access; Steel admin functions remain admin-only.
- A **Workbook Line** stores the **Price Formula**, **Quoted Unit Price**, and **Line Total** used for that quote line.
- The database unit price is the default input for a new **Quoted Unit Price**, but an explicit customer instruction can adjust either **Quoted Unit Price** or **Line Total**.
- When **Quoted Unit Price** changes, **Line Total** is recalculated through the **Price Formula**; when **Line Total** changes, **Quoted Unit Price** is recalculated for that **Workbook Line**.
- Existing **Workbook Line** prices and quantities remain unchanged across chat rounds unless the customer explicitly asks to update or recalculate that line.
- A **Customer Export** may show the customer-visible **Quoted Unit Price** and **Line Total**, but not customer tier or internal calculation/debug fields.
- An **Import Source Type** is chosen before upload and constrains parsing, merge rows, delete handling, and the final database API commit.
- Admin Import accepts only DOCX/XLSX uploads; PDF/image/text evidence is not a formal Import Source.
- **ERP Customer Code** is the import upsert key for customers.
- **ERP Item Code** plus customer tier is the import upsert key for price items.

## Example dialogue

> **Dev:** "If the customer asks for I 型鋼 200x200 and the database has H 型鋼 200x200 t8 and t12, should we mark one row as default?"
> **Domain expert:** "No. I 型鋼 is a product alias for H 型鋼 here. If the customer says 常用的, Admin can teach a preference rule, but the product rows should stay objective."
>
> **Customer:** "H 型鋼 200x200 多少錢?"
> **AI:** "H 型鋼 200x200 是 t8 嗎？目前查到 t8 是 1000 元、t12 是 1200 元，幣別是 NTD。"
> **Domain expert:** "The AI may show candidate prices while clarifying the missing thickness, but any leading candidate must come from a preference rule or deterministic ranking."
>
> **Customer:** "這一項總價打到 9000."
> **Domain expert:** "Update that workbook line's line total, then recalculate and save the quoted unit price through the related price formula."

## Flagged ambiguities

- "常用的" does not mean a fixed product-table default. It means an admin-taught **Preference Rule** that can vary by product, customer, project, region, or other business context.
- "多少錢" with an incomplete spec is not a single-price question when multiple **Spec Candidates** match. The AI should clarify the missing detail while showing known candidate prices when available.
- **Guest Mode** does not mean anonymous admin access or open access to every quote. It is scoped to the returning customer's own conversation/workbook/export token.
- "permanent workbook data" means the accepted **Workbook Line** calculation is saved in the workbook state, not left only in chat text or a tool result.
- "latest database price" means the default for new pricing or explicit recalculation, not permission to refresh existing workbook prices automatically.
- Customer or item rows without the confirmed ERP key are not guessed updates; they require review.
- "customer-facing Excel" means **Customer Export**, not a full workbook dump.
- Files under `docs/reference/doc` are development references only; production-style data changes enter through Admin import.
