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
The approved calculation rule or prompt context the AI uses to derive a workbook line's unit price and line total, with backend validation of source scope and workbook subtotal consistency.
_Avoid_: Backend-only calculator, unstored calculation, manually inconsistent total

**Working Order**:
The current AI-assembled order table for a Steel quote conversation, including interpreted line items, customer/tier context, source references, and provisional or accepted calculation facts.
_Avoid_: Quote workbook, raw chat Markdown, tool-result dump

**Working Order Memory**:
Conversation-scoped structured memory of a **Working Order** used to continue multi-turn quoting without requiring the full order table in every prompt.
_Avoid_: Global cache, Admin-reviewed source data, hidden provider state

**Working Order Memory Checkpoint**:
The active **Working Order Memory** state at a chat-turn boundary, used to restore memory when an edited user message reruns from an earlier point.
_Avoid_: Database deletion, full chat replay, global memory version

**Conversation History**:
The persisted user and assistant exchange for one Steel quote conversation, including final assistant text or Markdown and attachment references.
_Avoid_: Browser-local messages, working-order row index, provider OAuth state, activity log

**Message Revision**:
The current replacement text for an edited user chat message, displayed and used for prompt construction while prior text remains only hidden trace metadata when needed.
_Avoid_: Conversation branch, follow-up turn, browser-only overwrite

**Superseded Turn**:
A chat turn after an edited user message that is no longer part of the active transcript or prompt context, while remaining as hidden trace metadata when needed.
_Avoid_: Deleted message, active chat history, conversation branch

**Queued Steer**:
A user correction sent while an AI quote turn is still running, saved for application at the next safe orchestration boundary or follow-up turn.
_Avoid_: Cancellation, hidden prompt injection, lost input

**Workbook Line**:
A persisted quoted order item in the workbook, including its quantity, unit price, line total, formula, and adjustment state.
_Avoid_: Transient tool result, chat-only calculation

**Quoted Unit Price**:
The unit price currently saved on a **Workbook Line**, defaulting from the database unless explicitly adjusted.
_Avoid_: Always-current database price

**Line Total**:
The total price currently saved on a **Workbook Line**, calculated by AI through the **Price Formula** from the quoted line inputs and accepted only when workbook summary totals remain internally consistent.
_Avoid_: Untraceable discount, manually inconsistent total

**Staff Workbook Export**:
The current company-internal XLSX download of one or more workbook sheets from
the quote workbook. It preserves the selected sheet columns and values for
staff review and operational handoff.
_Avoid_: Customer-specific mask, durable share link, formal Admin import

**Customer Export**:
The customer-facing workbook output that shows only quote fields approved for the customer.
_Avoid_: Phase 4 staff workbook download, internal review sheet, admin export,
source trace

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

**Drawing Evidence**:
AI-interpreted facts from quote request drawings, PDFs, images, scanned pages,
and drawing tables, including part tables, dimensions, holes, slots, bends,
cut marks, bolt sizes, and OCR uncertainty.
_Avoid_: Formal source data, confirmed price/spec fact, provider-only memory

**File Analysis Data**:
A legacy user-verifiable extraction workspace from the workbook/file-analysis flow, containing AI-read rows from quote request files with source file, page, and region metadata.
_Avoid_: Working Order Memory, quote workbook, Admin import source, raw OCR dump, hidden provider state

**AI Tool Orchestration**:
The AI-led process that interprets quote request evidence, proposes material/spec candidates, chooses the relevant backend business tools, compares reviewed results, proposes workbook updates, and asks for confirmation when confidence is not high enough.
_Avoid_: Backend-hidden product/price/weight/cutting routing from raw customer text

**Quote-Specific Adjustment**:
A customer-requested change that applies only to the current quote line, such as excluding a charge, using a special price, or adding a surcharge.
_Avoid_: Formal source-data update, hidden override, permanent pricing rule

