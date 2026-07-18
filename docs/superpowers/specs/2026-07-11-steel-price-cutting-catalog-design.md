# Steel Price And Cutting Catalog Design

## Goal

Update `search_price_candidates`, the Steel price schema, category rules, and
`system_order` output so one grouped multi-item price lookup returns normal
price candidates plus one consolidated cutting-price catalog. Build that
catalog from `docs/reference/切工價錢-raw.xlsx` through a reviewed
`docs/reference/切工價錢-v4.4-normalized.xlsx`, import it into an independent
`steel.cutting_prices` table, and roll out to dev Supabase only.

## Authoritative sources

- `docs/products_db_v4.2.xlsx` remains authoritative for `steel.prices`.
- `docs/reference/切工價錢-raw.xlsx` is the source for concrete cutting prices.
- `docs/reference/切工價錢-v4.4-normalized.xlsx` is the only import source for
  `steel.cutting_prices`.
- The clean workbook is generated before the database migration/import is
  applied and is visually and structurally verified before use.
- Production remains unchanged until the user explicitly approves the verified
  dev result.

## Price query contract

One `search_price_candidates` call accepts one or more grouped queries without a
top-level query-count cap. Each query keeps its own candidate limit.
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

`thicknessMm` is compared numerically with stored `thickness_min_mm` and
`thickness_max_mm`. Exact ranges require equality; interval ranges include the
lower bound and exclude the upper bound.

`limit` is optional and defaults to 30. The AI omits it normally and uses 100
only when expanding the candidate set. Positive values over 100 clamp to 100
without rejecting the call.

`steel.prices.review_state` and its indexes/constraints are removed. Price
lookup no longer accepts or applies a reviewed filter. The independent
`steel.rules.review_state` publication workflow remains unchanged.

Price rows no longer store import/source metadata, activity flags, timestamps,
`dimension_signature`, `source_thickness`, or `normalized_spec_text`.
`spec_key` is the canonical searchable specification text.

## Consolidated cutting lookup

The system expands lookup-query categories through one shared exact category
mapping and performs one unlimited `steel.cutting_prices` query in parallel
with the normal grouped price query. After both return, backend code filters the
cutting catalog by the successfully matched material candidate specifications
before adding it to the final price data. Category discovery and no-match
queries contribute no cutting rows.

Supported mappings are:

| Product category | Exact cutting categories |
| --- | --- |
| H型鋼 | H型鋼, 工字鐵/H型鋼 |
| I型鋼/工字鐵 | 工字鐵/H型鋼 |
| 平鐵 | 平鐵 |
| 圓管 | 鐵管 |
| 方管 | 鐵管 |
| 扁方管 | 鐵管 |
| 圓條 | 鐵管 |
| 方鐵 | 鐵管 |
| 角鐵 | 角鐵 |
| 槽鐵 | 槽鐵 |

Every cutting lookup uses an equality join:

```sql
cutting_category = lookup.cutting_category
```

The same mapping is used again before candidate-to-cutting-record matching, so
SQL retrieval and backend filtering cannot drift. `鐵板` is deliberately absent:
it searches processing rows in `steel.prices` and never queries
`steel.cutting_prices`.

The database cutting lookup uses no thickness, dimension, keyword, or row limit
filter. The AI-visible output is candidate-aware:
H sections use stored `height_mm`/`width_mm`, pipe families prefer nominal inch
and otherwise use approved aliases or millimeter fallback, and
angle/channel/flat rows use their category-specific dimensions. All millimeter
comparisons use integer parts. A matched
candidate with no unique cutting row does not fall back to the full catalog.
If no supported product category is present, the
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
}
```

The same filtered cutting data is emitted once per cutting category rather than
copied into every query result. `sourceCategories` and `queryIds` are rebuilt
from successful candidate matches and preserve only the affected order lines.

## Clean cutting workbook

`切工價錢-v4.4-normalized.xlsx` contains one import-ready `cutting_prices`
sheet with concrete `加工/切工` price rows. Supplement and other processing
rows are excluded. `spec_text` is the only stored specification text and uses
NFKC plus `*`/`×`/`＊` to lowercase `x` normalization.

For inch values and ranges, millimeters are calculated mathematically as
`inch * 25.4`. The database stores decimal `inch_min`, `inch_max`, `mm_min`,
and `mm_max` without rounding; a single value uses the same min/max. Cutting
lookup compares millimeter dimensions by integer part rather than decimal
precision. Inch rows use their inch bounds and approved nominal-size aliases.

Tier A/C/F uses the workbook's combined A/C/F price. During normalization, the
parser fills a blank Tier B from Tier A; runtime code consumes only the resolved
`unit_price_b` and does not expose or calculate `tierBSource`.

## Cutting schema

`steel.cutting_prices` is independent of `steel.prices` and has no ERP code or
`review_state` requirement. It stores only concrete `加工/切工` price rows:

- identity `id`
- `cutting_category`
- `item_name`
- `cut_type`
- `spec_text`
- `inch_min` and `inch_max`
- `mm_min` and `mm_max`
- `height_mm` and `width_mm` for `H型鋼` and `工字鐵/H型鋼`; those rows do not
  use `inch_min/max` or `mm_min/max`
- `thickness_mm_values`, `thickness_mm_min`, and `thickness_mm_max`
- `unit`
- nullable `unit_price_a`, `unit_price_b`, `unit_price_c`, `unit_price_f`
- nullable `notes`
- timestamps

The importer validates every clean workbook row before opening a transaction,
then atomically replaces the full table and verifies the complete 97-row
catalog. Empty Tier B values are filled from Tier A by the parser before import.

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

- Workbook normalization rejects missing category/spec identity, malformed
  numeric values, invalid category-specific sizing, and non-`加工/切工` rows.
- Import validation finishes before database mutation.
- Database replacement rolls back on count or readback mismatch.
- Search returns normal price results even when the consolidated cutting list
  is empty.
- Tests prove exact cutting-category lookup, integer-part millimeter matching,
  removed inputs and source refs, one consolidated unlimited cutting query,
  shared category mapping, parser-resolved Tier B, CCG02 rules, and the `肚`
  output contract.
- Dev verification includes schema readback, imported row reconciliation,
  representative live grouped lookup, rule hash/readback, package build, and
  `git diff --check`.
