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
    'Reviewed OCR rules loaded from steel.agent_rules:',
    reviewedRule,
    '',
    'User request:',
    userInstruction.trim() || '(no additional user instruction)',
  ].join('\n');
}