**Rule Proposal**:
A structured candidate for a reusable customer/material default created from quote evidence and held for Admin review.
_Avoid_: Direct memory write, reviewed rule, automatic customer default

**Quote Default**:
A task-scoped AI retrieval item generated from reviewed database facts such as material rules, calculation defaults, or formula versions.
_Avoid_: Source of truth, unreviewed chat memory, prompt-only business rule

**Quote Rule**:
An Admin-reviewed prompt rule stored in `steel.quote_rules` for category/order-format judgment, specific calculation behavior, or price-calculation guidance after AI has selected a catalog/product-family context.
_Avoid_: Product-name alias rule, customer-specific specification, backend calculator

**Catalog Family Rule**:
An admin-supplied rule prompt stored in `steel.catalog_family_rules` that helps AI infer likely product/category keys and product-name candidates when customer wording, aliases, typos, or partial material descriptions are not enough.
_Avoid_: Backend parser, final product selection, price source, calculation rule

**Customer-Specific Rule**:
An admin-reviewed rule stored in `steel.customer_rules`, tied to a matched customer or customer tier, and returned with customer search context for the AI to consider during quoting.
_Avoid_: Global default, hidden resolver result, direct customer data mutation

**LibreChat User Memory**:
The user's custom memory layer from LibreChat, scoped to that user or account and separate from Steel Admin-reviewed facts.
_Avoid_: Admin-reviewed rule, site-wide default, formal source-data update

**Default Lookup Packet**:
A bounded backend-produced set of reviewed quote-default candidates for the current customer, item, charge type, and formula context.
_Avoid_: Full memory dump, raw prompt memory, unfiltered semantic retrieval, user memory merged into reviewed origins

**Instruction Packet**:
A bounded, reviewed, task-scoped quoting instruction retrieved for the current quote interpretation task, such as material alias expansion, price-before-weight policy, C-type rules, long-material cutting rules, hole/slot/bending interpretation, or workbook-output requirements. Planned storage is `steel.instruction_packets`. `docs/reference/instruction.txt` is the current reference seed for these rules, but runtime should retrieve only relevant packets rather than dump the whole file into every prompt.
The current seed/design baseline is
`tasks/steel-data-rules-architecture/instruction-packets.md`. Packet bodies
injected into AI prompts should be Traditional Chinese; canonical API/schema
keys can remain English.
_Avoid_: Full instruction dump, raw source text search, hard-coded provider prompt rule

**Agent Instruction**:
The Admin-managed default instruction injected into every Steel quote turn before tool use. Storage is `steel.agent_rules`; workbook output policy rules share this table and are distinguished by `rule_type`, `rule_sections`, selectors, and optional `sheet_id`. It tells AI the built-in order-inference workflow: file/OCR handling, raw customer text as evidence, reviewed lookup tool routing, workbook output behavior, confirmation policy, and avoiding raw typo table lookups. Detailed task-specific steel rules can still be retrieved through Instruction Packets or Quote Rules.
The current seed/design baseline is
`tasks/steel-data-rules-architecture/agent-instructions.md`. The prompt body
injected into AI should be Traditional Chinese; canonical API/schema keys can
remain English.
_Avoid_: Code-hardcoded provider prompt, full instruction corpus, one-off task packet, separate `workbook_rules` table

**Workbook Output Tool**:
A legacy provider-facing function tool that let AI propose semantic quote workbook data after it had enough reviewed or provisional quote facts.
_Avoid_: Working Order Memory, reviewed lookup tool, direct DB mutation, raw natural-language workbook edit

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

**Price Code Prefix**:
A short ERP-style price code prefix that groups related formal price rows before AI chooses a specific **Spec Candidate**.
_Avoid_: Final adopted item code, product name, exact spec

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
- A **Working Order** belongs to one Steel quote conversation and may be derived
  from **Quote Request Evidence**, **Drawing Evidence**, reviewed lookup
  results, user corrections, and assistant final Markdown.
