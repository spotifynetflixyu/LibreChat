# Phase 2: Quote Data And Tools

Goal: make Steel backend business tools deterministic while preserving AI-led quote orchestration. AI chooses the business tool path from normalized quote context and user intent; backend tools query reviewed repositories, validate inputs, sanitize outputs, reject unsafe raw lookups, and handle ambiguity according to `CONTEXT.md` and `steel_librechat_plan_v8.3_openai_oauth_responses_primary.md`.

Detailed data/rule architecture for the company's manual quoting workflow lives in [`../steel-data-rules-architecture/README.md`](../steel-data-rules-architecture/README.md). Treat that package as the Phase 2 companion plan for source priority, material-specific rules, source refs, tool-calling boundaries, and Admin maintenance scope.

## Scope

- Supabase read repositories for customers, aliases, tiers, prices, weight specs, processing/cutting/hole/slotting/bending prices, formulas, orders, and source chunks.
- Use steel handbook DOCX contents to design and validate the real schema/data model shape, without implementing real handbook data SQL import yet.
- Source schema mapping from Chinese `docs/reference` labels/headers/terms to English canonical schema keys used by spec, price, formula, processing-price, tool, AI API prompt context, and database query contracts.
- AI-proposed material/spec candidate validation, alias/search-term generation, and raw typo lookup guardrails.
- Customer tier resolver.
- Product price candidate search and ranking.
- Stock allocation engine.
- Deterministic calculation engine.
- AI-selected formula/rule orchestration over reviewed backend data, with backend validation before deterministic calculation.
- Optional AI Python / Code Interpreter calculation audit comparison, where backend-confirmed results remain the highest-confidence numeric source when backend calculation succeeds.
- Multi-item quote calculation audit storage: one current order/workbook-level calculation state and one current item/line audit record per steel material candidate or workbook row.
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

## Milestone 2.2: Material Normalization Dictionary

Files:

- Create `packages/api/src/steel/normalization/dictionary.ts`
- Create `packages/api/src/steel/normalization/normalize.ts`
- Create `packages/api/src/steel/normalization/terms.ts`
- Add tests under `packages/api/src/steel/normalization/*.spec.ts`

Tasks:

- Keep AI-led tool orchestration as the core framework. Backend tools expose
  table-specific capabilities and guardrails; they do not silently choose
  product-price, customer, quote-default, formula, or workbook output paths from
  raw customer text. Weight, cutting, processing, material-rule, ranking, and
  calculator details stay backend internal unless a later slice explicitly
  exposes them.
- Accept AI-proposed quote item candidates because customer order formats vary by customer, file, and message style.
- Treat AI-proposed specs as candidates, not confirmed facts, until backend validation and ambiguity handling complete.
- Return `ask_user` when AI confidence is not high or required fields are missing.
- Return `confirm_candidates` when multiple plausible specs exist, with bounded options for the user to choose from before pricing.
- Normalize full-width/half-width characters.
- Normalize `x`, `X`, `*`, and multiplication separators.
- Normalize mm/M/米/公尺/呎/尺/英吋.
- Extract material category, material grade, surface treatment, dimensions, thickness, length, quantity, and processing notes.
- Expand aliases and common conversions:
  - 1 inch approximately 25mm.
  - 1 1/2 / 1英半 approximately pipe outer diameter 48.3mm.
  - C75 to C75x45x15 candidate.
  - C100 to C100x50x20 candidate.
  - L38 to 38x38 angle candidate.
  - 黑圓管48.1 to 黑圓管 / 黑管 / 黑A / 黑B / 黑AB圓管 / 1 1/2 / 48.3.

Acceptance:

