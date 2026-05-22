# 鋼鐵報價 LibreChat 擴充專案：完整計劃文件 v8.1

版本日期：2026-05-21
修訂版本：v8.1
文件狀態：架構與功能規劃版
技術棧：LibreChat monorepo、TypeScript、React、MongoDB、PostgreSQL、pgvector、OpenAI Conversations API + Responses API、ExcelJS

---

## 0. 文件目的

本文件規劃一個以 **LibreChat** 為基礎的鋼鐵報價系統。系統需要保留 LibreChat 既有的聊天介面、多使用者驗證、Agents、檔案上傳、OCR、MCP / Actions、Memory、Admin Panel、對話紀錄等能力，並新增鋼鐵報價專用功能：

- Conversation-first 查價與報價流程
- 未登入 guest conversation
- 表格 / Workbook 綁定對話 ID
- OpenAI conversation + `previous_response_id`
- 開發階段可由 LibreChat UI 選擇低成本 OpenAI model
- Project Sources 管理
- Project Instructions 管理
- 文字來源 / 規則來源管理
- 鋼鐵資料查詢 tools
- Admin XLSX 增量匯入控制頁
- AI Merge Table
- PostgreSQL 正式資料更新
- Memory Candidate + Admin 審核統整
- Workbook JSON Engine
- Excel 多分頁匯出與指定分頁下載
- RAG 來源同步更新 / 刪除
- 審計與追蹤

本文件不包含完整程式碼，只定義架構、模組、資料模型、API 方向、資料流、工具選型與開發邊界。

### v8.1 修正重點

```text
1. MongoDB 採方案 A：所有鋼鐵新增 collections 保留 steel_ 前綴，避免與 LibreChat 既有或未來 collections 撞名。
2. PostgreSQL 採 schema 隔離：建議使用 steel schema，例如 steel.customers、steel.price_items。
3. OpenAI 對話狀態改為 OpenAI Conversations API + Responses API：
   - openai_conversation_id 作為長期 provider conversation id。
   - previous_response_id 作為每輪 response chain 追蹤與 fallback。
   - 後端仍保存 context_refs，不另透過 OpenAI API 抓歷史對話。
4. 若 SDK / API 實測 conversation 與 previous_response_id 不適合同時傳入，API 呼叫以 conversation 為主，previous_response_id 僅作 audit / fallback。
```

---

## 1. 核心決策摘要

| 項目 | 決策 |
|---|---|
| 基礎平台 | 使用 LibreChat monorepo 擴充，不另做 sidecar service |
| 後端維護 | 統一使用 LibreChat 後端，主要新增程式放 `/packages/api/steel` |
| 前端 | 使用 LibreChat `/client`，新增鋼鐵報價功能頁 |
| 資料庫 | 可使用 MongoDB + PostgreSQL |
| MongoDB | 保存應用狀態、Workbook、Sources metadata、Instructions、Memory、OpenAI runs、Audit |
| PostgreSQL | 保存客戶、價格、規格重量、加工價格、訂單、來源 chunks、embeddings |
| 向量搜尋 | PostgreSQL + pgvector，或評估沿用 LibreChat RAG API |
| AI Provider | 只使用 OpenAI API，每次 run 記錄 `provider = openai` |
| OpenAI 對話 | 使用 OpenAI Conversations API + Responses API；`openai_conversation_id` 為長期狀態主體，`previous_response_id` 作 response chain 追蹤 |
| OpenAI 歷史 | 不另外透過 OpenAI API 取得對話歷史；後端自行記錄 `context_refs` 與必要 audit 欄位 |
| 模型選擇 | LibreChat UI 保留 model selector；開發階段可選低成本模型 |
| 對話紀錄 | 沿用 LibreChat 原生 `conversations` + `messages`；只補充 `steel_conversation_meta` |
| Workbook 綁定 | Workbook 綁定 `steel_conversation_meta._id` |
| 帳號綁定 | `steel_conversation_meta` 可選擇性綁定 LibreChat user |
| 未登入使用 | 支援 guest conversation；裝置保存 `steel_conversation_meta_id + guest_access_token` |
| Workbook 更新 | OpenAI 產生 patch 後，後端直接更新目前 Workbook，不需二次口頭確認 |
| Workbook 版本 | 不保存舊報價版本，不保存舊價格快照；保存每次 patch 紀錄 |
| 價格來源 | 價格永遠以目前資料庫最新結果為主 |
| 用戶改價 | 使用者本輪明確指示可以調整價格 |
| Memory 價格 | Memory 不提供價格，不覆蓋價格 |
| Admin 匯入 | Admin 上傳 XLSX，OpenAI 產生 Merge Table（AI 負責 mapping + data patch），格式驗證由程式邏輯處理，Admin 確認後後端 transaction 更新 PostgreSQL |
| Excel | 後端 ExcelJS 產生 XLSX，可下載完整 Workbook 或指定分頁 |
| 客戶用 Excel 遮罩 | 開發階段先不完整定義，欄位輸出由後端控制 |
| RAG | Source 更新 / 刪除時，chunks 與 embeddings 必須同步更新、停用或刪除 |
| AI 資料庫操作 | AI 不直接操作 MongoDB / PostgreSQL，只能呼叫後端白名單 API |
| Raw query | 禁止 raw SQL / raw Mongo query tool |
| Collection 命名 | MongoDB 鋼鐵新增 collections 保留 `steel_` 前綴；PostgreSQL 使用 `steel` schema 隔離 |

---

## 2. 不重複造輪子原則

### 2.1 沿用 LibreChat 既有能力

以下功能不重做：

| 功能 | 處理方式 |
|---|---|
| 使用者登入 | 沿用 LibreChat Authentication |
| OAuth / SAML / LDAP | 沿用 LibreChat |
| Admin Panel | 在 LibreChat Admin 基礎上擴充鋼鐵管理頁 |
| ACL / Roles / Groups | 沿用 LibreChat Access Control |
| Agent Builder | 沿用 LibreChat Agents |
| Upload as Text | 沿用 LibreChat |
| OCR | 沿用 LibreChat OCR 或 OpenAI vision / file input 輔助 |
| MCP / Actions UI | 沿用或局部接入 |
| 聊天 UI | 沿用 LibreChat chat UI |
| 對話紀錄 | 沿用 LibreChat `conversations` + `messages` |
| 一般 User Memory | 沿用 LibreChat User Memory |
| Code Interpreter 沙盒 | 不自建 Python sandbox；使用 OpenAI Code Interpreter 或 LibreChat Code Interpreter |
| 一般 RAG pipeline | 先評估 LibreChat RAG API 是否可用；必要時才做 retrieval adapter |

### 2.2 新增鋼鐵專用能力

| 模組 | 是否新增 |
|---|---|
| Conversation Meta | 是（補充 LibreChat conversation 沒有的鋼鐵專用欄位） |
| Steel Project | 是 |
| Project Sources | 是 |
| Text Sources / Rule Sources | 是 |
| Project Instructions | 是 |
| Steel Data Import | 是 |
| Admin Data Control / AI Merge Table | 是 |
| Steel Tool Registry | 是 |
| OpenAI Orchestrator | 是 |
| Prompt Bundle Builder | 是 |
| Workbook JSON Engine | 是 |
| Excel Export Engine | 是 |
| Memory Candidate / System Memory | 是 |
| RAG Source Sync | 是 |
| Audit / Trace Logs | 是 |

---

## 3. LibreChat Monorepo 擴充架構

```text
LibreChat Repository
├─ /client
│  └─ 新增鋼鐵報價前端頁面
│
├─ /api
│  └─ 僅新增薄 wrapper
│
├─ /packages/api
│  └─ 新增 /steel 模組，放鋼鐵報價後端主邏輯
│
├─ /packages/data-schemas
│  └─ 新增 /steel schemas
│
├─ /packages/data-provider
│  └─ 新增 /steel API types、endpoints、client data service
│
└─ /packages/client
   └─ 可放鋼鐵報價共用前端 utilities
```

### 3.1 後端目錄建議

```text
/packages/api/steel
├─ conversations
├─ projects
├─ sources
├─ instructions
├─ admin-imports
├─ memory
├─ openai
├─ prompt
├─ tools
├─ repositories
├─ retrieval
├─ workbook
├─ excel
├─ audit
└─ permissions
```

