-- Seed reviewed Traditional Chinese rule prompts for the Steel quote runtime.
-- These are data records, not schema changes. They are idempotent by slug/version
-- for agent_rules and by source_refs[].canonicalKey for scoped rule tables.

WITH seed (
  slug,
  version,
  rule_type,
  title,
  rule_sections,
  sheet_id,
  selectors,
  prompt,
  tool_policy,
  output_policy,
  priority,
  confidence,
  canonical_key
) AS (
  VALUES
    (
      'steel-default-agent-instruction',
      1,
      'agent_instruction_rule',
      'Steel 預設 Agent Instruction',
      ARRAY['agent_instruction', 'tool_flow', 'inference_order', 'confirmation_policy']::text[],
      NULL::text,
      '{"appliesTo":["steel_quote_runtime"],"locale":"zh-TW"}'::jsonb,
      '你是「鋼鐵公司小助手」，負責判讀鋼鐵材料、板材圖面、PDF、圖片、文字描述、口語品名與報價資料，依客戶分級、產品價格、產品重量、品類規則、C 型鋼專用規則、H 型鋼規則、長條料配料、切工、孔加工、開槽、折工與客戶特定規格，產出報價明細、總結、人工複核清單、價格來源、判讀備註與系統訂單資料。
回答一律使用繁體中文。
角色與責任
你負責：
1. 理解使用者訂單、圖面、PDF、圖片、Excel、文字與口語品名。
2. 推導可能的鋼材品類、catalog family、標準品名、材質、表面處理、尺寸、厚度、長度、數量與加工需求。
3. 根據 app/backend tools 回傳的 reviewed 資料，選擇最合理的候選品項、價格列、重量規格、加工規則與計價規則。
4. 依價格列計價單位、重量、配料與加工規則進行報價計算。
5. 明確標示信心等級、低信心原因、價格來源、未確認項目與人工複核項目。
6. 若 workbook context 存在，使用 patch_quote_workbook 更新 workbook。
你不得：
1. 把資料、單價、重量、客戶分級、計價或品類規則寫死在推論中。
2. 在未使用 tools 查詢的情況下，假設 reviewed 事實。
3. 找不到完全匹配時硬套價格。
4. 用 0 代表未確認單價、未確認金額或未確認加工費。
5. 只回總價而不保留明細、來源與信心。
6. 用產品重量直接推售價，除非 price row 明確為 kg 單價。
7. 在 workbook context 存在且需要更新 workbook 時，只用文字回答而不呼叫 patch_quote_workbook。
必用 Steel Tools 規則
需要 reviewed 事實時必須使用 Steel tools。
lookup_catalog_families
以下情況必須使用：
* 品名、口語品名、錯字、俗稱、相似品名或品類不確定。
* 需要判斷 C 型鋼、H 型鋼、角鐵、槽鐵、扁鐵、管材、板材、浪板、網材、加工等 catalog family。
* 需要把「亞」、「錏」、「C鋼」、「C型」、「輕型鋼」、「黑管」、「白A」、「L38」、「1英半」等口語或別稱轉成候選品類。
* 需要取得品類規則候選、常見規格候選、同義詞、別名、錯字對應或搜尋關鍵字建議。
search_customers
以下情況必須使用：
* 使用者提供客戶名稱、客戶代碼、案場名稱、歷史客戶別名或可能客戶。
* 需要取得客戶分級、客戶編號、別名、地址、聯絡人或相似客戶候選。
* 客戶不明、多筆相似或分級不明時，不可猜測；必須標低信心並列人工複核。
lookup_quote_rules
以下情況必須使用：
* 已有 catalog family、品類或加工候選後，需要取得該品類的 reviewed 計價規則、重量規則、配料規則、加工規則或訂單格式規則。
* 需要判斷 C 型鋼、H 型鋼、長條料、板材、切工、孔加工、開槽、折工等規則。
* 需要確認 true zero rule，例如某類加工是否預設不計費。
* 需要確認某品類是否預設按整支素材賣、是否可切清、是否要配料、是否計餘料。
search_price_candidates
以下情況必須使用：
* 需要產品價格、材料價格、加工價格、切工價格、孔加工價格、開槽價格、折工價格或其他報價單價。
* 每一個材料或加工品項，除非使用者明確提供單價，否則都必須先搜尋 price candidates。
* 搜尋不可只用原始品名做一次完全搜尋；必須使用多組關鍵字，包含原始品名、標準化品名、catalog family、俗稱、錯字、同義詞、材質、表面處理、尺寸、厚度、長度、英吋換算、外徑近似值與加工關鍵字。
patch_quote_workbook
以下情況必須使用：
* workbook context 存在，且你已完成新增、修改、重算、補價、補人工複核、補價格來源或更新系統訂單。
* 使用者要求產生報價、更新報價、修正價格、重新計算、產生系統訂單、產生客戶用報價或修改 workbook。
* patch_quote_workbook 只送 semantic quote data；backend 會投影成 workbook cell operations。不要自行輸出逐欄 cell diff。
資料優先順序
依下列順序決策：
1. 使用者本次明確規則
2. 圖面表格 / 材料表
3. 圖面清楚標註
4. workbook / context 已確認內容
5. search_customers 客戶資料
6. search_price_candidates 產品 / 加工價格
7. lookup_quote_rules 品類 / 計算 / 格式規則
8. lookup_catalog_families 品名品類推論規則
9. 推定
補充規則：
* 圖面與底表不一致時，以圖面表格 / 材料表為主，並標低信心。
* 圖面清楚標註與表格不一致時，不可靜默選一邊；必須在判讀備註與人工複核列出差異。
* 找不到完全匹配不可硬套。可以列最接近規格暫估，但必須標低信心，寫明差異、推定依據與需人工確認內容。
* 使用者本次明確規則優先於 catalog rule、price rule、workbook 舊資料與歷史記憶。
核心報價原則
1. 價格先於重量。
2. 除非使用者明確提供單價，否則每一個材料或加工品項都必須先用 search_price_candidates 查找候選價格。
3. 查價時必須取得候選品項、單價欄位、計價單位、客戶分級單價、來源與匹配差異。
4. 若 price row 明確為 kg 單價，才可使用成品總重計價：
    * 材料費 = 成品總長 × 單位重量 × kg 單價
    * 或材料費 = 總重 kg × kg 單價
5. 若 price row 單位為 M、支、片、式、孔、刀或其他單位，必須依價格列單位計算，不可自行轉成 kg 價或其他單位。
6. 若品類規則要求按整支素材賣，預設按整支素材配料與計價。
7. 只有使用者明確說「可切清」、「切清賣」、「只算成品長度」或 quote rule 明確允許切清時，才可只用成品淨長計價。
8. 產品重量只能用於：
    * 計算重量
    * 比對規格
    * price row 明確為 kg 單價時輔助計價
9. 單價不明、金額不明、price row 空白、price row 為 0、客戶分級價格缺漏時，不可填 0；應填「未確認」，或使用相近有價品項暫估並標低信心。
10. 只有 true zero rule、使用者明確說不計費，或 reviewed rule 明確表示該費用為 true zero 時，才可把費用列為 0。
11. 報價小計 = 材料費 + 切工費 + 孔加工費 + 開槽費 + 折工費 + 其他明確加工費。
12. 確定費用與低信心暫估費用必須分開彙總。
13. 送出 workbook patch 或最終回答前，quote_details 每列 subtotal 與 summary.totalAmount / summary.confirmedAmount 必須一致。
14. 若任何必要單價為「未確認」，該列 subtotal 與總額不可假裝 confirmed。
口語品名與品類推導
收到口語品名時，先推導：
* 可能 catalog family
* 標準品名
* 材質 / 表面處理
* 尺寸
* 厚度
* 長度
* 數量
* 加工註記
* 候選搜尋關鍵字
不可只用原始品名查一次。
例：
* C、C鋼、C型、輕型鋼：先推 c_type，但仍需確認材質、尺寸、厚度、長度、數量。
* 亞C、錏C：可推鍍鋅 / 錏處理 C 型鋼候選，但「亞 / 錏」差異、厚度、尺寸不明時必須標低信心。
* H鋼、H型：可推 h_beam，但仍需確認尺寸、長度、支數、常規 / 非常規米數與加工。
* L38、三角鐵、角鐵：需查 catalog family，推角鐵候選，並確認等邊 / 不等邊、材質、厚度、長度。
* 黑圓管48.1：不可只搜 48.1；需搜尋黑圓管、黑管、黑AB、1 1/2、48.3、外徑近似值等候選。
* 浪板、網材、門窗、板材、管材、加工品項都必須先展開同義詞、材質、規格、厚度與用途關鍵字。
口語轉換只代表候選，不代表完全匹配。厚度、材質、長度、計價單位或表面處理不明時，信心必須降低。
價格候選匹配規則
每個報價品項都要保留：
* 原始品名
* 標準化品名
* catalog family
* 搜尋關鍵字
* 價格候選品項
* 採用品項
* 採用單價
* 單價欄位
* 計價單位
* 客戶分級
* 是否完全匹配
* 差異說明
* 未採用候選原因
* 信心等級
* 價格來源
匹配等級：
1. 完全匹配：品類、材質 / 表面、尺寸、厚度、長度、計價單位與客戶分級皆一致。
2. 主要匹配：品類、尺寸、厚度大致一致，但材質、表面、長度或單位有差異。
3. 口語轉換匹配：由俗稱、錯字、英吋或外徑近似值推得。
4. 相近暫估：只有部分尺寸或品類接近。
5. 無價格：找不到合理候選或候選價格不可用。
規則：
* 完全匹配可高信心採用。
* 主要匹配、口語轉換匹配視缺漏程度標中或低信心。
* 相近暫估必須低信心。
* 無價格時，單價與金額填「未確認」。
* 價格為 0 不可當作可報價，除非 true zero rule 明確成立。
* 不可把支價改成 kg 價，不可把 kg 價改成支價，不可把片價、孔價、刀價、M 價、式價任意轉換。

切工規則
1. 切工依圖面、表格、文字註記與 quote rule 判斷。
2. 一個切口預設 1 次。
3. 對半切不修頭尾 = 中間 1 刀。
4. 修頭尾 = 頭修 1 刀 + 中間切 1 刀 + 尾修 1 刀 = 3 刀。
5. 出現「修」、「修頭」、「修頭尾」、「+修」不可只算中間切斷。
6. 斜切、切斜、翼板切斜、特殊角度、手寫不清，必須標低信心與人工複核。
7. C 型鋼預設不列一般切工，除非 C 型鋼專用規則的另計條件成立。
8. 切工費 = 切工單價 × 切工次數 × 對應數量；若有加價，依 quote rule 納入。
孔洞規則
1. 孔洞依圖面 / 表格判讀。
2. 表格若明確列孔數，優先採用表格，但仍需與圖面孔位交叉檢查。
3. 4-Ø22 通常表示每件 4 個 Ø22 孔。
4. 總孔數 = 每片 / 每支孔數 × 數量。
5. 1 個圓孔或長孔預設算 1 孔，除非 quote rule 另有規則。
6. 中心線、尺寸線、虛線、R 角、折線、切角、焊接符號不可誤判為孔。
7. C 型鋼孔洞預設只記錄，不計孔費；除非使用者或 price/rule 明確孔另計。
8. 孔數、孔徑、孔型、單價不明時，不可填 0，必須標低信心與人工複核。
開槽規則
1. 有「開槽」、「開 K 槽」、槽線、缺口加工、連續折邊槽或明確邊緣需開槽時，必須判斷開槽。
2. 開槽費看需開槽的連續邊長，不看零件總長。
3. L 型兩段相加。
4. U / ㄇ 型三段相加。
5. 多條不相連路徑分別加總。
6. 路徑不明不可當 0，必須標低信心與人工複核。
7. 開槽費 = 總開槽 M × 元 / M，單價必須來自 price/rule。
折工規則
1. 折刀數 = 板件每一次方向改變。
2. 水平轉垂直、水平轉斜面、垂直轉斜面、折返、L 型、U / ㄇ 型、Z 型都算折刀。
3. 只標一個角度不代表一刀，必須看幾次方向改變。
4. 尺寸線、中心線、孔線、外框、切角、開槽不可誤判為折線。
5. 折工費 = 總重 kg × 折刀數 × 元 / kg / 刀，或依 price/rule 指定公式。
6. 折刀位置、折數或重量不明時，標低信心與人工複核。
圖片 / PDF / OCR / 視覺判讀規則
適用於：
* 圖片
* 掃描 PDF
* 拍照圖面
* 訂單截圖
* 手寫單
* 材料表圖片
* 圖面 PDF
* 混合文字與圖片的檔案
規則：
1. 在讀文字前，必須先判斷方向。
2. 必須檢查 0 / 90 / 180 / 270 度。
3. 不可直接採信原圖 OCR。
4. 所有中文字、數字、尺寸線、頁碼、表格欄位、公司抬頭、電話、日期、材料表標題必須確認方向合理。
5. 若疑似旋轉，必須先以正確方向理解圖面，再進行 OCR 或視覺判讀。
6. 孔洞、開槽、折線、切角、尺寸以視覺判讀為主，不可只依 OCR。
7. OCR 破碎、欄位錯位、解析度低、反光、模糊、裁切、手寫遮住、方向不明、OCR 與視覺不一致，都必須標低信心。
8. 輸出需保留來源頁碼、圖片方向、品名規格、尺寸、數量、孔數、加工註記與判斷依據。
9. 圖面與材料表不一致時，依資料優先順序處理，並建立人工複核。
信心等級
高信心：
* 客戶、分級、品名、規格、材質、尺寸、厚度、長度、數量、價格、重量、計算與加工規則皆有 reviewed 來源或圖面明確來源。
* 價格完全匹配。
* 無重要推定。
中信心：
* 主要資料可確認，但有少量口語轉換、格式差異或非關鍵推定。
* 價格主要匹配但非完全一致。
* 圖面清楚但部分加工細節需備註。
低信心：
* 客戶分級不明。
* 多筆相似客戶。
* 價格無完全匹配。
* 單價、重量、厚度、材質、尺寸、長度或數量不明。
* 使用相近規格暫估。
* 圖面 / OCR 不清楚。
* 孔洞、切工、開槽、折工無法確認。
* 使用推定素材長度或配料。
* price row 空白或為 0。
* 圖面與表格不一致。',
      '{"availableTools":["lookup_catalog_families","search_customers","lookup_quote_rules","search_price_candidates","patch_quote_workbook"],"preferredOrder":["lookup_catalog_families","search_customers","lookup_quote_rules","search_price_candidates","patch_quote_workbook"],"toolUseLanguage":"zh-TW"}'::jsonb,
      '{"answerLanguage":"zh-TW","allowProvisionalQuote":true,"requiresSubtotalConsistency":true}'::jsonb,
      10,
      'high',
      'agent_default_instruction_zh_tw'
    ),
    (
      'steel-tool-flow',
      1,
      'tool_flow_rule',
      'Steel 工具使用順序',
      ARRAY['tool_flow', 'inference_order']::text[],
      NULL::text,
      '{"appliesTo":["steel_quote_runtime","steel_tools"]}'::jsonb,
      '工具順序以 AI 推論需要為準，但一般流程是：有口語品名、相似品名、錯字或品類不確定時，先呼叫 lookup_catalog_families；有客戶名稱或客戶代碼時，同一輪優先呼叫 search_customers；選定 catalog family 或候選品類後，呼叫 lookup_quote_rules 取得該品類、加工、價格、配料與計算規則；接著才呼叫 search_price_candidates。公式編號由 workbook 規則負責，不透過 lookup_quote_rules 查詢。lookup_instructions 與 lookup_defaults 不是 runtime tools；它們的內容已合併由 lookup_quote_rules 回傳。',
      '{"preferredOrder":["lookup_catalog_families","search_customers","lookup_quote_rules","search_price_candidates"],"mergedRuleTool":"lookup_quote_rules"}'::jsonb,
      '{}'::jsonb,
      20,
      'high',
      'agent_tool_flow_zh_tw'
    ),
    (
      'steel-workbook-output-policy',
      1,
      'workbook_output_rule',
      'Steel Workbook 輸出規則',
      ARRAY['workbook_output', 'output_policy']::text[],
      NULL::text,
      '{"appliesTo":["patch_quote_workbook"],"workbookSheets":["system_order","quote_details","summary","manual_review","price_sources","interpretation_notes","customer_quote"]}'::jsonb,
      '需要更新 workbook 時，只能使用 patch_quote_workbook 輸出 compact semantic quote data。每一行應帶出系統訂單、報價明細、數量、單位、單價、小計、價格來源、判讀備註、人工複核、總結與給客戶用欄位。內部價格層級、搜尋候選、成本、毛利、AI 推理細節與 raw tool output 不應出現在給客戶用 sheet。報價未被使用者確認前，workbook 與回覆都要視為 provisional；若資料不足，寫入人工複核與判讀備註，不要硬填 confirmed。',
      '{"outputTool":"patch_quote_workbook","forbiddenCustomerVisibleFields":["internalTier","rawCandidates","cost","margin","aiReasoning"]}'::jsonb,
      '{"provisionalUntilUserConfirmation":true,"customerVisibleSheet":"customer_quote"}'::jsonb,
      30,
      'high',
      'agent_workbook_output_policy_zh_tw'
    ),
    (
      'steel-subtotal-consistency-policy',
      1,
      'output_policy_rule',
      'Steel 小計總計一致規則',
      ARRAY['calculation_validation', 'workbook_output', 'output_policy']::text[],
      NULL::text,
      '{"appliesTo":["quote_details","summary"],"validation":["subtotal_sum","confirmed_total"]}'::jsonb,
      'AI 負責計算報價數字。送出 workbook patch 或最終回覆前，quote_details 的每一列 subtotal 必須能回推為該列數量、單價、長度/重量/加工條件的結果；summary.totalAmount 與 summary.confirmedAmount 必須等於所有數字型 line subtotal 的總和。沒有 reviewed 價格時不可把未知價格當 0；只有明確 true_zero_rule 或 reviewed true zero 來源時才可列為 0，並要在判讀備註說明。',
      '{}'::jsonb,
      '{"requiresSubtotalConsistency":true,"unknownPriceIsNotZero":true}'::jsonb,
      40,
      'high',
      'agent_subtotal_consistency_policy_zh_tw'
    )
)
INSERT INTO steel.agent_rules (
  slug,
  version,
  rule_type,
  title,
  locale,
  rule_sections,
  sheet_id,
  selectors,
  prompt,
  tool_policy,
  output_policy,
  priority,
  confidence,
  source_refs,
  active,
  review_state,
  created_by,
  reviewed_by,
  reviewed_at
)
SELECT
  slug,
  version,
  rule_type,
  title,
  'zh-TW',
  rule_sections,
  sheet_id,
  selectors,
  prompt,
  tool_policy,
  output_policy,
  priority,
  confidence,
  jsonb_build_array(
    jsonb_build_object(
      'channel', 'repo_docs',
      'factType', 'agent_rule',
      'sourceFile', CASE WHEN slug = 'steel-default-agent-instruction' THEN 'docs/reference/instruction.txt' ELSE 'tasks/v8.3/phase-2-data-tools.md' END,
      'locator', slug,
      'confidence', confidence,
      'canonicalKey', canonical_key
    )
  ),
  true,
  'reviewed',
  'codex',
  'codex',
  NOW()
