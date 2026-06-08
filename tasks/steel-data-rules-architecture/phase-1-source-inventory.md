# Phase 1: Source Inventory And Reference Semantics

Goal: describe every source file by the facts it can provide, its authority, and how AI/tools may use it.

## Source Roles

| Source                      | Role                                                                     | Formal data owner                                                   |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `客戶資料.xlsx`             | Customer identity, aliases, and customer tier                            | `steel.customers`, `steel.customer_aliases`, `steel.customer_tiers` |
| `產品價格.xlsx`             | Product/material/processing price and product-price unit weight          | `steel.price_items`, processing price tables, source metadata       |
| `公式編號.xlsx` / CSV       | Formula names and reviewed formula structures                            | `steel.formula_versions` after reviewed conversion                  |
| `龍頂鋼鐵手冊__文字版.docx` | General product specs, dimensions, handbook unit weights, material rules | `steel.weight_specs`, `steel.material_rules`, source chunks         |
| `H型鋼.txt`                 | H-type regular/non-standard length classes and surcharge rule            | `steel.material_rules`                                              |
| `切工價錢.xlsx`             | Formal cutting price data and cutting adjustments                        | `steel.cutting_prices`, cutting adjustments/rules                   |
| `系統訂單.xlsx`             | ERP-facing output sheet format                                           | Workbook/export labels and system order renderer                    |
| `客戶詢價.rtf`              | Quote request evidence and parser fixture                                | Conversation/file evidence, not Admin import                        |

## Inventory Evidence

This pass inspected the current files under `docs/reference` and `docs/reference/legacy`.

| Source                      | Observed structure                                                                                        | Inventory conclusion                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `客戶資料.xlsx`             | `Sheet1`, range `A1:J2263`; header row 5; rows 7-2262 contain 2256 customer rows; row 2263 is a summary.  | Formal customer seed/reference. Tiers currently appear as `A級`, `B級`, `C級`, `D級`, `E級`, and `F級`.                                |
| `產品價格.xlsx`             | `Sheet1`, range `A1:M6766`; header row 5; rows 6-6764 contain 6759 item rows; rows 6765-6766 are totals.  | Formal product/material/processing price seed/reference. 4243 rows have a nonzero tier price; 2516 rows are all-zero tier-price rows.  |
| `產品價格.xlsx`             | Price headers are `售價A`, `售價B`, `售價C`, `售價F`; final column is `單位重`.                           | Product-price unit weight exists in the source; 1142 item rows currently carry nonzero unit weight.                                    |
| `產品價格.xlsx`             | 790 item names contain processing-like terms such as cut, hole, slot, bending, or processing wording.     | These rows need reviewed classification before they can override cutting lookup; generic/zero rows such as `加工沖孔切` stay unknown.  |
| `公式編號.xlsx`             | `Sheet1`, range `A1:M52`; header row 5; rows 19-52 contain the useful formula rows.                       | Formula source is a structure/reference input. Only rows with formula code and expression are candidates for reviewed formula records. |
| `公式編號 - Sheet1.csv`     | Same logical source as the workbook, but default parsing produced mojibake and Big5 decode failed.        | Keep as a development reference only. Prefer `公式編號.xlsx` or reviewed app-ready JSON/database rows for calculator runtime data.     |
| `龍頂鋼鐵手冊__文字版.docx` | OOXML document with 64 page markers and embedded images; text extraction shows spec/weight tables.        | Handbook source is a schema/spec/weight/rule design reference, not a runtime product parser or Admin upload path.                      |
| `H型鋼.txt`                 | UTF-8 text with regular lengths, non-standard examples, and `+0.3/KG` rule.                               | Source for the H-type surcharge rule; Phase 0 business decision interprets all non-regular H-type lengths as surchargeable.            |
| `切工價錢.xlsx`             | Five sheets: `全部整理資料`, `H型鋼切工`, `黑鐵類切工`, `斜切加價備註`, `判讀備註`.                       | `全部整理資料` is the reviewed consolidated cutting source; original sheets/notes remain evidence for audit and manual review.         |
| `切工價錢.xlsx`             | `全部整理資料` has 120 nonblank rows and confidence labels; includes `未確認` values.                     | `高` confidence rows can seed deterministic cutting facts; `中`/`低`, handwritten, unclear, and `未確認` rows require review.          |
| `系統訂單.xlsx`             | `老公公轉出`, range `A1:T6`; row 1 is the ERP-facing output header.                                       | Output-format reference only. It does not create product/customer/price facts.                                                         |
| `客戶詢價.rtf`              | RTF quote request sample with vendor, delivery location, timing, `C150*3.0`, and line lengths/quantities. | Quote request evidence/parser fixture. It may prove parsing and C-type rule retrieval, but it is not an Admin import source.           |
| `legacy/*.xls`              | Legacy customer/product files match the current `.xlsx` shapes and row counts.                            | Legacy fixtures prove normalization/conversion behavior. Prefer canonical `.xlsx` references when both forms exist.                    |

