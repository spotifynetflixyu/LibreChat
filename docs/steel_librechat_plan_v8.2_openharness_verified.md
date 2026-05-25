# 鋼鐵報價 LibreChat 擴充專案 v8.2 開發規格

版本日期：2026-05-25
修訂版本：v8.2-openharness-verified
文件狀態：可執行開發規格；本版已依 OpenAI API / OpenHarness ChatGPT OAuth 能力邊界重新查證與修正

本文件將 v8.1 規劃升級為可交給工程實作的規格。v8.2 的核心變更是：固定 Workbook 七分頁、ERP XLSX 作為正式 Admin 匯入來源、鋼鐵手冊 DOCX 先作真實 schema/data-model 設計參考、Admin 不做 DOCX/PDF parser upload path、真實手冊 data SQL 匯入延後、chat UX 與 Quote Workbook vertical slice 優先、資料庫以 MongoDB + Supabase PostgreSQL 為主、報價以 Quote Resolution Engine 和 deterministic calculator 為核心。

---

## 0. 文件目的

本專案在 LibreChat monorepo 內擴充一套鋼鐵公司報價系統，保留 LibreChat 原有聊天介面、使用者驗證、Agents、檔案上傳、OCR、MCP / Actions、Memory、Admin Panel、對話紀錄等能力，新增鋼鐵報價專用工作台。

產品定位：

```text
這是一個讓鋼鐵公司行政人員用聊天方式處理報價的工作台：
把客戶文字、圖面、PDF、Excel、DOCX 丟進來，系統會查客戶分級、
找價格候選、算重量與加工、標記低信心、產生內部報價、
系統訂單與客戶用報價單。
```

主要能力：

- Conversation-first 查價與報價流程。
- 支援未登入 guest conversation。
- Workbook / Excel 綁定 conversation ID。
- Steel AI Provider adapter 狀態追蹤；預設 driver 為 OpenHarness ChatGPT/Codex OAuth provider，`OPENAI_API_KEY` 作為 capability fallback / production-safe fallback。
- 開發階段 Steel workspace 的 model selector 由後端 allowlist 控制，可切換 `openharness_chatgpt_oauth` 或 `openai_api` driver。
- Project Sources / Project Instructions 管理。
- 鋼鐵資料查詢 tools。
- Admin ERP XLSX 增量匯入控制頁。
- Admin 正式資料匯入只接受 ERP 匯出的 XLSX。
- 鋼鐵手冊 DOCX 先由 code agent 依內容制定真實 schema/data model；真實手冊 data SQL 匯入後續再實作，後續 Admin 網頁不需要上傳 DOCX。
- `docs/reference/doc` 可用來設計真實 schema 與 API mock data，但目前來源文字仍有筆誤需要校正，不代表資料已整理成可直接匯入資料庫的狀態。
- `docs/reference/doc` 來源資料多為中文；需先建立 `tasks/v8.2/source-schema-mapping.md`，將中文來源 label/header/term 對應到英文 canonical schema key，程式端 DTO、tool args、repository filters、SQL columns 與 DB query contract 統一使用英文 key。
- 實作時同步設計 code-owned mapping，例如 `packages/api/src/steel/schema/mapping.ts`，並將精簡 mapping context 提供給 AI API，讓 AI 能把中文來源/客戶用語對應到既有 schema key；AI 不得自行發明 key。
- 中文產品名稱、別名、表格顯示文字、原始來源片段可以保留為 data/display/source/search values，但不能直接成為 code-owned field name 或 DB query key。
- API mock data 統一放在 `packages/data-provider/src/steel/mock/`，前端與後端 mock endpoint 共用同一份資料。
- API mock data 只能透過明確 mock path 匯入，不從 `packages/data-provider/src/steel/index.ts` 重新 export，避免被當成 production data-provider API。
- Chat Workspace + Workbook Preview 優先於真實資料匯入，Phase 3 先做獨立 Steel workspace，不改 LibreChat core chat store / global message flow。
- 手機版與桌面版共用同一套 Steel UX framework、components、hooks、API contracts 與 mock data，只在 responsive layout 上調整。
- 手機版 Workbook Preview 使用 full-view modal 呈現，右上角有明確 X 關閉；Phase 3 點選 workbook cell 只支援單一 cell selection，cell 會標記 selected style，並在底部 message input 加入欄位 marker，同時送出 structured selected ref 供 AI patch workbook。
- Workbook 可透過多輪對話持續修改；使用者也可以用文字描述多個明確位置要更改，讓 AI 產生多個 patch ops，但後端必須逐一驗證，模糊目標不得猜測。
- Phase 3 不做每次 AI patch 前的 preview / diff confirmation gate，以免拖慢 chat UX；成功套用 patch 後，用背景色標示最新更新的 workbook 欄位，維持到下一次 accepted workbook patch。
- AI patch 失敗或被後端拒絕時，不標示 workbook 欄位、不改 workbook data，chat 回覆說明未更新原因。
- Phase 3 不做明確 Undo button 或版本控制 UI；使用者統一透過聊天請 AI 還原或修改 workbook，AI 仍必須走 validated workbook patch flow。
- AI patch 成功時，chat 回覆用短摘要列出已更新欄位，例如 `已更新：報價明細 line-1 報價單價 120 -> 115`；不在 chat 顯示完整 diff table。
- AI Merge Table。
- MongoDB + Supabase PostgreSQL 資料保存。
- Memory Candidate + Admin 審核統整。
- Excel 多分頁匯出與指定分頁下載。
- RAG source 同步更新 / 刪除。
- 審計與追蹤。
- Steel Eval Harness 回歸測試。

---

## 1. v8.2 修正重點

### 1.1 Workbook / Excel 固定七分頁

每份報價 Workbook 至少包含七個固定分頁：

1. 報價明細
2. 總結
3. 人工複核清單
4. 價格來源
5. 判讀備註
6. 系統訂單
7. 給客戶用

「給客戶用」分頁必須移除：

- 內部資料
- 客戶等級 / 客戶分級
- 價格來源細節
- AI 判斷備註
- 人工複核內部原因
- internal cost
- margin
- source refs
- admin notes

### 1.2 移除外部直連資料庫規劃

外部企業資料庫尚未確認可以連接，v8.2 不做外部資料庫直連或企業系統直連規劃。正式開發只以 MongoDB + Supabase PostgreSQL 為主。

資料更新統一改成：

```text
Admin 上傳 ERP export XLSX
 -> Admin preview
 -> AI 協助 mapping / merge table
 -> 後端驗證 valid / invalid / needs_review
 -> Admin confirm
 -> Supabase PostgreSQL transaction
```

價格異動追溯稱為「資料匯入引發的價格異動追溯」。

鋼鐵手冊 DOCX 是真實 schema/data-model 設計參考，不是當前資料匯入工作：

```text
Code agent 依手冊 DOCX 內容盤點規格/重量/規則欄位
 -> 建立中文來源欄位/術語到英文 canonical schema key 的 source schema mapping
 -> 以 code agent 討論後的正確概念制定 canonical schema key
 -> 制定或修正 Supabase schema/data model
 -> 同步設計 code 版 source-schema mapping 與 AI API mapping context
 -> chat UX / workbook vertical slice 優先開發
 -> 後續再實作真實 data SQL import
```

### 1.3 Admin 不做 PDF Parser

Admin 資料維護頁不做 DOCX/PDF parser，也不負責把 PDF 轉成可匯入資料。

正式 Admin 匯入入口只接受：

- ERP 匯出的 XLSX

若 Admin 上傳 DOCX、PDF、掃描 PDF、圖片式 PDF、手冊 PDF、切工價錢 PDF 或圖面 PDF：

- 後端拒絕進入 Admin Import parser。
- UI 顯示「請先在系統外整理成 ERP XLSX 後再上傳」。
- 不建立 merge table。
- 不寫入 Supabase PostgreSQL 正式資料表。
- 若 PDF 另作報價對話附件或人工稽核附件，只能作低信心 evidence，不是 Admin data source。

核心結論：Admin data source = ERP XLSX only；鋼鐵手冊 DOCX = real schema/data-model design reference，不是 Admin web upload path、reusable parser，真實 data SQL import 延後到後續 code-agent data task。

---

## 2. 核心決策摘要

| 項目 | v8.2 決策 |
|---|---|
| 基礎平台 | 使用 LibreChat monorepo 擴充，不另做 sidecar service |
| 後端位置 | 新增 TypeScript 後端邏輯放 `packages/api/src/steel` |
| `/api` 邊界 | 只放 Express route wrapper 與 route registration |
| 前端位置 | 使用 `client/src/features/steel` 建立獨立 Steel workspace、Chat Workspace、Workbook Preview、Admin pages |
| 資料庫 | MongoDB + Supabase PostgreSQL |
| MongoDB 用途 | LibreChat 既有資料、Steel app state、Workbook、Memory、Audit、Import sessions |
| Supabase PostgreSQL 用途 | 結構化業務資料、價格、重量、加工、訂單、source chunks、pgvector |
| AI Provider | Steel AI Provider adapter；預設 `openharness_chatgpt_oauth`，備用 `openai_api` / `OPENAI_API_KEY`；依 capability smoke test 自動切換 |
| AI state | Steel Agent Orchestrator 保存 provider run metadata；OpenHarness session/conversation id 只作 OAuth runtime trace；OpenAI Conversations / Responses API state 只在 `openai_api` driver 啟用 |
| 模型選擇 | Steel Workspace 使用後端 allowlist；只顯示目前 driver 支援且已通過 smoke test 的模型 |
| Guest Mode | `STEEL_GUEST_MODE=false` 預設關閉；true 才允許未登入 quote/workbook/export |
| 價格規則 | 價格先於重量；不可用手冊重量直接推材料售價 |
| Workbook | Workbook JSON 是主資料，ExcelJS 只根據 Workbook JSON 匯出 |
| Workbook line | 永久保存公式、資料庫預設單價、報價單價、總價、調整來源 |
| Export | ExcelJS 產生 XLSX，固定七分頁，可完整或指定分頁下載 |
| Customer Sheet | 後端 allowlist 控制，不由 AI 決定欄位 |
| Admin Import | 正式入口只接受 ERP XLSX parsed data；後續表格維護走 web fetch data + table UI preview/edit |
| Source schema mapping | `tasks/v8.2/source-schema-mapping.md` 先把中文來源 label/header/term mapping 到英文 canonical schema key；程式端 DB/API/tool 查詢統一用英文 key |
| AI API mapping | Prompt/tool context 提供精簡 source-schema mapping，讓 AI API 對應既有 schema key；未知 key 追問或人工複核 |
| PDF | 不進 Admin Import；若作聊天附件只作低信心 evidence |
| AI DB 權限 | AI 不直接操作 MongoDB / Supabase PostgreSQL，只能呼叫白名單 tools |
| Raw query | 禁止 raw SQL / raw Mongo query tool |
| Eval | 建立 Steel Eval Harness 驗證價格先於重量、七分頁、Admin upload policy、客戶版遮罩 |

---

## 3. 不重複造輪子原則

沿用 LibreChat：

- Authentication、OAuth / SAML / LDAP。
- Admin Panel、ACL / Roles / Groups。
- Agents、model selector、既有 auth/navigation 基礎能力。
- 既有 conversations / messages 可作歷史資料參考，但 Phase 3 Steel Chat Workspace 不以改造 core LibreChat chat store / global message flow 作為 MVP 前提。
- Upload as Text、OCR、Files、Memory UI 基礎能力。
- MCP / Actions UI 可沿用或局部接入。

鋼鐵專用新增：

- `steel_conversation_meta`
- Quote Resolution Engine
- Material Normalization Dictionary
- Stock Allocation Engine
- Deterministic Calculation Engine
- Workbook JSON Engine
- Excel Export Engine
- Admin ERP XLSX Import / AI Merge Table
- Admin Table Maintenance UI
- Steel Handbook Schema Design Boundary
- Steel Tool Registry
- Steel Eval Harness

工程原則：

- 新後端邏輯用 TypeScript，放 `packages/api/src/steel`。
- `api/` 只新增薄 wrapper。
- shared API types 放 `packages/data-provider/src/steel`。
- Workbook JSON、patch request/response、selected workbook refs、changed paths、changed-field summary items 的 public DTO owner 是 `packages/data-provider/src/steel/workbooks.ts`。
- Backend canonical validation owner 是 `packages/api/src/steel/workbook/schema.ts` 的 Zod schema 與 workbook service；frontend 不另建 workbook validation schema。
- Mongo schema 放 `packages/data-schemas/src/schema/steel*.ts`。
- Supabase schema 變更必須同時更新 `supabase/schema.sql` 與 `supabase/migration/*.sql`。

---

## 4. LibreChat Monorepo 擴充架構