### 3.2 前端目錄建議

```text
/client/src/features/steel
├─ conversations
├─ projects
├─ sources
├─ instructions
├─ admin
│  ├─ imports
│  ├─ merge-table
│  └─ memory-review
├─ workbook
├─ exports
└─ shared
```

### 3.3 Shared types

```text
/packages/data-provider/steel
├─ conversation.types.ts
├─ project.types.ts
├─ source.types.ts
├─ instruction.types.ts
├─ admin-import.types.ts
├─ memory.types.ts
├─ workbook.types.ts
├─ tool.types.ts
└─ export.types.ts
```

---

## 4. Conversation-first 設計

### 4.1 LibreChat 對話紀錄分工

LibreChat 原生的 `conversations` + `messages` collections 負責：

```text
- 聊天訊息歷程（每一輪問答）
- 聊天 UI 顯示
- 已登入使用者的對話綁定
- model 設定、對話標題
```

鋼鐵系統新增 `steel_conversation_meta`，只補充 LibreChat conversation 沒有的欄位：

```text
- Guest token 管理（LibreChat 無 guest 模式）
- OpenAI previous_response_id chain 追蹤
- Workbook 綁定
- Project 綁定
- 對話狀態（expired）
```

### 4.2 設計原則

```text
steel_conversation_meta
  ├─ 可選擇性綁定 librechat_conversation_id（已登入使用者）
  ├─ 可選擇性綁定 LibreChat user
  ├─ 保存 openai_meta（previous_response_id 等）
  ├─ 綁定 Workbook
  ├─ 保存 guest access token hash
  └─ 保存 context_refs（本輪使用的 DB id 清單）
```

Workbook 不直接以 user 為主體，而是綁定 `steel_conversation_meta._id`。
帳號綁定是 optional。未登入使用者仍可開新對話查訂單、查價格、產生表格。

### 4.3 登入 / 未登入流程

#### 未登入 Guest 流程

```text
使用者未登入
  ↓
POST /api/steel/conversations/guest
  ↓
後端建立 steel_conversation_meta
  ↓
後端回傳：
  - steel_conversation_meta_id
  - guest_access_token
  ↓
前端裝置 local storage / secure cookie 保存
  ↓
使用者可查價、產生 Workbook、下載 Excel
```

#### 登入使用者流程

```text
使用者已登入
  ↓
POST /api/steel/conversations/authenticated
  ↓
後端建立 steel_conversation_meta
  ↓
steel_conversation_meta.user_id = LibreChat user id
  ↓
可映射 librechat_conversation_id
```

#### Guest 轉登入綁定

```text
使用者登入
  ↓
提供 steel_conversation_meta_id + guest_access_token
  ↓
POST /api/steel/conversations/:conversationMetaId/link-account
  ↓
後端驗證 token hash
  ↓
steel_conversation_meta.user_id = LibreChat user id
```

### 4.4 ID 分層

| ID | 用途 |
|---|---|
| `steel_conversation_meta_id` | 鋼鐵報價系統主對話 ID，前端裝置保存 |
| `guest_access_token` | 未登入裝置存取該 conversation 的 token，後端只存 hash |
| `user_id` | LibreChat 使用者 ID，optional |
| `librechat_conversation_id` | LibreChat 原生對話 ID，optional，已登入時映射 |
| `openai_meta.previous_response_id` | 下一輪 OpenAI Responses API 接續用 |
| `openai_meta.last_response_id` | 最新一輪 OpenAI response id，audit 用 |

### 4.5 `steel_conversation_meta` Schema 概念

```ts
steel_conversation_meta {
  _id: ObjectId

  user_id?: ObjectId
  guest_token_hash?: string

  librechat_conversation_id?: string

  openai_meta: {
    openai_conversation_id?: string // OpenAI Conversations API 的 durable conversation id
    previous_response_id?: string   // 最新一輪 response id，audit / fallback 用
    last_response_id?: string       // 最新 OpenAI response id
    chain_broken?: boolean          // provider state 或 response chain 失效後標記
  }

  project_id?: ObjectId
  last_workbook_id?: ObjectId
  last_model?: string

  status: 'active' | 'closed' | 'expired'
  created_from: 'guest' | 'authenticated'

  created_at: Date
  updated_at: Date
  last_accessed_at: Date
}
```

### 4.6 Guest Conversation 過期策略

```text
過期條件：最後存取後 30 天自動 expire（可由 Admin 設定）

過期後處理：
  - steel_conversation_meta.status = expired
  - workbooks.status = closed
  - 已下載的 Excel export 保留 7 天後清除
  - guest_token_hash 清除

Guest token 安全：
  - 後端只存 hash，token 不落地
  - 每次 conversation access 可選擇性 rotate token
```

### 4.7 存取檢查

```text
若 user_id 存在：
  - 目前登入 user_id 必須相同，或具備 Admin 權限

若 user_id 不存在：
  - request 必須提供 steel_conversation_meta_id + guest_access_token
  - 後端比對 guest_token_hash

Workbook / Export / OpenAI run / Tool call：
  - 都以 steel_conversation_meta_id 做主關聯
```

---

## 5. OpenAI Provider、Conversation 與 Model Selection

### 5.1 OpenAI Conversations API + Responses API 使用策略

本系統只使用 OpenAI 作為 AI provider，但對話狀態採用兩層設計：

```text
1. 系統業務對話：steel_conversation_meta._id
   - 前端、Workbook、Guest token、Excel 匯出都綁定此 ID。

2. OpenAI provider 對話：openai_conversation_id
   - 由 OpenAI Conversations API 建立。
   - Responses API 呼叫時傳入 conversation。
   - 用於跨 session、跨裝置、跨 job 的 provider-side durable conversation state。

3. Response chain 追蹤：previous_response_id
   - 每輪 Responses API 回傳 response.id。
   - 下一輪可保存 previous_response_id 作 audit / fallback。
   - 若 API/SDK 實測不適合同時傳 conversation 與 previous_response_id，則實際呼叫以 conversation 為主，previous_response_id 只作記錄與 fallback。
```

每次 OpenAI run 必須保存：

```text
provider = openai
steel_conversation_meta_id
openai_conversation_id
openai_response_id
previous_response_id
model
selected_by
context_refs
tool_call_ids
```

### 5.2 OpenAI conversation 與 previous_response_id 管理

OpenAI Conversations API 可與 Responses API 搭配，用 conversation object 保存長期狀態。Responses API 也可用 `previous_response_id` 鏈接 response。v8.1 採用：

```text
openai_conversation_id = 長期 provider conversation id
previous_response_id  = 每輪 response chain 追蹤 / audit / fallback
```

設計流程：

```text
建立 steel_conversation_meta
  ↓
後端建立 OpenAI conversation
  ↓
保存 openai_conversation_id 到 steel_conversation_meta.openai_meta
```

```text
第 1 輪：
Responses API 呼叫帶 conversation = openai_conversation_id
保存 response.id → steel_conversation_meta.openai_meta.last_response_id

第 2 輪：
Responses API 呼叫帶 conversation = openai_conversation_id
保存 previous_response_id = 上一輪 last_response_id
保存新 response.id

第 N 輪：
重複此流程
```

若 API / SDK 實測 conversation 與 previous_response_id 為互斥參數，則：

```text
1. 實際 Responses API 呼叫只帶 conversation = openai_conversation_id。
2. previous_response_id 不傳給 OpenAI，只保存於 steel_openai_runs 與 steel_conversation_meta.openai_meta。
3. 若 OpenAI conversation 不可用或 chain 需要 fallback，才改用 previous_response_id 模式重建。
```

若 provider state 或 response chain 發生錯誤：

```text
steel_conversation_meta.openai_meta.chain_broken = true
  ↓
Orchestrator 從最新的 context_refs 重建 prompt bundle
  ↓
以最新 workbook 狀態作為新的對話起點
  ↓
必要時建立新的 openai_conversation_id
```

注意：無論使用 conversation 或 previous_response_id，仍要監控 token 成本。Orchestrator 應保存 context_refs，必要時用最新 Workbook、Sources、Instructions、Memory 重新建構上下文，不依賴 OpenAI 取得歷史對話。

### 5.3 開發階段模型選擇

