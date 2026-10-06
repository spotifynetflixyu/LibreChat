# Steel review UI 調整方案 — 2026-10-06

狀態：使用者已確認方案，授權先記錄／同步相關未完成 GitHub issues，再實作。整合分支 `codex/steel-source-review`；相關規格 #1、整體驗收 #15。此次只完成 UI 調整，不接續 #14 的 OCR 時間選擇／resume，也不將整體驗收宣稱完成。

## 已確認介面

1. 彈窗固定上圖下表，移除 expand／collapse。上方維持授權來源檔／頁碼選擇、PDF 單頁／image 預覽與平移；縮小、放大、Fit 圖示固定預覽區右下角。Fit 將整頁／整圖置中完整呈現。
2. 下方只有一張可編輯表格與一行 sticky 欄位名稱，固定保留欄名＋兩筆標準 row 的高度；更多 rows 於此區內捲動，寬表保留橫向捲動。表格捲動不推走原檔預覽、標題或底部操作。
3. 表格上方顯示當前完整 Markdown title（ocr_result／system_order）及既有版本 badge，同列最右側 checkbox `Unlinked`／`未綁定`，預設不勾選。版本沿用每個 AI 輸出原版無 suffix、成功人工 Save 次數＋1 的 v2／v3 規則，歷史唯讀。
4. 未勾選：顯示綁定目前預覽檔＋頁的 rows，切檔／頁同步切換 rows。勾選：只顯示成功保存資料中未綁完整檔＋頁的 rows，以及本次新增未綁定 rows；切檔／頁只換預覽，供使用者確認要綁在哪裡。
5. 未綁定清單的既有 row membership 保留至 Save 成功。綁定彈窗確認只更新草稿與按鈕為「已綁定」，該 row 不消失；改預覽、反覆切 checkbox 不提早刷新 membership。Save 成功後使用後端確認的保存資料刷新；失敗／衝突／未知結果保留草稿和清單。新 owner／重新明確開啟使用該次資料初始化。
6. 統一 `Add item`／`新增項目` button，新增一筆業務欄位空白 row 並捲到／聚焦新列。一般模式附目前預覽檔＋頁，未綁定模式來源留空；system_order 先為未分類，列內明確選擇材料／加工種類，所屬材料由備註失焦後的零件編號同組判斷，不按業務類別猜測。
7. 最左 `Action` 欄提供「綁定／已綁定」與「刪除」。OCR／非加工 row 可開啟共用綁定彈窗；加工 row 不提供來源綁定 button，來源始終跟隨所屬材料，材料更換來源整組連動。
8. 共用綁定彈窗含來源檔＋頁碼兩個 menu selectors，以及確認／取消。包括已綁定 row，開啟都預設上方目前預覽檔＋頁；圖片固定第 1 頁。選項只來自授權既有來源，換檔重設合法頁碼；確認才改主草稿，取消／Esc／叉只捨棄彈窗暫選。載入／失敗／重試可觀察，沒有合法頁碼不能確認完整綁定。
9. 刪除材料 row 使用既有整組刪除，所屬加工一同標記刪除；其他 row 單列刪除。刪除／差異只在草稿與 AI 對照顯示，正式保存仍按 Save；沿用既有 row 復原與 AI 原版比較。
10. 底部僅儲存、關閉。有未儲存淨變更時顯示列數 caption，保留既有保存／錯誤／衝突／關閉確認體驗。移除彈窗下載 button 與其專用功能；聊天表格既有下載流程不在此次移除範圍。
11. 完整移除此次覆核 undo／redo button、操作、專用 snapshot history／grouping 與專用開發驗證，保留 Save／CAS／receipt／衝突／dirty tracking 所需版本資訊。移除 fullscreen 的功能與專用驗證，不只隱藏圖示。
12. 沿用 LibreChat 共用 primitives、語意 theme、Jotai、鍵盤／ARIA／light-dark／reduced-motion。依使用者指定文字提供此次所需 EN 與中文翻譯，不擴張其他翻譯範圍，不增加 library。

## 聚焦驗收

- [ ] 固定預覽＋兩列高度表格；一行 sticky 欄名；只有新增項目，無 undo／redo／expand／collapse／彈窗下載。
- [ ] PDF／image Fit、zoom、pan 與右下固定 controls，來源／頁碼切換正常。
- [ ] 一般／未綁定模式新增空白 row 正確，列內分類與備註失焦分組正確。
- [ ] Bind／Bound 彈窗預設目前預覽，取消不改草稿，確認留在未綁定清單；切來源／頁／checkbox 不提早消失。
- [ ] 真實 Save 成功刷新未綁定清單，失敗保留；DB／聊天／reload 與保存資料一致。
- [ ] 加工無來源綁定 button，材料來源與整組刪除連動加工；AI 原版差異与唯讀資格保留。
- [ ] Footer Save＋Close 與未儲存 caption，既有保存鎖定／關閉確認／候選快取行為保留。