### 4.1 建議目錄

```text
packages/api/src/steel
├─ conversations
├─ projects
├─ sources
├─ instructions
├─ admin
│  ├─ imports
│  └─ preview
├─ memory
├─ ai
│  ├─ providers
│  │  ├─ openharness-chatgpt-oauth
│  │  └─ openai-api-fallback
│  └─ events
├─ prompt
├─ tools
├─ quote
├─ normalization
├─ pricing
├─ calculators
├─ allocation
├─ vision
├─ repositories
├─ retrieval
├─ workbook
├─ excel
├─ exports
├─ evals
│  ├─ cases
│  ├─ expected
│  ├─ fixtures
│  ├─ reports
│  └─ runners
├─ audit
└─ permissions
```

```text
packages/data-provider/src/steel
├─ conversations.ts
├─ workbooks.ts
├─ quote.ts
├─ sources.ts
├─ imports.ts
├─ memory.ts
├─ exports.ts
├─ evals.ts
├─ mock
└─ index.ts
```

`mock` 目錄是 Phase 3 chat UX / workbook preview 開發用的 fixture 來源；不要從 `index.ts` re-export。

Contract ownership：

- `workbooks.ts` 定義 Workbook JSON、Workbook Patch request/response、`SelectedWorkbookRef`、changed paths、changed-field summary item 等 public DTO。
- `conversations.ts` 可定義 conversation message request/response envelope，但 selected refs 與 patch metadata 必須 reuse `workbooks.ts` DTO。
- `packages/data-provider/src/steel/mock/` fixture 必須以 public DTO typing 建立。
- `packages/api/src/steel/workbook/schema.ts` 以 Zod 定義 backend canonical runtime validation；所有 accepted workbook mutation 以 backend validation/service 結果為準。
- Frontend 只能 consume DTO/API response，不擁有或複製 workbook validation schema。

```text
client/src/features/steel
├─ chat
├─ workbook
├─ sources
├─ imports
├─ memory
├─ exports
└─ shared
```

### 4.2 Phase 建議

| Phase | 內容 | Gate |
|---|---|---|
| 1 | shared contracts、Mongo schemas、routes、permissions、audit | Steel conversation meta 可建立、guest gate 有測試 |
| 2 | Supabase repositories、handbook-informed schema boundary、normalization、pricing search、tools | 查客戶/價格/重量/加工 tools 可測 |
| 3 | Independent Steel Workspace、shared desktop/mobile UX framework、shared API mock data、Quote Resolution Engine、calculators、Workbook JSON、Workbook Preview | 使用者可送訊息並看到七分頁 workbook preview；real provider smoke 驗證 vertical slice；OpenHarness OAuth 與官方 OpenAI API fallback 各至少一條 smoke case |
| 4 | ExcelJS export、customer mask、system order sheet | 七分頁 export 與 customer mask 測試通過 |
| 5 | Admin ERP XLSX import、table maintenance、Source 管理 | Admin confirm 後才可寫入 Supabase |
| 6 | Memory Review、RAG source sync、eval harness、production hardening | 回歸測試與 audit 完整 |

---

## 5. Conversation-first 設計

LibreChat 原生 `conversations` + `messages` 保存聊天訊息歷程。Steel 只補 `steel_conversation_meta` 保存鋼鐵狀態。

```ts
export interface SteelConversationMeta {
 id: string;
 userId?: string;
 guestTokenHash?: string;
 librechatConversationId?: string;
 aiProviderMeta: {
   provider?: 'openharness_chatgpt_oauth' | 'openai_api';
   providerSessionId?: string;
   providerConversationId?: string;
   previousResponseId?: string;
   lastRunId?: string;
   providerStateBroken?: boolean;
 };
 projectId?: string;
 lastWorkbookId?: string;
 lastModel?: string;
 status: 'active' | 'closed' | 'expired';
 createdFrom: 'guest' | 'authenticated';
 createdAt: string;
 updatedAt: string;
 lastAccessedAt: string;
}
```

Guest conversation：

- 未登入使用者可建立 `steel_conversation_meta`。
- 後端回傳 `conversationMetaId + guestAccessToken`。
- 前端保存於 local storage 或 secure cookie。
- 後端只保存 token hash。
- guest 可查價、產生 workbook、下載 Excel。
- guest 轉登入時可綁定 `userId`。
- 預設最後存取後 30 天 expire，export 檔案預設 7 天清除。

---

## 6. Steel AI Provider Adapter、OpenHarness ChatGPT/Codex OAuth 與 Model Selection

### 6.1 決策

Steel Workspace 不直接綁死 LibreChat 原本 OpenAI client，也不讓 OpenHarness 取代 LibreChat 平台層。AI 呼叫層抽象為 `SteelAIProvider`，由 `SteelAgentOrchestrator` 控制 prompt bundle、tool loop、structured output、workbook patch、audit 與 fallback。

本版支援兩種 driver，預設與備援如下：

```text
STEEL_AI_DRIVER_DEFAULT=openharness_chatgpt_oauth
STEEL_AI_DRIVER_FALLBACK=openai_api
```

- `openharness_chatgpt_oauth`：預設 driver。使用 OpenHarness ChatGPT / Codex OAuth provider 承接模型執行，定位是 subscription-backed local / dev-first runtime。
- `openai_api`：備用 driver。使用官方 OpenAI API Key / Responses API / Conversations API，作為 capability fallback、production-safe fallback、檔案/vision/Excel hosted-tools fallback、API 用量與 rate-limit 觀測路徑。

OpenHarness 只替換 AI execution provider，不替換：

- LibreChat authentication / users / roles / conversations / files / admin shell。
- Steel Quote Resolution Engine。
- Steel deterministic calculators。
- MongoDB / Supabase repository layer。
- Workbook JSON / workbook patch validation。
- Backend business tools 的實際執行端。

### 6.2 查證結論：OpenAI API Conversation 與 OpenHarness ChatGPT OAuth 不是同一個能力面

結論：

```text
OpenAI API driver：可作為檔案、PDF vision、圖片/圖面判讀、Excel evidence、File Search、Code Interpreter、tool calling 的正式能力來源。
OpenHarness ChatGPT OAuth driver：可作為預設聊天 / agent execution driver，但檔案、vision、Excel、hosted tools 不得預設視為與 OpenAI API 等價，必須逐項 smoke test。
```

模型名稱相同不等於 provider surface 相同。即使兩邊都選到相同模型，例如 `gpt-5.5`，下列項目仍可能不同：

- authentication 與 entitlement。
- request / response schema。
- conversation state 保存方式。
- file input 傳輸方式與 MIME 支援。
- PDF page image 是否送入模型。
- spreadsheet augmentation 是否啟用。
- Code Interpreter / Hosted Shell / File Search 等 hosted tool 是否可用。
- tool calling event shape。
- stream event shape。
- rate limit / subscription limit / billing visibility。

因此不得把「同模型」寫成「同能力」。應寫成：

```text
同模型只代表推理核心能力接近；實際可用能力由 driver capability matrix 與 live smoke test 決定。
```

### 6.3 Capability Matrix

| 能力 | `openai_api` / `OPENAI_API_KEY` | `openharness_chatgpt_oauth` |
|---|---|---|
| Conversation state | 支援 OpenAI Responses API / Conversations API state；可用 `previous_response_id` 或 conversation item 保存訊息、tool call、tool output | 使用 OpenHarness Session / Conversation 作 runtime trace；不得視為官方 OpenAI Conversation state |
| 一般聊天 | 支援 | 支援；作為本案預設 driver |
| Structured output | 支援，但仍需後端 schema validate | 可透過 OpenHarness / AI SDK tool 或 structured output pattern smoke test；未通過不得進報價 runtime |
| Function / tool calling | 模型可決定呼叫 tool 並產生參數；custom tool 的實際執行仍由 Node/backend 完成 | 可掛 OpenHarness / AI SDK custom tools；custom tool 的實際執行仍由 Node/backend 完成 |
| Backend API tool：fetch price / customer / weight / workbook | 模型判斷是否呼叫；Node/backend 執行 API、權限、查詢、sanitize、audit | 模型判斷是否呼叫；Node/backend 執行 API、權限、查詢、sanitize、audit |
| File upload / file input | 官方 Responses API 可用 file input / Files API / URL；PDF 可同時取文字與頁面影像；非 PDF 文件主要取文字；spreadsheet 有專用 augmentation | 不可預設等價；需測試 provider 是否能傳 file parts、PDF、image、XLSX，失敗即 fallback 到 `openai_api` |
| OCR / 圖面判讀 | Vision-capable model 可對圖片與 PDF page image 判讀；Code Interpreter 可輔助裁切、旋轉、放大、影像處理 | 不可預設等價；需測試 image/file input 是否可達模型；未通過則 fallback 到 `openai_api` |
| Excel evidence | 可用 spreadsheet augmentation、File Search、Code Interpreter / Hosted Shell 形成 evidence；仍需後端保存 evidence refs | 不可預設等價；XLSX 解析與 evidence 若未通過 OAuth driver smoke test，fallback 到 `openai_api` |
| File Search | 官方 hosted tool 能搜尋 vector store / uploaded file content | 不可預設可用；若 OpenHarness 不支援 OpenAI hosted File Search，需用 backend tool 或 `openai_api` fallback |
| Code Interpreter / Hosted Shell | 官方 hosted tool 可在 sandbox 讀檔、寫 Python、產出檔案與圖表 | 不可預設可用；OpenHarness 本身有 FS/Bash/provider tools，但不是同一個 OpenAI hosted tool surface |
| Quota / cost | API 是 usage-based；有 rate limit、usage limit、billing / budget / dashboard / response headers；不是無限制 | ChatGPT/Codex OAuth 是 subscription-backed entitlement；不保證有可查的 remaining quota API；應用要處理 auth / rate / subscription-limit 類錯誤 |

### 6.4 AI-first 檔案、OCR、圖面與 Excel Evidence 策略

本案採用 AI-first 判讀，不採用 Node app 自行實作主 OCR / 主圖面判讀 / 主 Excel semantic evidence。正確邊界如下：

```text
使用者上傳 PDF / 圖片 / Excel / DOCX
 -> Node/backend 接收檔案、檢查權限、保存 metadata、建立 provider 可用的 file ref 或 signed URL
 -> AI provider 判斷檔案內容、方向、孔洞、開槽、折線、Excel evidence、需要呼叫哪些 tools
 -> AI provider 要求 backend tools 查客戶、價格、重量、加工、workbook
 -> Node/backend 執行 tools、回傳 sanitize 後結果
 -> AI provider 產生 structured quote / workbook patch / evidence notes
 -> Node/backend 驗證 patch、公式、欄位、權限、金額規則，通過後寫入 workbook truth
```

OpenAI / 模型負責：

- 判斷是否需要讀檔、看圖、查表、呼叫 tool。
- 對 PDF page image / 圖面 / 掃描件做方向、孔洞、開槽、折線、手寫標註等 vision 判讀。
- 對 Excel / 表格附件形成 evidence summary、候選欄位、可能對應。
- 產生 tool call arguments。
- 彙整 tool results 與檔案 evidence，產生報價明細、低信心原因與 workbook patch。

Node/backend 必須負責，不能省略：

- 檔案上傳入口、型別/大小/安全檢查、儲存、metadata、retention。
- 將附件轉成 provider 可接受的 `file_id`、URL、base64 或 file part；OAuth driver 不支援時 fallback 到 `openai_api`。
- 定義 backend business tools：客戶查詢、產品價格查詢、重量規格查詢、切工查詢、workbook read / patch proposal。
- 實際執行 custom tools。OpenAI 只會要求呼叫 tool，不會替系統直接執行你的內部 API。
- Tool args Zod validation、ACL、tenant boundary、prompt-injection filter、output sanitize、audit log、max tool-call guard。
- Workbook patch validation、公式驗證、不可填 0 規則、低信心規則、七分頁 schema validation。
- 保存 source refs / evidence refs，讓報價可追溯。

禁止寫成：

```text
Node app 不支援檔案 / OCR / Excel evidence，全部由 OpenAI 操作。
```

應改成：

```text
Node app 不做主判讀；OpenAI 負責判讀與決策。Node/backend 負責上傳、provider file ref、custom tool runtime、安全、驗證、audit、workbook truth 與 fallback routing。
```

### 6.5 File / Vision / Excel Driver Policy

每個 driver 啟用前必須保存 capability smoke test 結果：

