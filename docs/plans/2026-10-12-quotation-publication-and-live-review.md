# 報價完成、即時校對與主 Agent 總結開發規格

日期：2026-10-12

狀態：開發規格；實作與驗證須以本文為準，不代表已部署。

## 目標與完成定義

`system_order` 由後端組裝。後端先完成清理、欄位排序、OCR 校對 metadata 綁定、最新版指標及 DB 保存，標記該次報價為 **completed**，才一次推送完整表格與 metadata 到前端。

流程保持單向：**後端完成並保存 → 推送正式表格並顯示報價完成 → 主 Agent 補總結**。競態處理只保留必要的版本檢查與寫入邊界，不新增額外的報價狀態或總結重試流程。

主 Agent 接收由 DB 已保存的子報價 `system_order` chunk Markdown 統整而成的原組裝報價，繼續回應總結／校對說明。其回應完成、失敗或被使用者暫停，均不得改變報價完成狀態，也不得覆蓋前端正式 `system_order` 或要求重試報價。

本文取代 [原報價流程規格](2026-09-17-quotation-preflight.md) 及 [報價 ADR](../adr/0001-independent-resumable-quotation.md) 中等待主 Agent 回應後才完成報價、完成後替換整份表格，以及總結失敗後恢復報價的規定。實作時須一併清除互相衝突的舊分支、測試及文件。

## 一、後端組裝與發布 `system_order`

### 組裝契約

1. 後端從該 run 在 DB 已保存、驗證完整的各子報價 `system_order` chunk Markdown，依原訂單項次順序統整完整 `system_order`，保留材料列、加工列及其來源關係。恢復執行時沿用同一批已保存的 chunk，不要求子 Agent 重新產生內容。
2. 沿用既有數值清理規則。例如單價 `99 元` 清為 `99`，計價基準 A/a 至 F/f 對應 1 至 6；不改動原始 OCR 內容。
3. 前端正式發布表格將 `備註` 值改為 `零件編號`，不保留獨立 `零件編號` 欄位。原備註、獨立零件編號及加工資訊須保留於 DB 的原始 chunk 與給主 Agent 的原組裝 Markdown，不以顯示表覆寫它們。
4. 將欄位排成下列固定順序：

   `型號、品名規格、材質編號、單價、數量、總數、厚度、寬度、長度、肚、單位、類別、單重、計價基準、公式編號、備註`。

5. 綁定該次報價實際使用的 OCR 版本、來源列及檔案／頁面校對 metadata，並保存適用的計算依據。來源需通過既有使用者、conversation、tenant 及檔案權限檢查。

完整表格表示欄位與應保留的列已完成組裝，不表示每個價格欄位都必須有值。依既有規則保留的空白價格與待人工校對事項，不得被刪列或偽造數值。

### 發布契約

- 表格、不可變的 AI baseline、OCR metadata、校對 output、最新版指標及報價 completed 狀態，須以一致的持久化邊界保存。
- 成功保存後才把正式 `system_order` 推送到前端，接著才開始主 Agent 的總結回應。前端第一次取得正式表格時，就必須能使用其校對 metadata。
- 已保存表格使用獨立的後端發布／更新事件，與主 Agent 的文字串流分開。不得把 `system_order` Markdown 塞進 `onTextDelta`、主 Agent 累積文字或其串流快照。
- 獨立 `steel_message_update` 事件帶入正式 DB 訊息、發布收據、run／output／訊息身分及表格／總結／結尾的 content slot。事件須經現有 conversation／job 權限與 generation 檢查，保存後可重播；通知失敗只記錄錯誤，報價維持 completed，重連從 DB 完成證明取得最新版。
- 前端以發布收據及校對有效版本合併事件，重複或較舊事件不更新。延遲抵達的初始版本不得覆蓋人工 `vN`；事件在串流工作訊息初始化前到達，也必須保留在訊息快取並於初始化時沿用。
- 初始 AI 表格為 `v1`；重新生成的報價有新的 output／run 身分，舊 output 成為歷史版本，新 output 標記為最新版。
- 保存失敗時，不得宣告 completed、發布未保存的正式表格或開始主 Agent 總結。
- 相同發布的重送、重連及重放須冪等，不得新增重複表格、版本或最新版指標。

