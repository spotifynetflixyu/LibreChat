# Phase 4: Excel Export

Goal: make the quote workbook operational outside the chat surface: users can export the seven-sheet workbook, selected sheets, system order sheet, and customer quote sheet without refreshing or corrupting persisted workbook prices.

Non-goal: Admin ERP XLSX import, table maintenance, source management, RAG, memory, or production OCR hardening. Those move to later phases under the openai-oauth-responses-primary framework.

## Milestone 4.0: Export Library Setup

Current repo state:

- `api` and `packages/api` currently declare `xlsx@0.20.3`.
- No package currently declares `exceljs`.

Decision:

- Use ExcelJS deliberately for customer-facing export rendering.
- Keep `xlsx` for ERP import parsing and generated workbook read-back tests unless implementation proves a single library should own those paths too.

Tasks:

- Add ExcelJS intentionally to the backend package that owns customer-facing export rendering.
- Keep export masking and formatting behavior in code-owned renderer modules, not AI output.
- Keep parser usage separate from renderer usage.
- Confirm export rendering never calls AI providers and never refreshes price lookups.

Verification:

```bash
rtk npm ls exceljs xlsx
rtk npm run build:api
```

## Milestone 4.1: Excel Workbook Renderer

Files:

- Create `packages/api/src/steel/excel/render.ts`
- Create `packages/api/src/steel/excel/sheets.ts`
- Create `packages/api/src/steel/excel/customer.ts`
- Create `packages/api/src/steel/excel/system.ts`
- Create `packages/api/src/steel/excel/service.ts`
- Add tests under `packages/api/src/steel/excel/*.spec.ts`

Tasks:

- Render workbook JSON with ExcelJS.
- Support full workbook export.
- Support selected sheet export.
- Always render seven fixed sheets:
  - 報價明細
  - 總結
  - 人工複核清單
  - 價格來源
  - 判讀備註
  - 系統訂單
  - 給客戶用
- Freeze header row and enable filters.
- Format money as integers and weights with two decimals.
- Never render unconfirmed or missing prices as `0`.
- Use code-owned customer export allowlist.
- Render `quoted_unit_price` and `line_total` from persisted workbook values.
- Keep formula/debug/source refs out of customer-facing sheets.

Acceptance:

- XLSX tests read generated workbook back and assert sheet names, headers, formats, and blocked fields.
- Customer export excludes customer tier, internal cost, source refs, admin notes, AI notes, margin, formula/debug fields, and internal low-confidence reasons.
- System order sheet has fixed columns.
- Missing price renders as `未確認`, not zero or blank money.
- Export output is deterministic for the same workbook version.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/excel/.*\\.spec\\.ts$"
rtk npm run build:api
```

## Milestone 4.2: Export API

Files:

- Create `packages/api/src/steel/exports/service.ts`
- Create `packages/api/src/steel/exports/handlers.ts`
- Modify `api/server/routes/steel/index.js`

Endpoints:

```text
POST /api/steel/conversations/:conversationMetaId/exports
GET  /api/steel/exports/:exportId/download
```

Tasks:

- Support export kinds: full workbook, selected sheets, customer quote, system order.
- Apply user/guest access check.
- Write `steel_excel_exports`.
- Write download audit.
- Use persisted workbook values; do not refresh prices during export.
- Bind export records to workbook ID and version sequence.
- Include provider run IDs only as trace metadata if the export is generated immediately after an AI run; export correctness must not depend on provider state.

Acceptance:

- User can export only their own conversation workbook.
- Guest token can download only its own export when guest mode allows it.
- Export record includes sheet selection, file id/path, actor, workbook ID, and workbook version.
- Export remains valid if the provider session expires after workbook creation.
- Download audit includes actor, conversation meta ID, export ID, workbook ID, and selected sheet set.

Verification:

```bash
rtk npm run test:api -- --runTestsByPath api/server/routes/steel/index.spec.js
rtk npm run build:api
```

## Milestone 4.3: Export UX Actions

Files:

- Modify `client/src/features/steel/workbook`
- Modify Steel data-provider export hooks created in Phase 1.

Tasks:

- Add full workbook download action.
- Add customer quote download action.
- Add system order download action.
- Keep customer-visible actions visually distinct from internal/admin exports.
- On mobile, keep export actions available from the full-view workbook modal without changing the shared data contract.

Acceptance:

- Customer quote action downloads only customer-facing fields.
- System order action downloads the fixed system order sheet.
- Export failures show an actionable error without changing workbook data or latest patch highlights.

Verification:

```bash
rtk npm run test:client -- --runTestsByPath client/src/features/steel
rtk npm run build:client-package
```

## Phase Gate

Do not move to Phase 5 until:

- ExcelJS export can be downloaded and audited.
- Seven-sheet export tests pass.
- Customer export masking tests pass.
- System order sheet tests pass.
- Export uses persisted workbook values and never refreshes prices during rendering.
- Guest and authenticated access checks are tested.
- Export UX works on the shared desktop/mobile Steel workbook surface.