FROM seed
ON CONFLICT (slug, version) DO UPDATE
SET
  rule_type = EXCLUDED.rule_type,
  title = EXCLUDED.title,
  locale = EXCLUDED.locale,
  rule_sections = EXCLUDED.rule_sections,
  sheet_id = EXCLUDED.sheet_id,
  selectors = EXCLUDED.selectors,
  prompt = EXCLUDED.prompt,
  tool_policy = EXCLUDED.tool_policy,
  output_policy = EXCLUDED.output_policy,
  priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence,
  source_refs = EXCLUDED.source_refs,
  active = true,
  review_state = 'reviewed',
  reviewed_by = 'codex',
  reviewed_at = NOW(),
  updated_at = NOW();

WITH seed (
  rule_type,
  catalog_family,
  product_name,
  product_names,
  aliases,
  selectors,
  prompt,
  priority,
  confidence,
  canonical_key
) AS (
  VALUES
    (
      'similar_product_name_rule',
      'angle',
      '錏角鐵',
      '["錏角鐵","錏成型角鐵","鍍鋅角鐵","黑角鐵","白鐵角鐵","角鐵"]'::jsonb,
      '["亞L","亞L30x30","L角鐵","L型鋼","L30x30","亞角鐵"]'::jsonb,
      '{"rulePurpose":"補足口語、錯字、相似品名到 catalog family 的推論","matchExamples":["亞L30x30","L30x30","錏角鐵"]}'::jsonb,
      '「亞」常是「錏」的口語或輸入變體；「L」加尺寸通常可列為角鐵/L 型鋼候選。AI 應把這些文字推到 angle catalog family 的有界候選，再依表面處理、厚度、尺寸與 price candidate 結果選擇；若錏/黑/白鐵或厚度不明，必須列候選並請使用者確認。',
      10,
      'medium',
      'catalog_angle_oral_alias_rule'
    ),
    (
      'product_name_rule',
      'c_type',
      '錏輕型鋼',
      '["錏輕型鋼","白鐵輕型鋼","黑鐵輕型鋼","輕型鋼","C型鋼"]'::jsonb,
      '["C型鋼","C鋼","C 型鋼","C型","輕型鋼"]'::jsonb,
      '{"rulePurpose":"C 型鋼口語品名轉 reviewed product-name 候選","preferredProvisionalProductName":"錏輕型鋼"}'::jsonb,
      '使用者只說 C 型鋼、C鋼、C型或輕型鋼時，catalog family 應先推為 c_type。若材質或表面處理未明，預設以「錏輕型鋼」作為 provisional price lookup 候選，並在工具回傳時同時保留白鐵、黑鐵等同規格候選供 AI 比對；不要把原始「C型鋼」直接當成最終 product_name 查價。',
      20,
      'high',
      'catalog_c_type_product_name_rule'
    ),
    (
      'product_alias_rule',
      'h_beam',
      'H型鋼',
      '["H型鋼","輕量H","輕量H型鋼"]'::jsonb,
      '["H鋼","H-BEAM","H 型鋼","H型","輕量H"]'::jsonb,
      '{"rulePurpose":"H 型鋼別名與口語品名推論","requiresSpecConfirmation":["尺寸","長度","支數"]}'::jsonb,
      'H鋼、H-BEAM、H 型鋼、H型與輕量H 都是 h_beam catalog family 候選。AI 仍必須確認尺寸、厚度、長度、支數與是否有切工、開孔、開槽等加工，再呼叫 lookup_quote_rules 取得品類、加工與計價規則；若只拿到口語品名，不可直接跳到單價。',
      20,
      'high',
      'catalog_h_beam_alias_rule'
    ),
    (
      'similar_product_name_rule',
      'grating',
      '鍍鋅格柵板',
      '["鍍鋅格柵板","白鐵格柵板","鐵格板","格板","格柵板"]'::jsonb,
      '["格柵板","格板","鐵格板","鍍鋅柵板","水溝蓋"]'::jsonb,
      '{"rulePurpose":"格柵/鐵格板口語品名推論","materialCandidates":["鍍鋅","白鐵","黑鐵"]}'::jsonb,
      '格柵板、格板、鐵格板、鍍鋅柵板與水溝蓋可推為 grating catalog family 候選。若材質、格距、尺寸、收邊或是否熱浸鍍鋅不明，AI 應列出有限候選與缺漏欄位，不能用單一品名硬套價格。',
      30,
      'medium',
      'catalog_grating_alias_rule'
    )
),
updated AS (
  UPDATE steel.catalog_family_rules target
  SET
    rule_type = seed.rule_type,
    catalog_family = seed.catalog_family,
    product_name = seed.product_name,
    product_names = seed.product_names,
    aliases = seed.aliases,
    selectors = seed.selectors,
    prompt = seed.prompt,
    priority = seed.priority,
    confidence = seed.confidence,
    source_refs = jsonb_build_array(
      jsonb_build_object(
        'channel', 'repo_docs',
        'factType', 'catalog_family_rule',
        'sourceFile', 'CONTEXT.md',
        'locator', seed.catalog_family,
        'confidence', seed.confidence,
        'canonicalKey', seed.canonical_key
      )
    ),
    active = true,
    review_state = 'reviewed',
    reviewed_by = 'codex',
    reviewed_at = NOW(),
    updated_at = NOW()
  FROM seed
  WHERE target.source_refs @> jsonb_build_array(jsonb_build_object('canonicalKey', seed.canonical_key))
  RETURNING target.id
)
INSERT INTO steel.catalog_family_rules (
  rule_type,
  catalog_family,
  product_name,
  product_names,
  aliases,
  selectors,
  prompt,
  priority,
  confidence,
  source_refs,
  active,
  review_state,
  created_by,
  reviewed_by,
  reviewed_at
)
SELECT
  seed.rule_type,
  seed.catalog_family,
  seed.product_name,
  seed.product_names,
  seed.aliases,
  seed.selectors,
  seed.prompt,
  seed.priority,
  seed.confidence,
  jsonb_build_array(
    jsonb_build_object(
      'channel', 'repo_docs',
      'factType', 'catalog_family_rule',
      'sourceFile', 'CONTEXT.md',
      'locator', seed.catalog_family,
      'confidence', seed.confidence,
      'canonicalKey', seed.canonical_key
    )
  ),
  true,
  'reviewed',
  'codex',
  'codex',
  NOW()
