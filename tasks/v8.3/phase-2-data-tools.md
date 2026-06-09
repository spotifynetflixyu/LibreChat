# Phase 2: Quote Data And Tools

Goal: make Steel backend business tools source-backed while preserving AI-led
quote orchestration and AI-owned quote calculation. AI chooses the business tool
path from normalized quote context and user intent, then performs numeric quote
calculation on the fixed OAuth/Codex path from reviewed prompt context. Backend
tools query reviewed repositories, validate inputs, sanitize outputs, reject unsafe raw
lookups, validate subtotal/summary consistency for numeric totals, and handle ambiguity
according to `CONTEXT.md` and
`steel_librechat_plan_v8.3_openai_oauth_responses_primary.md`.

Detailed data/rule architecture for the company's manual quoting workflow lives in [`../steel-data-rules-architecture/README.md`](../steel-data-rules-architecture/README.md). Treat that package as the Phase 2 companion plan for source priority, material-specific rules, source refs, tool-calling boundaries, and Admin maintenance scope.

## Scope

- Supabase read repositories for customers, aliases, tiers, prices, weight specs, processing/cutting/hole/slotting/bending prices, formulas, orders, and source chunks.
- Use steel handbook DOCX contents to design and validate the real schema/data model shape, without implementing real handbook data SQL import yet.
- Source schema mapping from Chinese `docs/reference` labels/headers/terms to English canonical schema keys used by spec, price, formula, processing-price, tool, AI API prompt context, and database query contracts.
- AI-led material/spec candidate generation. Backend provides guardrails and
  `lookup_catalog_families` rule prompts when AI needs help with product/category
  inference.
- Customer search with tier context and customer-specific rules.
- Product price candidate search; AI chooses/ranks returned options and asks the
  user to confirm when candidates remain ambiguous.
- AI calculation lane using reviewed formula/rule/source prompt context returned
  by tools.
- AI-selected formula/rule orchestration over reviewed backend data, with backend
  source/rule and subtotal/summary validation before accepting numeric workbook
  results.
- Summary/subtotal consistency checks so internally inconsistent numeric quote
  output does not become a confirmed workbook total.
- No required `quote_calculation_state` or `quote_calculation_item_audits`
  backend canonical-calculation tables.
- Current-only workbook/calculation persistence: `version` is a visible update counter/freshness marker, while accepted updates overwrite latest database state instead of retaining historical workbook versions.
- Quote-specific adjustment handling for customer-requested no-charge, special-price, surcharge, or one-line rule override instructions.
- Tool registry with Zod-validated business tools for both `openai_oauth_responses` and explicitly selected `openai_api` driver runs.
- Tool call logging and prompt-injection filtering.

## Milestone 2.1: Supabase Read Repositories

Files:

- Create `packages/api/src/steel/repositories/customers.ts`
- Create `packages/api/src/steel/repositories/prices.ts`
- Create `packages/api/src/steel/repositories/weights.ts`
- Create `packages/api/src/steel/repositories/processing.ts`
- Create `packages/api/src/steel/repositories/orders.ts`
- Create `packages/api/src/steel/repositories/sources.ts`
- Create `packages/api/src/steel/repositories/formulas.ts`
- Create `packages/api/src/steel/repositories/types.ts`
- Add focused tests under `packages/api/src/steel/repositories/*.spec.ts`

Tasks:

- Use parameterized SQL only.
- Return typed rows with explicit nullable fields.
- Keep table names in repository modules, not tool handlers.
- Filter `active = true` by default for prices/rules.
- Include canonical `source_refs` for `context_refs`, quote trace, and audit.
- Preserve pricing unit; do not convert unit type in repository layer.
- Preserve source refs needed to distinguish product-price unit weight, handbook weight, cutting price, material rule, and quote-specific adjustment evidence.

Acceptance:

