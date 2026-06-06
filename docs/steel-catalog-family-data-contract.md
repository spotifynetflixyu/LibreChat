# Steel Catalog Family Data Contract

This document is the current source of truth for how product names from
`docs/reference/` become stable catalog lookup keys for AI quoting and database
queries.

## Purpose

`catalog_family` is the generic product catalog key. It is not steel-only.
`docs/reference/產品價格.xlsx` includes raw steel, panels, doors, windows,
accessories, tools, fasteners, wheels, locks, services, and fallback ERP product
groups. AI must normalize oral order wording into `catalog_family` candidates
before calling query tools.

AI owns that normalization decision. Backend tools may expose reviewed
vocabulary/context and must validate explicit keys, but they must not silently
convert oral text such as `H鋼` or `黑A鋼管` into a single decided
`catalog_family` through code-level alias matching.

Runtime API names:

- DB column and scope: `catalog_family`
- AI/tool input: `catalogFamilies`
- DTO field: `catalogFamily`
- Canonical vocabulary table: `steel.catalog_families`
- AI vocabulary context tool: `lookup_catalog_families`

Do not keep a compatibility input for the old steel-only family name. The
current schemas reject that old request shape.

## Source Roles

| Source                                                         | Role                                                                                                                                                                                                          | Import behavior                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `docs/reference/產品價格.xlsx`                                 | Primary product catalog, tier prices, product unit weight, reviewed catalog keys, ERP prefix groups.                                                                                                          | Imported into `catalog_families`, `price_categories`, and `price_items`.                      |
| `docs/reference/客戶資料.xlsx`                                 | Customer list and customer tier codes.                                                                                                                                                                        | Imported into `customers` and `customer_tiers`.                                               |
| `docs/reference/切工價錢.xlsx`                                 | Cutting prices and fuzzy cutting notes.                                                                                                                                                                       | Imported into `cutting_prices`; fuzzy notes become `quote_defaults` for AI confirmation.      |
| `docs/reference/公式編號.xlsx`                                 | Fixed formula source.                                                                                                                                                                                         | Imported into `formula_versions`.                                                             |
| `docs/reference/H型鋼.txt`                                     | H 型鋼 regular/non-standard length surcharge default.                                                                                                                                                         | Imported into `quote_defaults` scoped by `catalog_family = h_beam`.                           |
| `docs/reference/訂單參考.xlsm`, `docs/reference/系統訂單.xlsx` | Workbook and ERP input references. `訂單參考.xlsm` is the development reference for visible sheet order, labels, headers, and seed rows; runtime workbook initialization uses code constants derived from it. | Classified as workbook-only; not imported as formal DB facts and not read at runtime.         |
| `docs/reference/龍頂鋼鐵手冊__文字版.docx`                     | Secondary weight/spec/alias evidence.                                                                                                                                                                         | Use for missing weights or future reviewed aliases; do not override product-price facts.      |
| Admin-reviewed instruction packets                             | Editable AI quote-rule prompts such as oral aliases, C 型鋼 strategy, and H 型鋼 processing rules.                                                                                                            | Stored in `instruction_packets`; retrieved with `lookup_quote_rules` / `lookup_instructions`. |

## Database Contract

```text
steel.catalog_families
  key                 stable catalog key, e.g. h_beam, screw, erp_ax
  display_name_zh     reviewed display name
  aliases             reviewed oral/written aliases
  metadata            import id, source row count, source kind
  source_refs         source evidence

steel.price_categories
  code                ERP prefix category key, e.g. erp_ehs, erp_ftb
  name                source-backed category display name
  catalog_family      dominant catalog family for the category

steel.price_items
  category_id         required link to price_categories for imported rows
  catalog_family      required catalog key for imported rows

steel.quote_defaults
  scope_type          may use catalog_family
  catalog_family      optional scoped key for defaults

steel.instruction_packets
  packet_groups       stable rule bundle keys, e.g. c-type-quote-core
  selectors           catalog/task/processing/formula/customer facets
  instruction         reviewed Traditional Chinese instruction body
  user_visible_notes  assumptions/defaults AI may show in replies
  confirmation_questions
                      user-confirmation prompts for ambiguous defaults

steel.material_rules / steel.bending_prices / steel.calculation_rule_defaults
  catalog_family      optional scoped key where the table uses product family facets
```

