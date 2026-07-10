# Steel Price And Cutting Catalog Design

## Goal

Update `search_price_candidates`, the Steel price schema, category rules, and
`system_order` output so one grouped multi-item price lookup returns normal
price candidates plus one consolidated cutting-price catalog. Build that
catalog from `docs/reference/切工價錢-raw.xlsm` through a reviewed
`docs/reference/切工價錢-clean.xlsx`, import it into an independent
`steel.cutting_prices` table, and roll out to dev Supabase only.

## Authoritative sources

- `docs/products_db_v4.2.xlsx` remains authoritative for `steel.prices`.
- `docs/reference/切工價錢-raw.xlsm` is the source for cutting prices and
  supplemental calculation rules.
- `docs/reference/切工價錢-clean.xlsx` is the only import source for
  `steel.cutting_prices`.
- The clean workbook is generated before the database migration/import is
  applied and is visually and structurally verified before use.
- Production remains unchanged until the user explicitly approves the verified
  dev result.

## Price query contract

One `search_price_candidates` call continues to accept 1-20 grouped queries.
Each result preserves its normalized `queryId`.

Lookup queries accept:

- `category`
- `subcategory`
- `material`
- `thicknessMm`
- `erpItemCode`
- `keyword`
- `limit`

The `unit` input is removed. Candidate rows still return their unit because it
is required for pricing.

`material` and `keyword` use contains matching. Material enums are:

`黑鐵`, `白鐵`, `鋁`, `錏`, `鋅`, `鎢`, `塑膠`.

`錏` matches text containing `錏`. `鋅` matches text containing `鋅`, including
`鍍鋅`. These families are not aliases for one another.

`thicknessMm` is compared numerically when both input and stored
`source_thickness` are numeric. An AI input of `2` therefore matches stored
values such as `2`, `2.0`, or `2.00`. Non-numeric source thickness text does
not satisfy a numeric thickness filter.

`limit` is optional and defaults to 30. The AI omits it normally and uses 100
only when expanding the candidate set. Positive values over 100 clamp to 100
without rejecting the call.

`steel.prices.review_state` and its indexes/constraints are removed. Price
lookup no longer accepts or applies a reviewed filter. The independent
`steel.rules.review_state` publication workflow remains unchanged.

AI-visible price candidates omit `sourceRefs`. Database source metadata may
remain available to import validation and internal logging, but it is not part
of candidate data returned to the AI.

## Consolidated cutting lookup

Normal grouped price queries finish first. The system then derives one set of
unique cutting lookup terms from the lookup-query categories, performs one
unlimited `steel.cutting_prices` query, organizes the results, and adds them to
the final price data. Category discovery queries do not trigger cutting lookup
because they do not select one authoritative product category.

Supported mappings are:

| Product category | Cutting lookup term |
| --- | --- |
| H型鋼 | H型鋼 |
| 平鐵 | 平鐵 |
| 鐵板 | 鐵板 |
| 圓管 | 鐵管 |
| 方管 | 鐵管 |
| 扁方管 | 鐵管 |
| 角鐵 | 角鐵 |
| 槽鐵 | 槽鐵 |

Every cutting lookup uses contains matching:

```sql
cutting_category ILIKE '%' || lookup_term || '%'
```

This lets both `平鐵` and `鐵板` match the workbook category
`鐵板/平鐵`. Only the three pipe categories are transformed, all to `鐵管`.

Cutting lookup uses no thickness, dimension, keyword, active/reviewed, or row
limit filter. All matching price and supplemental rows are returned for AI
selection and calculation. If no supported product category is present, the
database cutting query is skipped and the output contains an empty array.

The final output extends the existing grouped price data:

```ts
interface SearchPriceCandidatesOutput {
  queryResults: SteelPriceQueryResult[];
  cuttingPrices: SteelCuttingPriceGroup[];
  summary: {
    queryCount: number;
    matchedQueryCount: number;
    noMatchQueryCount: number;
  };
}

interface SteelCuttingPriceGroup {
  cuttingCategory: string;
  sourceCategories: string[];
  queryIds: string[];
  prices: SteelCuttingPriceRecord[];
  supplements: SteelCuttingPriceRecord[];
}
```

