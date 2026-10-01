# OpenAI OAuth compaction：第一階段能力驗證

日期：2026-10-01。模型：`gpt-6.1-sol`。測試使用可拋棄的合成資料。

## 本階段交付

已找到並實測可用的 Codex V2 OAuth 原生壓縮協定：`POST /responses` 的輸入末尾加入 `{ "type": "compaction_trigger" }`。它與舊的 standalone `/responses/compact` 是不同協定。`gpt-6.1-sol` 已回傳加密 `compaction` 項目，壓縮後下一輪也正確保留合成工具值。

新增可重複執行的 OAuth compaction 協定診斷，不會啟用 conversation／Agent 的執行時壓縮。診斷核心接收注入的 OAuth client、model、取消訊號與回應大小上限；graph、資料庫與 deployment plugin 不會被更動。

```sh
npm run build:api
npm run probe:oauth-compaction -- --model gpt-6.1-sol
npm run probe:oauth-compaction -- --model gpt-6.1-sol --mode standalone
npm run probe:oauth-compaction -- --model gpt-6.1-sol --mode standalone --responses-lite
```

指令使用現有 Codex OAuth 路徑與 DEV 設定的憑證位置。可用 `--auth-file` 明確指定其他憑證檔；不會顯示路徑或憑證。`--refresh` 才會呼叫既有 refresh 流程；不要將 credentials 或帳號識別資料貼到輸出中。`--help` 列出診斷參數，不讀取 OAuth credentials。

預設 `--mode codex-v2` 使用現行 Codex 協定；`--mode standalone` 保留舊端點診斷。退出碼：`0` 表示所選協定診斷通過，`1` 表示該診斷的能力條件未通過，`2` 表示參數或操作失敗。通過診斷不會自動啟用 compaction，也不代表完整 Agent SDK admission／續跑整合已驗證。

## 實測結果

既有 credential refresh 後，模型列表可成功讀取，目標模型已列出。

| 路徑類別 | Method | 階段 | HTTP status | 安全結果 |
| --- | --- | --- | --- | --- |
| 既有 Codex OAuth | GET | 模型列表 | 200 | `modelListed=true` |
| 既有 Codex OAuth V2 | POST `/responses` | `compaction_trigger` | 200 | 原生 encrypted compaction item，正常 `response.completed` |
| 既有 Codex OAuth V2 | POST `/responses` | 壓縮後下一輪 | 200 | 保留先前工具值，正常 `response.completed` 與 usage |
| 既有 Codex OAuth V2 | POST `/responses` | 第二次壓縮及再次續聊 | 200／200 | 新壓縮項目替換舊項目，再次保留工具值 |
| 既有 Codex OAuth V2 | POST `/responses` | 串流取消 | 200 | 完整非終止事件後取消請求與 reader |
| 既有 Codex OAuth | POST | input accounting | 403 | accounting 未通過 |
| 既有 Codex OAuth | POST | standalone compaction | 404 | compact 未通過 |
| 既有 Codex OAuth，Responses-lite 相容性 | POST | input accounting | 403 | accounting 未通過 |
| 既有 Codex OAuth，Responses-lite 相容性 | POST | standalone compaction | 404 | compact 未通過 |
| 官方 public Responses，同一份既有 OAuth 憑證，獨立探測 | POST | input accounting／compaction | 401 | public route 的授權未通過 |

上述是此帳號／路徑在測試當下的能力證據。舊端點的負向結果不能推論 OAuth 不支援壓縮；V2 的正向結果也不代表所有模型皆可用。Public route 的獨立探測沒有改動 app transport，也沒有改用 API key。

V2 實測使用合成的 function call／result 與使用者訊息，回放只保留使用者訊息和原生壓縮項目，再加一筆沒有揭露答案的新問題，正確取回工具值。Opaque payload 只存在測試程序記憶體，未寫入診斷文件。5xx／網路失敗另屬操作失敗，不歸類為「不支援」。

已編譯的正式指令完成全部 V2 檢查並以 `0` 結束：`protocolCompatible`、`compactAccepted`、`replayCompleted`、`repeatedCompactionCompleted`、`cancellationObserved` 與 `usageObserved` 皆為 `true`。這個結果證實當前帳號／模型的協定可用，不代表完整 LibreChat 自動壓縮已接入。

