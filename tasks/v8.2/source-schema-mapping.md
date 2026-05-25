# Source Schema Mapping

Goal: keep Chinese source material, English schema contracts, AI API prompts, and future code mappings aligned while Steel chat UX and real schema design move ahead.

This file is the Phase 2 planning source of truth for mapping `docs/reference/doc` Chinese labels, headers, and business terms to English canonical schema keys. It can shape real Supabase schema/data model design, API mock fixtures, workbook DTOs, tool arguments, repository filters, and prompt context. It is not a real data import file.

## Decisions

- Programmatic contracts use English canonical keys.
- Chinese labels remain as display labels, source labels, aliases, search terms, and source excerpts.
- The mapping is useful for real schema design, not only mock data.
- Current source files may contain text typos, but no separate typo approval workflow is required. By the time code agents generate importable data or SQL, mapping rows should already use the corrected business concept.
- Do not add `review_status`, `corrected_text`, or approval-state columns to this mapping unless a later data-import task needs them.
- The AI API must receive a compact source-schema mapping context so it can map source/customer wording to the correct canonical keys.
- Backend validation remains authoritative. The AI API can propose a canonical key from the mapping, but it cannot create new keys or bypass DTO/tool/schema validation.

## Source Of Truth Path

Planning source:

- `tasks/v8.2/source-schema-mapping.md`

Code version to design during implementation:

- `packages/api/src/steel/schema/mapping.ts`
- `packages/api/src/steel/schema/mapping.spec.ts`

The code version should export:

- Canonical schema key constants.
- Chinese source aliases and display labels.
- Target table/DTO/tool/workbook path metadata.
- A serializer for prompt context, e.g. `buildSourceSchemaMappingPromptContext()`.
- Guard helpers for tool/prompt code, e.g. `resolveSourceSchemaKey(sourceLabel)`.

If frontend display code later needs a filtered label map, expose only display-safe labels through `packages/data-provider`; keep SQL table/column metadata backend-owned.

## AI API Contract

Prompt and tool orchestration should include a compact mapping packet:

```json
{
  "source_schema_mapping": [
    {
      "source_label": "報價單價",
      "canonical_key": "quoted_unit_price",
      "target": "workbook.quote_details.line.quoted_unit_price",
      "allowed_for": ["workbook_patch", "changed_field_summary"]
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

## Row Template

| Chinese source label/header | English canonical key | Target surface | Type/unit | Source reference | AI API usage | Notes |
|---|---|---|---|---|---|---|
|  |  | DB column / DTO field / tool arg / workbook path / prompt key |  | `docs/reference/doc/...` section/page/sheet | Use for tool args / workbook patch / retrieval filter / display only |  |

## Seed Rows From Settled v8.2 Contracts

These rows come from already-settled plan language. Phase 2 should extend them after inspecting `docs/reference/doc`.

| Chinese source label/header | English canonical key | Target surface | Type/unit | Source reference | AI API usage | Notes |
|---|---|---|---|---|---|---|
| 報價明細 | `quote_details` | workbook sheet id | enum | v8.2 fixed workbook sheets | workbook path, display label | Required sheet |
| 總結 | `summary` | workbook sheet id | enum | v8.2 fixed workbook sheets | workbook path, display label | Required sheet |
| 人工複核清單 | `manual_review` | workbook sheet id | enum | v8.2 fixed workbook sheets | manual-review routing | Required sheet |
| 價格來源 | `price_sources` | workbook sheet id | enum | v8.2 fixed workbook sheets | source trace display | Required sheet |
| 判讀備註 | `interpretation_notes` | workbook sheet id | enum | v8.2 fixed workbook sheets | interpretation trace display | Required sheet |
| 系統訂單 | `system_order` | workbook sheet id | enum | v8.2 fixed workbook sheets | system-order export | Required sheet |
| 給客戶用 | `customer_quote` | workbook sheet id | enum | v8.2 fixed workbook sheets | customer export preview | Customer-visible allowlist applies |
| 報價單價 | `quoted_unit_price` | workbook line DTO / patch path | money | workbook pricing traceability | workbook patch, changed-field summary | Customer-visible label allowed through export mask |
| 總價 | `line_total` | workbook line DTO / patch path | money | workbook pricing traceability | workbook patch, changed-field summary | Recalculate paired unit price when edited |
| 公式 | `formula_code` | workbook line DTO / formula table | string | workbook pricing traceability | trace only | Customer export blocks formula/debug fields |
| 客戶等級 / 客戶分級 | `customer_tier` | internal customer/price filter | enum/string | ERP customer/price data | retrieval filter only | Blocked from customer quote sheet |
| ERP 客戶代碼 | `erp_customer_code` | import lookup key / customer table | string | ERP XLSX import policy | admin import matching | Stable customer upsert key when present |
| ERP 品項代碼 | `erp_item_code` | import lookup key / price table | string | ERP XLSX import policy | admin import matching | Combine with customer tier for price upsert |

## Phase 2 Extension Checklist

- Inventory Chinese labels and headers from `docs/reference/doc`.
- Add only corrected business concepts to mapping rows.
- Prefer established English key names from existing schema/DTOs when available.
- Add a new schema key only when the source reveals a real missing concept.
- Keep product names and aliases as values/search terms, not as code-owned field names.
- Confirm each key has exactly one owning target surface before using it in API mock data, prompt context, or SQL schema changes.
- When real schema changes are needed, update both `supabase/schema.sql` and a one-change migration.
