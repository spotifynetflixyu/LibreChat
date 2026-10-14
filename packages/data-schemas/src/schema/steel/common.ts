export const steelWorkingOrderMemoryKindEnum = [
  'working_order_row',
  'customer_fact',
  'price_evidence',
  'rule_evidence',
  'ocr_extract',
  'paddleocr_preflight',
  'calculation_fact',
] as const;
export const steelWorkingOrderMemorySourceKindEnum = [
  'assistant_final_markdown',
  'tool_result',
  'ocr_result',
  'user_input',
] as const;
export const steelWorkingOrderMemoryStateEnum = ['active', 'superseded'] as const;
