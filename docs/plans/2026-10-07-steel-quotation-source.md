# Steel quotation OCR source — 2026-10-07

Plan V1 and revised V3.1: Advisor `PLAN_APPROVED`. V3.1 follows the maintainer's temporary-document and one-flow/no-queue instructions. Starting integration HEAD `c0133f99426f16077c97af982f66dd57f71b3884`; primary remains `feat/v8.8` / `326d27f51605599c70544792f0e280f428596639`. PR16 Draft/OPEN, base `feat/v8.8`. Issues #14/#15 remain pending/OPEN until verified; no merge, deploy or DB rule synchronization.

## Approved contract

- Resolve immutable complete AI and last human OCR references in authenticated user/tenant/conversation/trusted lineage. Compare original successful server savedAt; human strictly newer wins, otherwise AI wins. Keep historical human owner and time unchanged across new AI baselines.
- Preparation retains both reference slots, selected kind/version/times/clean Markdown and same-snapshot mappings. Admission checks both references, revision/hash and absence in one Mongo transaction with snapshot insertion and run/ticket CAS. Replay returns the original accepted run.
- Child, weight, quote, completion and resume use the same temporary frozen record. Later Save never changes input/checkpoints. Executed results retain their input provenance; changed current candidates still require a new quotation. Run/target/customer/lease and publication CAS protections remain.
- Recover missing mappings only from exact immutable authorized same-owner/output/revision/hash evidence with explicit row fileId and source code. Conflicts remain unlocated; reads/no-op never backfill or refresh hashes/times. Persist recovered evidence only with changed Save.
- Existing quotation status API/activity UI identifies frozen source and version, including historical reload after another run, without mixing sources. Shared semantic primitives and English localization; existing Steel editor/search/grouping contracts unchanged.

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


## Temporary input and one-flow lifecycle (V3.1)

The admitted `snapshot` artifact is a temporary DB document, created once in the admission transaction. It carries `expiresAt = acceptedAt + 24h`; a normal Mongo TTL index runs physical cleanup. This fixed lifetime implements the explicit user contract rather than adding another configuration lever. No app automation or provider work is scheduled. Mongo TTL may physically delete after its deadline; logical admission-time guards reject expired reads/resume, lease/checkpoint/completion/publication independently. A state read/start transaction cancels/releases an expired unfinished or unpublished run and deletes only its exact scoped input, including when TTL already removed it.

Cancellation atomically marks the exact authorized run terminal, drops its lease and removes that run's input. Successful guarded result publication deletes the input in the same transaction as its message, publication receipt and checkpoint. Failed publication retains it for the same-run retry. Confirmed-result replay verifies durable final/publication/run evidence and returns without rereading input or invoking a provider. Runtime final/chunk/checkpoint artifacts, AI publications, human receipts and immutable source metadata remain independent of temporary cleanup; the raw candidate references/absence, chosen version/hash/time and source mapping remain in run/result authority.

There is one executing flow per conversation. An unexpired active or completed-unpublished run resumes itself; a second correction/new flow is never queued or executed afterward. The quotation queue processor, steering-to-queue bridge and queue-entry paths are removed. Old optional pending storage is ignored, with no abnormal-data migration. The compatibility status `queued` means admitted and not started; it does not represent waiting requests. A fresh direct run remains possible after a published completion, cancellation or expiry.

Exact-head review of `51ebf3c7cdc6c742c31204c00929bb6003554363` found valid gaps in the no-reference legacy admission, exact human receipt/version proof, historical OCR artifact lineage and persisted historical source display. That head is superseded by these fixes; it is not approved. All admission paths now share the atomic DB implementation and fail closed for present invalid candidates. Fresh independent reviews and remote CI are recorded against the replacement PR head.

Current focused correction evidence: normal real publisher/provider reconstruction/resume, failed-publication retry and exact candidate proof tests pass (8); full state run passed 28 with one obsolete post-cancel artifact-count assertion, now corrected and passing independently; guarded DB publication/cleanup rollback/retry passes (6); native/history events pass (40), historical source client tests pass (71). Earlier Mongo monitor timeout was reproduced individually and the complete pre-lifecycle state suite passed 29; it was not attributed to baseline. First lifecycle type/test attempts exposed a missing public constant export and were repaired before verification.

The temporary-input lifecycle suite passes 5/5, including actual Mongo TTL deletion, foreign-scope preservation and cleanup rollback/retry. Queue retirement owning checks pass: preparation 48, runner 65, ToolService 195 (2 existing skipped). Remaining pending state APIs are compatibility storage only, with no runtime callers. Scoped imports/semantic ESLint and applicable static gates pass; Prettier is excluded. Final source-event, normal 30-case browser and Lighthouse gates are recorded in the PR evidence against the fixed replacement head.


## Completed-unpublished admission and post-cleanup catalog correction (V3.2)

