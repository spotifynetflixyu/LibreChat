# Steel Data Rules Architecture Work Package

This package expands Phase 2 into the work needed to turn the company's manual quoting workflow into database-backed facts, material-specific rules, and AI tool-calling contracts.

It complements `tasks/v8.3/phase-2-data-tools.md`. The v8.3 Phase 2 plan remains the implementation roadmap; this package owns the deeper data/rule architecture that is too large to keep inside one phase file.

## Accepted Decisions

- Core runtime framework: AI owns quote interpretation, business tool
  orchestration, and numeric quote calculation through OpenAI Responses
  code/Python execution. From quote request evidence, it reasons about
  material/spec candidates and decides whether the current step needs reviewed
  rules/defaults, customer, product-price, or formula lookup. The MVP
  AI-callable reviewed rule lookup is `lookup_quote_rules`, which merges
  DB-backed instruction packets and quote defaults for one batched interpreted
  context. Other reviewed lookup tools are `search_customers`,
  `search_price_candidates`, and `lookup_formula`; weight, cutting, processing,
  material-rule, ranking, and quote arithmetic are expressed as reviewed rules
  and prompts for the AI code lane, not backend pricing/calculator modules.
  Backend code must not silently choose a business lookup path from raw customer
  text, and AI reasoning helpers such as quote-item normalization, search-term
  generation, or price ranking must not be exposed as required runtime tools.
- Before `lookup_quote_rules`, AI uses the Admin-managed Agent Instruction that
  is injected into every Steel quote turn. It provides the default workflow/tool
  rules. Detailed inference rules live in database-backed Instruction Packets
  that Admin can update and the AI can retrieve selectively. Retrieval is one
  batched full-facet request per interpreted order context: include all detected
  material families, task types, processing types, formula candidates,
  customer/tier/project context, and low-confidence facets together instead of
  querying each small processing/detail point separately. Related packets are
  organized by stable packet groups/bundles so one lookup can return the
  material's price, formula, cutting, hole, workbook, and confirmation rules
  together.
- Agent Instruction scope includes Steel OCR/file interpretation, reviewed tool
  routing, order-line inference, workbook output policy, confirmation policy,
  and source validation. Generic provider file settings can still use
  `fileAnalysis.instructions`, but Steel order interpretation rules belong in
  the Agent Instruction or task-scoped Instruction Packets. The first Agent
  Instruction seed text lives in
  [`agent-instructions.md`](agent-instructions.md); task-scoped packet design
  lives in [`instruction-packets.md`](instruction-packets.md). Future
  prompt-injected instruction body text should be Traditional Chinese, while
  canonical API/schema keys can remain English.
- Product-price rows are the first authority for quote price and product-specific unit weight. If reviewed `產品價格.xlsx` data carries unit weight, use that product-price unit weight as the main quote weight for the matching priced item. The handbook remains separate evidence and the authority for general weight/spec lookup when the price source does not provide a reviewed unit weight.
- Material-specific rules are task-scoped. The C-type steel rule is given to the AI only when the current order contains a C-type steel item or a strong C-type candidate.
- H-type steel regular lengths are 6M, 9M, 10M, and 12M. Other normalized H-type lengths automatically receive the +0.3/kg non-standard material surcharge. Cutting remains priced through cutting-price data.
- `切工價錢.xlsx` is a formal cutting-price source. Later Admin updates should maintain it through backend/Admin workflows rather than prompt-only instructions.
- If source prices conflict, product price data wins for product/material/processing price values unless an Admin-reviewed source explicitly supersedes it. Product-price processing/cutting rows override cutting lookup only when they are explicit reviewed chargeable items for the requested work; generic labels, blanks, and `0.00` rows do not override the cutting source.
- Customer inquiry files such as `docs/reference/客戶詢價.rtf` are quote request evidence and parser fixtures. They are not formal Admin import sources because real inquiries may arrive as handwriting, PDF, image, photo, chat text, or mixed attachments.
- Customer chat instructions can create quote-specific adjustments such as no-charge items, special prices, added surcharges, or one-line rule overrides. These adjustments apply to the current workbook line and do not mutate formal source data or material rules.
- Blank or `0.00` price/charge source values are unknown unless Admin review explicitly marks them as true zero price facts. Zero unit weight remains invalid or unknown unless a later source-specific data task proves a legitimate zero-weight business concept.
- Formula and rule selection starts from AI-normalized quote context, such as material family, product family, spec, dimensions, quantity, and processing intent. The AI chooses the reviewed formula/rule/tool path and executes numeric calculation through OpenAI code/Python. Backend tools validate selected reviewed facts/source scope, workbook patches, and code-execution evidence; they do not run a parallel canonical quote calculator.
- C-type free cutting/hole behavior is not a backend product-family hard-code. It is an AI-selected reviewed quote default or explicit quote-specific override that is included in the calculation-rule prompt sent to the AI code lane.
- OpenAI Code Interpreter / AI-written Python is the quote calculation lane. Backend must be able to tell that customer-facing numbers came from code execution rather than probabilistic prose; if code-execution evidence is missing, loop/reject before accepting confirmed totals.
- Do not add `steel.quote_calculation_state` or `steel.quote_calculation_item_audits` as backend canonical-calculation tables. If audit storage is later needed, keep it focused on current AI code-execution evidence, source/prompt traceability, and concise human-readable workbook notes, not backend-vs-AI numeric comparison.
- Workbook `version` is only a visible update counter/freshness marker. Database storage keeps only the latest workbook state; old workbook/calculation data is overwritten unless a future history module is explicitly requested.
- Explicit approximate quote requests can use the highest-confidence reviewed product-price candidate to produce a preview estimate even when the user has typos or incomplete specs, as long as assumptions, source refs, and confidence are shown.
- Phase 2 source refs use one canonical `source_refs` JSONB array on quoteable fact rows. Each ref distinguishes source channel, fact category, locator, confidence, canonical key, and optional source version ID. Do not use a lone filename string as provenance.
- High-query and rule-critical fields are typed, not hidden in `metadata`: product-price unit weight, value/review state, material-rule priority/selectors, and formula source/review fields.

