# Steel review execution plan

Implementation baseline: `056eb076ac0b9f7b7ccaba74672ae1288fab662a` on `feat/v8.8`.
Integration branch: `codex/steel-source-review`, in an isolated managed worktree.
The original checkout and its user-staged documentation remain untouched by integration commits.
The current source-review spec, glossary, and ADRs are the acceptance source.

## Architecture

- Shared plain review types and endpoint/data-service/query-key contracts belong to data-provider.
- Database schemas and factory methods in data-schemas store a managed output sidecar:
  authorized owner scope, kind, lineage/output/AI versions, stable row IDs, single nullable
  file/page source, processing parent, candidate/customer snapshots, per-field overrides,
  AI raw/full baseline, last human saved complete Markdown/timestamp, derived effective
  review snapshot, exact message-part/section locators, operation receipts, and revisions.
- The authoritative current-output references select eligibility per kind. Read-only reads
  must not rewrite messages. Historical owner snapshots stay immutable after supersession.
- TypeScript Steel services receive DB methods, catalog client, config and context from callers.
  Legacy Express only wires existing auth, injected methods and route registration.
- Public API: scoped read; prepare operations against expected output/table/message/customer
  revisions; commit those same operations plus operation ID and deterministic commit hash.
  Preparation computes exact affected rows and quote changes. Commit revalidates and
  recalculates and must match the prepared hash before one atomic write; changed evidence
  requires preparation again. No durable draft-token store is needed.
- The commit hash includes the trusted output-bound customer snapshot ID/revision/tier,
  candidate evidence, final effective rows and target changes. No tier resolution from a
  mutable current customer record. Missing exact-tier prices remain null and selectable.
- Idempotency keys are scoped to authenticated owner, lineage, operation ID and canonical
  payload digest. Identical already-committed retries return their stored receipt without
  writes, even after supersession. Same ID/different payload fails. Never-committed and new
  undo/redo operations recheck latest-output eligibility and revision.
- One Mongo transaction/CAS updates review data, canonical OCR/quotation, staleness metadata,
  and precisely identified message targets. system order/customer_quote are atomic. Generic
  message mutation and AI writers must not bypass the managed-table revision boundary.
- Precise section updates validate authorized DB owner, unique range, expected hashes and
  any text/content mirror. Preserve every byte/part outside targets; reject ambiguous or
  removed targets. Never use first-heading matches or global text replacement.
- Clean readers batch-load managed output snapshots for OCR merge, quotation and provider
  inputs, not display strike-through. Historical inputs use their own snapshot.
- AI merge uses the previous AI complete baseline. A same-lineage new output preserves
  explicit human overrides and coherent candidate groups in a separate effective review
  snapshot, adopts untouched AI fields, updates dependent derived results and current
  display/quote atomically at the new owner, and never refreshes the last human save time.
  Historical owners do not change. Relevant quotation staleness follows changed OCR source.
- Next quote admission compares separately persisted AI/human complete saves and server
  timestamps, validates revisions and freezes source kind/hash/version/timestamps for the run.
  Resume never reselects. This selection is distinct from the composed comparison display.
- Material replacement updates candidate dimensions/price/material derived values but
  preserves all existing processing fields. Separate later input changes retain ordinary
  dependency recomputation. Inputs are decimal strings; use existing exact quote arithmetic.
- The frontend uses shared semantic primitives, Jotai feature state and React Query. PDF
  rendering is controlled single-page, multi-source single selection; one source has many rows.
  Sessions preserve pending operations across pages and support persisted inverse operations.
- New limits/timeouts/capabilities go through config schema with compatibility defaults.

## Task graph

Each numbered ticket is a demoable vertical slice with schema/API/UI and behavior tests
where its behavior needs them. Shared plumbing is introduced by the slice using it.

| Ticket | Behavior | Direct blockers |
| --- | --- | --- |
| 01 | Recognized Steel table read-only entry and per-kind current/history eligibility | none |
| 02 | Multi-file controlled page/image preview and all corresponding rows | 01 |
| 03 | OCR cell autosave, baseline/diff, exact atomic chat write, retry/conflict and stale quote | 01 |
| 04 | Single nullable source selectors and legacy unlocated labeling | 02, 03 |
| 05 | OCR add/delete/session undo-redo and stable IDs | 02, 03 |
| 06 | System order price/quantity correction and atomic customer_quote update | 03 |
| 07 | Material/processing group CRUD, explicit parent/source and undo-redo | 04, 06 |
| 08 | Dependency-aware material unit weight and pricing totals | 06 |
| 09 | Persisted per-piece/batch/confirmed-cutting inputs and processing calculations | 07, 08 |
| 10 | Material async catalog selection, exact customer tier, candidate dimensions, keep processing | 08 |
| 11 | Processing async catalog selection and parent applicability | 09, 10 |
| 12 | AI full/update merge, composed review and human conflict adoption without timestamp pollution | 05, 07, 10, 11 |
| 13 | Timestamp-based OCR quote admission and immutable resume source | 03 |
| 14 | Independent precise history/standards/spec audit and integrated UI/DB/Lighthouse evidence | 12, 13 |

Save captions are part of every relevant mutation slice, with no extra implementation ticket:
prepare returns unique net changed rows per table, success receipt supplies actual counts;
caption includes cascade changes and excludes unchanged processing on material replacement.

## Execution and checks

- User explicitly requested implement-spec; this authorizes the integration branch,
  per-ticket worktrees, commits/merges and a draft PR through the chosen GitHub tracker.
  Do not deploy, merge the PR or mutate PROD data/rules.
- Publish one spec plus blocker-ordered issues and native dependency edges. Preserve local
  context mirrors with GitHub identifiers. Keep parent issue unchanged when publishing tickets.
- Executor and merger agents use the configured executor route, no descendants, bounded
  ownership and worktrees based on the current integration tip. Do not revert other work.
- TDD at the user-confirmed browser→real backend→DB readback/reload and API→real Mongo replica-set
  seams. Fixtures may replace external AI/catalog HTTP only; do not mock persistence proof.
- Pin independent final review to the initial baseline and final integrated head, run both
  standards and spec axes, repair findings, then recheck the changed behavior.
- Complete focused Jest, workspace no-emit typechecks, required builds and scoped import/static
  checks; message/file loading changes also require Lighthouse and real multi-file UI evidence.
- Retain open tracker issues until actual PR merge permits resolution; draft/ready PR alone
  is not a merged completion. Report branch, head, PR, checks and remaining limitations honestly.
- Archive completed ticket worktrees after integrating and preserving any necessary ignored files.
