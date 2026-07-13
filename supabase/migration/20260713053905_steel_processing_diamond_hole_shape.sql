ALTER TABLE steel.prices DROP CONSTRAINT IF EXISTS prices_processing_shape_check;

ALTER TABLE steel.prices
  ADD CONSTRAINT prices_processing_shape_check CHECK (
    processing_shape IS NULL
    OR processing_shape IN (
      '外形切割', '直線切割', '圓孔', '方孔', '菱形孔', '長孔', '橢圓孔', '其他'
    )
  );
