BEGIN;

UPDATE steel.instruction_packets
SET
  instruction = 'C 型鋼仍必須先查 reviewed product-price rows，不可只用重量推價。C 型鋼口語品名通常對應產品價格列的輕型鋼品名；例如 C型鋼 100x50x20 2.3t 應以 catalogFamilies: [c_type] 搭配 100x2.3 等尺寸/厚度片段查價。材質不明時，AI 可以先塞 productName: 錏輕型鋼 作為通常情況的高信心候選；第一輪回覆必須列出同規格不同材質的 reviewed bounded options（例如白鐵輕型鋼、黑鐵輕型鋼）供確認，第二輪若用戶未指定其他材質/表面，視為確認預設錏輕型鋼。未指定客戶/分級時，查價自動使用全域預設 B 價分級 customerTierId 2；回覆需標示 B 價為暫估預設，若之後指定客戶或分級則改用該客戶/分級。C 型鋼切工與孔費預設免費，可列為 true-zero/no-charge；這不代表材料單價、特殊加工或非 C 型鋼加工免費。',
  blocking_rules = ARRAY[
    '不要把 C型鋼 當作 productName filter 卡死價格查詢；已選 c_type 時，優先用尺寸/厚度 spec fragments 查 reviewed price rows。',
    '不要在 customer/tier 未知時把 customerTierId 設為 A/tier 1；查價必須使用全域預設 B 價分級 customerTierId 2。',
    '不要在材質不明的第一輪只顯示錏輕型鋼，省略同規格其他材質候選。',
    '不要把 C 型鋼切工/孔費免費規則套用到材料單價、特殊加工或非 C 型鋼品項。',
    '不要把 C 型鋼套用一般長條料 6M 配料、餘料與一般切工邏輯。'
  ]::text[],
  user_visible_notes = ARRAY[
    '材質不明時，錏輕型鋼可作高信心暫估候選；第一輪需列出同規格其他材質選項。',
    '未指定分級時，查價使用全域預設 B 價 customerTierId 2；若之後指定客戶或分級，再改用該客戶/分級。',
    'C 型鋼切工與孔費預設免費只適用 C 型鋼一般情境，不代表材料或特殊加工免費。'
  ]::text[],
  confirmation_questions = ARRAY[
    '請確認材質是否為錏輕型鋼；若下一輪未指定其他材質，視為確認預設錏輕型鋼。'
  ]::text[],
  updated_at = NOW()
WHERE slug = 'c-type-basic-quote-zh-v1'
  AND version = 1;

COMMIT;
