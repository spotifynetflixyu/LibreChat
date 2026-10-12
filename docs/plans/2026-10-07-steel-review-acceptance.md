# Steel review acceptance (#15)

Baseline: `326d27f51605599c70544792f0e280f428596639` (`feat/v8.8`). Initial whole-feature checkpoint: `197d9e96aa3112b3dd4350e229800c8feae86b49`. The final pushed SHA, independent reviews and CI readback belong in #15 and PR16 so they identify the complete committed tree.

## Scope and current contracts

Acceptance follows the actual website: one owner per conversation; OCR/quotation processing completes or is stopped before another execution. No Steel queue, conversation ownership replacement, fabricated identity collision, generic message-writer framework or abnormal-data repair is added. The proposed generic POST/PUT race and ownership-transition findings were withdrawn after checking the frontend call paths and the maintainer's confirmed workflow.

The current UI contract supersedes older issue text: Latest version / Previous version (latest AI has no v1 suffix, each successful human Save increments its owner's suffix); View unlinked left of Add row; Close bottom left, Save bottom right and caption before Save; only Save is primary. OCR/system order share the table with actual headers and their own editing rules. Current values are above struck-through AI values; strikes stay in the dialog. Full trimmed system-order Notes group only on blur/Enter, material first, processing follows its material's source and cascade deletion. Unlinked membership refreshes only after successful Save. Catalog uses erp_item_code prefix/alphabetical ordering and product_name-only name lookup/label/fill; spec_key and value_state do not change these choices. Last queried options persist; arrows/wheel operate an open menu. Undo/redo, expand/collapse and dialog download remain retired.

#14 retains one temporary Mongo input per admitted run: successfully saved server times choose human only when strictly newer; ties choose AI. Admission verifies both candidates and fixes clean Markdown, source mapping and provenance. Child, weight, quote, completion and same-run resume consume that immutable input. Completion/cancel delete it; original 24-hour expiry is enforced logically and by TTL. A historical human owner remains eligible without borrowing newer mappings. Successful publication retains durable result provenance.

## Findings corrected during acceptance

1. Normal Save used concurrent operations on one Mongo transaction session. Existing queries now execute sequentially in that session; nontransactional source reads remain parallel. Authorization, scope, CAS, receipts, rollback and storage shapes are unchanged.
2. A browser source-binding journey (change file/page, then restore the saved file/page) falsely retained an unsaved row because JSON property order was compared. Source values are compared explicitly. The regression failed before the fix and then passed; the browser case keeps the zero-DB-write and clean-close assertions.
3. Existing additional browser assertions used obsolete table column indices and Updated badges. They now locate inputs by actual header/ARIA name and use current version labels. Header-only deletion/addition targets editable rows instead of AI tombstones. Binding tests switch the preview to the row's actual file/page. The normal prior-user attachment fixture connects the uploaded user message to its OCR reply and waits for confirmed Save before DB readback.

## Evidence at the initial checkpoint

- All 30 retained normal browser flows passed against Chrome, real Express and a disposable wiredTiger Mongo replica set. Provider/catalog endpoints are fixture boundaries; API authorization, database methods, Save and reload are real.
- Owning API review/admission/output/completion/publication: 74 passed. Client Markdown actions, headings, Editor and Selector: 65 passed, 2 previously retired cases skipped. Real-Mongo Save/rollback/receipt/retry/reorder/frozen-input selection: 9 passed; 44 cases outside that selection were not run. These are scoped counts, not a deduplicated total.
- Actual-base committed static checks (imports, JSON, cycles and unused i18n) passed, as did semantic ESLint over 219 changed source paths and diff checks. Prettier was not run. #14 owning noEmit/private builds and the seven retained remote checks passed at the checkpoint SHA.
- Lighthouse at that checkpoint, with 250ms Mongo delay and three cold navigations: median LCP 3724ms / 4500ms, CLS 0.0169 / 0.1, TBT 51ms / 500ms. This is explicitly checkpoint evidence, not a final-head claim.
- Fresh whole-feature SPEC and STANDARDS reviews approved that checkpoint. DATA review retained the transaction-session finding above; its two out-of-workflow P1 proposals were withdrawn. Earlier #14 approval is not used as whole-feature approval.

## Verification of the acceptance fixes

- Client session suite: 43 passed, including the source-revert regression. Client noEmit and its private production build passed. Data-schemas noEmit/private build and the nine real-Mongo Save/rollback/receipt/retry/reorder/frozen-input cases passed after the transaction change.
- Additional browser selection: 21/21 passed (1.7m) with the latest build, light theme and reduced motion; actual preview screenshot inspected. The initial failures were located individually rather than treated as baseline. This includes the prior-user attachment Save/readback/reload and restored source binding with zero writes and clean Close.
- Retained normal-browser manifest: 30/30 passed (2.7m) after the fixes, including historical OCR, actual frozen quotation-source badge, catalog keyboard selection, unlinked/group/cascade behavior and real Save/readback/reload. The dark 390px quotation-source screenshot was regenerated.
- Changed-source semantic ESLint, scoped imports, actual-base JSON/cycles/unused-i18n and diff checks passed. No Prettier was run.

Final retained normal-browser/Lighthouse checks, exact-head reviews and CI are recorded on #15/PR16 after pushing the fixes. The extra normal browser coverage includes source PDF/image/page counts and retries, unlinked binding, no-op, clean header-only deletion/addition and CSV, whitespace normalization, failed Save retry, lost-response receipt, conflict recovery, ordered manual weight, material addition, system price and absence of new customer_quote chat output. Light/reduced-motion preview and dark narrow quotation-source screenshots provide actual UI evidence; keyboard behavior is exercised by the retained normal catalog journeys.

## Completion boundary

PR16 stays Draft/OPEN against `feat/v8.8`; all issues stay OPEN until merge. No merge, deploy, primary/master mutation or DEV/PROD rule synchronization occurred. Ten old ticket worktrees are clean and integrated, but owned by two other chats. Managed archive from this chat refuses that ownership. Their cleanup remains pending explicit authorization to send those owner chats the bounded cleanup request; do not bypass ownership with manual removal. Keep #15 implementation:pending while this acceptance item remains unresolved.
