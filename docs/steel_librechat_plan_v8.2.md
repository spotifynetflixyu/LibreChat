# 鋼鐵報價 LibreChat 擴充專案 v8.2 開發規格

版本日期：2026-05-25
修訂版本：v8.2
文件狀態：可執行開發規格

本文件將 v8.1 規劃升級為可交給工程實作的規格。v8.2 的核心變更是：固定 Workbook 七分頁、正式資料來源只走 DOCX / XLSX Admin Import、Admin 不做 PDF parser、資料庫以 MongoDB + Supabase PostgreSQL 為主、報價以 Quote Resolution Engine 和 deterministic calculator 為核心。

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
- OpenAI Conversations API + Responses API 狀態追蹤。
- 開發階段可透過 LibreChat UI 選擇低成本 OpenAI model。
- Project Sources / Project Instructions 管理。
- 鋼鐵資料查詢 tools。
- Admin DOCX / XLSX 增量匯入控制頁。
- Admin 正式資料匯入只接受 DOCX / XLSX。
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
Admin 上傳 DOCX / XLSX
  -> Admin preview
  -> AI 協助 mapping / merge table
  -> 後端驗證 valid / invalid / needs_review
  -> Admin confirm
  -> Supabase PostgreSQL transaction
```

價格異動追溯稱為「資料匯入引發的價格異動追溯」。

### 1.3 Admin 不做 PDF Parser

Admin 資料維護頁不做 PDF parser，也不負責把 PDF 轉成 DOCX / XLSX。

正式資料匯入入口只接受：

- DOCX
- XLSX

若 Admin 上傳 PDF、掃描 PDF、圖片式 PDF、手冊 PDF、切工價錢 PDF 或圖面 PDF：

- 後端拒絕進入 Admin Import parser。
- UI 顯示「請先在系統外整理成 DOCX / XLSX 後再上傳」。
- 不建立 merge table。
- 不寫入 Supabase PostgreSQL 正式資料表。
- 若 PDF 另作報價對話附件或人工稽核附件，只能作低信心 evidence，不是 Admin data source。

核心結論：Admin data source = DOCX / XLSX only.

---

## 2. 核心決策摘要

| 項目 | v8.2 決策 |
|---|---|
| 基礎平台 | 使用 LibreChat monorepo 擴充，不另做 sidecar service |
| 後端位置 | 新增 TypeScript 後端邏輯放 `packages/api/src/steel` |
| `/api` 邊界 | 只放 Express route wrapper 與 route registration |
| 前端位置 | 使用 `client/src/features/steel` 建立 Chat Workspace、Workbook Preview、Admin pages |
| 資料庫 | MongoDB + Supabase PostgreSQL |
| MongoDB 用途 | LibreChat 既有資料、Steel app state、Workbook、Memory、Audit、Import sessions |
| Supabase PostgreSQL 用途 | 結構化業務資料、價格、重量、加工、訂單、source chunks、pgvector |
| AI Provider | OpenAI API，OpenAI 介面實作前需依官方 SDK type / API reference 校正 |
| OpenAI state | Responses API 呼叫使用 `conversation`；`previous_response_id` 只保存 audit / fallback，不同時傳 |
| 模型選擇 | 開發階段沿用 LibreChat model selector |
| Guest Mode | `STEEL_GUEST_MODE=false` 預設關閉；true 才允許未登入 quote/workbook/export |
| 價格規則 | 價格先於重量；不可用手冊重量直接推材料售價 |
| Workbook | Workbook JSON 是主資料，ExcelJS 只根據 Workbook JSON 匯出 |
| Workbook line | 永久保存公式、資料庫預設單價、報價單價、總價、調整來源 |
| Export | ExcelJS 產生 XLSX，固定七分頁，可完整或指定分頁下載 |
| Customer Sheet | 後端 allowlist 控制，不由 AI 決定欄位 |
| Admin Import | 正式入口只接受 DOCX / XLSX parsed data |
| PDF | 不進 Admin Import；若作聊天附件只作低信心 evidence |
| AI DB 權限 | AI 不直接操作 MongoDB / Supabase PostgreSQL，只能呼叫白名單 tools |
| Raw query | 禁止 raw SQL / raw Mongo query tool |
| Eval | 建立 Steel Eval Harness 驗證價格先於重量、七分頁、Admin upload policy、客戶版遮罩 |

---

## 3. 不重複造輪子原則

沿用 LibreChat：

- Authentication、OAuth / SAML / LDAP。
- Admin Panel、ACL / Roles / Groups。
- Agents、model selector、對話 UI、conversations / messages。
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
- Admin DOCX / XLSX Import / AI Merge Table
- Steel Tool Registry
- Steel Eval Harness

工程原則：

- 新後端邏輯用 TypeScript，放 `packages/api/src/steel`。
- `api/` 只新增薄 wrapper。
- shared API types 放 `packages/data-provider/src/steel`。
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
├─ openai
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
└─ index.ts
```

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
| 2 | Supabase repositories、normalization、pricing search、tools | 查客戶/價格/重量/加工 tools 可測 |
| 3 | Quote Resolution Engine、calculators、Workbook JSON | real OpenAI chat 可建立七分頁 workbook |
| 4 | ExcelJS export、customer mask、system order sheet | 七分頁 export 與 customer mask 測試通過 |
| 5 | Admin DOCX/XLSX import、Source 管理 | Admin confirm 後才可寫入 Supabase |
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
  openaiMeta: {
    openaiConversationId?: string;
    previousResponseId?: string;
    lastResponseId?: string;
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

## 6. OpenAI Provider、Conversation 與 Model Selection

OpenAI API 介面可能變動，實作前必須依當時官方 SDK type / API reference 校正：

- Responses API `conversation` 參數名稱。
- response id 保存方式。
- tool calling event 格式。
- structured outputs schema。
- file / vision input 格式。
- background / streaming event 格式。

狀態規則：

- `openaiConversationId` 是 provider-side 長期 conversation id。
- Responses API 呼叫傳 `conversation`。
- 不同時傳 `previous_response_id`。
- `previousResponseId` 只保存 audit / trace / fallback。
- 後端不透過 OpenAI API 抓歷史對話作為資料來源。
- 後端以 `contextRefs`、current workbook、active sources、instructions、memories 重建 prompt bundle。

每次 OpenAI run 保存：

```ts
export interface SteelOpenAIRunDraft {
  provider: 'openai';
  steelConversationMetaId: string;
  openaiConversationId?: string;
  openaiResponseId?: string;
  previousResponseId?: string;
  model: string;
  selectedBy: 'user' | 'system' | 'admin';
  promptTokens?: number;
  completionTokens?: number;
  contextRefs: PromptContextRefs;
  toolCallIds: string[];
  status: 'started' | 'completed' | 'failed';
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
}
```

Prompt Bundle 順序：

1. 使用者本輪明確指示。
2. LibreChat Agent instructions。
3. Steel Project Instructions。
4. Active Text Sources。
5. Relevant System Memories。
6. Retrieved Source Chunks。
7. Current Workbook Summary。
8. Available Tools。
9. Structured Output Schema。

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
- steel_openai_runs
- steel_tool_calls
- steel_excel_exports
- steel_admin_import_sessions
- steel_admin_merge_tables
- steel_admin_mapping_profiles
- steel_import_logs
- steel_audit_logs

MongoDB 保存：

- 對話 meta、guest token hash、OpenAI id audit。
- Workbook JSON 與 patch history。
- Project Sources / Instructions metadata。
- Admin DOCX / XLSX source metadata。
- 報價對話附件 evidence metadata。
- Admin import session / preview / merge table。
- Memory Candidate / System Memory。
- Tool calls、OpenAI runs、Excel export records、Audit logs。

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

本節定義系統需支援的來源類型。Repo 內 `docs/reference/doc` 檔案只可作 AI/dev logic reference；正式資料更新必須由 Admin 上傳或確認 DOCX / XLSX 後進入 import flow。

### 8.1 客戶資料.xlsx

用途：

- 客戶資料與單價分級。
- 報價前先比對客戶並取得分級。
- 客戶不明、多筆相似或分級不明時標低信心。

正式 import：

```text
Admin 上傳 XLSX
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

正式 import：

- Admin 上傳 DOCX。
- Admin preview parsed sections / tables。
- AI 協助 mapping。
- 後端驗證。
- Admin confirm。
- 寫入 `steel.weight_specs` / `steel.material_rules` / `steel.import_rule_notes` / `steel.source_chunks`。

### 8.4 龍頂鋼鐵手冊.pdf

Admin Import 不接受手冊 PDF。若業務需要匯入手冊內容，必須先在系統外整理成 DOCX / XLSX，再由 Admin 上傳。

正式重量查詢以 `steel.weight_specs` 為主。PDF 可作人工參考或對話附件 evidence，但不能由 Admin 匯入流程直接解析或寫入正式資料表。

### 8.5 H 型鋼規則文字來源

用途：

- H 型鋼常規 / 非常規米數規則。

規則：

- H 型鋼常規米數：6M、9M、10M、12M。
- H 型鋼非常規米數：7M、8M、11M、13M、14M、15M。
- 非常規米數單價 = 一般米數單價 + 0.3 元/kg。

正式 import：

- Admin Import 不接受 `.txt`。
- 若要匯入此規則，必須先在系統外整理成 DOCX / XLSX。
- Admin 上傳 DOCX / XLSX 後 preview。
- Admin confirm 後寫入 `steel.material_rules` 或 `steel.import_rule_notes`。

### 8.6 切工價錢.pdf

Admin Import 不接受切工價錢 PDF。若要匯入切工價格，Admin 必須上傳整理好的 XLSX。

正式查價以 Supabase cutting tables 為主。PDF 只作人工參考或報價對話附件 evidence，不是資料維護來源。

### 8.7 系統訂單.xlsx

用途：

- 系統訂單輸出格式範例。
- 作為 Excel「系統訂單」分頁欄位與格式參考。
- 不作為價格或重量來源。

正式 import：

- Admin 上傳 XLSX。
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
> 手冊 DOCX / XLSX 匯入後且 Admin 確認的資料
> 切工價格 XLSX 匯入後且 Admin 確認的資料
> H 型鋼規則 DOCX / XLSX 匯入後資料
> 推定
```

圖面與底表不一致，以圖面為主並標低信心。

---

## 9. DOCX / XLSX Admin Source Workflow

### 9.1 Source Manifest

```ts
export interface SourceManifest {
  id: string;
  projectSourceId: string;
  originalFileId: string;
  originalFilename: string;
  originalFileType: 'docx' | 'xlsx';
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

### 9.2 Admin Upload Rules

```text
Admin selects source type / target table
  -> Admin uploads DOCX or XLSX
  -> backend rejects PDF/image uploads
  -> parser creates preview rows
  -> Admin reviews parsed data
  -> AI helps mapping / merge table data only
  -> backend validates valid / invalid / needs_review
  -> Admin confirms
  -> Supabase transaction
```

Allowed Admin source files:

- `.docx`
- `.xlsx`

Rejected Admin source files:

- `.pdf`
- scanned PDF
- image PDF
- image files
- screenshots

Rejection message: "Admin data import only accepts DOCX/XLSX. Please prepare the source data as DOCX or XLSX before uploading."

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
  sourceFileType: 'docx' | 'xlsx';
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

當 Admin 修改 DOCX / XLSX 並重新上傳：

- 建立新的 source version。
- 舊版本保留 inactive。
- 不覆蓋舊版本。

---

## 11. Steel Tool Registry

OpenAI 不直接操作 MongoDB / Supabase PostgreSQL。OpenAI 只能呼叫後端白名單 business tools。

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
- `parse_docx_source`
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
6. Tool result 過濾 prompt injection 字串後再回傳給 OpenAI。
7. 回傳標準 tool result。
8. 記錄 `steel_tool_calls`。
9. 設定每 run 呼叫次數上限。

---

## 12. OpenAI Orchestrator 與 Prompt Bundle Builder

位置：

```text
packages/api/src/steel/openai
packages/api/src/steel/prompt
```

流程：

1. 接收 conversation message。
2. 取得 selected model。
3. 讀取 `steel_conversation_meta`。
4. 取得 OpenAI conversation id。
5. 組 Prompt Bundle。
6. 呼叫 OpenAI Responses API。
7. 處理 function calling loop。
8. 處理 structured outputs。
9. 寫入 `steel_openai_runs`。
10. 更新 `steel_conversation_meta.openaiMeta`。
11. 回寫 workbook patch / memory candidate / merge table patch。

Orchestrator acceptance：

- OpenAI client 可 injectable，測試不打真實 API。
- 至少一個 manual live smoke test 使用真實 OpenAI API 建立 customer-visible workbook。
- Runaway tool loop 有 typed error 與 audit。
- Invalid structured output 不修改 workbook。
- 所有 tool calls 寫入 `steel_tool_calls`。

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
  sourceType: 'database' | 'admin_docx' | 'admin_xlsx' | 'chat_pdf_evidence' | 'manual';
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

## 19. Vision / OCR Preprocessing Pipeline

此 pipeline 只用於報價對話中的圖面/圖片/PDF evidence，不屬於 Admin data import。Admin 資料維護仍只接受 DOCX / XLSX。

所有圖片、掃描 PDF、拍照圖面、訂單截圖、手寫單、材料表圖片，在讀文字前必須先判斷方向。

流程：

1. upload file / image
2. detect file type
3. render pages to images
4. orientation detection：0 / 90 / 180 / 270
5. visual layout classification：table / drawing / handwritten / mixed
6. OCR text extraction
7. vision interpretation for holes / slots / bends / cut marks
8. compare OCR vs vision result
9. produce structured intermediate result
10. attach evidence to workbook interpretation notes / manual review
11. never write formal source tables without Admin DOCX/XLSX import

低信心條件：

- OCR 破碎、欄位錯位、解析度低、反光、模糊、裁切。
- 手寫遮住、方向不明、OCR 與視覺不一致。
- 孔洞、開槽、折線、切角、尺寸不清。

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
  lastOpenAIRunId?: string;
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

Patch rules：

- 使用 JSON Patch RFC 6902。
- patch 必須帶 `targetVersionSeq`。
- 後端做 concurrency check。
- 後端驗證公式與價格一致性。
- 不允許 patch 修改系統欄位。
- 若 patch 修改 `quotedUnitPrice` 或 `lineTotal`，後端必須依 `formulaVersionId` 回算另一欄。
- 既有 workbook line 不因 Supabase 最新價格而自動更新。
- 只有使用者明確要求修改或重算該 line 時才可 patch。

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

## 25. Admin DOCX / XLSX Import / AI Merge Table

正式 Admin Import 入口只接受 DOCX / XLSX parsed data。

```ts
export interface AdminSourcePreviewRow {
  id: string;
  sourceManifestId: string;
  originalFilename: string;
  sourceFileType: 'docx' | 'xlsx';
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

- 判斷 DOCX / XLSX 用途。
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

- 全量解析 DOCX / XLSX。
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
- PDF 不能進 Admin Import；Admin 只接受 DOCX / XLSX。
- Excel 必須含 7 個必要分頁。
- 給客戶用不含客戶分級與內部資料。

---

## 28. Audit / Trace Logs

所有外部寫入、AI patch、import commit、export download 都要有 audit。

Audit event 類型：

- conversation_created
- guest_token_created
- openai_run_started
- openai_run_failed
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
- Tool output sanitize 後才回 OpenAI。
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
- [ ] `packages/data-schemas` build 通過。
- [ ] `packages/api` build 通過。
- [ ] Supabase schema snapshot 與 migration 同步。
- [ ] Supabase production TLS / CA policy 完成。

### 30.2 OpenAI

- [ ] 實作前校正官方 Responses API type。
- [ ] `conversation` call pattern 有 live smoke test。
- [ ] `previousResponseId` 只 audit，不與 conversation 同傳。
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
- [ ] ExcelJS export 固定七分頁。
- [ ] 給客戶用分頁不含內部欄位。
- [ ] 系統訂單分頁欄位固定。
- [ ] 未確認單價 / 金額顯示「未確認」。
- [ ] 指定分頁下載有 access check 與 audit。

### 30.5 Source / Import

- [ ] Admin Import 拒絕 PDF/image upload。
- [ ] Admin Import 正式入口只接受 DOCX / XLSX parsed data。
- [ ] Merge table valid / invalid / needs_review 由 code 決定。
- [ ] Commit only valid rows。
- [ ] Transaction rollback 測試通過。
- [ ] 資料匯入引發的價格異動寫入 `steel.price_history`。

### 30.6 UX Acceptance

- [ ] 使用者貼 LINE 訂單可產生 Workbook。
- [ ] 報價結果有明細、總結、複核、來源，不只回總價。
- [ ] 客戶口語品名會展開多組搜尋關鍵字。
- [ ] 找不到完全匹配不硬套，標低信心。
- [ ] 圖面 / 圖片先判斷方向。
- [ ] Admin 能 preview DOCX / XLSX parsed data。
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

GET    /api/steel/projects
POST   /api/steel/projects
GET    /api/steel/projects/:projectId/sources
POST   /api/steel/projects/:projectId/sources
GET    /api/steel/sources/:sourceId/versions
GET    /api/steel/source-versions/:versionId/preview
POST   /api/steel/source-versions/:versionId/confirm

POST   /api/steel/admin/import-sessions
POST   /api/steel/admin/import-sessions/:sessionId/upload-docx
POST   /api/steel/admin/import-sessions/:sessionId/upload-xlsx
GET    /api/steel/admin/import-sessions/:sessionId/preview
POST   /api/steel/admin/import-sessions/:sessionId/merge-table
POST   /api/steel/admin/import-sessions/:sessionId/merge-table/patch
POST   /api/steel/admin/import-sessions/:sessionId/commit

GET    /api/steel/admin/memory-candidates
POST   /api/steel/admin/memory-candidates/:candidateId/review

POST   /api/steel/evals/runs
GET    /api/steel/evals/runs/:runId
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
    sourceFileType: 'docx' | 'xlsx';
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

### Source Admin

Admin 上傳 DOCX / XLSX，查看 parsed data、source manifest、version history。PDF/image 上傳在 Admin data import 被拒絕。

### Import Admin

Admin preview parsed data、AI mapping、merge table、valid / invalid / needs_review，最後按「確認更新資料庫」才寫入 Supabase PostgreSQL。

### Memory Review

審核 AI 建議改善規則，將錯誤修正轉成 system memory 或 Project Instruction。

### UX 驗收標準

- 使用者貼 LINE 訂單，系統能產生 Workbook。
- 報價結果不是只回總價，而是有明細、總結、複核、來源。
- 客戶口語品名會展開多組價格搜尋關鍵字。
- 價格查詢先於重量計算。
- 找不到完全匹配不硬套，會標低信心。
- 長條料裁切會先配料，不直接用淨長計價。
- 圖面 / 圖片會先判斷方向。
- Admin data import 不接受 PDF/image，只接受 DOCX / XLSX。
- Admin 能 preview DOCX / XLSX parsed data。
- Excel 有七個必要分頁。
- 系統訂單分頁符合固定欄位。
- 給客戶用分頁不含客戶等級與內部資料。
- 使用者指出錯誤時，能建立 memory candidate。
- Guest user 可以建立報價並下載 Excel。
- Admin import 需經 valid / invalid / needs_review 檢查後才能寫入資料庫。