The importer creates one `price_items` row per product/tier combination. Every
imported product-price row must have both `category_id` and `catalog_family`.

## Import Coverage

Latest applied import through `packages/api/scripts/import-steel-reference-data.cjs`:

| Dataset            | Count |
| ------------------ | ----: |
| `catalog_families` |   210 |
| `price_categories` |   277 |
| `customers`        |  2256 |
| `price_items`      | 27024 |
| `cutting_prices`   |   238 |
| `formula_versions` |    31 |
| `quote_defaults`   |    29 |

The importer uses two levels:

1. Curated keys for reviewed product names and ERP code groups.
2. ERP-prefix fallback keys such as `erp_ax` so every source row is queryable
   even before a human promotes it to a curated key.

## Key Catalog Examples

| Key                     | Display   | Source rows | Example aliases            |
| ----------------------- | --------- | ----------: | -------------------------- |
| `h_beam`                | H型鋼     |         640 | H鋼, H-BEAM                |
| `c_type`                | C型鋼     |          57 | C鋼, 輕型鋼                |
| `angle`                 | 角鐵      |         206 | L角鐵, 錏角鐵, 鍍鋅角鐵    |
| `channel`               | 槽鐵      |         137 | U型鋼, 槽鋼                |
| `flat_bar`              | 平鐵      |         129 | 扁鐵, 扁鋼                 |
| `round_pipe`            | 圓管      |          89 | 圓鐵管, 白鐵圓管           |
| `square_pipe`           | 方管      |         162 | 四方管, 方鐵管             |
| `rectangular_pipe`      | 扁方管    |          99 | 矩形管, 錏扁方管           |
| `steel_pipe`            | 鋼管      |          27 | 黑鋼管, 白鋼管             |
| `piping`                | 配管      |          83 | 白鐵配管, 配管彎頭         |
| `b_pipe`                | B管       |          18 | 鍍鋅B管                    |
| `a_pipe`                | A管       |          49 | 黑A鋼管, 白A鋼管           |
| `p_pipe`                | P型管     |           5 | 白鐵P型管                  |
| `wall_panel`            | 壁板      |          13 | 屋面壁板                   |
| `resin_panel`           | 樹脂      |          19 | 樹脂板, 樹脂清板           |
| `aluminum_window`       | 鋁窗      |         137 | 氣密鋁窗, 收邊鋁窗         |
| `water_stop_plate`      | 擋水板    |           5 | 鋁合金擋水板               |
| `iron_door`             | 鐵門      |          28 | 白鐵門, 黑鐵門             |
| `canopy_frame`          | 棚架      |          22 | 雨棚架                     |
| `square_pipe_connector` | 方管連料  |          60 | 方管連料U型                |
| `telescopic_gate`       | 伸縮大門  |          59 | 伸縮門                     |
| `screen_mesh`           | 紗網      |          31 | ST紗網                     |
| `door_decoration`       | 門花      |         420 | 鑄花                       |
| `screw`                 | 螺絲      |         323 | 鏍絲, 自攻釘, 拉丁, 釘子   |
| `corner_wheel`          | 角輪      |         109 | H輪, 輪子                  |
| `door_lock`             | 門鎖      |         117 | 鎖, 鋁門鎖, 防火門鎖       |
| `i_beam`                | I字鐵     |          89 | 工字鐵, I-Beam             |
| `round_bar`             | 圓鐵/圓條 |          89 | 圓鐵, 圓條, 圓鋼           |
| `square_bar`            | 方鐵      |          38 | 方鋼                       |
| `galvanized_plate`      | 錏板      |          37 | 鍍鋅板                     |
| `ot_plate`              | OT板      |         109 | OT板                       |
| `black_plate`           | 黑板      |          51 | 黑鐵板                     |
| `grating`               | 鐵格板    |         128 | 格板                       |
| `floor_deck`            | 樓層板    |           5 | 50型樓層板, 75型樓層板     |
| `wire_mesh`             | 點焊網    |          32 | 點焊鋼絲網, 鋼絲網         |
| `expanded_metal`        | 網板      |          31 | OT網板, 擴張網板           |
| `corrugated_panel`      | 浪板/收邊 |         112 | 角浪板, 屋面板, 清板       |
| `plate`                 | 板材      |          26 | 鐵板, 鋼板                 |
| `measuring_tool`        | 量尺      |          18 | 捲尺, 鋼捲尺, 水平尺, 角尺 |