Ignore `docs/reference/.DS_Store`; it is local filesystem metadata, not source material.

## Source Reference Strategy

Phase 2 should design a concrete source-ref type from this strategy. This Phase 1 document is not a schema migration.

Phase 2 uses one canonical `source_refs` JSONB array on quoteable fact rows. A normalized `steel.source_refs` table is deferred until source-ref querying becomes a real product need.

Every source reference should keep:

- `channel`: one of `admin_erp_xlsx`, `admin_table_ui`, `handbook_reviewed_data`, `chat_evidence`, `manual`, or `legacy_normalization_proof`.
- `factType`: one of `customer`, `product_price`, `product_price_unit_weight`, `handbook_weight`, `formula`, `cutting_price`, `processing_price`, `hole_price`, `slotting_price`, `bending_price`, `material_rule`, `workbook_output_format`, or `quote_request_evidence`.
- `sourceFile`: stable repo-relative file path when the source is a repo reference fixture.
- `sourceVersionId`: imported source-version id when the source comes from an Admin upload or reviewed dataset.
- `locator`: the smallest stable position that lets an admin or developer re-open the source.
- `confidence`: source confidence when available, especially for reviewed cutting data and interpreted handbook/rule rows.
- `extractedLabel`: original Chinese source label/header where useful.
- `canonicalKey`: English programmatic key after source-schema mapping, when the fact enters a tool/schema contract.

Formal database facts and quote evidence can both carry source references, but their channels have different authority. `quote_request_evidence` may explain a workbook-line adjustment or parser interpretation; it must not be treated as formal customer, product, price, formula, cutting, or material-rule source data.

Recommended locator forms:

| Source kind       | Locator format                                                                  | Example                                                                                   |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| XLSX row          | `sheet=<sheet>;row=<1-based row>`                                               | `sheet=Sheet1;row=7` for a customer row in `客戶資料.xlsx`.                               |
| XLSX range/table  | `sheet=<sheet>;range=<A1 range>;header_row=<row>`                               | `sheet=老公公轉出;range=A1:T6;header_row=1` for `系統訂單.xlsx`.                          |
| Consolidated cut  | `sheet=全部整理資料;row=<row>;origin=<source block or note>`                    | `sheet=全部整理資料;row=5;origin=H型鋼切工`.                                              |
| DOCX section row  | `page=<page>;section=<heading>;table=<ordinal>;row=<row>`                       | `page=8;section=H型鋼規格表;table=1;row=first data row`.                                  |
| Text line range   | `line=<start>-<end>`                                                            | `line=1-7` for `H型鋼.txt`.                                                               |
| Quote evidence    | `conversation_file=<id>;span=<line/range or parser span>;source_file=<fixture>` | For fixtures, `source_file=docs/reference/客戶詢價.rtf;line=6-14`; runtime uses file ids. |
| Legacy normalized | `source_file=<legacy path>;normalized_to=<xlsx/docx artifact>;proof=<run id>`   | Keep conversion proof metadata separate from formal product/customer source facts.        |

Workbook lines should be able to carry multiple source refs: chosen price, chosen product-price unit weight or handbook weight, formula, material rule, cutting/processing price, and any quote-specific adjustment evidence.

## Source-Specific Semantics

### `客戶資料.xlsx`

- Authority: customer code, customer display/legal names, contacts, address, and customer tier.
- Header row: 5. Data rows: 7-2262. Summary row: 2263.
- Import identity candidate: customer code from `客戶編`.
- Matching evidence: contact/project/site/address fields can help match a customer but should not silently merge records without customer-code confidence.
- AI/tool use: customer lookup/search tools may return customer candidates, tier, aliases, and source refs; prompt context should not expose the full customer table.

### `產品價格.xlsx`

- Authority: product/material/processing prices, customer-tier price columns, product names/spec text, ERP item code, and product-price unit weight.
- Header row: 5. Data rows: 6-6764. Summary rows: 6765-6766.
- Tier columns: `售價A`, `售價B`, `售價C`, `售價F`.
- Product-price unit weight: `單位重`; this is the main quote weight when reviewed and present for a matched priced item.
- Zero handling: blank or `0.00` source prices are unknown unless Admin review marks a true zero price. Blank or `0.00` unit weight remains invalid or unknown unless a later source-specific data task proves a legitimate zero-weight concept.
- Processing/cutting classification: product-price rows with processing-like wording must be classified before overriding cutting lookup. Generic labels and zero rows do not override `切工價錢.xlsx`.
- AI/tool use: tools return bounded candidates with source refs, tier-specific price values, unit, product-price unit weight when present, adopted/rejected reasons, and low-confidence reasons.