## 二、主 Agent 回應期間支援即時人工校對

### 使用者操作

- 正式表格發布後，既有 Markdown 校對 icon button 就可開啟彈窗，不需等主 Agent 回應完成。
- 使用者可在主 Agent 串流回應期間校對 `system_order` 數值，沿用既有校對、計算及來源檢視能力。
- 每次成功保存人工校對，依既有版本機制產生 `v2`、`v3` 等 `vN`，並將新版本標記為最新版。
- 保存成功時，同步更新 DB 的 effective 表格、對應校對 metadata、chat Markdown 文字與結構化訊息中的表格內容。
- 重新整理或重連後，仍讀到最新版與相同的 OCR 來源綁定、人工修改及歷史版本。

### 一致性與競爭處理

- AI baseline 保持不可變；人工校對更新 effective 版本及保存收據。
- 以版本／收據與 output 身分檢查競爭保存。較舊的保存不得覆蓋較新的 `vN`；失敗保存不得推進版本或回復舊表格。
- OCR 與來源 metadata 不因人工修改報價數值而被換成其他來源。既有欄位計算、校對限制與來源權限仍須成立。
- 後續 AI 串流、訊息合併、terminal completion 及恢復事件，只能更新主 Agent 的文字區域；不得用其工作中訊息快照覆蓋 DB 或畫面中的最新版表格。
- 主 Agent 開始總結後，不得重新初始化表格的校對 output、AI baseline、人工收據或版本編號。

## 三、主 Agent 的完成、error 與暫停

### 職責與狀態

主 Agent 使用後端統整的原組裝 `system_order` Markdown 補充總結／校對說明。這一段回應與報價完成狀態分開處理。

### 主 Agent 輸入來源

- 原組裝 Markdown 的資料來源是該 run 在 DB 已保存的所有報價子 Agent `system_order` chunk Markdown；目前 chunk 區段名稱為 `system_order_chunk`。統整後保留 17 欄的獨立 `零件編號` 及原 `備註`，不能從已替換備註的前端 16 欄表反推。
- 目前主 Agent 實際 JSON 輸入的 `review_remarks` 承載上述原組裝 17 欄 Markdown，`system_order` 承載清理排序後的正式 16 欄 Markdown。兩者均是後端提供的輸入，不是要求主 Agent 重建表格；原組裝 Markdown 必須完整可用於總結，不只提供備註摘要。
- 原始 chunk、原組裝 Markdown、正式顯示表及後續人工 `vN` 有不同用途。顯示值清理、零件編號移入備註、人工校對及 AI 總結，均不得回寫或取代 DB 原始 chunk。
- 主 Agent 回應與串流只包含總結／校對說明，不能輸出、發布或覆寫 `system_order` 表格。

| 時機 | 報價狀態 | `system_order` 與人工校對 | 主 Agent 回應 |
| --- | --- | --- | --- |
| 子報價或後端組裝尚未完成 | 未完成 | 尚無此次正式完成表格 | 尚未開始總結 |
| 後端正式發布成功 | completed | 已保存、最新版、可立即校對 | 可以開始總結 |
| 主 Agent 正在回應 | completed | 可保存新的 `vN` | 串流總結文字 |
| 主 Agent 正常結束 | completed | 保留當下最新版 | 保存／補上總結文字 |
| 主 Agent error | completed | 保留當下最新版與人工修改 | 記錄該回應錯誤；保留已保存文字 |
| 使用者在主 Agent 回應期間按暫停 | completed | 保留當下最新版與人工修改 | 停止後續總結文字 |
| 重新整理、重連或重放 completed 報價 | completed | 載入當下最新版 | 不重新啟動報價 |

### 寫入邊界