```ts
export interface SteelAIDriverCapability {
 provider: 'openharness_chatgpt_oauth' | 'openai_api';
 model: string;
 supportsText: boolean;
 supportsStreaming: boolean;
 supportsToolCalling: boolean;
 supportsStructuredOutput: boolean;
 supportsImageInput: boolean | 'unverified';
 supportsPdfInput: boolean | 'unverified';
 supportsXlsxInput: boolean | 'unverified';
 supportsFileSearch: boolean | 'unverified';
 supportsCodeInterpreter: boolean | 'unverified';
 supportsSpreadsheetAugmentation: boolean | 'unverified';
 supportsConversationState: boolean | 'provider_trace_only' | 'unverified';
 lastSmokeTestAt?: string;
 failureReason?: string;
}
```

Routing 規則：

- 一般純文字聊天：優先 `openharness_chatgpt_oauth`。
- 需要 backend API tool calling：優先 `openharness_chatgpt_oauth`，但 tool loop smoke test 失敗時 fallback 到 `openai_api`。
- 需要圖片、PDF、掃描圖面、OCR、圖面判讀、孔洞/折線/開槽判讀：若 OAuth driver 的 image/pdf smoke test 未通過，直接 fallback 到 `openai_api`。
- 需要 XLSX / Excel evidence：若 OAuth driver 的 XLSX 或 spreadsheet evidence smoke test 未通過，直接 fallback 到 `openai_api`。
- 需要 OpenAI hosted File Search / Code Interpreter / Hosted Shell：OAuth driver 未明確支援時，直接 fallback 到 `openai_api`。
- OAuth subscription limit、auth failed、provider event unsupported、file input unsupported、tool call unsupported 時，自動分類錯誤並依 policy fallback。

### 6.6 Provider state 規則

`steel_conversation_meta.aiProviderMeta` 保存 provider runtime trace，但不作唯一業務真實來源。

- LibreChat conversation / messages 保存聊天歷程。
- MongoDB `steel_workbooks` 保存 workbook truth。
- MongoDB `steel_ai_runs` 保存 provider run audit。
- OpenHarness session / conversation id 只作 runtime trace。
- OpenAI Responses API `conversation` / `response_id` / `previous_response_id` 只在 `openai_api` driver 使用。
- 後端不得依賴 provider 回抓歷史對話重建報價狀態；必須用 `contextRefs`、current workbook、active sources、instructions、memories 重建 prompt bundle。

每次 AI run 保存：

```ts
export interface SteelAIRunDraft {
 provider: 'openharness_chatgpt_oauth' | 'openai_api';
 steelConversationMetaId: string;
 providerSessionId?: string;
 providerConversationId?: string;
 providerResponseId?: string;
 previousProviderResponseId?: string;
 model: string;
 selectedBy: 'user' | 'system' | 'admin';
 promptTokens?: number;
 completionTokens?: number;
 contextRefs: PromptContextRefs;
 toolCallIds: string[];
 attachedProviderFileIds?: string[];
 attachedSourceFileIds?: string[];
 status: 'started' | 'completed' | 'failed' | 'fallback_completed';
 fallbackFromProvider?: 'openharness_chatgpt_oauth' | 'openai_api';
 fallbackReason?: string;
 errorCategory?:
   | 'provider_auth_failed'
   | 'provider_subscription_limited'
   | 'provider_quota_unknown'
   | 'provider_rate_limited'
   | 'provider_tool_call_unsupported'
   | 'provider_file_input_unsupported'
   | 'provider_vision_input_unsupported'
   | 'provider_xlsx_input_unsupported'
   | 'provider_hosted_tool_unsupported'
   | 'structured_output_invalid'
   | 'unknown';
 errorSummary?: string;
}

export interface PromptContextRefs {
 workbookId?: string;
 workbookVersionSeq?: number;
 customerIds: string[];
 priceItemIds: string[];
 weightSpecIds: string[];
 processingPriceIds: string[];
 sourceVersionIds: string[];
 sourceChunkIds: string[];
 instructionVersionIds: string[];
 memoryIds: string[];
 uploadedFileIds?: string[];
 providerFileIds?: string[];
 evidenceIds?: string[];
}
```

### 6.7 Model selector 規則

Steel Workspace 的 model selector 不直接讀 LibreChat 全域 provider 清單。後端依 driver capability matrix 回傳 allowlist：

```ts
export interface SteelModelOption {
 id: string;
 label: string;
 provider: 'openharness_chatgpt_oauth' | 'openai_api';
 supportsTools: boolean;
 supportsStructuredOutput: boolean;
 supportsVisionInput: boolean | 'unverified';
 supportsFileInput: boolean | 'unverified';
 supportsPdfInput: boolean | 'unverified';
 supportsXlsxInput: boolean | 'unverified';
 supportsHostedFileSearch: boolean | 'unverified';
 supportsCodeInterpreter: boolean | 'unverified';
 smokeTestStatus: 'passed' | 'failed' | 'untested';
 enabled: boolean;
}
```

規則：

- 預設顯示 `openharness_chatgpt_oauth` 已登入 OAuth 並通過 smoke test 的模型。
- `openai_api` 顯示後端允許且 API key/project policy 可用的模型，作為 fallback 或手動切換。
- 未通過 tool calling / structured output smoke test 的模型不得進報價 runtime。
- 未通過 file / vision / XLSX smoke test 的模型不得處理附件報價，只能處理純文字或轉 fallback。

### 6.8 用量、成本與 limit 規則

- OAuth subscription access 可作為預設 runtime，但不得假設存在可靠的 `remaining quota` 查詢 API。
- 使用者提出的 `5h/week limit` 可列為 operational assumption / observed behavior，不可寫成已由 OpenAI 官方 API 文件保證的規格。
- API fallback 不是「沒有額度限制」；API 是 usage-based，會受 rate limits、usage limits、budget、billing 與組織/project policy 影響。
- app 必須處理 `subscription_limit_reached`、`rate_limited`、`usage_limit_reached`、`billing_unavailable`、`api_key_missing` 類錯誤。
- 對使用者顯示用量時，OAuth 顯示「subscription driver 狀態 / 最近錯誤 / 是否 fallback」，API 顯示「token usage / estimated cost / rate limit headers / budget status」。

### 6.9 環境設定

```env
STEEL_AI_DRIVER_DEFAULT=openharness_chatgpt_oauth
STEEL_AI_DRIVER_FALLBACK=openai_api
STEEL_OPENHARNESS_CHATGPT_ENABLED=true
STEEL_OPENHARNESS_CHATGPT_PROVIDER_VERSION_PIN=0.1.x
STEEL_OPENHARNESS_TOKEN_STORE=local_encrypted_file
STEEL_OPENAI_API_FALLBACK=true
STEEL_OPENAI_API_KEY_REQUIRED_FOR_PRODUCTION=true
STEEL_ALLOWED_MODEL_PROVIDER=openai_oauth,openai_api
STEEL_ENABLE_MULTI_PROVIDER=false
STEEL_FALLBACK_ON_FILE_INPUT_UNSUPPORTED=true
STEEL_FALLBACK_ON_VISION_INPUT_UNSUPPORTED=true
STEEL_FALLBACK_ON_XLSX_INPUT_UNSUPPORTED=true
STEEL_FALLBACK_ON_HOSTED_TOOL_UNSUPPORTED=true
```

local / dev 預設啟用 OAuth driver；正式部署需在 production checklist 確認 OAuth provider 授權、商用條款、token 儲存、錯誤處理、capability smoke test 與 fallback。OPENAI_API_KEY fallback 必須保留。

---

## 7. MongoDB / Supabase PostgreSQL 分工

### 7.1 MongoDB

沿用 LibreChat：

- users
- conversations
- messages
- agents
- files
- roles
- groups
- ACL resources

新增 collections 全部用 `steel_` 前綴：

- steel_conversation_meta
- steel_projects
- steel_project_sources
- steel_source_versions
- steel_project_instructions
- steel_instruction_versions
- steel_memory_candidates
- steel_memories
- steel_memory_events
- steel_memory_conflicts
- steel_workbooks
- steel_workbook_patches
- steel_ai_runs
- steel_tool_calls
- steel_excel_exports
- steel_admin_import_sessions
- steel_admin_merge_tables
- steel_admin_mapping_profiles
- steel_import_logs
- steel_audit_logs

MongoDB 保存：

- 對話 meta、guest token hash、AI provider id audit。
- Workbook JSON 與 patch history。
- Project Sources / Instructions metadata。
- ERP XLSX import metadata、future handbook import provenance、Admin table edit metadata。
- 報價對話附件 evidence metadata。
- Admin import session / preview / merge table。
- Memory Candidate / System Memory。
- Tool calls、AI provider runs、Excel export records、Audit logs。

### 7.2 Supabase PostgreSQL

使用 private `steel` schema。Supabase PostgreSQL 保存結構化業務資料與 pgvector。

建議 tables：

- steel.customers
- steel.customer_aliases
- steel.customer_tiers
- steel.price_items
- steel.price_categories
- steel.price_rule_conditions
- steel.weight_specs
- steel.material_rules
- steel.processing_prices
- steel.cutting_prices
- steel.cutting_price_adjustments
- steel.hole_prices
- steel.slotting_prices
- steel.bending_prices
- steel.orders
- steel.order_items
- steel.source_chunks
- steel.source_embeddings
- steel.formula_versions
- steel.import_rule_notes
- steel.price_history

結構化資料原則：

- 價格、重量、加工正式查詢只讀 Supabase PostgreSQL。
- Memory 不提供價格，不覆蓋價格。
- 資料匯入引發價格異動時寫入 `steel.price_history`。
- pgvector 僅用於 source chunks / rules retrieval，不替代 deterministic 查價。

---

## 8. 固定資料來源與鋼鐵規則

本節定義系統需支援的來源類型。ERP 匯出的 XLSX 是正式 Admin 匯入來源。鋼鐵手冊 DOCX 先作真實 schema/data-model 設計參考，用來確認重量、標準規格、材料規則與 source refs 的資料形狀；真實 data SQL 匯入後續再實作。後續 Admin 網頁不需要上傳 DOCX。

### 8.1 客戶資料.xlsx

用途：

- 客戶資料與單價分級。
- 報價前先比對客戶並取得分級。
- 客戶不明、多筆相似或分級不明時標低信心。

正式 import：

```text
Admin 上傳 ERP export XLSX
 -> preview parsed data
 -> AI 協助 mapping
 -> 後端驗證
 -> Admin confirm
 -> steel.customers / steel.customer_aliases / steel.customer_tiers
```

### 8.2 產品價格.xlsx

用途：

- 產品規格單價、材料單價。
- 孔加工、切工、開槽、折工等加工單價。

規則：

- 報價前必須優先搜尋匯入後的 `steel.price_items` / processing tables。
- 找不到完全匹配不可硬套。
- 找到完全匹配時，依客戶分級取該列單價。
- 不可用手冊重量取代價格表單價。

### 8.3 龍頂鋼鐵手冊_文字版.docx

用途：

- 產品規格與單位重量來源。
- 包含 H 型鋼、C 型鋼、槽鐵、工字鐵、角鐵、扁鐵、方鋼、圓鋼、管材、鋼板等。
- 只作重量、標準規格、尺寸對照來源。
- 不可取代產品價格表單價來源。

schema/data-model 設計：

- Code agent 依手冊內容盤點需要的欄位與關係。
- 手冊內容可用來制定真實 Supabase schema/data model，不只是 mock fixture 來源。
- `tasks/v8.2/source-schema-mapping.md` 記錄中文來源 label/header/term 到英文 canonical schema key 的對應。
- 不建立 `review_status` / `corrected_text` 這類筆誤審核欄位；後續 code agent 討論 data SQL/import 時，輸入應已是正確資料。
- 同步設計 code 版 mapping，供 backend prompt/tool/schema 使用。
- AI API 透過 mapping context 對應正確 schema key；未知 key 追問或進人工複核，不得自行發明。
- 用手冊內容檢查 `steel.weight_specs` / `steel.material_rules` / `steel.import_rule_notes` / `steel.source_chunks` 是否足夠。
- 只在 schema/data model 缺漏時修改 Supabase schema/migration。
- 不在 chat UX 優先階段實作真實手冊 data SQL import。
- 後續 Admin 網頁透過 web fetch data + table UI preview/edit 維護資料，不需要上傳 DOCX。

### 8.4 龍頂鋼鐵手冊.pdf

Admin Import 不接受手冊 PDF。若業務需要匯入手冊內容，v8.2 先以鋼鐵手冊 DOCX 制定 schema/data model；PDF 不進 Admin web upload path，真實手冊 data SQL import 後續再做。

正式重量查詢以 `steel.weight_specs` 為主。PDF 可作人工參考或對話附件 evidence，但不能由 Admin 匯入流程直接解析或寫入正式資料表。

### 8.5 H 型鋼規則文字來源

用途：

- H 型鋼常規 / 非常規米數規則。

規則：