`尺` is intentionally narrow. Only clear measuring tools map to
`measuring_tool`; dimensions like `1尺0` on other products do not.

## Boundary Rules

- `telescopic_gate` must not use the whole `AX` ERP prefix. It maps by
  `伸縮大門` / `伸縮門` product wording and `SA/SAC/SAS` ERP groups. Other AX
  rows stay in fallback keys such as `erp_ax`.
- `corrugated_panel` uses reviewed panel/trim ERP groups and product wording.
  Do not map windows, tools, or accessories just because the name contains
  `收邊` or `浪板`.
- `screw` owns fastener rows, including names containing `鋼板專用`; those are
  not steel plate price rows.
- `plate`, `galvanized_plate`, `ot_plate`, and `black_plate` are separate keys
  when product-price evidence distinguishes them.
- Surface treatment, grade, length, thickness, and customer-specific behavior
  should stay separate facets unless a reviewed rule says they define a
  different catalog family.

## Product Price Amount Calculation

`產品價格.xlsx` 的售價欄必須搭配產品列的價格單位與單位重語意解讀。AI 與
backend 不可只因使用者問「一支多少」就把 `unitPrice` 當成每支總價。

`unit` 是售價欄單位；`product_price_unit_weight_unit` 是重量欄語意。兩者要一起
判讀：

- 此規則只套用在鋼材/材料 stock catalog families，例如 `h_beam`（含 `輕量H`）、
  `c_type`、`angle`、`channel`、`flat_bar`、`rail`、pipe families、plate
  families、mesh、grating、floor deck。非鋼材或非材料產品/accessory rows，例如
  彈簧、螺絲、門鎖、角輪、鋁窗、樹脂、鐵門、伸縮門、量尺等，不套用這套
  kg/m、kg/支換算規則；除非有另外 reviewed rule，否則按該 row 的 `unitPrice`
  直接作件/組/支價或 manual review。
- 普遍鋼材的 `product_price_unit_weight_unit` 是 `kg_per_m`。此時
  `product_price_unit_weight` 是 kg/m。若 `unit=kg`，售價欄是每 kg 售價，計算金額
  時先用 `kg/m * lengthM * quantity` 換算重量，再乘以售價。
- 品名或規格明確帶固定長度 `M` 時，`product_price_unit_weight_unit` 是
  `kg_per_piece`，單位重代表重量/支。若 `unit=kg`，整支金額是
  `重量/支 * unitPrice`；若 `unit=piece`，`unitPrice` 已是整支金額。預設整支
  計價，即使切料後有餘料也計價。只有使用者明確說餘料不計價時，才把重量/支除以來源
  長度得到 kg/m，再乘以實際切料長度換算。
- 若 `單位重` 欄位是 0，但品名最後括號內有數字，且 reviewed row 可用
  `售價 = 括號重量 * 比率` 驗證，括號數字就是重量/支補漏來源。匯入時
  `product_price_unit_weight_unit=kg_per_piece`、`unit=piece`，metadata 記錄
  `sourceUnitWeightOrigin=product_name_parentheses`。Example:
  `白鐵平鐵 50 *8.0( 19.7)` 的 A 價 `2107.90`、比率 `107.00`，所以
  `19.7 * 107 = 2107.9`，`19.7` 是 reviewed 重量/支。
- 若 `單位重` 欄位已有正值，欄位值優先於品名括號；括號只能作補漏來源，不能覆蓋
  reviewed 欄位值。Example: `6K鐵軌 6M(38)` 的 `單位重=36`，且
  `9K鐵軌 6M(54)` 可佐證比例，因此 6K 鐵軌採 `36kg/支`，不可採括號 `(38)`。