## Manual Workflow To System Mapping

| Manual step                                                          | System owner                                                                   | AI access                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Receive customer inquiry with partial specs or oral material wording | Conversation files/messages and quote request evidence metadata                | Parse through file/text understanding; generate candidates in AI reasoning                                                                                   |
| Retrieve quoting interpretation/default rules                        | Reviewed instruction packets plus quote defaults from Admin-managed DB tables  | `lookup_quote_rules` returns task-scoped instruction packets/defaults before candidate expansion                                                             |
| Select customer and tier in ERP                                      | `steel.customers`, `steel.customer_aliases`, `steel.customer_tiers`            | `search_customers` returns exact and ambiguous customer matches                                                                                              |
| Search material/product in ERP                                       | `steel.price_items`, `steel.price_categories`, source aliases/search terms     | AI-generated `candidateQueries` -> `search_price_candidates`                                                                                                 |
| Enter quantity and calculate by formula/weight                       | Reviewed rules/source rows plus OpenAI code/Python execution evidence          | `lookup_formula` and `lookup_quote_rules`; AI code lane performs arithmetic, backend validates evidence/source/workbook patch                                |
| Calculate cutting, holes, slotting, bending                          | Reviewed processing price/rule rows plus OpenAI code/Python execution evidence | `lookup_quote_rules` and `lookup_formula`; AI code lane performs arithmetic, backend validates evidence/source/workbook patch                                |
| Output quote/order workbook                                          | Mongo Steel workbook state and Excel renderer                                  | `patch_quote_workbook` semantic output tool for all AI workbook updates; backend projection creates validated workbook cell operations for workbook services |

## Architecture Layers

1. Source inventory layer
   - Tracks where each fact came from: source channel, fact category, workbook, sheet, row, page, source version, confidence, and review status.
   - Includes structured references to `客戶資料.xlsx`, `產品價格.xlsx`, `公式編號.xlsx`, `切工價錢.xlsx`, `H型鋼.txt`, and handbook-derived reviewed data.

2. Canonical business data layer
   - PostgreSQL tables hold normalized customer, price, weight, formula, processing-price, and source-ref facts.
   - Programmatic keys stay English; Chinese labels remain values, aliases, display labels, and source excerpts.
   - Unknown values stay nullable with explicit value/review state instead of using `0` as a placeholder.

3. Material rule layer
   - Stores company-specific rules that change the normal quoting path for specific material families or conditions.
   - Rules are retrieved only when the normalized quote item matches the material family or condition.

4. Quote defaults layer
   - Treats quote defaults as generated retrieval surfaces over reviewed database facts, not as the formal source of truth.
   - Lets conversation-specific quote overrides become rule proposals only after explicit user intent, then requires Admin review before they can become customer defaults.
   - Publishes task-scoped quote defaults from reviewed rows so AI can select formulas and defaults without hard-coded numeric logic.
   - Retrieves quote defaults through backend typed filters before semantic ranking, returning only bounded reviewed candidates with origin refs.