### `公式編號.xlsx` And `公式編號 - Sheet1.csv`

- Authority: formula names and formula structures after review.
- Workbook header row: 5. Useful formula candidates begin at row 19 in the current file.
- Rows with code but no expression are not calculator-ready formulas.
- The CSV currently has an encoding/readability caveat; it should not be the runtime parser source.
- Runtime rule: AI calculation prompt context should use reviewed app-ready JSON
  or database rows, not direct CSV parsing at quote time.

### `龍頂鋼鐵手冊__文字版.docx`

- Authority: general specs, dimensions, handbook unit weights, material families, aliases, and possible material rules.
- Current extraction shows a 64-page OCR/text table document with embedded images retained for visual cross-check.
- Example anchors: page 8 `H型鋼規格表` contains `重量 kg/m`; page 26 `C型鋼規格表` contains C-type dimensions/thickness/weight.
- Handbook unit weight remains separate evidence when product-price unit weight exists; it becomes the general lookup source when product price has no reviewed unit weight.
- Non-goal: do not create a reusable handbook DOCX parser or Admin DOCX upload path in this phase.

### `H型鋼.txt`

- Authority: H-type regular lengths and material surcharge rule.
- Source text states regular lengths 6M, 9M, 10M, 12M and examples of non-standard lengths with `+0.3/KG`.
- Phase 0 decision: after length normalization, any H-type length outside 6M, 9M, 10M, and 12M receives the +0.3/kg material unit-price surcharge.
- Cutting remains separate and must be priced from cutting source data or reviewed product-price processing rows.

### `切工價錢.xlsx`

- Authority: formal cutting prices, cutting adjustments, and review notes.
- Preferred source sheet: `全部整理資料`.
- Audit/source evidence sheets: `H型鋼切工`, `黑鐵類切工`, `斜切加價備註`, `判讀備註`.
- Confidence policy: `高` rows can seed deterministic cutting facts; `中` rows need careful review; `低`, `未確認`, handwritten, unclear, or "另計" notes become manual-review reasons unless Admin later confirms them.
- Tier policy: current consolidated sheet uses `A/C/F` and `B`; preserve that split in Phase 2 instead of flattening to one price.
- AI/tool use: tools may return cutting candidates and notes, but should not treat unclear notes as confirmed charges.

### `系統訂單.xlsx`

- Authority: ERP-facing output headers, order row shape, Chinese workbook labels, and example output values.
- Not authority for customer, product, price, formula, or cutting facts.
- Use to keep workbook/export labels in Traditional Chinese and maintain ERP sheet compatibility.

### `客戶詢價.rtf`

- Authority: quote request evidence only.
- Current fixture includes supplier/customer wording, delivery location, timing, `C150*3.0`, and line lengths/quantities.
- Use as a parser and manual scenario fixture for C-type rule retrieval and finished-length behavior.
- Do not use it as source of truth for product, price, customer, formula, cutting, or material-rule table updates.

### `legacy/客戶資料.xls` And `legacy/產品價格.xls`

- Authority: legacy-file normalization proof, not preferred source when equivalent `.xlsx` files exist.
- Current observed shape matches the corresponding `.xlsx` files.
- Runtime policy remains: legacy Office server-side conversion is production behavior only after proof succeeds; converted temp outputs are artifacts, not formal source files.

## Source Ref Requirements

Every database-backed fact used in a quote should be able to report a stable source reference:

- source file or source version id
- sheet name or document page/section
- row/range or table identifier where applicable
- reviewed confidence when the source row had manual interpretation
- source type such as `customer`, `product_price`, `handbook_weight`, `cutting_price`, `formula`, or `material_rule`
- quote-specific adjustment evidence when a customer instruction changes one workbook line without changing formal source data

## Non-Goals

- Do not create a product runtime parser for handbook DOCX.
- Do not treat customer inquiries as formal import rows.
- Do not let AI read raw files as a substitute for repository/tool lookup.

## Exit Criteria

- Source mapping records which table owns each source fact.
- Source refs can appear in price candidates, workbook lines, manual review items, and audit records.
- Product-price unit weight can be the main quote weight while handbook unit weight remains separate evidence.