- 固定長度材料 row 若有正值 `比率` 欄且 `售價` 欄為整支價，即使該整支價看起來是
  用錯誤括號重量算出，也不可把 `售價` 當每 kg 單價。Example:
  `6K鐵軌 6M(38)` 的 A 價 `2090` 與比率 `55` 對應錯誤括號 38，但重量仍採
  `單位重=36`；報價可先把 `2090` 視為整支價，並把重量矛盾標示為待確認/推論。
- 若單位重缺失或來源互相矛盾，可以查相同系列、相同規格、不同長度或相近材料的
  reviewed rows，用長度比例或規格比例換算作推論 evidence。這類結果必須標示
  inferred/low confidence 或待確認，不可靜默覆蓋 reviewed 欄位值。
- 若固定長度品名的單位重為 0 或缺失，應查相同規格、不同長度但有 reviewed 單位重
  的 row，推回 kg/m 後再依本次長度計算；找不到可驗證重量時標示 low confidence 或
  manual review。

Example: `C型鋼 C100x50x20x2.3t 6M 一支多少？` 若 reviewed row 是
`錏輕型鋼 100x2.3`、售價 `NT$25-26.8/kg`、單位重 `4kg/m`，則一支 6M 是
`24kg`，暫估材料價約 `NT$600-643.2`。不可回覆 `NT$25-26.8/支`。

Catalog mapping notes:

- `輕量H` rows such as `輕量H150*75*3.2/4.5*6M(53)` are H 型鋼 material
  rows and use `h_beam` semantics.
- `BNH` rows are steel/material plate rows and must not remain fallback
  `erp_bnh` rows for price-unit calculations.

## AI Normalization Flow

1. Extract product words, shape, surface, size, quantity, and uncertain notes
   from the order/file.
2. When the catalog family is unclear, call `lookup_catalog_families` with
   AI-extracted product/catalog wording or explicit keys. The tool returns
   `catalogFamilyCandidates` and source context only; it does not return a
   backend-resolved key.
3. AI reviews the returned vocabulary/context and selects one or more
   `catalogFamily` candidates, or marks the mapping ambiguous.
4. If the user provided a customer name in the same quote request, call
   `search_customers` in the initial lookup round when available. Use the
   selected customer id/tier as `customerContext` in the following rule/default
   lookup so customer-scoped defaults can be returned.
5. Query `lookup_quote_rules` with batched `catalogContexts` before
   category-dependent price/default/formula lookups. One call may include
   multiple material/catalog keys such as `c_type` and `h_beam`; `lineRefs` help
   attach rules to workbook rows but are not required just to retrieve material
   defaults. Use `lookup_defaults` only for defaults-only compatibility flows.
6. Query `search_price_candidates` with `catalogFamilies` plus bounded
   product/spec candidate queries, using the same selected catalog keys from
   `lookup_catalog_families` / `lookup_quote_rules`.
   - `catalogFamilies` is the field for selected catalog/material keys such as
     `c_type`, `h_beam`, or `angle`.
   - `productNames` is the only AI-callable field for reviewed or AI-inferred
     product-name candidates with the same spec/catalog/tier filters. Use it
     for one or many plausible names such as `錏成型角鐵` and `鍍鋅角鐵`.
   - Use `candidateQueries` instead of `productNames` when each candidate needs
     its own confidence, reason, or spec fragment; each candidate query uses
     `productNames` for one or many reviewed product-name candidates.
   - When no reliable catalog key is available after `lookup_catalog_families`,
     AI may search with `productNames` using concise inferred product-name
     candidates, not the full raw user sentence. The result stays provisional or
     low confidence until reviewed candidates or the user confirm it.
   - For `c_type`, product-price rows use width/thickness fragments such as
     `100x2.3`; full section text such as `100x50x20 2.3t` is not enough by
     itself. The price tool validates this so failed oral normalization loops
     back to the AI instead of silently returning no candidates.
   - When C 型鋼 material/surface is not specified, AI may use
     `productNames: [錏輕型鋼]` as the usual high-confidence provisional
     candidate list, while still showing bounded alternatives such as
     白鐵輕型鋼 and 黑鐵輕型鋼 for confirmation.
   - When customer/tier is not specified, or customer lookup cannot find a usable
     customer price tier, AI must use the global default B tier by passing
     `customerTierId: 2` to price lookup. The response should keep this concise,
     for example `目前用 價格B：26.8 元/kg`, and separately mention that providing
     a customer name allows a customer quote price lookup. Do not add
     highest/most-expensive wording unless the user asks. If customer lookup
     returns a usable tier, AI must use that customer tier instead of the B
     default.
   - User-facing price bullets should use `價格`, not `reviewed 價格`.
     Reviewed/source status belongs in the source line or note text.
   - In quick price responses, if total piece weight is shown, do not also list
     unit weight as a separate bullet. Prefer one compact line such as
     `6M 一支重量：4 × 6 = 24 kg`.
   - In a follow-up turn after material alternatives were shown, if the user
     does not specify another C 型鋼 material/surface, AI treats the default
     錏輕型鋼 assumption as confirmed for the continuing quote context.