5. Tool execution layer
   - AI receives compact task-scoped prompt context and calls backend tools.
   - AI chooses the business tool path from its interpreted quote context and user intent; backend does not infer product-price vs weight vs cutting vs rule lookup from raw customer text.
   - AI generates material/spec candidates and price query candidates itself. Runtime tools are for reviewed-row retrieval, scoped quote defaults retrieval, deterministic validation/calculation, and workbook output, not for making AI reasoning steps mandatory.
   - AI may retrieve task-scoped Instruction Packets before candidate generation.
     Instruction Packets are reviewed rules such as price-before-weight,
     material alias expansion, C-type behavior, long-material cutting,
     hole/slot/bending interpretation, and workbook output requirements. They
     are not raw source chunks or a full prompt dump. `lookup_instructions`
     receives the full interpreted order context in one request; it is not a
     per-hole, per-cut, per-slot, or per-line detail lookup loop. Matching
     packet groups should expand together, so rules for the relevant steel
     material are retrieved as one bundle.
   - The Agent Instruction and Instruction Packets are database records seeded
     from sources such as `docs/reference/instruction.txt` and updated through
     Admin backend flows. The Agent Instruction is the default injected every
     turn; Instruction Packets are retrieved selectively.
   - Workbook updates use an output-tool boundary, not the reviewed lookup tool
     boundary. Current `/steel/oauth-chat` exposes only `patch_quote_workbook`
     to AI for workbook updates. AI proposes the adopted semantic quote facts;
     backend projection/validation turns them into workbook operations and
     workbook services persist or reject them.
   - Instruction Packet classification is multi-axis: steel/material family is
     one selector, but task type, product family, surface treatment, processing
     type, formula code, customer/tier/project scope, priority, review state,
     active status, version/supersession, and source refs are also needed.
   - The MVP AI-callable reviewed lookup surface is intentionally small:
     `lookup_instructions`, `search_customers`, `search_price_candidates`,
     `lookup_defaults`, and `lookup_formula`. Exact-customer lookup, spec-price
     lookup, weight lookup, cutting/processing lookup, material-rule lookup,
     formula-version selection, arbitrary source-chunk search, calculation
     primitives, and ranking helpers are backend internal capabilities or future
     extension tools unless a later slice proves they must be exposed.
   - Tool schemas, repository filters, and calculator inputs use canonical English keys.
   - The backend remains authoritative for validation, source-backed lookup execution, deterministic ranking/calculation, confidence marking, audit, and rejection of unsafe raw typo lookups.

6. Workbook/output layer
   - Workbook lines persist the chosen price source, weight source, material rule, quote-specific adjustments, formula, calculation basis, and low-confidence reasons.
   - Customer-facing outputs hide internal tier/debug/source details according to the export allowlist.

## Phase Map

| Phase | File                                                 | Exit gate                                                                                                        |
| ----- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0     | `phase-0-decisions.md`                               | Manual workflow decisions are locked and reflected in active docs                                                |
| 1     | `phase-1-source-inventory.md`                        | Source files are inventoried with stable source-ref strategy and no raw inquiry import confusion                 |
| 2     | `phase-2-canonical-data-model.md`                    | Schema and mapping plan can represent customers, prices, weights, formulas, cutting, processing, and source refs |
| 2A    | `phase-2-schema-delta-plan.md`                       | Supabase migration and snapshot changes are reviewed before repository implementation starts                     |
| 3     | `phase-3-material-rules.md`                          | C-type, H-type, long-material, cutting, hole, slotting, and bending rules have database-owned contracts          |
| 4     | `phase-4-tool-calling.md`                            | AI tools can retrieve only normalized facts/rules and cannot rely on raw source files                            |
| 4A    | `phase-4a-quote-defaults-architecture.md`            | Quote overrides can become Admin-reviewed rule proposals before publication as task-scoped quote defaults        |
| 4B    | `phase-4b-rule-proposal-backend.md`                  | Quote conversations can create structured `needs_review` proposals while Admin review UI remains deferred        |
| 4C    | `ai-rule-selection-scenarios.md`                     | Concrete AI orchestration scenarios are clear enough to become test fixtures for the C-type quote slice          |
| 4D    | `agent-instructions.md` and `instruction-packets.md` | Agent Instruction seed text and task-scoped Instruction Packet design are ready to seed/review                   |
| 5     | `phase-5-admin-maintenance.md`                       | Future Admin update flow is scoped for product price, cutting price, formulas, and rules                         |
| 6     | `phase-6-verification.md`                            | Manual scenarios prove source precedence, rule selection, and no-zero-price behavior                             |

Use `checkpoints.md` as the implementation tracker when this package becomes active.
