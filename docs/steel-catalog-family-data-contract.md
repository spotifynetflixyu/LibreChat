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

| Source                                                         | Role                                                                                                 | Import behavior                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `docs/reference/產品價格.xlsx`                                 | Primary product catalog, tier prices, product unit weight, reviewed catalog keys, ERP prefix groups. | Imported into `catalog_families`, `price_categories`, and `price_items`.                 |
| `docs/reference/客戶資料.xlsx`                                 | Customer list and customer tier codes.                                                               | Imported into `customers` and `customer_tiers`.                                          |
| `docs/reference/切工價錢.xlsx`                                 | Cutting prices and fuzzy cutting notes.                                                              | Imported into `cutting_prices`; fuzzy notes become `quote_defaults` for AI confirmation. |
| `docs/reference/公式編號.xlsx`                                 | Fixed formula source.                                                                                | Imported into `formula_versions`.                                                        |
| `docs/reference/H型鋼.txt`                                     | H 型鋼 regular/non-standard length surcharge default.                                                | Imported into `quote_defaults` scoped by `catalog_family = h_beam`.                      |
| `docs/reference/訂單參考.xlsx`, `docs/reference/系統訂單.xlsx` | Workbook and ERP input references.                                                                   | Classified as workbook-only; not imported as formal DB facts.                            |
| `docs/reference/龍頂鋼鐵手冊__文字版.docx`                     | Secondary weight/spec/alias evidence.                                                                | Use for missing weights or future reviewed aliases; do not override product-price facts. |

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

## AI Normalization Flow

1. Extract product words, shape, surface, size, quantity, and uncertain notes
   from the order/file.
2. When the catalog family is unclear, call `lookup_catalog_families` with
   AI-extracted product/catalog wording or explicit keys. The tool returns
   `catalogFamilyCandidates` and source context only; it does not return a
   backend-resolved key.
3. AI reviews the returned vocabulary/context and selects one or more
   `catalogFamily` candidates, or marks the mapping ambiguous.
4. Query `search_price_candidates` with `catalogFamilies` plus bounded
   product/spec candidate queries.
   - For `c_type`, product-price rows use width/thickness fragments such as
     `100x2.3`; full section text such as `100x50x20 2.3t` is not enough by
     itself. The price tool validates this so failed oral normalization loops
     back to the AI instead of silently returning no candidates.
   - When C 型鋼 material/surface is not specified, AI may use
     `productName: 錏輕型鋼` as the usual high-confidence provisional candidate,
     while still showing bounded alternatives such as 白鐵輕型鋼 and 黑鐵輕型鋼
     for confirmation.
5. Query `lookup_defaults` with `catalogContexts` when cutting, hole, slotting,
   formula, or customer-rule defaults may apply.
6. If multiple reviewed candidates remain plausible, ask the user to confirm.
   For quick approximate quotes, show the selected assumption and alternatives.

Examples:

| Raw wording            | Expected key      | Notes                                                                                                       |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `H鋼 100x100`          | `h_beam`          | Then query H price rows and H surcharge defaults.                                                           |
| `C型鋼 100x50x20 2.3t` | `c_type`          | Query by `c_type` plus size/thickness fragments such as `100x2.3`; do not narrow with `productName: C型鋼`. |
| `亞L30x30`             | candidate `angle` | `亞` is a low-confidence surface/typo clue; ask when needed.                                                |
| `白鐵配管1/4`          | `piping`          | Query by piping key and spec/name candidates.                                                               |
| `黑A鋼管`              | `a_pipe`          | Do not collapse into generic pipe when A管 is explicit.                                                     |
| `磁鋼板專用小六角釘子` | `screw`           | Not `plate`.                                                                                                |
| `1尺0 鐵格板`          | `grating`         | The `尺` token is a dimension, not `measuring_tool`.                                                        |

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