7. If returned instruction packets require `lookup_formula`, call
   `lookup_formula` with the same selected `catalogContexts` before the final
   quote answer.
8. If multiple reviewed candidates remain plausible, ask the user to confirm.
   For quick approximate quotes, show the selected assumption and alternatives.

Workbook patch ownership:

- For `/steel/oauth-chat`, AI owns workbook patch content. When workbook context
  is available, the model must call `patch_quote_workbook` with semantic quote
  data for every user-relevant sheet that has derivable data: `system_order`,
  `quote_details`, `summary`, `manual_review`, `price_sources`,
  `interpretation_notes`, and `customer_quote`.
- Backend provider orchestration may reject or remind an incomplete provisional
  price patch by returning missing sheet ids and missing workbook cell targets
  to the model. Backend code should not hard-code derived companion rows for
  multi-material quote lists because each line can have different material,
  source, customer, confidence, and missing-field evidence.
- Completion is checked per workbook update turn, not only by final field count
  or by whether a sheet was touched. A sparse patch that only creates shell
  rows such as `line_no`/`item` is incomplete when user-visible minimum cells
  are still missing, for example ERP `item_spec`/`unit_price`, summary `value`,
  review `confirmation_needed`, source `adopted_product_price_item`, note
  `content`, and customer quote `item_spec`/`unit_price`/`subtotal`.
- The same completeness rule applies to follow-up turns that update an existing
  quote line, such as customer selection, customer tier changes, material
  confirmation, or repricing. A follow-up semantic patch that updates
  `quote_details` quote/calculation fields must still include companion semantic
  fields for the relevant workbook sheets.
- If material, customer, reviewed source, or calculation evidence is unavailable,
  AI leaves the target value blank and records the missing evidence in
  `manual_review` or `interpretation_notes` instead of inventing a value.
- Do not expose direct workbook cell operations to AI. `patch_quote_workbook`
  stays compact by sending semantic quote fields; backend projection creates the
  synchronized workbook cell operations.

Workbook fill contract from `docs/reference/訂單參考_轉檔.xlsx`:

- `patch_quote_workbook` output is organized from app/backend tool results: customer
  lookup, product-price lookup, quote rules/defaults, formula lookup, and
  deterministic `calculation_results`. If `calculation_results` conflicts with
  an interpreted quote item, the workbook uses `calculation_results` and records
  a concise discrepancy note.
- Price evidence has priority over weight evidence. Material unit prices and
  processing prices must come from reviewed app/backend data or an explicit user
  price. Handbook/manual weights can fill weight/spec evidence but cannot
  replace missing product prices.
- Unknown unit prices, unknown amounts, missing formulas, missing weights, and
  ambiguous customer/material matches are written as `未確認`, never as `0`.
  They also create `人工複核` rows when the gap can affect the quote.
- `系統訂單` separates material rows from processing rows. C 型鋼 defaults create
  a material row only unless reviewed rules or explicit user input require
  separate cutting/hole rows.
