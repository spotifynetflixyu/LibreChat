# Phase 4: Excel Export

Goal: make the quote workbook operational outside the chat surface for company
staff: users can export the seven-sheet workbook or any selected sheets from
the persisted workbook without refreshing prices, recalculating quote data, or
corrupting saved workbook values.

Non-goal: customer-visible workbook masking, customer download permissions,
dedicated system-order export actions, Admin ERP XLSX import, table
maintenance, source management, RAG, memory, durable public export links, or
production OCR hardening. Those move to later phases under the
openai-oauth-responses-primary framework.

## Milestone 4.0: Export Library Setup

Current repo state:

- `api` and `packages/api` currently declare `xlsx@0.20.3`.
- No package currently declares `exceljs`.

Decision:

- Use ExcelJS deliberately for workbook export rendering.
- Keep `xlsx` for ERP import parsing and generated workbook read-back tests unless implementation proves a single library should own those paths too.
- Phase 4 exports are generated in memory from the persisted workbook and streamed
  directly by the API. Do not upload generated XLSX bytes to Supabase Storage or
  another durable file store in this phase.
- A future durable/shareable export feature may choose Supabase Storage or another
  file store, but that later feature should define retention, replacement, and
  public-link semantics separately.

Tasks:

- Add ExcelJS intentionally to the backend package that owns workbook export rendering.
- Keep export formatting behavior in code-owned renderer modules, not AI output.
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
  - 報價單
- Freeze header row and enable filters.
- Format money as integers and weights with two decimals.
- Never render unconfirmed or missing prices as `0`.
- Render `quoted_unit_price` and `line_total` from persisted workbook values.
- Preserve selected sheet columns and values as staff-visible workbook output.
- Do not apply customer masking, customer/internal field filtering, or dedicated
  system-order-only logic in Phase 4.

Acceptance:

- XLSX tests read generated workbook back and assert sheet names, headers,
  selected sheet sets, and formats.
- Full export includes all seven fixed sheets in workbook order.
- Selected-sheet export can include any sheet combination, including `系統訂單`
  and `報價單`, without special-case restrictions.
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
POST /api/steel/workbooks/:workbookId/export
```

Tasks:

- Request body includes workbook version and optional `sheetIds`; omitting
  `sheetIds` exports all seven sheets.
- Apply authenticated staff access check for the current `/steel/oauth-chat`
  test surface.
- Stream the generated XLSX bytes directly from memory with the XLSX content
  type and `Content-Disposition` filename.
- Write download audit.
- Use persisted workbook values; do not refresh prices during export.
- Bind audit metadata to workbook ID and version sequence.
- Do not write `steel_excel_exports` or durable file metadata in this phase unless
  a later durable storage slice is explicitly approved.
- Export correctness must not depend on provider state.

Acceptance:

- Authenticated staff user can export the current `/steel/oauth-chat` workbook.
- Export output is regenerated from the persisted workbook version and remains
  valid if the provider session expires after workbook creation.
- Download audit includes actor, workbook ID, workbook version, and selected
  sheet set.
- Export failures return an actionable error and do not mutate workbook data.

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
- Add selected-sheet download action that can include any checked workbook tabs.
- Wire the first UX into `/steel/oauth-chat`; the formal Steel Workspace export
  UX can reuse the same data contract later.

Acceptance:

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
- Selected-sheet export tests pass for arbitrary sheet combinations.
- Export uses persisted workbook values and never refreshes prices during rendering.
- Authenticated staff access checks are tested.
- Export UX works on `/steel/oauth-chat`.
