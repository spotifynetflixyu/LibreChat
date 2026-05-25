# Phase 4: Export And Admin ERP XLSX Import

Goal: make the MVP operational: users can export a seven-sheet workbook, and admins can safely preview, validate, merge, and commit ERP-exported XLSX data or table UI edits so quotes reflect current confirmed database values.

Non-goal: build an Admin DOCX/PDF parser in the web UI. Admin ERP Import rejects DOCX, PDF, image PDF, screenshots, image files, and `.txt`; those files do not create parsed rows, merge rows, or formal database writes. Steel handbook DOCX first informs schema/data-model design outside this Admin upload path; real data SQL/import is deferred.

## Part A: Excel Export MVP

### Milestone 4.0: Export Library Setup

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

Verification:

```bash
rtk npm ls exceljs xlsx
rtk npm run build:api
```

### Milestone 4.1: Excel Workbook Renderer

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

Acceptance:

- XLSX tests read generated workbook back and assert sheet names, headers, formats, and blocked fields.
- Customer export excludes customer tier, internal cost, source refs, admin notes, AI notes, margin, formula/debug fields, and internal low-confidence reasons.
- System order sheet has fixed columns.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/excel/.*\\.spec\\.ts$"
rtk npm run build:api
```

### Milestone 4.2: Export API

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

Acceptance:

- User can export only their own conversation workbook.
- Guest token can download only its own export when guest mode allows it.
- Export record includes sheet selection, file id/path, actor, and workbook version.

Verification:

```bash
rtk npm run test:api -- --runTestsByPath api/server/routes/steel/index.spec.js
rtk npm run build:api
```

## Part B: Admin ERP XLSX Import And Table Maintenance

### Milestone 4.3: ERP Import Session And Upload Guard

Files:

- Create `packages/api/src/steel/admin/imports/session.ts`
- Create `packages/api/src/steel/admin/imports/upload.ts`
- Create `packages/api/src/steel/admin/imports/xlsx.ts`
- Create `packages/api/src/steel/admin/imports/parser.ts`
- Create `packages/api/src/steel/admin/imports/mapping.ts`
- Create `packages/api/src/steel/admin/imports/handlers.ts`
- Add tests under `packages/api/src/steel/admin/imports/*.spec.ts`

Tasks:

- Start with one confirmed target table, preferably `price_items` or `customers`.
- Require Admin to choose source type / target table before upload.
- Accept only ERP-exported `.xlsx` by MIME type and extension for the ongoing Admin upload flow.
- Reject `.docx`, `.pdf`, scanned PDF, image PDF, screenshots, image files, and `.txt` before parsing.
- Ensure rejected uploads do not create source versions, parsed rows, merge rows, or database writes.
- Parse XLSX rows into normalized preview rows.
- Store raw XLSX file reference and parsed row summary.
- Create `steel_admin_import_sessions`.
- Create or reuse `steel_admin_mapping_profiles`.
- Do not expose the steel handbook DOCX through this Admin upload flow; its schema/data-model boundary is owned by Phase 2.

Acceptance:

- Upload guard tests prove non-XLSX ERP import files, including DOCX, are rejected.
- Parser handles header row detection only when deterministic or explicitly configured.
- Unknown mapping yields `needs_review`, not best-effort mutation.
- DOCX/PDF/image/text files cannot enter Admin ERP Import through upload, source version, parser, or merge-table paths.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/admin/imports/.*\\.spec\\.ts$"
```

### Milestone 4.4: Preview, Old Data Match, Table Edit, And Validation

Files:

- Create `packages/api/src/steel/admin/preview/types.ts`
- Create `packages/api/src/steel/admin/imports/lookup.ts`
- Create `packages/api/src/steel/admin/imports/validate.ts`
- Create `packages/api/src/steel/admin/imports/merge.ts`
- Create `packages/api/src/steel/admin/tables/fetch.ts`
- Create `packages/api/src/steel/admin/tables/update.ts`

Tasks:

- Build Admin preview data with original filename, source file type, sheet/table/section, original text, normalized fields, mapping, confidence, review flags, target table, validation status, and suggested action.
- Look up old Supabase rows by confirmed mapping profile keys.
- Rows missing confirmed lookup keys become `needs_review`, not guessed updates.
- Build New, Old, and Merge rows.
- Fetch existing table rows for Admin table-maintenance UI preview/edit flows.
- Validate table UI edits with the same backend-owned rules used by XLSX import.
- Support create, update, delete, ignore.
- Mark `valid`, `invalid`, and `needs_review` in code.
- Keep AI out of validity decisions.
- Reject impossible prices, missing required fields, ambiguous update keys, and target-table changes.

Acceptance:

- `invalid` and `needs_review` are code-owned.
- AI merge patches can only modify data fields, not validation rules.
- Source type constrains target table; AI cannot change it through a merge patch.
- Preview rows never claim DOCX/PDF/source-image provenance because those files cannot enter Admin ERP Import.
- Admin table UI can preview/edit existing rows without requiring DOCX upload.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/admin/imports/(lookup|validate|merge).*\\.spec\\.ts$"
```

### Milestone 4.5: Transaction Commit

Files:

- Create `packages/api/src/steel/admin/imports/commit.ts`
- Modify Supabase repositories as needed.
- Update `supabase/schema.sql` and add a migration only if schema changes are required.

Tasks:

- Commit only rows with `validation_status = valid` and `can_commit = true`.
- Ignore `invalid` and `needs_review` rows.
- Wrap all valid row changes in one Supabase transaction.
- On any valid row failure, rollback all changes.
- Ensure price changes write `steel.price_history`.
- Write import audit summary.

Acceptance:

- Transaction test proves rollback on one failing valid row.
- Price update test proves `price_history` records old/new prices and import log ID.
- Quote lookup after commit returns the new price.

Verification:

```bash
rtk npm run test:packages:api -- --runTestsByPath packages/api/src/steel/admin/imports/commit.spec.ts
rtk npm run build:api
```

## Part C: Eval Baseline

### Milestone 4.6: MVP Eval Cases

Files:

- Create `packages/api/src/steel/evals/cases`
- Create `packages/api/src/steel/evals/expected`
- Create `packages/api/src/steel/evals/fixtures`
- Create `packages/api/src/steel/evals/runners`
- Create `packages/api/src/steel/evals/reports`
- Add tests under `packages/api/src/steel/evals/*.spec.ts`

Tasks:

- Add eval cases for:
  - price-before-weight
  - no zero-filled unknown prices
  - multi-key price search
  - stock allocation
- Admin upload policy rejects files that are not ERP XLSX
- ERP XLSX preview data
- Admin table UI preview/edit data
  - seven-sheet Excel export
  - customer quote mask
  - system order sheet
- Generate report with case ID, assertion, expected, actual.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/evals/.*\\.spec\\.ts$"
```

## Phase Gate

Do not move to Phase 5 until:

- Excel export can be downloaded and audited.
- Seven-sheet export tests pass.
- Customer export masking tests pass.
- Admin upload policy tests prove DOCX/PDF/image/.txt files are rejected before parsing.
- Admin import safely updates at least one target table from ERP XLSX parsed data.
- Admin table UI safely previews and edits at least one target table without DOCX upload.
- Rollback behavior is tested.
- Updated prices are visible to Phase 2 lookup tools.
- MVP eval cases run and report failures clearly.
