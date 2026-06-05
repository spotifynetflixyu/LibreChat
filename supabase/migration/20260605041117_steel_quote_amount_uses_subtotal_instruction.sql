BEGIN;

WITH normalized AS (
  SELECT
    id,
    replace(
      instruction,
      ' workbook 報價明細的可見報價金額欄位是 報價（internal key material_fee）；報價明細不另保留與報價重複的小計欄位。quick price 或客戶/分級更新後若可計算新金額，必須 patch 報價並在 chat 回覆新報價。',
      ''
    ) AS instruction,
    array_remove(
      blocking_rules,
      '報價明細不要使用小計/subtotal 作為報價金額；使用 報價/material_fee，且客戶/分級更新後要更新並回覆新報價。'
    ) AS blocking_rules,
    array_remove(
      user_visible_notes,
      '報價明細只顯示 報價，不另列重複的小計；客戶/分級變更時同步更新報價。'
    ) AS user_visible_notes
  FROM steel.instruction_packets
  WHERE slug = 'c-type-basic-quote-zh-v1'
    AND version = 1
)
UPDATE steel.instruction_packets AS packet
SET
  instruction = CASE
    WHEN normalized.instruction LIKE '%小計（internal key subtotal）%' THEN normalized.instruction
    ELSE normalized.instruction || ' workbook 報價明細的可見報價金額欄位統一使用 小計（internal key subtotal）；不要另加與小計重複的可見報價欄位。quick price 或客戶/分級更新後若可計算新金額，必須 patch 小計並在 chat 回覆新小計。'
  END,
  blocking_rules = CASE
    WHEN '報價明細不要新增或使用可見 報價 欄位；報價金額統一使用 小計/subtotal，且客戶/分級更新後要更新並回覆新小計。' = ANY(normalized.blocking_rules)
      THEN normalized.blocking_rules
    ELSE array_append(
      normalized.blocking_rules,
      '報價明細不要新增或使用可見 報價 欄位；報價金額統一使用 小計/subtotal，且客戶/分級更新後要更新並回覆新小計。'
    )
  END,
  user_visible_notes = CASE
    WHEN '報價明細的報價金額統一叫 小計；客戶/分級變更時同步更新小計。' = ANY(normalized.user_visible_notes)
      THEN normalized.user_visible_notes
    ELSE array_append(
      normalized.user_visible_notes,
      '報價明細的報價金額統一叫 小計；客戶/分級變更時同步更新小計。'
    )
  END,
  updated_at = NOW()
FROM normalized
WHERE packet.id = normalized.id;

COMMIT;
