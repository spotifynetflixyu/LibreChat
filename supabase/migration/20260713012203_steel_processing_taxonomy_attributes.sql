ALTER TABLE steel.prices
  ADD COLUMN IF NOT EXISTS processing_method TEXT,
  ADD COLUMN IF NOT EXISTS processing_shape TEXT;

ALTER TABLE steel.prices DROP CONSTRAINT IF EXISTS prices_category_check;
ALTER TABLE steel.prices DROP CONSTRAINT IF EXISTS prices_processing_method_check;
ALTER TABLE steel.prices DROP CONSTRAINT IF EXISTS prices_processing_shape_check;
ALTER TABLE steel.prices DROP CONSTRAINT IF EXISTS prices_processing_attributes_category_check;

ALTER TABLE steel.prices
  ADD CONSTRAINT prices_category_check CHECK (category IN (
    'C型鋼', 'H型鋼', 'I型鋼/工字鐵', 'T型鋼', '鐵板', '平鐵', '角鐵',
    '圓條', '鋼筋', '圓管', '方鐵', '方管', '扁方管', '網', '格板/隔板', '板/浪板',
    '鐵軌', '槽鐵', '捲門/伸縮門', '門窗/門板', '五金/配件', '加工/孔',
    '加工/切工', '加工/倒角', '加工/開槽', '加工/折工', '加工/焊接',
    '加工/其他', '其他'
  )),
  ADD CONSTRAINT prices_processing_method_check CHECK (
    processing_method IS NULL
    OR processing_method IN ('剪床', '雷射', '鋸床', '水刀', '火', '沖床', '鑽床')
  ),
  ADD CONSTRAINT prices_processing_shape_check CHECK (
    processing_shape IS NULL
    OR processing_shape IN ('外形切割', '直線切割', '圓孔', '方孔', '長孔', '橢圓孔', '其他')
  ),
  ADD CONSTRAINT prices_processing_attributes_category_check CHECK (
    category LIKE '加工/%'
    OR (processing_method IS NULL AND processing_shape IS NULL)
  );
