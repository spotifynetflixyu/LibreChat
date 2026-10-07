# Steel quotation OCR source — 2026-10-07

Plan V1: Advisor `PLAN_APPROVED`. Starting integration HEAD `c0133f99426f16077c97af982f66dd57f71b3884`; primary remains `feat/v8.8` / `326d27f51605599c70544792f0e280f428596639`. PR16 Draft/OPEN, base `feat/v8.8`. Issues #14/#15 remain pending/OPEN until verified; no merge, deploy or DB rule synchronization.

## Approved contract

- Resolve immutable complete AI and last human OCR references in authenticated user/tenant/conversation/trusted lineage. Compare original successful server savedAt; human strictly newer wins, otherwise AI wins. Keep historical human owner and time unchanged across new AI baselines.
- Preparation retains both reference slots, selected kind/version/times/clean Markdown and same-snapshot mappings. Admission checks both references, revision/hash and absence in one Mongo transaction with snapshot insertion and run/ticket CAS. Replay returns the original accepted run.
- Child, weight, quote, completion and resume use the frozen record. Later Save never changes input/checkpoints. Executed results retain their input provenance; changed current candidates still require a new quotation. Run/target/customer/lease and publication CAS protections remain.
- Recover missing mappings only from exact immutable authorized same-owner/output/revision/hash evidence with explicit row fileId and source code. Conflicts remain unlocated; reads/no-op never backfill or refresh hashes/times. Persist recovered evidence only with changed Save.
- Existing quotation status API/activity UI identifies frozen source and version, including reload, without mixing another run. Shared semantic primitives and English localization; existing Steel editor/search/grouping contracts unchanged.

## Verification and sequence

DB contracts/publication first, API admission/runner/completion integration second, shared status/UI independently. Root integrates and verifies every handoff. Focused real Mongo transaction tests go through public service admission; controlled provider and normal Express/browser workflows exercise timestamp choice, races, historical human, mapping provenance, future Save, service reconstruction/resume and results. Run owning noEmit/private builds/scoped imports/semantic ESLint/diff/applicable gates, no Prettier, and Lighthouse. Independent exact-head SPEC and STANDARDS/security/data-integrity reviews precede #14 verified evidence, then #15 full integrated acceptance. Update PR/issues and read back; issues stay OPEN.

## CI checkpoint

Live PR HEAD is newer than the handoff ea0976c32: f578efa3c and c0133f994 contain prior user-approved CI cleanup/runtime wiring. Current c0133f994 has 7/7 retained CI SUCCESS. Retired gates do not prove old ea0976c32 failures repaired. Old backend/frontend/static and E2E logs are being audited individually; no blanket baseline attribution. The 17 confirmed retired English i18n keys are removed in this worktree; Prettier remains disabled.


## Implementation and local evidence

The data-schemas factory resolves authorized immutable publications/Save receipts and compares their successful server times. It retains both raw candidate slots, checks them inside the same transaction that accepts the ticket and writes the frozen artifact, and never substitutes current source mappings. Empty mapping recovery uses only the exact saved receipt's explicit row file/source evidence; ambiguous codes/files remain unlocated. Child/main provider inputs, weight/price lookups, completion, guarded message publication and resume share the admitted snapshot. Later changed Save marks the previous result stale without changing the run input. Status/activity reload shows the actual admitted AI/human version.

Preliminary independent review found chained mapping conflicts, weakened customer binding/provenance guards and insufficient terminal archive replay validation. All three were fixed with direct regression assertions. Raw candidate appearance/revision, one-sided customer binding, changed provenance, invalid chunk indices, archive hash/run identity and removed historical owner reject without partial snapshot/run writes. Exact scope checks retain tenantless workflows and prevent cross-tenant fallback.

Local evidence (before final commit):

- Real Mongo existing publication/review suites: 4 suites / 58 passed. New immutable input suite: 4 passed, including timestamp/tie/single/none, historical owner, mapping recovery/conflicts/read-only nonmutation, atomic rejection and accepted/archived replay.
- API focused runner/state/preparation/status/completion/review: 6 suites / 192 passed; publication/revision/weight/history/admission: 5 suites / 36 passed; normal full-publication/provider reconstruction/resume integration: 3 passed. An initial command also named two nonexistent suite paths and failed discovery for those paths; the six discovered suites passed. Correct owning suites were then run.
- Legacy response controllers: 272 passed after repairing mocks for the existing runtime boundaries. Client focused UI/activity/session/download/receipt/source: 10 suites / 165 passed, 2 previously skipped receipt cases; both have active real-browser coverage, separately 2 passed. Shared source status schema: 4 passed.
- Full normal 30-case browser manifest initially 29 passed / 1 failed because the revised user/assistant fixture's older-message link selected another branch. Corrected that test-only link; all 6 OCR cases passed on rerun. The other 24 normal app/auth/chat/upload/sidebar/catalog/processing cases passed in the full run. The two new normal source/historical cases are retained in the existing manifest; no new CI lane.
- Five catalog/processing workflows separately passed (43s), including Save → read → second Save → reload. Normal historical sidecar, source activity reload, narrow dark/reduced-motion screenshots and same-snapshot Mongo readback are observable. Existing keyboard/light/dark/source/dirty/no-op/pending-save component checks remain.
- Owning provider/client/schemas/API noEmit and private builds; scoped import sorting, semantic ESLint (Prettier disabled), JSON/cycles/unused i18n/diff gates. Lighthouse's first launch could not find default Chromium; the documented Chrome retry passed without changing budgets: median LCP 3759.248ms, CLS 0.0168846991, TBT 53.922ms.

The old ea0976c32 logs identified retired English keys, stale product_name-only expectations, stale full-publication/controller mocks and OCR-control admission expectations, plus the normal customerRunId guard/source fixture issues. These were audited/fixed with focused checks. Retired CI gates and two reproduced old Mongo failures were never used to classify every former failure as baseline.

## Compatibility and acceptance boundaries

Tenant-scoped requests now require exact tenant state/artifact references. Normal authenticated constructors persist tenantId; tenantless requests still match legacy null/undefined. A preexisting tenant-owned record that omitted tenantId is intentionally unreadable/unresumable in tenant context. No migration/backfill or abnormal-data repair is introduced.

All ten old ticket worktrees are clean. The app refused attachment of steel-review-01 with “This worktree is owned by another task.” They remain preserved for their owning chats to archive; the primary and unrelated worktrees are unchanged. Whole-feature #15 cannot claim worktree cleanup complete while this ownership restriction remains. Exact final SHA reviews and remote CI are recorded in the PR/issues after push; earlier head approvals do not cover this change.