- **Working Order Memory** indexes a **Working Order** for row number, ERP item
  code, spec text, customer/tier, source, and calculation retrieval; it does not
  mutate formal source tables.
- A **Working Order Memory Checkpoint** belongs to one **Conversation History**
  turn boundary and defines which memory entries are active for prompt summary
  and memory reads.
- **Conversation History** records the user-visible exchange, while **Working
  Order Memory** provides precise structured retrieval when long Markdown
  tables would be too large or fragile to rely on.
- A **Message Revision** replaces the visible user message content used by
  **Conversation History** and prompt construction; earlier text may be retained
  as hidden trace metadata, but it is not a visible branch.
- A **Message Revision** makes every later active chat turn a **Superseded
  Turn** until a new assistant response is generated from the edited message.
- **Superseded Turns** are excluded from active **Conversation History** replay
  and prompt construction by default.
- When a **Message Revision** reruns from an earlier point, **Working Order
  Memory** is restored to the **Working Order Memory Checkpoint** before that
  user message; memory produced by later **Superseded Turns** is not active.
- Thinking, tool, OCR, memory, and parse activity is not part of **Conversation
  History**; it is last-run UI state only.
- A **Queued Steer** may update the active **Working Order** only after the AI
  applies it in a safe orchestration boundary or follow-up turn.
- Once assistant final answer text has started streaming, a **Queued Steer** is
  deferred to the next follow-up turn rather than mutating the in-progress
  assistant message.
- A Phase 4 **Staff Workbook Export** may download any selected workbook sheets
  for company staff. It does not apply customer-visible masking, customer
  download permissions, or dedicated system-order export logic.
- Phase 4 staff exports are generated from the persisted workbook on demand and
  streamed by the API; a durable stored file or public/shareable export link is
  a later requirement, not the default export source of truth.
- A **Customer Export** may show the customer-visible **Quoted Unit Price** and **Line Total**, but not customer tier or internal calculation/debug fields.
- An **Import Source Type** is chosen before an import/edit session and constrains parsing, merge rows, delete handling, and the final database API commit.
- An **ERP Export XLSX** becomes formal database input only after parser preview, old-data matching, admin review, and a validated transaction commit.
- A **Legacy Office File** may be handled by the AI/provider; server-side conversion to `.xlsx` or `.docx` is only production behavior after a converter proof script succeeds.
- A **Steel Handbook DOCX** is a one-time development schema-design reference, not an ongoing Admin web upload path, reusable product parser, or immediate production-data import.
- **Quote Request Evidence** helps interpret the current order, but it does not update formal customer, product, price, weight, formula, or cutting-price tables by itself.
- **Drawing Evidence** is created from **Quote Request Evidence** and may become
  **File Analysis Data** for user review before it affects quote workbook rows.
- **File Analysis Data** saves the user from manually retyping detected tables,
  but it remains a review/edit dataset until the user confirms and requests
  workbook creation or update.
- If the user asks to re-read or re-interpret a file, AI must have access to the
  original **Quote Request Evidence** again. Previous **File Analysis Data** is
  a review result, not a substitute for the original PDF/image.
- **AI Tool Orchestration** is the core Steel quote runtime framework: AI
  interprets quote evidence, derives steel category/surface/dimensions and
  price query candidates, then chooses among the MVP reviewed lookup tools:
  catalog-family lookup, merged quote-rule lookup, customer search, product-price
  candidate search, and formula lookup. AI chooses among returned options and
  asks the customer to confirm when candidates remain ambiguous.
- Catalog-family lookup returns **Catalog Family Rules** and reviewed vocabulary
  candidates when AI needs help mapping unclear product wording to product,
  product-name, or category keys. Product-name-specific rules belong here, not
  in merged quote-rule lookup.