- 主 Agent 正常結束時，只保存／追加其總結內容，不重新發布 `system_order`，不以 AI 表格重建訊息，也不把人工 effective 表格替換回 AI baseline。
- 主 Agent 整理結尾後，後端自動補上既有完成摘要／項次核對，保存在獨立的總結區域。這是已完成報價的結尾補充，不是報價的完成條件，也不得改動表格。
- 追加總結需綁定原 conversation、回應及 output 身分，保留該訊息在保存當下的表格版本。過期回應不得寫入新的報價 output 或其他訊息。
- 文字與結構化 content 必須一致；不得重複追加總結，也不得因合併多個 text part 而重複表格或丟失其他內容。
- 主 Agent error 不得執行「error 後補存完整表格」：表格在開始總結前就已正式保存。
- 主 Agent error／暫停不得把 run 改為 interrupted／cancelled，不得顯示此次報價需要重試，不得重跑子報價、查價、組裝或計算。
- 報價尚未完成時的失敗、暫停與取消，仍按未完成報價的恢復及取消契約處理。須以正式發布的持久化結果區分兩個階段。
- 未完成報價續跑時，只在成功取得執行 lease 後綁定當次回應的 publication admission；忙碌中的重複請求與 completed 重放不得更換原發布身分。續跑仍讀取 DB 保存的 chunks，正式訊息目標與當次回應來源分別綁定。

## 錯誤日誌

直接使用既有 logger，在錯誤處理位置記錄下列資訊：

- `conversationId`：發生錯誤的 conversation。
- `responseId`：發生錯誤的回應。
- `code`：實際錯誤碼；上游沒有提供時明確表示未提供，不虛構細分類型。
- `message`：錯誤內容，沿用必要的長度限制及敏感資訊遮蔽。

不新增 `createQuotationFailureReporter`、錯誤 type 分類樹或詳細階段追蹤框架。不記錄金鑰、完整請求／回應物件或原始 stack；日誌失敗不得取代原本的業務錯誤。主 Agent error 的日誌屬於該回應，不得據此將已完成的報價改回失敗。

## 保存與競爭邊界

- 初始發布的單一 transaction 完成訊息、校對 baseline、metadata、latest owner、發布收據與 `activeRun.status = completed` 的寫入，並清除報價租約。不得先設 completed 再另行補存表格。
- 以同一個已發布證明判斷完成後的載入、校對、新報價 admission、歷史、取消及到期清理。證明需驗證 scoped 收據、checkpoint 與不可變表格 artifact；單獨的 completed 狀態不足以證明已發布。
- 開始總結後停止報價 heartbeat，不再使用報價 lease／未完成 run 的 `assertActive`。總結由當次 request 的暫停信號及原回應／output 身分控制。
- 總結的外層 error／暫停處理，先核對持久化的完成證明；完成後不得進入 `interruptRun`、報價恢復或舊版 final publication。
- 初始發布固定表格的 content slot／收據綁定身分，主 Agent 文字與後端結尾使用獨立的總結 slot。追加 transaction 讀取當下的訊息，完整保留該表格 slot、所有非文字 content 與最新人工 owner／metadata。競爭重試時需重讀，不能以主 Agent 開始時的 effective hash／人工 revision 限制合法的新 `vN`。
- 總結收據綁定 scope、runId、targetMessageId、原 responseId／generation 與允許總結內容的 digest；重送同一內容冪等。總結內容不得包含 `system_order`、`customer_quote`、報價控制或信號區段。
- 舊版 final＋published 收據仍可驗證及讀取。新的表格發布收據不得回落到舊 final publisher，也不得因輸入 snapshot 到期而把已完成報價改成 cancelled。到期清理只按已發布證明處理可清除的輸入，保留完成與歷史所有權。
- 前端 delta、terminal、error 及 resume／SYNC 都採同一個校對版本合併邊界，將最新訊息快取與人工 owner 同步到串流工作快照。更新總結文字時保留新版表格，不能只靠最後一次 DB 載入修復。
- 所有帶有 Steel quotation scope 的 terminal 回應（包含一般文字、Stop、preempt、step-limit）都由既有 finalizer 保存。通用 BaseClient 不得先寫入工作快照；finalizer 先採用已發布的 DB 訊息，再處理未完成回應，沿用既有 terminal claim 與 generation 檢查。
- 表格發布事件只更新表格及其 owner／metadata；AI 串流及 terminal 快照只更新主 Agent 文字；後端結尾只更新結尾區域。三者在同一則回應中有固定、分開的 slot，不能互相替換。

