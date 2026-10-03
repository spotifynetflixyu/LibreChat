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
| 02 | [多檔單頁原檔預覽](https://github.com/spotifynetflixyu/LibreChat/issues/3) | #2 | In progress |
| 03 | [OCR 儲存格自動儲存與精準聊天更新](https://github.com/spotifynetflixyu/LibreChat/issues/4) | #2 | In progress |
| 04 | [單一來源 selector 與未定位列補標](https://github.com/spotifynetflixyu/LibreChat/issues/5) | #3, #4 | Pending |
| 05 | [OCR 列增刪與本次 undo／redo](https://github.com/spotifynetflixyu/LibreChat/issues/6) | #3, #4 | Pending |
| 06 | [System order 修正與客戶報價原子同步](https://github.com/spotifynetflixyu/LibreChat/issues/7) | #4 | Pending |
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
