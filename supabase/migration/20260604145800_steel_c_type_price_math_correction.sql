BEGIN;

UPDATE steel.instruction_packets
SET
  instruction = replace(instruction, 'NT$150-160.8', 'NT$600-643.2'),
  updated_at = NOW()
WHERE slug = 'product-price-unit-weight-calculation-zh-v1'
  AND version = 1
  AND instruction LIKE '%NT$150-160.8%';

COMMIT;