## 舊流程清理範圍

| 舊行為 | 必須改成的行為 |
| --- | --- |
| 等主 Agent 回應完成才存表格／標記完成 | 後端組裝、校對綁定與正式發布成功即 completed |
| 主 Agent 結束時重新組合／覆蓋 `system_order` | 只處理總結區域，保留當下最新版表格 |
| error 時才把完整表格發布為最新版 | 開始總結前已完成正式發布 |
| 主 Agent error／暫停後 interrupted、顯示重試報價 | 報價維持 completed，僅結束總結回應 |
| 回應完成後才允許校對，或重建校對 metadata | 表格正式發布時即可校對，之後持續保留版本與 metadata |
| 用舊串流快照整份替換 chat 訊息 | 總結文字與最新版表格各自保持正確的更新邊界 |
| 將後端表格當作主 Agent 的文字 delta | 表格走已保存結果的獨立發布事件，AI 串流只含整理結尾文字 |
| terminal 的晚發布 writer、adopted-publication Map、獨立 completeRun／markPublished writer、AI 表格修訂服務 | 移除；只保留原子初始發布、獨立總結追加及舊資料唯讀證明 |
| 多層 quotation error reporter／type 分類 | 既有 logger 直接記錄四項必要資訊 |

執行清理時需核對 runner、publication／terminal completion、狀態與發布證明、校對 read/write、chat 串流合併及相關測試。移除失去用途的分支與 helper；前置訂單／客戶確認、子報價查價、租約競爭保護與來源權限規則仍需保留。

## 驗收案例

1. 主 Agent 尚未回應時：DB 已有清理排序後的正式表格、OCR metadata 與最新版指標，run 為 completed，前端校對 icon 可操作。
2. 輸入含單位的數值、獨立零件編號及原備註：發布結果符合清理與固定 16 欄順序，備註值為零件編號；DB 原始 chunk 與主 Agent 的原組裝 17 欄輸入仍有原備註、獨立零件編號及完整來源，兩份表格互不覆寫。
3. 主 Agent 串流時保存一次／多次校對：`vN` 遞增，DB、chat Markdown、content 及校對彈窗均顯示同一最新版。
4. 人工保存與 AI delta／完成事件交錯：較晚的 AI 事件不能覆蓋人工版本；總結完成後表格與人工收據保持不變。
5. 主 Agent error：報價仍 completed，表格可繼續校對，沒有重試報價／查價，日誌能以 conversation／response 找到錯誤碼與內容。
6. 使用者在主 Agent 回應期間按暫停：只停止總結，報價仍 completed；重新整理後不出現重試報價。
7. 後端發布前 error／暫停：不得偽造完成或發布正式表格，仍可依既有未完成報價機制恢復。
8. 正式發布 DB 失敗、來源不符、失去租約或新 generation 已取代舊回應：不得發布不可信表格、標記錯誤最新版或開始其總結。
9. completed 報價的重連、重送與歷史載入：不重跑模型查價／組裝，不新增重複 `vN`，不覆蓋最新人工版本。
10. 新報價／新回應取代舊回應時：較晚抵達的舊總結不能更新新 output；舊表格與校對版本保留為歷史。
11. 多個 text part、工具 content 及拆開的總結區段：保持表格版本一致、總結只出現一次，其他內容不被錯刪。
12. 主 Agent 串流與保存快照不含 `system_order` Markdown；後端表格事件可單獨還原表格、metadata、最新版與 completed 狀態。後端在主 Agent 回應結束後補上摘要，表格與人工版本保持不變。

完成條件：上述行為有對應的實際資料庫及前端／串流驗證，受影響 workspace 的型別檢查、建置及範圍檢查通過，舊規格與新實作沒有互相矛盾的完成、重試或表格覆蓋邏輯。部署與正式站驗證需另外記錄。
