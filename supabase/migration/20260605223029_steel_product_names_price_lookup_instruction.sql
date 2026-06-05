BEGIN;

UPDATE steel.instruction_packets
SET
  instruction = replace(
    replace(
      replace(
        replace(
          instruction,
          '材質不明時，AI 可以先塞 productName: 錏輕型鋼 作為通常情況的高信心候選',
          '材質不明時，AI 使用 productNames: [錏輕型鋼] 作為通常情況的高信心候選'
        ),
        '材質不明時，AI 可以先塞 productName 錏輕型鋼 作為通常情況的高信心候選',
        '材質不明時，AI 使用 productNames [錏輕型鋼] 作為通常情況的高信心候選'
      ),
      '，且同一個 search_price_candidates 呼叫不要再送 productName',
      ''
    ),
    '且同一個 search_price_candidates 呼叫不要再送 productName；',
    ''
  ),
  blocking_rules = (
    SELECT COALESCE(array_agg(rule ORDER BY ord), '{}'::text[])
    FROM (
      SELECT
        ord,
        CASE
          WHEN rule = '不要把 C型鋼 當作 productName filter 卡死價格查詢。'
            THEN '不要把 C型鋼 當作 productNames 候選卡死價格查詢。'
          ELSE replace(rule, 'productName filter', 'productNames 候選')
        END AS rule
      FROM unnest(blocking_rules) WITH ORDINALITY AS entry(rule, ord)
      WHERE rule <> '使用 productNames 時，不要在同一個 search_price_candidates 呼叫同時送 productName。'
    ) AS normalized_rules
  ),
  user_visible_notes = CASE
    WHEN 'C 型鋼材質不明時，查價使用 productNames: [錏輕型鋼] 作為預設候選。' = ANY(user_visible_notes)
      THEN user_visible_notes
    ELSE array_append(
      user_visible_notes,
      'C 型鋼材質不明時，查價使用 productNames: [錏輕型鋼] 作為預設候選。'
    )
  END,
  updated_at = NOW()
WHERE slug = 'c-type-basic-quote-zh-v1'
  AND version = 1;

COMMIT;
