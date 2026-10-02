# Steel agent 下一步提示與 Markdown 保存計劃

## 已確認規格

- 只有一般 agent 本輪輸出具名資料區段時，後端才在回覆結尾補一次下一步；一般文字、粗體、清單與單獨 quote_signal 不觸發。
- OCR／報價 flow 的主、子 agent 都不補下一步。一般 agent 收到 flow 結果時也不能對 flow 結果補下一步。
- 本輪有 system_order 時不補下一步，保留目前自動生成 customer_quote／結論的邏輯；歷史 system_order 不影響本輪判斷。
- 依系統語系輸出中文或英文，machine title 不翻譯。
- 使用合併及保存成功後的資料判斷提示；失敗、取消、未完成或等待核准的回覆不得補成功導向提示。
- ocr_result 與 customer_data 都先完成本輪的有效資料保存，再重新讀取 DB 的最新資料判斷下一步；不得使用 AI 開始回覆前的 state 或 hasOcrResult／hasCustomerData 快照作補文判斷。
- 客戶名稱須呼叫查詢工具；用戶明確指定 A～F（大小寫皆可）可直接選級。首次或變更都輸出完整 customer_data，不使用 customer_data_updates。
- 本輪輸出 customer_data、ocr_result、ocr_result_updates 或 system_order_updates 時，不同輪發出 quote_signal。即使同時要求報價，也先呈現並保存資料，下一輪確認後才開始 flow。
- 報價與 Quote（大小寫皆可）代表相同開始意圖，但仍須符合目前訂單、客戶及確認要求。
- 已保存訂單的修正輸出 ocr_result_updates；後端合併為完整 ocr_result 並保存。
- 已保存報價訂單的修正輸出 system_order_updates；後端合併為完整 system_order 並保存，保留未修改列，重建衍生 customer_quote。不得覆寫不可變的 flow artifact 或假稱重新查價。
- AI rules 只包含 AI 可見輸入、判斷、工具使用及輸出契約，不寫後端 merge／DB／UI 執行細節。

## 提示文字

| 保存後狀態 | 中文 | English |
| --- | --- | --- |
| 無有效 ocr_result | 下一步：請先提供材料訂單。 | Next step: Please provide a material order first. |
| 有 ocr_result，無有效客戶等級 | 下一步：1. 請確認訂單中的材料資料。2. 請提供客戶名稱以確認客戶等級，或回覆「使用預設 B 級進行報價」。 | Next steps: 1. Confirm the material details in the order. 2. Provide the customer name to determine the customer tier, or reply “Use default Tier B for the quote”. |
| 有 ocr_result，有有效客戶等級 | 下一步：已收到材料訂單與客戶等級，請確認資料後回覆「報價」。 | Next step: The material order and customer tier are available. Please confirm the details, then reply “Quote”. |

## 實作安排

1. 在 packages/api 增加共用、可測試的補文與回覆完成服務；legacy api 僅接線。沿用系統語系來源（lang cookie／Accept-Language，無值時英文），並使用既有 request scope／已載入資料。
2. 擴充直接選級的可信驗證：只接受目前用戶明確指定的 A～F，不接受 AI 任意生成客戶身分或級別；客戶名稱路徑仍比對工具保存的資料。保存完整 customer_data，阻止同輪 customer_data＋signal。
3. 保留已存在的 OCR 合併與保存機制，驗證對話完成及 Responses 路徑都寫入完整資料。
4. 實作 system_order 修正：AI 輸入提供完整表與 `system_order_revision` 的 `base_hash`、`row_index` 對照。AI 輸出 `system_order_updates`，欄位依序是 `base_hash`、`row_index` 與全部原欄位；只更新既有列，省略表示未變更，空白表示清空。新增／刪除材料須修正 OCR 再重新確認報價。以具 user／tenant／conversation scope、active run 與快照 hash 的 CAS 保存完整修正，不修改既有不可變報價 artifact；下輪提供目前快照作修正輸入。無底稿、重複／越界列、版本過期、未完成 flow 或格式錯誤時保留原資料並拒絕保存。數量／尺寸／單重變更須更新總數的要求放在 AI rules；後端逐列清理數字與度量欄位，換算 mm 後四捨五入。鐵板／方鐵使用已選候選的實際 density 與原始尺寸計重，型鋼使用候選單重與長度換算，衍生客戶報價由完整新表重建。
5. 對齊 docs/rules/agent規則.txt、輸出規則及 runtime preparation instruction；指定級別完整表、Quote 別名及下一輪確認要求一致。
6. 聚焦測試、typecheck、build、scoped import sorter、diff check，獨立審查資料完整性／相容性及回覆 transport。需要時執行專案 lighthouse。
7. DEV rules 使用 sync-steel-rules.cjs 明確 --target dev dry-run／apply／readback。PROD 同步及部署不包含在本次範圍。