- Merged quote-rule lookup returns **Instruction Packets**, **Quote Defaults**,
  and **Quote Rules** for the AI-selected product/category context;
  `lookup_instructions` and `lookup_defaults` are internal composition concepts,
  not separate runtime tools.
- Customer search returns customer candidates, tier context, and any
  **Customer-Specific Rules** available for the matched customer.
- Before the merged quote-rule lookup, AI follows the Admin-managed
  **Agent Instruction** from `steel.agent_rules` that is injected into every
  Steel quote turn. It may classify rough task facets and route tool use, then
  retrieve database-backed **Catalog Family Rules**, **Instruction Packets**,
  **Quote Defaults**, **Quote Rules**, and **Customer-Specific Rules** through
  tools.
- Workbook sheet ids, column ids, and visible workbook format stay code-owned in
  the workbook template/service. AI output behavior for writing workbook content
  belongs in `steel.agent_rules` as process/output rules, not in a separate
  workbook table.
- Backend tools validate the AI-chosen tool inputs, reject unsafe raw typo
  lookups, return reviewed source-backed candidates and rule prompts, and
  validate workbook patches and subtotal consistency. Backend code must not
  silently choose the business lookup path, rank final quote candidates, or run a
  parallel quote calculator from raw customer text.
- A **Quote-Specific Adjustment** may override default database prices, material rules, or processing charges for the current **Workbook Line**, but it does not mutate formal source data.
- **LibreChat User Memory** can override the priority of matching Admin-reviewed quote defaults for the current user's workflow, but it remains a user-scoped memory layer and does not mutate reviewed Steel facts.
- **Default Lookup Packets** should keep Admin-reviewed quote-default candidates separate from **LibreChat User Memory** candidates so backend validation can enforce scope, origin, and formula compatibility.
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
- A **Price Code Prefix** can lead to many related **ERP Item Codes** and
  **Spec Candidates**; it helps AI inspect formal rows whose full product names
  may include specifications instead of the Chinese family name.
- **AI Tool Orchestration** may discover a **Price Code Prefix** from a Chinese
  product-name search, then use that prefix to retrieve related formal
  **Spec Candidates** before choosing the most likely quoted item.
- A **Price Code Prefix** is optional discovery evidence. If a Chinese
  product-name/spec search already returns a reviewed **Spec Candidate** that
  matches the request, AI may quote from that row without a prefix expansion.
- Product-price candidate search uses two broad search facets: product-name
  text for the price row product name, and **ERP Item Code** text for exact item
  codes or **Price Code Prefixes**. These facets are OR-style discovery inputs
  so AI can judge candidate rows instead of receiving premature no-match
  results.
- Product-name text includes both Chinese family names and formal specification
  fragments as they appear inside price row product names, such as `75*2.3`,
  `1.2*4'*8'(28.5)`, `4.5*5尺*10尺 (46*101.6)`, or
  `150*75*5/7*6M(84)`.
- When customer wording says C 型鋼, C 鋼, or 輕型鋼 without a material/surface,
  the default product-name candidate is 錏輕型鋼. 黑鐵輕型鋼 and 白鐵輕型鋼 are
  alternatives only when evidence points there or the customer confirms them.
- Missing product-price data is still quote evidence: AI should carry the
  no-data result into the workbook or manual review with confidence and missing
  data notes instead of silently dropping the requested item.
- Chinese labels and headers from `docs/reference` map through **Source Schema Mapping** before they become schema, DTO, tool, or database-query concepts.
- Programmatic lookup uses English **Canonical Schema Keys**; Chinese names, aliases, and original labels may remain as data values, display labels, search aliases, or source text.
- AI API prompt/tool context uses **Source Schema Mapping** to resolve Chinese wording to existing **Canonical Schema Keys**; backend validation rejects unknown keys.
- **ERP Workbook Sheet Names** stay Chinese for workbook/export interoperability even when internal DTO keys and database fields are English.
- **Workbook Field Labels** stay Traditional Chinese, using `docs/reference` XLSX headers where available, even when internal workbook column keys, DTO keys, and patch paths are English.
- A chat message may include multiple **Selected Workbook Targets** when the user has written instructions for multiple marked cells or fields; backend workbook patching still validates each structured target.
- Steel v8.3 is a single-company system. Use **Account Data Privacy** through `userId`, owner checks, admin role/capability checks, and guest-token hashes; do not add tenant or organization scoping.