LibreChat UI 必須保留 model selector。開發階段允許使用低成本模型，正式報價可切到較高能力模型。

| 使用情境 | 開發階段建議 | 正式階段建議 |
|---|---|---|
| 簡單查價、查規格 | 低成本模型 | Admin 指定 |
| Workbook patch | 低成本模型 | 高能力模型或 Admin 指定 |
| Admin XLSX mapping / Merge Table | 低成本模型 | 高能力模型或 Admin 指定 |
| 複雜圖面、孔洞、折工推理 | 低成本模型起測 | 高能力模型 |
| 高風險正式報價 | 不建議低成本模型 | 高能力模型或正式指定模型 |

> 模型名稱為佔位符，實際模型依開發時 OpenAI 最新可用模型清單確認。

### 5.4 LibreChat 設定

```yaml
interface:
  modelSelect: true
  parameters: true
  presets: true
```

開發環境：

```env
OPENAI_MODELS=<低成本模型A>,<低成本模型B>,<高能力模型>
```

### 5.5 Steel Orchestrator 不得硬編碼模型

```ts
// API request 由前端或 Admin 設定帶入 selected_model
POST /api/steel/conversations/:conversationMetaId/messages
{
  "message": "幫我查這筆訂單價格",
  "selected_model": "<model_name>",
  "reasoning_effort": "low"
}
```

`steel_openai_runs` schema：

```ts
steel_openai_runs {
  _id: ObjectId

  provider: 'openai'
  steel_conversation_meta_id: ObjectId

  openai_meta: {
    openai_conversation_id: string       // OpenAI Conversations API 建立的 conversation id
    response_id: string                  // 本輪 OpenAI 回傳的 response.id
    previous_response_id?: string        // 本輪前一個 response id；audit / fallback
    model: string
    selected_by: 'user' | 'admin_default' | 'system_default'
    prompt_tokens?: number
    completion_tokens?: number
  }

  context_refs: {
    instruction_version_ids: ObjectId[]
    source_version_ids: ObjectId[]
    active_memory_ids: ObjectId[]
    workbook_id: ObjectId
    workbook_version_seq: number
    project_id: ObjectId
  }

  tool_call_ids: ObjectId[]
  created_at: Date
}
```

---

## 6. MongoDB / PostgreSQL 分工

### 6.1 MongoDB：應用狀態與文件型資料

```text
LibreChat 既有（不動）：
- users
- conversations            ← 沿用，保存聊天訊息歷程
- messages                 ← 沿用
- agents
- files
- roles
- groups
- ACL resources

鋼鐵新增（MongoDB collections 採 steel_ 前綴）：
- steel_conversation_meta        ← guest token、openai_meta、workbook 綁定
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
- steel_workbook_patches         ← 每次 patch 紀錄
- steel_openai_runs
- steel_tool_calls
- steel_excel_exports
- steel_admin_import_sessions
- steel_admin_merge_tables
- steel_admin_mapping_profiles
- steel_import_logs
- steel_audit_logs
```

MongoDB 主要保存：

| 類型 | 資料 |
|---|---|
| 對話 | LibreChat 原生 conversations + messages（沿用） |
| 對話 meta | steel_conversation_meta（補充 guest token、openai_meta） |
| Sources metadata | steel_project_sources、版本、分類、啟用狀態 |
| Instructions | 專案規則版本 |
| Memory | 候選記憶、系統記憶、審核事件 |
| Workbook | 目前最終狀態、patch 歷程 |
| Admin import | steel_admin_import_sessions、steel_admin_merge_tables、steel_admin_mapping_profiles |
| Audit | 操作摘要、下載、匯入、AI run、tool call |

### 6.2 PostgreSQL：結構化業務資料與檢索

PostgreSQL 建議使用 `steel` schema 隔離，例如 `steel.customers`、`steel.price_items`、`steel.source_chunks`。表格名稱本身可不加 `steel_` 前綴。

```text
customers
customer_aliases
customer_tiers

price_items
price_categories
price_rule_conditions

weight_specs
material_rules

processing_prices
cutting_prices
cutting_price_adjustments
hole_prices
slotting_prices
bending_prices

orders
order_items

source_chunks
source_embeddings          ← pgvector

formula_versions
import_rule_notes
price_history              ← ERP 匯入引發的價格異動追溯
```

PostgreSQL 主要保存：

| 類型 | 資料 |
|---|---|
| 客戶資料 | 客戶、別名、分級 |
| 價格 | 材料價格、加工價格 |
| 規格重量 | 型鋼、板材、管材、角鐵、扁鐵等 |
| 計價規則 | 公式版本、條件規則 |
| 訂單 | 訂單與訂單明細 |
| RAG | source chunks 與 embeddings（含 embedding model 版本） |
| 價格異動 | ERP 匯入後的單價異動追溯 |

### 6.3 `source_embeddings` Embedding Model 版本

```sql
CREATE TABLE source_embeddings (
  id                   SERIAL PRIMARY KEY,
  chunk_id             INTEGER REFERENCES source_chunks(id),
  embedding            vector(1536),
  embedding_model      VARCHAR(100) NOT NULL,
  embedding_model_dim  INTEGER NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

升級 embedding model 時，所有 chunks 必須重新 embed，不能混用不同版本的向量。

### 6.4 `price_history` 價格異動追溯

每次 ERP upsert 更新 `price_items` 時，若單價有異動，自動寫一筆歷史紀錄：

```sql
CREATE TABLE price_history (
  id              SERIAL PRIMARY KEY,
  price_item_id   INTEGER REFERENCES price_items(id),
  old_unit_price  NUMERIC(12, 2),
  new_unit_price  NUMERIC(12, 2),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  import_log_id   VARCHAR(100)   -- 對應 MongoDB steel_import_logs._id
);
```

### 6.5 價格保存策略

本系統不保存舊報價價格快照。

```text
每次查價：以 PostgreSQL 最新資料為準
用戶本輪明確指定單價：可在該 workbook 目前狀態中調整
Memory：不提供價格，不覆蓋價格
```

> 注意：本系統不保存報價當時的價格快照。若需追溯某份報價的計價依據，
> 只能透過 import_log 的時間戳推算當時的資料庫狀態，無法直接重算舊報價。
> 這是刻意的設計取捨，不是遺漏。

不保留：

```text
price_snapshot
quote_snapshot
舊報價版本
舊價格連動
```

保留（用於操作追蹤）：

```text
steel_import_logs
steel_audit_logs
price_history
```

---

## 7. 固定資料來源與鋼鐵規則

### 7.1 固定資料來源

| 來源 | 用途 |
|---|---|
| `客戶資料.xlsx` | 客戶資料、客戶分級 |
| `產品價格.xlsx` | 材料單價、加工單價 |
| `龍頂鋼鐵手冊_文字版.docx` | 規格重量、單位重量、板材重量 |
| `龍頂鋼鐵手冊.pdf` | 圖像對照、表格與施工圖 |
| `H型鋼.txt` | H 型鋼常規 / 非常規米數 |
| `切工價錢.pdf` | H 型鋼切工、黑鐵切工圖片表 |
| `系統訂單.xlsx` | 系統訂單欄位格式參考 |

### 7.2 重量與規格資料

系統應將手冊內的規格重量匯入 PostgreSQL `weight_specs`。例如：

```text
C型鋼 100x50x20：
- 2.3mm = 4.06 kg/m
- 2.5mm = 4.35 kg/m
- 3.0mm = 5.25 kg/m
- 3.2mm = 5.50 kg/m
```

H 型鋼、槽鐵、工字鐵、角鐵、扁鐵、方鋼、圓鋼、管材、鋼板等，均需建立標準化 spec key。

### 7.3 H 型鋼特殊米數規則

```text
常規米數：6M、9M、10M、12M
非常規米數：7M、8M、11M、13M、14M、15M
非常規米數價格：一般米數價格 + 0.3 元/kg
```

### 7.4 切工價格

`切工價錢.pdf` 為圖片式 PDF：

```text
第 1 頁：H 型鋼切工價錢
第 2 頁：黑鐵類切工價錢
```

匯入策略：

```text
1. Admin 控制頁或人工校正流程將圖片表轉成 PostgreSQL 結構化資料。
2. 仍保留原 PDF source refs。
3. OpenAI 可協助判讀，但正式查價以 PostgreSQL 最新表為準。
4. 模糊或無法對應時，標低信心，不可填 0。
```

---

## 8. Steel Project、Sources 與 Instructions

### 8.1 Steel Project Module

功能：

```text
1. 建立鋼鐵報價 Project
2. 綁定預設 Agent
3. 綁定 Project Sources
4. 綁定 Project Instructions
5. 綁定可用 Text Sources
6. 綁定啟用的 System Memories
7. 顯示相關 conversations、workbooks、exports
```

### 8.2 Project Sources Module

來源類型：

```ts
source_type: 'file_source' | 'text_source'

