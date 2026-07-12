ALTER TABLE steel.prices
  DROP CONSTRAINT IF EXISTS prices_source_dataset_check,
  DROP CONSTRAINT IF EXISTS prices_category_check;

ALTER TABLE steel.prices
  ADD CONSTRAINT prices_source_dataset_check
  CHECK (source_dataset = 'product_price_v4_3'),
  ADD CONSTRAINT prices_category_check
  CHECK (category IN (
    'C型鋼', 'H型鋼', 'I型鋼/工字鐵', 'T型鋼', '鐵板', '平鐵', '角鐵',
    '圓條', '鋼筋', '圓管', '方鐵', '方管', '扁方管', '網', '格板/隔板',
    '板/浪板', '鐵軌', '槽鐵', '捲門/伸縮門', '門窗/門板', '五金/配件',
    '加工/孔', '加工/切工', '加工/折工', '加工/其他', '加工/開槽', '其他'
  ));
