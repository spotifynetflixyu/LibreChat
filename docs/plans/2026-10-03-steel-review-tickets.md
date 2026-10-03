# Steel source review ticket graph

Spec: https://github.com/spotifynetflixyu/LibreChat/issues/1

Integration branch: `codex/steel-source-review`.
Baseline: `056eb076ac0b9f7b7ccaba74672ae1288fab662a`.

| Slice | GitHub ticket | Direct blockers | Integration state |
| --- | --- | --- | --- |
| 01 | [Steel 表格唯讀入口與版本資格](https://github.com/spotifynetflixyu/LibreChat/issues/2) | None | In progress |
| 02 | [多檔單頁原檔預覽](https://github.com/spotifynetflixyu/LibreChat/issues/3) | #2 | Pending |
| 03 | [OCR 儲存格自動儲存與精準聊天更新](https://github.com/spotifynetflixyu/LibreChat/issues/4) | #2 | Pending |
| 04 | [單一來源 selector 與未定位列補標](https://github.com/spotifynetflixyu/LibreChat/issues/5) | #3, #4 | Pending |
| 05 | [OCR 列增刪與本次 undo／redo](https://github.com/spotifynetflixyu/LibreChat/issues/6) | #3, #4 | Pending |
| 06 | [System order 修正與客戶報價原子同步](https://github.com/spotifynetflixyu/LibreChat/issues/7) | #4 | Pending |
| 07 | [材料與加工列綁定及整組增刪復原](https://github.com/spotifynetflixyu/LibreChat/issues/8) | #5, #7 | Pending |
| 08 | [材料單重與計價總數依賴重算](https://github.com/spotifynetflixyu/LibreChat/issues/9) | #7 | Pending |
| 09 | [加工計量輸入與 save 前重算](https://github.com/spotifynetflixyu/LibreChat/issues/10) | #8, #9 | Pending |
| 10 | [材料 async selector 與精確 customer tier 價格](https://github.com/spotifynetflixyu/LibreChat/issues/11) | #9 | Pending |
| 11 | [加工 async selector 與材料適用性](https://github.com/spotifynetflixyu/LibreChat/issues/12) | #10, #11 | Pending |
| 12 | [AI 完整／更新基準與人工覆核合成](https://github.com/spotifynetflixyu/LibreChat/issues/13) | #6, #8, #11, #12 | Pending |
| 13 | [更新時間選 OCR 報價輸入與固定 resume](https://github.com/spotifynetflixyu/LibreChat/issues/14) | #4 | Pending |
| 14 | [聊天精準更新獨立審查與 UI／DB 整體验收](https://github.com/spotifynetflixyu/LibreChat/issues/15) | #13, #14 | Pending |

All issues use `ready-for-agent`; native GitHub blocking edges are verified.
The execution frontier advances after a blocker is verified and merged into the integration branch.
Issues remain open for the final PR's merge/closure workflow; implementation status is recorded here
so merging a ticket into the integration branch is not confused with production deployment or PR merge.

Ticket bodies are mirrored outside the repository under `/tmp/steel-source-review-tickets/`
for fresh implementer context; GitHub is the authoritative tracker.

