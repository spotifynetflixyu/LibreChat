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
- Calculation rule defaults and rule proposals promoted from quote conversations.
- Source refs and reviewed confidence.
- True-zero review markers for otherwise blank or `0.00` price/charge source values.

LibreChat user memory is not an Admin-owned formal update surface. It can affect quote-time priority for the current user's workflow, but it remains separate from Admin-reviewed Steel facts and generated site-managed lesson/memory.

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

Phase 2 should persist reviewed facts with nullable numeric values plus explicit value/review state. Unknown values are not written as `0`, and true-zero prices or charges require Admin confirmation.

## Lesson/Memory Promotion Path

Conversation-derived defaults must go through a proposal workflow before they become reusable lessons or memory.

1. Chat captures a quote-specific adjustment on the current workbook line.
2. If the user asks to reuse it, backend creates a structured rule proposal with `needs_review` status.
3. The proposal records customer/material/charge scope, reviewed `formulaCode`, proposed adjustable parameters, source refs, and the originating conversation/workbook line.
4. Admin reviews conflicts with current prices/rules/defaults and chooses approve, reject, keep as one-time adjustment, or request more information.
5. Approval writes reviewed database facts first.
6. Lesson/memory entries are generated from reviewed facts and carry origin table/ID/revision refs.

The AI must not update Admin-reviewed lesson/memory directly. Steel Admin-reviewed lesson/memory is a task-scoped retrieval layer over reviewed facts, not the authoritative store. LibreChat user memory remains a separate user-scoped layer and must not be stored as an Admin-reviewed default.

## Non-Goals

- Do not build a DOCX/PDF Admin import path for customer inquiries.
- Do not let Admin update price/rule facts through unvalidated free-form prompt memory.
- Do not treat LibreChat user memory as an Admin-reviewed Steel fact or site-wide default.
- Do not let AI commit formal source changes without backend validation and Admin confirmation.
- Do not promote customer-requested quote-specific adjustments into formal source data unless a separate Admin review explicitly creates or updates a formal row/rule.
- Do not show or execute "save as customer default" until a rule proposal and Admin review path exists.

## Exit Criteria

- Admin maintenance can update cutting prices later without changing prompt code.
- Source conflicts can be resolved by explicit source-priority policy and reviewed rows.
- Every formal update produces source/audit trail.
