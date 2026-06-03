BEGIN;

SET search_path = steel, public;

INSERT INTO steel.quote_defaults (
  default_type,
  origin_table,
  origin_id,
  origin_revision,
  scope_type,
  material_family,
  charge_type,
  formula_code,
  selector,
  effect,
  default_parameters,
  priority,
  confidence,
  source_refs,
  active,
  review_state
)
SELECT
  'true_zero_rule',
  'tasks/steel-data-rules-architecture/instruction-packets.md',
  'c-type-free-cutting-hole-v1',
  '1',
  'material_family',
  'c_type',
  NULL,
  'C',
  '{
    "materialFamily": "c_type",
    "chargeTypes": ["cutting", "hole"]
  }'::jsonb,
  'true_zero_rule',
  '[
    {
      "parameterKey": "instruction",
      "valueType": "text",
      "value": "C 型鋼切工與孔費預設免費"
    },
    {
      "parameterKey": "skipRemainderCalculation",
      "valueType": "boolean",
      "value": true
    }
  ]'::jsonb,
  10,
  'high',
  '[
    {
      "channel": "repo_docs",
      "factType": "quote_default",
      "sourceFile": "tasks/steel-data-rules-architecture/instruction-packets.md",
      "locator": "c-type-basic-quote-zh-v1",
      "canonicalKey": "c_type_free_cutting_hole"
    }
  ]'::jsonb,
  true,
  'reviewed'
WHERE NOT EXISTS (
  SELECT 1
  FROM steel.quote_defaults
  WHERE origin_table = 'tasks/steel-data-rules-architecture/instruction-packets.md'
    AND origin_id = 'c-type-free-cutting-hole-v1'
    AND review_state = 'reviewed'
);

COMMIT;