- H 型鋼常規米數：6M、9M、10M、12M。
- H 型鋼非常規米數：7M、8M、11M、13M、14M、15M。
- 非常規米數單價 = 一般米數單價 + 0.3 元/kg。

正式更新：

- Admin Import 不接受 `.txt`。
- 若此規則屬於鋼鐵手冊內容，先用手冊內容確認 schema/data model；真實資料寫入後續再做。
- 後續調整透過 Admin table UI fetch/edit/review/save，不透過 DOCX upload。

### 8.6 切工價錢.pdf

Admin Import 不接受切工價錢 PDF。若要匯入切工價格，Admin 必須上傳整理好的 XLSX。

正式查價以 Supabase cutting tables 為主。PDF 只作人工參考或報價對話附件 evidence，不是資料維護來源。

### 8.7 系統訂單.xlsx

用途：

- 系統訂單輸出格式範例。
- 作為 Excel「系統訂單」分頁欄位與格式參考。
- 不作為價格或重量來源。

正式更新：

- Admin 上傳 approved XLSX 或透過 table UI 維護。
- Admin preview 欄位格式。
- 可轉成 `system_order_export_schema` 設定。
- 不寫入價格表。

### 8.8 資料優先順序

```text
使用者本次明確規則
> 圖面清楚標註
> 圖面底部表格 / 材料表
> 系統訂單.xlsx 格式要求
> 客戶資料.xlsx
> 產品價格.xlsx
> 手冊內容驗證後的 schema/data model 與後續匯入資料
> 切工價格 XLSX 匯入後且 Admin 確認的資料
> H 型鋼規則由後續手冊資料匯入或 table UI 確認後資料
> 推定
```

圖面與底表不一致，以圖面為主並標低信心。

---

## 9. ERP XLSX Import, Handbook Schema Design, And Table Maintenance

### 9.1 Source Manifest

```ts
export interface SourceManifest {
 id: string;
 projectSourceId: string;
 originalFileId: string;
 originalFilename: string;
 originalFileType: 'xlsx';
 sourceCategory:
   | 'customer_data'
   | 'product_price'
   | 'manual'
   | 'cutting_price'
   | 'system_order_format'
   | 'drawing'
   | 'rule_note'
   | 'other';
 parseVersion: number;
 parseStatus: 'pending' | 'processing' | 'ready_for_review' | 'confirmed' | 'failed';
 adminReviewStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
 parseNotes?: string;
 createdAt: string;
 updatedAt: string;
}
```

### 9.2 Admin ERP XLSX Upload Rules

```text
Admin selects source type / target table
 -> Admin uploads ERP export XLSX
 -> backend rejects DOCX/PDF/image/text uploads
 -> parser creates preview rows
 -> backend fetches matching old data
 -> Admin reviews parsed data
 -> AI helps mapping / merge table data only
 -> backend validates valid / invalid / needs_review
 -> Admin confirms
 -> Supabase transaction
```

Allowed Admin source files:

- `.xlsx`

Rejected Admin source files:

- `.docx`
- `.pdf`
- scanned PDF
- image PDF
- image files
- screenshots

Rejection message: "Admin ERP import only accepts XLSX. DOCX handbook handling is a schema-design reference, not an Admin upload path; please prepare ongoing source data as ERP XLSX."

### 9.3 Steel Handbook Schema Design

```text
Code agent inspects handbook DOCX content
 -> identifies spec/weight/rule/source-ref fields
 -> adjusts schema/data model if needed
 -> defers real handbook data SQL import
```

This path is not exposed as an Admin web upload and does not require a reusable parser in `packages/api`. Runtime AI does not write handbook data directly to the database. The chat UX and workbook vertical slice remain higher priority than real handbook data SQL import.

### 9.4 Admin Table Maintenance

```text
Admin opens table maintenance page
 -> web fetches existing database rows
 -> table UI shows preview/edit/diff
 -> backend validates edits
 -> Admin confirms
 -> audited Supabase transaction
```

This is the ongoing maintenance path after initial XLSX import and after any future handbook data SQL import.

---

## 10. Steel Project、Sources 與 Instructions

Steel Project 是報價上下文集合，包含 sources、instructions、memories、retrieval filters。

Source lifecycle：

```text
uploaded -> parsed -> reviewed -> active
active -> inactive
active -> deleted
```

Source versioning：

```ts
export interface SteelSourceVersionDraft {
 sourceId: string;
 originalFileId: string;
 sourceFileType: 'xlsx';
 parseVersion: number;
 parseStatus: 'pending' | 'processing' | 'ready_for_review' | 'confirmed' | 'failed';
 adminReviewStatus: 'pending' | 'approved' | 'rejected';
 extractionSummary: {
   rowCount?: number;
   tableCount?: number;
   paragraphCount?: number;
   lowConfidenceCount: number;
 };
}
```

當 Admin 修改 ERP XLSX 並重新上傳：

- 建立新的 source version。
- 舊版本保留 inactive。
- 不覆蓋舊版本。

鋼鐵手冊 DOCX 的真實資料匯入需要新的開發決策與 review，不作為一般 Admin web 操作，也不要求 reusable parser。

---

## 11. Steel Tool Registry

AI provider 不直接操作 MongoDB / Supabase PostgreSQL。AI provider 只能呼叫後端白名單 business tools。

禁止 tools：

- `run_mongo_query`
- `run_postgres_query`
- `execute_raw_sql`
- `read_file`
- `list_directory`

允許 tools：

- `lookup_customer`
- `search_customers`
- `search_orders`
- `get_order_detail`
- `normalize_quote_item`
- `generate_price_search_terms`
- `search_price_candidates`
- `rank_price_candidates`
- `lookup_spec_price`
- `lookup_weight_spec`
- `lookup_cutting_price`
- `lookup_processing_price`
- `allocate_stock_lengths`
- `calculate_plate_weight`
- `calculate_bar_weight`
- `calculate_cutting_fee`
- `calculate_hole_fee`
- `calculate_slotting_fee`
- `calculate_bending_fee`
- `calculate_line_total`
- `parse_xlsx_source`
- `search_project_sources`
- `search_relevant_memories`
- `get_workbook`
- `apply_workbook_patch`
- `create_memory_candidate`
- `update_memory_candidate`
- `export_workbook`
- `export_workbook_sheets`
- `admin_import_generate_merge_table`
- `admin_import_apply_merge_patch`

每個 tool 必須：

1. 使用 Zod 驗證輸入。
2. 加入 conversation access check。
3. 加入 user / guest 權限檢查。
4. 後端查 MongoDB / Supabase PostgreSQL。
5. 後端欄位 allowlist。
6. Tool result 過濾 prompt injection 字串後再回傳給 AI provider。
7. 回傳標準 tool result。
8. 記錄 `steel_tool_calls`。
9. 設定每 run 呼叫次數上限。

---

## 12. Steel AI Orchestrator 與 Prompt Bundle Builder

位置：

```text
packages/api/src/steel/ai
packages/api/src/steel/ai/providers/openharness-chatgpt-oauth
packages/api/src/steel/ai/providers/openai-api-fallback
packages/api/src/steel/prompt
```

流程：

1. 接收 conversation message。
2. 驗證 optional `selectedWorkbookRefs` 是否符合目前 workbook/version/sheet/row/column。
3. 取得 selected model 與 `STEEL_AI_DRIVER`。
4. 讀取 `steel_conversation_meta`。
5. 建立或讀取 provider session trace；OpenHarness session id / OpenAI conversation id 只作 runtime trace。
6. 組 Prompt Bundle。
7. 呼叫 selected `SteelAIProvider.run(input)`。
8. 將 OpenHarness / OpenAI provider events 統一轉成 `SteelAIEvent`。
9. 處理 tool calling loop；所有 tool calls 仍由 Steel backend 驗證與執行。
10. 處理 structured outputs。
11. 寫入 `steel_ai_runs`。
12. 更新 `steel_conversation_meta.aiProviderMeta`。
13. 回寫 workbook patch / memory candidate / merge table patch。

Provider interface：

```ts
export interface SteelAIProvider {
  id: 'openharness_chatgpt_oauth' | 'openai_api';
  listModels(input: SteelListModelsInput): Promise<SteelModelOption[]>;
  smokeTest(input: SteelProviderSmokeTestInput): Promise<SteelProviderSmokeTestResult>;
  run(input: SteelAIRunInput): AsyncIterable<SteelAIEvent>;
}

export interface SteelAIRunInput {
  conversationId: string;
  steelConversationMetaId: string;
  model: string;
  messages: SteelMessage[];
  systemPrompt: string;
  tools: SteelToolDefinition[];
  selectedWorkbookRefs?: SelectedWorkbookRef[];
  contextRefs: PromptContextRefs;
  metadata: {
    userId?: string;
    guestAccess?: boolean;
    workbookId?: string;
  };
}

export type SteelAIEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'tool.call'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool.result'; toolCallId: string; result: unknown }
  | { type: 'structured.output'; output: unknown }
  | { type: 'final'; responseId?: string }
  | { type: 'error'; category: string; message: string };
```

OpenHarness provider acceptance：

- OpenHarness client / session 可 injectable，測試不打真實 OAuth provider。
- OAuth login / token store 不寫入 frontend localStorage；server-side encrypted store 或 local dev file only。
- 完成 `docs/steel-chatgpt-oauth-setup.md` 前，不得執行真 OpenHarness provider smoke 或 Steel chat UI live test。
- CLI `--chatgpt` 只能作參考；Web localhost chat 需明確實作 server route adapter。
- 必測 smoke cases：純文字聊天、tool call、structured output、streaming、workbook patch、file evidence input。
- 若 OAuth driver 不支援 file input / vision input，必須回傳 typed error，不得靜默降級。
- Runaway tool loop 有 typed error 與 audit。
- Invalid structured output 不修改 workbook。
- 所有 tool calls 寫入 `steel_tool_calls`。
- 至少一個 manual live smoke test 使用 OpenHarness OAuth 建立 customer-visible workbook。
- 至少一個 manual live smoke test 使用官方 OpenAI API fallback 建立 customer-visible workbook。

OpenAI API fallback acceptance：

- 實作前校正官方 Responses API type。
- `conversation` call pattern 有 live smoke test。
- `previousResponseId` 只 audit，不與 conversation 同傳。
- tool calling loop 有 max call guard。
- structured output invalid 時不修改 workbook。

---

## 13. Quote Resolution Engine

位置：

```text
packages/api/src/steel/quote
packages/api/src/steel/normalization
packages/api/src/steel/pricing
packages/api/src/steel/calculators
```

核心流程：

```text
resolve_customer_tier
 -> normalize_quote_item
 -> generate_price_search_terms
 -> search_price_candidates
 -> rank_price_candidates
 -> quote_price_decision
 -> deterministic calculations
 -> quote_trace
 -> workbook_line
```

價格先於重量：

- 除非使用者明確提供單價，材料或加工品項必須先搜尋價格資料。
- 找候選品項後依客戶分級與該品項計價單位取價。
- 再查手冊取得重量與規格。
- 手冊重量只能用於計算重量、比對規格、或價格明確為 kg 單價時輔助計價。
- 不可用手冊重量直接推材料售價。

---

## 14. Product Price Candidate Search & Ranking

### 14.1 Price Candidate Interface

```ts
export interface PriceCandidate {
 id: string;
 sourceTable:
   | 'price_items'
   | 'processing_prices'
   | 'cutting_prices'
   | 'hole_prices'
   | 'slotting_prices'
   | 'bending_prices';
 productName: string;
 specKey?: string;
 materialGrade?: string;
 surfaceTreatment?: string;
 sizeText?: string;
 lengthM?: number;
 unit: 'kg' | '支' | '片' | '孔' | '刀' | 'M' | '式' | string;
 unitPrice: number | '未確認';
 currency: 'TWD';
 customerTierId?: string;
 matchType: 'exact_match' | 'major_match' | 'alias_match' | 'closest_estimate' | 'no_price';
 matchScore: number;
 differences: string[];
 rejectedReason?: string;
 sourceRefs: SourceRef[];
}

export interface SourceRef {
 sourceType: 'database' | 'future_handbook_import' | 'admin_erp_xlsx' | 'admin_table_ui' | 'chat_pdf_evidence' | 'manual';
 tableName?: string;
 rowId?: string;
 fileId?: string;
 filename?: string;
 sheetName?: string;
 pageNo?: number;
 bbox?: string;
}
```

### 14.2 Search Terms

`generate_price_search_terms` 不可只用原始品名搜尋一次。必須展開：

- 原始品名
- 標準化品名
- 俗稱 / 同義詞
- 英吋換算
- 外徑近似值
- 尺寸近似值
- 材質別稱
- 表面處理別稱
- 長度
- 單位
- 加工關鍵字

