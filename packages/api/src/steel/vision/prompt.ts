export interface BuildDrawingEvidencePromptInput {
  ocrAgentRuleInstruction: string;
  userInstruction: string;
}

export function buildDrawingEvidencePrompt({
  ocrAgentRuleInstruction,
  userInstruction,
}: BuildDrawingEvidencePromptInput) {
  const reviewedRule = ocrAgentRuleInstruction.trim();

  if (!reviewedRule) {
    throw new Error('reviewed OCR agent rule instruction is required');
  }

  return [
    'OCR extraction instructions:',
    reviewedRule,
    '',
    'User request:',
    userInstruction.trim() || '(no additional user instruction)',
  ].join('\n');
}