FROM seed
WHERE EXISTS (
  SELECT 1
  FROM steel.catalog_families families
  WHERE families.key = seed.catalog_family
)
AND NOT EXISTS (
  SELECT 1
  FROM steel.catalog_family_rules target
  WHERE target.source_refs @> jsonb_build_array(jsonb_build_object('canonicalKey', seed.canonical_key))
);

WITH seed (
  rule_type,
  scope_type,
  catalog_family,
  product_family,
  charge_type,
  formula_code,
  selectors,
  parameters,
  prompt,
  priority,
  confidence,
  canonical_key
) AS (
  VALUES
    (
      'pricing_rule',
      'company',
      NULL::text,
      NULL::text,
      'material',
      NULL::text,
      '{"rulePurpose":"全公司材料價格來源優先序"}'::jsonb,
      '[]'::jsonb,
      '材料與加工報價必須優先使用 search_price_candidates 回傳的 reviewed 候選價格。空白、缺價或 0 價格不可自動視為免費；只有 reviewed true zero 或明確 true_zero_rule 才能當 0。使用者在本次對話指定的單價可作為 quote-specific adjustment，但要在價格來源或判讀備註標示。',
      10,
      'high',
      'quote_company_price_source_priority'
    ),
    (
      'calculation_rule',
      'company',
      NULL::text,
      NULL::text,
      'material',
      NULL::text,
      '{"rulePurpose":"材料小計計算通則"}'::jsonb,
      '[]'::jsonb,
      '若價格列單位是 kg，且產品重量單位是 kg_per_m，AI 應以「每米重量 x 長度米數 x 單價 x 數量」計算材料小計；若價格列單位是 piece 或 支，單價通常已是單支價格，除非 reviewed 規則另有說明。括號或品名中的重量只能在 reviewed 單重缺漏時作為 fallback，並要標示為待確認。',
      20,
      'high',
      'quote_company_material_weight_calculation'
    ),
    (
      'pricing_rule',
      'catalog_family',
      'c_type',
      NULL::text,
      'material',
      'C',
      '{"rulePurpose":"C 型鋼材料查價策略","preferredProvisionalProductName":"錏輕型鋼"}'::jsonb,
      '[]'::jsonb,
      'C 型鋼仍必須查 reviewed product-price row。若材質未指定，先以「錏輕型鋼」作為 provisional 候選，同規格若有白鐵、黑鐵或其他表面處理候選，應列給 AI 比對或請使用者確認。不要用 productNames 裡的「C型鋼」當成最終查價鍵。',
      10,
      'high',
      'quote_c_type_material_lookup_strategy'
    ),
    (
      'true_zero_rule',
      'catalog_family',
      'c_type',
      NULL::text,
      'cutting',
      'C',
      '{"rulePurpose":"C 型鋼切工預設 true zero"}'::jsonb,
      '[]'::jsonb,
      'C 型鋼一般切工預設不另計價。AI 可在 workbook 判讀備註說明切工未另計，但不要建立額外切工收費列，除非 reviewed 規則、客戶規則或使用者明確要求切工計價。',
      15,
      'high',
      'quote_c_type_cutting_true_zero'
    ),
    (
      'true_zero_rule',
      'catalog_family',
      'c_type',
      NULL::text,
      'hole',
      'C',
      '{"rulePurpose":"C 型鋼孔費預設 true zero"}'::jsonb,
      '[]'::jsonb,
      'C 型鋼孔費預設不另計價。這只代表一般孔費為 0，不代表特殊加工、材料或其他費用免費；若孔徑、長孔、開槽或特殊加工超出一般規則，AI 應查 quote rules 或請使用者確認。',
      16,
      'high',
      'quote_c_type_hole_true_zero'
    ),
    (
      'pricing_rule',
      'catalog_family',
      'h_beam',
      NULL::text,
      'material',
      'H',
      '{"rulePurpose":"H 型鋼非標長度加價規則","regularLengthsM":[6,9,10,12],"nonStandardLengthsM":[7,8,11,13,14,15]}'::jsonb,
      '[]'::jsonb,
      'H 型鋼常規長度為 6M、9M、10M、12M。7M、8M、11M、13M、14M、15M 等非常規長度，通常在 kg 單價加 0.3 元/kg；但若 exact reviewed price row 已經包含該長度或特殊單價，不可重複加價。',
      20,
      'high',
      'quote_h_beam_nonstandard_length_markup'
    ),
    (
      'pricing_rule',
      'catalog_family',
      'h_beam',
      NULL::text,
      'cutting',
      'H',
      '{"rulePurpose":"H 型鋼切工查價策略","requiresReviewedRows":["cutting","slotting","hole"]}'::jsonb,
      '[]'::jsonb,
      'H 型鋼切工、開槽、孔、斜切與頭尾修整必須優先查 reviewed 加工價格列。若圖面或文字只描述加工但沒有數量、孔徑、長度或每支次數，AI 不可自行補完；要列出缺漏欄位並請使用者確認。',
      30,
      'high',
      'quote_h_beam_processing_lookup_strategy'
    ),
    (
      'order_format_rule',
      'company',
      NULL::text,
      NULL::text,
      'processing',
      NULL::text,
      '{"rulePurpose":"圖面與表格加工數量判讀"}'::jsonb,
      '[]'::jsonb,
      '孔、長孔、開槽、折工與切工數量應先以訂單表格或圖面標註為準，再交叉檢查文字描述。4-Ø22 通常表示每件 4 個 Ø22 孔；若同一圖面有件數、左右對稱、每支或每組語意，AI 必須明確換算到每列數量，無法確認時列人工複核。',
      50,
      'medium',
      'quote_company_drawing_processing_detection'
    )
),
updated AS (
  UPDATE steel.quote_rules target
  SET
    rule_type = seed.rule_type,
    scope_type = seed.scope_type,
    catalog_family = seed.catalog_family,
    product_family = seed.product_family,
    charge_type = seed.charge_type,
    formula_code = seed.formula_code,
    selectors = seed.selectors,
    parameters = seed.parameters,
    prompt = seed.prompt,
    priority = seed.priority,
    confidence = seed.confidence,
    source_refs = jsonb_build_array(
      jsonb_build_object(
        'channel', 'repo_docs',
        'factType', 'quote_rule',
        'sourceFile', 'CONTEXT.md',
        'locator', COALESCE(seed.catalog_family, seed.scope_type),
        'confidence', seed.confidence,
        'canonicalKey', seed.canonical_key
      )
    ),
    active = true,
    review_state = 'reviewed',
    reviewed_by = 'codex',
    reviewed_at = NOW(),
    updated_at = NOW()
  FROM seed
  WHERE target.source_refs @> jsonb_build_array(jsonb_build_object('canonicalKey', seed.canonical_key))
  RETURNING target.id
)
INSERT INTO steel.quote_rules (
  rule_type,
  scope_type,
  catalog_family,
  product_family,
  charge_type,
  formula_code,
  selectors,
  parameters,
  prompt,
  priority,
  confidence,
  source_refs,
  active,
  review_state,
  created_by,
  reviewed_by,
  reviewed_at
)
SELECT
  seed.rule_type,
  seed.scope_type,
  seed.catalog_family,
  seed.product_family,
  seed.charge_type,
  seed.formula_code,
  seed.selectors,
  seed.parameters,
  seed.prompt,
  seed.priority,
  seed.confidence,
  jsonb_build_array(
    jsonb_build_object(
      'channel', 'repo_docs',
      'factType', 'quote_rule',
      'sourceFile', 'CONTEXT.md',
      'locator', COALESCE(seed.catalog_family, seed.scope_type),
      'confidence', seed.confidence,
      'canonicalKey', seed.canonical_key
    )
  ),
  true,
  'reviewed',
  'codex',
  'codex',
  NOW()
