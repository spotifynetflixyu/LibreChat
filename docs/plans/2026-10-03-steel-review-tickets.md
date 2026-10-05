# Steel source review ticket graph

Spec: https://github.com/spotifynetflixyu/LibreChat/issues/1

Integration branch: `codex/steel-source-review`.
Draft PR: https://github.com/spotifynetflixyu/LibreChat/pull/16.

Current execution (2026-10-05): continue sequentially from slice09 through slice14; verify,
review and integrate each slice, then update GitHub before starting the next slice. The canonical Markdown locator is **messageId + exact full title**.
Each reply contains at most one Markdown section with that full title; another message's same
title is independent. Authorization, output ownership and expected revision remain backend guards.
No positional aliases or older review wire compatibility are retained.

User calculation revision (2026-10-05): all system_order business cells are editable on latest active rows; source associations use the existing authorized file/page selectors. The backend only automatically handles steel fields with sufficient confirmed evidence and an exact computable result. Unsupported or incomplete calculations preserve values instead of blanking them. Explicit manual input is retained; normal validation, authorization, CAS and atomicity remain required. GitHub #9 records the updated acceptance contract.

Verification boundary (2026-10-04): validate data and structures produced by normal frontend/backend
flows. Data inserted or corrupted outside those flows is excluded from acceptance; do not expand
ownership inference, repair, compatibility or defensive logic for synthetic invalid DB records.
This overrides earlier abnormal-DB review requirements. Normal API authorization, validation,
version/concurrency checks and transaction atomicity remain required. See the specification's
“驗證範圍與資料邊界” under Testing Decisions.

User revision: every new AI output starts review from its own complete AI baseline; prior human
changes remain historical and are not carried into the new UI or compared with the new AI output.
Baseline: `056eb076ac0b9f7b7ccaba74672ae1288fab662a`.

