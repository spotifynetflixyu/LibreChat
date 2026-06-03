# Phase 5: Admin Source Management

Goal: let admins safely preview, validate, merge, and commit ERP-exported XLSX data or table UI edits so quotes reflect current confirmed database values. This phase also establishes Steel Project / Source / Instruction management enough for later retrieval and prompt context.

Non-goals:

- No Admin DOCX/PDF parser in the web UI.
- No in-product PDF/image-to-import transformation.
- No real handbook data SQL/import unless a later data task explicitly starts from corrected source concepts.
- No AI-owned validity decisions. AI may assist merge/table edits, but code owns `valid`, `invalid`, `needs_review`, and commit eligibility.

## Milestone 5.0: Source Management Foundation

Files:

- Create `packages/api/src/steel/projects/service.ts`
- Create `packages/api/src/steel/projects/handlers.ts`
- Create `packages/api/src/steel/sources/service.ts`
- Create `packages/api/src/steel/sources/versions.ts`
- Create `packages/api/src/steel/instructions/service.ts`
- Modify `api/server/routes/admin/steel/index.js`
- Modify Steel data-provider source/project/instruction types created in Phase 1.

Endpoints:

```text
GET  /api/admin/steel/projects
POST /api/admin/steel/projects
GET  /api/admin/steel/projects/:projectId/sources
POST /api/admin/steel/projects/:projectId/sources
GET  /api/admin/steel/sources/:sourceId/versions
GET  /api/admin/steel/source-versions/:versionId/preview
POST /api/admin/steel/source-versions/:versionId/confirm
```

Tasks:

- Implement minimal project/source/instruction CRUD required by Admin Import and future retrieval.
- Store the Steel Agent Instruction in the database as the Admin-managed default
  instruction injected into every Steel quote turn. Admin can edit, review,
  activate/deactivate, and version it through backend/Admin flows.
- Store Steel Instruction Packets in the database, not only in prompt files.
  `docs/reference/instruction.txt` can seed initial packets, but runtime
  `lookup_instructions` reads reviewed active database rows.
- Planned database surfaces:
  - `steel.agent_instructions`: one or more versioned default Agent Instruction
    records, with exactly one reviewed active default per scope.
  - `steel.instruction_packets`: task-scoped instruction packets returned by
    `lookup_instructions`.
- `steel.agent_instructions` should support structured sections so Admin can
  update defaults without editing provider code:
  - `fileOcrRules`
  - `toolRules`
  - `orderInferenceRules`
  - `workbookRules`
  - `responseRules`
- The first Agent Instruction seed text lives in
  [`../steel-data-rules-architecture/agent-instructions.md`](../steel-data-rules-architecture/agent-instructions.md).
  `steel.instruction_packets` selector/request/response design lives in
  [`../steel-data-rules-architecture/instruction-packets.md`](../steel-data-rules-architecture/instruction-packets.md).
  Database body text injected into AI prompts should be Traditional Chinese;
  canonical API/schema keys can remain English.
- Support Admin updates for instruction packets through backend/Admin flows:
  create draft, edit selectors/body, mark reviewed, activate/deactivate,
  supersede old versions, and preserve source refs/audit.
- Classify instruction packets by multi-axis selectors:
  - `taskType`: material_price_lookup, formula_selection, default_selection,
    drawing_interpretation, processing_detection, workbook_output,
    confirmation_policy
  - `materialFamily` and `productFamily`
  - `surfaceTreatment`
  - `processingType`: cutting, holes, slotting, bending, none
  - optional `formulaCode`, `customerId`, `customerTierId`, `projectId`
  - `priority`, `reviewState`, `active`, `effectiveAt`, `supersedesId`,
    `sourceRefs`
- Keep every source-management endpoint under `/api/admin/steel/...`.
- Track source type/category, source status, source version status, parser/review status, and source refs.
- Keep Admin ERP XLSX source versions distinct from quote conversation evidence.
- Keep handbook DOCX as schema/data-model reference unless a later real data task creates approved import provenance.
- Ensure source/instruction version IDs can be recorded in prompt `context_refs`.

