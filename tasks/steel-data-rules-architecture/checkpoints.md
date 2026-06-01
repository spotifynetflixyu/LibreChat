# Steel Data Rules Architecture Checkpoints

Copy the active checkpoint into `tasks/todo.md` when implementation starts, then record evidence in the task's Review section.

## Checkpoint A: Decision Lock

- [ ] Product-price unit weight priority over handbook unit weight is documented in `CONTEXT.md`, this package, and v8.3 Phase 2 docs.
- [ ] Customer inquiry files are classified as quote request evidence, not Admin import sources.
- [ ] C-type material rules are task-scoped and not injected into every prompt.
- [ ] H-type non-regular lengths automatically receive the +0.3/kg material-unit-price-only surcharge.
- [ ] `切工價錢.xlsx` is treated as a formal cutting-price source.
- [ ] Quote-specific adjustments can override default price/rule behavior for one workbook line without mutating formal source data.
- [ ] Blank or `0.00` price/charge source values are unknown unless Admin review marks a true zero price.
- [ ] Zero unit weight is invalid or unknown unless a later source-specific task proves a legitimate zero-weight concept.

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

- [ ] `lookup_material_rules` returns only rules relevant to normalized quote items.
- [ ] C-type rule blocks long-material stock allocation unless explicit separate cutting conditions apply.
- [ ] H-type non-standard-length rule returns a material unit-price adjustment only and applies automatically to non-regular normalized H-type lengths.
- [ ] Long-material allocation rule applies to non-C long materials unless the customer explicitly allows exact finished-length pricing.
- [ ] Cutting rules can resolve H-type and black-iron cutting prices and adjustment notes.
- [ ] Quote-specific adjustments can override a material rule for one workbook line while preserving the formal rule.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(rules|allocation|pricing|repositories)/.*\\.spec\\.ts$"
```

## Checkpoint D: Tool-Calling Gate

- [ ] AI tools expose normalized lookup/calculation contracts, not raw SQL/Mongo/file access.
- [ ] Prompt bundles include task-scoped source-schema mapping and material rules only when relevant.
- [ ] Missing or unreviewed zero prices return `未確認` or low-confidence candidates, never confirmed zero totals.
- [ ] Explicit customer quote-specific adjustments are represented separately from formal price/rule facts.
- [ ] Tool results include source refs, confidence, adopted/rejected candidates, and low-confidence reasons.
- [ ] Tool-call logs store bounded summaries and sanitized output.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/tools/.*\\.spec\\.ts$"
rtk npm run build:api
```

## Checkpoint E: Manual Workflow Scenario Gate

- [ ] `客戶詢價.rtf` C-type sample parses into C-type quote items and retrieves the C-type rule.
- [ ] C-type sample calculates by finished length and does not produce stock-piece/remainder/general-cutting charges.
- [ ] H-type non-regular length sample applies +0.3/kg to material price only and uses cutting data separately.
- [ ] Product price weight conflict sample uses product-price unit weight as the main quote weight for the matched line.
- [ ] Cutting price lookup sample uses `切工價錢.xlsx` imported/reviewed cutting data as formal source.
- [ ] Customer special-price/no-charge/surcharge sample records a quote-specific adjustment without changing formal source rows.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(quote|rules|pricing|calculators|tools)/.*\\.spec\\.ts$"
```
