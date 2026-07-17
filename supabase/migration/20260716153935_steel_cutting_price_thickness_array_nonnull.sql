ALTER TABLE steel.cutting_prices
  ADD CONSTRAINT cutting_prices_thickness_array_nonnull_check
  CHECK (
    thickness_mm_values IS NULL
    OR array_position(thickness_mm_values, NULL) IS NULL
  );
