# 鋼鐵報價 LibreChat 擴充專案 v8.3 開發規格

版本日期：2026-05-26
修訂版本：v8.3-openai-oauth-responses-primary
文件狀態：可執行開發規格；本版改以 openai-oauth /v1/responses 為主要 AI API driver。官方 OpenAI API 只作 secondary API driver；fallback 指選擇 API driver，不是模型 fallback，也不使用 per-capability `STEEL_FALLBACK_*` env matrix。

本文件將 v8.2 規劃升級為可交給工程實作的 v8.3 規格。v8.3 的核心變更是：AI API 主要 driver 改為 openai-oauth /v1/responses、採 stateless full-history tool loop、前端 Steel Workspace 預設選擇 openai_oauth_responses、移除第二套 agent harness 規劃、official OpenAI API 不再視為未測保底、API fallback 僅表示改走 `openai_api` driver。原有固定 Workbook 七分頁、ERP XLSX 作為正式 Admin 匯入來源、鋼鐵手冊 DOCX 先作真實 schema/data-model 設計參考、Admin 不做 DOCX/PDF parser upload path、Quote Workbook vertical slice、MongoDB + Supabase PostgreSQL、Quote Resolution Engine、AI-led rule/tool orchestration 與 workbook subtotal validation 等決策保留。

---

## 0. 文件目的

本專案在 LibreChat monorepo 內擴充一套鋼鐵公司報價系統，保留 LibreChat 原有聊天介面、使用者驗證、Agents、檔案上傳、OCR、MCP / Actions、Memory、Admin Panel、對話紀錄等能力，新增鋼鐵報價專用工作台。

產品定位：

```text
這是一個讓鋼鐵公司行政人員用聊天方式處理報價的工作台：
把客戶文字、圖面、PDF、Excel、DOCX 丟進來，系統會查客戶分級、
找價格候選、把規則交給 AI 計算重量與加工、標記低信心、產生內部報價、
系統訂單與客戶用報價單。
```

主要能力：

- Conversation-first 查價與報價流程。
- 支援未登入 guest conversation。
- Workbook / Excel 綁定 conversation ID。
- Steel AI Provider adapter 狀態追蹤；預設 driver 為 `openai_oauth_responses`，呼叫 openai-oauth `/v1/responses`；`openai_api` 只作 secondary API driver。
- 開發階段 Steel workspace 的 model selector 由後端 allowlist 控制；v8.3 active OAuth Responses model 只支援 `gpt-5.5`，不再支援 `gpt-5.4` 或以下模型。
- Project Sources / Project Instructions 管理。
- 鋼鐵資料查詢 tools。
- Admin ERP XLSX 增量匯入控制頁。
- Admin 正式資料匯入以 ERP 匯出的 `.xlsx` 為 preferred normalized format；legacy `.xls` / `.doc` 可交由 AI/provider 辨識處理，server-side conversion to `.xlsx` / `.docx` 必須先由開發腳本測試成功才可成為正式後端流程。
- 鋼鐵手冊 DOCX 先由 code agent 依內容制定真實 schema/data model；真實手冊 data SQL 匯入後續再實作，後續 Admin 網頁不需要上傳 DOCX。
- `docs/reference` 可用來設計真實 schema 與 API mock data，但目前來源文字仍有筆誤需要校正，不代表資料已整理成可直接匯入資料庫的狀態。
- `docs/reference` 來源資料多為中文；需先建立 `tasks/v8.3/source-schema-mapping.md`，先處理會進入資料庫或資料庫查詢合約的規格表、價錢表、公式與加工價格欄位，將中文來源 label/header/term 對應到英文 canonical schema key。
- 實作時同步設計 code-owned mapping，例如 `packages/api/src/steel/schema/mapping.ts`，並將精簡 mapping context 提供給 AI API，讓 AI 能把中文來源/客戶用語對應到既有 schema key；AI 不得自行發明 key。
- 中文產品名稱、別名、表格顯示文字、原始來源片段可以保留為 data/display/source/search values，但不能直接成為 code-owned field name 或 DB query key。
- Workbook UI / Workbook Preview / Excel output 的可見欄位名稱使用繁體中文，優先參考 `docs/reference/*.xlsx` 既有表頭；內部 DTO key、patch path、schema key、DB/query contract 仍使用英文 canonical key。
- API mock data 統一放在 `packages/data-provider/src/steel/mock/`，前端與後端 mock endpoint 共用同一份資料。
- API mock data 只能透過明確 mock path 匯入，不從 `packages/data-provider/src/steel/index.ts` 重新 export，避免被當成 production data-provider API。
- Chat Workspace + Workbook Preview 優先於真實資料匯入，Phase 3 先做獨立 Steel workspace，不改 LibreChat core chat store / global message flow。
- 手機版與桌面版共用同一套 Steel UX framework、components、hooks、API contracts 與 mock data，只在 responsive layout 上調整。
- 手機版 Workbook Preview 使用 full-view modal 呈現，右上角有明確 X 關閉；Phase 3 點選 workbook cell 會標記 selected style，並在底部 message input 加入含分頁與欄位/位置的 marker，同時送出 structured selected refs 供 AI patch workbook。若使用者尚未輸入文字，下一個 cell selection 會覆蓋原 marker；若已輸入文字，下一個 selection 會換行新增 marker，支援一則 message 帶多個明確 targets。
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

## 1. v8.3 修正重點

### 1.1 Workbook / Excel 固定七分頁

每份報價 Workbook 至少包含七個固定分頁：

1. 報價明細
2. 總結
3. 人工複核清單
4. 價格來源
5. 判讀備註
6. 系統訂單
7. 報價單

目前 AI-facing `patch_quote_workbook` completion 只要求 `系統訂單`、`人工複核`
與 `報價單`；其他四個 public workbook 分頁保留給 storage/export compatibility，
不是 semantic patch completion gate。

「報價單」分頁必須移除：

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

外部企業資料庫尚未確認可以連接，v8.3 不做外部資料庫直連或企業系統直連規劃。正式開發只以 MongoDB + Supabase PostgreSQL 為主。

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

核心結論：Admin data source = ERP `.xlsx` normalized path；legacy `.xls` 只有在 server-side conversion 腳本測通後才可進正式後端流程。鋼鐵手冊 DOCX = real schema/data-model design reference，不是 Admin web upload path、reusable parser，真實 data SQL import 延後到後續 code-agent data task。

---

## 2. 核心決策摘要

| 項目                     | v8.3 決策                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基礎平台                 | 使用 LibreChat monorepo 擴充，不另做 sidecar service                                                                                                                                         |
| 後端位置                 | 新增 TypeScript 後端邏輯放 `packages/api/src/steel`                                                                                                                                          |
| `/api` 邊界              | 只放 Express route wrapper 與 route registration                                                                                                                                             |
| 前端位置                 | 使用 `client/src/features/steel` 建立獨立 Steel workspace、Chat Workspace、Workbook Preview、Admin pages                                                                                     |
| 資料庫                   | MongoDB + Supabase PostgreSQL                                                                                                                                                                |
| MongoDB 用途             | LibreChat 既有資料、Steel app state、Workbook、Memory、Audit、Import sessions                                                                                                                |
| Supabase PostgreSQL 用途 | 結構化業務資料、價格、重量、加工、訂單、source chunks、pgvector                                                                                                                              |
| AI Provider              | Steel AI Provider adapter；預設 `openai_oauth_responses` / `/v1/responses`；`openai_api` 為 secondary API driver。Fallback 指改選 API driver，不是模型 fallback 或 per-capability env matrix |
| Steel model allowlist    | v8.3 active OAuth Responses path 只支援 `gpt-5.5`；`gpt-5.4` 和以下模型不列入支援範圍                                                                                                        |
| AI state                 | Steel Agent Orchestrator 保存 provider run metadata；`openai_oauth_responses` 固定 stateless full-history；official Responses API state 只在 `openai_api` driver 明確實作並測通後啟用        |
| 模型選擇                 | Steel Workspace 使用後端 allowlist；只顯示目前 driver support matrix 允許的模型                                                                                                              |
| Guest Mode               | `STEEL_GUEST_MODE=false` 預設關閉；true 才允許未登入 quote/workbook/export                                                                                                                   |
| 價格規則                 | 價格先於重量；不可用手冊重量直接推材料售價                                                                                                                                                   |
| Workbook                 | Workbook JSON 是主資料，ExcelJS 只根據 Workbook JSON 匯出                                                                                                                                    |
| Workbook line            | 永久保存公式、資料庫預設單價、報價單價、總價、調整來源                                                                                                                                       |
| Workbook field labels    | Workbook Preview、selected target marker、changed-field summary、Excel 欄位顯示使用繁體中文 label；內部 structured key 維持英文                                                              |
| Export                   | ExcelJS 產生 XLSX，固定七分頁，可完整或指定分頁下載；Phase 4 員工用匯出不做 customer mask                                                                                                      |
| Customer Sheet           | 未來客戶專用格式再由後端 allowlist 控制；Phase 4 先不做 customer-visible 欄位限制                                                                                                                |
| Admin Import             | 正式入口以 ERP `.xlsx` parsed data 為 normalized path；legacy `.xls` 需先有 tested conversion；後續表格維護走 web fetch data + table UI preview/edit                                         |
| Source schema mapping    | `tasks/v8.3/source-schema-mapping.md` 先把規格表、價錢表、公式與加工價格等 DB-bound 中文來源 label/header/term mapping 到英文 canonical schema key；程式端 DB/API/tool 查詢統一用英文 key    |
| AI API mapping           | Prompt/tool context 提供精簡 source-schema mapping，讓 AI API 對應既有 schema key；未知 key 追問或人工複核                                                                                   |
| PDF                      | 不進 Admin Import；若作聊天附件只作低信心 evidence                                                                                                                                           |
| AI DB 權限               | AI 不直接操作 MongoDB / Supabase PostgreSQL，只能呼叫白名單 tools                                                                                                                            |
| Raw query                | 禁止 raw SQL / raw Mongo query tool                                                                                                                                                          |
| Eval                     | 建立 Steel Eval Harness 驗證價格先於重量、七分頁、Admin upload policy、客戶版遮罩                                                                                                            |

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
- Catalog Family Rule Guidance
- AI Calculation Rule Prompt Boundary
- Workbook Subtotal Validator
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
- Mongo schema 放 `packages/data-schemas/src/schema/steel/` 子資料夾，避免 Project-specific schema 和 LibreChat core schema 混在同一層。
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
│  │  ├─ openai-oauth-responses
│  │  └─ openai-api
│  └─ events
├─ prompt
├─ tools
├─ quote
├─ pricing
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
- Workbook mock fixture 與 UI/API 回傳可包含繁體中文 display label；label 優先來自 `docs/reference/*.xlsx` 表頭，例如 `系統訂單.xlsx` 的 `型號`、`品名規格`、`數量`、`單價`、`公式編號`，但 patch path 與 structured refs 不使用中文 label 當 key。
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