## 驗收

- 一般 agent／flow、當輪有／無具名資料、當輪 system_order、中／英文、三種保存狀態均符合提示條件，重試不重複補文。
- A～F 完整表保存、客戶工具結果保存，以及 customer_data＋signal 同輪拒絕，皆以真實資料模型測試。
- OCR updates 及 system_order updates 合併後讀回完整新版本；失敗不覆寫、並行過期版本不覆寫。
- 修正後的完整 system_order 與 customer_quote 同步，flow artifact 原內容保留。
- 規則解析／同步讀回完成；報告實際完成的 checks 和未能執行的 live 驗證。

## 狀態

- 依 2026-10-02 最新指示，修正行為以 AI rules 表達；後端採逐列數字清理、度量四捨五入與有可信候選資料時的重量重算，這些處理不要求 AI 重新輸出。
- 補文使用合併／保存後狀態，排除 flow、未完成回覆及本輪 system_order。Steel 保存失敗發出安全的失敗事件，一般文字回覆沿用原本的保存失敗行為。此次未加入串流緩衝或跨資料保存提交的新流程。
- 目前報價須對應已接受的訂單 hash，以及目前客戶身分與完整 customer_data；訂單或客戶／等級變更後保留舊報價，但不提供舊版 system_order_revision。修正 CAS 同時核對訂單、客戶、run 與報價快照，容量檢查在寫入前執行。
- 保留原有唯一索引；具 tenant 的已授權 user／conversation 可以延續舊 tenantless 資料，明確的其他 tenant 仍無法存取。未增加索引遷移。
- 最新聚焦驗證：packages/api 15 套、386 個測試通過；legacy controllers 3 套、267 個測試通過。涵蓋真實 Mongo 保存／讀回、修正競態、失敗不覆寫、客戶與訂單變更生命週期，以及多段串流事件。
- packages/api 與 packages/data-schemas typecheck、相關 build、scoped import sorting、git diff --check 通過。未執行格式自動改寫；不含 formatter 的 ESLint 與 HEAD 比較沒有新增診斷，仍有 6 個既有診斷。完整 static-checks 的格式／既有診斷 gate 尚未全綠。
- Lighthouse 使用本機 Chrome 通過：LCP 中位數約 3.92 秒，門檻 4.5 秒。
- DEV rules 已完成 dry-run／apply／readback：21 筆皆 active=true、review_state=reviewed，SHA256 全部符合本地 manifest，無過期 managed rows。
- system_order_updates 目前只修正既有列；材料新增／刪除走 OCR 修正後重新確認報價。尚未執行真實模型對話驗收；本次部署依最新發佈授權執行。
- 舊 state 排查：未重現「本輪已保存 OCR／客戶資料卻因舊 state 漏補文」的問題。新增真實 Mongo 保存／讀回回歸測試，涵蓋起始 state 無 OCR、起始 state 無客戶且本輪選擇 A～F、客戶工具查詢後保存。補文相關 3 套、33 個測試及 packages/api typecheck 通過；未修改執行邏輯。

- 發佈範圍已由用戶授權：提交所有變更、推送目前分支及 master，觸發 PROD 部署，另同步 DEV／PROD Steel rules。部署與 DB readback 結果另見本次執行紀錄。