### 14.3 Ranking

匹配類型：

- `exact_match`：類別、材質/表面、尺寸、厚度、長度、單位、客戶分級皆一致。
- `major_match`：類別、尺寸、厚度大致一致，但長度、表面或單位略有差異。
- `alias_match`：口語轉換匹配。
- `closest_estimate`：相近暫估。
- `no_price`：無價格。

決策規則：

- 找到完全匹配時，必須依該列計價單位計算。
- 不可把單支價改成 kg 價。
- 不可把 kg 價改成單支價。
- 不可把尺價、片價、孔價、刀價、M 價、式價自行轉成其他單位。
- 價格為 0 不可填 0，應標「未確認」或找相近有價品項暫估並低信心。
- 找不到價格則單價與金額填「未確認」。

### 14.4 Quote Trace

```ts
export interface QuoteTrace {
 originalItemName: string;
 normalizedItemName: string;
 searchTerms: string[];
 priceCandidates: PriceCandidate[];
 selectedPriceCandidate?: PriceCandidate;
 unitPrice: number | '未確認';
 unitPriceField?: string;
 pricingUnit?: string;
 customerTierId?: string;
 exactMatch: boolean;
 rejectedCandidateReasons: string[];
 differenceSummary: string[];
 confidenceLevel: 'high' | 'medium' | 'low';
 lowConfidenceReason?: string;
 sourceRefs: SourceRef[];
}
```

---

## 15. Customer Tier Resolver

`resolve_customer_tier` 功能：

- 比對客戶名稱、別名、案場常見資料。
- 從 `steel.customers` / `steel.customer_aliases` / `steel.customer_tiers` 取得分級。
- 客戶不明、多筆相似、分級不明時標低信心。

Acceptance：

- Exact customer match 回傳 tier。
- Alias match 回傳 tier 並記錄 alias source。
- 多筆相似回傳 candidates，不猜。
- 客戶未知時 workbook line 可建立，但價格決策低信心。

---

## 16. Material Normalization Dictionary

字典需支援：

- 類別：板材、型鋼、角鐵、槽鐵、扁鐵、圓鐵、方鋼、圓管、方管、扁方管、網材、門窗、浪板、加工等。
- 材質/表面：黑鐵、白鐵、不鏽鋼、鍍鋅、錏、鋁鋅、彩色、烤漆、熱浸鍍鋅等。
- 尺寸：公制尺寸、英吋、俗稱尺寸、外徑近似值、厚度、長度、寬度、高度。

常見轉換：

- 1 英吋約 25mm。
- 1 英半 / 1 1/2 約 38mm 或管外徑約 48.3mm。
- C75 常對應 C75x45x15。
- C100 常對應 C100x50x20。
- L38 常對應 38x38 角鐵。
- 黑圓管 48.1 需同時搜尋：黑圓管、黑管、黑A、黑B、黑AB圓管、1 1/2、48.3。
- 角鐵需同時搜尋：角鐵、三角鐵、英吋、mm 尺寸。
- 浪板需同時搜尋：顏色、材質、板型、用途。
- 網材需搜尋：線徑、孔距、網片、點焊網。

口語轉換只代表候選，不代表完全匹配。厚度、材質、長度、單位或表面處理不明時信心低。

---

## 17. Stock Allocation Engine

適用：

- 角鐵、扁鐵、槽鐵、工字鐵、圓鐵、方鋼、管材、方管、扁方管、其他長條料。

規則：

- 若客戶要裁切長度，除非使用者明確說可切清，否則一律視為「不賣切清」。
- 材料費不可直接用成品淨長重量計算。
- 必須依可售素材長度配料後計價。
- 價格表素材長度、素材規格、單支價或素材重量為主要計價依據。
- 無明確素材長度時暫以 6M 素材估算，並標低信心。

輸出：

```ts
export interface StockAllocationResult {
 stockLengthMm: number;
 stockPieceCount: number;
 finishedPiecesPerStock: number;
 requiredFinishedPieceCount: number;
 producedFinishedPieceCount: number;
 remainderLengthMm: number;
 remainderWeightKg?: number;
 algorithm: 'first_fit' | 'single_length_exact' | 'six_meter_estimate';
 confidenceLevel: 'high' | 'medium' | 'low';
 lowConfidenceReason?: string;
}
```

---

## 18. Deterministic Calculation Engine

AI 負責判讀資料與產生候選；後端 deterministic calculator 負責計算。

### 18.1 calculate_plate_weight

```text
單片重量 kg = 最長邊 mm x 最寬邊 mm x 厚度 mm x 密度 / 1,000,000
```

- 黑鐵 / 碳鋼密度 7.85。
- 不鏽鋼密度 7.93。
- 異形、切角、沖孔、折板先用外包四方尺寸。
- 有展開尺寸則優先用展開尺寸。

### 18.2 calculate_bar_weight

```text
總重 = kg/m x 長度 m x 數量
```

- 2C 表示兩支組合時，重量與數量需乘 2。

### 18.3 calculate_cutting_fee

```text
切工費 = (切工單價 + 加價) x 切工次數 x 對應數量
```

- 一個切口預設 1 次。
- 對半切不修頭尾 = 中間 1 刀。
- 修頭尾 = 頭修 1 刀 + 中間切 1 刀 + 尾修 1 刀 = 3 刀。
- 出現「修」「修頭」「修頭尾」「+修」不可只算中間切斷。
- 若產品價格表有明確加工品項，優先用該品項。

### 18.4 calculate_hole_fee

- 孔數必須從圖面孔位判斷，不可只依底部表格。
- `4-Ø22` = 每片 4 孔。
- 1 個圓孔或長孔算 1 孔，除非規則另定。
- 總孔數 = 每片 / 每支孔數 x 數量。
- 中心線、尺寸線、虛線、R角、折線、切角、焊接符號不可誤判為孔。

### 18.5 calculate_slotting_fee

```text
開槽費 = 總開槽 M x 元/M
```

- 開槽看需開槽的連續邊長，不看零件總長。
- L 型兩段相加。
- U / ㄇ 型三段相加。
- 多條不相連路徑分別加總。
- 路徑不明不可當 0，需低信心。

### 18.6 calculate_bending_fee

```text
折工費 = 總重 kg x 折刀數 x 元/kg/刀
```

- 折刀數 = 鐵板每一次方向改變。
- L、U/ㄇ、Z 型、折返、水平轉垂直、水平轉斜面、垂直轉斜面都算。
- 尺寸線、中心線、孔線、外框、切角、開槽不可誤判為折線。

### 18.7 calculate_line_total

```text
小計 = 材料費 + 切工費 + 孔加工費 + 開槽費 + 折工費 + 其他明確加工費
```

- 確定費用與低信心暫估費用分開彙總。
- 未確認單價或金額不可填 0。

---

## 19. AI-first Vision / OCR / File Evidence Pipeline

此 pipeline 只用於報價對話中的圖面/圖片/PDF/XLSX evidence，不屬於 Admin data import。Admin ERP 匯入只接受 XLSX；鋼鐵手冊 DOCX 是 schema/data-model reference，不是 Admin web upload。

本版原則：

```text
OpenAI / AI provider 做主判讀。
Node/backend 不做主 OCR、不做主圖面判讀、不用自製 Excel parser 取代 AI evidence。
Node/backend 必須做檔案接收、provider file ref、tool runtime、安全、驗證、audit、fallback。
```

所有圖片、掃描 PDF、拍照圖面、訂單截圖、手寫單、材料表圖片，在讀文字前必須先由 AI 判斷方向；若需要裁切、旋轉、放大、影像處理，優先使用 OpenAI Code Interpreter / hosted tool capability 或 vision-capable model，而不是在 Node app 寫業務判讀 parser。

流程：

1. upload file / image to LibreChat / Steel backend。
2. backend 檢查檔案型別、大小、權限、tenant boundary、retention policy。
3. backend 建立 source file metadata，並依 driver 建立 provider 可用 file ref：OpenAI file id、signed URL、base64 part 或 provider-specific file part。
4. SteelAIProvider 根據 capability matrix 選擇 driver；預設 OAuth，file / vision / XLSX 未通過則 fallback 到 `openai_api`。
5. AI 判斷方向：0 / 90 / 180 / 270。
6. AI 判斷 visual layout：table / drawing / handwritten / mixed。
7. AI 判讀 OCR / vision：孔洞、長孔、開槽、折線、切角、切工標註、底表與圖面不一致處。
8. AI 需要業務資料時產生 tool call：customer lookup、price lookup、weight spec lookup、cutting price lookup、workbook read / patch proposal。
9. Node/backend 執行 tool、驗證 args、查 DB、sanitize tool output，再回給 AI。
10. AI 產生 structured intermediate result、報價明細、低信心原因、evidence refs、workbook patch proposal。
11. Node/backend 驗證 workbook patch、公式、單價來源、不可填 0 規則、七分頁 schema；通過才寫入 workbook truth。
12. never write formal source tables without Admin ERP XLSX import, reviewed table UI edit, or a future approved handbook data SQL import。

低信心條件：

- OCR 破碎、欄位錯位、解析度低、反光、模糊、裁切。
- 手寫遮住、方向不明、OCR 與 vision 不一致。
- 孔洞、開槽、折線、切角、尺寸不清。
- OAuth driver 未通過 file / vision / XLSX smoke test，但仍以輔助 context 使用。
- OpenAI API fallback 不可用、file id 建立失敗、hosted tool 不可用。

禁止：

- 因為 Node/backend 沒有 OCR parser 就略過圖面判讀。
- 用 Node OCR/parser 結果覆蓋 AI vision 判斷。
- 把 OpenHarness / Vercel AI SDK 的一般 file part 能力視為已完成鋼鐵圖面判讀。
- 在 custom backend tool 中直接接受 raw SQL / raw Mongo query。

---

## 20. Drawing Interpretation Schema

```ts
export interface DrawingInterpretation {
 sourceFileId: string;
 pageNo: number;
 rotationApplied: 0 | 90 | 180 | 270;
 ocrText: string;
 visionNotes: string[];
 detectedTables: DetectedTable[];
 detectedHoles: DetectedHole[];
 detectedBends: DetectedBend[];
 detectedSlots: DetectedSlot[];
 detectedCutMarks: DetectedCutMark[];
 confidence: 'high' | 'medium' | 'low';
 manualReviewReason?: string;
}

export interface DetectedHole {
 partNo?: string;
 diameterMm?: number;
 countPerPiece: number | '未確認';
 evidence: SourceRef[];
 confidence: 'high' | 'medium' | 'low';
}

export interface DetectedBend {
 partNo?: string;
 bendCount: number | '未確認';
 bendPositions: string[];
 evidence: SourceRef[];
 confidence: 'high' | 'medium' | 'low';
}

export interface DetectedSlot {
 partNo?: string;
 totalLengthM: number | '未確認';
 pathDescription: string;
 evidence: SourceRef[];
 confidence: 'high' | 'medium' | 'low';
}

export interface DetectedCutMark {
 partNo?: string;
 cutCount: number | '未確認';
 repairHeadTail: boolean;
 evidence: SourceRef[];
 confidence: 'high' | 'medium' | 'low';
}

export interface DetectedTable {
 tableType: 'material_list' | 'dimension_table' | 'price_table' | 'unknown';
 rows: Array<Record<string, string>>;
 evidence: SourceRef[];
 confidence: 'high' | 'medium' | 'low';
}
```

---

## 21. Workbook JSON Engine

Workbook JSON 是主資料，XLSX 是 ExcelJS 根據 Workbook JSON 產生的輸出。

Contract ownership:

- `packages/data-provider/src/steel/workbooks.ts` owns the public DTO/type surface for workbook JSON, selected workbook refs, patch request/response, changed paths, and changed-field summaries.
- `packages/api/src/steel/workbook/schema.ts` owns canonical Zod validation and can reject DTO-shaped payloads that violate runtime rules such as access, version, allowed path, formula, protected field, or concurrency checks.
- Frontend components and hooks consume DTOs/API responses and do not duplicate workbook validation schema.

