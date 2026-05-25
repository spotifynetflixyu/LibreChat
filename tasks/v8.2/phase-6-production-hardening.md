# Phase 6: Production Hardening

Goal: expand beyond the authenticated MVP while protecting data integrity, access control, source traceability, provider reliability, and user trust.

Each item below should be implemented as its own small plan with a checkpoint before external usage.

## 6A: Guest Mode Hardening

Scope:

- `POST /api/steel/conversations/:conversationMetaId/link-account`
- Optional guest token rotation.
- 30-day guest expiry policy.
- Export retention cleanup.
- Public/default source restrictions for guest retrieval.
- Abuse/rate-limit controls for `STEEL_GUEST_MODE=true`.

Gate:

- Token is never stored plaintext.
- Expired guest conversation cannot access workbook/export.
- Link-account verifies token before assigning `user_id`.
- `STEEL_GUEST_MODE=true` never grants Admin, Source, Instruction, Memory, or import management access.
- Admin can still inspect audit records.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(conversations|permissions)/.*guest.*\\.spec\\.ts$"
rtk npm run test:api -- --runTestsByPath api/server/routes/steel/guest.spec.js
```

## 6B: Retrieval And Source Sync

Scope:

- Chunking and embeddings.
- Steel Supabase PostgreSQL + pgvector retrieval module.
- Source version lifecycle: active, inactive, deleted.
- Reindex jobs for source changes.
- Retrieval filters for provider prompt context.

Gate:

- Prompt runs record exact instruction/source version IDs.
- Inactive/deleted sources are excluded from retrieval.
- Guest retrieval can only use public/default active sources.
- Embedding model and dimension are stored; mixed embedding versions are rejected or reindexed.
- ERP XLSX source versions keep uploaded/source file refs, parser metadata, and review status.
- Future handbook data SQL/import work must define reviewed import provenance when it is implemented.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(sources|retrieval)/.*\\.spec\\.ts$"
rtk npm run build:api
```

## 6C: Full PDF / OCR / Vision Drawing Evidence Flow

Scope:

- Production-grade file metadata, retention, and provider file refs.
- AI-first orientation detection, PDF/image evidence, and drawing interpretation.
- OpenHarness capability smoke for image/PDF/XLSX remains optional per driver/model; unsupported paths fallback to `openai_api`.
- Official OpenAI API file/vision/XLSX fallback paths for PDF page image, uploaded file input, spreadsheet evidence, File Search, and Code Interpreter when enabled.
- Drawing interpretation schema for holes, bends, slots, cut marks, tables, and notes.
- Marked image preview for quote user review.
- Low-confidence drawing interpretations in workbook manual review and interpretation notes.
- Quote conversation PDF/image evidence remains separate from Admin data import.

Gate:

- OCR/vision output is evidence, not authoritative price/spec data.
- Node/backend owns upload, file metadata, provider refs, ACL, audit, fallback routing, and workbook validation.
- Formal ongoing Admin data import still requires Admin-uploaded ERP XLSX parsed data or validated table UI edits.
- Holes, slots, bends, cut marks, and dimensions have source refs.
- Ambiguous vision output cannot write confirmed workbook totals without low-confidence mark.
- PDF/image evidence cannot create Admin source versions, merge rows, or formal database writes.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(vision|ai|workbook|tools)/.*\\.spec\\.ts$"
```

## 6D: AI Merge Table Full UX

Scope:

- Multi-round Admin chat for mapping profile patch and merge table patch.
- New / Old / Merge tabs in `client/src/features/steel/admin/imports`.
- Low-confidence row review.
- Admin confirms final update.

Gate:

- AI can modify data content only.
- Code remains the only owner of validity and commit eligibility.
- Admin has a clear diff before commit.
- Every AI-suggested patch is version-checked.
- Admin import rows visibly show uploaded ERP XLSX source file, sheet/table/section, mapping, and validation status.
- Admin table UI visibly shows fetched old data, edited values, validation status, and pending commit diff.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/admin/imports/.*\\.spec\\.ts$"
rtk npm run test:client -- --runTestsByPath client/src/features/steel/admin/imports
```

## 6E: System Memory Candidate Review

Scope:

- Memory candidate detection from user corrections, resolved low confidence, repeated errors, source conflict, and Admin-created candidates.
- Admin review and merge.
- System memory activation/disable/supersede.
- Promote memory to Project Instruction.

Gate:

