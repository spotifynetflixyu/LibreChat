# Source Schema Mapping

Goal: keep Chinese source labels from `docs/reference` aligned with English database, API, tool, and prompt contracts for Steel spec and price data.

This v8.3 mapping is intentionally narrower than the old v8.2 draft. It only covers fields that are expected to become database-backed keys for spec tables, price tables, formulas, and processing-price tables. It is not a runtime import file, not a workbook UI schema, and not a dump of every Chinese display label.

## Decisions

- Programmatic contracts use English canonical keys for SQL columns, repository filters, DTO fields, tool args, and AI structured output.
- Chinese labels remain as source labels, ERP/export sheet names, display labels, aliases, search terms, and source excerpts.
- Fixed workbook and Excel sheet names stay in Chinese because they must remain compatible with ERP-facing output and the reference workbook names.
- The sheet names themselves are not translated into database keys. Sheet names are handled by workbook/export rendering; this mapping covers database-bound fields only.
- `docs/reference` files are development references for source format, naming, and structure. They do not become production data by direct parser import.
- Formula reference files, including `docs/reference/公式編號 - Sheet1.csv`, are used to understand formula naming and structure. Runtime/calculator data should come from reviewed app-ready data such as JSON or reviewed database rows, not from parsing the CSV directly at quote time.
- Current source files may contain text typos, but no separate typo approval workflow is required. By the time code agents generate importable data or SQL, mapping rows should already use the corrected business concept.
- Do not add `review_status`, `corrected_text`, or approval-state columns to this mapping unless a later data-import task explicitly needs them.
- Treat ERP XLSX column names as stable and append-only for v8.3 import design. Future source files may add columns, but existing required columns should not be renamed; parsers should tolerate extra columns while preserving required-key validation.
- Backend validation remains authoritative. The AI API can propose a canonical key from the mapping, but it cannot create new keys or bypass DTO/tool/schema validation.

## Source Of Truth Path

Planning source:

- `tasks/v8.3/source-schema-mapping.md`

Code version to design during implementation:

- `packages/api/src/steel/schema/mapping.ts`
- `packages/api/src/steel/schema/mapping.spec.ts`

The code version should export:

- Canonical schema key constants for database-bound fields.
- Chinese source aliases and display labels for those keys.
- Target table, column, DTO, and tool metadata.
- A serializer for task-scoped prompt context, e.g. `buildSourceSchemaMappingPromptContext({ target: 'price_lookup' })`.
- Guard helpers for tool/prompt code, e.g. `resolveSourceSchemaKey(sourceLabel)`.

If frontend display code later needs labels, expose only display-safe labels through `packages/data-provider`; keep SQL table/column metadata backend-owned.

## AI API Contract

Prompt and tool orchestration should include a compact, task-scoped mapping packet:

```json
{
  "source_schema_mapping": [
    {
      "source_label": "公式編號",
      "canonical_key": "formula_code",
      "target": "steel.formula_versions.code",
      "allowed_for": ["calculator_context", "price_lookup"]
    }
  ]
}
```

Rules:

- AI maps Chinese source/customer wording to an existing `canonical_key`.
- AI must use canonical keys in structured output, selected workbook refs, workbook patches, and tool arguments.
- If no mapping exists, AI asks a clarification question or returns a manual-review item.
- AI does not invent SQL column names, DTO fields, workbook paths, or tool arguments.
- Backend Zod schemas, tool schemas, repository allowlists, and workbook patch validation reject unknown canonical keys.

## ERP Workbook Sheet Names

These Chinese names are required output labels, not English database keys:

| Chinese sheet name | Internal sheet id | Rule |
|---|---|---|
| 報價明細 | `quote_details` | Export/workbook sheet label must stay Chinese. |
| 總結 | `summary` | Export/workbook sheet label must stay Chinese. |
| 人工複核清單 | `manual_review` | Export/workbook sheet label must stay Chinese. |
| 價格來源 | `price_sources` | Export/workbook sheet label must stay Chinese. |
| 判讀備註 | `interpretation_notes` | Export/workbook sheet label must stay Chinese. |
| 系統訂單 | `system_order` | Export/workbook sheet label must stay Chinese for ERP-facing output. |
| 給客戶用 | `customer_quote` | Export/workbook sheet label must stay Chinese. |

