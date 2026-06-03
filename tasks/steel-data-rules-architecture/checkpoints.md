# Steel Data Rules Architecture Checkpoints

Copy the active checkpoint into `tasks/todo.md` when implementation starts, then record evidence in the task's Review section.

## Checkpoint A: Decision Lock

- [ ] AI-led tool orchestration is documented as the core Steel quote runtime framework in `CONTEXT.md`, this package, and v8.3 Phase 2 docs.
- [ ] Product-price unit weight priority over handbook unit weight is documented in `CONTEXT.md`, this package, and v8.3 Phase 2 docs.
- [ ] Customer inquiry files are classified as quote request evidence, not Admin import sources.
- [ ] C-type material rules are task-scoped and not injected into every prompt.
- [ ] H-type non-regular lengths automatically receive the +0.3/kg material-unit-price-only surcharge.
- [ ] `切工價錢.xlsx` is treated as a formal cutting-price source.
- [ ] Quote-specific adjustments can override default price/rule behavior for one workbook line without mutating formal source data.
- [ ] Conversation adjustments can only become customer defaults through a rule proposal and Admin review path, not direct `steel.quote_defaults` mutation.
- [ ] Blank or `0.00` price/charge source values are unknown unless Admin review marks a true zero price.
- [ ] Zero unit weight is invalid or unknown unless a later source-specific task proves a legitimate zero-weight concept.
- [ ] Steel Agent Instruction is Admin-managed, versioned, injected into every
      Steel quote turn, and not hard-coded in provider adapters.
- [ ] AI candidate-generation and quote-interpretation policies are retrieved as task-scoped Instruction Packets seeded by `docs/reference/instruction.txt` or future Admin-reviewed instruction versions, not by dumping the whole instruction file into every prompt.

Verification:

```bash
rtk proxy rg -n "Product Price Unit Weight|True Zero Price|Quote Request Evidence|Quote-Specific Adjustment|Material Rule|Cutting Price Source|C-type|C 型鋼|切工價錢|true zero|0\\.3/kg" CONTEXT.md tasks/steel-data-rules-architecture tasks/v8.3/phase-2-data-tools.md
```

## Checkpoint B: Source Mapping And Schema Gate

- [ ] Source schema mapping covers customer tier columns, product prices, product-price unit weight, formula fields, cutting price fields, and material rule fields.
- [ ] `source_refs` strategy records `channel`, `factType`, `sourceFile`, sheet/page, row/range locator, `sourceVersionId`, confidence, and `canonicalKey` when applicable.
- [ ] Schema deltas update both `supabase/schema.sql` and one new migration.
- [ ] Product price and cutting price sources can preserve customer-tier-specific values.
- [ ] Product price source can carry the main quote unit weight without replacing handbook weight specs globally.
- [ ] Product-price explicit reviewed processing/cutting items can override cutting lookup, while generic/blank/`0.00` rows cannot.
- [ ] Typed fields exist in the schema delta plan for product-price unit weight, value/review state, material-rule priority/selectors, and formula source/review shape.
- [ ] `phase-2-schema-delta-plan.md` is reviewed before creating the Supabase migration.

Verification:

```bash
rtk npm run build:api
rtk proxy rg -n "source_refs|product_price_unit_weight|value_state|review_state|cutting_unit_price|material_rule" supabase/schema.sql tasks/steel-data-rules-architecture tasks/v8.3/source-schema-mapping.md
```

## Checkpoint C: Rule Retrieval Gate

- [ ] Material-rule facts are surfaced only through task-scoped prompt context,
      `lookup_defaults`, `lookup_formula`, or backend validation; no separate
      MVP `lookup_material_rules` tool is required.
- [ ] `lookup_formula` returns reviewed formula candidates by normalized
      material/spec context, such as formula code `C` for C-type steel, without
      reading `公式編號.xlsx` at runtime.