- `系統訂單`.`型號` is the adopted product-price row model/code from
  `產品價格.xlsx` / `search_price_candidates`, carried in semantic
  `systemOrder.modelCode`. It is not an oral product name, catalog family key,
  or material category.
- `報價明細` owns the working calculation line. `小計` is the sum of material,
  cutting, hole, slotting, bending, and other fees; if any required unit price is
  unknown, `小計` is `未確認`.
- `總結` separates confirmed amounts from low-confidence provisional estimates:
  `確定金額` and `低信心暫估金額` must not be mixed.
- `價格來源` records one source row for every material or processing line. A
  no-price result still gets a source row with the adopted item as `未確認` and
  source as `未找到` or the actual searched source.
- `判讀備註` records only concise human-readable reasoning: customer/tier
  judgment, price search strategy, oral name conversion, weight source, stock
  allocation, no-zero unknown policy, OCR/drawing assumptions, and approximate
  or substitute candidate use.
- `給客戶用` is customer-visible only. It must not expose customer tier, source
  refs, search keywords, candidate rows, rejected-candidate reasons, AI/internal
  notes, cost, margin, or low-confidence internal reasons. Unknown unit price or
  subtotal is shown as `未確認`.

Workbook version/highlight behavior:

- A new workbook starts at `v1` with sheet/column structure only and no data
  rows.
- The first accepted data patch into an empty workbook is treated as initial
  data load: the workbook remains `v1` and `changedPaths` is empty so no cells
  are highlighted as "updated". `changedFieldSummary` may still be returned for
  concise chat summaries.
- Later accepted patches against a workbook that already has data rows are
  normal updates: they increment the workbook version and return `changedPaths`
  for latest-update highlighting.

Examples:

| Raw wording            | Expected key      | Notes                                                                                                          |
| ---------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `H鋼 100x100`          | `h_beam`          | Then query H price rows and H surcharge defaults.                                                              |
| `C型鋼 100x50x20 2.3t` | `c_type`          | Query by `c_type` plus size/thickness fragments such as `100x2.3`; do not narrow with `productNames: [C型鋼]`. |
| `亞L30x30`             | candidate `angle` | `亞` is a low-confidence surface/typo clue; ask when needed.                                                   |
| `白鐵配管1/4`          | `piping`          | Query by piping key and spec/name candidates.                                                                  |
| `黑A鋼管`              | `a_pipe`          | Do not collapse into generic pipe when A管 is explicit.                                                        |
| `磁鋼板專用小六角釘子` | `screw`           | Not `plate`.                                                                                                   |
| `1尺0 鐵格板`          | `grating`         | The `尺` token is a dimension, not `measuring_tool`.                                                           |

## Future Update Workflow

1. Put the updated XLSX in `docs/reference/` or wire the future update workbook
   into the same importer path.
2. Run dry-run:

   ```bash
   cd packages/api
   npm run steel:import-reference-data
   ```

3. Review `catalogFamilies`, `priceCategories`, and source row samples. Promote
   new curated keys only when wording/ERP groups prove a stable product family.
4. Apply:

   ```bash
   cd packages/api
   npm run steel:import-reference-data -- --apply
   ```

5. Verify:

   ```sql
   SELECT COUNT(*)
   FROM steel.price_items
   WHERE last_import_log_id = 'docs-reference-product-prices-v1'
     AND (catalog_family IS NULL OR category_id IS NULL);

   SELECT key, display_name_zh, metadata->>'sourceProductRowCount'
   FROM steel.catalog_families
   WHERE active = true
   ORDER BY key;
   ```

## Handbook Boundary

`龍頂鋼鐵手冊__文字版.docx` remains secondary. It helped identify or validate
terms such as I 字鐵, 槽鐵, 角鐵, 平鐵, 圓鐵/圓條, 方鐵, 樓層板, 點焊網,
網板, and steel plate variants. Product-price rows now decide the active
catalog keys; handbook-only candidates such as steel rail or checkered plate
should be promoted only after matching price rows or real orders prove the
need.
