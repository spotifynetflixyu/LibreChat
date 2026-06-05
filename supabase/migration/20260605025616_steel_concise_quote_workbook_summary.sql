BEGIN;

UPDATE steel.instruction_packets
SET
  instruction = 'C 型鋼仍必須先查 reviewed product-price rows，不可只用重量推價。C 型鋼口語品名通常對應產品價格列的輕型鋼品名；例如 C型鋼 100x50x20 2.3t 應以 catalogFamilies: [c_type] 搭配 100x2.3 等尺寸/厚度片段查價。材質不明時，AI 可以先塞 productName: 錏輕型鋼 作為通常情況的高信心候選；第一輪回覆必須列出同規格不同材質的 reviewed bounded options（例如白鐵輕型鋼、黑鐵輕型鋼）供確認，第二輪若用戶未指定其他材質/表面，視為確認預設錏輕型鋼。未指定客戶或找不到客戶價格等級時，查價自動使用全域預設 B 價分級 customerTierId 2；回覆只需簡短提醒目前用價格B，例如 目前用 價格B：26.8 元/kg，並另外提醒提供客戶名稱可再查該客戶報價；不要加最高/最貴說明。快速報價若已顯示整支總重，例如 6M 一支重量：4 × 6 = 24 kg，不要再另列單位重 bullet。若 search_customers 找到可用客戶分級，後續查價改用該客戶分級，不要用 B 預設價覆蓋。patch_workbook 成功後，chat 回覆必須簡短說明本輪新增資訊與 workbook 改動重點，不可只回已更新 workbook：N 個欄位。C 型鋼切工與孔費預設免費，可列為 true-zero/no-charge；這不代表材料單價、特殊加工或非 C 型鋼加工免費。',
  blocking_rules = ARRAY[
    '不要把 C型鋼 當作 productName filter 卡死價格查詢；已選 c_type 時，優先用尺寸/厚度 spec fragments 查 reviewed price rows。',
    '不要在 customer/tier 未知時把 customerTierId 設為 A/tier 1；查價必須使用全域預設 B 價分級 customerTierId 2。',
    '不要在 B 價提醒中加最高/最貴說明；只需簡短說明目前用價格B，並提醒提供客戶名稱可再查客戶報價。',
    '不要在快速報價已顯示整支總重時，另列單位重 bullet。',
    '不要在 search_customers 找到可用客戶分級時，仍用 B 預設價覆蓋該客戶分級。',
    '不要在 patch_workbook 成功後只回 workbook 更新欄位數，必須說明新增資訊與改動重點。',
    '不要在材質不明的第一輪只顯示錏輕型鋼，省略同規格其他材質候選。',
    '不要把 C 型鋼切工/孔費免費規則套用到材料單價、特殊加工或非 C 型鋼品項。',
    '不要把 C 型鋼套用一般長條料 6M 配料、餘料與一般切工邏輯。'
  ]::text[],
  user_visible_notes = ARRAY[
    '材質不明時，錏輕型鋼可作高信心暫估候選；第一輪需列出同規格其他材質選項。',
    '未指定客戶或找不到客戶價格等級時，查價使用全域預設 B 價 customerTierId 2；回覆簡短提醒目前用價格B，提供客戶名稱後可再查該客戶報價，不要加最高/最貴說明。',
    '快速報價若已顯示整支總重，不要再另列單位重；有總重即可。',
    '若查到可用客戶分級，改用該客戶分級報價，不要使用 B 預設價覆蓋。',
    'workbook 更新後，chat 回覆要說明本輪新增資訊與改動重點，不要只說更新幾個欄位。',
    'C 型鋼切工與孔費預設免費只適用 C 型鋼一般情境，不代表材料或特殊加工免費。'
  ]::text[],
  confirmation_questions = ARRAY[
    '請確認材質是否為錏輕型鋼；若下一輪未指定其他材質，視為確認預設錏輕型鋼。'
  ]::text[],
  updated_at = NOW()
WHERE slug = 'c-type-basic-quote-zh-v1'
  AND version = 1;

COMMIT;
