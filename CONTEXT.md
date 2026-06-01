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
The admin-selected dataset category that determines which database table an ERP export XLSX or table-maintenance workflow can update.
_Avoid_: AI-inferred target table, arbitrary upload type, handbook DOCX upload type

**ERP Export XLSX**:
An XLSX file exported from the ERP and uploaded by an admin as formal source data for parser preview, old-data matching, review, and database update.
_Avoid_: Direct ERP connector, customer chat attachment, unreviewed database mutation

**Legacy Office File**:
A pre-OOXML Office file such as `.xls` or `.doc`. The AI/provider may handle it directly, but server-side conversion to `.xlsx` or `.docx` must be proven by a development script before it becomes production behavior.
_Avoid_: Assuming open-source converters are reliable without test evidence, treating legacy conversion as mandatory Phase 1 runtime behavior

**Steel Handbook DOCX**:
The steel handbook DOCX used during development to design and validate the real schema/data model for steel specs, dimensions, weights, and rules. Current source text may contain typos, but code/data-import discussions should use corrected business concepts before any later importable data or SQL is produced.
_Avoid_: Ongoing Admin upload format, reusable runtime parser, price source, direct database mutation, immediate real-data SQL import, typo-preserving import

**Quote Request Evidence**:
Customer-supplied inquiry material used to understand the requested quote, such as chat text, handwritten notes, PDFs, images, photos, RTF samples, or mixed attachments.
_Avoid_: Formal Admin import source, database source of truth, price source

**Quote-Specific Adjustment**:
A customer-requested change that applies only to the current quote line, such as excluding a charge, using a special price, or adding a surcharge.
_Avoid_: Formal source-data update, hidden override, permanent pricing rule

**Product Price Unit Weight**:
The primary unit weight used for a quote when reviewed product price data carries unit weight for the priced item.
_Avoid_: AI-inferred weight, deleting handbook evidence

**True Zero Price**:
An admin-reviewed zero price or charge that means the business intentionally charges zero for that price or processing fact.
_Avoid_: Blank source value, missing price, unreviewed `0.00`, zero unit weight

**Cutting Price Source**:
The reviewed cutting-price dataset used to price cutting work when product price data does not already provide an explicit reviewed chargeable cutting item.
_Avoid_: AI-estimated cutting price, prompt-only cutting table

**Material Rule**:
A company-approved default rule that changes how a material family or matched product candidate is priced, allocated, or processed.
_Avoid_: Global prompt text applied to every item, product-table default, unchangeable quote result

**Source Schema Mapping**:
An agreed mapping from Chinese source labels, headers, and handbook terms to English **Canonical Schema Keys** used by code, APIs, tools, AI API prompts, and database query contracts.
_Avoid_: Treating Chinese source labels as code-owned field names, database column names, tool argument keys, or AI-generated new schema keys

**Canonical Schema Key**:
The English field, key, path, or column name used by programmatic Steel contracts for a mapped business concept.
_Avoid_: Raw Chinese source header, display label, translated-at-query-time field guess

**Source Reference**:
The structured trace that identifies where a formal quote fact, evidence item, or quote-specific adjustment came from, including its source channel, fact category, locator, confidence, and mapped canonical key when applicable.
_Avoid_: Unstructured filename string, raw source-file dump, hidden provenance

**ERP Workbook Sheet Name**:
The Chinese workbook sheet name required by ERP-facing quote workbook output.
_Avoid_: English-only sheet label, translated ERP sheet

**Workbook Field Label**:
The Traditional Chinese label shown for a workbook column or editable field in the UI, workbook preview, and Excel output.
_Avoid_: English internal key, database column, patch path

**Selected Workbook Target**:
One explicit workbook cell or field position the user marks as the target of a chat instruction.
_Avoid_: Vague workbook area, AI-guessed patch target

**Admin Table Maintenance**:
The ongoing admin web workflow that fetches existing database rows and lets an admin preview or edit table data before saving through validated backend APIs.
_Avoid_: File upload requirement, raw database editor, AI-only update

**ERP Customer Code**:
The external ERP identifier used to match an imported customer to an existing customer record.
_Avoid_: Display name, legal name, guessed customer match

**ERP Item Code**:
The external ERP identifier used with customer tier to match an imported price item to an existing price record.
_Avoid_: Product name, spec text alone, guessed item match

