# Phase 1: Source Inventory And Reference Semantics

Goal: describe every source file by the facts it can provide, its authority, and how AI/tools may use it.

## Source Roles

| Source                      | Role                                                                     | Formal data owner                                                   |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `客戶資料.xlsx`             | Customer identity, aliases, and customer tier                            | `steel.customers`, `steel.customer_aliases`, `steel.customer_tiers` |
| `產品價格.xlsx`             | Product/material/processing price and product-specific unit weight       | `steel.price_items`, processing price tables, source metadata       |
| `公式編號.xlsx` / CSV       | Formula names and reviewed formula structures                            | `steel.formula_versions` after reviewed conversion                  |
| `龍頂鋼鐵手冊__文字版.docx` | General product specs, dimensions, handbook unit weights, material rules | `steel.weight_specs`, `steel.material_rules`, source chunks         |
| `H型鋼.txt`                 | H-type regular/non-standard length classes and surcharge rule            | `steel.material_rules`                                              |
| `切工價錢.xlsx`             | Formal cutting price data and cutting adjustments                        | `steel.cutting_prices`, cutting adjustments/rules                   |
| `系統訂單.xlsx`             | ERP-facing output sheet format                                           | Workbook/export labels and system order renderer                    |
| `客戶詢價.rtf`              | Quote request evidence and parser fixture                                | Conversation/file evidence, not Admin import                        |

## Source Ref Requirements

Every database-backed fact used in a quote should be able to report a stable source reference:

- source file or source version id
- sheet name or document page/section
- row/range or table identifier where applicable
- reviewed confidence when the source row had manual interpretation
- source type such as `customer`, `product_price`, `handbook_weight`, `cutting_price`, `formula`, or `material_rule`

## Non-Goals

- Do not create a product runtime parser for handbook DOCX.
- Do not treat customer inquiries as formal import rows.
- Do not let AI read raw files as a substitute for repository/tool lookup.

## Exit Criteria

- Source mapping records which table owns each source fact.
- Source refs can appear in price candidates, workbook lines, manual review items, and audit records.
- Product-price unit weight and handbook unit weight can coexist without overwriting each other globally.
