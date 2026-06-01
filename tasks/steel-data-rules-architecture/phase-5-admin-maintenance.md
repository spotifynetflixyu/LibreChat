# Phase 5: Admin Maintenance And Update Path

Goal: scope how formal data changes happen after the initial reviewed data is available.

## Formal Admin Updates

Admin updates should maintain normalized database facts, not prompt-only instructions.

Owned update surfaces:

- Customers and tiers.
- Product prices and product-price unit weights.
- Cutting prices and cutting adjustments.
- Formula versions.
- Material rules.
- Source refs and reviewed confidence.

## Source-Specific Policy

- `產品價格.xlsx`: formal product/material/processing price source.
- `切工價錢.xlsx`: formal cutting-price source.
- `龍頂鋼鐵手冊__文字版.docx`: schema/model/reference source for specs and weights; real data import remains a later reviewed task.
- Customer inquiry files: quote evidence only.

## Admin Workflow Shape

1. Admin selects source/update type.
2. Backend parses or fetches the existing table data for preview.
3. Backend maps source labels to canonical keys.
4. Backend compares with old rows.
5. Admin confirms valid rows.
6. Backend commits in a transaction and writes audit/source refs.

## Non-Goals

- Do not build a DOCX/PDF Admin import path for customer inquiries.
- Do not let Admin update price/rule facts through unvalidated free-form prompt memory.
- Do not let AI commit formal source changes without backend validation and Admin confirmation.

## Exit Criteria

- Admin maintenance can update cutting prices later without changing prompt code.
- Source conflicts can be resolved by explicit source-priority policy and reviewed rows.
- Every formal update produces source/audit trail.
