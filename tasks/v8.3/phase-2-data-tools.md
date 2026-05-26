# Phase 2: Quote Data And Tools

Goal: make Steel quoting deterministic before involving Steel AI provider orchestration. Tools must query backend-owned repositories, validate inputs, sanitize outputs, and handle ambiguity according to `CONTEXT.md` and `steel_librechat_plan_v8.3_openai_oauth_responses_primary.md`.

## Scope

- Supabase read repositories for customers, aliases, tiers, prices, weight specs, processing/cutting/hole/slotting/bending prices, formulas, orders, and source chunks.
- Use steel handbook DOCX contents to design and validate the real schema/data model shape, without implementing real handbook data SQL import yet.
- Source schema mapping from Chinese `docs/reference` labels/headers/terms to English canonical schema keys used by spec, price, formula, processing-price, tool, AI API prompt context, and database query contracts.
- Material normalization dictionary.
- Customer tier resolver.
- Product price candidate search and ranking.
- Stock allocation engine.
- Deterministic calculation engine.
- Tool registry with Zod-validated business tools for both openai-oauth responses and OpenAI API fallback runs.
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
- Include source IDs/row IDs for `context_refs`, quote trace, and audit.
- Preserve pricing unit; do not convert unit type in repository layer.

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
- Treat `docs/reference/公式編號 - Sheet1.csv` as a formula structure reference; calculator runtime data should come from reviewed app-ready JSON or database rows.
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
- Never fill missing price with `0`.
- Never convert incompatible unit pricing, e.g. kg to piece, piece to kg, cut to M, hole to piece.

Acceptance:

- `黑圓管48.1` searches 48.3 and 1 1/2 variants.
- Missing thickness returns candidates and low confidence.
- Price `0` becomes `未確認` or low-confidence estimate from another non-zero candidate.
- Fully matched row uses that row's pricing unit.

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

- Apply "not selling exact cut length" unless user explicitly says cut-clear is allowed.
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
- Separate confirmed totals from low-confidence estimated totals.
- Use `未確認`, not `0`, for unknown unit price or amount.
- Record formula code/version and calculation basis for workbook lines.

Acceptance:

- Cutting fee handles repair head/tail count correctly.
- Hole fee ignores center/dimension/hidden lines.
- Slotting fee uses continuous slot paths.
- Bending fee counts direction changes, not dimension lines.
- Line total separates confirmed and low-confidence estimated fees.

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

Allowed MVP tools:

- `lookup_customer`
- `search_customers`
- `normalize_quote_item`
- `generate_price_search_terms`
- `search_price_candidates`
- `rank_price_candidates`
- `lookup_spec_price`
- `lookup_weight_spec`
- `lookup_cutting_price`
- `lookup_processing_price`
- `allocate_stock_lengths`
- `calculate_plate_weight`
- `calculate_bar_weight`
- `calculate_cutting_fee`
- `calculate_hole_fee`
- `calculate_slotting_fee`
- `calculate_bending_fee`
- `calculate_line_total`
- `get_workbook`
- `apply_workbook_patch` as a stub until Phase 3 implements mutation.

Tasks:

- Validate every argument with Zod.
- Apply conversation access checks for scoped tools.
- Apply per-run call limits.
- Log every tool call with input summary, result status, duration, and error category.
- Sanitize tool output before returning it to any Steel AI provider.
- Keep tool definitions provider-neutral: openai-oauth and OpenAI adapters may serialize them differently, but backend validation/execution is shared.
- Return typed tool errors that the orchestrator can classify for provider fallback, unsupported capability, or manual review.
- Do not provide raw SQL, raw Mongo, read file, or list directory tools.

Acceptance:

- Missing prices never become `0`.
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