| Phase | 內容                                                                                                                                                         | Gate                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | shared contracts、Mongo schemas、routes、permissions、audit                                                                                                  | Steel conversation meta 可建立、guest gate 有測試                                                                                                                  |
| 2     | Supabase repositories、handbook-informed schema boundary、catalog-family rules、customer-specific rules、price candidate search、quote-rule tools、workbook subtotal validator | 查客戶/價格/規則/公式 tools 可測；AI 計算後的 workbook subtotal consistency 可驗證                                                                                 |
| 3     | Independent Steel Workspace、shared desktop/mobile UX framework、shared API mock data、Quote Resolution Engine、Workbook JSON、Workbook Preview              | 使用者可送訊息並看到七分頁 workbook preview；`openai_oauth_responses` + `gpt-5.5` text/tool/workbook vertical slice evidence passed；`openai_api` 不得作未決策保底 |
| 4     | ExcelJS export、完整 workbook / 任意指定分頁員工下載                                                                                                         | 七分頁 export、任意選取分頁、未確認不變 0、audit 測試通過                                                                                                          |
| 5     | Admin ERP XLSX import、table maintenance、Source 管理                                                                                                        | Admin confirm 後才可寫入 Supabase                                                                                                                                  |
| 6     | Memory Review、RAG source sync、eval harness、production hardening                                                                                           | 回歸測試與 audit 完整                                                                                                                                              |

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
    provider?: 'openai_oauth_responses' | 'openai_api';
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

## 6. Steel AI Provider Adapter、openai-oauth /v1/responses 與 Model Selection

### 6.1 v8.3 決策

Steel Workspace 不直接綁死 LibreChat 原本 OpenAI client，也不讓任何外部 agent harness 取代 LibreChat 平台層。AI 呼叫層抽象為 `SteelAIProvider`，由 `SteelAgentOrchestrator` 控制 prompt bundle、stateless tool loop、structured output、workbook patch、audit 與 capability-gated routing。

本版支援兩種 driver，預設選擇如下：

```text
STEEL_OPENAI_PROVIDER=OAUTH
STEEL_OPENAI_DEFAULT_MODEL=gpt-5.5
```

- `openai_oauth_responses`：主要開發 driver。第一版以 `openai-oauth-provider` direct provider 為唯一 coded provider path，呼叫 `/v1/responses`，active model 只支援 `gpt-5.5`。Vercel AI SDK 6 dependency 是 Apache-2.0，已確認可用於 production；實作時必須透過 package-manager overrides/resolutions 統一 `ai`、`@ai-sdk/openai`、`@ai-sdk/provider`、`@ai-sdk/provider-utils` 版本。`openai-oauth` CLI localhost proxy 只作手動 diagnostic smoke probe，不是 runtime route。
- `openai_api`：第二 driver。使用官方 OpenAI API Key / Responses API。只有 backend 明確選擇 API workflow 時才使用；不得把 official API 當成未測保底。

`openai-oauth` 只替換 AI execution provider，不替換：

- LibreChat authentication / users / roles / conversations / files / admin shell。
- Steel Quote Resolution Engine。
- Steel AI calculation from reviewed rule/source prompt context, with workbook
  subtotal consistency checks. The OAuth/Codex path must not require hosted
  code-interpreter disclosure as evidence.
- MongoDB / Supabase repository layer。
- Workbook JSON / workbook patch validation。
- Backend business tools 的實際執行端。
- Code-owned capability support matrix、routing gate、audit 與 typed error handling。

### 6.2 查證結論：openai-oauth /v1/responses 是 stateless proxy，不可假設等同官方 API 完整能力

結論：

```text
openai_oauth_responses：本案主要 AI API driver；active model 為 gpt-5.5。
openai_api：第二 driver；只有 backend 明確選擇 API workflow 時才使用，不作未決策保底。
```

`openai-oauth` CLI 可提供 OpenAI-compatible endpoint，主要呼叫 `/v1/responses`；但 CLI `/v1/responses` 沒有 stateful replay support，proxy 是 stateless，呼叫方必須送完整 conversation history。因此 v8.3 的 provider state 模式固定為：

```text
stateMode = stateless_full_history
```

禁用於 `openai_oauth_responses` driver：

- `previous_response_id` replay。
- official Conversations API state。
- provider 回抓歷史對話重建報價狀態。

每一輪 AI run 必須由 `PromptBundleBuilder` 組完整 context：

```text
system instructions
+ project instructions
+ relevant memories
+ current workbook summary / selected workbook refs
+ recent conversation messages
+ compressed older history
+ active source/evidence refs
+ tool definitions
+ current user message
```

模型名稱相同不等於 provider surface 相同。即使兩邊都選到相同模型，下列項目仍可能不同：

- authentication 與 entitlement。
- request / response schema。
- tool calling event shape。
- streaming event shape。
- file input 傳輸方式與 MIME 支援。
- image/PDF/DOCX/XLS/XLSX 是否能進入模型。
- PDF page image 是否送入模型。
- spreadsheet augmentation 是否存在。
- hosted File Search / Code Interpreter 是否可用。
- rate limit / subscription limit / billing visibility。

Phase 1 的能力判斷是 code-owned support matrix，不做新 Admin UI smoke runner；目前 active baseline 是 `openai_oauth_responses` + `gpt-5.5`，並重用 `/steel/oauth-chat` 已證明的 file-support evidence。後續若加入更多 provider/model/capability，才需要逐項 smoke evidence。

### 6.2.1 openai-oauth repo 查證與整合決策

查證來源：`EvanZhouDev/openai-oauth`，研究時 repo HEAD 為 `aa526920af322568968a30fe820b2b9d55545f8a`，npm metadata 顯示 `openai-oauth@1.0.2`、`openai-oauth-provider@1.0.3`，兩者 license 皆為 `AGPL-3.0-only`。

該 repo 有兩個 integration surface：

1. `openai-oauth` CLI/local server：啟動 OpenAI-compatible localhost endpoint，預設 `http://127.0.0.1:10531/v1`，支援 `/v1/models`、`/v1/responses`、`/v1/chat/completions`，並以本機 Codex/ChatGPT OAuth auth file 呼叫 `chatgpt.com/backend-api/codex`。
2. `openai-oauth-provider`：Vercel AI SDK provider，可直接建立 AI SDK provider；AI SDK 6 dependency set 是 Apache-2.0，已確認 production 可用，但必須用 package-manager overrides/resolutions 統一版本。

LibreChat v8.3 採用決策：

- Phase 1/3 以 `openai-oauth-provider` direct provider 作為 `openai_oauth_responses` 唯一 coded runtime path；local HTTP proxy 只保留為手動 diagnostic smoke probe。
- Direct provider adapter 加依賴時，同一 slice 必須加入 `ai`、`@ai-sdk/openai`、`@ai-sdk/provider`、`@ai-sdk/provider-utils` 的版本 overrides/resolutions，避免 duplicated AI SDK provider package versions。
- `packages/api/src/steel/ai/providers/openai-oauth-responses/client.ts` 應包住 direct provider seam；測試以 fake auth / mocked fetch 覆蓋 direct provider 行為，不建立 env-controlled local proxy mode。
- 直接 in-process `openai-oauth-provider` spike 已完成，紀錄於 `tasks/v8.3/openai-oauth-provider-spike.md`：install、import、TypeScript typecheck、mocked fetch、live local-auth text call 都可行。AI SDK 6 不再是 blocker；剩餘 gate 是 packaging verification、backend-owned model discovery、server-only auth material、Responses setting normalization/drop metadata。
- 不可將 `openai-oauth` proxy 當 hosted multi-user service。Direct provider 可作 production path；local proxy 只允許 trusted local/dev manual smoke probe，不進 runtime route。
- openai-oauth auth file 等同 password-equivalent credential；不得存 frontend、不得進 log、不得進 audit raw payload。
- local proxy 可能 rewrite/drop official Responses settings；例如 provider state、`previous_response_id` / `item_reference` 與部分 output-token controls 不可被視為已套用。Steel adapter 必須將這些列入 `unsupportedSettings` / provider warning metadata。

Local proxy start shape：

```bash
npx @openai/codex login
npx openai-oauth@latest --host 127.0.0.1 --port 10531
```

可選固定 models：

```bash
npx openai-oauth@latest --host 127.0.0.1 --port 10531 --models gpt-5.5
```

### 6.3 Capability Matrix

