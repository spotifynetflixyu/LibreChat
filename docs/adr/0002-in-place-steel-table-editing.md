---
status: accepted
---

# 保留原版並直接更新聊天中的 Steel 表格

使用者在原檔對照介面編輯 OCR 或 system order 時，編輯先留草稿，按「儲存」才統一重算並寫入 DB，並直接更新聊天訊息中的文字 Markdown；不以新增聊天訊息代替修改原表。另行保留原版內容與累積差異，使目前資料與原始內容都可供對照。這是在保持歷史訊息完全不變與直接呈現可編輯結果之間的取捨：聊天表格必須反映編輯後的有效資料，而原版保留責任不能只依賴原聊天文字。

人工修正只允許同一聊天中各自最後輸出的 `ocr_result` 與 `system_order` 結果；舊版只供唯讀對照，不改寫舊版聊天文本。其他 Markdown 不提供本功能，customer_quote 只由其綁定的最後 system order 連動更新。後端在每次寫入時核對最後結果身分及版本，不能只依前端隱藏操作；新結果完成後，舊彈窗的待保存、重試與 undo／redo 均不能再改寫前版。

DB 分開保存 AI 最新完整 Markdown 與人工覆核結果；人工修正直接保存完整 Markdown 與聊天訊息；未來 AI 只輸出完整 Markdown。移除舊 cell comment 修訂入口、更新 rows、後端 delta merge 與補上完整表格流程。新 publication 混有舊 updates／revision／deletion control 區段亦拒絕，不能 fallback 至舊 merge；歷史資料保留唯讀，實際 OCR／報價 chunk 組裝維持。此決策取代先前支援 AI update rows 的規格。依使用者後續修正，每個新 AI 輸出從該次完整基準重新開始覆核，不帶入或比較過去人工修改，也不顯示過去人工刪除線；只有本版之後的人工修正才與本版 AI 比較。此決策取代先前「新 AI 保留過去人工修正供衝突覆核」。人工 UI 儲存不污染 AI 基準，歷史 AI 原版、人工完整結果、差異與時間仍留在原 owner 供唯讀。

兩份完整 OCR Markdown 分別保存成功更新時間；下次報價取更新時間較新的版本，人工時間嚴格大於 AI 時間才取人工，AI 較新或同時則取 AI。新 AI 完整輸出或介面比較不刷新人工時間；報價開始後固定所選版本供執行及 resume，不隨後續修改切換。

OCR 與 system order 各自更新所屬資料，system order 修改不反寫 OCR；customer_quote 則由最新 system order 自動重算並同步保存內部 DB 資料，後端不再產生或附加其聊天 Markdown。OCR 修改保留舊報價並標記過期，重新報價由使用者啟動。資料列來源檔案與頁碼允許缺值，不因缺少來源關聯阻擋編輯或儲存。

AI 原版與最新有效 Markdown 分開保存，對照彈窗取兩者以穩定列身分產生累積差異；刪除線只在彈窗，聊天 text／content 只顯示最新 clean Markdown，移除已刪除列。原版及彈窗比較與有效資料分開，已刪除列及刪除線舊值不得進入計算或後續 AI 的有效資料。save 前統一重算 system order 重量／計價總數，再沿用既有 customer_quote 計算，不重新查價。system order 包含材料與其明確綁定的加工列，不能只靠列位置保存材料加工關係。來源只標記單頁且可留空；版本衝突保留使用者尚未儲存的修改，核對最新版後再套用。

重算依修改欄位觸發，長度、寬度、厚度、單重與數量可觸發依賴更新。單重與總數允許手動修正；手動單重保留其值並重算總重，不因儲存覆蓋回推導值。材料與加工整組刪除及復原，加工來源跟隨所屬材料；後端只更新具有完整明確依據且能精確計算的鋼材相關欄位；缺少依據或不能處理時保留原值並允許保存，不猜值。所有業務欄位可人工修改，明確清空只清空該欄。

材料與加工 async selector 的候選價格只採該報價 customer tier 對應值。該 tier 缺價時仍可選取候選，單價與該列 customer_quote 小計留空，不 fallback 到其他 tier、不沿用舊單價或以 0 補值。後端核對客戶 tier 與候選；此決策限定人工 selector，不改既有 AI 查價流程。

更換材料候選時，既有加工列及其綁定、候選、計算輸入、總量與單價保留不動，不因本次更換自動刪除、重選、重驗或重算；材料本身與 customer_quote 依新候選更新。後續獨立修改數量、尺寸、加工輸入或綁定仍沿既定重算規則。

