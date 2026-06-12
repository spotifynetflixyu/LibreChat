import { buildDrawingEvidencePrompt } from './prompt';

describe('Steel drawing evidence prompt builder', () => {
  it('builds the prompt from DB-loaded OCR rules and the user request only', () => {
    const ocrAgentRuleInstruction =
      'DB_OCR_RULE_SENTINEL 請先做局部裁切、方向確認、欄位對齊與視覺交叉檢查。';
    const userInstruction = '請判讀這張圖面有哪些資訊。';

    const prompt = buildDrawingEvidencePrompt({
      ocrAgentRuleInstruction,
      userInstruction,
    });

    expect(prompt).toBe(
      [
        'Reviewed OCR rules loaded from steel.agent_rules:',
        ocrAgentRuleInstruction,
        '',
        'User request:',
        userInstruction,
      ].join('\n'),
    );
  });

  it('requires reviewed OCR rules to be provided by the caller', () => {
    expect(() =>
      buildDrawingEvidencePrompt({
        ocrAgentRuleInstruction: '',
        userInstruction: '讀圖',
      }),
    ).toThrow('reviewed OCR agent rule instruction is required');
  });

  it('falls back to an explicit empty user request marker', () => {
    expect(
      buildDrawingEvidencePrompt({
        ocrAgentRuleInstruction: 'DB_OCR_RULE_SENTINEL',
        userInstruction: '',
      }),
    ).toBe(
      [
        'Reviewed OCR rules loaded from steel.agent_rules:',
        'DB_OCR_RULE_SENTINEL',
        '',
        'User request:',
        '(no additional user instruction)',
      ].join('\n'),
    );
  });
});