```ts
export interface SteelWorkbook {
 id: string;
 steelConversationMetaId: string;
 userId?: string;
 guestAccess?: boolean;
 currentWorkbookJson: WorkbookJson;
 versionSeq: number;
 status: 'draft' | 'exported' | 'closed';
 createdAt: string;
 updatedAt: string;
 lastAIRunId?: string;
}

export interface WorkbookJson {
 schemaVersion: 'steel-workbook-v1';
 sheets: {
   quoteDetails: WorkbookLine[];
   summary: WorkbookSummary;
   manualReviewItems: ManualReviewItem[];
   priceSources: PriceSourceRow[];
   interpretationNotes: InterpretationNote[];
   systemOrder: SystemOrderRow[];
   customerQuote: CustomerQuoteRow[];
 };
}

export interface WorkbookLine {
 id: string;
 pageNo?: number;
 partNo?: string;
 itemName: string;
 originalItemName: string;
 normalizedItemName: string;
 spec?: string;
 quantity: number;
 unit: string;
 materialCategory?: string;
 materialGrade?: string;
 dimensionsText?: string;
 formulaCode: string;
 formulaVersionId: string;
 calculationBasis: 'database_default' | 'user_unit_price' | 'user_line_total' | 'manual_unconfirmed';
 defaultUnitPrice: number | '未確認';
 quotedUnitPrice: number | '未確認';
 lineTotal: number | '未確認';
 adjustmentSource: 'database_default' | 'user_unit_price' | 'user_line_total';
 adjustmentReason?: string;
 confidenceLevel: 'high' | 'medium' | 'low';
 lowConfidenceReason?: string;
 quoteTrace: QuoteTrace;
 priceSourceRefs: SourceRef[];
 weightSourceRefs: SourceRef[];
}
```

Selected workbook refs：

```ts
export interface SelectedWorkbookRef {
 workbookId: string;
 versionSeq: number;
 sheetId:
   | 'quote_details'
   | 'summary'
   | 'manual_review'
   | 'price_sources'
   | 'interpretation_notes'
   | 'system_order'
   | 'customer_quote';
 rowId: string;
 columnKey: string;
 label: string;
 currentValue: string | number | boolean | null;
}
```

Phase 3 selection rule：

- UI 每次只允許一個 selected workbook cell。
- Request envelope 保留 `selectedWorkbookRefs: SelectedWorkbookRef[]`，但 Phase 3 驗證 `maxItems = 1`。
- 多處修改不透過 UI 多選；使用者以文字描述多個明確位置，AI 可產生多個 patch ops。
- 若文字描述無法明確定位 sheet / row / column，AI 必須追問或標記人工複核，不得猜 patch path。

Patch rules：

- 使用 JSON Patch RFC 6902。
- patch 必須帶 `targetVersionSeq`。
- 後端做 concurrency check。
- 後端驗證公式與價格一致性。
- 不允許 patch 修改系統欄位。
- 若 patch 修改 `quotedUnitPrice` 或 `lineTotal`，後端必須依 `formulaVersionId` 回算另一欄。
- 既有 workbook line 不因 Supabase 最新價格而自動更新。
- 只有使用者明確要求修改或重算該 line 時才可 patch。
- 使用者從 UI 點選 cell 後送出的 `selectedWorkbookRefs` 可作為明確指定 line/cell 的依據，但 patch 仍需通過 workbook service 欄位 allowlist、版本與公式驗證。
- 一輪對話可產生多個 patch ops，但每個 op 都必須對應明確使用者意圖與合法 workbook path。
- Phase 3 不做每次 patch 前的使用者確認；後端接受 patch 後，patch response 應包含 changed paths / patch id / updated at，讓 workbook UI 用背景色標示最新更新欄位。
- 最新更新欄位背景色必須和目前 selected cell 樣式不同，避免混淆「正在指定」與「剛被更新」。
- 最新更新欄位背景色維持到下一次 accepted workbook patch；新 patch 會替換上一組 highlighted changed paths，而不是累積舊標記。
- Failed / rejected patch response 只回傳使用者可讀的原因，不回傳 latest-update changed paths，不得改 workbook state 或 highlight state。
- Phase 3 不提供 Undo button；`steel_workbook_patches` 保留 audit/history，但還原需求由使用者透過 chat 提出，AI 產生新的 validated patch。
- 前端不得用 undo/rollback 直接改 workbook JSON 或繞過 patch service。
- Accepted patch response 應提供 concise summary items：sheet label、row label、field label、previous value、new value，供 chat 顯示短摘要；chat 不顯示完整 diff table。

---

## 22. Excel Export Engine

使用 ExcelJS 產生 XLSX。

每份報價 Workbook 至少包含七個分頁：

1. 報價明細
2. 總結
3. 人工複核清單
4. 價格來源
5. 判讀備註
6. 系統訂單
7. 給客戶用

所有分頁格式：

- 開篩選。
- 凍結首列。
- 欄寬自動或合理設定。
- 金額整數。
- 重量保留 2 位。
- 未確認單價或金額不可填 0，顯示「未確認」。

支援匯出：

- 完整 Workbook。
- 指定分頁。
- 給客戶用分頁。
- 系統訂單分頁。

---

## 23. Customer Quote Sheet Mask

```ts
export interface CustomerQuoteRow {
 itemName: string;
 spec?: string;
 quantity: number;
 unit: string;
 unitPrice: number | '未確認';
 subtotal: number | '未確認';
 customerNote?: string;
 pendingConfirmation?: string;
}
```

允許欄位：

- 品名
- 規格
- 數量
- 單位
- 單價
- 小計
- 客戶可讀備註
- 待確認提示

禁止欄位：

- 客戶分級
- 內部成本
- 價格來源細節
- 搜尋關鍵字
- 候選品項
- 未採用原因
- AI 判斷備註
- 低信心內部原因
- 人工複核內部欄位
- source refs
- admin notes
- margin
- internal_cost

後端以 allowlist 產生，不接受 AI 指定欄位。

---

## 24. System Order Export Schema

```ts
export interface SystemOrderRow {
 companyCode?: string;
 lineNo: number;
 warehouseCode?: string;
 modelNo?: string;
 productSpec: string;
 materialCode?: string;
 factoryCode?: string;
 unit: 'Kg' | '支' | '片' | '孔' | '刀' | 'M' | '式' | string;
 quantity: number | '未確認';
 unitWeight?: number | '未確認';
 totalQuantity?: number | '未確認';
 unitPrice: number | '未確認';
 pricingBasis: string;
 formulaCode?: string;
 thicknessMm?: number;
 widthMm?: number;
 lengthMm?: number;
 category?: string;
 deliveryDate?: string;
 remark?: string;
 confidenceLevel: 'high' | 'medium' | 'low';
}
```

規則：

- 每一筆可進系統的材料或加工項目輸出一列。
- 材料列與加工列分開。
- 單位依品項填 Kg、支、片、孔、刀、M、式等。
- 不明填「未確認」。
- 單價必須來自正式價格表、Admin 匯入的切工/加工資料，或使用者明確提供。
- 未確認不可填 0。
- 無法可靠轉成系統訂單格式仍需列入，但信心標低並備註原因。

---

## 25. Admin ERP XLSX Import / Table UI / AI Merge Table

正式 ongoing Admin Import 入口只接受 ERP XLSX parsed data。鋼鐵手冊 DOCX 處理是 schema/data-model reference，不是 Admin 網頁上傳入口，也不是 reusable parser；真實 data SQL import 後續再做。

```ts
export interface AdminSourcePreviewRow {
 id: string;
 sourceManifestId: string;
 originalFilename: string;
 sourceFileType: 'xlsx' | 'table_ui';
 sourcePageNo?: number;
 sheetName?: string;
 originalText: string;
 normalizedFields: Record<string, string | number | boolean | null>;
 fieldMapping: Record<string, string>;
 confidence: 'high' | 'medium' | 'low';
 needsReview: boolean;
 handwrittenFlag: boolean;
 rotationApplied?: 0 | 90 | 180 | 270;
 targetTable: string;
 targetColumns: string[];
 validationStatus: 'valid' | 'invalid' | 'needs_review';
 errorMessage?: string;
 suggestedAction: 'create' | 'update' | 'delete' | 'ignore' | 'needs_review';
}

export interface AdminMergeRow {
 id: string;
 importSessionId: string;
 targetTable: string;
 operation: 'create' | 'update' | 'delete' | 'ignore';
 lookupKey: Record<string, string | number>;
 oldData?: Record<string, string | number | boolean | null>;
 newData: Record<string, string | number | boolean | null>;
 mergedData: Record<string, string | number | boolean | null>;
 validationStatus: 'valid' | 'invalid' | 'needs_review';
 canCommit: boolean;
 errorMessages: string[];
 confidence: 'high' | 'medium' | 'low';
 sourceRefs: SourceRef[];
}
```

AI 負責：

- 判斷 XLSX sheet 用途。
- 判斷 header row。
- 產生 mapping helper。
- 根據 Admin 多輪對話修正 mapping helper。
- 結合 New data 與對應 Old data。
- 產生 merge rows。
- 標記新增、更新、刪除、低信心。
- 產生 merge table patch，只修改 data 內容。

AI 不負責：

- 格式驗證。
- valid / invalid 標記。
- 直接寫入 Supabase PostgreSQL。
- 執行 raw SQL / Mongo query。
- 修改格式驗證規則定義。

程式邏輯負責：

- 全量解析 ERP XLSX。
- 透過 web fetch data 取得 table UI 的 old data。
- 保存原始檔案與解析結果。
- 套用 mapping helper。
- 查找 Supabase PostgreSQL old data。
- 執行欄位格式驗證與 schema 合規檢查。
- 標記 valid / invalid / needs_review。
- Admin confirm 後執行 transaction。
- 只處理 valid rows。
- 寫入 import audit summary。

---

## 26. Memory Candidate / Error Feedback Workflow

```ts
export interface MemoryCandidate {
 id: string;
 type:
   | 'pricing_rule'
   | 'normalization_rule'
   | 'ocr_rule'
   | 'drawing_rule'
   | 'source_import_rule'
   | 'customer_alias_rule'
   | 'material_allocation_rule'
   | 'excel_output_rule'
   | 'system_order_rule';
 title: string;
 proposedRule: string;
 reason: string;
 evidenceConversationMetaId?: string;
 evidenceWorkbookId?: string;
 affectedTools: string[];
 scope: 'global' | 'project' | 'customer' | 'material_type';
 status: 'pending' | 'approved' | 'edited_approved' | 'rejected';
 createdBy: 'ai' | 'admin' | 'user_feedback';
 reviewedBy?: string;
 createdAt: string;
 reviewedAt?: string;
}
```

流程：

```text
user reports mistake
 -> AI explains likely cause
 -> AI proposes correction rule
 -> create_memory_candidate
 -> Admin review
 -> approve / edit / reject
 -> promote to steel_memories or Project Instruction
 -> future retrieval injects relevant memory
```

Memory 不可覆蓋：

- 使用者本輪明確指示。
- Supabase PostgreSQL 查價結果。
- Supabase PostgreSQL 規格重量結果。
- 後端 deterministic 計算結果。

Memory 不提供價格，不覆蓋價格。

---

## 27. Steel Eval Harness

位置：

```text
packages/api/src/steel/evals
├─ cases
├─ expected
├─ fixtures
├─ reports
└─ runners
```

Eval 類型：

1. 文字訂單解析測試。
2. 價格候選搜尋測試。
3. 客戶分級測試。
4. 重量查表測試。
5. 長條料配料測試。
6. Admin upload policy 測試。
7. Admin preview data 測試。
8. 圖面 OCR / vision 測試。
9. 切工計算測試。
10. 孔加工計算測試。
11. 開槽計算測試。
12. 折工計算測試。
13. Excel 匯出測試。
14. 系統訂單輸出測試。
15. 給客戶用分頁遮罩測試。
16. 回歸測試。

Eval runner interface：

```ts
export interface SteelEvalCase {
 id: string;
 type:
   | 'text_order'
   | 'price_search'
   | 'customer_tier'
   | 'weight_lookup'
   | 'stock_allocation'
   | 'admin_upload_policy'
   | 'admin_preview'
   | 'drawing_vision'
   | 'calculation'
   | 'excel_export';
 inputFixturePath: string;
 expectedPath: string;
 requiredAssertions: string[];
}

export interface SteelEvalReport {
 runId: string;
 startedAt: string;
 finishedAt: string;
 passed: number;
 failed: number;
 failures: Array<{
   caseId: string;
   assertion: string;
   expected: string;
   actual: string;
 }>;
}
```

必測規則：

- 價格先於重量。
- 未確認不可填 0。
- 產品價格必須多關鍵字搜尋。
- PDF/DOCX 不能進 ongoing Admin ERP Import；Admin 匯入只接受 ERP XLSX。
- Excel 必須含 7 個必要分頁。
- 給客戶用不含客戶分級與內部資料。

---

## 28. Audit / Trace Logs

所有外部寫入、AI patch、import commit、export download 都要有 audit。

Audit event 類型：

- conversation_created
- guest_token_created
- ai_run_started
- ai_run_failed
- tool_called
- workbook_created
- workbook_patched
- excel_export_created
- excel_export_downloaded
- source_uploaded
- admin_source_rejected
- import_session_created
- import_merge_table_generated
- import_committed
- memory_candidate_created
- memory_candidate_reviewed

Audit 必須包含：