- [ ] C-type rule blocks long-material stock allocation unless explicit separate cutting conditions apply.
- [ ] Backend calculators do not hard-code `if C-type then cutting/hole = 0`; they require a selected quote default, calculation rule, reviewed true-zero fact, or quote-specific override.
- [ ] C-type cutting/hole no-charge behavior is available only as a configured quote default or reviewed rule selected by AI and validated by backend tools.
- [ ] H-type non-standard-length rule returns a material unit-price adjustment only and applies automatically to non-regular normalized H-type lengths.
- [ ] Long-material allocation rule applies to non-C long materials unless the customer explicitly allows exact finished-length pricing.
- [ ] Cutting rules can resolve H-type and black-iron cutting prices and adjustment notes.
- [ ] Cutting rules distinguish `operationCutCount` from `billableCutCount` and cover head trim, tail trim, no-head/no-tail, split/multi-piece, and remainder-tail behavior.
- [ ] Hole rules count only confirmed round/oval/long/rectangular/bolt/punched/custom holes and reject center lines, dimension lines, hidden lines, R corners, bend lines, cut marks, and welding symbols.
- [ ] Slotting rules calculate continuous slot path length, including L/U/multi-segment paths, without treating normal outside profiles as slotting.
- [ ] Quote-specific adjustments can override a material rule for one workbook line while preserving the formal rule.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(rules|allocation|pricing|repositories)/.*\\.spec\\.ts$"
```

## Checkpoint D: Tool-Calling Gate

- [ ] AI tools expose normalized lookup/calculation contracts, not raw SQL/Mongo/file access.
- [ ] Allowed MVP runtime lookup tools are limited to `lookup_instructions`,
      `search_customers`, `search_price_candidates`, `lookup_defaults`, and
      `lookup_formula`.
- [ ] Prompt bundles include task-scoped source-schema mapping and material rules only when relevant.
- [ ] AI orchestrates business tool selection from normalized quote context and user intent, while backend tools validate the selected tool input, selected formula/rule/source, and deterministic calculation.
- [ ] Backend code does not silently choose product-price, customer, default,
      formula, or workbook output paths from raw customer text.
- [ ] Exact customer lookup, spec-price lookup, weight lookup, cutting/
      processing lookup, material-rule lookup, formula-version selection,
      ranking helpers, arbitrary source-chunk search, calculation primitives,
      and workbook-read helpers are backend internal capabilities or later
      extension tools, not Allowed MVP runtime tools.
- [ ] Typo/incomplete raw text such as `亞L30x30` is treated as quote evidence for AI candidate generation, not as a canonical table lookup key.
- [ ] `search_price_candidates` rejects raw-only typo lookups and accepts confirmed normalized keys or AI-derived `candidateQueries`.
- [ ] AI retrieves quote defaults through `lookup_defaults` using typed filters and bounded reviewed candidates, not by receiving all defaults in prompt context.
- [ ] Missing or unreviewed zero prices return `未確認` or low-confidence candidates, never confirmed zero totals.
- [ ] Missing or zero material prices can present nearest reviewed candidate prices for confirmation, but cannot patch a confirmed customer-facing total before user confirmation.
- [ ] Explicit approximate quote requests can produce preview estimates from the highest-confidence reviewed price candidate, with assumed spec and low-confidence reason, even when the user input has typos or incomplete dimensions.
- [ ] Provisional workbook patches can record candidate estimates, source refs, confidence, and missing fields, but confirmed customer-facing totals require user confirmation when candidate choice remains ambiguous.
- [ ] Explicit customer quote-specific adjustments are represented separately from formal price/rule facts.
- [ ] Backend internal cut-count validation records operation/billable counts
      with adopted/rejected reasons before any cutting fee is accepted.
- [ ] All cuttable materials ask about head/tail trimming when cutting is needed and evidence is not explicit.
- [ ] No-cut lines still patch workbook cutting fields as zero with a no-cut reason.
- [ ] Remainder-tail paths explicitly say and record that tail trim is not counted.
- [ ] Backend internal hole-fee calculation consumes structured hole groups,
      including non-round dimensions when present, and item quantity instead of
      raw OCR text.
- [ ] Backend internal slotting-fee calculation consumes structured slot paths
      and returns total slotting meters before pricing.
- [ ] "Save as customer default" creates a `needs_review` rule proposal only after required customer/material/charge/formula/parameter fields are known.
- [ ] Reviewed customer/tier/company defaults persist in `steel.calculation_rule_defaults`, while published retrieval entries persist in `steel.quote_defaults`.
- [ ] AI-selected `selectedCalculationRule` is rejected if its `quote_default` origin is stale, unreviewed, inactive, or out of scope.
- [ ] Applied Admin-reviewed customer defaults are disclosed in assistant text, for example customer-scoped H-type cutting/hole no-charge rules.
- [ ] Tool results include source refs, confidence, adopted/rejected candidates, and low-confidence reasons.
- [ ] Tool-call logs store bounded summaries and sanitized output.
- [ ] Optional AI Python / Code Interpreter calculation evidence is compared against backend canonical calculation per item/line, with backend-confirmed numbers used for preview patching when backend succeeds.
- [ ] AI Python code/output and verbose execution artifacts are stored in DB calculation audit records, not visible workbook cells.
- [ ] Concise AI/backend calculation differences may be preserved in `價格來源`, `判讀備註`, or manual-review fields instead of blocking preview patches by default.
- [ ] Multi-item orders maintain one current calculation state and multiple current item/line audit records, one per material candidate or workbook line.
- [ ] Accepted workbook/calculation updates overwrite latest database state; workbook `version` is only a visible update counter/freshness marker, not retained history.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/tools/.*\\.spec\\.ts$"
rtk npm run build:api
```