The same cutting data is emitted once per cutting category rather than copied
into every query result. `sourceCategories` and `queryIds` preserve the links
back to the affected order lines.

## Clean cutting workbook

`切工價錢-clean.xlsx` contains two import-ready sheets:

1. `cutting_prices`: concrete cutting price rows.
2. `cutting_supplements`: conditional surcharges, exclusions, formulas, and
   manual-review notes.

Both sheets preserve source sheet and row for audit. Item/spec text is
normalized with the same NFKC and `*`/`×`/`＊` to lowercase `x` rules used by
normal Steel price specifications.

For inch values and ranges, millimeters are calculated mathematically as
`inch * 25.4`. The database stores decimal `inch_min`, `inch_max`, `mm_min`,
and `mm_max` without rounding; a single value uses the same min/max. Cutting
lookup does not use those values as filters. The AI receives the source inch
text and exact millimeter endpoints in the returned catalog.

Tier A/C/F uses the workbook's combined A/C/F price. Tier B remains nullable in
the source and database. The returned cutting record exposes effective B as
the explicit B price when present, otherwise the shared A/C/F price. This
preserves the workbook's missing-value truth while giving the AI the applicable
price.

## Cutting schema

`steel.cutting_prices` is independent of `steel.prices` and has no ERP code or
`review_state` requirement. It stores both concrete price and supplemental
rows:

- identity `id`
- `cutting_category`
- `record_type` (`price` or `supplement`)
- `item_name`
- `cut_type`
- `spec_text`
- `normalized_spec_text`
- `inch_min` and `inch_max`
- `mm_min` and `mm_max`
- `unit`
- nullable `unit_price_a`, `unit_price_b`, `unit_price_c`, `unit_price_f`
- structured `conditions` JSONB
- nullable `calculation_rule`
- nullable `notes`
- `source_sheet` and `source_row`
- timestamps

The importer validates every clean workbook row before opening a transaction,
then atomically replaces the full table and verifies source/insert counts.

## Category pricing rules

### 鐵板

- 白鐵 below 3t, excluding 3t, prefers candidates containing `2B`.
- 白鐵 3t and above prefers candidates containing `NO1`.
- 黑鐵 at the same thickness prefers a product name containing `雷射切割`.

### C型鋼

When an order uses `2C`, the batched price request includes an additional exact
ERP query for `CCG02` (`型鋼結筒加工費`). The processing fee is total combined
weight in kg multiplied by the selected customer-tier price. `2C` material
weight and quantity are still doubled as required by the existing rule.

### Ratio prices

Only ratio prices whose row unit is `Kg` or `M` are automatically quoteable.
Other ratio units stay stored but are marked skipped pending a category rule.

## `system_order.肚`

The fixed output header uses `肚`, not `度`, immediately after `長度`.

`肚` is relevant only when `公式編號` is `DA`, `DB`, or `DC`; category is not
part of the condition. No derivation logic exists yet. If a confirmed input
provides `肚`, the value may be used. Otherwise the field stays empty and the
row is added to manual review rather than guessing a value.

The formulas remain:

- `DA = (長度 / 4) * 肚`
- `DB = (長度 / 3) * 肚`
- `DC = 長度 * 寬度 * 肚`

## Error handling and verification

- Workbook normalization rejects unknown record types, missing category/spec
  identity, malformed numeric values, and duplicate source rows.
- Import validation finishes before database mutation.
- Database replacement rolls back on count or readback mismatch.
- Search returns normal price results even when the consolidated cutting list
  is empty.
- Tests prove contains matching, numeric thickness equality, removed inputs and
  source refs, one consolidated unlimited cutting query, category mapping,
  tier-B fallback, CCG02 rules, and the `肚` output contract.
- Dev verification includes schema readback, imported row reconciliation,
  representative live grouped lookup, rule hash/readback, package build, and
  `git diff --check`.
