ALTER TABLE steel.cutting_prices
  ADD COLUMN spec_selector JSONB;

ALTER TABLE steel.cutting_prices
  ADD CONSTRAINT cutting_prices_spec_selector_check
  CHECK (
    spec_selector IS NULL
    OR (
      jsonb_typeof(spec_selector) = 'object'
      AND spec_selector->>'version' = '1'
      AND (
        (
          spec_selector->>'match' = 'any'
          AND jsonb_typeof(spec_selector->'selectors') = 'array'
          AND jsonb_array_length(spec_selector->'selectors') > 0
        )
        OR (
          spec_selector->>'match' = 'manual_review'
          AND spec_selector->>'reason' = 'supplement_rule_not_structured'
        )
      )
    )
  );
