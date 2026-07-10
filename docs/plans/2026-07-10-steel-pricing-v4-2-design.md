# Steel Pricing v4.2 Design

## Goal

Make `docs/products_db_v4.2.xlsx` the complete source of truth for
`steel.prices`, redesign `search_price_candidates` around query-addressable
grouped results, restore nullable A-F ratio prices, and rename reviewed Steel
category rules to `類別規則`.

## Data ownership

- `products_db_ready` is the only imported sheet.
- `erp_item_code` is the sole row identity and is unique.
- Every workbook row creates exactly one `steel.prices` row.
- Applying the workbook replaces the whole table. Rows absent from the workbook
  are deleted.
- `spec_key` is searchable text, not identity. It is normalized as
  `<erp_item_code> <normalized_spec_text>` and indexed with `pg_trgm`.
- Missing prices, ratios, weights, density, and dimensions are stored as SQL
  `NULL`, never placeholder zeroes.

## Category taxonomy

The category enum is:

`C型鋼`, `H型鋼`, `I型鋼/工字鐵`, `T型鋼`, `鐵板`, `平鐵`, `角鐵`,
`圓鐵`, `圓管`, `方鐵`, `方管`, `扁方管`, `網`, `格板/隔板`, `板/浪板`,
`鐵軌`, `槽鐵`, `捲門/伸縮門`, `門窗/門板`, `五金/配件`, `加工/孔`,
`加工/切工`, `加工/折工`, `加工/其他`, `加工/開槽`, `其他`.

The query-facing subcategory registry is the union of the user's list and all
non-empty values present in v4.2. The importer validates pairs against this
registry; empty subcategory remains valid for every category.

| Category | Subcategories |
| --- | --- |
| C型鋼 | 加工/其他 |
| H型鋼 | — |
| I型鋼/工字鐵 | — |
| T型鋼 | — |
| 鐵板 | 網板、花板、圍籬板、檔泥板、特殊 |
| 平鐵 | — |
| 角鐵 | 不等邊、烤漆、配件 |
| 圓鐵 | 其他 |
| 圓管 | 鋼管、圓條、A管、B管、配管、連料 |
| 方鐵 | — |
| 方管 | 連料 |
| 扁方管 | — |
| 網 | 點焊網、菱形網、浪型網、高床網、刺網、配件 |
| 格板/隔板 | — |
| 板/浪板 | 五金/配件 |
| 鐵軌 | — |
| 槽鐵 | — |
| 捲門/伸縮門 | 邊柱、配件、中柱、遙控、底支、其他 |
| 門窗/門板 | 門花、網、配件、角鐵、窗花 |
| 五金/配件 | 節竹鐵、花管、配管、焊條、螺帽、螺母、螺絲、後鈕、馬達箱、華司、壁虎、鑄花、釘、鋸、彈簧、輪子、油漆、扶手、伸縮器、矽利康、膠、培林座、配件、螺母/螺絲、加工、蜂巢紙 |
| 加工/孔 | 鐵板、角鐵、接頭、五金、門 |
| 加工/切工 | 鐵板、板/浪板、圓管、槽鐵、方管、H型鋼、平鐵、角鐵、I型鋼/工字鐵 |
| 加工/折工 | 鐵板、花板、特殊、消音、切工、門、車斗、中柱、工具箱、無缺口、其他 |
| 加工/其他 | C型鋼、鐵板、圓管、H型鋼、扁鐵、角鐵、網、捲門/伸縮門、扁、L、丸條、U、加工 |
| 加工/開槽 | H型鋼 |
| 其他 | 蜂巢紙、曬衣架、保麗龍、手套、加工、配件 |

## Search contract

One tool call accepts 1-20 queries. `queryId` is optional for backward
compatibility; omitted IDs normalize to `q1`, `q2`, and so on. Category lookup
queries accept `category`, `subcategory`, `material`, `thicknessMm`,
`erpItemCode`, `keyword`, `unit`, and `limit`.

`limit` defaults to 30. Any positive integer above 100 is normalized to 100;
it is not rejected.

Results are grouped in input order:

```ts
interface SteelPriceQueryResult {
  queryId: string;
  query: NormalizedSteelPriceQuery;
  status: 'ok' | 'no_match' | 'invalid_subcategory' | 'category_mismatch';
  candidates: SteelPriceItem[];
  categoryCandidates: SteelPriceCategoryCandidate[];
  issues: SteelPriceQueryIssue[];
}

interface SearchPriceCandidatesOutput {
  queryResults: SteelPriceQueryResult[];
  summary: {
    queryCount: number;
    matchedQueryCount: number;
    noMatchQueryCount: number;
  };
}
```

Deduplication is scoped to one query. The same price row may appear in several
query groups. Lookup is executed as one SQL statement carrying query index and
query ID, so grouped provenance does not add cloud round trips.

## Pricing options

Direct tier prices A-F remain the first choice. Ratios are stored separately
and never overwrite direct prices.

```ts
interface SteelPriceOption {
  source: 'tier_price' | 'price_ratio';
  quoteUnit: string;
  tierPrices: { A: number | null; B: number | null; C: number | null; D: number | null; E: number | null; F: number | null };
}

interface SteelSkippedPriceOption {
  source: 'price_ratio';
  status: 'skipped';
  reason: 'category_rule_pending';
}
```

- A direct option is emitted when any direct price exists.
- A ratio option is emitted only when the row unit is `Kg` or `M`.
- A non-Kg/M ratio is retained in the database but emitted as a skipped option
  with `category_rule_pending` for future category-rule completion.
- A ratio-only non-Kg/M row is not quote eligible.
- Raw ratio columns are not copied into the top-level AI-visible candidate.

## Category rules

Rename `docs/rules/鋼材規則` to `docs/rules/類別規則`. English identifiers and
descriptions call these `category rules`. Existing calculation rules move
without losing their reviewed slugs. A new lookup rule documents every category,
its complete subcategories, available facets, example
`search_price_candidates` query, unit handling, and ratio status.

Generic tool-envelope and retry behavior stays in `agent規則.txt`. Category
lookup examples and price formulas stay in `類別規則`.

## Workbook output

`system_order` gains a `度` column immediately after `長度`:

```text
... 厚度, 寬度, 長度, 度, 類別, 交貨日期, 備註
```

`度` is populated only when category is `捲門/伸縮門` and formula code is
`DA`, `DB`, or `DC`. It supplies the reviewed live formulas' existing `肚`
variable. Every other category leaves `度` empty.

## Deployment

1. Repair the live migration ledger entry that is structurally present but
   absent from history.
2. Apply an expand migration.
3. Parse and validate all 6,761 workbook rows before opening the replacement
   transaction.
4. In one transaction, lock and truncate `steel.prices`, insert all rows, and
   verify counts/state totals before commit.
5. Apply the finalize migration and verify constraints/indexes.
6. Sync reviewed agent/output/category rules and read them back.

The application uses direct Postgres through `STEEL_POSTGRES_URL`; no public
Data API exposure or Docker database is introduced.