驗證採相關 focused tests、client noEmit、必要 private build、scoped imports／lint、diff check、代表性真實 browser/API/Mongo Save／reload 與實際截圖；不展開非正常資料修復或所有瀏覽器排列。整體 #15 及其 #14 blocker 維持未完成。

## 實作狀態邊界（Advisor v2 已通過）

- 未綁定 membership 是成功採用的 committed base 中穩定 row IDs，加上本次新增未綁定 row IDs；草稿綁定及 checkbox／preview 切換不重設。只在成功保存（含 receipt 確認成功）、新 owner 或明確重新開啟時依新 base 初始化。一般 query refetch、失敗／衝突／不確定 receipt 不刷新。
- 加工顯示與來源篩選始終使用其所屬材料的 effective source；沒有獨立來源綁定操作。整組刪除保持既有 AI tombstone／復原比較；新增後又刪除、沒有 AI 基準的 row 可消除淨變更。
- 鍵盤可操作 checkbox、preview controls、scroll table 與兩個 selectors；預覽區提供可聚焦、有標籤的平移操作；新增 row 聚焦第一個可輸入欄位；綁定子彈窗 Esc／取消只關子彈窗並還原焦點。
- 執行順序：確認方案記錄、GitHub #1／#15 readback 已完成 → UI 實作 → 聚焦驗證／獨立審查 → 更新 UI 驗證證據；整體 #15 的未完成狀態不因本次 UI 完成而更改。


## 2026-10-06 使用者確認：備註零件編號分組

這段取代材料 selector／手動 parent 綁定規則。新增項目直接新增一列業務欄位空白 row，不先選新增材料或加工；row 內種類選為材料／加工後，system order 的材料與加工只以備註填入的完整零件編號判斷同組。沿用 trim 後完整相同的編號匹配，唯一未刪除材料為該組材料；加工自動跟隨材料來源檔＋頁，排到該材料下方，同組加工維持穩定順序。空白／沒有對應材料／不能唯一確定時保持未綁定，不猜選材料。更改備註即更新草稿分組與排列，按 Save 才保存。取消人工材料 parent selector；來源綁定彈窗仍適用於材料的來源檔＋頁。Unlinked 成員仍只有成功 Save 才刷新，確認分組不讓清單的 row 立即消失。

- [ ] 新增項目一按就出現空白 row，沒有材料／加工前置選單。
- [ ] 備註相同零件編號自動分組，改編號更新綁定／来源／排序，沒有人工材料 parent selector。
- [ ] UI、Save、Markdown、DB readback 和 reload 保持相同分組／排列與 cascade 刪除。

新增項目 button 位於 Markdown title 同行的最右方、Unlinked checkbox 左邊。

分組判斷限定 system order：備註 input 失去焦點（或 Enter 完成輸入）才更新綁定與排序，輸入期間不移動列；材料優先、加工跟隨材料。OCR result 備註維持原有即時草稿編輯，不執行分組。

模組維護：下方表格共用 Editor／Input／Action UI；ocr.ts 負責 OCR 編輯策略，system.ts 負責 system order 的 selector／分類策略、備註失焦判斷、同組來源與材料優先排序及加工計量。mode.ts 為共用 UI 的模式介面，session.ts 保持草稿／操作保存的共通責任。

OCR result 也提供新增項目、Action 綁定／已綁定與刪除。共用的是表格、輸入框與操作 UI；欄名、欄位順序及編輯策略各自使用該 OCR result／system order 表格的 headers，不能統一成相同欄位。

OCR 欄位契約補充：AI 至少固定輸出類別、品名規格、零件編號、來源、頁碼，另依來源資料彈性提供其他欄位。UI 與新增空白列沿用該次 OCR headers；OCR 類別也使用共用 menu selector，保留目前／AI 值與空值選项。OCR 不執行 system order 備註分組。

AI 規則核對：OCR主Agent整理規則 final_ocr_markdown 已固定要求類別、品名規格、零件編號、來源，以及厚度、長度、寬度、數量、加工、備註；工作流程要求每列保留頁碼。此次把頁碼補入同一份固定欄位清單，與既有逐列頁碼要求一致；UI 保留實際所有固定與彈性欄位，不裁成只剩五欄。此為 repository 規則文字一致性修正，未同步 DEV／PROD DB 規則。

## 已取得的聚焦驗證證據