// file_source 子類：
source_category:
  | 'spec_manual'       // 規格手冊（如龍頂手冊）
  | 'price_table'       // 價格表
  | 'cutting_table'     // 切工表
  | 'drawing'           // 圖面

// text_source 子類：
source_category:
  | 'ocr_rule'          // OCR 圖文判斷規則
  | 'hole_rule'         // 孔洞規則
  | 'slot_rule'         // 開槽規則
  | 'bending_rule'      // 折工規則
  | 'material_rule'     // 長條料配料規則
  | 'low_confidence_rule' // 低信心規則
  | 'excel_rule'        // Excel 輸出規則
```

`project_sources` Schema 概念：

```ts
steel_project_sources {
  _id: ObjectId
  project_id: ObjectId
  source_type: 'file_source' | 'text_source'
  source_category: string
  display_name: string
  status: 'active' | 'inactive' | 'deleted'
  priority: number
  current_version_id: ObjectId
  created_at: Date
  updated_at: Date
}
```

功能：

```text
1. 新增來源
2. 刪除來源
3. 停用來源
4. 更新來源
5. 來源版本
6. 來源分類
7. 來源優先順序
8. OCR / Upload as Text 結果保存
9. 切分 chunks
10. 建立 embeddings
11. RAG 檢索時只查 active source/version/chunk
```

### 8.3 Project Instructions Module

功能：

```text
1. 編輯 Project Instruction
2. 分類：核心、報價、OCR、Excel、低信心、Admin 匯入
3. 保存版本
4. 啟用 / 停用版本
5. 每次 OpenAI run 記錄 instruction version id（存於 context_refs）
6. 支援 Memory promote 成 Instruction
7. 支援 Text Source promote 成 Instruction
```

---

## 9. Steel Tool Registry

### 9.1 原則

OpenAI 不直接查資料庫。
OpenAI 只呼叫後端白名單 business tools。

禁止：

```text
run_mongo_query
run_postgres_query
execute_raw_sql
read_file
list_directory
```

允許 business tools：

```text
lookup_customer
search_customers
search_orders
get_order_detail
lookup_spec_price
lookup_weight_spec
lookup_cutting_price
lookup_processing_price
search_project_sources
search_relevant_memories
get_workbook
apply_workbook_patch
create_memory_candidate
update_memory_candidate
export_workbook
export_workbook_sheets
admin_import_generate_merge_table
admin_import_apply_merge_patch
```

### 9.2 Tool 執行邊界

每個 tool：

```text
1. 後端使用 Zod 驗證輸入（不信任 OpenAI 回傳的 tool arguments）
2. 自動加入 conversation access check
3. 自動加入 user / guest 權限檢查
4. 後端查 MongoDB / PostgreSQL
5. 後端欄位 allowlist
6. Tool result 過濾 prompt injection 字串後再回傳給 OpenAI
7. 回傳標準 tool result
8. 記錄 steel_tool_calls
```

每個 tool 設定每 run 呼叫次數上限，防止 runaway loop：

```text
lookup_customer:      最多 20 次 / run
lookup_spec_price:    最多 50 次 / run
apply_workbook_patch: 最多 10 次 / run
export_workbook:      最多 3 次 / session
```

### 9.3 典型 Tool

#### `lookup_spec_price`

```ts
lookup_spec_price({
  material_type: string,
  spec: string,
  thickness_mm?: number,
  customer_tier?: string,
  unit?: string
})
```

規則：

```text
- 精準匹配優先
- 找不到精準單價不可硬套
- 可回傳 closest_matches，但 price_status = 未確認
- 未確認不可填 0
```

#### `lookup_weight_spec`

```ts
lookup_weight_spec({
  material_type: string,
  spec: string,
  thickness_mm?: number
})
```

規則：

```text
- 以 PostgreSQL weight_specs 最新資料為主
- 找不到規格則低信心
- 可回傳相近規格作人工複核
```

---

## 10. OpenAI Orchestrator 與 Prompt Bundle Builder

### 10.1 OpenAI Orchestrator

位置：`/packages/api/steel/openai`

功能：

```text
1. 接收 conversation message
2. 取得 selected_model
3. 讀取 steel_conversation_meta
4. 取得 latest previous_response_id
5. 組 Prompt Bundle
6. 呼叫 OpenAI Responses API
7. 處理 function calling loop
8. 處理 structured outputs
9. 處理 Code Interpreter
10. 寫入 steel_openai_runs（含 context_refs）
11. 更新 steel_conversation_meta.openai_meta
12. 回寫 workbook patch / memory_candidate / merge_table_patch
```

### 10.2 Prompt Bundle Builder

Prompt Bundle 組合順序：

```text
1. 使用者本輪明確指示
2. LibreChat Agent instructions
3. Steel Project Instructions
4. Active Text Sources
5. Relevant System Memories
6. Retrieved Source Chunks
7. Current Workbook Summary
8. Available Tools
9. Structured Output Schema
```

Memory 不覆蓋：

```text
- 使用者本輪明確指示
- PostgreSQL 查價結果
- PostgreSQL 規格重量結果
- 後端計算結果
```

### 10.3 context_refs 與 Chain 斷裂恢復

每次 OpenAI run 保存 `context_refs`，記錄本輪使用的 DB record ids：

```ts
context_refs: {
  instruction_version_ids: ObjectId[]   // 本輪使用的 instruction 版本
  source_version_ids: ObjectId[]        // 本輪使用的 source 版本
  active_memory_ids: ObjectId[]         // 本輪注入的 system memory
  workbook_id: ObjectId                 // 本輪對應的 workbook
  workbook_version_seq: number          // 本輪 workbook 版本序號
  project_id: ObjectId
}
```

當 `chain_broken = true` 時，Orchestrator 從 `context_refs` 重查各 id 的當前狀態，重建 prompt bundle，以最新的 workbook 狀態作為對話起點。

> 注意：用 DB id 參照重建時，取得的是「現在的版本」內容，不是「當時的版本」。
> 確保 instruction / source 版本不刪除只做 inactive，即可透過 version_id 查回當時內容。

### 10.4 Structured Outputs

使用 Structured Outputs 的任務：

```text
quote_extraction
workbook_json
workbook_patch
memory_candidate
admin_mapping_profile
admin_merge_table
admin_merge_table_patch
tool_result
low_confidence_items
```

---

## 11. Workbook JSON Engine

### 11.1 主資料

```text
workbook_json = 可編輯資料（主資料）
xlsx = 匯出結果（由後端 ExcelJS 產生）
```

### 11.2 Workbook 綁定

```ts
steel_workbooks {
  _id: ObjectId
  steel_conversation_meta_id: ObjectId

  user_id?: ObjectId
  guest_access?: boolean

  current_workbook_json: object
  version_seq: number

  status: 'draft' | 'exported' | 'closed'

  created_at: Date
  updated_at: Date
  last_openai_run_id?: ObjectId
}
```

### 11.3 Workbook 分頁

建議最少分頁：

```text
總覽
總細項
低置信
價格來源
判讀備註
給客戶用
系統訂單
```

### 11.4 表格修改流程

```text
使用者提出修改
  ↓
OpenAI 帶 previous_response_id 接續
  ↓
OpenAI 產生 workbook_patch
  ↓
後端檢查格式與 conversation access
  ↓
後端直接套用 patch 到 current_workbook_json
  ↓
更新 version_seq
  ↓
寫入 steel_workbook_patches（patch 紀錄）
  ↓