**Account Data Privacy**:
The single-company access model where each authenticated account can only access its own Steel quotes/workbooks unless admin permissions apply, and guest access is scoped by conversation token.
_Avoid_: Multi-company tenant model, organization/workspace scoping

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
- An **Import Source Type** is chosen before an import/edit session and constrains parsing, merge rows, delete handling, and the final database API commit.
- An **ERP Export XLSX** becomes formal database input only after parser preview, old-data matching, admin review, and a validated transaction commit.
- A **Legacy Office File** may be handled by the AI/provider; server-side conversion to `.xlsx` or `.docx` is only production behavior after a converter proof script succeeds.
- A **Steel Handbook DOCX** is a one-time development schema-design reference, not an ongoing Admin web upload path, reusable product parser, or immediate production-data import.
- **Quote Request Evidence** helps interpret the current order, but it does not update formal customer, product, price, weight, formula, or cutting-price tables by itself.
- A **Quote-Specific Adjustment** may override default database prices, material rules, or processing charges for the current **Workbook Line**, but it does not mutate formal source data.
- **Product Price Unit Weight** is the main quote weight when present on reviewed product price data; handbook weight remains separate evidence and the general spec/weight reference when product price has no reviewed unit weight.
- A missing or unreviewed `0.00` price is not a **True Zero Price**; tools return `未確認`, a low-confidence estimate, or manual review until an admin confirms the zero-price business fact.
- A **Cutting Price Source** is formal cutting-price data and can be maintained through Admin workflows; cutting fees still remain separate from material unit-price adjustments.
- A **Material Rule** is retrieved task-by-task for matching quote items. For example, the C-type steel rule is used only when the order contains a C-type steel item or strong candidate.
- A **Material Rule** provides the default company behavior for a matched item; a **Quote-Specific Adjustment** can override that behavior for one quote line when the customer explicitly asks.
- A **Source Reference** may point to Admin ERP XLSX data, Admin table maintenance, handbook-reviewed data, material-rule data, or chat evidence, but those channels do not have the same authority.
- **Admin Table Maintenance** fetches database rows through backend APIs and saves reviewed edits through validation and audit.
- Admin ERP import accepts `.xlsx` uploads; legacy `.xls` is only accepted through a tested normalization path. PDF/image/text evidence is not a formal Import Source, and DOC/DOCX remains outside ongoing Admin web import unless a later data-import task approves it.
- **ERP Customer Code** is the import upsert key for customers.
- **ERP Item Code** plus customer tier is the import upsert key for price items.
- Chinese labels and headers from `docs/reference` map through **Source Schema Mapping** before they become schema, DTO, tool, or database-query concepts.
- Programmatic lookup uses English **Canonical Schema Keys**; Chinese names, aliases, and original labels may remain as data values, display labels, search aliases, or source text.
- AI API prompt/tool context uses **Source Schema Mapping** to resolve Chinese wording to existing **Canonical Schema Keys**; backend validation rejects unknown keys.
- **ERP Workbook Sheet Names** stay Chinese for workbook/export interoperability even when internal DTO keys and database fields are English.
- **Workbook Field Labels** stay Traditional Chinese, using `docs/reference` XLSX headers where available, even when internal workbook column keys, DTO keys, and patch paths are English.
- A chat message may include multiple **Selected Workbook Targets** when the user has written instructions for multiple marked cells or fields; backend workbook patching still validates each structured target.
- Steel v8.3 is a single-company system. Use **Account Data Privacy** through `userId`, owner checks, admin role/capability checks, and guest-token hashes; do not add tenant or organization scoping.

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
- The handbook DOCX under `docs/reference` may be used to design the real schema/data model; real handbook data SQL/import work is deferred until after the chat UX path is prioritized and code/data-import discussions have corrected the source concepts.
- Chinese reference materials under `docs/reference` do not justify Chinese code/database/tool field names; they require an agreed **Source Schema Mapping** to English **Canonical Schema Keys** first.
- A workbook badge without sheet and field/cell position is not a clear **Selected Workbook Target**.
- English workbook DTO keys do not justify English UI/export labels; visible workbook field labels should be Traditional Chinese while structured keys remain English.
- ERP export files do not update formal data directly; parser output must be compared with old data and confirmed by an admin before commit.
- The Admin web UI does not need a DOCX upload path for ongoing updates.
- Tenant or organization scoping is over-modeling for this project; per-account privacy is the required boundary.
- C-type steel rules should not be injected into unrelated material prompts; only matching C-type quote items should receive C-type roll-forming behavior.
- H-type regular lengths are 6M, 9M, 10M, and 12M; other H-type lengths receive the non-standard +0.3/kg material surcharge automatically after unit normalization, while cutting remains priced by the cutting-price source.
- "Customer asked for a special case" means a **Quote-Specific Adjustment**, not a change to formal product price, handbook weight, cutting-price, or material-rule data.
- "0.00" in a source file does not mean free work unless it has been reviewed as a **True Zero Price**.