受管理表格下載前僅在有實際修正時先完成原有 save 與重算，再下載同 owner 後端確認的保存版本；失敗保留修改並停止下載。無修正或淨零不新增人工保存或時間，歷史唯讀只下載自身快照。

此決策記錄已確認的資料與呈現責任；具體歷程資料模型與寫入 API 仍屬技術提案。完整設計與驗收情境見[設計草案](../plans/2026-10-03-steel-source-comparison.md)。

原地更新的必要條件是後端核對 user／tenant／conversation／message／content part／table locator 與版本，只修改明確 target 範圍；其他聊天、訊息、表格及 target 以外內容完整保留。定位不唯一或版本失效時停止該次寫入，不依同名標題猜測替換；此路徑列為獨立程式審查與 DB 讀回驗收項目。

後續使用者改為手動儲存：草稿期間不寫 DB，儲存按鈕旁顯示未儲存淨列數。關閉前若有草稿詢問儲存／捨棄／繼續編輯；後端儲存沿既有欄位清理及重算責任，DB、指定聊天 Markdown 與回覆快照同成同敗。下載有修正時仍先完成保存。

最新標題標記決策：僅 ocr_result、system_order、customer_data 使用共享非互動 badge，提供 en Updated／Previous version、zh-Hant 已更新／歷史版本、zh-Hans 已更新／历史版本。非最新可信 owner 維持唯讀；DB 各 kind 最新完整 Markdown 所綁 messageId 與 output／table／generation／revision 決定資格，人工保存保持 messageId。新 AI 基準重設人工標記，報價時間選擇獨立。Customer_data 不新增編輯入口。此使用者明確要求允許兩個 badge key 的中文翻譯例外。

停止 customer_quote 的後端聊天輸出，涵蓋新串流、cached final、完成回覆與人工 Save 的衍生區段。既有重算、內部保存及 summary 總額仍保留，與 system_order 同交易；不再要求或插入 customer_quote 聊天 target，不猜測改寫歷史區段。

最新定位決策：同一回覆的每份 Markdown 具有唯一完整 title；新覆核直接以已授權 messageId ＋完整 title 定位，不以表格序號作為邏輯身分。同名 title 在其他 messageId 不受影響；後端仍核對聊天／user／tenant、latest output／generation、預期版本及精準 text／content mirror，並自行取得實際 part／offset。讀取不遷移或回填資料。所有覆核入口一律使用 messageId ＋完整 title，移除表格序號、caller partIndex／tableId alias 與舊整表提交的相容路徑；後端保存穩定列身分、原始 AI、人工結果及本協定的不可變收據。此決策取代先前保留新舊定位／提交入口相容性的提案，不放寬權限、最新輸出資格或精準更新指定訊息的限制。

最新 Save 簡化（2026-10-05）：API 執行期間禁止修改值及關閉彈窗。保留 AI 原 Markdown，每次 Save 更新既有人工完整 Markdown，並直接更新原 messageId＋title 的聊天文字；不新增 AI 訊息或輸出 generation。成功回覆、DB 及 UI 使用相同的最新成功保存 Markdown／版本。提交版本與目前人工版本（尚無人工時為 AI 版）不同時，由後端判斷實際衝突。驗證集中代表性正常流程與聚焦計算／API／DB 測試，取代保存期間新输入及重複瀏覽器排列的驗收。

2026-10-05：正常 AI system_order 的加工列初次依備註零件編號對應唯一材料，來源跟隨材料；保存後維持明確列身分與人工綁定，使用材料 selector 更正。計算候選依據僅屬內部 metadata，不新增 Markdown 欄位，也不因載入補充而計入未保存 rows。


## 2026-10-06 已確認 UI 契約（取代舊介面要求）

採固定上圖下表、單一可編輯表格、兩筆標準 row 高度與一行 sticky 欄名。移除 fullscreen、覆核 undo／redo 及彈窗下載功能／專用驗證；聊天下載沿原流程。新增項目統一空白 row，一般模式附目前來源頁，Unlinked／未綁定模式保持來源空白。未綁定清單依成功保存資料初始化，確認來源綁定、換預覽及切 checkbox 都不移除該 row，只有 Save 成功才刷新，失敗保留。來源確認採共用兩 selector 彈窗，預設當前預覽檔＋頁；加工不提供來源綁定 button，整組跟隨材料；材料刪除連同加工。Footer 只保留儲存／關閉與未儲存 caption。完整 title＋現有版本 badge 保留。

此節優先於上述 fullscreen、undo／redo、分開 located／unlocated 表格與彈窗下載的歷史規格；資料保存、AI 原版比較、授權、Save 鎖定、整組復原及聊天下載契約維持。詳見 [已確認 UI 方案](../plans/2026-10-06-steel-review-ui.md)。


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