使用者可立即下載 Excel
```

不需要二次口頭確認。若使用者認為更新有問題，下一輪對話再要求修正。

### 11.5 Patch 格式

採用 JSON Patch（RFC 6902），以 Structured Output 輸出：

```json
{
  "patch_format": "workbook-patch-v1",
  "target_version_seq": 7,
  "ops": [
    {
      "op": "replace",
      "path": "/sheets/總細項/rows/3/unit_price",
      "value": 32
    }
  ],
  "reason": "使用者本輪明確指定單價"
}
```

不允許 patch 修改系統欄位（如 `steel_conversation_meta_id`、`user_id`、`audit`）。

### 11.6 Workbook Patch 紀錄

```ts
steel_workbook_patches {
  _id: ObjectId
  workbook_id: ObjectId
  steel_conversation_meta_id: ObjectId
  openai_run_id?: ObjectId         // 若是 AI 產生的 patch

  patch_ops: object[]              // JSON Patch RFC 6902 ops
  version_seq_before: number
  version_seq_after: number
  patch_source: 'ai' | 'user_direct'
  reason?: string
  applied_at: Date
}
```

### 11.7 並發控制

```text
前端送出 patch 時帶入 target_version_seq
  ↓
後端確認 current version_seq 與 target_version_seq 相符
  ↓
相符 → 套用 patch，version_seq + 1
不符 → 回傳 409，前端提示使用者重新載入
```

---

## 12. Excel Export Engine

### 12.1 功能

```text
1. 匯出完整 Excel
2. 匯出指定分頁
3. 匯出「給客戶用」分頁
4. 匯出「系統訂單」分頁
5. 凍結首列
6. 開篩選
7. 欄寬調整
8. 金額整數格式
9. 重量保留 2 位
10. 未確認不得顯示為 0
11. 保存匯出紀錄
12. 支援 guest conversation 下載
```

### 12.2 指定分頁下載

```ts
POST /api/steel/conversations/:conversationMetaId/exports
{
  "sheet_ids": ["customer_quote"],
  "filename": "客戶用報價單.xlsx"
}
```

### 12.3 客戶用 Excel 遮罩

開發階段先不完整定義遮罩欄位。輸出欄位由後端 code 控制，不由 AI 決定。

開發階段暫用 allowlist：

```text
item_name
spec
quantity
unit
unit_price
subtotal
remark
```

未來補充（待業務確認）：

```text
internal_cost
low_confidence_reason
source_refs
admin_notes
ai_notes
margin
```

### 12.4 時效性下載連結

```text
GET /api/steel/exports/:exportId/download?token=<signed_jwt>
```

下載前驗證：JWT 有效期（建議 24 小時）、請求者 ACL 權限，並記錄到 `steel_audit_logs`。

---

## 13. Admin 控制頁：XLSX 增量匯入、AI Merge Table 與 PostgreSQL 更新

### 13.1 模組目的

Admin 控制頁用於讓 Admin 上傳 XLSX，透過 OpenAI 協助完成：

```text
1. 欄位 mapping（AI 多輪對話處理）
2. 舊資料比對
3. Merge 表格 data 產生
4. Admin 多輪對話修正 data
5. 格式驗證由程式邏輯定義與執行
6. Admin 確認後寫入 PostgreSQL
```

本模組支援**增量更新**。Admin 上傳的 New data 不需要是完整資料表，可以只包含本次要新增、更新或刪除的資料。

### 13.2 核心分工

#### AI 負責（語意判斷與 data 內容）

```text
1. 判斷 XLSX sheet 用途
2. 判斷 header row
3. 產生 mapping helper（欄位對應）
4. 根據 Admin 多輪對話修正 mapping helper
5. 結合 New data 與對應 Old data
6. 產生 merge_rows（data 內容判斷）
7. 標記新增、更新、刪除、低信心
8. 根據 Admin 多輪對話修正 merge_rows 的 data 內容
9. 產生 merge_table_patch（只修改 data 內容）
```

AI 不負責：

```text
1. 格式驗證（型別、範圍、必填）
2. valid / invalid 標記
3. 直接寫入 PostgreSQL
4. 執行 raw SQL / Mongo query
5. 修改格式驗證規則定義
```

#### 程式邏輯負責（格式驗證與提交）

```text
1. 全量解析 XLSX
2. 保存原始檔案與解析結果
3. 套用 mapping helper 到本次 XLSX rows
4. 依 lookup rule 查找 PostgreSQL 舊資料
5. 接收 AI 產生的 merge_rows
6. 執行欄位格式驗證（型別、範圍、必填）
7. 執行 schema 合規檢查（對應目標 PostgreSQL table）
8. 標記 valid / invalid / needs_review
9. 接收 merge_table_patch，套用並重新驗證
10. Admin 確認後執行 PostgreSQL transaction
11. 只處理 valid rows
12. 寫入 import audit summary
```

#### Admin 負責

```text
1. 上傳 XLSX
2. 選擇目標資料 Table
3. 透過多輪對話修正 mapping helper 與 merge data
4. 確認哪些資料有效 / 無效
5. 按下「更新資料庫」
```

### 13.3 核心流程

```text
Admin 上傳 XLSX
  ↓
後端 Excel Parser 全量解析本次 XLSX
  ↓
AI（多輪對話）：產生 / 修正 mapping helper
  ↓
後端套用 mapping helper 到本次 XLSX rows
  ↓
後端依查找規則尋找 PostgreSQL 舊資料
  ↓
AI 結合 New data + 對應 Old data，產出 merge_rows
  ↓
程式驗證：標記 valid / invalid / needs_review
  ↓
Admin 透過多輪對話要求 AI 修正 data
  ↓
AI 產生 merge_table_patch（只修改 data，不改格式規則）
  ↓
後端套用 patch，程式重新驗證
  ↓
Admin 確認
  ↓
後端 transaction 寫入 PostgreSQL（只處理 valid rows）
```

### 13.4 UI 版面

```text
左側：目標資料 Table 選單
中間：Admin 與 AI 對話 UI
右側：資料表格 UI（New / Old / Merge Tab）
```

#### 左側目標資料 Table

```text
客戶資料    → customers、customer_aliases、customer_tiers
材料價格    → price_items、price_categories、price_rule_conditions
價格細節    → processing_prices、cutting_prices、hole_prices、slotting_prices、bending_prices
規則細節    → material_rules、import_rule_notes
```

#### 中間 Admin 與 AI 對話

Admin 可用自然語言修正 mapping、刪除標記、data 內容。

範例：

```text
這次「尺寸」就是舊版的「規格」，請 mapping 到 spec。
這次 XLSX 只上傳要更新的價格，不是完整價格表。
有「刪除」欄位且值為 Y 的資料，代表要刪除該筆。
第 12 列不是新增，是要更新舊的 100x50x20 規格。
```

AI 每輪回覆後產生：

```text
mapping_profile_patch
merge_table_patch
low_confidence_items
admin_decision_summary
```

### 13.5 New / Old / Merge Tab

#### New Tab

New Tab 顯示本次 XLSX 上傳的新資料，不顯示 PostgreSQL 全部資料。

#### Old Tab

Old Tab 只顯示與 New data 對應到的 PostgreSQL 舊資料，不顯示全部正式資料。

#### Merge Tab

Merge Tab 是主要操作畫面，只顯示本次會改變或需要處理的資料。

顯示類型：

```text
新增
更新
刪除
低信心
有效資料（valid）
無效資料（invalid）
需要 Admin 決策（needs_review）
```

### 13.6 Merge 操作類型

每筆 Merge row 標記為：

```text
create   → New data 找不到對應 Old data，且程式驗證通過
update   → New data 找到對應 Old data，且未標記刪除
delete   → New data 有刪除標記，且找到對應 Old data
invalid  → 程式驗證失敗（缺必填欄位、格式錯誤、違反 schema 等）
needs_review → 低信心、多筆候選、AI 無法判斷 create 或 update
```

> invalid 與 needs_review 的標記完全由程式邏輯決定，AI 只負責 data 內容，不決定 validity。

### 13.7 Merge Table Schema 概念

```json
{
  "merge_rows": [
    {
      "merge_row_id": "mr_001",
      "target_table": "price_items",
      "operation": "update",
      "validity": "valid",
      "validity_reason": "matched_old_record_and_required_fields_complete",
      "source": { "sheet_name": "價格表", "source_row": 12 },
      "lookup": {
        "old_record_id": "price_001",
        "lookup_key": { "material_name": "C型鋼", "spec": "100x50x20", "customer_tier": "B" },
        "match_confidence": "high"
      },
      "fields": [
        {
          "field_name": "unit_price",
          "old_value": 31,
          "new_value": 32,
          "merge_value": 32,
          "value_source": "new_value",
          "change_type": "updated"
        }
      ],
      "confidence": "high",
      "can_commit": true
    }
  ]
}
```

### 13.8 Admin Import 狀態機

```text
uploaded → parsed → mapping_draft → lookup_ready → old_data_matched
  → merge_generated ↔ admin_reviewing ↔ merge_revised
  → final_ready → committed