- Memory cannot provide material prices, processing prices, customer tier prices, or override Supabase results.
- Memory cannot override deterministic calculator results.
- Scope is explicit: global, project, customer, or material type.
- Conflicts are recorded and resolved before activation when overlap matters.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/memory/.*\\.spec\\.ts$"
rtk npm run build:api
```

## 6F: Eval Harness

Scope:

- Add fixtures for real-like text orders, drawing interpretations, Admin ERP XLSX preview rows, handbook-shaped lookup data when available, system order rows, and customer quote rows.
- Add provider capability/fallback eval fixtures where mocked provider results prove typed error routing.
- Add regression reports in `packages/api/src/steel/evals/reports`.
- Add CI-friendly command for focused Steel evals.

Gate:

- Eval failures identify case ID, assertion, expected value, actual value, and source fixture.
- Evals cover:
  - price-first behavior
  - no zero-filled unknowns
  - seven fixed sheets
  - customer quote mask
  - Admin upload policy rejecting files that are not ERP XLSX
  - provider capability/fallback classification
  - stock allocation
  - cutting/hole/slotting/bending calculations
  - system order output

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/evals/.*\\.spec\\.ts$"
```

## 6G: Async Jobs And Scale

Scope:

- Deferred until after the Phase 3 real-provider chat-to-workbook smoke path is proven.
- Jobs for source reindex.
- Jobs for large ERP XLSX parse.
- Jobs for large workbook export.
- Job status endpoint.

Gate:

- Jobs are idempotent.
- Failed jobs preserve actionable error summaries.
- Progress endpoint cannot leak another user's job state.
- Synchronous endpoints have payload and timeout limits.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/jobs/.*\\.spec\\.ts$"
rtk npm run build:api
```

## 6H: Signed Export Links And Retention

Scope:

- Short-lived signed download token.
- 24-hour default expiry for signed links.
- 7-day default retention for guest exports unless changed by Admin policy.
- Export file retention cleanup.
- Audit on each download.

Gate:

- Token is scoped to export ID and user/guest access context.
- Expired token fails.
- Deleted/closed workbook export fails.
- Download audit includes actor, export ID, workbook ID, and conversation meta ID.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/exports/.*signed.*\\.spec\\.ts$"
```

## 6I: Provider Production Readiness

Scope:

- OpenHarness OAuth token storage and operational risk review.
- Official OpenAI API fallback cost/rate-limit/budget observability.
- Provider/version pin review.
- Model allowlist review.
- Capability smoke scheduler or admin runbook.
- Typed provider error dashboard/audit review.

Gate:

- Production either explicitly accepts OpenHarness OAuth provider risk or disables it outside local/dev.
- `OPENAI_API_KEY` fallback remains configured for production-safe operation when required.
- OAuth `remaining quota` is not treated as a guaranteed API feature.
- API fallback handles usage limits, rate limits, budget, billing, API-key, and project-policy errors.
- Capability status is current enough before enabling file/vision/XLSX workflows.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/ai/.*\\.spec\\.ts$"
rtk npm run build:api
```

## 6J: Frontend UX Hardening

Scope:

- Harden the Phase 3 Chat Workspace.
- Harden the Phase 3 Workbook Preview with seven tabs.
- Harden the shared desktop/mobile Steel UX framework without introducing a separate mobile-only workflow.
- Source Admin.
- Import Admin.
- Memory Review.
- Low-confidence overview.
- Customer quote/system order quick download actions.

Gate:

- Phase 3 chat UX remains functional with real API data.
- Mobile and desktop layouts keep the same data contracts and core workflow.
- User can filter manual review rows.
- Customer quote preview does not display internal fields.
- Admin can preview ERP XLSX parsed source data before import.
- Admin can fetch and edit existing table data without DOCX upload.
- Admin can review memory candidate.

Verification:

```bash
rtk npm run test:client
rtk npm run build:client-package
```

## Final Production Readiness Gate

Before broad release:

- Run full relevant test matrix.
- Run manual vertical slice on local dev: backend health, authenticated Steel quote, workbook patch, Excel export, ERP XLSX Admin import or table UI update, quote reflects new price.
- Run OpenHarness OAuth and OpenAI API fallback provider smoke tests.
- Review audit logs for every external write and every provider fallback.
- Review prompt-injection test coverage for source chunks, tool results, OCR text, and Admin import rows.
- Confirm OpenHarness/OpenAI model list, API type shape, provider capability status, and cost guardrails are current.
- Confirm database TLS policy and Supabase permissions for deployed environment.
- Confirm eval harness covers critical business regressions.