| 能力                            | `openai_oauth_responses`                                                                                   | `openai_api`                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Conversation state              | 不支援 stateful replay；固定 `stateless_full_history`；每次送完整 conversation/context bundle              | 可實作 official Responses API state，但 v8.3 不預設依賴；是否啟用需 smoke test                          |
| 一般聊天                        | 主要 driver；active model 為 `gpt-5.5`；`/steel/oauth-chat` 與 provider tests 作為早期 evidence            | 第二 driver；只在 backend 明確選擇 API driver 時使用                                                    |
| Structured output               | 必須測 workbook patch JSON / Zod validation；未通過不得寫 workbook                                         | 必須測 structured output；未通過不得作 API driver workflow                                              |
| Function / tool calling         | 必須測 tool call event、tool result round-trip、max loop guard                                             | 必須測 tool call event、tool result round-trip、max loop guard                                          |
| Backend API tools               | 模型只產生 tool call；Node/backend 執行 lookup / pricing / workbook tools                                  | 同左；不得讓模型直接查 DB                                                                               |
| Image input                     | `/steel/oauth-chat` file path 已證明 OAuth file support；後續圖面品質另以 parse-quality smoke 分類         | 只在 backend 明確選擇 API driver 且有 evidence 時使用                                                   |
| PDF input                       | OAuth path 可處理 file input；文字 PDF、掃描 PDF、圖面 PDF 仍需依任務記錄 parse-quality evidence           | 只在 backend 明確選擇 API driver 且有 evidence 時使用                                                   |
| DOC/DOCX input                  | AI/provider 可處理 `.doc` / `.docx`；server-side `.doc` conversion 必須先由腳本證明                        | 只在 backend 明確選擇 API driver 且有 evidence 時使用                                                   |
| XLS/XLSX input                  | AI/provider 可處理 `.xls` / `.xlsx`；server-side `.xls` conversion 必須先由腳本證明                        | 只在 backend 明確選擇 API driver 且有 evidence 時使用                                                   |
| File Search                     | 不預設可用；若未測通，改用 backend retrieval tools 或 typed error                                          | 不預設可用；必須實作並測通 hosted tool 後才可用                                                         |
| Code Interpreter / Hosted Shell | 不預設可用；若需要裁切、旋轉、Excel 分析，必須先測通                                                       | 不預設可用；必須實作並測通 hosted tool 後才可用                                                         |
| Quota / cost                    | subscription-backed entitlement；不要求 reliable remaining quota API；需處理 auth/rate/subscription errors | usage-based；仍受 rate limits、budget、billing、project policy 影響；需處理 API key/billing/rate errors |

### 6.4 Capability 狀態模型

每個 driver、model、capability 都要保存狀態：

```ts
export type SteelCapabilityStatus =
  | 'unverified'
  | 'passed'
  | 'failed'
  | 'disabled'
  | 'not_applicable';

export interface SteelAIDriverCapability {
  provider: 'openai_oauth_responses' | 'openai_api';
  model: string;
  endpoint?: '/v1/responses' | '/v1/chat/completions';
  baseUrl?: string;
  stateMode: 'stateless_full_history' | 'provider_state' | 'none';
  text: SteelCapabilityStatus;
  streaming: SteelCapabilityStatus;
  toolCalling: SteelCapabilityStatus;
  structuredOutput: SteelCapabilityStatus;
  imageInput: SteelCapabilityStatus;
  pdfInput: SteelCapabilityStatus;
  docInput: SteelCapabilityStatus;
  docxInput: SteelCapabilityStatus;
  xlsInput: SteelCapabilityStatus;
  xlsxInput: SteelCapabilityStatus;
  fileSearch: SteelCapabilityStatus;
  codeInterpreter: SteelCapabilityStatus;
  spreadsheetAugmentation: SteelCapabilityStatus;
  lastSmokeTestAt?: string;
  smokeTestVersion: string;
  failureReason?: string;
  notes?: string;
}
```

Routing gate：

```ts
function canUseCapability(
  caps: SteelAIDriverCapability,
  capability: keyof SteelAIDriverCapability,
) {
  return caps[capability] === 'passed';
}
```

規則：

- `unverified` 不可視為可用。
- `failed` 不可自動 fallback 成另一 driver；若要走 API，必須是 backend 明確選擇 `openai_api` workflow。
- `openai_api` 沒有該 capability 的 backend policy/evidence 時，不得被當作保底。
- 若 primary 與 secondary 都不可用，回 typed error，對報價項標低信心或進人工複核。

### 6.5 File / Vision / Excel Driver Policy

Routing 規則：

- 一般純文字聊天：優先 `openai_oauth_responses`。若 `text` 或 `streaming` 未 `passed`，且 `openai_api` 對應 capability 已 `passed`，才可轉 `openai_api`；否則回 typed error。
- 需要 backend API tool calling：優先 `openai_oauth_responses`。若 tool loop 不可用，回 typed error，除非 backend 明確選擇 `openai_api` workflow。
- 需要圖片、PDF、掃描圖面、OCR、孔洞/折線/開槽判讀：先看 `openai_oauth_responses.imageInput/pdfInput` 是否可用。若不可用，不做自動 provider fallback，該附件標低信心並列人工複核，除非 backend 明確選擇 `openai_api` workflow。
- 需要 DOCX 訂單：必須有 `docxInput=passed`。否則不交給該 driver。
- 需要 XLS / XLSX evidence：必須有 `xlsInput` / `xlsxInput` 或 `spreadsheetAugmentation=passed`。否則不交給該 driver。
- 需要 hosted File Search / Code Interpreter：只有該 driver 的 hosted tool smoke test passed 才可用。否則走 backend retrieval / backend preprocessing / 人工複核，不可假設 official API fallback。
- provider auth failed、subscription limit、rate limit、event unsupported、file input unsupported、structured output invalid 時，必須分類錯誤、寫 audit、按 capability support matrix 決定 typed error 或明確 API workflow。

### 6.6 AI-first 檔案、OCR、圖面與 Excel Evidence 策略

本案仍採用 AI-first 判讀，不採用 Node app 自行實作主 OCR / 主圖面判讀 / 主 Excel semantic evidence。但 v8.3 將 provider 能力分成已測與未測；AI-first 不代表任何 driver 都可讀任何檔案。

檔案/圖片判讀 prompt guidance 必須走 LibreChat config 的 `fileAnalysis.instructions`。此欄位是 OpenAI-native / provider-native file analysis guidance，不是 LibreChat `ocr` / Mistral OCR pipeline 設定。Admin Panel 的設定 UI 必須更新同一個欄位，或透過既有 Admin config override API 寫入 `fieldPath: "fileAnalysis.instructions"`；不得在 Steel UI、provider adapter 或 `ocr.instructions` 寫死旋轉圖片、繁中辨識、image-based PDF 等提示。

流程：

```text
使用者上傳 PDF / 圖片 / DOCX / XLS / XLSX
 -> Node/backend 接收檔案、檢查權限、保存 metadata
 -> Node/backend 根據 driver 建立 file ref / signed URL / base64 part / provider-specific payload
 -> Capability gate 檢查 primary driver 是否 passed
 -> 若 primary failed，檢查 secondary 同 capability 是否 passed
 -> 只有 passed driver 可處理附件
 -> AI 判斷檔案內容、方向、孔洞、開槽、折線、Excel evidence、需要呼叫哪些 tools
 -> Node/backend 執行 tools、sanitize tool output、回傳給 AI
 -> AI 產生 structured quote / workbook patch / evidence notes
 -> Node/backend 驗證 patch、公式、欄位、權限、金額規則，通過後寫入 workbook truth
```

Node/backend 必須負責，不能省略：

- 檔案上傳入口、型別/大小/安全檢查、儲存、metadata、retention。
- provider payload builder：`file_id`、URL、base64、multipart 或 provider-specific content part。
- `openai_oauth_responses` stateless full-history prompt bundle。
- backend business tools：客戶查詢、產品價格查詢、重量規格查詢、切工查詢、workbook read / patch proposal。
- Tool args Zod validation、ACL、account-owner/guest-token boundary、prompt-injection filter、output sanitize、audit log、max tool-call guard。
- Workbook patch validation、公式驗證、不可填 0 規則、低信心規則、七分頁 schema validation。
- code-owned capability support result 保存與 routing gate。
- `fileAnalysis.instructions` 的 runtime 注入：只有目前 turn 含 image / PDF 類附件時才注入，包含 image-based PDF；不改寫使用者原始 message text。
- source refs / evidence refs 保存。

### 6.7 Provider state 規則

`steel_conversation_meta.aiProviderMeta` 保存 provider runtime trace，但不作唯一業務真實來源。

- LibreChat conversation / messages 保存聊天歷程。
- MongoDB `steel_workbooks` 保存 workbook truth。
- MongoDB `steel_ai_runs` 保存 provider run audit。
- `openai_oauth_responses` driver 不保存可 replay 的 provider conversation state；每次 run 由 backend 重建 prompt bundle。
- `openai_api` 可選擇保存 official `response_id` / `previous_response_id` 作 audit，但是否用於 state replay 必須獨立測試與開關控制。
- 後端不得依賴 provider 回抓歷史對話重建報價狀態；必須用 `contextRefs`、current workbook、active sources、instructions、memories 重建 prompt bundle。

每次 AI run 保存：

