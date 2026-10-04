# Steel source review ticket graph

Spec: https://github.com/spotifynetflixyu/LibreChat/issues/1

Integration branch: `codex/steel-source-review`.
Draft PR: https://github.com/spotifynetflixyu/LibreChat/pull/16.

User revision: every new AI output starts review from its own complete AI baseline; prior human
changes remain historical and are not carried into the new UI or compared with the new AI output.
Baseline: `056eb076ac0b9f7b7ccaba74672ae1288fab662a`.

| Slice | GitHub ticket | Direct blockers | Integration state |
| --- | --- | --- | --- |
| 01 | [Steel 表格唯讀入口與版本資格](https://github.com/spotifynetflixyu/LibreChat/issues/2) | None | Verified (`d58ce51bc`) |
| 02 | [多檔單頁原檔預覽](https://github.com/spotifynetflixyu/LibreChat/issues/3) | #2 | Verified (`c3bd8ad1c`) |
| 03 | [OCR 草稿、手動儲存與精準聊天更新](https://github.com/spotifynetflixyu/LibreChat/issues/4) | #2 | Verified (`1db96bd67`) |
| 04 | [單一來源 selector 與未定位列補標](https://github.com/spotifynetflixyu/LibreChat/issues/5) | #3, #4 | Verified (`65c9b2140`) |
| 05 | [OCR 列增刪與本次 undo／redo](https://github.com/spotifynetflixyu/LibreChat/issues/6) | #3, #4 | In progress |
| 06 | [System order 修正與內部報價原子同步](https://github.com/spotifynetflixyu/LibreChat/issues/7) | #4 | Pending |
| 07 | [材料與加工列綁定及整組增刪復原](https://github.com/spotifynetflixyu/LibreChat/issues/8) | #5, #7 | Pending |
| 08 | [材料單重與計價總數依賴重算](https://github.com/spotifynetflixyu/LibreChat/issues/9) | #7 | Pending |
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

Latest user preference: update related tickets first, then implement them sequentially. Human edits use explicit Save with unsaved-row caption; dirty close asks save/discard/continue. Save reuses backend field cleanup and atomically updates normalized DB/chat data. Slices01–04 are verified; OCR row ledger and session undo/redo05 now proceed in numerical order.

Slice02 evidence at `c3bd8ad1c74c03d2eab65a3ef0ba92db38bddbb3`: 17/17 authenticated Chrome cases against real Express and a disposable Mongo replica set, including multi-PDF/image pages, independent same-page rows, unlocated and out-of-range rows, zoom/pan/fullscreen, narrow light/dark layouts, menu-first Escape, retry, active owner and cross-chat/tenant identity guards. Focused real-Mongo/client/shared-dialog tests and owning workspace builds/typechecks passed; independent spec and standards reviews approved frozen feature head `b1818e418`. Scoped ESLint and diff checks passed. Slice03 now proceeds in the user-requested sequence; later slices remain pending.


Slice03 evidence at `1db96bd67f0af7c902c6c0d8556cb56f0d1dbe94`: 55/55 authenticated Chrome cases against real Express and a disposable Mongo replica set, with DB readback and chat reload. Saved clean values replace only the authorized messageId/table target; other same-title messages and unrelated content remain byte-for-byte unchanged. Covers normalization/no-op, prepared and confirmed captions, immutable receipts, failed/lost Save recovery, later drafts, dirty close, clean download, generic edit guards, and unavailable-source business saves while rejecting forged clearing of available sources. Controlled AI publication/manual Save race passed. Owning real-Mongo writer/source suites passed14/14; fresh shared/database/API builds and database/API noEmit passed. Client tree is unchanged from the already validated `99358fe30` client build/typecheck/focused UI and legacy route checks. Independent exact-head spec and standards reviews approved. Full-feature checks and Lighthouse remain in14; issues and draft PR remain open pending the final merge workflow.


Slice04 evidence at `65c9b2140c980c80b9797abc5909bbe5df65e072`: the separately merged integration tree exactly matches frozen actor `fbc1797ed674323a3130bde1aa29a28791c8ae50`. Root rebuilt all dependent workspaces and passed 77/77 authenticated Chrome cases against real Express and disposable Mongo, with DB readback and chat reload, plus the controlled AI/manual-save transaction race and all four owning workspace noEmit checks. Independent exact integrated-head spec and standards reviews approved. Focused suites passed database27/API30/provider10/client45; all 25 changed JS/TS paths passed scoped ESLint with Prettier disabled, imports and diff checks. Source corrections are local drafts until explicit Save, permit missing associations, use authorized single-file/single-page metadata and actual PDF/image page counts, preserve immutable AI and old receipts, and reserve lossless source codes without assigning unknown rows. Matching legacy proofs use the same full physical message hash for second-part tables; invalid proofs stay unlocated and business-saveable. Saved source mappings survive reopen, source-only edits do not stale quotations, and only the exact authorized message/table/part changes. Full-feature Lighthouse and final checks remain in14; issues and PR remain open/Draft.

Latest Save contract revision: the new UI submits only changed-row operations and a captured expected revision. The backend applies them to the latest saved effective Markdown while keeping the AI baseline immutable. Same-output nonconflicting row/field edits automatically merge, including another Save between prepare and commit; genuine conflicts preserve the draft, and new AI generations remain separate owners. Ticket05/GitHub#6 records the approved transaction-current merge and intent receipt contract. Slice05 is still In progress; this note records scope, not runtime verification.

Latest session-history revision: successful own Save confirmation clears undo/redo and the focus group; failed/unknown saves retain history. Later local inputs during Save remain unsaved drafts even when confirmation clears history. Server AI baselines, saved revisions and immutable receipts remain retained.

05 補充：R12 衝突恢復已獲獨立架構審核並更新 GitHub #6：同 owner 409 回傳最新版與全部衝突，檔案／頁碼 selector 警示，保留草稿並以下次指定最新版保存；同值自動消除。仍為 In progress，需真實 UI／API／Mongo／reload、精準鏡像與兩軸審查通過後才標 Verified。

Latest title contract: every Markdown has a unique full title within one reply. New review location is the authorized messageId plus exact full title, with backend-derived physical target and retained output/version authorization. All review entry points require title and changed-row operations; positional aliases, full-row submission and old wire/digest compatibility are removed at the user’s request. Slice05 incorporates this uniform protocol before release06; existing backend data and current-protocol receipts remain protected. GitHub #6 remains In progress until the title path and predecessor behavior pass real UI/API/Mongo/reload proof and independent reviews.