client focused 109 passed、2 個先前停用案例 skipped；provider review 51、API review 37 passed。三個代表性 Chrome→Express→disposable Mongo 流程通過，完整 AI 固定欄位 OCR 額外重驗 1 passed；包含真實 Save／readback／reload、Unlinked 綁定後保留至 Save、分類及 Notes 同組來源與 cascade 刪除。型別、私有 builds、semantic lint／imports／JSON／diff 檢查通過；Prettier 未執行。獨立初審的 Notes Esc 保留草稿及完整標題換行 finding 已修正。此段只記錄以上已跑驗證；最新 OCR fixture 已改走正常完整回覆 admission／publication，來源 mapping、真實最新版本 badge 與完整固定欄位瀏覽器重驗 1 passed（28.7s）；先前 fixture import／缺 mapping 失敗已修正。最終固定 commit 審查及 GitHub readback 另記錄於相關 issue／PR completion evidence。

Lighthouse 隔離載入 gate 已通過：三次 cold navigation median LCP 3793.685 ms（limit 4500）、CLS 0.0168823（limit 0.1）、TBT 51.531 ms（limit 500）。此為此次必要載入 gate，不代表整體 #15 完成。


Static checks 使用實際 base `origin/feat/v8.8`（此 repo 沒有 origin/dev）。初次 gate 發現 baseline 已存在的 `completion.ts → full.ts → completion.ts` cycle；使用者追加要求一併修正。共用 completion 型別移至既有 markdown/types.ts，completion 保留原公開 type re-exports，full 不再回頭引用 completion；發布流程沒有改動。9 個 real-Mongo completion／publication tests 通過，最終 owning 型別／build／static 與 exact-head 審查證據記錄於 GitHub。整體 #14／#15 仍 pending，PR16 保持 Draft／OPEN；此批完成後暫停。


## 2026-10-06 後續視覺調整

來源／刪除改為共享 Button icon-sm＋TooltipAnchor；英文字組統一 Link／Linked／Unlinked，中文維持綁定／已綁定／未綁定。Linked／未綁定共用完整 chain，以 Linked 中性實色底／未綁定透明底區分；trash 圖示保留 localized tooltip 與含 rowId 的 accessible name，原 callbacks 與加工來源限制不變。新增改為 Add row／新增列，標題右側 checkbox 在 button 左邊，Add row 最右。Footer Close 使用中性 outline、在最左；Save 使用共享主色 submit、在最右，caption 與保存狀態位於 Save 左邊。

Checkbox 最新文案：View unlinked／顯示未綁定（简体：显示未绑定）。仍只篩選未綁完整來源檔＋頁的保存成員，行為不變。

Delete 預設維持中性，hover 使用共享 danger 文字、邊框與淡色背景 semantic roles。

本次視覺調整驗證：client 兩個聚焦 suites 54 passed、2 先前 skipped；fresh client noEmit／private build、scoped semantic lint（Prettier off）／imports／JSON／diff 通過。三個正常 Chrome→Express→disposable Mongo 流程 3 passed（47.1s），包含 OCR 完整欄位、System 同 chain 的實色／透明底、Delete danger hover、滑鼠與鍵盤 tooltip、未保存 Close 確認／繼續編輯保留草稿、真實 Save／readback／reload、Add row／Notes／cascade；已擷取 OCR、System、Delete hover、Close 未保存確認画面。Tooltip hover 的初始測試因表格自動捲動重置 Ariakit mouse intent 未展開，改以正常捲動後的持續滑鼠移動，產品共用 tooltip 無需修改。此前 e77fe128e 的獨立審查屬上一版；本次小幅視覺變更由 root 聚焦核驗，不宣稱舊審查涵蓋新 head。

最新配色修正：只有 Save 使用 primary（submit）；Linked 改為共享 Button default 的中性實色底（surface-inverted／text-inverted），未綁定維持透明 outline，Delete hover 的 danger 行為不變。

中性 Linked 配色修正驗證：Editor 9 passed、正常綁定／Save／reload Chrome 流程 1 passed（34.1s），client noEmit／private build 與 scoped semantic lint／diff 通過；已確認實際畫面為 Linked 中性深色底、未綁定透明底，Save 保留 primary。

型號／品名規格 async selector 移除箭頭 icon：使用共享 ControlCombobox 的既有 showCarat=false，保留點擊開選單、搜尋、鍵盤／滾輪與候選快取行為。

無箭頭修正驗證：既有 Selector 聚焦 6 passed，client noEmit、scoped semantic lint（Prettier off）／imports／diff 通過。只調整既有共享元件顯示選項，不新增搜尋或狀態流程。