## Checkpoint D2: Rule Proposal Backend Gate

- [ ] `steel_rule_proposals` stores structured rule proposals instead of generic name/status placeholders.
- [ ] `POST /api/steel/rule-proposals` requires JWT auth and creates only `needs_review` proposals.
- [ ] Proposal creation rejects missing scope-specific selectors, missing source refs, missing formula code, or empty adjustable parameters.
- [ ] Created proposals record authenticated `createdByUserId`, source refs, reason, confidence, selector, and proposed default parameters.
- [ ] Client requests cannot set review/publish fields such as `status`, `reviewedByUserId`, `reviewedAt`, or quote-default publication refs.
- [ ] Admin review UI and Admin approval/reject/publish mutations remain deferred to Phase 5 or a later explicit backend/Admin slice.
- [ ] Global/site-managed quote defaults remain a future extension module, not part of the rule proposal backend gate.
- [ ] Confirmed conversation scenarios prove when AI should create a proposal, when it should ask for scope/spec confirmation, and when it should keep the adjustment quote-specific.
- [ ] Phase 4B closeout explicitly returns next implementation focus to the core order quoting path.

Verification:

```bash
rtk npm run test:packages:data-provider -- --runInBand --testPathPatterns="src/steel/rules\\.spec\\.ts$"
rtk npm run test:packages:data-schemas -- --runInBand --testPathPatterns="src/schema/steel\\.spec\\.ts$"
rtk npm run test:packages:api -- --runInBand --testPathPatterns="src/steel/(rules|handlers)\\.spec\\.ts$"
rtk cd api && npx jest server/routes/__tests__/steel.spec.js --runInBand --coverage=false
rtk npm run build:data-provider
rtk npm run build:data-schemas
rtk npm run build:api
```

## Checkpoint E: Manual Workflow Scenario Gate

- [ ] `客戶詢價.rtf` C-type sample parses into C-type quote items and retrieves the C-type rule.
- [ ] C-type sample calculates by finished length and does not produce stock-piece/remainder/general-cutting charges.
- [ ] C-type sample proves true-zero cutting/hole is accepted through the configured quote default, selected calculation rule, or quote-specific override, not by product-family hardcoding.
- [ ] C-type no-charge cutting/hole default is present as a configured quote-default or reviewed-rule fixture before AI selects it.
- [ ] H-type non-regular length sample applies +0.3/kg to material price only and uses cutting data separately.
- [ ] H-type cutting sample asks whether to cut head/tail when the user only says "要切" and cut-count affects price.
- [ ] General cuttable-material sample with remainder explains `有餘料，切尾不計入` and still counts the separation cut.
- [ ] Explicit no-cut sample records zero cutting in workbook.
- [ ] Product price weight conflict sample uses product-price unit weight as the main quote weight for the matched line.
- [ ] Cutting price lookup sample uses `切工價錢.xlsx` imported/reviewed cutting data as formal source.
- [ ] Cut-count sample covers split/no-head/no-tail, head/tail trim, and remainder omitting only tail trim, not the separation cut.
- [ ] Hole sample confirms `4-Ø22` style notation, oval/long/rectangular non-round hole groups, quantity multiplier, and non-hole line rejection.
- [ ] Slotting sample confirms straight, L, and U/ㄇ path length calculation with unclear paths sent to manual review.
- [ ] Customer special-price/no-charge/surcharge sample records a quote-specific adjustment without changing formal source rows.
- [ ] 全華興 / 亞L30x30 approximate quote sample proves the full AI-led chain: typo/incomplete-spec detection, material/spec candidate generation, AI-chosen product-price lookup path, reviewed price ranking, provisional workbook notes, bounded user options, and no confirmed total before user confirmation when candidates remain ambiguous.
- [ ] AI Python/backend mismatch sample patches backend-confirmed numbers, stores full Python evidence in DB audit records, and records a concise difference summary for review.
- [ ] Multi-material order sample proves C-type and angle lines have separate current audit rows and separate confidence states before order totals aggregate.
- [ ] Workbook version sample proves the UI version increments while old workbook/calculation data is overwritten rather than retained.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(quote|rules|pricing|calculators|tools)/.*\\.spec\\.ts$"
```