本次驗證：59 個 focused Jest 測試、scoped ESLint、API build、CJS syntax、diff／新檔案空白檢查及新增模組與測試的 scoped TypeScript 檢查均通過；獨立審查沒有剩餘 actionable findings。Scoped TypeScript 使用 API workspace 原本的 compiler options 與 ambient type roots，只縮小 include 到新增模組。API 全量 `npx tsc --noEmit` 執行超過十分鐘仍無結果後停止，因此不列為通過。

## V2 診斷契約與後續啟用條件

1. 先確認實際 client 為 OAuth，並由模型列表確認目標 model。
2. 使用正常 Responses transport 和模型相容性轉換，輸入末尾加入 `compaction_trigger`；串流必須恰好有一筆含非空 encrypted content 的 `compaction` `output_item.done`，並有成功完成事件及有效 usage。不能只依 HTTP 200 或 EOF 判定成功。
3. 按 Codex V2 的歷史建立方式保留合成使用者訊息及 compaction item，追加恰好一筆新訊息。下一輪必須正確回答先前工具值，且正常完成。Standalone「完整 output」規則不能直接套用成 V2 的 window 規則。
4. 診斷另檢查連續 compact／回放、取消、回應上限與失敗狀態。只輸出固定 stage／status／code 和布林結果，不輸出原始內容、headers、帳號、opaque payload 或數值 usage。
5. V2 會回報 server usage，但這不等同下一次任意新增輸入的 admission 計量。Opaque pre-admission budget、SDK 接點、私有 checkpoint、全部主子 Agent／runner 路徑及外掛生命週期仍須另行接入驗證。

官方實作基準：[Codex `compact_remote_v2_attempt.rs`](https://github.com/openai/codex/blob/1f52d407041d933e490ca3033729bce6319d07fa/codex-rs/core/src/compact_remote_v2_attempt.rs)、[`compact_remote_v2.rs`](https://github.com/openai/codex/blob/1f52d407041d933e490ca3033729bce6319d07fa/codex-rs/core/src/compact_remote_v2.rs)。

## Standalone 診斷契約

1. 先確認 client 為 OAuth，並由已驗證身分的模型列表確認目標 model；模型不存在時停止。
2. 分別檢查 accounting 與 compact，記錄各自的固定 stage／status／code。回應內容、headers、帳號、opaque payload 與數值 usage 不會進入診斷輸出。
3. 只有前兩項通過，才將 **完整 compact output 加上恰好一筆新的合成 item** 送去下一次 accounting 與 generation；保留 user items 與工具配對，不重複追加。
4. Generation 必須成功到 `response.completed`，另驗證取消與回應大小限制；EOF 或 provider failure 不能當成完成。
5. 正向協定證據建立後，仍須完成原研究中的 opaque budget、SDK pre-admission 接點、私有 checkpoint、全部主子 Agent／runner 路徑與外掛生命週期整合，才可提供執行時功能。

目前完成的是協定能力階段，尚未接入一般 conversation／主子 Agent／Steel runner 的自動壓縮。沒有添加 runtime 設定／UI 開關，也沒有更動 node_modules、schema、env、正式環境、commit 或 push。原研究的舊端點假設已由本文件的 V2 實測補充；後續架構須採用 V2 對應的 raw item 與 budget 契約。

## 壓縮狀態提示

後續啟用原生 compact 時，需在實際壓縮期間顯示 Codex 類似的狀態提示：英文 `Compacting context · This can take a few minutes`；繁體中文「正在壓縮上下文 · 這可能需要幾分鐘」。提示須由壓縮開始／完成／失敗／取消的生命週期事件驅動，不能以計時器推測，也不能在一般工具輸出縮減時顯示。

提示使用既有 UI 元件、圖示與語系機制，並以可供螢幕閱讀器讀取的狀態呈現。完成後移除；取消時清除；失敗時轉為安全、可翻譯的錯誤狀態。主 Agent 與子 Agent 的提示須依執行身分區分；重新連線或續跑時須反映實際狀態，不重複顯示。OAuth 能力尚未通過時，不顯示正在壓縮的提示。

設計與完整覆蓋矩陣見 [原研究文件](openai-oauth-compaction-research.md)。