```ts
export interface SteelAIRunDraft {
  provider: 'openai_oauth_responses' | 'openai_api';
  steelConversationMetaId: string;
  providerResponseId?: string;
  previousProviderResponseId?: string;
  model: string;
  endpoint: '/v1/responses' | '/v1/chat/completions';
  stateMode: 'stateless_full_history' | 'provider_state';
  selectedBy: 'user' | 'system' | 'admin';
  promptTokens?: number;
  completionTokens?: number;
  contextRefs: PromptContextRefs;
  toolCallIds: string[];
  attachedProviderFileIds?: string[];
  attachedSourceFileIds?: string[];
  status: 'started' | 'completed' | 'failed' | 'fallback_completed';
  fallbackFromProvider?: 'openai_oauth_responses' | 'openai_api';
  fallbackToProvider?: 'openai_oauth_responses' | 'openai_api';
  fallbackReason?: string;
  errorCategory?:
    | 'provider_auth_failed'
    | 'provider_subscription_limited'
    | 'provider_quota_unknown'
    | 'provider_rate_limited'
    | 'provider_tool_call_unsupported'
    | 'provider_file_input_unsupported'
    | 'provider_vision_input_unsupported'
    | 'provider_docx_input_unsupported'
    | 'provider_xls_input_unsupported'
    | 'provider_xlsx_input_unsupported'
    | 'provider_hosted_tool_unsupported'
    | 'fallback_capability_not_passed'
    | 'structured_output_invalid'
    | 'unknown';
  errorSummary?: string;
}
```

### 6.8 Model selector 與 LibreChat UI 規則

Steel Workspace 的 model selector 不直接讀 LibreChat 全域 provider 清單。後端依 driver capability matrix 回傳 allowlist。

實作時不可建立第二套平行 model/default setting 系統。Phase 1 必須先對齊 LibreChat 現有 `/api/models`、`/api/endpoints`、`modelSpecs`、default preset、default setting 與 runtime setting 流程，再把 Steel driver capability matrix 疊成 provider-neutral `SteelRuntimeOptions`。

```ts
export interface SteelModelOption {
  id: string;
  label: string;
  provider: 'openai_oauth_responses' | 'openai_api';
  endpoint: '/v1/responses' | '/v1/chat/completions';
  defaultForSteel: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsVisionInput: SteelCapabilityStatus;
  supportsFileInput: SteelCapabilityStatus;
  supportsPdfInput: SteelCapabilityStatus;
  supportsDocxInput: SteelCapabilityStatus;
  supportsXlsInput: SteelCapabilityStatus;
  supportsXlsxInput: SteelCapabilityStatus;
  supportsHostedFileSearch: SteelCapabilityStatus;
  supportsCodeInterpreter: SteelCapabilityStatus;
  smokeTestStatus: 'passed' | 'failed' | 'untested';
  enabled: boolean;
  disabledReason?: string;
}
```

UI 規則：

- Steel Workspace 預設選擇 `openai_oauth_responses` / `/v1/responses` + `gpt-5.5`。
- 若使用者上傳 PDF / 圖片 / DOCX / XLS / XLSX，前端先送 metadata；實際 driver 由後端 capability gate 決定。
- Model selector 顯示 capability badges：Text、Tools、Image、PDF、DOCX、XLS、XLSX、Hosted Tools。
- `openai_api` 不因存在 API key 就自動顯示為可用；必須由 backend 明確選擇 API workflow。
- 未列入 backend support matrix 的模型不得進報價 runtime。
- 未列入 file / vision / XLS/XLSX support matrix 的模型不得處理附件報價。
- UI 要顯示 typed error，例如「PDF capability 尚未可用，已列入人工複核」，而不是靜默 fallback。

### 6.9 用量、成本與 limit 規則

- `openai_oauth_responses` 是 subscription-backed entitlement；不得假設存在可靠的 `remaining quota` 查詢 API。
- 使用者提出的時間上限或操作限制只能列為 operational observation，不可寫成已由官方 API 文件保證的固定值。
- `openai_api` 是 usage-based；不是無限制，也不是未測保底。
- app 必須處理 `subscription_limit_reached`、`rate_limited`、`usage_limit_reached`、`billing_unavailable`、`api_key_missing` 類錯誤。
- 對使用者顯示用量時，OAuth driver 顯示「subscription driver 狀態 / 最近錯誤 / 是否改走 API driver」；API driver 顯示「token usage / estimated cost / rate limit headers / budget status」。

### 6.10 環境設定

```env
STEEL_OPENAI_PROVIDER=OAUTH
STEEL_OPENAI_DEFAULT_MODEL=gpt-5.5
STEEL_OPENAI_REASONING_EFFORT=medium

STEEL_OPENAI_API_KEY_REQUIRED_FOR_PRODUCTION=true
OPENAI_API_KEY=...

STEEL_ALLOWED_MODEL_PROVIDER=openai_oauth_responses,openai_api
STEEL_ENABLE_MULTI_PROVIDER=true
```

說明：`STEEL_OPENAI_PROVIDER=OAUTH` 是預設 OAuth Responses path；`STEEL_OPENAI_PROVIDER=API` 表示明確選擇 official OpenAI API driver。Direct provider 不需要 `/v1` base URL 或 transport selector；local proxy 只作 local/dev manual smoke probe，不可作 hosted multi-user service，也不進 runtime route。不要使用 `STEEL_OPENAI_OAUTH_AUTO_FALLBACK` 或 per-capability `STEEL_FALLBACK_*` env matrix。

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
- pgvector 僅用於 source chunks / rules retrieval，不替代 reviewed table 查價。

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

### 8.3 龍頂鋼鐵手冊\_文字版.docx

用途：

- 產品規格與單位重量來源。
- 包含 H 型鋼、C 型鋼、槽鐵、工字鐵、角鐵、扁鐵、方鋼、圓鋼、管材、鋼板等。
- 只作重量、標準規格、尺寸對照來源。
- 不可取代產品價格表單價來源。

schema/data-model 設計：

- Code agent 依手冊內容盤點需要的欄位與關係。
- 手冊內容可用來制定真實 Supabase schema/data model，不只是 mock fixture 來源。
- `tasks/v8.3/source-schema-mapping.md` 記錄規格表、價錢表、公式與加工價格等 DB-bound 中文來源 label/header/term 到英文 canonical schema key 的對應。
- 不建立 `review_status` / `corrected_text` 這類筆誤審核欄位；後續 code agent 討論 data SQL/import 時，輸入應已是正確資料。
- 同步設計 code 版 mapping，供 backend prompt/tool/schema 使用。
- AI API 透過 mapping context 對應正確 schema key；未知 key 追問或進人工複核，不得自行發明。
- 用手冊內容檢查 `steel.weight_specs` / `steel.material_rules` / `steel.import_rule_notes` / `steel.source_chunks` 是否足夠。
- 只在 schema/data model 缺漏時修改 Supabase schema/migration。
- 不在 chat UX 優先階段實作真實手冊 data SQL import。
- 後續 Admin 網頁透過 web fetch data + table UI preview/edit 維護資料，不需要上傳 DOCX。

### 8.4 龍頂鋼鐵手冊.pdf

Admin Import 不接受手冊 PDF。若業務需要匯入手冊內容，v8.3 先以鋼鐵手冊 DOCX 制定 schema/data model；PDF 不進 Admin web upload path，真實手冊 data SQL import 後續再做。

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

v8.3 ERP XLSX 欄位名稱視為穩定且 append-only：未來 ERP export 可以新增欄位，但既有 required columns 不應 rename。Parser 必須容忍額外欄位，同時保留 required-key validation。

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

允許 MVP runtime reviewed lookup tools：

- `lookup_catalog_families`
- `lookup_quote_rules`
- `search_customers`
- `search_price_candidates`
- `lookup_formula`

MVP runtime 流程由 AI 判斷訂單鋼材類別、可能鋼材種類、表面處理、尺寸與查表候選 query。當產品/品類推論不足時，AI 呼叫 `lookup_catalog_families` 取得 Admin 補充的品名/品類推論 rules 與 reviewed vocabulary candidates；接著用選定 catalog keys 呼叫 `lookup_quote_rules`、`search_customers`、`search_price_candidates`、`lookup_formula`。Backend tools 回傳有來源、有界的 catalog/customer/rule/price/formula 候選資料；AI 再從候選中推導最可信的價格與公式路徑，必要時列出選項請使用者確認，並產生 workbook 內容、說明與待確認事項。

Agent Instruction 是 Admin-managed default instruction，每輪 Steel quote turn 都內建注入。它負責全域流程、工具使用、安全與來源驗證規則，可由 Admin 後台更新與版本化，不應寫死在 provider adapter。規劃儲存在 `steel.agent_instructions`。`lookup_quote_rules` 是 AI-callable merged runtime lookup，回傳任務範圍內的細部 instruction packets 與 reviewed quote defaults；`lookup_instructions` / `lookup_defaults` 只保留為內部組成概念，不是 runtime tools。

Agent Instruction 可包含 Steel 訂單推導的全域規則：OCR / 圖片與 PDF 方向判斷、繁中保留、圖面與表格優先序、工具路由、訂單拆行、缺欄位確認、workbook provisional/confirmed 寫入規則、來源驗證與低信心回覆。細部品類推論規則由 `lookup_catalog_families` 回傳；鋼材、加工、公式、workbook 輸出等 rules/defaults 則由 `lookup_quote_rules` 查回。

Agent Instruction 初版文字記錄在 `tasks/steel-data-rules-architecture/agent-instructions.md`，`steel.instruction_packets` 設計基準記錄在 `tasks/steel-data-rules-architecture/instruction-packets.md`。兩者未來插入資料庫後，注入 AI instruction prompt 的 body text 統一使用繁體中文；API/schema/tool keys 可維持 canonical English。這兩份文件是 docs/design baseline；真正 implementation 若新增 Steel PostgreSQL schema，仍需同步更新 `supabase/schema.sql` 與一個新的 migration。