其他：cancelled、failed
```

### 13.9 ERP 匯入 Upsert 策略

客戶資料與材料單價來源為 ERP 系統匯出，支援多次匯入並更新既有資料。

Upsert key（待 ERP 欄位確認後補充）：

```text
customers        → erp_customer_code（欄位名稱待確認）
price_items      → erp_item_code + customer_tier（欄位名稱待確認）
```

ERP 欄位 mapping 設定儲存於 `steel_admin_mapping_profiles`，可由 Admin 設定，不硬編碼。

### 13.10 後端提交規則

Admin 按下「確認更新資料庫」後，後端執行：

```text
1. 讀取 Merge Tab final rows
2. 過濾 validity = valid 且 can_commit = true 的 rows
3. 忽略 invalid rows
4. 忽略 needs_review rows
5. 開啟 PostgreSQL transaction
6. 對 valid create 執行 INSERT
7. 對 valid update 執行 UPDATE（upsert）
8. 對 valid delete 執行 soft delete 或 physical delete
9. 若 unit_price 有異動，寫入 price_history
10. 寫入 import audit summary
11. COMMIT
```

若任一有效 row 更新失敗：

```text
ROLLBACK → 顯示錯誤 → 正式資料不變
```

---

## 14. Memory Candidate 與 System Memory

### 14.1 三層 Memory 分工

```text
層級 1：LibreChat User Memory（個人偏好）
  → 沿用 LibreChat，不修改

層級 2：Memory Candidate Pool（AI 偵測候選池）
  → AI 主動偵測，寫入 steel_memory_candidates
  → Admin 在管理頁面審核

層級 3：System Memory（系統層級修正記憶）
  → Admin 審核通過後 promote 至 memories（active）
  → 對所有使用者的 AI 推理統一生效
```

### 14.2 AI 偵測候選的觸發條件

```text
1. user_correction   → 使用者明確指出 AI 錯誤
2. low_confidence_resolved → 低信心項目被人工確認修正
3. repeated_error    → 相同類型錯誤在不同對話中重複
4. source_conflict   → AI 發現來源資料與工具結果矛盾
5. admin_created     → Admin 在控制頁手動新增候選
```

### 14.3 Candidate Schema 概念

```ts
steel_memory_candidates {
  _id: ObjectId

  trigger_type:
    | 'user_correction'
    | 'low_confidence_resolved'
    | 'repeated_error'
    | 'source_conflict'
    | 'admin_created'

  steel_conversation_meta_id?: ObjectId
  source_openai_response_id?: string

  error_description: string
  suggested_correction: string

  affected_scope: 'global' | 'project' | 'customer' | 'material_type'
  affected_material_type?: string
  affected_customer_id?: number
  affected_project_id?: ObjectId

  candidate_status: 'pending' | 'approved' | 'rejected' | 'merged'
  confidence?: number
  evidence_refs: string[]

  created_at: Date
  reviewed_by?: ObjectId
  reviewed_at?: Date
}
```

`create_memory_candidate` 為 Tool Registry 的內部工具，只允許 AI orchestrator 呼叫。

### 14.4 Admin 審核與統整

Admin Memory 控制頁功能：

```text
1. 查看 pending candidates（依日期、scope、trigger_type 篩選）
2. 查看 AI 提供的佐證：錯誤描述、建議修正、來源對話、信心分數
3. 預覽該修正若生效，將影響哪些 Project / Customer
4. 合併多筆相似 candidate
5. 編輯 system memory 內容
6. 設定 scope
7. 核准 → promote 至 memories（active）
8. 拒絕 → candidate_status = rejected，附拒絕原因
9. 停用 active memory
10. promote memory 到 Project Instruction
```

範例統整：

```text
候選 A：角鐵裁切不能直接用成品淨長算材料費
候選 B：槽鐵裁切要先配 6M 素材
候選 C：扁鐵裁切要列餘料

Admin 統整為：
長條料若為裁切料，除非用戶明確說可切清，否則需先依可售素材長度配料，
再計算材料費、切工與餘料。
```

### 14.5 Memory 狀態機

```text
steel_memory_candidates：
  pending  → approved  （Admin 核准，同時建立 memories active 記錄）
  pending  → rejected  （Admin 拒絕，附理由）
  rejected → pending   （AI 再次偵測到相同問題，重新提案）
  approved → merged    （已合併進 system memory）

steel_memories：
  active     → disabled    （Admin 主動停用）
  active     → superseded  （被新版 memory 取代）
  superseded → active      （不允許直接恢復，需重新走候選審核流程）
```

### 14.6 Memory Conflict 記錄

```ts
steel_memory_conflicts {
  _id: ObjectId
  memory_id_a: ObjectId
  memory_id_b: ObjectId
  conflict_type: 'scope_overlap' | 'rule_contradiction' | 'customer_override'
  detected_at: Date
  resolved_by?: ObjectId
  resolution?: 'keep_a' | 'keep_b' | 'merge' | 'both_disabled'
}
```

### 14.7 Memory 不提供價格

System Memory 可提供：

```text
判斷提醒
計價規則補充
圖面判讀注意事項
錯誤案例
格式偏好
```

不可提供：

```text
材料單價
加工單價
客戶分級價格
取代 PostgreSQL 查價結果
```

### 14.8 promote-to-instruction

```ts
// POST /api/steel/memories/:memoryId/promote-to-instruction
{
  target_project_id: ObjectId,
  instruction_category: 'core' | 'quote' | 'ocr' | 'excel' | 'low_confidence' | 'admin_import'
}
```

Promote 後：memories 狀態改為 `superseded`，新 instruction_version 記錄 `promoted_from_memory_id`。

---

## 15. RAG Retrieval 與 Source Sync

### 15.1 Retrieval 目標

```text
1. Project Sources chunks 語意搜尋
2. Text Sources 規則搜尋
3. 手冊規格片段搜尋
4. 切工表備註搜尋
5. Memory 相關性搜尋
```

先評估 LibreChat RAG API 是否可承接 metadata filter（source_type、source_category、active version）需求；若可，做 adapter；若不足，自建 TypeScript retrieval 模組。

### 15.2 Source 更新

```text
使用者更新 Source
  ↓
舊 source_version 標記 inactive
  ↓
舊 chunks / embeddings 標記 inactive 或刪除
  ↓
非同步 BullMQ job：重新解析 → 切 chunks → 產生 embeddings
  ↓
新 source_version 設 active
```

### 15.3 Source 刪除

```text
使用者刪除 Source
  ↓
steel_project_sources.status = deleted
  ↓
同步停用：source_chunks、source_embeddings
  ↓