- actor type：user / guest / admin / system
- actor id 或 guest conversation id
- conversation meta id
- workbook id
- source id / import session id / export id
- action
- before / after version 或 summary
- error category
- timestamp

---

## 29. Permissions / Security

### 29.1 Access Rules

- `STEEL_GUEST_MODE=false`：quote conversation/workbook/export 需要登入加 Steel permission。
- `STEEL_GUEST_MODE=true`：guest 可建立 quote conversation/workbook/export，但只限自己的 token。
- Admin pages 永遠 admin-only。
- Source management、import、memory review 永遠 admin-only。
- Guest 永遠不能進 Admin、Source、Instruction、Memory、Import management。

### 29.2 Data Safety

- 禁止 raw SQL / raw Mongo query tools。
- 所有 Supabase SQL 使用 parameterized query。
- Tool output sanitize 後才回 AI provider。
- PDF 不可進 Admin Import 或直接寫正式資料表。
- AI merge patch 不可修改 validation rules。
- Customer export 用後端 allowlist。
- `guestTokenHash` 永不保存 plaintext。

### 29.3 Prompt Injection

需要測試：

- Source chunks 中包含「忽略以上規則」。
- Tool result 中包含 HTML / markdown injection。
- Admin import rows 中包含 prompt injection 文本。
- PDF OCR 結果中包含指令文字。

Expected：

- Sanitizer 標記並包裝為 evidence text。
- Prompt 不把 source text 視為 developer/system instruction。
- AI 不能取得 raw query tool。

---

## 30. Production Checklist

### 30.1 Backend

- [ ] `packages/api/src/steel` 所有新模組為 TypeScript。
- [ ] `/api` route wrapper 保持薄。
- [ ] `packages/data-provider` build 通過。
- [ ] Workbook public DTOs live in `packages/data-provider/src/steel/workbooks.ts`; frontend and mock data consume those DTOs.
- [ ] Backend canonical workbook validation lives in `packages/api/src/steel/workbook/schema.ts`.
- [ ] Client code does not define an independent workbook validation schema.
- [ ] `packages/data-schemas` build 通過。
- [ ] `packages/api` build 通過。
- [ ] Supabase schema snapshot 與 migration 同步。
- [ ] Supabase production TLS / CA policy 完成。

### 30.2 AI Provider / OpenHarness / OpenAI fallback

- [ ] `SteelAIProvider` interface 已抽象化，不讓 Steel Orchestrator 直接依賴 OpenHarness 或官方 OpenAI client。
- [ ] `openharness_chatgpt_oauth` driver 僅作 local PoC / dev runtime，production 需明確風險接受。
- [ ] `@openharness/provider-chatgpt` 版本已 pin，並記錄 experimental 風險。
- [ ] OAuth login / token store 有 server-side 保護；不把 OAuth token 存在 frontend localStorage。
- [ ] `check quota remaining` 不作 OAuth driver 必備功能；OAuth driver 只做 model availability / rate-limit / auth error smoke handling。
- [ ] 若需正式成本、用量、rate limit 查詢，使用 `openai_api` driver + OpenAI Admin API / dashboard。
- [ ] OpenHarness provider 的 tool calling、structured output、streaming event 已轉成 `SteelAIEvent`。
- [ ] OpenHarness provider 的 file input / vision input 支援狀態已 smoke test；未支援時回 typed error。
- [ ] 官方 OpenAI API fallback 仍保留 Responses API live smoke test。
- [ ] `previousResponseId` 只 audit，不與 official `conversation` 同傳。
- [ ] tool calling loop 有 max call guard。
- [ ] structured output invalid 時不修改 workbook。

### 30.3 Quote Engine

- [ ] 價格先於重量有 eval。
- [ ] 缺價格不可填 0。
- [ ] 多關鍵字搜尋有 eval。
- [ ] 客戶分級 resolver 有 ambiguous tests。
- [ ] Stock allocation 不用淨長直接計價。
- [ ] Deterministic calculators 有單元測試。

### 30.4 Workbook / Excel

- [ ] Workbook JSON 固定七分頁。
- [ ] Workbook patch/selection DTOs and backend validation ownership are separated as documented.
- [ ] ExcelJS export 固定七分頁。
- [ ] 給客戶用分頁不含內部欄位。
- [ ] 系統訂單分頁欄位固定。
- [ ] 未確認單價 / 金額顯示「未確認」。
- [ ] 指定分頁下載有 access check 與 audit。

### 30.5 Source / Import

- [ ] Admin ERP Import 拒絕 DOCX/PDF/image upload。
- [ ] Admin Import 正式入口只接受 ERP XLSX parsed data 或 validated table UI edits。
- [ ] 鋼鐵手冊 DOCX 用於真實 schema/data-model 設計，不暴露為 Admin web upload，也不要求 reusable parser；真實 data SQL import 延後到後續 code-agent data task。
- [ ] `tasks/v8.2/source-schema-mapping.md` 與 code 版 mapping 設計完成，AI API 可用 mapping context 對應正確 schema key。
- [ ] Merge table valid / invalid / needs_review 由 code 決定。
- [ ] Commit only valid rows。
- [ ] Transaction rollback 測試通過。
- [ ] 資料匯入引發的價格異動寫入 `steel.price_history`。

### 30.6 UX Acceptance

- [ ] 使用者貼 LINE 訂單可產生 Workbook。
- [ ] Phase 3 Chat Workspace 是獨立 Steel workspace，不依賴重寫 core LibreChat chat store / global message flow。
- [ ] 手機版與桌面版共用同一套 Steel UX framework、API contracts 與 mock data。
- [ ] 手機版 Workbook Preview 是 full-view modal，右上角有 X 關閉。
- [ ] 點選 workbook cell 後，單一 cell 有 selected style，底部 message input 顯示欄位 marker。
- [ ] 提交 message 時最多送一個 structured selected workbook ref；AI 更新 workbook 需經 workbook patch service，UI 依 patch/refetch 同步。
- [ ] 使用者可透過多輪對話持續修改 workbook data。
- [ ] 使用者可用文字描述多個明確位置要更改；AI 可產生多個 patch ops，但模糊位置需追問或人工複核。
- [ ] Phase 3 不做每次 AI patch 前的 preview/diff confirmation。
- [ ] 最新被接受的 workbook patch 欄位用背景色標示，且和 selected cell 樣式不同。
- [ ] 最新更新欄位背景色維持到下一次 accepted workbook patch；新 patch 取代上一組 highlight。
- [ ] AI patch 失敗或被拒絕時，不標示欄位、不清掉上一個 accepted patch highlight，chat 顯示未更新原因。
- [ ] Phase 3 不做 Undo button 或版本控制 UI；還原/修改統一透過聊天讓 AI 產生 validated patch。
- [ ] AI patch 成功後，chat 短摘要列出已更新欄位，不顯示完整 diff table。
- [ ] 報價結果有明細、總結、複核、來源，不只回總價。
- [ ] 客戶口語品名會展開多組搜尋關鍵字。
- [ ] 找不到完全匹配不硬套，標低信心。
- [ ] 圖面 / 圖片先判斷方向。
- [ ] Admin 能 preview ERP XLSX parsed data。
- [ ] Admin 能透過 table UI fetch/edit/review/save 既有資料。
- [ ] Guest user 可建立報價並下載 Excel。
- [ ] 使用者指出錯誤時能建立 memory candidate。

---

## API Route 草稿

```text
POST   /api/steel/conversations/authenticated
POST   /api/steel/conversations/guest
POST   /api/steel/conversations/:conversationMetaId/link-account
GET    /api/steel/conversations/:conversationMetaId
POST   /api/steel/conversations/:conversationMetaId/messages
GET    /api/steel/conversations/:conversationMetaId/workbook
POST   /api/steel/workbooks/:workbookId/patch
GET    /api/steel/workbooks/:workbookId/patches

POST   /api/steel/conversations/:conversationMetaId/exports
GET    /api/steel/exports/:exportId/download

GET    /api/steel/ai/models

POST   /api/admin/steel/ai/capability-smoke

GET    /api/admin/steel/projects
POST   /api/admin/steel/projects
GET    /api/admin/steel/projects/:projectId/sources
POST   /api/admin/steel/projects/:projectId/sources
GET    /api/admin/steel/sources/:sourceId/versions
GET    /api/admin/steel/source-versions/:versionId/preview
POST   /api/admin/steel/source-versions/:versionId/confirm

POST   /api/admin/steel/import-sessions
POST   /api/admin/steel/import-sessions/:sessionId/upload-xlsx
GET    /api/admin/steel/import-sessions/:sessionId/preview
POST   /api/admin/steel/import-sessions/:sessionId/merge-table
POST   /api/admin/steel/import-sessions/:sessionId/merge-table/patch
POST   /api/admin/steel/import-sessions/:sessionId/commit

GET    /api/admin/steel/tables/:targetTable/rows
POST   /api/admin/steel/tables/:targetTable/preview-update
POST   /api/admin/steel/tables/:targetTable/commit

GET    /api/admin/steel/memory-candidates
POST   /api/admin/steel/memory-candidates/:candidateId/review

POST   /api/admin/steel/evals/runs
GET    /api/admin/steel/evals/runs/:runId
```

---

## MongoDB Schema 草稿

TypeScript interface 草稿索引：

| 要求名稱 | 本文件 interface |
|---|---|
| `steel_conversation_meta` | `SteelConversationMeta` |
| `steel_workbooks` | `SteelWorkbook` |
| `workbook_line` | `WorkbookLine` |
| `quote_trace` | `QuoteTrace` |
| `price_candidate` | `PriceCandidate` |
| `source_manifest` | `SourceManifest` |
| `admin_source_preview_row` | `AdminSourcePreviewRow` |
| `system_order_row` | `SystemOrderRow` |
| `customer_quote_row` | `CustomerQuoteRow` |
| `admin_merge_row` | `AdminMergeRow` |
| `memory_candidate` | `MemoryCandidate` |

```ts
export const steelWorkbookSchemaDraft = {
 collection: 'steel_workbooks',
 indexes: [
   { steel_conversation_meta_id: 1 },
   { user_id: 1, updated_at: -1 },
   { status: 1, updated_at: -1 },
 ],
 required: [
   'steel_conversation_meta_id',
   'current_workbook_json',
   'version_seq',
   'status',
   'created_at',
   'updated_at',
 ],
};

export const steelAdminImportSessionSchemaDraft = {
 collection: 'steel_admin_import_sessions',
 indexes: [
   { created_by: 1, created_at: -1 },
   { target_table: 1, status: 1 },
   { source_manifest_id: 1 },
 ],
 required: [
   'source_file_type',
   'target_table',
   'status',
   'preview_summary',
   'created_at',
   'updated_at',
 ],
};
```

新增 Mongo schemas 至少包含：

- `steelConversationMeta`
- `steelWorkbook`
- `steelWorkbookPatch`
- `steelOpenAIRun`
- `steelToolCall`
- `steelExcelExport`
- `steelProject`
- `steelProjectSource`
- `steelSourceVersion`
- `steelAdminImportSession`
- `steelAdminMergeTable`
- `steelAdminMappingProfile`
- `steelMemoryCandidate`
- `steelMemory`
- `steelAuditLog`

---

## Supabase PostgreSQL Migration / Schema 草稿

以下是 v8.2 目標 schema 摘要；實作時需更新 `supabase/schema.sql` 並建立 one-change migration。

```sql
CREATE SCHEMA IF NOT EXISTS steel;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS steel.customers (
 id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 source_customer_code TEXT UNIQUE,
 display_name TEXT NOT NULL,
 legal_name TEXT,
 tax_id TEXT,
 customer_tier_id BIGINT REFERENCES steel.customer_tiers(id),
 status TEXT NOT NULL DEFAULT 'active',
 notes TEXT,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 import_log_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS steel.price_items (
 id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 source_item_code TEXT,
 category_id BIGINT REFERENCES steel.price_categories(id),
 customer_tier_id BIGINT REFERENCES steel.customer_tiers(id),
 spec_key TEXT NOT NULL,
 product_name TEXT NOT NULL,
 material_grade TEXT,
 surface_treatment TEXT,
 length_m NUMERIC(10, 3),
 unit TEXT NOT NULL,
 unit_price NUMERIC(14, 4) NOT NULL,
 currency TEXT NOT NULL DEFAULT 'TWD',
 effective_from DATE,
 effective_to DATE,
 active BOOLEAN NOT NULL DEFAULT true,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 last_import_log_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT price_items_unit_price_check CHECK (unit_price >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS price_items_source_tier_unique
ON steel.price_items (source_item_code, COALESCE(customer_tier_id, 0))
WHERE source_item_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS steel.source_chunks (
 id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 project_source_id TEXT NOT NULL,
 source_version_id TEXT NOT NULL,
 chunk_key TEXT NOT NULL UNIQUE,
 chunk_text TEXT NOT NULL,
 token_count INTEGER,
 status TEXT NOT NULL DEFAULT 'active',
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS steel.source_embeddings (
 id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 chunk_id BIGINT NOT NULL REFERENCES steel.source_chunks(id) ON DELETE CASCADE,
 embedding vector(1536) NOT NULL,
 embedding_model TEXT NOT NULL,
 embedding_model_dim INTEGER NOT NULL,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS steel.price_history (
 id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 price_item_id BIGINT NOT NULL REFERENCES steel.price_items(id) ON DELETE CASCADE,
 old_unit_price NUMERIC(14, 4),
 new_unit_price NUMERIC(14, 4) NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 import_log_id TEXT
);
```