| Slice | GitHub ticket | Direct blockers | Integration state |
| --- | --- | --- | --- |
| 01 | [Steel 表格唯讀入口與版本資格](https://github.com/spotifynetflixyu/LibreChat/issues/2) | None | Verified (`d58ce51bc`) |
| 02 | [多檔單頁原檔預覽](https://github.com/spotifynetflixyu/LibreChat/issues/3) | #2 | Verified (`c3bd8ad1c`) |
| 03 | [OCR 草稿、手動儲存與精準聊天更新](https://github.com/spotifynetflixyu/LibreChat/issues/4) | #2 | Verified (`1db96bd67`) |
| 04 | [單一來源 selector 與未定位列補標](https://github.com/spotifynetflixyu/LibreChat/issues/5) | #3, #4 | Verified (`65c9b2140`) |
| 05 | [OCR 列增刪與本次 undo／redo](https://github.com/spotifynetflixyu/LibreChat/issues/6) | #3, #4 | Verified (`e4ed93c76`) |
| 06 | [System order 修正與內部報價原子同步](https://github.com/spotifynetflixyu/LibreChat/issues/7) | #4 | Verified (`dfec53c9a`) |
| 07 | [材料與加工列綁定及整組增刪復原](https://github.com/spotifynetflixyu/LibreChat/issues/8) | #5, #7 | Verified (`d46c9d99a`) |
| 08 | [材料單重與計價總數依賴重算](https://github.com/spotifynetflixyu/LibreChat/issues/9) | #7 | Verified (`e6ba86e35`) |
| 09 | [加工計量輸入與 save 前重算](https://github.com/spotifynetflixyu/LibreChat/issues/10) | #8, #9 | Pending |
| 10 | [材料 async selector 與精確 customer tier 價格](https://github.com/spotifynetflixyu/LibreChat/issues/11) | #9 | Pending |
| 11 | [加工 async selector 與材料適用性](https://github.com/spotifynetflixyu/LibreChat/issues/12) | #10, #11 | Pending |
| 12 | [AI 完整輸出、退役舊編輯與每版覆核隔離](https://github.com/spotifynetflixyu/LibreChat/issues/13) | #6, #8, #11, #12 | Pending |
| 13 | [更新時間選 OCR 報價輸入與固定 resume](https://github.com/spotifynetflixyu/LibreChat/issues/14) | #4, #13 | Pending |
| 14 | [聊天精準更新獨立審查與 UI／DB 整體验收](https://github.com/spotifynetflixyu/LibreChat/issues/15) | #13, #14 | Pending |

All issues use `ready-for-agent`; native GitHub blocking edges are verified.
The execution frontier advances after a blocker is verified and merged into the integration branch.
Issues remain open for the final PR's merge/closure workflow; implementation status is recorded here
so merging a ticket into the integration branch is not confused with production deployment or PR merge.

Ticket bodies are mirrored outside the repository under `/tmp/steel-source-review-tickets/`
for fresh implementer context; GitHub is the authoritative tracker.


Slice01 evidence at `d58ce51bca450f1b7b3de6b36b996a97a3d4a5f9`: 11/11 authenticated browser cases against the real backend and a disposable Mongo replica set; 13/13 focused real-Mongo cases; 7/7 API cases; owning workspace builds/typechecks; exact-head spec and standards repair reviews passed. No DB writes on read/reload. Full-feature Lighthouse and final review remain in slice14.

Latest user preference: update related tickets first, then implement them sequentially. Human edits use explicit Save with unsaved-row caption; dirty close asks save/discard/continue. Save reuses backend field cleanup and atomically updates normalized DB/chat data. Slices01–08 are verified; sequential execution now proceeds from09.

Slice02 evidence at `c3bd8ad1c74c03d2eab65a3ef0ba92db38bddbb3`: 17/17 authenticated Chrome cases against real Express and a disposable Mongo replica set, including multi-PDF/image pages, independent same-page rows, unlocated and out-of-range rows, zoom/pan/fullscreen, narrow light/dark layouts, menu-first Escape, retry, active owner and cross-chat/tenant identity guards. Focused real-Mongo/client/shared-dialog tests and owning workspace builds/typechecks passed; independent spec and standards reviews approved frozen feature head `b1818e418`. Scoped ESLint and diff checks passed. Slice03 now proceeds in the user-requested sequence; later slices remain pending.


Slice03 evidence at `1db96bd67f0af7c902c6c0d8556cb56f0d1dbe94`: 55/55 authenticated Chrome cases against real Express and a disposable Mongo replica set, with DB readback and chat reload. Saved clean values replace only the authorized messageId/table target; other same-title messages and unrelated content remain byte-for-byte unchanged. Covers normalization/no-op, prepared and confirmed captions, immutable receipts, failed/lost Save recovery, later drafts, dirty close, clean download, generic edit guards, and unavailable-source business saves while rejecting forged clearing of available sources. Controlled AI publication/manual Save race passed. Owning real-Mongo writer/source suites passed14/14; fresh shared/database/API builds and database/API noEmit passed. Client tree is unchanged from the already validated `99358fe30` client build/typecheck/focused UI and legacy route checks. Independent exact-head spec and standards reviews approved. Full-feature checks and Lighthouse remain in14; issues and draft PR remain open pending the final merge workflow.


Slice04 evidence at `65c9b2140c980c80b9797abc5909bbe5df65e072`: the separately merged integration tree exactly matches frozen actor `fbc1797ed674323a3130bde1aa29a28791c8ae50`. Root rebuilt all dependent workspaces and passed 77/77 authenticated Chrome cases against real Express and disposable Mongo, with DB readback and chat reload, plus the controlled AI/manual-save transaction race and all four owning workspace noEmit checks. Independent exact integrated-head spec and standards reviews approved. Focused suites passed database27/API30/provider10/client45; all 25 changed JS/TS paths passed scoped ESLint with Prettier disabled, imports and diff checks. Source corrections are local drafts until explicit Save, permit missing associations, use authorized single-file/single-page metadata and actual PDF/image page counts, preserve immutable AI and old receipts, and reserve lossless source codes without assigning unknown rows. Matching legacy proofs use the same full physical message hash for second-part tables; invalid proofs stay unlocated and business-saveable. Saved source mappings survive reopen, source-only edits do not stale quotations, and only the exact authorized message/table/part changes. Full-feature Lighthouse and final checks remain in14; issues and PR remain open/Draft.

Latest Save contract revision: the new UI submits only changed-row operations and a captured expected revision. The backend applies them to the latest saved effective Markdown while keeping the AI baseline immutable. Same-output nonconflicting row/field edits automatically merge, including another Save between prepare and commit; genuine conflicts preserve the draft, and new AI generations remain separate owners. Ticket05/GitHub#6 records the approved transaction-current merge and intent receipt contract. Slice05 is Verified; final evidence and the confirmed verification boundary are recorded below.

Latest session-history revision: successful own Save confirmation clears undo/redo and the focus group; failed/unknown saves retain history. Save APIs now lock all value editing and modal closing; subsequent edits start after completion. Server AI baselines, saved revisions and immutable receipts remain retained.

05 補充：R12 衝突恢復已獲獨立架構審核並更新 GitHub #6：同 owner 409 回傳最新版與全部衝突，檔案／頁碼 selector 警示，保留草稿並以下次指定最新版保存；同值自動消除。已由下方固定版本的真實 UI／API／Mongo／reload 與兩軸審查驗證；現為 Verified；使用者已指示從06依序繼續。

Latest title contract: every Markdown has a unique full title within one reply. New review location is the authorized messageId plus exact full title, with backend-derived physical target and retained output/version authorization. All review entry points require title and changed-row operations; positional aliases, full-row submission and old wire/digest compatibility are removed at the user’s request. Slice05 incorporates this uniform protocol before release06; existing backend data and current-protocol receipts remain protected. The title path and retained normal-flow behavior passed real UI/API/Mongo/reload proof and independent reviews at the frozen head below; GitHub #6 records Verified while remaining OPEN until the PR merge policy permits closure.


Slice05 final evidence at `e4ed93c76d7a660b3289b2d6ce539471b6082dc1` (tree `e4d817ed1ccb87827d26e02ba46cabc5b0a48f38`): ROOT completed 128/128 authenticated Chrome cases against real Express and a disposable wiredTiger Mongo replica set, with DB readback and chat reload. Focused suites passed 206/206 (provider22, API41, database45, client98), all five owning noEmit and scoped semantic lint/import/diff checks passed. The initial database run had two 15s timeouts under concurrent Mongo load; the unchanged focused rerun passed 45/45 without changing tests or timeouts. Independent current-scope SPEC and STANDARDS reviews approved this exact source. A separate Git-only fast-forward integrated the identical tree; ROOT then rebuilt all five dependent workspaces, passed all five owning noEmit again, and completed 7/7 title-locator/committed-receipt browser cases against the real integrated build.

The current validation boundary covers normal frontend/backend-produced data and structures. A preceding historical ambiguity review case required an artificial competing DB record missing title/provenance; the user explicitly excluded such data inserted outside normal flows. Its proposed defensive patch/tests were cancelled, not reported as fixed. No additional abnormal-DB inference, compatibility or defensive expansion is an acceptance requirement. Normal API authorization, source validation, version conflicts, retries and atomic persistence remain required.

The canonical locator remains **messageId + exact full title**; normal DB records preserve the AI baseline, saved human Markdown and successful timestamps. Diff strikes appear only in the comparison dialog; saved chat/export show clean active values. Save submits changed-row operations against the latest data, clears this session’s undo/redo after confirmation, and preserves later drafts and other messages.

Slices01–08 are verified and integrated; execution proceeds from09. Slices09–14, full-feature Lighthouse/static checks, remote CI and whole-feature review remain pending. PR16 stays Draft and OPEN; tickets remain OPEN under the final PR merge/closure workflow. No production deployment, parent issue update or primary-branch write occurred.

Latest source-boundary correction: OCR result includes all source files. Identical new AI Markdown cannot bind a different file mapping; manual row deletion only reduces bindings. Do not add that hypothetical to acceptance or defensive logic. Keep the source evidence of the selected OCR snapshot. GitHub #7 records this correction.


Slice06 final evidence at `dfec53c9a476483c369ac6e04cbf423746b8d7b7` (tree `8a8d9661e33246e2bc62436d9e4ffe316f39b6ef`): fresh independent SPEC and STANDARDS reviews approved the exact clean actor head. Root passed 22/22 authenticated Chrome cases against real Express and a disposable wiredTiger Mongo replica set, including atomic price/total Save, conflicts, clean download, immutable receipts, completed replay, ordinary revision and publication/manual-Save races. The normal no-publication-receipt A completion/B revision/delayed A replay preserves B's external text, tool content and metadata; the common typed publisher retains the original source identity before applying the trusted current target. New public customer_quote output is suppressed while internal quotation calculation and existing historical text remain retained. API focused81, actual host278, ToolService bridge15, completion36 and real-Mongo publication5 passed. Scoped43-file ESLint had zero new diagnostics; all34 remaining diagnostics were within the pre-existing35 baseline. Imports and diff checks passed without Prettier.

A separate Git-only fast-forward integrated the identical reviewed tree. Root rebuilt all five dependent workspaces, passed all five noEmit checks, then reran all22 browser cases against the integrated build; all557 integrated source/dist hashes were unchanged through that run. This record changes only documentation after the reviewed executable tree. Full-feature Lighthouse/static checks, remote CI and final whole-feature review remain for14; GitHub #7 stays OPEN under the PR merge policy. No abnormal-DB repair or impossible same-new-AI-Markdown/different-file-mapping acceptance case was added.


Slice07 final evidence at `d46c9d99a3a093e7d09cd0883499ccb7eb262566` (tree `f6addd9e79600cb631dd31400e8c4f9aba69bb36`): fresh independent whole-slice SPEC and STANDARDS reviews approved the exact clean source after a subsystem invariant audit. Root passed 62/62 authenticated Chrome cases against real Express and a disposable wiredTiger Mongo replica set (51 system_order and 11 normal OCR), including source inheritance, explicit classification/binding, group delete/restore, pending Save input, conflicts/no-op, clean download, immutable receipts, DB readback and reload. Normal restored-child rebind followed by original-group re-delete clears obsolete cascade provenance; the next individual delete/restore remains available after Save/reload. No-binding group re-delete retains its proper cascade marker. Internal quotation and clean Markdown agree with the saved canonical rows.

Focused suites passed 191/191 (provider27, session44, API33, Editor14, Markdown review47, real-Mongo writes26); all five owning noEmit and ordered private builds passed. All 20 changed JS/TS files passed scoped semantic ESLint with the formatter disabled, with imports and diff checks; no Prettier was run. A separate Git-only fast-forward integrated the identical approved tree. Root rebuilt all five dependent workspaces, passed all five noEmit checks, then reran all62 browser cases against the integrated build; all534 integrated source/dist files and HEAD remained unchanged through both runs. This completion record changes only documentation after the reviewed executable tree.

The normal-flow verification boundary excludes direct abnormal DB records and unpublished intermediate missing-system sidecars; current API/DB initialization produces trusted kinds and explicit parent-null. OCR includes all files, so identical new AI Markdown cannot acquire a different file mapping; manual row deletion only reduces bindings. No repair, compatibility, ownership inference or hypothetical defense was added for these excluded cases. Normal explicit human binding/source edits retain independent revision CAS when physical Markdown bytes stay unchanged. GitHub #8 remains OPEN under the PR merge policy; PR16 stays Draft while08–14 and whole-feature Lighthouse/static checks/remote CI/final review remain pending. No production deployment or primary/master/PROD change occurred.

使用者最新補充（2026-10-05）：system_order 類別欄位使用 menu selector；彈窗比對 AI 原 Markdown 並顯示刪除線，Save 後聊天 Markdown 與下載為最新成功保存值。


Slice08 final evidence at `e6ba86e3536ba2d4f34be03fb5d36d867afd2aa3` (tree `f74867bf566f9c1bcac5ca0651b13c62b106cb3a`): fresh independent whole-slice SPEC and STANDARDS reviews approved the exact clean source after the formula/producer/provenance/transaction invariant audit. Root passed 85/85 authenticated Chrome cases against real Express and disposable wiredTiger Mongo (23 material, 51 system_order and 11 normal OCR), with normal publication/checkpoint authority, DB readback and reload. All 542 source/test/private-dist/HEAD hashes remained unchanged during that proof. Focused provider53, runner65, Mongo read/write46, client112 and category-registry33 checks passed; owning noEmit, scoped imports/lint with Prettier disabled, and diff checks passed.

A separate Git-only fast-forward integrated the identical source tree. Root rebuilt all five private workspaces, passed all five owning noEmit, then passed 41/41 integrated Chrome cases (23 material, seven critical system_order and 11 normal OCR); the same 542 source/dist/HEAD hashes remained unchanged. The primary checkout remains clean on feat/v8.8 at `326d27f51605599c70544792f0e280f428596639`.

Latest system_order review exposes every business field; 類別 uses the existing shared menu and canonical 29 categories, preserving current/AI values and allowing clear. The popup retains AI-original strikethrough after Save; chat and downloads contain clean latest saved values. Supported material formulas use exact decimal inputs and their actual operands: plate thickness/width/length with density, square current width/length with density, and confirmed profiles length with per-metre or stock-length evidence. Quantity preserves manual unit weight; ordered explicit total/price edits retain their authority. Unsupported, incomplete and repeating computations preserve outputs; explicit blanks remain blank. Normal added rows use the same ordered cleanup/calculation as updates. Trusted derived changes merge; concurrent manual provenance and all independent conflicts remain visible. No Save-time lookup or abnormal-DB/hypothetical new-AI mapping repair was added.

GitHub #9 remains OPEN under the PR merge policy; PR16 stays Draft while09–14 and whole-feature Lighthouse/static checks, current remote CI and final review remain pending. Existing CI failures have not been relabeled as baseline, and the prior axe setup failure did not execute accessibility lint. No Prettier, deployment, primary/master/PROD write or PR merge occurred.

最新 Save／驗證決定（2026-10-05）：API 保存期間不可修改值或關閉彈窗，取代先前保存期間保留新輸入的產品要求。Markdown 綁定 messageId＋完整 title，AI 原版保留供比較；每次成功 Save 更新人工 Markdown 與原有聊天文字，統一回傳最新成功保存版本，不建立新訊息／AI 輸出 generation。指定版本不同於目前人工版本（沒有人工版本則為 AI 版）才有可能衝突，後端按實際變更判斷並套用最新版。09 納入此修正，03／05 原有證據保留為歷史，更新後以代表性正常流程與聚焦測試驗證，不重複展開所有瀏覽器排列。

2026-10-05 加工材料對應補充：AI system_order 初次載入依備註的零件編號與同表唯一未刪除材料建立綁定及來源；不增加 Markdown 欄位，不按位置／品名猜配。沿用保存的人工作業及材料 selector 更正。09 驗證以正常產生的 A/B 零件確認初始加工綁定，取代先做人工 API 綁定的測試準備。