## Rule Storage And Association

Steel reusable rule prompts are stored in reviewed `steel.*_rules` tables so AI
can retrieve bounded, task-scoped rules through tools instead of receiving a
full prompt dump.

**`steel.agent_rules`** stores always-on process rules. Use it for the default
Agent Instruction, tool-routing order, output policy, and workbook-output flow.
Rows carry `slug`, `version`, `rule_type`, `rule_sections`, optional `sheet_id`,
`selectors`, `prompt`, `tool_policy`, `output_policy`, `priority`,
`confidence`, `source_refs`, lifecycle fields, and optional
`supersedes_rule_id`. Workbook output policy uses this same table; workbook
sheet/column format itself remains code-owned by the workbook template/service.

**`steel.catalog_family_rules`** stores product-name/category inference rules
for `lookup_catalog_families`. Use it for similar product names, aliases, typo
normalization, and hints that help AI choose catalog family keys or product-name
candidates. Rows carry optional `catalog_family`, optional `product_name`,
`product_names`, `aliases`, `selectors`, `prompt`, priority/confidence,
`source_refs`, lifecycle fields, and optional `supersedes_rule_id`.

**`steel.quote_rules`** stores quoting rules for `lookup_quote_rules` after AI
has chosen a catalog/product-family context. Use it for category/order-format
techniques, specific calculation rules, cutting/hole/slot/bending prompts, price
calculation rules, and formula-related quote behavior. Rows carry `scope_type`,
optional `catalog_family`, optional `product_family`, optional `charge_type`,
optional `formula_code`, `selectors`, `parameters`, `prompt`,
priority/confidence, `source_refs`, lifecycle fields, and optional
`supersedes_rule_id`. Do not put product-name alias rules here.

**`steel.customer_rules`** stores customer-specific rules for `search_customers`
after customer matching. Use it for customer/tier-specific specifications,
no-charge behavior, special processing expectations, or customer quote-output
notes. Rows carry optional `customer_id`, optional `customer_tier_id`, optional
`catalog_family`, optional `product_family`, optional `charge_type`, optional
`formula_code`, `selectors`, `parameters`, `prompt`, priority/confidence,
`source_refs`, lifecycle fields, and optional `supersedes_rule_id`.

When AI needs rules, the tool path is:

- Use `lookup_catalog_families` for product/category inference and product-name
  rules. The tool returns reviewed catalog candidates plus `rules[]`.
- Use `search_customers` when customer wording is present. The tool returns
  customer candidates, tier context, and customer `rules[]`.
- Use `lookup_quote_rules` after AI chooses catalog/category facets. The tool
  returns instruction packets, quote defaults, stored quote rules, and unified
  `rules[]`.
- AI reads each returned rule as reviewed prompt/context evidence, but AI still
  selects the applicable option and asks for confirmation when ambiguity remains.

Before an Admin UI exists, when Codex adds or updates rules it must handle
associations automatically:

- First choose the table by purpose: process/workbook flow to
  `agent_rules`; product-name/category inference to `catalog_family_rules`;
  category/order/calculation/price behavior to `quote_rules`; customer-specific
  specs to `customer_rules`.
- Resolve catalog associations against `steel.catalog_families.key`. If the
  rule mentions a product name, alias, typo, or similar name, store it in
  `catalog_family_rules` with `catalog_family` when known, `product_name` for
  the primary name, `product_names` for candidate names, `aliases` for raw
  customer/internal wording, and `selectors` for extra matching context.
