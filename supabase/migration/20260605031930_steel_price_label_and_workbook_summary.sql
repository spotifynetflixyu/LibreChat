BEGIN;

UPDATE steel.instruction_packets
SET
  instruction = CASE
    WHEN instruction LIKE '%reviewed 價格%' THEN instruction
    ELSE instruction || ' 對使用者顯示價格 bullet 時，用 價格：<單價>，不要寫 reviewed 價格：<單價>；reviewed/source 狀態放在來源或備註即可。'
  END,
  blocking_rules = CASE
    WHEN '不要用 reviewed 價格 作為使用者可見價格 bullet 標籤；用 價格，reviewed/source 狀態放來源或備註。' = ANY(blocking_rules)
      THEN blocking_rules
    ELSE array_append(
      blocking_rules,
      '不要用 reviewed 價格 作為使用者可見價格 bullet 標籤；用 價格，reviewed/source 狀態放來源或備註。'
    )
  END,
  user_visible_notes = CASE
    WHEN '價格 bullet 用 價格，不要寫 reviewed 價格；來源狀態另列。' = ANY(user_visible_notes)
      THEN user_visible_notes
    ELSE array_append(
      user_visible_notes,
      '價格 bullet 用 價格，不要寫 reviewed 價格；來源狀態另列。'
    )
  END,
  updated_at = NOW()
WHERE slug = 'c-type-basic-quote-zh-v1'
  AND version = 1;

COMMIT;