實作注意：

- `steel` schema private，不直接授權 Supabase anon/authenticated。
- 應用後端透過 `STEEL_POSTGRES_URL` 存取。
- 若現有 schema 欄位名稱仍反映舊外部系統語彙，v8.2 migration 應改成中性的 `source_customer_code` / `source_item_code`。
- `vector` extension 目前在 public schema，SQL search path 需包含 `public`。

---

## Admin Preview Page 資料結構草稿

```ts
export interface AdminPreviewPageData {
 sessionId: string;
 sourceManifest: SourceManifest;
 targetTable: string;
 summary: {
   totalRows: number;
   validRows: number;
   invalidRows: number;
   needsReviewRows: number;
   createRows: number;
   updateRows: number;
   deleteRows: number;
   lowConfidenceRows: number;
 };
 rows: AdminSourcePreviewRow[];
 mergeRows: AdminMergeRow[];
 mappingProfile?: {
   id: string;
   targetTable: string;
   sourceFileType: 'xlsx' | 'table_ui';
   sheetNamePattern?: string;
   headerFingerprint?: string;
   mappingRules: Record<string, string>;
   normalizers: string[];
   requiredFields: string[];
   lastUsedAt?: string;
 };
}
```

---

## 產品對話 UX 情境摘要

### Chat Workspace

使用者可以貼 LINE 訂單、上傳文件、選模型、問 AI、修改報價、產生報價單。右側或下方顯示 Workbook preview，提供：

- 七分頁切換。
- 低信心數量。
- 下載完整 Excel。
- 下載系統訂單。
- 下載給客戶用。
- 只看人工複核。

Phase 3 先建立獨立 Steel workspace，重用 LibreChat auth、navigation、model selector 能力，但不要求改造 core LibreChat chat store / global message flow。手機版與桌面版共用同一套 Steel UX framework；手機版 Workbook Preview 以 full-view modal 開啟，右上角 X 關閉。點選 workbook cell 時，UI 以 selected style 標記單一 cell，並在底部 message input 加入欄位 marker；使用者接著輸入修改內容後送出，request 同時帶最多一個 structured selected workbook ref。AI 只能透過 workbook patch service 更新 workbook，成功後 workbook UI 依 patch 或 refetch 同步，不做每次 patch 前的 preview/diff confirmation，也不做 Undo button 或版本控制 UI。使用者可以透過多輪對話持續修改 workbook data、請 AI 還原剛才修改，或用文字描述多個明確位置要更改，讓 AI 產生多個後端驗證過的 patch ops。最新被接受 patch 更新過的欄位用背景色標示，且和 selected cell 樣式不同；背景色維持到下一次 accepted workbook patch，下一次 patch 會替換上一組 highlight。AI patch 成功時，chat 用短摘要列出已更新欄位，不顯示完整 diff table；AI patch 失敗或被後端拒絕時，不標示欄位、不清掉上一個 accepted patch highlight，chat 顯示未更新原因。不建立 mobile-only API 或 mobile-only data model。

### Source Admin

Admin 上傳 ERP XLSX，查看 parsed data、source manifest、version history。DOCX/PDF/image 上傳在 Admin data import 被拒絕。鋼鐵手冊 DOCX 屬於 schema/data-model 設計參考，不是 Admin web upload。

### Import Admin

Admin preview ERP XLSX parsed data、AI mapping、merge table、valid / invalid / needs_review，最後按「確認更新資料庫」才寫入 Supabase PostgreSQL。後續維護可由 table UI fetch/edit/review/save，不需要上傳 DOCX。

### Memory Review

審核 AI 建議改善規則，將錯誤修正轉成 system memory 或 Project Instruction。

### UX 驗收標準

- 使用者貼 LINE 訂單，系統能產生 Workbook。
- Steel Chat Workspace 在 desktop/mobile responsive web 上共用同一套 workflow。
- 手機版可用 full-view modal 檢視 workbook，並可點選單一 cell 後在 message input 中指定該欄位請 AI 修改。
- 多輪對話可持續修改 workbook；文字描述多處明確修改可交給 AI 判斷並產生 validated patch ops。
- AI patch 套用後，最新更新欄位會以背景色標示，不要求每次更新前都先確認；背景色維持到下一次 accepted workbook patch。
- AI patch 失敗或被拒絕時，不標示欄位，workbook 保持原資料。
- 不提供 Undo button；使用者以聊天要求 AI 還原或修改，仍經 workbook patch service。
- AI patch 成功時，chat 用短摘要說明已更新欄位，不顯示完整 diff table。
- 報價結果不是只回總價，而是有明細、總結、複核、來源。
- 客戶口語品名會展開多組價格搜尋關鍵字。
- 價格查詢先於重量計算。
- 找不到完全匹配不硬套，會標低信心。
- 長條料裁切會先配料，不直接用淨長計價。
- 圖面 / 圖片會先判斷方向。
- Admin data import 不接受 DOCX/PDF/image，只接受 ERP XLSX。
- Admin 能 preview ERP XLSX parsed data。
- Admin 能透過 table UI preview/edit 既有資料。
- Excel 有七個必要分頁。
- 系統訂單分頁符合固定欄位。
- 給客戶用分頁不含客戶等級與內部資料。
- 使用者指出錯誤時，能建立 memory candidate。
- Guest user 可以建立報價並下載 Excel。
- Admin import 需經 valid / invalid / needs_review 檢查後才能寫入資料庫。

---

## 附錄 A：OpenHarness ChatGPT/Codex OAuth Verified 開發步驟

### A.1 修正後正確步驟

```text
1. 建立 SteelAIProvider interface。
2. 新增 OpenHarnessChatGPTOAuthProvider adapter，設為 default driver。
3. 新增 OpenAIAPIProvider adapter，設為 fallback driver，使用 OPENAI_API_KEY。
4. pin @openharness/core 與 @openharness/provider-chatgpt 版本，記錄 experimental 風險。
5. 完成 server-side OAuth login / token store；token 檔視為密碼等級保存。
6. 依 `docs/steel-chatgpt-oauth-setup.md` 完成 ChatGPT OAuth 綁定；未完成前不得執行真 provider smoke 或聊天 UI live 測試。
7. 建立 admin-only driver capability smoke route：`POST /api/admin/steel/ai/capability-smoke`。
8. 建立 driver capability smoke test：text、stream、tool calling、structured output、image、PDF、XLSX、File Search、Code Interpreter。
9. 不把 quota remaining 當 OAuth driver 必備功能；只處理 auth / rate / subscription limit / fallback。
10. 建立 /api/steel/conversations/:conversationMetaId/messages route 到 SteelAgentOrchestrator。
11. 使用者上傳檔案後，backend 建立 source file metadata 與 provider file refs；AI 做判讀與 evidence，不由 Node 寫主 OCR/圖面 parser。
12. 將 Steel tools 掛入 OpenHarness agent；tool decision 由 AI，tool execution 由 Steel backend。
13. 將 OpenHarness stream events 轉成 SteelAIEvent。
14. OAuth 綁定完成後，測試純聊天、backend API tool call、structured output、workbook patch、PDF/圖片圖面、XLSX evidence。
15. 若 OAuth driver 對 file / vision / XLSX / hosted tools 失敗，自動 fallback 到 OPENAI_API_KEY。
16. OAuth 綁定完成後 run localhost Steel Workspace page，確認預設聊天由 OpenHarness OAuth driver 執行，fallback 事件可追蹤。
```

### A.2 對使用者原期待的真偽判斷

```text
「OpenAI API Conversation 支援檔案上傳、OCR、圖面判讀、Excel evidence」
```

判斷：大致為真，但應精準寫為：官方 OpenAI Responses API / Conversations API 可搭配 file input、Files API、vision-capable model、File Search、Code Interpreter / Hosted Shell、spreadsheet augmentation 來做 PDF、圖片、圖面與 Excel evidence。Conversation 本身是 state / item 容器，不是 OCR engine；實際判讀由模型與 hosted tools 完成。

```text
「OpenHarness ChatGPT OAuth provider 授權不同，但 model 相同，所以也都支援檔案上傳、OCR、圖面判讀、Excel evidence」
```

判斷：未證實，不能寫成真。OpenHarness 可確認是基於 Vercel AI SDK 的 agent harness，且 `@openharness/provider-chatgpt` 是 experimental ChatGPT/Codex OAuth provider；但這不等於它完整暴露 OpenAI API 的 file input、PDF vision、spreadsheet augmentation、File Search、Code Interpreter / Hosted Shell surface。必須逐項 smoke test，未通過就 fallback 到 `openai_api`。

```text
「鋼鐵報價的檔案 tool calling、OCR、圖面判讀、Excel evidence 應仍由 OpenAI 判斷與操作，不應由 Node app 支援」
```

判斷：需修正。正確說法是：AI / OpenAI 負責主判讀與何時呼叫 tool；Node/backend 不做主 OCR / 主圖面 parser / 主 Excel semantic evidence。但 Node/backend 必須支援檔案上傳、provider file refs、custom tool definitions、custom tool execution、權限、安全、audit、workbook validation、fallback routing。

```text
「預設是用 OpenHarness ChatGPT OAuth，備用 OPENAI_API_KEY」
```

判斷：可行，並已作為本版預設。但要加 capability gate：純文字與已通過 smoke test 的 tool workflow 走 OAuth；file / vision / XLSX / hosted tools 若 OAuth 未通過，立即 fallback 到 OPENAI_API_KEY。

```text
「用量/成本是 OAuth subscription 才有 5h/week limit；API 沒有額度限制」
```

判斷：需修正。OAuth subscription access 可以有 subscription entitlement / time limit / usage cap，但 `5h/week` 不應寫成已由官方 API 文件保證的固定值，除非另有明確官方或 provider 文件。API fallback 是 usage-based billing，不是沒有額度限制；仍有 rate limits、usage limits、budget、billing 與 project policy。

### A.3 必測 smoke cases

| 編號 | Driver | 測試 | 通過條件 | 失敗處理 |
|---|---|---|---|---|
| OH-01 | openharness_chatgpt_oauth | 純文字聊天 | 可 stream 回覆 | auth error / fallback |
| OH-02 | openharness_chatgpt_oauth | backend API tool call：查客戶 | AI 產生 tool call，backend 執行，結果回 AI | tool unsupported / fallback |
| OH-03 | openharness_chatgpt_oauth | structured workbook patch | patch JSON 通過 schema validation | 禁止寫 workbook |
| OH-04 | openharness_chatgpt_oauth | 圖片圖面 | AI 能讀圖並產生 evidence | vision unsupported / fallback |
| OH-05 | openharness_chatgpt_oauth | PDF 圖面 | AI 能讀 PDF page image / text 並產生 evidence | file unsupported / fallback |
| OH-06 | openharness_chatgpt_oauth | XLSX evidence | AI 能讀 sheet / header / row evidence | xlsx unsupported / fallback |
| API-01 | openai_api | PDF + vision | OpenAI file input 可用並回傳 evidence | 報錯給人工複核 |
| API-02 | openai_api | XLSX + spreadsheet evidence | 可回傳表格 evidence 或透過 hosted tool 分析 | 報錯給人工複核 |
| API-03 | openai_api | File Search / Code Interpreter | hosted tool 可用 | 若不可用，降級為低信心 |

### A.4 環境變數摘要

```env
STEEL_AI_DRIVER_DEFAULT=openharness_chatgpt_oauth
STEEL_AI_DRIVER_FALLBACK=openai_api
STEEL_OPENAI_API_FALLBACK=true
OPENAI_API_KEY=...
STEEL_FALLBACK_ON_FILE_INPUT_UNSUPPORTED=true
STEEL_FALLBACK_ON_VISION_INPUT_UNSUPPORTED=true
STEEL_FALLBACK_ON_XLSX_INPUT_UNSUPPORTED=true
STEEL_FALLBACK_ON_HOSTED_TOOL_UNSUPPORTED=true
```