Do not add these rows to database schema mapping. They are workbook/export labels.

## Database-Bound Seed Rows

These rows seed the v8.3 mapping from the current Supabase schema and known reference files. Phase 2 should extend them only after inspecting corrected reference data or reviewed app-ready JSON.

| Chinese source label/header/term | English canonical key | Target DB surface | Type/unit | Source reference | AI API usage | Notes |
|---|---|---|---|---|---|---|
| 產品分類 / 分類代碼 | `price_category_code` | `steel.price_categories.code` | string | `docs/reference/產品價格.xlsx` | price lookup, admin import mapping | Category upsert key when provided. |
| 分類名稱 / 產品分類名稱 | `price_category_name` | `steel.price_categories.name` | string | `docs/reference/產品價格.xlsx` | price lookup, display | Chinese value can remain in `name`. |
| 材質 / 材料族群 | `material_family` | `steel.price_categories.material_family`, `steel.bending_prices.material_family` | string | `docs/reference/產品價格.xlsx`, `docs/reference/龍頂鋼鐵手冊__文字版.docx` | price lookup, rule lookup | Use canonical English key; value may be Chinese alias. |
| 預設單位 / 單位 | `default_unit` | `steel.price_categories.default_unit` | enum/string | `docs/reference/產品價格.xlsx` | price lookup | Normalize to known unit codes. |
| ERP 品項代碼 / 品號 | `erp_item_code` | `steel.price_items.erp_item_code`, `steel.order_items.erp_item_code` | string | `docs/reference/產品價格.xlsx`, ERP XLSX exports | admin import matching, price lookup | Price upsert key with customer tier when reliable. |
| 客戶等級 / 客戶分級 | `customer_tier_id` | `steel.price_items.customer_tier_id` | FK | ERP XLSX exports | price lookup | Customer-facing export must not expose tier. |
| 規格鍵 / 規格 | `spec_key` | `steel.price_items.spec_key`, `steel.weight_specs.spec_key`, `steel.processing_prices.spec_key`, `steel.cutting_prices.spec_key`, `steel.order_items.spec_key` | string | `docs/reference/產品價格.xlsx`, `docs/reference/龍頂鋼鐵手冊__文字版.docx` | price/spec lookup, workbook patch targeting | Stable normalized spec identifier. |
| 品名 / 產品名稱 | `product_name` | `steel.price_items.product_name`, `steel.order_items.product_name` | string | `docs/reference/產品價格.xlsx`, ERP XLSX exports | price lookup, display | Product name may stay Chinese data. |
| 材質等級 | `material_grade` | `steel.price_items.material_grade`, `steel.weight_specs.material_grade` | string | `docs/reference/產品價格.xlsx`, `docs/reference/龍頂鋼鐵手冊__文字版.docx` | price/spec lookup | Separate from material family. |
| 單價 / 售價 | `unit_price` | `steel.price_items.unit_price`, processing price tables | money | `docs/reference/產品價格.xlsx` | price lookup | Missing or unknown price is `未確認`, never `0`. |
| 幣別 | `currency` | price/order tables `currency` | enum/string | ERP XLSX exports | price lookup, export | Default is TWD when source omits it. |
| 生效日 | `effective_from` | `steel.price_items.effective_from` | date | ERP XLSX exports | price lookup | Optional range start. |
| 失效日 | `effective_to` | `steel.price_items.effective_to` | date | ERP XLSX exports | price lookup | Optional range end. |
| 有效 / 啟用 | `active` | price/spec/rule tables `active` | boolean | ERP XLSX exports | lookup filter | Inactive rows are not quote candidates. |
| 產品族群 | `product_family` | `steel.weight_specs.product_family`, `steel.processing_prices.product_family`, `steel.cutting_prices.product_family` | string | `docs/reference/龍頂鋼鐵手冊__文字版.docx`, `docs/reference/產品價格.xlsx` | spec/price lookup | Example value may be H 型鋼, 管類, 板類. |
| 形狀 / 斷面 | `shape` | `steel.weight_specs.shape` | string | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | weight/spec lookup | Shape remains data, not a column name. |
| 厚度 | `thickness_mm` | `steel.weight_specs.thickness_mm`, processing/cutting condition metadata | millimeter | `docs/reference/龍頂鋼鐵手冊__文字版.docx`, `docs/reference/公式編號 - Sheet1.csv` | spec lookup, calculator context | Normalize numeric source to mm. |
| 寬度 | `width_mm` | `steel.weight_specs.width_mm`, `steel.slotting_prices.width_mm` | millimeter | `docs/reference/龍頂鋼鐵手冊__文字版.docx`, `docs/reference/公式編號 - Sheet1.csv` | spec lookup, calculator context | Normalize numeric source to mm. |
| 高度 | `height_mm` | `steel.weight_specs.height_mm` | millimeter | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | spec lookup | H/槽/C shape dimension. |
| 翼寬 | `flange_width_mm` | `steel.weight_specs.flange_width_mm` | millimeter | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | spec lookup | Use for H/I/C shapes when source distinguishes it. |
| 腹板厚 | `web_thickness_mm` | `steel.weight_specs.web_thickness_mm` | millimeter | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | spec lookup | Use only when source has separate web thickness. |
| 長度 | `length_m` | `steel.weight_specs.length_m`, `steel.cutting_prices.length_m` | meter | `docs/reference/龍頂鋼鐵手冊__文字版.docx`, `docs/reference/公式編號 - Sheet1.csv` | spec/price lookup, calculator context | Formula source may express length separately; normalize before DB write. |
| 單位重 | `weight_kg_per_m` | `steel.weight_specs.weight_kg_per_m` | kg/m | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | weight lookup | Weight supports calculation, not material sale price replacement. |
| 單支重量 | `weight_kg_per_piece` | `steel.weight_specs.weight_kg_per_piece` | kg/piece | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | weight lookup | Use when source gives piece weight. |
| 來源參照 | `source_ref` | spec/rule tables `source_ref` | string | all reference sources | audit/source trace | Store stable source locator, not raw parsed file. |
| 規則代碼 | `material_rule_code` | `steel.material_rules.code` | string | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | rule lookup | For business rules that are not prices. |
| 規則名稱 | `material_rule_name` | `steel.material_rules.name` | string | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | rule lookup | Chinese value can stay in `name`. |
| 規則類型 | `material_rule_type` | `steel.material_rules.rule_type` | enum/string | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | rule lookup | Example: regular length, material constraint. |
| 規則內容 | `material_rule_body` | `steel.material_rules.rule_body` | JSON | `docs/reference/龍頂鋼鐵手冊__文字版.docx` | rule lookup | Validated JSON shape belongs in code/schema task. |
| 加工類型 | `processing_type` | `steel.processing_prices.processing_type` | string | `docs/reference/產品價格.xlsx` | processing price lookup | Covers generic processing rows. |
| 加工單價 | `processing_unit_price` | `steel.processing_prices.unit_price` | money | `docs/reference/產品價格.xlsx` | processing price lookup | Use table-specific key in prompt context to avoid confusion with material price. |
| 最低加工費 | `min_price` | `steel.processing_prices.min_price` | money | `docs/reference/產品價格.xlsx` | processing price lookup | Optional minimum charge. |
| 切割類型 / 切工 | `cut_type` | `steel.cutting_prices.cut_type` | string | `docs/reference/產品價格.xlsx` | cutting price lookup | Cutting-specific processing key. |
| 切割單價 | `cutting_unit_price` | `steel.cutting_prices.unit_price` | money | `docs/reference/產品價格.xlsx` | cutting price lookup | Keep separate from material `unit_price`. |
| 每公斤加價 | `surcharge_per_kg` | `steel.cutting_prices.surcharge_per_kg` | money/kg | `docs/reference/產品價格.xlsx` | cutting price lookup | Optional surcharge. |
| 調整條件 | `condition_type` | `steel.price_rule_conditions.condition_type`, `steel.cutting_price_adjustments.condition_type` | enum/string | ERP XLSX exports, reviewed JSON | rule lookup | Must be validated by code allowlist. |
| 條件欄位 | `field_name` | `steel.price_rule_conditions.field_name` | string | reviewed JSON | rule lookup | Must reference an allowed canonical key. |
| 運算子 | `operator` | `steel.price_rule_conditions.operator` | enum/string | reviewed JSON | rule lookup | Must be validated by code allowlist. |
| 條件值 | `condition_value` | `steel.price_rule_conditions.value` | JSON | reviewed JSON | rule lookup | Store normalized JSON, not raw text. |
| 優先序 | `priority` | `steel.price_rule_conditions.priority` | integer | reviewed JSON | rule lookup | Lower or higher ordering must be defined by service contract. |
| 調整類型 | `adjustment_type` | `steel.cutting_price_adjustments.adjustment_type` | enum | reviewed JSON | cutting price lookup | Must be one of `fixed`, `per_kg`, `percent`. |
| 調整值 | `adjustment_value` | `steel.cutting_price_adjustments.adjustment_value` | number/money/percent | reviewed JSON | cutting price lookup | Interpreted by adjustment type. |
| 孔類型 | `hole_type` | `steel.hole_prices.hole_type` | string | `docs/reference/產品價格.xlsx` | hole price lookup | Hole evidence may come from vision, price comes from DB. |
| 孔徑 | `diameter_mm` | `steel.hole_prices.diameter_mm` | millimeter | `docs/reference/產品價格.xlsx` | hole price lookup | Normalize to mm. |
| 適用厚度下限 | `thickness_min_mm` | `steel.hole_prices.thickness_min_mm`, `steel.bending_prices.thickness_min_mm` | millimeter | `docs/reference/產品價格.xlsx` | processing price lookup | Optional lower bound. |
| 適用厚度上限 | `thickness_max_mm` | `steel.hole_prices.thickness_max_mm`, `steel.bending_prices.thickness_max_mm` | millimeter | `docs/reference/產品價格.xlsx` | processing price lookup | Optional upper bound. |
| 開槽類型 | `slot_type` | `steel.slotting_prices.slot_type` | string | `docs/reference/產品價格.xlsx` | slotting price lookup | Slot evidence may come from vision, price comes from DB. |
| 槽長 | `slot_length_mm` | `steel.slotting_prices.length_mm` | millimeter | `docs/reference/產品價格.xlsx` | slotting price lookup | Prompt key can be specific while DB column is `length_mm`. |
| 槽寬 | `slot_width_mm` | `steel.slotting_prices.width_mm` | millimeter | `docs/reference/產品價格.xlsx` | slotting price lookup | Prompt key can be specific while DB column is `width_mm`. |
| 折彎類型 | `bend_type` | `steel.bending_prices.bend_type` | string | `docs/reference/產品價格.xlsx` | bending price lookup | Bending-specific processing key. |
| 公式編號 | `formula_code` | `steel.formula_versions.code` | string | reviewed JSON derived from `docs/reference/公式編號 - Sheet1.csv` | calculator context | Do not parse CSV directly at quote time. |
| 公式版本 | `formula_version_seq` | `steel.formula_versions.version_seq` | integer | reviewed JSON | calculator context | Versioned formula identity. |
| 公式名稱 | `formula_name` | `steel.formula_versions.formula_body.name` | string in JSON | reviewed JSON derived from `docs/reference/公式編號 - Sheet1.csv` | calculator context | Formula display name can remain Chinese. |
| 公式計算式 | `formula_expression` | `steel.formula_versions.formula_body.expression` | string in JSON | reviewed JSON derived from `docs/reference/公式編號 - Sheet1.csv` | calculator context | Must be converted to a safe deterministic expression format before use. |
| 公式長度 | `formula_length` | `steel.formula_versions.formula_body.length` | number in JSON | reviewed JSON derived from `docs/reference/公式編號 - Sheet1.csv` | calculator context | Meaning must be confirmed during formula normalization. |

## Phase 2 Extension Checklist

- Inventory Chinese labels and headers from `docs/reference` and any reviewed app-ready JSON derived from those files.
- Add only corrected business concepts to mapping rows.
- Keep the first pass focused on spec, price, processing price, and formula data that can be database-backed.
- Prefer established English key names from `supabase/schema.sql` when available.
- Add a new schema key only when the source reveals a real missing database concept.
- Keep product names, aliases, formula display names, and ERP sheet names as values/search terms/display labels, not as code-owned field names.
- Confirm each key has exactly one owning database surface before using it in API mock data, prompt context, or SQL schema changes.
- When real schema changes are needed, update both `supabase/schema.sql` and a one-change migration.