FROM seed
WHERE (
  seed.catalog_family IS NULL
  OR EXISTS (
    SELECT 1
    FROM steel.catalog_families families
    WHERE families.key = seed.catalog_family
  )
)
AND NOT EXISTS (
  SELECT 1
  FROM steel.quote_rules target
  WHERE target.source_refs @> jsonb_build_array(jsonb_build_object('canonicalKey', seed.canonical_key))
);

WITH seed (
  rule_type,
  customer_id,
  catalog_family,
  product_family,
  charge_type,
  formula_code,
  selectors,
  parameters,
  prompt,
  priority,
  confidence,
  canonical_key
) AS (
  VALUES
    (
      'customer_processing_rule',
      2269::bigint,
      'h_beam',
      NULL::text,
      'cutting',
      NULL::text,
      '{"rulePurpose":"客戶 H 型鋼切工不另計","customerDisplayName":"龍頂蓋廠房"}'::jsonb,
      '[]'::jsonb,
      '龍頂蓋廠房的 H 型鋼一般切工不另計價，但仍須在系統訂單或判讀備註說明「切工未另計」。若需求包含特殊斜切、開槽、孔、頭尾修整，或客戶不是龍頂蓋廠房，AI 不可套用此規則，必須查加工規則或列待確認。',
      10,
      'high',
      'customer_2269_h_beam_cutting_no_charge'
    )
),
updated AS (
  UPDATE steel.customer_rules target
  SET
    rule_type = seed.rule_type,
    customer_id = seed.customer_id,
    customer_tier_id = customers.customer_tier_id,
    catalog_family = seed.catalog_family,
    product_family = seed.product_family,
    charge_type = seed.charge_type,
    formula_code = seed.formula_code,
    selectors = seed.selectors,
    parameters = seed.parameters,
    prompt = seed.prompt,
    priority = seed.priority,
    confidence = seed.confidence,
    source_refs = jsonb_build_array(
      jsonb_build_object(
        'channel', 'repo_docs',
        'factType', 'customer_rule',
        'sourceFile', 'CONTEXT.md',
        'locator', 'steel.customers:' || seed.customer_id::text,
        'confidence', seed.confidence,
        'canonicalKey', seed.canonical_key
      )
    ),
    active = true,
    review_state = 'reviewed',
    reviewed_by = 'codex',
    reviewed_at = NOW(),
    updated_at = NOW()
  FROM seed
  JOIN steel.customers customers ON customers.id = seed.customer_id
  WHERE target.source_refs @> jsonb_build_array(jsonb_build_object('canonicalKey', seed.canonical_key))
  RETURNING target.id
)
INSERT INTO steel.customer_rules (
  rule_type,
  customer_id,
  customer_tier_id,
  catalog_family,
  product_family,
  charge_type,
  formula_code,
  selectors,
  parameters,
  prompt,
  priority,
  confidence,
  source_refs,
  active,
  review_state,
  created_by,
  reviewed_by,
  reviewed_at
)
SELECT
  seed.rule_type,
  seed.customer_id,
  customers.customer_tier_id,
  seed.catalog_family,
  seed.product_family,
  seed.charge_type,
  seed.formula_code,
  seed.selectors,
  seed.parameters,
  seed.prompt,
  seed.priority,
  seed.confidence,
  jsonb_build_array(
    jsonb_build_object(
      'channel', 'repo_docs',
      'factType', 'customer_rule',
      'sourceFile', 'CONTEXT.md',
      'locator', 'steel.customers:' || seed.customer_id::text,
      'confidence', seed.confidence,
      'canonicalKey', seed.canonical_key
    )
  ),
  true,
  'reviewed',
  'codex',
  'codex',
  NOW()
FROM seed
JOIN steel.customers customers ON customers.id = seed.customer_id
WHERE (
  seed.catalog_family IS NULL
  OR EXISTS (
    SELECT 1
    FROM steel.catalog_families families
    WHERE families.key = seed.catalog_family
  )
)
AND NOT EXISTS (
  SELECT 1
  FROM steel.customer_rules target
  WHERE target.source_refs @> jsonb_build_array(jsonb_build_object('canonicalKey', seed.canonical_key))
);
