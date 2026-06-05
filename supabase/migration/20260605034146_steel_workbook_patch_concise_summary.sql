BEGIN;

UPDATE steel.instruction_packets
SET
  instruction = CASE
    WHEN instruction LIKE '%訂單資訊與 workbook 改動重點%'
      THEN instruction
    ELSE instruction || ' patch_workbook 成功後，chat 回覆只需簡短說明訂單資訊與 workbook 改動重點；不要列逐欄 diff、長搜尋關鍵字或長候選品項。'
  END,
  blocking_rules = CASE
    WHEN 'patch_workbook 成功後不要列逐欄 diff、長搜尋關鍵字或長候選品項；只回訂單資訊與改動重點。' = ANY(blocking_rules)
      THEN blocking_rules
    ELSE array_append(
      blocking_rules,
      'patch_workbook 成功後不要列逐欄 diff、長搜尋關鍵字或長候選品項；只回訂單資訊與改動重點。'
    )
  END,
  user_visible_notes = CASE
    WHEN 'workbook 更新回覆只需要訂單資訊與改動重點，不需要逐欄明細。' = ANY(user_visible_notes)
      THEN user_visible_notes
    ELSE array_append(
      user_visible_notes,
      'workbook 更新回覆只需要訂單資訊與改動重點，不需要逐欄明細。'
    )
  END,
  updated_at = NOW()
WHERE slug = 'c-type-basic-quote-zh-v1'
  AND version = 1;

COMMIT;