Acceptance:

- Admin can create/list Steel projects and sources.
- Admin can update the default Steel Agent Instruction without code changes, and
  runtime prompt context records its instruction/version ID.
- Source versions can represent ERP XLSX import metadata and review status.
- Quote conversation PDF/image evidence cannot become a formal Admin import source version.
- Future retrieval filters have enough metadata for project, source, version, chunk, category, and guest/public access.
- `lookup_instructions` can retrieve bounded task-scoped reviewed packets by
  task type, material/product family, surface, processing type, formula code,
  customer/tier/project scope, and priority without exposing the whole
  instruction corpus.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(projects|sources|instructions)/.*\\.spec\\.ts$"
rtk npm run build:api
```

## Milestone 5.1: ERP Import Session And Upload Guard

Files:

- Create `packages/api/src/steel/admin/imports/session.ts`
- Create `packages/api/src/steel/admin/imports/upload.ts`
- Create `packages/api/src/steel/admin/imports/xlsx.ts`
- Create `packages/api/src/steel/admin/imports/parser.ts`
- Create `packages/api/src/steel/admin/imports/mapping.ts`
- Create `packages/api/src/steel/admin/imports/handlers.ts`
- Add tests under `packages/api/src/steel/admin/imports/*.spec.ts`

Tasks:

- Start with one confirmed target table, preferably `price_items` if ERP item code plus customer tier is reliable; otherwise start with customers/customer aliases/customer tiers.
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

## Milestone 5.2: Preview, Old Data Match, Table Edit, And Validation

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

## Milestone 5.3: Transaction Commit

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
- Preserve source/import session refs so later quote traces can explain data provenance.

Acceptance:

- Transaction test proves rollback on one failing valid row.
- Price update test proves `price_history` records old/new prices and import log ID.
- Quote lookup after commit returns the new price.
- Import audit identifies actor, source version, target table, valid row count, ignored row count, failed row count, and commit outcome.

Verification:

```bash
rtk npm run test:packages:api -- --runTestsByPath packages/api/src/steel/admin/imports/commit.spec.ts
rtk npm run build:api
```

## Milestone 5.4: Admin UI

Files:

- Create `client/src/features/steel/admin/sources`
- Create `client/src/features/steel/admin/imports`
- Create `client/src/features/steel/admin/tables`
- Modify Steel data-provider admin hooks created in Phase 1.

Tasks:

- Build source list and source-version preview surfaces.
- Build ERP XLSX import session UI.
- Build New / Old / Merge table preview.
- Build Admin table maintenance fetch/edit/preview/save UI for the first target table.
- Show validation status, `needs_review`, and commit eligibility clearly.
- Keep source type / target table immutable after parser starts.
- Do not include a DOCX/PDF upload affordance for Admin import.

Acceptance:

- Admin can upload one approved ERP XLSX fixture and preview rows.
- Admin can inspect New / Old / Merge rows before commit.
- Admin can fetch and edit at least one existing table through the table-maintenance UI.
- Non-XLSX upload attempts show the required rejection message before parser work starts.

Verification:

```bash
rtk npm run test:client -- --runTestsByPath client/src/features/steel/admin
rtk npm run build:client-package
```

## Phase Gate

Do not move to Phase 6 until:

- Admin upload policy tests prove DOCX/PDF/image/.txt files are rejected before parsing.
- Rejected Admin uploads create no source versions, parsed rows, merge rows, or formal database writes.
- Admin import safely updates at least one target table from ERP XLSX parsed data.
- Admin table UI safely previews and edits at least one target table without DOCX upload.
- Rollback behavior is tested.
- Price changes write `steel.price_history`.
- Updated prices are visible to Phase 2 lookup tools.
- Source/project/instruction metadata can be recorded in prompt context refs.
- Admin UI shows preview/validation/commit status clearly enough for a staff review.
