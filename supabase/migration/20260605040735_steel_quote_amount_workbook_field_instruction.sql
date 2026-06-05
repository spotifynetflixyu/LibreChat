BEGIN;

UPDATE steel.instruction_packets
SET
  instruction = CASE
    WHEN instruction LIKE '%報價明細不另保留與報價重複的小計欄位%' THEN instruction
    ELSE instruction || ' workbook 報價明細的可見報價金額欄位是 報價（internal key material_fee）；報價明細不另保留與報價重複的小計欄位。quick price 或客戶/分級更新後若可計算新金額，必須 patch 報價並在 chat 回覆新報價。'
  END,
  blocking_rules = CASE
    WHEN '報價明細不要使用小計/subtotal 作為報價金額；使用 報價/material_fee，且客戶/分級更新後要更新並回覆新報價。' = ANY(blocking_rules)
      THEN blocking_rules
    ELSE array_append(
      blocking_rules,
      '報價明細不要使用小計/subtotal 作為報價金額；使用 報價/material_fee，且客戶/分級更新後要更新並回覆新報價。'
    )
  END,
  user_visible_notes = CASE
    WHEN '報價明細只顯示 報價，不另列重複的小計；客戶/分級變更時同步更新報價。' = ANY(user_visible_notes)
      THEN user_visible_notes
    ELSE array_append(
      user_visible_notes,
      '報價明細只顯示 報價，不另列重複的小計；客戶/分級變更時同步更新報價。'
    )
  END,
  updated_at = NOW()
WHERE slug = 'c-type-basic-quote-zh-v1'
  AND version = 1;

COMMIT;