- Alias conversion produces candidates, not exact-match claims.
- Unknown thickness/material/length/unit/surface treatment lowers confidence.
- Uncertain AI interpretation never proceeds directly to pricing; it asks the user or returns options for confirmation.
- Multiple plausible AI/spec candidates are presented for user confirmation instead of silently selecting one.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/normalization/.*\\.spec\\.ts$"
```

## Milestone 2.3: Customer Tier Resolver

Files:

- Create `packages/api/src/steel/quote/customer.ts`
- Add tests under `packages/api/src/steel/quote/customer.spec.ts`

Tasks:

- Match customers by display name, legal name, alias, and common project/site data.
- Return tier from `steel.customers`, `steel.customer_aliases`, and `steel.customer_tiers`.
- Return candidates when multiple customers match.
- Mark low confidence when customer or tier is unknown.

Acceptance:

- Exact customer match returns tier.
- Alias match records alias evidence.
- Multi-match returns candidates and does not guess.

Verification:

```bash
rtk npm run test:packages:api -- --runTestsByPath packages/api/src/steel/quote/customer.spec.ts
```

## Milestone 2.4: Price Candidate Search And Ranking

Files:

- Create `packages/api/src/steel/pricing/terms.ts`
- Create `packages/api/src/steel/pricing/search.ts`
- Create `packages/api/src/steel/pricing/rank.ts`
- Create `packages/api/src/steel/pricing/decision.ts`
- Add tests under `packages/api/src/steel/pricing/*.spec.ts`

Tasks:

- Generate multiple search terms from normalized items.
- Search material and processing tables.
- Support exact, major, alias, closest-estimate, and no-price result types.
- Rank by category, material/surface, dimensions, thickness, length, unit, and customer tier.
- Preserve candidate differences and rejected reasons.
- Enforce price-before-weight.
- Use product-price unit weight as the main quote weight when reviewed product price data carries unit weight; keep handbook weight as separate evidence.
- Never fill missing price with `0`.
- Treat blank or `0.00` values from `產品價格.xlsx` as unknown/missing price, not free price.
- Confirm zero cutting/hole/processing charges only through an AI/memory/admin selected calculation rule or reviewed business rule; do not infer true-zero from product family in code.
- The current C-type cutting/hole free-charge behavior is a selectable calculation rule/lesson; when selected with high confidence, it can mark the charge true zero and skip remainder calculation.
- The C-type cutting/hole free-charge rule must be configured as a quote default or reviewed rule fixture before AI can select it; backend code must not create the no-charge behavior from C-type product family alone.
- Formula selection starts from AI-normalized material/spec context and reviewed `steel.formula_versions` rows. For example, `docs/reference/公式編號.xlsx` maps formula code `C` to `C型鋼`, but runtime tools use reviewed database rows rather than reading the spreadsheet.
- Backend pricing/calculator code validates AI-selected `formulaCode` and `selectedCalculationRule`; it does not hard-code C-type free cutting or hole behavior by product family.
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
- Multiple usable price candidates are presented to the user for confirmation instead of silently selected.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/pricing/.*\\.spec\\.ts$"
```

## Milestone 2.5: Stock Allocation Engine

Files:

- Create `packages/api/src/steel/allocation/lengths.ts`
- Create `packages/api/src/steel/allocation/usage.ts`
- Add tests under `packages/api/src/steel/allocation/*.spec.ts`

Tasks:

- Apply "not selling exact cut length" unless the customer explicitly allows exact finished-length pricing.
- Allocate finished lengths against sellable stock length.
- Default unknown stock length to 6M with low confidence.
- Return stock length, stock pieces, pieces per stock, required finished pieces, remainder length/weight, algorithm, confidence, and low-confidence reason.

Acceptance:

- `鍍鋅L38*38*2.5mm*2000mm*26支` with 6M stock yields 9 stock pieces, not 26 x 2m net-length pricing.
- Low-confidence reason is present when stock length is assumed.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/allocation/.*\\.spec\\.ts$"
```

## Milestone 2.6: Deterministic Calculation Engine

Files:

- Create `packages/api/src/steel/calculators/plate.ts`
- Create `packages/api/src/steel/calculators/bar.ts`
- Create `packages/api/src/steel/calculators/cutting.ts`
- Create `packages/api/src/steel/calculators/holes.ts`
- Create `packages/api/src/steel/calculators/slotting.ts`
- Create `packages/api/src/steel/calculators/bending.ts`
- Create `packages/api/src/steel/calculators/line.ts`
- Add tests under `packages/api/src/steel/calculators/*.spec.ts`

Tasks:

- Implement plate, bar, cutting, hole, slotting, bending, and line-total calculators.
- Implement cut count as a separate deterministic step inside the cutting calculator contract. It returns `operationCutCount` for physical/system-order use and `billableCutCount` for quote charging.
- Count head trim, tail trim, split/multi-piece separation cuts, and remainder behavior from normalized evidence. If one stock piece produces `n` finished pieces with no remainder and no tail trim, separation cuts are `n - 1`; if a remainder exists, separation cuts are `n` because the last finished piece must still be separated from the remainder.
- "Remainder omits tail trim" omits only the extra tail trim/finish cut, not the separation cut between the last finished piece and the remainder.
- For every material that can carry cutting price, if cutting is needed and head/tail trimming is not explicit, the assistant must ask before confirmed cutting fee calculation.
- If a remainder omits tail trim, assistant text and workbook notes must say `有餘料，切尾不計入`.
- If cutting is not needed, workbook still records zero cutting count/fee with the no-cut reason.
- Implement hole fee from structured hole groups: hole type, round diameter, non-round length/width or dimension label, count per piece, quantity multiplier, source refs, and confidence.
- Compare optional AI Python / Code Interpreter calculation evidence with backend canonical calculation per item/line. If backend calculation succeeds, workbook numeric fields use backend-confirmed values; full Python code/output stays in current DB audit records, while concise AI/backend differences may appear in `價格來源` or `判讀備註`.
- Support future Admin-reviewed prices for non-round hole types such as oval, long, rectangular, and custom holes even when the current source price row is `0` or missing during development.
- Implement slotting fee from structured slot paths: path type, segment lengths, path quantity, quantity multiplier, source refs, and confidence.
- Separate confirmed totals from low-confidence estimated totals.
- Use `未確認`, not `0`, for unknown unit price or amount.
- Record formula code/version and calculation basis for workbook lines.
- Validate and normalize explicit quote-specific adjustments after default price/rule resolution. Calculators may consume the normalized adjustment object, but Phase 2 does not persist workbook mutation.

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
rtk npm run test:packages:api -- --testPathPatterns="src/steel/calculators/.*\\.spec\\.ts$"
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

- `lookup_instructions`
- `search_customers`
- `search_price_candidates`
- `lookup_defaults`
- `lookup_formula`

MVP flow:

1. AI starts from the Admin-managed Agent Instruction injected into every Steel
   quote turn, not from a code-hardcoded provider prompt. The Agent Instruction
   says raw customer text is evidence and tells AI when to call
   `lookup_instructions` before applying detailed material/spec/process
   inference.
2. AI judges the order's steel category, likely material/product family,
   surface treatment, dimensions, quantity, and missing fields from quote
   evidence.
3. AI calls `lookup_instructions` when it needs task-scoped quoting rules for
   candidate generation, such as `docs/reference/instruction.txt` derived
   price-before-weight policy, material alias expansion, C-type rules,
   long-material cutting behavior, hole/slot/bending interpretation, or workbook
   output requirements. The tool returns bounded reviewed instruction packets,
   not the full instruction source. The request is batched by interpreted order
   context: include all detected material families, task types, processing
   types, formula candidates, customer/tier/project context, and low-confidence
   facets together. Do not query instruction packets separately for hole count,
   cut count, slotting path, bending, formula, or each small material-line
   detail unless later user input materially changes the context. The lookup
   should expand matching packet groups, such as `h-type-quote-core`,
   `c-type-quote-core`, `angle-zinc-quote-core`, `plate-processing-core`, and
   `workbook-output-core`, so one call returns the related price/formula/
   cutting/hole/workbook rules needed by the detected context.
4. AI generates bounded product-price `candidateQueries`, such as
   `錏成型角鐵 30x30`, `鍍鋅角鐵 30x30`, or `角鐵 30x30`, instead of passing raw
   typo text to backend lookup.
5. Backend tools return reviewed instruction, customer, price, default, and
   formula candidates with source refs, confidence, missing/zero markers, and
   bounded alternatives.
6. AI chooses the most credible calculation path from returned facts, explains
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
  facet in one `lookup_instructions` request so returned packets can be applied
  across all relevant lines.
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
- Tool rules cover `lookup_instructions`, `search_customers`,
  `search_price_candidates`, `lookup_defaults`, `lookup_formula`, raw-typo
  guardrails, and when not to call a tool.
- Workbook rules cover when AI may write provisional workbook notes/candidates,
  when confirmed totals are forbidden, and when to use the workbook output tool
  after reviewed facts or user confirmation are sufficient.

Workbook output tool:

- `patch_workbook` is a provider-facing workbook output tool when workbook
  context is present. It is not one of the reviewed lookup tools.
- AI may call `patch_workbook` to propose typed workbook operations. Backend
  workbook validation/service applies or rejects those operations.
- Keep `get_workbook` out of the MVP lookup tool list. Workbook structure
  context is provided by the quote runtime; a future explicit workbook-context
  tool can be added only if runtime context is insufficient.

Not exposed as MVP tools:

- `lookup_customer`: redundant with `search_customers`, which can return exact
  and ambiguous customer matches.
- `lookup_spec_price`: redundant with `search_price_candidates` exact or
  candidate-query modes.
- `lookup_weight_spec`, `lookup_cutting_price`, `lookup_processing_price`, and
  `lookup_material_rules`: backend internal repositories or future extension
  tools. The MVP lookup surface should use `search_price_candidates`,
  `lookup_defaults`, and `lookup_formula` to return the facts AI needs for
  quote reasoning.
- `lookup_formula_version`: storage-oriented naming; MVP exposes
  `lookup_formula` and lets backend return reviewed active formula candidates
  and version refs.
- `select_calculation_rule`, ranking helpers, and calculation primitives:
  backend internal validation/calculation policies, not AI-callable MVP tools.
- `get_workbook`: workbook context should be provided by the quote runtime or a
  later explicit workbook-context tool, not part of the reviewed-data MVP tool
  list.
- `search_source_chunks`: too broad for the MVP AI inference path. Use
  `lookup_instructions` for reviewed task-scoped instruction packets instead of
  arbitrary source text retrieval.

Tasks:

- Validate every argument with Zod.
- Keep business tool selection in AI orchestration. Backend tools expose
  validated lookup capabilities and reject unsafe raw inputs, but they do not
  silently choose product-price, customer, default, formula, or workbook output
  paths from raw customer text.
- Do not expose quote-item normalization, price-search-term generation, or price-ranking helpers as runtime tools. AI generates material/spec candidates and `candidateQueries` in reasoning; backend tools validate lookup inputs and source-backed outputs.
- Add `lookup_instructions` as the instruction retrieval tool. It should return
  reviewed, task-scoped instruction packets seeded by sources such as
  `docs/reference/instruction.txt`, with version/source refs and applicability
  filters. It must not dump the entire instruction file into prompt context.
- Keep the Agent Instruction Admin-managed and default-injected every turn. It
  can define global workflow/tool rules and route to `lookup_instructions`.
  Task-scoped material/process/formula details should still be stored as
  reviewed instruction packets when selective retrieval is needed.
- `search_price_candidates` queries reviewed price rows with confirmed normalized keys or derived `candidateQueries`, not with unnormalized customer evidence.
- Add `lookup_defaults` as the other core reviewed lookup tool when the AI needs global/site-managed material defaults, customer defaults, formula defaults, or no-charge defaults. It must use typed filters and return bounded reviewed candidates with origin refs, not dump all defaults into prompt context.
- Add `lookup_formula` as the formula retrieval tool. It should return reviewed
  active formula candidates and version/source refs without exposing
  storage-oriented version selection as a separate AI decision.
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

- Repository, normalization, pricing, allocation, calculator, and tool tests pass.
- Tool result shapes are stable enough for prompt bundle.
- Price-before-weight behavior is tested.
- Missing price cannot render as `0`.
- Tool call logging and sanitizer exist.
- `tasks/todo.md` records which real data imports are still deferred, including handbook data SQL/import and Admin ERP XLSX flow.