- Repository tests cover exact match, no match, inactive exclusion, multiple candidates, and source refs.
- Query results include enough fields for price candidate ranking and traceability.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/repositories/.*\\.spec\\.ts$"
rtk npm run build:api
```

## Milestone 2.1A: Handbook Schema Design Boundary

Tasks:

- Inspect/organize steel handbook DOCX contents to identify schema needs for specs, dimensions, weights, material rules, handbook notes, and source chunks.
- Build and extend `tasks/v8.3/source-schema-mapping.md` for Chinese labels/headers/terms found in `docs/reference`.
- For each mapped concept, record Chinese source label/header, English canonical key, target database surface, type/unit, normalizer, and source reference.
- Use the mapping to design real Supabase tables/columns and shared DTO fields when the handbook reveals a missing business concept.
- Do not add a correction approval workflow to the mapping; when source text has typos, map the corrected business concept that code/data-import agents should use.
- Keep programmatic query contracts English-only: repository filters, SQL column names, DTO keys, and tool argument names use canonical English keys.
- Preserve Chinese values as source/display/search data where useful, including aliases, original source labels, product names, ERP workbook sheet labels, and source excerpts.
- Treat fixed workbook sheet names as Chinese ERP-facing output labels, not database schema keys.
- Treat `docs/reference/公式編號.xlsx` as the preferred formula structure reference. The CSV copy has an encoding/readability caveat; calculator runtime data should come from reviewed app-ready JSON or database rows.
- Ensure mock data shaped from Chinese references uses English DTO/API keys and Chinese only as values or display/source labels.
- Design the code-owned mapping module at `packages/api/src/steel/schema/mapping.ts` and focused tests at `packages/api/src/steel/schema/mapping.spec.ts`.
- Design a prompt serializer that teaches Steel AI providers the allowed source-label-to-canonical-key mapping without exposing raw SQL access.
- Do not create reusable handbook parser modules under `packages/api`.
- Update the first-pass Supabase schema/data model only when the handbook content proves a missing structure.
- Defer real handbook data SQL/import implementation until after chat UX and workbook vertical slice work.
- Keep ongoing Admin web routes free of DOCX upload paths.

Acceptance:

- Phase 2 schemas can represent handbook-style specs/rules/source refs when data exists, using corrected canonical concepts rather than typo-preserved source fields.
- Chinese source references have an agreed mapping to English canonical schema keys before their fields are used by code or database queries.
- Code mapping design exists for backend prompt/tool/schema use.
- Repository/tool/prompt contracts and tests use English keys while still supporting Chinese aliases/source values through normalization/search data.
- AI provider mapping behavior is specified: unknown source labels produce clarification/manual review, not invented canonical keys.
- The codebase does not expose a handbook DOCX parser tool or route.
- No real handbook data SQL/import is required to start chat UX development.
- Any schema change still updates both `supabase/schema.sql` and a one-change migration.
- Schema delta planning uses typed/indexed fields for product-price unit weight, value/review state, rule priority/selectors, formula source/review shape, and `source_refs`.

Verification:

```bash
rtk npm run build:api
```

## Milestone 2.2: AI-Led Catalog Family Rule Guidance

Files:

- Use existing `packages/api/src/steel/repositories/families.ts`
- Use existing `packages/api/src/steel/tools/registry.ts`
- Use existing `packages/api/src/steel/tools/execute.ts`
- Add or update focused tests under `packages/api/src/steel/tools/*.spec.ts`

Tasks:

- Keep AI-led tool orchestration as the core framework. Backend tools expose
  table-specific capabilities and guardrails; they do not silently choose
  product-price, customer, quote-default, formula, or workbook output paths from
  raw customer text.
- Do not build a backend material/spec parser, resolver, or normalization
  dictionary as a Phase 2 implementation slice.
- AI autonomously interprets quote evidence and proposes product/category/spec
  candidates.
- When AI inference is insufficient, it calls `lookup_catalog_families` to get
  admin-supplied catalog-family/product-name inference rules and reviewed
  vocabulary candidates.
- `lookup_catalog_families` output must help AI choose catalog keys for later
  `lookup_quote_rules` and `search_price_candidates` calls, or ask the user for
  confirmation.
- Backend still rejects unsafe raw typo table lookups; raw customer text remains
  quote evidence, not a canonical product/spec key.

Acceptance:

- AI-owned alias/spec interpretation produces candidates, not exact-match claims.
- `lookup_catalog_families` can return admin-supplied inference rule prompts and
  reviewed vocabulary candidates.
- Unknown thickness/material/length/unit/surface treatment lowers confidence.
- Uncertain AI interpretation asks the user or returns options for confirmation.
- Multiple plausible AI/spec candidates are presented for user confirmation
  instead of silently selecting one.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(repositories|tools)/(families|execute|registry).*\\.spec\\.ts$"
```

## Milestone 2.3: Customer Search And Customer-Specific Rules

Files:

- Use existing `packages/api/src/steel/repositories/customers.ts`
- Use existing `packages/api/src/steel/tools/execute.ts`
- Add or update focused customer tool tests under `packages/api/src/steel/tools/*.spec.ts`

Tasks:

- Match customers by display name, legal name, alias, and common project/site
  data through `search_customers`.
- Return tier from `steel.customers`, `steel.customer_aliases`, and
  `steel.customer_tiers`.
- Return customer-specific rules/defaults when a matched customer has reviewed
  applicable quote rules.
- Return candidates when multiple customers match.
- Do not create a separate backend customer resolver that chooses for AI.

Acceptance:

- Exact customer match returns tier.
- Alias match records alias evidence.
- Customer-specific rules/defaults are exposed as bounded reviewed tool output,
  not as hidden backend behavior.
- Multi-match returns candidates and does not guess.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(repositories|tools)/(customers|execute).*\\.spec\\.ts$"
```

## Milestone 2.4: Price Candidate Search

Files:

- Use existing `packages/api/src/steel/repositories/prices.ts`
- Use existing `packages/api/src/steel/tools/execute.ts`
- Do not create backend canonical quote decision/calculation modules such as
  `packages/api/src/steel/pricing/decision.ts` for runtime arithmetic; if the
  existing module remains temporarily, quarantine it as superseded validation
  policy until removed.
- Add or update focused price-candidate tool tests under
  `packages/api/src/steel/tools/*.spec.ts`

Tasks:

- Accept AI-generated candidate queries from interpreted quote evidence.
- Search material and processing tables.
- Support exact, major, alias, closest-estimate, and no-price result types.
- Return bounded options with source refs, confidence, missing/zero markers, and
  rejected reasons.
- AI ranks/selects returned candidates and asks the user to confirm when
  candidates remain ambiguous.
- Preserve candidate differences and rejected reasons.
- Enforce price-before-weight.
- Use product-price unit weight as the main quote weight when reviewed product price data carries unit weight; keep handbook weight as separate evidence.
- Never fill missing price with `0`.
- Treat blank or `0.00` values from `產品價格.xlsx` as unknown/missing price, not free price.
- Confirm zero cutting/hole/processing charges only through an AI/memory/admin selected calculation rule or reviewed business rule; do not infer true-zero from product family in code.
- The current C-type cutting/hole free-charge behavior is a selectable calculation rule/lesson; when selected with high confidence, it can mark the charge true zero and skip remainder calculation.
- The C-type cutting/hole free-charge rule must be configured as a quote default or reviewed rule fixture before AI can select it; backend code must not create the no-charge behavior from C-type product family alone.
- Formula selection starts from AI-normalized material/spec context and reviewed `steel.formula_versions` rows. For example, `docs/reference/公式編號.xlsx` maps formula code `C` to `C型鋼`, but runtime tools use reviewed database rows rather than reading the spreadsheet.
- Backend validation checks AI-selected `formulaCode` and
  `selectedCalculationRule`; it does not hard-code C-type free cutting or hole
  behavior by product family.
- Treat quote defaults/admin rule parameters as defaults. User-provided conversation numbers or amounts can override adjustable parameters when the override is explicit and high confidence.
- Keep formula identity fixed through `formulaCode`; keep numeric values adjustable through `defaultParameters` and `parameterOverrides`.
- AI must retrieve matching quote defaults through backend tools using normalized customer/item/charge context. Retrieval returns bounded reviewed candidates with origin refs, not the whole memory corpus.
- Do not persist conversation overrides as customer defaults directly. "Save as customer default" must create a reviewed rule proposal for Admin approval first; only approved database facts can publish quote defaults.
- Do not treat zero unit weight as true zero in Phase 2.
- Never convert incompatible unit pricing, e.g. kg to piece, piece to kg, cut to M, hole to piece.

Acceptance:

- `黑圓管48.1` searches 48.3 and 1 1/2 variants.
- Missing thickness returns candidates and low confidence.
- Product price `0` becomes `未確認` / no-price even when a C-type rule exists; non-product zero charges need selected calculation-rule evidence before they can become true zero.
- Missing or zero material price can return nearest reviewed nonzero price/spec candidates. The assistant asks the user to confirm one candidate or provide a quote-specific unit price before producing a confirmed customer-facing total.
- When the user explicitly asks for an approximate quote and the highest-confidence reviewed candidate is clearly source-backed, the assistant may provide a preview estimate with assumed spec and low-confidence reason, even when the input has typos or incomplete dimensions.
- A user saying a custom unit price or amount can produce a high-confidence `parameterOverride`; uncertain overrides ask the user to confirm first.
- Fully matched row uses that row's pricing unit.
- Multiple usable price candidates are presented to the user for confirmation instead of silently selected; for quick `一支多少` requests, the assistant may lead with the highest-confidence source-backed candidate as a provisional quote while still listing the other plausible options.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(repositories|tools)/(prices|execute).*\\.spec\\.ts$"
```

## Milestone 2.5: Processing And Cutting Rule Prompts

Files:

- Use `lookup_quote_rules` instruction/default packets.
- Use `search_price_candidates` for reviewed processing-price rows when needed.
- Add or update focused tool/provider tests only if returned rule prompts are
  missing or unclear.

Tasks:

- Do not create a standalone stock allocation or cut-allocation backend module in
  Phase 2.
- Provide cutting, stock-length, no-cut, head/tail, hole, slotting, and bending
  rule prompts through `lookup_quote_rules` when relevant.
- AI calculates cutting/allocation quantities from those rule prompts and
  reviewed source rows.
- Backend validates source/rule scope and workbook subtotal consistency only.

Acceptance:

- Relevant cutting/allocation rules are available through `lookup_quote_rules`
  for the interpreted product/category context.
- AI may calculate cut/allocation quantities, but confirmed workbook totals must
  still pass source/rule validation and subtotal consistency.
- Low-confidence reasons are present when AI uses an assumption such as unknown
  stock length.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/tools/execute\\.spec\\.ts$"
```

## Milestone 2.6: Workbook Subtotal Validator

Files:

- Create `packages/api/src/steel/workbook/subtotals.ts`
- Add tests under `packages/api/src/steel/workbook/subtotals.spec.ts`

Tasks:

- Extract the existing provider subtotal/summary consistency check into a shared
  workbook helper.
- For every material that can carry cutting price, if cutting is needed and head/tail trimming is not explicit, the assistant must ask before confirmed cutting fee calculation.
- If a remainder omits tail trim, assistant text and workbook notes must say `有餘料，切尾不計入`.
- If cutting is not needed, workbook still records zero cutting count/fee with the no-cut reason.
- Validate workbook totals by checking that `summary.totalAmount` matches the
  sum of line `subtotal` values after source/rule validation. Concise
  calculation/source summaries may appear in `價格來源` or `判讀備註`.
- Support future Admin-reviewed prices for non-round hole types such as oval, long, rectangular, and custom holes even when the current source price row is `0` or missing during development.
- Keep confidence/provisional status on quote lines, review rows, notes, or
  customer_quote notes instead of separate summary amount fields.
- Use `未確認`, not `0`, for unknown unit price or amount.
- Record formula code/version and calculation basis for workbook lines.
- Validate and normalize explicit quote-specific adjustments after default
  price/rule resolution. AI may use explicit adjustments during calculation, but
  Phase 2 does not persist workbook mutation beyond accepted workbook state.

Canonical quote adjustment object:

```ts
interface SteelQuoteAdjustment {
  adjustmentType: 'no_charge' | 'special_price' | 'surcharge' | 'material_rule_override';
  target: {
    lineId?: string;
    chargeType?:
      | 'material'
      | 'cutting'
      | 'hole'
      | 'slotting'
      | 'bending'
      | 'processing'
      | 'line_total';
    fieldKey?: string;
  };
  amount?: number;
  unit?: 'TWD' | 'TWD_PER_KG' | 'percent' | string;
  instruction: string;
  reason?: string;
  sourceRefs: SteelSourceRef[];
  confidence: 'high' | 'medium' | 'low';
  manualReviewRequired: boolean;
}
```

The adjustment object is evidence for calculation and later workbook persistence. It is not a formal source-data update.

Acceptance:

- Cutting fee handles no-head/no-tail, repair head/tail, split/multi-piece count, and remainder-tail behavior correctly.
- Hole fee ignores center/dimension/hidden lines, R corners, bend lines, cut-angle markers, and welding symbols.
- Hole fee handles `4-Ø22` style notation as per-piece hole count multiplied by item quantity.
- Hole fee handles oval/long/rectangular/custom non-round hole types through reviewed price lookup or returns `未確認` when no reviewed price exists.
- Slotting fee uses continuous slot paths, including straight, L, U/ㄇ, and disconnected multi-path totals.
- Slotting fee does not treat a normal outside profile or ordinary plate edge as slotting without explicit evidence.
- Bending fee counts direction changes, not dimension lines.
- Line total separates confirmed and low-confidence estimated fees.
- Special-price, no-charge, surcharge, and rule-override inputs affect only the current workbook line calculation and do not mutate source tables.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(ai|workbook)/(provider|subtotals).*\\.spec\\.ts$"
```

## Milestone 2.7: Tool Registry

Files:

- Create `packages/api/src/steel/tools/registry.ts`
- Create `packages/api/src/steel/tools/schemas.ts`
- Create `packages/api/src/steel/tools/execute.ts`
- Create `packages/api/src/steel/tools/results.ts`
- Create `packages/api/src/steel/tools/sanitize.ts`
- Add tests under `packages/api/src/steel/tools/*.spec.ts`

Allowed MVP runtime tools:

- `lookup_catalog_families`
- `lookup_quote_rules`
- `search_customers`
- `search_price_candidates`

MVP flow:

1. AI starts from the Admin-managed Agent Instruction injected into every Steel
   quote turn, not from a code-hardcoded provider prompt. The Agent Instruction
   says raw customer text is evidence and tells AI when to call
   `lookup_catalog_families` for unclear product/category inference and
   `lookup_quote_rules` before applying detailed material/spec/process rules or
   reviewed defaults.
2. AI judges the order's steel category, likely material/product family,
   surface treatment, dimensions, quantity, and missing fields from quote
   evidence.
3. AI calls `lookup_catalog_families` when product/category inference is
   insufficient. The tool returns admin-supplied catalog-family/product-name
   inference rules and reviewed vocabulary candidates so AI can pick catalog
   keys for later tool calls or ask the user to confirm bounded options.
4. AI calls `lookup_quote_rules` when it needs task-scoped quoting rules or
   reviewed quote defaults for candidate generation, such as
   `docs/reference/instruction.txt` derived price-before-weight policy, material
   alias expansion, C-type rules, long-material cutting behavior,
   hole/slot/bending interpretation, defaults, or workbook output requirements.
   The tool returns bounded reviewed instruction packets plus quote defaults,
   not the full instruction/default corpus. The request is batched by
   interpreted order context: include all detected material families, task
   types, processing types, formula candidates, customer/tier/project context,
   and low-confidence facets together. Do not query rule/default packets
   separately for hole count, cut count, slotting path, bending, formula, or each
   small material-line detail unless later user input materially changes the
   context. The lookup
   should expand matching packet groups, such as `h-type-quote-core`,
   `c-type-quote-core`, `angle-zinc-quote-core`, `plate-processing-core`, and
   `workbook-output-core`, so one call returns the related price/formula/
   cutting/hole/workbook rules needed by the detected context.
5. AI generates bounded product-price `candidateQueries`, such as
   `錏成型角鐵 30x30`, `鍍鋅角鐵 30x30`, or `角鐵 30x30`, instead of passing raw
   typo text to backend lookup.
6. Backend tools return reviewed catalog-family rules, quote rules/defaults,
   customer candidates/customer-specific rules, and price candidates with
   source refs, confidence, missing/zero markers, and bounded alternatives.
7. AI chooses the most credible calculation path from returned facts, explains
   assumptions/options, and produces a provisional workbook patch. Confirmed
   customer-facing totals require sufficient reviewed facts or user
   confirmation.

Instruction packet storage:

- Instruction packets live in the database and are Admin-updateable through
  backend/Admin flows. `docs/reference/instruction.txt` is a seed/reference
  source, not the runtime storage surface.
- Classification should be multi-axis. Start with steel/material family, but
  also include task type, product family, surface treatment, processing type,
  formula code, customer/tier/project scope, priority, review state, active
  status, version/supersession, and source refs.
- Runtime lookup is batched by the interpreted order context, not by individual
  detail. A mixed order should send every detected material/task/process/formula
  facet in one `lookup_quote_rules` request so returned packets/defaults can be
  applied across all relevant lines.
- Related packets should be grouped by stable `packetGroup` / bundle keys. The
  tool should return grouped sibling packets together; it should not make the AI
  issue separate lookups for a material's formula, cutting, holes, workbook
  notes, or confirmation rules.
- Steel/material family is still an important selector, but not sufficient by
  itself. Global policies such as price-before-weight, processing policies such
  as hole/slot/bending interpretation, and workbook-output rules need their own
  task/facet selectors.
- Detailed Agent Instruction seed text lives in
  [`../steel-data-rules-architecture/agent-instructions.md`](../steel-data-rules-architecture/agent-instructions.md).
  Instruction Packet selector/request/response design lives in
  [`../steel-data-rules-architecture/instruction-packets.md`](../steel-data-rules-architecture/instruction-packets.md).
  Future prompt-injected Agent Instruction and Instruction Packet body text
  should be Traditional Chinese; canonical API/schema keys can remain English.

Agent Instruction content:

- The Agent Instruction is the Admin-managed default instruction injected into
  every Steel quote turn. It can include global OCR/file handling, tool routing,
  order-line inference, workbook output, confirmation, and source-validation
  rules.
- OCR/file rules cover image/PDF orientation checks, Traditional Chinese
  preservation, drawing-vs-table precedence, low-confidence OCR handling, and
  source/evidence refs. This is Steel order interpretation policy; generic
  provider file handling still stays under `fileAnalysis.instructions` where
  applicable.
- Tool rules cover `lookup_catalog_families`, `lookup_quote_rules`,
  `search_customers`, `search_price_candidates`, raw-typo guardrails, and when
  not to call a tool.
- Workbook rules cover when AI may write provisional workbook notes/candidates,
  when confirmed totals are forbidden, and when to use the workbook output tool
  after reviewed facts or user confirmation are sufficient.

Workbook output tool:

- `patch_quote_workbook` is a provider-facing workbook output tool when workbook
  context is present. It is not one of the reviewed lookup tools.
- AI may call `patch_quote_workbook` to propose compact semantic quote data.
  Backend projection creates typed workbook operations, then workbook
  validation/service applies or rejects those operations.
- Keep `get_workbook` out of the MVP lookup tool list. Workbook structure
  context is provided by the quote runtime; a future explicit workbook-context
  tool can be added only if runtime context is insufficient.

Not exposed as MVP tools:

- `lookup_customer`: redundant with `search_customers`, which can return exact
  and ambiguous customer matches plus reviewed customer-specific rules.
- `lookup_spec_price`: redundant with `search_price_candidates` exact or
  candidate-query modes.
- `lookup_weight_spec`, `lookup_cutting_price`, `lookup_processing_price`, and
  `lookup_material_rules`: backend internal repositories or future extension
  tools. The MVP lookup surface should use `lookup_quote_rules`,
  and `search_price_candidates` to return the facts AI needs for quote
  reasoning.
- `lookup_formula` / `lookup_formula_version`: formula code filling is governed
  by workbook rules and semantic quote data, not by an AI-callable runtime
  lookup tool.
- `select_calculation_rule`, ranking helpers, and calculation primitives:
  not AI-callable MVP tools. AI owns final candidate selection and arithmetic;
  backend validates source/rule scope, workbook shape, and subtotal consistency.
- `get_workbook`: workbook context should be provided by the quote runtime or a
  later explicit workbook-context tool, not part of the reviewed-data MVP tool
  list.
- `search_source_chunks`: too broad for the MVP AI inference path. Use
  `lookup_quote_rules` for reviewed task-scoped instruction packets/defaults
  instead of arbitrary source text retrieval.

Tasks:

- Validate every argument with Zod.
- Keep business tool selection in AI orchestration. Backend tools expose
  validated lookup capabilities and reject unsafe raw inputs, but they do not
  silently choose product-price, customer, default, formula, or workbook output
  paths from raw customer text.
- Do not expose quote-item normalization, price-search-term generation, or price-ranking helpers as runtime tools. AI generates material/spec candidates and `candidateQueries` in reasoning; backend tools validate lookup inputs and source-backed outputs.
- Add `lookup_catalog_families` for admin-supplied product/category inference
  rules and reviewed vocabulary candidates. This tool helps AI choose catalog
  keys for `lookup_quote_rules` and `search_price_candidates`; it must not
  become a hidden backend resolver.
- Add `lookup_quote_rules` as the merged instruction/default retrieval tool. It
  should return reviewed, task-scoped instruction packets seeded by sources such
  as `docs/reference/instruction.txt`, plus reviewed quote defaults from
  `steel.quote_defaults`, with version/source refs and applicability filters.
  It must not dump the entire instruction/default corpus into prompt context.
- Keep the Agent Instruction Admin-managed and default-injected every turn. It
  can define global workflow/tool rules and route to `lookup_quote_rules`.
  Task-scoped material/process/formula details should still be stored as
  reviewed instruction packets when selective retrieval is needed.
- `search_price_candidates` queries reviewed price rows with confirmed normalized keys or derived `candidateQueries`, not with unnormalized customer evidence.
- `search_customers` returns matched/ambiguous customers, tier context, and
  reviewed customer-specific rules/defaults when available. It must not hide a
  backend resolver decision from AI.
- `lookup_quote_rules = lookup_instructions + lookup_defaults`; the latter names
  describe internal composition, not separate runtime tools. Quote defaults must
  use typed filters and return bounded reviewed candidates with origin refs, not
  dump all defaults into prompt context.
- Apply conversation access checks for scoped tools.
- Apply per-run call limits.
- Log every tool call with tool name, provider tool-call ID when available, input summary, result status, duration, source refs, error category, output summary, and redaction version.
- Sanitize tool output before returning it to any Steel AI provider.
- Keep tool definitions provider-neutral: openai-oauth and OpenAI adapters may serialize them differently, but backend validation/execution is shared.
- Return typed tool errors that the orchestrator can classify for explicitly selected secondary driver routing, unsupported capability, or manual review.
- Do not provide raw SQL, raw Mongo, read file, or list directory tools.
- Do not persist raw full prompts, source tables, raw source files, or full customer inquiry contents in tool-call logs.

Acceptance:

- Missing prices never become `0`.
- Customer-requested quote adjustments are represented distinctly from formal source facts.
- Ambiguous specs return candidates plus targeted clarification.
- Tool result sanitizer neutralizes prompt-injection-like source text.
- Tool tests can run through provider-neutral executor mocks without depending on a specific openai-oauth or OpenAI SDK.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/tools/.*\\.spec\\.ts$"
rtk npm run build:api
```

## Phase Gate

Do not move to Phase 3 until:

- Repository, catalog-family, customer, price-candidate, quote-rule, formula,
  workbook subtotal, and tool tests pass for the active implementation surface.
- Tool result shapes are stable enough for prompt bundle.
- Price-before-weight behavior is tested.
- Missing price cannot render as `0`.
- Confirmed workbook totals cannot pass when summary totals differ from line
  subtotal sums.
- Tool call logging and sanitizer exist.
- No Phase 2 backend normalization boundary, customer resolver, candidate
  ranking hardening, stock allocation module, or calculation context serializer
  remains in the active implementation queue.
- `tasks/todo.md` records which real data imports are still deferred, including handbook data SQL/import and Admin ERP XLSX flow.