- Resolve quote-rule associations with canonical facets only:
  `catalog_family`, `product_family`, `charge_type`, and `formula_code`.
  Product-name filters are not valid quote-rule associations; add those to
  `catalog_family_rules` instead.
- Resolve customer associations by searching `steel.customers`,
  `steel.customer_aliases`, and `steel.customer_tiers`. Store the strongest
  confirmed association as `customer_id`; use `customer_tier_id` only for tier
  rules that intentionally apply to a whole tier. Add optional catalog/charge/
  formula facets only when the rule is scoped that narrowly.
- Resolve agent/workbook-output associations with `slug`, incremented `version`,
  `rule_sections`, `rule_type`, and optional `sheet_id`. `sheet_id` must match a
  code-owned workbook sheet id such as `system_order`, `quote_details`,
  `summary`, `manual_review`, `price_sources`, `interpretation_notes`, or
  `customer_quote`.
- Always write `prompt`, `priority`, `confidence`, `review_state`,
  `source_refs`, and any structured `selectors`/`parameters` needed by AI. Use
  `source_refs` to identify whether the rule came from Admin table maintenance,
  repo docs, ERP workbook review, or another reviewed source.
- For semantic updates, do not overwrite a reviewed active row in place. Insert
  a replacement row, point `supersedes_rule_id` to the old row, and set the old
  row `active = false` with `invalidated_at = now()`. For `agent_rules`, also
  increment `version` for the same `slug`.
- After writing, verify the association through the same repository/tool path
  that AI will use, for example `lookup_catalog_families`,
  `search_customers`, or `lookup_quote_rules`, and record the verification in
  the task notes.

## Example dialogue

> **Dev:** "If the customer asks for I 型鋼 200x200 and the database has H 型鋼 200x200 t8 and t12, should we mark one row as default?"
> **Domain expert:** "No. I 型鋼 is a product alias for H 型鋼 here. If the customer says 常用的, Admin can teach a preference rule, but the product rows should stay objective."
>
> **Customer:** "H 型鋼 200x200 多少錢?"
> **AI:** "H 型鋼 200x200 是 t8 嗎？目前查到 t8 是 1000 元、t12 是 1200 元，幣別是 NTD。"
> **Domain expert:** "The AI may show candidate prices while clarifying the missing thickness, but any leading candidate must come from reviewed candidates, rule prompts, or user confirmation."
>
> **Customer:** "亞L30x30 一支多少？"
> **AI:** Treat `亞L30x30` as quote request evidence, identify possible typo and incomplete spec, propose angle/L steel 30x30 candidates, choose the product-price lookup path for the "一支多少" intent, query reviewed price rows with derived candidates, write only provisional workbook output, and ask the user to confirm from bounded options.
> **Domain expert:** "AI owns the tool choice. Backend validates and guards each tool call; it does not hard-code this raw text into a backend-selected lookup path."
>
> **Customer:** "這一項總價打到 9000."
> **Domain expert:** "Update that workbook line's line total, then recalculate and save the quoted unit price through the related price formula."

## Flagged ambiguities

- "常用的" does not mean a fixed product-table default. It means an admin-taught **Preference Rule** that can vary by product, customer, project, region, or other business context.
- "多少錢" with an incomplete spec is not a single-price question when multiple **Spec Candidates** match. The AI should clarify the missing detail while showing known candidate prices when available.
- Typo/incomplete material text, such as `亞L30x30`, is not a canonical lookup key. AI should propose possible material/spec candidates and choose the relevant tool path; backend tools should reject raw typo table lookups and return source-backed candidates only.
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
- "User memory says otherwise" means a **LibreChat User Memory** priority override for that user, not an Admin-reviewed Steel fact or a site-wide default.
- "0.00" in a source file does not mean free work unless it has been reviewed as a **True Zero Price**.
