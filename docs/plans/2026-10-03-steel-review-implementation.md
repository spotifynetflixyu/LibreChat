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
- Save reuses existing backend field normalization on clean effective values (system order:
  `packages/api/src/steel/markdown/order.ts`), before building display differences. Preparation
  and commit use identical validation/normalization/recalculation and final hash/counts; persist
  and return the same normalized snapshot in DB and exact chat targets. AI originals stay intact.
- One Mongo transaction/CAS updates review data, canonical OCR/quotation, staleness metadata,
  and precisely identified message targets. system order/customer_quote are atomic. Generic
  message mutation and AI writers must not bypass the managed-table revision boundary.
- Precise section updates validate authorized DB owner, unique range, expected hashes and
  any text/content mirror. Preserve every byte/part outside targets; reject ambiguous or
  removed targets. Never use first-heading matches or global text replacement.
- Clean readers batch-load managed output snapshots for OCR chunk aggregation, quotation and provider
  inputs, not display strike-through. Historical inputs use their own snapshot.
- AI now emits complete Markdown only. Remove cell-comment editing, pending-comment prompt
  injection, AI delta sections, backend delta merge and appended complete tables. Reject any
  new publication with retired update/revision/deletion sections, even mixed with a full table;
  fenced examples and immutable historical messages are excluded by precise parsing. Keep
  OCR/quotation chunk assembly and isolated read-only legacy history if required. Consumers
  read their owner saved clean complete snapshot/revision/hash; rejected or incomplete outputs
  cannot fall back to raw, delta or reconstructed chat. Every successful new AI output starts
  a fresh effective review snapshot from its own complete AI baseline, with no prior human
  overrides, added/deleted rows, source markings, candidates, derived values or strikes.
  Human differences apply only within the output where they were saved. Save the new AI
  snapshot, current owner/display/quote and necessary staleness atomically; historical owners
  remain immutable. Never rewrite, reattach, delete or refresh the last human complete save.
  This supersedes the earlier cross-output human-composition policy.
- Compare complete saved AI/human snapshots only within the authenticated owner/tenant/
  conversation/current OCR lineage. Each candidate has immutable snapshot identity, revision,
  hash and server save time. The last-human reference may point to a historical owner;
  preserve that reference rather than copying the save into the new owner. Admission atomically
  validates both candidate versions/hashes and freezes the selected snapshot identity.
- Allocate a trusted monotonic output sequence at producer-generation admission. Finalization
  validates that generation, expected current reference/revision and exact new message-part/
  section/mirrors. Commit AI raw/full, clean effective, AI time, target and references together
  with CAS current-owner switching; delayed/superseded finalizers cannot regress the sequence.
  Require a unique complete authorized target and reject retired protocols or uncertain mirrors
  without touching the prior current owner or unrelated message content. The fresh AI baseline
  derives solely from this complete AI output. Stored/queued comments must never be sent after
  retirement. Track the complete-output instruction in actual preparation/delegate inputs and
  rule sources; do not implicitly apply PROD rules. Slice12 owns retirement after replacement
  saves exist; slice14 proves UI, prompt absence, rejected mixed protocols and clean consumers.
- Next quote admission compares separately persisted AI/human complete saves and server
  timestamps, validates revisions and freezes source kind/hash/version/timestamps for the run.
  Resume never reselects. Read the last human complete save even when its owner is historical;
  resetting the new output UI must not remove it from timestamp-based source selection.
- Material replacement updates candidate dimensions/price/material derived values but
  preserves all existing processing fields. Separate later input changes retain ordinary
  dependency recomputation. Inputs are decimal strings; use existing exact quote arithmetic.
- Manual Save is the only ordinary human commit trigger. Enter/blur, source/CRUD/candidate
  selection and undo/redo update a feature-owned draft only; page/file switching preserves it.
  A localized Save button has a persistent net unique unsaved-row caption. Save flushes the
  active cell, prepares/recalculates all net operations and displays authoritative affected counts
  before atomic commit; zero net changes do not write or refresh human time. Changes arriving
  during a save stay in a subsequent draft, never cleared by an earlier receipt.
- The frontend uses shared semantic primitives, Jotai feature state and React Query. PDF
  rendering is controlled single-page, multi-source single selection; one source has many rows.
  Sessions preserve pending operations across pages and stage inverse operations for explicit Save.
  Every close entry checks unsaved active cells/failed drafts and asks Save updates, Discard
  unsaved changes or Continue editing; save closes only after confirmed success. Discard
  never rolls back committed saves, and unknown in-flight outcomes use their receipt.
- Managed-table downloads use the same feature-owned save gate: flush the active edit and
  drain in-flight prepare/commit, save only net corrections, then download the clicked
  owner's backend-confirmed immutable saved clean snapshot/revision. No-op/history downloads
  do not write or refresh human time. Failures or superseded pending edits block download and
  retain drafts; a lost save response is resolved through the existing idempotent receipt.
  Slice 03 owns the shared gate, 06 adds system-order/quote atomic completion, and 14 verifies
  actual downloaded contents against DB/API/reload. Ordinary Markdown gains no save behavior.
- New limits/timeouts/capabilities go through config schema with compatibility defaults.

## Task graph

User execution preference: implement tickets in numeric/topological order, one ticket at a time.
Complete, review and verify a ticket before releasing the next; no parallel ticket implementation.

Each numbered ticket is a demoable vertical slice with schema/API/UI and behavior tests
where its behavior needs them. Shared plumbing is introduced by the slice using it.

| Ticket | Behavior | Direct blockers |
| --- | --- | --- |
| 01 | Recognized Steel table read-only entry and per-kind current/history eligibility | none |
| 02 | Multi-file controlled page/image preview and all corresponding rows | 01 |
| 03 | OCR cell draft and manual Save, baseline/diff, exact atomic chat write, retry/conflict and stale quote | 01 |
| 04 | Single nullable source selectors and legacy unlocated labeling | 02, 03 |
| 05 | OCR add/delete/session undo-redo and stable IDs | 02, 03 |
| 06 | System order price/quantity correction and atomic customer_quote update | 03 |
| 07 | Material/processing group CRUD, explicit parent/source and undo-redo | 04, 06 |
| 08 | Dependency-aware material unit weight and pricing totals | 06 |
| 09 | Persisted per-piece/batch/confirmed-cutting inputs and processing calculations | 07, 08 |
| 10 | Material async catalog selection, exact customer tier, candidate dimensions, keep processing | 08 |
| 11 | Processing async catalog selection and parent applicability | 09, 10 |
| 12 | Full AI output, retire comment/delta editing, per-output review and immutable human history | 05, 07, 10, 11 |
| 13 | Timestamp-based OCR quote admission and immutable resume source | 03, 12 |
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
