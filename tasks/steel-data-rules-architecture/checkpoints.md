# Steel Data Rules Architecture Checkpoints

Copy the active checkpoint into `tasks/todo.md` when implementation starts, then record evidence in the task's Review section.

## Checkpoint A: Decision Lock

- [ ] Product-price unit weight priority over handbook unit weight is documented in `CONTEXT.md`, this package, and v8.3 Phase 2 docs.
- [ ] Customer inquiry files are classified as quote request evidence, not Admin import sources.
- [ ] C-type material rules are task-scoped and not injected into every prompt.
- [ ] H-type non-standard length surcharge is material-unit-price-only.
- [ ] `切工價錢.xlsx` is treated as a formal cutting-price source.

Verification:

```bash
rtk proxy rg -n "Product Price Unit Weight|Quote Request Evidence|Material Rule|Cutting Price Source|C-type|C 型鋼|切工價錢" CONTEXT.md tasks/steel-data-rules-architecture tasks/v8.3/phase-2-data-tools.md
```

## Checkpoint B: Source Mapping And Schema Gate

- [ ] Source schema mapping covers customer tier columns, product prices, product-price unit weight, formula fields, cutting price fields, and material rule fields.
- [ ] `source_ref` strategy records source file, sheet/page, row/range, source version, and confidence.
- [ ] Schema deltas update both `supabase/schema.sql` and one new migration.
- [ ] Product price and cutting price sources can preserve customer-tier-specific values.
- [ ] Product price source can carry a reviewed unit weight override without replacing handbook weight specs globally.

Verification:

```bash
rtk npm run build:api
rtk proxy rg -n "source_ref|product_price_unit_weight|cutting_unit_price|material_rule" supabase/schema.sql tasks/steel-data-rules-architecture tasks/v8.3/source-schema-mapping.md
```

## Checkpoint C: Rule Retrieval Gate

- [ ] `lookup_material_rules` returns only rules relevant to normalized quote items.
- [ ] C-type rule blocks long-material stock allocation unless explicit separate cutting conditions apply.
- [ ] H-type non-standard-length rule returns a material unit-price adjustment only.
- [ ] Long-material allocation rule applies to non-C long materials unless user explicitly permits cut-clear.
- [ ] Cutting rules can resolve H-type and black-iron cutting prices and adjustment notes.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(rules|allocation|pricing|repositories)/.*\\.spec\\.ts$"
```

## Checkpoint D: Tool-Calling Gate

- [ ] AI tools expose normalized lookup/calculation contracts, not raw SQL/Mongo/file access.
- [ ] Prompt bundles include task-scoped source-schema mapping and material rules only when relevant.
- [ ] Missing or zero prices return `未確認` or low-confidence candidates, never confirmed zero totals.
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
- [ ] H-type non-standard length sample applies +0.3/kg to material price only and uses cutting data separately.
- [ ] Product price weight conflict sample uses product-price unit weight for the product-price-derived quote line.
- [ ] Cutting price lookup sample uses `切工價錢.xlsx` imported/reviewed cutting data as formal source.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(quote|rules|pricing|calculators|tools)/.*\\.spec\\.ts$"
```
