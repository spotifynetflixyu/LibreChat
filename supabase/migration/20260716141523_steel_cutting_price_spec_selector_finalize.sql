DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM steel.cutting_prices
    WHERE spec_selector IS NULL
  ) THEN
    ALTER TABLE steel.cutting_prices
      ALTER COLUMN spec_selector SET NOT NULL;
  END IF;
END
$$;