Workbook 目前透過 provider-facing `patch_quote_workbook` output tool 更新。當 workbook context 存在時，AI 可呼叫 `patch_quote_workbook` 產生 compact semantic quote data；backend projection 再產生 typed workbook operations，並用 workbook schema/service 驗證與套用。`patch_quote_workbook` 不是 reviewed lookup tool，不應和 `search_price_candidates` / `lookup_quote_rules` 這類查資料工具混在同一個 MVP lookup list。

`docs/reference/instruction.txt` 是目前 instruction seed source。Runtime 不應每次把整份 instruction 檔注入 prompt；應透過 `lookup_quote_rules` 取回與任務相關的 reviewed packets/defaults，例如價格先於重量、口語品名轉換、C 型鋼規則、長條料配料、切工、孔洞、開槽、折工、圖片/PDF 判讀與 workbook 輸出要求。

不列為 MVP runtime tools：

- `normalize_quote_item`、`generate_price_search_terms`、`rank_price_candidates`：AI reasoning / backend validation，不是 tool。
- `lookup_customer`：由 `search_customers` 回傳 exact 或 ambiguous customer candidates、tier context、customer-specific rules。
- `lookup_spec_price`：由 `search_price_candidates` exact/candidate-query 模式涵蓋。
- `lookup_weight_spec`、`lookup_cutting_price`、`lookup_processing_price`、material-rule lookup：backend internal repository/validation 或 future extension，不從 MVP tool surface 暴露。
- `lookup_formula_version`：改用 AI-facing `lookup_formula`，由 backend 回傳 reviewed active formula candidates 與 version/source refs。
- `allocate_stock_lengths`、`calculate_plate_weight`、`calculate_bar_weight`、`calculate_cutting_fee`、`calculate_hole_fee`、`calculate_slotting_fee`、`calculate_bending_fee`、`calculate_line_total`：不作為 backend runtime calculator module，也不是 MVP AI-callable tools；這些算術由 AI 依 reviewed rules/source prompt context 執行，backend 只驗證來源、workbook patch、以及 workbook summary totals 是否符合 line subtotal sums。
- `get_workbook`：workbook context 由 quote runtime 提供，或等後續明確 workbook-context slice 再開。
- `parse_xlsx_source`、`admin_import_generate_merge_table`、`admin_import_apply_merge_patch`：Admin/import pipeline，不是 quote runtime MVP tools。
- `search_source_chunks`：對 MVP 推導流程太廣；instruction/default 推導應使用 `lookup_quote_rules` 取得 task-scoped reviewed packets/defaults，而不是搜尋任意 source text。
- `search_orders`、`get_order_detail`、`search_project_sources`、`search_relevant_memories`、`create_memory_candidate`、`update_memory_candidate`、`export_workbook`、`export_workbook_sheets`：future/adjacent surfaces，不能混入 MVP quote runtime tool list。

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
packages/api/src/steel/ai/providers/openai-oauth-responses
packages/api/src/steel/ai/providers/openai-api
packages/api/src/steel/ai/capabilities
packages/api/src/steel/prompt
```

流程：

1. 接收 conversation message。
2. 驗證 optional `selectedWorkbookRefs` 是否符合目前 workbook/version/sheet/row/column。
3. 取得 selected model 與 `STEEL_OPENAI_PROVIDER`。
4. 讀取 `steel_conversation_meta`。
5. 根據使用者訊息與附件需求產生 required capability set，例如 `text + toolCalling`、`pdfInput + structuredOutput`、`xlsxInput + toolCalling`。
6. 讀取 driver capability support matrix；primary driver 不可用時，回 typed error，除非 backend 明確選擇 `openai_api` workflow。
7. 組 Prompt Bundle；`openai_oauth_responses` 固定使用 `stateless_full_history`。
8. 呼叫 selected `SteelAIProvider.run(input)`。
9. 將 provider events 統一轉成 `SteelAIEvent`。
10. 處理 tool calling loop；所有 tool calls 仍由 Steel backend 驗證與執行。
11. 處理 structured outputs。
12. 寫入 `steel_ai_runs`。
13. 更新 `steel_conversation_meta.aiProviderMeta`。
14. 回寫 workbook patch / memory candidate / merge table patch。

Provider interface：

```ts
export interface SteelAIProvider {
  id: 'openai_oauth_responses' | 'openai_api';
  listModels(input: SteelListModelsInput): Promise<SteelModelOption[]>;
  smokeTest(input: SteelProviderSmokeTestInput): Promise<SteelProviderSmokeTestResult>;
  run(input: SteelAIRunInput): AsyncIterable<SteelAIEvent>;
}

export interface SteelAIRunInput {
  conversationId: string;
  steelConversationMetaId: string;
  provider: 'openai_oauth_responses' | 'openai_api';
  endpoint: '/v1/responses' | '/v1/chat/completions';
  stateMode: 'stateless_full_history' | 'provider_state';
  model: string;
  messages: SteelMessage[];
  systemPrompt: string;
  tools: SteelToolDefinition[];
  selectedWorkbookRefs?: SelectedWorkbookRef[];
  contextRefs: PromptContextRefs;
  attachedFiles?: SteelAttachedFileForProvider[];
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

`openai_oauth_responses` provider acceptance：

- CLI proxy base URL 可設定，預設 `http://127.0.0.1:10531/v1`。
- 呼叫 `/v1/responses` 可 injectable，測試可使用 mock server，不一定打真實 OAuth provider。
- OAuth login / token store 不寫入 frontend localStorage；server-side encrypted store 或 local dev file only。
- `stateMode=stateless_full_history`；每次 tool result round-trip 皆重送完整 prompt bundle。
- 必測/evidence cases：純文字聊天、streaming、tool call、tool result round-trip、structured workbook patch、image、PDF、DOCX、XLS、XLSX；Phase 1 可使用 code-owned support matrix 與既有 `/steel/oauth-chat` file evidence。
- 若 provider 不支援某檔案型別，必須回 typed error，不得靜默降級。
- Runaway tool loop 有 typed error 與 audit。
- Invalid structured output 不修改 workbook。
- 所有 tool calls 寫入 `steel_tool_calls`。
- 至少一個 manual live smoke test 使用 `openai_oauth_responses` 建立 customer-visible workbook。

`openai_api` provider acceptance：

- 實作前校正官方 Responses API type。
- 只有 backend 明確選擇 API workflow 時，才可作 secondary route；不作自動 fallback。
- 不得因 primary driver 失敗就無條件轉官方 API。
- 若使用 `previousResponseId` 或 Conversations state，需獨立 live smoke test；未測通時只作 audit，不作 replay。
- tool calling loop 有 max call guard。
- structured output invalid 時不修改 workbook。

## 13. Quote Resolution Engine

位置：

```text
packages/api/src/steel/quote
packages/api/src/steel/pricing
packages/api/src/steel/tools
packages/api/src/steel/workbook
```

核心流程：

```text
AI interprets quote evidence
 -> Admin-managed Agent Instruction is already injected
 -> lookup_catalog_families when product/category inference is insufficient
 -> lookup_quote_rules for merged task-scoped rules/defaults
 -> search_customers returns customer candidates/tier/customer-specific rules
 -> AI derives material/surface/dimension candidates
 -> AI generates bounded product-price candidateQueries
 -> search_price_candidates / lookup_formula
 -> AI calculation from reviewed source/rule prompt context
 -> backend validates source scope, workbook patch, and subtotal consistency
 -> quote_trace
 -> provisional or confirmed workbook_line
```

價格先於重量：

- 除非使用者明確提供單價，材料或加工品項必須先搜尋價格資料。
- 找候選品項後依客戶分級與該品項計價單位取價。
- 再查手冊取得重量與規格。
- 手冊重量只能用於計算重量、比對規格、或價格明確為 kg 單價時輔助計價。
- 不可用手冊重量直接推材料售價。

---

## 14. Product Price Candidate Search

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
  channel:
    | 'admin_erp_xlsx'
    | 'admin_table_ui'
    | 'handbook_reviewed_data'
    | 'chat_evidence'
    | 'manual'
    | 'legacy_normalization_proof';
  factType:
    | 'customer'
    | 'product_price'
    | 'product_price_unit_weight'
    | 'handbook_weight'
    | 'formula'
    | 'cutting_price'
    | 'processing_price'
    | 'hole_price'
    | 'slotting_price'
    | 'bending_price'
    | 'material_rule'
    | 'workbook_output_format'
    | 'quote_request_evidence';
  sourceFile?: string;
  sourceVersionId?: string;
  locator: string;
  confidence?: 'high' | 'medium' | 'low' | 'unknown';
  extractedLabel?: string;
  canonicalKey?: string;
  fileId?: string;
  bbox?: string;
}
```

Phase 2 schema work should store source references as a `source_refs` JSONB array on quoteable fact rows. A normalized source-reference table is deferred until source-ref querying becomes a real product need. Raw source files, full source tables, and full customer inquiry contents must not be copied into the source reference.

Legacy source-type names such as:

```ts
type LegacySourceType =
  | 'database'
  | 'future_handbook_import'
  | 'admin_erp_xlsx'
  | 'admin_table_ui'
  | 'chat_pdf_evidence'
  | 'manual';