RAG search 強制只查 active source/version/chunk
```

### 15.4 檢索 Filter

```text
source_status = active
source_version_status = active
chunk_status = active
project_id = current_project_id
```

若是 guest conversation：

```text
只允許查 public 或系統預設 active sources
```

---

## 16. Admin Data Import 資料模型

### 16.1 MongoDB

```ts
steel_admin_import_sessions {
  _id: ObjectId
  admin_user_id: ObjectId

  target_dataset:
    | 'customers'
    | 'material_prices'
    | 'processing_prices'
    | 'rules'

  source_file_id: ObjectId
  status:
    | 'uploaded' | 'parsed' | 'mapping_draft' | 'lookup_ready'
    | 'old_data_matched' | 'merge_generated' | 'admin_reviewing'
    | 'merge_revised' | 'final_ready' | 'committed' | 'cancelled' | 'failed'

  selected_model: string

  openai_meta: {
    openai_conversation_id?: string
    previous_response_id?: string
  }

  created_at: Date
  updated_at: Date
}
```

```ts
steel_admin_merge_tables {
  _id: ObjectId
  import_session_id: ObjectId

  new_rows: object[]
  old_rows: object[]
  merge_rows: object[]

  version_seq: number
  validation_summary: {
    valid_count: number
    invalid_count: number
    needs_review_count: number
  }

  created_at: Date
  updated_at: Date
}
```

```ts
steel_admin_mapping_profiles {
  _id: ObjectId
  target_dataset: string

  mapping_helper: object      // AI 產生，欄位對應
  lookup_helper: object       // 查找 Old data 規則
  delete_marker_policy?: object

  created_by: ObjectId
  created_at: Date
  updated_at: Date
}
```

### 16.2 PostgreSQL 目標表

```text
customers、customer_aliases、customer_tiers
price_items、price_categories、price_rule_conditions
processing_prices、cutting_prices、cutting_price_adjustments
hole_prices、slotting_prices、bending_prices
material_rules、import_rule_notes
```

---

## 17. 非同步任務（BullMQ）

耗時操作不在 HTTP request 內同步執行，由 BullMQ（Node.js，Redis 後端）處理：

| Job 類型 | 觸發時機 |
|---|---|
| `source_reindex_job` | Source 新增 / 更新後，重新 chunk + embed |
| `admin_import_parse_job` | Admin 上傳 XLSX 後，解析 rows |
| `excel_export_job` | 大型 Workbook 匯出 |

前端進度查詢：

```text
GET /api/steel/jobs/:jobId
  → { status: 'pending' | 'processing' | 'completed' | 'failed', progress: number }
```

或由 WebSocket 推播完成事件。

---

## 18. API 大綱

### 18.1 Conversation APIs

```text
POST /api/steel/conversations/guest
POST /api/steel/conversations/authenticated
GET  /api/steel/conversations/:conversationMetaId
POST /api/steel/conversations/:conversationMetaId/link-account
POST /api/steel/conversations/:conversationMetaId/messages
GET  /api/steel/conversations/:conversationMetaId/workbook
GET  /api/steel/jobs/:jobId
```

### 18.2 Workbook APIs

```text
GET  /api/steel/workbooks/:workbookId
POST /api/steel/workbooks/:workbookId/patch
POST /api/steel/conversations/:conversationMetaId/workbook/patch
GET  /api/steel/workbooks/:workbookId/patches        ← patch 歷程
POST /api/steel/conversations/:conversationMetaId/exports
GET  /api/steel/exports/:exportId/download
```

### 18.3 Project / Sources / Instructions APIs

```text
GET    /api/steel/projects
POST   /api/steel/projects
GET    /api/steel/projects/:projectId
PATCH  /api/steel/projects/:projectId

GET    /api/steel/projects/:projectId/sources
POST   /api/steel/projects/:projectId/sources/file
POST   /api/steel/projects/:projectId/sources/text
PATCH  /api/steel/sources/:sourceId
DELETE /api/steel/sources/:sourceId
POST   /api/steel/sources/:sourceId/reindex

GET    /api/steel/projects/:projectId/instructions
PATCH  /api/steel/projects/:projectId/instructions
POST   /api/steel/projects/:projectId/instructions/versions
```

### 18.4 Admin Import APIs

```text
POST /api/steel/admin/import-sessions
GET  /api/steel/admin/import-sessions/:sessionId
POST /api/steel/admin/import-sessions/:sessionId/upload-xlsx
POST /api/steel/admin/import-sessions/:sessionId/generate-mapping
POST /api/steel/admin/import-sessions/:sessionId/match-old-data
POST /api/steel/admin/import-sessions/:sessionId/generate-merge
POST /api/steel/admin/import-sessions/:sessionId/chat
POST /api/steel/admin/import-sessions/:sessionId/apply-merge-patch
POST /api/steel/admin/import-sessions/:sessionId/commit
POST /api/steel/admin/import-sessions/:sessionId/cancel
```

### 18.5 Memory APIs

```text
GET  /api/steel/memory-candidates
POST /api/steel/memory-candidates
PATCH /api/steel/memory-candidates/:candidateId
POST /api/steel/memory-candidates/:candidateId/approve
POST /api/steel/memory-candidates/:candidateId/reject
POST /api/steel/memory-candidates/merge

GET  /api/steel/memories
POST /api/steel/memories
PATCH /api/steel/memories/:memoryId
POST /api/steel/memories/:memoryId/disable
POST /api/steel/memories/:memoryId/promote-to-instruction
```

---

## 19. 鋼鐵報價流程

### 19.1 一般查價流程

```text
使用者輸入訂單 / 規格 / 圖面
  ↓
steel_conversation_meta 建立或取得
  ↓
OpenAI 判斷需求
  ↓
呼叫 lookup_customer / lookup_spec_price / lookup_weight_spec
  ↓
取得 PostgreSQL 最新價格與規格
  ↓
OpenAI 產生 workbook_json 或 workbook_patch
  ↓
後端更新 current_workbook_json，寫入 steel_workbook_patches
  ↓
使用者查看表格或下載 Excel
```

### 19.2 圖面 / OCR 流程

```text
使用者上傳圖片 / PDF
  ↓
LibreChat Upload as Text / OCR 或 OpenAI vision 判讀
  ↓
OpenAI 依 Project Instructions 與 Text Sources 判斷：
  材料類別、規格尺寸、數量、孔洞、切工、開槽、折工、低信心
  ↓
呼叫後端 tools 查價 / 查重
  ↓
產生 workbook_json
```

### 19.3 修改表格流程

```text
使用者：「把第 3 項單價改成 32/kg」
  ↓
OpenAI 帶 previous_response_id 接續
  ↓
OpenAI 產生 workbook_patch
  ↓
後端套用 patch，寫入 steel_workbook_patches
  ↓
使用者可立即下載
```

---

## 20. Excel 與系統訂單欄位

### 20.1 報價明細建議欄位

```text
頁碼、零件編號、材料類別、材質、規格、長寬厚、成品長度m、數量
素材長度、素材支數、可裁成品數、餘料長度/重量
單位重量、單重、總重、重量算法
客戶、分級、材料單價、材料費
切工來源頁/品項、切工規格、切工單價、切工次數、切工加價、切工費
孔徑、每片/每支孔數、總孔數、孔單價、孔費
開槽路徑、每片/總開槽M、開槽單價、開槽費
折刀數、折刀位置、折工單價、折工費
其他費、小計
信心等級、低信心原因、判斷依據、建議複核、備註
```

### 20.2 系統訂單欄位

```text
公司編號、項次、倉庫編號、型號、品名規格、材質編號、廠別編號
單位、數量、單重、總數、單價、計價基準、公式編號
厚度、寬度、長度、類別、交貨日期、備註
```

---

## 21. 採用工具

| 工具 | 用途 |
|---|---|
| LibreChat | 聊天 UI、多使用者、Agents、Admin、檔案上傳、對話紀錄 |
| TypeScript | 後端模組、前後端共享 types |
| React | 前端管理頁 |
| MongoDB | 應用狀態、Workbook、Sources metadata、Memory、Audit |
| PostgreSQL | 客戶、價格、規格、訂單、chunks |
| pgvector | Source / rule semantic retrieval |
| OpenAI Responses API | 對話、tool calling、structured outputs、Code Interpreter |
| OpenAI Code Interpreter | Python 計算、資料處理、圖像輔助處理 |
| ExcelJS | XLSX 匯出 |
| Zod | 後端 schema validation |
| Prisma 或 node-postgres | PostgreSQL 存取 |
| BullMQ + Redis | source reindex、XLSX 匯入、Excel export 非同步 job |
| JSON Patch RFC 6902 | Workbook patch / Merge table patch |

---

## 22. 權限與資料隔離

### 22.1 一般使用者

```text
- 可建立 authenticated conversation
- 可建立 workbook
- 可下載自己 conversation 的 workbook
- 可用 OpenAI 查價
```

### 22.2 Guest

```text
- 可建立 guest conversation
- 裝置保存 steel_conversation_meta_id + token
- 可查價、建立 workbook、下載該 conversation 的 workbook
- 不可進 Admin 控制頁
- 不可管理 Sources / Instructions / Memory
- 只可查 public 或系統預設 active sources
```

### 22.3 Admin

```text
- 可進 Admin 控制頁
- 可上傳 XLSX 更新資料庫
- 可審核 Memory Candidate
- 可管理 Project Sources
- 可管理 Project Instructions
- 可查看匯入與 audit 摘要
```

---

## 23. Audit / Trace

保存最小必要資訊：

```text
1. OpenAI run：
   - provider、model
   - steel_conversation_meta_id
   - openai_meta（previous_response_id、last_response_id）
   - context_refs
   - tool_call_ids