At `6eaba5bc7ef56af933b372c39727e53fd4feae44`, independent STANDARDS/security/data-integrity review approved; SPEC review found a valid P1: a delayed second signal could replace a completed-but-unpublished run. That head is superseded and has no overall approval. The replacement verifies exact durable final/publication checkpoints and hashes before preparing a new run or changing its customer. Ticket CAS retains exact prior run identity/status/checkpoints; admission repeats publication proof inside its transaction. The delayed unchanged signal reuses the original run. Real Mongo tests cover failed-publication retry, a preissued second signal, missing publication evidence, and completion of another run between a delayed ticket's proof check and CAS; no extra ticket or input is created.

The same head's normal browser/remote CI run had 25 passed and 5 catalog/processing failures, with other retained CI lanes passing. The failures were valid integration regressions: the normal catalog API returned HTTP 409 `CATALOG_CHANGED` because its customer evidence lookup still depended on the deleted temporary input. The configured catalog fixture and query hook were verified; this was not a fixture or baseline attribution.

Advisor V3.2 returned `PLAN_APPROVED` for a narrow durable customer evidence reader. Catalog retains the original input digest and exact admitted customer from its immutable accepted ticket and same-scope active/verified archived run. Current system-order run and clicked owner must match the private catalog request. Present invalid run/ticket/archive evidence fails closed; the current customer or another run is never substituted. No OCR body copy, extra permanent input document, migration, or read-time backfill is added. Legitimate legacy snapshot-only records keep their prior reader contract.

Replacement focused evidence and exact-head review/CI readback are added to PR16 and issues after push. The 30-flow acceptance manifest, original source/UI contracts and performance budgets remain unchanged; no Prettier is run. #15 remains pending because the ten prior worktrees require their owning chats to archive them.


Replacement owning evidence: runner and normal publisher/provider/input integration 73 passed; lifecycle 6, state 29, preparation 48; complete read-method suite 26; activity UI 46. API/schemas noEmit and scoped import/semantic lint pass (one nested ternary found and flattened without changing behavior). The `queued` wire value remains compatible, while its user-facing label is “Preparing quotation”. Browser/CI/Lighthouse final results and exact pushed-head reviews are pending and will be recorded in GitHub evidence; this entry does not claim approval or green CI for the replacement head.


## Complete current-input mutation fencing (V3.3)

At `e8c5a2a085cdaa0d7e875dfa5c032febee7e97af`, all seven retained remote checks passed, including the normal E2E manifest and Lighthouse. Independent exact-head reviews nevertheless found valid gaps: current-order replacement and customer/evidence clearing could still race admission or change a completed-unpublished run's authority; Traditional Chinese still used the old queue label. That head is superseded and has no overall approval.

Advisor V3.3 returned `PLAN_APPROVED`. Every current-input mutator uses the same hash-validated final/publication receipt proof and binds its CAS to the observed active run identity, status and checkpoints (or absence). Save operations reject a locked flow; delayed clears retain its authority. Existing same-data replay remains non-mutating. The normal full-Markdown publisher uses the shared database proof within its own transaction and refuses unfinished or completed-unpublished runs before changing OCR/order/customer mirrors. The matching run's result materialization and guarded quotation publisher retain their original authority checks and remain available for publication retry.

The invariant audit covers every normal currentOrder/currentCustomer/evidence writer, preparation/admission, successful publication, cleanup and replay. Legacy pending-message storage has no normal queue callers and is not expanded. No abnormal-data repair, migration, or DB rule synchronization is added. New deterministic real-Mongo/provider tests exercise all six input mutations between a previous run's successful proof read and the admission/completion of a new unpublished run, then publish that same new run successfully without invoking the provider again.

The compatible `queued` wire status now uses the new English `com_ui_steel_quote_status_preparing` key. The actual Traditional/Simplified Chinese loader falls back to the new preparing label; only English translations are changed, preserving the repository localization policy. Locale/activity tests pass 59; client noEmit/private build and scoped semantic lint pass. Final owning checks, exact replacement-head reviews and remote CI are recorded after the correction is committed.

Maintainer requested a pause at #15: finish #14 correction, necessary verification and issue/PR evidence, then stop before whole-feature #15 acceptance or worktree cleanup. #15 remains pending/OPEN; its earlier integrated evidence is retained without claiming completion.

Final V3.3 owning verification before push: API input/runner/state/preparation/lifecycle 162 passed using the new private DS build; shared DB input/full publication 11 passed; activity and actual zh-Hant/zh-Hans locale path 59 passed. All three owning noEmit/private builds and scoped semantic ESLint/import/diff checks passed; affected imports/JSON/cycles/unused English i18n gates passed against the actual PR base. No Prettier. Necessary #14 browser/performance checks and independent reviews/remote CI are recorded on PR16 and #14 against the committed replacement head; #15 remains paused.