```

are superseded by `channel` plus `factType`.

### 14.2 Search Candidates

Price search candidates are generated by AI reasoning, not by an exposed
`generate_price_search_terms` tool. AI must not pass a nonexistent raw customer
string such as `亞L30x30` as a canonical price key. It should derive bounded
`candidateQueries` first, then call `search_price_candidates`.

Candidate generation should consider:

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

### 14.3 AI Candidate Selection

Price candidate ranking/selection is owned by AI after receiving bounded,
source-backed options. Backend returns match metadata, source refs, missing/zero
markers, and rejected reasons; it does not run final quote ranking or expose a
`rank_price_candidates` MVP tool.

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
  interpretedItemName: string;
  candidateQueries: string[];
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

## 15. Customer Search And Customer-Specific Rules

`search_customers` 功能：

- 比對客戶名稱、別名、案場常見資料。
- 從 `steel.customers` / `steel.customer_aliases` / `steel.customer_tiers` 取得分級。
- 回傳 matched/ambiguous customer candidates、tier context、以及 customer-specific reviewed rules/defaults。
- 客戶不明、多筆相似、分級不明時標低信心；AI 決定是否請使用者確認。
- Backend 不做 hidden customer resolver，也不替 AI 選定客戶。

Acceptance：

- Exact customer match 回傳 tier。
- Alias match 回傳 tier 並記錄 alias source。
- Customer-specific rules/defaults 以 bounded reviewed tool output 回傳。
- 多筆相似回傳 candidates，不猜。
- 客戶未知時 workbook line 可建立，但價格決策低信心。

---

## 16. AI-Led Catalog Family Rule Guidance

`lookup_catalog_families` 支援：

- Admin-supplied product/category inference rules for ambiguous customer wording.
- Reviewed vocabulary candidates for category, material/surface, product names,
  and common spec fragments.
- Guidance for AI to choose catalog keys for `lookup_quote_rules`,
  `search_price_candidates`, and `lookup_formula`, or to ask the user for
  confirmation.

Backend does not implement a Phase 2 material/spec parser, resolver, or
normalization dictionary. AI interprets quote evidence and may use the following
examples as rule-prompt/vocabulary candidates when returned by reviewed tools:

常見轉換：

- 1 英吋約 25mm。
- 1 英半 / 1 1/2 約 38mm 或管外徑約 48.3mm。
- C75 常對應 C75x45x15。
- C100 常對應 C100x50x20。
- L38 常對應 38x38 角鐵。
- 黑圓管 48.1 may suggest candidates: 黑圓管、黑管、黑A、黑B、黑AB圓管、1 1/2、48.3。
- 角鐵需同時搜尋：角鐵、三角鐵、英吋、mm 尺寸。
- 浪板需同時搜尋：顏色、材質、板型、用途。
- 網材需搜尋：線徑、孔距、網片、點焊網。

口語轉換只代表候選，不代表完全匹配。厚度、材質、長度、單位或表面處理不明時信心低。

---

## 17. Processing And Cutting Rule Prompts

Phase 2 does not implement a backend stock allocation engine. For long materials
such as angle, flat bar, channel, I-beam, round bar, square bar, pipes, square
tubes, and rectangular tubes, `lookup_quote_rules` returns reviewed
stock-length/cutting/no-cut/head-tail prompts and `search_price_candidates` can
return reviewed source rows when a processing price exists. AI applies the rules
and calculates allocation/cutting quantities.

Rule prompt examples:

- 若客戶要裁切長度，除非使用者明確說可切清，否則一律視為「不賣切清」。
- 材料費不可直接用成品淨長重量計算。
- 必須依可售素材長度配料後計價。
- 價格表素材長度、素材規格、單支價或素材重量為主要計價依據。
- 無明確素材長度時可用低信心 6M assumption，但須在說明/workbook notes
  標示。

Backend validates selected source/rule scope and workbook subtotal consistency;
it does not calculate or persist a canonical stock-allocation result.

---

## 18. AI Calculation Rule Prompt Boundary

AI 負責判讀資料、選擇 reviewed source/rule context，並依規則計算重量、
加工與 line subtotal。Backend 不保留平行 canonical quote calculator；它只
驗證工具來源、rule scope、workbook patch shape、不可用 `0` 代表未知金額，
以及 `summary.totalAmount` / `summary.confirmedAmount` 是否等於各 line
`subtotal` 加總。OAuth/Codex path 不要求 hosted Code Interpreter disclosure
作為計算證據。

`lookup_quote_rules` 可回傳以下 task-scoped rule prompts，讓 AI 自主計算：

- 板材重量：`單片重量 kg = 最長邊 mm x 最寬邊 mm x 厚度 mm x 密度 / 1,000,000`；
  黑鐵/碳鋼密度 7.85，不鏽鋼密度 7.93；異形、切角、沖孔、折板先用外包
  四方尺寸，有展開尺寸則優先用展開尺寸。
- 型材重量：`總重 = kg/m x 長度 m x 數量`；`2C` 表示兩支組合時，重量與
  數量需乘 2。
- 切工：`切工費 = (切工單價 + 加價) x 切工次數 x 對應數量`。AI 必須區分
  `operationCutCount` 與 `billableCutCount`；出現「修」「修頭」「修頭尾」
  或 `+修` 不可只算中間切斷；有餘料且規則允許省略切尾時，只省略尾修刀，
  不省略成品與餘料間的分離刀。C 型鋼 true zero 切工只來自 selected
  reviewed rule/default。
- 孔加工：孔數必須從圖面孔位判斷，不可只依底部表格；`4-Ø22` = 每片 4
  孔；孔數、孔型、孔徑或數量倍率不清時不可當 `0`，需列人工複核或詢問。
  未來 Admin-reviewed 橢圓孔、長孔、長方孔或 custom 非圓孔價格可由工具回傳
  source rows/rules，再由 AI 計算。
- 開槽：`開槽費 = 總開槽 M x 元/M`；看連續需開槽邊長，不看零件總長。
  L 型兩段相加，U/ㄇ 型三段相加，多條不相連路徑分別加總；路徑不明不可
  當 `0`。
- 折工：`折工費 = 總重 kg x 折刀數 x 元/kg/刀`；折刀數是鐵板每一次方向
  改變，尺寸線、中心線、孔線、外框、切角、開槽不可誤判為折線。
- Line subtotal：`小計 = 材料費 + 切工費 + 孔加工費 + 開槽費 + 折工費 +
  其他明確加工費`。確定費用與低信心暫估費用分開彙總；未確認單價或金額
  顯示 `未確認`，不可填 `0`。

---

## 19. AI-first Vision / OCR / File Evidence Pipeline

此 pipeline 只用於報價對話中的圖面/圖片/PDF/DOCX/XLS/XLSX evidence，不屬於 Admin data import。Admin ERP 匯入以 `.xlsx` normalized path 為準；legacy `.xls` server conversion 必須先由開發腳本測通。鋼鐵手冊 DOCX 是 schema/data-model reference，不是 Admin web upload。

本版原則：

```text
AI provider 做主判讀。
Node/backend 不做主 OCR、不做主圖面判讀、不用自製 Excel parser 取代 AI evidence。
Node/backend 必須做檔案接收、provider file ref、capability gate、tool runtime、安全、驗證、audit。
official OpenAI API 不可當成未決策自動 fallback；只有 backend 明確選擇 API workflow 時才使用。
```

所有圖片、掃描 PDF、拍照圖面、訂單截圖、手寫單、材料表圖片，在讀文字前必須先由 AI 判斷方向；若需要裁切、旋轉、放大、影像處理，優先使用 backend support matrix 允許的 provider 能力或 backend image preprocessing，不可假設任何 driver 都可用 hosted tools。

方向、繁中保留、image-based PDF 等提示屬於 `fileAnalysis.instructions` runtime config。此設定由 `librechat.yaml` 或 Admin config override 管理；Admin Panel UI 後續應提供文字欄位更新同一份 config。Provider adapter 只負責 payload/options，例如 OpenAI image `imageDetail`，不擁有這段提示文字。

流程：

1. upload file / image to LibreChat / Steel backend。
2. backend 檢查檔案型別、大小、權限、account-owner/guest-token boundary、retention policy。
3. backend 建立 source file metadata，並依 driver 建立 provider 可用 file ref：file id、signed URL、base64 part、multipart 或 provider-specific payload。
4. backend 解析需求 capability：`imageInput`、`pdfInput`、`docxInput`、`xlsInput`、`xlsxInput`、`toolCalling`、`structuredOutput`。
5. `CapabilityGate` 優先檢查 `openai_oauth_responses` support matrix；若不可用，回 typed error 並建立人工複核項，除非 backend 明確選擇 `openai_api` workflow。
6. AI 判斷方向：0 / 90 / 180 / 270。
7. AI 判斷 visual layout：table / drawing / handwritten / mixed。
8. AI 判讀 OCR / vision：孔洞、長孔、開槽、折線、切角、切工標註、底表與圖面不一致處。
9. AI 需要業務資料時產生 tool call：customer lookup、price lookup、weight spec lookup、cutting price lookup、workbook read / patch proposal。
10. Node/backend 執行 tool、驗證 args、查 DB、sanitize tool output，再回給 AI。
11. AI 產生 structured intermediate result、報價明細、低信心原因、evidence refs、workbook patch proposal。
12. Node/backend 驗證 workbook patch、公式、單價來源、不可填 0 規則、七分頁 schema；通過才寫入 workbook truth。
13. never write formal source tables without Admin ERP XLSX import, reviewed table UI edit, or a future approved handbook data SQL import。

低信心條件：

- OCR 破碎、欄位錯位、解析度低、反光、模糊、裁切。
- 手寫遮住、方向不明、OCR 與 vision 不一致。
- 孔洞、開槽、折線、切角、尺寸不清。
- `openai_oauth_responses` 不在 file / vision / XLS/XLSX support matrix 中。
- `openai_api` workflow 未被 backend 明確選擇或缺乏對應 support evidence。
- file id / provider payload 建立失敗。
- hosted tool 不可用。

禁止：

- 因為 Node/backend 沒有 OCR parser 就略過圖面判讀。
- 用 Node OCR/parser 結果覆蓋 AI vision 判斷。
- 把任何 provider 的一般 file part 能力視為已完成鋼鐵圖面判讀。
- 在 custom backend tool 中直接接受 raw SQL / raw Mongo query。
- 將 official OpenAI API 當成未經決策的自動 fallback；API driver 只能在 backend 明確選擇該 workflow 時使用。

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
  calculationBasis:
    | 'database_default'
    | 'user_unit_price'
    | 'user_line_total'
    | 'manual_unconfirmed';
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

- UI 支援一則 message 內多個 selected workbook targets。
- 若 message input 尚未有使用者文字，下一個 cell selection 會覆蓋原有 marker；若已有使用者文字，下一個 selection 會換行新增 marker。
- 每個 marker 必須清楚顯示分頁與欄位/位置，例如 `報價明細 / line-1 / 報價單價`，供使用者確認目標。
- Request envelope 使用 `selectedWorkbookRefs: SelectedWorkbookRef[]`，可帶多個 structured refs；後端驗證每個 ref 的 workbook/version/sheet/row/column。
- 多處修改可以由多個 selected refs 或使用者文字描述明確位置觸發；AI 可產生多個 patch ops。
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
7. 報價單

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
- 報價單分頁。
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

正式 ongoing Admin Import 入口以 ERP `.xlsx` parsed data 為 normalized path；legacy `.xls` 只有在 server-side conversion 腳本測通後才可進正式後端流程。鋼鐵手冊 DOCX 處理是 schema/data-model reference，不是 Admin 網頁上傳入口，也不是 reusable parser；真實 data SQL import 後續再做。

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
- 已接受 workbook state、reviewed source context、以及通過 subtotal consistency
  validation 的 quote result。

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
15. 報價單分頁遮罩測試。
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
- PDF/DOCX 不能進 ongoing Admin ERP Import；Admin 匯入以 ERP `.xlsx` normalized path 為準，legacy `.xls` 需先有 tested conversion。
- Excel 必須含 7 個必要分頁。
- 報價單不含客戶分級與內部資料。

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

### 30.2 AI Provider / openai-oauth / official OpenAI API

- [ ] `SteelAIProvider` interface 已抽象化，不讓 Steel Orchestrator 直接依賴單一 provider client 或 official OpenAI client。
- [ ] `openai_oauth_responses` driver 已實作，使用 direct `openai-oauth-provider` 作為 coded runtime path；`openai-oauth` CLI localhost proxy 只作手動 diagnostic smoke probe。
- [ ] `openai_oauth_responses` driver 固定 `stateMode=stateless_full_history`，每次 request 由 backend 傳完整 prompt bundle。
- [ ] OAuth login / token store 有 server-side 保護；不把 OAuth token 存在 frontend localStorage。
- [ ] `check quota remaining` 不作 OAuth driver 必備功能；OAuth driver 只做 model availability / rate-limit / auth error smoke handling。
- [ ] LibreChat Steel Workspace model selector 預設選擇 `openai_oauth_responses` + `gpt-5.5`，不顯示 `gpt-5.4` 或以下模型，並沿用 LibreChat model/default setting framework 解析預設 model 與 runtime settings。
- [ ] Phase 1 已建立可測的 OpenAI OAuth direct-provider service seam；完整 chat-to-workbook live smoke 仍屬 Phase 3 gate。
- [ ] `openai_oauth_responses` text / streaming smoke test passed。
- [ ] `openai_oauth_responses` tool calling / tool result round-trip smoke test passed。
- [ ] `openai_oauth_responses` structured workbook patch smoke test passed；invalid structured output 不修改 workbook。
- [ ] `openai_oauth_responses` image / PDF / DOCX / XLS / XLSX smoke tests 分別紀錄 passed / failed / disabled。
- [ ] `openai_api` driver 已實作但不當作未測保底；只有 backend 明確選擇 API workflow 時才可使用。
- [ ] official API PDF / image / DOCX / XLS / XLSX / hosted tool smoke tests 分別紀錄，不以存在 `OPENAI_API_KEY` 代表可用。
- [ ] 不使用 `STEEL_FALLBACK_REQUIRE_CAPABILITY_PASSED` 或 `STEEL_FALLBACK_ON_*` env matrix。
- [ ] capability 不可用時回 typed error，建立低信心或人工複核項，不靜默重試。
- [ ] tool calling loop 有 max call guard。
- [ ] 所有 provider event、tool call、fallback decision 寫入 `steel_ai_runs` / `steel_tool_calls` / audit log。

### 30.3 Quote Engine

- [ ] 價格先於重量有 eval。
- [ ] 缺價格不可填 0。
- [ ] 多關鍵字搜尋有 eval。
- [ ] `lookup_catalog_families` 可回傳品名/品類推論 rules 與 reviewed vocabulary candidates。
- [ ] `search_customers` 可回傳 customer candidates、tier context、customer-specific rules。
- [ ] Price candidate options 由 AI 選擇/排序；多候選時列選項讓使用者確認。
- [ ] Cutting/stock-length/hole/slotting/bending rules 只作 prompt/tool context，AI 依規則計算。
- [ ] Workbook subtotal validator 有單元測試，confirmed summary total 必須等於 line subtotal sum。

### 30.4 Workbook / Excel

- [ ] Workbook JSON 固定七分頁。
- [ ] Workbook patch/selection DTOs and backend validation ownership are separated as documented.
- [ ] ExcelJS export 固定七分頁。
- [ ] 指定分頁下載可選任意 workbook sheet，不做 customer mask 或 system-order 專用限制。
- [ ] 未確認單價 / 金額顯示「未確認」。
- [ ] 指定分頁下載有 access check 與 audit。

### 30.5 Source / Import

- [ ] Admin ERP Import 拒絕 DOCX/PDF/image upload。
- [ ] Admin Import 正式入口只接受 ERP `.xlsx` parsed data、tested legacy `.xls` normalization output，或 validated table UI edits。
- [ ] 鋼鐵手冊 DOCX 用於真實 schema/data-model 設計，不暴露為 Admin web upload，也不要求 reusable parser；真實 data SQL import 延後到後續 code-agent data task。
- [ ] `tasks/v8.3/source-schema-mapping.md` 與 code 版 mapping 設計完成，AI API 可用 mapping context 對應正確 schema key。
- [ ] Merge table valid / invalid / needs_review 由 code 決定。
- [ ] Commit only valid rows。
- [ ] Transaction rollback 測試通過。
- [ ] 資料匯入引發的價格異動寫入 `steel.price_history`。

### 30.6 UX Acceptance

- [ ] 使用者貼 LINE 訂單可產生 Workbook。
- [ ] Phase 3 Chat Workspace 是獨立 Steel workspace，不依賴重寫 core LibreChat chat store / global message flow。
- [ ] 手機版與桌面版共用同一套 Steel UX framework、API contracts 與 mock data。
- [ ] 手機版 Workbook Preview 是 full-view modal，右上角有 X 關閉。
- [ ] 點選 workbook cell 後，cell 有 selected style，底部 message input 顯示含分頁與欄位/位置的 marker。
- [ ] 尚未輸入文字時，下一個 cell selection 覆蓋原 marker；已有文字時，下一個 cell selection 換行新增 marker。
- [ ] 提交 message 時可送多個 structured selected workbook refs；AI 更新 workbook 需經 workbook patch service，UI 依 patch/refetch 同步。
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
GET    /api/steel/ai/models

POST   /api/steel/conversations/:conversationMetaId/exports
GET    /api/steel/exports/:exportId/download

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

| 要求名稱                   | 本文件 interface        |
| -------------------------- | ----------------------- |
| `steel_conversation_meta`  | `SteelConversationMeta` |
| `steel_workbooks`          | `SteelWorkbook`         |
| `workbook_line`            | `WorkbookLine`          |
| `quote_trace`              | `QuoteTrace`            |
| `price_candidate`          | `PriceCandidate`        |
| `source_manifest`          | `SourceManifest`        |
| `admin_source_preview_row` | `AdminSourcePreviewRow` |
| `system_order_row`         | `SystemOrderRow`        |
| `customer_quote_row`       | `CustomerQuoteRow`      |
| `admin_merge_row`          | `AdminMergeRow`         |
| `memory_candidate`         | `MemoryCandidate`       |

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

以下是 v8.3 目標 schema 摘要；實作時需更新 `supabase/schema.sql` 並建立 one-change migration。

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
- 若現有 schema 欄位名稱仍反映舊外部系統語彙，v8.3 migration 應改成中性的 `source_customer_code` / `source_item_code`。
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
- 下載報價單。
- 只看人工複核。

Phase 3 先建立獨立 Steel workspace，重用 LibreChat auth、navigation、model selector 能力，但不要求改造 core LibreChat chat store / global message flow。手機版與桌面版共用同一套 Steel UX framework；手機版 Workbook Preview 以 full-view modal 開啟，右上角 X 關閉。點選 workbook cell 時，UI 以 selected style 標記該 cell，並在底部 message input 加入含分頁與欄位/位置的 marker；若尚未輸入文字，下一個 selection 覆蓋原 marker；若已有文字，下一個 selection 會換行新增 marker。送出時 request 可帶多個 structured selected workbook refs。AI 只能透過 workbook patch service 更新 workbook，成功後 workbook UI 依 patch 或 refetch 同步，不做每次 patch 前的 preview/diff confirmation，也不做 Undo button 或版本控制 UI。使用者可以透過多輪對話持續修改 workbook data、請 AI 還原剛才修改，或用文字描述多個明確位置要更改，讓 AI 產生多個後端驗證過的 patch ops。最新被接受 patch 更新過的欄位用背景色標示，且和 selected cell 樣式不同；背景色維持到下一次 accepted workbook patch，下一次 patch 會替換上一組 highlight。AI patch 成功時，chat 用短摘要列出已更新欄位，不顯示完整 diff table；AI patch 失敗或被後端拒絕時，不標示欄位、不清掉上一個 accepted patch highlight，chat 顯示未更新原因。不建立 mobile-only API 或 mobile-only data model。

### Source Admin

Admin 上傳 ERP `.xlsx`，查看 parsed data、source manifest、version history；legacy `.xls` 只有在 server-side conversion 腳本測通後才可進正式流程。DOCX/PDF/image 上傳在 Admin data import 被拒絕。鋼鐵手冊 DOCX 屬於 schema/data-model 設計參考，不是 Admin web upload。

### Import Admin

Admin preview ERP XLSX parsed data、AI mapping、merge table、valid / invalid / needs_review，最後按「確認更新資料庫」才寫入 Supabase PostgreSQL。後續維護可由 table UI fetch/edit/review/save，不需要上傳 DOCX。

### Memory Review

審核 AI 建議改善規則，將錯誤修正轉成 system memory 或 Project Instruction。

### UX 驗收標準

- 使用者貼 LINE 訂單，系統能產生 Workbook。
- Steel Chat Workspace 在 desktop/mobile responsive web 上共用同一套 workflow。
- 手機版可用 full-view modal 檢視 workbook，並可點選多個明確 cell/field target 後在 message input 中以含分頁與欄位/位置的 marker 指定要 AI 修改的目標。
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
- Admin data import 不接受 DOCX/PDF/image，只接受 ERP `.xlsx` 或 tested legacy `.xls` normalization output。
- Admin 能 preview ERP XLSX parsed data。
- Admin 能透過 table UI preview/edit 既有資料。
- Excel 有七個必要分頁。
- 系統訂單分頁符合固定欄位。
- 報價單分頁不含客戶等級與內部資料。
- 使用者指出錯誤時，能建立 memory candidate。
- Guest user 可以建立報價並下載 Excel。
- Admin import 需經 valid / invalid / needs_review 檢查後才能寫入資料庫。

---

## 附錄 A：v8.3 openai-oauth /v1/responses 開發步驟

### A.1 修正後正確步驟

```text
1. 建立 SteelAIProvider interface。
2. 新增 OpenAIOAuthResponsesProvider adapter，設為 default driver。
3. driver endpoint 固定先走 /v1/responses。
4. runtime provider path 直接寫死為 `openai-oauth-provider` direct provider；不提供 env transport selector。Local proxy 只作手動 diagnostic smoke probe。
5. state mode 固定 stateless_full_history；每次 request 由 backend 傳完整 conversation/context bundle。
6. 新增 OpenAIAPIProvider adapter，設為 secondary driver；不作未測保底。
7. 加入 `openai-oauth-provider` 時同步加入 package-manager overrides/resolutions，統一 AI SDK 6 package versions。
8. 完成 server-side OAuth login / token store；token 檔視為密碼等級保存。
9. 建立 code-owned driver capability support matrix：Phase 1 hard-code `openai_oauth_responses` + `gpt-5.5` support and reuse `/steel/oauth-chat` file evidence; later phases can add targeted smoke evidence.
10. 建立 /api/steel/conversations/:conversationMetaId/messages route 到 SteelAgentOrchestrator。
11. 使用者上傳檔案後，backend 建立 source file metadata 與 provider payload；AI 做判讀與 evidence，不由 Node 寫主 OCR/圖面 parser。
12. Steel tools 仍由 backend 執行；tool decision 由 AI，tool execution 由 Steel backend。
13. 將 provider stream/tool events 轉成 SteelAIEvent。
14. 測試純聊天、backend API tool call、structured output、workbook patch、圖片圖面、PDF、DOCX、XLS、XLSX evidence。
15. 若 primary driver 對 file / vision / XLS / XLSX / hosted tools 不可用，預設建立 typed error、低信心與人工複核項。
16. 只有 backend 明確選擇 API workflow 時才使用 secondary `openai_api` driver；不做 per-capability automatic fallback。
17. run localhost Steel Workspace page，確認預設聊天由 openai_oauth_responses driver 執行，fallback 事件可追蹤。
```

### A.2 v8.3 對使用者期待的判斷

```text
「AI API 改用 openai-oauth /v1/responses，把它當主要 API 開發」
```

判斷：採用。v8.3 將 `openai_oauth_responses` 設為 primary driver，active model 為 `gpt-5.5`。

```text
「先測試可呼叫、傳圖片、傳 PDF、傳 DOCX、傳 XLS、XLSX」
```

判斷：採用。AI/provider 已確認可處理 legacy `.xls` / `.doc`；server-side conversion 必須先以開發腳本證明可行才可進正式後端流程。

```text
「前端 LibreChat UI 預設選擇 openai-oauth /v1/responses」
```

判斷：採用。Steel Workspace 的 model selector 預設選擇 `openai_oauth_responses`，但 enable 狀態由後端 capability matrix 控制。

```text
「移除外部 agent harness」
```

判斷：採用。v8.3 不引入第二套 agent harness；沿用 LibreChat UI / auth / files / Agents concepts / MCP-Actions 基礎，鋼鐵專用 orchestration 由 Steel backend 實作。

```text
「預設 fallback 到 official OpenAI API 的項目都要先開發測試過，再決定哪些 fallback 到 API」
```

判斷：採用。v8.3 禁止未測 fallback。`openai_api` 是 secondary driver，不是保底 driver；只有對應 capability status = passed 才可 routing / fallback。

### A.3 必測 smoke cases

| 編號     | Driver                 | 測試                            | 通過條件                                          | 失敗處理                                                    |
| -------- | ---------------------- | ------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| OAUTH-01 | openai_oauth_responses | `/v1/models`                    | 能列出帳號可用模型                                | driver disabled                                             |
| OAUTH-02 | openai_oauth_responses | `/v1/responses` 純文字          | 可回覆且可 stream                                 | text/streaming failed                                       |
| OAUTH-03 | openai_oauth_responses | stateless full-history          | 第二輪可引用第一輪內容，且 request 含完整 history | stateMode failed                                            |
| OAUTH-04 | openai_oauth_responses | backend API tool call：查客戶   | AI 產生 tool call，backend 執行，結果回 AI        | toolCalling failed                                          |
| OAUTH-05 | openai_oauth_responses | tool result round-trip          | tool result 後重送 full history，AI 產生最終回覆  | toolLoop failed                                             |
| OAUTH-06 | openai_oauth_responses | structured workbook patch       | patch JSON 通過 schema validation                 | 禁止寫 workbook                                             |
| OAUTH-07 | openai_oauth_responses | 圖片圖面 PNG/JPG                | AI 能讀圖並產生 evidence                          | imageInput failed                                           |
| OAUTH-08 | openai_oauth_responses | 文字 PDF                        | 能讀 PDF text evidence                            | pdfInput failed                                             |
| OAUTH-09 | openai_oauth_responses | 掃描 PDF / 圖面 PDF             | 能讀 page image / direction / holes evidence      | pdfInput failed                                             |
| OAUTH-10 | openai_oauth_responses | DOCX 訂單                       | 能讀段落 / 表格 evidence                          | docxInput failed                                            |
| OAUTH-11 | openai_oauth_responses | XLS 舊 Excel                    | 能讀 sheet/header/row evidence                    | xlsInput failed                                             |
| OAUTH-12 | openai_oauth_responses | XLSX                            | 能讀 sheet/header/row evidence                    | xlsxInput failed                                            |
| API-01   | openai_api             | 純文字 / streaming              | 可作 text secondary route                         | 不啟用 API text fallback                                    |
| API-02   | openai_api             | tool calling / tool result loop | 可作 tool secondary route                         | 不啟用 API tool fallback                                    |
| API-03   | openai_api             | structured workbook patch       | 可作 structured output secondary route            | 不啟用 API structured fallback                              |
| API-04   | openai_api             | 圖片圖面                        | 可回傳 image evidence                             | 不啟用 vision fallback                                      |
| API-05   | openai_api             | PDF + vision                    | 可回傳 PDF text/page image evidence               | 依 file / vision 類 fallback gate 處理，不新增 PDF 專用 key |
| API-06   | openai_api             | DOCX                            | 可回傳 DOCX evidence                              | 依 file input fallback gate 處理，不新增 DOCX 專用 key      |
| API-07   | openai_api             | XLS / XLSX                      | 可回傳 spreadsheet evidence                       | 依 XLSX/spreadsheet fallback gate 處理，不新增 XLS 專用 key |
| API-08   | openai_api             | File Search / Code Interpreter  | hosted tool 可用且 audit 可追蹤                   | 不啟用 hosted-tool fallback                                 |

### A.4 環境變數摘要

```env
STEEL_OPENAI_PROVIDER=OAUTH
STEEL_OPENAI_DEFAULT_MODEL=gpt-5.5
STEEL_OPENAI_REASONING_EFFORT=medium
OPENAI_API_KEY=...

STEEL_ALLOWED_MODEL_PROVIDER=openai_oauth_responses,openai_api

```

### A.5 不可做事項

- 不把 `openai_api` 當作未測保底。
- 不使用 `STEEL_OPENAI_OAUTH_AUTO_FALLBACK` 或 per-capability `STEEL_FALLBACK_*` env matrix。
- 不因 provider 名稱或模型名稱相同就推定 file / vision / spreadsheet 能力相同。
- 不使用 `previous_response_id` 來驅動 `openai_oauth_responses` replay。
- 不讓 AI 直接查 MongoDB / Supabase。
- 不讓 frontend 保存 OAuth token。
- 不把 invalid structured output 寫入 workbook。
- 不把缺價格、缺單價或未知金額填 0。