2. Workbook：
   - current_workbook_json
   - version_seq
   - updated_at
   - last_openai_run_id
   - steel_workbook_patches（每次 patch 紀錄）

3. Admin import：
   - source file
   - mapping profile
   - merge table summary
   - committed rows count
   - invalid rows count
   - needs_review rows count

4. Memory：
   - candidate 來源（trigger_type、steel_conversation_meta_id）
   - admin 審核者
   - 合併後 system memory
```

不保存：

```text
舊報價完整版本
舊價格快照
舊報價價格連動
```

> 注意：本系統不保存報價當時的價格快照。若需追溯某份報價的計價依據，
> 只能透過 import_log 的時間戳推算當時的資料庫狀態，無法直接重算舊報價。
> 這是刻意的設計取捨，不是遺漏。

---

## 24. 高風險與待確認項目

| 項目 | 說明 |
|---|---|
| LibreChat RAG API 是否可承接 Steel Sources | 先確認 metadata filter（source_type、version、active）是否足夠 |
| OpenAI response chain 30 天 TTL | 已有 chain_broken + context_refs 恢復機制，需在 MVP 前測試 |
| ExcelJS 效能 | 大型 workbook 需壓力測試 |
| Admin Merge Table 準確性 | 需用實際價格 XLSX 測 mapping / lookup / merge |
| 切工價錢 PDF 結構化 | 圖片式表格需人工校正後匯入 |
| 客戶用 Excel 遮罩 | 開發階段先 allowlist，正式前補完整遮罩策略 |
| Guest token 安全 | token 只存 hash，建議可設過期與 rotate |
| ERP 欄位 mapping | ERP 匯出欄位名稱待業務確認後補充 |
| Prompt injection 防護 | tool result 需在 MVP 前實作 sanitizer |

---

## 25. 最終模組清單

| 模組 | 位置 | 資料庫 |
|---|---|---|
| Conversation Meta | `/packages/api/steel/conversations` | MongoDB |
| Steel Project | `/packages/api/steel/projects` | MongoDB |
| Project Sources | `/packages/api/steel/sources` | MongoDB + PostgreSQL |
| Project Instructions | `/packages/api/steel/instructions` | MongoDB |
| Steel Admin Import | `/packages/api/steel/admin-imports` | MongoDB + PostgreSQL |
| AI Merge Table | `/packages/api/steel/admin-imports/merge` | MongoDB |
| Steel Tool Registry | `/packages/api/steel/tools` | MongoDB + PostgreSQL |
| OpenAI Orchestrator | `/packages/api/steel/openai` | MongoDB |
| Prompt Bundle Builder | `/packages/api/steel/prompt` | MongoDB + PostgreSQL |
| Workbook JSON Engine | `/packages/api/steel/workbook` | MongoDB |
| Excel Export Engine | `/packages/api/steel/excel` | MongoDB |
| Steel Memory | `/packages/api/steel/memory` | MongoDB |
| RAG Retrieval / Adapter | `/packages/api/steel/retrieval` | PostgreSQL + pgvector |
| Audit / Trace | `/packages/api/steel/audit` | MongoDB |
| PostgreSQL Repositories | `/packages/api/steel/repositories` | PostgreSQL |
| Permissions | `/packages/api/steel/permissions` | MongoDB / LibreChat ACL |
| Async Jobs | `/packages/api/steel/jobs` | Redis（BullMQ） |

---

## 26. 補充說明：OpenAI Conversations API + Responses API 正確理解

### 26.1 v8.1 採用 OpenAI conversation 作為 provider-side 長期狀態

OpenAI Conversations API 可與 Responses API 搭配使用。建立 OpenAI conversation object 後，Responses API 呼叫可傳入 `conversation`，讓 OpenAI 在 provider side 持久化對話 state。

本系統因此使用兩種 id：

| ID | 來源 | 用途 |
|---|---|---|
| `steel_conversation_meta._id` | 本系統 MongoDB | 業務主對話 ID；Workbook、Guest token、Export、Audit 都綁定此 ID |
| `openai_conversation_id` | OpenAI Conversations API | OpenAI provider-side durable conversation id |
| `openai_response_id` | OpenAI Responses API | 每輪 response id |
| `previous_response_id` | OpenAI Responses API | response chain 追蹤、audit、fallback |

### 26.2 conversation 與 previous_response_id 的使用原則

```text
主要策略：
- 建立 steel_conversation_meta 時，同步建立 OpenAI conversation。
- Responses API 呼叫以 conversation = openai_conversation_id 為主。
- 每輪仍保存 previous_response_id，做 response chain 追蹤、audit 與 fallback。

實測分歧處理：
- 若 API / SDK 可同時傳 conversation 與 previous_response_id，則兩者都傳。
- 若 API / SDK 不適合同時傳，則只傳 conversation，previous_response_id 只保存不傳。
```

### 26.3 不透過 OpenAI API 取得歷史對話

本系統不另外呼叫 OpenAI API 取得歷史對話內容。後端需要追溯時，只使用本地資料：

```text
- LibreChat conversations / messages
- steel_openai_runs
- steel_conversation_meta.openai_meta
- steel_workbooks.current_workbook_json
- steel_workbook_patches
- context_refs
```

### 26.4 response objects TTL 與恢復策略

Responses API 的 response objects 有保存期限與成本考量。即使使用 conversation，也不應把 OpenAI provider state 當成唯一資料來源。

恢復策略：

```text
provider state 失效或 response chain 失效
  ↓
steel_conversation_meta.openai_meta.chain_broken = true
  ↓
Orchestrator 使用本地 context_refs、最新 workbook、active sources、instructions、memories 重建 prompt bundle
  ↓
必要時建立新的 OpenAI conversation
```

### 26.5 Token 成本說明

使用 conversation 或 previous_response_id 都可能讓模型取得更多歷史上下文。Orchestrator 應監控 token 用量；若 conversation 過長，應以本地 context_refs 和 workbook summary 重建上下文，避免長鏈成本失控。

---

## 27. 官方文檔 URL

### LibreChat

```text
LibreChat Features:             https://www.librechat.ai/docs/features
LibreChat Architecture:         https://www.librechat.ai/docs/development/architecture
LibreChat Agents:               https://www.librechat.ai/docs/features/agents
LibreChat Access Control:       https://www.librechat.ai/docs/features/access_control
LibreChat Admin Panel:          https://www.librechat.ai/docs/features/admin_panel
LibreChat MCP:                  https://www.librechat.ai/docs/features/mcp
LibreChat User Memory:          https://www.librechat.ai/docs/features/memory
LibreChat Upload as Text:       https://www.librechat.ai/docs/features/upload_as_text
LibreChat OCR:                  https://www.librechat.ai/docs/features/ocr
LibreChat RAG API:              https://www.librechat.ai/docs/features/rag_api
LibreChat Agents API:           https://www.librechat.ai/docs/features/agents_api
LibreChat Interface Config:     https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/interface
```

### OpenAI API

```text
Responses API / Conversation State: https://platform.openai.com/docs/guides/conversation-state
Function Calling:                   https://platform.openai.com/docs/guides/function-calling
Structured Outputs:                 https://platform.openai.com/docs/guides/structured-outputs
Code Interpreter:                   https://platform.openai.com/docs/guides/tools-code-interpreter
Retrieval:                          https://platform.openai.com/docs/guides/retrieval
```

### 資料庫 / ORM / Queue

```text
MongoDB:          https://www.mongodb.com/docs/manual/
pgvector:         https://github.com/pgvector/pgvector
PostgreSQL:       https://www.postgresql.org/docs/current/
PostgreSQL JSONB: https://www.postgresql.org/docs/current/datatype-json.html
Prisma ORM:       https://www.prisma.io/docs/orm
BullMQ:           https://docs.bullmq.io/
```

### 標準

```text
JSON Patch RFC 6902: https://datatracker.ietf.org/doc/html/rfc6902
```
